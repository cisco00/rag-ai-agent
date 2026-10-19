"""
routers/sessions.py — Chat session management.
"""

import json
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends

from models import (
    get_db, create_chat_session, get_chat_history, ChatSession, ChatMessage
)
from dependencies import get_current_org
from auth import get_current_user
from schemas import CreateSessionRequest, SessionResponse, MessageResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ──

@router.post("/chat/sessions", response_model=SessionResponse)
async def create_new_session(request: CreateSessionRequest, org=Depends(get_current_org), user=Depends(get_current_user)):
    """Create a new chat session."""
    try:
        session = create_chat_session(org.id, request.title, user_id=user["id"])
        return session
    except Exception as e:
        logger.error(f"Failed to create session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat/sessions", response_model=List[SessionResponse])
async def list_chat_sessions(org=Depends(get_current_org), user=Depends(get_current_user)):
    """List all chat sessions for the organization."""
    try:
        with get_db() as db:
            sessions = db.query(ChatSession).filter(
                ChatSession.org_id == org.id,
                ChatSession.user_id == user["id"]
            ).order_by(ChatSession.updated_at.desc()).all()
            for session in sessions:
                db.expunge(session)
            return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat/sessions/search")
async def search_chat_sessions(q: str = "", org=Depends(get_current_org), user=Depends(get_current_user)):
    """
    Search sessions by title or message content.
    Returns sessions with 'snippet' (matching excerpt), 'updated_at', and 'match_role'
    so the frontend can highlight the matched keyword and show a timestamp.
    User-role messages are preferred for snippets (shorter, more scannable).
    """
    def _make_snippet(text: str, keyword: str, ctx_before: int = 40, ctx_after: int = 100) -> str:
        """Extract ~140-char window around first keyword match."""
        if not text:
            return ""
        lo = text.lower()
        idx = lo.find(keyword.lower())
        if idx == -1:
            # Keyword not found in this exact text (ilike matched a variant) — use start
            return text[:140] + ("…" if len(text) > 140 else "")
        start = max(0, idx - ctx_before)
        end   = min(len(text), idx + len(keyword) + ctx_after)
        return ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")

    if not q or not q.strip():
        # Empty query — return all sessions (same as list)
        with get_db() as db:
            sessions = db.query(ChatSession).filter(
                ChatSession.org_id == org.id,
                ChatSession.user_id == user["id"]
            ).order_by(ChatSession.updated_at.desc()).limit(50).all()
            return [
                {
                    "id": s.id,
                    "title": s.title,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                    "snippet": None,
                    "match_role": None,
                }
                for s in sessions
            ]

    kw   = q.strip()
    term = f"%{kw}%"

    with get_db() as db:
        # Sessions whose title matches
        title_sessions = db.query(ChatSession).filter(
            ChatSession.org_id == org.id,
            ChatSession.user_id == user["id"],
            ChatSession.title.ilike(term),
        ).order_by(ChatSession.updated_at.desc()).limit(20).all()

        # All matching messages, ordered so user messages come first within each session
        msg_rows = (
            db.query(ChatMessage, ChatSession)
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .filter(
                ChatSession.org_id == org.id,
                ChatSession.user_id == user["id"],
                ChatMessage.content.ilike(term),
            )
            .order_by(
                ChatSession.updated_at.desc(),
                # Prefer role='user' (shorter, more meaningful snippets)
                ChatMessage.role.desc(),   # 'user' > 'assistant' lexicographically
            )
            .limit(60)
            .all()
        )

    # Merge, de-duplicate — keep best snippet per session (first user msg wins)
    seen: dict = {}

    for s in title_sessions:
        seen[s.id] = {
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at,
            "updated_at": s.updated_at,
            "snippet": None,
            "match_role": "title",
        }

    for msg, session in msg_rows:
        if session.id in seen and seen[session.id].get("snippet"):
            # Already have a snippet for this session — skip unless current is from a user msg
            # and the stored snippet is from an assistant msg
            if seen[session.id]["match_role"] != "assistant" or msg.role != "user":
                continue

        snippet = _make_snippet(msg.content or "", kw)
        seen[session.id] = {
            "id": session.id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "snippet": snippet,
            "match_role": msg.role,
        }

    results = list(seen.values())
    results.sort(key=lambda r: r["updated_at"] or r["created_at"], reverse=True)
    return results[:30]


@router.get("/chat/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_session_messages(session_id: str, org=Depends(get_current_org), user=Depends(get_current_user)):
    """Get messages for a chat session."""
    try:
        # Verify session ownership
        with get_db() as db:
            session = db.query(ChatSession).filter(
                ChatSession.id == session_id,
                ChatSession.org_id == org.id,
                ChatSession.user_id == user["id"]
            ).first()
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")

        db_messages = get_chat_history(session_id)
        responses = []
        for msg in db_messages:
            viz = None
            if msg.visualization:
                try:
                    viz = json.loads(msg.visualization)
                except Exception:
                    logger.warning(f"Failed to parse visualization for message {msg.id}")
            
            thought = None
            if msg.thinking_process:
                try:
                    thought = json.loads(msg.thinking_process)
                except Exception:
                    logger.warning(f"Failed to parse thinking process for message {msg.id}")

            responses.append({
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "visualization": viz,
                "thinking_process": thought,
                "created_at": msg.created_at
            })
        return responses
    except Exception as e:
        logger.error(f"Failed to get messages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, org=Depends(get_current_org), user=Depends(get_current_user)):
    """Delete a chat session."""
    try:
        with get_db() as db:
            session = db.query(ChatSession).filter(
                ChatSession.id == session_id,
                ChatSession.org_id == org.id,
                ChatSession.user_id == user["id"]
            ).first()
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
            
            db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
            db.delete(session)
            db.commit()
            return {"status": "success"}
    except HTTPException:
         raise
    except Exception as e:
        logger.error(f"Failed to delete session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
