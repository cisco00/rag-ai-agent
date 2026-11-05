"""
federation.py — Cross-database query federation for Vantage AI.

When a user asks an AI query that spans two or more connected databases
(e.g. "join our Postgres CRM with the MySQL warehouse"), this module:

  1. Reads the requested secondary data sources by ID.
  2. Pulls each source's tables into pandas DataFrames (capped at 100 k rows).
  3. Pushes them into the *primary* SQLAlchemy connection as temporary tables
     with a prefixed name (e.g.  "src2__orders",  "src3__customers").
  4. Returns an enriched system-prompt addendum that tells the AI about the
     extra tables and which real database they come from.
  5. Provides a cleanup function to drop those temp tables when the query ends.

The design is intentionally simple: rather than a full query-planner or
DuckDB-based federation, we materialise only what is needed into the primary
connection session so the existing AnalyticsAgent can run SQL against a
*single* connection as normal.

Supported source types that expose a connection_string in connection_details:
  - 'database'  — arbitrary SQLAlchemy-compatible URL
  - 'postgres'  / 'postgresql'
  - 'mysql'
  - 'sqlite'
  - 'mssql'

For 'upload' / 'api' sources whose data already lives in the org's primary DB
the tables are already queryable and no federation is needed.
"""

import json
import logging
import re
from typing import List, Optional, Tuple

import pandas as pd
from sqlalchemy import text

from database import DatabaseManager
from models import DataSource, get_db

logger = logging.getLogger(__name__)

# Hard row cap per secondary table to avoid OOM during federation
_MAX_ROWS = 100_000


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_prefix(name: str) -> str:
    """Turn a data-source name into a safe SQL identifier prefix."""
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name).strip("_").lower()
    return (cleaned[:30] or "src") + "__"


