"""
routers/insights.py — Proactive insights and recommendations.
"""

import logging
from typing import Any, Dict
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


@router.get("/insights/unseen-count")
async def get_unseen_count(org=Depends(get_current_org)):
    """Return just the number of unseen insights — lightweight for polling."""
    try:
        count = _read_only_engine(org.id).get_unseen_count()
        return {"count": count}
    except Exception as e:
        logger.error(f"Failed to get unseen count: {e}")
        raise HTTPException(status_code=500, detail="Failed to get unseen count")


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
        from insight_engine import InsightEngine, get_org_threshold
        db_manager = DatabaseManager(connection_string=conn_str)
        agent = AnalyticsAgent(
            connection_string=conn_str,
            observability_tags=[f"org:{org.id}"]
        )
        engine = InsightEngine(
            db_manager=db_manager,
            agent=agent,
            org_id=org.id,
            threshold_pct=get_org_threshold(org.id),
        )
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


# ── Suppression ────────────────────────────────────────────────────────────────

@router.post("/insights/{insight_id}/suppress")
async def suppress_insight_metric(insight_id: str, org=Depends(get_current_org)):
    """Suppress future insights for the metric referenced by this insight."""
    try:
        from insight_engine import InsightEngine, _get_admin_engine
        from sqlalchemy import text as sa_text

        # Look up the table+column for this insight
        engine = _get_admin_engine()
        with engine.connect() as conn:
            row = conn.execute(
                sa_text(
                    "SELECT metric_table, metric_column FROM org_insights "
                    "WHERE id = :id AND org_id = :org_id"
                ),
                {"id": insight_id, "org_id": org.id},
            ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Insight not found")

        ie = _read_only_engine(org.id)
        ie.suppress_metric(row["metric_table"], row["metric_column"])
        return {
            "status": "success",
            "suppressed": {
                "table":  row["metric_table"],
                "column": row["metric_column"],
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to suppress metric for insight {insight_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to suppress metric")


@router.get("/insights/suppressions")
async def get_suppressions(org=Depends(get_current_org)):
    """List all suppressed metrics for this org."""
    try:
        return {"suppressions": _read_only_engine(org.id).get_suppressions()}
    except Exception as e:
        logger.error(f"Failed to get suppressions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get suppressions")


@router.delete("/insights/suppressions/{metric_table}/{metric_column}")
async def unsuppress_metric(
    metric_table: str,
    metric_column: str,
    org=Depends(get_current_org),
):
    """Remove a suppression so a metric can generate insights again."""
    try:
        _read_only_engine(org.id).unsuppress_metric(metric_table, metric_column)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to unsuppress {metric_table}.{metric_column}: {e}")
        raise HTTPException(status_code=500, detail="Failed to unsuppress metric")


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/insights/settings")
async def get_insight_settings(org=Depends(get_current_org)):
    """Return insight settings (threshold, etc.) for this org."""
    try:
        return _read_only_engine(org.id).get_settings()
    except Exception as e:
        logger.error(f"Failed to get insight settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to get insight settings")


@router.post("/insights/settings")
async def save_insight_settings(
    request: Dict[str, Any],
    org=Depends(get_current_org),
):
    """Persist insight settings for this org."""
    try:
        threshold_pct = float(request.get("threshold_pct", 10.0))
        _read_only_engine(org.id).save_settings(threshold_pct)
        return {"status": "success", "threshold_pct": threshold_pct}
    except Exception as e:
        logger.error(f"Failed to save insight settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to save settings")
