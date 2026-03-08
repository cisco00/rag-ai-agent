"""
auth.py — User authentication & role-based access control for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Adds named user accounts on top of the existing org/API-key layer.

Roles (per org):
  owner   — full access, can invite/remove users, manage billing settings
  admin   — full access except removing the owner
  analyst — can query, import data, create dashboards; cannot manage users
  viewer  — read-only: can query and view dashboards, cannot import/modify data

JWT flow:
  POST /auth/login     → {access_token, refresh_token, user}
  POST /auth/refresh   → {access_token}
  POST /auth/logout    → clears refresh token
  GET  /auth/me        → current user info

Invite flow:
  POST /auth/invite    → sends invite link (org admin+)
  POST /auth/accept    → user sets password from invite token

Password security:
  bcrypt with 12 rounds
  Minimum 8 chars, at least one digit or special char enforced

Storage: SQLAlchemy — works on both SQLite and Postgres admin DB.
"""

import os
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import text
from fastapi import Depends, HTTPException, Header
from pydantic import BaseModel, EmailStr, field_validator

from models import engine as admin_engine, get_db, Organization, get_org_by_api_key
from logging_config import get_logger

logger = get_logger(__name__)

# ─── Config ──────────────────────────────────────────────────────────────────
JWT_SECRET       = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM    = "HS256"
ACCESS_TOKEN_TTL  = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "60"))    # 1 hour
REFRESH_TOKEN_TTL = int(os.getenv("REFRESH_TOKEN_TTL_DAYS",   "30"))    # 30 days

ROLES            = ("owner", "admin", "analyst", "viewer")
ROLE_RANK        = {r: i for i, r in enumerate(ROLES)}  # owner=0 is highest

if JWT_SECRET == secrets.token_hex(32):
    logger.warning("JWT_SECRET not set — using ephemeral key. Set JWT_SECRET in env.")


# ─── Schema creation ─────────────────────────────────────────────────────────

def ensure_auth_tables():
    """Create users and invite_tokens tables. Call from lifespan startup."""
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
            detail="Password must contain at least one digit or special character."
        )


# ─── Token helpers ────────────────────────────────────────────────────────────

def _make_access_token(user_id: int, org_id: int, role: str) -> str:
    expire  = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_TTL)
    payload = {
        "sub":    str(user_id),
        "org_id": org_id,
        "role":   role,
        "exp":    expire,
        "type":   "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _make_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hash_for_storage)."""
    import hashlib
    raw   = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def decode_access_token(token: str) -> dict:
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
    now     = datetime.utcnow().isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            try:
                result = conn.execute(text("""
                    INSERT INTO users (org_id, email, display_name, password_hash, role, is_active, created_at)
                    VALUES (:org_id, :email, :display_name, :pw_hash, :role, 1, :now)
                    RETURNING id
                """), {
                    "org_id": org_id, "email": email.lower().strip(),
                    "display_name": display_name or email.split("@")[0],
                    "pw_hash": pw_hash, "role": role, "now": now,
                })
                user_id = result.scalar()
            except Exception:
                # Fallback for SQLite which doesn't support RETURNING in all versions
                conn.execute(text("""
                    INSERT INTO users (org_id, email, display_name, password_hash, role, is_active, created_at)
                    VALUES (:org_id, :email, :display_name, :pw_hash, :role, 1, :now)
                """), {
                    "org_id": org_id, "email": email.lower().strip(),
                    "display_name": display_name or email.split("@")[0],
                    "pw_hash": pw_hash, "role": role, "now": now,
                })
                user_id = conn.execute(
                    text("SELECT id FROM users WHERE org_id=:o AND email=:e"),
                    {"o": org_id, "e": email.lower().strip()}
                ).scalar()

    return get_user_by_id(user_id)


def get_user_by_id(user_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, org_id, email, display_name, role, is_active, last_login_at, created_at "
                 "FROM users WHERE id = :id"),
            {"id": user_id}
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_email(org_id: int, email: str) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM users WHERE org_id = :org_id AND email = :email AND is_active = 1"),
            {"org_id": org_id, "email": email.lower().strip()}
        ).mappings().first()
    return dict(row) if row else None


def list_org_users(org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, org_id, email, display_name, role, is_active, last_login_at, created_at "
                 "FROM users WHERE org_id = :org_id ORDER BY created_at DESC"),
            {"org_id": org_id}
        ).mappings().all()
    return [dict(r) for r in rows]


def update_user_role(org_id: int, user_id: int, new_role: str):
    if new_role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role.")
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE users SET role=:role WHERE id=:id AND org_id=:org_id"),
                {"role": new_role, "id": user_id, "org_id": org_id}
            )


