"""
routers/org_context.py — routes migrated from monolithic api.py
"""

import os, io, json, math, time, threading, asyncio
from pathlib import Path
from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from models import (
    get_org_by_api_key, create_org, update_org_db, update_branding,
    create_shared_report, get_shared_report, get_org_shared_reports,
    ScheduledReport, get_db, create_feedback, create_query_history,
    get_org_history, DataSource, ChatSession, ChatMessage,
    create_chat_session, add_chat_message, get_chat_history
)
from database import DatabaseManager
from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK
from utils import send_email_mock, clean_llm_json_content
from validators import sanitize_table_name
from export_manager import ExportManager
from scheduler import schedule_job_for_report
from insight_engine import InsightEngine
from org_context_manager import OrgContextManager, ensure_context_tables
from dependencies import get_cached_schema_summary

logger = logging.getLogger(__name__)
router = APIRouter()



# ── Pydantic models ──

class RegisterRequest(BaseModel):
    name: str
    email: Optional[str] = None

class ConfigRequest(BaseModel):
    connection_string: str

class QueryRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    tables: Optional[List[str]] = None
    verify_only: bool = False
    confirmed_sql: Optional[str] = None

class QueryResponse(BaseModel):
    query: str
    response: str
    visualization: Optional[dict] = None
    status: str
    sql_query: Optional[str] = None

class FeedbackRequest(BaseModel):
    query: str
    response: str
    vote: int
    feedback_text: Optional[str] = None

class DataSourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    table_name: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class ApiImportRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None
    table_name: str
    if_exists: str = "replace"

class TransformRequest(BaseModel):
    table_name: str
    operations: List[Dict[str, Any]]
    target_table: Optional[str] = None

class TransformSuggestRequest(BaseModel):
    table_name: str
    prompt: str

class ForecastRequest(BaseModel):
    table_name: str
    date_column: str
    value_column: str
    periods: int = 30
    freq: str = 'D'

class AnomalyRequest(BaseModel):
    table_name: str
    value_column: str
    contamination: float = 0.05

class CorrelationRequest(BaseModel):
    table_name: str
    columns: Optional[List[str]] = None
    method: str = 'pearson'

class CreateSessionRequest(BaseModel):
    title: Optional[str] = None

class SessionResponse(BaseModel):
    id: str
    title: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    visualization: Optional[Dict[str, Any]] = None
    created_at: datetime
    class Config:
        from_attributes = True

class ContextEntryRequest(BaseModel):
    key: str
    definition: str
    context_type: str = "term"
    sql_snippet: Optional[str] = None
    examples: Optional[List[str]] = None


class ContextEntryResponse(BaseModel):
    id: str
    key: str
    definition: str
    context_type: str
    sql_snippet: Optional[str] = None
    examples: Optional[List] = None
    source: str
    confidence: float
    usage_count: int
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class BrandingRequest(BaseModel):
    org_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None

class CreateDatabaseRequest(BaseModel):
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    new_db_name: str
    new_user: str
    new_password: str
    email: Optional[str] = None

class SuggestQueriesResponse(BaseModel):
    queries: List[str]

class UpdateCellRequest(BaseModel):
    row_id: Any
    column: str
    value: Any

class FillMissingRequest(BaseModel):
    strategy: str
    value: Optional[Any] = None
    weight_column: Optional[str] = None

class RenameColumnRequest(BaseModel):
    old_column: str
    new_column: str

class ScheduledReportRequest(BaseModel):
    query: str
    frequency: str = "biweekly"
    recipients: str



# ── Routes ──

@router.get("/organization/context", response_model=List[ContextEntryResponse])
async def get_org_context(org=Depends(get_current_org)):
    """Fetch all business context for the organization."""
    ctx_manager = OrgContextManager(org.id)
    return ctx_manager.get_all_context()


@router.post("/organization/context", response_model=ContextEntryResponse)
async def add_org_context(request: ContextEntryRequest, org=Depends(get_current_org)):
    """Add or update business context."""
    ctx_manager = OrgContextManager(org.id)
    try:
        return ctx_manager.add_context(
            key=request.key,
            definition=request.definition,
            context_type=request.context_type,
            sql_snippet=request.sql_snippet,
            examples=request.examples
        )
    except Exception as e:
        logger.error(f"Failed to add context: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/organization/context/{key}")
