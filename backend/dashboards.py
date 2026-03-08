"""
dashboards.py — Saved dashboards for Vantage AI
────────────────────────────────────────────────────────────────────────────────
Users pin query results (text + visualization) as cards, arrange cards
into named dashboards, and optionally share the whole dashboard via a link.

Concepts:
  DashboardCard  — one saved query + its result + visualization + layout position
  Dashboard      — named collection of cards belonging to an org

Layout:
  Cards carry a simple grid layout (x, y, w, h) that the frontend uses.
  Default card size is 6×4 in a 12-column grid.

Sharing:
  A dashboard can be published via a short public token (no auth required
  to view — same pattern as SharedReport).

Storage: SQLAlchemy, works on SQLite + Postgres.
"""

import json
import secrets
from datetime import datetime
from typing import Optional

from sqlalchemy import text

from models import engine as admin_engine
from logging_config import get_logger

logger = get_logger(__name__)


# ─── Schema ──────────────────────────────────────────────────────────────────

def ensure_dashboard_tables():
    """Create dashboards and dashboard_cards tables. Call from lifespan startup."""
    dialect = admin_engine.dialect.name
    serial  = "SERIAL" if dialect == "postgresql" else "INTEGER"
    ai      = "" if dialect == "postgresql" else "AUTOINCREMENT"

    ddl = f"""
        CREATE TABLE IF NOT EXISTS dashboards (
            id          {serial} PRIMARY KEY {ai},
            org_id      INTEGER NOT NULL,
            name        TEXT NOT NULL,
            description TEXT,
            is_public   INTEGER NOT NULL DEFAULT 0,
            share_token TEXT UNIQUE,
            created_by  INTEGER,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_dashboards_org_id ON dashboards (org_id);
        CREATE INDEX IF NOT EXISTS ix_dashboards_share_token ON dashboards (share_token);

        CREATE TABLE IF NOT EXISTS dashboard_cards (
            id              {serial} PRIMARY KEY {ai},
            dashboard_id    INTEGER NOT NULL,
            org_id          INTEGER NOT NULL,
            title           TEXT,
            query_text      TEXT,
            response_text   TEXT,
            visualization   TEXT,
            sql_query       TEXT,
            card_type       TEXT NOT NULL DEFAULT 'query',
            layout_x        INTEGER NOT NULL DEFAULT 0,
            layout_y        INTEGER NOT NULL DEFAULT 0,
            layout_w        INTEGER NOT NULL DEFAULT 6,
            layout_h        INTEGER NOT NULL DEFAULT 4,
            refresh_minutes INTEGER,
            last_refreshed  TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_dashboard_cards_dashboard_id
            ON dashboard_cards (dashboard_id);
    """

    with admin_engine.connect() as conn:
        with conn.begin():
            for stmt in [s.strip() for s in ddl.strip().split(";") if s.strip()]:
                conn.execute(text(stmt))


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_card(row: dict) -> dict:
    if row.get("visualization") and isinstance(row["visualization"], str):
        try:
            row["visualization"] = json.loads(row["visualization"])
        except Exception:
            row["visualization"] = None
    return row


# ─── Dashboard CRUD ───────────────────────────────────────────────────────────

