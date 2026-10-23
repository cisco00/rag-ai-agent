"""
routers/card_comments.py — Threaded Comments on Dashboard Cards (Feature #7)
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from dependencies import get_current_org
from auth import get_current_user
from card_comments import (
    list_comments, create_comment, update_comment,
    delete_comment, count_comments,
)

router = APIRouter()


class CommentCreate(BaseModel):
    body: str
    parent_id: Optional[int] = None
    mentions: Optional[list[str]] = []


class CommentUpdate(BaseModel):
    body: str


@router.get("/dashboards/{dashboard_id}/cards/{card_id}/comments")
async def get_comments(
    dashboard_id: int,
    card_id: int,
    org=Depends(get_current_org),
):
    comments = list_comments(org.id, dashboard_id, card_id)
    return {"comments": comments}


@router.post("/dashboards/{dashboard_id}/cards/{card_id}/comments")
async def post_comment(
    dashboard_id: int,
    card_id: int,
    request: CommentCreate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    user_id = user.get("id") if user else None
    display_name = user.get("display_name") or user.get("email", "User") if user else "User"
    comment = create_comment(
        org_id=org.id,
        dashboard_id=dashboard_id,
        card_id=card_id,
        user_id=user_id,
        display_name=display_name,
        body=request.body,
        parent_id=request.parent_id,
        mentions=request.mentions,
    )
    return {"status": "success", "comment": comment}


@router.put("/dashboards/{dashboard_id}/cards/{card_id}/comments/{comment_id}")
async def edit_comment(
    dashboard_id: int,
    card_id: int,
    comment_id: int,
    request: CommentUpdate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
):
    user_id = user.get("id") if user else None
    updated = update_comment(comment_id, org.id, user_id, request.body)
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"status": "success", "comment": updated}


@router.delete("/dashboards/{dashboard_id}/cards/{card_id}/comments/{comment_id}")
async def remove_comment(
    dashboard_id: int,
    card_id: int,
    comment_id: int,
    org=Depends(get_current_org),
):
    if not delete_comment(comment_id, org.id):
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"status": "success"}


@router.get("/dashboards/{dashboard_id}/comment-counts")
async def get_comment_counts(
    dashboard_id: int,
    card_ids: str = "",   # comma-separated card IDs
    org=Depends(get_current_org),
):
    """Return comment counts per card for a dashboard overview."""
    ids = [int(x) for x in card_ids.split(",") if x.strip().isdigit()]
    counts = count_comments(org.id, dashboard_id, ids)
    return {"counts": counts}