async def delete_org_context(key: str, org=Depends(get_current_org)):
    """Delete context entry."""
    ctx_manager = OrgContextManager(org.id)
    ctx_manager.delete_context(key)
    return {"status": "success", "message": f"Context for {key} deleted."}


@router.get("/organization/context/stats")
async def get_org_context_stats(org=Depends(get_current_org)):
    """Get statistics about organizational context."""
    ctx_manager = OrgContextManager(org.id)
    return ctx_manager.get_stats()


@router.post("/organization/context/process-corrections")
async def process_corrections(org=Depends(get_current_org)):
    """Trigger processing of pending corrections for implicit learning."""
    from main import AnalyticsAgent
    from config import get_agent_config
    
    config = get_agent_config()
    db_conn_str = get_org_connection_string(org)
    
    # We need an agent to call the LLM
    agent = AnalyticsAgent(connection_string=db_conn_str)
    
    # Define the LLM caller for the context manager
    async def llm_caller(prompt: str) -> str:
        response = agent.client.chat_completion(
            model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000
        )
        return response.choices[0].message.content

    ctx_manager = OrgContextManager(org.id, llm_caller=llm_caller)
    count = await ctx_manager.process_pending_corrections()
    agent.close()
    
    return {"status": "success", "learned_rules_count": count}


