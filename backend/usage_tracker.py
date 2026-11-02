"""
usage_tracker.py — Native LLM usage tracking stored directly in the admin DB.

Records every LLM completion (tokens in/out, model, provider, org) so the
Usage & Billing page always shows real data — completely independent of
Langfuse.  Langfuse remains an optional enhancement on top.
"""

import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pricing table — cost per 1 000 tokens in USD
# Values are approximate retail rates; update as provider pricing changes.
# ---------------------------------------------------------------------------
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    # OpenAI
    "gpt-4o":                   {"prompt": 0.005,  "completion": 0.015},
    "gpt-4o-mini":              {"prompt": 0.00015,"completion": 0.0006},
    "gpt-4-turbo":              {"prompt": 0.01,   "completion": 0.03},
    "gpt-4":                    {"prompt": 0.03,   "completion": 0.06},
    "gpt-3.5-turbo":            {"prompt": 0.0005, "completion": 0.0015},
    # Anthropic
    "claude-3-5-sonnet-20241022":{"prompt": 0.003, "completion": 0.015},
    "claude-3-5-haiku-20241022": {"prompt": 0.001, "completion": 0.005},
    "claude-3-opus-20240229":    {"prompt": 0.015, "completion": 0.075},
    "claude-3-sonnet-20240229":  {"prompt": 0.003, "completion": 0.015},
    "claude-3-haiku-20240307":   {"prompt": 0.00025,"completion": 0.00125},
    # Google
    "gemini-1.5-pro":           {"prompt": 0.00125,"completion": 0.005},
    "gemini-1.5-flash":         {"prompt": 0.000075,"completion": 0.0003},
    "gemini-1.0-pro":           {"prompt": 0.0005, "completion": 0.0015},
}

# Generic fallback when model not found in table
DEFAULT_PROMPT_PRICE_PER_1K  = 0.002
DEFAULT_COMPLETION_PRICE_PER_1K = 0.006


def _get_admin_db_path() -> str:
    """Return the path to the admin SQLite database."""
    import os
    db_path = os.getenv("ADMIN_DB_PATH", "admin.db")
    return db_path


