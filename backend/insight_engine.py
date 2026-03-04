"""
Proactive Insight Engine for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Automatically detects anomalies and metric changes in org databases,
then uses the AI agent to explain WHY — surfacing insights proactively
without the user needing to ask.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Optional
import sqlite3
import os

from logging_config import get_logger

logger = get_logger(__name__)

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


def _get_admin_db_path() -> str:
    """Standardized admin database path resolution matching org_context_manager."""
    db_url = os.getenv("ADMIN_DB_URL") or os.getenv("ADMIN_DB_PATH") or "./admin.db"
    
    if db_url.startswith("sqlite:///"):
        path = db_url.replace("sqlite:///", "")
    elif db_url.startswith("sqlite://"):
        path = db_url.replace("sqlite://", "")
    else:
        path = db_url
        
    return os.path.abspath(path)


def _admin_conn():
    c = sqlite3.connect(_get_admin_db_path())
    c.row_factory = sqlite3.Row
    return c


def ensure_insight_tables():
    """
    Create insight storage tables in admin.db.
    Call from lifespan startup in api.py.
    """
    with _admin_conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS org_insights (
                id TEXT PRIMARY KEY,
                org_id INTEGER NOT NULL,
                metric_table TEXT,
                metric_column TEXT,
                change_pct REAL,
                period TEXT,
                headline TEXT,
                explanation TEXT,
                likely_causes TEXT,
                severity TEXT DEFAULT 'medium',
                seen INTEGER DEFAULT 0,
                created_at TEXT
            );
        """)


# ─────────────────────────────────────────────────────────────────────────────
# InsightEngine — one per org, one per watchdog run
# ─────────────────────────────────────────────────────────────────────────────

