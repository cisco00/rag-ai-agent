"""
routers/data_quality.py — Data Quality Monitoring

Stores per-table profiler snapshots over time and surfaces drift alerts
when key metrics change significantly between successive snapshots.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query as QP
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.ext.declarative import declarative_base

from dependencies import get_current_org, get_org_connection_string
from auth import get_current_user
from models import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Lightweight ORM model (created on first use) ──────────────────────────────

_Base = declarative_base()

class DQSnapshot(_Base):
    __tablename__ = "dq_snapshots"
    id         = Column(Integer, primary_key=True)
    org_id     = Column(Integer, nullable=False)
    table_name = Column(String(255), nullable=False)
    profile    = Column(Text, nullable=False)   # JSON blob
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_dq_snapshots_org_table", "org_id", "table_name"),
    )


def _ensure_table(engine):
    _Base.metadata.create_all(engine, tables=[DQSnapshot.__table__])


# ── Drift detection helpers ───────────────────────────────────────────────────

_NULL_DRIFT_THRESH  = 0.10   # 10 pp change in null rate → alert
_DIST_DRIFT_THRESH  = 0.20   # 20% relative change in mean/stddev → alert
_ROW_DRIFT_THRESH   = 0.15   # 15% change in row count → alert


def _drift_alerts(prev_profile: dict, curr_profile: dict) -> List[dict]:
    alerts = []

    prev_rows = prev_profile.get("row_count", 0)
    curr_rows = curr_profile.get("row_count", 0)
    if prev_rows and curr_rows:
        delta = abs(curr_rows - prev_rows) / prev_rows
        if delta >= _ROW_DRIFT_THRESH:
            direction = "dropped" if curr_rows < prev_rows else "increased"
            alerts.append({
                "type": "row_count",
                "severity": "high" if delta > 0.4 else "medium",
                "message": f"Row count {direction} by {delta:.0%} ({prev_rows:,} → {curr_rows:,})",
            })

    prev_cols = {c["name"]: c for c in prev_profile.get("columns", [])}
    curr_cols = {c["name"]: c for c in curr_profile.get("columns", [])}

    for col_name, curr in curr_cols.items():
        prev = prev_cols.get(col_name)
        if not prev:
            continue

        # Null rate drift
        pn = prev.get("null_pct", 0) or 0
        cn = curr.get("null_pct", 0) or 0
        if abs(cn - pn) >= _NULL_DRIFT_THRESH:
            alerts.append({
                "type": "null_rate",
                "column": col_name,
                "severity": "high" if abs(cn - pn) > 0.3 else "medium",
                "message": f"Null rate for '{col_name}' changed {pn:.1%} → {cn:.1%}",
            })

        # Mean drift (numeric columns)
        pm = prev.get("mean")
        cm = curr.get("mean")
        if pm is not None and cm is not None and pm != 0:
            rel = abs(cm - pm) / abs(pm)
            if rel >= _DIST_DRIFT_THRESH:
                alerts.append({
                    "type": "mean_drift",
                    "column": col_name,
                    "severity": "medium",
                    "message": f"Mean of '{col_name}' shifted {rel:.0%} ({pm:.3g} → {cm:.3g})",
                })

    # Dropped columns
    for col_name in prev_cols:
        if col_name not in curr_cols:
            alerts.append({
                "type": "column_removed",
                "column": col_name,
                "severity": "high",
                "message": f"Column '{col_name}' no longer present",
            })

    return alerts


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/data-quality/snapshot/{table_name}")
async def take_snapshot(
    table_name: str,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Run the profiler on *table_name*, persist a snapshot, and return the
    profile together with any drift alerts vs. the previous snapshot.
    """
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(400, "No database configured.")

    # Run profiler in thread (CPU-bound)
    try:
        from profiler import profile_table
        profile = await run_in_threadpool(profile_table, conn_str, table_name, True)
    except Exception as exc:
        raise HTTPException(500, f"Profiling failed: {exc}")

    profile_json = json.dumps(profile, default=str)

    with get_db() as db:
        from sqlalchemy import inspect as sa_inspect
        engine = db.bind or db.get_bind()
        _ensure_table(engine)

        # Fetch the most recent previous snapshot for drift comparison
        prev_snap = (
            db.query(DQSnapshot)
            .filter(DQSnapshot.org_id == org.id, DQSnapshot.table_name == table_name)
            .order_by(DQSnapshot.created_at.desc())
            .first()
        )
        prev_profile = json.loads(prev_snap.profile) if prev_snap else None

        # Persist new snapshot
        snap = DQSnapshot(org_id=org.id, table_name=table_name, profile=profile_json)
        db.add(snap)
        db.commit()
        db.refresh(snap)

    alerts = _drift_alerts(prev_profile, profile) if prev_profile else []

    return {
        "snapshot_id": snap.id,
        "table_name":  table_name,
        "created_at":  snap.created_at.isoformat(),
        "profile":     profile,
        "drift_alerts": alerts,
        "has_baseline": prev_profile is not None,
    }


@router.get("/data-quality/history/{table_name}")
async def snapshot_history(
    table_name: str,
    limit: int = QP(10, ge=1, le=50),
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Return up to *limit* snapshots (newest first) for trend charts."""
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)

        rows = (
            db.query(DQSnapshot)
            .filter(DQSnapshot.org_id == org.id, DQSnapshot.table_name == table_name)
            .order_by(DQSnapshot.created_at.desc())
            .limit(limit)
            .all()
        )

    history = []
    for r in rows:
        p = json.loads(r.profile)
        history.append({
            "snapshot_id": r.id,
            "created_at":  r.created_at.isoformat(),
            "row_count":   p.get("row_count"),
            "columns": [
                {
                    "name":       c.get("name"),
                    "null_pct":   c.get("null_pct"),
                    "mean":       c.get("mean"),
                    "stddev":     c.get("std"),
                    "min":        c.get("min"),
                    "max":        c.get("max"),
                    "distinct":   c.get("distinct_count"),
                }
                for c in p.get("columns", [])
            ],
        })
    return {"table_name": table_name, "history": history}


@router.get("/data-quality/tables")
async def monitored_tables(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """List all tables that have at least one snapshot, with latest snapshot time."""
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)

        from sqlalchemy import func
        rows = (
            db.query(
                DQSnapshot.table_name,
                func.max(DQSnapshot.created_at).label("last_snapshot"),
                func.count(DQSnapshot.id).label("snapshot_count"),
            )
            .filter(DQSnapshot.org_id == org.id)
            .group_by(DQSnapshot.table_name)
            .all()
        )

    return {
        "tables": [
            {
                "table_name":     r.table_name,
                "last_snapshot":  r.last_snapshot.isoformat(),
                "snapshot_count": r.snapshot_count,
            }
            for r in rows
        ]
    }
