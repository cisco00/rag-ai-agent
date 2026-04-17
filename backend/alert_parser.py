"""
alert_parser.py — Natural language → alert rule parser for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Fixes applied
─────────────
Bug #20 — Operator semantics in _SYSTEM_PROMPT corrected to match alerts.py
           evaluator (after Bug #3 fix):
             pct_change_gt → value INCREASED/GREW  by more than X%
             pct_change_lt → value DROPPED/FELL     by more than X%
           Previously the prompt defined pct_change_lt as "grows more than X%"
           but the evaluator checked for drops, so growth alerts never fired.
"""

import json
import os
import re
from typing import Optional

from logging_config import get_logger

logger = get_logger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

VALID_OPERATORS   = (">", "<", ">=", "<=", "==", "!=", "pct_change_gt", "pct_change_lt")
VALID_AGGREGATES  = ("count", "sum", "avg", "min", "max")
VALID_ALERT_TYPES = ("metric", "freshness")

_AGG_ALIASES = {
    "number of": "count", "total number": "count", "count of": "count",
    "total": "sum", "sum of": "sum",
    "average": "avg", "mean": "avg", "avg": "avg",
    "minimum": "min", "min": "min", "lowest": "min",
    "maximum": "max", "max": "max", "highest": "max",
}

# ─── Exceptions ───────────────────────────────────────────────────────────────

class AlertParseError(Exception):
    """Raised when the LLM response cannot be parsed into a valid alert rule."""
    pass


# ─── Schema helpers ───────────────────────────────────────────────────────────

def _build_schema_context(conn_str: str) -> str:
    from database import DatabaseManager
    dm = DatabaseManager(connection_string=conn_str)
    try:
        tables = dm.list_tables()
        if not tables:
            return "(no tables found in database)"

        lines = []
        for table in tables[:30]:
            lines.append(f"TABLE: {table}")
            try:
                cols = dm.describe_table(table)
                for col_name, col_type in cols[:40]:
                    lines.append(f"  - {col_name} ({col_type})")
            except Exception:
                lines.append("  (could not describe table)")
        return "\n".join(lines)
    finally:
        dm.close()


# ─── Prompt ───────────────────────────────────────────────────────────────────

