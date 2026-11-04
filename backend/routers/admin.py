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

# ── Update Status Endpoints ──────────────────────────────────────────────────

@router.get("/admin/updates/status")
async def update_status(user: dict = Depends(_require_superuser)):
    """Return the cached update check result (no network call)."""
    from update_checker import get_update_status
    return get_update_status()


@router.post("/admin/updates/check")
async def force_update_check(user: dict = Depends(_require_superuser)):
    """Force an immediate version check against the remote repository."""
    from update_checker import check_for_updates
    result = await check_for_updates()
    return result


@router.post("/admin/updates/dismiss")
async def dismiss_update(
    version: str = Query(..., description="Version string to dismiss"),
    user: dict = Depends(_require_superuser),
):
    """Dismiss the update notification for a given version."""
    from update_checker import dismiss_version
    dismiss_version(version)
    return {"dismissed": version}


@router.get("/admin/updates/release-url")
async def get_release_url(
    version: Optional[str] = Query(None, description="Specific version tag, e.g. '1.2.3'. Defaults to latest_version from cache."),
    user: dict = Depends(_require_superuser),
):
    """
    Return GitHub release info for the given version (or latest cached version).
    Used by the desktop app to show a 'Download & Install' button with the
    correct platform-specific asset URL.
    """
    from update_checker import get_release_info, get_update_status
    target = version or get_update_status().get("latest_version")
    info   = await get_release_info(target)
    return info


@router.get("/admin/updates/changelog")
async def get_changelog(user: dict = Depends(_require_superuser)):
    """
    Fetch and return the CHANGELOG.md content from GitHub (or the local file
    as fallback).  Returns raw Markdown so the frontend can render it.
    Sections are split by version heading so the frontend can highlight the
    latest entry.
    """
    import os, re
    import httpx
    from update_checker import get_update_status, CHANGELOG_URL, _GITHUB_TOKEN, _VERSION_FILE

    # Try to fetch the raw CHANGELOG from GitHub
    raw_url = (
        "https://raw.githubusercontent.com/cisco00/rag-ai-agent/main/CHANGELOG.md"
    )
    changelog_md: str = ""
    source = "remote"

    headers = {}
    if _GITHUB_TOKEN:
        headers["Authorization"] = f"token {_GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(raw_url, headers=headers, follow_redirects=True)
            resp.raise_for_status()
            changelog_md = resp.text
    except Exception:
        # Fall back to the local CHANGELOG.md
        source = "local"
        local_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "..", "CHANGELOG.md"
        )
        try:
            with open(os.path.normpath(local_path)) as f:
                changelog_md = f.read()
        except Exception:
            changelog_md = "No changelog available."

    # Split into version sections  (## [x.y.z] …)
    status   = get_update_status()
    latest_v = status.get("latest_version") or ""

    sections: list[dict] = []
    pattern  = re.compile(r'^## \[([^\]]+)\]', re.MULTILINE)
    matches  = list(pattern.finditer(changelog_md))

    for i, m in enumerate(matches):
        version_str = m.group(1)
        start       = m.start()
        end         = matches[i + 1].start() if i + 1 < len(matches) else len(changelog_md)
        sections.append({
            "version": version_str,
            "content": changelog_md[start:end].strip(),
            "is_latest": version_str == latest_v,
        })

    return {
        "markdown": changelog_md,
        "sections": sections,
        "source": source,
        "latest_version": latest_v,
        "changelog_url": CHANGELOG_URL,
    }

