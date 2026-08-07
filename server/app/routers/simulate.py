"""``/api/simulate`` endpoints — ETL simulation for patron_table_sessions.

Provides:
  GET  /api/simulate/tables/{table_id}/patrons   — active patrons at a table
  POST /api/simulate/sessions                    — upsert a patron session
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.collections import web_collections as cols
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["simulate"])

BEHAVIOR_TAG_OPTIONS = [
    "Aggressive",
    "Conservative",
    "PromoSeeker",
    "LateNight",
    "CardCounterWatch",
]


# ---------- GET /simulate/tables/{table_id}/patrons ----------


@router.get("/simulate/tables/{table_id}/patrons")
async def get_table_patrons(
    table_id: str,
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    """Return all patrons currently active at the given table.

    Joins ``patron_table_sessions`` (isActive=true) with ``patron_profiles``
    so the frontend can show patronId + name + tier in the dropdown.
    """
    try:
        pipeline: list[dict[str, Any]] = [
            {"$match": {"tableId": table_id, "isActive": True}},
            {
                "$lookup": {
                    "from": cols.patrons,
                    "localField": "patronId",
                    "foreignField": "patronId",
                    "as": "profile",
                }
            },
            {"$unwind": {"path": "$profile", "preserveNullAndEmptyArrays": True}},
            {
                "$project": {
                    "_id": 0,
                    "patronId": 1,
                    "tableId": 1,
                    "seatedAt": 1,
                    "lastActionAt": 1,
                    "sessionBetAmount": 1,
                    "currentStackEstimate": 1,
                    "behaviorTags": 1,
                    "isActive": 1,
                    "name": "$profile.name",
                    "maskedName": "$profile.maskedName",
                    "tier": "$profile.tier",
                }
            },
            {"$sort": {"sessionBetAmount": -1}},
        ]

        patrons = await db[cols.sessions].aggregate(pipeline).to_list(length=None)

        return ok_response(tableId=table_id, patrons=patrons, count=len(patrons))

    except Exception as exc:
        return error_response(str(exc))


# ---------- POST /simulate/sessions ----------


class UpsertSessionRequest(BaseModel):
    patronId: str = Field(..., description="Patron ID, e.g. P-000001")
    tableId: str = Field(..., description="Table ID, e.g. T-0001")
    sessionBetAmount: float = Field(..., ge=0, description="Cumulative bet amount for this session")
    currentStackEstimate: float = Field(..., ge=0, description="Current chip stack estimate")
    behaviorTags: list[str] = Field(default_factory=list, description="Behavior tags")
    isActive: bool = Field(default=True, description="Whether patron is active at the table")


@router.post("/simulate/sessions")
async def upsert_session(
    body: UpsertSessionRequest,
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    """Upsert a patron_table_sessions document by {patronId, tableId}.

    - If a session already exists, updates bet amount, stack estimate,
      behavior tags, isActive, and lastActionAt.
    - If no session exists, inserts a new one with seatedAt = now.
    """
    try:
        now = datetime.now(tz=timezone.utc)

        filter_doc = {"patronId": body.patronId, "tableId": body.tableId}
        update_doc = {
            "$set": {
                "sessionBetAmount": body.sessionBetAmount,
                "currentStackEstimate": body.currentStackEstimate,
                "behaviorTags": body.behaviorTags,
                "isActive": body.isActive,
                "lastActionAt": now,
            },
            "$setOnInsert": {
                "patronId": body.patronId,
                "tableId": body.tableId,
                "seatedAt": now,
            },
        }

        result = await db[cols.sessions].update_one(
            filter_doc,
            update_doc,
            upsert=True,
        )

        action = "inserted" if result.upserted_id else "updated"

        return ok_response(
            action=action,
            patronId=body.patronId,
            tableId=body.tableId,
            isActive=body.isActive,
            sessionBetAmount=body.sessionBetAmount,
            currentStackEstimate=body.currentStackEstimate,
            behaviorTags=body.behaviorTags,
            updatedAt=now.isoformat(),
        )

    except Exception as exc:
        return error_response(str(exc))


# ---------- GET /simulate/behavior-tags ----------


@router.get("/simulate/behavior-tags")
async def get_behavior_tags() -> Any:
    """Return the list of valid behavior tag options."""
    return ok_response(tags=BEHAVIOR_TAG_OPTIONS)
