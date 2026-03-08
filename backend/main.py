"""
Analytics Agent module for the RAG AI Agent.

New in this version
───────────────────
1. Multi-table JOIN support
   • Two new tools: get_foreign_keys / get_join_schema  (see tools.py)
   • Expanded system prompt teaches the agent the FK-first JOIN workflow

2. Session Memory  (SessionMemory class)
   • Stores a compressed summary of every query + result in the session
   • Injected into the system prompt so the agent can answer follow-ups like
     "now filter that by region" without rediscovering data

3. Confidence Scores  (ConfidenceScorer class)
   • Rule-based scoring (0–100%) runs after every query — no extra LLM call
   • Considers: schema verification, error retries, query complexity, iterations
   • Returned in the API response as  confidence  and  confidence_reasoning
   • Frontend can gate auto-execution behind a threshold (e.g. ≥ 75%)
"""

import os
import sys
import json
import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools
from exceptions import (
    AgentError,
    ModelAPIError,
    MaxIterationsError,
    VisualizationParseError,
    ToolExecutionError,
    VerificationRequired,
)
from logging_config import get_logger
from config import get_agent_config
from llm_client import get_llm_client, LLMClient

logger = get_logger(__name__)


# ═════════════════════════════════════════════════════════════════════════════
# 1.  SESSION MEMORY
# ═════════════════════════════════════════════════════════════════════════════

class SessionMemory:
    """
    Keeps a compressed, rolling log of what was queried and found during the
    current chat session.  Injected into every system prompt so the agent can
    resolve follow-up references like:
      • "now filter that by region"
      • "compare with last month"
      • "show the same breakdown for product B"

    Design goals
    ────────────
    • Lean context footprint — only a small result preview is stored.
    • Rolling window (MAX_ENTRIES) so long sessions don't bloat the prompt.
    • Structured entries so the agent gets clean, parseable context.
    """

    MAX_ENTRIES    = 10   # keep the last N turns in memory
    MAX_ROWS       = 5    # result rows stored per turn
    MAX_COLS       = 8    # columns per row

    def __init__(self) -> None:
        self._entries: List[Dict[str, Any]] = []

    # ── write ────────────────────────────────────────────────────────────────

    def record(
        self,
        query: str,
        sql: Optional[str],
        result_preview: Optional[List[Dict]],
        summary: str,
        tables_used: List[str],
    ) -> None:
        """Append a turn to session memory."""
        preview: List[Dict] = []
        if result_preview:
            for row in result_preview[: self.MAX_ROWS]:
                preview.append(
                    {k: v for i, (k, v) in enumerate(row.items()) if i < self.MAX_COLS}
                )

        self._entries.append({
            "turn":           len(self._entries) + 1,
            "query":          query[:300],
            "sql":            (sql or "")[:500],
            "result_preview": preview,
            "summary":        summary[:400],
            "tables_used":    tables_used,
        })

        # Rolling window
        if len(self._entries) > self.MAX_ENTRIES:
            self._entries = self._entries[-self.MAX_ENTRIES :]

    # ── read ─────────────────────────────────────────────────────────────────

    def to_prompt_block(self) -> str:
        """
        Render a compact context block for the system prompt.
        Returns an empty string if memory is empty (first turn).
        """
        if not self._entries:
            return ""

        lines = ["── SESSION MEMORY ── (results from earlier in this conversation)"]
        for e in self._entries:
            lines.append(f"\n[Turn {e['turn']}] User asked: {e['query']}")
            if e["tables_used"]:
                lines.append(f"  Tables used : {', '.join(e['tables_used'])}")
            if e["result_preview"]:
                lines.append(f"  Result sample ({len(e['result_preview'])} rows):")
                for row in e["result_preview"]:
                    lines.append(f"    {row}")
            lines.append(f"  Summary     : {e['summary']}")

        lines.append(
            "\n── HOW TO USE SESSION MEMORY ──\n"
            "When the user says 'that', 'those results', 'the same data', "
            "'now filter', 'now sort', 'compare with', 'show only X from that', "
            "or otherwise refers back to something without re-stating it — "
            "USE the SESSION MEMORY above to understand the reference. "
            "Do NOT call list_tables or re-discover data you already retrieved. "
            "Build directly on previous findings."
        )
        return "\n".join(lines)

    def get_last_tables(self) -> List[str]:
        """Tables used in the most recent turn (handy for follow-up routing)."""
        return self._entries[-1]["tables_used"] if self._entries else []

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


