"""
cloud_storage.py — Feature: S3 / Cloud Storage Export

Supports AWS S3, MinIO, Backblaze B2, Cloudflare R2, and any
S3-compatible provider via boto3.

Config is stored per-org in the admin DB (encrypted).
Exports can be triggered manually or as part of scheduled reports.
"""

import io
import os
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from models import engine as admin_engine
from logging_config import get_logger

logger = get_logger(__name__)


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_cloud_storage_tables() -> None:
    """Create cloud_storage_configs table (idempotent)."""
    dialect = admin_engine.dialect.name
    serial  = "SERIAL" if dialect == "postgresql" else "INTEGER"
    ai      = "" if dialect == "postgresql" else "AUTOINCREMENT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS cloud_storage_configs (
            id           {serial} PRIMARY KEY {ai},
            org_id       INTEGER  NOT NULL UNIQUE,
            provider     TEXT     NOT NULL DEFAULT 's3',
            bucket       TEXT     NOT NULL,
            region       TEXT,
            endpoint_url TEXT,
            access_key   TEXT     NOT NULL,
            secret_key   TEXT     NOT NULL,
            path_prefix  TEXT     NOT NULL DEFAULT 'vantage-exports/',
            is_active    INTEGER  NOT NULL DEFAULT 1,
            created_at   TEXT     NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT     NOT NULL DEFAULT (datetime('now'))
        )
    """
    ddl2 = f"""
        CREATE TABLE IF NOT EXISTS cloud_export_log (
            id           {serial} PRIMARY KEY {ai},
            org_id       INTEGER  NOT NULL,
            file_key     TEXT     NOT NULL,
            file_size    INTEGER,
            export_type  TEXT,
            status       TEXT     NOT NULL DEFAULT 'success',
            error_msg    TEXT,
            created_at   TEXT     NOT NULL DEFAULT (datetime('now'))
        )
    """
    with admin_engine.begin() as conn:
        conn.execute(text(ddl))
        conn.execute(text(ddl2))


# ── Config CRUD ───────────────────────────────────────────────────────────────

def get_storage_config(org_id: int) -> Optional[dict]:
    """Return the cloud storage config for an org, or None if not configured."""
    sql = """
        SELECT id, org_id, provider, bucket, region, endpoint_url,
               access_key, secret_key, path_prefix, is_active, created_at
        FROM cloud_storage_configs
        WHERE org_id = :org_id
    """
    with admin_engine.connect() as conn:
        row = conn.execute(text(sql), {"org_id": org_id}).fetchone()
    if not row:
        return None
    keys = ["id", "org_id", "provider", "bucket", "region", "endpoint_url",
            "access_key", "secret_key", "path_prefix", "is_active", "created_at"]
    d = dict(zip(keys, row))
    # Never expose the secret key in responses — caller strips it if needed
    return d


def upsert_storage_config(org_id: int, data: dict) -> dict:
    """Create or update the cloud storage config for an org."""
    existing = get_storage_config(org_id)
    now = datetime.now(timezone.utc).isoformat()

    if existing:
        sql = """
            UPDATE cloud_storage_configs
            SET provider     = :provider,
                bucket       = :bucket,
                region       = :region,
                endpoint_url = :endpoint_url,
                access_key   = :access_key,
                secret_key   = :secret_key,
                path_prefix  = :path_prefix,
                is_active    = :is_active,
                updated_at   = :now
            WHERE org_id = :org_id
        """
    else:
        sql = """
            INSERT INTO cloud_storage_configs
                (org_id, provider, bucket, region, endpoint_url,
                 access_key, secret_key, path_prefix, is_active, created_at, updated_at)
            VALUES
                (:org_id, :provider, :bucket, :region, :endpoint_url,
                 :access_key, :secret_key, :path_prefix, :is_active, :now, :now)
        """

    params = {
        "org_id":       org_id,
        "provider":     data.get("provider", "s3"),
        "bucket":       data["bucket"],
        "region":       data.get("region", "us-east-1"),
        "endpoint_url": data.get("endpoint_url") or None,
        "access_key":   data["access_key"],
        "secret_key":   data["secret_key"],
        "path_prefix":  data.get("path_prefix", "vantage-exports/").rstrip("/") + "/",
        "is_active":    int(data.get("is_active", True)),
        "now":          now,
    }
    with admin_engine.begin() as conn:
        conn.execute(text(sql), params)
    return get_storage_config(org_id)


def delete_storage_config(org_id: int) -> bool:
    with admin_engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM cloud_storage_configs WHERE org_id = :org_id"),
            {"org_id": org_id},
        )
    return result.rowcount > 0


# ── S3 client ─────────────────────────────────────────────────────────────────

def _get_s3_client(cfg: dict):
    """
    Build a boto3 S3 client from a storage config.
    Works for AWS S3, MinIO, Backblaze B2, Cloudflare R2, etc.
    """
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError:
        raise RuntimeError(
            "boto3 is required for cloud storage export. "
            "Install it with: pip install boto3"
        )

    kwargs = {
        "aws_access_key_id":     cfg["access_key"],
        "aws_secret_access_key": cfg["secret_key"],
        "config": BotoConfig(
            retries={"max_attempts": 3, "mode": "adaptive"},
            signature_version="s3v4",
        ),
    }

    if cfg.get("region"):
        kwargs["region_name"] = cfg["region"]

    # Custom endpoint — required for MinIO / B2 / R2
    if cfg.get("endpoint_url"):
        kwargs["endpoint_url"] = cfg["endpoint_url"]

    return boto3.client("s3", **kwargs)


# ── Core upload ───────────────────────────────────────────────────────────────

def upload_to_cloud(
    org_id: int,
    file_data: bytes,
    filename: str,
    content_type: str = "application/octet-stream",
    export_type: str = "manual",
    cfg: Optional[dict] = None,
) -> dict:
    """
    Upload file_data to the configured cloud storage bucket.

    Returns:
        {
          "file_key": "vantage-exports/2024-01-15/report.pdf",
          "bucket":   "my-bucket",
          "url":      "https://...",   # presigned URL valid 7 days
          "size":     12345,
        }
    """
    if cfg is None:
        cfg = get_storage_config(org_id)
    if not cfg:
        raise RuntimeError("Cloud storage is not configured for this organisation.")
    if not cfg.get("is_active"):
        raise RuntimeError("Cloud storage is disabled for this organisation.")

    prefix   = cfg.get("path_prefix", "vantage-exports/")
    date_str = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    file_key = f"{prefix}{date_str}/{filename}"

    client = _get_s3_client(cfg)
    bucket = cfg["bucket"]

    try:
        client.put_object(
            Bucket=bucket,
            Key=file_key,
            Body=file_data,
            ContentType=content_type,
        )
        logger.info(f"Uploaded {file_key} ({len(file_data)} bytes) to {bucket}")
    except Exception as exc:
        _log_export(org_id, file_key, len(file_data), export_type, "error", str(exc))
        raise RuntimeError(f"Upload failed: {exc}") from exc

    # Generate a presigned URL valid for 7 days
    try:
        presigned_url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": file_key},
            ExpiresIn=7 * 24 * 3600,
        )
    except Exception:
        presigned_url = None

    _log_export(org_id, file_key, len(file_data), export_type, "success")

    return {
        "file_key":     file_key,
        "bucket":       bucket,
        "url":          presigned_url,
        "size":         len(file_data),
        "exported_at":  datetime.now(timezone.utc).isoformat(),
    }


def _log_export(
    org_id: int,
    file_key: str,
    file_size: int,
    export_type: str,
    status: str,
    error_msg: Optional[str] = None,
) -> None:
    sql = """
        INSERT INTO cloud_export_log
            (org_id, file_key, file_size, export_type, status, error_msg)
        VALUES
            (:org_id, :file_key, :file_size, :export_type, :status, :error_msg)
    """
    try:
        with admin_engine.begin() as conn:
            conn.execute(text(sql), {
                "org_id":      org_id,
                "file_key":    file_key,
                "file_size":   file_size,
                "export_type": export_type,
                "status":      status,
                "error_msg":   error_msg,
            })
    except Exception:
        pass  # Never let logging break an export


# ── Export log ────────────────────────────────────────────────────────────────

def list_export_log(org_id: int, limit: int = 50) -> list:
    sql = """
        SELECT id, file_key, file_size, export_type, status, error_msg, created_at
        FROM cloud_export_log
        WHERE org_id = :org_id
        ORDER BY created_at DESC
        LIMIT :limit
    """
    with admin_engine.connect() as conn:
        rows = conn.execute(text(sql), {"org_id": org_id, "limit": limit}).fetchall()
    keys = ["id", "file_key", "file_size", "export_type", "status", "error_msg", "created_at"]
    return [dict(zip(keys, r)) for r in rows]


# ── Connection test ───────────────────────────────────────────────────────────

def test_connection(org_id: int, cfg_override: Optional[dict] = None) -> dict:
    """
    Verify the cloud storage credentials by writing and deleting a small test object.
    Returns {"ok": True/False, "message": "..."}
    """
    cfg = cfg_override or get_storage_config(org_id)
    if not cfg:
        return {"ok": False, "message": "No cloud storage config found."}

    test_key = f"{cfg.get('path_prefix', 'vantage-exports/')}connection-test.txt"
    try:
        client = _get_s3_client(cfg)
        client.put_object(
            Bucket=cfg["bucket"],
            Key=test_key,
            Body=b"Vantage AI connection test",
            ContentType="text/plain",
        )
        client.delete_object(Bucket=cfg["bucket"], Key=test_key)
        return {"ok": True, "message": f"Connected to bucket '{cfg['bucket']}' successfully."}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
