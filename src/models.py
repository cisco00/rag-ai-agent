from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import secrets
import os
from datetime import datetime, timedelta
import json

Base = declarative_base()

class Organization(Base):
    __tablename__ = 'organizations'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    api_key = Column(String(64), unique=True, nullable=False)
    db_connection_string = Column(Text, nullable=True) # User's own DB connection string

class SharedReport(Base):
    __tablename__ = 'shared_reports'
    
    id = Column(String(32), primary_key=True)
    org_id = Column(Integer, nullable=False)
    query = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    visualization = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

# Setup admin database
ADMIN_DB_URL = "sqlite:///./admin.db"
engine = create_engine(ADMIN_DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_admin_db():
    Base.metadata.create_all(bind=engine)

def create_org(name: str):
    db = SessionLocal()
    api_key = secrets.token_urlsafe(32)
    org = Organization(name=name, api_key=api_key)
    db.add(org)
    db.commit()
    db.refresh(org)
    db.close()
    return org

def get_org_by_api_key(api_key: str):
    db = SessionLocal()
    org = db.query(Organization).filter(Organization.api_key == api_key).first()
    db.close()
    return org

def update_org_db(api_key: str, connection_string: str):
    db = SessionLocal()
    org = db.query(Organization).filter(Organization.api_key == api_key).first()
    if org:
        org.db_connection_string = connection_string
        db.commit()
    db.close()
    return org

def create_shared_report(org_id: int, query: str, response: str, visualization: dict = None, expires_in_days: int = 30):
    db = SessionLocal()
    report_id = secrets.token_urlsafe(16)
    expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
    
    report = SharedReport(
        id=report_id,
        org_id=org_id,
        query=query,
        response=response,
        visualization=json.dumps(visualization) if visualization else None,
        expires_at=expires_at
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    db.close()
    return report

def get_shared_report(report_id: str):
    db = SessionLocal()
    report = db.query(SharedReport).filter(SharedReport.id == report_id).first()
    
    # Check if expired
    if report and report.expires_at and report.expires_at < datetime.utcnow():
        db.close()
        return None
    
    db.close()
    return report
