"""
audit_log.py — Data Lineage & Audit Trail — Feature #11

Every AI query execution is logged to `query_audit_log`.  From those logs we
can reconstruct:

  • An audit trail: who ran what query, when, how long it took, did it succeed
  • Data lineage: which tables have been read/written by which users/roles

Schema
──────
query_audit_log
  id            PK
  org_id        FK
  user_id       INTEGER (0 = anonymous / API key)
  user_email    TEXT
  user_role     TEXT
  question      TEXT     — natural-language question posed to the AI
  sql_query     TEXT     — SQL generated and executed
  tables_used   TEXT     — JSON array of table names found in the SQL
  status        TEXT     — 'success' | 'error'
  error_message TEXT     — populated on status='error'
  row_count     INTEGER  — rows returned (NULL if error / streaming)
  duration_ms   INTEGER  — wall-clock time in milliseconds
  created_at    TIMESTAMP

table_lineage  (materialised summary — rebuilt on each insert)
  org_id        INTEGER
  table_name    TEXT
  last_accessed TIMESTAMP
  access_count  INTEGER
  accessing_users TEXT   — JSON array of unique user emails
  PRIMARY KEY (org_id, table_name)
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from models import admin_engine

logger = logging.getLogger(__name__)


# ── Schema ─────────────────────────────────────────────────────────────────────

def ensure_audit_tables() -> None:
    """Create audit tables if they don't exist (idempotent)."""
    with admin_engine.begin() as conn:
        dialect = admin_engine.dialect.name

        if dialect == "sqlite":
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS query_audit_log (
                    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
                    org_id        INTEGER  NOT NULL,
                    user_id       INTEGER  DEFAULT 0,
                    user_email    TEXT     DEFAULT '',
                    user_role     TEXT     DEFAULT '',
                    question      TEXT,
                    sql_query     TEXT,
                    tables_used   TEXT,    -- JSON array
                    status        TEXT     NOT NULL DEFAULT 'success',
                    error_message TEXT,
                    row_count     INTEGER,
                    duration_ms   INTEGER,
                    created_at    TEXT     DEFAULT (datetime('now'))
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS table_lineage (
                    org_id          INTEGER NOT NULL,
                    table_name      TEXT    NOT NULL,
                    last_accessed   TEXT,
                    access_count    INTEGER DEFAULT 0,
                    accessing_users TEXT,   -- JSON array
                    PRIMARY KEY (org_id, table_name)
                )
            """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS query_audit_log (
                    id            SERIAL   PRIMARY KEY,
                    org_id        INTEGER  NOT NULL,
                    user_id       INTEGER  DEFAULT 0,
                    user_email    TEXT     DEFAULT '',
                    user_role     TEXT     DEFAULT '',
                    question      TEXT,
                    sql_query     TEXT,
                    tables_used   TEXT,
                    status        TEXT     NOT NULL DEFAULT 'success',
                    error_message TEXT,
                    row_count     INTEGER,
                    duration_ms   INTEGER,
                    created_at    TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS table_lineage (
                    org_id          INTEGER NOT NULL,
                    table_name      TEXT    NOT NULL,
                    last_accessed   TIMESTAMP,
                    access_count    INTEGER DEFAULT 0,
                    accessing_users TEXT,
                    PRIMARY KEY (org_id, table_name)
                )
            """))

        # Indexes
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS idx_qal_org_created ON query_audit_log(org_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_qal_user ON query_audit_log(org_id, user_id)",
        ]:
            try:
                conn.execute(text(idx_sql))
            except Exception:
                pass


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_tables(sql: str) -> list[str]:
    """Extract table names from SQL (same logic as data_permissions)."""
    pattern = r'(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?'
    return list({m.lower() for m in re.findall(pattern, sql, re.IGNORECASE)})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Write ──────────────────────────────────────────────────────────────────────

