"""
totp_auth.py — Two-Factor Authentication (TOTP) — Feature #9

Uses pyotp for TOTP generation/verification and qrcode for setup QR codes.
Adds totp_secret + totp_enabled columns to users table via inline migration.
"""
import io
import base64
import secrets
from typing import Optional

import pyotp
import qrcode
from sqlalchemy import text
from models import admin_engine


# ── Schema migration ───────────────────────────────────────────────────────────

def ensure_totp_columns() -> None:
    """Add totp_secret and totp_enabled columns to users if they don't exist."""
    with admin_engine.begin() as conn:
        try:
            cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()]
            if "totp_secret" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN totp_secret TEXT"))
            if "totp_enabled" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0"))
            if "totp_pending_secret" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN totp_pending_secret TEXT"))
        except Exception:
            # PostgreSQL — add columns if not exist
            for col, type_ in [
                ("totp_secret", "TEXT"),
                ("totp_enabled", "INTEGER DEFAULT 0"),
                ("totp_pending_secret", "TEXT"),
            ]:
                try:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {type_}"))
                except Exception:
                    pass


# ── TOTP helpers ───────────────────────────────────────────────────────────────

APP_NAME = "Vantage AI"


def generate_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=APP_NAME)


def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code with ±1 window for clock drift."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def totp_qr_base64(secret: str, email: str) -> str:
    """Generate QR code PNG and return as base64 data URI."""
    uri = get_totp_uri(secret, email)
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


# ── Database operations ────────────────────────────────────────────────────────

def get_totp_status(user_id: int) -> dict:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT totp_enabled, totp_secret FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
    if not row:
        return {"enabled": False}
    return {"enabled": bool(row.totp_enabled)}


def begin_totp_setup(user_id: int, email: str) -> dict:
    """Generate a new pending secret and return QR code data."""
    secret = generate_secret()
    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET totp_pending_secret = :sec WHERE id = :id"),
            {"sec": secret, "id": user_id},
        )
    return {
        "secret": secret,
        "qr_code": totp_qr_base64(secret, email),
        "manual_entry_key": secret,
    }


def confirm_totp_setup(user_id: int, code: str) -> bool:
    """Confirm TOTP setup by verifying the first code from the authenticator app."""
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT totp_pending_secret FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
    if not row or not row.totp_pending_secret:
        return False
    if not verify_totp_code(row.totp_pending_secret, code):
        return False
    # Promote pending → active
    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET totp_secret = :sec, totp_enabled = 1, totp_pending_secret = NULL WHERE id = :id"),
            {"sec": row.totp_pending_secret, "id": user_id},
        )
    return True


def disable_totp(user_id: int) -> None:
    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending_secret = NULL WHERE id = :id"),
            {"id": user_id},
        )


def check_totp_required(user_id: int, code: Optional[str]) -> bool:
    """
    Returns True if 2FA passed (either not enabled, or code is valid).
    Called during login if the user has 2FA active.
    """
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT totp_enabled, totp_secret FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
    if not row or not row.totp_enabled:
        return True   # 2FA not required
    if not code:
        return False  # 2FA required but no code provided
    return verify_totp_code(row.totp_secret, code)
