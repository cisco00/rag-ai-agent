"""
routers/org_context.py — Routes for organizational context and business rules.
"""

import asyncio
import json
import logging
import time
from threading import Thread
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Body
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool

from models import (
    get_org_history, create_feedback, create_query_history,
    get_chat_history, add_chat_message, create_shared_report,
    get_shared_report, get_org_shared_reports, ScheduledReport,
    get_db, update_org_db,
    save_query, unsave_query, get_saved_queries,
    ColumnDescription,
)
from exceptions import RAGAgentError, ModelAPIError
from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary,
    require_permission, FILE_DB_CACHE, FILE_DB_CACHE_LOCK
)
from auth import get_current_user
from org_context_manager import OrgContextManager
from export_manager import ExportManager
from scheduler import schedule_job_for_report
from schemas import (
    ContextEntryRequest, ContextEntryResponse, QueryRequest,
    QueryResponse, ScheduledReportRequest, ConfigRequest
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.get("/config")
async def get_config(org=Depends(get_current_org)):
    """Return the structured DB config for the current organization."""
    conn_str = org.db_connection_string or ""
    config_data = {
        "db_type": "sqlite",
        "host": "",
        "port": None,
        "user": "",
        "db_name": ""
    }
    
    if conn_str.startswith("postgresql://") or conn_str.startswith("mysql://"):
        import urllib.parse
        parsed = urllib.parse.urlparse(conn_str)
        config_data["db_type"] = parsed.scheme
        config_data["host"] = parsed.hostname or ""
        config_data["port"] = parsed.port
        config_data["user"] = parsed.username or ""
        config_data["db_name"] = parsed.path.lstrip('/') if parsed.path else ""
    elif conn_str.startswith("sqlite:///"):
        config_data["db_type"] = "sqlite"
        config_data["db_name"] = conn_str.replace("sqlite:///", "")

    return {
        "status": "success",
        "config": config_data
    }

@router.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org),
                      user=Depends(require_permission("MANAGE_ORG"))):
    """Update the DB connection string for the current organization."""
    try:
        import os
        import re
        
        # Construct the connection string safely based on db_type
        if request.db_type == "sqlite":
            safe_api_key = re.sub(r'[^a-zA-Z0-9_]', '', org.api_key)
            db_path = f"/data/file_db_{safe_api_key}.sqlite"
            connection_string = f"sqlite:///{db_path}"
        elif request.db_type in ["postgresql", "mysql"]:
            from urllib.parse import quote as _url_quote
            raw_user = request.user or ""
            raw_pass = request.password or ""
            # URL-encode username and password so that special characters
            # (including '@' in email-style Neon usernames) don't break parsing.
            enc_user = _url_quote(raw_user, safe="!$&'()*+,;=") if raw_user else ""
            enc_pass = _url_quote(raw_pass, safe="")            if raw_pass else ""
            pass_part = f":{enc_pass}" if enc_pass else ""
            auth_part = f"{enc_user}{pass_part}@" if enc_user or pass_part else ""
            port_part = f":{request.port}" if request.port else ""
            host_part = request.host or "localhost"
            db_name_part = request.db_name or ""
            connection_string = f"{request.db_type}://{auth_part}{host_part}{port_part}/{db_name_part}"
        else:
            raise ValueError(f"Unsupported db_type: {request.db_type}")

        db_manager = DatabaseManager(connection_string=connection_string)
        db_manager.list_tables()  # Validate connection
        db_manager.close()

        update_org_db(org.api_key, connection_string)

        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)

        return {"status": "success", "message": "Database connection string updated."}
    except Exception as e:
        logger.error(f"DB CONFIG ERROR: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to connect: {str(e)}")

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
    
    agent = AnalyticsAgent(connection_string=db_conn_str, observability_tags=[f"org:{org.id}"])
    
    async def llm_caller(prompt: str) -> str:
        # Offload blocking LLM call
        response = await run_in_threadpool(
            agent.client.chat_completion,
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

    # Append AI-generated column descriptions to the system prompt
    try:
        from column_describer import get_descriptions_for_schema, build_descriptions_block
        col_descs = get_descriptions_for_schema(org.id)
        desc_block = build_descriptions_block(col_descs)
        if desc_block:
            enriched_prompt = enriched_prompt + "\n\n" + desc_block
    except Exception as _cd_err:
        logger.warning("column_describer inject failed: %s", _cd_err)

    from main import AnalyticsAgent
    agent = AnalyticsAgent(
        connection_string=conn_str,
        schema_summary=schema_summary,
        system_prompt_override=enriched_prompt,
        observability_tags=[f"org:{org.id}"]
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

        # Offload blocking agent run_query
        result = await run_in_threadpool(
            agent.run_query,
            request.query,
            history,
            tables=request.tables,
            verify_only=request.verify_only,
            confirmed_sql=request.confirmed_sql
        )

        # Feature #10 — apply row/column permissions to result
        try:
            from data_permissions import apply_permissions
            sql_for_perms = result.get("sql_query") or ""
            rows_for_perms = result.get("last_result_rows")
            if sql_for_perms:
                _, filtered_rows = apply_permissions(
                    sql=sql_for_perms,
                    rows=rows_for_perms,
                    org_id=org.id,
                    role=user.get("role", "viewer"),
                    user_id=user.get("id", 0),
                )
                if filtered_rows is not None and isinstance(result, dict):
                    result["last_result_rows"] = filtered_rows
                    # Rebuild visualization from filtered rows if present
                    if result.get("visualization") and "data" in result["visualization"]:
                        result["visualization"]["data"] = filtered_rows[:1000]
        except Exception as _pe:
            logger.warning(f"Permission enforcement skipped: {_pe}")

        # Feature #11 — log query to audit trail (fire-and-forget)
        try:
            import time as _time
            from audit_log import log_query as _log_query
            _log_query(
                org_id=org.id,
                user_id=user.get("id", 0),
                user_email=user.get("email", ""),
                user_role=user.get("role", ""),
                question=request.query,
                sql_query=result.get("sql_query") or "",
                status=result.get("status", "success"),
                error_message=result.get("error") if result.get("status") == "error" else None,
                row_count=len(result.get("last_result_rows") or []) if result.get("last_result_rows") else None,
            )
        except Exception as _ae:
            logger.warning(f"Audit log write skipped: {_ae}")

        history_id: Optional[int] = None
        if result.get("status") == "success" and not request.verify_only:
             try:
                h = create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=result.get("sql_query"),
                    user_id=user["id"]
                )
                history_id = h.id if h else None
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
             # Track AI query activity
             try:
                 from auth import log_activity
                 log_activity(user["id"], org.id, "AI Query", {"query": request.query[:200], "sql": (result.get("sql_query") or "")[:200]})
             except Exception:
                 pass
        elif request.confirmed_sql and result.get("status") == "success":
             try:
                h = create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=request.confirmed_sql,
                    user_id=user["id"]
                )
                history_id = h.id if h else None
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
            thinking_process=result.get("thinking_process"),
            query_id=history_id,
        )
    finally:
        agent.close()


