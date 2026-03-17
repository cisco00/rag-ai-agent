"""
auth.py — User authentication & role-based access control for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Fixes applied
─────────────
Bug #2  — change_password now uses _get_user_with_hash() which includes
           password_hash in the SELECT. get_user_by_id() intentionally omits
           it (no hash in HTTP responses), so a separate internal helper is used.
Bug #7  — Duplicate get_current_user / decode_access_token removed from
           dependencies.py. auth.py is the single source of truth; routers
           should import these from auth.py only.
Bug #11 — change_password no longer touches last_login_at. Password changes
           are not login events; setting last_login_at was corrupting audit data.
"""

import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import text
from fastapi import Depends, HTTPException, Header, Response
from pydantic import BaseModel, field_validator

from models import engine as admin_engine
from logging_config import get_logger

logger = get_logger(__name__)

from dependencies import (
    JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL,
    ROLES, ROLE_RANK, _P,
)

# ─── Cookie configuration ─────────────────────────────────────────────────────
_SECURE_COOKIES: bool = os.getenv("SECURE_COOKIES", "true").lower() not in ("false", "0", "no")

COOKIE_REFRESH = "vantage_refresh_token"
COOKIE_API_KEY = "vantage_api_key"


def _set_auth_cookies(response: Response, refresh_token: str, api_key: str) -> None:
    common = dict(
        httponly  = True,
        samesite  = "lax",
        secure    = _SECURE_COOKIES,
        path      = "/",
    )
    response.set_cookie(
        key      = COOKIE_REFRESH,
        value    = refresh_token,
        max_age  = REFRESH_TOKEN_TTL * 24 * 60 * 60,
        **common,
    )
    response.set_cookie(
        key      = COOKIE_API_KEY,
        value    = api_key,
        max_age  = REFRESH_TOKEN_TTL * 24 * 60 * 60,
        **common,
    )


def _clear_auth_cookies(response: Response) -> None:
    for name in (COOKIE_REFRESH, COOKIE_API_KEY):
        response.delete_cookie(
            key      = name,
            path     = "/",
            samesite = "lax",
            secure   = _SECURE_COOKIES,
            httponly = True,
        )


# ─── Schema creation ──────────────────────────────────────────────────────────

def ensure_auth_tables():
    """Create users, refresh_tokens, and invite_tokens tables on startup."""
    dialect = admin_engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE IF NOT EXISTS users (
                id            SERIAL PRIMARY KEY,
                org_id        INTEGER NOT NULL,
                email         TEXT NOT NULL,
                display_name  TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'analyst',
                is_active     INTEGER NOT NULL DEFAULT 1,
                last_login_at TEXT,
                created_at    TEXT NOT NULL,
                UNIQUE (org_id, email)
            );
            CREATE INDEX IF NOT EXISTS ix_users_org_id ON users (org_id);
            CREATE INDEX IF NOT EXISTS ix_users_email  ON users (email);

            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id
                ON refresh_tokens (user_id);

            CREATE TABLE IF NOT EXISTS invite_tokens (
                id         SERIAL PRIMARY KEY,
                org_id     INTEGER NOT NULL,
                email      TEXT NOT NULL,
                role       TEXT NOT NULL DEFAULT 'analyst',
                token_hash TEXT NOT NULL UNIQUE,
                invited_by INTEGER,
                expires_at TEXT NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
        """
    else:
        ddl = """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id        INTEGER NOT NULL,
                email         TEXT NOT NULL,
                display_name  TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'analyst',
                is_active     INTEGER NOT NULL DEFAULT 1,
                last_login_at TEXT,
                created_at    TEXT NOT NULL,
                UNIQUE (org_id, email)
            );

            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS invite_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id     INTEGER NOT NULL,
                email      TEXT NOT NULL,
                role       TEXT NOT NULL DEFAULT 'analyst',
                token_hash TEXT NOT NULL UNIQUE,
                invited_by INTEGER,
                expires_at TEXT NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
        """

    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


# ─── Password helpers ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def validate_password_strength(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    special = set(string.digits + string.punctuation)
    if not any(c in special for c in password):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one digit or special character.",
        )


# ─── Token helpers ────────────────────────────────────────────────────────────

def _make_access_token(user_id: int, org_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_TTL)
    return jwt.encode(
        {"sub": str(user_id), "org_id": org_id, "role": role,
         "exp": expire, "type": "access"},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


def _make_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hash)."""
    import hashlib
    raw    = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise JWTError("Not an access token")
        return payload
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {exc}")


# ─── User CRUD ────────────────────────────────────────────────────────────────

