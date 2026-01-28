"""
Database models for the RAG AI Agent API.

This module defines SQLAlchemy models for organizations and shared reports,
along with CRUD operations.
"""

from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Index
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from contextlib import contextmanager
from typing import Optional
import secrets
import os
from datetime import datetime, timedelta
import json

from logging_config import get_logger
from exceptions import OrganizationNotFoundError, DatabaseError

# Initialize logger
logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


class Organization(Base):
    """
    Organization model for multi-tenancy support.
    
    Each organization has a unique API key and can configure their own database.
    """
    __tablename__ = 'organizations'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    api_key = Column(String(64), unique=True, nullable=False, index=True)
    db_connection_string = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<Organization(id={self.id}, name='{self.name}')>"


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
        Base.metadata.create_all(bind=engine)
        logger.info("Admin database tables created successfully")
    except Exception as e:
        logger.error(f"Failed to create admin database tables: {e}", exc_info=True)
        raise DatabaseError(f"Failed to initialize admin database: {str(e)}") from e


def create_org(name: str) -> Organization:
    """
    Create a new organization with a unique API key.
    
    Args:
        name: Organization name
    
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
            org = Organization(name=name, api_key=api_key)
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