@router.post("/query/stream")
async def stream_query(request: QueryRequest, org=Depends(get_current_org), user=Depends(get_current_user)):
    """SSE endpoint that streams thinking steps + final result as they arrive."""
    conn_str = get_org_connection_string(org, prefer_file_db=request.use_file)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")

    schema_summary = get_cached_schema_summary(conn_str)

    from config import get_agent_config
    config = get_agent_config()
    ctx_manager = OrgContextManager(org.id)
    enriched_prompt = ctx_manager.inject_into_prompt(config.system_prompt)

    # Append AI-generated column descriptions to the system prompt
    try:
        from column_describer import get_descriptions_for_schema, build_descriptions_block
        col_descs = get_descriptions_for_schema(org.id)
        desc_block = build_descriptions_block(col_descs)
        if desc_block:
            enriched_prompt = enriched_prompt + "\n\n" + desc_block
    except Exception as _cd_err:
        logger.warning("column_describer inject failed: %s", _cd_err)

    from main import AnalyticsAgent
    agent = AnalyticsAgent(
        connection_string=conn_str,
        schema_summary=schema_summary,
        system_prompt_override=enriched_prompt,
        observability_tags=[f"org:{org.id}"],
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def progress_callback(event: dict):
        """Called from worker thread — schedules SSE event on event loop."""
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    def run_agent():
        try:
            history = request.history
            if request.session_id and not history:
                db_messages = get_chat_history(request.session_id)
                history = [{"role": m.role, "content": m.content} for m in db_messages]

            if request.session_id:
                try:
                    add_chat_message(request.session_id, "user", request.query)
                except Exception:
                    pass

            result = agent.run_query(
                request.query,
                history,
                tables=request.tables,
                verify_only=request.verify_only,
                confirmed_sql=request.confirmed_sql,
                progress_callback=progress_callback,
            )

            # Feature #10 — apply row/column permissions to streamed result
            try:
                from data_permissions import apply_permissions
                sql_for_perms = result.get("sql_query") or ""
                if sql_for_perms:
                    _, filtered_rows = apply_permissions(
                        sql=sql_for_perms,
                        rows=result.get("last_result_rows"),
                        org_id=org.id,
                        role=user.get("role", "viewer"),
                        user_id=user.get("id", 0),
                    )
                    if filtered_rows is not None:
                        result["last_result_rows"] = filtered_rows
                        if result.get("visualization") and "data" in result["visualization"]:
                            result["visualization"]["data"] = filtered_rows[:1000]
            except Exception as _pe:
                logger.warning(f"Stream permission enforcement skipped: {_pe}")

            # Feature #11 — audit log for streamed query (fire-and-forget)
            try:
                from audit_log import log_query as _log_query
                _log_query(
                    org_id=org.id,
                    user_id=user.get("id", 0),
                    user_email=user.get("email", ""),
                    user_role=user.get("role", ""),
                    question=request.query,
                    sql_query=result.get("sql_query") or "",
                    status=result.get("status", "success"),
                    error_message=result.get("error") if result.get("status") == "error" else None,
                    row_count=len(result.get("last_result_rows") or []) if result.get("last_result_rows") else None,
                )
            except Exception as _ae:
                logger.warning(f"Audit log (stream) write skipped: {_ae}")

            # Persist history
            if result.get("status") == "success":
                try:
                    h = create_query_history(
                        org_id=org.id,
                        query=request.query,
                        response=result["text"],
                        visualization=result.get("visualization"),
                        sql_query=result.get("sql_query"),
                        user_id=user["id"],
                    )
                    if h:
                        result["query_id"] = h.id
                except Exception as ex:
                    logger.error(f"Failed to save history: {ex}")

            if request.session_id:
                try:
                    add_chat_message(
                        request.session_id, "assistant", result.get("text", ""),
                        visualization=result.get("visualization"),
                        thinking_process=result.get("thinking_process"),
                    )
                except Exception as ex:
                    logger.error(f"Failed to save assistant message: {ex}")

            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "done", "result": result}), loop
            )
        except Exception as exc:
            logger.error(f"Streaming agent error: {exc}", exc_info=True)
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "message": str(exc)}), loop
            )
        finally:
            agent.close()
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)  # sentinel

    Thread(target=run_agent, daemon=True).start()

    async def event_generator():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=330.0)
                if event is None:
                    break
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Query timed out'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class ShareSnapshotRequest(BaseModel):
    """Payload for creating a public link from an already-computed result."""
    query: str                          # the user's original question
    response: str                       # the AI's markdown / text answer
    visualization: Optional[dict] = None  # chart/table payload (optional)


