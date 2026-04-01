"""
Proactive Insight Engine for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Automatically detects anomalies and metric changes in org databases,
then uses the AI agent to explain WHY — surfacing insights proactively
without the user needing to ask.

Storage backend: SQLAlchemy (works with SQLite AND PostgreSQL).
The raw sqlite3 dependency has been removed — this module now uses the same
admin DB engine as models.py, so it works correctly when ADMIN_DB_URL points
to a Postgres instance.
"""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from logging_config import get_logger

logger = get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Admin DB access via shared SQLAlchemy engine (same engine as models.py)
# ─────────────────────────────────────────────────────────────────────────────

def _get_admin_engine():
    """Return the SQLAlchemy engine that models.py already initialised."""
    from models import engine as admin_engine
    return admin_engine


# Keywords that identify likely KPI columns
KPI_KEYWORDS = [
    "revenue", "sales", "orders", "users", "sessions", "conversions",
    "mrr", "arr", "churn", "signups", "profit", "cost", "spend",
    "clicks", "impressions", "leads", "customers", "transactions",
    "volume", "quantity", "amount", "total", "count", "rate", "price",
]

DATE_KEYWORDS = [
    "date", "created_at", "updated_at", "timestamp", "time",
    "day", "week", "month", "year", "period",
]


def ensure_insight_tables():
    """
    Create org_insights table in the admin DB if it doesn't exist.
    Uses SQLAlchemy so it works for both SQLite and PostgreSQL.
    Call from lifespan startup in api.py.
    """
    engine = _get_admin_engine()
    dialect = engine.dialect.name

    if dialect == "postgresql":
        ddl = """
            CREATE TABLE IF NOT EXISTS org_insights (
                id          TEXT PRIMARY KEY,
                org_id      INTEGER NOT NULL,
                metric_table  TEXT,
                metric_column TEXT,
                change_pct  DOUBLE PRECISION,
                period      TEXT,
                headline    TEXT,
                explanation TEXT,
                likely_causes TEXT,
                severity    TEXT DEFAULT 'medium',
                seen        INTEGER DEFAULT 0,
                created_at  TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_org_insights_org_id ON org_insights (org_id);
        """
    else:
        ddl = """
            CREATE TABLE IF NOT EXISTS org_insights (
                id          TEXT PRIMARY KEY,
                org_id      INTEGER NOT NULL,
                metric_table  TEXT,
                metric_column TEXT,
                change_pct  REAL,
                period      TEXT,
                headline    TEXT,
                explanation TEXT,
                likely_causes TEXT,
                severity    TEXT DEFAULT 'medium',
                seen        INTEGER DEFAULT 0,
                created_at  TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_org_insights_org_id ON org_insights (org_id);
        """

    with engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


# ─────────────────────────────────────────────────────────────────────────────
# InsightEngine — one per org, one per watchdog run
# ─────────────────────────────────────────────────────────────────────────────

