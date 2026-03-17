"""
profiler.py — Column-level data profiling for Vantage AI
────────────────────────────────────────────────────────────────────────────────
For each column in a table, computes:
  - null_count / null_pct
  - distinct_count (and is_unique flag)
  - For numerics:  min, max, mean, median (approx), std_dev, p25, p75
  - For text:      min_length, max_length, avg_length, top_5_values
  - For dates:     min_date, max_date, date_range_days
  - data_type (as reported by the DB)
  - sample (3 non-null values)

Design goals:
  - All aggregations run IN the database (no SELECT * loads into memory)
  - Each column uses one SQL query — no full table scans with pandas
  - Results are cached per (conn_str_hash, table_name) for 10 minutes
  - Profile is injected into the agent system prompt for richer context
  - Also exposed via GET /tables/{table}/profile endpoint

Storage: in-process dict cache (no DB persistence — profiles are cheap to recompute).
"""

import hashlib
import time
from typing import Any, Optional

from sqlalchemy import text, inspect

from database import DatabaseManager
from logging_config import get_logger

logger = get_logger(__name__)

# ─── Cache ────────────────────────────────────────────────────────────────────
_PROFILE_CACHE: dict[str, tuple[float, dict]] = {}
PROFILE_CACHE_TTL = 600  # 10 minutes


def _cache_key(conn_str: str, table_name: str) -> str:
    h = hashlib.sha256(conn_str.encode()).hexdigest()[:16]
    return f"{h}:{table_name}"


def _get_cached(conn_str: str, table_name: str) -> Optional[dict]:
    key = _cache_key(conn_str, table_name)
    if key in _PROFILE_CACHE:
        ts, data = _PROFILE_CACHE[key]
        if time.time() - ts < PROFILE_CACHE_TTL:
            return data
    return None


def _set_cached(conn_str: str, table_name: str, data: dict):
    _PROFILE_CACHE[_cache_key(conn_str, table_name)] = (time.time(), data)


def invalidate_profile_cache(conn_str: str, table_name: str):
    _PROFILE_CACHE.pop(_cache_key(conn_str, table_name), None)


# ─── Type detection ───────────────────────────────────────────────────────────

_NUMERIC_AFFINITIES = {
    "int", "integer", "bigint", "smallint", "tinyint", "mediumint",
    "float", "real", "double", "numeric", "decimal", "number",
    "serial", "bigserial",
}

_DATE_AFFINITIES = {
    "date", "datetime", "timestamp", "timestamptz", "time",
}


def _col_kind(col_type: str) -> str:
    t = col_type.lower().split("(")[0].strip()
    if any(a in t for a in _NUMERIC_AFFINITIES):
        return "numeric"
    if any(a in t for a in _DATE_AFFINITIES):
        return "date"
    return "text"


# ─── Per-column SQL profilers ─────────────────────────────────────────────────

def _profile_numeric(conn, table: str, col: str, dialect: str, total_rows: int) -> dict:
    q = f"""
        SELECT
            COUNT(*)                          AS total,
            COUNT("{col}")                    AS non_null,
            MIN("{col}")                      AS min_val,
            MAX("{col}")                      AS max_val,
            AVG("{col}")                      AS mean_val,
            COUNT(DISTINCT "{col}")           AS distinct_count
        FROM "{table}"
    """
    row = conn.execute(text(q)).mappings().first()
    if not row:
        return {}

    non_null      = row["non_null"]    or 0
    null_count    = total_rows - non_null
    distinct_count= row["distinct_count"] or 0

    result = {
        "null_count":    null_count,
        "null_pct":      round(null_count / total_rows * 100, 2) if total_rows else 0,
        "distinct_count":distinct_count,
        "is_unique":     distinct_count == non_null and non_null > 0,
        "min":           _safe_float(row["min_val"]),
        "max":           _safe_float(row["max_val"]),
        "mean":          _safe_float(row["mean_val"]),
    }

    # Percentiles — dialect specific
    try:
        if dialect == "postgresql":
            pct_row = conn.execute(text(f"""
                SELECT
                    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "{col}") AS p25,
                    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "{col}") AS median,
                    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "{col}") AS p75,
                    STDDEV("{col}") AS std_dev
                FROM "{table}"
                WHERE "{col}" IS NOT NULL
            """)).mappings().first()
            if pct_row:
                result["p25"]    = _safe_float(pct_row["p25"])
                result["median"] = _safe_float(pct_row["median"])
                result["p75"]    = _safe_float(pct_row["p75"])
                result["std_dev"]= _safe_float(pct_row["std_dev"])
        else:
            # SQLite approximation using row offset
            if non_null > 0:
                for label, frac in [("p25", 0.25), ("median", 0.5), ("p75", 0.75)]:
                    offset = max(0, int(non_null * frac) - 1)
                    val    = conn.execute(text(f"""
                        SELECT "{col}" FROM "{table}"
                        WHERE "{col}" IS NOT NULL
                        ORDER BY "{col}" LIMIT 1 OFFSET {offset}
                    """)).scalar()
                    result[label] = _safe_float(val)
    except Exception as exc:
        logger.debug(f"[Profiler] Percentile calc failed for {col}: {exc}")

    # Sample values
    sample_rows = conn.execute(text(f"""
        SELECT DISTINCT "{col}" FROM "{table}"
        WHERE "{col}" IS NOT NULL LIMIT 3
    """)).fetchall()
    result["sample"] = [_safe_float(r[0]) for r in sample_rows]

    return result


