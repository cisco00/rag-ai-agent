import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

import sys
# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import AnalyticsAgent

load_dotenv()

app = FastAPI(
    title="Computer Store Analytics API",
    description="A RAG-powered analytics tool for querying store data using natural language.",
    version="1.0.0"
)

# --- Models ---
class QueryRequest(BaseModel):
    query: str
    history: Optional[List[dict]] = None

class QueryResponse(BaseModel):
    query: str
    response: str
    status: str

# --- State ---
agent = None

@app.on_event("startup")
async def startup_event():
    global agent
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        # In a real app we might want to log this properly
        print("CRITICAL: HF_TOKEN not found in environment.")
        return
    agent = AnalyticsAgent(hf_token)

@app.on_event("shutdown")
async def shutdown_event():
    if agent:
        agent.close()

# --- Endpoints ---
@app.get("/health")
async def health_check():
    return {"status": "healthy", "agent_initialized": agent is not None}

@app.get("/tables")
async def get_tables():
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    tables = agent.db.list_tables()
    schemas = {}
    for table in tables:
        schemas[table] = agent.db.describe_table(table)
    
    return {"tables": tables, "schemas": schemas}

@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    try:
        response_text = agent.run_query(request.query, request.history)
        return QueryResponse(
            query=request.query,
            response=response_text,
            status="success"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics")
async def get_analytics():
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    return {"query_count": len(agent.query_log), "logs": agent.query_log}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
