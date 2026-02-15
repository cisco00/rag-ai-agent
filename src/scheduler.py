
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
import asyncio
import os

from models import get_db, ScheduledReport, Organization
from main import AnalyticsAgent
from utils import send_email_mock

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

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

def execute_scheduled_report(report_id: int):
    """
    Execute a single scheduled report.
    This function is called by the scheduler.
    """
    logger.info(f"Executing scheduled report {report_id}")
    
    try:
        # Create a new DB session
        with get_db() as db:
            report = db.query(ScheduledReport).filter(ScheduledReport.id == report_id).first()
            if not report or not report.is_active:
                logger.warning(f"Report {report_id} not found or inactive")
                return

            org = db.query(Organization).filter(Organization.id == report.org_id).first()
            if not org:
                logger.error(f"Organization {report.org_id} not found for report {report_id}")
                return
            
            # Setup Analytics Agent with Org's DB
            # Note: We need to handle the case where db_connection_string is None
            if not org.db_connection_string:
                logger.warning(f"No DB configured for org {org.name}, skipping report")
                return

            with AnalyticsAgent(org.db_connection_string) as agent:
                # Run the query
                # AnalyticsAgent.run_query is synchronous
                result = agent.run_query(report.query)
                
                # Format Email Body
                subject = f"Bi-Weekly Insight: {report.query}"
                body = f"""
                Hello,
                
                Here is your scheduled analysis for: "{report.query}"
                
                Analysis:
                {result['text']}
                
                Generated at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}
                """
                
                # Send Emails
                recipients = report.recipients.split(',')
                for email in recipients:
                    email = email.strip()
                    if email:
                        send_email_mock(email, subject, body)
                
                # Update next_run_at
                if report.frequency == 'daily':
                    report.next_run_at += timedelta(days=1)
                elif report.frequency == 'weekly':
                    report.next_run_at += timedelta(weeks=1)
                elif report.frequency == 'biweekly':
                    report.next_run_at += timedelta(weeks=2)
                elif report.frequency == 'monthly':
                    report.next_run_at += timedelta(days=30) # Approx
                
                db.commit()
                logger.info(f"Report {report_id} executed successfully. Next run: {report.next_run_at}")
                
                # Schedule the next run
                schedule_job_for_report(report.id, report.next_run_at)

    except Exception as e:
        logger.error(f"Error executing report {report_id}: {e}", exc_info=True)

def schedule_job_for_report(report_id: int, run_date: datetime):
    """
    Add a job to the scheduler.
    """
    scheduler.add_job(
        execute_scheduled_report, 
        'date', 
        run_date=run_date, 
        args=[report_id],
        id=f"report_{report_id}",
        replace_existing=True,
        misfire_grace_time=None
    )
    logger.info(f"Scheduled job for report {report_id} at {run_date}")

def refresh_jobs():
    """
    Load all active jobs from DB and schedule them.
    Should be called on startup.
    """
    logger.info("Refreshing scheduled jobs from database")
    try:
        with get_db() as db:
            reports = db.query(ScheduledReport).filter(
                ScheduledReport.is_active == 1
            ).all()
            
            for report in reports:
                schedule_job_for_report(report.id, report.next_run_at)
                
            logger.info(f"Loaded {len(reports)} scheduled jobs")
    except Exception as e:
        logger.error(f"Failed to refresh jobs: {e}", exc_info=True)
