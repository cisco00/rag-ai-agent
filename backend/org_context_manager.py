"""
Organization Context Manager for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Gives the AI persistent memory of your organization's business terminology,
metric definitions, and data rules. Context is injected into every LLM call
automatically so the AI always understands your business language.

Two ways context is added:
  1. Explicit  — user/admin defines it via API  ("ARR excludes churn credits")
  2. Implicit  — AI infers it from user corrections ("No, active users excludes trials")

INTEGRATION: Standalone file. Plugs into existing admin.db.
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Optional
import sqlite3
import os

logger = logging.getLogger(__name__)

CONTEXT_TYPES = ["term", "rule", "preference", "dimension", "threshold"]


def _get_admin_db_path() -> str:
    # Check multiple env vars for consistency with other modules
    db_url = os.getenv("ADMIN_DB_URL") or os.getenv("ADMIN_DB_PATH") or "./admin.db"
    
    # Strip sqlite prefix if present
    if db_url.startswith("sqlite:///"):
        path = db_url.replace("sqlite:///", "")
    elif db_url.startswith("sqlite://"):
        path = db_url.replace("sqlite://", "")
    else:
        path = db_url
        
    # Return absolute path to avoid CWD issues
    return os.path.abspath(path)


def _conn():
    """Return a sqlite3 connection to admin.db with row_factory and WAL mode."""
    # Use a longer timeout (30s) to avoid "database is locked" during heavy concurrent access
    c = sqlite3.connect(_get_admin_db_path(), timeout=30.0)
    c.row_factory = sqlite3.Row
    try:
        # Enable Write-Ahead Logging for better concurrency with SQLAlchemy
        c.execute("PRAGMA journal_mode=WAL")
    except Exception as e:
        logger.warning(f"Failed to set WAL mode: {e}")
    return c


def ensure_context_tables():
    """
    Create context tables in admin.db if they don't exist.
    Call this from your lifespan startup handler in api.py.
    """
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS org_context (
                id TEXT PRIMARY KEY,
                org_id INTEGER NOT NULL,
                context_type TEXT DEFAULT 'term',
                key TEXT NOT NULL,
                definition TEXT NOT NULL,
                sql_snippet TEXT,
                examples TEXT,
                source TEXT DEFAULT 'user_defined',
                confidence REAL DEFAULT 1.0,
                usage_count INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(org_id, key)
            );

            CREATE TABLE IF NOT EXISTS context_corrections (
                id TEXT PRIMARY KEY,
                org_id INTEGER NOT NULL,
                original_query TEXT,
                original_response TEXT,
                user_correction TEXT,
                extracted_key TEXT,
                processed INTEGER DEFAULT 0,
                created_at TEXT
            );
        """)


