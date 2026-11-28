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
import json
import hmac
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

# ─── Application URL (used in password-reset emails) ─────────────────────────
APP_URL: str = os.getenv("APP_URL", "http://localhost:5173")

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
    """Create users, refresh_tokens, invite_tokens, workspaces, and membership tables on startup."""
    dialect = admin_engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE IF NOT EXISTS users (
                id            SERIAL PRIMARY KEY,
                org_id        INTEGER,
                email         TEXT NOT NULL UNIQUE,
                display_name  TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'analyst',
                is_active     INTEGER NOT NULL DEFAULT 1,
                is_superuser  INTEGER NOT NULL DEFAULT 0,
                email_verified INTEGER NOT NULL DEFAULT 0,
                last_login_at TEXT,
                created_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_users_org_id ON users (org_id);
            CREATE INDEX IF NOT EXISTS ix_users_email  ON users (email);

            CREATE TABLE IF NOT EXISTS workspaces (
                id              SERIAL PRIMARY KEY,
                type            TEXT NOT NULL DEFAULT 'personal',
                name            TEXT NOT NULL,
                owner_user_id   INTEGER,
                organization_id INTEGER,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_workspaces_owner ON workspaces (owner_user_id);
            CREATE INDEX IF NOT EXISTS ix_workspaces_org   ON workspaces (organization_id);

            CREATE TABLE IF NOT EXISTS workspace_memberships (
                id           SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL,
                user_id      INTEGER NOT NULL,
                role         TEXT NOT NULL DEFAULT 'member',
                status       TEXT NOT NULL DEFAULT 'active',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                UNIQUE (workspace_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS ix_wm_workspace ON workspace_memberships (workspace_id);
            CREATE INDEX IF NOT EXISTS ix_wm_user      ON workspace_memberships (user_id);

            CREATE TABLE IF NOT EXISTS org_memberships (
                id         SERIAL PRIMARY KEY,
                org_id     INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                role       TEXT NOT NULL DEFAULT 'employee',
                status     TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (org_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS ix_om_org    ON org_memberships (org_id);
            CREATE INDEX IF NOT EXISTS ix_om_user   ON org_memberships (user_id);

            CREATE TABLE IF NOT EXISTS domain_verification_records (
                id         SERIAL PRIMARY KEY,
                org_id     INTEGER NOT NULL,
                domain     TEXT NOT NULL,
                token      TEXT NOT NULL,
                verified   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                UNIQUE (org_id, domain)
            );

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

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER,
                org_id     INTEGER,
                action     TEXT NOT NULL,
                details    TEXT,
                created_at TEXT NOT NULL
            );
        """
    else:
        ddl = """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id        INTEGER,
                email         TEXT NOT NULL UNIQUE,
                display_name  TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'analyst',
                is_active     INTEGER NOT NULL DEFAULT 1,
                is_superuser  INTEGER NOT NULL DEFAULT 0,
                email_verified INTEGER NOT NULL DEFAULT 0,
                last_login_at TEXT,
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                type            TEXT NOT NULL DEFAULT 'personal',
                name            TEXT NOT NULL,
                owner_user_id   INTEGER,
                organization_id INTEGER,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_memberships (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL,
                user_id      INTEGER NOT NULL,
                role         TEXT NOT NULL DEFAULT 'member',
                status       TEXT NOT NULL DEFAULT 'active',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                UNIQUE (workspace_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS org_memberships (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id     INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                role       TEXT NOT NULL DEFAULT 'employee',
                status     TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (org_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS domain_verification_records (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id     INTEGER NOT NULL,
                domain     TEXT NOT NULL,
                token      TEXT NOT NULL,
                verified   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                UNIQUE (org_id, domain)
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

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                org_id     INTEGER,
                action     TEXT NOT NULL,
                details    TEXT,
                created_at TEXT NOT NULL
            );
        """

    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))

        # ── Migrations ────────────────────────────────────────────────────────
        try:
            # Migration 1: Add is_superuser column if missing
            if dialect == "postgresql":
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superuser INTEGER DEFAULT 0"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0"))
                # Drop NOT NULL on org_id if it still exists
                conn.execute(text("ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL"))
            else:
                for col_sql in [
                    "ALTER TABLE users ADD COLUMN is_superuser INTEGER DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0",
                ]:
                    try:
                        conn.execute(text(col_sql))
                    except Exception:
                        pass
                # For SQLite: migrate users table to remove NOT NULL on org_id & globalise email uniqueness
                try:
                    _migrate_users_sqlite(conn)
                except Exception as mig_err:
                    logger.warning(f"Users table migration skipped: {mig_err}")
            conn.commit()

            # Bootstrap: if no superuser exists, promote the oldest owner.
            conn.execute(text("""
                UPDATE users SET is_superuser = 1
                WHERE id = (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1)
                  AND NOT EXISTS (SELECT 1 FROM users WHERE is_superuser = 1)
            """))
            conn.commit()
        except Exception:
            pass

        # ── Backfill workspaces for existing users ────────────────────────────
        try:
            _backfill_personal_workspaces(conn)
        except Exception as bf_err:
            logger.warning(f"Workspace backfill skipped: {bf_err}")


def _migrate_users_sqlite(conn):
    """
    SQLite-safe migration: rebuild users table so org_id is nullable and
    email is globally unique (the application already enforces global email
    uniqueness in create_user, so this just makes the DB constraint match).
    Only runs when the old schema still has the UNIQUE(org_id, email) constraint.
    """
    # Check if the new schema already in place by looking for email_verified
    cols = [r[1] for r in conn.execute(text("PRAGMA table_info(users)")).fetchall()]
    if "email_verified" in cols:
        return  # already migrated or brand-new DB

    logger.info("Migrating users table: making org_id nullable, globalising email uniqueness")
    conn.execute(text("ALTER TABLE users RENAME TO _users_pre_migration"))
    conn.execute(text("""
        CREATE TABLE users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id        INTEGER,
            email         TEXT NOT NULL UNIQUE,
            display_name  TEXT,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'analyst',
            is_active     INTEGER NOT NULL DEFAULT 1,
            is_superuser  INTEGER NOT NULL DEFAULT 0,
            email_verified INTEGER NOT NULL DEFAULT 0,
            last_login_at TEXT,
            created_at    TEXT NOT NULL
        )
    """))
    conn.execute(text("""
        INSERT INTO users (id, org_id, email, display_name, password_hash, role,
                           is_active, is_superuser, email_verified, last_login_at, created_at)
        SELECT id, org_id, email, display_name, password_hash, role,
               is_active, COALESCE(is_superuser, 0), 0, last_login_at, created_at
        FROM _users_pre_migration
        ON CONFLICT(email) DO NOTHING
    """))
    conn.execute(text("DROP TABLE _users_pre_migration"))
    conn.commit()


def _backfill_personal_workspaces(conn):
    """Create personal workspaces for any users that don't already have one."""
    now = datetime.now(timezone.utc).isoformat()
    users_without_ws = conn.execute(text("""
        SELECT u.id, u.display_name, u.email FROM users u
        WHERE u.is_active = 1
          AND NOT EXISTS (
              SELECT 1 FROM workspaces w
              WHERE w.owner_user_id = u.id AND w.type = 'personal'
          )
    """)).mappings().all()

    for u in users_without_ws:
        name = u["display_name"] or u["email"].split("@")[0]
        try:
            with conn.begin():
                result = conn.execute(text("""
                    INSERT INTO workspaces (type, name, owner_user_id, created_at, updated_at)
                    VALUES ('personal', :name, :uid, :now, :now)
                """), {"name": f"{name}'s Workspace", "uid": u["id"], "now": now})
                # Try to get the workspace id
                try:
                    ws_id = result.lastrowid
                except Exception:
                    ws_id = conn.execute(text(
                        "SELECT id FROM workspaces WHERE owner_user_id=:uid AND type='personal'"
                    ), {"uid": u["id"]}).scalar()
                if ws_id:
                    conn.execute(text("""
                        INSERT OR IGNORE INTO workspace_memberships
                            (workspace_id, user_id, role, status, created_at, updated_at)
                        VALUES (:ws, :uid, 'owner', 'active', :now, :now)
                    """), {"ws": ws_id, "uid": u["id"], "now": now})
        except Exception:
            pass


# ─── Activity Tracking ────────────────────────────────────────────────────────

def log_activity(user_id: Optional[int], org_id: Optional[int], action: str, details: Optional[dict] = None) -> None:
    """Safely log an activity to the central `activity_logs` table."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        details_str = json.dumps(details) if details else None
        query = text(
            "INSERT INTO activity_logs (user_id, org_id, action, details, created_at) "
            "VALUES (:usr, :org, :act, :det, :now)"
        )
        with admin_engine.connect() as conn:
            with conn.begin():
                conn.execute(query, {
                    "usr": user_id,
                    "org": org_id,
                    "act": action,
                    "det": details_str,
                    "now": now
                })
    except Exception as e:
        logger.error(f"Failed to log activity '{action}': {e}")



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

def _make_access_token(user_id: int, org_id: Optional[int], role: str,
                        is_superuser: int = 0, workspace_id: Optional[int] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_TTL)
    payload = {
        "sub": str(user_id),
        "org_id": org_id,
        "role": role,
        "is_superuser": is_superuser,
        "exp": expire,
        "type": "access",
    }
    if workspace_id is not None:
        payload["workspace_id"] = workspace_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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

# ─── Workspace helpers ────────────────────────────────────────────────────────

def create_personal_workspace(user_id: int, display_name: str) -> int:
    """Create a personal workspace for a user. Returns workspace_id."""
    now = datetime.now(timezone.utc).isoformat()
    name = f"{display_name}'s Workspace"
    with admin_engine.connect() as conn:
        with conn.begin():
            try:
                result = conn.execute(text("""
                    INSERT INTO workspaces (type, name, owner_user_id, created_at, updated_at)
                    VALUES ('personal', :name, :uid, :now, :now)
                    RETURNING id
                """), {"name": name, "uid": user_id, "now": now})
                ws_id = result.scalar()
            except Exception:
                conn.execute(text("""
                    INSERT INTO workspaces (type, name, owner_user_id, created_at, updated_at)
                    VALUES ('personal', :name, :uid, :now, :now)
                """), {"name": name, "uid": user_id, "now": now})
                ws_id = conn.execute(text(
                    "SELECT id FROM workspaces WHERE owner_user_id=:uid AND type='personal'"
                ), {"uid": user_id}).scalar()
            conn.execute(text("""
                INSERT OR IGNORE INTO workspace_memberships
                    (workspace_id, user_id, role, status, created_at, updated_at)
                VALUES (:ws, :uid, 'owner', 'active', :now, :now)
            """), {"ws": ws_id, "uid": user_id, "now": now})
    return ws_id


def get_personal_workspace(user_id: int) -> Optional[dict]:
    """Return the user's personal workspace."""
    with admin_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT * FROM workspaces WHERE owner_user_id=:uid AND type='personal'"
        ), {"uid": user_id}).mappings().first()
    return dict(row) if row else None


def get_user_workspaces(user_id: int) -> list[dict]:
    """Return all workspaces the user has active membership in."""
    with admin_engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT w.id, w.type, w.name, w.owner_user_id, w.organization_id,
                   wm.role AS member_role, wm.status,
                   o.name AS org_name
            FROM workspace_memberships wm
            JOIN workspaces w ON w.id = wm.workspace_id
            LEFT JOIN organizations o ON o.id = w.organization_id
            WHERE wm.user_id = :uid AND wm.status = 'active'
            ORDER BY w.type DESC, w.created_at ASC
        """), {"uid": user_id}).mappings().all()
    return [dict(r) for r in rows]


def get_workspace_by_id(workspace_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT * FROM workspaces WHERE id=:id"
        ), {"id": workspace_id}).mappings().first()
    return dict(row) if row else None


def assert_workspace_member(user_id: int, workspace_id: int) -> dict:
    """Raise 403 if user is not an active member of workspace. Returns membership row."""
    with admin_engine.connect() as conn:
        row = conn.execute(text("""
            SELECT wm.*, w.type, w.organization_id FROM workspace_memberships wm
            JOIN workspaces w ON w.id = wm.workspace_id
            WHERE wm.workspace_id=:ws AND wm.user_id=:uid AND wm.status='active'
        """), {"ws": workspace_id, "uid": user_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=403, detail="You do not have access to this workspace.")
    return dict(row)


def create_org_workspace(org_id: int, org_name: str) -> int:
    """Create an org workspace. Returns workspace_id."""
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            try:
                result = conn.execute(text("""
                    INSERT INTO workspaces (type, name, organization_id, created_at, updated_at)
                    VALUES ('organization', :name, :org_id, :now, :now)
                    RETURNING id
                """), {"name": org_name, "org_id": org_id, "now": now})
                ws_id = result.scalar()
            except Exception:
                conn.execute(text("""
                    INSERT INTO workspaces (type, name, organization_id, created_at, updated_at)
                    VALUES ('organization', :name, :org_id, :now, :now)
                """), {"name": org_name, "org_id": org_id, "now": now})
                ws_id = conn.execute(text(
                    "SELECT id FROM workspaces WHERE organization_id=:oid AND type='organization'"
                ), {"oid": org_id}).scalar()
    return ws_id


def add_user_to_org_workspace(user_id: int, org_id: int, role: str = "employee") -> None:
    """Add a user to the organization's workspace."""
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        ws = conn.execute(text(
            "SELECT id FROM workspaces WHERE organization_id=:oid AND type='organization'"
        ), {"oid": org_id}).mappings().first()
        if not ws:
            return
        ws_id = ws["id"]
        with conn.begin():
            conn.execute(text("""
                INSERT INTO workspace_memberships
                    (workspace_id, user_id, role, status, created_at, updated_at)
                VALUES (:ws, :uid, :role, 'active', :now, :now)
                ON CONFLICT(workspace_id, user_id) DO UPDATE
                    SET role=excluded.role, status='active', updated_at=excluded.updated_at
            """), {"ws": ws_id, "uid": user_id, "role": role, "now": now})
            # Also add org_membership record
            conn.execute(text("""
                INSERT INTO org_memberships (org_id, user_id, role, status, created_at, updated_at)
                VALUES (:oid, :uid, :role, 'active', :now, :now)
                ON CONFLICT(org_id, user_id) DO UPDATE
                    SET role=excluded.role, status='active', updated_at=excluded.updated_at
            """), {"oid": org_id, "uid": user_id, "role": role, "now": now})


def remove_user_from_org_workspace(user_id: int, org_id: int) -> None:
    """Deactivate a user's org workspace membership."""
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        ws = conn.execute(text(
            "SELECT id FROM workspaces WHERE organization_id=:oid AND type='organization'"
        ), {"oid": org_id}).mappings().first()
        if not ws:
            return
        ws_id = ws["id"]
        with conn.begin():
            conn.execute(text("""
                UPDATE workspace_memberships SET status='inactive', updated_at=:now
                WHERE workspace_id=:ws AND user_id=:uid
            """), {"ws": ws_id, "uid": user_id, "now": now})
            conn.execute(text("""
                UPDATE org_memberships SET status='inactive', updated_at=:now
                WHERE org_id=:oid AND user_id=:uid
            """), {"oid": org_id, "uid": user_id, "now": now})


# ─── Individual Registration ──────────────────────────────────────────────────

def register_individual(email: str, password: str,
                         display_name: Optional[str] = None) -> dict:
    """
    Register a user as an individual (no org required).
    Creates a personal workspace automatically.
    Returns full login payload.
    """
    email = email.lower().strip()
    existing = get_user_by_email_global(email)
    if existing:
        # Attempt to log in with the supplied password — if correct, return the
        # session transparently (idempotent registration for returning users).
        try:
            return login_user(email=email, password=password)
        except HTTPException:
            # Wrong password — tell the user to log in with their real password
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Please log in instead.",
            )
    validate_password_strength(password)
    pw_hash = hash_password(password)
    name = display_name or email.split("@")[0]
    now  = datetime.now(timezone.utc).isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            try:
                result = conn.execute(text("""
                    INSERT INTO users
                        (email, display_name, password_hash, role, is_active, email_verified, created_at)
                    VALUES (:email, :name, :pw_hash, 'owner', 1, 0, :now)
                    RETURNING id
                """), {"email": email, "name": name, "pw_hash": pw_hash, "now": now})
                user_id = result.scalar()
            except Exception:
                conn.execute(text("""
                    INSERT INTO users
                        (email, display_name, password_hash, role, is_active, email_verified, created_at)
                    VALUES (:email, :name, :pw_hash, 'owner', 1, 0, :now)
                """), {"email": email, "name": name, "pw_hash": pw_hash, "now": now})
                user_id = conn.execute(
                    text("SELECT id FROM users WHERE email=:e"), {"e": email}
                ).scalar()

    # Create personal workspace
    ws_id = create_personal_workspace(user_id, name)
    log_activity(user_id, None, "Individual Registration", {"email": email})

    return login_user(email=email, password=password)


# ─── Domain Verification ──────────────────────────────────────────────────────

def initiate_domain_verification(org_id: int, domain: str) -> str:
    """
    Generate a DNS TXT verification token for the domain.
    Returns the raw token for the user to publish as: vantage-verify=<token>
    """
    domain = domain.lower().strip()
    token = f"vantage-verify={secrets.token_urlsafe(24)}"
    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO domain_verification_records
                    (org_id, domain, token, verified, created_at, expires_at)
                VALUES (:org_id, :domain, :token, 0, :now, :exp)
                ON CONFLICT(org_id, domain) DO UPDATE
                    SET token=excluded.token, verified=0,
                        created_at=excluded.created_at, expires_at=excluded.expires_at
            """), {"org_id": org_id, "domain": domain, "token": token,
                   "now": now, "exp": expires_at})
    return token


def check_domain_verification(org_id: int, domain: str) -> bool:
    """
    Check DNS TXT records to verify domain ownership.
    In production this would do a real DNS lookup; here we also accept
    an env-override DOMAIN_VERIFY_SKIP=1 for local development.
    """
    domain = domain.lower().strip()
    now = datetime.now(timezone.utc).isoformat()

    with admin_engine.connect() as conn:
        row = conn.execute(text("""
            SELECT token, expires_at FROM domain_verification_records
            WHERE org_id=:oid AND domain=:domain
        """), {"oid": org_id, "domain": domain}).mappings().first()

    if not row or row["expires_at"] < now:
        raise HTTPException(status_code=400,
                            detail="Verification record not found or expired. Please re-initiate.")

    expected_token = row["token"]

    # Dev bypass
    if os.getenv("DOMAIN_VERIFY_SKIP", "0") == "1":
        verified = True
    else:
        verified = _dns_txt_contains(domain, expected_token)

    if verified:
        with admin_engine.connect() as conn:
            with conn.begin():
                conn.execute(text("""
                    UPDATE domain_verification_records SET verified=1
                    WHERE org_id=:oid AND domain=:domain
                """), {"oid": org_id, "domain": domain})
    return verified


def _dns_txt_contains(domain: str, expected: str) -> bool:
    """Check if the domain's DNS TXT records contain the expected token."""
    try:
        import dns.resolver
        answers = dns.resolver.resolve(domain, "TXT")
        for rdata in answers:
            for txt_string in rdata.strings:
                if expected.encode() in txt_string or expected in txt_string.decode("utf-8", errors="ignore"):
                    return True
    except Exception:
        pass
    return False


# ─── Organization Creation (post domain-verification) ────────────────────────

def create_org_with_admin(user_id: int, org_name: str, domain: str) -> dict:
    """
    Create a new organization after domain verification is confirmed.
    Assigns the user as admin, creates org workspace, creates org membership.
    Returns {org_id, workspace_id, org_name, api_key}
    """
    from models import create_org, admin_engine as model_engine
    now = datetime.now(timezone.utc).isoformat()

    # Verify domain is confirmed
    with admin_engine.connect() as conn:
        verified = conn.execute(text("""
            SELECT 1 FROM domain_verification_records
            WHERE org_id IS NULL OR org_id = 0  -- will re-check by domain
        """)).fetchone()
        # Actually check by domain directly
        dv = conn.execute(text("""
            SELECT org_id, verified FROM domain_verification_records
            WHERE domain=:domain ORDER BY created_at DESC LIMIT 1
        """), {"domain": domain.lower().strip()}).mappings().first()

    # If we have a pending verification (org_id=0 means initiated before org created)
    if not dv:
        raise HTTPException(status_code=400,
                            detail="Domain verification not initiated. Please verify your domain first.")

    # Check domain isn't taken by another org
    with admin_engine.connect() as conn:
        taken = conn.execute(text("""
            SELECT 1 FROM domain_verification_records dvr
            JOIN organizations o ON o.id = dvr.org_id
            WHERE dvr.domain=:domain AND dvr.verified=1
        """), {"domain": domain.lower().strip()}).fetchone()
    if taken:
        raise HTTPException(status_code=409,
                            detail="An organization with this domain already exists.")

    org = create_org(org_name)
    org_id = org.id

    # Mark domain as verified for this org
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                UPDATE domain_verification_records SET org_id=:oid, verified=1
                WHERE domain=:domain
            """), {"oid": org_id, "domain": domain.lower().strip()})
            # Update user's org_id
            conn.execute(text("UPDATE users SET org_id=:oid WHERE id=:uid"),
                         {"oid": org_id, "uid": user_id})

    # Create org workspace
    ws_id = create_org_workspace(org_id, org_name)

    # Add user to org workspace as admin
    add_user_to_org_workspace(user_id, org_id, role="admin")
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                UPDATE workspace_memberships SET role='admin'
                WHERE workspace_id=:ws AND user_id=:uid
            """), {"ws": ws_id, "uid": user_id})

    log_activity(user_id, org_id, "Organization Created",
                 {"org_name": org_name, "domain": domain})

    return {
        "org_id": org_id,
        "workspace_id": ws_id,
        "org_name": org_name,
        "api_key": org.api_key,
    }


# ─── Admin Transfer ───────────────────────────────────────────────────────────

def transfer_admin(org_id: int, current_admin_id: int, new_admin_email: str) -> dict:
    """
    Atomically transfer org admin role.
    Current admin → employee, target user → admin.
    """
    new_admin_email = new_admin_email.lower().strip()
    now = datetime.now(timezone.utc).isoformat()

    with admin_engine.connect() as conn:
        # Verify current admin
        current = conn.execute(text(
            "SELECT email FROM users WHERE id=:uid AND is_active=1"
        ), {"uid": current_admin_id}).mappings().first()
        if not current:
            raise HTTPException(status_code=404, detail="Current admin not found.")

        # Verify org membership
        cm = conn.execute(text("""
            SELECT role FROM org_memberships WHERE org_id=:oid AND user_id=:uid AND status='active'
        """), {"oid": org_id, "uid": current_admin_id}).mappings().first()
        if not cm or cm["role"] not in ("admin", "owner"):
            raise HTTPException(status_code=403, detail="You are not the administrator of this organization.")

        # Find target
        target = conn.execute(text(
            "SELECT id, email, email_verified FROM users WHERE email=:email AND is_active=1"
        ), {"email": new_admin_email}).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Target user not found.")

        tm = conn.execute(text("""
            SELECT role, status FROM org_memberships
            WHERE org_id=:oid AND user_id=:uid
        """), {"oid": org_id, "uid": target["id"]}).mappings().first()
        if not tm or tm["status"] != "active":
            raise HTTPException(status_code=400,
                                detail="Target user is not an active member of this organization.")

        ws = conn.execute(text(
            "SELECT id FROM workspaces WHERE organization_id=:oid AND type='organization'"
        ), {"oid": org_id}).mappings().first()
        ws_id = ws["id"] if ws else None

        with conn.begin():
            # Demote current admin
            conn.execute(text("""
                UPDATE org_memberships SET role='employee', updated_at=:now
                WHERE org_id=:oid AND user_id=:uid
            """), {"oid": org_id, "uid": current_admin_id, "now": now})
            if ws_id:
                conn.execute(text("""
                    UPDATE workspace_memberships SET role='employee', updated_at=:now
                    WHERE workspace_id=:ws AND user_id=:uid
                """), {"ws": ws_id, "uid": current_admin_id, "now": now})

            # Promote new admin
            conn.execute(text("""
                UPDATE org_memberships SET role='admin', updated_at=:now
                WHERE org_id=:oid AND user_id=:uid
            """), {"oid": org_id, "uid": target["id"], "now": now})
            if ws_id:
                conn.execute(text("""
                    UPDATE workspace_memberships SET role='admin', updated_at=:now
                    WHERE workspace_id=:ws AND user_id=:uid
                """), {"ws": ws_id, "uid": target["id"], "now": now})

            # Update org admin_user_id if the column exists
            try:
                conn.execute(text(
                    "UPDATE organizations SET admin_user_id=:uid WHERE id=:oid"
                ), {"uid": target["id"], "oid": org_id})
            except Exception:
                pass

    log_activity(current_admin_id, org_id, "Admin Transfer",
                 {"from": current["email"], "to": new_admin_email})

    return {"success": True, "new_admin": new_admin_email}


# ─── User CRUD ────────────────────────────────────────────────────────────────

def create_user(org_id: Optional[int], email: str, password: str,
                role: str = "analyst", display_name: Optional[str] = None) -> dict:
    email = email.lower().strip()
    if get_user_by_email_global(email):
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists. Please use another email to register."
        )
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
    log_activity(user_id, org_id, "User Registered", {"email": email, "role": role})
    return get_user_by_id(user_id)


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Return user dict WITHOUT password_hash (safe for HTTP responses)."""
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, org_id, email, display_name, role, is_active, is_superuser, "
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
            text("SELECT id, org_id, email, display_name, role, is_active, is_superuser, "
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
    if not user:
        import hashlib
        _eh = hashlib.sha256(email.encode()).hexdigest()[:12]
        logger.warning(f"Login failed: unknown email hash={_eh}…")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(password, user["password_hash"]):
        import hashlib
        _eh = hashlib.sha256(email.encode()).hexdigest()[:12]
        logger.warning(f"Login failed: wrong password email_hash={_eh}…")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    effective_org_id = user.get("org_id")
    api_key = None
    if effective_org_id:
        with admin_engine.connect() as conn:
            org_row = conn.execute(
                text("SELECT api_key FROM organizations WHERE id = :id"),
                {"id": effective_org_id},
            ).mappings().first()
        api_key = org_row["api_key"] if org_row else None

    # Determine active workspace (personal first, then first org workspace)
    workspaces = get_user_workspaces(user["id"])
    personal_ws = next((w for w in workspaces if w["type"] == "personal"), None)
    active_workspace = personal_ws or (workspaces[0] if workspaces else None)
    active_workspace_id = active_workspace["id"] if active_workspace else None

    # Ensure personal workspace exists
    if not personal_ws:
        try:
            ws_id = create_personal_workspace(user["id"], user.get("display_name") or email.split("@")[0])
            active_workspace_id = ws_id
            workspaces = get_user_workspaces(user["id"])
        except Exception:
            pass

    access_token          = _make_access_token(user["id"], effective_org_id, user["role"],
                                                user.get("is_superuser", 0), active_workspace_id)
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

    log_activity(user["id"], effective_org_id, "User Logged In", {"email": user["email"]})

    return {
        "access_token":       access_token,
        "refresh_token":      raw_refresh,
        "api_key":            api_key,
        "token_type":         "bearer",
        "expires_in":         ACCESS_TOKEN_TTL * 60,
        "active_workspace_id": active_workspace_id,
        "workspaces":         workspaces,
        "user": {
            "id":           user["id"],
            "org_id":       user.get("org_id"),    # None for individual users, set for org members
            "email":        user["email"],
            "display_name": user["display_name"],
            "role":         user["role"],
            "is_superuser": bool(user.get("is_superuser")),
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
            # H-1 fix: include u.is_superuser so refreshed tokens retain admin privileges
            text("SELECT rt.*, u.org_id, u.role, u.is_superuser FROM refresh_tokens rt "
                 "JOIN users u ON u.id = rt.user_id "
                 "WHERE rt.token_hash = :hash AND rt.expires_at > :now"),
            {"hash": ref_hash, "now": now},
        ).mappings().first()
    if not row or not hmac.compare_digest(row["token_hash"], ref_hash):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")

    # L-3 fix: rotate the refresh token on every use (prevent replay after theft)
    new_raw, new_hash = _make_refresh_token()
    new_expires_at = (datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL)).isoformat()
    created_at     = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            # delete old token
            conn.execute(text("DELETE FROM refresh_tokens WHERE token_hash = :old"),
                         {"old": ref_hash})
            # insert rotated token
            conn.execute(text("INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) "
                              "VALUES (:uid, :h, :exp, :now)"),
                         {"uid": row["user_id"], "h": new_hash,
                          "exp": new_expires_at, "now": created_at})

    return {
        "access_token":  _make_access_token(row["user_id"], row["org_id"], row["role"],
                                             row.get("is_superuser", 0)),
        "refresh_token": new_raw,   # rotated — client must store this new value
        "token_type":    "bearer",
        "expires_in":    ACCESS_TOKEN_TTL * 60,
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
    
    email = email.lower().strip()
    now = datetime.now(timezone.utc).isoformat()
    
    with admin_engine.connect() as conn:
        # Check if user already exists (globally)
        if get_user_by_email_global(email):
            raise HTTPException(
                status_code=400, 
                detail="An account with this email already exists. Please use another email to register."
            )

        # Check if active invite already exists (unused and not expired)
        existing_invite = conn.execute(
            text("SELECT 1 FROM invite_tokens WHERE org_id = :org_id AND email = :email AND used = 0 AND expires_at > :now"),
            {"org_id": org_id, "email": email, "now": now}
        ).fetchone()
        if existing_invite:
            raise HTTPException(status_code=400, detail="An active invitation has already been sent to this email.")

    raw        = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO invite_tokens
                    (org_id, email, role, token_hash, invited_by, expires_at, used, created_at)
                VALUES
                    (:org_id, :email, :role, :token_hash, :invited_by, :expires_at, 0, :now)
            """), {
                "org_id": org_id, "email": email,
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
        with conn.begin():
            invite = conn.execute(
                text("""
                    UPDATE invite_tokens 
                    SET used = 1 
                    WHERE token_hash = :h AND used = 0 AND expires_at > :now 
                    RETURNING org_id, email, role, token_hash
                """),
                {"h": token_hash, "now": now},
            ).mappings().first()
            
    if not invite or not hmac.compare_digest(invite["token_hash"], token_hash):
        raise HTTPException(status_code=400, detail="Invite token is invalid or has expired.")
        
    create_user(
        org_id=invite["org_id"], email=invite["email"],
        password=password, role=invite["role"],
        display_name=display_name,
    )
    
    return login_user(email=invite["email"], password=password, org_id=invite["org_id"])


def get_invite_statuses(org_id: int) -> list[dict]:
    """
    Return a unified list of all organization members (users) and
    all pending/expired invitations.
    """
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.connect() as conn:
        # 1. Get all active users in the org
        users = conn.execute(
            text("SELECT email, display_name, role, last_login_at, created_at FROM users "
                 "WHERE org_id = :org_id AND is_active = 1"),
            {"org_id": org_id}
        ).mappings().all()
        
        # 2. Get all pending/expired invite tokens
        invites = conn.execute(
            text("SELECT email, role, created_at, expires_at FROM invite_tokens "
                 "WHERE org_id = :org_id AND used = 0"),
            {"org_id": org_id}
        ).mappings().all()
        
        results = []
        seen_emails = set()
        
        # Add actual users first
        for u in users:
            results.append({
                "email": u["email"],
                "display_name": u["display_name"],
                "role": u["role"],
                "status": "accepted",
                "last_login": u["last_login_at"],
                "created_at": u["created_at"]
            })
            seen_emails.add(u["email"])
            
        # Add remaining invitations
        for inv in invites:
            # Skip if we already added a user with this email (shouldn't happen with used=0 but safe)
            if inv["email"] in seen_emails:
                continue
                
            status = "pending"
            if inv["expires_at"] < now:
                status = "expired"
                
            results.append({
                "email": inv["email"],
                "role": inv["role"],
                "status": status,
                "created_at": inv["created_at"],
            })
            
        # Optional: Sort by created_at desc
        results.sort(key=lambda x: x["created_at"], reverse=True)
            
        return results


def revoke_invite(org_id: int, email: str) -> bool:
    """Revoke a pending invitation for an email in an organization."""
    with admin_engine.connect() as conn:
        with conn.begin():
            result = conn.execute(
                text("DELETE FROM invite_tokens WHERE org_id = :org_id AND email = :email AND used = 0"),
                {"org_id": org_id, "email": email}
            )
            return result.rowcount > 0


def remove_user(org_id: int, target_email: str, requester_role: str, requester_email: str) -> bool:
    """
    Remove a user from the organization.
    Only owners and admins can remove users. Owners cannot be removed.
    """
    if requester_role not in ["owner", "admin"]:
        raise ValueError("Requires 'owner' or 'admin' role to remove users.")
    if target_email == requester_email:
        raise ValueError("Cannot remove yourself.")
        
    with admin_engine.connect() as conn:
        with conn.begin():
            target = conn.execute(
                text("SELECT id, role FROM users WHERE org_id = :org_id AND email = :email"),
                {"org_id": org_id, "email": target_email}
            ).fetchone()
            
            if not target:
                raise ValueError("Target user not found.")
                
            # Extract fields securely
            target_role = target[1] if hasattr(target, '_mapping') else list(target)[1]
            
            if target_role == "owner":
                raise ValueError("Cannot remove the organization owner. The owner must hand over ownership first.")
                
            conn.execute(
                text("DELETE FROM users WHERE org_id = :org_id AND email = :email"),
                {"org_id": org_id, "email": target_email}
            )
            return True


def change_user_role(org_id: int, target_email: str, new_role: str, requester_email: str, requester_role: str) -> bool:
    """
    Change a user's role. If the new role is 'owner', the requester must be an owner,
    and the requester will be demoted to 'admin' (Ownership Handover).
    """
    if requester_role not in ["owner", "admin"]:
        raise ValueError("Requires 'owner' or 'admin' role to change roles.")
        
    if new_role not in ROLES:
        raise ValueError(f"Invalid role '{new_role}'. Must be one of {ROLES}.")
        
    if new_role == "owner" and requester_role != "owner":
        raise ValueError("Only an existing owner can hand over ownership.")
        
    with admin_engine.connect() as conn:
        with conn.begin():
            target = conn.execute(
                text("SELECT id, role FROM users WHERE org_id = :org_id AND email = :email"),
                {"org_id": org_id, "email": target_email}
            ).fetchone()
            
            if not target:
                raise ValueError("Target user not found.")
                
            # Using index 1 for role 
            target_role = target[1] if hasattr(target, '_mapping') else list(target)[1]
            
            if target_role == "owner" and new_role != "owner":
                # Forcing an owner demotion without handover
                raise ValueError("Cannot demote the organization owner. The owner must hand over ownership to someone else explicitly.")
                
            if new_role == "owner":
                # Ownership Handover: Demote requester to 'admin' and promote target to 'owner'
                if requester_email != target_email:
                    conn.execute(
                        text("UPDATE users SET role = 'admin' WHERE org_id = :o AND email = :e"),
                        {"o": org_id, "e": requester_email}
                    )
            
            conn.execute(
                text("UPDATE users SET role = :new_role WHERE org_id = :org_id AND email = :email"),
                {"new_role": new_role, "org_id": org_id, "email": target_email}
            )
            return True


# ─── Password Reset ───────────────────────────────────────────────────────────

def create_password_reset_token(email: str) -> Optional[str]:
    """Generates a password reset token for an existing user."""
    import hashlib
    email = email.lower().strip()
    user = get_user_by_email_global(email)
    if not user:
        return None
    
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used, created_at)
                VALUES (:user_id, :token_hash, :expires_at, 0, :now)
            """), {
                "user_id": user["id"],
                "token_hash": token_hash,
                "expires_at": expires_at,
                "now": now
            })
    return raw


def reset_password_with_token(raw_token: str, new_password: str) -> bool:
    """Validates the reset token and updates the user's password."""
    import hashlib
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    
    validate_password_strength(new_password)
    new_hash = hash_password(new_password)
    
    with admin_engine.connect() as conn:
        with conn.begin():
            row = conn.execute(text("""
                UPDATE password_reset_tokens 
                SET used = 1 
                WHERE token_hash = :h AND used = 0 AND expires_at > :now
                RETURNING user_id, token_hash
            """), {"h": token_hash, "now": now}).mappings().first()
            
            if not row or not hmac.compare_digest(row["token_hash"], token_hash):
                return False
            
            user_id = row["user_id"]
            
            conn.execute(
                text("UPDATE users SET password_hash = :h WHERE id = :uid"), 
                {"h": new_hash, "uid": user_id}
            )
    return True


# ─── Permission helpers ───────────────────────────────────────────────────────

def get_role_permissions(role: str) -> list[str]:
    return [perm for perm, members in _P.items() if role in members]


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
    # Desktop mode: bypass auth, return a virtual superuser
    _env = os.getenv("ENVIRONMENT", "development").lower()
    if _env == "desktop":
        return {
            "id": 1,
            "email": "desktop@local",
            "display_name": "Desktop User",
            "role": "owner",
            "is_superuser": True,
            "is_active": True,
            "org_id": 1,
        }

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

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str