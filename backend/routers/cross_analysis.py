"""
routers/cross_analysis.py — Cross-Analytical Intelligence

Human-in-the-loop design:
  Phase 1  POST /analytics/cross-analysis/propose
    Given 2-4 completed analysis summaries, ask the LLM to generate
    3-5 hypothesis cards connecting them.  Every card must cite a
    specific number from at least two distinct analyses; any card that
    fails that check is dropped server-side before the user ever sees it.

  Phase 2  (frontend)
    User votes on each card: Accept / Uncertain / Reject.
    Only accepted cards move on.

  Phase 3  POST /analytics/cross-analysis/synthesize
    Takes the accepted cards only.  Produces a final narrative that is
    strictly forbidden from introducing any new connection not stated in
    the accepted cards.
"""

import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from dependencies import get_current_org

logger = logging.getLogger(__name__)
router = APIRouter()


# ── LLM helpers (re-uses the same client pattern as analytics_interpret) ──────

def _get_llm_client():
    try:
        import openai
        api_key = (
            os.environ.get("OPENAI_API_KEY") or
            os.environ.get("ANTHROPIC_API_KEY") or
            os.environ.get("LLM_API_KEY", "")
        )
        base_url = os.environ.get("LLM_BASE_URL") or None
        return openai.OpenAI(api_key=api_key, base_url=base_url) if base_url \
               else openai.OpenAI(api_key=api_key)
    except ImportError:
        return None


def _call_llm(messages: list, temperature: float = 0.3, max_tokens: int = 2000) -> str:
    client = _get_llm_client()
    if client is None:
        raise RuntimeError("LLM library not available. Install openai.")
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content.strip()


def _get_org_context(org) -> tuple:
    org_name = getattr(org, "name", None) or "this organization"
    industry = "unknown industry"
    profile: dict = {}
    try:
        from routers.business_profile import OrgBusinessProfile, _ensure_table
        from models import admin_engine
        from sqlalchemy.orm import Session
        _ensure_table(admin_engine)
        with Session(admin_engine) as db:
            rec = db.query(OrgBusinessProfile).filter(
                OrgBusinessProfile.org_id == org.id
            ).first()
            if rec:
                profile = json.loads(rec.profile_json or "{}")
    except Exception:
        pass
    if profile.get("industry"):
        industry = profile["industry"]
    return org_name, industry, profile


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class AnalysisSummary(BaseModel):
    type: str            # "regression" | "forecast" | "cluster" etc.
    label: str           # human-readable label shown in the UI
    stats: Dict[str, Any]  # the computed stats dict


class ProposeRequest(BaseModel):
    analyses: List[AnalysisSummary]   # 2-4 completed analyses


class ConfirmedHypothesis(BaseModel):
    id: str
    claim: str
    evidence_a: str
    evidence_b: str
    analyses_referenced: List[str]
    confidence: str


class SynthesizeRequest(BaseModel):
    confirmed: List[ConfirmedHypothesis]
    analyses: List[AnalysisSummary]   # original analyses (for context)


# ── Helpers ───────────────────────────────────────────────────────────────────

_NUMBER_RE = re.compile(r'\b\d[\d.,]*%?\b')

def _has_numeric_evidence(text: str) -> bool:
    """Return True if the text contains at least one number."""
    return bool(_NUMBER_RE.search(text))

