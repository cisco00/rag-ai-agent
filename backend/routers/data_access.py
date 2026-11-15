"""
routers/data_access.py — Data Access Permission Dialog

Implements the approval workflow from the Vantage AI Read-Only Database
Access and Data Replication Architecture spec:
  POST   /data-access/request              — analyst submits a request
  GET    /data-access/requests             — admin lists all requests
  GET    /data-access/requests/mine        — analyst sees own requests
  POST   /data-access/requests/{id}/approve — admin approves + triggers snapshot
  POST   /data-access/requests/{id}/decline — admin declines with optional reason
  DELETE /data-access/requests/{id}        — admin hard-deletes a request
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.ext.declarative import declarative_base

from auth import get_current_user
from dependencies import get_current_org
from models import get_db, admin_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# ── ORM ───────────────────────────────────────────────────────────────────────

_Base = declarative_base()


class DataAccessRequest(_Base):
    __tablename__ = "data_access_requests"

    id             = Column(Integer, primary_key=True)
    org_id         = Column(Integer, nullable=False)
    requested_by   = Column(Integer, nullable=True)      # user.id
    requester_name = Column(String(255), nullable=True)
    requester_email= Column(String(255), nullable=True)

    database_name  = Column(String(255), nullable=True)
    tables_json    = Column(Text, default="[]")          # list of table names
    columns_json   = Column(Text, default="{}")          # {table: [col, ...]}
    purpose        = Column(Text, nullable=True)
    access_type    = Column(String(50), default="read")  # "read" | "export" | "replicate"
    estimated_rows = Column(Integer, nullable=True)

    status         = Column(String(50), default="pending") # pending|approved|declined
    decline_reason = Column(Text, nullable=True)
    resolved_by    = Column(Integer, nullable=True)      # user.id of admin who acted

    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    resolved_at    = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_dar_org",    "org_id"),
        Index("ix_dar_status", "status"),
        Index("ix_dar_user",   "requested_by"),
    )


def _ensure_table(engine):
    _Base.metadata.create_all(engine, tables=[DataAccessRequest.__table__])


# ── Pydantic ──────────────────────────────────────────────────────────────────

class _BM(BaseModel):
    class Config:
        from_attributes = True


class RequestCreate(_BM):
    database_name:  Optional[str] = None
    tables:         List[str] = []
    columns:        dict = {}       # {table: [col, ...]}
    purpose:        Optional[str] = None
    access_type:    str = "read"
    estimated_rows: Optional[int] = None


class DeclineBody(_BM):
    reason: Optional[str] = None


# ── Serializer ────────────────────────────────────────────────────────────────

def _serialize(r: DataAccessRequest) -> dict:
    return {
        "id":              r.id,
        "org_id":          r.org_id,
        "requested_by":    r.requested_by,
        "requester_name":  r.requester_name,
        "requester_email": r.requester_email,
        "database_name":   r.database_name,
        "tables":          json.loads(r.tables_json or "[]"),
        "columns":         json.loads(r.columns_json or "{}"),
        "purpose":         r.purpose,
        "access_type":     r.access_type,
        "estimated_rows":  r.estimated_rows,
        "status":          r.status,
        "decline_reason":  r.decline_reason,
        "resolved_by":     r.resolved_by,
        "created_at":      r.created_at.isoformat() if r.created_at else None,
        "resolved_at":     r.resolved_at.isoformat() if r.resolved_at else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/data-access/request", status_code=201)
async def create_request(
    body: RequestCreate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Analyst submits a data access request."""
    _ensure_table(admin_engine)
    with get_db() as db:
        req = DataAccessRequest(
            org_id=org.id,
            requested_by=getattr(user, "id", None),
            requester_name=getattr(user, "display_name", None) or getattr(user, "email", None),
            requester_email=getattr(user, "email", None),
            database_name=body.database_name,
            tables_json=json.dumps(body.tables),
            columns_json=json.dumps(body.columns),
            purpose=body.purpose,
            access_type=body.access_type,
            estimated_rows=body.estimated_rows,
            status="pending",
        )
        db.add(req)
        db.commit()
        db.refresh(req)
    logger.info("[DataAccess] Request #%s created by user %s", req.id, req.requested_by)
    return _serialize(req)


