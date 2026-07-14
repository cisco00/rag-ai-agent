"""
Database models for the RAG AI Agent API.

This module defines SQLAlchemy models for organizations and shared reports,
along with CRUD operations.
"""

from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Index, text
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from contextlib import contextmanager
from typing import Optional, List, Dict
import secrets
import os
from datetime import datetime, timedelta
import json

from logging_config import get_logger
from exceptions import OrganizationNotFoundError, DatabaseError

from utils import encrypt_string, decrypt_string

# Initialize logger
logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


class EncryptedString(TypeDecorator):
    """
    Encrypts string data on the way into the database,
    and decrypts it on the way out.
    """
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return encrypt_string(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return decrypt_string(value)


class Organization(Base):
    """
    Organization model for multi-tenancy support.
    
    Each organization has a unique API key and can configure their own database.
    """
    __tablename__ = 'organizations'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), nullable=True)
    api_key = Column(String(64), unique=True, nullable=False, index=True)
    db_connection_string = Column(EncryptedString, nullable=True)
    branding = Column(Text, nullable=True)  # JSON: {org_name, tagline, primary_color, logo_url}
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<Organization(id={self.id}, name='{self.name}')>"

    def get_branding(self) -> dict:
        """Return branding config as dict with defaults."""
        defaults = {
            "org_name": self.name,
            "tagline": "Analytics Portal",
            "primary_color": "#2563eb",
            "logo_url": ""
        }
        if not self.branding:
            return defaults
        try:
            stored = json.loads(self.branding)
            return {**defaults, **stored}
        except Exception:
            return defaults


class SharedReport(Base):
    """
    Shared report model for shareable analysis results.
    
    Reports can be shared via a unique link and have an expiration date.
    """
    __tablename__ = 'shared_reports'
    
    id = Column(String(32), primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    query = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    visualization = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True, index=True)
    
    def __repr__(self):
        return f"<SharedReport(id='{self.id}', org_id={self.org_id})>"
    
    def is_expired(self) -> bool:
        """Check if the report has expired."""
        if self.expires_at is None:
            return False
        return self.expires_at < datetime.utcnow()
    
    def get_visualization(self) -> Optional[dict]:
        """Get visualization data as a dictionary."""
        if not self.visualization:
            return None
        try:
            return json.loads(self.visualization)
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse visualization for report {self.id}")
            return None


class ScheduledReport(Base):
    """
    Model for scheduled automated reports.
    """
    __tablename__ = 'scheduled_reports'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    query = Column(Text, nullable=False)
    frequency = Column(String(20), default="biweekly")  # daily, weekly, biweekly, monthly
    next_run_at = Column(DateTime, nullable=False, index=True)
    recipients = Column(Text, nullable=False)  # comma-separated emails
    is_active = Column(Integer, default=1)  # 1=active, 0=inactive (using Integer for SQLite boolean compat)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<ScheduledReport(id={self.id}, org_id={self.org_id}, freq='{self.frequency}')>"



class ConnectedDatabase(Base):
    """
    Model for tracking previously used database connections per organization.
    """
    __tablename__ = 'connected_databases'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    connection_string = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<ConnectedDatabase(id={self.id}, org_id={self.org_id})>"


class Feedback(Base):
    """
    Model for storing user feedback (thumbs up/down).
    """
    __tablename__ = 'feedback'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    query = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    vote = Column(Integer, nullable=False)  # 1 for up, -1 for down
    feedback_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<Feedback(id={self.id}, vote={self.vote})>"


class QueryHistory(Base):
    """
    Model for storing query history.
    """
    __tablename__ = 'query_history'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    query = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    visualization = Column(Text, nullable=True)  # JSON string
    sql_query = Column(Text, nullable=True)
    user_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<QueryHistory(id={self.id}, org_id={self.org_id})>"
    
    def get_visualization(self) -> Optional[dict]:
        """Get visualization data as a dictionary."""
        if not self.visualization:
            return None
        try:
            return json.loads(self.visualization)
        except json.JSONDecodeError:
            return None