def create_dashboard(org_id: int, name: str, description: Optional[str] = None,
                     created_by: Optional[int] = None) -> dict:
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO dashboards (org_id, name, description, is_public, created_by, created_at, updated_at)
                VALUES (:org_id, :name, :description, 0, :created_by, :now, :now)
            """), {
                "org_id": org_id, "name": name,
                "description": description, "created_by": created_by, "now": now,
            })
        row = conn.execute(
            text("SELECT * FROM dashboards WHERE org_id=:org_id ORDER BY created_at DESC LIMIT 1"),
            {"org_id": org_id}
        ).mappings().first()
    return dict(row)


def get_dashboards(org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM dashboards WHERE org_id=:org_id ORDER BY updated_at DESC"),
            {"org_id": org_id}
        ).mappings().all()
    return [dict(r) for r in rows]


def get_dashboard(dashboard_id: int, org_id: int) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM dashboards WHERE id=:id AND org_id=:org_id"),
            {"id": dashboard_id, "org_id": org_id}
        ).mappings().first()
    return dict(row) if row else None


def get_dashboard_by_share_token(token: str) -> Optional[dict]:
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM dashboards WHERE share_token=:token AND is_public=1"),
            {"token": token}
        ).mappings().first()
    return dict(row) if row else None


def update_dashboard(dashboard_id: int, org_id: int, updates: dict) -> dict:
    allowed    = {"name", "description"}
    filtered   = {k: v for k, v in updates.items() if k in allowed}
    filtered["updated_at"] = datetime.utcnow().isoformat()
    filtered["id"]         = dashboard_id
    filtered["org_id"]     = org_id
    set_clause = ", ".join(f"{k}=:{k}" for k in filtered if k not in ("id", "org_id"))
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text(f"UPDATE dashboards SET {set_clause} WHERE id=:id AND org_id=:org_id"),
                filtered
            )
    return get_dashboard(dashboard_id, org_id)


def delete_dashboard(dashboard_id: int, org_id: int):
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("DELETE FROM dashboard_cards WHERE dashboard_id=:did AND org_id=:org_id"),
                {"did": dashboard_id, "org_id": org_id}
            )
            conn.execute(
                text("DELETE FROM dashboards WHERE id=:id AND org_id=:org_id"),
                {"id": dashboard_id, "org_id": org_id}
            )


def publish_dashboard(dashboard_id: int, org_id: int) -> str:
    """Make dashboard publicly shareable. Returns the share token."""
    token = secrets.token_urlsafe(16)
    now   = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE dashboards SET is_public=1, share_token=:token, updated_at=:now "
                     "WHERE id=:id AND org_id=:org_id"),
                {"token": token, "now": now, "id": dashboard_id, "org_id": org_id}
            )
    return token


def unpublish_dashboard(dashboard_id: int, org_id: int):
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("UPDATE dashboards SET is_public=0, share_token=NULL, updated_at=:now "
                     "WHERE id=:id AND org_id=:org_id"),
                {"now": now, "id": dashboard_id, "org_id": org_id}
            )


# ─── Card CRUD ────────────────────────────────────────────────────────────────

def add_card(dashboard_id: int, org_id: int, data: dict) -> dict:
    now = datetime.utcnow().isoformat()
    viz = data.get("visualization")
    if isinstance(viz, dict):
        viz = json.dumps(viz)

    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("""
                INSERT INTO dashboard_cards
                    (dashboard_id, org_id, title, query_text, response_text,
                     visualization, sql_query, card_type,
                     layout_x, layout_y, layout_w, layout_h,
                     refresh_minutes, created_at, updated_at)
                VALUES
                    (:dashboard_id, :org_id, :title, :query_text, :response_text,
                     :visualization, :sql_query, :card_type,
                     :layout_x, :layout_y, :layout_w, :layout_h,
                     :refresh_minutes, :now, :now)
            """), {
                "dashboard_id":   dashboard_id,
                "org_id":         org_id,
                "title":          data.get("title"),
                "query_text":     data.get("query_text"),
                "response_text":  data.get("response_text"),
                "visualization":  viz,
                "sql_query":      data.get("sql_query"),
                "card_type":      data.get("card_type", "query"),
                "layout_x":       data.get("layout_x", 0),
                "layout_y":       data.get("layout_y", 0),
                "layout_w":       data.get("layout_w", 6),
                "layout_h":       data.get("layout_h", 4),
                "refresh_minutes":data.get("refresh_minutes"),
                "now":            now,
            })
            # bump dashboard updated_at
            conn.execute(
                text("UPDATE dashboards SET updated_at=:now WHERE id=:id"),
                {"now": now, "id": dashboard_id}
            )
        row = conn.execute(
            text("SELECT * FROM dashboard_cards WHERE dashboard_id=:did ORDER BY created_at DESC LIMIT 1"),
            {"did": dashboard_id}
        ).mappings().first()
    return _parse_card(dict(row))


def get_cards(dashboard_id: int, org_id: int) -> list[dict]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM dashboard_cards WHERE dashboard_id=:did AND org_id=:org_id "
                 "ORDER BY layout_y, layout_x"),
            {"did": dashboard_id, "org_id": org_id}
        ).mappings().all()
    return [_parse_card(dict(r)) for r in rows]


def update_card(card_id: int, org_id: int, updates: dict) -> Optional[dict]:
    allowed  = {
        "title", "layout_x", "layout_y", "layout_w", "layout_h",
        "refresh_minutes", "response_text", "visualization",
    }
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return None
    if "visualization" in filtered and isinstance(filtered["visualization"], dict):
        filtered["visualization"] = json.dumps(filtered["visualization"])
    filtered["updated_at"] = datetime.utcnow().isoformat()
    filtered["id"]         = card_id
    filtered["org_id"]     = org_id
    set_clause = ", ".join(f"{k}=:{k}" for k in filtered if k not in ("id", "org_id"))
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text(f"UPDATE dashboard_cards SET {set_clause} WHERE id=:id AND org_id=:org_id"),
                filtered
            )
        row = conn.execute(
            text("SELECT * FROM dashboard_cards WHERE id=:id AND org_id=:org_id"),
            {"id": card_id, "org_id": org_id}
        ).mappings().first()
    return _parse_card(dict(row)) if row else None


def remove_card(card_id: int, org_id: int):
    with admin_engine.connect() as conn:
        with conn.begin():
            conn.execute(
                text("DELETE FROM dashboard_cards WHERE id=:id AND org_id=:org_id"),
                {"id": card_id, "org_id": org_id}
            )


def reorder_cards(dashboard_id: int, org_id: int, layout: list[dict]):
    """
    Bulk update card positions.
    layout = [{"id": 1, "x": 0, "y": 0, "w": 6, "h": 4}, ...]
    """
    now = datetime.utcnow().isoformat()
    with admin_engine.connect() as conn:
        with conn.begin():
            for item in layout:
                conn.execute(text("""
                    UPDATE dashboard_cards
                    SET layout_x=:x, layout_y=:y, layout_w=:w, layout_h=:h, updated_at=:now
                    WHERE id=:id AND org_id=:org_id AND dashboard_id=:did
                """), {
                    "x": item.get("x", 0), "y": item.get("y", 0),
                    "w": item.get("w", 6), "h": item.get("h", 4),
                    "now": now, "id": item["id"],
                    "org_id": org_id, "did": dashboard_id,
                })


async def refresh_card(card_id: int, org_id: int, org_conn_str: str, agent) -> dict:
    """Re-run the saved query and update the card's response + visualization."""
    with admin_engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM dashboard_cards WHERE id=:id AND org_id=:org_id"),
            {"id": card_id, "org_id": org_id}
        ).mappings().first()

    if not row or not row["query_text"]:
        return {"status": "error", "message": "Card not found or has no query"}

    try:
        result    = agent.run_query(row["query_text"], history=[])
        now       = datetime.utcnow().isoformat()
        viz_str   = json.dumps(result.get("visualization")) if result.get("visualization") else None

        with admin_engine.connect() as conn:
            with conn.begin():
                conn.execute(text("""
                    UPDATE dashboard_cards
                    SET response_text=:response, visualization=:viz,
                        last_refreshed=:now, updated_at=:now
                    WHERE id=:id AND org_id=:org_id
                """), {
                    "response": result.get("text", ""),
                    "viz":      viz_str,
                    "now":      now,
                    "id":       card_id,
                    "org_id":   org_id,
                })
        return {"status": "success", "card_id": card_id, "refreshed_at": now}
    except Exception as exc:
        logger.error(f"[Dashboards] Card refresh failed: {exc}")
        return {"status": "error", "message": str(exc)}