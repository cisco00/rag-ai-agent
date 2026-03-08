"""router: transformations — table manipulation and AI-suggested transformations."""
import json
import logging
import time
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from database import DatabaseManager
from pipeline import apply_transform
from utils import clean_llm_json_content
from dependencies import (
    get_current_org,
    get_org_connection_string,
    get_cached_schema_summary,
    FILE_DB_CACHE,
    FILE_DB_CACHE_LOCK,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Request models ---
class TransformRequest(BaseModel):
    table_name: str
    operations: List[Dict[str, Any]]
    target_table: Optional[str] = None


class TransformSuggestRequest(BaseModel):
    table_name: str
    prompt: str


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


# --- Endpoints ---

@router.post("/transform")
async def transform_data(request: TransformRequest, org=Depends(get_current_org)):
    """Apply transformation operations to a table."""
    db_conn = get_org_connection_string(org)
    if not db_conn:
        raise HTTPException(status_code=400, detail="No database configured.")
    try:
        result = await run_in_threadpool(
            apply_transform, db_conn, request.table_name, request.operations, request.target_table
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Transformation failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/transform/suggest")
async def suggest_transformations(request: TransformSuggestRequest, org=Depends(get_current_org)):
    """Suggest transformation operations based on natural language prompt."""
    try:
        conn_str = get_org_connection_string(org)
        if not conn_str:
            raise HTTPException(status_code=400, detail="No database configured")

        schema_summary = get_cached_schema_summary(conn_str)
        if not schema_summary:
            raise HTTPException(status_code=400, detail="Schema cannot be read")

        from config import get_agent_config
        from llm_client import get_llm_client

        config = get_agent_config()
        try:
            client = get_llm_client(config.model_provider, config)
        except Exception as e:
            logger.error(f"Failed to initialize LLM: {e}")
            raise HTTPException(status_code=500, detail="Failed to initialize AI")

        operations_spec = (
            "You are a translation layer between natural language and a pandas-backed data transformation pipeline.\n"
            "Based on the user's intent, respond exclusively with a JSON list of operation objects.\n\n"
            "SUPPORTED OPERATIONS:\n"
            '1. clean_text: {"type": "clean_text", "column": "col_name", "clean_type": "lower|upper|trim|title|remove_special"}\n'
            '2. filter: {"type": "filter", "column": "col_name", "op": ">|<|==|!=|>=|<=", "value": "any"}\n'
            '3. rename_col: {"type": "rename_col", "column": "old_name", "new_name": "new_name"}\n'
            '4. drop_col: {"type": "drop_col", "column": "col_name"}\n'
            '5. change_type: {"type": "change_type", "column": "col_name", "new_type": "int|float|str|datetime|bool"}\n'
            '6. fill_na: {"type": "fill_na", "column": "col_name", "method": "value|mean|median|mode", "value": "any"}\n'
            '7. drop_duplicates: {"type": "clean", "method": "drop_duplicates", "subset": "col_name"}\n'
            '8. remove_outliers: {"type": "clean", "method": "remove_outliers", "column": "col_name", "outlier_method": "z-score", "threshold": 3.0}\n\n'
            f"SCHEMA OF DATABASE:\n{schema_summary}\n\n"
            f"Output ONLY valid JSON. No markdown. Example: "
            '[{"type": "clean_text", "column": "first_name", "clean_type": "title"}]'
        )

        messages = [
            {"role": "system", "content": operations_spec},
            {"role": "user", "content": f"Table: {request.table_name}. Prompt: {request.prompt}"},
        ]

        response = client.chat_completion(model=config.model_name, messages=messages, max_tokens=500)
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


@router.post("/tables/{table_name}/duplicate")
async def duplicate_table_endpoint(table_name: str, org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        new_name = f"{table_name}_copy_{int(time.time())}"
        db_manager.duplicate_table(table_name, new_name)
        return {"status": "success", "new_table": new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.patch("/tables/{table_name}/cell")
async def update_cell_endpoint(table_name: str, request: UpdateCellRequest, org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        success = db_manager.update_cell_value(table_name, request.row_id, request.column, request.value)
        if not success:
            raise HTTPException(status_code=404, detail="Row not found or no change made")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.post("/tables/{table_name}/columns/{column_name}/fill")
async def fill_missing_values_endpoint(
    table_name: str, column_name: str, request: FillMissingRequest, org=Depends(get_current_org)
):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        rows_affected = db_manager.fill_missing_values(
            table_name, column_name, request.strategy, request.value, request.weight_column
        )
        return {"status": "success", "rows_affected": rows_affected}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.delete("/tables/{table_name}")
async def delete_table_endpoint(table_name: str, org=Depends(get_current_org)):
    """Delete a table (only copies allowed)."""
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    if "_copy_" not in table_name:
        raise HTTPException(
            status_code=403, detail="Only table copies can be deleted. Original data is protected."
        )
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        db_manager.drop_table(table_name)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error deleting table: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.post("/tables/{table_name}/columns/rename")
async def rename_column_endpoint(table_name: str, request: RenameColumnRequest, org=Depends(get_current_org)):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        db_manager.rename_column(table_name, request.old_column, request.new_column)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.delete("/tables/{table_name}/columns/{column_name}")
async def drop_column_endpoint(table_name: str, column_name: str, org=Depends(get_current_org)):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        db_manager.drop_column(table_name, column_name)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.delete("/tables/{table_name}/rows/{row_id}")
async def delete_row_endpoint(table_name: str, row_id: str, org=Depends(get_current_org)):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        try:
            rid = int(row_id)
        except Exception:
            rid = row_id
        success = db_manager.delete_row(table_name, rid)
        if not success:
            raise HTTPException(status_code=404, detail="Row not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()
