"""
routers/data.py — routes migrated from monolithic api.py
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
from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK, require_permission
from utils import clean_llm_json_content
from email_service import send_email_mock
from validators import sanitize_table_name
from export_manager import ExportManager
from scheduler import schedule_job_for_report
import pandas as pd
from profiler import profile_table

logger = logging.getLogger(__name__)
router = APIRouter()



from schemas import (
    CreateDatabaseRequest, DataSourceResponse, UpdateCellRequest,
    FeedbackRequest, RenameColumnRequest, FillMissingRequest, ApiImportRequest
)



# ── Routes ──

@router.get("/database/available")
async def get_available_databases(org=Depends(get_current_org)):
    """Fetch connection history for the organization."""
    from models import get_org_connection_history
    try:
        history = get_org_connection_history(org.id)
        return {"status": "success", "databases": history}
    except Exception as e:
        logger.error(f"Failed to fetch connection history: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve database connection history.")


@router.post("/database/create-postgres")
async def create_postgres_database(request: CreateDatabaseRequest, org=Depends(get_current_org),
                                   user=Depends(require_permission("MANAGE_ORG"))):
    """Create a new Postgres database, a new user, and update org config"""
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    
    # Resolve admin credentials (prefer provided from frontend, fallback to env vars)
    admin_user = request.admin_user or os.getenv("POSTGRES_SYS_ADMIN_USER", "postgres")
    admin_password = request.admin_password or os.getenv("POSTGRES_SYS_ADMIN_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    
    # 1. Connect to postgres system db
    try:
        conn = psycopg2.connect(
            user=admin_user, 
            password=admin_password, 
            host=host, 
            port=port, 
            dbname='postgres'
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # 2. Create User if not exists
        # Check existence
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (request.new_user,))
        if not cur.fetchone():
             # Create Role
             # Use sql.SQL to safely identifier quoting
             cur.execute(sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {} CREATEDB").format(
                sql.Identifier(request.new_user),
                sql.Literal(request.new_password)
             ))
        
        # 3. Check if DB exists
        cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{request.new_db_name}'")
        if cur.fetchone():
             pass 
        else:
            # Create it with new user as owner
            if not request.new_db_name.isalnum():
                 raise HTTPException(status_code=400, detail="Database name must be alphanumeric")
            
            # CREATE DATABASE cannot be executed with sql parameters easily for identifier?
            # actually sql.Identifier works
            cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(request.new_db_name),
                sql.Identifier(request.new_user)
            ))
            
        conn.close()
        
        # Grant permissions on public schema (required for PG15+)
        try:
            conn_new = psycopg2.connect(
                user=admin_user, 
                password=admin_password, 
                host=host, 
                port=port, 
                dbname=request.new_db_name
            )
            conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur_new = conn_new.cursor()
            cur_new.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(request.new_db_name),
                sql.Identifier(request.new_user)
            ))
            cur_new.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(request.new_user)))
            cur_new.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {}").format(sql.Identifier(request.new_user)))
            conn_new.close()
        except Exception as e:
             logger.error(f"Failed to grant permissions: {e}")
        
        # 4. Formulate new connection string using NEW USER credentials
        new_conn_str = f"postgresql://{request.new_user}:{request.new_password}@{host}:{port}/{request.new_db_name}"
        
        # 5. Update Org Config
        update_org_db(org.api_key, new_conn_str)
        # Log to connection history
        from models import log_connection
        log_connection(org.id, new_conn_str)

        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
            
        # 6. Send Email using org.email if available, fallback to request.email
        recipient_email = getattr(org, 'email', None)
        if recipient_email:
            subject = "Your New Database & User Details"
            body = f"""
Hello,

A new PostgreSQL database and user have been created for you.

Details:
Host: {host}
Port: {port}
Database Name: {request.new_db_name}
New Username: {request.new_user}
New Password: {request.new_password}

You can now use these credentials to connect external tools.
The Vantage AI Agent is already configured to use this connection.

