"""
routers/totp.py — Two-Factor Authentication (TOTP) management routes — Feature #9

Routes (all require auth via Depends(get_current_org)):
  GET  /auth/totp/status          — check whether 2FA is enabled for current user
  POST /auth/totp/setup           — begin setup (generates secret + QR code PNG)
  POST /auth/totp/confirm         — confirm setup by submitting first TOTP code
  POST /auth/totp/disable         — disable 2FA (requires current TOTP code)
  POST /auth/totp/verify-login    — verify TOTP during login (accepts temp_token)
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import totp_auth
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────────

class ConfirmSetupRequest(BaseModel):
    code: str  # 6-digit TOTP code from authenticator app


class DisableRequest(BaseModel):
    code: str  # 6-digit TOTP code to confirm identity before disabling



# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/totp/status")
async def totp_status(user=Depends(get_current_user)):
    """Return whether 2FA is currently enabled for the authenticated user."""
    try:
        return totp_auth.get_totp_status(user["id"])
    except Exception as e:
        logger.error(f"TOTP status error: {e}")
        raise HTTPException(status_code=500, detail="Could not retrieve 2FA status")


@router.post("/totp/setup")
async def totp_setup(user=Depends(get_current_user)):
    """
    Begin 2FA setup. Returns a QR code image (base64 PNG data URI) and the
    manual entry key so the user can add it to their authenticator app.
    The secret is stored as 'pending' until /totp/confirm succeeds.
    """
    try:
        return totp_auth.begin_totp_setup(user["id"], user["email"])
    except Exception as e:
        logger.error(f"TOTP setup error: {e}")
        raise HTTPException(status_code=500, detail="Could not start 2FA setup")


@router.post("/totp/confirm")
async def totp_confirm(payload: ConfirmSetupRequest, user=Depends(get_current_user)):
    """
    Confirm 2FA setup by verifying the first TOTP code from the user's
    authenticator app. Promotes the pending secret to active on success.
    """
    if not payload.code or not payload.code.strip().isdigit():
        raise HTTPException(status_code=400, detail="Code must be 6 digits")
    try:
        ok = totp_auth.confirm_totp_setup(user["id"], payload.code.strip())
    except Exception as e:
        logger.error(f"TOTP confirm error: {e}")
        raise HTTPException(status_code=500, detail="Internal error confirming 2FA")

    if not ok:
        raise HTTPException(status_code=400, detail="Invalid code — please try again")
    return {"enabled": True, "message": "Two-factor authentication is now active"}


@router.post("/totp/disable")
async def totp_disable(payload: DisableRequest, user=Depends(get_current_user)):
    """
    Disable 2FA. Requires a valid current TOTP code to prevent accidental
    or unauthorised disablement.
    """
    status = totp_auth.get_totp_status(user["id"])
    if not status.get("enabled"):
        raise HTTPException(status_code=400, detail="2FA is not currently enabled")

    # Retrieve the stored secret directly for verification
    from sqlalchemy import text
    from models import admin_engine
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT totp_secret FROM users WHERE id = :id"), {"id": user["id"]}
        ).fetchone()
    if not row or not row.totp_secret:
        raise HTTPException(status_code=500, detail="Could not retrieve 2FA secret")

    if not totp_auth.verify_totp_code(row.totp_secret, payload.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid code — 2FA not disabled")

    totp_auth.disable_totp(user["id"])
    return {"enabled": False, "message": "Two-factor authentication has been disabled"}
