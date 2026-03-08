"""
dependencies.py — Shared FastAPI dependencies and in-process caches.

All routers import from here to share auth, connection helpers, and caches
instead of each redefining them.
"""
import os
import threading
import logging
from typing import Optional

from fastapi import Header, HTTPException

from models import get_org_by_api_key
from database import DatabaseManager

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Caches
# ---------------------------------------------------------------------------
FILE_DB_CACHE: dict = {}
FILE_DB_CACHE_LOCK = threading.Lock()

SCHEMA_CACHE: dict = {}
SCHEMA_CACHE_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
async def get_current_org(x_api_key: str = Header(...)):
    """Resolve the organization from the X-API-KEY header."""
    org = get_org_by_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return org

# ---------------------------------------------------------------------------
# Connection-string helpers
# ---------------------------------------------------------------------------
def get_org_connection_string(org, prefer_file_db: bool = False) -> Optional[str]:
    """Get connection string for org. If prefer_file_db, use file upload DB when available."""
    with FILE_DB_CACHE_LOCK:
        if prefer_file_db and org.api_key in FILE_DB_CACHE:
            return FILE_DB_CACHE[org.api_key]
        # prefer_file_db=False: prioritize org's configured database, fallback to file cache
        return org.db_connection_string or FILE_DB_CACHE.get(org.api_key)

def get_cached_schema_summary(connection_string: str) -> Optional[str]:
    """
    Get or create a schema summary string for a connection string.
    This speeds up LLM initialization by avoiding repeated list_tables/describe_table calls.
    """
    if not connection_string:
        return None
        
    with SCHEMA_CACHE_LOCK:
        if connection_string in SCHEMA_CACHE:
            return SCHEMA_CACHE[connection_string]
            
    # Cache miss - generate summary
    logger.info(f"Generating schema summary for cache: {connection_string[:20]}...")
    try:
        db_manager = DatabaseManager(connection_string=connection_string)
        try:
            tables = db_manager.list_tables()
            summary_parts = []
            for table in tables:
                schema = db_manager.describe_table(table)
                cols = ", ".join([f"{col[0]} ({col[1]})" for col in schema])
                summary_parts.append(f"Table '{table}': {cols}")
            
            summary = "\n".join(summary_parts)
            
            with SCHEMA_CACHE_LOCK:
                SCHEMA_CACHE[connection_string] = summary
                
            return summary
        finally:
            db_manager.close()
    except Exception as e:
        logger.error(f"Failed to generate schema summary: {e}")
        return None

