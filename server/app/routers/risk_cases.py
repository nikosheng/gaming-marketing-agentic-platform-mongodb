"""``/api/risk-cases`` endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.risk_case_agent import submit_admin_decision
from app.collections import web_collections as cols
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["risk-cases"])


@router.post("/risk-cases/{case_id}/admin-decision")
async def admin_decision(
    case_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not case_id:
            return error_response("caseId is required", status_code=400)
        body = await request.json()
        decision = body.get("decision")
        if decision not in ("Approve", "Reject", "RequestMoreInfo"):
            return error_response("valid decision is required", status_code=400)
        rationale = (body.get("rationale") or "").strip()
        if not rationale:
            return error_response("rationale is required", status_code=400)

        result = await submit_admin_decision(
            db=db, case_id=case_id, decision=decision, rationale=rationale
        )
        pr_agent_profile = None
        assignment = result.get("assignment")
        if assignment and assignment.get("prAgentId"):
            pr_agent_profile = await db[cols.pr_agents].find_one(
                {"prAgentId": assignment["prAgentId"]},
                {
                    "_id": 0,
                    "prAgentId": 1,
                    "name": 1,
                    "active": 1,
                    "maxActivePatrons": 1,
                    "currentActivePatrons": 1,
                    "preferredTiers": 1,
                    "preferredGames": 1,
                    "preferredLanguages": 1,
                    "specialtyTags": 1,
                    "lastAssignedAt": 1,
                },
            )
        return ok_response(**result, prAgentProfile=pr_agent_profile)
    except ValueError as exc:
        return error_response(str(exc), status_code=404)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
