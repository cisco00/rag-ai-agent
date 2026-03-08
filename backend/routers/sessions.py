"""router: sessions — chat session persistence endpoints."""
import json
import logging

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

from models import (
    get_db, ChatSession, ChatMessage,
    create_chat_session, get_chat_history,
)
from dependencies import get_current_org

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat")


class CreateSessionRequest(BaseModel):
    title: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    visualization: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/sessions", response_model=SessionResponse)
async def create_new_session(request: CreateSessionRequest, org=Depends(get_current_org)):
    """Create a new chat session."""
    try:
        session = create_chat_session(org.id, request.title)
        return session
    except Exception as e:
        logger.error(f"Failed to create session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions", response_model=List[SessionResponse])
async def list_chat_sessions(org=Depends(get_current_org)):
    """List all chat sessions for the organization."""
    try:
        with get_db() as db:
            sessions = (
                db.query(ChatSession)
                .filter(ChatSession.org_id == org.id)
                .order_by(ChatSession.updated_at.desc())
                .all()
            )
            for session in sessions:
                db.expunge(session)
            return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_session_messages(session_id: str, org=Depends(get_current_org)):
    """Get messages for a chat session."""
    try:
        db_messages = get_chat_history(session_id)
        responses = []
        for msg in db_messages:
            viz = None
            if msg.visualization:
                try:
                    viz = json.loads(msg.visualization)
                except Exception:
                    logger.warning(f"Failed to parse visualization for message {msg.id}")
            responses.append(
                {
                    "id": msg.id,
                    "role": msg.role,
                    "content": msg.content,
                    "visualization": viz,
                    "created_at": msg.created_at,
                }
            )
        return responses
    except Exception as e:
        logger.error(f"Failed to get messages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, org=Depends(get_current_org)):
    """Delete a chat session."""
    try:
        with get_db() as db:
            session = (
                db.query(ChatSession)
                .filter(ChatSession.id == session_id, ChatSession.org_id == org.id)
                .first()
            )
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