@router.post("/share")
async def share_report(request: ShareSnapshotRequest, org=Depends(get_current_org)):
    """
    Create a public shareable link for an already-computed result.

    Accepts the pre-rendered query + response + visualization so that the
    LLM is *not* re-invoked — this is purely a storage operation.
    """
    import os
    try:
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=request.response,
            visualization=request.visualization,
        )
        # APP_URL should be the *frontend* origin so the link opens in the browser.
        # Fall back to the backend origin if not set.
        app_url = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")
        share_url = f"{app_url}/shared/{shared_report.id}"

        return {
            "status": "success",
            "share_url": share_url,
            "report_id": shared_report.id,
            "expires_at": shared_report.expires_at.isoformat() if shared_report.expires_at else None,
        }
    except Exception as e:
        logger.error("share_report error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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


@router.patch("/scheduled-reports/{report_id}/toggle")
async def toggle_scheduled_report(report_id: int, org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Toggle a scheduled report (Pause/Resume)."""
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


@router.put("/scheduled-reports/{report_id}")
async def update_scheduled_report(report_id: int, request: ScheduledReportRequest,
                                  org=Depends(get_current_org),
                                  user=Depends(require_permission("VIEW_REPORTS"))):
    """Update a scheduled report configuration."""
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


# ── Saved Queries endpoints ──────────────────────────────────────────────────

@router.get("/saved-queries")
async def list_saved_queries(org=Depends(get_current_org), user=Depends(get_current_user)):
    """Return all saved/bookmarked queries for this org."""
    items = get_saved_queries(org.id, user_id=user["id"] if user else None)
    return [
        {
            "id": item.id,
            "query": item.query,
            "response": item.response,
            "sql_query": item.sql_query,
            "visualization": item.get_visualization(),
            "saved_title": item.saved_title,
            "created_at": item.created_at.isoformat(),
        }
        for item in items
    ]


@router.post("/saved-queries/{query_id}")
async def bookmark_query(
    query_id: int,
    body: dict = Body(default={}),
    org=Depends(get_current_org),
):
    """Bookmark (save) a query history entry. Optionally pass {\"title\": \"...\"}."""
    title = body.get("title") if isinstance(body, dict) else None
    item = save_query(query_id, org.id, title=title)
    if not item:
        raise HTTPException(status_code=404, detail="Query not found")
    return {"status": "saved", "id": item.id, "saved_title": item.saved_title}


@router.delete("/saved-queries/{query_id}")
async def unbookmark_query(query_id: int, org=Depends(get_current_org)):
    """Remove the saved bookmark from a query history entry."""
    ok = unsave_query(query_id, org.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Query not found")
    return {"status": "unsaved", "id": query_id}


# ── Column Descriptions ───────────────────────────────────────────────────────

@router.get("/column-descriptions")
async def list_column_descriptions(
    table_name: Optional[str] = None,
    org=Depends(get_current_org),
):
    """Return AI-generated column descriptions for this org, optionally filtered by table."""
    from column_describer import get_descriptions_for_schema
    tables = [table_name] if table_name else None
    descs = get_descriptions_for_schema(org.id, tables)
    # Flatten to a list for easy consumption by the frontend
    result = []
    for tbl, cols in descs.items():
        for col, desc in cols.items():
            result.append({"table_name": tbl, "column_name": col, "description": desc})
    return result


@router.put("/column-descriptions/{table_name}/{column_name}")
async def update_column_description(
    table_name: str,
    column_name: str,
    body: dict = Body(...),
    org=Depends(get_current_org),
):
    """Manually update a column description (marks it as human-edited)."""
    description = body.get("description", "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")
    from datetime import datetime as _dt
    with get_db() as db:
        row = db.query(ColumnDescription).filter_by(
            org_id=org.id,
            table_name=table_name,
            column_name=column_name,
        ).first()
        if row:
            row.description  = description
            row.generated_by = "manual"
            row.generated_at = _dt.utcnow()
        else:
            db.add(ColumnDescription(
                org_id=org.id,
                table_name=table_name,
                column_name=column_name,
                description=description,
                generated_by="manual",
                generated_at=_dt.utcnow(),
            ))
    return {"status": "updated", "table_name": table_name, "column_name": column_name}


@router.post("/column-descriptions/{table_name}/regenerate")
async def regenerate_column_descriptions(
    table_name: str,
    background_tasks: BackgroundTasks,
    org=Depends(get_current_org),
    user=Depends(require_permission("WRITE_DATA")),
):
    """Re-generate AI descriptions for all columns in the given table."""
    from dependencies import get_org_connection_string
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    from column_describer import generate_and_store_descriptions
    background_tasks.add_task(generate_and_store_descriptions, org.id, table_name, conn_str, True)
    return {"status": "queued", "table_name": table_name}



# ── CSV / Excel export ────────────────────────────────────────────────────────

class ExportDataRequest(BaseModel):
    """Rows + columns extracted from a visualization or table result."""
    columns: list          # list of column name strings
    rows: list             # list of dicts {col: value}
    filename: str = "export"


@router.post("/export/csv")
async def export_csv(request: ExportDataRequest, org=Depends(get_current_org)):
    """Stream result data as a UTF-8 CSV file."""
    import csv
    import io

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=request.columns, extrasaction="ignore")
    writer.writeheader()
    for row in request.rows:
        writer.writerow({c: row.get(c, "") for c in request.columns})

    filename = f"{request.filename}_{int(time.time())}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),   # utf-8-sig adds BOM for Excel compat
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/xlsx")
async def export_xlsx(request: ExportDataRequest, org=Depends(get_current_org)):
    """Stream result data as an Excel (.xlsx) file."""
    import io
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Results"

    header_font  = Font(bold=True, color="FFFFFF")
    header_fill  = PatternFill("solid", fgColor="2563EB")  # Tailwind blue-600
    header_align = Alignment(horizontal="center", vertical="center")

    # Header row
    for col_idx, col_name in enumerate(request.columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.font   = header_font
        cell.fill   = header_fill
        cell.alignment = header_align

    # Data rows
    for row_idx, row in enumerate(request.rows, start=2):
        for col_idx, col_name in enumerate(request.columns, start=1):
            ws.cell(row=row_idx, column=col_idx, value=row.get(col_name, ""))

    # Auto-size columns (cap at 60)
    for col_idx, col_name in enumerate(request.columns, start=1):
        max_len = max(len(str(col_name)), *(len(str(r.get(col_name, ""))) for r in request.rows or [{}]))
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 4, 60)

    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"{request.filename}_{int(time.time())}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Query History Browser ─────────────────────────────────────────────────────

@router.get("/history")
async def get_query_history(
    page: int = 1,
    page_size: int = 20,
    search: str = "",
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Paginated, searchable query history for the organisation.
    Returns entries newest-first; each includes id, query, response snippet,
    visualization type, sql_query, created_at, is_saved, saved_title.
    """
    from models import QueryHistory
    offset = (page - 1) * page_size
    with get_db() as db:
        q = db.query(QueryHistory).filter(QueryHistory.org_id == org.id)
        if search:
            like = f"%{search}%"
            q = q.filter(
                (QueryHistory.query.ilike(like)) | (QueryHistory.response.ilike(like))
            )
        total = q.count()
        items = (
            q.order_by(QueryHistory.created_at.desc())
            .offset(offset)
            .limit(page_size)
            .all()
        )

    results = []
    for item in items:
        viz_type = None
        if item.visualization:
            try:
                viz_type = json.loads(item.visualization).get("type")
            except Exception:
                pass
        results.append({
            "id":           item.id,
            "query":        item.query,
            "response":     item.response[:300] + "…" if len(item.response) > 300 else item.response,
            "visualization_type": viz_type,
            "sql_query":    item.sql_query,
            "created_at":   item.created_at.isoformat(),
            "is_saved":     bool(item.is_saved),
            "saved_title":  item.saved_title,
        })

    return {
        "items": results,
        "total": total,
        "page":  page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),   # ceiling division
    }
