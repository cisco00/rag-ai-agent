"""
dependencies.py — Shared FastAPI dependencies and in-process caches.

All routers import from here to share auth, connection helpers, and caches
instead of each redefining them.

Fixes applied
─────────────
Bug #7  — Removed duplicate get_current_user, decode_access_token, and
           require_min_role. auth.py is the single source of truth. Importing
           both would cause silent shadowing depending on import order.
Bug #8  — JWT_SECRET now fails loudly at startup in production when not set.
           The old hardcoded default (committed to source) allowed anyone who
           read the repo to forge valid tokens for any user.
Bug #10 — schema_cache import is now wrapped in a try/except with stub
           fallbacks so startup does not crash with ModuleNotFoundError when
           schema_cache.py is not present.
"""

import os
import secrets
import threading
import logging
from typing import Optional

from fastapi import Header, HTTPException, Depends
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from models import get_org_by_api_key
from database import DatabaseManager

logger = logging.getLogger(__name__)

# ── Bug #10: safe import of schema_cache ──────────────────────────────────────
# schema_cache.py is a project file not included in this upload set.
# Provide stub fallbacks so the server starts even if the file is missing.
try:
    from schema_cache import get_cached_schema_summary, invalidate_schema_cache
except ImportError:
    logger.warning(
        "schema_cache module not found — schema caching disabled. "
        "Add schema_cache.py to enable it."
    )
    def get_cached_schema_summary(*args, **kwargs):
        return None
    def invalidate_schema_cache(*args, **kwargs):
        pass

# ── Rate Limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ── Caches ────────────────────────────────────────────────────────────────────
FILE_DB_CACHE: dict = {}
FILE_DB_CACHE_LOCK = threading.Lock()


def get_org_connection_string(org, prefer_file_db: bool = True) -> Optional[str]:
    """
    Get the connection string for an organization.
    If prefer_file_db is True and a file-based DB is cached, returns that.
    Otherwise returns the org's configured db_connection_string.
    """
    if prefer_file_db:
        with FILE_DB_CACHE_LOCK:
            if org.api_key in FILE_DB_CACHE:
                return FILE_DB_CACHE[org.api_key]

        # Sanitize api_key to prevent directory traversal
        import re
        safe_api_key = re.sub(r'[^a-zA-Z0-9_]', '', org.api_key)

        # Fallback: check /data/ directory for the default file database
        temp_db_path = f"/data/file_db_{safe_api_key}.sqlite"

        if os.path.exists(temp_db_path):
            conn_str = f"sqlite:///{temp_db_path}"
            with FILE_DB_CACHE_LOCK:
                FILE_DB_CACHE[org.api_key] = conn_str
            return conn_str

    return org.db_connection_string


async def get_current_org(x_api_key: str = Header(...)):
    """Dependency to get the current organization from the X-API-KEY header."""
    org = get_org_by_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Valid X-API-KEY required")
    return org


# ── Auth constants ────────────────────────────────────────────────────────────
#
# Bug #8: JWT_SECRET no longer has a hardcoded fallback in production.
# A known-public secret in source code lets anyone forge tokens.
#
# Behaviour:
#   ENVIRONMENT=production and JWT_SECRET unset → hard startup failure.
#   Other environments and JWT_SECRET unset      → random ephemeral secret
#                                                   with a warning (dev only).
#
_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_SECRET   = os.getenv("JWT_SECRET")

if not JWT_SECRET:
    if _ENVIRONMENT == "production":
        raise RuntimeError(
            "[Auth] JWT_SECRET must be set explicitly in production.\n"
            "Example: JWT_SECRET=$(openssl rand -hex 32)\n"
            "A hardcoded or missing secret allows token forgery for every user."
        )
    # Development/staging: generate a random secret per process.
    # Tokens are invalidated on every restart, which is acceptable for dev.
    JWT_SECRET = secrets.token_hex(32)
    logger.warning(
        "[Auth] JWT_SECRET not set — using a random ephemeral secret. "
        "All sessions will be invalidated on restart. "
        "Set JWT_SECRET in your .env for stable development sessions."
    )

JWT_ALGORITHM     = "HS256"
ACCESS_TOKEN_TTL  = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "60"))
REFRESH_TOKEN_TTL = int(os.getenv("REFRESH_TOKEN_TTL_DAYS",   "30"))

ROLES: tuple[str, ...] = (
    "owner", "admin", "business_owner", "product_manager",
    "operation_manager", "analyst", "sales_team", "marketing_team", "viewer",
)
ROLE_RANK: dict[str, int] = {r: i for i, r in enumerate(ROLES)}

# Permission groups (SET of roles that may perform those actions)
_P: dict[str, frozenset] = {
    "WRITE_DATA":        frozenset({"owner", "admin", "analyst"}),
    "MUTATE_TABLES":     frozenset({"owner", "admin", "analyst"}),
    "MANAGE_SYNCS":      frozenset({"owner", "admin", "analyst"}),
    "MANAGE_ALERTS":     frozenset({"owner", "admin", "operation_manager", "analyst"}),
    "MANAGE_DASHBOARDS": frozenset({"owner", "admin", "business_owner", "product_manager",
                                    "operation_manager", "analyst"}),
    "MANAGE_ORG":        frozenset({"owner", "admin", "business_owner"}),
    "MANAGE_USERS":      frozenset({"owner", "admin", "business_owner"}),
    "EXPORT":            frozenset({"owner", "admin", "business_owner", "product_manager",
                                    "operation_manager", "analyst", "sales_team", "marketing_team"}),
    "VIEW_ADVANCED":     frozenset({"owner", "admin", "business_owner", "product_manager",
                                    "operation_manager", "analyst"}),
    "VIEW_REPORTS":      frozenset({"owner", "admin", "business_owner", "product_manager",
                                    "operation_manager", "analyst", "sales_team", "marketing_team"}),
}

_P_LABELS: dict[str, str] = {
    "WRITE_DATA":        "import or modify data",
    "MUTATE_TABLES":     "delete or structurally edit tables",
    "MANAGE_SYNCS":      "manage scheduled syncs",
    "MANAGE_ALERTS":     "create or edit alert rules",
    "MANAGE_DASHBOARDS": "create or edit dashboards",
    "MANAGE_ORG":        "manage org configuration",
    "MANAGE_USERS":      "manage users",
    "EXPORT":            "export reports",
    "VIEW_ADVANCED":     "use advanced analytics",
    "VIEW_REPORTS":      "view scheduled reports",
}

# ── Permission helpers ────────────────────────────────────────────────────────
# NOTE: get_current_user, decode_access_token, and require_min_role have been
# removed from this module (Bug #7).  Import them from auth.py:
#
#   from auth import get_current_user, decode_access_token, require_min_role
#
# Keeping duplicates here caused routers that imported from different modules
# to behave inconsistently.

def has_permission(user: dict, permission: str) -> bool:
    group = _P.get(permission)
    return group is not None and user.get("role") in group


def require_permission(permission: str):
    """
    FastAPI dependency that enforces a named permission.
    Import get_current_user from auth.py for the inner dependency.
    """
    from auth import get_current_user as _get_current_user
    async def _dep(user: dict = Depends(_get_current_user)):
        if not has_permission(user, permission):
            label = _P_LABELS.get(permission, permission)
            raise HTTPException(
                status_code=403,
                detail=f"Your role '{user['role']}' does not have permission to {label}."
            )
        return user
    return _dep