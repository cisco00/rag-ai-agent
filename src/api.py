import os
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

import sys
# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import AnalyticsAgent
from models import init_admin_db, create_org, get_org_by_api_key, update_org_db

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(
    title="Vantage AI",
    description="A multi-tenant RAG-powered analytics tool for organizations.",
    version="2.0.0"
)

# Add CORS support for React development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, specify the actual origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.on_event("startup")
async def startup_event():
    init_admin_db()
    print("Admin database initialized.")

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))

# --- Models ---
class RegisterRequest(BaseModel):
    name: str

class ConfigRequest(BaseModel):
    connection_string: str

class QueryRequest(BaseModel):
    query: str
    history: Optional[List[dict]] = None

class QueryResponse(BaseModel):
    query: str
    response: str
    visualization: Optional[dict] = None
    status: str

# --- Security ---
async def get_current_org(x_api_key: str = Header(...)):
    org = get_org_by_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    if not org.db_connection_string:
         # For new orgs, we might allow them to hit /config but nothing else
         # However, to keep it simple, we'll just check it in the endpoints
         pass
    return org

# --- Endpoints ---
@app.post("/register")
async def register(request: RegisterRequest):
    try:
        org = create_org(request.name)
        return {
            "message": "Organization created successfully",
            "name": org.name,
            "api_key": org.api_key,
            "instruction": "Save your API key. You will need it for all subsequent requests as X-API-KEY header."
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail="Organization name already exists or registration failed.")

@app.post("/config")
async def configure_db(request: ConfigRequest, org=Depends(get_current_org)):
    update_org_db(org.api_key, request.connection_string)
    return {"status": "success", "message": "Database connection string updated."}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/tables")
async def get_tables(org=Depends(get_current_org)):
    if not org.db_connection_string:
        raise HTTPException(status_code=400, detail="Database connection not configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=org.db_connection_string)
    
    try:
        tables = agent.db.list_tables()
        schemas = {}
        for table in tables:
            schemas[table] = agent.db.describe_table(table)
        return {"tables": tables, "schemas": schemas}
    finally:
        agent.close()

@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, org=Depends(get_current_org)):
    if not org.db_connection_string:
        raise HTTPException(status_code=400, detail="Database connection not configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=org.db_connection_string)
    
    try:
        result = agent.run_query(request.query, request.history)
        return QueryResponse(
            query=request.query,
            response=result["text"],
            visualization=result["visualization"],
            status="success"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