def create_user(org_id: int, email: str, password: str,
                role: str = "analyst", display_name: Optional[str] = None) -> dict:
    validate_password_strength(password)
    if role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {ROLES}")
    pw_hash = hash_password(password)
    now     = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            try:
                result = conn.execute(text("""
                    INSERT INTO users
                        (org_id, email, display_name, password_hash, role, is_active, created_at)
                    VALUES (:org_id, :email, :display_name, :pw_hash, :role, 1, :now)
                    RETURNING id
                """), {
                    "org_id": org_id, "email": email.lower().strip(),
                    "display_name": display_name or email.split("@")[0],
                    "pw_hash": pw_hash, "role": role, "now": now,
                })
                user_id = result.scalar()
            except Exception:
                # SQLite fallback (no RETURNING support on older versions)
                conn.execute(text("""
                    INSERT INTO users
                        (org_id, email, display_name, password_hash, role, is_active, created_at)
                    VALUES (:org_id, :email, :display_name, :pw_hash, :role, 1, :now)
                """), {
                    "org_id": org_id, "email": email.lower().strip(),
                    "display_name": display_name or email.split("@")[0],
                    "pw_hash": pw_hash, "role": role, "now": now,
                })
                user_id = conn.execute(
                    text("SELECT id FROM users WHERE org_id=:o AND email=:e"),
                    {"o": org_id, "e": email.lower().strip()},
                ).scalar()
    return get_user_by_id(user_id)


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Return user dict WITHOUT password_hash (safe for HTTP responses)."""
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, org_id, email, display_name, role, is_active, "
                 "last_login_at, created_at FROM users WHERE id = :id"),
            {"id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def _get_user_with_hash(user_id: int) -> Optional[dict]:
    """
    Internal helper that includes password_hash.
    Fix #2: change_password uses this instead of get_user_by_id so it can
    verify the current password without a KeyError.
    NEVER return this dict in an HTTP response.
    """
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM users WHERE id = :id"),
            {"id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_email(org_id: int, email: str) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM users "
                 "WHERE org_id = :org_id AND email = :email AND is_active = 1"),
            {"org_id": org_id, "email": email.lower().strip()},
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_email_global(email: str) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM users WHERE email = :email AND is_active = 1 LIMIT 1"),
            {"email": email.lower().strip()},
        ).mappings().first()
    return dict(row) if row else None


def list_org_users(org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, org_id, email, display_name, role, is_active, "
                 "last_login_at, created_at FROM users "
                 "WHERE org_id = :org_id ORDER BY created_at DESC"),
            {"org_id": org_id},
        ).mappings().all()
    return [dict(r) for r in rows]


def update_user_role(org_id: int, user_id: int, new_role: str):
    if new_role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role.")
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE users SET role=:role WHERE id=:id AND org_id=:org_id"),
                {"role": new_role, "id": user_id, "org_id": org_id},
            )


def deactivate_user(org_id: int, user_id: int):
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE users SET is_active=0 WHERE id=:id AND org_id=:org_id"),
                {"id": user_id, "org_id": org_id},
            )


def change_password(user_id: int, current_password: str, new_password: str) -> None:
    """
    Verify the current password then replace it with the new one.

    Fix #2: Uses _get_user_with_hash() so password_hash is available for
    bcrypt verification. get_user_by_id() omits it intentionally.

    Fix #11: Does NOT update last_login_at — changing a password is not a
    login event. The old code was corrupting audit timestamps.
    """
    user = _get_user_with_hash(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if not verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    validate_password_strength(new_password)
    new_hash = hash_password(new_password)
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                # Fix #11: only update password_hash, not last_login_at
                text("UPDATE users SET password_hash=:h WHERE id=:id"),
                {"h": new_hash, "id": user_id},
            )


# ─── Login / Refresh / Logout ─────────────────────────────────────────────────

def register_first_user(email: str, password: str,
                         display_name: Optional[str] = None,
                         org_id: Optional[int] = None) -> dict:
    """
    Create the first owner user for an org right after org registration.
    Returns the full login payload (access_token, refresh_token, api_key, user).
    """
    if org_id is None:
        raise HTTPException(status_code=400,
                            detail="org_id is required for register_first_user")
    create_user(org_id=org_id, email=email, password=password,
                role="owner", display_name=display_name)
    return login_user(email=email, password=password, org_id=org_id)


def login_user(email: str, password: str, org_id: Optional[int] = None) -> dict:
    email = email.lower().strip()
    user  = get_user_by_email(org_id, email) if org_id else get_user_by_email_global(email)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    effective_org_id = user["org_id"]
    with admin_engine.connect() as conn:
        org_row = conn.execute(
            text("SELECT api_key FROM organizations WHERE id = :id"),
            {"id": effective_org_id},
        ).mappings().first()
    api_key = org_row["api_key"] if org_row else None

    access_token          = _make_access_token(user["id"], effective_org_id, user["role"])
    raw_refresh, ref_hash = _make_refresh_token()
    expires_at            = (datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL)).isoformat()
    now                   = datetime.now(timezone.utc).isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
                VALUES (:user_id, :token_hash, :expires_at, :now)
            """), {"user_id": user["id"], "token_hash": ref_hash,
                   "expires_at": expires_at, "now": now})
            conn.execute(
                text("UPDATE users SET last_login_at=:now WHERE id=:id"),
                {"now": now, "id": user["id"]},
            )

    return {
        "access_token":  access_token,
        "refresh_token": raw_refresh,
        "api_key":       api_key,
        "token_type":    "bearer",
        "expires_in":    ACCESS_TOKEN_TTL * 60,
        "user": {
            "id":           user["id"],
            "email":        user["email"],
            "display_name": user["display_name"],
            "role":         user["role"],
            "permissions":  get_role_permissions(user["role"]),
        },
    }