class DataSource(Base):
    __tablename__ = 'data_sources'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    source_type = Column(String(50), nullable=False) # 'api', 'upload', 'database'
    connection_details = Column(Text, nullable=True) # JSON with URL, params, or filepath
    table_name = Column(String(255), nullable=True)
    refresh_interval = Column(Integer, nullable=True) # Interval in minutes
    last_synced_at = Column(DateTime, nullable=True)
    is_active = Column(Integer, default=1) # 1 for active, 0 for inactive
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<DataSource(id={self.id}, name='{self.name}', type='{self.source_type}')>"


class IntegrationCredential(Base):
    """
    Model for storing organization-specific CRM credentials (Client ID/Secret).
    """
    __tablename__ = 'integration_credentials'
    
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    provider = Column(String(50), nullable=False) # 'hubspot', 'salesforce'
    client_id = Column(EncryptedString, nullable=False)
    client_secret = Column(EncryptedString, nullable=False)
    redirect_uri = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<IntegrationCredential(org_id={self.org_id}, provider='{self.provider}')>"


class ChatSession(Base):
    __tablename__ = 'chat_sessions'
    
    id = Column(String(32), primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    title = Column(String(255), nullable=True)
    user_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<ChatSession(id='{self.id}', title='{self.title}')>"


class ChatMessage(Base):
    __tablename__ = 'chat_messages'
    
    id = Column(Integer, primary_key=True)
    session_id = Column(String(32), nullable=False, index=True) 
    role = Column(String(50), nullable=False) # 'user', 'assistant'
    content = Column(Text, nullable=False)
    visualization = Column(Text, nullable=True)  # JSON string
    thinking_process = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<ChatMessage(id={self.id}, role='{self.role}')>"

# Setup admin database
ADMIN_DB_URL = os.getenv("ADMIN_DB_URL", "sqlite:///./admin.db")

logger.info(f"Initializing admin database: {ADMIN_DB_URL}")

engine = create_engine(
    ADMIN_DB_URL,
    connect_args={"check_same_thread": False} if ADMIN_DB_URL.startswith("sqlite") else {},
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@contextmanager
def get_db():
    """
    Context manager for database sessions with proper cleanup.
    
    Usage:
        with get_db() as db:
            org = db.query(Organization).first()
    
    Yields:
        Database session
    """
    db = SessionLocal()
    try:
        logger.debug("Database session started")
        yield db
        db.commit()
        logger.debug("Database session committed")
    except Exception as e:
        db.rollback()
        logger.error(f"Database session rolled back: {e}", exc_info=True)
        raise
    finally:
        db.close()
        logger.debug("Database session closed")


def init_admin_db():
    """
    Initialize the admin database by creating all tables.
    """
    logger.info("Creating admin database tables")
    try:
        if ADMIN_DB_URL.startswith("sqlite"):
             Base.metadata.create_all(bind=engine)
        else:
             Base.metadata.create_all(bind=engine)
             
        # Manual migrations for new columns
        with engine.connect() as conn:
            with conn.begin():
                try:
                    conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE query_history ADD COLUMN user_id INTEGER"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE chat_messages ADD COLUMN thinking_process TEXT"))
                    logger.info("Migration: added thinking_process to chat_messages")
                except Exception as e:
                    logger.warning(f"Migration: chat_messages.thinking_process may already exist or error: {e}")
                
                # New migrations for DataSource refresh
                try:
                    conn.execute(text("ALTER TABLE data_sources ADD COLUMN refresh_interval INTEGER"))
                except Exception: pass
                try:
                    conn.execute(text("ALTER TABLE data_sources ADD COLUMN last_synced_at DATETIME"))
                except Exception: pass
                try:
                    conn.execute(text("ALTER TABLE data_sources ADD COLUMN is_active INTEGER DEFAULT 1"))
                except Exception: pass
                
                # New migration for integration_credentials table (if create_all skipped it)
                try:
                    conn.execute(text("""
                        CREATE TABLE IF NOT EXISTS integration_credentials (
                            id INTEGER PRIMARY KEY,
                            org_id INTEGER NOT NULL,
                            provider VARCHAR(50) NOT NULL,
                            client_id TEXT NOT NULL,
                            client_secret TEXT NOT NULL,
                            redirect_uri VARCHAR(255),
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME
                        )
                    """))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_integration_credentials_org_id ON integration_credentials (org_id)"))
                except Exception as e:
                    logger.warning(f"Migration: integration_credentials error: {e}")
                    
        logger.info("Admin database tables created and migrations applied")
    except Exception as e:
        logger.error(f"Failed to create admin database tables: {e}", exc_info=True)
        raise DatabaseError(f"Failed to initialize admin database: {str(e)}") from e


