"""
alerts.py — Threshold-based alerting for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Fixes applied
─────────────
Bug #1  — evaluate_all_alerts() now loads orgs via ORM (SessionLocal) so
           EncryptedString TypeDecorator decrypts db_connection_string.
Bug #3  — pct_change_gt triggers on INCREASES, pct_change_lt on DROPS.
Bug #4  — delivered flag is now True only when delivery_error is None.
Bug #5  — ensure_alert_tables() creates table_freshness table.
Bug #6  — pct_change SQL uses dialect-aware time expressions.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy import text

from models import engine as admin_engine
from utils import send_email_mock
from logging_config import get_logger

logger = get_logger(__name__)

ALERT_CHECK_INTERVAL_MINUTES = int(os.getenv("ALERT_CHECK_INTERVAL", "15"))

METRIC_OPS    = (">", "<", ">=", "<=", "==", "!=", "pct_change_gt", "pct_change_lt")
FRESHNESS_OPS = ("stale_hours",)


# ─── Schema ──────────────────────────────────────────────────────────────────

def ensure_alert_tables():
    """
    Create alert_rules, alert_history, and table_freshness tables.
    Fix #5: table_freshness is now created here.
    """
    dialect = admin_engine.dialect.name
    if dialect == "postgresql":
        serial = "SERIAL"
        text_  = "TEXT"
        ai     = ""
    else:
        serial = "INTEGER"
        text_  = "TEXT"
        ai     = "AUTOINCREMENT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS alert_rules (
            id                  {serial} PRIMARY KEY {ai},
            org_id              INTEGER NOT NULL,
            name                {text_} NOT NULL,
            is_active           INTEGER NOT NULL DEFAULT 1,
            alert_type          {text_} NOT NULL DEFAULT 'metric',
            table_name          {text_},
            column_name         {text_},
            aggregate           {text_} DEFAULT 'avg',
            operator            {text_} NOT NULL,
            threshold_value     REAL,
            lookback_hours      INTEGER DEFAULT 24,
            notify_email        {text_},
            notify_webhook      {text_},
            cooldown_minutes    INTEGER DEFAULT 60,
            last_triggered_at   {text_},
            created_by          INTEGER,
            created_at          {text_} NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_alert_rules_org_id ON alert_rules (org_id);

        CREATE TABLE IF NOT EXISTS alert_history (
            id              {serial} PRIMARY KEY {ai},
            rule_id         INTEGER NOT NULL,
            org_id          INTEGER NOT NULL,
            triggered_at    {text_} NOT NULL,
            current_value   REAL,
            threshold_value REAL,
            message         {text_},
            delivered       INTEGER DEFAULT 0,
            delivery_error  {text_}
        );
        CREATE INDEX IF NOT EXISTS ix_alert_history_rule_id ON alert_history (rule_id);

        CREATE TABLE IF NOT EXISTS table_freshness (
            org_id       INTEGER NOT NULL,
            table_name   {text_} NOT NULL,
            last_updated {text_} NOT NULL,
            PRIMARY KEY (org_id, table_name)
        );
        CREATE INDEX IF NOT EXISTS ix_table_freshness_org_id ON table_freshness (org_id)
    """

    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_alert_rule(org_id: int, data: dict) -> dict:
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO alert_rules
                    (org_id, name, is_active, alert_type, table_name, column_name,
                     aggregate, operator, threshold_value, lookback_hours,
                     notify_email, notify_webhook, cooldown_minutes, created_by, created_at)
                VALUES
                    (:org_id, :name, 1, :alert_type, :table_name, :column_name,
                     :aggregate, :operator, :threshold_value, :lookback_hours,
                     :notify_email, :notify_webhook, :cooldown_minutes, :created_by, :now)
            """), {
                "org_id":          org_id,
                "name":            data["name"],
                "alert_type":      data.get("alert_type", "metric"),
                "table_name":      data.get("table_name"),
                "column_name":     data.get("column_name"),
                "aggregate":       data.get("aggregate", "avg"),
                "operator":        data["operator"],
                "threshold_value": data.get("threshold_value"),
                "lookback_hours":  data.get("lookback_hours", 24),
                "notify_email":    data.get("notify_email"),
                "notify_webhook":  data.get("notify_webhook"),
                "cooldown_minutes":data.get("cooldown_minutes", 60),
                "created_by":      data.get("created_by"),
                "now":             now,
            })
        row = conn.execute(
            text("SELECT * FROM alert_rules WHERE org_id=:org_id ORDER BY created_at DESC LIMIT 1"),
            {"org_id": org_id}
        ).mappings().first()
    return dict(row)


def get_alert_rules(org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM alert_rules WHERE org_id=:org_id ORDER BY created_at DESC"),
            {"org_id": org_id}
        ).mappings().all()
    return [dict(r) for r in rows]


def get_alert_rule(rule_id: int, org_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM alert_rules WHERE id=:id AND org_id=:org_id"),
            {"id": rule_id, "org_id": org_id}
        ).mappings().first()
    return dict(row) if row else None


def update_alert_rule(rule_id: int, org_id: int, updates: dict):
    allowed = {
        "name", "is_active", "table_name", "column_name", "aggregate",
        "operator", "threshold_value", "lookback_hours",
        "notify_email", "notify_webhook", "cooldown_minutes",
    }
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return
    set_clause = ", ".join(f"{k}=:{k}" for k in filtered)
    filtered.update({"id": rule_id, "org_id": org_id})
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text(f"UPDATE alert_rules SET {set_clause} WHERE id=:id AND org_id=:org_id"),
                filtered
            )


def delete_alert_rule(rule_id: int, org_id: int):
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("DELETE FROM alert_rules WHERE id=:id AND org_id=:org_id"),
                {"id": rule_id, "org_id": org_id}
            )


def get_alert_history(org_id: int, rule_id: Optional[int] = None, limit: int = 50) -> list[dict]:
    with admin_engine.connect() as conn:
        if rule_id:
            rows = conn.execute(
                text("SELECT * FROM alert_history WHERE org_id=:org_id AND rule_id=:rule_id "
                     "ORDER BY triggered_at DESC LIMIT :limit"),
                {"org_id": org_id, "rule_id": rule_id, "limit": limit}
            ).mappings().all()
        else:
            rows = conn.execute(
                text("SELECT * FROM alert_history WHERE org_id=:org_id "
                     "ORDER BY triggered_at DESC LIMIT :limit"),
                {"org_id": org_id, "limit": limit}
            ).mappings().all()
    return [dict(r) for r in rows]


# ─── Freshness helpers ────────────────────────────────────────────────────────

def update_table_freshness(org_id: int, table_name: str) -> None:
    """
    Record that a table was just updated.
    Call this from file-upload routes so freshness alerts have accurate data.
    """
    now     = datetime.utcnow().isoformat()
    dialect = admin_engine.dialect.name

    with admin_engine.connect() as conn:
        with conn.begin():
            if dialect == "postgresql":
                conn.execute(text("""
                    INSERT INTO table_freshness (org_id, table_name, last_updated)
                    VALUES (:org_id, :table_name, :now)
                    ON CONFLICT (org_id, table_name)
                    DO UPDATE SET last_updated = EXCLUDED.last_updated
                """), {"org_id": org_id, "table_name": table_name, "now": now})
            else:
                conn.execute(text("""
                    INSERT OR REPLACE INTO table_freshness (org_id, table_name, last_updated)
                    VALUES (:org_id, :table_name, :now)
                """), {"org_id": org_id, "table_name": table_name, "now": now})


# ─── Evaluation engine ────────────────────────────────────────────────────────

def _time_filter_sql(dialect: str, column: str, hours: int, direction: str = "recent") -> str:
    """
    Build a dialect-aware time filter expression.
    Fix #6: SQLite datetime() is no longer hardcoded — PostgreSQL uses INTERVAL.

    direction='recent'  → rows from the last `hours` hours
    direction='prev'    → rows from 2×hours ago up to 1×hours ago
    """
    if dialect == "postgresql":
        if direction == "recent":
            return f"{column} >= NOW() - INTERVAL '{hours} hours'"
        else:
            return (
                f"{column} >= NOW() - INTERVAL '{hours * 2} hours' "
                f"AND {column} < NOW() - INTERVAL '{hours} hours'"
            )
    else:
        # SQLite
        if direction == "recent":
            return f"{column} >= datetime('now', '-{hours} hours')"
        else:
            return (
                f"{column} >= datetime('now', '-{hours * 2} hours') "
                f"AND {column} < datetime('now', '-{hours} hours')"
            )


def _evaluate_metric_rule(rule: dict, org_conn_str: str) -> tuple[bool, Optional[float], str]:
    """
    Returns (triggered, current_value, message).

    Fix #3: Operator semantics corrected:
      pct_change_gt → triggers when value INCREASED by > threshold%
      pct_change_lt → triggers when value DROPPED   by > threshold%
    Fix #6: Time filters are now dialect-aware via _time_filter_sql().
    """
    from database import DatabaseManager

    op        = rule["operator"]
    table     = rule["table_name"]
    column    = rule["column_name"]
    agg       = rule.get("aggregate", "avg").upper()
    threshold = rule["threshold_value"]
    hours     = rule.get("lookback_hours", 24)

    dm = DatabaseManager(connection_string=org_conn_str)
    try:
        dialect = dm.engine.dialect.name

        if op in ("pct_change_gt", "pct_change_lt"):
            recent_filter = _time_filter_sql(dialect, "created_at", hours, "recent")
            prev_filter   = _time_filter_sql(dialect, "created_at", hours, "prev")

            recent_sql = (
                f'SELECT {agg}("{column}") AS val FROM "{table}" '
                f'WHERE "{column}" IS NOT NULL AND {recent_filter}'
            )
            prev_sql = (
                f'SELECT {agg}("{column}") AS val FROM "{table}" '
                f'WHERE "{column}" IS NOT NULL AND {prev_filter}'
            )

            recent = dm.execute_query(recent_sql)
            prev   = dm.execute_query(prev_sql)
            rv     = recent[0]["val"] if recent and recent[0]["val"] is not None else None
            pv     = prev[0]["val"]   if prev   and prev[0]["val"]   is not None else None

            if rv is None or pv is None or pv == 0:
                return False, None, "Insufficient data for pct_change comparison"

            pct = ((rv - pv) / abs(pv)) * 100

            # Fix #3: corrected semantics
            if op == "pct_change_gt":
                # Trigger when value went UP by more than threshold%
                triggered = pct > threshold
            else:
                # pct_change_lt: trigger when value DROPPED by more than threshold%
                triggered = pct < -abs(threshold)

            actual_direction = "increased" if pct > 0 else "dropped"
            msg = (
                f"'{column}' in '{table}' {actual_direction} by {abs(pct):.1f}% "
                f"(threshold: {threshold}%)"
            )
            return triggered, round(pct, 2), msg

        else:
            sql    = f'SELECT {agg}("{column}") AS val FROM "{table}" WHERE "{column}" IS NOT NULL'
            result = dm.execute_query(sql)
            val    = result[0]["val"] if result and result[0]["val"] is not None else None

            if val is None:
                return False, None, "No data"

            val = float(val)
            ops_map = {
                ">": val > threshold, "<": val < threshold,
                ">=": val >= threshold, "<=": val <= threshold,
                "==": val == threshold, "!=": val != threshold,
            }
            triggered = ops_map.get(op, False)
            msg = f"{agg}({column}) = {val:.4g} {op} {threshold}"
            return triggered, val, msg
    finally:
        dm.close()


def _evaluate_freshness_rule(rule: dict) -> tuple[bool, Optional[float], str]:
    """
    Check if a table hasn't been updated within threshold_value hours.
    Fix #5: table_freshness now exists (created in ensure_alert_tables).
    """
    table_name = rule["table_name"]
    max_hours  = rule["threshold_value"] or 6

    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT last_updated FROM table_freshness "
                 "WHERE org_id=:org_id AND table_name=:table_name"),
            {"org_id": rule["org_id"], "table_name": table_name}
        ).mappings().first()

    if not row:
        return True, None, f"No freshness record for '{table_name}'"

    last_updated = datetime.fromisoformat(row["last_updated"])
    age_hours    = (datetime.utcnow() - last_updated).total_seconds() / 3600
    triggered    = age_hours >= max_hours
    msg          = f"'{table_name}' last updated {age_hours:.1f}h ago (threshold: {max_hours}h)"
    return triggered, round(age_hours, 2), msg


async def _deliver_alert(rule: dict, current_value: Optional[float], message: str) -> Optional[str]:
    """Send email and/or webhook. Returns None on success, error string on failure."""
    subject = f"[Vantage AI Alert] {rule['name']}"
    body    = (
        f"Alert triggered: {rule['name']}\n\n"
        f"Condition: {message}\n"
        f"Triggered at: {datetime.utcnow().isoformat()} UTC\n\n"
        f"— Vantage AI"
    )

    delivery_error = None

    if rule.get("notify_email"):
        try:
            send_email_mock(rule["notify_email"], subject, body)
        except Exception as exc:
            delivery_error = f"email: {exc}"
            logger.error(f"[Alerts] Email delivery failed for rule {rule['id']}: {exc}")

    if rule.get("notify_webhook"):
        try:
            payload = {
                "alert_name":    rule["name"],
                "org_id":        rule["org_id"],
                "rule_id":       rule["id"],
                "current_value": current_value,
                "message":       message,
                "triggered_at":  datetime.utcnow().isoformat(),
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(rule["notify_webhook"], json=payload)
                resp.raise_for_status()
        except Exception as exc:
            err = f"webhook: {exc}"
            delivery_error = (delivery_error + " | " + err) if delivery_error else err
            logger.error(f"[Alerts] Webhook delivery failed for rule {rule['id']}: {exc}")

    return delivery_error


def _record_trigger(rule_id: int, org_id: int, current_value: Optional[float],
                    threshold: Optional[float], message: str,
                    delivered: bool, delivery_error: Optional[str]):
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO alert_history
                    (rule_id, org_id, triggered_at, current_value, threshold_value,
                     message, delivered, delivery_error)
                VALUES
                    (:rule_id, :org_id, :triggered_at, :current_value, :threshold_value,
                     :message, :delivered, :delivery_error)
            """), {
                "rule_id":        rule_id,
                "org_id":         org_id,
                "triggered_at":   now,
                "current_value":  current_value,
                "threshold_value":threshold,
                "message":        message,
                "delivered":      1 if delivered else 0,
                "delivery_error": delivery_error,
            })
            conn.execute(
                text("UPDATE alert_rules SET last_triggered_at=:now WHERE id=:id"),
                {"now": now, "id": rule_id}
            )


