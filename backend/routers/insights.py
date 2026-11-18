"""
routers/insights.py — Proactive insights and recommendations.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks

from dependencies import get_current_org, get_org_connection_string
from database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Helper ────────────────────────────────────────────────────────────────────

def _read_only_engine(org_id: int):
    """InsightEngine configured for read operations only (no db/agent needed)."""
    from insight_engine import InsightEngine
    return InsightEngine(None, None, org_id)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/insights")
async def get_org_insights(limit: int = 50, org=Depends(get_current_org)):
    """Fetch stored proactive insights for the organisation."""
    try:
        engine = _read_only_engine(org.id)
        insights = engine.get_all_insights(limit=limit)
        return {"status": "success", "insights": insights}
    except Exception as e:
        logger.error(f"Failed to fetch insights: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch insights")


@router.post("/insights/generate")
async def generate_insights(
    background_tasks: BackgroundTasks,
    org=Depends(get_current_org),
):
    """Trigger a fresh watchdog scan for this organisation in the background."""
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(
            status_code=400,
            detail="No database connection configured for this organisation."
        )

    def _run():
        from main import AnalyticsAgent
        from insight_engine import InsightEngine
        db_manager = DatabaseManager(connection_string=conn_str)
        agent = AnalyticsAgent(
            connection_string=conn_str,
            observability_tags=[f"org:{org.id}"]
        )
        engine = InsightEngine(db_manager=db_manager, agent=agent, org_id=org.id)
        try:
            engine.run_watchdog()
        finally:
            engine.close()

    background_tasks.add_task(_run)
    return {"status": "success", "message": "Insight analysis started in background."}


@router.post("/insights/mark-all-seen")
async def mark_all_insights_seen(org=Depends(get_current_org)):
    """Mark all insights as read for the organisation."""
    try:
        _read_only_engine(org.id).mark_all_seen()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to mark insights seen: {e}")
        raise HTTPException(status_code=500, detail="Failed to update insights")


@router.post("/insights/{insight_id}/seen")
async def mark_insight_seen(insight_id: str, org=Depends(get_current_org)):
    """Mark a specific insight as read."""
    try:
        _read_only_engine(org.id).mark_seen(insight_id)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to mark insight seen: {e}")
        raise HTTPException(status_code=500, detail="Failed to update insight")


@router.delete("/insights/{insight_id}")
async def delete_insight(insight_id: str, org=Depends(get_current_org)):
    """Permanently dismiss (delete) a single insight."""
    try:
        from insight_engine import InsightEngine
        from sqlalchemy import text
        from insight_engine import _get_admin_engine

        engine = _get_admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                result = conn.execute(
                    text(
                        "DELETE FROM org_insights "
                        "WHERE id = :id AND org_id = :org_id"
                    ),
                    {"id": insight_id, "org_id": org.id},
                )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Insight not found")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete insight {insight_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete insight")
