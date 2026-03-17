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
_SYSTEM_PROMPT = """You are an alert configuration assistant for a data analytics platform.
Your job is to parse a natural-language alert request into a structured JSON object.

You have access to the user's database schema to map vague terms to real table/column names.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no explanation:
{
  "alert_type":      "metric" | "freshness",
  "table_name":      "<exact table name from schema>",
  "column_name":     "<exact column name from schema, or null for freshness alerts>",
  "aggregate":       "count" | "sum" | "avg" | "min" | "max",
  "operator":        ">" | "<" | ">=" | "<=" | "==" | "!=" | "pct_change_gt" | "pct_change_lt",
  "threshold_value": <number>,
  "lookback_hours":  <integer, how many hours of data to aggregate over>,
  "name":            "<short human-readable name for this alert, max 60 chars>",
  "explanation":     "<one sentence: restate what the alert will do in plain English>",
  "warnings":        ["<any assumption you made that the user should know about>"],
  "ambiguous":       true | false,
  "ambiguous_reason": "<why it's ambiguous, or null>"
}

OPERATOR RULES:
- Use "pct_change_gt" when the user says "increases by more than X%", "grows more than X%",
  "rises by X%", "goes up by X%", "jumped more than X%"
  threshold_value = the positive percentage number (e.g. 20 for "20%")
  This triggers when: (recent_value - previous_value) / previous_value * 100 > threshold

- Use "pct_change_lt" when the user says "drops more than X%", "falls by more than X%",
  "decreases by X%", "declined more than X%", "down more than X%"
  threshold_value = the positive percentage number (e.g. 20 for "20%")
  This triggers when: (recent_value - previous_value) / previous_value * 100 < -threshold
  (i.e. a negative change whose magnitude exceeds the threshold)

- Use "<" when the user says "falls below", "goes under", "drops to below", "less than"
- Use ">" when the user says "exceeds", "goes above", "more than", "over"
- Use "stale_hours" as operator (with alert_type="freshness") when the user mentions
  data not being updated

AGGREGATE RULES:
- "signups", "registrations", "new users", "orders placed" → count
- "revenue", "sales", "amount", "spend", "cost" → sum (unless "average" is mentioned)
- "average X", "mean X", "avg X" → avg
- When in doubt for event tables, prefer "count"
- When in doubt for value tables (revenue, price, score), prefer "avg"

LOOKBACK RULES:
- "daily" / "today" / "per day" → 24
- "hourly" / "in the last hour" → 1
- "weekly" / "this week" → 168
- "in the last N hours" → N
- "in the last N minutes" → round to nearest hour (minimum 1)
- No time window mentioned → 24 (default to daily)

FRESHNESS ALERTS:
- alert_type = "freshness", operator = "stale_hours"
- column_name = null
- threshold_value = number of hours before triggering
- "hasn't been updated in 6 hours" → threshold_value = 6
- "stale for more than a day" → threshold_value = 24

AMBIGUOUS = true if:
- You cannot identify the table with reasonable confidence
- The column doesn't exist in the schema and you had to guess
- The request is contradictory or too vague to produce a useful alert

Always pick the most semantically appropriate table and column from the schema.
Prefer columns with names like "created_at", "timestamp", "date" for time-based counting.
Prefer numeric columns for value-based aggregates.
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
