import os
import pandas as pd
import io
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, Header, Request, UploadFile, File, Form
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta
import time
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import sys
# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import AnalyticsAgent
from models import init_admin_db, create_org, get_org_by_api_key, update_org_db, create_shared_report, get_shared_report, get_org_shared_reports, ScheduledReport, get_db, create_feedback, create_query_history, get_org_history, DataSource, ChatSession, ChatMessage, create_chat_session, add_chat_message, get_chat_history
from analytics import perform_forecast, detect_anomalies, calculate_correlation
from database import DatabaseManager
from scheduler import start_scheduler, shutdown_scheduler, schedule_job_for_report, refresh_jobs
from utils import send_email_mock

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from export_manager import ExportManager

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_admin_db()
    start_scheduler()
    refresh_jobs()
    print("Admin database initialized and scheduler started.")
    yield
    shutdown_scheduler()
    print("Scheduler shutdown.")

app = FastAPI(
    title="Vantage AI",
    description="A multi-tenant RAG-powered analytics tool for organizations.",
    version="2.0.0",
    lifespan=lifespan
)

# Add CORS support for React development
# Add CORS support
cors_origins_str = os.getenv("CORS_ORIGINS", "*")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from prometheus_fastapi_instrumentator import Instrumentator

# Instrument Prometheus
Instrumentator().instrument(app).expose(app)


# Temporary store for file-based database paths
# In a real production app, this would be in a cache or persistent DB
FILE_DB_CACHE = {}
FILE_DB_CACHE_LOCK = threading.Lock()  # Thread-safe access to cache

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))


# --- Schema Caching ---
SCHEMA_CACHE = {}  # {connection_string: schema_summary_str}
SCHEMA_CACHE_LOCK = threading.Lock()

def get_cached_schema_summary(connection_string: str) -> Optional[str]:
    """
    Get or create a schema summary string for a connection string.
    This speeds up LLM initialization by avoiding repeated list_tables/describe_table calls.
    """
    if not connection_string:
        return None
        
    with SCHEMA_CACHE_LOCK:
        if connection_string in SCHEMA_CACHE:
            return SCHEMA_CACHE[connection_string]
            
    # Cache miss - generate summary
    logger.info(f"Generating schema summary for cache: {connection_string[:20]}...")
    try:
        db_manager = DatabaseManager(connection_string=connection_string)
        try:
            tables = db_manager.list_tables()
            summary_parts = []
            for table in tables:
                schema = db_manager.describe_table(table)
                cols = ", ".join([f"{col[0]} ({col[1]})" for col in schema])
                summary_parts.append(f"Table '{table}': {cols}")
            
            summary = "\n".join(summary_parts)
            
            with SCHEMA_CACHE_LOCK:
                SCHEMA_CACHE[connection_string] = summary
                
            return summary
        finally:
            db_manager.close()
    except Exception as e:
        logger.error(f"Failed to generate schema summary: {e}")
        return None


# --- Models ---
class RegisterRequest(BaseModel):
    name: str
    email: str

class ConfigRequest(BaseModel):
    connection_string: str

class QueryRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None # Keep for compatibility, but prefer session_id
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
    table_name: Optional[str]
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
    operations: List[Dict[str, Any]] # e.g. [{"type": "filter", "column": "age", "op": ">", "value": 30}]
    target_table: Optional[str] = None

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
    title: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    
    class Config:
        from_attributes = True

# --- Security ---
async def get_current_org(x_api_key: str = Header(...)):
    org = get_org_by_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return org

