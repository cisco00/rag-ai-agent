"""
query_templates.py — Saved Queries / Query Templates for Vantage AI

Templates store a natural-language query with optional {param} placeholders.
Before running, the user fills in the parameter values and the placeholders
are replaced to produce the final query sent to the AI.

Schema
──────
query_templates
  id            – primary key
  org_id        – organisation that owns the template
  user_id       – creator (nullable — org-level templates when null)
  name          – short display name
  description   – optional longer description
  query_text    – NL query with optional {param} placeholders
  parameters    – JSON array of {name, label, type, default}
  tags          – comma-separated tag string for filtering
  use_count     – incremented on every run
  created_at    – ISO timestamp
  updated_at    – ISO timestamp
"""

import json
import re
from datetime import datetime
from typing import Optional

from sqlalchemy import text

from models import engine as admin_engine
from logging_config import get_logger

logger = get_logger(__name__)


# ─── Schema ───────────────────────────────────────────────────────────────────

def ensure_template_tables() -> None:
    """Create query_templates table if it doesn't exist."""
    dialect = admin_engine.dialect.name
    if dialect == "postgresql":
        serial, ai = "SERIAL", ""
    else:
        serial, ai = "INTEGER", "AUTOINCREMENT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS query_templates (
            id          {serial} PRIMARY KEY {ai},
            org_id      INTEGER NOT NULL,
            user_id     INTEGER,
            name        TEXT    NOT NULL,
            description TEXT,
            query_text  TEXT    NOT NULL,
            parameters  TEXT    DEFAULT '[]',
            tags        TEXT    DEFAULT '',
            use_count   INTEGER DEFAULT 0,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_qt_org_id ON query_templates (org_id);
        CREATE INDEX IF NOT EXISTS ix_qt_name   ON query_templates (org_id, name)
    """
    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["parameters"] = json.loads(d.get("parameters") or "[]")
    except (json.JSONDecodeError, TypeError):
        d["parameters"] = []
    d["tags"] = [t.strip() for t in (d.get("tags") or "").split(",") if t.strip()]
    return d


def detect_parameters(query_text: str) -> list[dict]:
    """
    Scan query_text for {param} placeholders and return a parameter list.
    E.g. "Top customers in {region} for {month}" →
    [{"name": "region", "label": "Region", "type": "text", "default": ""},
     {"name": "month",  "label": "Month",  "type": "text", "default": ""}]
    """
    names = list(dict.fromkeys(re.findall(r"\{(\w+)\}", query_text)))  # preserve order, dedupe
    return [
        {"name": n, "label": n.replace("_", " ").title(), "type": "text", "default": ""}
        for n in names
    ]


def fill_parameters(query_text: str, values: dict[str, str]) -> str:
    """Replace {param} placeholders with provided values."""
    result = query_text
    for key, val in values.items():
        result = result.replace(f"{{{key}}}", str(val))
    return result


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_template(org_id: int, data: dict) -> dict:
    now = datetime.utcnow().isoformat()
    params = data.get("parameters")
    if params is None:
        params = detect_parameters(data.get("query_text", ""))
    tags_str = ",".join(data.get("tags", [])) if isinstance(data.get("tags"), list) else (data.get("tags") or "")

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO query_templates
                    (org_id, user_id, name, description, query_text, parameters, tags, use_count, created_at, updated_at)
                VALUES
                    (:org_id, :user_id, :name, :description, :query_text, :parameters, :tags, 0, :now, :now)
            """), {
                "org_id":      org_id,
                "user_id":     data.get("user_id"),
                "name":        data["name"],
                "description": data.get("description", ""),
                "query_text":  data["query_text"],
                "parameters":  json.dumps(params),
                "tags":        tags_str,
                "now":         now,
            })
        row = conn.execute(
            text("SELECT * FROM query_templates WHERE org_id=:org_id ORDER BY created_at DESC LIMIT 1"),
            {"org_id": org_id}
        ).mappings().first()
    return _row_to_dict(row)


def list_templates(org_id: int, search: Optional[str] = None, tag: Optional[str] = None) -> list[dict]:
    with admin_engine.connect() as conn:
        q = "SELECT * FROM query_templates WHERE org_id=:org_id"
        params: dict = {"org_id": org_id}
        if search:
            q += " AND (name LIKE :search OR description LIKE :search OR query_text LIKE :search)"
            params["search"] = f"%{search}%"
        if tag:
            q += " AND tags LIKE :tag"
            params["tag"] = f"%{tag}%"
        q += " ORDER BY use_count DESC, updated_at DESC"
        rows = conn.execute(text(q), params).mappings().all()
    return [_row_to_dict(r) for r in rows]


def get_template(template_id: int, org_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM query_templates WHERE id=:id AND org_id=:org_id"),
            {"id": template_id, "org_id": org_id}
        ).mappings().first()
    return _row_to_dict(row) if row else None


def update_template(template_id: int, org_id: int, data: dict) -> Optional[dict]:
    allowed = {"name", "description", "query_text", "parameters", "tags"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return get_template(template_id, org_id)

    if "parameters" in updates and isinstance(updates["parameters"], list):
        updates["parameters"] = json.dumps(updates["parameters"])
    if "tags" in updates and isinstance(updates["tags"], list):
        updates["tags"] = ",".join(updates["tags"])

    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k}=:{k}" for k in updates)
    updates.update({"id": template_id, "org_id": org_id})

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text(f"UPDATE query_templates SET {set_clause} WHERE id=:id AND org_id=:org_id"),
                updates
            )
    return get_template(template_id, org_id)


def delete_template(template_id: int, org_id: int) -> bool:
    with admin_engine.connect() as conn:
        with conn.begin():
            result = conn.execute(
                text("DELETE FROM query_templates WHERE id=:id AND org_id=:org_id"),
                {"id": template_id, "org_id": org_id}
            )
    return result.rowcount > 0


def increment_use_count(template_id: int, org_id: int) -> None:
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE query_templates SET use_count=use_count+1, updated_at=:now WHERE id=:id AND org_id=:org_id"),
                {"now": datetime.utcnow().isoformat(), "id": template_id, "org_id": org_id}
            )
