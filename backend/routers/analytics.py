"""router: analytics — query execution, history, exports, forecasting, anomaly, correlation."""
import json
import logging
import time
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from main import AnalyticsAgent
from models import (
    get_db, create_feedback, create_query_history, get_org_history,
    create_shared_report, get_shared_report, get_org_shared_reports,
    add_chat_message, get_chat_history,
)
from analytics import perform_forecast, detect_anomalies, calculate_correlation
from pipeline import load_for_forecast, load_for_anomaly, load_for_correlation
from export_manager import ExportManager
from database import DatabaseManager
from utils import clean_llm_json_content
from org_context_manager import OrgContextManager
from dependencies import (
    get_current_org,
    get_org_connection_string,
    get_cached_schema_summary,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Request/Response models ---
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


class ForecastRequest(BaseModel):
    table_name: str
    date_column: str
    value_column: str
    periods: int = 30
    freq: str = "D"


class AnomalyRequest(BaseModel):
    table_name: str
    value_column: str
    contamination: float = 0.05


class CorrelationRequest(BaseModel):
    table_name: str
    columns: Optional[List[str]] = None
    method: str = "pearson"


class SuggestQueriesResponse(BaseModel):
    queries: List[str]


# --- Endpoints ---

@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(
            status_code=400, detail="No database or file configured for this organization."
        )

    schema_summary = get_cached_schema_summary(conn_str)

    from config import get_agent_config
    config = get_agent_config()
    ctx_manager = OrgContextManager(org.id)
    enriched_prompt = ctx_manager.inject_into_prompt(config.system_prompt)

    agent = AnalyticsAgent(
        connection_string=conn_str,
        schema_summary=schema_summary,
        system_prompt_override=enriched_prompt,
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
            confirmed_sql=request.confirmed_sql,
        )

        if result.get("status") == "success" and not request.verify_only:
            try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=result.get("sql_query"),
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
                )
            except Exception as ex:
                logger.error(f"Failed to save history: {ex}")

        if request.session_id:
            try:
                add_chat_message(
                    request.session_id, "assistant",
                    result.get("text", ""),
                    visualization=result.get("visualization"),
                )
            except Exception as e:
                logger.error(f"Failed to save assistant message: {e}")

        return QueryResponse(
            query=request.query,
            response=result.get("text", ""),
            visualization=result.get("visualization"),
            status=result.get("status", "success"),
            sql_query=result.get("sql_query"),
        )
    except Exception as e:
        logger.error(f"Query execution failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if "agent" in locals():
            agent.close()


@router.get("/suggested-queries", response_model=SuggestQueriesResponse)
async def get_suggested_queries(org=Depends(get_current_org)):
    """Generate suggested analytical queries based on the database schema."""
    try:
        conn_str = get_org_connection_string(org)
        if not conn_str:
            return SuggestQueriesResponse(queries=[])

        schema_summary = get_cached_schema_summary(conn_str)
        if not schema_summary:
            return SuggestQueriesResponse(queries=[])

        from config import get_agent_config
        from llm_client import get_llm_client

        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            logger.error(f"Failed to initialize LLM: {e}")
            return SuggestQueriesResponse(queries=[])

        prompt = (
            "You are a Senior Data Analyst. Based on the following database schema, "
            "generate exactly 4 distinct, insightful analytical questions a business executive "
            "would want to ask.\n\n"
            f"SCHEMA:\n{schema_summary}\n\n"
            'Output ONLY a valid JSON object: {"queries": ["...", "...", "...", "..."]}'
        )

        response = client.chat_completion(
            model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        content = response.choices[0].message.content
        try:
            data = json.loads(clean_llm_json_content(content))
            queries = [str(q) for q in data.get("queries", [])][:4]
        except json.JSONDecodeError:
            queries = []

        return SuggestQueriesResponse(queries=queries)
    except Exception as e:
        logger.error(f"Error generating suggested queries: {e}", exc_info=True)
        return SuggestQueriesResponse(queries=[])


@router.get("/history")
async def get_history(limit: int = 50, org=Depends(get_current_org)):
    """Get past queries for the organization."""
    try:
        history = get_org_history(org.id, limit)
        return {"history": history}
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")


@router.post("/feedback")
async def submit_feedback(request: FeedbackRequest, org=Depends(get_current_org)):
    try:
        feedback = create_feedback(
            org_id=org.id,
            query=request.query,
            response=request.response,
            vote=request.vote,
            feedback_text=request.feedback_text,
        )
        if request.feedback_text:
            try:
                ctx_manager = OrgContextManager(org.id)
                ctx_manager.record_correction(
                    original_query=request.query,
                    original_response=request.response,
                    user_correction=request.feedback_text,
                )
            except Exception as e:
                logger.error(f"Failed to record correction: {e}")
        return {"status": "success", "message": "Feedback submitted successfully", "id": feedback.id}
    except Exception as e:
        logger.error(f"Feedback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit feedback")


@router.post("/share")
async def share_report(request: QueryRequest, org=Depends(get_current_org)):
    """Create a shareable link for an analysis result."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")

    agent = AnalyticsAgent(connection_string=conn_str)
    try:
        result = agent.run_query(request.query, request.history)
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=result["text"],
            visualization=result["visualization"],
        )
        base_url = "http://localhost:8000"
        share_url = f"{base_url}/shared/{shared_report.id}"
        return {
            "status": "success",
            "share_url": share_url,
            "report_id": shared_report.id,
            "expires_at": shared_report.expires_at.isoformat(),
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
    """Public endpoint to view shared reports (no auth required)."""
    report = get_shared_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or expired")
    visualization = json.loads(report.visualization) if report.visualization else None
    return {
        "query": report.query,
        "response": report.response,
        "visualization": visualization,
        "created_at": report.created_at.isoformat(),
    }


@router.post("/export/pdf")
async def export_pdf(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PDF."""
    try:
        manager = ExportManager()
        viz_data = request.visualization
        if hasattr(viz_data, "dict"):
            viz_data = viz_data.dict()
        pdf_buffer = manager.generate_pdf(request.query, request.response, viz_data)
        filename = f"report_{int(time.time())}.pdf"
        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"Error exporting PDF: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export/pptx")
async def export_pptx(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PowerPoint."""
    try:
        manager = ExportManager()
        viz_data = request.visualization
        if hasattr(viz_data, "dict"):
            viz_data = viz_data.dict()
        pptx_buffer = manager.generate_pptx(request.query, request.response, viz_data)
        filename = f"report_{int(time.time())}.pptx"
        return StreamingResponse(
            pptx_buffer,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"Error exporting PPTX: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analytics/forecast")
async def get_forecast(request: ForecastRequest, org=Depends(get_current_org)):
    """Generate a time-series forecast."""
    db_conn = get_org_connection_string(org)
    if not db_conn:
        raise HTTPException(status_code=400, detail="No database configured.")
    try:
        df = await run_in_threadpool(
            load_for_forecast, db_conn, request.table_name, request.date_column, request.value_column
        )
        result = perform_forecast(df, request.date_column, request.value_column, request.periods, request.freq)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Forecast failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/analytics/anomaly")
async def get_anomalies(request: AnomalyRequest, org=Depends(get_current_org)):
    """Detect anomalies. Loads only the target column."""
    db_conn = get_org_connection_string(org)
    if not db_conn:
        raise HTTPException(status_code=400, detail="No database configured.")
    try:
        df = await run_in_threadpool(load_for_anomaly, db_conn, request.table_name, request.value_column)
        result = detect_anomalies(df, request.value_column, request.contamination)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Anomaly detection failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/analytics/correlation")
async def get_correlation_matrix(request: CorrelationRequest, org=Depends(get_current_org)):
    """Calculate correlation matrix."""
    db_conn = get_org_connection_string(org)
    if not db_conn:
        raise HTTPException(status_code=400, detail="No database configured.")
    try:
        dm = DatabaseManager(connection_string=db_conn)
        if request.table_name not in dm.list_tables():
            dm.close()
            raise HTTPException(status_code=404, detail=f"Table '{request.table_name}' not found")
        dm.close()

        df = await run_in_threadpool(
            load_for_correlation, db_conn, request.table_name, request.columns or []
        )
        result = await run_in_threadpool(calculate_correlation, df, request.columns, request.method)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Correlation API failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
