"""
routers/data_permissions.py — Row-Level & Column-Level Permission Rule Management — Feature #10

Routes (all require admin/owner permission):
  GET    /permissions/rules               — list all rules for the org
  POST   /permissions/rules               — create a new rule
  GET    /permissions/rules/{id}          — get a single rule
  PATCH  /permissions/rules/{id}          — update a rule
  DELETE /permissions/rules/{id}          — delete a rule
  POST   /permissions/rules/{id}/toggle   — toggle is_active

  GET    /permissions/preview             — preview what a role/user sees for a query
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator

import data_permissions as dp
from auth import get_current_user
from dependencies import get_current_org, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic models ─────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    rule_type:     str                    # 'row' | 'column'
    target_type:   str                    # 'role' | 'user'
    target_value:  str                    # role name or user_id as string
    table_name:    str
    column_names:  Optional[List[str]] = None
    column_action: Optional[str]       = None   # 'mask' | 'hide'
    row_filter:    Optional[str]       = None   # SQL WHERE fragment
    description:   Optional[str]       = None

    @field_validator("rule_type")
    @classmethod
    def valid_rule_type(cls, v):
        if v not in ("row", "column"):
            raise ValueError("rule_type must be 'row' or 'column'")
        return v

    @field_validator("target_type")
    @classmethod
    def valid_target_type(cls, v):
        if v not in ("role", "user"):
            raise ValueError("target_type must be 'role' or 'user'")
        return v


class RuleUpdate(BaseModel):
    rule_type:     Optional[str]       = None
    target_type:   Optional[str]       = None
    target_value:  Optional[str]       = None
    table_name:    Optional[str]       = None
    column_names:  Optional[List[str]] = None
    column_action: Optional[str]       = None
    row_filter:    Optional[str]       = None
    description:   Optional[str]       = None
    is_active:     Optional[bool]      = None


class PreviewRequest(BaseModel):
    sql:          str
    target_type:  str   # 'role' | 'user'
    target_value: str   # role name or user_id


# ── Routes ───────────────────────────────────────────────────────────────────────

@router.get("/permissions/rules")
async def list_rules(
    org=Depends(get_current_org),
    user=Depends(get_current_user),
    _=Depends(require_permission("MANAGE_ORG")),
):
    return dp.list_rules(org.id)


@router.post("/permissions/rules", status_code=201)
async def create_rule(
    payload: RuleCreate,
    org=Depends(get_current_org),
    user=Depends(get_current_user),
    _=Depends(require_permission("MANAGE_ORG")),
):
    try:
        rule = dp.create_rule(
            org_id=org.id,
            rule_type=payload.rule_type,
            target_type=payload.target_type,
            target_value=payload.target_value,
            table_name=payload.table_name,
            column_names=payload.column_names,
            column_action=payload.column_action,
            row_filter=payload.row_filter,
            description=payload.description,
        )
        return rule
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"create_rule error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create permission rule")


@router.get("/permissions/rules/{rule_id}")
async def get_rule(
    rule_id: int,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    rule = dp.get_rule(rule_id, org.id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.patch("/permissions/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    payload: RuleUpdate,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    updates = payload.model_dump(exclude_none=True)
    rule = dp.update_rule(rule_id, org.id, **updates)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.delete("/permissions/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    ok = dp.delete_rule(rule_id, org.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")


@router.post("/permissions/rules/{rule_id}/toggle")
async def toggle_rule(
    rule_id: int,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    rule = dp.get_rule(rule_id, org.id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    updated = dp.update_rule(rule_id, org.id, is_active=not rule["is_active"])
    return updated


@router.post("/permissions/preview")
async def preview_permissions(
    payload: PreviewRequest,
    org=Depends(get_current_org),
    _=Depends(require_permission("MANAGE_ORG")),
):
    """
    Show how a role/user's permissions would modify a given SQL query
    and what columns would be masked/hidden. Useful for admins to audit rules.
    """
    try:
        # Determine user_id for user-targeted rules
        user_id = 0
        if payload.target_type == "user":
            try:
                user_id = int(payload.target_value)
            except ValueError:
                user_id = 0

        role = payload.target_value if payload.target_type == "role" else ""

        rules = dp._get_active_rules(org.id, role, user_id)

        modified_sql = dp.apply_row_permissions(payload.sql, rules)

        # Determine column effects
        from data_permissions import _extract_tables
        tables_in_query = _extract_tables(payload.sql)
        col_effects: dict[str, dict] = {}
        for rule in rules:
            if rule["rule_type"] != "column":
                continue
            if rule["table_name"].lower() not in tables_in_query:
                continue
            cols = rule["column_names"] if isinstance(rule["column_names"], list) else []
            for col in cols:
                col_effects[col] = {"action": rule["column_action"], "rule_id": rule["id"]}

        row_rules_applied = [
            r for r in rules
            if r["rule_type"] == "row" and r["table_name"].lower() in tables_in_query
        ]

        return {
            "original_sql": payload.sql,
            "modified_sql": modified_sql,
            "sql_changed": modified_sql != payload.sql,
            "row_rules_applied": row_rules_applied,
            "column_effects": col_effects,
            "rules_checked": len(rules),
        }
    except Exception as e:
        logger.error(f"preview_permissions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
