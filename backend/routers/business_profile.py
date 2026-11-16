"""
routers/business_profile.py — Org Business Profile

Stores lightweight org-context fields that make AI analytics
interpretations organisation-specific rather than generic.

Fields
------
industry           : str   — e.g. "E-commerce", "Banking", "SaaS"
business_model     : str   — free-text description
key_metrics        : list  — ["revenue", "churn_rate", "transactions_per_day"]
objectives         : str   — strategic / analytical goals
data_description   : str   — what the connected tables contain
team_size          : str   — optional (startup / small / mid / enterprise)
region             : str   — optional geographic context
custom_context     : str   — anything else the org wants the AI to know

Stored as a JSON blob in a dedicated table so it doesn't require
altering the Organisation model.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, Text, DateTime, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session

from auth import get_current_user
from dependencies import get_current_org
from models import admin_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# ── ORM ───────────────────────────────────────────────────────────────────────

_Base = declarative_base()


class OrgBusinessProfile(_Base):
    __tablename__ = "org_business_profiles"

    id             = Column(Integer, primary_key=True)
    org_id         = Column(Integer, nullable=False, unique=True)
    profile_json   = Column(Text, default="{}")
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at     = Column(DateTime,
                            default=lambda: datetime.now(timezone.utc),
                            onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("ix_obp_org", "org_id"),)


def _ensure_table(engine):
    _Base.metadata.create_all(engine, tables=[OrgBusinessProfile.__table__])


# ── Pydantic ──────────────────────────────────────────────────────────────────

INDUSTRIES = [
    "E-commerce", "Banking & Finance", "SaaS / Software",
    "Healthcare", "Manufacturing", "Retail", "Logistics & Supply Chain",
    "Real Estate", "Education", "Media & Entertainment",
    "Telecommunications", "Insurance", "Hospitality & Travel",
    "Energy & Utilities", "Non-profit", "Government", "Other",
]

TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "201–1000", "1000+"]


class ProfileUpsert(BaseModel):
    industry:         Optional[str] = None
    business_model:   Optional[str] = None
    key_metrics:      Optional[List[str]] = None
    objectives:       Optional[str] = None
    data_description: Optional[str] = None
    team_size:        Optional[str] = None
    region:           Optional[str] = None
    custom_context:   Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load(record: OrgBusinessProfile) -> dict:
    try:
        return json.loads(record.profile_json or "{}")
    except Exception:
        return {}


def _serialize(record: OrgBusinessProfile) -> dict:
    data = _load(record)
    return {
        "org_id":     record.org_id,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        **data,
        # completeness score (0–100) so the UI can show a progress indicator
        "completeness": _completeness(data),
        "industries":   INDUSTRIES,
        "team_sizes":   TEAM_SIZES,
    }


_SCORED_FIELDS = ["industry", "business_model", "key_metrics", "objectives", "data_description"]

def _completeness(data: dict) -> int:
    filled = sum(1 for f in _SCORED_FIELDS
                 if data.get(f) and (data[f] if not isinstance(data[f], list) else len(data[f]) > 0))
    return int(filled / len(_SCORED_FIELDS) * 100)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/business-profile")
async def get_profile(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    _ensure_table(admin_engine)
    with Session(admin_engine) as db:
        record = db.query(OrgBusinessProfile).filter(
            OrgBusinessProfile.org_id == org.id
        ).first()
        if not record:
            return {
                "org_id":       org.id,
                "completeness": 0,
                "industries":   INDUSTRIES,
                "team_sizes":   TEAM_SIZES,
            }
        return _serialize(record)


@router.put("/business-profile")
async def upsert_profile(
    body: ProfileUpsert,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    _ensure_table(admin_engine)
    with Session(admin_engine) as db:
        record = db.query(OrgBusinessProfile).filter(
            OrgBusinessProfile.org_id == org.id
        ).first()

        # Merge new values over existing
        existing = json.loads(record.profile_json or "{}") if record else {}
        update = body.model_dump(exclude_none=True)
        merged = {**existing, **update}

        if record:
            record.profile_json = json.dumps(merged)
            record.updated_at   = datetime.now(timezone.utc)
        else:
            record = OrgBusinessProfile(
                org_id=org.id,
                profile_json=json.dumps(merged),
            )
            db.add(record)

        db.commit()
        db.refresh(record)

        # Serialise while session is still open — avoids DetachedInstanceError
        result = _serialize(record)

    logger.info("[BizProfile] org=%s updated — completeness=%s%%",
                org.id, _completeness(merged))
    return result


@router.delete("/business-profile", status_code=204)
async def clear_profile(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    _ensure_table(admin_engine)
    with Session(admin_engine) as db:
        record = db.query(OrgBusinessProfile).filter(
            OrgBusinessProfile.org_id == org.id
        ).first()
        if record:
            db.delete(record)
            db.commit()
