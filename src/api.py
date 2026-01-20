import os
import pandas as pd
import io
from fastapi import FastAPI, HTTPException, Depends, Header, Request, UploadFile, File
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

import sys
# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import AnalyticsAgent
from models import init_admin_db, create_org, get_org_by_api_key, update_org_db, create_shared_report, get_shared_report
from database import DatabaseManager

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

# Temporary store for file-based database paths
# In a real production app, this would be in a cache or persistent DB
FILE_DB_CACHE = {}

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
    use_file: Optional[bool] = False

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
    # Clear file cache if they switch to a real DB
    FILE_DB_CACHE.pop(org.api_key, None)
    return {"status": "success", "message": "Database connection string updated."}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), org=Depends(get_current_org)):
    content = await file.read()
    filename = file.filename
    
    try:
        if filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        elif filename.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Use CSV or Excel.")
        
        # Clean col names for SQL
        df.columns = [c.replace(' ', '_').replace('(', '').replace(')', '').lower() for c in df.columns]
        
        # Create a unique in-memory database for this org's file
        temp_db_path = f"file_db_{org.api_key}.sqlite"
        db_manager = DatabaseManager(connection_string=f"sqlite:///{temp_db_path}")
        
        # Load into table named 'uploaded_data'
        success = db_manager.load_dataframe(df, "uploaded_data")
        db_manager.close()
        
        if success:
            FILE_DB_CACHE[org.api_key] = f"sqlite:///{temp_db_path}"
            return {"status": "success", "message": f"File '{filename}' uploaded and processed.", "table_name": "uploaded_data"}
        else:
            raise Exception("Failed to load dataframe into SQL")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/tables")
async def get_tables(org=Depends(get_current_org)):
    # Check if there's an active file first
    conn_str = FILE_DB_CACHE.get(org.api_key) or org.db_connection_string
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
    try:
        tables = agent.db.list_tables()
        schemas = {}
        for table in tables:
            schemas[table] = agent.db.describe_table(table)
        return {"tables": tables, "schemas": schemas, "is_file": org.api_key in FILE_DB_CACHE}
    finally:
        agent.close()

@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, org=Depends(get_current_org)):
    # Determine which DB to use
    conn_str = None
    if request.use_file and org.api_key in FILE_DB_CACHE:
        conn_str = FILE_DB_CACHE[org.api_key]
    else:
        conn_str = org.db_connection_string or FILE_DB_CACHE.get(org.api_key)
        
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
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

@app.post("/share")
async def share_report(request: QueryRequest, org=Depends(get_current_org)):
    """Create a shareable link for an analysis result"""
    # Determine which DB to use
    conn_str = None
    if request.use_file and org.api_key in FILE_DB_CACHE:
        conn_str = FILE_DB_CACHE[org.api_key]
    else:
        conn_str = org.db_connection_string or FILE_DB_CACHE.get(org.api_key)
        
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database or file configured for this organization.")
    
    hf_token = os.environ.get("HF_TOKEN")
    agent = AnalyticsAgent(hf_token, connection_string=conn_str)
    
    try:
        result = agent.run_query(request.query, request.history)
        
        # Create shared report
        shared_report = create_shared_report(
            org_id=org.id,
            query=request.query,
            response=result["text"],
            visualization=result["visualization"]
        )
        
        # Generate shareable URL
        base_url = "http://localhost:8000"  # In production, use request.base_url
        share_url = f"{base_url}/shared/{shared_report.id}"
        
        return {
            "status": "success",
            "share_url": share_url,
            "report_id": shared_report.id,
            "expires_at": shared_report.expires_at.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        agent.close()

@app.get("/shared/{report_id}")
async def get_shared(report_id: str):
    """Public endpoint to view shared reports (no auth required)"""
    import json
    
    report = get_shared_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or expired")
    
    visualization = json.loads(report.visualization) if report.visualization else None
    
    return {
        "query": report.query,
        "response": report.response,
        "visualization": visualization,
        "created_at": report.created_at.isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
