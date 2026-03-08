"""
Organization Context Manager for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Gives the AI persistent memory of your organization's business terminology,
metric definitions, and data rules. Context is injected into every LLM call
automatically so the AI always understands your business language.

Two ways context is added:
  1. Explicit  — user/admin defines it via API  ("ARR excludes churn credits")
  2. Implicit  — AI infers it from user corrections ("No, active users excludes trials")

Storage backend: SQLAlchemy (works with SQLite AND PostgreSQL).
Raw sqlite3 dependency removed — uses the same admin DB engine as models.py.
"""

import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import text
import logging

logger = logging.getLogger(__name__)

CONTEXT_TYPES = ["term", "rule", "preference", "dimension", "threshold"]


def _admin_engine():
    """Return the shared SQLAlchemy admin engine from models.py."""
    from models import engine as _engine
    return _engine


def ensure_context_tables():
    """
    Create org_context and context_corrections tables if they don't exist.
    Works on both SQLite and PostgreSQL via SQLAlchemy.
    Call from lifespan startup in api.py.
    """
    engine  = _admin_engine()
    dialect = engine.dialect.name

    if dialect == "postgresql":
        ddl = """
            CREATE TABLE IF NOT EXISTS org_context (
                id           TEXT PRIMARY KEY,
                org_id       INTEGER NOT NULL,
                context_type TEXT DEFAULT 'term',
                key          TEXT NOT NULL,
                definition   TEXT NOT NULL,
                sql_snippet  TEXT,
                examples     TEXT,
                source       TEXT DEFAULT 'user_defined',
                confidence   DOUBLE PRECISION DEFAULT 1.0,
                usage_count  INTEGER DEFAULT 0,
                created_at   TEXT,
                updated_at   TEXT,
                UNIQUE (org_id, key)
            );
            CREATE INDEX IF NOT EXISTS ix_org_context_org_id ON org_context (org_id);

            CREATE TABLE IF NOT EXISTS context_corrections (
                id                TEXT PRIMARY KEY,
                org_id            INTEGER NOT NULL,
                original_query    TEXT,
                original_response TEXT,
                user_correction   TEXT,
                extracted_key     TEXT,
                processed         INTEGER DEFAULT 0,
                created_at        TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_context_corrections_org_id
                ON context_corrections (org_id);
        """
    else:
        ddl = """
            CREATE TABLE IF NOT EXISTS org_context (
                id           TEXT PRIMARY KEY,
                org_id       INTEGER NOT NULL,
                context_type TEXT DEFAULT 'term',
                key          TEXT NOT NULL,
                definition   TEXT NOT NULL,
                sql_snippet  TEXT,
                examples     TEXT,
                source       TEXT DEFAULT 'user_defined',
                confidence   REAL DEFAULT 1.0,
                usage_count  INTEGER DEFAULT 0,
                created_at   TEXT,
                updated_at   TEXT,
                UNIQUE (org_id, key)
            );

            CREATE TABLE IF NOT EXISTS context_corrections (
                id                TEXT PRIMARY KEY,
                org_id            INTEGER NOT NULL,
                original_query    TEXT,
                original_response TEXT,
                user_correction   TEXT,
                extracted_key     TEXT,
                processed         INTEGER DEFAULT 0,
                created_at        TEXT
            );
        """

    engine = _admin_engine()
    with engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


