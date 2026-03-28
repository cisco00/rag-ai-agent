"""
api.py — Production Ready Modular API Entry Point

Fixes applied
─────────────
Bug #9  — InsightScheduler now uses a real make_insight_engine factory instead
           of dummy_engine_factory that always returned None. Proactive insights
           were completely disabled. Ported from the old monolithic api.py.
Bug #13 — The routers/ package must exist (see routers/__init__.py and
           routers/stub.py). This file is the entry point; the actual route
           handlers live in the router modules.
Bug #14 — SPA catch-all route was registered with POST/PUT/DELETE/OPTIONS methods,
           causing it to intercept API requests (e.g. /auth/register returning 405)
           before they could reach the real router handlers. Fixed to GET-only.
"""

import os
import json
import asyncio
import logging
from typing import Optional
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models import init_admin_db, get_org_by_api_key, SessionLocal, Organization
from database import DatabaseManager
from scheduler import start_scheduler, shutdown_scheduler, refresh_jobs, run_organizational_learning
from org_context_manager import ensure_context_tables
from insight_engine import InsightScheduler, ensure_insight_tables
from auth import ensure_auth_tables
from alerts import ensure_alert_tables, evaluate_all_alerts, ALERT_CHECK_INTERVAL_MINUTES
from dashboards import ensure_dashboard_tables
from dependencies import get_org_connection_string
from job_queue import start_job_queue, stop_job_queue

from prometheus_fastapi_instrumentator import Instrumentator

# Domain Routers
from routers import auth, data, analytics, branding, sessions, transformations, alerts, dashboards, insights, org_context

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

insight_scheduler: Optional[InsightScheduler] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global insight_scheduler
    init_admin_db()
    ensure_insight_tables()

    start_scheduler()
    refresh_jobs()
    ensure_context_tables()
    ensure_auth_tables()
    ensure_alert_tables()
    ensure_dashboard_tables()

    # ── Alert evaluation via APScheduler ─────────────────────────────────────
    _ALERT_EVAL_TIMEOUT_S = int(ALERT_CHECK_INTERVAL_MINUTES * 60 * 0.8)
    _main_loop = asyncio.get_running_loop()

    def _run_evaluate_all_alerts():
        future = asyncio.run_coroutine_threadsafe(evaluate_all_alerts(), _main_loop)
        try:
            future.result(timeout=_ALERT_EVAL_TIMEOUT_S)
        except TimeoutError:
            logger.error(
                f"[Alerts] Evaluation timed out after {_ALERT_EVAL_TIMEOUT_S}s "
                f"(interval={ALERT_CHECK_INTERVAL_MINUTES}m)."
            )
        except Exception as _exc:
            logger.error(f"[Alerts] Scheduled evaluation raised: {_exc}", exc_info=True)

    from apscheduler.triggers.interval import IntervalTrigger
    from scheduler import scheduler as _scheduler
    try:
        _scheduler.add_job(
            _run_evaluate_all_alerts,
            trigger=IntervalTrigger(minutes=ALERT_CHECK_INTERVAL_MINUTES),
            id="alert_evaluator",
            replace_existing=True,
        )
        logger.info(f"Alert evaluator registered (interval={ALERT_CHECK_INTERVAL_MINUTES}m)")
        
        # ── Organizational Learning via APScheduler ─────────────────────────────
        _LEARNING_INTERVAL_MINUTES = 30
        _scheduler.add_job(
            run_organizational_learning,
            trigger=IntervalTrigger(minutes=_LEARNING_INTERVAL_MINUTES),
            id="org_learning_job",
            replace_existing=True,
        )
        logger.info(f"Organizational learning job registered (interval={_LEARNING_INTERVAL_MINUTES}m)")
    except Exception as _e:
        logger.warning(f"Could not register alert evaluator: {_e}")

    # ── Proactive Insight Scheduler ───────────────────────────────────────────
    # Fix #9: Restore the working engine factory instead of the dummy one that
    # always returned None, which silently disabled all proactive insights.
    def make_insight_engine(org_id: int):
        """
        Build an InsightEngine for the given org.
        Called by InsightScheduler on each tick for every org.
        """
        try:
            from main import AnalyticsAgent
            from insight_engine import InsightEngine

            with SessionLocal() as session:
                org = session.query(Organization).filter(Organization.id == org_id).first()
                if not org:
                    return None

            conn_str = get_org_connection_string(org)
            if not conn_str:
                return None

            db_manager = DatabaseManager(connection_string=conn_str)
            agent      = AnalyticsAgent(connection_string=conn_str)
            return InsightEngine(db_manager=db_manager, agent=agent, org_id=org_id)
        except Exception as exc:
            logger.warning(f"[Insights] Could not create engine for org {org_id}: {exc}")
            return None

    insight_scheduler = InsightScheduler(make_insight_engine, interval_minutes=60)
    await insight_scheduler.start()

    await start_job_queue()
    logger.info("Async job queue started")

    yield

    shutdown_scheduler()
    if insight_scheduler:
        await insight_scheduler.stop()
    await stop_job_queue()
    logger.info("Async job queue stopped")


