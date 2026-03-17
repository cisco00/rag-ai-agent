"""
routers/analytics.py — Data analytics, forecasting, and anomaly detection.
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool

from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary
)
from models import get_org_history
from schemas import (
    ForecastRequest, AnomalyRequest, CorrelationRequest, SuggestQueriesResponse
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.post("/analytics/forecast")
async def get_forecast(request: ForecastRequest, org=Depends(get_current_org)):
    """Generate a time-series forecast."""
    try:
        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
            
        import pandas as pd
        db_manager = DatabaseManager(connection_string=db_conn)
        
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


@router.post("/analytics/correlation")
async def get_correlation_matrix(request: CorrelationRequest, org=Depends(get_current_org)):
    """Calculate correlation matrix for a table."""
    db_conn = get_org_connection_string(org)
    
    if not db_conn:
         raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
         
    try:
        db_manager = DatabaseManager(connection_string=db_conn)
        if request.table_name not in db_manager.list_tables():
            db_manager.close()
            raise HTTPException(status_code=404, detail=f"Table '{request.table_name}' not found")
            
        import pandas as pd
        col_list = ", ".join(request.columns) if request.columns else "*"
        df = pd.read_sql(f"SELECT {col_list} FROM {request.table_name} LIMIT 10000", db_manager.get_engine())
        db_manager.close()
        
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
            from utils import clean_llm_json_content
            data = json.loads(clean_llm_json_content(content))
            queries = data.get("queries", [])
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
