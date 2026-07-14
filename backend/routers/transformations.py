"""
routers/transformations.py — Data transformation and AI-suggested operations.
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Depends

from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary,
    require_permission
)
from utils import clean_llm_json_content
from schemas import TransformRequest, TransformSuggestRequest

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.post("/transform")
async def transform_data(request: TransformRequest, org=Depends(get_current_org),
                         user=Depends(require_permission("MUTATE_TABLES"))):
    """Apply transformations to a table."""
    try:
        from fastapi.concurrency import run_in_threadpool
        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
            
        import pandas as pd
        from transformations import DataTransformer
        
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Determine target table
        source_table = request.table_name
        target_table = request.target_table
        
        # If no target specified, default to creating a new one as requested by user
        if not target_table:
            target_table = f"transformed_{source_table}"
            logger.info(f"Auto-assigning target table: {target_table}")
        
        # Load table using threadpool
        def _load_df():
            query = f"SELECT * FROM {source_table}"
            return pd.read_sql(query, db_manager.get_engine())
            
        df = await run_in_threadpool(_load_df)
        
        # Apply operations using DataTransformer (CPU intensive, also good for threadpool if large)
        try:
             df = await run_in_threadpool(DataTransformer.apply_transformations, df, request.operations)
        except Exception as e:
             logger.error(f"Error applying transformations: {e}")
             db_manager.close()
             raise HTTPException(status_code=400, detail=f"Transformation error: {str(e)}")
                
        # Save changes to the target table
        def _save_df(dataframe, table):
            return db_manager.load_dataframe(dataframe, table, if_exists="replace")
            
        success = await run_in_threadpool(_save_df, df, target_table)
        db_manager.close()
        
        if success:
            # Return preview and success info
            preview_data = df.head(10).to_dict(orient="records")
            import math
            import numpy as np
            cleaned_preview = []
            for row in preview_data:
                cleaned_row = {}
                for k, v in row.items():
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                         cleaned_row[k] = None
                    elif isinstance(v, (np.int64, np.int32)):
                         cleaned_row[k] = int(v)
                    elif isinstance(v, (np.bool_, bool)):
                         cleaned_row[k] = bool(v)
                    else:
                         cleaned_row[k] = v
                cleaned_preview.append(cleaned_row)
                
            return {
                "status": "success", 
                "message": f"Transformed data saved to '{target_table}'", 
                "rows_affected": len(df),
                "target_table": target_table,
                "preview": cleaned_preview
            }
        else:
            raise Exception("Failed to save transformed data to database")
            
    except Exception as e:
        logger.error(f"Transformation failed: {e}", exc_info=True)
        if 'db_manager' in locals() and db_manager:
            db_manager.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transform/suggest")
async def suggest_transformations(request: TransformSuggestRequest, org=Depends(get_current_org),
                                  user=Depends(require_permission("MUTATE_TABLES"))):
    """Suggest transformation operations based on natural language prompt."""
    try:
        from config import get_agent_config
        from llm_client import get_llm_client
        
        conn_str = get_org_connection_string(org)
        if not conn_str:
            raise HTTPException(status_code=400, detail="No database configured")
            
        schema_summary = get_cached_schema_summary(conn_str)
        if not schema_summary:
             raise HTTPException(status_code=400, detail="Schema cannot be read")

        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            logger.error(f"Failed to initialize LLM for suggestions: {e}")
            raise HTTPException(status_code=500, detail="Failed to initialize AI")

        operations_spec = (
            "You are a translation layer between natural language and a pandas-backed data transformation pipeline.\n"
            "Based on the user's intent, respond exclusively with a JSON list of operation objects.\n\n"
            "Each operation MUST include a 'friendly_description' field with a human-readable sentence explaining what it does.\n\n"
            "SUPPORTED OPERATIONS (type field):\n"
            "1. clean_text: {{\"type\": \"clean_text\", \"column\": \"col_name\", \"clean_type\": \"lower|upper|trim|title|remove_special\", \"friendly_description\": \"...\"}}\n"
            "2. filter: {{\"type\": \"filter\", \"column\": \"col_name\", \"op\": \">|<|==|!=|>=|<=\", \"value\": \"any\", \"friendly_description\": \"...\"}}\n"
            "3. rename_col: {{\"type\": \"rename_col\", \"column\": \"old_name\", \"new_name\": \"new_name\", \"friendly_description\": \"...\"}}\n"
            "4. drop_col: {{\"type\": \"drop_col\", \"column\": \"col_name\", \"friendly_description\": \"...\"}}\n"
            "5. change_type: {{\"type\": \"change_type\", \"column\": \"col_name\", \"new_type\": \"int|float|str|datetime|bool\", \"friendly_description\": \"...\"}}\n"
            "6. fill_na: {{\"type\": \"fill_na\", \"column\": \"col_name\", \"method\": \"value|mean|median|mode\", \"value\": \"any\", \"friendly_description\": \"...\"}}\n"
            "7. drop_duplicates: {{\"type\": \"clean\", \"method\": \"drop_duplicates\", \"subset\": \"col_name\", \"friendly_description\": \"...\"}}\n"
            "8. remove_outliers: {{\"type\": \"clean\", \"method\": \"remove_outliers\", \"column\": \"col_name\", \"outlier_method\": \"z-score\", \"threshold\": 3.0, \"friendly_description\": \"...\"}}\n\n"
            "SCHEMA OF DATABASE:\n"
            "{schema_summary}\n\n"
            "Analyze the user prompt carefully against the schema for table '{table_name}'.\n"
            "Output ONLY valid JSON. Do not use Markdown code fences.\n"
            "Example: [{{\"type\": \"clean_text\", \"column\": \"first_name\", \"clean_type\": \"title\", \"friendly_description\": \"Capitalize first names\"}}]"
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
