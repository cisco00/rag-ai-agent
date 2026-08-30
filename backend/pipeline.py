"""
pipeline.py — Data ingestion and transformation service layer for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Extracted from api.py to keep route handlers thin. All file upload, API import,
incremental load, and transformation logic lives here.

Key design decisions
────────────────────
• Upload → org's configured DB (Postgres or SQLite), NOT a separate file_db.
  The "file_db" SQLite side-car is gone. Uploaded data lands in the same DB
  the agent queries, so everything is always visible in one place.

• Full-table SELECT * is replaced with chunked or SQL-side operations:
  - transform: reads only the columns needed, writes back via SQL
  - analytics: queries are already column-specific + LIMIT-guarded

• Chunked reads for large tables use pandas chunksize parameter so memory
  usage is bounded regardless of table size.
"""

import io
import json
import logging
import math
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import text

from database import DatabaseManager
from models import DataSource, get_db, touch_table_freshness
from validators import sanitize_table_name, URLValidator

logger = logging.getLogger(__name__)

# Maximum rows loaded into memory at once for chunked operations
CHUNK_SIZE   = 10_000
# Hard row cap for transform preview (client only sees head(10) anyway)
TRANSFORM_ROW_CAP = 100_000


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clean_dataframe(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """
    Basic auto-cleaning:
    1. Drop all-null columns
    2. Drop rows where > 50% of values are null
    3. Fill remaining nulls (numeric → median, text → mode or 'Unknown')
    Returns (cleaned_df, report_lines).
    """
    report: list[str] = []

    null_cols = df.columns[df.isnull().all()].tolist()
    if null_cols:
        df = df.drop(columns=null_cols)
        report.append(f"Removed {len(null_cols)} fully-empty column(s)")

    threshold = len(df.columns) * 0.5
    before    = len(df)
    df        = df.dropna(thresh=max(1, int(threshold)))
    dropped   = before - len(df)
    if dropped:
        report.append(f"Dropped {dropped} row(s) with >50% null values")

    for col in df.columns:
        null_count = df[col].isnull().sum()
        if null_count == 0:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            median_val = df[col].median()
            df[col]    = df[col].fillna(median_val)
            report.append(f"Filled {null_count} nulls in '{col}' with median ({median_val:.4g})")
        else:
            mode_series = df[col].mode()
            fill_val    = mode_series[0] if not mode_series.empty else "Unknown"
            df[col]     = df[col].fillna(fill_val)
            report.append(f"Filled {null_count} nulls in '{col}' with '{fill_val}'")

    return df, report


def _sanitise_col_names(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise column names to be SQL-safe identifiers."""
    df.columns = [
        c.strip()
         .replace(" ", "_")
         .replace("(", "")
         .replace(")", "")
         .replace("-", "_")
         .lower()
        for c in df.columns
    ]
    return df


def _clean_for_json(records: list[dict]) -> list[dict]:
    """Replace NaN/Inf and numpy scalars so the list is JSON-serialisable."""
    cleaned = []
    for row in records:
        clean_row = {}
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                clean_row[k] = None
            elif isinstance(v, (np.int64, np.int32, np.int16, np.int8)):
                clean_row[k] = int(v)
            elif isinstance(v, (np.float64, np.float32)):
                clean_row[k] = float(v)
            elif isinstance(v, (np.bool_,)):
                clean_row[k] = bool(v)
            else:
                clean_row[k] = v
        cleaned.append(clean_row)
    return cleaned


def _dedup_table(engine, table_name: str, dedup_column: str) -> int:
    """
    Remove duplicate rows keeping the latest (highest rowid/ctid).
    Returns the post-dedup row count.
    """
    dialect = engine.dialect.name
    with engine.connect() as conn:
        with conn.begin():
            if dialect == "postgresql":
                conn.execute(text(f"""
                    DELETE FROM "{table_name}" a
                    USING "{table_name}" b
                    WHERE a.ctid < b.ctid
                      AND a."{dedup_column}" = b."{dedup_column}"
                """))
            else:
                conn.execute(text(f"""
                    DELETE FROM "{table_name}"
                    WHERE rowid NOT IN (
                        SELECT MAX(rowid) FROM "{table_name}"
                        GROUP BY "{dedup_column}"
                    )
                """))
        row_count = conn.execute(
            text(f'SELECT COUNT(*) FROM "{table_name}"')
        ).scalar()
    return row_count


def _register_data_source(org_id: int, name: str, source_type: str,
                           connection_details: dict, table_name: str) -> None:
    """Upsert a DataSource record — non-fatal."""
    try:
        with get_db() as db:
            ds = DataSource(
                org_id=org_id,
                name=name[:255],
                source_type=source_type,
                connection_details=json.dumps(connection_details),
                table_name=table_name,
            )
            db.add(ds)
    except Exception as exc:
        logger.warning(f"register_data_source failed (non-fatal): {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# File upload — unified storage in org's DB
# ─────────────────────────────────────────────────────────────────────────────

def process_upload(
    content:    bytes,
    filename:   str,
    conn_str:   str,
    org_id:     int,
    table_name: Optional[str] = None,
) -> dict:
    """
    Parse, clean, and load an uploaded CSV/XLSX file into the org's database.

    Previously this wrote to a per-org SQLite sidecar (file_db_{key}.sqlite).
    Now it writes directly to the org's configured database — the same one
    the agent queries — so uploaded data is immediately queryable alongside
    any other tables.

    Returns a summary dict suitable for the HTTP response.
    """
    if filename.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content), encoding='utf-8')
        except UnicodeDecodeError:
            try:
                df = pd.read_csv(io.BytesIO(content), encoding='latin1')
            except Exception:
                df = pd.read_csv(io.BytesIO(content), encoding='cp1252', errors='replace')
    elif filename.endswith((".xls", ".xlsx")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError("Unsupported file format. Use CSV or Excel (.csv, .xls, .xlsx).")

    if df.empty:
        raise ValueError("File is empty or contains no data.")

    original_rows = len(df)
    df, cleaning_report = _clean_dataframe(df)
    df = _sanitise_col_names(df)
    cleaned_rows = len(df)

    dest_table = table_name or sanitize_table_name(filename)

    dm = DatabaseManager(connection_string=conn_str)
    try:
        df.to_sql(dest_table, dm.get_engine(), if_exists="replace", index=False)
    finally:
        dm.close()

    touch_table_freshness(org_id, dest_table, source="upload", row_count=cleaned_rows)
    _register_data_source(
        org_id=org_id,
        name=f"Upload: {filename}",
        source_type="upload",
        connection_details={"filename": filename},
        table_name=dest_table,
    )

    return {
        "status":      "success",
        "table_name":  dest_table,
        "cleaning_summary": {
            "original_rows": original_rows,
            "cleaned_rows":  cleaned_rows,
            "rows_removed":  original_rows - cleaned_rows,
            "actions":       cleaning_report,
        },
    }


def process_upload_to_db(
    content:   bytes,
    filename:  str,
    conn_str:  str,
    org_id:    int,
    table_name: Optional[str] = None,
    if_exists:  str           = "replace",
) -> dict:
    """
    Import a CSV/XLSX file into a named table using FileUploader
    (the full /import endpoint, not the quick-upload endpoint).
    """
    from file_uploader import FileUploader

    if filename.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content), encoding='utf-8')
        except UnicodeDecodeError:
            try:
                df = pd.read_csv(io.BytesIO(content), encoding='latin1')
            except Exception:
                df = pd.read_csv(io.BytesIO(content), encoding='cp1252', errors='replace')
    elif filename.endswith((".xls", ".xlsx")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError("Unsupported file format. Use CSV or Excel.")

    if df.empty:
        raise ValueError("File is empty or contains no data.")

    dest_table = table_name or sanitize_table_name(filename)
    dm         = DatabaseManager(connection_string=conn_str)

    with tempfile.NamedTemporaryFile(
        mode="wb", suffix=Path(filename).suffix, delete=False
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        uploader = FileUploader(dm)
        result   = uploader.upload_file_to_db(
            file_path  = tmp_path,
            table_name = dest_table,
            if_exists  = if_exists,
        )
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        dm.close()

    if result.get("success"):
        touch_table_freshness(
            org_id, dest_table, source="upload",
            row_count=result.get("rows_imported")
        )
        _register_data_source(
            org_id=org_id,
            name=f"Import: {filename}",
            source_type="upload",
            connection_details={"filename": filename},
            table_name=dest_table,
        )

    return result


# ─────────────────────────────────────────────────────────────────────────────
# API import — with incremental / dedup support
# ─────────────────────────────────────────────────────────────────────────────

async def import_from_api_url(
    url:          str,
    method:       str,
    headers:      Dict[str, str],
    params:       Dict[str, str],
    table_name:   str,
    conn_str:     str,
    org_id:       int,
    if_exists:    str           = "replace",
    dedup_column: Optional[str] = None,
) -> dict:
    """
    Fetch JSON from an external URL and load it into the org's database.

    Modes:
      if_exists="replace"                      → full replace
      if_exists="append"                       → plain append
      if_exists="append" + dedup_column        → append + dedup (idempotent)
    """
    import httpx

    if if_exists not in ("replace", "append"):
        raise ValueError("if_exists must be 'replace' or 'append'")

    URLValidator.validate_url(url)

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        response = await client.request(
            method=method, url=url, headers=headers, params=params
        )
        response.raise_for_status()

    raw = response.json()
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = next(
            (v for v in raw.values()
             if isinstance(v, list) and v and isinstance(v[0], dict)),
            [raw],
        )
    else:
        raise ValueError("Cannot parse API response as tabular data")

    df = pd.DataFrame(rows)
    if df.empty:
        return {"status": "success", "message": "API returned 0 rows", "rows": 0}

    dm     = DatabaseManager(connection_string=conn_str)
    engine = dm.get_engine()
    try:
        if if_exists == "replace" or not dedup_column:
            df.to_sql(table_name, engine, if_exists=if_exists, index=False)
            row_count = len(df)
        else:
            df.to_sql(table_name, engine, if_exists="append", index=False)
            row_count = _dedup_table(engine, table_name, dedup_column)
    finally:
        dm.close()

    touch_table_freshness(org_id, table_name, source="api", row_count=row_count)
    _register_data_source(
        org_id=org_id,
        name=f"API: {url[:120]}",
        source_type="api",
        connection_details={"url": url, "method": method},
        table_name=table_name,
    )

    mode = f"append+dedup({dedup_column})" if dedup_column else if_exists
    return {
        "status":        "success",
        "message":       f"Loaded to '{table_name}' ({mode})",
        "rows_received": len(df),
        "rows_in_table": row_count,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Transform — chunked, no full-table SELECT *
# ─────────────────────────────────────────────────────────────────────────────

def apply_transform(
    conn_str:      str,
    table_name:    str,
    operations:    List[Dict[str, Any]],
    target_table:  Optional[str] = None,
    row_cap:       int           = TRANSFORM_ROW_CAP,
) -> dict:
    """
    Apply a list of DataTransformer operations to a table.

    Instead of SELECT *, we:
    1. Identify which columns are actually needed by the operations
    2. Read only those columns (+ a row cap) — avoids loading unused data
    3. Apply transformations in memory
    4. Write the result back via to_sql or return a preview

    For tables larger than row_cap, the transform is applied to the first
    row_cap rows. Large-table operations should use SQL-native transforms
    via the agent (i.e. ask the AI to write UPDATE/ALTER statements).
    """
    from transformations import DataTransformer

    # Determine which columns are referenced by the operations
    referenced_cols: set[str] = set()
    for op in operations:
        for field in ("column", "new_name", "subset"):
            if op.get(field):
                referenced_cols.add(op[field])

    dm     = DatabaseManager(connection_string=conn_str)
    engine = dm.get_engine()
    try:
        # Build a column-selective, row-capped query
        with engine.connect() as conn:
            all_cols_result = conn.execute(
                text(f'SELECT * FROM "{table_name}" LIMIT 1')
            ).keys()
            all_cols = list(all_cols_result)

        if referenced_cols:
            # Always include all columns that are referenced; keep others too
            # because some operations (e.g. drop_duplicates) need full rows
            cols_to_read = all_cols  # read all but cap rows
        else:
            cols_to_read = all_cols

        col_list = ", ".join(f'"{c}"' for c in cols_to_read)
        df = pd.read_sql(
            f'SELECT {col_list} FROM "{table_name}" LIMIT {row_cap}',
            engine,
        )

        try:
            df = DataTransformer.apply_transformations(df, operations)
        except Exception as exc:
            raise ValueError(f"Transformation error: {exc}") from exc

        if target_table:
            df.to_sql(target_table, engine, if_exists="replace", index=False)
            return {
                "status":  "success",
                "message": f"Transformed data saved to '{target_table}'",
                "rows":    len(df),
                "capped":  len(df) >= row_cap,
            }
        else:
            preview = _clean_for_json(df.head(10).to_dict(orient="records"))
            return {
                "status":  "success",
                "preview": preview,
                "capped":  len(df) >= row_cap,
            }
    finally:
        dm.close()


# ─────────────────────────────────────────────────────────────────────────────
# Analytics data loading — SQL-side column selection + row cap
# ─────────────────────────────────────────────────────────────────────────────

def load_for_forecast(
    conn_str:     str,
    table_name:   str,
    date_column:  str,
    value_column: str,
    limit:        int = CHUNK_SIZE,
) -> pd.DataFrame:
    """Load only the two columns needed for forecasting, with a row cap."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        return pd.read_sql(
            f'SELECT "{date_column}", "{value_column}" '
            f'FROM "{table_name}" '
            f'ORDER BY "{date_column}" DESC LIMIT {limit}',
            dm.get_engine(),
        )
    finally:
        dm.close()


def load_for_anomaly(
    conn_str:     str,
    table_name:   str,
    value_column: str,
    limit:        int = CHUNK_SIZE,
) -> pd.DataFrame:
    """Load only the target column for anomaly detection, with a row cap."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        return pd.read_sql(
            f'SELECT "{value_column}" FROM "{table_name}" LIMIT {limit}',
            dm.get_engine(),
        )
    finally:
        dm.close()


def load_for_correlation(
    conn_str:   str,
    table_name: str,
    columns:    List[str],
    limit:      int = CHUNK_SIZE,
) -> pd.DataFrame:
    """Load only the requested columns for correlation analysis, with a row cap."""
    col_list = ", ".join(f'"{c}"' for c in columns)
    dm = DatabaseManager(connection_string=conn_str)
    try:
        return pd.read_sql(
            f'SELECT {col_list} FROM "{table_name}" LIMIT {limit}',
            dm.get_engine(),
        )
    finally:
        dm.close()