# --- Endpoints ---
@app.post("/register")
async def register(request: RegisterRequest):
    try:
        org = create_org(request.name)
        
        # Auto-provision database if system credentials are set
        try:
             db_conn_str = await provision_org_database(org.name, org.api_key)
             if db_conn_str:
                 update_org_db(org.api_key, db_conn_str)
                 org.db_connection_string = db_conn_str
                 logger.info(f"Auto-provisioned database for org: {org.name}")
                 
                 # Send email notification
                 email_subject = "Your Vantage AI Database Details"
                 email_body = (
                     f"Hello,\n\n"
                     f"Your new organization '{org.name}' has been created successfully!\n\n"
                     f"A dedicated database has been provisioned for you.\n"
                     f"Database Connection String:\n{db_conn_str}\n\n"
                     f"Your API Key is:\n{org.api_key}\n\n"
                     f"Please save this API key securely. You will need it to access your organization's data.\n\n"
                     f"Welcome to Vantage AI!"
                 )
                 send_email_mock(request.email, email_subject, email_body)

        except Exception as e:
            logger.error(f"Failed to auto-provision database: {e}")
            # Continue without failing registration - they can config manually
            
        return {
            "message": "Organization created successfully",
            "name": org.name,
            "api_key": org.api_key,
            "db_configured": bool(org.db_connection_string),
            "instruction": "Save your API key. You will need it for all subsequent requests as X-API-KEY header."
        }
    except Exception as e:
        logger.error(f"Registration error: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail="Organization name already exists or registration failed.")

async def provision_org_database(org_name: str, api_key: str) -> Optional[str]:
    """
    Provision a dedicated database and user for a new organization.
    Returns the new connection string or None if provisioning is not configured.
    """
    # Check for system credentials
    sys_user = os.getenv("POSTGRES_SYS_ADMIN_USER")
    sys_pass = os.getenv("POSTGRES_SYS_ADMIN_PASSWORD")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    
    if not (sys_user and sys_pass):
        logger.info("Postgres system credentials not set. Skipping auto-provisioning.")
        return None

    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    import secrets
    import string

    # Generate unique identifiers
    # Sanitize org name for db name usage
    safe_name = "".join(c for c in org_name.lower() if c.isalnum())[:10]
    unique_suffix = api_key[:8]
    
    new_db_name = f"vantage_{safe_name}_{unique_suffix}"
    new_user = f"user_{safe_name}_{unique_suffix}"
    
    # Generate secure password
    alphabet = string.ascii_letters + string.digits
    new_password = ''.join(secrets.choice(alphabet) for i in range(16))

    logger.info(f"Provisioning database {new_db_name} for user {new_user}")

    try:
        # Run in threadpool to avoid blocking event loop
        def _provision():
            conn = psycopg2.connect(
                user=sys_user, 
                password=sys_pass, 
                host=host, 
                port=port, 
                dbname='postgres'
            )
            conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur = conn.cursor()
            
            # 1. Create User
            # Check existence first (though should be unique)
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (new_user,))
            if not cur.fetchone():
                cur.execute(sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(
                sql.Identifier(new_user),
                sql.Literal(new_password)
                ))
            
            # 2. Create Database with Owner
            cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{new_db_name}'")
            if not cur.fetchone():
                cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(new_db_name),
                    sql.Identifier(new_user)
                ))
                
            conn.close()

            # Grant permissions on public schema (required for PG15+)
            try:
                conn_new = psycopg2.connect(
                    user=sys_user, 
                    password=sys_pass, 
                    host=host, 
                    port=port, 
                    dbname=new_db_name
                )
                conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
                cur_new = conn_new.cursor()
                cur_new.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(new_user)))
                conn_new.close()
            except Exception as e:
                logger.error(f"Failed to grant permissions: {e}")
                # Don't fail the whole process if this part fails, but log it.
            
            return f"postgresql://{new_user}:{new_password}@{host}:{port}/{new_db_name}"

        return await run_in_threadpool(_provision)
        
    except Exception as e:
        logger.error(f"Provisioning failed: {e}", exc_info=True)
        # Re-raise to let caller handle logging/suppression
        raise

@app.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org)):
    try:
        # Validate connection first
        db_manager = DatabaseManager(connection_string=request.connection_string)
        # Try a simple query
        db_manager.list_tables()
        db_manager.close()
        
        update_org_db(org.api_key, request.connection_string)
        # Clear file cache if they switch to a real DB
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
        return {"status": "success", "message": "Database connection string updated."}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"DB CONFIG ERROR: {error_msg}")
        
        # Check for specific errors
        if "OperationalError" in error_msg:
             if 'password authentication failed' in error_msg:
                 raise HTTPException(status_code=400, detail={"code": "AUTH_FAILED", "message": "Authentication failed. Check your credentials."})
             elif 'does not exist' in error_msg:
                 raise HTTPException(status_code=400, detail={"code": "DB_NOT_FOUND", "message": f"Database does not exist or host is unreachable. {error_msg}"})
             else:
                  raise HTTPException(status_code=400, detail={"code": "CONNECTION_FAILED", "message": f"Connection failed: {error_msg}"})
        
        raise HTTPException(status_code=400, detail=f"Failed to connect: {error_msg}")