class InsightEngine:
    """
    Monitors an org's database for significant metric changes,
    uses AI to explain anomalies, and stores results in the admin DB.
    """

    def __init__(
        self,
        db_manager,         # DatabaseManager for the org's data DB
        agent,              # AnalyticsAgent
        org_id: int,
        threshold_pct: float = 10.0,
        lookback_days: int = 7,
        max_stored: int = 20,
    ):
        self.db            = db_manager
        self.agent         = agent
        self.org_id        = org_id
        self.threshold_pct = threshold_pct
        self.lookback_days = lookback_days
        self.max_stored    = max_stored
        ensure_insight_tables()

    def close(self):
        """Clean up resources."""
        if hasattr(self, 'agent') and self.agent:
            self.agent.close()
        if hasattr(self, 'db') and self.db:
            self.db.close()

    # ── Metric discovery ──────────────────────────────────────────────────────

    def _discover_key_metrics(self) -> list[dict]:
        """Auto-detect KPI columns from the org's database schema."""
        metrics = []
        try:
            tables = self.db.list_tables()
            for table in tables:
                schema   = self.db.describe_table(table)
                date_col = self._find_date_col(schema)
                for col_name, col_type in schema:
                    name_lower = col_name.lower()
                    type_lower = col_type.lower()
                    is_numeric = any(t in type_lower for t in [
                        "int", "float", "real", "numeric", "decimal",
                        "double", "number", "bigint", "smallint",
                    ])
                    is_kpi = any(kw in name_lower for kw in KPI_KEYWORDS)
                    if is_numeric and is_kpi:
                        metrics.append({
                            "table":       table,
                            "column":      col_name,
                            "date_column": date_col,
                        })
        except Exception as exc:
            logger.warning(
                f"[InsightEngine] Metric discovery failed for org {self.org_id}: {exc}"
            )
        return metrics

    def _find_date_col(self, schema) -> Optional[str]:
        for col_name, _ in schema:
            if any(kw in col_name.lower() for kw in DATE_KEYWORDS):
                return col_name
        return None

    # ── Baseline comparison ───────────────────────────────────────────────────

    def _is_postgres(self) -> bool:
        """Check if the org's data DB is PostgreSQL."""
        try:
            return self.db.engine.dialect.name == "postgresql"
        except Exception:
            return False

    def _get_recent_value(
        self, table: str, column: str, date_col: Optional[str]
    ) -> Optional[float]:
        """24-hour average for the metric."""
        try:
            if date_col:
                if self._is_postgres():
                    where = f'WHERE "{date_col}" >= CURRENT_TIMESTAMP - INTERVAL \'1 day\''
                else:
                    where = f'WHERE "{date_col}" >= date(\'now\', \'-1 day\')'
                sql = (
                    f'SELECT AVG("{column}") AS val FROM "{table}" '
                    f'{where} '
                    f'AND "{column}" IS NOT NULL'
                )
            else:
                sql = (
                    f'SELECT AVG("{column}") AS val FROM "{table}" '
                    f'WHERE "{column}" IS NOT NULL'
                )
            result = self.db.execute_query(sql)

            if result and result[0].get("val") is not None:
                return float(result[0]["val"])
        except Exception as exc:
            logger.debug(
                f"[InsightEngine] recent_value failed {table}.{column}: {exc}"
            )
        return None

    def _get_baseline_value(
        self, table: str, column: str, date_col: Optional[str]
    ) -> Optional[float]:
        """Rolling N-day average (excluding last 24 h) as baseline."""
        try:
            if date_col:
                if self._is_postgres():
                    where_start = f'WHERE "{date_col}" >= CURRENT_TIMESTAMP - INTERVAL \'{self.lookback_days} days\''
                    where_end   = f'AND "{date_col}" < CURRENT_TIMESTAMP - INTERVAL \'1 day\''
                else:
                    where_start = f'WHERE "{date_col}" >= date(\'now\', \'-{self.lookback_days} days\')'
                    where_end   = f'AND "{date_col}" < date(\'now\', \'-1 day\')'
                sql = (
                    f'SELECT AVG("{column}") AS val FROM "{table}" '
                    f'{where_start} '
                    f'{where_end} '
                    f'AND "{column}" IS NOT NULL'
                )
            else:
                sql = (
                    f'SELECT AVG("{column}") AS val FROM "{table}" '
                    f'WHERE "{column}" IS NOT NULL'
                )
            result = self.db.execute_query(sql)
            if result and result[0].get("val") is not None:
                return float(result[0]["val"])
        except Exception as exc:
            logger.debug(
                f"[InsightEngine] baseline_value failed {table}.{column}: {exc}"
            )
        return None

    # ── AI explanation ────────────────────────────────────────────────────────

    def _explain_anomaly(self, metric: dict, change_pct: float) -> dict:
        direction = "increased" if change_pct > 0 else "dropped"
        abs_pct   = abs(change_pct)
        prompt = (
            f"INTERNAL ANALYSIS — DO NOT SHOW SQL.\n\n"
            f"ANOMALY DETECTED: '{metric['column']}' in table '{metric['table']}' "
            f"has {direction} by {abs_pct:.1f}% vs the {self.lookback_days}-day average.\n\n"
            f"Investigate by:\n"
            f"1. Checking if specific segments drove the change\n"
            f"2. Looking for correlated columns that changed simultaneously\n"
            f"3. Checking for data quality issues\n"
            f"4. Identifying when the change started\n\n"
            f"Respond ONLY in JSON:\n"
            f'{{"headline":"...","explanation":"...","likely_causes":["..."],'
            f'"severity":"low|medium|high","recommended_action":"..."}}'
        )
        try:
            result = self.agent.run_query(prompt, history=[])
            text_  = result.get("text", "")
            start, end = text_.find("{"), text_.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text_[start:end])
        except Exception as exc:
            logger.warning(f"[InsightEngine] LLM explanation failed: {exc}")

        direction_word = "increased" if change_pct > 0 else "decreased"
        return {
            "headline": f"{metric['column']} {direction_word} by {abs(change_pct):.1f}%",
            "explanation": (
                f"Significant change detected in {metric['column']} "
                f"({direction_word} {abs(change_pct):.1f}% vs {self.lookback_days}-day avg)."
            ),
            "likely_causes":      ["Investigate data for root cause"],
            "severity":           "high" if abs(change_pct) > 25 else "medium",
            "recommended_action": f"Query '{metric['column']}' broken down by key dimensions.",
        }

    # ── Storage (SQLAlchemy) ──────────────────────────────────────────────────

    def _store_insight(self, metric: dict, change_pct: float, explanation: dict):
        insight_id = str(uuid.uuid4())
        engine     = _get_admin_engine()
        try:
            with engine.connect() as conn:
                with conn.begin():
                    conn.execute(text("""
                        INSERT INTO org_insights
                            (id, org_id, metric_table, metric_column, change_pct,
                             period, headline, explanation, likely_causes,
                             severity, seen, created_at)
                        VALUES
                            (:id, :org_id, :metric_table, :metric_column, :change_pct,
                             :period, :headline, :explanation, :likely_causes,
                             :severity, 0, :created_at)
                    """), {
                        "id":            insight_id,
                        "org_id":        self.org_id,
                        "metric_table":  metric["table"],
                        "metric_column": metric["column"],
                        "change_pct":    round(change_pct, 2),
                        "period":        f"Last 24h vs {self.lookback_days}-day avg",
                        "headline":      explanation.get("headline", ""),
                        "explanation":   explanation.get("explanation", ""),
                        "likely_causes": json.dumps(explanation.get("likely_causes", [])),
                        "severity":      explanation.get("severity", "medium"),
                        "created_at":    datetime.utcnow().isoformat(),
                    })

                    # Trim to max_stored per org
                    dialect = engine.dialect.name
                    if dialect == "postgresql":
                        trim_sql = text("""
                            DELETE FROM org_insights
                            WHERE org_id = :org_id AND id NOT IN (
                                SELECT id FROM org_insights
                                WHERE org_id = :org_id
                                ORDER BY created_at DESC
                                LIMIT :max_stored
                            )
                        """)
                    else:
                        trim_sql = text("""
                            DELETE FROM org_insights
                            WHERE org_id = :org_id AND id NOT IN (
                                SELECT id FROM org_insights
                                WHERE org_id = :org_id
                                ORDER BY created_at DESC
                                LIMIT :max_stored
                            )
                        """)
                    conn.execute(trim_sql, {
                        "org_id":     self.org_id,
                        "max_stored": self.max_stored,
                    })
        except Exception as exc:
            logger.error(
                f"[InsightEngine] Failed to store insight for org {self.org_id}: {exc}"
            )

    # ── Public API ────────────────────────────────────────────────────────────

    def run_watchdog(self):
        """Discover KPIs, compare vs baseline, explain anomalies, store results."""
        logger.info(f"[InsightEngine] Running watchdog for org {self.org_id}")
        metrics = self._discover_key_metrics()

        for metric in metrics:
            try:
                recent   = self._get_recent_value(
                    metric["table"], metric["column"], metric.get("date_column")
                )
                baseline = self._get_baseline_value(
                    metric["table"], metric["column"], metric.get("date_column")
                )

                if recent is None or baseline is None or baseline == 0:
                    continue

                change_pct = ((recent - baseline) / abs(baseline)) * 100

                if abs(change_pct) >= self.threshold_pct:
                    logger.info(
                        f"[InsightEngine] Anomaly: {metric['column']} "
                        f"changed {change_pct:.1f}% for org {self.org_id}"
                    )
                    explanation = self._explain_anomaly(metric, change_pct)
                    self._store_insight(metric, change_pct, explanation)

            except Exception as exc:
                logger.warning(
                    f"[InsightEngine] Check failed for {metric}: {exc}"
                )

    def _fetch_insights(self, where_extra: str, params: dict) -> list[dict]:
        engine = _get_admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(text(f"""
                SELECT id, metric_table, metric_column, change_pct, period,
                       headline, explanation, likely_causes, severity, seen, created_at
                FROM org_insights
                WHERE org_id = :org_id {where_extra}
                ORDER BY created_at DESC
                LIMIT 50
            """), params).mappings().all()
        return [self._parse_insight(dict(r)) for r in rows]

    def get_unseen_insights(self) -> list[dict]:
        return self._fetch_insights("AND seen = 0", {"org_id": self.org_id})

    def get_all_insights(self, limit: int = 20) -> list[dict]:
        engine = _get_admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, metric_table, metric_column, change_pct, period,
                       headline, explanation, likely_causes, severity, seen, created_at
                FROM org_insights
                WHERE org_id = :org_id
                ORDER BY created_at DESC
                LIMIT :limit
            """), {"org_id": self.org_id, "limit": limit}).mappings().all()
        return [self._parse_insight(dict(r)) for r in rows]

    def mark_seen(self, insight_id: str):
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("UPDATE org_insights SET seen=1 WHERE id=:id AND org_id=:org_id"),
                    {"id": insight_id, "org_id": self.org_id},
                )

    def mark_all_seen(self):
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("UPDATE org_insights SET seen=1 WHERE org_id=:org_id"),
                    {"org_id": self.org_id},
                )

    def _parse_insight(self, row: dict) -> dict:
        row["likely_causes"] = json.loads(row.get("likely_causes") or "[]")
        import math
        if "change_pct" in row and isinstance(row["change_pct"], float):
            if math.isnan(row["change_pct"]) or math.isinf(row["change_pct"]):
                row["change_pct"] = None
        return row


# ─────────────────────────────────────────────────────────────────────────────
# InsightScheduler — background asyncio loop for all orgs
# ─────────────────────────────────────────────────────────────────────────────

class InsightScheduler:
    """Background task that runs InsightEngine for every org on a set interval."""

    def __init__(self, engine_factory, interval_minutes: int = 60):
        self.engine_factory   = engine_factory
        self.interval_minutes = interval_minutes
        self._running         = False
        self._task            = None

    async def start(self):
        self._running = True
        self._task    = asyncio.create_task(self._loop())
        logger.info(f"[InsightScheduler] Started (interval: {self.interval_minutes}min)")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("[InsightScheduler] Stopped")

    async def _loop(self):
        while self._running:
            await self._run_all_orgs()
            await asyncio.sleep(self.interval_minutes * 60)

    async def _run_all_orgs(self):
        """Run watchdog for every org that has a configured database."""
        try:
            # Use SQLAlchemy admin engine — no raw sqlite3
            from models import engine as admin_engine
            with admin_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        "SELECT id FROM organizations "
                        "WHERE db_connection_string IS NOT NULL"
                    )
                ).mappings().all()

            for row in rows:
                if not self._running:
                    break
                org_id = row["id"]
                try:
                    engine = self.engine_factory(org_id)
                    if engine:
                        try:
                            await asyncio.get_event_loop().run_in_executor(
                                None, engine.run_watchdog
                            )
                        finally:
                            if hasattr(engine, "close"):
                                engine.close()
                except Exception as exc:
                    logger.error(
                        f"[InsightScheduler] Watchdog failed for org {org_id}: {exc}"
                    )

        except Exception as exc:
            logger.error(f"[InsightScheduler] Loop error: {exc}")