def ensure_usage_tables() -> None:
    """Create usage_events table if it does not exist."""
    db_path = _get_admin_db_path()
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS usage_events (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    org_id           INTEGER NOT NULL,
                    model            TEXT    NOT NULL,
                    provider         TEXT    NOT NULL DEFAULT 'unknown',
                    prompt_tokens    INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens     INTEGER NOT NULL DEFAULT 0,
                    cost_usd         REAL    NOT NULL DEFAULT 0.0,
                    created_at       TEXT    NOT NULL
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_usage_org_date "
                "ON usage_events(org_id, created_at)"
            )
            conn.commit()
        logger.info("[UsageTracker] usage_events table ready.")
    except Exception as e:
        logger.error(f"[UsageTracker] Failed to create usage_events table: {e}", exc_info=True)


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimate cost in USD from a pricing table entry."""
    # Try exact match, then prefix match
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        # Try prefix match so "gpt-4o-2024-11-20" matches "gpt-4o"
        for key in MODEL_PRICING:
            if model.startswith(key):
                pricing = MODEL_PRICING[key]
                break

    if pricing:
        cost = (prompt_tokens / 1000) * pricing["prompt"] + \
               (completion_tokens / 1000) * pricing["completion"]
    else:
        cost = (prompt_tokens / 1000) * DEFAULT_PROMPT_PRICE_PER_1K + \
               (completion_tokens / 1000) * DEFAULT_COMPLETION_PRICE_PER_1K

    return round(cost, 8)


def record_usage(
    org_id: int,
    model: str,
    provider: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    """
    Insert one usage event into the admin DB.
    Called after every successful LLM completion.
    Silently swallows errors so a tracking failure never breaks inference.
    """
    if not org_id:
        return  # Can't attribute without an org

    total_tokens = prompt_tokens + completion_tokens
    cost_usd = _estimate_cost(model, prompt_tokens, completion_tokens)
    created_at = datetime.utcnow().isoformat()

    db_path = _get_admin_db_path()
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                INSERT INTO usage_events
                    (org_id, model, provider, prompt_tokens, completion_tokens,
                     total_tokens, cost_usd, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (org_id, model, provider, prompt_tokens, completion_tokens,
                 total_tokens, cost_usd, created_at),
            )
            conn.commit()
    except Exception as e:
        logger.warning(f"[UsageTracker] Failed to record usage event: {e}")


def get_usage_summary(org_id: int, days: int = 30) -> Dict[str, Any]:
    """
    Return aggregated usage for the last `days` days for an org.
    Result shape matches the existing /billing/usage response so the
    frontend needs no changes.
    """
    now = datetime.utcnow()
    cutoff = (now - timedelta(days=days)).isoformat()

    # Pre-build zeroed daily buckets for a continuous chart
    daily_usage: Dict[str, Dict[str, Any]] = {}
    for i in range(days):
        d = (now - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        daily_usage[d] = {
            "date": d,
            "queries": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost": 0.0,
        }

    total_prompt_tokens    = 0
    total_completion_tokens = 0
    total_queries          = 0
    total_cost             = 0.0

    db_path = _get_admin_db_path()
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT date(created_at) AS day,
                       COUNT(*)         AS queries,
                       SUM(prompt_tokens)     AS pt,
                       SUM(completion_tokens) AS ct,
                       SUM(cost_usd)          AS cost
                FROM usage_events
                WHERE org_id = ?
                  AND created_at >= ?
                GROUP BY date(created_at)
                ORDER BY day
                """,
                (org_id, cutoff),
            ).fetchall()

        for row in rows:
            day = row["day"]
            if day in daily_usage:
                daily_usage[day]["queries"]           += row["queries"]
                daily_usage[day]["prompt_tokens"]     += (row["pt"] or 0)
                daily_usage[day]["completion_tokens"] += (row["ct"] or 0)
                daily_usage[day]["cost"]              += round(row["cost"] or 0, 6)
            total_queries           += row["queries"]
            total_prompt_tokens     += (row["pt"] or 0)
            total_completion_tokens += (row["ct"] or 0)
            total_cost              += (row["cost"] or 0)

    except Exception as e:
        logger.error(f"[UsageTracker] Failed to query usage summary: {e}", exc_info=True)

    daily_trend = [daily_usage[k] for k in sorted(daily_usage.keys())]

    return {
        "status": "success",
        "org_id": org_id,
        "timeframe_days": days,
        "totals": {
            "prompt_tokens":      total_prompt_tokens,
            "completion_tokens":  total_completion_tokens,
            "total_tokens":       total_prompt_tokens + total_completion_tokens,
            "total_queries":      total_queries,
            "estimated_cost_usd": round(total_cost, 4),
        },
        "daily_trend": daily_trend,
        "pricing_model": "native_tracker",
    }


def get_top_models(org_id: int, days: int = 30, limit: int = 10) -> List[Dict[str, Any]]:
    """Return the most-used models for an org over the last `days` days."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    db_path = _get_admin_db_path()
    results = []
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT model, provider,
                       COUNT(*)         AS queries,
                       SUM(total_tokens) AS tokens,
                       SUM(cost_usd)    AS cost
                FROM usage_events
                WHERE org_id = ? AND created_at >= ?
                GROUP BY model, provider
                ORDER BY queries DESC
                LIMIT ?
                """,
                (org_id, cutoff, limit),
            ).fetchall()
        for row in rows:
            results.append({
                "model":    row["model"],
                "provider": row["provider"],
                "queries":  row["queries"],
                "tokens":   row["tokens"] or 0,
                "cost":     round(row["cost"] or 0, 4),
            })
    except Exception as e:
        logger.error(f"[UsageTracker] get_top_models failed: {e}", exc_info=True)
    return results