# Fix #20: pct_change_gt = increases/grows, pct_change_lt = drops/falls
_SYSTEM_PROMPT = """System Instruction: Alert Configuration Engine v2.1 (Production Hardened)

You are an alert configuration engine for a data analytics platform.

Your task is to convert a user’s natural language request into a fully specified alert configuration JSON using the provided database schema.

You MUST be precise, conservative, and deterministic.
When uncertain, degrade confidence and declare assumptions — never guess silently.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT OUTPUT CONTRACT (NO DEVIATIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Output MUST be valid JSON
- No markdown, no comments, no explanation outside JSON
- All fields MUST be present
- Do NOT invent fields

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "alert_type": "metric" | "freshness",
  "table_name": "<exact schema table>",
  "column_name": "<exact schema column or null>",
  "time_column": "<exact time column>",
  "aggregate": "count" | "sum" | "avg" | "min" | "max",
  "operator": ">" | "<" | ">=" | "<=" | "==" | "!=" | "pct_change_gt" | "pct_change_lt" | "stale_hours",
  "threshold_value": <number>,
  "lookback_hours": <integer>,
  "evaluation_frequency": "hourly" | "daily",
  "name": "<≤60 chars>",
  "explanation": "<1 sentence>",
  "warnings": ["<0 or more items>"],
  "ambiguous": true | false,
  "ambiguous_reason": "<string or null>",
  "confidence_score": <0–100 integer>
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION PRINCIPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NEVER GUESS SILENTLY
If mapping is uncertain:
- set ambiguous = true
- include assumption in warnings
- reduce confidence_score

2. PREFER SAFE OVER SMART
- Choose simpler, defensible interpretation
- Avoid complex inferred metrics unless explicit

3. FAIL GRACEFULLY
If request cannot be reliably mapped:
- still return JSON
- mark ambiguous = true
- explain limitation clearly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHEMA MAPPING LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1 — Candidate Selection
- Match semantic meaning
- Match data type (numeric for metrics, timestamp for time)

Step 2 — Ranking
Prioritize:
1. Exact semantic match
2. Tables with numeric + time column
3. Event tables over static tables
4. Aggregatable columns (amount, total, price)

Step 3 — Tie Handling
- Choose best match
- Add warning: "Multiple candidate tables/columns — selected X"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIME COLUMN RULE (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every metric alert MUST include a valid time column.

Priority:
- created_at
- timestamp
- event_time
- date

If none exist:
- ambiguous = true
- ambiguous_reason = "No valid time column found"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPERATOR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Percentage Change:
- "increase", "rise", "grow" → pct_change_gt
- "drop", "fall", "decrease" → pct_change_lt
- threshold_value is always positive

Window logic:
- recent_window = last N hours
- previous_window = N hours before that

Comparison:
- above / over / exceeds → >
- below / under → <
- at least → >=
- at most → <=

Freshness:
- alert_type = "freshness"
- operator = "stale_hours"
- column_name = null
- threshold_value = hours since last update
- Freshness = NOW() - MAX(time_column)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGGREGATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- users, orders, signups → count
- revenue, sales, cost → sum
- "average", "mean" → avg

Fallback:
- event tables → count
- numeric columns → avg

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOOKBACK RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- last hour → 1
- today / daily → 24
- weekly → 168
- last N hours → N
- last N minutes → round to nearest hour (min 1)
- missing → default = 24

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION FREQUENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- lookback ≤ 6 → hourly
- lookback > 6 → daily

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNIT NORMALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- k → ×1,000
- m / million → ×1,000,000
- % handled via pct_change

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SANITY FILTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If alert is weak or trivial:
- add warning (e.g., "Threshold may be too low to be actionable")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AMBIGUITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Set ambiguous = true if:
- table unclear
- column inferred
- time column missing
- request vague or conflicting

If ambiguous:
- explanation MUST include "Assuming..."
- ambiguous_reason MUST be explicit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIDENCE SCORING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start at 90

Subtract:
- ambiguous → -30
- guessed column → -15
- multiple candidates → -10
- weak semantic match → -10
- missing time clarity → -15

Clamp between 0–100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAME RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Format:
"[Metric] [Condition] [Window]"

Examples:
- "Revenue Drop >20% (24h)"
- "Orders Above 500 (1h)"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPLANATION RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- One sentence only
- Clearly describe trigger logic
- If ambiguous → must include "Assuming..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL VALIDATION (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before output:
- JSON is valid
- No missing fields
- Correct data types
- time_column present for metric alerts
- operator matches alert_type
- confidence_score is integer
- ambiguous_reason is null if ambiguous=false
"""

_USER_TEMPLATE = """DATABASE SCHEMA:
{schema}

USER REQUEST:
"{text}"

Parse this into an alert rule JSON object. Use only table/column names that exist in the schema above."""


# ─── LLM call ─────────────────────────────────────────────────────────────────

def _call_llm(prompt_text: str, schema_context: str) -> str:
    from config import get_config
    from llm_client import get_llm_client

    cfg    = get_config()
    client = get_llm_client(cfg.agent.model_provider, cfg.agent)
    model  = cfg.agent.model_name

    messages = [
        {"role": "system",  "content": _SYSTEM_PROMPT},
        {"role": "user",    "content": _USER_TEMPLATE.format(
            schema=schema_context,
            text=prompt_text,
        )},
    ]

    response = client.chat_completion(
        model=model,
        messages=messages,
        tools=None,
        max_tokens=512,
    )
    return response.choices[0].message.content or ""


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate_parsed(parsed: dict, schema_context: str) -> list[str]:
    errors = []

    alert_type = parsed.get("alert_type")
    if alert_type not in VALID_ALERT_TYPES:
        errors.append(f"Invalid alert_type: {alert_type!r}")

    if alert_type == "metric":
        if not parsed.get("table_name"):
            errors.append("table_name is required for metric alerts")
        if not parsed.get("column_name"):
            errors.append("column_name is required for metric alerts")
        op = parsed.get("operator")
        if op not in VALID_OPERATORS:
            errors.append(f"Invalid operator: {op!r}")
        agg = parsed.get("aggregate")
        if agg not in VALID_AGGREGATES:
            errors.append(f"Invalid aggregate: {agg!r}")

    if alert_type == "freshness":
        if not parsed.get("table_name"):
            errors.append("table_name is required for freshness alerts")

    if parsed.get("threshold_value") is None:
        errors.append("threshold_value is required")
    else:
        try:
            float(parsed["threshold_value"])
        except (TypeError, ValueError):
            errors.append(f"threshold_value must be a number, got: {parsed['threshold_value']!r}")

    lh = parsed.get("lookback_hours")
    if lh is not None:
        try:
            assert int(lh) >= 1
        except Exception:
            errors.append(f"lookback_hours must be a positive integer, got: {lh!r}")

    if parsed.get("table_name"):
        table_line = f"TABLE: {parsed['table_name']}"
        if table_line not in schema_context:
            errors.append(
                f"Table '{parsed['table_name']}' not found in schema. "
                "LLM may have hallucinated a table name."
            )

    return errors


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise AlertParseError(f"Could not extract valid JSON from LLM response: {raw[:300]!r}")


