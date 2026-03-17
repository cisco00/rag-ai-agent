"""
routers/sessions.py — routes migrated from monolithic api.py
"""

import os, io, json, math, time, threading, asyncio
from pathlib import Path
from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from models import (
    get_org_by_api_key, create_org, update_org_db, update_branding,
    create_shared_report, get_shared_report, get_org_shared_reports,
    ScheduledReport, get_db, create_feedback, create_query_history,
    get_org_history, DataSource, ChatSession, ChatMessage,
    create_chat_session, add_chat_message, get_chat_history
)
from database import DatabaseManager
from dependencies import get_current_org, get_org_connection_string, FILE_DB_CACHE, FILE_DB_CACHE_LOCK
from utils import send_email_mock, clean_llm_json_content
from validators import sanitize_table_name
from export_manager import ExportManager
from scheduler import schedule_job_for_report

logger = logging.getLogger(__name__)
router = APIRouter()



# ── Pydantic models ──

class RegisterRequest(BaseModel):
    name: str
    email: Optional[str] = None

class ConfigRequest(BaseModel):
    connection_string: str

class QueryRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    tables: Optional[List[str]] = None
    verify_only: bool = False
    confirmed_sql: Optional[str] = None

class QueryResponse(BaseModel):
    query: str
    response: str
    visualization: Optional[dict] = None
    status: str
    sql_query: Optional[str] = None

class FeedbackRequest(BaseModel):
    query: str
    response: str
    vote: int
    feedback_text: Optional[str] = None

class DataSourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    table_name: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class ApiImportRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None
    table_name: str
    if_exists: str = "replace"

class TransformRequest(BaseModel):
    table_name: str
    operations: List[Dict[str, Any]]
    target_table: Optional[str] = None

class TransformSuggestRequest(BaseModel):
    table_name: str
    prompt: str

class ForecastRequest(BaseModel):
    table_name: str
    date_column: str
    value_column: str
    periods: int = 30
    freq: str = 'D'

class AnomalyRequest(BaseModel):
    table_name: str
    value_column: str
    contamination: float = 0.05

class CorrelationRequest(BaseModel):
    table_name: str
    columns: Optional[List[str]] = None
    method: str = 'pearson'

class CreateSessionRequest(BaseModel):
    title: Optional[str] = None

class SessionResponse(BaseModel):
    id: str
    title: Optional[str] = None
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

class ContextEntryRequest(BaseModel):
    key: str
    definition: str
    context_type: str = "term"
    sql_snippet: Optional[str] = None
    examples: Optional[List[str]] = None

class ContextEntryResponse(BaseModel):
    id: str

class BrandingRequest(BaseModel):
    org_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None

class CreateDatabaseRequest(BaseModel):
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    new_db_name: str
    new_user: str
    new_password: str
    email: Optional[str] = None

class SuggestQueriesResponse(BaseModel):
    queries: List[str]

class UpdateCellRequest(BaseModel):
    row_id: Any
    column: str
    value: Any

class FillMissingRequest(BaseModel):
    strategy: str
    value: Optional[Any] = None
    weight_column: Optional[str] = None

class RenameColumnRequest(BaseModel):
    old_column: str
    new_column: str

class ScheduledReportRequest(BaseModel):
    query: str
    frequency: str = "biweekly"
    recipients: str



# ── Routes ──

@router.post("/chat/sessions", response_model=SessionResponse)
async def create_new_session(request: CreateSessionRequest, org=Depends(get_current_org)):
    """Create a new chat session."""
    try:
        session = create_chat_session(org.id, request.title)
        return session
    except Exception as e:
        logger.error(f"Failed to create session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat/sessions", response_model=List[SessionResponse])
async def list_chat_sessions(org=Depends(get_current_org)):
    """List all chat sessions for the organization."""
    try:
        with get_db() as db:
            sessions = db.query(ChatSession).filter(ChatSession.org_id == org.id).order_by(ChatSession.updated_at.desc()).all()
            # Detach from session to avoid lazy loading issues after session closes
            for session in sessions:
                db.expunge(session)
            return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_session_messages(session_id: str, org=Depends(get_current_org)):
    """Get messages for a chat session."""
    try:
        db_messages = get_chat_history(session_id)
        # Parse visualization JSON for each message
        responses = []
        for msg in db_messages:
            viz = None
            if msg.visualization:
                try:
                    viz = json.loads(msg.visualization)
                except Exception:
                    logger.warning(f"Failed to parse visualization for message {msg.id}")
            
            responses.append({
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "visualization": viz,
                "created_at": msg.created_at
            })
        return responses
    except Exception as e:
        logger.error(f"Failed to get messages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, org=Depends(get_current_org)):
    """Delete a chat session."""
    try:
        with get_db() as db:
            session = db.query(ChatSession).filter(
                ChatSession.id == session_id,
                ChatSession.org_id == org.id
            ).first()
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
            
            # Delete messages first
            db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
            db.delete(session)
            db.commit()
            return {"status": "success"}
    except HTTPException:
         raise
    except Exception as e:
        logger.error(f"Failed to delete session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


