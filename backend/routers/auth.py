"""
routers/auth.py — routes migrated from monolithic api.py
"""

import os, io, json, math, time, threading, asyncio
from pathlib import Path
from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, WebSocket, WebSocketDisconnect, Response
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
import auth as auth_module

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



# ── Helpers ──

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



# ── Routes ──

@router.post("/register")
async def register(request: RegisterRequest):
    try:
        org = create_org(request.name, request.email)
        
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


@router.get("/config")
async def get_config(org=Depends(get_current_org)):
    try:
        return {
            "status": "success",
            "connection_string": org.db_connection_string
        }
    except Exception as e:
        logger.error(f"DB CONFIG GET ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org)):
    try:
        from utils import send_email_mock
        # Validate connection first
        db_manager = DatabaseManager(connection_string=request.connection_string)
        # Try a simple query
        db_manager.list_tables()
        db_manager.close()
        org = update_org_db(org.api_key, request.connection_string)
        # Log connection to history
        from models import log_connection
        log_connection(org.id, request.connection_string)
        
        # Clear file cache if they switch to a real DB
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
            
        # Send notification email if the organization has an email associated
        if org.email:
            subject = "Database Connected Successfully"
            body = f"""
Hello,

Your database connection for organization '{org.name}' has been verified and successfully linked to your account.
You can now start querying your tables via the dashboard!

Thanks,
The RAG AI Agent Team
            """
            try:
                send_email_mock(org.email, subject, body.strip())
            except Exception as e:
                logger.error(f"Failed to send DB connection email: {e}")

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

# ---------------------------------------------------------------------------
# Branding endpoints
# ---------------------------------------------------------------------------

class BrandingRequest(BaseModel):
    org_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None

@router.post("/login")
async def login_route(request: auth_module.LoginRequest, response: Response):
    try:
        # Check if org_id is provided in headers maybe, otherwise login_user defaults to global check
        res = auth_module.login_user(email=request.email, password=request.password)
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))

@router.post("/logout")
async def logout_route(response: Response, authorization: Optional[str] = Header(None)):
    auth_module._clear_auth_cookies(response)
    # The actual token invalidation isn't getting the refresh token clearly from headers usually,
    # but the frontend just needs the cookies cleared.
    return {"message": "Logged out successfully"}

@router.post("/refresh")
async def refresh_route(response: Response, authorization: Optional[str] = Header(None)):
    # Standard implementation: pull refresh token from header or cookie
    raise HTTPException(status_code=501, detail="Not implemented")

@router.get("/me")
async def get_me(user: dict = Depends(auth_module.get_current_user)):
    return user