"""
alerts.py — Threshold-based alerting for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Lets users define rules like:
  "Alert me when revenue drops more than 10% day-over-day"
  "Alert me when the orders table hasn't been updated in 6 hours"
  "Alert me when avg order value exceeds $500"

Delivery:
  - Email (via send_email_mock, swap for real SMTP/SES)
  - Webhook (POST JSON payload to any URL)

Evaluation:
  - Runs on APScheduler every N minutes (default 15)
  - Each alert tracks last_triggered_at to avoid spam (cooldown_minutes)

Storage: SQLAlchemy — SQLite and Postgres compatible.
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

# ─── Condition operators supported ───────────────────────────────────────────
# metric conditions
METRIC_OPS     = (">", "<", ">=", "<=", "==", "!=", "pct_change_gt", "pct_change_lt")
# data freshness
FRESHNESS_OPS  = ("stale_hours",)   # triggers when table not updated in N hours


# ─── Schema ──────────────────────────────────────────────────────────────────

def ensure_alert_tables():
    """Create alert_rules and alert_history tables. Call from lifespan startup."""
    dialect = admin_engine.dialect.name
    if dialect == "postgresql":
        serial = "SERIAL"
        text_  = "TEXT"
    else:
        serial = "INTEGER"  # SQLite AUTOINCREMENT
        text_  = "TEXT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS alert_rules (
            id                  {serial} PRIMARY KEY {'AUTOINCREMENT' if dialect != 'postgresql' else ''},
            org_id              INTEGER NOT NULL,
            name                {text_} NOT NULL,
            is_active           INTEGER NOT NULL DEFAULT 1,

            -- What to measure
            alert_type          {text_} NOT NULL DEFAULT 'metric',
            table_name          {text_},
            column_name         {text_},
            aggregate           {text_} DEFAULT 'avg',
            operator            {text_} NOT NULL,
            threshold_value     REAL,
            lookback_hours      INTEGER DEFAULT 24,

            -- Delivery
            notify_email        {text_},
            notify_webhook      {text_},

            -- Anti-spam
            cooldown_minutes    INTEGER DEFAULT 60,
            last_triggered_at   {text_},

            -- Metadata
            created_by          INTEGER,
            timestamp_column    {text_} DEFAULT 'created_at',
            created_at          {text_} NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_alert_rules_org_id ON alert_rules (org_id);

        CREATE TABLE IF NOT EXISTS alert_history (
            id              {serial} PRIMARY KEY {'AUTOINCREMENT' if dialect != 'postgresql' else ''},
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
    """

    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))
                
            # Backward compatibility: add timestamp_column if it's missing
            try:
                conn.execute(text(f"ALTER TABLE alert_rules ADD COLUMN timestamp_column {text_} DEFAULT 'created_at'"))
            except Exception as e:
                # Column likely already exists
                pass


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_alert_rule(org_id: int, data: dict) -> dict:
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO alert_rules
                    (org_id, name, is_active, alert_type, table_name, column_name,
                     aggregate, operator, threshold_value, lookback_hours,
                     notify_email, notify_webhook, cooldown_minutes, created_by, 
                     timestamp_column, created_at)
                VALUES
                    (:org_id, :name, 1, :alert_type, :table_name, :column_name,
                     :aggregate, :operator, :threshold_value, :lookback_hours,
                     :notify_email, :notify_webhook, :cooldown_minutes, :created_by,
                     :timestamp_column, :now)
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
                "timestamp_column":data.get("timestamp_column", "created_at"),
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
        "notify_email", "notify_webhook", "cooldown_minutes", "timestamp_column",
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


# ─── Evaluation engine ────────────────────────────────────────────────────────

def _evaluate_metric_rule(rule: dict, org_conn_str: str) -> tuple[bool, Optional[float], str]:
    """
    Returns (triggered, current_value, message).
    Connects to the org's data DB (not admin DB) to run the metric query.
    """
    from database import DatabaseManager

    op         = rule["operator"]
    table      = rule["table_name"]
    column     = rule["column_name"]
    agg        = rule.get("aggregate", "avg").upper()
    threshold  = rule["threshold_value"]
    hours      = rule.get("lookback_hours", 24)

    dm = DatabaseManager(connection_string=org_conn_str)
    dialect = dm.engine.dialect.name
    
    try:
        if op in ("pct_change_gt", "pct_change_lt"):
            ts_col = rule.get("timestamp_column", "created_at")
            # Compare recent window vs previous window of same length
            if dialect == "postgresql":
                recent_where = f'"{ts_col}" >= CURRENT_TIMESTAMP - INTERVAL \'{hours} hours\''
                prev_where   = f'"{ts_col}" >= CURRENT_TIMESTAMP - INTERVAL \'{hours * 2} hours\' AND "{ts_col}" < CURRENT_TIMESTAMP - INTERVAL \'{hours} hours\''
            else:
                # SQLite fallback
                recent_where = f'"{ts_col}" >= datetime(\'now\', \'-{hours} hours\')'
                prev_where   = f'"{ts_col}" >= datetime(\'now\', \'-{hours * 2} hours\') AND "{ts_col}" < datetime(\'now\', \'-{hours} hours\')'
                
            recent_sql = f'SELECT {agg}("{column}") AS val FROM "{table}" WHERE "{column}" IS NOT NULL AND {recent_where}'
            prev_sql   = f'SELECT {agg}("{column}") AS val FROM "{table}" WHERE "{column}" IS NOT NULL AND {prev_where}'

            recent  = dm.execute_query(recent_sql)
            prev    = dm.execute_query(prev_sql)
            rv      = recent[0]["val"] if recent and recent[0]["val"] is not None else None
            pv      = prev[0]["val"]   if prev   and prev[0]["val"]   is not None else None

            if rv is None or pv is None or pv == 0:
                return False, None, "Insufficient data for pct_change comparison"

            pct = ((rv - pv) / abs(pv)) * 100
            if op == "pct_change_gt":
                triggered = pct > threshold
            else:
                triggered = pct < -abs(threshold)

            direction = "increased" if pct > 0 else "dropped"
            msg = (
                f"'{column}' in '{table}' {direction} by {abs(pct):.1f}% "
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
    """Check if a table hasn't been updated within lookback_hours."""
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


async def _deliver_alert(rule: dict, current_value: Optional[float], message: str):
    """Send email and/or webhook notification."""
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
    Evaluates every active alert rule for every org.
    """
    from models import Organization
    with admin_engine.connect() as conn:
        orgs = conn.execute(
            text("SELECT id, db_connection_string FROM organizations "
                 "WHERE db_connection_string IS NOT NULL")
        ).mappings().all()

    for org_row in orgs:
        org_id   = org_row["id"]
        conn_str = org_row["db_connection_string"]

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
                    _record_trigger(
                        rule["id"], org_id, val, rule.get("threshold_value"),
                        msg, delivered=True, delivery_error=delivery_error,
                    )
            except Exception as exc:
                logger.error(f"[Alerts] Evaluation error for rule {rule['id']}: {exc}")