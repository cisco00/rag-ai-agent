"""router: data — file upload/import, table queries, stats, and data sources."""
import io
import json
import logging
import tempfile
from pathlib import Path
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from main import AnalyticsAgent
from models import update_org_db, get_db, DataSource
from database import DatabaseManager
from pipeline import process_upload
from file_uploader import FileUploader
from validators import sanitize_table_name
from dependencies import (
    get_current_org,
    get_org_connection_string,
    FILE_DB_CACHE,
    FILE_DB_CACHE_LOCK,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class ApiImportRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[dict] = None
    params: Optional[dict] = None
    table_name: str
    if_exists: str = "replace"


class DataSourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    table_name: Optional[str]
    from datetime import datetime
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/import")
async def import_file_to_database(
    file: UploadFile = File(...),
    table_name: Optional[str] = Form(None),
    if_exists: str = Form("replace"),
    org=Depends(get_current_org),
):
    """Import a CSV or Excel file directly into the org's configured database."""
    if not org.db_connection_string:
        db_path = f"sqlite:///org_{org.api_key[:8]}.db"
        update_org_db(org.api_key, db_path)
        org.db_connection_string = db_path
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)

    content = await file.read()
    filename = file.filename

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif filename.endswith((".xls", ".xlsx")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file format. Use CSV or Excel (.csv, .xls, .xlsx)",
            )

        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty or contains no data")

        db_manager = DatabaseManager(connection_string=org.db_connection_string)
        uploader = FileUploader(db_manager)

        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=Path(filename).suffix, delete=False
        ) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name

        try:
            if not table_name:
                table_name = sanitize_table_name(filename)

            result = uploader.upload_file_to_db(
                file_path=tmp_path, table_name=table_name, if_exists=if_exists
            )

            if result["success"]:
                return {
                    "status": "success",
                    "message": f"File '{filename}' imported successfully",
                    "table_name": result["table_name"],
                    "rows_imported": result["rows_imported"],
                    "columns": result["columns"],
                    "column_names": result["column_names"],
                    "column_types": result["column_types"],
                    "action": if_exists,
                    "database": org.db_connection_string.split("://")[0],
                }
            else:
                raise HTTPException(
                    status_code=500, detail=result.get("error", "Import failed")
                )
        finally:
            import os as _os
            if _os.path.exists(tmp_path):
                _os.unlink(tmp_path)
            db_manager.close()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/multiple")
