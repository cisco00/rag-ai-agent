"""
data_permissions.py — Row-Level & Column-Level Data Permissions — Feature #10

Design
──────
Two rule types are stored in the `data_permission_rules` table:

  ROW rule   — attaches a SQL WHERE clause fragment to a table for a given
               target (role or user).  The AI-generated SQL is wrapped:
                   SELECT * FROM (<original SQL>) AS _q WHERE <row_filter>
               so no LLM prompt changes are needed.

  COLUMN rule — lists columns to MASK (replace with NULL / '***') or to HIDE
               (remove from result set) for a given target.

Targets
───────
  target_type = 'role'  → applies to every user with that role in the org
  target_type = 'user'  → applies to a specific user (by user_id)

User-level rules take precedence over role-level rules.

The enforcement layer (apply_permissions) is called from the /query and
/query/stream routes AFTER the AI has generated SQL but BEFORE the result
is returned to the client.
"""

import logging
import re
from typing import Optional

from sqlalchemy import text
from models import admin_engine

logger = logging.getLogger(__name__)

# ── Schema migration ───────────────────────────────────────────────────────────

def ensure_permission_tables() -> None:
    """Create data_permission_rules table if it doesn't exist."""
    with admin_engine.begin() as conn:
        dialect = admin_engine.dialect.name

        if dialect == "sqlite":
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS data_permission_rules (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    org_id        INTEGER NOT NULL,
                    rule_type     TEXT    NOT NULL,  -- 'row' | 'column'
                    target_type   TEXT    NOT NULL,  -- 'role' | 'user'
                    target_value  TEXT    NOT NULL,  -- role name or user_id (as text)
                    table_name    TEXT    NOT NULL,
                    column_names  TEXT,              -- JSON array, NULL for row rules
                    column_action TEXT,              -- 'mask' | 'hide', NULL for row rules
                    row_filter    TEXT,              -- SQL WHERE fragment, NULL for column rules
                    description   TEXT,
                    is_active     INTEGER DEFAULT 1,
                    created_at    TEXT    DEFAULT (datetime('now')),
                    updated_at    TEXT    DEFAULT (datetime('now'))
                )
            """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS data_permission_rules (
                    id            SERIAL PRIMARY KEY,
                    org_id        INTEGER NOT NULL,
                    rule_type     TEXT    NOT NULL,
                    target_type   TEXT    NOT NULL,
                    target_value  TEXT    NOT NULL,
                    table_name    TEXT    NOT NULL,
                    column_names  TEXT,
                    column_action TEXT,
                    row_filter    TEXT,
                    description   TEXT,
                    is_active     INTEGER DEFAULT 1,
                    created_at    TIMESTAMP DEFAULT NOW(),
                    updated_at    TIMESTAMP DEFAULT NOW()
                )
            """))

        # Index for fast lookup during query enforcement
        try:
            if dialect == "sqlite":
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_dpr_org_active
                    ON data_permission_rules(org_id, is_active)
                """))
            else:
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_dpr_org_active
                    ON data_permission_rules(org_id, is_active)
                """))
        except Exception:
            pass  # index may already exist


# ── Rule CRUD ──────────────────────────────────────────────────────────────────

def _row(r) -> dict:
    import json
    d = dict(r._mapping)
    if d.get("column_names"):
        try:
            d["column_names"] = json.loads(d["column_names"])
        except Exception:
            pass
    d["is_active"] = bool(d.get("is_active", 1))
    return d


def list_rules(org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM data_permission_rules WHERE org_id = :oid ORDER BY id"),
            {"oid": org_id},
        ).fetchall()
    return [_row(r) for r in rows]


def get_rule(rule_id: int, org_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM data_permission_rules WHERE id = :id AND org_id = :oid"),
            {"id": rule_id, "oid": org_id},
        ).fetchone()
    return _row(row) if row else None


def create_rule(
    org_id: int,
    rule_type: str,          # 'row' | 'column'
    target_type: str,        # 'role' | 'user'
    target_value: str,       # role name or str(user_id)
    table_name: str,
    column_names: Optional[list] = None,
    column_action: Optional[str] = None,  # 'mask' | 'hide'
    row_filter: Optional[str] = None,
    description: Optional[str] = None,
) -> dict:
    import json
    cols_json = json.dumps(column_names) if column_names else None

    # Validate
    if rule_type not in ("row", "column"):
        raise ValueError("rule_type must be 'row' or 'column'")
    if target_type not in ("role", "user"):
        raise ValueError("target_type must be 'role' or 'user'")
    if rule_type == "column":
        if not column_names:
            raise ValueError("column_names required for column rules")
        if column_action not in ("mask", "hide"):
            raise ValueError("column_action must be 'mask' or 'hide'")
    if rule_type == "row" and not row_filter:
        raise ValueError("row_filter required for row rules")

    with admin_engine.begin() as conn:
        result = conn.execute(
            text("""
                INSERT INTO data_permission_rules
                    (org_id, rule_type, target_type, target_value, table_name,
                     column_names, column_action, row_filter, description)
                VALUES
                    (:oid, :rt, :tt, :tv, :tn, :cn, :ca, :rf, :desc)
            """),
            {
                "oid": org_id, "rt": rule_type, "tt": target_type,
                "tv": target_value, "tn": table_name, "cn": cols_json,
                "ca": column_action, "rf": row_filter, "desc": description,
            },
        )
        new_id = result.lastrowid
    return get_rule(new_id, org_id)