class OrgContextManager:
    """
    Manages organization-specific business context for LLM injection.
    Context persists across sessions and shapes every AI response.

    Quick integration in api.py /query route (3 lines):
        ctx = OrgContextManager(org.id)
        enriched_system_prompt = ctx.inject_into_prompt(config.agent.system_prompt)
        agent = AnalyticsAgent(connection_string=conn_str, system_prompt_override=enriched_system_prompt)
    """

    def __init__(self, org_id: int, llm_caller=None):
        self.org_id = org_id
        self.llm_caller = llm_caller
        ensure_context_tables()

    # ─────────────────────────────────────────────
    # CRUD
    # ─────────────────────────────────────────────

    def add_context(
        self,
        key: str,
        definition: str,
        context_type: str = "term",
        sql_snippet: Optional[str] = None,
        examples: Optional[list] = None,
        source: str = "user_defined",
        confidence: float = 1.0,
    ) -> dict:
        """Add or update a business context entry."""
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        with _conn() as c:
            c.execute("""
                INSERT INTO org_context
                    (id, org_id, context_type, key, definition, sql_snippet,
                     examples, source, confidence, usage_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                ON CONFLICT(org_id, key) DO UPDATE SET
                    definition  = excluded.definition,
                    sql_snippet = excluded.sql_snippet,
                    examples    = excluded.examples,
                    source      = excluded.source,
                    confidence  = excluded.confidence,
                    updated_at  = excluded.updated_at
            """, [
                entry_id, self.org_id, context_type, key, definition,
                sql_snippet,
                json.dumps(examples) if examples else None,
                source, confidence, now, now,
            ])

        logger.info(f"[OrgContext] Saved [{self.org_id}] {key}")
        return self.get_context(key)

    def get_context(self, key: str) -> Optional[dict]:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM org_context WHERE org_id = ? AND key = ?",
                [self.org_id, key]
            ).fetchone()
        return self._row(row) if row else None

    def get_all_context(self) -> list:
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM org_context WHERE org_id = ? ORDER BY context_type, key",
                [self.org_id]
            ).fetchall()
        return [self._row(r) for r in rows]

    def delete_context(self, key: str):
        with _conn() as c:
            c.execute(
                "DELETE FROM org_context WHERE org_id = ? AND key = ?",
                [self.org_id, key]
            )

    def increment_usage(self, key: str):
        with _conn() as c:
            c.execute(
                "UPDATE org_context SET usage_count = usage_count + 1 WHERE org_id = ? AND key = ?",
                [self.org_id, key]
            )

    def get_stats(self) -> dict:
        with _conn() as c:
            rows = c.execute("""
                SELECT context_type, COUNT(*) as cnt, SUM(usage_count) as uses
                FROM org_context WHERE org_id = ? GROUP BY context_type
            """, [self.org_id]).fetchall()
            pending = c.execute(
                "SELECT COUNT(*) as n FROM context_corrections WHERE org_id = ? AND processed = 0",
                [self.org_id]
            ).fetchone()
        return {
            "total_entries": sum(r["cnt"] for r in rows),
            "by_type": {r["context_type"]: {"count": r["cnt"], "usage": r["uses"]} for r in rows},
            "pending_corrections": pending["n"] if pending else 0,
        }

    # ─────────────────────────────────────────────
    # PROMPT INJECTION — the core method
    # ─────────────────────────────────────────────

    def get_context_for_prompt(self) -> str:
        """Build context block to prepend to system prompt. Returns '' if none defined."""
        entries = self.get_all_context()
        if not entries:
            return ""

        by_type: dict[str, list] = {}
        for e in entries:
            by_type.setdefault(e["context_type"], []).append(e)

        type_labels = {
            "term":       "📊 Business Terms & Metric Definitions",
            "rule":       "⚙️  Data Rules & Filters (always apply to every query)",
            "preference": "🎯 Preferences",
            "dimension":  "🗂️  Key Business Dimensions",
            "threshold":  "🚨 Important Thresholds",
        }

        lines = [
            "━━━ ORGANIZATION BUSINESS CONTEXT ━━━",
            "Apply these definitions and rules to EVERY query without exception.",
            "",
        ]
        for ctx_type, label in type_labels.items():
            if ctx_type not in by_type:
                continue
            lines.append(label)
            for entry in by_type[ctx_type]:
                line = f"  • {entry['key']}: {entry['definition']}"
                if entry.get("sql_snippet"):
                    line += f"\n    → SQL filter: {entry['sql_snippet']}"
                if entry.get("examples"):
                    ex = entry["examples"]
                    if isinstance(ex, list) and ex:
                        line += f"\n    → Example: {ex[0]}"
                lines.append(line)
            lines.append("")
        lines.append("━━━ END CONTEXT ━━━")
        return "\n".join(lines)

    def inject_into_prompt(self, base_system_prompt: str) -> str:
        """Return system prompt enriched with org-specific context."""
        block = self.get_context_for_prompt()
        if not block:
            return base_system_prompt
        return f"{base_system_prompt}\n\n{block}"

    # ─────────────────────────────────────────────
    # IMPLICIT LEARNING FROM CORRECTIONS
    # ─────────────────────────────────────────────

    def record_correction(self, original_query: str, original_response: str, user_correction: str) -> str:
        """Record a user correction. Returns correction_id."""
        cid = str(uuid.uuid4())
        with _conn() as c:
            c.execute("""
                INSERT INTO context_corrections
                (id, org_id, original_query, original_response, user_correction, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, [cid, self.org_id, original_query, original_response,
                  user_correction, datetime.utcnow().isoformat()])
        return cid

    async def process_correction(self, correction_id: str) -> Optional[dict]:
        """LLM extracts a reusable rule from a correction. Auto-saves if confidence >= 0.75."""
        if not self.llm_caller:
            return None

        with _conn() as c:
            row = c.execute(
                "SELECT * FROM context_corrections WHERE id = ? AND org_id = ?",
                [correction_id, self.org_id]
            ).fetchone()
        if not row:
            return None

        correction = dict(row)
        prompt = f"""
You are analyzing a user correction to an AI data analyst.

Original question: {correction['original_query']}
AI response (truncated): {correction['original_response'][:400]}
User correction: {correction['user_correction']}

Determine if the correction implies a REUSABLE business definition or filter rule.

Respond ONLY in JSON:
If reusable rule found:
{{
  "rule_found": true,
  "key": "snake_case_name",
  "definition": "human-readable definition",
  "context_type": "term|rule|preference|threshold",
  "sql_snippet": "SQL fragment or null",
  "confidence": 0.85
}}
If not reusable: {{"rule_found": false}}

Only extract rules with confidence >= 0.75.
"""
        try:
            text = await self.llm_caller(prompt)
            start, end = text.find("{"), text.rfind("}") + 1
            if start < 0 or end <= start:
                raise ValueError("No JSON")
            result = json.loads(text[start:end])

            with _conn() as c:
                c.execute(
                    "UPDATE context_corrections SET processed=1, extracted_key=? WHERE id=?",
                    [result.get("key"), correction_id]
                )

            if result.get("rule_found") and result.get("confidence", 0) >= 0.75:
                saved = self.add_context(
                    key=result["key"],
                    definition=result["definition"],
                    context_type=result.get("context_type", "term"),
                    sql_snippet=result.get("sql_snippet"),
                    source="inferred",
                    confidence=result["confidence"],
                )
                logger.info(f"[OrgContext] Auto-learned: {result['key']} ({result['confidence']:.0%})")
                return saved
        except Exception as e:
            logger.error(f"[OrgContext] process_correction error: {e}")
        return None

    async def process_pending_corrections(self) -> int:
        with _conn() as c:
            rows = c.execute(
                "SELECT id FROM context_corrections WHERE org_id=? AND processed=0",
                [self.org_id]
            ).fetchall()
        count = 0
        for row in rows:
            if await self.process_correction(row["id"]):
                count += 1
        return count

    def _row(self, row) -> dict:
        d = dict(row)
        if d.get("examples") and isinstance(d["examples"], str):
            try:
                d["examples"] = json.loads(d["examples"])
            except Exception:
                d["examples"] = []
        return d