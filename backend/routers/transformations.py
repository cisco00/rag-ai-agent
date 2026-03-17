"""
routers/transformations.py — Data transformation and AI-suggested operations.
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Depends

from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary
)
from utils import clean_llm_json_content
from schemas import TransformRequest, TransformSuggestRequest

logger = logging.getLogger(__name__)
router = APIRouter()

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