app = FastAPI(
    title="Vantage AI",
    description="A multi-tenant RAG-powered analytics tool for organizations.",
    version="2.0.0",
    lifespan=lifespan,
    redirect_slashes=False
)

Instrumentator().instrument(app).expose(app)

# ── Request Logging Middleware ───────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every request method, path, headers, and response status code."""
    import time
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    logger.info(
        f"DEBUG REQ: {request.method} {request.url} "
        f"STATUS: {response.status_code} ({duration:.2f}s) "
        f"CLIENT: {request.client.host if request.client else 'unknown'}"
    )
    return response

@app.get("/debug/routes")
async def get_all_routes():
    """Return a list of all registered routes and their methods."""
    routes = []
    for r in app.routes:
        if hasattr(r, "path"):
            methods = list(getattr(r, "methods", []))
            routes.append({"path": r.path, "methods": methods, "name": getattr(r, "name", "")})
    return {"total": len(routes), "routes": routes}

@app.post("/app-level-post-test")
async def app_level_post_test():
    return {"message": "App-level POST works"}

# ── CORS ──────────────────────────────────────────────────────────────────────
_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]
_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
_raw_cors    = os.getenv("CORS_ORIGINS", "").strip()


def _parse_and_validate_origins(raw: str) -> list[str]:
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    bad = []
    for o in origins:
        if "*" in o:
            bad.append(f"{o!r} — wildcards are not allowed")
        elif not (o.startswith("http://") or o.startswith("https://")):
            bad.append(f"{o!r} — must start with http:// or https://")
    if bad:
        raise ValueError("Invalid CORS origins:\n  " + "\n  ".join(bad))
    seen: set[str] = set()
    return [x for x in origins if not (x in seen or seen.add(x))]  # type: ignore


if _raw_cors:
    try:
        cors_origins = _parse_and_validate_origins(_raw_cors)
    except ValueError as _cors_err:
        raise RuntimeError(
            f"[CORS] CORS_ORIGINS is invalid and the server cannot start safely.\n"
            f"{_cors_err}\n"
            "Fix CORS_ORIGINS in your .env or environment variables."
        ) from _cors_err
    logger.info(f"[CORS] Allowing origins: {cors_origins}")
else:
    if _ENVIRONMENT == "production":
        raise RuntimeError(
            "[CORS] CORS_ORIGINS must be set explicitly in production.\n"
            "Example: CORS_ORIGINS=https://app.vantage.ai\n"
            "Refusing to start — an unconfigured CORS allowlist would silently "
            "break authentication for every user."
        )
    cors_origins = _DEV_ORIGINS
    logger.warning(
        f"[CORS] CORS_ORIGINS not set — using dev defaults {_DEV_ORIGINS}. "
        "Set CORS_ORIGINS=<your frontend URL> before deploying to production."
    )

