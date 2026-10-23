"""
routers/sheets.py — Feature #8: Google Sheets / Excel Live Sync
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from dependencies import get_current_org
from auth import get_current_user
from google_sheets import (
    GOOGLE_CONFIGURED,
    get_auth_url,
    exchange_code,
    create_new_sheet,
    list_syncs,
    get_sync,
    create_sync,
    delete_sync,
    run_sync,
)

router = APIRouter()


# ── Request models ─────────────────────────────────────────────────────────────

class SyncCreate(BaseModel):
    name: str
    query_text: str
    spreadsheet_id: Optional[str] = None   # None → create new
    spreadsheet_name: Optional[str] = None  # used when creating new
    worksheet_name: str = "Vantage Sync"
    cron_schedule: Optional[str] = None
    access_token: str
    refresh_token: str


class ExchangeCodeRequest(BaseModel):
    code: str


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/sheets/status")
async def sheets_status():
    """Returns whether Google OAuth is configured server-side."""
    return {"configured": GOOGLE_CONFIGURED}


@router.get("/sheets/auth-url")
async def auth_url(
    state: str = Query(default=""),
    org=Depends(get_current_org),
):
    """Return the Google OAuth consent page URL."""
    if not GOOGLE_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    try:
        url = get_auth_url(state=state)
        return {"url": url}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/sheets/exchange-code")
async def exchange_oauth_code(
    request: ExchangeCodeRequest,
    org=Depends(get_current_org),
):
    """Exchange a Google auth code for access + refresh tokens."""
    try:
        tokens = exchange_code(request.code)
        return {"status": "ok", **tokens}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sheets/create-new")
async def create_sheet(
    body: dict,
    org=Depends(get_current_org),
):
    """Create a brand-new Google Sheet and return its id + url."""
    try:
        result = create_new_sheet(
            name=body.get("name", "Vantage Export"),
            access_token=body["access_token"],
            refresh_token=body["refresh_token"],
        )
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sheets/syncs")
async def list_sheet_syncs(org=Depends(get_current_org)):
    """List all sync configs for the org."""
    syncs = list_syncs(org.id)
    return {"syncs": syncs, "total": len(syncs)}


@router.post("/sheets/syncs")
async def create_sheet_sync(
    request: SyncCreate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Create a new sync config (optionally creating a new sheet first)."""
    spreadsheet_id  = request.spreadsheet_id
    spreadsheet_url = None

    # Auto-create a new sheet if no ID provided
    if not spreadsheet_id:
        sheet_name = request.spreadsheet_name or request.name
        try:
            created = create_new_sheet(
                name=sheet_name,
                access_token=request.access_token,
                refresh_token=request.refresh_token,
            )
            spreadsheet_id  = created["spreadsheet_id"]
            spreadsheet_url = created["spreadsheet_url"]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to create sheet: {e}")

    data = {
        "name":            request.name,
        "query_text":      request.query_text,
        "spreadsheet_id":  spreadsheet_id,
        "spreadsheet_url": spreadsheet_url,
        "worksheet_name":  request.worksheet_name,
        "cron_schedule":   request.cron_schedule,
        "access_token":    request.access_token,
        "refresh_token":   request.refresh_token,
    }
    user_id = user.get("id") if user else None
    sync = create_sync(org.id, user_id, data)
    return {"status": "success", "sync": sync}


@router.get("/sheets/syncs/{sync_id}")
async def get_sheet_sync(sync_id: int, org=Depends(get_current_org)):
    s = get_sync(sync_id, org.id)
    if not s:
        raise HTTPException(status_code=404, detail="Sync not found")
    # Never expose tokens to the client
    s.pop("access_token", None)
    s.pop("refresh_token", None)
    return {"sync": s}


@router.delete("/sheets/syncs/{sync_id}")
async def delete_sheet_sync(sync_id: int, org=Depends(get_current_org)):
    if not delete_sync(sync_id, org.id):
        raise HTTPException(status_code=404, detail="Sync not found")
    return {"status": "success"}


@router.post("/sheets/syncs/{sync_id}/run")
async def run_sheet_sync(
    sync_id: int,
    org=Depends(get_current_org),
):
    """Manually trigger a sync run now."""
    s = get_sync(sync_id, org.id)
    if not s:
        raise HTTPException(status_code=404, detail="Sync not found")

    # We need the org's DB connection string to run the query
    try:
        from models import SessionLocal
        from models import Organisation
        db = SessionLocal()
        try:
            db_org = db.query(Organisation).filter(Organisation.id == org.id).first()
            db_url = db_org.db_connection_string if db_org else None
        finally:
            db.close()

        if not db_url:
            raise HTTPException(status_code=422, detail="No database connected for this organisation")

        result = run_sync(sync_id, org.id, db_url)
        return {"status": "success", **result}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