class InsightEngine:
    """
    Monitors an org's database for significant metric changes,
    uses AI to explain anomalies, and stores results in admin.db.
    """

    def __init__(
        self,
        db_manager,         # DatabaseManager instance for org's data DB
        agent,              # AnalyticsAgent instance
        org_id: int,
        threshold_pct: float = 10.0,
        lookback_days: int = 7,
        max_stored: int = 20,
    ):
        self.db = db_manager
        self.agent = agent
        self.org_id = org_id
        self.threshold_pct = threshold_pct
        self.lookback_days = lookback_days
        self.max_stored = max_stored
        ensure_insight_tables()

    # ─────────────────────────────────────────────
    # METRIC DISCOVERY
    # ─────────────────────────────────────────────

    def _discover_key_metrics(self) -> list[dict]:
        """Auto-detect KPI columns from org's database schema."""
        metrics = []
        try:
            tables = self.db.list_tables()
            for table in tables:
                schema = self.db.describe_table(table)
                date_col = self._find_date_col(schema)
                for col_name, col_type in schema:
                    name_lower = col_name.lower()
                    type_lower = col_type.lower()
                    is_numeric = any(t in type_lower for t in [
                        "int", "float", "real", "numeric", "decimal", "double", "number"
                    ])
                    is_kpi = any(kw in name_lower for kw in KPI_KEYWORDS)
                    if is_numeric and is_kpi:
                        metrics.append({
                            "table": table,
                            "column": col_name,
                            "date_column": date_col,
                        })
        except Exception as e:
            logger.warning(f"[InsightEngine] Metric discovery failed for org {self.org_id}: {e}")
        return metrics

    def _find_date_col(self, schema) -> Optional[str]:
        for col_name, _ in schema:
            if any(kw in col_name.lower() for kw in DATE_KEYWORDS):
                return col_name
        return None

    # ─────────────────────────────────────────────
    # BASELINE COMPARISON
    # ─────────────────────────────────────────────

    def _get_recent_value(self, table: str, column: str, date_col: Optional[str]) -> Optional[float]:
        """24-hour average for the metric."""
        try:
            if date_col:
                sql = f'SELECT AVG("{column}") as val FROM "{table}" WHERE "{date_col}" >= date(\'now\', \'-1 day\') AND "{column}" IS NOT NULL'
            else:
                sql = f'SELECT AVG("{column}") as val FROM "{table}" WHERE "{column}" IS NOT NULL'
            result = self.db.execute_query(sql)
            if result and result[0].get("val") is not None:
                return float(result[0]["val"])
        except Exception as e:
            logger.debug(f"[InsightEngine] recent_value failed {table}.{column}: {e}")
        return None

    def _get_baseline_value(self, table: str, column: str, date_col: Optional[str]) -> Optional[float]:
        """Rolling N-day average (excluding last 24h) as baseline."""
        try:
            if date_col:
                sql = f'SELECT AVG("{column}") as val FROM "{table}" WHERE "{date_col}" >= date(\'now\', \'-{self.lookback_days} days\') AND "{date_col}" < date(\'now\', \'-1 day\') AND "{column}" IS NOT NULL'
            else:
                sql = f'SELECT AVG("{column}") as val FROM "{table}" WHERE "{column}" IS NOT NULL'
            result = self.db.execute_query(sql)
            if result and result[0].get("val") is not None:
                return float(result[0]["val"])
        except Exception as e:
            logger.debug(f"[InsightEngine] baseline_value failed {table}.{column}: {e}")
        return None

    # ─────────────────────────────────────────────
    # AI EXPLANATION
    # ─────────────────────────────────────────────

    def _explain_anomaly(self, metric: dict, change_pct: float) -> dict:
        """
        Call the AnalyticsAgent Investigation root cause.
        Returns a structured explanation dict.
        """
        direction = "increased" if change_pct > 0 else "dropped"
        abs_pct = abs(change_pct)

        prompt = (
            f"INTERNAL ANALYSIS — DO NOT SHOW SQL.\n\n"
            f"ANOMALY DETECTED: '{metric['column']}' in table '{metric['table']}' "
            f"has {direction} by {abs_pct:.1f}% compared to the {self.lookback_days}-day average.\n\n"
            f"Investigate silently by:\n"
            f"1. Checking if specific segments (categories, regions, products) drove the change\n"
            f"2. Looking for correlated columns that changed simultaneously\n"
            f"3. Checking for data quality issues (nulls, duplicates, outliers)\n"
            f"4. Identifying when the change started\n\n"
            f"Respond ONLY in this JSON format:\n"
            f'{{"headline":"one-line description","explanation":"2-3 sentences",'
            f'"likely_causes":["cause 1","cause 2"],"severity":"high|medium|low",'
            f'"recommended_action":"one actionable step"}}'
        )

        try:
            # Note: AnalyticsAgent.run_query is sync in this codebase
            result = self.agent.run_query(prompt, history=[])
            text = result.get("text", "")
            start, end = text.find("{"), text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
        except Exception as e:
            logger.warning(f"[InsightEngine] explain_anomaly LLM failed: {e}")

        # Fallback — return basic explanation without AI
        direction_word = "increased" if change_pct > 0 else "decreased"
        return {
            "headline": f"{metric['column']} {direction_word} by {abs(change_pct):.1f}%",
            "explanation": (
                f"Significant change detected in {metric['column']} "
                f"({direction_word} {abs(change_pct):.1f}% vs {self.lookback_days}-day average)."
            ),
            "likely_causes": ["Investigate data for root cause"],
            "severity": "high" if abs(change_pct) > 25 else "medium",
            "recommended_action": f"Query '{metric['column']}' broken down by key dimensions.",
        }

    # ─────────────────────────────────────────────
    # STORAGE
    # ─────────────────────────────────────────────

    def _store_insight(self, metric: dict, change_pct: float, explanation: dict):
        insight_id = str(uuid.uuid4())
        try:
            with _admin_conn() as c:
                c.execute("""
                    INSERT INTO org_insights
                    (id, org_id, metric_table, metric_column, change_pct, period,
                     headline, explanation, likely_causes, severity, seen, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """, [
                    insight_id, self.org_id,
                    metric["table"], metric["column"],
                    round(change_pct, 2),
                    f"Last 24h vs {self.lookback_days}-day avg",
                    explanation.get("headline", ""),
                    explanation.get("explanation", ""),
                    json.dumps(explanation.get("likely_causes", [])),
                    explanation.get("severity", "medium"),
                    datetime.utcnow().isoformat(),
                ])

                # Trim to max_stored
                c.execute("""
                    DELETE FROM org_insights
                    WHERE org_id = ? AND id NOT IN (
                        SELECT id FROM org_insights WHERE org_id = ?
                        ORDER BY created_at DESC LIMIT ?
                    )
                """, [self.org_id, self.org_id, self.max_stored])
        except Exception as e:
            logger.error(f"[InsightEngine] Failed to store insight for org {self.org_id}: {e}")

    # ─────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────

    def run_watchdog(self):
        """
        Main detection loop. Discovers KPI metrics, compares vs baseline,
        calls AI explanation for anomalies, stores results.
        """
        logger.info(f"[InsightEngine] Running watchdog for org {self.org_id}")
        metrics = self._discover_key_metrics()

        for metric in metrics:
            try:
                recent = self._get_recent_value(
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
                        f"changed {change_pct:.1f}% in org {self.org_id}"
                    )
                    explanation = self._explain_anomaly(metric, change_pct)
                    self._store_insight(metric, change_pct, explanation)

            except Exception as e:
                logger.warning(f"[InsightEngine] Watchdog check failed for {metric}: {e}")

    def get_unseen_insights(self) -> list[dict]:
        with _admin_conn() as c:
            rows = c.execute("""
                SELECT id, metric_table, metric_column, change_pct, period,
                       headline, explanation, likely_causes, severity, created_at
                FROM org_insights
                WHERE org_id = ? AND seen = 0
                ORDER BY created_at DESC
            """, [self.org_id]).fetchall()
        return [self._parse_insight(dict(r)) for r in rows]

    def get_all_insights(self, limit: int = 20) -> list[dict]:
        with _admin_conn() as c:
            rows = c.execute("""
                SELECT id, metric_table, metric_column, change_pct, period,
                       headline, explanation, likely_causes, severity, seen, created_at
                FROM org_insights
                WHERE org_id = ? ORDER BY created_at DESC LIMIT ?
            """, [self.org_id, limit]).fetchall()
        return [self._parse_insight(dict(r)) for r in rows]

    def mark_seen(self, insight_id: str):
        with _admin_conn() as c:
            c.execute(
                "UPDATE org_insights SET seen=1 WHERE id=? AND org_id=?",
                [insight_id, self.org_id]
            )

    def mark_all_seen(self):
        with _admin_conn() as c:
            c.execute("UPDATE org_insights SET seen=1 WHERE org_id=?", [self.org_id])

    def _parse_insight(self, row: dict) -> dict:
        row["likely_causes"] = json.loads(row.get("likely_causes") or "[]")
        return row


