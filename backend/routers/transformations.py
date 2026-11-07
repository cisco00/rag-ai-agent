"""
routers/transformations.py — Data transformation, AI-suggested operations,
                              pipeline save/load, and column profiling.

Phase 1 engine: ops are compiled to a SQL CTE chain (SQLTransformer).
Ops that cannot be expressed in SQL fall back to Pandas.
Both /transform (apply) and /transform/preview use the hybrid engine and
return run_stats  {engine, sql_ops, pandas_ops, total_time_ms, rows_before,
                   rows_after, cte_count}.
"""

import json
import logging
import time
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


# ── Hybrid execution helper ───────────────────────────────────────────────────

def _run_hybrid(
    db_manager: "DatabaseManager",
    source_table: str,
    operations: list,
    limit: int | None = None,
) -> tuple[object, dict]:
    """
    Execute *operations* against *source_table* using the SQL+Pandas engine.

    Returns (df_result, run_stats).
    run_stats keys:
      engine        "sql" | "pandas" | "hybrid"
      sql_ops       int
      pandas_ops    int
      cte_count     int
      total_time_ms float
      rows_before   int
      rows_after    int
    """
    import pandas as pd
    from transformations import DataTransformer
    from sql_transformer import SQLTransformer

    t0 = time.monotonic()

    # -- 1. Get column list for the compiler --------------------------------
    engine = db_manager.get_engine()
    all_cols_df = pd.read_sql(f'SELECT * FROM "{source_table}" LIMIT 1', engine)
    all_columns = list(all_cols_df.columns)
    rows_before_query = f'SELECT COUNT(*) AS n FROM "{source_table}"'
    rows_before_df = pd.read_sql(rows_before_query, engine)
    rows_before = int(rows_before_df.iloc[0, 0])

    # -- 2. Compile ops to SQL CTE chain ------------------------------------
    dialect = SQLTransformer.dialect_from_connection_string(
        db_manager.connection_string
    )
    result = SQLTransformer.compile(
        table_name=source_table,
        ops=operations,
        dialect=dialect,
        all_columns=all_columns,
    )

    sql_query   = result["sql"]
    params      = result["params"]
    compiled    = result["compiled_ops"]
    skipped     = result["skipped_ops"]
    cte_count   = result["cte_count"]

    # -- 3. Run SQL portion --------------------------------------------------
    if sql_query:
        final_sql = sql_query
        if limit is not None:
            final_sql = f"{sql_query} LIMIT {int(limit)}"
        from sqlalchemy import text as sa_text
        with engine.connect() as conn:
            df = pd.read_sql(sa_text(final_sql).bindparams(**params), conn)
    else:
        # Nothing compiled – load the raw table
        base_q = f'SELECT * FROM "{source_table}"'
        if limit is not None:
            base_q += f" LIMIT {int(limit)}"
        df = pd.read_sql(base_q, engine)

    # -- 4. Pre-load right-side tables for join / union ops in skipped list ----
    enriched_skipped = []
    for op in skipped:
        op_type = op.get("type", "")
        if op_type in ("join", "union"):
            right_table = op.get("right_table", "")
            if right_table:
                try:
                    right_df = pd.read_sql(f'SELECT * FROM "{right_table}"', engine)
                    op = {**op, "_right_df": right_df}
                except Exception as e:
                    logger.warning(f"Could not load right table '{right_table}': {e}")
        enriched_skipped.append(op)

    # -- 5. Pandas fallback for skipped ops ----------------------------------
    if enriched_skipped:
        df = DataTransformer.apply_transformations(df, enriched_skipped)

    t1 = time.monotonic()

    # Determine engine label
    if compiled and skipped:
        eng_label = "hybrid"
    elif compiled:
        eng_label = "sql"
    else:
        eng_label = "pandas"

    run_stats = {
        "engine":        eng_label,
        "sql_ops":       len(compiled),
        "pandas_ops":    len(skipped),
        "cte_count":     cte_count,
        "total_time_ms": round((t1 - t0) * 1000, 1),
        "rows_before":   rows_before,
        "rows_after":    len(df),
    }

    return df, run_stats

