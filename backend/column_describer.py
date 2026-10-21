"""
column_describer.py — AI-generated column descriptions for imported tables.

How it works
────────────
1. After a table is created (file import, API import, etc.) callers invoke
   ``generate_and_store_descriptions(org_id, table_name, conn_str)`` as a
   background task.  It samples up to 5 representative values per column,
   calls the configured LLM with a compact prompt, and stores one
   ``ColumnDescription`` row per column in the admin DB.

2. ``get_descriptions_for_schema(org_id, table_names)`` returns a mapping
   ``{table_name: {col_name: description}}`` that can be appended to the
   LLM system-prompt to improve answer accuracy.

3. Individual descriptions can be updated via the admin API (PUT route in
   org_context.py) when a user wants to correct an AI-generated description.

Thread / async safety
─────────────────────
``generate_and_store_descriptions`` is a *synchronous* function intended to be
run inside FastAPI's ``BackgroundTasks`` or a threadpool.  It does not use
asyncio internally so it is safe to call from APScheduler jobs too.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────

def generate_and_store_descriptions(
    org_id: int,
    table_name: str,
    conn_str: str,
    force: bool = False,
) -> int:
    """
    Generate AI descriptions for every column in *table_name* and persist them.

    Parameters
    ----------
    org_id      : organisation ID (used as a DB partition key)
    table_name  : name of the table whose columns need descriptions
    conn_str    : SQLAlchemy connection string for the *org's* analytics DB
    force       : if True, overwrite existing descriptions; if False, skip
                  columns that already have a description

    Returns
    -------
    Number of columns for which a description was written.
    """
    from database import DatabaseManager
    from models import get_db, ColumnDescription

    try:
        db_mgr = DatabaseManager(connection_string=conn_str)
        try:
            schema = db_mgr.describe_table(table_name)   # [(name, type), ...]
            if not schema:
                logger.warning("column_describer: no schema for table '%s'", table_name)
                return 0

            # Fetch sample values for all columns in one pass
            sample_map = _sample_values(db_mgr, table_name, [c[0] for c in schema])
        finally:
            db_mgr.close()

        # Call LLM for all columns at once (cheaper: one request)
        descriptions = _llm_describe_columns(table_name, schema, sample_map)

        written = 0
        now = datetime.utcnow()
        with get_db() as db:
            for col_name, col_type in schema:
                desc_text = descriptions.get(col_name, "")
                if not desc_text:
                    continue

                existing = db.query(ColumnDescription).filter_by(
                    org_id=org_id,
                    table_name=table_name,
                    column_name=col_name,
                ).first()

                if existing and not force:
                    continue   # keep human-edited descriptions

                samples = sample_map.get(col_name, [])
                sample_json = json.dumps(samples, default=str)

                if existing:
                    existing.description  = desc_text
                    existing.sample_values = sample_json
                    existing.generated_by = 'ai'
                    existing.generated_at = now
                else:
                    db.add(ColumnDescription(
                        org_id       = org_id,
                        table_name   = table_name,
                        column_name  = col_name,
                        description  = desc_text,
                        sample_values = sample_json,
                        generated_by = 'ai',
                        generated_at = now,
                    ))
                written += 1

        logger.info(
            "column_describer: wrote %d description(s) for %s.%s (org %d)",
            written, table_name, col_name, org_id,
        )
        return written

    except Exception as exc:
        logger.error(
            "column_describer: failed for org=%d table='%s': %s",
            org_id, table_name, exc, exc_info=True,
        )
        return 0


def get_descriptions_for_schema(
    org_id: int,
    table_names: Optional[List[str]] = None,
) -> Dict[str, Dict[str, str]]:
    """
    Return ``{table_name: {col_name: description}}`` for *org_id*.

    If *table_names* is supplied only those tables are fetched; otherwise all
    tables for the org are returned.
    """
    from models import get_db, ColumnDescription

    result: Dict[str, Dict[str, str]] = {}
    try:
        with get_db() as db:
            q = db.query(ColumnDescription).filter_by(org_id=org_id)
            if table_names:
                q = q.filter(ColumnDescription.table_name.in_(table_names))
            rows = q.all()
            for row in rows:
                result.setdefault(row.table_name, {})[row.column_name] = row.description
    except Exception as exc:
        logger.error("column_describer: get_descriptions failed: %s", exc)
    return result


def build_descriptions_block(descriptions: Dict[str, Dict[str, str]]) -> str:
    """
    Format the description dict as a concise text block for injection into the
    LLM system prompt.

    Example output::

        Column descriptions:
        orders.customer_id — unique identifier for the purchasing customer
        orders.total_amount — order total in USD before tax
        products.sku — internal stock-keeping unit code
    """
    if not descriptions:
        return ""

    lines = ["Column descriptions (use these to interpret ambiguous column names):"]
    for table, cols in sorted(descriptions.items()):
        for col, desc in sorted(cols.items()):
            lines.append(f"  {table}.{col}: {desc}")
    return "\n".join(lines)


# ── Internals ─────────────────────────────────────────────────────────────────

def _sample_values(
    db_mgr,
    table_name: str,
    col_names: List[str],
    n: int = 5,
) -> Dict[str, List]:
    """
    Pull up to *n* non-NULL, distinct sample values for each column.
    Returns ``{col_name: [val, ...]}`` — silently skips columns that fail.
    """
    result: Dict[str, List] = {}
    for col in col_names:
        try:
            # Use the underlying SQLAlchemy connection to stay DB-agnostic
            with db_mgr.engine.connect() as conn:
                from sqlalchemy import text as sa_text
                rows = conn.execute(
                    sa_text(
                        f"SELECT DISTINCT {_quote(col)} "
                        f"FROM {_quote(table_name)} "
                        f"WHERE {_quote(col)} IS NOT NULL "
                        f"LIMIT {n}"
                    )
                ).fetchall()
                result[col] = [r[0] for r in rows]
        except Exception:
            result[col] = []
    return result


def _quote(identifier: str) -> str:
    """Wrap an identifier in double-quotes, escaping any embedded quotes."""
    return '"' + identifier.replace('"', '""') + '"'


def _llm_describe_columns(
    table_name: str,
    schema: List[tuple],
    sample_map: Dict[str, List],
) -> Dict[str, str]:
    """
    Call the configured LLM to produce a one-sentence description for every
    column.  Returns ``{col_name: description}``; falls back to an empty dict
    on any error.
    """
    try:
        from config import get_agent_config
        from llm_client import get_llm_client

        cfg    = get_agent_config()
        client = get_llm_client(cfg.provider, cfg)

        # Build a compact schema listing
        schema_lines = []
        for col_name, col_type in schema:
            samples = sample_map.get(col_name, [])
            sample_str = (
                ", ".join(str(s) for s in samples[:5]) if samples else "no samples"
            )
            schema_lines.append(f"  - {col_name} ({col_type}): samples [{sample_str}]")

        prompt = (
            f"You are a data dictionary assistant. "
            f"Given the table '{table_name}' with the following columns and sample values, "
            f"write a concise one-sentence description (max 20 words) for each column that explains "
            f"what the column stores in plain business language. "
            f"Reply ONLY with valid JSON: {{\"col_name\": \"description\", ...}}\n\n"
            + "\n".join(schema_lines)
        )

        response = client.chat_completion(
            model=cfg.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        return json.loads(raw)

    except Exception as exc:
        logger.warning("column_describer: LLM call failed: %s", exc)
        return {}
