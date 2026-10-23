"""
google_sheets.py — Feature #8: Google Sheets / Excel Live Sync

Provides:
  • OAuth 2.0 flow (get URL → exchange code → store tokens)
  • Push arbitrary row data to a named worksheet in a Google Sheet
  • Per-org sync configs table: store query + sheet + schedule
  • Manual and scheduled sync execution
"""

import json
import os
from datetime import datetime
from typing import Optional

from sqlalchemy import text

from models import engine as admin_engine
from logging_config import get_logger

logger = get_logger(__name__)

# ── Env vars ──────────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/sheets/callback")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

GOOGLE_CONFIGURED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_sheets_tables() -> None:
    """Create sheet_syncs table (idempotent)."""
    dialect = admin_engine.dialect.name
    serial = "SERIAL" if dialect == "postgresql" else "INTEGER"
    ai     = "" if dialect == "postgresql" else "AUTOINCREMENT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS sheet_syncs (
            id             {serial} PRIMARY KEY {ai},
            org_id         INTEGER  NOT NULL,
            user_id        INTEGER,
            name           TEXT     NOT NULL,
            query_text     TEXT     NOT NULL,
            spreadsheet_id TEXT     NOT NULL,
            spreadsheet_url TEXT,
            worksheet_name TEXT     NOT NULL DEFAULT 'Vantage Sync',
            cron_schedule  TEXT,
            access_token   TEXT,
            refresh_token  TEXT,
            token_expiry   TEXT,
            last_run_at    TEXT,
            last_run_status TEXT,
            last_row_count INTEGER,
            is_active      INTEGER  NOT NULL DEFAULT 1,
            created_at     TEXT     NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT     NOT NULL DEFAULT (datetime('now'))
        )
    """
    with admin_engine.begin() as conn:
        conn.execute(text(ddl))


# ── OAuth helpers ─────────────────────────────────────────────────────────────

def get_auth_url(state: str = "") -> str:
    """Build the Google OAuth consent URL."""
    if not GOOGLE_CONFIGURED:
        raise RuntimeError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set")
    try:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [GOOGLE_REDIRECT_URI],
                }
            },
            scopes=SCOPES,
            redirect_uri=GOOGLE_REDIRECT_URI,
        )
        url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return url
    except ImportError:
        raise RuntimeError("google-auth-oauthlib not installed")


def exchange_code(code: str) -> dict:
    """Exchange auth code for tokens. Returns {access_token, refresh_token, expiry}."""
    try:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [GOOGLE_REDIRECT_URI],
                }
            },
            scopes=SCOPES,
            redirect_uri=GOOGLE_REDIRECT_URI,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        return {
            "access_token":  creds.token,
            "refresh_token": creds.refresh_token,
            "expiry":        creds.expiry.isoformat() if creds.expiry else None,
        }
    except ImportError:
        raise RuntimeError("google-auth-oauthlib not installed")


def _build_credentials(access_token: str, refresh_token: str):
    """Reconstruct google.oauth2 Credentials from stored tokens."""
    from google.oauth2.credentials import Credentials
    return Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )


# ── Sheet push ────────────────────────────────────────────────────────────────

def push_to_sheet(
    spreadsheet_id: str,
    worksheet_name: str,
    rows: list[list],          # header row + data rows
    access_token: str,
    refresh_token: str,
) -> dict:
    """
    Clear the target worksheet and write `rows` (header + data) into it.
    Returns {"rows_written": N, "spreadsheet_url": "..."}
    """
    try:
        import gspread
    except ImportError:
        raise RuntimeError("gspread not installed — run: pip install gspread")

    creds = _build_credentials(access_token, refresh_token)

    client       = gspread.authorize(creds)
    spreadsheet  = client.open_by_key(spreadsheet_id)

    # Create worksheet if it doesn't exist
    try:
        ws = spreadsheet.worksheet(worksheet_name)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=50)

    ws.clear()
    if rows:
        ws.update(rows, "A1")
        # Bold the header
        try:
            ws.format("A1:ZZ1", {"textFormat": {"bold": True}})
        except Exception:
            pass

    return {
        "rows_written": len(rows) - 1 if rows else 0,
        "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
    }


def create_new_sheet(name: str, access_token: str, refresh_token: str) -> dict:
    """Create a brand-new Google Sheet and return its id + url."""
    try:
        import gspread
    except ImportError:
        raise RuntimeError("gspread not installed")

    creds       = _build_credentials(access_token, refresh_token)
    client      = gspread.authorize(creds)
    spreadsheet = client.create(name)
    return {
        "spreadsheet_id":  spreadsheet.id,
        "spreadsheet_url": spreadsheet.url,
    }


# ── Sync config CRUD ──────────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    keys = [
        "id", "org_id", "user_id", "name", "query_text",
        "spreadsheet_id", "spreadsheet_url", "worksheet_name",
        "cron_schedule", "last_run_at", "last_run_status", "last_row_count",
        "is_active", "created_at",
    ]
    d = dict(zip(keys, row))
    d["is_active"] = bool(d.get("is_active", 1))
    return d


def list_syncs(org_id: int) -> list[dict]:
    sql = """
        SELECT id, org_id, user_id, name, query_text,
               spreadsheet_id, spreadsheet_url, worksheet_name,
               cron_schedule, last_run_at, last_run_status, last_row_count,
               is_active, created_at
        FROM sheet_syncs
        WHERE org_id = :org_id
        ORDER BY created_at DESC
    """
    with admin_engine.connect() as conn:
        rows = conn.execute(text(sql), {"org_id": org_id}).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_sync(sync_id: int, org_id: int) -> Optional[dict]:
    sql = """
        SELECT id, org_id, user_id, name, query_text,
               spreadsheet_id, spreadsheet_url, worksheet_name,
               cron_schedule, last_run_at, last_run_status, last_row_count,
               is_active, created_at,
               access_token, refresh_token
        FROM sheet_syncs
        WHERE id = :id AND org_id = :org_id
    """
    with admin_engine.connect() as conn:
        row = conn.execute(text(sql), {"id": sync_id, "org_id": org_id}).fetchone()
    if not row:
        return None
    keys = [
        "id", "org_id", "user_id", "name", "query_text",
        "spreadsheet_id", "spreadsheet_url", "worksheet_name",
        "cron_schedule", "last_run_at", "last_run_status", "last_row_count",
        "is_active", "created_at", "access_token", "refresh_token",
    ]
    return dict(zip(keys, row))


def create_sync(org_id: int, user_id: Optional[int], data: dict) -> dict:
    sql = """
        INSERT INTO sheet_syncs
            (org_id, user_id, name, query_text, spreadsheet_id, spreadsheet_url,
             worksheet_name, cron_schedule, access_token, refresh_token, is_active)
        VALUES
            (:org_id, :user_id, :name, :query_text, :spreadsheet_id, :spreadsheet_url,
             :worksheet_name, :cron_schedule, :access_token, :refresh_token, 1)
    """
    params = {
        "org_id":          org_id,
        "user_id":         user_id,
        "name":            data["name"],
        "query_text":      data["query_text"],
        "spreadsheet_id":  data["spreadsheet_id"],
        "spreadsheet_url": data.get("spreadsheet_url", ""),
        "worksheet_name":  data.get("worksheet_name", "Vantage Sync"),
        "cron_schedule":   data.get("cron_schedule"),
        "access_token":    data.get("access_token", ""),
        "refresh_token":   data.get("refresh_token", ""),
    }
    with admin_engine.begin() as conn:
        result = conn.execute(text(sql), params)
        if admin_engine.dialect.name == "postgresql":
            sync_id = conn.execute(text("SELECT lastval()")).scalar()
        else:
            sync_id = result.lastrowid
    return get_sync(sync_id, org_id)  # type: ignore[return-value]


def update_sync_status(sync_id: int, status: str, row_count: Optional[int] = None) -> None:
    sql = """
        UPDATE sheet_syncs
        SET last_run_at = :now, last_run_status = :status, last_row_count = :row_count,
            updated_at = :now
        WHERE id = :id
    """
    with admin_engine.begin() as conn:
        conn.execute(text(sql), {
            "id": sync_id, "now": datetime.utcnow().isoformat(),
            "status": status, "row_count": row_count,
        })


def delete_sync(sync_id: int, org_id: int) -> bool:
    sql = "DELETE FROM sheet_syncs WHERE id = :id AND org_id = :org_id"
    with admin_engine.begin() as conn:
        result = conn.execute(text(sql), {"id": sync_id, "org_id": org_id})
    return result.rowcount > 0


# ── Run a sync ────────────────────────────────────────────────────────────────

def run_sync(sync_id: int, org_id: int, org_db_url: str) -> dict:
    """
    Execute the sync: run the query against the org's DB, then push to Sheets.
    Returns {"rows_written": N, "spreadsheet_url": "..."}
    """
    sync = get_sync(sync_id, org_id)
    if not sync:
        raise ValueError(f"Sync {sync_id} not found")

    from sqlalchemy import create_engine

    try:
        eng = create_engine(org_db_url)
        with eng.connect() as conn:
            result = conn.execute(text(sync["query_text"]))
            col_names = list(result.keys())
            data_rows = [list(row) for row in result.fetchall()]

        rows = [col_names] + [[str(v) if v is not None else "" for v in row] for row in data_rows]

        push_result = push_to_sheet(
            spreadsheet_id=sync["spreadsheet_id"],
            worksheet_name=sync["worksheet_name"],
            rows=rows,
            access_token=sync["access_token"],
            refresh_token=sync["refresh_token"],
        )

        update_sync_status(sync_id, "success", push_result["rows_written"])
        return push_result

    except Exception as e:
        update_sync_status(sync_id, f"error: {str(e)[:200]}")
        raise