def create_chat_session(org_id: int, title: Optional[str] = None, user_id: Optional[int] = None) -> ChatSession:
    """Create a new chat session."""
    try:
        with get_db() as db:
            session_id = secrets.token_urlsafe(16)
            session = ChatSession(id=session_id, org_id=org_id, title=title, user_id=user_id)
            db.add(session)
            # Commit handled by context manager
            db.flush()
            db.refresh(session)
            db.expunge(session)
            return session
    except Exception as e:
        logger.error(f"Failed to create chat session: {e}", exc_info=True)
        raise DatabaseError(f"Failed to create chat session: {str(e)}") from e

def add_chat_message(session_id: str, role: str, content: str, 
                     visualization: Optional[dict] = None, 
                     thinking_process: Optional[list] = None) -> ChatMessage:
    """Add a message to a chat session."""
    try:
        with get_db() as db:
            viz_json = json.dumps(visualization) if visualization else None
            thought_json = json.dumps(thinking_process) if thinking_process else None
            msg = ChatMessage(
                session_id=session_id, 
                role=role, 
                content=content, 
                visualization=viz_json,
                thinking_process=thought_json
            )
            db.add(msg)
            db.flush()
            db.refresh(msg)
            db.expunge(msg)
            return msg
    except Exception as e:
        logger.error(f"Failed to add chat message: {e}", exc_info=True)
        raise DatabaseError(f"Failed to add chat message: {str(e)}") from e

def get_chat_history(session_id: str) -> list[ChatMessage]:
    """Get all messages for a session."""
    try:
        with get_db() as db:
            messages = db.query(ChatMessage).filter(
                ChatMessage.session_id == session_id
            ).order_by(ChatMessage.created_at.asc()).all()
            # Expunge all
            for msg in messages:
                db.expunge(msg)
            return messages
    except Exception as e:
        logger.error(f"Failed to get chat history: {e}", exc_info=True)
        raise DatabaseError(f"Failed to get chat history: {str(e)}") from e


def create_org(name: str, email: Optional[str] = None) -> Organization:
    """
    Create a new organization with a unique API key.
    
    Args:
        name: Organization name
        email: Optional organization email
    
    Returns:
        Created Organization instance
    
    Raises:
        DatabaseError: If creation fails
    """
    logger.info(f"Creating organization: {name}")
    
    try:
        with get_db() as db:
            # Generate unique API key
            api_key = secrets.token_urlsafe(32)
            
            # Create organization
            org = Organization(name=name, email=email, api_key=api_key)
            db.add(org)
            db.flush()
            db.refresh(org)
            
            logger.info(
                f"Organization created successfully",
                extra={"org_id": org.id, "org_name": name}
            )
            
            # Detach from session
            db.expunge(org)
            
            return org
    
    except Exception as e:
        # Check for unique constraint violation
        if "UNIQUE constraint failed" in str(e) or "psycopg2.errors.UniqueViolation" in str(e):
             # Rollback is already handled by the context manager, but we need to ensure
             # the error is clear
             logger.warning(f"Organization with name '{name}' already exists")
             raise DatabaseError(f"Organization with name '{name}' already exists. Please choose a different name.") from e
        
        logger.error(f"Failed to create organization: {e}", exc_info=True)
        raise DatabaseError(f"Failed to create organization: {str(e)}") from e