Regards,
Vantage AI Team
"""
            try:
                send_email_mock(recipient_email, subject, body.strip())
            except Exception as e:
                logger.error(f"Failed to send create DB email: {e}")
        else:
             logger.warning("No email available to send database creation notification.")
                
        return {
            "status": "success", "message": f"Database '{request.new_db_name}' created with user '{request.new_user}'."}
        
    except Exception as e:
        logger.error(f"Failed to create database: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create the database. Please verify your administrative credentials and ensure the database name is unique.")


@router.post("/import")
async def import_file_to_database(
    file: UploadFile = File(...), 
    table_name: Optional[str] = Form(None),
    if_exists: str = Form('replace'),
    org=Depends(get_current_org),
    user=Depends(require_permission("WRITE_DATA"))
):
    """
    Import a CSV or Excel file directly into the organization's configured database.
    This creates a permanent table that can be queried for analysis.
    
    Args:
        file: The CSV or Excel file to upload
        table_name: Name for the database table (optional, defaults to filename)
        if_exists: How to handle existing table: 'fail', 'replace', or 'append'
    
    Returns:
        Import status with table details
    """
    # Check if organization has a configured database
    if not org.db_connection_string:
        # Auto-provision a database for the organization
        print(f"Auto-provisioning database for org {org.name}")
        db_path = f"sqlite:///org_{org.api_key[:8]}.db"
        update_org_db(org.api_key, db_path)
        # Refresh org object and file cache
        org.db_connection_string = db_path
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
    
    content = await file.read()
    filename = file.filename
    
    try:
        # Import file_uploader module
        from file_uploader import FileUploader
        
        # Read file into DataFrame
        if filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        elif filename.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Use CSV or Excel (.csv, .xls, .xlsx)")
        
        # Validate file is not empty
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty or contains no data")
        
        # Store original stats
        original_rows = len(df)
        original_cols = len(df.columns)
        
        # Create database manager with org's connection string
        db_manager = DatabaseManager(connection_string=org.db_connection_string)
        
        # Create file uploader instance
        uploader = FileUploader(db_manager)
        
        # Save file temporarily
        import tempfile
        with tempfile.NamedTemporaryFile(mode='wb', suffix=Path(filename).suffix, delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            if not table_name:
                table_name = sanitize_table_name(filename)

            # Upload file to database
            result = uploader.upload_file_to_db(
                file_path=tmp_path,
                table_name=table_name,
                if_exists=if_exists
            )
            
            if result['success']:
                return {
                    "status": "success",
                    "message": f"File '{filename}' imported successfully",
                    "table_name": result['table_name'],
                    "rows_imported": result['rows_imported'],
                    "columns": result['columns'],
                    "column_names": result['column_names'],
                    "column_types": result['column_types'],
                    "action": if_exists,
                    "database": org.db_connection_string.split('://')[0]  # Show DB type
                }
            else:
                raise HTTPException(status_code=500, detail=result.get('error', 'Import failed'))
        
        finally:
            # Clean up temp file
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            db_manager.close()
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error importing file: {str(e)}")


@router.post("/import/batch")
async def import_multiple_files(
    files: List[UploadFile] = File(...),
    table_prefix: Optional[str] = None,
    if_exists: str = 'replace',
    cleaning_options: Optional[str] = Form(None),
    org=Depends(get_current_org),
    user=Depends(require_permission("WRITE_DATA"))
):
    """
    Import multiple CSV or Excel files at once into the organization's database.
    Each file creates a separate table.
    
    Args:
        files: List of CSV or Excel files to upload
        table_prefix: Optional prefix for all table names (e.g., 'import_2024')
        if_exists: How to handle existing tables: 'fail', 'replace', or 'append'
        cleaning_options: JSON string mapping filenames to column cleaning strategies
                          e.g. {"file.csv": {"col1": "fill_mean", "col2": "drop_rows"}}
    
    Returns:
        Batch import status with results for each file
    """
    # Check if organization has a configured database
    if not org.db_connection_string:
        # Auto-provision a database for the organization
        print(f"Auto-provisioning database for org {org.name}")
        db_path = f"sqlite:///org_{org.api_key[:8]}.db"
        update_org_db(org.api_key, db_path)
        # Refresh org object and file cache
        org.db_connection_string = db_path
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
    
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    # Parse cleaning options
    import json
    options_map = {}
    if cleaning_options:
        try:
            options_map = json.loads(cleaning_options)
        except json.JSONDecodeError:
            pass # Ignore invalid JSON, treat as no options
    
    # Limit number of files to prevent abuse
    max_files = 20
    if len(files) > max_files:
        raise HTTPException(
            status_code=400, 
            detail=f"Too many files. Maximum {max_files} files allowed per batch."
        )
    
    results = {
        "status": "success",
        "total_files": len(files),
        "successful": 0,
        "failed": 0,
        "files": []
    }
    
    # Import file_uploader module
    from file_uploader import FileUploader
    
    # Create database manager with org's connection string
    try:
        db_manager = DatabaseManager(connection_string=org.db_connection_string)
    except Exception as e:
        logger.error(f"Failed to initialize database manager for import: {e}")
        raise HTTPException(status_code=500, detail="Failed to connect to the database for import. Please check your organization's database configuration.")
    uploader = FileUploader(db_manager)
    
    import tempfile
    
    try:
        for file in files:
            file_result = {
                "filename": file.filename,
                "status": "pending"
            }
            
            try:
                content = await file.read()
                filename = file.filename
                
                # Validate file type
                if not filename.endswith(('.csv', '.xls', '.xlsx')):
                    file_result["status"] = "failed"
                    file_result["error"] = f"Unsupported file format. Only CSV and Excel files allowed."
                    results["failed"] += 1
                    results["files"].append(file_result)
                    continue
                
                # Generate table name
                table_name = sanitize_table_name(filename, prefix=table_prefix)
                
                # Save file temporarily
                with tempfile.NamedTemporaryFile(mode='wb', suffix=Path(filename).suffix, delete=False) as tmp_file:
                    tmp_file.write(content)
                    tmp_path = tmp_file.name
                
                # Get options for this file if available
                file_options = options_map.get(filename, None)
                
                try:
                    # Upload file to database
                    result = uploader.upload_file_to_db(
                        file_path=tmp_path,
                        table_name=table_name,
                        if_exists=if_exists,
                        cleaning_options=file_options
                    )
                    
                    if result['success']:
                        file_result["status"] = "success"
                        file_result["table_name"] = result['table_name']
                        file_result["rows_imported"] = result['rows_imported']
                        file_result["columns"] = result['columns']
                        file_result["column_names"] = result['column_names']
                        results["successful"] += 1
                    else:
                        file_result["status"] = "failed"
                        file_result["error"] = result.get('error', 'Import failed')
                        results["failed"] += 1
                
                finally:
                    # Clean up temp file
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                
            except Exception as e:
                file_result["status"] = "failed"
                file_result["error"] = str(e)
                results["failed"] += 1
            
            results["files"].append(file_result)
        
        # Update overall status
        if results["failed"] > 0 and results["successful"] == 0:
            results["status"] = "failed"
            # Add top-level error for frontend
            if len(files) == 1:
                results["error"] = results["files"][0].get("error", "Import failed")
            else:
                results["error"] = "All file imports failed"
        elif results["failed"] > 0:
            results["status"] = "partial"
        
        return results
        
    finally:
        db_manager.close()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), org=Depends(get_current_org),
                      user=Depends(require_permission("WRITE_DATA"))):
    content = await file.read()
    filename = file.filename
    
    try:
        import pandas as pd
        def read_df_sync(content, filename):
            if filename.endswith('.csv'):
                return pd.read_csv(io.BytesIO(content))
            elif filename.endswith(('.xls', '.xlsx')):
                return pd.read_excel(io.BytesIO(content))
            else:
                return None

        # Run blocking pandas read in a threadpool
        df = await run_in_threadpool(read_df_sync, content, filename)
        
        if df is None:
             raise HTTPException(status_code=400, detail="Unsupported file format. Use CSV or Excel.")
        
        # Store original row count for reporting
        original_rows = len(df)
        
        # DATA CLEANING FUNCTION
        def clean_dataframe(df):
            """Clean dataframe by handling missing and null values"""
            cleaning_report = []
            
            # 1. Drop columns that are entirely null
            null_cols = df.columns[df.isnull().all()].tolist()
            if null_cols:
                df = df.drop(columns=null_cols)
                cleaning_report.append(f"Removed {len(null_cols)} empty columns")
            
            # 2. Drop rows where more than 50% of values are null
            threshold = len(df.columns) * 0.5
            df = df.dropna(thresh=threshold)
            
            # 3. Handle remaining nulls by column type
            for col in df.columns:
                null_count = df[col].isnull().sum()
                if null_count > 0:
                    # For numeric columns, fill with median
                    if pd.api.types.is_numeric_dtype(df[col]):
                        median_val = df[col].median()
                        df[col] = df[col].fillna(median_val)
                        cleaning_report.append(f"Filled {null_count} nulls in '{col}' with median ({median_val})")
                    
                    # For categorical/text columns, fill with mode or 'Unknown'
                    else:
                        if df[col].mode().empty:
                            df[col] = df[col].fillna('Unknown')
                            cleaning_report.append(f"Filled {null_count} nulls in '{col}' with 'Unknown'")
                        else:
                            mode_val = df[col].mode()[0]
                            df[col] = df[col].fillna(mode_val)
                            cleaning_report.append(f"Filled {null_count} nulls in '{col}' with mode ('{mode_val}')")
            
            return df, cleaning_report
        
        # Apply cleaning
        df, cleaning_report = clean_dataframe(df)
        cleaned_rows = len(df)
        
        # Clean col names for SQL
        df.columns = [c.replace(' ', '_').replace('(', '').replace(')', '').lower() for c in df.columns]
        
        # Create a unique in-memory database for this org's file
        temp_db_path = f"file_db_{org.api_key}.sqlite"
        db_manager = DatabaseManager(connection_string=f"sqlite:///{temp_db_path}")
        
        # Load into table named 'uploaded_data'
        success = db_manager.load_dataframe(df, "uploaded_data", if_exists='replace')
        db_manager.close()
        
        if success:
            with FILE_DB_CACHE_LOCK:
                FILE_DB_CACHE[org.api_key] = f"sqlite:///{temp_db_path}"
            return {
                "status": "success", 
                "message": f"File '{filename}' uploaded and processed.", 
                "table_name": "uploaded_data",
                "cleaning_summary": {
                    "original_rows": original_rows,
                    "cleaned_rows": cleaned_rows,
                    "rows_removed": original_rows - cleaned_rows,
                    "actions": cleaning_report
                }
            }
        else:
            raise Exception("Failed to load dataframe into SQL")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.get("/health")
async def health_check():
    return {"status": "healthy"}


@router.get("/tables")
async def get_tables(org=Depends(get_current_org)):
    # Check if there's an active file first
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    from main import AnalyticsAgent
    agent = AnalyticsAgent(connection_string=conn_str)
    try:
        tables = agent.db.list_tables()
        schemas = {}
        for table in tables:
            schemas[table] = agent.db.describe_table(table)
        with FILE_DB_CACHE_LOCK:
            is_file = org.api_key in FILE_DB_CACHE
        return {"tables": tables, "schemas": schemas, "is_file": is_file}
    finally:
        agent.close()


@router.get("/tables/{table_name}/profile")
async def get_table_profile(table_name: str, force: bool = False, org=Depends(get_current_org)):
    """Fetch column-level statistics for a table."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    try:
        raw_profile = profile_table(conn_str, table_name, force=force)
        
        # Transform for frontend compatibility (matches DataProfiler.tsx expectations)
        row_count = raw_profile.get("total_rows", 0)
        formatted_columns = {}
        
        for col_name, stats in raw_profile.get("columns", {}).items():
            # Basic mapping
            formatted_stats = {
                "dtype": stats.get("data_type", "unknown"),
                "total_count": row_count,
                "null_count": stats.get("null_count", 0),
                "null_pct": stats.get("null_pct", 0),
                "distinct_count": stats.get("distinct_count", 0),
                "sample_values": stats.get("sample", []),
                "std": stats.get("std_dev")
            }
            
            # Numeric stats
            for field in ["min", "max", "mean", "median", "p25", "p75"]:
                if field in stats:
                    formatted_stats[field] = stats[field]
            
            # Top values: frontend expects [string, number][]
            if "top_values" in stats:
                formatted_stats["top_values"] = [
                    (str(item["value"]), item["count"]) 
                    for item in stats["top_values"]
                ]
            
            formatted_columns[col_name] = formatted_stats

        profile = {
            "table": raw_profile.get("table", table_name),
            "row_count": row_count,
            "column_count": raw_profile.get("column_count", 0),
            "profiled_at": raw_profile.get("profiled_at"),
            "columns": formatted_columns
        }
        
        return {"status": "success", "profile": profile}
    except Exception as e:
        logger.error(f"Profiling failed for {table_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate a profile for table '{table_name}'. Please ensure the table contains valid data.")


