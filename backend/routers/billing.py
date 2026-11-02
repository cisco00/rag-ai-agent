"""
routers/billing.py — Organizational token usage and billing analytics.

Data source priority:
  1. Native usage_tracker (always available — stored in admin DB)
  2. Langfuse API (optional — enriches data when keys are configured)

The page always shows real data; Langfuse is an optional enhancement.
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


@router.get("/ping")
async def ping_billing():
    """Diagnostic endpoint to verify billing router is online."""
    return {"status": "ok", "message": "Billing router is active"}


@router.get("/usage")
async def get_org_usage(org=Depends(get_current_org), user=Depends(require_permission("MANAGE_ORG"))):
    """
    Return token usage and cost data for the organization.

    Native tracker data is returned immediately; Langfuse is merged on top
    when keys are configured (adds external cost calculations).
    """
    # ── Step 1: Always fetch native tracker data ─────────────────────────────
    try:
        from usage_tracker import get_usage_summary
        native = get_usage_summary(org.id, days=30)
    except Exception as e:
        logger.error(f"[Billing] Native tracker failed: {e}", exc_info=True)
        native = _empty_usage_structure(org.id)

    # If the native tracker already has data, we return success regardless of
    # whether Langfuse is configured.
    has_native_data = native["totals"]["total_queries"] > 0

    # ── Step 2: Optionally enrich with Langfuse ──────────────────────────────
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "http://localhost:3000").rstrip("/")
    langfuse_active = bool(public_key and secret_key)

    langfuse_totals = None
    if langfuse_active:
        try:
            langfuse_totals = await _fetch_langfuse_usage(org.id, public_key, secret_key, host)
        except Exception as e:
            logger.warning(f"[Billing] Langfuse fetch failed (non-fatal): {e}")

    # ── Step 3: Merge and return ─────────────────────────────────────────────
    if langfuse_totals:
        # Prefer Langfuse cost calculations (more precise) but keep native query counts
        result = native.copy()
        result["pricing_model"] = "langfuse_native_or_fallback_0.001"
        # Merge daily trend costs from Langfuse where available
        lf_by_date = {d["date"]: d for d in langfuse_totals.get("daily_trend", [])}
        merged_trend = []
        for day in native["daily_trend"]:
            lf_day = lf_by_date.get(day["date"])
            if lf_day and lf_day["cost"] > 0:
                day = day.copy()
                day["cost"] = lf_day["cost"]
            merged_trend.append(day)
        result["daily_trend"] = merged_trend
        if langfuse_totals["totals"]["estimated_cost_usd"] > 0:
            result["totals"]["estimated_cost_usd"] = langfuse_totals["totals"]["estimated_cost_usd"]
        result["status"] = "success"
        return result

    # Native-only response
    result = native.copy()
    result["status"] = "success"
    return result


# ---------------------------------------------------------------------------
# Langfuse helper (unchanged logic from original, extracted to helper)
# ---------------------------------------------------------------------------

async def _fetch_langfuse_usage(org_id: int, public_key: str, secret_key: str, host: str) -> Dict[str, Any]:
    """Fetch usage data from Langfuse API. Returns None-shaped dict on failure."""
    org_tag = f"org:{org_id}"
    now = datetime.utcnow()
    thirty_days_ago = now - timedelta(days=30)

    total_prompt_tokens    = 0
    total_completion_tokens = 0
    total_queries          = 0
    total_cost             = 0.0
    daily_usage: Dict[str, Dict[str, Any]] = {}

    for i in range(30):
        d = (now - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        daily_usage[d] = {"date": d, "queries": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0}

    auth_string = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()

    async with httpx.AsyncClient() as client:
        page = 1
        has_more = True
        while has_more and page <= 5:
            url = f"{host}/api/public/observations?type=GENERATION&tags={org_tag}&page={page}&limit=100"
            response = await client.get(
                url,
                headers={"Authorization": f"Basic {auth_string}", "Content-Type": "application/json"},
                timeout=5.0,
            )
            if response.status_code != 200:
                logger.warning(f"[Billing] Langfuse API {response.status_code} for page {page}")
                break
            data = response.json()
            observations = data.get("data", [])
            if not observations:
                break

            for obs in observations:
                created_at_str = obs.get("createdAt")
                if not created_at_str:
                    continue
                try:
                    obs_date = datetime.fromisoformat(created_at_str.replace("Z", "+00:00")).replace(tzinfo=None)
                except Exception:
                    obs_date = now
                if obs_date < thirty_days_ago:
                    continue
                day_key = obs_date.strftime("%Y-%m-%d")
                if day_key not in daily_usage:
                    daily_usage[day_key] = {"date": day_key, "queries": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0}

                usage_obj = obs.get("usage", {}) or {}
                p_tokens = usage_obj.get("promptTokens", 0)
                c_tokens = usage_obj.get("completionTokens", 0)
                obs_cost = obs.get("calculatedTotalCost") or (p_tokens + c_tokens) * 0.001

                total_prompt_tokens    += p_tokens
                total_completion_tokens += c_tokens
                total_cost             += obs_cost
                total_queries          += 1

                daily_usage[day_key]["queries"]           += 1
                daily_usage[day_key]["prompt_tokens"]     += p_tokens
                daily_usage[day_key]["completion_tokens"] += c_tokens
                daily_usage[day_key]["cost"]              += obs_cost

            meta = data.get("meta", {})
            if page >= meta.get("totalPages", 1):
                has_more = False
            else:
                page += 1

    return {
        "totals": {
            "prompt_tokens":      total_prompt_tokens,
            "completion_tokens":  total_completion_tokens,
            "total_tokens":       total_prompt_tokens + total_completion_tokens,
            "total_queries":      total_queries,
            "estimated_cost_usd": round(total_cost, 4),
        },
        "daily_trend": [daily_usage[k] for k in sorted(daily_usage.keys())],
    }


def _empty_usage_structure(org_id: int) -> Dict[str, Any]:
    """Return a zeroed-out usage dict (matches expected response shape)."""
    now = datetime.utcnow()
    daily_trend = [
        {"date": (now - timedelta(days=29 - i)).strftime("%Y-%m-%d"),
         "queries": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0}
        for i in range(30)
    ]
    return {
        "status": "success",
        "org_id": org_id,
        "timeframe_days": 30,
        "totals": {
            "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "total_queries": 0, "estimated_cost_usd": 0.0,
        },
        "daily_trend": daily_trend,
        "pricing_model": "native_tracker",
    }
