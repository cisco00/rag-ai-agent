"""
routers/analytics.py — routes migrated from monolithic api.py
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

@router.post("/transform")
async def transform_data(request: TransformRequest, org=Depends(get_current_org)):
    """Apply transformations to a table."""
    try:
        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
            
        import pandas as pd
        from transformations import DataTransformer
        
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Load table
        # WARNING: This loads entire table to memory. In prod use SQL.
        query = f"SELECT * FROM {request.table_name}"
        df = pd.read_sql(query, db_manager.get_engine())
        
        # Apply operations using DataTransformer
        try:
             df = DataTransformer.apply_transformations(df, request.operations)
        except Exception as e:
             logger.error(f"Error applying transformations: {e}")
             raise HTTPException(status_code=400, detail=f"Transformation error: {str(e)}")
                
        # Save or Return
        if request.target_table:
            success = db_manager.load_dataframe(df, request.target_table, if_exists="replace")
            db_manager.close()
            return {"status": "success", "message": f"Transformed data saved to '{request.target_table}'", "rows": len(df)}
        else:
            db_manager.close()
            # Return preview
            preview_data = df.head(10).to_dict(orient="records")
            # JSON cannot handle NaN, so replace with None
            import math
            import numpy as np
            cleaned_preview = []
            for row in preview_data:
                cleaned_row = {}
                for k, v in row.items():
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                         cleaned_row[k] = None
                    # Handle numpy types
                    elif isinstance(v, (np.int64, np.int32)):
                         cleaned_row[k] = int(v)
                    elif isinstance(v, (np.bool_, bool)):
                         cleaned_row[k] = bool(v)
                    else:
                         cleaned_row[k] = v
                cleaned_preview.append(cleaned_row)
            return {"status": "success", "preview": cleaned_preview}
            
    except Exception as e:
        logger.error(f"Transformation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transform/suggest")
async def suggest_transformations(request: TransformSuggestRequest, org=Depends(get_current_org)):
    """Suggest transformation operations based on natural language prompt."""
    try:
        from config import get_agent_config
        from llm_client import get_llm_client
        
        conn_str = get_org_connection_string(org)
        if not conn_str:
            raise HTTPException(status_code=400, detail="No database configured")
            
        # Get schema summary (cached)
        schema_summary = get_cached_schema_summary(conn_str)
        if not schema_summary:
             raise HTTPException(status_code=400, detail="Schema cannot be read")

        # Initialize LLM
        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            logger.error(f"Failed to initialize LLM for suggestions: {e}")
            raise HTTPException(status_code=500, detail="Failed to initialize AI")

        # Describe the capabilities
        operations_spec = (
            "You are a translation layer between natural language and a pandas-backed data transformation pipeline.\n"
            "Based on the user's intent, respond exclusively with a JSON list of operation objects.\n\n"
            "SUPPORTED OPERATIONS (type field):\n"
            "1. clean_text: {{\"type\": \"clean_text\", \"column\": \"col_name\", \"clean_type\": \"lower|upper|trim|title|remove_special\"}}\n"
            "2. filter: {{\"type\": \"filter\", \"column\": \"col_name\", \"op\": \">|<|==|!=|>=|<=\", \"value\": \"any\"}}\n"
            "3. rename_col: {{\"type\": \"rename_col\", \"column\": \"old_name\", \"new_name\": \"new_name\"}}\n"
            "4. drop_col: {{\"type\": \"drop_col\", \"column\": \"col_name\"}}\n"
            "5. change_type: {{\"type\": \"change_type\", \"column\": \"col_name\", \"new_type\": \"int|float|str|datetime|bool\"}}\n"
            "6. fill_na: {{\"type\": \"fill_na\", \"column\": \"col_name\", \"method\": \"value|mean|median|mode\", \"value\": \"any\"}}\n"
            "7. drop_duplicates: {{\"type\": \"clean\", \"method\": \"drop_duplicates\", \"subset\": \"col_name\"}}\n"
            "8. remove_outliers: {{\"type\": \"clean\", \"method\": \"remove_outliers\", \"column\": \"col_name\", \"outlier_method\": \"z-score\", \"threshold\": 3.0}}\n\n"
            "SCHEMA OF DATABASE:\n"
            "{schema_summary}\n\n"
            "Analyze the user prompt carefully against the schema for table '{table_name}'.\n"
            "Output ONLY valid JSON. Do not use Markdown code fences.\n"
            "Example: [{{\"type\": \"clean_text\", \"column\": \"first_name\", \"clean_type\": \"title\"}}]"
        )

        user_prompt = f"Table: {request.table_name}. Prompt: {request.prompt}"

        messages = [
            {"role": "system", "content": operations_spec.format(schema_summary=schema_summary, table_name=request.table_name)},
            {"role": "user", "content": user_prompt}
        ]
        
        response = client.chat_completion(
            model=config.model_name,
            messages=messages,
            max_tokens=500
        )
        
        content = response.choices[0].message.content
        try:
            operations = json.loads(clean_llm_json_content(content))
            if not isinstance(operations, list):
                 operations = [operations]
        except json.JSONDecodeError:
            logger.error(f"Failed to parse LLM suggestions: {content}")
            raise HTTPException(status_code=500, detail="AI output format was invalid")
            
        return {"status": "success", "operations": operations}

    except Exception as e:
        logger.error(f"Error suggesting transformations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analytics/forecast")
async def get_forecast(request: ForecastRequest, org=Depends(get_current_org)):
    """Generate a time-series forecast."""
    try:
        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
            
        import pandas as pd
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Load data — limit to 10,000 rows to prevent timeouts on large tables
        query = f"SELECT {request.date_column}, {request.value_column} FROM {request.table_name} LIMIT 10000"
        df = pd.read_sql(query, db_manager.get_engine())
        db_manager.close()
        
        from analytics import perform_forecast
        result = perform_forecast(df, request.date_column, request.value_column, request.periods, request.freq)
        
        if isinstance(result, dict) and "error" in result:
             raise HTTPException(status_code=400, detail=result["error"])
             
        return result
        
    except Exception as e:
         logger.error(f"Forecast failed: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=str(e))


@router.post("/analytics/anomaly")
async def get_anomalies(request: AnomalyRequest, org=Depends(get_current_org)):
    """Detect anomalies in a dataset."""
    try:
        db_conn = get_org_connection_string(org)
        if not db_conn:
             raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
             
        import pandas as pd
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Load data — limit rows to prevent timeouts on large tables
        query = f"SELECT {request.value_column} FROM {request.table_name} LIMIT 10000"
        df = pd.read_sql(query, db_manager.get_engine())
        db_manager.close()
        
        from analytics import detect_anomalies
        result = detect_anomalies(df, request.value_column, request.contamination)
        
        if isinstance(result, dict) and "error" in result:
             raise HTTPException(status_code=400, detail=result["error"])
             
        return result
        
    except Exception as e:
         logger.error(f"Anomaly detection failed: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=str(e))

from fastapi import WebSocket, WebSocketDisconnect


@router.post("/analytics/correlation")
async def get_correlation_matrix(request: CorrelationRequest, org=Depends(get_current_org)):
    """
    Calculate correlation matrix for a table.
    """
    # 1. Get DB Connection
    # org is already retrieved by Depends
    
    db_conn = get_org_connection_string(org)
    
    if not db_conn:
         raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
         
    # 2. Fetch Data
    try:
        db_manager = DatabaseManager(connection_string=db_conn)
        # Verify table exists
        if request.table_name not in db_manager.list_tables():
            db_manager.close()
            raise HTTPException(status_code=404, detail=f"Table '{request.table_name}' not found")
            
        # Limit rows to prevent timeouts on large tables
        import pandas as pd
        col_list = ", ".join(request.columns) if request.columns else "*"
        df = pd.read_sql(f"SELECT {col_list} FROM {request.table_name} LIMIT 10000", db_manager.get_engine())
        db_manager.close()
        
        # 3. Calculate Correlation
        from analytics import calculate_correlation
        result = await run_in_threadpool(
            calculate_correlation, 
            df, 
            request.columns, 
            request.method
        )
        
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
            
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Correlation API failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analytics/suggested-queries", response_model=SuggestQueriesResponse)
async def get_suggested_queries(org=Depends(get_current_org)):
    """Generate suggested analytical queries based on the database schema."""
    try:
        conn_str = get_org_connection_string(org)
        if not conn_str:
            return SuggestQueriesResponse(queries=[])
            
        # Get schema summary (cached)
        schema_summary = get_cached_schema_summary(conn_str)
        if not schema_summary:
             return SuggestQueriesResponse(queries=[])

        from config import get_agent_config
        from llm_client import get_llm_client
        
        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            logger.error(f"Failed to initialize LLM for suggestions: {e}")
            return SuggestQueriesResponse(queries=[])

        prompt = (
            "You are a Senior Data Analyst. Based on the following database schema, "
            "generate exactly 4 distinct, insightful, and relevant analytical questions "
            "that a business executive would want to ask about this data.\n\n"
            f"SCHEMA:\n{schema_summary}\n\n"
            "Output ONLY a valid JSON object with a single key 'queries' containing a list of 4 strings. "
            "Do not include markdown formatting or any other text.\n"
            'Example: {"queries": ["What are the top 5 products by revenue?", "Show me sales trends over time.", ...]}'
        )

        messages = [{"role": "user", "content": prompt}]
        
        response = client.chat_completion(
            model=config.model_name,
            messages=messages,
            max_tokens=300
        )
        
        content = response.choices[0].message.content
        try:
            data = json.loads(clean_llm_json_content(content))
            queries = data.get("queries", [])
            # Validate
            if not isinstance(queries, list):
                 queries = []
            queries = [str(q) for q in queries][:4]
        except json.JSONDecodeError:
            logger.error(f"Failed to parse LLM suggestions: {content}")
            queries = []
            
        return SuggestQueriesResponse(queries=queries)

    except Exception as e:
        logger.error(f"Error generating suggested queries: {e}", exc_info=True)
        return SuggestQueriesResponse(queries=[])


@router.get("/analytics/history")
async def get_history(limit: int = 50, org=Depends(get_current_org)):
    """Get past queries for the organization"""
    try:
        history = get_org_history(org.id, limit)
        return {"history": history}
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")


# --- Insight Endpoints ---


