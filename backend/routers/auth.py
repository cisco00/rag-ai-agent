"""
routers/auth.py — Authentication and Organization registration routes.

Fixes applied
─────────────
Bug #15 — Removed @router.get("/register") and @router.get("/login") SPA
           fallback handlers. Stacking a GET and POST decorator on the same
           path (or sharing a path across two named routes) caused FastAPI to
           mis-resolve POST /auth/register as the GET handler, returning 405.
           GET requests to /auth/register and /auth/login are now handled by
           the top-level SPA catch-all in api.py (@app.get("/{full_path:path}"))
           which was already fixed to GET-only in Bug #14. The get_static_dir
           helper and FileResponse import are no longer needed here and have
           been removed.
"""

import os
import logging
from typing import Optional
from fastapi import APIRouter, Cookie, HTTPException, Depends, Header, Response, Request
from fastapi.concurrency import run_in_threadpool

import auth as auth_module
from models import (
    get_org_by_api_key, create_org, update_org_db
)
from database import DatabaseManager
from dependencies import get_current_org, FILE_DB_CACHE, FILE_DB_CACHE_LOCK, require_permission, limiter
from email_service import send_welcome_email
from schemas import (
    RegisterRequest, ConfigRequest, LoginRequest, RegisterUserRequest,
    AcceptInviteRequest, InviteRequest, ForgotPasswordRequest, ResetPasswordRequest,
    RefreshRequest
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Organization Registration ────────────────────────────────────────────────

@router.post("/register")
@limiter.limit("5/minute")
async def register(request: Request, payload: RegisterRequest):
    """Register a new organization and optionally provision a DB."""
    if payload.email and auth_module.get_user_by_email_global(payload.email):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
        
    try:
        org = create_org(payload.name, payload.email)
        try:
            db_conn_str = await provision_org_database(org.name, org.api_key)
            if db_conn_str:
                update_org_db(org.api_key, db_conn_str)
                org.db_connection_string = db_conn_str
                logger.info(f"Auto-provisioned database for org: {org.name}")

                send_welcome_email(payload.email, org.name, org.api_key)
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
        raise HTTPException(status_code=400, detail="Organization name already exists or email already in use.")


# ── Helpers ──────────────────────────────────────────────────────────────────

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
    from fastapi.concurrency import run_in_threadpool

    safe_name = "".join(c for c in org_name.lower() if c.isalnum())[:10]
    unique_suffix = api_key[:8]
    new_db_name = f"vantage_{safe_name}_{unique_suffix}"
    new_user = f"user_{safe_name}_{unique_suffix}"

    alphabet = string.ascii_letters + string.digits
    new_password = ''.join(secrets.choice(alphabet) for _ in range(16))

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
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (new_db_name,))
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


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/register-first-user")
@limiter.limit("5/minute")
async def register_first_user_route(request: Request,
                                    payload: RegisterUserRequest,
                                    response: Response,
                                    x_api_key: str = Header(...)):
    """Create the first owner user for an organization."""
    try:
        org = get_org_by_api_key(x_api_key)
        if not org:
            raise HTTPException(status_code=401, detail="Invalid API key")

        res = auth_module.register_first_user(
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            org_id=org.id
        )
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Register first user failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
@limiter.limit("5/minute")
async def login_route(request: Request, payload: LoginRequest, response: Response):
    """Authenticate a user and set cookies."""
    try:
        res = auth_module.login_user(email=payload.email, password=payload.password)
        auth_module._set_auth_cookies(response, res["refresh_token"], res["api_key"])
        return res
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/logout")
async def logout_route(
    response: Response,
    vantage_refresh_token: Optional[str] = Cookie(None),  # C-4 fix: read cookie
):
    """Log out a user and invalidate the server-side refresh token."""
    # C-4 fix: delete the token from the DB so stolen tokens cannot be reused
    if vantage_refresh_token:
        try:
            auth_module.logout_user(vantage_refresh_token)
        except Exception:
            pass  # already expired or missing — still clear cookies
    auth_module._clear_auth_cookies(response)
    return {"message": "Logged out successfully"}


