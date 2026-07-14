"""
routers/billing.py — Organizational token usage and billing analytics.
"""

import logging
import os
import httpx
import json
import base64
from datetime import datetime, timedelta
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from dependencies import get_current_org, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()

# Pricing fallback
FALLBACK_PRICE_PER_TOKEN = 0.001

@router.get("/ping")
async def ping_billing():
    """Diagnostic endpoint to verify billing router is online."""
    return {"status": "ok", "message": "Billing router is active"}

@router.get("/usage")
async def get_org_usage(org=Depends(get_current_org), user=Depends(require_permission("MANAGE_ORG"))):
    """
    Fetch Langfuse telemetry data tagged with this organization's ID to calculate usage and costs.
    """
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "http://localhost:3000").rstrip("/")
    
    logger.info(f"[Billing] Fetching usage for org {org.id}. Langfuse host: {host}")
    
    if not public_key or not secret_key:
        return _build_mock_or_empty_response(org.id, "Langfuse observability keys not configured.")

    org_tag = f"org:{org.id}"
    
    # Calculate timestamps for the last 30 days
    now = datetime.utcnow()
    thirty_days_ago = now - timedelta(days=30)
    
    # Initialize counts
    total_prompt_tokens = 0
    total_completion_tokens = 0
    total_queries = 0
    total_cost = 0.0
    daily_usage: Dict[str, Dict[str, Any]] = {}
    
    # Initialize last 30 days in daily_usage to ensure continuous chart data
    for i in range(30):
        d = (now - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        daily_usage[d] = {
            "date": d,
            "queries": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost": 0.0
        }

    try:
        # We query Langfuse Observations API for Generations tagged with this org_id
        # Using HTTP Basic Auth
        auth_string = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
        
        logger.debug(f"[Billing] Initializing HTTP client for Langfuse observations. Org tag: {org_tag}")
        async with httpx.AsyncClient() as client:
            # We fetch up to 1000 recent generations (pagination handled simply for MVP)
            page = 1
            has_more = True
            
            while has_more and page <= 5: # Limit to 5000 recent observations to prevent timeouts
                url = f"{host}/api/public/observations?type=GENERATION&tags={org_tag}&page={page}&limit=100"
                response = await client.get(
                    url,
                    headers={
                        "Authorization": f"Basic {auth_string}",
                        "Content-Type": "application/json"
                    },
                    timeout=5.0
                )
                
                logger.debug(f"[Billing] Langfuse response: {response.status_code} for page {page}")
                
                if response.status_code != 200:
                    logger.error(f"[Billing] Langfuse API error ({response.status_code}): {response.text}")
                    break
                    
                data = response.json()
                observations = data.get("data", [])
                
                if not observations:
                    break
                
                for obs in observations:
                    # Filter by date manually just in case
                    created_at_str = obs.get("createdAt")
                    if not created_at_str:
                        continue
                        
                    # Handle ISO string Z or offset
                    try:
                        obs_date = datetime.fromisoformat(created_at_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    except Exception:
                        obs_date = now # Fallback
                        
                    if obs_date < thirty_days_ago:
                        continue
                        
                    day_key = obs_date.strftime("%Y-%m-%d")
                    if day_key not in daily_usage:
                        # Should exist from initialization, but just in case
                        daily_usage[day_key] = {"date": day_key, "queries": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0}
                        
                    usage_obj = obs.get("usage", {}) or {}
                    
                    p_tokens = usage_obj.get("promptTokens", 0)
                    c_tokens = usage_obj.get("completionTokens", 0)
                    
                    # Cost logic: use Langfuse calculated cost if > 0, else fallback
                    obs_cost = obs.get("calculatedTotalCost")
                    if obs_cost is None or obs_cost == 0:
                        obs_cost = (p_tokens + c_tokens) * FALLBACK_PRICE_PER_TOKEN
                        
                    total_prompt_tokens += p_tokens
                    total_completion_tokens += c_tokens
                    total_cost += obs_cost
                    total_queries += 1
                    
                    daily_usage[day_key]["queries"] += 1
                    daily_usage[day_key]["prompt_tokens"] += p_tokens
                    daily_usage[day_key]["completion_tokens"] += c_tokens
                    daily_usage[day_key]["cost"] += obs_cost
                    
                meta = data.get("meta", {})
                if page >= meta.get("totalPages", 1):
                    has_more = False
                else:
                    page += 1
                    
    except Exception as e:
        logger.error(f"Error fetching Langfuse billing data: {e}", exc_info=True)
        # Continuing to return empty stats rather than crash the admin panel
    
    # Convert daily usage dict to sorted list
    daily_trend = [daily_usage[k] for k in sorted(daily_usage.keys())]

    return {
        "status": "success",
        "org_id": org.id,
        "timeframe_days": 30,
        "totals": {
            "prompt_tokens": total_prompt_tokens,
            "completion_tokens": total_completion_tokens,
            "total_tokens": total_prompt_tokens + total_completion_tokens,
            "total_queries": total_queries,
            "estimated_cost_usd": round(total_cost, 4)
        },
        "daily_trend": daily_trend,
        "pricing_model": "langfuse_native_or_fallback_0.001"
    }


def _build_mock_or_empty_response(org_id: int, message: str):
    """Returns empty zeroed-out stats when telemetry is disabled."""
    now = datetime.utcnow()
    daily_trend = []
    for i in range(30):
        d = (now - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        daily_trend.append({
            "date": d,
            "queries": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost": 0.0
        })
        
    return {
        "status": "partial",
        "message": message,
        "org_id": org_id,
        "timeframe_days": 30,
        "totals": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "total_queries": 0,
            "estimated_cost_usd": 0.0
        },
        "daily_trend": daily_trend,
        "pricing_model": "none"
    }
