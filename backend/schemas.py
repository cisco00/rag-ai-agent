"""
schemas.py — Centralized Pydantic models for the Vantage AI API.
"""

from pydantic import BaseModel, field_validator
from typing import List, Optional, Any, Dict
from datetime import datetime
import string

# ── Auth & Organization ──

class RegisterRequest(BaseModel):
    name: str
    email: Optional[str] = None

class ConfigRequest(BaseModel):
    connection_string: str

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterUserRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def strong_password(cls, v):
        special = set(string.digits + string.punctuation)
        if len(v) < 8 or not any(c in special for c in v):
            raise ValueError("Password must be ≥8 chars and contain a digit or special char.")
        return v

class InviteRequest(BaseModel):
    email: str
    role: str = "analyst"

class AcceptInviteRequest(BaseModel):
    token: str
    password: str
    display_name: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

# ── Analytics & Querying ──

class QueryRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    tables: Optional[List[str]] = None
    verify_only: bool = False
    confirmed_sql: Optional[str] = None
    use_file: bool = False

class QueryResponse(BaseModel):
    query: str
    response: str
    visualization: Optional[dict] = None
    status: str
    sql_query: Optional[str] = None
    thinking_process: Optional[List[Dict[str, Any]]] = None

class FeedbackRequest(BaseModel):
    query: str
    response: str
    vote: int
    feedback_text: Optional[str] = None

class SuggestQueriesResponse(BaseModel):
    queries: List[str]

# ── Data Management ──

class DataSourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    table_name: Optional[str] = None
    refresh_interval: Optional[int] = None
    last_synced_at: Optional[datetime] = None
    is_active: Optional[int] = 1
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
    refresh_interval: Optional[int] = None # in minutes

class ApiPreviewRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None

class CleaningConfig(BaseModel):
    # Auto cleaning
    drop_null_rows: bool = False
    drop_null_columns: bool = False
    drop_duplicates: bool = False
    # Manual: type conversions  {"col_name": "int"|"float"|"str"|"datetime"|"bool"}
    type_conversions: Optional[Dict[str, str]] = None
    # Manual: formatting  [{"column":"name","action":"lowercase"|"uppercase"|"trim"|"title"}]
    formatting: Optional[List[Dict[str, Any]]] = None
    # Manual: validation  [{"column":"age","rule":"min_value","value":0}, ...]
    validation_rules: Optional[List[Dict[str, Any]]] = None
    # Manual: exclude columns
    exclude_columns: Optional[List[str]] = None
    # Manual: row filters  [{"column":"status","op":"==","value":"active"}]
    row_filters: Optional[List[Dict[str, Any]]] = None

class ApiCleanImportRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None
    table_name: str
    if_exists: str = "replace"
    refresh_interval: Optional[int] = None
    cleaning_config: Optional[CleaningConfig] = None

class TransformRequest(BaseModel):
    table_name: str
    operations: List[Dict[str, Any]]
    target_table: Optional[str] = None

class TransformSuggestRequest(BaseModel):
    table_name: str
    prompt: str

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

# ── Alerts ──

class AlertRuleRequest(BaseModel):
    name: str
    is_active: Optional[int] = 1
    alert_type: str = "metric"
    table_name: Optional[str] = None
    column_name: Optional[str] = None
    aggregate: str = "avg"
    operator: str
    threshold_value: Optional[float] = None
    lookback_hours: int = 24
    notify_email: Optional[str] = None
    notify_webhook: Optional[str] = None
    cooldown_minutes: int = 60
    created_by: Optional[int] = None

# ── Advanced Analytics ──

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

# ── Dashboards ──

class DashboardRequest(BaseModel):
    name: str
    description: Optional[str] = None
    role_id: Optional[str] = None
    is_shared: bool = False

class CardRequest(BaseModel):
    title: str
    query_text: str
    response_text: Optional[str] = None
    visualization: Optional[Dict[str, Any]] = None
    sql_query: Optional[str] = None
    card_type: str = "query"
    layout_x: int = 0
    layout_y: int = 0
    layout_w: int = 6
    layout_h: int = 4

class CardLayoutItem(BaseModel):
    id: int
    layout_x: int
    layout_y: int
    layout_w: int
    layout_h: int

class PinQueryRequest(BaseModel):
    dashboard_id: int
    query_text: str
    response_text: str
    visualization: Optional[Dict[str, Any]] = None
    sql_query: Optional[str] = None
    title: Optional[str] = None

# ── Chat Sessions ──

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
    thinking_process: Optional[List[Dict[str, Any]]] = None
    created_at: datetime
    class Config:
        from_attributes = True

# ── Organization Context ──

class ContextEntryRequest(BaseModel):
    key: str
    definition: str
    context_type: str = "term"
    sql_snippet: Optional[str] = None
    examples: Optional[List[str]] = None

class ContextEntryResponse(BaseModel):
    id: str
    key: str
    definition: str
    context_type: str
    sql_snippet: Optional[str] = None
    examples: Optional[List] = None
    source: str
    confidence: float
    usage_count: int
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

# ── Branding ──

class BrandingRequest(BaseModel):
    org_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None

# ── Database & Reports ──

class CreateDatabaseRequest(BaseModel):
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    new_db_name: str
    new_user: str
    new_password: str
    email: Optional[str] = None

class ScheduledReportRequest(BaseModel):
    query: str
    frequency: str = "biweekly"
    recipients: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