def refresh_access_token(raw_refresh_token: str) -> dict:
    """
    Exchange a refresh token for a new access token.
    The refresh token is validated against its SHA-256 hash in the DB.
    """
    import hashlib
    ref_hash = hashlib.sha256(raw_refresh_token.encode()).hexdigest()
    now      = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT rt.*, u.org_id, u.role FROM refresh_tokens rt "
                 "JOIN users u ON u.id = rt.user_id "
                 "WHERE rt.token_hash = :hash AND rt.expires_at > :now"),
            {"hash": ref_hash, "now": now},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")
    return {
        "access_token": _make_access_token(row["user_id"], row["org_id"], row["role"]),
        "token_type":   "bearer",
        "expires_in":   ACCESS_TOKEN_TTL * 60,
    }


def logout_user(raw_refresh_token: str):
    import hashlib
    ref_hash = hashlib.sha256(raw_refresh_token.encode()).hexdigest()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("DELETE FROM refresh_tokens WHERE token_hash = :hash"),
                {"hash": ref_hash},
            )


# ─── Invite flow ──────────────────────────────────────────────────────────────

def create_invite(org_id: int, email: str, role: str, invited_by: int) -> str:
    import hashlib
    if role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role.")
    raw        = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    now        = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO invite_tokens
                    (org_id, email, role, token_hash, invited_by, expires_at, used, created_at)
                VALUES
                    (:org_id, :email, :role, :token_hash, :invited_by, :expires_at, 0, :now)
            """), {
                "org_id": org_id, "email": email.lower().strip(),
                "role": role, "token_hash": token_hash,
                "invited_by": invited_by, "expires_at": expires_at, "now": now,
            })
    return raw


def accept_invite(raw_token: str, password: str,
                  display_name: Optional[str] = None) -> dict:
    import hashlib
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    now        = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        invite = conn.execute(
            text("SELECT * FROM invite_tokens "
                 "WHERE token_hash=:h AND used=0 AND expires_at>:now"),
            {"h": token_hash, "now": now},
        ).mappings().first()
    if not invite:
        raise HTTPException(status_code=400, detail="Invite token is invalid or has expired.")
    create_user(
        org_id=invite["org_id"], email=invite["email"],
        password=password, role=invite["role"],
        display_name=display_name,
    )
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE invite_tokens SET used=1 WHERE token_hash=:h"),
                {"h": token_hash},
            )
    return login_user(email=invite["email"], password=password, org_id=invite["org_id"])


# ─── Permission helpers ───────────────────────────────────────────────────────

def get_role_permissions(role: str) -> dict[str, bool]:
    return {perm: (role in members) for perm, members in _P.items()}


def get_role_summary() -> dict[str, dict]:
    labels = {
        "owner":             "Owner — full control including user and org management",
        "admin":             "Admin — full data and user management, cannot remove owner",
        "business_owner":    "Business Owner — query, dashboards, insights, exports; read-only data",
        "product_manager":   "Product Manager — query, dashboards, insights, exports; read-only data",
        "operation_manager": "Operations Manager — query, dashboards, alerts, exports; read-only data",
        "analyst":           "Analyst — full data access (import, transform, analytics); no user management",
        "sales_team":        "Sales Team — query, dashboards (view + pin), exports, insights",
        "marketing_team":    "Marketing Team — query, dashboards (view + pin), exports, insights",
        "viewer":            "Viewer — query and view dashboards only",
    }
    return {
        role: {
            "label":       labels.get(role, role),
            "rank":        ROLE_RANK[role],
            "permissions": get_role_permissions(role),
        }
        for role in ROLES
    }


# ─── FastAPI dependencies ─────────────────────────────────────────────────────

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI dependency. Single authoritative definition (Bug #7).
    Routers should import this from auth.py, not from dependencies.py.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing or malformed. Use: Bearer <token>",
        )
    token   = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    user    = get_user_by_id(int(payload["sub"]))
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User not found or deactivated.")
    return user


def require_role(*roles: str):
    """Exact role match dependency."""
    async def _check(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of: {roles}. Your role: {user['role']}",
            )
        return user
    return _check


def require_min_role(min_role: str):
    """Role rank gate dependency."""
    async def _check(user: dict = Depends(get_current_user)):
        if ROLE_RANK.get(user["role"], 99) > ROLE_RANK.get(min_role, 0):
            raise HTTPException(
                status_code=403,
                detail=f"Requires at least '{min_role}' role.",
            )
        return user
    return _check


# ─── Pydantic models ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterUserRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def strong_password(cls, v):
        special = set(string.digits + string.punctuation)
        if len(v) < 8 or not any(c in special for c in v):
            raise ValueError("Password must be ≥8 chars and contain a digit or special char.")
        return v

class InviteRequest(BaseModel):
    email: str
    role: str = "analyst"

class AcceptInviteRequest(BaseModel):
    token: str
    password: str
    display_name: Optional[str] = None

class UpdateRoleRequest(BaseModel):
    role: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str