class CreateDatabaseRequest(BaseModel):
    host: str
    port: str
    admin_user: str
    admin_password: str
    new_db_name: str
    new_user: str          # New field
    new_password: str      # New field
    email: str

from utils import send_email_mock

@app.post("/database/create-postgres")
async def create_postgres_database(request: CreateDatabaseRequest, org=Depends(get_current_org)):
    """Create a new Postgres database, a new user, and update org config"""
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    
    # 1. Connect to postgres system db
    try:
        conn = psycopg2.connect(
            user=request.admin_user, 
            password=request.admin_password, 
            host=request.host, 
            port=request.port, 
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
                user=request.admin_user, 
                password=request.admin_password, 
                host=request.host, 
                port=request.port, 
                dbname=request.new_db_name
            )
            conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur_new = conn_new.cursor()
            cur_new.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(request.new_user)))
            conn_new.close()
        except Exception as e:
             logger.error(f"Failed to grant permissions: {e}")
        
        # 4. Formulate new connection string using NEW USER credentials
        new_conn_str = f"postgresql://{request.new_user}:{request.new_password}@{request.host}:{request.port}/{request.new_db_name}"
        
        # 5. Update Org Config
        update_org_db(org.api_key, new_conn_str)
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
            
        # 6. Send Email
        subject = "Your New Database & User Details"
        body = f"""
Hello,

A new PostgreSQL database and user have been created for you.

Details:
Host: {request.host}
Port: {request.port}
Database Name: {request.new_db_name}
New Username: {request.new_user}
New Password: {request.new_password}

Admin Access Used: {request.admin_user}

You can now use these credentials to connect external tools.
The Vantage AI Agent is already configured to use this connection.

Regards,
Vantage AI Team
        """
        send_email_mock(request.email, subject, body)
        
        return {"status": "success", "message": f"Database '{request.new_db_name}' created with user '{request.new_user}'."}
        
    except Exception as e:
        logger.error(f"Failed to create database: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/import")
async def import_file_to_database(
    file: UploadFile = File(...), 
    table_name: Optional[str] = Form(None),
    if_exists: str = Form('replace'),
    org=Depends(get_current_org)
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
                import re
                base_name = Path(filename).stem.lower()
                base_name = re.sub(r'[^a-z0-9_]', '_', base_name)
                if base_name and base_name[0].isdigit():
                    base_name = f"t_{base_name}"
                table_name = base_name

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

@app.post("/import/batch")
async def import_multiple_files(
    files: List[UploadFile] = File(...),
    table_prefix: Optional[str] = None,
    if_exists: str = 'replace',
    cleaning_options: Optional[str] = Form(None),
    org=Depends(get_current_org)
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
        raise HTTPException(status_code=500, detail=str(e))
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
                import re
                base_name = Path(filename).stem.lower()
                # Replace any non-alphanumeric character with underscore
                base_name = re.sub(r'[^a-z0-9_]', '_', base_name)
                # Ensure it doesn't start with a number
                if base_name and base_name[0].isdigit():
                    base_name = f"t_{base_name}"
                
                if table_prefix:
                    table_name = f"{table_prefix}_{base_name}"
                else:
                    table_name = base_name
                
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

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), org=Depends(get_current_org)):
    content = await file.read()
    filename = file.filename
    
    try:
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

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/tables")
async def get_tables(org=Depends(get_current_org)):
    # Check if there's an active file first
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
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

@app.post("/feedback")
async def submit_feedback(request: FeedbackRequest, org=Depends(get_current_org)):
    try:
        feedback = create_feedback(
            org_id=org.id,
            query=request.query,
            response=request.response,
            vote=request.vote,
            feedback_text=request.feedback_text
        )
        return {"status": "success", "message": "Feedback submitted successfully", "id": feedback.id}
    except Exception as e:
        logger.error(f"Feedback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit feedback")