def _profile_text(conn, table: str, col: str, total_rows: int) -> dict:
    row = conn.execute(text(f"""
        SELECT
            COUNT(*)                AS total,
            COUNT("{col}")          AS non_null,
            COUNT(DISTINCT "{col}") AS distinct_count
        FROM "{table}"
    """)).mappings().first()
    if not row:
        return {}

    non_null       = row["non_null"] or 0
    null_count     = total_rows - non_null
    distinct_count = row["distinct_count"] or 0

    result = {
        "null_count":    null_count,
        "null_pct":      round(null_count / total_rows * 100, 2) if total_rows else 0,
        "distinct_count":distinct_count,
        "is_unique":     distinct_count == non_null and non_null > 0,
    }

    # Top 5 values by frequency
    try:
        top = conn.execute(text(f"""
            SELECT "{col}" AS val, COUNT(*) AS cnt
            FROM "{table}"
            WHERE "{col}" IS NOT NULL
            GROUP BY "{col}"
            ORDER BY cnt DESC
            LIMIT 5
        """)).mappings().all()
        result["top_values"] = [{"value": r["val"], "count": r["cnt"]} for r in top]
    except Exception as exc:
        logger.debug(f"[Profiler] top_values failed for {col}: {exc}")

    # String length stats (where supported)
    try:
        len_row = conn.execute(text(f"""
            SELECT
                MIN(LENGTH("{col}"))     AS min_len,
                MAX(LENGTH("{col}"))     AS max_len,
                AVG(LENGTH("{col}"))     AS avg_len
            FROM "{table}" WHERE "{col}" IS NOT NULL
        """)).mappings().first()
        if len_row:
            result["min_length"] = len_row["min_len"]
            result["max_length"] = len_row["max_len"]
            result["avg_length"] = round(float(len_row["avg_len"]), 1) if len_row["avg_len"] else None
    except Exception as exc:
        logger.debug(f"[Profiler] length stats failed for {col}: {exc}")

    # Sample
    sample_rows = conn.execute(text(f"""
        SELECT DISTINCT "{col}" FROM "{table}"
        WHERE "{col}" IS NOT NULL LIMIT 3
    """)).fetchall()
    result["sample"] = [r[0] for r in sample_rows]

    return result


def _profile_date(conn, table: str, col: str, total_rows: int) -> dict:
    row = conn.execute(text(f"""
        SELECT
            COUNT(*)                AS total,
            COUNT("{col}")          AS non_null,
            COUNT(DISTINCT "{col}") AS distinct_count,
            MIN("{col}")            AS min_date,
            MAX("{col}")            AS max_date
        FROM "{table}"
    """)).mappings().first()
    if not row:
        return {}

    non_null   = row["non_null"] or 0
    null_count = total_rows - non_null

    result = {
        "null_count":    null_count,
        "null_pct":      round(null_count / total_rows * 100, 2) if total_rows else 0,
        "distinct_count":row["distinct_count"] or 0,
        "min_date":      str(row["min_date"]) if row["min_date"] else None,
        "max_date":      str(row["max_date"]) if row["max_date"] else None,
    }

    # Date range days
    if row["min_date"] and row["max_date"]:
        try:
            from dateutil.parser import parse as parse_dt
            diff = parse_dt(str(row["max_date"])) - parse_dt(str(row["min_date"]))
            result["date_range_days"] = diff.days
        except Exception:
            pass

    sample_rows = conn.execute(text(f"""
        SELECT DISTINCT "{col}" FROM "{table}"
        WHERE "{col}" IS NOT NULL LIMIT 3
    """)).fetchall()
    result["sample"] = [str(r[0]) for r in sample_rows]

    return result


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return round(float(val), 6)
    except (TypeError, ValueError):
        return None