# ─── Main public interface ────────────────────────────────────────────────────

async def parse_alert_from_text(
    text: str,
    conn_str: str,
    org_id: int,
    created_by: Optional[int] = None,
    notify_email: Optional[str] = None,
    notify_webhook: Optional[str] = None,
    cooldown_minutes: int = 60,
    max_retries: int = 2,
) -> dict:
    if not text or not text.strip():
        raise AlertParseError("Alert description cannot be empty.")

    text = text.strip()
    logger.info(f"[AlertParser] Parsing alert for org {org_id}: {text!r}")

    from fastapi.concurrency import run_in_threadpool
    try:
        schema_context = await run_in_threadpool(_build_schema_context, conn_str)
    except Exception as exc:
        logger.error(f"[AlertParser] Schema fetch failed: {exc}")
        raise AlertParseError(f"Could not read database schema: {exc}") from exc

    logger.debug(f"[AlertParser] Schema context ({len(schema_context)} chars)")

    last_error          = None
    validation_feedback = ""

    for attempt in range(1, max_retries + 2):
        try:
            prompt = text
            if validation_feedback:
                prompt = (
                    f"{text}\n\n"
                    f"[Previous attempt had these errors, please fix them: {validation_feedback}]"
                )

            raw    = await run_in_threadpool(_call_llm, prompt, schema_context)
            logger.debug(f"[AlertParser] LLM raw response (attempt {attempt}): {raw[:500]}")

            parsed = _extract_json(raw)
            errors = _validate_parsed(parsed, schema_context)

            if errors:
                validation_feedback = "; ".join(errors)
                last_error = AlertParseError(
                    f"Validation failed (attempt {attempt}): {validation_feedback}"
                )
                logger.warning(f"[AlertParser] {last_error}")
                if attempt <= max_retries:
                    continue
                raise last_error

            alert_type = parsed["alert_type"]
            operator   = parsed["operator"] if alert_type == "metric" else "stale_hours"

            rule = {
                "name":             parsed.get("name") or text[:60],
                "alert_type":       alert_type,
                "table_name":       parsed.get("table_name"),
                "column_name":      parsed.get("column_name") if alert_type == "metric" else None,
                "aggregate":        parsed.get("aggregate", "avg") if alert_type == "metric" else None,
                "operator":         operator,
                "threshold_value":  float(parsed["threshold_value"]),
                "lookback_hours":   int(parsed.get("lookback_hours") or 24),
                "notify_email":     notify_email,
                "notify_webhook":   notify_webhook,
                "cooldown_minutes": cooldown_minutes,
                "created_by":       created_by,
            }

            explanation      = parsed.get("explanation", "")
            warnings         = parsed.get("warnings", []) or []
            ambiguous        = bool(parsed.get("ambiguous", False))
            ambiguous_reason = parsed.get("ambiguous_reason")

            if ambiguous and ambiguous_reason:
                warnings.insert(0, f"Ambiguous: {ambiguous_reason}")

            logger.info(
                f"[AlertParser] Parsed successfully: "
                f"type={alert_type} table={rule['table_name']} "
                f"col={rule['column_name']} op={operator} "
                f"threshold={rule['threshold_value']} lookback={rule['lookback_hours']}h"
            )

            return {
                "rule":        rule,
                "explanation": explanation,
                "warnings":    warnings,
                "ambiguous":   ambiguous,
            }

        except AlertParseError:
            raise
        except Exception as exc:
            last_error = AlertParseError(f"LLM call failed on attempt {attempt}: {exc}")
            logger.error(f"[AlertParser] {last_error}", exc_info=True)
            if attempt <= max_retries:
                continue
            raise last_error

    raise last_error or AlertParseError("Parsing failed for unknown reason")
