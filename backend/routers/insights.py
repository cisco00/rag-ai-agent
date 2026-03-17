"""
routers/insights.py — Proactive insights and recommendations.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends

from dependencies import get_current_org, get_org_connection_string
from database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.get("/insights")
async def get_org_insights(limit: int = 20, org=Depends(get_current_org)):
    """Fetch proactive insights for the organization."""
    try:
        from main import AnalyticsAgent
        from insight_engine import InsightEngine
        
        conn_str = get_org_connection_string(org)
        if not conn_str:
            return {"status": "success", "insights": []}
            
        db_manager = DatabaseManager(connection_string=conn_str)
        agent = AnalyticsAgent(connection_string=conn_str)
        engine = InsightEngine(db_manager=db_manager, agent=agent, org_id=org.id)
            
        insights = engine.get_all_insights(limit=limit)
        return {"status": "success", "insights": insights}
    except Exception as e:
        logger.error(f"Failed to fetch insights: {e}", exc_info=True)
        return {"status": "error", "message": "Failed to fetch insights"}


@router.post("/insights/mark-all-seen")
async def mark_all_insights_seen(org=Depends(get_current_org)):
    """Mark all insights as read for the organization."""
    try:
        from insight_engine import InsightEngine
        # InsightEngine just needs the ID for this operation
        engine = InsightEngine(None, None, org.id)
        engine.mark_all_seen()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to mark insights seen: {e}")
        raise HTTPException(status_code=500, detail="Failed to update insights")


@router.post("/insights/{insight_id}/seen")
async def mark_insight_seen(insight_id: str, org=Depends(get_current_org)):
    """Mark a specific insight as read."""
    try:
        from insight_engine import InsightEngine
        engine = InsightEngine(None, None, org.id)
        engine.mark_seen(insight_id)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to mark insight seen: {e}")
        raise HTTPException(status_code=500, detail="Failed to update insight")