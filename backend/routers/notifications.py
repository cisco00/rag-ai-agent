"""
routers/notifications.py — In-app Notification Center

Provides a lightweight per-user notification store backed by the admin DB.
Notifications are created by backend services (alerts, scheduler, etc.) and
consumed by the frontend bell icon.

Endpoints
─────────
GET  /notifications              — list unread + recent (max 50)
POST /notifications/{id}/read    — mark one as read
POST /notifications/read-all     — mark all as read for this user
DELETE /notifications/{id}       — dismiss one
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, text
from sqlalchemy.ext.declarative import declarative_base

from auth import get_current_user
from dependencies import get_current_org
from models import admin_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# ── ORM ───────────────────────────────────────────────────────────────────────

_Base = declarative_base()


class Notification(_Base):
    __tablename__ = "notifications"

    id         = Column(Integer, primary_key=True)
    org_id     = Column(Integer, nullable=False)
    user_id    = Column(Integer, nullable=True)   # None = broadcast to all org users
    type       = Column(String(50), nullable=False, default="info")
    # types: info | alert | report | invite | data_quality | pipeline | error
    title      = Column(String(255), nullable=False)
    message    = Column(Text, nullable=True)
    link       = Column(String(500), nullable=True)   # optional deep-link
    read       = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_notif_org_user", "org_id", "user_id"),
        Index("ix_notif_created", "created_at"),
    )


def _ensure_table():
    _Base.metadata.create_all(admin_engine, tables=[Notification.__table__])


# ── Public helper used by other modules ───────────────────────────────────────

def create_notification(
    org_id:  int,
    title:   str,
    *,
    type:    str = "info",
    message: Optional[str] = None,
    link:    Optional[str] = None,
    user_id: Optional[int] = None,   # None = all org members
) -> None:
    """
    Persist a notification. Called from alerts, scheduler, etc.
    Silently ignores errors so callers aren't disrupted.
    """
    try:
        _ensure_table()
        with admin_engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("""
                        INSERT INTO notifications (org_id, user_id, type, title, message, link, read, created_at)
                        VALUES (:org_id, :user_id, :type, :title, :message, :link, 0, :now)
                    """),
                    {
                        "org_id": org_id,
                        "user_id": user_id,
                        "type": type,
                        "title": title,
                        "message": message,
                        "link": link,
                        "now": datetime.now(timezone.utc).isoformat(),
                    },
                )
    except Exception as exc:
        logger.error(f"[Notifications] Failed to create notification: {exc}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    limit: int = 50,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Return up to `limit` recent notifications for this user (most recent first).
    Includes both user-specific and org-wide (user_id IS NULL) notifications.
    """
    def _fetch():
        _ensure_table()
        with admin_engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT id, type, title, message, link, read, created_at
                    FROM notifications
                    WHERE org_id = :org_id
                      AND (user_id = :uid OR user_id IS NULL)
                    ORDER BY created_at DESC
                    LIMIT :lim
                """),
                {"org_id": org.id, "uid": user["id"], "lim": limit},
            ).mappings().all()
        return [dict(r) for r in rows]

    try:
        rows = await run_in_threadpool(_fetch)
        # Coerce created_at to ISO string
        for r in rows:
            if isinstance(r.get("created_at"), datetime):
                r["created_at"] = r["created_at"].isoformat()
        unread = sum(1 for r in rows if not r["read"])
        return {"notifications": rows, "unread_count": unread}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/notifications/{notif_id}/read")
async def mark_read(
    notif_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Mark a single notification as read."""
    def _update():
        _ensure_table()
        with admin_engine.connect() as conn:
            with conn.begin():
                result = conn.execute(
                    text("""
                        UPDATE notifications
                        SET read = 1
                        WHERE id = :id AND org_id = :org_id
                          AND (user_id = :uid OR user_id IS NULL)
                    """),
                    {"id": notif_id, "org_id": org.id, "uid": user["id"]},
                )
                return result.rowcount

    try:
        rows = await run_in_threadpool(_update)
        if rows == 0:
            raise HTTPException(status_code=404, detail="Notification not found.")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/notifications/read-all")
async def mark_all_read(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Mark all notifications for this user as read."""
    def _update_all():
        _ensure_table()
        with admin_engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("""
                        UPDATE notifications
                        SET read = 1
                        WHERE org_id = :org_id
                          AND (user_id = :uid OR user_id IS NULL)
                          AND read = 0
                    """),
                    {"org_id": org.id, "uid": user["id"]},
                )

    try:
        await run_in_threadpool(_update_all)
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/notifications/{notif_id}")
async def dismiss_notification(
    notif_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Permanently delete a notification."""
    def _delete():
        _ensure_table()
        with admin_engine.connect() as conn:
            with conn.begin():
                result = conn.execute(
                    text("""
                        DELETE FROM notifications
                        WHERE id = :id AND org_id = :org_id
                          AND (user_id = :uid OR user_id IS NULL)
                    """),
                    {"id": notif_id, "org_id": org.id, "uid": user["id"]},
                )
                return result.rowcount

    try:
        rows = await run_in_threadpool(_delete)
        if rows == 0:
            raise HTTPException(status_code=404, detail="Notification not found.")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
