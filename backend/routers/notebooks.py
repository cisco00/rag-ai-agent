"""
routers/notebooks.py — Multi-cell SQL Notebook Explorer

Persistent notebooks with SQL cells, markdown cells, and inline results.
Cells are stored as a JSON blob; execution is per-cell on demand.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, text as sa_text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import create_engine

from dependencies import get_current_org, get_org_connection_string
from auth import get_current_user
from models import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── ORM ───────────────────────────────────────────────────────────────────────

_Base = declarative_base()

class NotebookRecord(_Base):
    __tablename__ = "notebooks"
    id         = Column(Integer, primary_key=True)
    org_id     = Column(Integer, nullable=False)
    created_by = Column(Integer, nullable=True)
    title      = Column(String(255), default="Untitled Notebook")
    cells      = Column(Text, default="[]")   # JSON: [{id, type, content}]
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_notebooks_org", "org_id"),
    )

def _ensure_table(engine):
    _Base.metadata.create_all(engine, tables=[NotebookRecord.__table__])


# ── SQL execution helper ───────────────────────────────────────────────────────

_ROW_LIMIT = 500
_DANGEROUS = {"drop", "delete", "truncate", "alter", "create", "insert", "update", "grant", "revoke"}


def _run_sql(conn_str: str, sql: str) -> Dict[str, Any]:
    """Execute raw SQL against the org database; return columns + rows."""
    # Lightweight guard: block DML/DDL (read-only notebook)
    first_word = sql.strip().split()[0].lower() if sql.strip() else ""
    if first_word in _DANGEROUS:
        raise ValueError(
            f"Notebooks are read-only: '{first_word.upper()}' statements are not allowed. "
            "Use the Data Manager or AI Transform for mutations."
        )

    engine = create_engine(conn_str, pool_pre_ping=True, pool_size=1, max_overflow=0)
    try:
        with engine.connect() as conn:
            result = conn.execute(sa_text(sql))
            columns = list(result.keys())
            rows = []
            for row in result.fetchmany(_ROW_LIMIT):
                rows.append({col: (val if not hasattr(val, 'isoformat') else val.isoformat())
                             for col, val in zip(columns, row)})
        return {"columns": columns, "data": rows, "row_count": len(rows)}
    finally:
        engine.dispose()


def _suggest_viz(columns: List[str], data: List[dict]) -> Optional[dict]:
    """Heuristic: suggest a chart type from column names and dtypes."""
    if not data or len(columns) < 2:
        return None

    def _is_numeric(col: str) -> bool:
        vals = [row.get(col) for row in data[:20] if row.get(col) is not None]
        return bool(vals) and all(isinstance(v, (int, float)) for v in vals)

    def _looks_temporal(col: str) -> bool:
        low = col.lower()
        return any(k in low for k in ("date", "time", "month", "year", "week", "day", "ts", "at"))

    x_col = columns[0]
    numeric_cols = [c for c in columns[1:] if _is_numeric(c)]

    if not numeric_cols:
        return None

    chart_type = "line" if _looks_temporal(x_col) else "bar"
    return {
        "type": chart_type,
        "x": x_col,
        "ys": numeric_cols[:4],   # cap at 4 series
    }


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class _BM(BaseModel):
    class Config:
        from_attributes = True

class NotebookCreateRequest(_BM):
    title: str = "Untitled Notebook"
    cells: Optional[List[dict]] = None

class NotebookUpdateRequest(_BM):
    title: Optional[str] = None
    cells: Optional[List[dict]] = None

class RunCellRequest(_BM):
    sql: str


# ── Routes ────────────────────────────────────────────────────────────────────

def _serialize(nb: NotebookRecord) -> dict:
    return {
        "id":         nb.id,
        "title":      nb.title,
        "cells":      json.loads(nb.cells or "[]"),
        "created_at": nb.created_at.isoformat() if nb.created_at else None,
        "updated_at": nb.updated_at.isoformat() if nb.updated_at else None,
        "created_by": nb.created_by,
    }


@router.get("/notebooks")
async def list_notebooks(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)
        rows = (
            db.query(NotebookRecord)
            .filter(NotebookRecord.org_id == org.id)
            .order_by(NotebookRecord.updated_at.desc())
            .all()
        )
    return {"notebooks": [_serialize(r) for r in rows]}


@router.post("/notebooks", status_code=201)
async def create_notebook(
    body: NotebookCreateRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)
        nb = NotebookRecord(
            org_id=org.id,
            created_by=getattr(user, "id", None),
            title=body.title,
            cells=json.dumps(body.cells or []),
        )
        db.add(nb)
        db.commit()
        db.refresh(nb)
    return _serialize(nb)


@router.get("/notebooks/{notebook_id}")
async def get_notebook(
    notebook_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)
        nb = db.query(NotebookRecord).filter(
            NotebookRecord.id == notebook_id,
            NotebookRecord.org_id == org.id,
        ).first()
    if not nb:
        raise HTTPException(404, "Notebook not found")
    return _serialize(nb)


@router.put("/notebooks/{notebook_id}")
async def update_notebook(
    notebook_id: int,
    body: NotebookUpdateRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)
        nb = db.query(NotebookRecord).filter(
            NotebookRecord.id == notebook_id,
            NotebookRecord.org_id == org.id,
        ).first()
        if not nb:
            raise HTTPException(404, "Notebook not found")
        if body.title is not None:
            nb.title = body.title
        if body.cells is not None:
            nb.cells = json.dumps(body.cells)
        nb.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(nb)
    return _serialize(nb)


@router.delete("/notebooks/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    with get_db() as db:
        engine = db.bind or db.get_bind()
        _ensure_table(engine)
        nb = db.query(NotebookRecord).filter(
            NotebookRecord.id == notebook_id,
            NotebookRecord.org_id == org.id,
        ).first()
        if not nb:
            raise HTTPException(404, "Notebook not found")
        db.delete(nb)
        db.commit()


@router.post("/notebooks/run-cell")
async def run_cell(
    body: RunCellRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Execute a SQL statement against the org's data database."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(400, "No database configured for this organisation.")

    sql = body.sql.strip()
    if not sql:
        raise HTTPException(422, "SQL cannot be empty.")

    try:
        result = await run_in_threadpool(_run_sql, conn_str, sql)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        logger.warning("Notebook SQL error: %s", exc)
        raise HTTPException(400, str(exc))

    viz = _suggest_viz(result["columns"], result["data"])
    return {**result, "visualization": viz}
