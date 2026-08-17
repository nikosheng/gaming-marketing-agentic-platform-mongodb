"""``/api/alert-rules`` endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.alert_rule_agent import (
    persist_alert_rule,
    preview_alert_rule,
    seed_template_rules_if_empty,
)
from app.collections import web_collections as cols
from app.routers._common import db_dep, error_response, ok_response, strip_id

router = APIRouter(tags=["alert-rules"])


@router.get("/alert-rules")
async def list_rules(db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        rules = await seed_template_rules_if_empty(db)
        return ok_response(rules=[strip_id(r) for r in rules])
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/alert-rules")
async def create_or_preview(
    request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        action = body.get("action")
        if action == "preview":
            nl = (body.get("nlDescription") or "").strip()
            if not nl:
                return error_response("nlDescription is required", status_code=400)
            res = await preview_alert_rule(db, nl)
            err = res.get("error")
            if err:
                status = 503 if err.startswith("AI_NOT_CONFIGURED") else 500
                return error_response(err, status_code=status)
            return ok_response(preview=res.get("preview"))

        if action == "confirm":
            preview = body.get("preview")
            if not preview:
                return error_response(
                    "preview is required for confirm action", status_code=400
                )
            res = await persist_alert_rule(db, preview)
            if res.get("error"):
                return error_response(res["error"], status_code=400)
            rule_id = res.get("ruleId")
            rule = await db[cols.alert_rules].find_one({"ruleId": rule_id})
            return ok_response(ruleId=rule_id, rule=strip_id(rule))

        return error_response("action must be 'preview' or 'confirm'", status_code=400)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.patch("/alert-rules/{rule_id}")
async def update_rule_status(
    rule_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        status = body.get("status")
        if status not in ("Active", "Paused"):
            return error_response(
                "status must be 'Active' or 'Paused'", status_code=400
            )
        result = await db[cols.alert_rules].update_one(
            {"ruleId": rule_id}, {"$set": {"status": status}}
        )
        if result.matched_count == 0:
            return error_response(f"Rule {rule_id} not found", status_code=404)
        return ok_response(ruleId=rule_id, status=status)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