class OrgContextManager:
    """
    Manages organization-specific business context for LLM injection.
    Context persists across sessions and shapes every AI response.

    Quick integration in api.py /query route (3 lines):
        ctx = OrgContextManager(org.id)
        enriched = ctx.inject_into_prompt(config.agent.system_prompt)
        agent = AnalyticsAgent(connection_string=conn_str, system_prompt_override=enriched)
    """

    def __init__(self, org_id: int, llm_caller=None):
        self.org_id     = org_id
        self.llm_caller = llm_caller
        ensure_context_tables()

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def add_context(
        self,
        key:          str,
        definition:   str,
        context_type: str            = "term",
        sql_snippet:  Optional[str]  = None,
        examples:     Optional[list] = None,
        source:       str            = "user_defined",
        confidence:   float          = 1.0,
    ) -> dict:
        """Add or update a business context entry (upsert on org_id + key)."""
        entry_id = str(uuid.uuid4())
        now      = datetime.utcnow().isoformat()
        engine   = _admin_engine()
        dialect  = engine.dialect.name

        if dialect == "postgresql":
            upsert_sql = text("""
                INSERT INTO org_context
                    (id, org_id, context_type, key, definition, sql_snippet,
                     examples, source, confidence, usage_count, created_at, updated_at)
                VALUES
                    (:id, :org_id, :context_type, :key, :definition, :sql_snippet,
                     :examples, :source, :confidence, 0, :now, :now)
                ON CONFLICT (org_id, key) DO UPDATE SET
                    definition   = EXCLUDED.definition,
                    sql_snippet  = EXCLUDED.sql_snippet,
                    examples     = EXCLUDED.examples,
                    source       = EXCLUDED.source,
                    confidence   = EXCLUDED.confidence,
                    updated_at   = EXCLUDED.updated_at
            """)
        else:  # SQLite
            upsert_sql = text("""
                INSERT INTO org_context
                    (id, org_id, context_type, key, definition, sql_snippet,
                     examples, source, confidence, usage_count, created_at, updated_at)
                VALUES
                    (:id, :org_id, :context_type, :key, :definition, :sql_snippet,
                     :examples, :source, :confidence, 0, :now, :now)
                ON CONFLICT(org_id, key) DO UPDATE SET
                    definition   = excluded.definition,
                    sql_snippet  = excluded.sql_snippet,
                    examples     = excluded.examples,
                    source       = excluded.source,
                    confidence   = excluded.confidence,
                    updated_at   = excluded.updated_at
            """)

        params = {
            "id":           entry_id,
            "org_id":       self.org_id,
            "context_type": context_type,
            "key":          key,
            "definition":   definition,
            "sql_snippet":  sql_snippet,
            "examples":     json.dumps(examples) if examples else None,
            "source":       source,
            "confidence":   confidence,
            "now":          now,
        }

        with engine.connect() as conn:
            with conn.begin():
                conn.execute(upsert_sql, params)

        logger.info(f"[OrgContext] Saved [{self.org_id}] {key}")
        return self.get_context(key)

    def get_context(self, key: str) -> Optional[dict]:
        engine = _admin_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT * FROM org_context WHERE org_id = :org_id AND key = :key"),
                {"org_id": self.org_id, "key": key},
            ).mappings().first()
        return self._row(dict(row)) if row else None

    def get_all_context(self) -> list:
        engine = _admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT * FROM org_context "
                    "WHERE org_id = :org_id ORDER BY context_type, key"
                ),
                {"org_id": self.org_id},
            ).mappings().all()
        return [self._row(dict(r)) for r in rows]

    def delete_context(self, key: str):
        engine = _admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("DELETE FROM org_context WHERE org_id = :org_id AND key = :key"),
                    {"org_id": self.org_id, "key": key},
                )

    def increment_usage(self, key: str):
        engine = _admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text(
                        "UPDATE org_context SET usage_count = usage_count + 1 "
                        "WHERE org_id = :org_id AND key = :key"
                    ),
                    {"org_id": self.org_id, "key": key},
                )

    def get_stats(self) -> dict:
        engine = _admin_engine()
        with engine.connect() as conn:
            type_rows = conn.execute(
                text(
                    "SELECT context_type, COUNT(*) AS cnt, SUM(usage_count) AS uses "
                    "FROM org_context WHERE org_id = :org_id GROUP BY context_type"
                ),
                {"org_id": self.org_id},
            ).mappings().all()

            pending_row = conn.execute(
                text(
                    "SELECT COUNT(*) AS n FROM context_corrections "
                    "WHERE org_id = :org_id AND processed = 0"
                ),
                {"org_id": self.org_id},
            ).mappings().first()

        return {
            "total_entries": sum(r["cnt"] for r in type_rows),
            "by_type": {
                r["context_type"]: {"count": r["cnt"], "usage": r["uses"]}
                for r in type_rows
            },
            "pending_corrections": pending_row["n"] if pending_row else 0,
        }

    # ── Prompt injection ──────────────────────────────────────────────────────

    def get_context_for_prompt(self) -> str:
        """Build context block to prepend to the system prompt. Returns '' if none."""
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
        block = self.get_context_for_prompt()
        if not block:
            return base_system_prompt
        return f"{base_system_prompt}\n\n{block}"

    # ── Implicit learning from corrections ────────────────────────────────────

    def record_correction(
        self,
        original_query:    str,
        original_response: str,
        user_correction:   str,
    ) -> str:
        """Record a user correction. Returns correction_id."""
        cid    = str(uuid.uuid4())
        engine = _admin_engine()
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("""
                        INSERT INTO context_corrections
                            (id, org_id, original_query, original_response,
                             user_correction, created_at)
                        VALUES
                            (:id, :org_id, :original_query, :original_response,
                             :user_correction, :created_at)
                    """),
                    {
                        "id":                cid,
                        "org_id":            self.org_id,
                        "original_query":    original_query,
                        "original_response": original_response,
                        "user_correction":   user_correction,
                        "created_at":        datetime.utcnow().isoformat(),
                    },
                )
        return cid

    async def process_correction(self, correction_id: str) -> Optional[dict]:
        """LLM extracts a reusable rule from a correction. Auto-saves if confidence >= 0.75."""
        if not self.llm_caller:
            return None

        engine = _admin_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT * FROM context_corrections "
                    "WHERE id = :id AND org_id = :org_id"
                ),
                {"id": correction_id, "org_id": self.org_id},
            ).mappings().first()

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
            response_text = await self.llm_caller(prompt)
            start, end    = response_text.find("{"), response_text.rfind("}") + 1
            if start < 0 or end <= start:
                raise ValueError("No JSON found in LLM response")
            result = json.loads(response_text[start:end])

            # Mark correction as processed
            with engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        text(
                            "UPDATE context_corrections "
                            "SET processed=1, extracted_key=:key WHERE id=:id"
                        ),
                        {"key": result.get("key"), "id": correction_id},
                    )

            if result.get("rule_found") and result.get("confidence", 0) >= 0.75:
                saved = self.add_context(
                    key          = result["key"],
                    definition   = result["definition"],
                    context_type = result.get("context_type", "term"),
                    sql_snippet  = result.get("sql_snippet"),
                    source       = "inferred",
                    confidence   = result["confidence"],
                )
                logger.info(
                    f"[OrgContext] Auto-learned: {result['key']} "
                    f"({result['confidence']:.0%})"
                )
                return saved

        except Exception as exc:
            logger.error(f"[OrgContext] process_correction error: {exc}")
        return None

    async def process_pending_corrections(self) -> int:
        engine = _admin_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id FROM context_corrections "
                    "WHERE org_id = :org_id AND processed = 0"
                ),
                {"org_id": self.org_id},
            ).mappings().all()

        count = 0
        for row in rows:
            if await self.process_correction(row["id"]):
                count += 1
        return count

    def _row(self, row: dict) -> dict:
        if row.get("examples") and isinstance(row["examples"], str):
            try:
                row["examples"] = json.loads(row["examples"])
            except Exception:
                row["examples"] = []
        return row