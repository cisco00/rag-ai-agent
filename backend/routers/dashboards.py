from typing import List, Optional
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_org, get_org_connection_string
from main import AnalyticsAgent
from dashboards import (
    get_dashboards, create_dashboard, get_dashboard, get_cards,
    update_dashboard, delete_dashboard, publish_dashboard, unpublish_dashboard,
    get_dashboard_by_share_token, add_card, update_card, remove_card,
    reorder_cards, refresh_card
)

router = APIRouter()

class DashboardRequest(BaseModel):
    name:        str
    description: Optional[str] = None

class CardRequest(BaseModel):
    title:           Optional[str]   = None
    query_text:      Optional[str]   = None
    response_text:   Optional[str]   = None
    visualization:   Optional[dict]  = None
    sql_query:       Optional[str]   = None
    card_type:       str             = "query"
    layout_x:        int             = 0
    layout_y:        int             = 0
    layout_w:        int             = 6
    layout_h:        int             = 4

class CardLayoutItem(BaseModel):
    id:       int
    layout_x: int
    layout_y: int
    layout_w: int
    layout_h: int

class PinQueryRequest(BaseModel):
    dashboard_id:  int
    title:         Optional[str]  = None
    query_text:    str
    response_text: Optional[str]  = None
    visualization: Optional[dict] = None
    sql_query:     Optional[str]  = None


@router.get("/dashboards")
async def list_dashboards(org=Depends(get_current_org)):
    return {"dashboards": get_dashboards(org.id)}


@router.post("/dashboards")
async def create_new_dashboard(request: DashboardRequest, org=Depends(get_current_org)):
    dash = create_dashboard(org.id, request.name, request.description)
    return {"status": "success", "dashboard": dash}


@router.get("/dashboards/{dashboard_id}")
async def get_one_dashboard(dashboard_id: int, org=Depends(get_current_org)):
    dash = get_dashboard(dashboard_id, org.id)
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    cards = get_cards(dashboard_id, org.id)
    return {"dashboard": dash, "cards": cards}


@router.patch("/dashboards/{dashboard_id}")
async def update_one_dashboard(
    dashboard_id: int, request: DashboardRequest, org=Depends(get_current_org)
):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    dash = update_dashboard(dashboard_id, org.id, request.model_dump(exclude_unset=True))
    return {"status": "success", "dashboard": dash}


@router.delete("/dashboards/{dashboard_id}")
async def delete_one_dashboard(dashboard_id: int, org=Depends(get_current_org)):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    delete_dashboard(dashboard_id, org.id)
    return {"status": "success"}


@router.post("/dashboards/{dashboard_id}/publish")
async def publish_one_dashboard(dashboard_id: int, org=Depends(get_current_org)):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    token    = publish_dashboard(dashboard_id, org.id)
    base_url = os.getenv("APP_URL", "http://localhost:5173")
    return {"status": "success", "share_url": f"{base_url}/dashboards/shared/{token}"}


@router.post("/dashboards/{dashboard_id}/unpublish")
async def unpublish_one_dashboard(dashboard_id: int, org=Depends(get_current_org)):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    unpublish_dashboard(dashboard_id, org.id)
    return {"status": "success"}


@router.get("/dashboards/shared/{token}")
async def view_shared_dashboard(token: str):
    dash = get_dashboard_by_share_token(token)
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or no longer shared.")
    cards = get_cards(dash["id"], dash["org_id"])
    return {"dashboard": dash, "cards": cards}


@router.post("/dashboards/{dashboard_id}/cards")
async def add_dashboard_card(
    dashboard_id: int, request: CardRequest, org=Depends(get_current_org)
):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    card = add_card(dashboard_id, org.id, request.model_dump())
    return {"status": "success", "card": card}


@router.patch("/dashboards/{dashboard_id}/cards/{card_id}")
async def update_dashboard_card(
    dashboard_id: int, card_id: int,
    request: CardRequest, org=Depends(get_current_org)
):
    card = update_card(card_id, org.id, request.model_dump(exclude_unset=True))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found.")
    return {"status": "success", "card": card}


@router.delete("/dashboards/{dashboard_id}/cards/{card_id}")
async def delete_dashboard_card(
    dashboard_id: int, card_id: int, org=Depends(get_current_org)
):
    remove_card(card_id, org.id)
    return {"status": "success"}


@router.post("/dashboards/{dashboard_id}/layout")
async def update_dashboard_layout(
    dashboard_id: int, layout: List[CardLayoutItem], org=Depends(get_current_org)
):
    if not get_dashboard(dashboard_id, org.id):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    reorder_cards(dashboard_id, org.id, [i.model_dump() for i in layout])
    return {"status": "success"}


@router.post("/dashboards/{dashboard_id}/cards/{card_id}/refresh")
async def refresh_dashboard_card(
    dashboard_id: int, card_id: int, org=Depends(get_current_org)
):
    conn_str = get_org_connection_string(org)
    if not conn_str:
        raise HTTPException(status_code=400, detail="No database configured.")
    agent  = AnalyticsAgent(connection_string=conn_str)
    result = await refresh_card(card_id, org.id, conn_str, agent)
    return result


@router.post("/dashboards/pin")
async def pin_query_to_dashboard(request: PinQueryRequest, org=Depends(get_current_org)):
    dash = get_dashboard(request.dashboard_id, org.id)
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found.")

    existing = get_cards(request.dashboard_id, org.id)
    max_y    = max((c["layout_y"] + c["layout_h"] for c in existing), default=0)

    card = add_card(request.dashboard_id, org.id, {
        "title":         request.title or request.query_text[:60],
        "query_text":    request.query_text,
        "response_text": request.response_text,
        "visualization": request.visualization,
        "sql_query":     request.sql_query,
        "card_type":     "query",
        "layout_x":      0,
        "layout_y":      max_y,
        "layout_w":      6,
        "layout_h":      4
    })
    return {"status": "success", "card": card}
