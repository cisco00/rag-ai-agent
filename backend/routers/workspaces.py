"""
routers/workspaces.py — Workspace management, org creation, domain verification,
                         admin transfer, and org-member management.

All auth/individual-registration routes stay in routers/auth.py.
This router is mounted at /workspaces in api.py.
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import logging

import auth as auth_module
from dependencies import limiter

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Pydantic bodies ────────────────────────────────────────────────────────────

class RegisterIndividualRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None

class InitiateDomainRequest(BaseModel):
    domain: str                      # e.g. "acme.com"

class CreateOrgRequest(BaseModel):
    org_name: str
    domain: str

class TransferAdminRequest(BaseModel):
    new_admin_email: str

class OrgInviteRequest(BaseModel):
    email: str
    role: str = "employee"

class SwitchWorkspaceRequest(BaseModel):
    workspace_id: int


# ── Individual registration ───────────────────────────────────────────────────

@router.post("/register-individual")
@limiter.limit("5/minute")
async def register_individual(request: Request, body: RegisterIndividualRequest):
    """
    Register a user as an individual — no org needed.
    Creates a personal workspace automatically and returns a full login payload.
    """
    try:
        result = auth_module.register_individual(
            email=body.email,
            password=body.password,
            display_name=body.display_name,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Individual registration failed: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))


# ── Workspace listing & switching ─────────────────────────────────────────────

@router.get("/")
async def list_workspaces(user: dict = Depends(auth_module.get_current_user)):
    """Return all workspaces the authenticated user has access to."""
    try:
        workspaces = auth_module.get_user_workspaces(user["id"])
        return workspaces
    except Exception as exc:
        logger.error(f"list_workspaces failed: {exc}")
        raise HTTPException(status_code=500, detail="Could not load workspaces.")


@router.post("/switch")
async def switch_workspace(
    body: SwitchWorkspaceRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Switch the user's active workspace.
    Validates membership, then returns a fresh access token that includes the
    workspace_id in its payload so every subsequent request is scoped to it.
    """
    try:
        membership = auth_module.assert_workspace_member(user["id"], body.workspace_id)
        ws = auth_module.get_workspace_by_id(body.workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found.")

        new_token = auth_module._make_access_token(
            user_id=user["id"],
            org_id=ws.get("organization_id") or user.get("org_id"),
            role=membership["role"],
            is_superuser=user.get("is_superuser", 0),
            workspace_id=body.workspace_id,
        )
        return {
            "access_token": new_token,
            "workspace": ws,
            "role": membership["role"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"switch_workspace failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: int,
    user: dict = Depends(auth_module.get_current_user),
):
    """Get details for a specific workspace (membership required)."""
    auth_module.assert_workspace_member(user["id"], workspace_id)
    ws = auth_module.get_workspace_by_id(workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return ws


# ── Organisation creation (requires domain verification) ─────────────────────

@router.post("/org/initiate-domain")
@limiter.limit("10/minute")
async def initiate_domain_verification(
    request: Request,
    body: InitiateDomainRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Step 1 of org creation: generate a DNS TXT verification token.
    The user must publish this as a TXT record on their domain, then call
    /workspaces/org/verify-domain to confirm.
    Returns the token string to publish.
    """
    # Use a temporary org_id of 0 for pre-creation verification
    try:
        token = auth_module.initiate_domain_verification(0, body.domain)
        return {
            "domain": body.domain.lower().strip(),
            "txt_record_name": f"_vantage-verify.{body.domain.lower().strip()}",
            "txt_record_value": token,
            "instructions": (
                f"Add a TXT record to your DNS:\n"
                f"  Name:  _vantage-verify.{body.domain.lower().strip()}\n"
                f"  Value: {token}\n"
                f"DNS changes can take up to 48 hours to propagate. "
                f"This token expires in 7 days."
            ),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"initiate_domain_verification failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/org/verify-domain")
@limiter.limit("10/minute")
async def verify_domain(
    request: Request,
    body: InitiateDomainRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Step 2: poll DNS to confirm the TXT record is live.
    Set env DOMAIN_VERIFY_SKIP=1 to bypass DNS lookup in dev/staging.
    Returns {verified: true/false}.
    """
    try:
        ok = auth_module.check_domain_verification(0, body.domain)
        return {"verified": ok, "domain": body.domain.lower().strip()}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"verify_domain failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/org/create")
@limiter.limit("5/minute")
async def create_org(
    request: Request,
    body: CreateOrgRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Step 3: finalise org creation after domain is verified.
    Creates the org, the org workspace, and makes the calling user the admin.
    Returns {org_id, workspace_id, org_name, api_key}.
    """
    try:
        result = auth_module.create_org_with_admin(
            user_id=user["id"],
            org_name=body.org_name,
            domain=body.domain,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"create_org failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ── Org member management ──────────────────────────────────────────────────────

@router.get("/org/members")
async def list_org_members(user: dict = Depends(auth_module.get_current_user)):
    """List all members of the user's current organisation."""
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="You are not part of an organisation.")
    try:
        members = auth_module.list_org_users(org_id)
        return members
    except Exception as exc:
        logger.error(f"list_org_members failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/org/invite")
@limiter.limit("20/minute")
async def invite_org_member(
    request: Request,
    body: OrgInviteRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Invite an employee to the org.
    Only the org admin may send invitations.
    """
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="You are not part of an organisation.")
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only the organisation admin can invite members.")

    # Role must be employee (not admin — can't invite admins)
    if body.role not in ("employee", "analyst", "viewer"):
        body.role = "employee"

    try:
        from email_service import send_invite_email, APP_URL
        token = auth_module.create_invite(
            org_id=org_id,
            email=body.email,
            role=body.role,
            invited_by=user["id"],
        )
        invite_url = f"{APP_URL}/accept-invite?token={token}"
        from models import get_org_by_id
        org = get_org_by_id(org_id)
        send_invite_email(
            to_email=body.email,
            org_name=org.name if org else "Organisation",
            role=body.role,
            invite_url=invite_url,
            invited_by=user.get("display_name") or user.get("email"),
        )
        return {"status": "invited", "email": body.email, "role": body.role}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"invite_org_member failed: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/org/transfer-admin")
async def transfer_admin(
    body: TransferAdminRequest,
    user: dict = Depends(auth_module.get_current_user),
):
    """
    Transfer org admin privileges to an active employee.
    Requires the caller to be the current admin.
    Atomic: old admin becomes employee, new admin is promoted.
    """
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="You are not part of an organisation.")

    try:
        result = auth_module.transfer_admin(
            org_id=org_id,
            current_admin_id=user["id"],
            new_admin_email=body.new_admin_email,
        )
        # Send notifications (best-effort)
        try:
            from email_service import send_email, APP_URL
            send_email(
                body.new_admin_email,
                "You are now the organisation administrator",
                f"<p>You have been assigned as the administrator of the organisation. "
                f"<a href='{APP_URL}'>Sign in</a> to manage your team.</p>",
                f"You are now the administrator. Visit {APP_URL}",
            )
        except Exception:
            pass
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"transfer_admin failed: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/org/members/{email}")
async def remove_org_member(
    email: str,
    user: dict = Depends(auth_module.get_current_user),
):
    """Remove an employee from the org. Admin only."""
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="You are not part of an organisation.")

    try:
        auth_module.remove_user(
            org_id=org_id,
            target_email=email,
            requester_role=user["role"],
            requester_email=user["email"],
        )
        return {"status": "removed", "email": email}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"remove_org_member failed: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