# ─────────────────────────────────────────────────────────────────────────────
# InsightScheduler — background loop for all orgs
# ─────────────────────────────────────────────────────────────────────────────

class InsightScheduler:
    """
    Background asyncio task that runs InsightEngine for all orgs
    on a configurable interval.
    """

    def __init__(self, engine_factory, interval_minutes: int = 60):
        """
        Args:
            engine_factory: callable(org_id) -> InsightEngine
            interval_minutes: How often to run the watchdog
        """
        self.engine_factory = engine_factory
        self.interval_minutes = interval_minutes
        self._running = False
        self._task = None

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop())
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
        """Run watchdog for every registered org with a configured DB."""
        try:
            with _admin_conn() as c:
                orgs = c.execute(
                    "SELECT id FROM organizations WHERE db_connection_string IS NOT NULL"
                ).fetchall()

            for org_row in orgs:
                if not self._running:
                    break
                org_id = org_row["id"]
                try:
                    engine = self.engine_factory(org_id)
                    if engine:
                        # Run blocking watchdog in threadpool to avoid blocking event loop
                        await asyncio.get_event_loop().run_in_executor(None, engine.run_watchdog)
                except Exception as e:
                    logger.error(f"[InsightScheduler] Watchdog failed for org {org_id}: {e}")

        except Exception as e:
            logger.error(f"[InsightScheduler] Loop error: {e}")
