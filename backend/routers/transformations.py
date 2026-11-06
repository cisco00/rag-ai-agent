"""
routers/transformations.py — Data transformation, AI-suggested operations,
                              pipeline save/load, and column profiling.
"""

import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from database import DatabaseManager
from dependencies import (
    get_current_org, get_org_connection_string, get_cached_schema_summary,
    require_permission
)
from auth import get_current_user
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

        # Validate table names before any SQL use
        from validators import TableNameValidator
        try:
            TableNameValidator.validate(source_table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid source table name: '{source_table}'")

        # If no target specified, default to creating a new one as requested by user
        if not target_table:
            target_table = f"transformed_{source_table}"
            logger.info(f"Auto-assigning target table: {target_table}")

        try:
            TableNameValidator.validate(target_table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid target table name: '{target_table}'")

        # Load table using threadpool (quoted identifier for mixed-case/reserved-word safety)
        def _load_df():
            query = f'SELECT * FROM "{source_table}"'
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
            max_tokens=2000
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


@router.post("/transform/preview")
async def preview_transform_data(
    request: TransformRequest,
    org=Depends(get_current_org),
    user=Depends(require_permission("MUTATE_TABLES")),
):
    """
    Dry-run the pipeline on a 50-row sample and return before/after rows.
    Nothing is written to the database.
    """
    try:
        from fastapi.concurrency import run_in_threadpool
        import math
        import numpy as np
        import pandas as pd
        from transformations import DataTransformer
        from validators import TableNameValidator

        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database configured for this organization.")

        source_table = request.table_name
        try:
            TableNameValidator.validate(source_table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid table name: '{source_table}'")

        db_manager = DatabaseManager(connection_string=db_conn)

        def _load_sample():
            query = f'SELECT * FROM "{source_table}" LIMIT 50'
            return pd.read_sql(query, db_manager.get_engine())

        df_before = await run_in_threadpool(_load_sample)
        db_manager.close()

        def _apply():
            return DataTransformer.apply_transformations(df_before.copy(), request.operations)

        try:
            df_after = await run_in_threadpool(_apply)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Transformation error: {str(e)}")

        def _clean(rows):
            out = []
            for row in rows:
                cleaned = {}
                for k, v in row.items():
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                        cleaned[k] = None
                    elif isinstance(v, (np.int64, np.int32)):
                        cleaned[k] = int(v)
                    elif isinstance(v, (np.bool_, bool)):
                        cleaned[k] = bool(v)
                    else:
                        cleaned[k] = v
                out.append(cleaned)
            return out

        before_rows = _clean(df_before.head(10).to_dict(orient="records"))
        after_rows  = _clean(df_after.head(10).to_dict(orient="records"))

        return {
            "status": "ok",
            "before": before_rows,
            "after": after_rows,
            "before_columns": list(df_before.columns),
            "after_columns": list(df_after.columns),
            "sample_size": len(df_before),
            "rows_before": len(df_before),
            "rows_after": len(df_after),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Preview failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Pipeline save / load ──────────────────────────────────────────────────────

class SavePipelineRequest(BaseModel):
    name: str
    table_name: str
    operations: list   # raw frontend operation objects (with id + type + params)


@router.get("/transform/pipelines")
async def list_pipelines(
    table: Optional[str] = Query(None, description="Filter by table name"),
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """List saved pipelines for the current user/org, optionally filtered by table."""
    from models import get_db, SavedPipeline
    with get_db() as db:
        q = db.query(SavedPipeline).filter(
            SavedPipeline.org_id == org.id,
            SavedPipeline.user_id == user["id"],
        )
        if table:
            q = q.filter(SavedPipeline.table_name == table)
        pipelines = q.order_by(SavedPipeline.updated_at.desc()).all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "table_name": p.table_name,
                "operations": json.loads(p.operations),
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            }
            for p in pipelines
        ]


@router.post("/transform/pipelines")
async def save_pipeline(
    body: SavePipelineRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Save (or overwrite if same name+table) a named pipeline."""
    from models import get_db, SavedPipeline
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    with get_db() as db:
        existing = db.query(SavedPipeline).filter(
            SavedPipeline.org_id == org.id,
            SavedPipeline.user_id == user["id"],
            SavedPipeline.name == body.name.strip(),
            SavedPipeline.table_name == body.table_name,
        ).first()
        if existing:
            existing.operations = json.dumps(body.operations)
            existing.updated_at = now
            db.flush()
            return {"status": "updated", "id": existing.id}
        else:
            pipeline = SavedPipeline(
                org_id=org.id,
                user_id=user["id"],
                name=body.name.strip()[:255],
                table_name=body.table_name,
                operations=json.dumps(body.operations),
                created_at=now,
                updated_at=now,
            )
            db.add(pipeline)
            db.flush()
            db.refresh(pipeline)
            return {"status": "created", "id": pipeline.id}


@router.delete("/transform/pipelines/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Delete a saved pipeline."""
    from models import get_db, SavedPipeline
    with get_db() as db:
        pipeline = db.query(SavedPipeline).filter(
            SavedPipeline.id == pipeline_id,
            SavedPipeline.org_id == org.id,
            SavedPipeline.user_id == user["id"],
        ).first()
        if not pipeline:
            raise HTTPException(status_code=404, detail="Pipeline not found")
        db.delete(pipeline)
    return {"status": "deleted"}


# ── Column profiling ──────────────────────────────────────────────────────────

@router.get("/tables/{table}/profile")
async def profile_table(
    table: str,
    org=Depends(get_current_org),
    _user=Depends(get_current_user),
):
    """
    Return per-column statistics for a table (sample of up to 2 000 rows).
    For numeric columns: min, max, mean, std, 8-bucket histogram.
    For text/categorical columns: top-5 value frequencies.
    """
    try:
        import math
        import numpy as np
        import pandas as pd
        from fastapi.concurrency import run_in_threadpool
        from validators import TableNameValidator

        try:
            TableNameValidator.validate(table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid table name: '{table}'")

        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database configured for this organization.")

        db_manager = DatabaseManager(connection_string=db_conn)

        def _load():
            return pd.read_sql(f'SELECT * FROM "{table}" LIMIT 2000', db_manager.get_engine())

        df = await run_in_threadpool(_load)
        db_manager.close()

        total_rows = len(df)
        profile: dict = {}

        def _safe(v):
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return None
            if isinstance(v, (np.int64, np.int32, np.int16, np.int8)):
                return int(v)
            if isinstance(v, (np.float64, np.float32)):
                return float(v)
            return v

        for col in df.columns:
            series = df[col]
            null_count = int(series.isna().sum())
            null_pct   = round(null_count / total_rows * 100, 1) if total_rows else 0.0
            unique_count = int(series.nunique(dropna=True))

            stats: dict = {
                "dtype":        str(series.dtype),
                "count":        int(series.count()),
                "null_count":   null_count,
                "null_pct":     null_pct,
                "unique_count": unique_count,
            }

            if pd.api.types.is_numeric_dtype(series):
                non_null = series.dropna()
                if len(non_null) > 0:
                    stats["min"]  = _safe(non_null.min())
                    stats["max"]  = _safe(non_null.max())
                    stats["mean"] = round(_safe(non_null.mean()), 4)
                    stats["std"]  = round(_safe(non_null.std()), 4) if len(non_null) > 1 else 0.0
                    hist, edges   = np.histogram(non_null, bins=8)
                    stats["histogram"] = {
                        "counts": [int(c) for c in hist],
                        "edges":  [round(float(e), 4) for e in edges],
                    }
            else:
                top5 = series.value_counts(dropna=True).head(5)
                stats["top_values"] = [
                    {"value": str(k), "count": int(v)}
                    for k, v in top5.items()
                ]

            profile[col] = stats

        return {
            "table":        table,
            "row_count":    total_rows,
            "column_count": len(df.columns),
            "profile":      profile,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Profile failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
