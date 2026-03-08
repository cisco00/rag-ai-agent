"""router: auth — registration, config, and database provisioning."""
import os
import logging
import string
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from models import create_org, get_org_by_api_key, update_org_db, get_db
from database import DatabaseManager
from utils import send_email_mock
from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Request models ---
class RegisterRequest(BaseModel):
    name: str
    email: str


class ConfigRequest(BaseModel):
    connection_string: str


class CreateDatabaseRequest(BaseModel):
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    new_db_name: str
    new_user: str
    new_password: str
    email: Optional[str] = None


# --- Endpoints ---

@router.post("/register")
async def register(request: RegisterRequest):
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
                    f"Hello,\n\n"
                    f"Your new organization '{org.name}' has been created successfully!\n\n"
                    f"A dedicated database has been provisioned for you.\n"
                    f"Database Connection String:\n{db_conn_str}\n\n"
                    f"Your API Key is:\n{org.api_key}\n\n"
                    f"Please save this API key securely.\n\nWelcome to Vantage AI!"
                )
                send_email_mock(request.email, email_subject, email_body)

        except Exception as e:
            logger.error(f"Failed to auto-provision database: {e}")

        return {
            "message": "Organization created successfully",
            "name": org.name,
            "api_key": org.api_key,
            "db_configured": bool(org.db_connection_string),
            "instruction": "Save your API key. You will need it for all subsequent requests as X-API-KEY header.",
        }
    except Exception as e:
        logger.error(f"Registration error: {e}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail="Organization name already exists or registration failed.",
        )


async def provision_org_database(org_name: str, api_key: str) -> Optional[str]:
    """
    Provision a dedicated Postgres database for a new organization.
    Returns the connection string or None if not configured.
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

    safe_name = "".join(c for c in org_name.lower() if c.isalnum())[:10]
    unique_suffix = api_key[:8]
    new_db_name = f"vantage_{safe_name}_{unique_suffix}"
    new_user = f"user_{safe_name}_{unique_suffix}"
    alphabet = string.ascii_letters + string.digits
    new_password = "".join(secrets.choice(alphabet) for _ in range(16))

    logger.info(f"Provisioning database {new_db_name} for user {new_user}")

    def _provision():
        conn = psycopg2.connect(
            user=sys_user, password=sys_pass, host=host, port=port, dbname="postgres"
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (new_user,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(
                    sql.Identifier(new_user), sql.Literal(new_password)
                )
            )

        cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{new_db_name}'")
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(new_db_name), sql.Identifier(new_user)
                )
            )
        conn.close()

        try:
            conn_new = psycopg2.connect(
                user=sys_user, password=sys_pass, host=host, port=port, dbname=new_db_name
            )
            conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur_new = conn_new.cursor()
            cur_new.execute(
                sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(new_user))
            )
            conn_new.close()
        except Exception as e:
            logger.error(f"Failed to grant permissions: {e}")

        return f"postgresql://{new_user}:{new_password}@{host}:{port}/{new_db_name}"

    return await run_in_threadpool(_provision)


@router.get("/config")
async def get_config(org=Depends(get_current_org)):
    try:
        return {"status": "success", "connection_string": org.db_connection_string}
    except Exception as e:
        logger.error(f"DB CONFIG GET ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org)):
    try:
        db_manager = DatabaseManager(connection_string=request.connection_string)
        db_manager.list_tables()
        db_manager.close()
        org = update_org_db(org.api_key, request.connection_string)
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)

        if org.email:
            subject = "Database Connected Successfully"
            body = (
                f"Hello,\n\nYour database connection for organization '{org.name}' "
                f"has been verified and successfully linked.\n\nThanks,\nThe Vantage AI Team"
            )
            try:
                send_email_mock(org.email, subject, body)
            except Exception as e:
                logger.error(f"Failed to send DB connection email: {e}")

        return {"status": "success", "message": "Database connection string updated."}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"DB CONFIG ERROR: {error_msg}")
        if "OperationalError" in error_msg:
            if "password authentication failed" in error_msg:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "AUTH_FAILED", "message": "Authentication failed. Check your credentials."},
                )
            elif "does not exist" in error_msg:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "DB_NOT_FOUND", "message": f"Database does not exist or host is unreachable. {error_msg}"},
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "CONNECTION_FAILED", "message": f"Connection failed: {error_msg}"},
                )
        raise HTTPException(status_code=400, detail=f"Failed to connect: {error_msg}")
