"""``/api/patrons/{patron_id}/...`` endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.risk_case_agent import create_or_reuse_risk_case, get_latest_risk_case
from app.collections import web_collections as cols
from app.llm.embeddings import build_interaction_embedding_text, generate_embedding
from app.routers._common import db_dep, error_response, ok_response, strip_ids

router = APIRouter(tags=["patrons"])


_ID_SAFE = re.compile(r"[^A-Z0-9-]", re.IGNORECASE)


@router.get("/patrons/{patron_id}/interactions")
async def list_interactions(
    patron_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        records = (
            await db[cols.patron_interactions]
            .find({"patronId": patron_id})
            .sort("occurredAt", -1)
            .limit(50)
            .to_list(length=50)
        )
        records = strip_ids(records)
        total_value = sum(r.get("totalValueHKD", 0) or 0 for r in records)
        return ok_response(patronId=patron_id, records=records, totalValue=total_value)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/patrons/{patron_id}/interactions", status_code=201)
async def create_interaction(
    patron_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        int_type = body.get("type")
        total_value = body.get("totalValueHKD")
        occurred_at = body.get("occurredAt")
        if not int_type or total_value is None or not occurred_at:
            return error_response(
                "type, totalValueHKD, and occurredAt are required", status_code=400
            )

        now = datetime.now(timezone.utc)

        patron = await db[cols.patrons].find_one(
            {"patronId": patron_id}, {"tier": 1, "adt": 1}
        )
        detail = body.get("detail") or {}

        try:
            occurred_dt = datetime.fromisoformat(str(occurred_at).replace("Z", "+00:00"))
        except ValueError:
            occurred_dt = now

        raw_id = f"INT-{int(now.timestamp() * 1000)}-{patron_id}"
        record: dict[str, Any] = {
            "interactionId": _ID_SAFE.sub("-", raw_id),
            "patronId": patron_id,
            "type": int_type,
            "detail": detail,
            "totalValueHKD": float(total_value),
            "occurredAt": occurred_dt,
            "recordedBy": body.get("recordedBy") or "system",
            "recordedAt": now,
            "linkedAlertId": body.get("linkedAlertId"),
            "patronTierAtTime": (patron or {}).get("tier"),
            "patronAdtAtTime": (patron or {}).get("adt"),
        }

        # Non-blocking embedding
        try:
            embedding_text = build_interaction_embedding_text(
                type_=record["type"],
                total_value_hkd=record["totalValueHKD"],
                tier=record.get("patronTierAtTime"),
                detail=detail,
                occurred_at=record["occurredAt"],
            )
            embedding = await generate_embedding(embedding_text, "document")
            if any(v != 0 for v in embedding):
                record["interactionEmbedding"] = embedding
        except Exception:  # noqa: BLE001
            pass

        await db[cols.patron_interactions].insert_one(record)
        record.pop("_id", None)
        return ok_response(status_code=201, record=record)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.get("/patrons/{patron_id}/analysis-reports")
async def list_reports(
    patron_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        reports = (
            await db[cols.patron_analysis_reports]
            .find({"patronId": patron_id}, {"_id": 0})
            .sort("generatedAt", -1)
            .to_list(length=None)
        )
        return ok_response(patronId=patron_id, reports=reports)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/patrons/{patron_id}/risk-case")
async def create_risk_case(
    patron_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not patron_id:
            return error_response("patronId is required", status_code=400)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        if not body.get("tableId"):
            return error_response("tableId is required", status_code=400)
        result = await create_or_reuse_risk_case(
            db=db,
            patron_id=patron_id,
            table_id=body["tableId"],
            analysis_run_id=body.get("analysisRunId"),
        )
        return ok_response(**result)
    except ValueError as exc:
        return error_response(str(exc), status_code=404)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.get("/patrons/{patron_id}/risk-case/latest")
async def latest_risk_case(
    patron_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not patron_id:
            return error_response("patronId is required", status_code=400)
        risk_case = await get_latest_risk_case(db, patron_id)
        if not risk_case:
            return error_response("No risk case found", status_code=404)
        assignment = await db[cols.pr_assignments].find_one(
            {"caseId": risk_case.get("caseId")},
            projection={"_id": 0},
            sort=[("assignedAt", -1)],
        )
        pr_agent_profile = None
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
        return ok_response(case=risk_case, assignment=assignment, prAgentProfile=pr_agent_profile)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
