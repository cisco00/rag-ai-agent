"""
routers/transformations.py

Bug #13 fix: This router module was missing, causing ModuleNotFoundError on startup.
Provides a FastAPI APIRouter that api.py can import and register.

TODO: Migrate the corresponding route handlers from the old monolithic api.py
into this module. The stubs below show the correct structure.
"""
from fastapi import APIRouter

router = APIRouter()

# ── Route handlers ────────────────────────────────────────────────────────────
# Migrate handlers from the old api.py that belong to the 'transformations' domain.
# Example:
#
#   from dependencies import get_current_org, require_permission
#
#   @router.get("/")
#   async def list_transformations(org=Depends(get_current_org)):
#       ...