async def import_multiple_files(
    files: List[UploadFile] = File(...),
    table_prefix: Optional[str] = None,
    if_exists: str = "replace",
    cleaning_options: Optional[str] = Form(None),
    org=Depends(get_current_org),
):
    """Import multiple CSV or Excel files at once."""
    if not org.db_connection_string:
        raise HTTPException(status_code=400, detail="No database configured.")

    from pipeline import process_upload_to_db
    results = []
    for file in files:
        content = await file.read()
        filename = file.filename
        try:
            table_name = sanitize_table_name(filename)
            if table_prefix:
                table_name = f"{table_prefix}_{table_name}"

            cleaning_opts = json.loads(cleaning_options) if cleaning_options else None
            result = await run_in_threadpool(
                process_upload_to_db, content, filename, org.db_connection_string,
                org.id, table_name, if_exists, cleaning_opts,
            )
            results.append({"file": filename, "status": "success", **result})
        except Exception as e:
            logger.error(f"Failed to import {filename}: {e}")
            results.append({"file": filename, "status": "error", "error": str(e)})

    return {"status": "complete", "results": results}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), org=Depends(get_current_org)):
    """Upload a CSV or Excel file into the org's configured database."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(
            status_code=400,
            detail="No database configured. Please connect a database first via /config.",
        )
    content = await file.read()
    filename = file.filename
    try:
        result = await run_in_threadpool(process_upload, content, filename, conn_str, org.id)
        return {"status": "success", "message": f"File '{filename}' uploaded and processed.", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Upload failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing file: {exc}")


@router.get("/tables")
async def get_tables(org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    agent = AnalyticsAgent(connection_string=conn_str)
    try:
        tables = agent.db.list_tables()
        schemas = {table: agent.db.describe_table(table) for table in tables}
        with FILE_DB_CACHE_LOCK:
            is_file = org.api_key in FILE_DB_CACHE
        return {"tables": tables, "schemas": schemas, "is_file": is_file}
    finally:
        agent.close()


@router.get("/data/sources")
async def list_data_sources(org=Depends(get_current_org)):
    """List all data sources for the organization."""
    try:
        with get_db() as db:
            sources = db.query(DataSource).filter(DataSource.org_id == org.id).all()
            return [
                {
                    "id": s.id,
                    "name": s.name,
                    "source_type": s.source_type,
                    "table_name": s.table_name,
                    "created_at": s.created_at,
                }
                for s in sources
            ]
    except Exception as e:
        logger.error(f"Failed to list sources: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/api")
async def import_from_api(request: ApiImportRequest, org=Depends(get_current_org)):
    """Import data from an external API."""
    import httpx

    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=request.url,
                headers=request.headers,
                params=request.params,
                timeout=30.0,
            )
            response.raise_for_status()

        data = response.json()

        if isinstance(data, list):
            df = pd.DataFrame(data)
        elif isinstance(data, dict):
            df = None
            for key, val in data.items():
                if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                    df = pd.DataFrame(val)
                    break
            if df is None:
                df = pd.DataFrame([data])
        else:
            raise HTTPException(status_code=400, detail="Could not parse API response as tabular data")

        if not org.db_connection_string:
            raise HTTPException(status_code=400, detail="Organization has no database configured")

        db_manager = DatabaseManager(connection_string=org.db_connection_string)
        success = db_manager.load_dataframe(df, request.table_name, if_exists=request.if_exists)
        db_manager.close()

        if success:
            with get_db() as db:
                source = DataSource(
                    org_id=org.id,
                    name=f"API: {request.url}",
                    source_type="api",
                    connection_details=json.dumps({"url": request.url, "method": request.method}),
                    table_name=request.table_name,
                )
                db.add(source)
                db.commit()

            return {"status": "success", "message": f"Imported {len(df)} rows to table '{request.table_name}'"}
        else:
            raise HTTPException(status_code=500, detail="Failed to save data to database")

    except Exception as e:
        logger.error(f"API import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables/{table_name}/preview")
async def preview_table(table_name: str, org=Depends(get_current_org)):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    if not table_name.isidentifier():
        raise HTTPException(status_code=400, detail="Invalid table name")

    agent = AnalyticsAgent(connection_string=conn_str)
    try:
        from sqlalchemy import text

        schema = agent.db.describe_table(table_name)
        columns = [{"name": col[0], "type": col[1]} for col in schema]

        with agent.db.engine.connect() as conn:
            try:
                result = conn.execute(text(f"SELECT rowid as _id, * FROM {table_name} LIMIT 50"))
            except Exception:
                conn.rollback()
                try:
                    result = conn.execute(text(f"SELECT ctid::text as _id, * FROM {table_name} LIMIT 50"))
                except Exception:
                    conn.rollback()
                    result = conn.execute(text(f"SELECT * FROM {table_name} LIMIT 50"))
            rows = [dict(row._mapping) for row in result]

        return {"table": table_name, "columns": columns, "rows": rows, "total_rows": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()


@router.post("/analyze-file")
async def analyze_file(file: UploadFile = File(...), org=Depends(get_current_org)):
    """Analyze a file without saving it to the database. Returns preview data."""
    content = await file.read()
    filename = file.filename

    try:
        def read_df_sync(content, filename):
            if filename.endswith(".csv"):
                return pd.read_csv(io.BytesIO(content))
            elif filename.endswith((".xls", ".xlsx")):
                return pd.read_excel(io.BytesIO(content))
            return None

        df = await run_in_threadpool(read_df_sync, content, filename)

        if df is None:
            raise HTTPException(status_code=400, detail="Unsupported file format")
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")

        preview_rows = df.head(5).fillna("").to_dict(orient="records")
        columns = []
        missing_values = {}
        for col in df.columns:
            dtype = str(df[col].dtype)
            null_count = int(df[col].isnull().sum())
            columns.append({"name": col, "type": dtype})
            if null_count > 0:
                missing_values[col] = null_count

        return {
            "filename": filename,
            "row_count": len(df),
            "columns": columns,
            "preview_rows": preview_rows,
            "missing_values": missing_values,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing file: {str(e)}")


@router.get("/stats")
async def get_stats(org=Depends(get_current_org)):
    """Get statistics for all tables."""
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        return {"tables": []}

    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        tables = db_manager.list_tables()
        stats_list = [db_manager.get_table_stats(table) for table in tables]
        return {"tables": stats_list, "org_name": org.name}
    except Exception as e:
        logger.error(f"Error fetching stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()