# ─── Main profiler ────────────────────────────────────────────────────────────

def profile_table(conn_str: str, table_name: str, force: bool = False) -> dict:
    """
    Generate a column-by-column profile for table_name.
    All work is done in the DB — no full-table pandas reads.
    Results are cached for PROFILE_CACHE_TTL seconds.

    Returns:
        {
          "table": "orders",
          "total_rows": 142000,
          "column_count": 12,
          "profiled_at": "...",
          "columns": {
              "revenue": {
                  "data_type": "DOUBLE PRECISION",
                  "kind": "numeric",
                  "null_count": 0, "null_pct": 0,
                  "distinct_count": 9842, "is_unique": False,
                  "min": 0.5, "max": 9999.0, "mean": 145.3,
                  "median": 89.0, "p25": 40.0, "p75": 210.0,
                  "std_dev": 178.2,
                  "sample": [45.5, 120.0, 8.99]
              },
              ...
          }
        }
    """
    if not force:
        cached = _get_cached(conn_str, table_name)
        if cached:
            return cached

    dm = DatabaseManager(connection_string=conn_str)
    try:
        engine  = dm.get_engine()
        dialect = engine.dialect.name

        # Introspect column types
        insp    = inspect(engine)
        columns = insp.get_columns(table_name)
        if not columns:
            raise ValueError(f"Table '{table_name}' not found or has no columns.")

        with engine.connect() as conn:
            total_row = conn.execute(
                text(f'SELECT COUNT(*) AS n FROM "{table_name}"')
            ).scalar()
            total_rows = int(total_row or 0)

            col_profiles = {}
            for col_info in columns:
                col_name  = col_info["name"]
                col_type  = str(col_info["type"])
                kind      = _col_kind(col_type)

                try:
                    if kind == "numeric":
                        stats = _profile_numeric(conn, table_name, col_name, dialect, total_rows)
                    elif kind == "date":
                        stats = _profile_date(conn, table_name, col_name, total_rows)
                    else:
                        stats = _profile_text(conn, table_name, col_name, total_rows)

                    col_profiles[col_name] = {
                        "data_type": col_type,
                        "kind":      kind,
                        **stats,
                    }
                except Exception as exc:
                    logger.warning(f"[Profiler] Failed to profile col '{col_name}': {exc}")
                    col_profiles[col_name] = {
                        "data_type": col_type,
                        "kind":      kind,
                        "error":     str(exc),
                    }

        result = {
            "table":        table_name,
            "total_rows":   total_rows,
            "column_count": len(columns),
            "profiled_at":  __import__("datetime").datetime.utcnow().isoformat(),
            "columns":      col_profiles,
        }

        _set_cached(conn_str, table_name, result)
        return result

    finally:
        dm.close()


def profile_to_prompt_block(profile: dict) -> str:
    """
    Convert a profile dict into a compact block that can be injected into
    the agent system prompt for richer column-level awareness.
    """
    lines = [
        f"DATA PROFILE: {profile['table']} ({profile['total_rows']:,} rows)",
        "",
    ]
    for col, stats in profile.get("columns", {}).items():
        if "error" in stats:
            continue
        kind  = stats.get("kind", "text")
        parts = [f"  {col} [{stats.get('data_type', '')}]"]

        null_pct = stats.get("null_pct", 0)
        if null_pct > 0:
            parts.append(f"null={null_pct:.1f}%")

        if kind == "numeric":
            if stats.get("min") is not None:
                parts.append(f"range=[{stats['min']}, {stats['max']}]")
            if stats.get("mean") is not None:
                parts.append(f"mean={stats['mean']}")
        elif kind == "date":
            if stats.get("min_date"):
                parts.append(f"range=[{stats['min_date']} → {stats['max_date']}]")
        else:
            dc = stats.get("distinct_count", 0)
            if stats.get("is_unique"):
                parts.append("unique_id")
            elif dc <= 20:
                top = [v["value"] for v in stats.get("top_values", [])[:5]]
                if top:
                    parts.append(f"values={top}")
            else:
                parts.append(f"distinct={dc}")

        lines.append("  ".join(parts))

    return "\n".join(lines)


def profile_all_tables(conn_str: str) -> dict[str, dict]:
    """Profile all tables for an org. Returns {table_name: profile}."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        tables = dm.list_tables()
    finally:
        dm.close()

    results = {}
    for table in tables:
        try:
            results[table] = profile_table(conn_str, table)
        except Exception as exc:
            logger.warning(f"[Profiler] Skipped table '{table}': {exc}")
    return results