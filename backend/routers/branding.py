"""router: branding — org branding and database management endpoints."""
import os
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from models import update_branding, get_db
from utils import send_email_mock
from dependencies import get_current_org, FILE_DB_CACHE, FILE_DB_CACHE_LOCK

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Request models ---
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


# --- Endpoints ---

@router.get("/branding")
async def get_branding(org=Depends(get_current_org)):
    """Return the branding configuration for the authenticated organization."""
    return org.get_branding()


@router.put("/branding")
async def save_branding(request: BrandingRequest, org=Depends(get_current_org)):
    """Save branding configuration for the authenticated organization."""
    try:
        current = org.get_branding()
        updated = {
            "org_name": request.org_name or current["org_name"],
            "tagline": request.tagline if request.tagline is not None else current["tagline"],
            "primary_color": request.primary_color or current["primary_color"],
            "logo_url": request.logo_url if request.logo_url is not None else current["logo_url"],
        }
        update_branding(org.api_key, updated)
        return {"status": "success", "branding": updated}
    except Exception as e:
        logger.error(f"Branding save failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/database/available")
async def get_available_databases(org=Depends(get_current_org)):
    """Fetch a list of available databases on the PostgreSQL cluster."""
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    admin_user = os.getenv("POSTGRES_SYS_ADMIN_USER", "postgres")
    admin_password = os.getenv("POSTGRES_SYS_ADMIN_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")

    try:
        conn = psycopg2.connect(
            user=admin_user, password=admin_password, host=host, port=port, dbname="postgres"
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute(
            "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres';"
        )
        rows = cur.fetchall()
        databases = [row[0] for row in rows]
        conn.close()
        return {"status": "success", "databases": databases}
    except Exception as e:
        logger.error(f"Failed to fetch databases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/database/create-postgres")
async def create_postgres_database(request: CreateDatabaseRequest, org=Depends(get_current_org)):
    """Create a new Postgres database, a new user, and update org config."""
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    from models import update_org_db

    admin_user = request.admin_user or os.getenv("POSTGRES_SYS_ADMIN_USER", "postgres")
    admin_password = request.admin_password or os.getenv("POSTGRES_SYS_ADMIN_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")

    try:
        conn = psycopg2.connect(
            user=admin_user, password=admin_password, host=host, port=port, dbname="postgres"
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (request.new_user,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {} CREATEDB").format(
                    sql.Identifier(request.new_user), sql.Literal(request.new_password)
                )
            )

        cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{request.new_db_name}'")
        if not cur.fetchone():
            if not request.new_db_name.isalnum():
                raise HTTPException(status_code=400, detail="Database name must be alphanumeric")
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(request.new_db_name), sql.Identifier(request.new_user)
                )
            )

        conn.close()

        try:
            conn_new = psycopg2.connect(
                user=admin_user, password=admin_password, host=host, port=port, dbname=request.new_db_name
            )
            conn_new.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur_new = conn_new.cursor()
            cur_new.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(request.new_db_name), sql.Identifier(request.new_user)
                )
            )
            cur_new.execute(
                sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(request.new_user))
            )
            cur_new.execute(
                sql.SQL("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {}").format(
                    sql.Identifier(request.new_user)
                )
            )
            conn_new.close()
        except Exception as e:
            logger.error(f"Failed to grant permissions: {e}")

        new_conn_str = f"postgresql://{request.new_user}:{request.new_password}@{host}:{port}/{request.new_db_name}"
        update_org_db(org.api_key, new_conn_str)
        with FILE_DB_CACHE_LOCK:
            FILE_DB_CACHE.pop(org.api_key, None)

        recipient_email = getattr(org, "email", None)
        if recipient_email:
            subject = "Your New Database & User Details"
            body = (
                f"Hello,\n\nA new PostgreSQL database and user have been created.\n\n"
                f"Host: {host}\nPort: {port}\nDatabase Name: {request.new_db_name}\n"
                f"New Username: {request.new_user}\nNew Password: {request.new_password}\n\n"
                f"Regards,\nVantage AI Team"
            )
            try:
                send_email_mock(recipient_email, subject, body)
            except Exception as e:
                logger.error(f"Failed to send create DB email: {e}")

        return {
            "status": "success",
            "message": f"Database '{request.new_db_name}' created with user '{request.new_user}'.",
        }

    except Exception as e:
        logger.error(f"Failed to create database: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
