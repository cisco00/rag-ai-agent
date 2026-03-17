"""
routers/auth.py — Authentication and Organization registration routes.
"""

import os
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header, Response
from fastapi.concurrency import run_in_threadpool

import auth as auth_module
from models import (
    get_org_by_api_key, create_org, update_org_db
)
from database import DatabaseManager
from dependencies import get_current_org, FILE_DB_CACHE, FILE_DB_CACHE_LOCK
from utils import send_email_mock
from schemas import (
    RegisterRequest, ConfigRequest, LoginRequest, RegisterUserRequest,
    AcceptInviteRequest
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Helpers ──

async def provision_org_database(org_name: str, api_key: str) -> Optional[str]:
    """
    Provision a dedicated database and user for a new organization.
    Returns the new connection string or None if provisioning is not configured.
    """
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

    safe_name = "".join(c for c in org_name.lower() if c.isalnum())[:10]
    unique_suffix = api_key[:8]
    new_db_name = f"vantage_{safe_name}_{unique_suffix}"
    new_user = f"user_{safe_name}_{unique_suffix}"
    
    alphabet = string.ascii_letters + string.digits
    new_password = ''.join(secrets.choice(alphabet) for i in range(16))

    logger.info(f"Provisioning database {new_db_name} for user {new_user}")

    try:
        def _provision():
            conn = psycopg2.connect(user=sys_user, password=sys_pass, host=host, port=port, dbname='postgres')
            conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur = conn.cursor()
            
            # Create Role
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (new_user,))
            if not cur.fetchone():
                cur.execute(sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(
                    sql.Identifier(new_user), sql.Literal(new_password)
                ))
            
            # Create Database
            cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{new_db_name}'")
            if not cur.fetchone():
                cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(new_db_name), sql.Identifier(new_user)
                ))
            conn.close()

            # Grant permissions on public schema
            try:
                conn_new = psycopg2.connect(user=sys_user, password=sys_pass, host=host, port=port, dbname=new_db_name)
                conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
                cur_new = conn_new.cursor()
                cur_new.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(new_user)))
                conn_new.close()
            except Exception as e:
                logger.error(f"Failed to grant permissions: {e}")
            
            return f"postgresql://{new_user}:{new_password}@{host}:{port}/{new_db_name}"

        return await run_in_threadpool(_provision)
    except Exception as e:
        logger.error(f"Provisioning failed: {e}", exc_info=True)
        raise

# ── Routes ──

@router.post("/register")
async def register(request: RegisterRequest):
    """Register a new organization and optionally provision a DB."""
    try:
        org = create_org(request.name, request.email)
        try:
             db_conn_str = await provision_org_database(org.name, org.api_key)
             if db_conn_str:
                 update_org_db(org.api_key, db_conn_str)
                 org.db_connection_string = db_conn_str
                 logger.info(f"Auto-provisioned database for org: {org.name}")
                 
                 email_subject = "Your Vantage AI Database Details"
                 email_body = (
                     f"Hello,\n\nYour new organization '{org.name}' has been created successfully!\n\n"
                     f"Database Connection String:\n{db_conn_str}\n\n"
                     f"Your API Key is:\n{org.api_key}\n\n"
                     "Please save this API key securely. Welcome to Vantage AI!"
                 )
                 send_email_mock(request.email, email_subject, email_body)

        except Exception as e:
            logger.error(f"Failed to auto-provision database: {e}")
            
        return {
            "message": "Organization created successfully",
            "name": org.name,
            "api_key": org.api_key,
            "db_configured": bool(org.db_connection_string)
        }
    except Exception as e:
        logger.error(f"Registration error: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail="Organization name already exists or registration failed.")

@router.post("/register-first-user")
async def register_first_user_route(request: RegisterUserRequest, 
                                    response: Response, 
                                    x_api_key: str = Header(...)):
    """Create the first owner user for an organization."""
    try:
        org = get_org_by_api_key(x_api_key)
        if not org:
            raise HTTPException(status_code=401, detail="Invalid API key")
            
        res = auth_module.register_first_user(
            email=request.email, 
            password=request.password, 
            display_name=request.display_name,
            org_id=org.id
        )
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Register first user failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login")
async def login_route(request: LoginRequest, response: Response):
    """Authenticate a user and set cookies."""
    try:
        res = auth_module.login_user(email=request.email, password=request.password)
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))

@router.post("/logout")
async def logout_route(response: Response):
    """Log out a user by clearing cookies."""
    auth_module._clear_auth_cookies(response)
    return {"message": "Logged out successfully"}

@router.post("/refresh")
async def refresh_route(refresh_token: str):
    """Exchange a refresh token for a new access token."""
    try:
        return auth_module.refresh_access_token(refresh_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

@router.post("/accept-invite")
async def accept_invite_route(request: AcceptInviteRequest, response: Response):
    """Accept an invitation to join an organization."""
    try:
        res = auth_module.accept_invite(
            raw_token=request.token,
            password=request.password,
            display_name=request.display_name
        )
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Accept invite failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/me")
async def get_me(user: dict = Depends(auth_module.get_current_user)):
    """Return the current authenticated user's profile."""
    return user

@router.get("/config")
async def get_config(org=Depends(get_current_org)):
    """Return the DB connection string for the current organization."""
    return {
        "status": "success",
        "connection_string": org.db_connection_string
    }

@router.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org)):
    """Update the DB connection string for the current organization."""
    try:
        db_manager = DatabaseManager(connection_string=request.connection_string)
        db_manager.list_tables() # Validate connection
        db_manager.close()
        
        update_org_db(org.api_key, request.connection_string)
        
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)
            
        return {"status": "success", "message": "Database connection string updated."}
    except Exception as e:
        logger.error(f"DB CONFIG ERROR: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to connect: {str(e)}")