# --- New Data Feature Endpoints ---

@app.get("/data/sources", response_model=List[DataSourceResponse])
async def list_data_sources(org=Depends(get_current_org)):
    """List all data sources for the organization."""
    try:
        with get_db() as db:
            sources = db.query(DataSource).filter(DataSource.org_id == org.id).all()
            return sources
    except Exception as e:
        logger.error(f"Failed to list sources: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/import/api")
async def import_from_api(request: ApiImportRequest, org=Depends(get_current_org)):
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
             # Auto-provision (reuse logic or error)
             raise HTTPException(status_code=400, detail="Organization has no database configured")
             
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

@app.post("/transform")
async def transform_data(request: TransformRequest, org=Depends(get_current_org)):
    """Apply transformations to a table."""
    try:
        db_conn = org.db_connection_string
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database configured")
            
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

@app.post("/analytics/forecast")
async def get_forecast(request: ForecastRequest, org=Depends(get_current_org)):
    """Generate a time-series forecast."""
    try:
        db_conn = org.db_connection_string
        if not db_conn:
            raise HTTPException(status_code=400, detail="No database configured")
            
        import pandas as pd
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Load data (restricted columns)
        query = f"SELECT {request.date_column}, {request.value_column} FROM {request.table_name}"
        df = pd.read_sql(query, db_manager.get_engine())
        db_manager.close()
        
        result = perform_forecast(df, request.date_column, request.value_column, request.periods, request.freq)
        
        if "error" in result:
             raise HTTPException(status_code=400, detail=result["error"])
             
        return result
        
    except Exception as e:
         logger.error(f"Forecast failed: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=str(e))

@app.post("/analytics/anomaly")
async def get_anomalies(request: AnomalyRequest, org=Depends(get_current_org)):
    """Detect anomalies in a dataset."""
    try:
        db_conn = org.db_connection_string
        if not db_conn:
             raise HTTPException(status_code=400, detail="No database configured")
             
        import pandas as pd
        db_manager = DatabaseManager(connection_string=db_conn)
        
        # Load data
        query = f"SELECT {request.value_column} FROM {request.table_name}"
        df = pd.read_sql(query, db_manager.get_engine())
        db_manager.close()
        
        result = detect_anomalies(df, request.value_column, request.contamination)
        
        if "error" in result:
             raise HTTPException(status_code=400, detail=result["error"])
             
        return result
        
    except Exception as e:
         logger.error(f"Anomaly detection failed: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=str(e))

from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/stream/{source_id}")
async def websocket_endpoint(websocket: WebSocket, source_id: int):
    """
    Simulate real-time data streaming.
    """
    await websocket.accept()
    try:
        import asyncio
        import random
        import json
        
        # Simulate data stream
        while True:
            # Generate random data point
            data = {
                "source_id": source_id,
                "timestamp": datetime.utcnow().isoformat(),
                "value": random.uniform(10, 100),
                "status": random.choice(["ok", "warning", "critical"])
            }
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(1) # Send every second
            
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from stream {source_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
             await websocket.close()
        except:
             pass

@app.get("/tables/{table_name}/preview")
async def preview_table(table_name: str, org=Depends(get_current_org)):
    # Determine which DB to use
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
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

@app.post("/analyze-file")
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

@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, org=Depends(get_current_org)):
    # Determine which DB to use
    with FILE_DB_CACHE_LOCK:
        conn_str = None
        if hasattr(request, 'use_file') and request.use_file and org.api_key in FILE_DB_CACHE:
            conn_str = FILE_DB_CACHE[org.api_key]
        else:
            conn_str = org.db_connection_string or FILE_DB_CACHE.get(org.api_key)
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    
    # Get schema summary (cached)
    schema_summary = get_cached_schema_summary(conn_str)
    
    start_time = time.time()
    
    agent = AnalyticsAgent(hf_token, connection_string=conn_str, schema_summary=schema_summary)
    
    # Save user message if session_id provided
    if request.session_id:
        try:
            add_chat_message(request.session_id, "user", request.query)
        except Exception as e:
            logger.error(f"Failed to save user message: {e}")

    try:
        # Check if org has DB connection
        if not org.db_connection_string:
            return {
                "text": "Please configure your database connection first.",
                "visualization": None,
                "status": "success"
            }
            
        # Determine which DB to use for the agent
        with FILE_DB_CACHE_LOCK:
            conn_str = None
            # If use_file was in the request, it would be handled here.
            # For now, prioritize org's configured DB, then file cache.
            conn_str = org.db_connection_string or FILE_DB_CACHE.get(org.api_key)
        
        if not conn_str:
            raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
        
        hf_token = os.environ.get("HF_TOKEN")
        
        # Get schema summary (cached)
        schema_summary = get_cached_schema_summary(conn_str)
        
        # Initialize agent
        agent = AnalyticsAgent(hf_token, connection_string=conn_str, schema_summary=schema_summary)
        
        # Load history from session if session_id provided and no explicit history
        history = request.history
        if request.session_id and not history:
            # Fetch history from DB
             db_messages = get_chat_history(request.session_id)
             history = [{"role": m.role, "content": m.content} for m in db_messages]

        result = agent.run_query(
            request.query, 
            history, 
            tables=request.tables, 
            verify_only=request.verify_only,
            confirmed_sql=request.confirmed_sql
        )
        # Save to history if successful (and not just verifying, unless confirmed)
        if result.get("status") == "success" and not request.verify_only:
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=result.get("sql_query")
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        elif request.confirmed_sql and result.get("status") == "success":
             # Also save if it was a confirmed execution
             try:
                create_query_history(
                    org_id=org.id,
                    query=request.query,
                    response=result["text"],
                    visualization=result.get("visualization"),
                    sql_query=request.confirmed_sql
                )
             except Exception as ex:
                logger.error(f"Failed to save history: {ex}")
        
        # Save assistant response if session_id provided (Chat feature)
        if request.session_id:
            try:
                response_text = result.get("text", "")
                if result.get("visualization"):
                     response_text += "\n[Visualization Generated]"
                add_chat_message(request.session_id, "assistant", response_text)
            except Exception as e:
                logger.error(f"Failed to save assistant message: {e}")

        # Update title if it's the first message and title is generic
        if request.session_id and (not history or len(history) == 0):
             # Logic to update title could go here
             pass

        return QueryResponse(
            query=request.query,
            response=result.get("text", ""),
            visualization=result.get("visualization"),
            status=result.get("status", "success"),
            sql_query=result.get("sql_query")
        )
    except Exception as e:
        logger.error(f"Query execution failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'agent' in locals():
            agent.close()

@app.get("/history")
async def get_history(limit: int = 50, org=Depends(get_current_org)):
    """Get past queries for the organization"""
    try:
        history = get_org_history(org.id, limit)
        return {"history": history}
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")

class UpdateCellRequest(BaseModel):
    row_id: Any
    column: str
    value: Any

@app.post("/tables/{table_name}/duplicate")
async def duplicate_table_endpoint(table_name: str, org=Depends(get_current_org)):
    # Determine which DB to use
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    
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

@app.patch("/tables/{table_name}/cell")
async def update_cell_endpoint(table_name: str, request: UpdateCellRequest, org=Depends(get_current_org)):
    # Determine which DB to use
    with FILE_DB_CACHE_LOCK:
        conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    
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

class FillMissingRequest(BaseModel):
    strategy: str # 'value', 'mean', 'median', 'mode', 'weighted_mean'
    value: Optional[Any] = None
    weight_column: Optional[str] = None

@app.post("/tables/{table_name}/columns/{column_name}/fill")
async def fill_missing_values_endpoint(
    table_name: str, 
    column_name: str, 
    request: FillMissingRequest, 
    org=Depends(get_current_org)
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

@app.delete("/tables/{table_name}")
async def delete_table_endpoint(table_name: str, org=Depends(get_current_org)):
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

class RenameColumnRequest(BaseModel):
    old_column: str
    new_column: str

@app.post("/tables/{table_name}/columns/rename")
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

@app.delete("/tables/{table_name}/columns/{column_name}")
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

@app.delete("/tables/{table_name}/rows/{row_id}")
async def delete_row_endpoint(table_name: str, row_id: str, org=Depends(get_current_org)):
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

@app.get("/stats")
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

@app.post("/share")
async def share_report(request: QueryRequest, org=Depends(get_current_org)):
    """Create a shareable link for an analysis result"""
    # Determine which DB to use
    with FILE_DB_CACHE_LOCK:
        conn_str = None
        if request.use_file and org.api_key in FILE_DB_CACHE:
            conn_str = FILE_DB_CACHE[org.api_key]
        else:
            conn_str = org.db_connection_string or FILE_DB_CACHE.get(org.api_key)
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
    try:
        result = agent.run_query(request.query, request.history)
        
        # Create shared report
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=result["text"],
            visualization=result["visualization"]
        )
        
        # Generate shareable URL
        base_url = "http://localhost:8000"  # In production, use request.base_url
        share_url = f"{base_url}/shared/{shared_report.id}"
        
        return {
            "status": "success",
            "share_url": share_url,
            "report_id": shared_report.id,
            "expires_at": shared_report.expires_at.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()

@app.get("/shared")
async def get_all_shared_reports(limit: int = 50, org=Depends(get_current_org)):
    """Get all shared reports for the organization."""
    try:
        reports = get_org_shared_reports(org.id, limit)
        return {"reports": reports}
    except Exception as e:
        logger.error(f"Error fetching shared reports: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch shared reports")

@app.get("/shared/{report_id}")
async def get_shared(report_id: str):
    """Public endpoint to view shared reports (no auth required)"""
    import json
    
    report = get_shared_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or expired")
    
    visualization = json.loads(report.visualization) if report.visualization else None
    
    return {
        "query": report.query,
        "response": report.response,
        "visualization": visualization,
        "created_at": report.created_at.isoformat()
    }

@app.post("/export/pdf")
async def export_pdf(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PDF"""
    try:
        manager = ExportManager()
        # Convert visualization object to dict if it's not already
        viz_data = request.visualization
        if hasattr(viz_data, 'dict'):
            viz_data = viz_data.dict()
            
        pdf_buffer = manager.generate_pdf(request.query, request.response, viz_data)
        
        timestamp = int(time.time())
        filename = f"report_{timestamp}.pdf"
        
        return StreamingResponse(
            pdf_buffer, 
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error(f"Error exporting PDF: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export/pptx")
async def export_pptx(request: QueryResponse, org=Depends(get_current_org)):
    """Export analysis result as PowerPoint"""
    try:
        manager = ExportManager()
        # Convert visualization object to dict if it's not already
        viz_data = request.visualization
        if hasattr(viz_data, 'dict'):
            viz_data = viz_data.dict()
            
        pptx_buffer = manager.generate_pptx(request.query, request.response, viz_data)
        
        timestamp = int(time.time())
        filename = f"report_{timestamp}.pptx"
        
        return StreamingResponse(
            pptx_buffer, 
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error(f"Error exporting PPTX: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class ScheduledReportRequest(BaseModel):
    query: str
    frequency: str = "biweekly"  # daily, weekly, biweekly, monthly
    recipients: str  # comma-separated emails

@app.post("/scheduled-reports")
async def create_scheduled_report(request: ScheduledReportRequest, org=Depends(get_current_org)):
    """Schedule a new automated report"""
    from datetime import timedelta
    
    try:
        with get_db() as db:
            # Calculate next run time (e.g., start tomorrow at 9am)
            # For simplicity, we'll start it a few minutes from now for testing, 
            # or use logic to snap to 9am. Let's do 1 minute from now for immediate gratification in testing.
            # In prod, this might be configurable.
            next_run = datetime.utcnow() + timedelta(minutes=2) 
            
            report = ScheduledReport(
                org_id=org.id,
                query=request.query,
                frequency=request.frequency,
                next_run_at=next_run,
                recipients=request.recipients
            )
            db.add(report)
            db.flush()
            db.refresh(report)
            
            # Schedule the job
            schedule_job_for_report(report.id, report.next_run_at)
            
            return {
                "id": report.id,
                "message": "Report scheduled successfully",
                "next_run_at": report.next_run_at.isoformat()
            }
    except Exception as e:
        logger.error(f"Failed to schedule report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/scheduled-reports")
async def list_scheduled_reports(org=Depends(get_current_org)):
    """List active scheduled reports"""
    try:
        with get_db() as db:
            reports = db.query(ScheduledReport).filter(
                ScheduledReport.org_id == org.id,
                ScheduledReport.is_active == 1
            ).all()
            
            return [
                {
                    "id": r.id,
                    "query": r.query,
                    "frequency": r.frequency,
                    "next_run_at": r.next_run_at.isoformat(),
                    "recipients": r.recipients
                }
                for r in reports
            ]
    except Exception as e:
        logger.error(f"Failed to list scheduled reports: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/scheduled-reports/{report_id}")
async def delete_scheduled_report(report_id: int, org=Depends(get_current_org)):
    """Cancel a scheduled report"""
    try:
        with get_db() as db:
            report = db.query(ScheduledReport).filter(
                ScheduledReport.id == report_id,
                ScheduledReport.org_id == org.id
            ).first()
            
            if not report:
                raise HTTPException(status_code=404, detail="Report not found")
            
            report.is_active = 0
            db.commit()
            
            # We should technically remove it from the scheduler too, 
            # or rely on the execution logic to skip inactive ones. 
            # Refreshing jobs would also clean it up if implemented that way.
            # For now, execution logic checks is_active.
            
            return {"message": "Report cancelled"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



# --- Chat Persistence Endpoints ---

@app.post("/chat/sessions", response_model=SessionResponse)
async def create_new_session(request: CreateSessionRequest, org=Depends(get_current_org)):
    """Create a new chat session."""
    try:
        session = create_chat_session(org.id, request.title)
        return session
    except Exception as e:
        logger.error(f"Failed to create session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/chat/sessions", response_model=List[SessionResponse])
async def list_chat_sessions(org=Depends(get_current_org)):
    """List all chat sessions for the organization."""
    try:
        with get_db() as db:
            sessions = db.query(ChatSession).filter(ChatSession.org_id == org.id).order_by(ChatSession.updated_at.desc()).all()
            # Detach from session to avoid lazy loading issues after session closes
            for session in sessions:
                db.expunge(session)
            return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/chat/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_session_messages(session_id: str, org=Depends(get_current_org)):
    """Get messages for a chat session."""
    try:
        messages = get_chat_history(session_id)
        return messages
    except Exception as e:
        logger.error(f"Failed to get messages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, org=Depends(get_current_org)):
    """Delete a chat session."""
    try:
        with get_db() as db:
            session = db.query(ChatSession).filter(
                ChatSession.id == session_id,
                ChatSession.org_id == org.id
            ).first()
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
            
            # Delete messages first
            db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
            db.delete(session)
            db.commit()
            return {"status": "success"}
    except HTTPException:
         raise
    except Exception as e:
        logger.error(f"Failed to delete session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analytics/correlation")
async def get_correlation_matrix(request: CorrelationRequest, org=Depends(get_current_org)):
    """
    Calculate correlation matrix for a table.
    """
    # 1. Get DB Connection
    # org is already retrieved by Depends
    
    if not org.db_connection_string:
         raise HTTPException(status_code=400, detail="Database not configured")
         
    # 2. Fetch Data
    try:
        db_manager = DatabaseManager(connection_string=org.db_connection_string)
        # Verify table exists
        if request.table_name not in db_manager.list_tables():
            db_manager.close()
            raise HTTPException(status_code=404, detail=f"Table '{request.table_name}' not found")
            
        df = db_manager.get_table_data(request.table_name)
        db_manager.close()
        
        # 3. Calculate Correlation
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


# Mount static files (MUST be last to avoid overriding API routes)
# Point to the external frontend build directory
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
static_dir = os.path.join(project_root, "fron-end", "dist")

if not os.path.exists(static_dir):
    print(f"Warning: Static dir {static_dir} does not exist. Run 'npm run build' in fron-end/")
    # Don't try to mount if it doesn't exist to prevent startup crashes when testing just the API
else:
    # Mount assets first
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    # Mount root last (catch-all) - SPA Routing
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Check if file exists in static directory
        file_path = os.path.join(static_dir, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Finally default to index.html for SPA routing
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "Frontend not found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