def _is_in_cooldown(rule: dict) -> bool:
    if not rule.get("last_triggered_at"):
        return False
    cooldown_mins = rule.get("cooldown_minutes", 60)
    last          = datetime.fromisoformat(rule["last_triggered_at"])
    return (datetime.utcnow() - last).total_seconds() < cooldown_mins * 60


# ─── Scheduler-facing evaluation loop ────────────────────────────────────────

async def evaluate_all_alerts():
    """
    Called by APScheduler every ALERT_CHECK_INTERVAL_MINUTES.

    Fix #1: Uses ORM (SessionLocal) instead of raw SQL so EncryptedString
    TypeDecorator decrypts db_connection_string before we use it.
    """
    from models import SessionLocal, Organization

    with SessionLocal() as session:
        orgs = (
            session.query(Organization)
            .filter(Organization.db_connection_string.isnot(None))
            .all()
        )
        org_data = [
            {"id": org.id, "conn_str": org.db_connection_string}
            for org in orgs
        ]

    for item in org_data:
        org_id   = item["id"]
        conn_str = item["conn_str"]

        rules = [r for r in get_alert_rules(org_id) if r["is_active"]]
        for rule in rules:
            if _is_in_cooldown(rule):
                continue
            try:
                alert_type = rule.get("alert_type", "metric")
                if alert_type == "freshness":
                    triggered, val, msg = _evaluate_freshness_rule({**rule, "org_id": org_id})
                else:
                    triggered, val, msg = _evaluate_metric_rule(rule, conn_str)

                if triggered:
                    logger.info(f"[Alerts] Rule {rule['id']} triggered for org {org_id}: {msg}")
                    delivery_error = await _deliver_alert(rule, val, msg)
                    # Fix #4: delivered is True only when there was no error
                    _record_trigger(
                        rule["id"], org_id, val, rule.get("threshold_value"),
                        msg,
                        delivered=(delivery_error is None),
                        delivery_error=delivery_error,
                    )
            except Exception as exc:
                logger.error(f"[Alerts] Evaluation error for rule {rule['id']}: {exc}")
