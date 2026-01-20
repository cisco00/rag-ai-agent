from sqlalchemy import create_engine, Column, Integer, String, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import secrets
import os

Base = declarative_base()

class Organization(Base):
    __tablename__ = 'organizations'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    api_key = Column(String(64), unique=True, nullable=False)
    db_connection_string = Column(Text, nullable=True) # User's own DB connection string

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
