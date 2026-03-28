"""
routers/branding.py — Branding and organization customization routes.
"""

import os
import shutil
import logging
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile
from pydantic import BaseModel
from typing import Optional

from models import update_branding
from dependencies import get_current_org, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()

from schemas import BrandingRequest

# ── Routes ──

@router.get("/branding")
async def get_branding(org=Depends(get_current_org)):
    """Return the branding configuration for the authenticated organization."""
    return org.get_branding()

@router.put("/branding")
async def save_branding(request: BrandingRequest, org=Depends(get_current_org),
                        user=Depends(require_permission("MANAGE_ORG"))):
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

@router.post("/logo")
async def upload_logo(file: UploadFile = File(...), org=Depends(get_current_org),
                      user=Depends(require_permission("MANAGE_ORG"))):
    """Upload a logo file for the organization and return its static URL."""
    try:
        # Determine and validate the file extension
        ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".png"
        if ext not in [".png", ".jpg", ".jpeg", ".svg"]:
            raise HTTPException(status_code=400, detail="Unsupported file format. Use PNG, JPG, or SVG.")
        
        # Define the save path (relative to backend/ directory)
        # routers/branding.py -> backend/routers/ -> backend/
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        logo_dir = os.path.join(backend_dir, "static", "uploads", "logos")
        os.makedirs(logo_dir, exist_ok=True)
        
        # Use a unique but predictable filename for this organization
        filename = f"org_{org.id}_logo{ext}"
        save_path = os.path.join(logo_dir, filename)
        
        # Save the file correctly
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Static URL for the uploaded file
        # This matches the mount in api.py: app.mount("/uploads", ...)
        logo_url = f"/uploads/logos/{filename}"
        
        return {"status": "success", "logo_url": logo_url}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logo upload failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error during logo upload.")