def _fetch_source_tables(conn_str: str) -> List[str]:
    """Return all table names in a remote database (read-only probe)."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        dialect = dm.get_engine().dialect.name
        with dm.get_engine().connect() as conn:
            if dialect == "sqlite":
                rows = conn.execute(text(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )).fetchall()
            elif dialect in ("postgresql", "postgres"):
                rows = conn.execute(text(
                    "SELECT tablename FROM pg_catalog.pg_tables "
                    "WHERE schemaname NOT IN ('pg_catalog','information_schema')"
                )).fetchall()
            elif dialect == "mysql":
                rows = conn.execute(text("SHOW TABLES")).fetchall()
            elif dialect == "mssql":
                rows = conn.execute(text(
                    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_TYPE='BASE TABLE'"
                )).fetchall()
            else:
                rows = []
        return [r[0] for r in rows]
    except Exception as exc:
        logger.warning(f"[federation] Could not list tables from {conn_str[:40]}…: {exc}")
        return []
    finally:
        dm.close()


def _load_table_df(conn_str: str, table_name: str) -> Optional[pd.DataFrame]:
    """Load up to _MAX_ROWS from a remote table into a DataFrame."""
    dm = DatabaseManager(connection_string=conn_str)
    try:
        dialect = dm.get_engine().dialect.name
        q_table = f'"{table_name}"'
        if dialect == "mysql":
            q_table = f"`{table_name}`"
        df = pd.read_sql(
            f"SELECT * FROM {q_table} LIMIT {_MAX_ROWS}",
            dm.get_engine(),
        )
        return df
    except Exception as exc:
        logger.warning(f"[federation] Failed to load table {table_name!r}: {exc}")
        return None
    finally:
        dm.close()


# ── Main API ──────────────────────────────────────────────────────────────────

class FederationSession:
    """
    Context that materialises secondary-source tables into the primary DB
    under temp-table names, then cleans them up on close.
    """

    def __init__(self):
        self._temp_tables: List[Tuple[str, str]] = []  # [(primary_conn_str, table_name)]
        self.schema_addendum: str = ""

    def setup(
        self,
        primary_conn_str: str,
        secondary_sources: List[DataSource],
    ) -> None:
        """
        Load tables from each secondary source into the primary DB.
        Populates self.schema_addendum with a system-prompt block.
        """
        if not secondary_sources:
            return

        primary_dm = DatabaseManager(connection_string=primary_conn_str)
        primary_engine = primary_dm.get_engine()
        addendum_lines: List[str] = [
            "\n\n## FEDERATED DATA SOURCES",
            "The following tables have been loaded from secondary databases and are "
            "available in the current connection with the prefix shown. You can JOIN "
            "them with any primary tables.\n",
        ]

        for src in secondary_sources:
            conn_str = _get_conn_str(src)
            if not conn_str:
                logger.warning(f"[federation] Source {src.id} ({src.name!r}) has no connection string — skipped")
                continue

            prefix = _safe_prefix(src.name)
            source_tables = _fetch_source_tables(conn_str)

            if not source_tables:
                logger.info(f"[federation] Source {src.id} has no tables")
                continue

            loaded_names: List[str] = []
            for tbl in source_tables:
                df = _load_table_df(conn_str, tbl)
                if df is None or df.empty:
                    continue
                temp_name = f"{prefix}{tbl}"[:63]  # stay within typical identifier limits
                try:
                    df.to_sql(temp_name, primary_engine, if_exists="replace", index=False)
                    self._temp_tables.append((primary_conn_str, temp_name))
                    loaded_names.append(temp_name)
                    logger.info(f"[federation] Materialised {src.name!r} → {temp_name!r} ({len(df)} rows)")
                except Exception as exc:
                    logger.warning(f"[federation] Could not write {temp_name!r}: {exc}")

            if loaded_names:
                addendum_lines.append(
                    f"### Source: {src.name} (type: {src.source_type})\n"
                    + "\n".join(f"  - `{n}`" for n in loaded_names)
                )

        primary_dm.close()
        self.schema_addendum = "\n".join(addendum_lines) if len(addendum_lines) > 2 else ""

    def close(self, primary_conn_str: str) -> None:
        """Drop all materialised temp tables from the primary connection."""
        if not self._temp_tables:
            return
        try:
            dm = DatabaseManager(connection_string=primary_conn_str)
            with dm.get_engine().connect() as conn:
                with conn.begin():
                    for _, temp_name in self._temp_tables:
                        try:
                            conn.execute(text(f'DROP TABLE IF EXISTS "{temp_name}"'))
                        except Exception as exc:
                            logger.debug(f"[federation] DROP {temp_name!r} failed (non-fatal): {exc}")
            dm.close()
        except Exception as exc:
            logger.warning(f"[federation] cleanup error (non-fatal): {exc}")
        self._temp_tables.clear()


def _get_conn_str(src: DataSource) -> Optional[str]:
    """
    Extract a SQLAlchemy connection string from a DataSource.
    Returns None if the source is not a remote database.
    """
    if src.source_type in ("upload", "api"):
        # Data already lives in the org's primary DB; skip
        return None

    details: dict = {}
    if src.connection_details:
        try:
            details = json.loads(src.connection_details)
        except Exception:
            pass

    # Explicit connection string takes priority
    for key in ("connection_string", "conn_str", "url", "database_url"):
        if details.get(key):
            return details[key]

    # Build from components (MySQL / Postgres)
    db_type = src.source_type.lower()
    host    = details.get("host", "localhost")
    port    = details.get("port", "")
    db_name = details.get("database", details.get("db", ""))
    user    = details.get("user", details.get("username", ""))
    pw      = details.get("password", "")

    if not db_name:
        return None

    port_str = f":{port}" if port else ""
    if db_type in ("postgres", "postgresql"):
        return f"postgresql://{user}:{pw}@{host}{port_str}/{db_name}"
    elif db_type == "mysql":
        return f"mysql+pymysql://{user}:{pw}@{host}{port_str}/{db_name}"
    elif db_type == "sqlite":
        return f"sqlite:///{db_name}"
    elif db_type == "mssql":
        return f"mssql+pyodbc://{user}:{pw}@{host}{port_str}/{db_name}?driver=ODBC+Driver+17+for+SQL+Server"
    return None


def load_secondary_sources(org_id: int, source_ids: List[int]) -> List[DataSource]:
    """Fetch DataSource objects from the platform DB, filtered to this org."""
    if not source_ids:
        return []
    with get_db() as db:
        sources = db.query(DataSource).filter(
            DataSource.org_id == org_id,
            DataSource.id.in_(source_ids),
            DataSource.is_active == 1,
        ).all()
        for s in sources:
            db.expunge(s)
        return sources
