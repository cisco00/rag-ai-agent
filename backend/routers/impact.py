"""
routers/impact.py — Column Impact Analysis

Searches across dashboards, notebooks, query history, scheduled reports,
and query templates to find every place that references a given column.
Answers "what breaks if I rename or drop column X in table Y?"
"""

import re
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, Query as QP
from sqlalchemy import text as sa_text

from dependencies import get_current_org
from auth import get_current_user
from models import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Helpers ───────────────────────────────────────────────────────────────────

_SNIPPET_RADIUS = 90   # chars around the first match to include in snippet


def _word_match(haystack: str, column: str, table: Optional[str] = None) -> bool:
    """True if `column` appears as a SQL identifier in `haystack`."""
    if not haystack:
        return False
    # Match: col, table.col, "col", `col`, [col]
    patterns = [
        r'(?i)\b' + re.escape(column) + r'\b',
        r'(?i)[`"\[]' + re.escape(column) + r'[`"\]]',
    ]
    if table:
        patterns.append(r'(?i)\b' + re.escape(table) + r'\.' + re.escape(column) + r'\b')
    return any(re.search(p, haystack) for p in patterns)


def _snippet(haystack: str, column: str, radius: int = _SNIPPET_RADIUS) -> str:
    """Return a short excerpt centred on the first match."""
    m = re.search(r'(?i)\b' + re.escape(column) + r'\b', haystack or '')
    if not m:
        return (haystack or '')[:radius * 2].strip()
    start = max(0, m.start() - radius)
    end   = min(len(haystack), m.end() + radius)
    prefix = '…' if start > 0 else ''
    suffix = '…' if end < len(haystack) else ''
    raw = haystack[start:end].strip()
    # Collapse whitespace / newlines for display
    raw = re.sub(r'\s+', ' ', raw)
    return prefix + raw + suffix


# ── Route ─────────────────────────────────────────────────────────────────────

@router.get("/impact/analyze")
async def analyze_impact(
    table:  str = QP(..., description="Table name the column belongs to"),
    column: str = QP(..., description="Column name to search for"),
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Return every dashboard card, notebook cell, query history entry,
    scheduled report, and query template that references `table`.`column`.
    """
    org_id  = org.id
    results = []

    with get_db() as db:
        # ── 1. Dashboard cards ───────────────────────────────────────────────
        try:
            rows = db.execute(sa_text("""
                SELECT dc.id, dc.title, dc.sql_query, dc.query_text,
                       d.id AS dash_id, d.name AS dash_name
                FROM   dashboard_cards dc
                JOIN   dashboards d ON d.id = dc.dashboard_id
                WHERE  d.org_id = :org_id
                  AND  (dc.sql_query  LIKE :pat
                     OR dc.query_text LIKE :pat)
            """), {"org_id": org_id, "pat": f"%{column}%"}).fetchall()

            for r in rows:
                sql_ctx = r.sql_query or r.query_text or ""
                if _word_match(sql_ctx, column, table):
                    results.append({
                        "type":           "dashboard_card",
                        "id":             r.id,
                        "title":          r.title or "(untitled card)",
                        "parent_id":      r.dash_id,
                        "parent_name":    r.dash_name,
                        "snippet":        _snippet(sql_ctx, column),
                        "navigate_to":    "boards",
                    })
        except Exception as exc:
            logger.debug("dashboard_cards scan skipped: %s", exc)

        # ── 2. Notebooks ─────────────────────────────────────────────────────
        try:
            rows = db.execute(sa_text("""
                SELECT id, title, cells
                FROM   notebooks
                WHERE  org_id = :org_id
                  AND  cells LIKE :pat
            """), {"org_id": org_id, "pat": f"%{column}%"}).fetchall()

            import json as _json
            for r in rows:
                try:
                    cells = _json.loads(r.cells or "[]")
                except Exception:
                    cells = []
                for cell in cells:
                    if cell.get("type") != "sql":
                        continue
                    content = cell.get("content", "")
                    if _word_match(content, column, table):
                        results.append({
                            "type":        "notebook_cell",
                            "id":          r.id,
                            "title":       r.title or "(untitled notebook)",
                            "parent_id":   r.id,
                            "parent_name": r.title or "(untitled notebook)",
                            "snippet":     _snippet(content, column),
                            "navigate_to": "notebook",
                        })
                        break  # one hit per notebook is enough
        except Exception as exc:
            logger.debug("notebooks scan skipped: %s", exc)

        # ── 3. Query history ─────────────────────────────────────────────────
        try:
            rows = db.execute(sa_text("""
                SELECT id, query, sql_query, created_at
                FROM   query_history
                WHERE  org_id = :org_id
                  AND  sql_query LIKE :pat
                ORDER  BY created_at DESC
                LIMIT  50
            """), {"org_id": org_id, "pat": f"%{column}%"}).fetchall()

            for r in rows:
                sql_ctx = r.sql_query or ""
                if _word_match(sql_ctx, column, table):
                    results.append({
                        "type":        "query_history",
                        "id":          r.id,
                        "title":       (r.query or sql_ctx)[:80] or "(query)",
                        "parent_id":   None,
                        "parent_name": None,
                        "snippet":     _snippet(sql_ctx, column),
                        "created_at":  str(r.created_at) if r.created_at else None,
                        "navigate_to": "history",
                    })
        except Exception as exc:
            logger.debug("query_history scan skipped: %s", exc)

        # ── 4. Scheduled reports ─────────────────────────────────────────────
        try:
            rows = db.execute(sa_text("""
                SELECT id, query, recipients, frequency
                FROM   scheduled_reports
                WHERE  org_id = :org_id
                  AND  query LIKE :pat
            """), {"org_id": org_id, "pat": f"%{column}%"}).fetchall()

            for r in rows:
                query_txt = r.query or ""
                if _word_match(query_txt, column, table):
                    results.append({
                        "type":        "scheduled_report",
                        "id":          r.id,
                        "title":       f"Scheduled report → {r.recipients or 'unknown'}",
                        "parent_id":   None,
                        "parent_name": f"{r.frequency or ''} report",
                        "snippet":     _snippet(query_txt, column),
                        "navigate_to": "scheduled",
                    })
        except Exception as exc:
            logger.debug("scheduled_reports scan skipped: %s", exc)

        # ── 5. Query templates ───────────────────────────────────────────────
        try:
            rows = db.execute(sa_text("""
                SELECT id, name, query_text
                FROM   query_templates
                WHERE  org_id = :org_id
                  AND  query_text LIKE :pat
            """), {"org_id": org_id, "pat": f"%{column}%"}).fetchall()

            for r in rows:
                q_txt = r.query_text or ""
                if _word_match(q_txt, column, table):
                    results.append({
                        "type":        "query_template",
                        "id":          r.id,
                        "title":       r.name or "(unnamed template)",
                        "parent_id":   None,
                        "parent_name": None,
                        "snippet":     _snippet(q_txt, column),
                        "navigate_to": "templates",
                    })
        except Exception as exc:
            logger.debug("query_templates scan skipped: %s", exc)

    # Deduplicate by (type, id) in case multiple cells in one notebook matched
    seen    = set()
    unique  = []
    for r in results:
        key = (r["type"], r["id"])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return {
        "table":      table,
        "column":     column,
        "total_hits": len(unique),
        "results":    unique,
    }