# ── Routes ──

@router.post("/transform")
async def transform_data(request: TransformRequest, org=Depends(get_current_org),
                         user=Depends(require_permission("MUTATE_TABLES"))):
    """Apply transformations to a table (hybrid SQL+Pandas engine)."""
    try:
        import math
        import numpy as np
        from fastapi.concurrency import run_in_threadpool
        from validators import TableNameValidator

        db_conn = get_org_connection_string(org)
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")

        source_table = request.table_name
        target_table = request.target_table

        try:
            TableNameValidator.validate(source_table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid source table name: '{source_table}'")

        if not target_table:
            target_table = f"transformed_{source_table}"
            logger.info(f"Auto-assigning target table: {target_table}")

        try:
            TableNameValidator.validate(target_table)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid target table name: '{target_table}'")

        db_manager = DatabaseManager(connection_string=db_conn)

        def _run():
            return _run_hybrid(db_manager, source_table, request.operations)

        try:
            df, run_stats = await run_in_threadpool(_run)
        except Exception as e:
            logger.error(f"Hybrid transform error: {e}", exc_info=True)
            db_manager.close()
            raise HTTPException(status_code=400, detail=f"Transformation error: {str(e)}")

        def _save(dataframe, table):
            return db_manager.load_dataframe(dataframe, table, if_exists="replace")

        success = await run_in_threadpool(_save, df, target_table)
        db_manager.close()

        if success:
            preview_data = df.head(10).to_dict(orient="records")
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
                "status":       "success",
                "message":      f"Transformed data saved to '{target_table}'",
                "rows_affected": len(df),
                "target_table": target_table,
                "preview":      cleaned_preview,
                "run_stats":    run_stats,
            }
        else:
            raise Exception("Failed to save transformed data to database")

    except HTTPException:
        raise
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

        system_msg = {"role": "system", "content": operations_spec.format(schema_summary=schema_summary, table_name=request.table_name)}
        messages = [system_msg]

        # Inject prior conversation turns so the AI has context for follow-ups
        if request.conversation:
            for turn in request.conversation:
                messages.append({"role": turn.role, "content": turn.content})

        user_prompt = f"Table: {request.table_name}. Prompt: {request.prompt}"
        messages.append({"role": "user", "content": user_prompt})
        
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
            
        return {
            "status": "success",
            "operations": operations,
            # Return the raw LLM reply so the frontend can append it to conversation history
            "assistant_message": content,
            "user_message": user_prompt,
        }

    except Exception as e:
        logger.error(f"Error suggesting transformations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── AI pipeline explanation ───────────────────────────────────────────────────

class ExplainPipelineRequest(BaseModel):
    table_name: str
    operations: list   # already-mapped backend ops


@router.post("/transform/explain")
async def explain_pipeline(
    request: ExplainPipelineRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Return a plain-English paragraph explaining what the pipeline does,
    plus a one-line summary suitable for a commit message / notification.
    """
    try:
        from config import get_agent_config
        from llm_client import get_llm_client

        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            raise HTTPException(status_code=500, detail="Failed to initialize AI")

        ops_json = __import__('json').dumps(request.operations, indent=2)
        prompt = (
            f"You are a data engineer explaining a transformation pipeline to a business analyst.\n"
            f"Source table: {request.table_name}\n"
            f"Pipeline operations (JSON):\n{ops_json}\n\n"
            f"Write TWO things, separated by a line that is exactly '---':\n"
            f"1. A plain-English paragraph (3-5 sentences) explaining what the pipeline does "
            f"and why each step matters. Use business language, not technical jargon.\n"
            f"2. A single sentence (max 15 words) suitable as a pipeline title or notification.\n"
            f"Do not include headers, bullets, or JSON. Just the paragraph, then ---, then the sentence."
        )

        response = client.chat_completion(
            model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
        )
        content = response.choices[0].message.content.strip()

        # Split on the separator
        parts = content.split("---", 1)
        paragraph = parts[0].strip()
        summary   = parts[1].strip() if len(parts) > 1 else paragraph[:80]

        return {"paragraph": paragraph, "summary": summary}

    except Exception as e:
        logger.error(f"Error explaining pipeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transform/preview")
async def preview_transform_data(
    request: TransformRequest,
    org=Depends(get_current_org),
    user=Depends(require_permission("MUTATE_TABLES")),
):
    """
    Dry-run the pipeline on a 50-row sample and return before/after rows.
    Uses the hybrid SQL+Pandas engine. Nothing is written to the database.
    """
    try:
        import math
        import numpy as np
        import pandas as pd
        from fastapi.concurrency import run_in_threadpool
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

        # Load 50-row "before" sample in background
        def _load_before():
            return pd.read_sql(
                f'SELECT * FROM "{source_table}" LIMIT 50',
                db_manager.get_engine()
            )

        df_before = await run_in_threadpool(_load_before)

        # Run hybrid engine — LIMIT 50 applied inside SQL CTE final SELECT
        def _run_preview():
            return _run_hybrid(db_manager, source_table, request.operations, limit=50)

        try:
            df_after, run_stats = await run_in_threadpool(_run_preview)
        except Exception as e:
            db_manager.close()
            raise HTTPException(status_code=400, detail=f"Transformation error: {str(e)}")

        db_manager.close()

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
            "status":         "ok",
            "before":         before_rows,
            "after":          after_rows,
            "before_columns": list(df_before.columns),
            "after_columns":  list(df_after.columns),
            "sample_size":    len(df_before),
            "rows_before":    len(df_before),
            "rows_after":     len(df_after),
            "run_stats":      run_stats,
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


# ── Pipeline scheduling ───────────────────────────────────────────────────────

class SchedulePipelineRequest(BaseModel):
    frequency: str   # hourly | daily | weekly | monthly


@router.post("/transform/pipelines/{pipeline_id}/schedule")
async def schedule_pipeline(
    pipeline_id: int,
    body: SchedulePipelineRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Create or replace the schedule for a saved pipeline."""
    allowed = {"hourly", "daily", "weekly", "monthly"}
    if body.frequency not in allowed:
        raise HTTPException(status_code=400, detail=f"frequency must be one of {allowed}")

    from models import get_db, SavedPipeline, PipelineSchedule
    from scheduler import schedule_pipeline_job, _next_run_for_frequency
    from datetime import datetime, timedelta

    with get_db() as db:
        # Verify pipeline ownership
        pipeline = db.query(SavedPipeline).filter(
            SavedPipeline.id == pipeline_id,
            SavedPipeline.org_id == org.id,
            SavedPipeline.user_id == user["id"],
        ).first()
        if not pipeline:
            raise HTTPException(status_code=404, detail="Pipeline not found")

        # Upsert schedule
        existing = db.query(PipelineSchedule).filter(
            PipelineSchedule.pipeline_id == pipeline_id,
            PipelineSchedule.org_id == org.id,
        ).first()

        now = datetime.utcnow()
        next_run = _next_run_for_frequency(body.frequency, now)

        if existing:
            existing.frequency   = body.frequency
            existing.is_active   = 1
            existing.next_run_at = next_run
            sched = existing
        else:
            sched = PipelineSchedule(
                org_id=org.id, user_id=user["id"],
                pipeline_id=pipeline_id,
                frequency=body.frequency,
                is_active=1,
                next_run_at=next_run,
                created_at=now,
            )
            db.add(sched)
            db.flush()
            db.refresh(sched)

        db.commit()
        schedule_pipeline_job(sched.id, next_run)

        return {
            "status": "scheduled",
            "schedule_id": sched.id,
            "frequency": sched.frequency,
            "next_run_at": sched.next_run_at.isoformat(),
        }


@router.delete("/transform/pipelines/{pipeline_id}/schedule")
async def unschedule_pipeline(
    pipeline_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Remove the schedule for a saved pipeline."""
    from models import get_db, PipelineSchedule
    from scheduler import scheduler as apscheduler

    with get_db() as db:
        sched = db.query(PipelineSchedule).filter(
            PipelineSchedule.pipeline_id == pipeline_id,
            PipelineSchedule.org_id == org.id,
        ).first()
        if not sched:
            raise HTTPException(status_code=404, detail="No schedule found for this pipeline")
        job_id = f"pipeline_schedule_{sched.id}"
        try:
            apscheduler.remove_job(job_id)
        except Exception:
            pass   # already gone
        db.delete(sched)
    return {"status": "unscheduled"}


@router.get("/transform/pipelines/{pipeline_id}/schedule")
async def get_pipeline_schedule(
    pipeline_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Return the current schedule (if any) for a saved pipeline."""
    from models import get_db, PipelineSchedule

    with get_db() as db:
        sched = db.query(PipelineSchedule).filter(
            PipelineSchedule.pipeline_id == pipeline_id,
            PipelineSchedule.org_id == org.id,
        ).first()
        if not sched:
            return {"scheduled": False}
        return {
            "scheduled":        True,
            "schedule_id":      sched.id,
            "frequency":        sched.frequency,
            "is_active":        bool(sched.is_active),
            "next_run_at":      sched.next_run_at.isoformat() if sched.next_run_at else None,
            "last_run_at":      sched.last_run_at.isoformat()  if sched.last_run_at  else None,
            "last_run_status":  sched.last_run_status,
            "last_run_message": sched.last_run_message,
        }


# ── Batch apply ───────────────────────────────────────────────────────────────

class BatchTransformRequest(BaseModel):
    pipeline_id: Optional[int] = None          # run a saved pipeline
    operations:  Optional[list] = None          # or inline operations
    tables: list                                # list of table names to run against


@router.post("/transform/batch")
async def batch_transform(
    body: BatchTransformRequest,
    org=Depends(get_current_org),
    user=Depends(require_permission("MUTATE_TABLES")),
):
    """
    Apply the same pipeline to multiple tables.
    Returns per-table success/error status and row counts.
    """
    if not body.tables:
        raise HTTPException(status_code=400, detail="No tables specified")

    # Resolve operations
    ops_list = body.operations
    if body.pipeline_id:
        from models import get_db, SavedPipeline
        with get_db() as db:
            pipeline = db.query(SavedPipeline).filter(
                SavedPipeline.id == body.pipeline_id,
                SavedPipeline.org_id == org.id,
                SavedPipeline.user_id == user["id"],
            ).first()
            if not pipeline:
                raise HTTPException(status_code=404, detail="Pipeline not found")
            ops_list = json.loads(pipeline.operations)
    if not ops_list:
        raise HTTPException(status_code=400, detail="No operations found in pipeline")

    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured")

    from transformations import DataTransformer
    import pandas as pd

    results = []
    for table_name in body.tables:
        db_manager = None
        try:
            db_manager = DatabaseManager(connection_string=conn_str)
            df = db_manager.execute_query(f'SELECT * FROM "{table_name}"')
            if df is None or df.empty:
                results.append({"table": table_name, "status": "skipped", "message": "Table is empty", "rows": 0})
                continue

            df_out = DataTransformer.apply_transformations(df.copy(), ops_list)
            target = f"transformed_{table_name}"
            ok = db_manager.load_dataframe(df_out, target, if_exists='replace')

            if ok:
                results.append({"table": table_name, "status": "success", "target": target, "rows": len(df_out)})
            else:
                results.append({"table": table_name, "status": "error", "message": "Failed to write output"})
        except Exception as e:
            logger.error(f"Batch transform error on table '{table_name}': {e}", exc_info=True)
            results.append({"table": table_name, "status": "error", "message": str(e)})
        finally:
            if db_manager:
                db_manager.close()

    success_count = sum(1 for r in results if r["status"] == "success")
    return {
        "status": "done",
        "total": len(results),
        "success": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }


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