def get_org_by_api_key(api_key: str) -> Optional[Organization]:
    """
    Get organization by API key.
    
    Args:
        api_key: API key to search for
    
    Returns:
        Organization if found, None otherwise
    
    Raises:
        DatabaseError: If query fails
    """
    logger.debug(f"Looking up organization by API key")
    
    try:
        with get_db() as db:
            org = db.query(Organization).filter(
                Organization.api_key == api_key
            ).first()
            
            if org:
                # Detach from session to avoid lazy loading issues
                db.expunge(org)
                logger.debug(f"Organization found: {org.name}")
            else:
                logger.debug("Organization not found")
            
            return org
    
    except Exception as e:
        logger.error(f"Failed to get organization: {e}", exc_info=True)
        raise DatabaseError(f"Failed to get organization: {str(e)}") from e


def get_org_by_id(org_id: int) -> Optional[Organization]:
    """
    Get organization by ID.

    Added to support routers and dependencies that look up orgs by primary key.
    """
    try:
        with get_db() as db:
            org = db.query(Organization).filter(Organization.id == org_id).first()
            if org:
                db.expunge(org)
            return org
    except Exception as e:
        logger.error(f"Failed to get organization by id: {e}", exc_info=True)
        raise DatabaseError(f"Failed to get organization by id: {str(e)}") from e


def get_user_by_id(user_id: int) -> Optional[dict]:
    """
    Thin shim so that any code importing get_user_by_id from models
    still works. The real implementation lives in auth.py.
    """
    from auth import get_user_by_id as _get
    return _get(user_id)


def update_org_db(api_key: str, connection_string: str) -> Organization:
    """
    Update organization's database connection string.
    
    Args:
        api_key: Organization's API key
        connection_string: New database connection string
    
    Returns:
        Updated Organization instance
    
    Raises:
        OrganizationNotFoundError: If organization not found
        DatabaseError: If update fails
    """
    logger.info("Updating organization database configuration")
    
    try:
        with get_db() as db:
            org = db.query(Organization).filter(
                Organization.api_key == api_key
            ).first()
            
            if not org:
                raise OrganizationNotFoundError(api_key)
            
            org.db_connection_string = connection_string
            db.flush()
            db.refresh(org)
            
            logger.info(
                f"Organization database updated",
                extra={"org_id": org.id, "org_name": org.name}
            )
            
            # Detach from session
            db.expunge(org)
            
            return org
    
    except OrganizationNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Failed to update organization: {e}", exc_info=True)
        raise DatabaseError(f"Failed to update organization: {str(e)}") from e


def log_connection(org_id: int, connection_string: str):
    """Save a connection string to the history for an organization."""
    try:
        with get_db() as db:
            # Check if it already exists in history to avoid duplicates
            exists = db.query(ConnectedDatabase).filter(
                ConnectedDatabase.org_id == org_id,
                ConnectedDatabase.connection_string == connection_string
            ).first()
            
            if not exists:
                conn_hist = ConnectedDatabase(org_id=org_id, connection_string=connection_string)
                db.add(conn_hist)
                db.flush()
                logger.debug(f"Logged new connection for org {org_id}")
    except Exception as e:
        logger.error(f"Failed to log connection for org {org_id}: {e}")


def create_data_source(
    org_id: int,
    name: str,
    source_type: str,
    connection_details: dict,
    table_name: Optional[str] = None,
    refresh_interval: Optional[int] = None
) -> DataSource:
    """Create a new data source record."""
    try:
        with get_db() as db:
            source = DataSource(
                org_id=org_id,
                name=name,
                source_type=source_type,
                connection_details=json.dumps(connection_details),
                table_name=table_name,
                refresh_interval=refresh_interval
            )
            db.add(source)
            db.flush()
            db.refresh(source)
            db.expunge(source)
            return source
    except Exception as e:
        logger.error(f"Failed to create data source: {e}")
        return None


def get_org_data_sources(org_id: int) -> List[DataSource]:
    """Get all data sources for an organization."""
    try:
        with get_db() as db:
            sources = db.query(DataSource).filter(DataSource.org_id == org_id).all()
            for s in sources:
                db.expunge(s)
            return sources
    except Exception as e:
        logger.error(f"Failed to get data sources: {e}")
        return []


def update_data_source_sync(source_id: int, last_synced_at: datetime):
    """Update last sync timestamp for a data source."""
    try:
        with get_db() as db:
            source = db.query(DataSource).filter(DataSource.id == source_id).first()
            if source:
                source.last_synced_at = last_synced_at
                db.flush()
    except Exception as e:
        logger.error(f"Failed to update data source sync: {e}")


