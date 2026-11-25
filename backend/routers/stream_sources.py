"""
stream_sources — CRUD for Kafka / CDC event-stream source configurations.

Each record stores enough to open an AIOKafkaConsumer:
  bootstrap_servers, topic, group_id, security settings, CDC format.

Table is auto-created on first use — no migration needed.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Any, Dict
import json
import logging
from sqlalchemy import text

from models import admin_engine
from dependencies import get_current_org, require_permission

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Schema ────────────────────────────────────────────────────────────────────

_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS stream_sources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL,
    name        TEXT    NOT NULL,
    source_type TEXT    NOT NULL,
    connection_details TEXT NOT NULL DEFAULT '{}',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

def _ensure_table():
    with admin_engine.connect() as conn:
        conn.execute(text(_TABLE_DDL))
        conn.commit()

def _get_source(org_id: int, source_id: int):
    _ensure_table()
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, name, source_type, connection_details, created_at "
                 "FROM stream_sources WHERE id = :id AND org_id = :org_id"),
            {"id": source_id, "org_id": org_id}
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Stream source not found")
    return {
        "id": row[0], "name": row[1], "source_type": row[2],
        "connection_details": json.loads(row[3] or "{}"),
        "created_at": str(row[4]),
    }

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_stream_sources(
    org=Depends(get_current_org),
    user=Depends(require_permission("MANAGE_ORG")),
):
    """Return all stream source configs for this org (credentials masked)."""
    _ensure_table()
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, name, source_type, connection_details, created_at "
                 "FROM stream_sources WHERE org_id = :org_id ORDER BY id"),
            {"org_id": org.id}
        ).fetchall()

    result = []
    for r in rows:
        details = json.loads(r[3] or "{}")
        # Mask credentials
        masked = {k: ("••••••" if "secret" in k.lower() or "password" in k.lower() else v)
                  for k, v in details.items()}
        result.append({
            "id": r[0], "name": r[1], "source_type": r[2],
            "connection_details": masked, "created_at": str(r[4]),
        })
    return result


@router.post("")
async def create_stream_source(
    body: Dict[str, Any],
    org=Depends(get_current_org),
    user=Depends(require_permission("MANAGE_ORG")),
):
    """Create a new Kafka or CDC stream source config."""
    _ensure_table()
    name = body.get("name", "").strip()
    source_type = body.get("source_type", "").strip()
    details = body.get("connection_details", {})

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if source_type not in ("kafka", "cdc_kafka"):
        raise HTTPException(status_code=400, detail="source_type must be 'kafka' or 'cdc_kafka'")
    if not details.get("bootstrap_servers"):
        raise HTTPException(status_code=400, detail="connection_details.bootstrap_servers is required")
    if not details.get("topic"):
        raise HTTPException(status_code=400, detail="connection_details.topic is required")

    with admin_engine.connect() as conn:
        conn.execute(
            text("INSERT INTO stream_sources (org_id, name, source_type, connection_details) "
                 "VALUES (:org_id, :name, :st, :cd)"),
            {"org_id": org.id, "name": name, "st": source_type, "cd": json.dumps(details)},
        )
        new_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
        conn.commit()

    logger.info(f"Created stream source id={new_id} type={source_type} for org={org.id}")
    return {"id": new_id, "status": "created"}


@router.put("/{source_id}")
async def update_stream_source(
    source_id: int,
    body: Dict[str, Any],
    org=Depends(get_current_org),
    user=Depends(require_permission("MANAGE_ORG")),
):
    """Update name and/or connection details for an existing stream source."""
    existing = _get_source(org.id, source_id)   # 404 if missing
    merged = {**existing["connection_details"], **body.get("connection_details", {})}
    new_name = body.get("name", existing["name"])

    with admin_engine.connect() as conn:
        conn.execute(
            text("UPDATE stream_sources SET name=:name, connection_details=:cd "
                 "WHERE id=:id AND org_id=:org_id"),
            {"name": new_name, "cd": json.dumps(merged), "id": source_id, "org_id": org.id},
        )
        conn.commit()
    return {"status": "updated"}


@router.delete("/{source_id}")
async def delete_stream_source(
    source_id: int,
    org=Depends(get_current_org),
    user=Depends(require_permission("MANAGE_ORG")),
):
    _ensure_table()
    with admin_engine.connect() as conn:
        conn.execute(
            text("DELETE FROM stream_sources WHERE id=:id AND org_id=:org_id"),
            {"id": source_id, "org_id": org.id},
        )
        conn.commit()
    return {"status": "deleted"}


@router.post("/{source_id}/test")
async def test_stream_source(
    source_id: int,
    org=Depends(get_current_org),
    user=Depends(require_permission("MANAGE_ORG")),
):
    """
    Ping the Kafka broker: list topics and confirm the configured topic exists.
    Returns 400 on connectivity failure so the UI can surface the error.
    """
    source = _get_source(org.id, source_id)
    details = source["connection_details"]
    bootstrap = details.get("bootstrap_servers", "localhost:9092")
    topic = details.get("topic", "")

    try:
        from aiokafka.admin import AIOKafkaAdminClient
        admin_kwargs = {"bootstrap_servers": bootstrap}
        _apply_kafka_security(admin_kwargs, details)

        client = AIOKafkaAdminClient(**admin_kwargs)
        await client.start()
        try:
            cluster_meta = await client.describe_cluster()
            topics_meta  = await client.list_topics()
        finally:
            await client.close()

        brokers = [f"{b.host}:{b.port}" for b in cluster_meta.brokers] if hasattr(cluster_meta, "brokers") else [bootstrap]
        return {
            "status": "ok",
            "brokers": brokers,
            "topic_exists": topic in topics_meta,
            "sample_topics": sorted(list(topics_meta))[:20],
        }

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="aiokafka is not installed on the server. Add it to requirements.txt."
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Kafka connection failed: {exc}")


# ── Helpers (shared with api.py's WS handler) ─────────────────────────────────

def _apply_kafka_security(kwargs: dict, details: dict) -> None:
    """Inject SASL/SSL settings from connection_details into aiokafka kwargs."""
    protocol = details.get("security_protocol", "PLAINTEXT").upper()
    if protocol != "PLAINTEXT":
        kwargs["security_protocol"] = protocol

    mechanism = details.get("sasl_mechanism", "").upper()
    if mechanism:
        kwargs["sasl_mechanism"] = mechanism
        kwargs["sasl_plain_username"] = details.get("sasl_username", "")
        kwargs["sasl_plain_password"] = details.get("sasl_password", "")

    if "ssl" in protocol.lower():
        kwargs["ssl_context"] = True   # aiokafka creates a default SSL context


def get_stream_source_config(org_id: int, source_id: int) -> dict:
    """
    Public helper used by the WebSocket handler in api.py.
    Returns full (unmasked) config dict or raises HTTPException.
    """
    return _get_source(org_id, source_id)