@router.post("/refresh")
async def refresh_route(payload: RefreshRequest):
    """Exchange a refresh token for a new access token."""
    try:
        return auth_module.refresh_access_token(payload.refresh_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/forgot-password")
@limiter.limit("5/minute")
async def forgot_password_route(request: Request, payload: ForgotPasswordRequest):
    """Generate a password reset token and send an email."""
    try:
        token = auth_module.create_password_reset_token(payload.email)
        if token:
            # We found a user, send the email
            # Build the reset URL (frontend should handle this route)
            reset_url = f"{auth_module.APP_URL}/auth?reset_token={token}"
            # Need to import send_password_reset_email or similar
            from email_service import send_password_reset_email
            send_password_reset_email(payload.email, reset_url)
        
        # Always return success to prevent email enumeration
        return {"message": "If an account exists for that email, a reset link has been sent."}
    except Exception as e:
        logger.error(f"Forgot password failed: {e}")
        # Still return success to prevent enumeration
        return {"message": "If an account exists for that email, a reset link has been sent."}


@router.post("/reset-password")
@limiter.limit("5/minute")
async def reset_password_route(request: Request, payload: ResetPasswordRequest):
    """Reset a user's password using a valid token."""
    try:
        success = auth_module.reset_password_with_token(payload.token, payload.password)
        if not success:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
        return {"message": "Password reset successfully. You can now login with your new password."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reset password failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/invite")
async def invite_user_route(request: InviteRequest,
                            user: dict = Depends(require_permission("MANAGE_USERS"))):
    """Generate an invitation token for a new team member."""
    try:
        token = auth_module.create_invite(
            org_id=user["org_id"],
            email=request.email,
            role=request.role,
            invited_by=user["id"],
        )
        return {"token": token, "email": request.email, "role": request.role}
    except Exception as e:
        logger.error(f"Invite failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/invite/status")
async def get_invite_status_route(user: dict = Depends(require_permission("MANAGE_USERS"))):
    """Return the status of all invitations for the current organization."""
    try:
        return auth_module.get_invite_statuses(user["org_id"])
    except Exception as e:
        logger.error(f"Failed to fetch invite statuses: {e}")
        raise HTTPException(status_code=400, detail=str(e))


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


@router.delete("/invite/{email}")
async def revoke_invite_route(email: str, user: dict = Depends(require_permission("MANAGE_USERS"))):
    """Revoke a pending invitation for a specific email."""
    try:
        success = auth_module.revoke_invite(user["org_id"], email)
        if not success:
            raise HTTPException(status_code=404, detail="Active invite not found")
        return {"status": "success", "message": "Invite revoked"}
    except Exception as e:
        logger.error(f"Failed to revoke invite: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/users/{email}")
async def remove_user_route(email: str, user: dict = Depends(require_permission("MANAGE_USERS"))):
    """Remove a user from the organization."""
    try:
        auth_module.remove_user(
            org_id=user["org_id"], 
            target_email=email, 
            requester_role=user["role"], 
            requester_email=user["email"]
        )
        return {"status": "success", "message": "User removed"}
    except Exception as e:
        logger.error(f"Failed to remove user: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/users/{email}/role")
async def change_user_role_route(email: str, request: auth_module.UpdateRoleRequest, user: dict = Depends(require_permission("MANAGE_USERS"))):
    """Change a user's role, allowing ownership handover."""
    try:
        auth_module.change_user_role(
            org_id=user["org_id"],
            target_email=email,
            new_role=request.role,
            requester_email=user["email"],
            requester_role=user["role"]
        )
        return {"status": "success", "message": f"Role updated to {request.role}"}
    except Exception as e:
        logger.error(f"Failed to change user role: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
async def get_me(user: dict = Depends(auth_module.get_current_user)):
    """Return the current authenticated user's profile, including permissions."""
    user["permissions"] = auth_module.get_role_permissions(user.get("role", "viewer"))
    return user