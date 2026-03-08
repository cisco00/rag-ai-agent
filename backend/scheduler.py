import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import asyncio
import json
import os

from models import (
    get_db, ScheduledReport, Organization,
    ScheduledSync, get_active_syncs, update_sync_run_status, touch_table_freshness,
)
from main import AnalyticsAgent
from utils import send_email_mock

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


# ─── Lifecycle ────────────────────────────────────────────────────────────────

def start_scheduler():
    """Start the background scheduler."""
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def shutdown_scheduler():
    """Shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler shutdown")


# ─── Scheduled reports ────────────────────────────────────────────────────────

def execute_scheduled_report(report_id: int):
    """Execute a single scheduled report and email the result."""
    logger.info(f"Executing scheduled report {report_id}")

    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(ScheduledReport.id == report_id).first()
            if not report or not report.is_active:
                logger.warning(f"Report {report_id} not found or inactive")
                return

            org = db.query(Organization).filter(Organization.id == report.org_id).first()
            if not org:
                logger.error(f"Organization {report.org_id} not found for report {report_id}")
                return

            if not org.db_connection_string:
                logger.warning(f"No DB configured for org {org.name}, skipping report")
                return

            with AnalyticsAgent(connection_string=org.db_connection_string) as agent:
                result = agent.run_query(report.query)

                subject = f"Scheduled Report: {report.query}"
                body = (
                    f"Hello,\n\n"
                    f"Here is your scheduled analysis for: \"{report.query}\"\n\n"
                    f"Analysis:\n{result['text']}\n\n"
                    f"Generated at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
                )

                for email in report.recipients.split(','):
                    email = email.strip()
                    if email:
                        send_email_mock(email, subject, body)

                # Advance next_run_at
                freq_map = {
                    'daily':    timedelta(days=1),
                    'weekly':   timedelta(weeks=1),
                    'biweekly': timedelta(weeks=2),
                    'monthly':  timedelta(days=30),
                }
                delta = freq_map.get(report.frequency, timedelta(weeks=2))
                report.next_run_at += delta
                db.commit()
                logger.info(f"Report {report_id} done. Next run: {report.next_run_at}")
                schedule_job_for_report(report.id, report.next_run_at)

    except Exception as e:
        logger.error(f"Error executing report {report_id}: {e}", exc_info=True)


def schedule_job_for_report(report_id: int, run_date: datetime):
    """Schedule a one-shot job for a report at run_date."""
    scheduler.add_job(
        execute_scheduled_report,
        'date',
        run_date=run_date,
        args=[report_id],
        id=f"report_{report_id}",
        replace_existing=True,
        misfire_grace_time=None,
    )
    logger.info(f"Scheduled report job {report_id} at {run_date}")


def refresh_jobs():
    """Load all active scheduled reports and syncs from DB on startup."""
    logger.info("Refreshing scheduled jobs from database")
    try:
        with get_db() as db:
            reports = db.query(ScheduledReport).filter(ScheduledReport.is_active == 1).all()
            for report in reports:
                schedule_job_for_report(report.id, report.next_run_at)
            logger.info(f"Loaded {len(reports)} report jobs")
    except Exception as e:
        logger.error(f"Failed to refresh report jobs: {e}", exc_info=True)

    try:
        syncs = get_active_syncs()
        for sync in syncs:
            register_sync_job(sync)
        logger.info(f"Loaded {len(syncs)} sync jobs")
    except Exception as e:
        logger.error(f"Failed to refresh sync jobs: {e}", exc_info=True)


# ─── Scheduled data syncs ─────────────────────────────────────────────────────

def execute_scheduled_sync(sync_id: int):
    """
    Pull data from an external URL and load it into the org's database.

    Load strategies:
      if_exists='replace'             → full table replace each run
      if_exists='append'              → plain append
      if_exists='append'+dedup_column → append then deduplicate (idempotent)
    """
    logger.info(f"Executing scheduled sync {sync_id}")

    try:
        syncs = get_active_syncs()
        sync  = next((s for s in syncs if s.id == sync_id), None)

        if not sync:
            logger.warning(f"Sync {sync_id} not found or inactive")
            return

        # Fetch the org's connection string
        with get_db() as db:
            org = db.query(Organization).filter(Organization.id == sync.org_id).first()
            if not org or not org.db_connection_string:
                logger.warning(f"Org {sync.org_id} has no DB for sync {sync_id}")
                update_sync_run_status(sync_id, "error", "No database configured for org")
                return
            conn_str = org.db_connection_string

        # HTTP fetch — use requests (sync context, no async)
        import requests
        headers = sync.get_headers()
        params  = sync.get_params()

        resp = requests.request(
            method=sync.method or "GET",
            url=sync.url,
            headers=headers,
            params=params,
            timeout=30,
            allow_redirects=False,
        )
        resp.raise_for_status()
        raw = resp.json()

        # Normalise to list of dicts
        import pandas as pd
        if isinstance(raw, list):
            rows = raw
        elif isinstance(raw, dict):
            rows = next(
                (v for v in raw.values()
                 if isinstance(v, list) and v and isinstance(v[0], dict)),
                [raw],
            )
        else:
            raise ValueError(f"Cannot parse API response as tabular data: {type(raw)}")

        df = pd.DataFrame(rows)
        if df.empty:
            logger.info(f"Sync {sync_id}: API returned 0 rows, skipping write")
            update_sync_run_status(sync_id, "success")
            return

        # Write to org DB
        from database import DatabaseManager
        from sqlalchemy import text

        dm     = DatabaseManager(connection_string=conn_str)
        engine = dm.get_engine()
        try:
            if_exists    = sync.if_exists or "replace"
            dedup_column = sync.dedup_column

            if if_exists == "replace" or not dedup_column:
                df.to_sql(sync.table_name, engine, if_exists=if_exists, index=False)
                row_count = len(df)
            else:
                # Append then deduplicate — idempotent
                df.to_sql(sync.table_name, engine, if_exists="append", index=False)
                dialect = engine.dialect.name
                with engine.connect() as conn:
                    with conn.begin():
                        if dialect == "postgresql":
                            conn.execute(text(f"""
                                DELETE FROM "{sync.table_name}" a
                                USING "{sync.table_name}" b
                                WHERE a.ctid < b.ctid
                                  AND a."{dedup_column}" = b."{dedup_column}"
                            """))
                        else:
                            conn.execute(text(f"""
                                DELETE FROM "{sync.table_name}"
                                WHERE rowid NOT IN (
                                    SELECT MAX(rowid) FROM "{sync.table_name}"
                                    GROUP BY "{dedup_column}"
                                )
                            """))
                    row_count = conn.execute(
                        text(f'SELECT COUNT(*) FROM "{sync.table_name}"')
                    ).scalar()
        finally:
            dm.close()

        touch_table_freshness(
            org_id=sync.org_id,
            table_name=sync.table_name,
            source="sync",
            row_count=row_count,
        )
        update_sync_run_status(sync_id, "success")
        logger.info(
            f"Sync {sync_id} complete: {len(df)} rows fetched, "
            f"{row_count} rows in '{sync.table_name}'"
        )

    except Exception as e:
        logger.error(f"Sync {sync_id} failed: {e}", exc_info=True)
        update_sync_run_status(sync_id, "error", str(e))


def _parse_cron(cron_expr: str) -> CronTrigger:
    """
    Parse a 5-field cron expression into an APScheduler CronTrigger.
    Fields: minute hour day_of_month month day_of_week
    """
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Cron expression must have 5 fields, got: {cron_expr!r}")
    minute, hour, day, month, dow = parts
    return CronTrigger(
        minute=minute, hour=hour,
        day=day, month=month, day_of_week=dow,
    )


def register_sync_job(sync: ScheduledSync):
    """Add or replace a sync job in APScheduler."""
    try:
        trigger = _parse_cron(sync.cron_expr)
        scheduler.add_job(
            execute_scheduled_sync,
            trigger=trigger,
            args=[sync.id],
            id=f"sync_{sync.id}",
            replace_existing=True,
            misfire_grace_time=60,
        )
        logger.info(f"Registered sync job {sync.id} ({sync.name}) cron='{sync.cron_expr}'")
    except Exception as e:
        logger.error(f"Failed to register sync job {sync.id}: {e}", exc_info=True)


def unregister_sync_job(sync_id: int):
    """Remove a sync job from APScheduler."""
    job_id = f"sync_{sync_id}"
    try:
        scheduler.remove_job(job_id)
        logger.info(f"Removed sync job {job_id}")
    except Exception:
        pass  # Job may not be registered; not an error