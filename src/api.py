import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

import sys
# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import AnalyticsAgent

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

load_dotenv()

app = FastAPI(
    title="Computer Store Analytics API",
    description="A RAG-powered analytics tool for querying store data using natural language.",
    version="1.0.0"
)

# Mount static files
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))

# --- Models ---
class QueryRequest(BaseModel):
    query: str
    history: Optional[List[dict]] = None
    db_path: Optional[str] = None

class QueryResponse(BaseModel):
    query: str
    response: str
    visualization: Optional[dict] = None
    status: str

# --- State ---
DEFAULT_DB = "identifier.sqlite.db"
agent = None

@app.on_event("startup")
async def startup_event():
    global agent
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("CRITICAL: HF_TOKEN not found in environment.")
        return
    # Initialize with default DB
    agent = AnalyticsAgent(hf_token, db_path=DEFAULT_DB)

@app.on_event("shutdown")
async def shutdown_event():
    if agent:
        agent.close()

# --- Endpoints ---
@app.get("/health")
async def health_check():
    return {"status": "healthy", "agent_initialized": agent is not None}

@app.get("/tables")
async def get_tables(db_path: Optional[str] = None):
    hf_token = os.environ.get("HF_TOKEN")
    
    # Use specified DB or default agent
    target_agent = agent
    is_transient = False
    
    if db_path and db_path != DEFAULT_DB:
        target_agent = AnalyticsAgent(hf_token, db_path=db_path)
        is_transient = True

    if not target_agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    try:
        tables = target_agent.db.list_tables()
        schemas = {}
        for table in tables:
            schemas[table] = target_agent.db.describe_table(table)
        return {"tables": tables, "schemas": schemas}
    finally:
        if is_transient:
            target_agent.close()

@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    hf_token = os.environ.get("HF_TOKEN")
    
    # Use specified DB or default agent
    target_agent = agent
    is_transient = False
    
    if request.db_path and request.db_path != DEFAULT_DB:
        target_agent = AnalyticsAgent(hf_token, db_path=request.db_path)
        is_transient = True

    if not target_agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    try:
        result = target_agent.run_query(request.query, request.history)
        return QueryResponse(
            query=request.query,
            response=result["text"],
            visualization=result["visualization"],
            status="success"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if is_transient:
            target_agent.close()

@app.get("/analytics")
async def get_analytics():
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    return {"query_count": len(agent.query_log), "logs": agent.query_log}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