@router.post("/feedback")
async def submit_feedback(request: FeedbackRequest, org=Depends(get_current_org)):
    try:
        feedback = create_feedback(
            org_id=org.id,
            query=request.query,
            response=request.response,
            vote=request.vote,
            feedback_text=request.feedback_text
        )

        # Record correction for implicit organizational learning if feedback exists
        if request.feedback_text:
            try:
                from org_context_manager import OrgContextManager
                ctx_manager = OrgContextManager(org.id)
                ctx_manager.record_correction(
                    original_query=request.query,
                    original_response=request.response,
                    user_correction=request.feedback_text
                )
                logger.info(f"Recorded correction for org {org.id}")
            except Exception as e:
                logger.error(f"Failed to record correction: {e}")

        return {"status": "success", "message": "Feedback submitted successfully", "id": feedback.id}
    except Exception as e:
        logger.error(f"Feedback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit feedback")

# --- New Data Feature Endpoints ---


@router.get("/data/sources", response_model=List[DataSourceResponse])
async def list_data_sources(org=Depends(get_current_org)):
    """List all data sources for the organization."""
    try:
        with get_db() as db:
            sources = db.query(DataSource).filter(DataSource.org_id == org.id).all()
            return sources
    except Exception as e:
        logger.error(f"Failed to list sources: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/api")
