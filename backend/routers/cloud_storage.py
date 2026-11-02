"""
routers/cloud_storage.py — S3 / Cloud Storage Export API

Endpoints:
  GET    /cloud-storage/config          — get current config (secret_key masked)
  POST   /cloud-storage/config          — create / update config
  DELETE /cloud-storage/config          — remove config
  POST   /cloud-storage/test            — test connection
  POST   /cloud-storage/export          — export query results / file to cloud
  GET    /cloud-storage/log             — export history
"""

import io
import csv
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field

from auth import get_current_user
from dependencies import get_current_org
from cloud_storage import (
    get_storage_config,
    upsert_storage_config,
    delete_storage_config,
    upload_to_cloud,
    list_export_log,
    test_connection,
)
from export_manager import ExportManager

router = APIRouter(prefix="/cloud-storage", tags=["Cloud Storage"])

_export_manager = ExportManager()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StorageConfigIn(BaseModel):
    provider:     str  = Field("s3", description="s3 | minio | b2 | r2")
    bucket:       str
    region:       Optional[str] = "us-east-1"
    endpoint_url: Optional[str] = None   # MinIO/B2/R2 custom endpoint
    access_key:   str
    secret_key:   str
    path_prefix:  str  = "vantage-exports/"
    is_active:    bool = True


class CloudExportRequest(BaseModel):
    export_type: str = Field("csv", description="csv | json | pdf | pptx")
    filename:    Optional[str] = None
    # For CSV / JSON exports
    columns:     Optional[list] = None
    rows:        Optional[list] = None
    # For PDF / PPTX re-exports of a previous query result
    query:       Optional[str]  = None
    response:    Optional[str]  = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask(cfg: dict) -> dict:
    """Return config with secret_key masked for API responses."""
    c = dict(cfg)
    if c.get("secret_key"):
        c["secret_key"] = "••••••••"
    return c


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(
    org: dict = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """Return current cloud storage config (secret masked)."""
    cfg = get_storage_config(org["id"])
    if not cfg:
        return {"configured": False}
    return {"configured": True, "config": _mask(cfg)}


@router.post("/config")
async def save_config(
    body: StorageConfigIn,
    org: dict = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """Create or update cloud storage config for this org."""
    cfg = upsert_storage_config(org["id"], body.model_dump())
    return {"ok": True, "config": _mask(cfg)}


@router.delete("/config")
async def remove_config(
    org: dict = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """Remove cloud storage config."""
    deleted = delete_storage_config(org["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="No cloud storage config found.")
    return {"ok": True}


@router.post("/test")
async def test_config(
    body: Optional[StorageConfigIn] = None,
    org: dict = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """
    Test cloud storage connectivity.
    If a body is provided it overrides the saved config (useful before saving).
    """
    cfg_override = body.model_dump() if body else None
    result = test_connection(org["id"], cfg_override)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/export")
async def export_to_cloud(
    body: CloudExportRequest,
    org: dict = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """
    Export data directly to cloud storage.

    Supported export_type values:
      - csv   — rows/columns list → CSV file
      - json  — rows/columns list → JSON file
      - pdf   — query+response   → PDF report
      - pptx  — query+response   → PowerPoint report
    """
    now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ext_map = {"csv": "csv", "json": "json", "pdf": "pdf", "pptx": "pptx"}
    ct_map  = {
        "csv":  "text/csv",
        "json": "application/json",
        "pdf":  "application/pdf",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }

    export_type = body.export_type.lower()
    if export_type not in ext_map:
        raise HTTPException(status_code=400, detail=f"Unsupported export type: {export_type}")

    filename = body.filename or f"vantage-export-{now_str}.{ext_map[export_type]}"
    content_type = ct_map[export_type]

    # ── Build the file bytes ──────────────────────────────────────────────────
    try:
        if export_type == "csv":
            if not body.rows:
                raise HTTPException(status_code=400, detail="'rows' required for CSV export.")
            buf = io.StringIO()
            writer = csv.writer(buf)
            if body.columns:
                writer.writerow(body.columns)
            writer.writerows(body.rows)
            file_bytes = buf.getvalue().encode("utf-8")

        elif export_type == "json":
            if not body.rows:
                raise HTTPException(status_code=400, detail="'rows' required for JSON export.")
            if body.columns:
                records = [dict(zip(body.columns, row)) for row in body.rows]
            else:
                records = body.rows
            file_bytes = json.dumps(records, indent=2, default=str).encode("utf-8")

        elif export_type == "pdf":
            if not body.query or not body.response:
                raise HTTPException(status_code=400, detail="'query' and 'response' required for PDF export.")
            buf = _export_manager.generate_pdf(body.query, body.response)
            file_bytes = buf.read()

        elif export_type == "pptx":
            if not body.query or not body.response:
                raise HTTPException(status_code=400, detail="'query' and 'response' required for PPTX export.")
            buf = _export_manager.generate_pptx(body.query, body.response)
            file_bytes = buf.read()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate export: {exc}")

    # ── Upload to cloud ───────────────────────────────────────────────────────
    try:
        result = upload_to_cloud(
            org_id=org["id"],
            file_data=file_bytes,
            filename=filename,
            content_type=content_type,
            export_type=export_type,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    return {
        "ok":          True,
        "file_key":    result["file_key"],
        "bucket":      result["bucket"],
        "url":         result["url"],
        "size":        result["size"],
        "exported_at": result["exported_at"],
    }


@router.get("/log")
async def get_export_log(
    limit: int = 50,
    org: dict  = Depends(get_current_org),
    user: dict = Depends(get_current_user),
):
    """Return recent cloud export history for this org."""
    return {"exports": list_export_log(org["id"], limit=limit)}
