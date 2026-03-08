"""
profiler.py — Column-level data profiling for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Provides profile_table(), profile_all_tables(), and profile_to_prompt_block()
for use by api.py endpoints /tables/{table}/profile and /profile.

For each column, computes:
  - dtype, total_count, null_count, null_pct, distinct_count
  - Numeric: min, max, mean, median, std, p25, p75
  - Categorical: top_values (up to 10)
  - sample_values (5 representative values)

Results are cached per (connection_string, table) for 10 minutes to avoid
re-running expensive scans on every request.
"""

import time
import math
from datetime import datetime
from typing import Optional

import pandas as pd
from sqlalchemy import text

from database import DatabaseManager
from logging_config import get_logger

logger = get_logger(__name__)

# ─── Simple TTL cache ─────────────────────────────────────────────────────────
_CACHE: dict = {}          # key → (expires_at, profile_dict)
_CACHE_TTL   = 600         # seconds (10 minutes)


def _cache_key(conn_str: str, table: str) -> str:
    return f"{conn_str}::{table}"


def _get_cached(conn_str: str, table: str) -> Optional[dict]:
    key = _cache_key(conn_str, table)
    entry = _CACHE.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def _set_cached(conn_str: str, table: str, profile: dict):
    key = _cache_key(conn_str, table)
    _CACHE[key] = (time.monotonic() + _CACHE_TTL, profile)


# ─── Core profiling ───────────────────────────────────────────────────────────

def _profile_column(series: pd.Series) -> dict:
    total   = len(series)
    nulls   = int(series.isna().sum())
    col_info: dict = {
        "dtype":          str(series.dtype),
        "total_count":    total,
        "null_count":     nulls,
        "null_pct":       round(nulls / total * 100, 2) if total else 0,
        "distinct_count": int(series.nunique(dropna=True)),
    }

    non_null = series.dropna()

    # Numeric stats
    if pd.api.types.is_numeric_dtype(series):
        try:
            col_info.update({
                "min":    _safe_float(non_null.min()),
                "max":    _safe_float(non_null.max()),
                "mean":   _safe_float(non_null.mean()),
                "median": _safe_float(non_null.median()),
                "std":    _safe_float(non_null.std()),
                "p25":    _safe_float(non_null.quantile(0.25)),
                "p75":    _safe_float(non_null.quantile(0.75)),
            })
        except Exception:
            pass

    # Categorical / text top values
    else:
        try:
            top = non_null.astype(str).value_counts().head(10)
            col_info["top_values"] = [[str(k), int(v)] for k, v in top.items()]
        except Exception:
            col_info["top_values"] = []

    # Sample values (5)
    try:
        samples = non_null.head(5).tolist()
        col_info["sample_values"] = [_json_safe(v) for v in samples]
    except Exception:
        col_info["sample_values"] = []

    return col_info


def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    except Exception:
        return None


def _json_safe(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    try:
        import numpy as np
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return float(v)
    except ImportError:
        pass
    return v


# ─── Public API ───────────────────────────────────────────────────────────────

def profile_table(conn_str: str, table_name: str, force: bool = False) -> dict:
    """
    Profile a single table.  Raises ValueError if the table does not exist.
    Uses an in-memory cache (10 min TTL) unless force=True.
    """
    if not force:
        cached = _get_cached(conn_str, table_name)
        if cached:
            return cached

    dm = DatabaseManager(connection_string=conn_str)
    try:
        tables = dm.list_tables()
        if table_name not in tables:
            raise ValueError(f"Table '{table_name}' not found in the database.")

        engine = dm.get_engine()

        # Row count
        with engine.connect() as conn:
            row_count = conn.execute(
                text(f'SELECT COUNT(*) FROM "{table_name}"')
            ).scalar() or 0

        # Load up to 50 000 rows for profiling (avoids OOM on huge tables)
        df = pd.read_sql(
            f'SELECT * FROM "{table_name}" LIMIT 50000',
            engine
        )

        columns_profile = []
        for col in df.columns:
            try:
                cp = _profile_column(df[col])
                cp["column"] = col
                columns_profile.append(cp)
            except Exception as exc:
                logger.warning(f"[Profiler] Could not profile column '{col}': {exc}")
                columns_profile.append({"column": col, "error": str(exc)})

        profile = {
            "table":        table_name,
            "row_count":    int(row_count),
            "column_count": len(df.columns),
            "columns":      columns_profile,
            "profiled_at":  datetime.utcnow().isoformat(),
            "sampled":      row_count > 50000,
        }

        _set_cached(conn_str, table_name, profile)
        return profile

    finally:
        dm.close()


def profile_all_tables(conn_str: str) -> dict:
    """Profile every table in the database. Returns dict keyed by table name."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        tables = dm.list_tables()
    finally:
        dm.close()

    profiles = {}
    for table in tables:
        try:
            profiles[table] = profile_table(conn_str, table)
        except Exception as exc:
            logger.error(f"[Profiler] Failed to profile table '{table}': {exc}")
            profiles[table] = {"table": table, "error": str(exc)}
    return profiles


def profile_to_prompt_block(profile: dict) -> str:
    """
    Convert a table profile into a concise text block suitable for injection
    into an LLM prompt as schema context.
    """
    lines = [
        f"Table: {profile['table']}  ({profile['row_count']:,} rows, {profile['column_count']} columns)",
    ]
    for col in profile.get("columns", []):
        if "error" in col:
            lines.append(f"  {col['column']}: [error profiling]")
            continue
        parts = [f"  {col['column']} ({col['dtype']})"]
        parts.append(f"nulls={col['null_pct']}%")
        parts.append(f"distinct={col['distinct_count']}")
        if "mean" in col:
            parts.append(f"range=[{col.get('min')}, {col.get('max')}] mean={col.get('mean')}")
        elif "top_values" in col and col["top_values"]:
            top_str = ", ".join(str(v[0]) for v in col["top_values"][:3])
            parts.append(f"top=[{top_str}]")
        lines.append("  ".join(parts))
    return "\n".join(lines)