"""
routers/branding.py — Branding and organization customization routes.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from models import update_branding
from dependencies import get_current_org

logger = logging.getLogger(__name__)
router = APIRouter()

from schemas import BrandingRequest

# ── Routes ──

@router.get("/branding")
async def get_branding(org=Depends(get_current_org)):
    """Return the branding configuration for the authenticated organization."""
    return org.get_branding()

@router.put("/branding")
async def save_branding(request: BrandingRequest, org=Depends(get_current_org)):
    """Save branding configuration for the authenticated organization."""
    try:
        current = org.get_branding()
        updated = {
            "org_name": request.org_name or current["org_name"],
            "tagline": request.tagline if request.tagline is not None else current["tagline"],
            "primary_color": request.primary_color or current["primary_color"],
            "logo_url": request.logo_url if request.logo_url is not None else current["logo_url"],
        }
        update_branding(org.api_key, updated)
        return {"status": "success", "branding": updated}
    except Exception as e:
        logger.error(f"Branding save failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))