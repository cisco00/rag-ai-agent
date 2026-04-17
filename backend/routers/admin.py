"""
routers/admin.py — Global Admin endpoints for platform-wide user & activity tracking.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy import text

from models import engine as admin_engine
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_superuser(user: dict = Depends(get_current_user)):
    """Only allow platform superusers to access admin endpoints."""
    if not user.get("is_superuser"):
        raise HTTPException(status_code=403, detail="Platform admin access required.")
    return user


@router.get("/admin/users")
async def list_all_users(
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(_require_superuser),
):
    """Return all users across every organization."""
    with admin_engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT u.id, u.org_id, u.email, u.display_name, u.role, "
            "u.is_active, u.last_login_at, u.created_at, "
            "o.name AS org_name "
            "FROM users u "
            "LEFT JOIN organizations o ON u.org_id = o.id "
            "ORDER BY u.created_at DESC "
            "LIMIT :limit OFFSET :offset"
        ), {"limit": limit, "offset": offset}).mappings().all()

        total = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()

    return {
        "users": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/admin/activities")
async def list_activities(
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None),
    user_id_filter: Optional[int] = Query(None, alias="user_id"),
    user: dict = Depends(_require_superuser),
):
    """Return platform-wide activity logs with optional filters."""
    base_query = "FROM activity_logs a"
    params: dict = {"limit": limit, "offset": offset}
    conditions = []

    if action:
        conditions.append("a.action = :action")
        params["action"] = action
    if user_id_filter is not None:
        conditions.append("a.user_id = :uid")
        params["uid"] = user_id_filter

    where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    with admin_engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT a.id, a.user_id, a.org_id, a.action, a.details, a.created_at, "
            "u.email AS user_email, u.display_name AS user_name, o.name AS org_name "
            f"{base_query} "
            "LEFT JOIN users u ON a.user_id = u.id "
            "LEFT JOIN organizations o ON a.org_id = o.id "
            f"{where_clause} "
            "ORDER BY a.created_at DESC "
            "LIMIT :limit OFFSET :offset"
        ), params).mappings().all()

        total = conn.execute(text(
            f"SELECT COUNT(*) {base_query} {where_clause}"
        ), params).scalar()

    return {
        "activities": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/admin/stats")
async def admin_stats(user: dict = Depends(_require_superuser)):
    """Return high-level platform statistics."""
    with admin_engine.connect() as conn:
        total_users = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        total_orgs = conn.execute(text("SELECT COUNT(*) FROM organizations")).scalar()
        try:
            total_activities = conn.execute(text("SELECT COUNT(*) FROM activity_logs")).scalar()
        except Exception:
            total_activities = 0

    return {
        "total_users": total_users,
        "total_organizations": total_orgs,
        "total_activities": total_activities,
    }
""" TargetFile """
