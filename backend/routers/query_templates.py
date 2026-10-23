"""
routers/query_templates.py — Saved Queries / Query Templates
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from dependencies import get_current_org
from auth import get_current_user
from query_templates import (
    create_template, list_templates, get_template,
    update_template, delete_template, increment_use_count,
    detect_parameters, fill_parameters,
)

router = APIRouter()


# ─── Request models ───────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    query_text: str
    parameters: Optional[list] = None   # auto-detected if omitted
    tags: Optional[list[str]] = []


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    query_text: Optional[str] = None
    parameters: Optional[list] = None
    tags: Optional[list[str]] = None


class TemplateRunRequest(BaseModel):
    parameter_values: Optional[dict[str, str]] = {}


class DetectParamsRequest(BaseModel):
    query_text: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/query-templates")
async def list_query_templates(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    org=Depends(get_current_org),
):
    """List all saved query templates for the org."""
    templates = list_templates(org.id, search=search, tag=tag)
    return {"templates": templates, "total": len(templates)}


@router.post("/query-templates")
async def create_query_template(
    request: TemplateCreate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    """Create a new query template."""
    data = request.model_dump()
    data["user_id"] = user.get("id") if user else None
    template = create_template(org.id, data)
    return {"status": "success", "template": template}


@router.get("/query-templates/{template_id}")
async def get_query_template(template_id: int, org=Depends(get_current_org)):
    """Get a single template by ID."""
    t = get_template(template_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"template": t}


@router.put("/query-templates/{template_id}")
async def update_query_template(
    template_id: int,
    request: TemplateUpdate,
    org=Depends(get_current_org),
):
    """Update an existing template."""
    t = get_template(template_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    updated = update_template(template_id, org.id, request.model_dump(exclude_unset=True))
    return {"status": "success", "template": updated}


@router.delete("/query-templates/{template_id}")
async def delete_query_template(template_id: int, org=Depends(get_current_org)):
    """Delete a template."""
    if not get_template(template_id, org.id):
        raise HTTPException(status_code=404, detail="Template not found")
    delete_template(template_id, org.id)
    return {"status": "success"}


@router.post("/query-templates/{template_id}/run")
async def run_template(
    template_id: int,
    request: TemplateRunRequest,
    org=Depends(get_current_org),
):
    """
    Fill parameter placeholders and return the ready-to-run query.
    Increments use_count. The frontend then submits the returned
    query_text to the normal /query endpoint.
    """
    t = get_template(template_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    filled = fill_parameters(t["query_text"], request.parameter_values or {})
    increment_use_count(template_id, org.id)
    return {"query_text": filled, "template": t}


@router.post("/query-templates/detect-params")
async def detect_template_params(
    request: DetectParamsRequest,
    org=Depends(get_current_org),
):
    """Auto-detect {param} placeholders in a query string."""
    params = detect_parameters(request.query_text)
    return {"parameters": params}
