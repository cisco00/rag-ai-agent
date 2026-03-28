
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
import asyncio
import os

from models import get_db, ScheduledReport, Organization
from email_service import send_scheduled_report_email
from org_context_manager import OrgContextManager

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

            from main import AnalyticsAgent
            with AnalyticsAgent(connection_string=org.db_connection_string) as agent:
                # Run the query
                # AnalyticsAgent.run_query is synchronous
                result = agent.run_query(report.query)
                
                # Send styled HTML report emails
                recipients = report.recipients.split(',')
                for email in recipients:
                    email = email.strip()
                    if email:
                        send_scheduled_report_email(
                            to_email=email,
                            query=report.query,
                            analysis=result['text'],
                            frequency=report.frequency,
                        )
                
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

def run_organizational_learning():
    """
    Background job to process pending user corrections across all organizations.
    This allows the AI to learn from feedback automatically.
    """
    logger.info("Running scheduled organizational learning task")
    try:
        from main import AnalyticsAgent
        from config import get_agent_config
        
        # Get main event loop for async processing
        import asyncio
        import api
        loop = getattr(api, "_main_loop", None)
        if not loop:
             try:
                 loop = asyncio.get_running_loop()
             except RuntimeError:
                 logger.error("Could not get running event loop for organizational learning")
                 return

        with get_db() as db:
            orgs = db.query(Organization).all()
            for org in orgs:
                try:
                    # Initialize OrgContextManager
                    # We need an LLM caller. We'll use a temporary AnalyticsAgent for this.
                    # This ensures we use the correct LLM provider and token.
                    context_manager = OrgContextManager(org.id)
                    
                    # Define an LLM caller that OrgContextManager can use
                    async def llm_caller(prompt: str) -> str:
                        # Use a dedicated AnalyticsAgent to get a configured LLM client
                        # We don't necessarily need a database connection for just LLM calls,
                        # but AnalyticsAgent requires it. We'll use the org's connection if available.
                        with AnalyticsAgent(connection_string=org.db_connection_string) as agent:
                            response = agent.client.chat_completion(
                                model=agent.config.model_name,
                                messages=[{"role": "user", "content": prompt}]
                            )
                            return response.choices[0].message.content

                    context_manager.llm_caller = llm_caller
                    
                    # Process corrections async
                    # We use run_coroutine_threadsafe because APScheduler runs in threads
                    future = asyncio.run_coroutine_threadsafe(
                        context_manager.process_pending_corrections(), 
                        loop
                    )
                    # We don't strictly need to wait for the result here if we want it completely backgrounded,
                    # but waiting (with timeout) lets us log progress.
                    processed_count = future.result(timeout=60)
                    if processed_count > 0:
                        logger.info(f"Org {org.id}: Processed {processed_count} corrections")
                        
                except Exception as org_exc:
                    logger.error(f"Failed learning for org {org.id}: {org_exc}")
                    
    except Exception as e:
        logger.error(f"Error in organizational learning background job: {e}", exc_info=True)
