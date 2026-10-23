"""
routers/audit.py — Data Lineage & Audit Trail — Feature #11

Routes:
  GET /audit/logs                  — paginated query audit log
  GET /audit/logs/{id}             — single log entry with full SQL
  GET /audit/lineage               — all table lineage records
  GET /audit/lineage/{table_name}  — lineage for one table
  GET /audit/stats                 — summary stats (total queries, active users, etc.)
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query

import audit_log as al
from auth import get_current_user
from dependencies import get_current_org, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit/logs")
async def list_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    return al.get_audit_logs(
        org_id=org.id,
        limit=limit,
        offset=offset,
        user_id=user_id,
        status=status,
        table_name=table_name,
    )


@router.get("/audit/logs/{log_id}")
async def get_audit_log(
    log_id: int,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    from models import admin_engine
    from sqlalchemy import text
    import json

    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM query_audit_log WHERE id = :id AND org_id = :oid"),
            {"id": log_id, "oid": org.id},
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Log entry not found")

    d = dict(row._mapping)
    try:
        d["tables_used"] = json.loads(d["tables_used"] or "[]")
    except Exception:
        d["tables_used"] = []
    return d


# ── Lineage ───────────────────────────────────────────────────────────────────

@router.get("/audit/lineage")
async def list_lineage(
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    return al.get_lineage(org.id)


@router.get("/audit/lineage/{table_name}")
async def get_lineage_for_table(
    table_name: str,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    record = al.get_table_lineage(org.id, table_name)
    if not record:
        raise HTTPException(status_code=404, detail="No lineage data for this table")
    return record


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/audit/stats")
async def audit_stats(
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    """
    Quick summary numbers for the audit dashboard:
      total_queries, success_count, error_count,
      unique_users, tables_accessed, avg_duration_ms,
      queries_today, most_queried_table
    """
    from models import admin_engine
    from sqlalchemy import text

    with admin_engine.connect() as conn:
        dialect = admin_engine.dialect.name
        today_expr = "date('now')" if dialect == "sqlite" else "CURRENT_DATE"

        row = conn.execute(
            text(f"""
                SELECT
                    COUNT(*)                                       AS total_queries,
                    SUM(CASE WHEN status = 'success' THEN 1 END)  AS success_count,
                    SUM(CASE WHEN status = 'error'   THEN 1 END)  AS error_count,
                    COUNT(DISTINCT user_id)                        AS unique_users,
                    AVG(duration_ms)                               AS avg_duration_ms,
                    SUM(CASE WHEN date(created_at) = {today_expr} THEN 1 ELSE 0 END) AS queries_today
                FROM query_audit_log
                WHERE org_id = :oid
            """),
            {"oid": org.id},
        ).fetchone()

        tables_row = conn.execute(
            text("SELECT COUNT(*) FROM table_lineage WHERE org_id = :oid"),
            {"oid": org.id},
        ).fetchone()

        top_table = conn.execute(
            text("""
                SELECT table_name FROM table_lineage
                WHERE org_id = :oid
                ORDER BY access_count DESC LIMIT 1
            """),
            {"oid": org.id},
        ).fetchone()

    d = dict(row._mapping) if row else {}
    return {
        "total_queries":       d.get("total_queries") or 0,
        "success_count":       d.get("success_count") or 0,
        "error_count":         d.get("error_count") or 0,
        "unique_users":        d.get("unique_users") or 0,
        "avg_duration_ms":     round(d.get("avg_duration_ms") or 0, 1),
        "queries_today":       d.get("queries_today") or 0,
        "tables_accessed":     tables_row[0] if tables_row else 0,
        "most_queried_table":  top_table[0] if top_table else None,
    }