def log_query(
    *,
    org_id: int,
    user_id: int = 0,
    user_email: str = "",
    user_role: str = "",
    question: str = "",
    sql_query: str = "",
    status: str = "success",
    error_message: Optional[str] = None,
    row_count: Optional[int] = None,
    duration_ms: Optional[int] = None,
) -> None:
    """
    Insert one row into query_audit_log and upsert table_lineage.
    Called fire-and-forget from the query route — never raises.
    """
    try:
        tables = _extract_tables(sql_query) if sql_query else []
        tables_json = json.dumps(tables)

        with admin_engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO query_audit_log
                        (org_id, user_id, user_email, user_role, question,
                         sql_query, tables_used, status, error_message,
                         row_count, duration_ms)
                    VALUES
                        (:oid, :uid, :uemail, :urole, :q,
                         :sql, :tables, :status, :errmsg,
                         :rows, :dur)
                """),
                {
                    "oid": org_id, "uid": user_id, "uemail": user_email,
                    "urole": user_role, "q": question, "sql": sql_query,
                    "tables": tables_json, "status": status,
                    "errmsg": error_message, "rows": row_count, "dur": duration_ms,
                },
            )

            # Upsert lineage for every table touched
            for tbl in tables:
                _upsert_lineage(conn, org_id, tbl, user_email)

    except Exception as e:
        logger.warning(f"audit log write failed (non-fatal): {e}")


def _upsert_lineage(conn, org_id: int, table_name: str, user_email: str) -> None:
    """Increment lineage counters for one table."""
    dialect = admin_engine.dialect.name
    now = _now_iso()

    row = conn.execute(
        text("SELECT access_count, accessing_users FROM table_lineage WHERE org_id = :oid AND table_name = :tbl"),
        {"oid": org_id, "tbl": table_name},
    ).fetchone()

    if row:
        count = (row[0] or 0) + 1
        try:
            users = set(json.loads(row[1] or "[]"))
        except Exception:
            users = set()
        if user_email:
            users.add(user_email)
        conn.execute(
            text("""
                UPDATE table_lineage
                SET access_count = :cnt, last_accessed = :ts, accessing_users = :u
                WHERE org_id = :oid AND table_name = :tbl
            """),
            {"cnt": count, "ts": now, "u": json.dumps(sorted(users)),
             "oid": org_id, "tbl": table_name},
        )
    else:
        users_json = json.dumps([user_email] if user_email else [])
        conn.execute(
            text("""
                INSERT INTO table_lineage (org_id, table_name, last_accessed, access_count, accessing_users)
                VALUES (:oid, :tbl, :ts, 1, :u)
            """),
            {"oid": org_id, "tbl": table_name, "ts": now, "u": users_json},
        )


# ── Read ───────────────────────────────────────────────────────────────────────

def get_audit_logs(
    org_id: int,
    limit: int = 100,
    offset: int = 0,
    user_id: Optional[int] = None,
    status: Optional[str] = None,
    table_name: Optional[str] = None,
) -> dict:
    """Return paginated audit log entries with total count."""
    filters = ["org_id = :oid"]
    params: dict = {"oid": org_id, "limit": limit, "offset": offset}

    if user_id is not None:
        filters.append("user_id = :uid")
        params["uid"] = user_id
    if status:
        filters.append("status = :status")
        params["status"] = status
    if table_name:
        # JSON array contains — works for both SQLite and Postgres with simple LIKE
        filters.append("tables_used LIKE :tbl")
        params["tbl"] = f'%"{table_name}"%'

    where = " AND ".join(filters)

    with admin_engine.connect() as conn:
        total = conn.execute(
            text(f"SELECT COUNT(*) FROM query_audit_log WHERE {where}"),
            params,
        ).scalar() or 0

        rows = conn.execute(
            text(f"""
                SELECT id, user_id, user_email, user_role, question,
                       sql_query, tables_used, status, error_message,
                       row_count, duration_ms, created_at
                FROM query_audit_log
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        ).fetchall()

    entries = []
    for r in rows:
        d = dict(r._mapping)
        try:
            d["tables_used"] = json.loads(d["tables_used"] or "[]")
        except Exception:
            d["tables_used"] = []
        entries.append(d)

    return {"total": total, "entries": entries}


def get_lineage(org_id: int) -> list[dict]:
    """Return all table lineage records for the org, sorted by access count."""
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT table_name, last_accessed, access_count, accessing_users
                FROM table_lineage
                WHERE org_id = :oid
                ORDER BY access_count DESC
            """),
            {"oid": org_id},
        ).fetchall()

    result = []
    for r in rows:
        d = dict(r._mapping)
        try:
            d["accessing_users"] = json.loads(d["accessing_users"] or "[]")
        except Exception:
            d["accessing_users"] = []
        result.append(d)
    return result


def get_table_lineage(org_id: int, table_name: str) -> Optional[dict]:
    """Return lineage for a single table."""
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT table_name, last_accessed, access_count, accessing_users
                FROM table_lineage
                WHERE org_id = :oid AND table_name = :tbl
            """),
            {"oid": org_id, "tbl": table_name},
        ).fetchone()
    if not row:
        return None
    d = dict(row._mapping)
    try:
        d["accessing_users"] = json.loads(d["accessing_users"] or "[]")
    except Exception:
        d["accessing_users"] = []
    return d
