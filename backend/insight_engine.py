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
    Create org_insights and org_insight_suppressions tables in the admin DB.
    Uses SQLAlchemy so it works for both SQLite and PostgreSQL.
    Call from lifespan startup in api.py.
    """
    engine = _get_admin_engine()
    dialect = engine.dialect.name

    if dialect == "postgresql":
        insights_ddl = """
            CREATE TABLE IF NOT EXISTS org_insights (
                id                 TEXT PRIMARY KEY,
                org_id             INTEGER NOT NULL,
                metric_table       TEXT,
                metric_column      TEXT,
                change_pct         DOUBLE PRECISION,
                period             TEXT,
                headline           TEXT,
                explanation        TEXT,
                likely_causes      TEXT,
                recommended_action TEXT,
                severity           TEXT DEFAULT 'medium',
                seen               INTEGER DEFAULT 0,
                notification_sent  INTEGER DEFAULT 0,
                created_at         TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_org_insights_org_id ON org_insights (org_id);
            CREATE INDEX IF NOT EXISTS ix_org_insights_metric ON org_insights (org_id, metric_table, metric_column);
        """
        suppressions_ddl = """
            CREATE TABLE IF NOT EXISTS org_insight_suppressions (
                id             SERIAL PRIMARY KEY,
                org_id         INTEGER NOT NULL,
                metric_table   TEXT NOT NULL,
                metric_column  TEXT NOT NULL,
                created_at     TEXT,
                UNIQUE (org_id, metric_table, metric_column)
            );
            CREATE INDEX IF NOT EXISTS ix_suppressions_org ON org_insight_suppressions (org_id);
        """
        # Add insight_threshold_pct to organizations if it doesn't exist
        threshold_migration = """
            ALTER TABLE organizations ADD COLUMN IF NOT EXISTS insight_threshold_pct DOUBLE PRECISION DEFAULT 10.0;
        """
    else:
        insights_ddl = """
            CREATE TABLE IF NOT EXISTS org_insights (
                id                 TEXT PRIMARY KEY,
                org_id             INTEGER NOT NULL,
                metric_table       TEXT,
                metric_column      TEXT,
                change_pct         REAL,
                period             TEXT,
                headline           TEXT,
                explanation        TEXT,
                likely_causes      TEXT,
                recommended_action TEXT,
                severity           TEXT DEFAULT 'medium',
                seen               INTEGER DEFAULT 0,
                notification_sent  INTEGER DEFAULT 0,
                created_at         TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_org_insights_org_id ON org_insights (org_id);
            CREATE INDEX IF NOT EXISTS ix_org_insights_metric ON org_insights (org_id, metric_table, metric_column);
        """
        suppressions_ddl = """
            CREATE TABLE IF NOT EXISTS org_insight_suppressions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id         INTEGER NOT NULL,
                metric_table   TEXT NOT NULL,
                metric_column  TEXT NOT NULL,
                created_at     TEXT,
                UNIQUE (org_id, metric_table, metric_column)
            );
            CREATE INDEX IF NOT EXISTS ix_suppressions_org ON org_insight_suppressions (org_id);
        """
        threshold_migration = None  # SQLite handled below with try/except

    # Migrate existing installs: add columns that may be absent in older schema
    with engine.connect() as conn:
        with conn.begin():
            for col, col_type in [
                ("recommended_action", "TEXT"),
                ("notification_sent", "INTEGER DEFAULT 0"),
            ]:
                try:
                    conn.execute(text(
                        f"ALTER TABLE org_insights ADD COLUMN {col} {col_type}"
                    ))
                except Exception:
                    pass  # Column already exists

            # Add insight_threshold_pct to organizations (SQLite — try/except)
            if dialect != "postgresql":
                try:
                    conn.execute(text(
                        "ALTER TABLE organizations ADD COLUMN insight_threshold_pct REAL DEFAULT 10.0"
                    ))
                except Exception:
                    pass

    # Create/update tables
    all_ddl = insights_ddl + suppressions_ddl
    if threshold_migration:
        all_ddl += threshold_migration

    with engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in all_ddl.strip().split(";") if s.strip()]:
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
                # No date column: use the last 20% of rows as a "recent" proxy.
                if self._is_postgres():
                    sql = (
                        f'SELECT AVG("{column}") AS val FROM ('
                        f'  SELECT "{column}" FROM "{table}" '
                        f'  WHERE "{column}" IS NOT NULL '
                        f'  ORDER BY ctid DESC '
                        f'  LIMIT (SELECT GREATEST(1, FLOOR(COUNT(*) * 0.2)) FROM "{table}")'
                        f') sub'
                    )
                else:
                    sql = (
                        f'SELECT AVG("{column}") AS val FROM ('
                        f'  SELECT "{column}" FROM "{table}" '
                        f'  WHERE "{column}" IS NOT NULL '
                        f'  ORDER BY rowid DESC '
                        f'  LIMIT (SELECT MAX(1, CAST(COUNT(*) * 0.2 AS INTEGER)) FROM "{table}")'
                        f') sub'
                    )
            result = self.db.execute_query(sql, allow_modifications=False)

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
        """Rolling N-day average (excluding last 24 h) as baseline.

        When no date column exists we use the bottom 80 % of rows (by rowid /
        ctid) as the historical baseline and the top 20 % as "recent".  This
        avoids the degenerate case where both queries return the full-table
        average and the change_pct is always 0.
        """
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
                # No date column: use the first 80% of rows as "historical" baseline.
                # _get_recent_value (no date_col) uses the last 20% via OFFSET.
                if self._is_postgres():
                    sql = (
                        f'SELECT AVG("{column}") AS val FROM ('
                        f'  SELECT "{column}" FROM "{table}" '
                        f'  WHERE "{column}" IS NOT NULL '
                        f'  ORDER BY ctid '
                        f'  LIMIT (SELECT FLOOR(COUNT(*) * 0.8) FROM "{table}")'
                        f') sub'
                    )
                else:
                    sql = (
                        f'SELECT AVG("{column}") AS val FROM ('
                        f'  SELECT "{column}" FROM "{table}" '
                        f'  WHERE "{column}" IS NOT NULL '
                        f'  ORDER BY rowid '
                        f'  LIMIT (SELECT CAST(COUNT(*) * 0.8 AS INTEGER) FROM "{table}")'
                        f') sub'
                    )
            result = self.db.execute_query(sql, allow_modifications=False)
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

    def _has_recent_duplicate(self, table: str, column: str, hours: int = 24) -> bool:
        """Return True if an unseen insight for this metric was stored in the last N hours."""
        engine = _get_admin_engine()
        dialect = engine.dialect.name
        try:
            with engine.connect() as conn:
                if dialect == "postgresql":
                    cutoff_expr = f"CURRENT_TIMESTAMP - INTERVAL '{hours} hours'"
                else:
                    cutoff_expr = f"datetime('now', '-{hours} hours')"
                row = conn.execute(text(f"""
                    SELECT 1 FROM org_insights
                    WHERE org_id       = :org_id
                      AND metric_table  = :table
                      AND metric_column = :column
                      AND seen          = 0
                      AND created_at   >= {cutoff_expr}
                    LIMIT 1
                """), {"org_id": self.org_id, "table": table, "column": column}).fetchone()
                return row is not None
        except Exception:
            return False

    def _get_org_admin_email(self) -> Optional[str]:
        """
        Return an email address for the org's owner/admin to send alerts to.
        Preference order: organizations.email → oldest owner in users table → oldest admin.
        """
        engine = _get_admin_engine()
        try:
            with engine.connect() as conn:
                # 1. Check org-level contact email
                row = conn.execute(
                    text("SELECT email FROM organizations WHERE id = :org_id"),
                    {"org_id": self.org_id},
                ).mappings().first()
                if row and row["email"]:
                    return row["email"]

                # 2. Fall back to oldest owner in the users table
                row = conn.execute(
                    text(
                        "SELECT email FROM users "
                        "WHERE org_id = :org_id AND is_active = 1 "
                        "AND role IN ('owner', 'admin') "
                        "ORDER BY created_at ASC LIMIT 1"
                    ),
                    {"org_id": self.org_id},
                ).mappings().first()
                if row:
                    return row["email"]
        except Exception as exc:
            logger.debug(f"[InsightEngine] Could not get org admin email: {exc}")
        return None

    def _store_insight(self, metric: dict, change_pct: float, explanation: dict):
        insight_id = str(uuid.uuid4())
        engine     = _get_admin_engine()
        severity   = explanation.get("severity", "medium")
        try:
            with engine.connect() as conn:
                with conn.begin():
                    conn.execute(text("""
                        INSERT INTO org_insights
                            (id, org_id, metric_table, metric_column, change_pct,
                             period, headline, explanation, likely_causes,
                             recommended_action, severity, seen, notification_sent, created_at)
                        VALUES
                            (:id, :org_id, :metric_table, :metric_column, :change_pct,
                             :period, :headline, :explanation, :likely_causes,
                             :recommended_action, :severity, 0, 0, :created_at)
                    """), {
                        "id":                 insight_id,
                        "org_id":             self.org_id,
                        "metric_table":       metric["table"],
                        "metric_column":      metric["column"],
                        "change_pct":         round(change_pct, 2),
                        "period":             f"Last 24h vs {self.lookback_days}-day avg",
                        "headline":           explanation.get("headline", ""),
                        "explanation":        explanation.get("explanation", ""),
                        "likely_causes":      json.dumps(explanation.get("likely_causes", [])),
                        "recommended_action": explanation.get("recommended_action", ""),
                        "severity":           severity,
                        "created_at":         datetime.utcnow().isoformat(),
                    })

                    # Trim to max_stored per org (same SQL works for both dialects)
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

            # Send email alert for high-severity insights
            if severity == "high":
                self._send_insight_alert(insight_id, metric, change_pct, explanation)

        except Exception as exc:
            logger.error(
                f"[InsightEngine] Failed to store insight for org {self.org_id}: {exc}"
            )

    def _send_insight_alert(
        self,
        insight_id: str,
        metric: dict,
        change_pct: float,
        explanation: dict,
    ):
        """Email the org admin when a high-severity insight is stored."""
        try:
            admin_email = self._get_org_admin_email()
            if not admin_email:
                logger.debug(
                    f"[InsightEngine] No admin email for org {self.org_id} — skipping alert"
                )
                return

            from email_service import send_insight_alert_email
            engine = _get_admin_engine()
            with engine.connect() as conn:
                row = conn.execute(
                    text("SELECT name FROM organizations WHERE id = :org_id"),
                    {"org_id": self.org_id},
                ).mappings().first()
            org_name = row["name"] if row else f"Org {self.org_id}"

            sent = send_insight_alert_email(
                to_email=admin_email,
                org_name=org_name,
                headline=explanation.get("headline", ""),
                metric=metric["column"],
                table_name=metric["table"],
                change_pct=change_pct,
                explanation=explanation.get("explanation", ""),
                recommended_action=explanation.get("recommended_action"),
            )

            if sent:
                # Mark notification as sent so we don't re-send if the row survives
                admin_engine = _get_admin_engine()
                with admin_engine.connect() as conn:
                    with conn.begin():
                        conn.execute(
                            text(
                                "UPDATE org_insights SET notification_sent = 1 "
                                "WHERE id = :id AND org_id = :org_id"
                            ),
                            {"id": insight_id, "org_id": self.org_id},
                        )
                logger.info(
                    f"[InsightEngine] Alert email sent → {admin_email} for insight {insight_id}"
                )
        except Exception as exc:
            logger.warning(f"[InsightEngine] Alert email failed: {exc}")

    # ── Suppression ───────────────────────────────────────────────────────────────

    def _get_suppressed_metrics(self) -> set:
        """Return set of (table, column) tuples suppressed for this org."""
        engine = _get_admin_engine()
        try:
            with engine.connect() as conn:
                rows = conn.execute(
                    text(
                        "SELECT metric_table, metric_column "
                        "FROM org_insight_suppressions WHERE org_id = :org_id"
                    ),
                    {"org_id": self.org_id},
                ).fetchall()
            return {(r[0], r[1]) for r in rows}
        except Exception:
            return set()

    def suppress_metric(self, table: str, column: str):
        """Prevent this table.column from generating future insights."""
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                try:
                    conn.execute(
                        text(
                            "INSERT INTO org_insight_suppressions "
                            "(org_id, metric_table, metric_column, created_at) "
                            "VALUES (:org_id, :table, :column, :ts)"
                        ),
                        {
                            "org_id": self.org_id,
                            "table":  table,
                            "column": column,
                            "ts":     datetime.utcnow().isoformat(),
                        },
                    )
                except Exception:
                    pass  # Already suppressed — UNIQUE constraint violation is fine

    def unsuppress_metric(self, table: str, column: str):
        """Re-enable insights for this table.column."""
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text(
                        "DELETE FROM org_insight_suppressions "
                        "WHERE org_id = :org_id AND metric_table = :table "
                        "AND metric_column = :column"
                    ),
                    {"org_id": self.org_id, "table": table, "column": column},
                )

    def get_suppressions(self) -> list[dict]:
        """Return list of suppressed metrics for this org."""
        engine = _get_admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT metric_table, metric_column, created_at "
                    "FROM org_insight_suppressions WHERE org_id = :org_id "
                    "ORDER BY created_at DESC"
                ),
                {"org_id": self.org_id},
            ).mappings().all()
        return [dict(r) for r in rows]

    # ── Public API ────────────────────────────────────────────────────────────

    # Maximum KPI columns to scan per run (prevents runaway LLM calls on large schemas)
    MAX_METRICS_PER_RUN = 15
    # Auto-expire insights older than this many days
    EXPIRY_DAYS = 30

    def _expire_old_insights(self):
        """Delete insights older than EXPIRY_DAYS for this org."""
        engine = _get_admin_engine()
        dialect = engine.dialect.name
        try:
            with engine.connect() as conn:
                with conn.begin():
                    if dialect == "postgresql":
                        cutoff = f"CURRENT_TIMESTAMP - INTERVAL '{self.EXPIRY_DAYS} days'"
                    else:
                        cutoff = f"datetime('now', '-{self.EXPIRY_DAYS} days')"
                    conn.execute(text(f"""
                        DELETE FROM org_insights
                        WHERE org_id = :org_id AND created_at < {cutoff}
                    """), {"org_id": self.org_id})
        except Exception as exc:
            logger.warning(f"[InsightEngine] Expiry sweep failed for org {self.org_id}: {exc}")

    def run_watchdog(self):
        """Discover KPIs, compare vs baseline, explain anomalies, store results."""
        logger.info(f"[InsightEngine] Running watchdog for org {self.org_id}")

        # Clean up stale insights first
        self._expire_old_insights()

        metrics = self._discover_key_metrics()

        # Cap total metrics per run to avoid runaway LLM costs on large schemas
        if len(metrics) > self.MAX_METRICS_PER_RUN:
            logger.info(
                f"[InsightEngine] Capping metrics from {len(metrics)} to "
                f"{self.MAX_METRICS_PER_RUN} for org {self.org_id}"
            )
            metrics = metrics[:self.MAX_METRICS_PER_RUN]

        # Load suppressed metrics once — avoids repeated DB hits in the loop
        suppressed = self._get_suppressed_metrics()

        for metric in metrics:
            try:
                # Skip suppressed table.column pairs
                if (metric["table"], metric["column"]) in suppressed:
                    logger.debug(
                        f"[InsightEngine] Skipping suppressed metric: "
                        f"{metric['table']}.{metric['column']}"
                    )
                    continue

                # Skip if an unseen insight for this metric was stored in the last 24 h
                if self._has_recent_duplicate(metric["table"], metric["column"]):
                    logger.debug(
                        f"[InsightEngine] Skipping duplicate: "
                        f"{metric['table']}.{metric['column']}"
                    )
                    continue

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

    _SELECT_COLS = """
        id, metric_table, metric_column, change_pct, period,
        headline, explanation, likely_causes, recommended_action,
        severity, seen, created_at
    """

    def _fetch_insights(self, where_extra: str, params: dict) -> list[dict]:
        engine = _get_admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(text(f"""
                SELECT {self._SELECT_COLS}
                FROM org_insights
                WHERE org_id = :org_id {where_extra}
                ORDER BY created_at DESC
                LIMIT 50
            """), params).mappings().all()
        return [self._parse_insight(dict(r)) for r in rows]

    def get_unseen_insights(self) -> list[dict]:
        return self._fetch_insights("AND seen = 0", {"org_id": self.org_id})

    def get_all_insights(self, limit: int = 50) -> list[dict]:
        engine = _get_admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(text(f"""
                SELECT {self._SELECT_COLS}
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

    def get_unseen_count(self) -> int:
        engine = _get_admin_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT COUNT(*) FROM org_insights WHERE org_id = :org_id AND seen = 0"),
                {"org_id": self.org_id},
            ).fetchone()
        return row[0] if row else 0

    def mark_all_seen(self):
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("UPDATE org_insights SET seen=1 WHERE org_id=:org_id"),
                    {"org_id": self.org_id},
                )

    def _parse_insight(self, row: dict) -> dict:
        import math
        row["likely_causes"] = json.loads(row.get("likely_causes") or "[]")
        # Normalise recommended_action: empty string → None so frontend can check truthiness
        if not row.get("recommended_action"):
            row["recommended_action"] = None
        # Guard against NaN/Inf from floating-point edge cases
        if "change_pct" in row and isinstance(row["change_pct"], float):
            if math.isnan(row["change_pct"]) or math.isinf(row["change_pct"]):
                row["change_pct"] = None
        return row

    # ── Threshold settings ────────────────────────────────────────────────────

    def get_settings(self) -> dict:
        """Return current insight settings for this org."""
        engine = _get_admin_engine()
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text(
                        "SELECT insight_threshold_pct FROM organizations WHERE id = :org_id"
                    ),
                    {"org_id": self.org_id},
                ).mappings().first()
            threshold = float(row["insight_threshold_pct"]) if row and row["insight_threshold_pct"] is not None else 10.0
        except Exception:
            threshold = self.threshold_pct
        return {"threshold_pct": threshold}

    def save_settings(self, threshold_pct: float):
        """Persist insight threshold for this org and update the in-memory value."""
        # Clamp to a sensible range
        threshold_pct = max(1.0, min(threshold_pct, 100.0))
        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text(
                        "UPDATE organizations SET insight_threshold_pct = :t WHERE id = :org_id"
                    ),
                    {"t": threshold_pct, "org_id": self.org_id},
                )
        self.threshold_pct = threshold_pct


def get_org_threshold(org_id: int) -> float:
    """
    Read insight_threshold_pct for an org, returning the default if not set.
    Used by InsightScheduler to build the engine with per-org settings.
    """
    engine = _get_admin_engine()
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT insight_threshold_pct FROM organizations WHERE id = :org_id"
                ),
                {"org_id": org_id},
            ).mappings().first()
        if row and row["insight_threshold_pct"] is not None:
            return float(row["insight_threshold_pct"])
    except Exception:
        pass
    return 10.0


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
                    # Pass per-org threshold so each org's setting is respected
                    threshold = get_org_threshold(org_id)
                    engine = self.engine_factory(org_id, threshold_pct=threshold)
                    if engine:
                        try:
                            await asyncio.get_running_loop().run_in_executor(
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