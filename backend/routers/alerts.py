"""
routers/alerts.py — Alerting and monitoring routes.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from dependencies import get_current_org, get_org_connection_string, require_permission
from alerts import (
    get_alert_rules, create_alert_rule, get_alert_rule, update_alert_rule,
    delete_alert_rule, get_alert_history, _evaluate_metric_rule, _evaluate_freshness_rule,
    get_unseen_alert_count, mark_alerts_seen,
)
from schemas import AlertRuleRequest

router = APIRouter()

# ── Routes ──

@router.get("/alerts")
async def list_alerts(org=Depends(get_current_org)):
    """List all alert rules for the org."""
    try:
        return {"alerts": get_alert_rules(org.id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts")
async def create_alert(request: AlertRuleRequest, org=Depends(get_current_org),
                       user=Depends(require_permission("MANAGE_ALERTS"))):
    """Create a new alert rule."""
    data = request.model_dump()
    rule = create_alert_rule(org.id, data)
    return {"status": "success", "alert": rule}


@router.get("/alerts/history")
async def alert_history(rule_id: Optional[int] = None, org=Depends(get_current_org)):
    return {"history": get_alert_history(org.id, rule_id=rule_id)}


@router.get("/alerts/unseen-count")
async def unseen_count(org=Depends(get_current_org)):
    """Return count of alert history rows not yet seen by the user."""
    return {"count": get_unseen_alert_count(org.id)}


@router.post("/alerts/history/mark-seen")
async def mark_seen(org=Depends(get_current_org)):
    """Mark all unseen alert history rows as seen."""
    updated = mark_alerts_seen(org.id)
    return {"status": "ok", "marked": updated}


@router.patch("/alerts/{rule_id}")
async def update_alert(rule_id: int, request: AlertRuleRequest, org=Depends(get_current_org),
                       user=Depends(require_permission("MANAGE_ALERTS"))):
    rule = get_alert_rule(rule_id, org.id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    update_alert_rule(rule_id, org.id, request.model_dump(exclude_unset=True))
    return {"status": "success", "alert": get_alert_rule(rule_id, org.id)}


@router.delete("/alerts/{rule_id}")
async def remove_alert(rule_id: int, org=Depends(get_current_org),
                       user=Depends(require_permission("MANAGE_ALERTS"))):
    if not get_alert_rule(rule_id, org.id):
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    delete_alert_rule(rule_id, org.id)
    return {"status": "success"}


@router.post("/alerts/{rule_id}/toggle")
async def toggle_alert(rule_id: int, org=Depends(get_current_org),
                       user=Depends(require_permission("MANAGE_ALERTS"))):
    rule = get_alert_rule(rule_id, org.id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    update_alert_rule(rule_id, org.id, {"is_active": 0 if rule["is_active"] else 1})
    return {"status": "success", "is_active": not rule["is_active"]}


@router.post("/alerts/{rule_id}/test")
async def test_alert(rule_id: int, org=Depends(get_current_org),
                     user=Depends(require_permission("MANAGE_ALERTS"))):
    """Manually trigger evaluation of one rule right now (ignores cooldown)."""
    rule     = get_alert_rule(rule_id, org.id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    try:
        if rule.get("alert_type") == "freshness":
            triggered, val, msg = _evaluate_freshness_rule({**rule, "org_id": org.id})
        else:
            triggered, val, msg = _evaluate_metric_rule(rule, conn_str)
        return {"triggered": triggered, "current_value": val, "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
