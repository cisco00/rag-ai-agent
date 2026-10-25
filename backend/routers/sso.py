"""
routers/sso.py — SSO / SAML 2.0 Routes — Feature #12

Public (no auth required):
  GET  /auth/saml/{org_id}/metadata   — SP metadata XML served to IdP admins
  GET  /auth/saml/{org_id}/login      — initiate SAML login (redirect to IdP)
  POST /auth/saml/{org_id}/acs        — Assertion Consumer Service (IdP posts here)
  GET  /auth/saml/{org_id}/slo        — Single Logout (redirect from IdP)

Admin (MANAGE_ORG required):
  GET  /sso/config                    — get current SSO config (cert redacted)
  PUT  /sso/config                    — save/update SSO config
  POST /sso/test                      — validate config completeness
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Depends, Form
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

import sso
from auth import get_current_user, get_user_by_email_global, _make_access_token, _make_refresh_token
from dependencies import get_current_org, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── helpers ──────────────────────────────────────────────────────────────────

def _base_url(request: Request) -> str:
    """Derive the SP base URL from the incoming request (scheme + host)."""
    # Allow override via X-Forwarded-Proto for reverse-proxy deployments
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host  = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def _issue_tokens(user: dict, org_id: int) -> dict:
    """Issue access + refresh tokens for an SSO-authenticated user."""
    import hashlib
    from models import admin_engine
    from sqlalchemy import text
    from datetime import datetime, timezone, timedelta
    from config import REFRESH_TOKEN_TTL

    access_token = _make_access_token(
        user["id"], org_id, user["role"],
        is_superuser=int(user.get("is_superuser", 0))
    )
    raw_refresh, refresh_hash = _make_refresh_token()

    expire_at = (datetime.now(timezone.utc) + timedelta(minutes=REFRESH_TOKEN_TTL)).isoformat()
    with admin_engine.begin() as conn:
        # Remove stale refresh tokens for this user
        conn.execute(
            text("DELETE FROM refresh_tokens WHERE user_id = :uid"),
            {"uid": user["id"]},
        )
        conn.execute(
            text("""
                INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (:uid, :hash, :exp)
            """),
            {"uid": user["id"], "hash": refresh_hash, "exp": expire_at},
        )

    return {
        "access_token":  access_token,
        "refresh_token": raw_refresh,
        "token_type":    "bearer",
        "user": {
            "id":           user["id"],
            "email":        user["email"],
            "display_name": user.get("display_name"),
            "role":         user["role"],
            "org_id":       org_id,
        },
    }


def _get_or_provision_user(org_id: int, email: str, name: str, role: str) -> dict:
    """
    Return existing user or create a new one (JIT provisioning).
    Existing users keep their current role — the IdP role only applies to new accounts.
    """
    from auth import get_user_by_email_global
    from models import admin_engine
    from sqlalchemy import text
    from datetime import datetime, timezone

    email = email.lower().strip()
    existing = get_user_by_email_global(email)
    if existing:
        return existing

    # JIT provision
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.begin() as conn:
        try:
            result = conn.execute(text("""
                INSERT INTO users (org_id, email, display_name, password_hash, role, is_active, created_at)
                VALUES (:org_id, :email, :name, '', :role, 1, :now)
                RETURNING id
            """), {"org_id": org_id, "email": email, "name": name or email.split("@")[0],
                   "role": role, "now": now})
            user_id = result.scalar()
        except Exception:
            conn.execute(text("""
                INSERT INTO users (org_id, email, display_name, password_hash, role, is_active, created_at)
                VALUES (:org_id, :email, :name, '', :role, 1, :now)
            """), {"org_id": org_id, "email": email, "name": name or email.split("@")[0],
                   "role": role, "now": now})
            user_id = conn.execute(
                text("SELECT id FROM users WHERE org_id=:o AND email=:e"),
                {"o": org_id, "e": email},
            ).scalar()

    from auth import get_user_by_id
    return get_user_by_id(user_id)


# ─── Public SAML endpoints ────────────────────────────────────────────────────

@router.get("/auth/saml/{org_id}/metadata", response_class=Response)
async def saml_metadata(org_id: int, request: Request):
    """Serve SP metadata XML — hand this URL to your IdP administrator."""
    try:
        xml = sso.build_sp_metadata(org_id, _base_url(request))
        return Response(content=xml, media_type="application/xml")
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error(f"SAML metadata error org={org_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/saml/{org_id}/login")
async def saml_login(org_id: int, request: Request, relay_state: str = ""):
    """Redirect browser to the IdP for authentication."""
    try:
        redirect_url = sso.initiate_login(org_id, _base_url(request), relay_state)
        return RedirectResponse(url=redirect_url, status_code=302)
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"SAML login error org={org_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auth/saml/{org_id}/acs")
async def saml_acs(
    org_id: int,
    request: Request,
    SAMLResponse: str = Form(...),
    RelayState: str = Form(default=""),
):
    """
    Assertion Consumer Service — the IdP POSTs the SAML response here.
    Validates the assertion and returns JWT tokens (same shape as /auth/login).
    """
    try:
        post_data     = {"SAMLResponse": SAMLResponse, "RelayState": RelayState}
        user_attrs    = sso.process_acs(org_id, _base_url(request), post_data)
        user          = _get_or_provision_user(
            org_id,
            user_attrs["email"],
            user_attrs["name"],
            user_attrs["role"],
        )
        if not user:
            raise HTTPException(status_code=400, detail="Failed to provision SSO user")

        token_data = _issue_tokens(user, org_id)
        return token_data

    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SAML ACS error org={org_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/saml/{org_id}/slo")
async def saml_slo(org_id: int, request: Request):
    """Single Logout — IdP redirects here to end the session."""
    # For a pure JWT / stateless setup, the client just discards the token.
    # A real SLO would also invalidate the refresh token.
    return {"message": "Logged out. Please discard your local token."}


# ─── Admin config endpoints ───────────────────────────────────────────────────

class SSOConfigUpdate(BaseModel):
    is_enabled:       Optional[bool]   = None
    idp_entity_id:    Optional[str]    = None
    idp_sso_url:      Optional[str]    = None
    idp_slo_url:      Optional[str]    = None
    idp_x509_cert:    Optional[str]    = None
    sp_entity_id:     Optional[str]    = None
    attribute_email:  Optional[str]    = None
    attribute_name:   Optional[str]    = None
    attribute_role:   Optional[str]    = None
    default_role:     Optional[str]    = None
    provider_name:    Optional[str]    = None


@router.get("/sso/config")
async def get_sso_config(
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    config = sso.get_config(org.id)
    if not config:
        return {
            "is_enabled": False, "idp_entity_id": None, "idp_sso_url": None,
            "idp_slo_url": None, "idp_x509_cert": None, "sp_entity_id": None,
            "attribute_email": "email", "attribute_name": "name",
            "attribute_role": "role", "default_role": "viewer",
            "provider_name": "SSO", "cert_configured": False,
        }
    # Redact cert for security — just signal presence
    out = dict(config)
    cert = out.get("idp_x509_cert") or ""
    out["cert_configured"] = bool(cert.strip())
    out["idp_x509_cert"]   = "***" if cert.strip() else None
    return out


@router.put("/sso/config")
async def update_sso_config(
    payload: SSOConfigUpdate,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    fields = payload.model_dump(exclude_none=True)
    if "is_enabled" in fields:
        fields["is_enabled"] = int(fields["is_enabled"])
    # If cert placeholder is sent, don't overwrite the stored cert
    if fields.get("idp_x509_cert") == "***":
        del fields["idp_x509_cert"]

    config = sso.upsert_config(org.id, **fields)
    out = dict(config)
    cert = out.get("idp_x509_cert") or ""
    out["cert_configured"] = bool(cert.strip())
    out["idp_x509_cert"]   = "***" if cert.strip() else None
    return out


@router.post("/sso/test")
async def test_sso_config(
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    """Return a checklist of what's configured and what's missing."""
    config = sso.get_config(org.id) or {}
    checks = {
        "enabled":        bool(config.get("is_enabled")),
        "idp_entity_id":  bool(config.get("idp_entity_id")),
        "idp_sso_url":    bool(config.get("idp_sso_url")),
        "idp_x509_cert":  bool((config.get("idp_x509_cert") or "").strip()),
        "attribute_map":  bool(config.get("attribute_email")),
    }
    ready   = all(checks.values())
    missing = [k for k, v in checks.items() if not v]
    return {"ready": ready, "checks": checks, "missing": missing}
