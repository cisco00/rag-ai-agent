"""
routers/schema_diagram.py — Cross-Table Schema Diagram (Feature #4)

Fetches all tables + columns for the org and infers FK relationships by
matching column names (e.g. `user_id` → `users.id` / `user.id`).

Phase: Join Explorer
  GET  /schema/foreign-keys          — real FK metadata via SQLAlchemy inspect
  POST /schema/join-preview          — live join preview (first N rows)
"""

import re
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK

logger = logging.getLogger(__name__)
router = APIRouter()


def _infer_foreign_keys(tables_schemas: dict) -> list[dict]:
    """
    Heuristic FK detection:
      - Column `<singular>_id`  or `<singular>_fk` → candidate target table `<singular>` or `<singular>s`
      - Return list of {from_table, from_column, to_table, to_column} dicts
    """
    table_names = set(tables_schemas.keys())
    # Also build lower-case lookup
    lower_map = {t.lower(): t for t in table_names}

    relationships = []
    seen = set()

    for table, schema_text in tables_schemas.items():
        # Parse column names from the describe output (format: "col_name (TYPE)")
        col_names: list[str] = []
        for line in str(schema_text).splitlines():
            line = line.strip()
            if not line:
                continue
            # Typical format from describe_table: "col_name (VARCHAR)" or "col_name: VARCHAR"
            m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)[\s(:]', line)
            if m:
                col_names.append(m.group(1))

        for col in col_names:
            col_lower = col.lower()
            # Match e.g. user_id, userId, user_fk, userId
            for suffix in ('_id', '_fk', 'id', 'Id'):
                if col_lower.endswith(suffix.lower()) and len(col_lower) > len(suffix):
                    stem = col_lower[: -len(suffix)]
                    # try exact, plural (stem + 's'), and singular (stem without trailing 's')
                    candidates = [stem, stem + 's', stem.rstrip('s')]
                    for cand in candidates:
                        target = lower_map.get(cand)
                        if target and target != table:
                            key = (table, col, target)
                            if key not in seen:
                                seen.add(key)
                                relationships.append({
                                    "from_table": table,
                                    "from_column": col,
                                    "to_table": target,
                                    "to_column": "id",
                                })
                            break

    return relationships


def _build_diagram(conn_str: str, org) -> dict:
    from main import AnalyticsAgent
    tags = [f"org:{org.id}"] if org else []
    agent = AnalyticsAgent(connection_string=conn_str, observability_tags=tags)
    try:
        tables = agent.db.list_tables()
        schemas: dict[str, str] = {}
        columns_meta: dict[str, list[dict]] = {}

        for table in tables:
            raw = agent.db.describe_table(table)
            schemas[table] = raw

            # Parse column name + type pairs
            cols: list[dict] = []
            for line in str(raw).splitlines():
                line = line.strip()
                if not line:
                    continue
                # "col_name (VARCHAR)" or "col_name: VARCHAR"
                m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)[\s(:]+([\w\s()]+)', line)
                if m:
                    dtype = m.group(2).strip().rstrip(')').strip()
                    cols.append({"name": m.group(1), "type": dtype})
            if not cols:
                # Fallback: try the agent's DB inspect directly
                try:
                    from sqlalchemy import inspect as sa_inspect, create_engine
                    engine = create_engine(conn_str)
                    insp = sa_inspect(engine)
                    for col in insp.get_columns(table):
                        cols.append({"name": col["name"], "type": str(col["type"])})
                    engine.dispose()
                except Exception:
                    pass
            columns_meta[table] = cols

        relationships = _infer_foreign_keys(schemas)

        return {
            "tables": tables,
            "columns": columns_meta,
            "relationships": relationships,
        }
    finally:
        agent.close()


@router.get("/schema/diagram")
async def get_schema_diagram(org=Depends(get_current_org)):
    """Return tables, their columns, and inferred FK relationships for the ERD."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")

    try:
        result = await run_in_threadpool(_build_diagram, conn_str, org)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build schema diagram: {e}")


# ── FK metadata via SQLAlchemy inspect ───────────────────────────────────────

def _get_real_foreign_keys(conn_str: str) -> list[dict]:
    """
    Use SQLAlchemy reflection to retrieve declared FK constraints.
    Returns [{ from_table, from_column, to_table, to_column }]
    """
    from sqlalchemy import create_engine, inspect as sa_inspect

    engine = create_engine(conn_str)
    try:
        insp      = sa_inspect(engine)
        tables    = insp.get_table_names()
        fk_list: list[dict] = []
        seen = set()

        for table in tables:
            try:
                for fk in insp.get_foreign_keys(table):
                    referred = fk.get("referred_table", "")
                    local_cols    = fk.get("constrained_columns", [])
                    referred_cols = fk.get("referred_columns", [])
                    for lc, rc in zip(local_cols, referred_cols):
                        key = (table, lc, referred, rc)
                        if key not in seen:
                            seen.add(key)
                            fk_list.append({
                                "from_table":  table,
                                "from_column": lc,
                                "to_table":    referred,
                                "to_column":   rc,
                                "source":      "declared",
                            })
            except Exception:
                pass  # some engines/tables don't support FK reflection

        return fk_list
    finally:
        engine.dispose()


@router.get("/schema/foreign-keys")
async def get_foreign_keys(org=Depends(get_current_org)):
    """
    Return declared FK relationships for all tables in this org's database,
    supplemented by heuristic inference when SQLAlchemy finds none.

    Response: { foreign_keys: [{from_table, from_column, to_table, to_column, source}] }
    """
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")

    def _run():
        fks = _get_real_foreign_keys(conn_str)
        if not fks:
            # Fall back to heuristic inference from diagram build
            diagram = _build_diagram(conn_str, None)
            # Mark inferred
            fks = [dict(r, source="inferred") for r in diagram["relationships"]]
        return {"foreign_keys": fks}

    try:
        return await run_in_threadpool(_run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Join preview ──────────────────────────────────────────────────────────────

class JoinPreviewRequest(BaseModel):
    left_table:  str
    right_table: str
    left_key:    str
    right_key:   str
    join_type:   str = "inner"   # inner | left | right | full
    limit:       int = 50


def _run_join_preview(conn_str: str, req: JoinPreviewRequest) -> dict:
    import math
    import numpy as np
    import pandas as pd
    from sqlalchemy import create_engine, text

    engine = create_engine(conn_str)
    try:
        # Quote identifiers safely
        def qi(name: str) -> str:
            return f'"{name}"'

        join_sql_map = {
            "inner": "INNER JOIN",
            "left":  "LEFT JOIN",
            "right": "RIGHT JOIN",
            "full":  "FULL OUTER JOIN",
        }
        join_kw = join_sql_map.get(req.join_type.lower(), "INNER JOIN")

        # Suffix right-side columns to avoid name collisions
        with engine.connect() as conn:
            # Get left columns
            left_cols_q  = text(f"SELECT * FROM {qi(req.left_table)} LIMIT 0")
            right_cols_q = text(f"SELECT * FROM {qi(req.right_table)} LIMIT 0")
            left_cols  = list(conn.execute(left_cols_q).keys())
            right_cols = list(conn.execute(right_cols_q).keys())

        # Build column select with _right suffix for collisions
        left_sel  = [f'l.{qi(c)} AS {qi(c)}' for c in left_cols]
        right_sel = []
        for c in right_cols:
            if c in left_cols and c != req.right_key:
                right_sel.append(f'r.{qi(c)} AS {qi(c + "_right")}')
            elif c != req.right_key:
                right_sel.append(f'r.{qi(c)}')

        all_sel = ", ".join(left_sel + right_sel)

        sql = (
            f"SELECT {all_sel} "
            f"FROM {qi(req.left_table)} l "
            f"{join_kw} {qi(req.right_table)} r "
            f"ON l.{qi(req.left_key)} = r.{qi(req.right_key)} "
            f"LIMIT {req.limit}"
        )

        with engine.connect() as conn:
            df = pd.read_sql(text(sql), conn)

        # Clean NaN/inf for JSON
        rows = []
        for rec in df.to_dict(orient="records"):
            cleaned = {}
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    cleaned[k] = None
                elif isinstance(v, (np.int64, np.int32)):
                    cleaned[k] = int(v)
                else:
                    cleaned[k] = v
            rows.append(cleaned)

        return {
            "rows":       rows,
            "columns":    list(df.columns),
            "total_rows": len(rows),
            "sql":        sql,
        }
    finally:
        engine.dispose()


@router.post("/schema/join-preview")
async def join_preview(request: JoinPreviewRequest, org=Depends(get_current_org)):
    """
    Execute a live JOIN between two tables and return up to `limit` rows.

    Returns { rows, columns, total_rows, sql }
    """
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")

    try:
        result = await run_in_threadpool(_run_join_preview, conn_str, request)
        return result
    except Exception as e:
        logger.error(f"Join preview failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
