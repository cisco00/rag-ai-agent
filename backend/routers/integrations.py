from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from fastapi.responses import RedirectResponse, HTMLResponse
from typing import List, Optional, Any, Dict
import os
import json
import logging
import httpx
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError

from models import get_db, DataSource, create_data_source, update_data_source_sync, get_integration_credential, save_integration_credential
from dependencies import get_current_org, require_permission, JWT_SECRET, JWT_ALGORITHM
from schemas import CRMAuthRequest, CRMSyncRequest, DataSourceResponse

router = APIRouter()
logger = logging.getLogger(__name__)

def generate_state_token(api_key: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    return jwt.encode({"api_key": api_key, "exp": expire, "type": "oauth_state"}, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_state_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "oauth_state":
            raise ValueError("Invalid state token type")
        return payload.get("api_key")
    except JWTError:
        raise ValueError("Invalid or expired state token")

# Mock settings for demonstration
MOCK_MODE = os.getenv("CRM_MOCK_MODE", "true").lower() == "true"

@router.get("/available")
async def get_available_integrations(user=Depends(require_permission("MANAGE_SYNCS"))):
    """List supported CRM integrations."""
    logger.info("Fetching available integrations...")
    return [
        {
            "id": "salesforce",
            "name": "Salesforce",
            "icon": "cloud",
            "description": "Sync Leads, Contacts, and Opportunities.",
            "status": "ready"
        },
        {
            "id": "hubspot",
            "name": "HubSpot",
            "icon": "sprout",
            "description": "Sync Contacts, Companies, and Deals.",
            "status": "ready"
        }
    ]

@router.get("/{provider}/auth-url")
async def get_crm_auth_url(provider: str, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Get the OAuth initiation URL for a CRM provider."""
    if provider not in ["salesforce", "hubspot"]:
        raise HTTPException(status_code=400, detail="Unsupported provider")

    state_token = generate_state_token(org.api_key)

    if MOCK_MODE:
        # Pass a mock URL that pointing to our local callback
        host = os.getenv("BACKEND_URL", "http://localhost:8000")
        return {"url": f"{host}/integrations/{provider}/callback?code=mock_code_123&state={state_token}"}

    # Priority 1: Org-specific credentials
    cred = get_integration_credential(org.id, provider)
    
    if cred:
        client_id = cred.client_id
        redirect_uri = cred.redirect_uri or os.getenv("CRM_CALLBACK_URL", f"{os.getenv('BACKEND_URL', 'http://localhost:8000').rstrip('/')}/integrations/{provider}/callback")
    else:
        # Priority 2: System defaults
        client_id = os.getenv(f"{provider.upper()}_CLIENT_ID")
        redirect_uri = os.getenv("CRM_CALLBACK_URL", f"{os.getenv('BACKEND_URL', 'http://localhost:8000').rstrip('/')}/integrations/{provider}/callback")

    if not client_id and not MOCK_MODE:
        raise HTTPException(status_code=400, detail=f"{provider} Client ID not configured for your organization. Please provide it in the Config modal.")

    if provider == "salesforce":
        auth_url = f"https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&state={state_token}"
    else: # HubSpot
        auth_url = f"https://app.hubspot.com/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&scope=contacts%20deals%20companies&state={state_token}"

    if MOCK_MODE:
        host = os.getenv("BACKEND_URL", "http://localhost:8000")
        return {"url": f"{host}/integrations/{provider}/callback?code=mock_code_123&state={state_token}"}

    return {"url": auth_url}

@router.get("/{provider}/auth")
async def crm_auth(provider: str, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Keep for backward compatibility or direct calls if API key is provided."""
    res = await get_crm_auth_url(provider, org)
    return RedirectResponse(url=res["url"])

@router.get("/{provider}/callback")
async def crm_callback(provider: str, code: str, state: Optional[str] = None):
    """Handle OAuth callback and store tokens."""
    # State usually contains the org's API key or session ID to link the connection
    if not state:
        raise HTTPException(status_code=400, detail="Missing state parameter")

    try:
        api_key = decode_state_token(state)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from models import get_org_by_api_key
    org = get_org_by_api_key(api_key)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    try:
        if MOCK_MODE:
            tokens = {
                "access_token": f"mock_{provider}_access_token",
                "refresh_token": f"mock_{provider}_refresh_token",
                "instance_url": f"https://mock-{provider}.com",
                "expires_at": (datetime.now().timestamp() + 3600)
            }
        else:
            # Real token exchange logic
            cred = get_integration_credential(org.id, provider)
            if cred:
                client_id = cred.client_id
                client_secret = cred.client_secret
                redirect_uri = cred.redirect_uri or os.getenv("CRM_CALLBACK_URL")
            else:
                client_id = os.getenv(f"{provider.upper()}_CLIENT_ID")
                client_secret = os.getenv(f"{provider.upper()}_CLIENT_SECRET")
                redirect_uri = os.getenv("CRM_CALLBACK_URL")

            token_url = "https://login.salesforce.com/services/oauth2/token" if provider == "salesforce" else "https://api.hubapi.com/oauth/v1/token"
            
            async with httpx.AsyncClient() as client:
                resp = await client.post(token_url, data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri
                })
                if resp.status_code != 200:
                    logger.error(f"Token exchange failed: {resp.text}")
                    return RedirectResponse(url=f"/integrations?status=error&message=Token+exchange+failed")
                tokens = resp.json()

        # Store as a DataSource
        source_name = f"{provider.capitalize()} CRM"
        source = create_data_source(
            org_id=org.id,
            name=source_name,
            source_type=f"crm_{provider}",
            connection_details=tokens,
            refresh_interval=60 # Default 1 hour
        )

        # Redirect to a page that closes the popup and notifies the parent
        return RedirectResponse(url="/integrations/callback-success")
    except Exception as e:
        logger.error(f"CRM Callback error: {e}")
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
        return RedirectResponse(url=f"{frontend_url}/integrations?status=error&message={str(e)}")

async def _sync_task(source, org, objects):
    from crm_sync import run_crm_sync
    try:
        await run_crm_sync(source, org, objects=objects)
        update_data_source_sync(source.id, datetime.now())
    except Exception as e:
        logger.error(f"Background sync failed: {e}")

@router.post("/sync")
async def sync_crm(request: CRMSyncRequest, background_tasks: BackgroundTasks, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Trigger a sync for a CRM data source."""
    from models import get_db
    with get_db() as db:
        source = db.query(DataSource).filter(DataSource.id == request.source_id, DataSource.org_id == org.id).first()
        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

    background_tasks.add_task(_sync_task, source, org, request.objects)
    return {"status": "success", "message": "Sync started in background"}
@router.post("/import/hubspot")
async def import_hubspot(background_tasks: BackgroundTasks, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Trigger manual HubSpot import."""
    with get_db() as db:
        source = db.query(DataSource).filter(DataSource.source_type == "crm_hubspot", DataSource.org_id == org.id).first()
        if not source:
            raise HTTPException(status_code=404, detail="HubSpot integration not found")

    background_tasks.add_task(_sync_task, source, org, ["contacts", "deals", "companies"])
    return {"status": "success", "message": "HubSpot import started"}

@router.post("/import/salesforce")
async def import_salesforce(background_tasks: BackgroundTasks, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Trigger manual Salesforce import."""
    with get_db() as db:
        source = db.query(DataSource).filter(DataSource.source_type == "crm_salesforce", DataSource.org_id == org.id).first()
        if not source:
            raise HTTPException(status_code=404, detail="Salesforce integration not found")

@router.post("/{provider}/mock-link")
async def crm_mock_link(provider: str, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Instantly connect a mock CRM source (One-Click Connect)."""
    if not MOCK_MODE:
        raise HTTPException(status_code=400, detail="Mock connection only available in CRM_MOCK_MODE=true")

    tokens = {
        "access_token": f"mock_{provider}_access_token",
        "refresh_token": f"mock_{provider}_refresh_token",
        "instance_url": f"https://mock-{provider}.com",
        "expires_at": (datetime.now().timestamp() + 3600)
    }

    # Store as a DataSource
    source_name = f"{provider.capitalize()} CRM"
    source = create_data_source(
        org_id=org.id,
        name=source_name,
        source_type=f"crm_{provider}",
        connection_details=tokens,
        refresh_interval=60
    )
    
    return {"status": "success", "source_id": source.id}

@router.get("/{provider}/credentials")
async def get_org_credentials(provider: str, org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Fetch stored credentials for the organization (masked)."""
    cred = get_integration_credential(org.id, provider)
    if not cred:
        return {"client_id": "", "has_secret": False, "redirect_uri": ""}
    
    return {
        "client_id": cred.client_id,
        "has_secret": True,
        "redirect_uri": cred.redirect_uri or ""
    }

@router.post("/{provider}/credentials")
async def save_org_credentials(provider: str, request: Dict[str, Any], org=Depends(get_current_org), user=Depends(require_permission("MANAGE_SYNCS"))):
    """Save or update organization-specific CRM credentials."""
    client_id = request.get("client_id")
    client_secret = request.get("client_secret")
    redirect_uri = request.get("redirect_uri")
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Client ID and Client Secret are required")
        
    result = save_integration_credential(
        org_id=org.id,
        provider=provider,
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri
    )
    
    if not result:
        raise HTTPException(status_code=500, detail=f"Failed to save {provider} credentials to database. Check server logs.")
        
    return {"status": "success", "message": "Credentials saved successfully"}

@router.get("/callback-success")
async def crm_callback_success():
    """Return a simple HTML page that closes the popup and notifies the opener."""
    html_content = """
    <html>
        <body>
            <script>
                if (window.opener) {
                    window.opener.postMessage('crm_auth_success', '*');
                }
                window.close();
            </script>
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h2>Connection Successful!</h2>
                <p>You can close this window now.</p>
            </div>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)