# ═════════════════════════════════════════════════════════════════════════════
# 2.  CONFIDENCE SCORER
# ═════════════════════════════════════════════════════════════════════════════

class ConfidenceScorer:
    """
    Rule-based confidence score (0–100%) attached to every query result.

    No extra LLM call — runs in microseconds after the agent loop finishes.

    Signals evaluated
    ─────────────────
    + schema_verified   → agent called describe_table / get_join_schema first
    + fk_verified       → agent called get_foreign_keys / get_join_schema before a JOIN
    - had_error_retry   → the agent fixed a SQL error mid-run (lower confidence)
    - complexity        → complex SQL (multiple JOINs, subqueries, HAVING …)
    - high_iterations   → agent needed many rounds to finish
    - risky_keyword     → destructive SQL keyword detected (near-zero score)

    Return value
    ────────────
    (score: float 0.0–1.0,  reasoning: str)

    The reasoning string is human-readable for display in the UI, e.g.
      "High confidence (92%)"
      "Medium confidence (68%): JOIN used without FK verification."
      "Low confidence (41%): agent corrected SQL error; took 9 iterations."
    """

    _COMPLEX   = {"join", "union", "intersect", "except", "with ", "having", "subquery"}
    _RISKY     = {"delete", "drop", "truncate", "update", "insert", "alter", "create"}
    _SCHEMA_TOOLS = {"describe_table", "get_join_schema"}
    _FK_TOOLS     = {"get_foreign_keys", "get_join_schema"}

    @staticmethod
    def score(
        sql: Optional[str],
        tools_used: List[str],
        iterations: int,
        had_error_retry: bool,
    ) -> Tuple[float, str]:
        """
        Compute a confidence score.

        Args:
            sql             : The SQL that was or will be executed (None for text-only answers).
            tools_used      : Tool names called during this agent run.
            iterations      : Number of agent-loop iterations.
            had_error_retry : True if the agent encountered and corrected a SQL error.

        Returns:
            (score 0.0–1.0,  reasoning string)
        """
        if not sql:
            return 0.5, "Text-only answer — no SQL generated."

        sql_lower = sql.lower()

        # Hard block for destructive SQL (should never reach here, but be safe)
        for kw in ConfidenceScorer._RISKY:
            if kw in sql_lower:
                return 0.05, f"Destructive keyword '{kw}' detected — do not run."

        score     = 1.0
        penalties: List[str] = []
        tools_set = set(tools_used)

        # Schema not verified
        if not tools_set & ConfidenceScorer._SCHEMA_TOOLS:
            score -= 0.20
            penalties.append("column names not verified against schema")

        # SQL error that needed correction
        if had_error_retry:
            score -= 0.20
            penalties.append("agent corrected a SQL error mid-run")

        # Complex query
        complexity_hits = [kw for kw in ConfidenceScorer._COMPLEX if kw in sql_lower]
        if len(complexity_hits) >= 2:
            score -= 0.12
            penalties.append(f"complex query ({', '.join(complexity_hits)})")
        elif complexity_hits:
            score -= 0.05
            penalties.append(f"uses {complexity_hits[0]}")

        # JOIN without FK verification
        if "join" in sql_lower and not (tools_set & ConfidenceScorer._FK_TOOLS):
            score -= 0.10
            penalties.append("JOIN used without FK verification")

        # Many iterations
        if iterations >= 8:
            score -= 0.12
            penalties.append(f"took {iterations} iterations")
        elif iterations >= 5:
            score -= 0.05
            penalties.append(f"took {iterations} iterations")

        score = max(0.05, min(1.0, round(score, 2)))

        if score >= 0.85:
            label = "High confidence"
        elif score >= 0.65:
            label = "Medium confidence"
        else:
            label = "Low confidence — review before executing"

        reasoning = f"{label} ({score:.0%})"
        if penalties:
            reasoning += ": " + "; ".join(penalties) + "."

        return score, reasoning