def get_integration_credential(org_id: int, provider: str) -> Optional[IntegrationCredential]:
    """Fetch credentials for a specific org and provider."""
    try:
        with get_db() as db:
            cred = db.query(IntegrationCredential).filter(
                IntegrationCredential.org_id == org_id,
                IntegrationCredential.provider == provider
            ).first()
            if cred:
                db.expunge(cred)
            return cred
    except Exception as e:
        logger.error(f"Failed to get integration credential: {e}")
        return None


def save_integration_credential(org_id: int, provider: str, client_id: str, client_secret: str, redirect_uri: Optional[str] = None) -> IntegrationCredential:
    """Save or update integration credentials."""
    try:
        with get_db() as db:
            cred = db.query(IntegrationCredential).filter(
                IntegrationCredential.org_id == org_id,
                IntegrationCredential.provider == provider
            ).first()
            
            if cred:
                cred.client_id = client_id
                cred.client_secret = client_secret
                cred.redirect_uri = redirect_uri
            else:
                cred = IntegrationCredential(
                    org_id=org_id,
                    provider=provider,
                    client_id=client_id,
                    client_secret=client_secret,
                    redirect_uri=redirect_uri
                )
                db.add(cred)
            
            db.flush()
            db.refresh(cred)
            db.expunge(cred)
            return cred
    except Exception as e:
        logger.error(f"Failed to save integration credential: {e}", exc_info=True)
        return None


def get_org_connection_history(org_id: int) -> list[str]:
    """Retrieve unique connection strings previously used by the organization."""
    try:
        with get_db() as db:
            rows = db.query(ConnectedDatabase).filter(
                ConnectedDatabase.org_id == org_id
            ).order_by(ConnectedDatabase.created_at.desc()).all()
            
            # Extract strings, ensuring uniqueness while preserving order
            seen = set()
            history = []
            for r in rows:
                if r.connection_string not in seen:
                    history.append(r.connection_string)
                    seen.add(r.connection_string)
            return history
    except Exception as e:
        logger.error(f"Failed to get connection history for org {org_id}: {e}")
        return []


def update_branding(api_key: str, branding_data: dict) -> Organization:
    """Save branding config for an organization."""
    try:
        with get_db() as db:
            org = db.query(Organization).filter(
                Organization.api_key == api_key
            ).first()
            if not org:
                raise OrganizationNotFoundError(api_key)
            org.branding = json.dumps(branding_data)
            db.flush()
            db.refresh(org)
            db.expunge(org)
            return org
    except OrganizationNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Failed to update branding: {e}", exc_info=True)
        raise DatabaseError(f"Failed to update branding: {str(e)}") from e


def create_shared_report(
    org_id: int,
    query: str,
    response: str,
    visualization: Optional[dict] = None,
    expires_in_days: int = 30
) -> SharedReport:
    """
    Create a shareable report.
    
    Args:
        org_id: Organization ID
        query: Original query
        response: Agent's response
        visualization: Optional visualization data
        expires_in_days: Number of days until expiration
    
    Returns:
        Created SharedReport instance
    
    Raises:
        DatabaseError: If creation fails
    """
    logger.info(f"Creating shared report for org {org_id}")
    
    try:
        with get_db() as db:
            # Generate unique report ID
            report_id = secrets.token_urlsafe(16)
            
            # Calculate expiration
            expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
            
            # Create report
            report = SharedReport(
                id=report_id,
                org_id=org_id,
                query=query,
                response=response,
                visualization=json.dumps(visualization) if visualization else None,
                expires_at=expires_at
            )
            
            db.add(report)
            db.flush()
            db.refresh(report)
            
            logger.info(
                f"Shared report created",
                extra={"report_id": report_id, "org_id": org_id}
            )
            
            # Detach from session
            db.expunge(report)
            
            return report
    
    except Exception as e:
        logger.error(f"Failed to create shared report: {e}", exc_info=True)
        raise DatabaseError(f"Failed to create shared report: {str(e)}") from e


