
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
import asyncio
import os

from models import get_db, ScheduledReport, Organization, DataSource, update_data_source_sync
from email_service import send_scheduled_report_email
from org_context_manager import OrgContextManager
from database import DatabaseManager
import httpx
import pandas as pd
import json

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

def execute_data_source_sync(source_id: int):
    """
    Background job to synchronize a data source (e.g., API refresh).
    """
    logger.info(f"Starting background sync for DataSource {source_id}")
    
    try:
        with get_db() as db:
            source = db.query(DataSource).filter(DataSource.id == source_id).first()
            if not source or not source.is_active:
                logger.warning(f"DataSource {source_id} not found or inactive")
                return
            
            org = db.query(Organization).filter(Organization.id == source.org_id).first()
            if not org or not org.db_connection_string:
                logger.error(f"Organization or DB connection missing for DataSource {source_id}")
                return
            
            details = json.loads(source.connection_details)
            
            if source.source_type == 'api':
                url = details.get('url')
                method = details.get('method', 'GET')
                headers = details.get('headers')
                params = details.get('params')
                
                # Fetch fresh data
                with httpx.Client() as client:
                    resp = client.request(method, url, headers=headers, params=params, timeout=60.0)
                    resp.raise_for_status()
                    data = resp.json()
                
                # Convert to DataFrame
                if isinstance(data, list):
                    df = pd.DataFrame(data)
                elif isinstance(data, dict):
                    found_list = False
                    for key, val in data.items():
                        if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                            df = pd.DataFrame(val)
                            found_list = True
                            break
                    if not found_list:
                         df = pd.DataFrame([data])
                else:
                     logger.error(f"Could not parse API data for Source {source_id}")
                     return

                # Update database
                db_manager = DatabaseManager(connection_string=org.db_connection_string)
                success = db_manager.load_dataframe(df, source.table_name, if_exists='replace')
                db_manager.close()
                
                if success:
                    update_data_source_sync(source.id, datetime.utcnow())
                    logger.info(f"Successfully synced DataSource {source_id} to table '{source.table_name}'")
                else:
                    logger.error(f"Failed to load synced data for Source {source_id}")

            # Schedule next run
            if source.refresh_interval:
                next_run = datetime.utcnow() + timedelta(minutes=source.refresh_interval)
                schedule_job_for_source(source.id, next_run)

    except Exception as e:
        logger.error(f"Error syncing DataSource {source_id}: {e}", exc_info=True)

def schedule_job_for_source(source_id: int, run_date: datetime):
    """Schedule a data source sync job."""
    scheduler.add_job(
        execute_data_source_sync,
        'date',
        run_date=run_date,
        args=[source_id],
        id=f"source_sync_{source_id}",
        replace_existing=True,
        misfire_grace_time=None
    )
    logger.info(f"Scheduled sync for DataSource {source_id} at {run_date}")

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
            
            # Load and schedule data source syncs
            sources = db.query(DataSource).filter(
                DataSource.is_active == 1,
                DataSource.refresh_interval != None
            ).all()

            for source in sources:
                # If never synced, sync now. Otherwise schedule based on interval.
                if not source.last_synced_at:
                    run_at = datetime.utcnow() + timedelta(seconds=10)
                else:
                    run_at = source.last_synced_at + timedelta(minutes=source.refresh_interval)
                    if run_at < datetime.utcnow():
                        run_at = datetime.utcnow() + timedelta(seconds=10)
                
                schedule_job_for_source(source.id, run_at)
                
            logger.info(f"Loaded {len(reports)} reports and {len(sources)} data source syncs")
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