def _filter_hypotheses(raw: list) -> list:
    """
    Server-side guard: drop any hypothesis that
      • doesn't reference at least 2 distinct analyses
      • doesn't have a numeric citation in its evidence fields
    """
    out = []
    for h in raw:
        refs = h.get("analyses_referenced", [])
        ev_a = h.get("evidence_a", "")
        ev_b = h.get("evidence_b", "")
        if (
            len(set(refs)) >= 2
            and _has_numeric_evidence(ev_a)
            and _has_numeric_evidence(ev_b)
        ):
            h["id"] = str(uuid.uuid4())
            out.append(h)
    return out[:5]   # hard cap at 5


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/analytics/cross-analysis/propose")
async def propose_hypotheses(
    body: ProposeRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Phase 1: generate candidate connection hypotheses from 2-4 analyses.
    Returns hypothesis cards for the user to vote on.
    """
    if len(body.analyses) < 2:
        raise HTTPException(422, "Select at least 2 analyses to find connections.")
    if len(body.analyses) > 4:
        raise HTTPException(422, "Select at most 4 analyses at a time.")

    org_name, industry, profile = _get_org_context(org)

    # Build the analysis block for the prompt
    analyses_block = ""
    for a in body.analyses:
        analyses_block += f"\n--- {a.label} ({a.type}) ---\n"
        analyses_block += json.dumps(a.stats, indent=2, default=str)[:800]
        analyses_block += "\n"

    system_prompt = f"""You are a senior data scientist at {org_name} ({industry}).
You have just finished {len(body.analyses)} separate analyses.
Your task is to identify genuine connections between them — not to explain each one individually.

RULES (non-negotiable):
1. Generate between 3 and 5 hypothesis cards. No more, no fewer.
2. Every card must reference at least 2 different analyses by their exact label.
3. Every evidence field MUST contain at least one specific number from the analysis results.
   Do NOT make up numbers. Use only values from the data provided below.
4. Confidence must be "Low", "Medium", or "High". Be conservative.
5. Do not state causation — only association or patterns worth investigating.
6. If you cannot find 3 genuine numeric cross-connections, return fewer cards rather than inventing them.

Respond ONLY with valid JSON — an array of hypothesis objects:
[
  {{
    "claim": "One or two sentences stating the cross-analysis connection.",
    "evidence_a": "Specific evidence from analysis A with a cited number.",
    "evidence_b": "Specific evidence from analysis B with a cited number.",
    "analyses_referenced": ["<exact label A>", "<exact label B>"],
    "confidence": "Low|Medium|High",
    "confidence_reason": "One sentence explaining why you rated it this confidence level."
  }}
]"""

    user_msg = f"Here are the analysis results to connect:\n{analyses_block}"

    try:
        raw_text = _call_llm(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": user_msg}],
            temperature=0.2,
            max_tokens=2200,
        )
        # Extract JSON array from response
        match = re.search(r'\[.*\]', raw_text, re.DOTALL)
        if not match:
            raise ValueError("No JSON array found in LLM response")
        raw_hypotheses = json.loads(match.group())
    except Exception as exc:
        logger.warning("Cross-analysis propose failed: %s", exc)
        raise HTTPException(500, f"Failed to generate hypotheses: {exc}")

    hypotheses = _filter_hypotheses(raw_hypotheses)

    if not hypotheses:
        raise HTTPException(422,
            "Could not find numeric cross-analysis connections in these results. "
            "Try selecting analyses with more overlapping metrics.")

    return {
        "hypotheses": hypotheses,
        "analyses_count": len(body.analyses),
        "note": (
            f"{len(raw_hypotheses)} candidate connections generated; "
            f"{len(hypotheses)} passed the evidence check."
        ),
    }


@router.post("/analytics/cross-analysis/synthesize")
async def synthesize_confirmed(
    body: SynthesizeRequest,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """
    Phase 3: synthesise ONLY the user-confirmed hypotheses into a final narrative.
    Strictly forbidden from introducing any new connection.
    """
    if not body.confirmed:
        raise HTTPException(422, "No confirmed hypotheses to synthesize.")

    org_name, industry, profile = _get_org_context(org)

    confirmed_block = ""
    for i, h in enumerate(body.confirmed, 1):
        confirmed_block += (
            f"\nHYPOTHESIS {i} (confidence: {h.confidence})\n"
            f"Claim: {h.claim}\n"
            f"Evidence A: {h.evidence_a}\n"
            f"Evidence B: {h.evidence_b}\n"
            f"Analyses: {', '.join(h.analyses_referenced)}\n"
        )

    system_prompt = f"""You are writing a cross-analysis summary for {org_name} ({industry}).

You have been given {len(body.confirmed)} hypothesis card(s) that a human analyst has
reviewed and accepted. Your job is to weave them into a coherent narrative.

STRICT RULES:
1. Do NOT introduce any connection, pattern, or insight not explicitly stated in the
   confirmed hypotheses below. Zero new claims.
2. Do NOT invent numbers beyond what appears in the evidence fields.
3. Use hedging language: "this suggests", "the data points to", "may indicate" — never
   "proves", "confirms", "clearly shows".
4. End with a caveats section listing 2-3 things to validate before acting.

Respond ONLY with valid JSON:
{{
  "headline": "One sentence summary (max 20 words).",
  "narrative": "2-4 paragraph synthesis. Only from confirmed hypotheses.",
  "action_threads": ["Suggested next investigative step 1", "Step 2"],
  "caveats": ["Caveat 1", "Caveat 2", "Caveat 3"]
}}"""

    user_msg = f"Confirmed hypotheses to synthesize:\n{confirmed_block}"

    try:
        raw_text = _call_llm(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": user_msg}],
            temperature=0.3,
            max_tokens=1600,
        )
        match = re.search(r'\{.*\}', raw_text, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found in LLM response")
        result = json.loads(match.group())
    except Exception as exc:
        logger.warning("Cross-analysis synthesize failed: %s", exc)
        raise HTTPException(500, f"Failed to synthesize: {exc}")

    return {
        **result,
        "confirmed_count": len(body.confirmed),
        "analyses_used": list({a for h in body.confirmed for a in h.analyses_referenced}),
    }