async def import_from_api(request: ApiImportRequest, org=Depends(get_current_org),
                          user=Depends(require_permission("WRITE_DATA"))):
    """Import data from an external API."""
    import httpx
    try:
        # Fetch data
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=request.url,
                headers=request.headers,
                params=request.params,
                timeout=30.0
            )
            response.raise_for_status()
            
        data = response.json()
        
        # Convert to DataFrame
        import pandas as pd
        # Handle list of dicts or dict with list
        if isinstance(data, list):
            df = pd.DataFrame(data)
        elif isinstance(data, dict):
            # heuristics to find the list
            found_list = False
            for key, val in data.items():
                if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                    df = pd.DataFrame(val)
                    found_list = True
                    break
            if not found_list:
                 df = pd.DataFrame([data])
        else:
             raise HTTPException(status_code=400, detail="Could not parse API response as tabular data")
             
        # Save to DB
        # Create database manager with org's connection string
        if not org.db_connection_string:
             # Auto-provision a database for the organization
             print(f"Auto-provisioning database for org {org.name}")
             db_path = f"sqlite:///org_{org.api_key[:8]}.db"
             update_org_db(org.api_key, db_path)
             # Refresh org object and file cache
             org.db_connection_string = db_path
             with FILE_DB_CACHE_LOCK:
                 FILE_DB_CACHE.pop(org.api_key, None)
        db_manager = DatabaseManager(connection_string=org.db_connection_string)
        success = db_manager.load_dataframe(df, request.table_name, if_exists=request.if_exists)
        db_manager.close()
        
        if success:
            # Register DataSource
            with get_db() as db:
                import json
                source = DataSource(
                    org_id=org.id,
                    name=f"API: {request.url}",
                    source_type="api",
                    connection_details=json.dumps({"url": request.url, "method": request.method}),
                    table_name=request.table_name
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
    
    from main import AnalyticsAgent
    agent = AnalyticsAgent(connection_string=conn_str)
    try:
        # Sanitize table name to prevent SQL injection (basic check)
        # In production, use parameterized queries or SQLAlchemy introspection
        if not table_name.isidentifier():
             raise HTTPException(status_code=400, detail="Invalid table name")

        # Get columns
        schema = agent.db.describe_table(table_name)
        columns = [{"name": col[0], "type": col[1]} for col in schema]
        
        # Get data (limit 50)
        # using SQLAlchemy logic internally from the agent's db wrapper if available, 
        # but here accessing the engine directly for a quick select
        import sqlalchemy
        from sqlalchemy import text
        
        with agent.db.engine.connect() as conn:
            # Try to get rowid (SQLite) or ctid (Postgres) to enable editing
            try:
                # SQLite
                result = conn.execute(text(f"SELECT rowid as _id, * FROM {table_name} LIMIT 50"))
            except Exception:
                conn.rollback() # Rollback aborted transaction
                try:
                    # Postgres - cast ctid to text
                    result = conn.execute(text(f"SELECT ctid::text as _id, * FROM {table_name} LIMIT 50"))
                except Exception:
                    conn.rollback() # Rollback aborted transaction
                    # Fallback (no editing supported for this table)
                    result = conn.execute(text(f"SELECT * FROM {table_name} LIMIT 50"))
            
            rows = [dict(row._mapping) for row in result]
            
        return {
            "table": table_name,
            "columns": columns,
            "rows": rows,
            "total_rows": len(rows) # In a real app, do a count(*) query too
        }
    except Exception as e:
        print(f"Preview error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()


@router.post("/analyze-file")
async def analyze_file(file: UploadFile = File(...), org=Depends(get_current_org)):
    """
    Analyze a file without saving it to the database.
    Returns preview data (columns and rows) for user verification.
    """
    content = await file.read()
    filename = file.filename
    
    try:
        import io
        import pandas as pd
        
        # Determine file type and read
        # Determine file type and read
        def read_df_sync(content, filename):
            if filename.endswith('.csv'):
                return pd.read_csv(io.BytesIO(content))
            elif filename.endswith(('.xls', '.xlsx')):
                return pd.read_excel(io.BytesIO(content))
            return None

        # Run blocking pandas read in a threadpool
        df = await run_in_threadpool(read_df_sync, content, filename)

        if df is None:
            raise HTTPException(status_code=400, detail="Unsupported file format")
            
        if df.empty:
            raise HTTPException(status_code=400, detail="File is empty")
            
        # Get preview data
        preview_rows = df.head(5).fillna("").to_dict(orient='records')
        
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
            "missing_values": missing_values
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing file: {str(e)}")

# --- Organization Context Endpoints ---


@router.post("/tables/{table_name}/duplicate")
async def duplicate_table_endpoint(table_name: str, org=Depends(get_current_org),
                                   user=Depends(require_permission("MUTATE_TABLES"))):
    # Use get_org_connection_string which checks FILE_DB_CACHE first (same as /tables)
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    # We need to access DatabaseManager directly, not via Agent (Agent wraps it but is for AI)
    # But DatabaseManager handles connection strings.
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
async def update_cell_endpoint(table_name: str, request: UpdateCellRequest, org=Depends(get_current_org),
                               user=Depends(require_permission("MUTATE_TABLES"))):
    # Determine which DB to use
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
        
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        success = db_manager.update_cell_value(
            table_name, 
            request.row_id, 
            request.column, 
            request.value
        )
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
    table_name: str, 
    column_name: str, 
    request: FillMissingRequest, 
    org=Depends(get_current_org),
    user=Depends(require_permission("MUTATE_TABLES"))
):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        rows_affected = db_manager.fill_missing_values(
            table_name, 
            column_name, 
            request.strategy, 
            request.value,
            request.weight_column
        )
        return {"status": "success", "rows_affected": rows_affected}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()


@router.delete("/tables/{table_name}")
async def delete_table_endpoint(table_name: str, org=Depends(get_current_org),
                                user=Depends(require_permission("MUTATE_TABLES"))):
    """Delete a table (only copies allowed)"""
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    # Restrict deletion to copies
    if "_copy_" not in table_name:
        raise HTTPException(status_code=403, detail="Only table copies can be deleted. Original data is protected.")
        
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
async def rename_column_endpoint(table_name: str, request: RenameColumnRequest, org=Depends(get_current_org),
                                 user=Depends(require_permission("MUTATE_TABLES"))):
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
async def drop_column_endpoint(table_name: str, column_name: str, org=Depends(get_current_org),
                               user=Depends(require_permission("MUTATE_TABLES"))):
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
async def delete_row_endpoint(table_name: str, row_id: str, org=Depends(get_current_org),
                              user=Depends(require_permission("MUTATE_TABLES"))):
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        # row_id comes as string but might be integer in DB (rowid). Try converting.
        try:
            rid = int(row_id)
        except:
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


@router.get("/stats")
async def get_stats(org=Depends(get_current_org)):
    """Get statistics for all tables"""
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    if not conn_str:
        # If DB not configured, return empty list instead of error for overview
        return {"tables": []}
        
    db_manager = None
    try:
        db_manager = DatabaseManager(connection_string=conn_str)
        tables = db_manager.list_tables()
        stats_list = []
        for table in tables:
            stats = db_manager.get_table_stats(table)
            stats_list.append(stats)
        return {"tables": stats_list, "org_name": org.name}
    except Exception as e:
        logger.error(f"Error fetching stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db_manager:
            db_manager.close()