_CORS_ALLOW_HEADERS = ["*"]

_PERMISSIVE_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost", "http://127.0.0.1",
    "http://0.0.0.0:5173", "http://0.0.0.0"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins + _PERMISSIVE_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# SPA Fallback Path Logic
def get_static_dir():
    # Fix: api.py is in backend/, so project_root is parent of backend/
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # Try multiple standard locations
    dirs = [
        os.path.join(project_root, "frontend", "dist"),
        os.path.join(project_root, "front-end", "dist"),
        os.path.join(os.path.dirname(project_root), "frontend", "dist"),
        "/app/static",
        "/app/frontend/dist"
    ]
    for d in dirs:
        if os.path.exists(d):
            return d
    return dirs[0]  # Fallback to first

static_dir = get_static_dir()
logger.info(f"Using static directory: {static_dir} (exists: {os.path.exists(static_dir)})")

app.include_router(auth.router,            prefix="/auth",           tags=["Authentication"])
app.include_router(data.router,                                      tags=["Data Management"])
app.include_router(analytics.router,                                 tags=["Analytics"])
app.include_router(branding.router,                                  tags=["Branding"])
app.include_router(sessions.router,                                  tags=["Chat Sessions"])
app.include_router(transformations.router,                           tags=["Data Transformations"])
app.include_router(alerts.router,                                    tags=["Alerts"])
app.include_router(dashboards.router,                                tags=["Dashboards"])
app.include_router(insights.router,                                  tags=["Insights"])
app.include_router(org_context.router,                               tags=["Organization Context"])


@app.get("/")
async def root():
    """Root endpoint for health checks and API status."""
    return {
        "status": "online",
        "message": "Vantage AI API is running",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ── WebSocket Streaming ───────────────────────────────────────────────────────
@app.websocket("/ws/stream/{table_name}")
async def websocket_endpoint(websocket: WebSocket, table_name: str, api_key: Optional[str] = None):
    if not api_key:
        await websocket.close(code=4003)
        return
    org = get_org_by_api_key(api_key)
    if not org:
        await websocket.close(code=4003)
        return
    conn_str = get_org_connection_string(org)
    if not conn_str:
        await websocket.close(code=4000)
        return

    await websocket.accept()
    try:
        db = DatabaseManager(connection_string=conn_str)
        try:
            dialect      = db.engine.dialect.name
            id_col       = "ctid" if dialect == "postgresql" else "rowid"
            last_sent_id = None
            while True:
                query   = f"SELECT *, {id_col} as _stream_id FROM {table_name} ORDER BY {id_col} DESC LIMIT 1"
                results = db.execute_query(query)
                if results:
                    point      = results[0]
                    current_id = point.get("_stream_id")
                    if current_id != last_sent_id:
                        if "timestamp" not in point:
                            point["timestamp"] = datetime.now(timezone.utc).isoformat()
                        point.pop("_stream_id", None)
                        await websocket.send_text(json.dumps(point, default=str))
                        last_sent_id = current_id
                await asyncio.sleep(2)
        finally:
            db.close()
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {table_name}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()

# ── SPA Static Files ──────────────────────────────────────────────────────────
# Fix #14: The catch-all is GET-only. Registering it with POST/PUT/DELETE/OPTIONS
# caused FastAPI to match API requests (e.g. POST /auth/register) against this
# handler instead of the real router endpoints, producing spurious 405 errors.
if os.path.exists(static_dir):
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

# ── Uploads Static Files ──────────────────────────────────────────────────────
# Ensure uploads directory exists and is served
backend_dir = os.path.dirname(os.path.abspath(__file__))
uploads_root = os.path.join(backend_dir, "static", "uploads")
os.makedirs(uploads_root, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_root), name="uploads")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "Frontend not found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