def deactivate_user(org_id: int, user_id: int):
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE users SET is_active=0 WHERE id=:id AND org_id=:org_id"),
                {"id": user_id, "org_id": org_id}
            )


# ─── Login / Refresh / Logout ─────────────────────────────────────────────────

def login_user(org_id: int, email: str, password: str) -> dict:
    user = get_user_by_email(org_id, email)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Generate tokens
    access_token          = _make_access_token(user["id"], org_id, user["role"])
    raw_refresh, ref_hash = _make_refresh_token()
    expires_at            = (datetime.utcnow() + timedelta(days=REFRESH_TOKEN_TTL)).isoformat()
    now                   = datetime.utcnow().isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            # Store refresh token hash
            conn.execute(text("""
                INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
                VALUES (:user_id, :token_hash, :expires_at, :now)
            """), {"user_id": user["id"], "token_hash": ref_hash,
                   "expires_at": expires_at, "now": now})
            # Update last_login_at
            conn.execute(
                text("UPDATE users SET last_login_at=:now WHERE id=:id"),
                {"now": now, "id": user["id"]}
            )

    return {
        "access_token":  access_token,
        "refresh_token": raw_refresh,
        "token_type":    "bearer",
        "expires_in":    ACCESS_TOKEN_TTL * 60,
        "user": {
            "id":           user["id"],
            "email":        user["email"],
            "display_name": user["display_name"],
            "role":         user["role"],
        },
    }


def refresh_access_token(raw_refresh_token: str) -> dict:
    import hashlib
    ref_hash = hashlib.sha256(raw_refresh_token.encode()).hexdigest()
    now      = datetime.utcnow().isoformat()

    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT rt.*, u.org_id, u.role FROM refresh_tokens rt "
                 "JOIN users u ON u.id = rt.user_id "
                 "WHERE rt.token_hash = :hash AND rt.expires_at > :now"),
            {"hash": ref_hash, "now": now}
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
                {"hash": ref_hash}
            )


# ─── Invite flow ──────────────────────────────────────────────────────────────

def create_invite(org_id: int, email: str, role: str, invited_by: int) -> str:
    """Returns the raw invite token to be sent via email."""
    import hashlib
    if role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role.")
    raw        = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.utcnow() + timedelta(days=7)).isoformat()
    now        = datetime.utcnow().isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO invite_tokens
                    (org_id, email, role, token_hash, invited_by, expires_at, used, created_at)
                VALUES (:org_id, :email, :role, :token_hash, :invited_by, :expires_at, 0, :now)
            """), {
                "org_id": org_id, "email": email.lower().strip(),
                "role": role, "token_hash": token_hash,
                "invited_by": invited_by, "expires_at": expires_at, "now": now,
            })
    return raw


def accept_invite(raw_token: str, password: str, display_name: Optional[str] = None) -> dict:
    """Accepts an invite — creates the user, marks the token used, returns login tokens."""
    import hashlib
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    now        = datetime.utcnow().isoformat()

    with admin_engine.connect() as conn:
        invite = conn.execute(
            text("SELECT * FROM invite_tokens WHERE token_hash=:h AND used=0 AND expires_at>:now"),
            {"h": token_hash, "now": now}
        ).mappings().first()

    if not invite:
        raise HTTPException(status_code=400, detail="Invite token is invalid or has expired.")

    user = create_user(
        org_id=invite["org_id"], email=invite["email"],
        password=password, role=invite["role"],
        display_name=display_name,
    )

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE invite_tokens SET used=1 WHERE token_hash=:h"),
                {"h": token_hash}
            )

    return login_user(invite["org_id"], invite["email"], password)


# ─── FastAPI dependencies ─────────────────────────────────────────────────────

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Dependency — extracts and validates the JWT from the Authorization header.
    Usage: user = Depends(get_current_user)
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header missing or malformed.")
    token   = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    user    = get_user_by_id(int(payload["sub"]))
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User not found or deactivated.")
    return user


def require_role(*roles: str):
    """
    Returns a FastAPI dependency that enforces minimum role.
    Usage: Depends(require_role("admin", "owner"))
    """
    async def _check(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of: {roles}. Your role: {user['role']}"
            )
        return user
    return _check


def require_min_role(min_role: str):
    """
    Returns a dependency that enforces a minimum role rank.
    e.g. require_min_role("analyst") allows analyst, admin, owner.
    """
    async def _check(user: dict = Depends(get_current_user)):
        if ROLE_RANK.get(user["role"], 99) > ROLE_RANK.get(min_role, 0):
            raise HTTPException(
                status_code=403,
                detail=f"Requires at least '{min_role}' role."
            )
        return user
    return _check


# ─── Pydantic request/response models ────────────────────────────────────────

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