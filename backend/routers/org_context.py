"""
routers/org_context.py — Routes for organizational context and business rules.
"""

import logging
import time
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from models import (
    get_org_history, create_feedback, create_query_history,
    get_chat_history, add_chat_message, create_shared_report,
    get_shared_report, get_org_shared_reports, ScheduledReport,
    get_db
)
from exceptions import RAGAgentError, ModelAPIError
from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary,
    require_permission
)
from auth import get_current_user
from org_context_manager import OrgContextManager
from export_manager import ExportManager
from scheduler import schedule_job_for_report
from schemas import (
    ContextEntryRequest, ContextEntryResponse, QueryRequest,
    QueryResponse, ScheduledReportRequest
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.get("/organization/context", response_model=List[ContextEntryResponse])
async def get_org_context(org=Depends(get_current_org)):
    """Fetch all business context for the organization."""
    ctx_manager = OrgContextManager(org.id)
    return ctx_manager.get_all_context()


@router.post("/organization/context", response_model=ContextEntryResponse)
async def add_org_context(request: ContextEntryRequest, org=Depends(get_current_org),
                          user=Depends(require_permission("MANAGE_ORG"))):
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
async def delete_org_context(key: str, org=Depends(get_current_org),
                             user=Depends(require_permission("MANAGE_ORG"))):
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
async def process_corrections(org=Depends(get_current_org),
                              user=Depends(require_permission("MANAGE_ORG"))):
    """Trigger processing of pending corrections for implicit learning."""
    from main import AnalyticsAgent
    from config import get_agent_config
    
    config = get_agent_config()
    db_conn_str = get_org_connection_string(org)
    
    agent = AnalyticsAgent(connection_string=db_conn_str)
    
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
async def execute_query(request: QueryRequest, org=Depends(get_current_org), user=Depends(get_current_user)):
    conn_str = get_org_connection_string(org, prefer_file_db=request.use_file)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    schema_summary = get_cached_schema_summary(conn_str)
    
    from config import get_agent_config
    config = get_agent_config()
    ctx_manager = OrgContextManager(org.id)
    enriched_prompt = ctx_manager.inject_into_prompt(config.system_prompt)
    
    from main import AnalyticsAgent
    agent = AnalyticsAgent(
        connection_string=conn_str, 
        schema_summary=schema_summary,
        system_prompt_override=enriched_prompt
    )
    
    if request.session_id:
        try:
            add_chat_message(request.session_id, "user", request.query)
        except Exception as e:
            logger.error(f"Failed to save user message: {e}")

    try:
        history = request.history
        if request.session_id and not history:
             db_messages = get_chat_history(request.session_id)
             history = [{"role": m.role, "content": m.content} for m in db_messages]

        result = agent.run_query(
            request.query, 
            history, 
            tables=request.tables, 
            verify_only=request.verify_only,
            confirmed_sql=request.confirmed_sql
        )
        
        if result.get("status") == "success" and not request.verify_only:
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=result.get("sql_query"),
                    user_id=user["id"]
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        elif request.confirmed_sql and result.get("status") == "success":
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=request.confirmed_sql,
                    user_id=user["id"]
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        
        if request.session_id:
            try:
                response_text = result.get("text", "")
                visualization = result.get("visualization")
                thinking_process = result.get("thinking_process")
                add_chat_message(request.session_id, "assistant", response_text, 
                                 visualization=visualization, thinking_process=thinking_process)
            except Exception as e:
                logger.error(f"Failed to save assistant message: {e}")

        return QueryResponse(
            query=request.query,
            response=result.get("text", ""),
            visualization=result.get("visualization"),
            status=result.get("status", "success"),
            sql_query=result.get("sql_query"),
            thinking_process=result.get("thinking_process")
        )
    except RAGAgentError as e:
        logger.error(f"RAG Agent Error: {e}", exc_info=True)
        # Use a more appropriate status code if it's a known error
        status_code = 400
        if isinstance(e, ModelAPIError):
            status_code = 503 # Service Unavailable (temporary)
        
        detail_msg = getattr(e, "user_message", str(e))
        raise HTTPException(status_code=status_code, detail=detail_msg)
    except Exception as e:
        logger.error(f"Unexpected query failure: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred during analysis. Please try again.")
    finally:
        agent.close()


@router.post("/share")
async def share_report(request: QueryRequest, org=Depends(get_current_org)):
    """Create a shareable link for an analysis result"""
    conn_str = get_org_connection_string(org, prefer_file_db=request.use_file)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    from main import AnalyticsAgent
    agent = AnalyticsAgent(connection_string=conn_str)
    
    try:
        result = agent.run_query(request.query, request.history)
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=result["text"],
            visualization=result["visualization"]
        )
        
        base_url = "http://localhost:8000"
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
async def export_pdf(request: QueryResponse, org=Depends(get_current_org),
                     user=Depends(require_permission("EXPORT"))):
    """Export analysis result as PDF"""
    try:
        manager = ExportManager()
        pdf_buffer = manager.generate_pdf(request.query, request.response, request.visualization)
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
async def export_pptx(request: QueryResponse, org=Depends(get_current_org),
                      user=Depends(require_permission("EXPORT"))):
    """Export analysis result as PowerPoint"""
    try:
        manager = ExportManager()
        pptx_buffer = manager.generate_pptx(request.query, request.response, request.visualization)
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


@router.post("/scheduled-reports")
async def create_scheduled_report(request: ScheduledReportRequest, org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Schedule a new automated report"""
    from datetime import datetime, timedelta
    try:
        with get_db() as db:
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
    """List all scheduled reports for the organization."""
    try:
        with get_db() as db:
            reports = db.query(ScheduledReport).filter(
                ScheduledReport.org_id == org.id
            ).all()
            return [
                {
                    "id": r.id,
                    "query": r.query,
                    "frequency": r.frequency,
                    "next_run_at": r.next_run_at.isoformat(),
                    "recipients": r.recipients,
                    "is_active": r.is_active
                }
                for r in reports
            ]
    except Exception as e:
        logger.error(f"Failed to list scheduled reports: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/scheduled-reports/{report_id}")
async def delete_scheduled_report(report_id: int, org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Delete a scheduled report permanently."""
    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(
                ScheduledReport.id == report_id,
                ScheduledReport.org_id == org.id
            ).first()
            if not report:
                raise HTTPException(status_code=404, detail="Report not found")
            db.delete(report)
            db.commit()
            return {"message": "Report deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/scheduled-reports/{report_id}/toggle")
async def toggle_scheduled_report(report_id: int, org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Toggle a scheduled report (Pause/Resume)."""
    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(
                ScheduledReport.id == report_id,
                ScheduledReport.org_id == org.id
            ).first()
            if not report:
                raise HTTPException(status_code=404, detail="Report not found")
            report.is_active = 1 if report.is_active == 0 else 0
            db.commit()
            db.refresh(report)
            return {"status": "success", "is_active": report.is_active}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to toggle report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/scheduled-reports/{report_id}")
async def update_scheduled_report(report_id: int, request: ScheduledReportRequest,
                                  org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Update a scheduled report configuration."""
    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(
                ScheduledReport.id == report_id,
                ScheduledReport.org_id == org.id
            ).first()
            if not report:
                raise HTTPException(status_code=404, detail="Report not found")
            
            report.query = request.query
            report.frequency = request.frequency
            report.recipients = request.recipients
            db.commit()
            db.refresh(report)
            return {"message": "Report updated successfully", "id": report.id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