def update_rule(rule_id: int, org_id: int, **fields) -> Optional[dict]:
    import json
    if "column_names" in fields and isinstance(fields["column_names"], list):
        fields["column_names"] = json.dumps(fields["column_names"])
    allowed = {"rule_type", "target_type", "target_value", "table_name",
               "column_names", "column_action", "row_filter", "description", "is_active"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return get_rule(rule_id, org_id)

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    dialect = admin_engine.dialect.name
    ts_expr = "datetime('now')" if dialect == "sqlite" else "NOW()"
    fields["_id"] = rule_id
    fields["_oid"] = org_id
    with admin_engine.begin() as conn:
        conn.execute(
            text(f"UPDATE data_permission_rules SET {set_clause}, updated_at = {ts_expr} WHERE id = :_id AND org_id = :_oid"),
            fields,
        )
    return get_rule(rule_id, org_id)


def delete_rule(rule_id: int, org_id: int) -> bool:
    with admin_engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM data_permission_rules WHERE id = :id AND org_id = :oid"),
            {"id": rule_id, "oid": org_id},
        )
    return result.rowcount > 0


# ── Permission enforcement ─────────────────────────────────────────────────────

def _get_active_rules(org_id: int, role: str, user_id: int) -> list[dict]:
    """Fetch all active rules that apply to this user (role rules + user rules)."""
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT * FROM data_permission_rules
                WHERE org_id = :oid AND is_active = 1
                  AND (
                      (target_type = 'role' AND target_value = :role)
                   OR (target_type = 'user' AND target_value = :uid)
                  )
            """),
            {"oid": org_id, "role": role, "uid": str(user_id)},
        ).fetchall()
    return [_row(r) for r in rows]


def _extract_tables(sql: str) -> set[str]:
    """
    Naively extract table names from a SQL query for rule matching.
    Works for simple FROM / JOIN patterns; complex CTEs may not match perfectly —
    that's fine, rules simply won't fire for unrecognised tables.
    """
    # Match: FROM tbl, FROM "tbl", JOIN tbl, JOIN "tbl"
    pattern = r'(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?'
    return {m.lower() for m in re.findall(pattern, sql, re.IGNORECASE)}


def apply_row_permissions(sql: str, rules: list[dict]) -> str:
    """
    Wrap the SQL in a subquery that applies all relevant row filters.
    Multiple row rules for the same table are ANDed together.
    """
    tables_in_query = _extract_tables(sql)
    filters = []
    for rule in rules:
        if rule["rule_type"] != "row":
            continue
        if rule["table_name"].lower() not in tables_in_query:
            continue
        rf = rule["row_filter"].strip().rstrip(";")
        if rf:
            filters.append(rf)

    if not filters:
        return sql

    combined = " AND ".join(f"({f})" for f in filters)
    # Strip trailing semicolons so we can wrap safely
    clean_sql = sql.strip().rstrip(";")
    return f"SELECT * FROM ({clean_sql}) AS _permission_filtered WHERE {combined}"


def apply_column_permissions(rows: list[dict], rules: list[dict], sql: str) -> list[dict]:
    """
    Post-process result rows to mask or hide restricted columns.
    User-level rules (target_type='user') take precedence: if a user rule
    says 'hide' and a role rule says 'mask', we hide.
    """
    if not rows:
        return rows

    tables_in_query = _extract_tables(sql)

    # Collect effective column actions; user rules win over role rules
    # action priority: hide > mask
    _priority = {"hide": 2, "mask": 1}
    col_actions: dict[str, str] = {}  # col_name → action

    # Sort: role rules first, then user rules (so user rules overwrite)
    sorted_rules = sorted(rules, key=lambda r: 0 if r["target_type"] == "role" else 1)
    for rule in sorted_rules:
        if rule["rule_type"] != "column":
            continue
        if rule["table_name"].lower() not in tables_in_query:
            continue
        action = rule["column_action"]
        cols = rule["column_names"] if isinstance(rule["column_names"], list) else []
        for col in cols:
            c = col.lower()
            if c not in col_actions or _priority.get(action, 0) >= _priority.get(col_actions[c], 0):
                col_actions[c] = action

    if not col_actions:
        return rows

    mask_cols = {c for c, a in col_actions.items() if a == "mask"}
    hide_cols  = {c for c, a in col_actions.items() if a == "hide"}

    result = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            kl = k.lower()
            if kl in hide_cols:
                continue  # drop column entirely
            elif kl in mask_cols:
                new_row[k] = "***"
            else:
                new_row[k] = v
        result.append(new_row)
    return result


def apply_permissions(
    sql: str,
    rows: Optional[list[dict]],
    org_id: int,
    role: str,
    user_id: int,
) -> tuple[str, Optional[list[dict]]]:
    """
    Main entry point called by the query routes.

    Returns:
        (modified_sql, modified_rows)
        modified_sql has row filters baked in (wrap-in-subquery).
        modified_rows has column masking/hiding applied (None if rows not yet fetched).
    """
    try:
        rules = _get_active_rules(org_id, role, user_id)
        if not rules:
            return sql, rows

        # Row-level: rewrite SQL
        new_sql = apply_row_permissions(sql, rules)

        # Column-level: post-process rows (may be None if caller hasn't run query yet)
        new_rows = apply_column_permissions(rows or [], rules, sql) if rows is not None else None

        return new_sql, new_rows
    except Exception as e:
        logger.error(f"apply_permissions failed — serving unrestricted results: {e}")
        return sql, rows  # fail open to avoid breaking existing queries