# ═════════════════════════════════════════════════════════════════════════════
# 3.  DATA CLASSES
# ═════════════════════════════════════════════════════════════════════════════

@dataclass
class QueryResult:
    """Result returned by QueryProcessor.process()."""
    text:                  str
    visualization:         Optional[Dict[str, Any]] = None
    tools_used:            List[str]                = field(default_factory=list)
    iterations:            int                      = 0
    sql_query:             Optional[str]            = None
    had_error_retry:       bool                     = False
    confidence:            Optional[float]          = None
    confidence_reasoning:  Optional[str]            = None


# ═════════════════════════════════════════════════════════════════════════════
# 4.  VISUALIZATION PARSER  (unchanged logic, cleaned up)
# ═════════════════════════════════════════════════════════════════════════════

class VisualizationParser:
    VALID_CHART_TYPES = ["bar", "line", "pie", "scatter", "area"]

    @staticmethod
    def parse(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
        if "VISUALIZATION:" in text:
            parts        = text.split("VISUALIZATION:", 1)
            clean_text   = parts[0].strip()
            potential    = parts[1].strip()
        else:
            clean_text   = text
            potential    = text

        cb = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", potential, re.DOTALL)
        if cb:
            potential = cb.group(1)
        potential = potential.strip().strip("`").lstrip("json").strip()

        try:
            s = potential.find("{")
            e = potential.rfind("}")
            if s != -1 and e != -1:
                viz = json.loads(potential[s : e + 1])
                VisualizationParser._validate(viz)
                logger.info("Visualization parsed", extra={"type": viz.get("type")})
                return clean_text, viz
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(f"Visualization parse failed: {exc}")

        return text, None

    @staticmethod
    def _validate(viz: Dict[str, Any]) -> None:
        if not isinstance(viz, dict):
            raise VisualizationParseError("Visualization must be a dict")
        if "type" not in viz:
            raise VisualizationParseError("Visualization missing 'type'")
        if viz["type"] not in VisualizationParser.VALID_CHART_TYPES:
            logger.warning(f"Unknown chart type: {viz['type']}")
        if "data" not in viz and "labels" not in viz:
            raise VisualizationParseError("Visualization missing 'data' or 'labels'")


# ═════════════════════════════════════════════════════════════════════════════
# 5.  QUERY PROCESSOR
# ═════════════════════════════════════════════════════════════════════════════

class QueryProcessor:
    """
    Runs the agent tool-calling loop and returns a QueryResult.

    Tracks two new signals for ConfidenceScorer:
      • last_sql          — the SQL that was most recently passed to execute_query
      • had_error_retry   — True if a tool call returned an error string and the
                            agent continued (self-correction)
    """

    def __init__(
        self,
        client:          LLMClient,
        tools_schema:    List[Dict],
        tool_map:        Dict[str, Any],
        config,
        fallback_client: Optional[LLMClient] = None,
    ) -> None:
        self.client          = client
        self.tools_schema    = tools_schema
        self.tool_map        = tool_map
        self.config          = config
        self.fallback_client = fallback_client

    def process(
        self,
        query:          str,
        messages:       List[Dict],
        max_iterations: Optional[int] = None,
        verify_only:    bool          = False,
    ) -> QueryResult:
        max_iterations  = max_iterations or self.config.max_iterations
        iteration_count = 0
        final_text      = ""
        tools_used:  List[str]       = []
        last_sql:    Optional[str]   = None
        had_error_retry              = False

        logger.info(f"QueryProcessor.process: {query[:100]}")

        while iteration_count < max_iterations:
            iteration_count += 1
            logger.debug(f"Iteration {iteration_count}/{max_iterations}")

            # ── LLM call (with fallback) ──────────────────────────────────────
            try:
                response = self.client.chat_completion(
                    model=self.config.model_name,
                    messages=messages,
                    tools=self.tools_schema,
                    tool_choice="auto",
                    max_tokens=self.config.max_tokens,
                )
            except Exception as primary_err:
                if self.fallback_client:
                    logger.warning(f"Primary model failed ({primary_err}), trying fallback")
                    try:
                        response = self.fallback_client.chat_completion(
                            model=self.config.fallback_model_name,
                            messages=messages,
                            tools=self.tools_schema,
                            tool_choice="auto",
                            max_tokens=self.config.max_tokens,
                        )
                    except Exception as fb_err:
                        raise ModelAPIError(
                            f"Both models failed. Primary: {primary_err}; Fallback: {fb_err}",
                            self.config.model_name,
                        ) from primary_err
                else:
                    msg = str(primary_err)
                    if "402" in msg:
                        msg = (
                            "AI provider free-tier limit reached (402). "
                            "Upgrade your plan or check your API key quota."
                        )
                    raise ModelAPIError(msg, self.config.model_name) from primary_err

            response_msg = response.choices[0].message
            tool_calls   = response_msg.tool_calls

            # ── No tool calls → final answer ──────────────────────────────────
            if not tool_calls:
                logger.info(f"Completed in {iteration_count} iterations")
                final_text = response_msg.content
                break

            # ── Append assistant turn ─────────────────────────────────────────
            msg_dict: Dict = {"role": response_msg.role, "content": response_msg.content}
            if response_msg.tool_calls:
                msg_dict["tool_calls"] = [
                    {
                        "id":       tc.id,
                        "type":     tc.type,
                        "function": {
                            "name":      tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in response_msg.tool_calls
                ]
            messages.append(msg_dict)

            # ── Execute each tool call ────────────────────────────────────────
            for tc in tool_calls:
                try:
                    tool_result = self._execute_tool(tc, verify_only)

                    # Track the SQL that was submitted for confidence scoring
                    if tc.function.name == "execute_query":
                        try:
                            args     = json.loads(tc.function.arguments or "{}")
                            last_sql = args.get("sql")
                        except Exception:
                            pass

                except VerificationRequired as vr:
                    if response_msg.content:
                        vr.explanation = response_msg.content
                    raise

                except Exception as exc:
                    # Feed errors back → agent self-corrects
                    logger.warning(f"Tool error (caught for self-correction): {exc}")
                    tool_result    = f"Error executing {tc.function.name}: {exc}"
                    had_error_retry = True

                tools_used.append(tc.function.name)

                content = str(tool_result)
                if len(content) > 50_000:
                    content = content[:50_000] + "... [TRUNCATED]"
                    logger.warning(f"Tool {tc.function.name} result truncated")

                messages.append({
                    "role":         "tool",
                    "name":         tc.function.name,
                    "tool_call_id": tc.id,
                    "content":      content,
                })

        if iteration_count >= max_iterations:
            logger.warning(f"Max iterations ({max_iterations}) reached")
            raise MaxIterationsError(max_iterations)

        # ── Compute confidence score ──────────────────────────────────────────
        confidence, confidence_reasoning = ConfidenceScorer.score(
            sql             = last_sql,
            tools_used      = tools_used,
            iterations      = iteration_count,
            had_error_retry = had_error_retry,
        )

        return QueryResult(
            text                 = final_text,
            tools_used           = tools_used,
            iterations           = iteration_count,
            sql_query            = last_sql,
            had_error_retry      = had_error_retry,
            confidence           = confidence,
            confidence_reasoning = confidence_reasoning,
        )

    def _execute_tool(self, tool_call, verify_only: bool = False) -> Any:
        fn   = tool_call.function.name
        raw  = tool_call.function.arguments

        if raw is None:
            args = {}
        elif isinstance(raw, dict):
            args = raw
        else:
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                args = {}

        logger.info(f"Executing tool: {fn}", extra={"args": str(args)[:100]})

        if fn not in self.tool_map:
            raise ToolExecutionError(fn, "Tool not found")

        if verify_only and fn == "execute_query":
            raise VerificationRequired("User verification required", fn, args)

        try:
            result = self.tool_map[fn](**args)
            logger.debug(f"Tool {fn} succeeded")
            return result
        except Exception as exc:
            logger.error(f"Tool {fn} failed: {exc}", exc_info=True)
            raise ToolExecutionError(fn, str(exc)) from exc


# ═════════════════════════════════════════════════════════════════════════════
# 6.  ANALYTICS AGENT
# ═════════════════════════════════════════════════════════════════════════════

# ── Multi-table JOIN addendum injected after the base system prompt ───────────
_JOIN_PROMPT_ADDENDUM = """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MULTI-TABLE QUERY RULES  (always follow these)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When a question MIGHT involve more than one table:

STEP 1 — MAP THE SCHEMA FIRST
  Call get_join_schema() before writing any SQL.
  This returns every table, every column, and every detected relationship
  in a single response. Never guess join columns.

STEP 2 — UNDERSTAND THE RELATIONSHIPS
  Read the "join_hints" array returned by get_join_schema or get_foreign_keys.
  Each hint shows you the exact columns to use: e.g.
    orders.customer_id = customers.id  [explicit_fk]
  Use ONLY these verified column names in your JOIN conditions.

STEP 3 — WRITE THE JOIN QUERY
  Use the join_hints literally. Example:
    SELECT c.name, SUM(o.amount)
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    GROUP BY c.name
  • Prefer LEFT JOIN when some rows might not have a match.
  • Always alias tables (o, c) to avoid ambiguous column references.
  • If no relationship is found, state that clearly rather than inventing a join.

STEP 4 — HANDLE MISSING RELATIONSHIPS
  If get_foreign_keys returns no relationships, consider:
    a) The tables may share a common business key (e.g. email, order_number).
       Use describe_table on both tables to check.
    b) The data may truly be unrelated — say so honestly.
  Never cross-join tables without an explicit condition.

COMMON JOIN PATTERNS:
  • fact + dimension  : orders JOIN customers, orders JOIN products
  • self-join         : employees e1 JOIN employees e2 ON e1.manager_id = e2.id
  • bridge table      : users JOIN user_roles JOIN roles
  • date dimension    : transactions JOIN calendar ON DATE(ts) = calendar.date
"""


class AnalyticsAgent:
    """
    AI-powered analytics agent for database querying and insights.

    New in this version
    ───────────────────
    • session_memory  : SessionMemory instance (one per chat session in api.py)
    • Confidence scoring on every query result
    • Multi-table JOIN system-prompt addendum
    • run_query now returns  confidence  and  confidence_reasoning  in its dict
    """

    def __init__(
        self,
        hf_token:               Optional[str] = None,
        connection_string:      Optional[str] = None,
        schema_summary:         Optional[str] = None,
        system_prompt_override: Optional[str] = None,
        session_memory:         Optional[SessionMemory] = None,
    ) -> None:
        self.config = get_agent_config()

        if hf_token:                           # legacy support
            self.config.hf_token = hf_token

        self.db                    = DatabaseManager(connection_string)
        self.schema_summary        = schema_summary
        self.system_prompt_override = system_prompt_override

        # Session memory — shared with api.py so it persists across requests
        self.session_memory: SessionMemory = session_memory or SessionMemory()

        self.tools_schema, self.tool_map = get_db_tools(self.db)

        try:
            self.client = get_llm_client(self.config.model_provider, self.config)
            logger.info(f"LLM provider: {self.config.model_provider}")
        except Exception as exc:
            raise AgentError(f"Failed to initialise LLM: {exc}") from exc

        self.fallback_client = None
        if self.config.fallback_model_provider:
            try:
                self.fallback_client = get_llm_client(
                    self.config.fallback_model_provider, self.config
                )
            except Exception as exc:
                logger.warning(f"Fallback LLM unavailable: {exc}")

        self.query_processor = QueryProcessor(
            self.client,
            self.tools_schema,
            self.tool_map,
            self.config,
            fallback_client=self.fallback_client,
        )

        self.query_log: List[Dict[str, Any]] = []
        logger.info("AnalyticsAgent initialised")

    # ── Public API ────────────────────────────────────────────────────────────

    def run_query(
        self,
        query:          str,
        history:        Optional[List[Dict]] = None,
        max_iterations: Optional[int]        = None,
        tables:         Optional[List[str]]  = None,
        verify_only:    bool                 = False,
        confirmed_sql:  Optional[str]        = None,
    ) -> Dict[str, Any]:
        """
        Execute a natural-language query.

        Returns a dict with keys:
          text, visualization, status, sql_query,
          confidence (0.0–1.0), confidence_reasoning (str)
        """
        logger.info(f"run_query: {query[:100]} | tables={tables}")

        if tables:
            new_schema, new_map = get_db_tools(self.db, tables=tables)
            self.query_processor.tools_schema = new_schema
            self.query_processor.tool_map     = new_map

        try:
            messages = list(history) if history else []

            # ── Build system prompt ───────────────────────────────────────────
            system_prompt = self.system_prompt_override or self.config.system_prompt

            # Append multi-table JOIN guidance
            system_prompt += _JOIN_PROMPT_ADDENDUM

            # Append schema cache (skips redundant list_tables/describe calls)
            if self.schema_summary:
                system_prompt += (
                    "\n\nDATABASE SCHEMA CACHE:\n"
                    + self.schema_summary
                    + "\n\nNOTE: You do NOT need to call list_tables or describe_table "
                      "for the tables listed above. Use this schema directly."
                )

            # Inject session memory so the agent can resolve follow-up references
            memory_block = self.session_memory.to_prompt_block()
            if memory_block:
                system_prompt += "\n\n" + memory_block

            if not any(m.get("role") == "system" for m in messages):
                messages.insert(0, {"role": "system", "content": system_prompt})

            messages.append({"role": "user", "content": query})

            # ── Run the agent ─────────────────────────────────────────────────
            try:
                if confirmed_sql:
                    result = self._run_confirmed_sql(confirmed_sql, query, messages, max_iterations)
                else:
                    result = self.query_processor.process(
                        query, messages, max_iterations, verify_only=verify_only
                    )

            except VerificationRequired as vr:
                logger.info(f"Verification required for {vr.tool_name}")
                # Compute confidence for the pending SQL before showing to user
                confidence, confidence_reasoning = ConfidenceScorer.score(
                    sql             = vr.tool_args.get("sql"),
                    tools_used      = [],
                    iterations      = 0,
                    had_error_retry = False,
                )
                return {
                    "text":                 vr.explanation or "Please review the generated SQL before execution.",
                    "sql_query":            vr.tool_args.get("sql"),
                    "status":               "needs_verification",
                    "visualization":        None,
                    "confidence":           confidence,
                    "confidence_reasoning": confidence_reasoning,
                }

            except MaxIterationsError:
                logger.warning("Max iterations reached")
                return {
                    "text": (
                        "I reached the maximum number of processing steps. "
                        "Try rephrasing your query or breaking it into smaller questions."
                    ),
                    "visualization":        None,
                    "status":               "error",
                    "confidence":           0.0,
                    "confidence_reasoning": "Query did not complete within iteration limit.",
                }

            # ── Parse visualization ───────────────────────────────────────────
            clean_text, viz_data = VisualizationParser.parse(result.text)
            if viz_data and not clean_text:
                clean_text = "Here is the visual analysis of the results."

            # ── Update session memory ─────────────────────────────────────────
            tables_used = self._extract_tables_from_tools(result.tools_used)
            self.session_memory.record(
                query          = query,
                sql            = result.sql_query,
                result_preview = None,   # we don't re-run to get rows here; summary is enough
                summary        = clean_text[:400] if clean_text else "",
                tables_used    = tables_used,
            )

            self._log_query(query, result, viz_data)

            return {
                "text":                 clean_text,
                "visualization":        viz_data,
                "status":               "success",
                "sql_query":            result.sql_query,
                "confidence":           result.confidence,
                "confidence_reasoning": result.confidence_reasoning,
            }

        except AgentError as exc:
            logger.error(f"AgentError: {exc}", exc_info=True)
            return {
                "text":                 f"Error processing query: {exc}",
                "visualization":        None,
                "status":               "error",
                "confidence":           0.0,
                "confidence_reasoning": "Agent error — could not complete.",
            }
        except Exception as exc:
            logger.error(f"Unexpected error: {exc}", exc_info=True)
            return {
                "text":                 f"An unexpected error occurred: {exc}",
                "visualization":        None,
                "status":               "error",
                "confidence":           0.0,
                "confidence_reasoning": "Unexpected error.",
            }

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _run_confirmed_sql(
        self,
        confirmed_sql:  str,
        original_query: str,
        messages:       List[Dict],
        max_iterations: Optional[int],
    ) -> QueryResult:
        """Execute pre-approved SQL directly then ask the LLM to explain the results."""
        exec_fn = self.tool_map.get("execute_query")
        if not exec_fn:
            raise ToolExecutionError("execute_query", "Tool not found")

        sql_results = exec_fn(sql=confirmed_sql)

        explanation_prompt = (
            f"I executed the following SQL for the user's request: '{original_query}'\n\n"
            f"SQL: {confirmed_sql}\n\n"
            f"Results: {str(sql_results)[:10_000]}\n\n"
            "Please analyse these results and answer the user's question. "
            "If a chart would help, include a VISUALIZATION JSON block at the end."
        )
        messages.append({"role": "user", "content": explanation_prompt})

        return self.query_processor.process(
            "Explain results", messages, max_iterations, verify_only=False
        )

    @staticmethod
    def _extract_tables_from_tools(tools_used: List[str]) -> List[str]:
        """
        Best-effort extraction of table names from the tool call log.
        Because tool args are not stored here we rely on the fact that
        describe_table and execute_query calls imply table access — the
        session memory summary is more valuable than a precise table list.
        """
        # Tables will be recorded more precisely if callers pass them explicitly.
        # For now we return a placeholder.  api.py can enrich this if desired.
        return []

    def _log_query(self, query: str, result: QueryResult, viz_data) -> None:
        self.query_log.append({
            "query":            query,
            "response_length":  len(result.text or ""),
            "tools_used":       result.tools_used,
            "iterations":       result.iterations,
            "has_visualization": viz_data is not None,
            "confidence":       result.confidence,
        })

    def get_query_stats(self) -> Dict[str, Any]:
        if not self.query_log:
            return {"total_queries": 0}
        return {
            "total_queries":     len(self.query_log),
            "avg_iterations":    sum(q["iterations"] for q in self.query_log) / len(self.query_log),
            "queries_with_viz":  sum(1 for q in self.query_log if q["has_visualization"]),
            "avg_confidence":    round(
                sum(q["confidence"] or 0 for q in self.query_log) / len(self.query_log), 2
            ),
            "most_used_tools":   self._get_most_used_tools(),
        }

    def _get_most_used_tools(self) -> List[Tuple[str, int]]:
        counts: Dict[str, int] = {}
        for q in self.query_log:
            for t in q["tools_used"]:
                counts[t] = counts.get(t, 0) + 1
        return sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]

    def close(self) -> None:
        logger.info("Closing AnalyticsAgent")
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
        return False


# ─────────────────────────────────────────────────────────────────────────────
# CLI smoke-test
# ─────────────────────────────────────────────────────────────────────────────

def main():
    load_dotenv()
    with AnalyticsAgent() as agent:
        print("\n--- Query 1 ---")
        r1 = agent.run_query("What is the cheapest product?")
        print(r1["text"])
        print(f"Confidence: {r1['confidence_reasoning']}")

        print("\n--- Query 2 (follow-up) ---")
        r2 = agent.run_query("Now show the top 5 most expensive ones from that same table.")
        print(r2["text"])
        print(f"Confidence: {r2['confidence_reasoning']}")

        print("\n--- Stats ---")
        print(json.dumps(agent.get_query_stats(), indent=2))


if __name__ == "__main__":
    main()