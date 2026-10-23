"""
routers/schema_diagram.py — Cross-Table Schema Diagram (Feature #4)

Fetches all tables + columns for the org and infers FK relationships by
matching column names (e.g. `user_id` → `users.id` / `user.id`).
"""

import re
from fastapi import APIRouter, HTTPException, Depends
from starlette.concurrency import run_in_threadpool

from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK

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
    agent = AnalyticsAgent(connection_string=conn_str, observability_tags=[f"org:{org.id}"])
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
