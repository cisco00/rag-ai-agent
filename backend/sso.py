"""
sso.py — SSO / SAML 2.0 Integration — Feature #12

Stores one SAML IdP configuration per org in `sso_configs`.
Provides helpers used by routers/sso.py to:
  • serve SP metadata XML
  • build a SAML AuthnRequest redirect URL (SSO login initiation)
  • process an Assertion Consumer Service (ACS) POST from the IdP
  • exchange the validated assertion for a local JWT (same flow as password login)

The SP entity-ID and ACS URL are derived from the request's base URL so
they work whether the backend is running on localhost or a production domain.

python3-saml is used as the SAML library.  If it's not installed the module
still imports cleanly — every function that requires it will raise a clear
RuntimeError so the rest of the application is unaffected.
"""

import json
import logging
from typing import Optional

from sqlalchemy import text
from models import admin_engine

logger = logging.getLogger(__name__)


# ── Schema ─────────────────────────────────────────────────────────────────────

def ensure_sso_tables() -> None:
    with admin_engine.begin() as conn:
        dialect = admin_engine.dialect.name
        if dialect == "sqlite":
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sso_configs (
                    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                    org_id             INTEGER NOT NULL UNIQUE,
                    is_enabled         INTEGER DEFAULT 0,
                    idp_entity_id      TEXT,
                    idp_sso_url        TEXT,
                    idp_slo_url        TEXT,
                    idp_x509_cert      TEXT,
                    sp_entity_id       TEXT,
                    attribute_email    TEXT  DEFAULT 'email',
                    attribute_name     TEXT  DEFAULT 'name',
                    attribute_role     TEXT  DEFAULT 'role',
                    default_role       TEXT  DEFAULT 'viewer',
                    provider_name      TEXT  DEFAULT 'SSO',
                    created_at         TEXT  DEFAULT (datetime('now')),
                    updated_at         TEXT  DEFAULT (datetime('now'))
                )
            """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sso_configs (
                    id                 SERIAL PRIMARY KEY,
                    org_id             INTEGER NOT NULL UNIQUE,
                    is_enabled         INTEGER DEFAULT 0,
                    idp_entity_id      TEXT,
                    idp_sso_url        TEXT,
                    idp_slo_url        TEXT,
                    idp_x509_cert      TEXT,
                    sp_entity_id       TEXT,
                    attribute_email    TEXT  DEFAULT 'email',
                    attribute_name     TEXT  DEFAULT 'name',
                    attribute_role     TEXT  DEFAULT 'role',
                    default_role       TEXT  DEFAULT 'viewer',
                    provider_name      TEXT  DEFAULT 'SSO',
                    created_at         TIMESTAMP DEFAULT NOW(),
                    updated_at         TIMESTAMP DEFAULT NOW()
                )
            """))


# ── CRUD ───────────────────────────────────────────────────────────────────────

def _row(r) -> dict:
    d = dict(r._mapping)
    d["is_enabled"] = bool(d.get("is_enabled", 0))
    return d


def get_config(org_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM sso_configs WHERE org_id = :oid"),
            {"oid": org_id},
        ).fetchone()
    return _row(row) if row else None


def upsert_config(org_id: int, **fields) -> dict:
    """Create or update SSO config for an org."""
    allowed = {
        "is_enabled", "idp_entity_id", "idp_sso_url", "idp_slo_url",
        "idp_x509_cert", "sp_entity_id", "attribute_email", "attribute_name",
        "attribute_role", "default_role", "provider_name",
    }
    fields = {k: v for k, v in fields.items() if k in allowed}

    existing = get_config(org_id)
    dialect = admin_engine.dialect.name
    ts = "datetime('now')" if dialect == "sqlite" else "NOW()"

    if existing:
        if not fields:
            return existing
        set_clause = ", ".join(f"{k} = :{k}" for k in fields)
        fields["_oid"] = org_id
        with admin_engine.begin() as conn:
            conn.execute(
                text(f"UPDATE sso_configs SET {set_clause}, updated_at = {ts} WHERE org_id = :_oid"),
                fields,
            )
    else:
        # Insert with defaults
        cols = ["org_id"] + list(fields.keys())
        vals = [":org_id"] + [f":{k}" for k in fields.keys()]
        fields["org_id"] = org_id
        with admin_engine.begin() as conn:
            conn.execute(
                text(f"INSERT INTO sso_configs ({', '.join(cols)}) VALUES ({', '.join(vals)})"),
                fields,
            )
    return get_config(org_id)


# ── SAML helpers ───────────────────────────────────────────────────────────────