def get_shared_report(report_id: str) -> Optional[SharedReport]:
    """
    Get a shared report by ID.
    
    Args:
        report_id: Report ID
    
    Returns:
        SharedReport if found and not expired, None otherwise
    
    Raises:
        DatabaseError: If query fails
    """
    logger.debug(f"Looking up shared report: {report_id}")
    
    try:
        with get_db() as db:
            report = db.query(SharedReport).filter(
                SharedReport.id == report_id
            ).first()
            
            # Check if report exists and is not expired
            if report:
                if report.is_expired():
                    logger.debug(f"Report {report_id} has expired")
                    return None
                
                # Detach from session
                db.expunge(report)
                logger.debug(f"Shared report found: {report_id}")
            else:
                logger.debug(f"Shared report not found: {report_id}")
            
            return report
    
    except Exception as e:
        logger.error(f"Failed to get shared report: {e}", exc_info=True)
        raise DatabaseError(f"Failed to get shared report: {str(e)}") from e


def get_org_shared_reports(org_id: int, limit: int = 50) -> list[SharedReport]:
    """
    Get all active shared reports for an organization.
    """
    logger.debug(f"Fetching shared reports for org {org_id}")
    
    try:
        with get_db() as db:
            reports = db.query(SharedReport).filter(
                SharedReport.org_id == org_id
            ).order_by(SharedReport.created_at.desc()).limit(limit).all()
            
            # Filter out expired reports and detach
            active_reports = []
            for item in reports:
                if not item.is_expired():
                    db.expunge(item)
                    active_reports.append(item)
                
            return active_reports
            
    except Exception as e:
        logger.error(f"Failed to get shared reports: {e}", exc_info=True)
        return []


def create_feedback(
    org_id: int,
    query: str,
    response: str,
    vote: int,
    feedback_text: Optional[str] = None
) -> Feedback:
    """
    Create a new feedback entry.
    
    Args:
        org_id: Organization ID
        query: User query
        response: Assistant response
        vote: 1 (up) or -1 (down)
        feedback_text: Optional text feedback
    
    Returns:
        Created Feedback instance
    """
    logger.info(f"Creating feedback for org {org_id}, vote={vote}")
    
    try:
        with get_db() as db:
            feedback = Feedback(
                org_id=org_id,
                query=query,
                response=response,
                vote=vote,
                feedback_text=feedback_text
            )
            db.add(feedback)
            db.flush()
            db.refresh(feedback)
            
            # Detach
            db.expunge(feedback)
            return feedback
            
    except Exception as e:
        logger.error(f"Failed to create feedback: {e}", exc_info=True)
        raise DatabaseError(f"Failed to create feedback: {str(e)}") from e


def create_query_history(
    org_id: int,
    query: str,
    response: str,
    visualization: Optional[dict] = None,
    sql_query: Optional[str] = None,
    user_id: Optional[int] = None
) -> QueryHistory:
    """
    Create a new query history entry.
    """
    logger.info(f"Saving query history for org {org_id}")
    
    try:
        with get_db() as db:
            history = QueryHistory(
                org_id=org_id,
                query=query,
                response=response,
                visualization=json.dumps(visualization) if visualization else None,
                sql_query=sql_query,
                user_id=user_id
            )
            db.add(history)
            db.flush()
            db.refresh(history)
            db.expunge(history)
            return history
            
    except Exception as e:
        logger.error(f"Failed to save query history: {e}", exc_info=True)
        # Don't raise, just log error as this is non-critical
        return None


def get_org_history(org_id: int, limit: int = 50, user_id: Optional[int] = None) -> list[QueryHistory]:
    """
    Get query history for an organization.
    """
    logger.debug(f"Fetching history for org {org_id}")
    
    try:
        with get_db() as db:
            query_obj = db.query(QueryHistory).filter(
                QueryHistory.org_id == org_id
            )
            
            if user_id is not None:
                query_obj = query_obj.filter(QueryHistory.user_id == user_id)
                
            history = query_obj.order_by(QueryHistory.created_at.desc()).limit(limit).all()
            
            # Detach
            for item in history:
                db.expunge(item)
                
            return history
            
    except Exception as e:
        logger.error(f"Failed to get query history: {e}", exc_info=True)
        return []