"""
card_comments.py — Threaded comments on dashboard cards (Feature #7)

Table: card_comments
  id, org_id, dashboard_id, card_id, user_id, display_name,
  parent_id (NULL = top-level thread), body, mentions (JSON array),
  created_at, updated_at, is_deleted
"""
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from models import admin_engine


# ── DDL ───────────────────────────────────────────────────────────────────────

def ensure_comment_tables() -> None:
    with admin_engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS card_comments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id      INTEGER NOT NULL,
                dashboard_id INTEGER NOT NULL,
                card_id     INTEGER NOT NULL,
                user_id     INTEGER,
                display_name TEXT NOT NULL DEFAULT 'Unknown',
                parent_id   INTEGER,
                body        TEXT NOT NULL,
                mentions    TEXT DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                is_deleted  INTEGER NOT NULL DEFAULT 0
            )
        """))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row(row) -> dict:
    d = dict(row._mapping)
    d["mentions"] = json.loads(d.get("mentions") or "[]")
    return d


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_comments(org_id: int, dashboard_id: int, card_id: int) -> list[dict]:
    """Return non-deleted comments for a card, sorted oldest-first."""
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT * FROM card_comments
                WHERE org_id = :org AND dashboard_id = :dash AND card_id = :card
                  AND is_deleted = 0
                ORDER BY created_at ASC
            """),
            {"org": org_id, "dash": dashboard_id, "card": card_id},
        ).fetchall()
    return [_row(r) for r in rows]


def create_comment(
    org_id: int,
    dashboard_id: int,
    card_id: int,
    user_id: Optional[int],
    display_name: str,
    body: str,
    parent_id: Optional[int] = None,
    mentions: Optional[list[str]] = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    mentions_json = json.dumps(mentions or [])
    with admin_engine.begin() as conn:
        result = conn.execute(
            text("""
                INSERT INTO card_comments
                    (org_id, dashboard_id, card_id, user_id, display_name, parent_id, body, mentions, created_at, updated_at, is_deleted)
                VALUES (:org, :dash, :card, :uid, :name, :parent, :body, :mentions, :now, :now, 0)
            """),
            {
                "org": org_id, "dash": dashboard_id, "card": card_id,
                "uid": user_id, "name": display_name,
                "parent": parent_id, "body": body,
                "mentions": mentions_json, "now": now,
            },
        )
        new_id = result.lastrowid
        row = conn.execute(text("SELECT * FROM card_comments WHERE id = :id"), {"id": new_id}).fetchone()
    return _row(row)


def update_comment(comment_id: int, org_id: int, user_id: Optional[int], body: str) -> Optional[dict]:
    now = datetime.now(timezone.utc).isoformat()
    with admin_engine.begin() as conn:
        existing = conn.execute(
            text("SELECT * FROM card_comments WHERE id = :id AND org_id = :org AND is_deleted = 0"),
            {"id": comment_id, "org": org_id},
        ).fetchone()
        if not existing:
            return None
        conn.execute(
            text("UPDATE card_comments SET body = :body, updated_at = :now WHERE id = :id"),
            {"body": body, "now": now, "id": comment_id},
        )
        row = conn.execute(text("SELECT * FROM card_comments WHERE id = :id"), {"id": comment_id}).fetchone()
    return _row(row)


def delete_comment(comment_id: int, org_id: int) -> bool:
    with admin_engine.begin() as conn:
        existing = conn.execute(
            text("SELECT id FROM card_comments WHERE id = :id AND org_id = :org"),
            {"id": comment_id, "org": org_id},
        ).fetchone()
        if not existing:
            return False
        conn.execute(
            text("UPDATE card_comments SET is_deleted = 1 WHERE id = :id"),
            {"id": comment_id},
        )
    return True


def count_comments(org_id: int, dashboard_id: int, card_ids: list[int]) -> dict[int, int]:
    """Return {card_id: count} for each card in card_ids."""
    if not card_ids:
        return {}
    placeholders = ",".join(str(c) for c in card_ids)
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                SELECT card_id, COUNT(*) as cnt FROM card_comments
                WHERE org_id = :org AND dashboard_id = :dash AND card_id IN ({placeholders}) AND is_deleted = 0
                GROUP BY card_id
            """),
            {"org": org_id, "dash": dashboard_id},
        ).fetchall()
    return {r.card_id: r.cnt for r in rows}