def _get_saml_settings(config: dict, base_url: str) -> dict:
    """
    Build the python3-saml settings dict from a stored config + runtime base_url.
    The SP entity ID is either what the admin stored or auto-derived from base_url.
    """
    sp_entity_id = config.get("sp_entity_id") or f"{base_url}/auth/saml/metadata"
    acs_url      = f"{base_url}/auth/saml/acs"
    slo_url      = f"{base_url}/auth/saml/slo"

    # Strip formatting artifacts from the cert (headers, whitespace)
    raw_cert = (config.get("idp_x509_cert") or "").strip()
    raw_cert = (raw_cert
                .replace("-----BEGIN CERTIFICATE-----", "")
                .replace("-----END CERTIFICATE-----", "")
                .replace("\n", "")
                .replace("\r", "")
                .replace(" ", ""))

    return {
        "strict": True,
        "debug": False,
        "sp": {
            "entityId": sp_entity_id,
            "assertionConsumerService": {
                "url": acs_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": slo_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": config.get("idp_entity_id") or "",
            "singleSignOnService": {
                "url": config.get("idp_sso_url") or "",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "singleLogoutService": {
                "url": config.get("idp_slo_url") or config.get("idp_sso_url") or "",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": raw_cert,
        },
    }


def _require_saml():
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth  # noqa
        from onelogin.saml2.utils import OneLogin_Saml2_Utils  # noqa
    except ImportError:
        raise RuntimeError(
            "python3-saml is not installed. "
            "Run: pip install python3-saml>=1.15.0"
        )


def build_sp_metadata(org_id: int, base_url: str) -> str:
    """Return SP metadata XML for this org."""
    _require_saml()
    from onelogin.saml2.settings import OneLogin_Saml2_Settings

    config = get_config(org_id)
    if not config:
        config = {}

    settings_data = _get_saml_settings(config, base_url)
    settings = OneLogin_Saml2_Settings(settings=settings_data, sp_validation_only=True)
    metadata = settings.get_sp_metadata()
    errors = settings.validate_metadata(metadata)
    if errors:
        raise ValueError(f"SP metadata invalid: {errors}")
    return metadata.decode("utf-8") if isinstance(metadata, bytes) else metadata


def initiate_login(org_id: int, base_url: str, relay_state: str = "") -> str:
    """
    Return the IdP redirect URL to start SAML login.
    The frontend redirects the browser there.
    """
    _require_saml()
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    config = get_config(org_id)
    if not config or not config.get("is_enabled"):
        raise ValueError("SSO is not enabled for this organisation")
    if not config.get("idp_sso_url"):
        raise ValueError("IdP SSO URL is not configured")

    settings_data = _get_saml_settings(config, base_url)
    req = {
        "https":            "on" if base_url.startswith("https") else "off",
        "http_host":        base_url.split("://", 1)[-1].split("/")[0],
        "script_name":      "/auth/saml/acs",
        "server_port":      "",
        "get_data":         {},
        "post_data":        {},
        "query_string":     "",
    }
    auth = OneLogin_Saml2_Auth(req, old_settings=settings_data)
    return auth.login(return_to=relay_state or base_url)


def process_acs(
    org_id: int,
    base_url: str,
    post_data: dict,
    query_string: str = "",
) -> dict:
    """
    Validate the SAML response POSTed to the ACS endpoint.
    Returns a dict with: email, name, role (from attributes or defaults).
    Raises ValueError on invalid assertion.
    """
    _require_saml()
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    config = get_config(org_id)
    if not config:
        raise ValueError("No SSO config for this org")

    settings_data = _get_saml_settings(config, base_url)
    parsed_host   = base_url.split("://", 1)[-1].split("/")[0]
    req = {
        "https":        "on" if base_url.startswith("https") else "off",
        "http_host":    parsed_host,
        "script_name":  "/auth/saml/acs",
        "server_port":  "",
        "get_data":     {},
        "post_data":    post_data,
        "query_string": query_string,
    }
    auth = OneLogin_Saml2_Auth(req, old_settings=settings_data)
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or str(errors)
        raise ValueError(f"SAML assertion invalid: {reason}")
    if not auth.is_authenticated():
        raise ValueError("SAML authentication failed")

    attrs = auth.get_attributes()

    def _attr(key: str) -> str:
        """Pull the first value of a SAML attribute."""
        val = attrs.get(key) or attrs.get(key.lower()) or []
        return val[0] if val else ""

    email_attr = config.get("attribute_email") or "email"
    name_attr  = config.get("attribute_name")  or "name"
    role_attr  = config.get("attribute_role")  or "role"

    email = _attr(email_attr) or auth.get_nameid() or ""
    name  = _attr(name_attr)  or email.split("@")[0]
    role  = _attr(role_attr)  or config.get("default_role") or "viewer"

    return {"email": email, "name": name, "role": role}