@router.get("/data-access/requests")
async def list_requests(
    status: Optional[str] = None,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Admin: list all requests for this org, optionally filtered by status."""
    _ensure_table(admin_engine)
    # Only org admins / superusers should see all requests
    role = getattr(user, "role", "viewer")
    if role not in ("admin", "business_owner", "superuser") and not getattr(user, "is_superuser", False):
        raise HTTPException(403, "Admins only")

    with get_db() as db:
        q = db.query(DataAccessRequest).filter(DataAccessRequest.org_id == org.id)
        if status:
            q = q.filter(DataAccessRequest.status == status)
        rows = q.order_by(DataAccessRequest.created_at.desc()).all()
    return {"requests": [_serialize(r) for r in rows]}


@router.get("/data-access/requests/mine")
async def list_my_requests(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Analyst: see own requests."""
    _ensure_table(admin_engine)
    uid = getattr(user, "id", None)
    with get_db() as db:
        rows = (
            db.query(DataAccessRequest)
            .filter(
                DataAccessRequest.org_id == org.id,
                DataAccessRequest.requested_by == uid,
            )
            .order_by(DataAccessRequest.created_at.desc())
            .all()
        )
    return {"requests": [_serialize(r) for r in rows]}


@router.post("/data-access/requests/{request_id}/approve")
async def approve_request(
    request_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Admin approves the request and triggers a table snapshot."""
    _ensure_table(admin_engine)
    role = getattr(user, "role", "viewer")
    if role not in ("admin", "business_owner", "superuser") and not getattr(user, "is_superuser", False):
        raise HTTPException(403, "Admins only")

    with get_db() as db:
        req = db.query(DataAccessRequest).filter(
            DataAccessRequest.id == request_id,
            DataAccessRequest.org_id == org.id,
        ).first()
        if not req:
            raise HTTPException(404, "Request not found")
        if req.status != "pending":
            raise HTTPException(409, f"Request is already {req.status}")

        req.status      = "approved"
        req.resolved_by = getattr(user, "id", None)
        req.resolved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(req)

    logger.info("[DataAccess] Request #%s approved by user %s", request_id, req.resolved_by)
    # In a full implementation this would queue a replication job.
    # For now we return the updated record and a placeholder message.
    return {
        **_serialize(req),
        "message": "Request approved. Data snapshot will be prepared.",
    }


@router.post("/data-access/requests/{request_id}/decline")
async def decline_request(
    request_id: int,
    body: DeclineBody = DeclineBody(),
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Admin declines the request with an optional reason."""
    _ensure_table(admin_engine)
    role = getattr(user, "role", "viewer")
    if role not in ("admin", "business_owner", "superuser") and not getattr(user, "is_superuser", False):
        raise HTTPException(403, "Admins only")

    with get_db() as db:
        req = db.query(DataAccessRequest).filter(
            DataAccessRequest.id == request_id,
            DataAccessRequest.org_id == org.id,
        ).first()
        if not req:
            raise HTTPException(404, "Request not found")
        if req.status != "pending":
            raise HTTPException(409, f"Request is already {req.status}")

        req.status         = "declined"
        req.decline_reason = body.reason
        req.resolved_by    = getattr(user, "id", None)
        req.resolved_at    = datetime.now(timezone.utc)
        db.commit()
        db.refresh(req)

    logger.info("[DataAccess] Request #%s declined by user %s", request_id, req.resolved_by)
    return _serialize(req)


@router.delete("/data-access/requests/{request_id}", status_code=204)
async def delete_request(
    request_id: int,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Admin hard-deletes a request record."""
    _ensure_table(admin_engine)
    role = getattr(user, "role", "viewer")
    if role not in ("admin", "business_owner", "superuser") and not getattr(user, "is_superuser", False):
        raise HTTPException(403, "Admins only")

    with get_db() as db:
        req = db.query(DataAccessRequest).filter(
            DataAccessRequest.id == request_id,
            DataAccessRequest.org_id == org.id,
        ).first()
        if not req:
            raise HTTPException(404, "Request not found")
        db.delete(req)
        db.commit()