@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org, prefer_file_db=getattr(request, 'use_file', False))
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    schema_summary = get_cached_schema_summary(conn_str)
    start_time = time.time()

    # Inject organizational context
    from config import get_agent_config
    config = get_agent_config()
    ctx_manager = OrgContextManager(org.id)
    enriched_prompt = ctx_manager.inject_into_prompt(config.system_prompt)

    agent = AnalyticsAgent(
        connection_string=conn_str, 
        schema_summary=schema_summary,
        system_prompt_override=enriched_prompt
    )
    
    # Save user message if session_id provided
    if request.session_id:
        try:
            add_chat_message(request.session_id, "user", request.query)
        except Exception as e:
            logger.error(f"Failed to save user message: {e}")

    try:
        # Load history from session if session_id provided and no explicit history
        history = request.history
        if request.session_id and not history:
            # Fetch history from DB
             db_messages = get_chat_history(request.session_id)
             history = [{"role": m.role, "content": m.content} for m in db_messages]

        result = agent.run_query(
            request.query, 
            history, 
            tables=request.tables, 
            verify_only=request.verify_only,
            confirmed_sql=request.confirmed_sql
        )
        # Save to history if successful (and not just verifying, unless confirmed)
        if result.get("status") == "success" and not request.verify_only:
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=result.get("sql_query")
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        elif request.confirmed_sql and result.get("status") == "success":
             # Also save if it was a confirmed execution
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=request.confirmed_sql
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        
        # Save assistant response if session_id provided (Chat feature)
        if request.session_id:
            try:
                response_text = result.get("text", "")
                visualization = result.get("visualization")
                add_chat_message(request.session_id, "assistant", response_text, visualization=visualization)
            except Exception as e:
                logger.error(f"Failed to save assistant message: {e}")

        # Update title if it's the first message and title is generic
        if request.session_id and (not history or len(history) == 0):
             # Logic to update title could go here
             pass

        return QueryResponse(
            query=request.query,
            response=result.get("text", ""),
            visualization=result.get("visualization"),
            status=result.get("status", "success"),
            sql_query=result.get("sql_query")
        )
    except Exception as e:
        logger.error(f"Query execution failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'agent' in locals():
            agent.close()

class SuggestQueriesResponse(BaseModel):
    queries: List[str]



# End of file or other routes

class UpdateCellRequest(BaseModel):
    row_id: Any
    column: str
    value: Any


@router.post("/share")
async def share_report(request: QueryRequest, org=Depends(get_current_org)):
    """Create a shareable link for an analysis result"""
    conn_str = get_org_connection_string(org, prefer_file_db=getattr(request, 'use_file', False))
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    agent = AnalyticsAgent(connection_string=conn_str)
    
    try:
        result = agent.run_query(request.query, request.history)
        
        # Create shared report
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=result["text"],
            visualization=result["visualization"]
        )
        
        # Generate shareable URL
        base_url = "http://localhost:8000"  # In production, use request.base_url
        share_url = f"{base_url}/shared/{shared_report.id}"
        
        return {
            "status": "success",
            "share_url": share_url,
            "report_id": shared_report.id,
            "expires_at": shared_report.expires_at.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()


@router.get("/shared")
async def get_all_shared_reports(limit: int = 50, org=Depends(get_current_org)):
    """Get all shared reports for the organization."""
    try:
        reports = get_org_shared_reports(org.id, limit)
        return {"reports": reports}
    except Exception as e:
        logger.error(f"Error fetching shared reports: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch shared reports")


@router.get("/shared/{report_id}")
async def get_shared(report_id: str):
    """Public endpoint to view shared reports (no auth required)"""
    import json
    
    report = get_shared_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or expired")
    
    visualization = json.loads(report.visualization) if report.visualization else None
    
    return {
        "query": report.query,
        "response": report.response,
        "visualization": visualization,
        "created_at": report.created_at.isoformat()
    }


@router.post("/export/pdf")
async def export_pdf(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PDF"""
    try:
        manager = ExportManager()
        # Convert visualization object to dict if it's not already
        viz_data = request.visualization
        if hasattr(viz_data, 'dict'):
            viz_data = viz_data.dict()
            
        pdf_buffer = manager.generate_pdf(request.query, request.response, viz_data)
        
        timestamp = int(time.time())
        filename = f"report_{timestamp}.pdf"
        
        return StreamingResponse(
            pdf_buffer, 
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error(f"Error exporting PDF: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export/pptx")
async def export_pptx(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PowerPoint"""
    try:
        manager = ExportManager()
        # Convert visualization object to dict if it's not already
        viz_data = request.visualization
        if hasattr(viz_data, 'dict'):
            viz_data = viz_data.dict()
            
        pptx_buffer = manager.generate_pptx(request.query, request.response, viz_data)
        
        timestamp = int(time.time())
        filename = f"report_{timestamp}.pptx"
        
        return StreamingResponse(
            pptx_buffer, 
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error(f"Error exporting PPTX: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class ScheduledReportRequest(BaseModel):
    query: str
    frequency: str = "biweekly"
    recipients: str


@router.post("/scheduled-reports")
async def create_scheduled_report(request: ScheduledReportRequest, org=Depends(get_current_org)):
    """Schedule a new automated report"""
    from datetime import timedelta
    
    try:
        with get_db() as db:
            # Calculate next run time (e.g., start tomorrow at 9am)
            # For simplicity, we'll start it a few minutes from now for testing, 
            # or use logic to snap to 9am. Let's do 1 minute from now for immediate gratification in testing.
            # In prod, this might be configurable.
            next_run = datetime.utcnow() + timedelta(minutes=2) 
            
            report = ScheduledReport(
                org_id=org.id,
                query=request.query,
                frequency=request.frequency,
                next_run_at=next_run,
                recipients=request.recipients
            )
            db.add(report)
            db.flush()
            db.refresh(report)
            
            # Schedule the job
            schedule_job_for_report(report.id, report.next_run_at)
            
            return {
                "id": report.id,
                "message": "Report scheduled successfully",
                "next_run_at": report.next_run_at.isoformat()
            }
    except Exception as e:
        logger.error(f"Failed to schedule report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scheduled-reports")
async def list_scheduled_reports(org=Depends(get_current_org)):
    """List active scheduled reports"""
    try:
        with get_db() as db:
            reports = db.query(ScheduledReport).filter(
                ScheduledReport.org_id == org.id,
                ScheduledReport.is_active == 1
            ).all()
            
            return [
                {
                    "id": r.id,
                    "query": r.query,
                    "frequency": r.frequency,
                    "next_run_at": r.next_run_at.isoformat(),
                    "recipients": r.recipients
                }
                for r in reports
            ]
    except Exception as e:
        logger.error(f"Failed to list scheduled reports: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/scheduled-reports/{report_id}")
async def delete_scheduled_report(report_id: int, org=Depends(get_current_org)):
    """Cancel a scheduled report"""
    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(
                ScheduledReport.id == report_id,
                ScheduledReport.org_id == org.id
            ).first()
            
            if not report:
                raise HTTPException(status_code=404, detail="Report not found")
            
            report.is_active = 0
            db.commit()
            
            # We should technically remove it from the scheduler too, 
            # or rely on the execution logic to skip inactive ones. 
            # Refreshing jobs would also clean it up if implemented that way.
            # For now, execution logic checks is_active.
            
            return {"message": "Report cancelled"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



# --- Chat Persistence Endpoints ---


