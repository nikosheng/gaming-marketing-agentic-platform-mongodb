"""``/api/simulate`` endpoints — ETL simulation for patron_table_sessions.

Provides:
  GET  /api/simulate/tables/{table_id}/patrons   — active patrons at a table
  POST /api/simulate/sessions                    — upsert a patron session
"""

from __future__ import annotations

from datetime import datetime, timezone
import random
from typing import Any

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.collections import web_collections as cols
from app.config import settings
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["simulate"])

BEHAVIOR_TAG_OPTIONS = [
    "Aggressive",
    "Conservative",
    "PromoSeeker",
    "LateNight",
    "CardCounterWatch",
]

SIM_GAME_TYPES = ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"]
SIM_REGIONS = ["Macau", "HongKong", "Guangdong", "OtherGBA", "Taiwan", "International"]
SIM_RISK_FLAGS = ["HighVariance", "FrequentCashout", "NightOnly", "PromoSensitive"]


def _random_tier_for_bet(session_bet_amount: float) -> str:
    if session_bet_amount >= 20000:
        return random.choices(["Platinum", "Diamond"], weights=[0.35, 0.65], k=1)[0]
    if session_bet_amount >= 12000:
        return random.choices(["Gold", "Platinum", "Diamond"], weights=[0.2, 0.65, 0.15], k=1)[0]
    if session_bet_amount >= 8000:
        return random.choices(["Silver", "Gold", "Platinum"], weights=[0.15, 0.7, 0.15], k=1)[0]
    if session_bet_amount >= 4000:
        return random.choices(["Bronze", "Silver", "Gold"], weights=[0.25, 0.6, 0.15], k=1)[0]
    return random.choices(["Bronze", "Silver"], weights=[0.85, 0.15], k=1)[0]


def _random_region() -> str:
    return random.choices(
        SIM_REGIONS,
        weights=[0.22, 0.26, 0.2, 0.1, 0.12, 0.1],
        k=1,
    )[0]


def _random_risk_flags() -> list[str]:
    if random.random() < 0.6:
        return ["None"]
    count = 1 if random.random() < 0.8 else 2
    return random.sample(SIM_RISK_FLAGS, k=count)


def _random_preferred_games(primary_game: str) -> list[str]:
    primary = primary_game if primary_game in SIM_GAME_TYPES else "Baccarat"
    others = [g for g in SIM_GAME_TYPES if g != primary]
    if random.random() < 0.65:
        return [primary]
    if random.random() < 0.9:
        return [primary, random.choice(others)]
    return [primary, *random.sample(others, k=2)]


def _random_adt(session_bet_amount: float) -> float:
    baseline = max(800.0, session_bet_amount * random.uniform(0.65, 1.2))
    return round(baseline)


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
    name: str | None = Field(default=None, description="Optional SIM patron name")
    maskedName: str | None = Field(default=None, description="Optional masked name")
    tier: str | None = Field(default=None, description="Optional tier")
    adt: float | None = Field(default=None, ge=0, description="Optional ADT")
    pointsBalance: float | None = Field(default=None, ge=0, description="Optional points")
    region: str | None = Field(default=None, description="Optional region")


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

        if result.upserted_id:
            table = await db[cols.tables].find_one(
                {"tableId": body.tableId}, {"_id": 0, "gameType": 1}
            )
            game_type = str((table or {}).get("gameType") or "Baccarat")
            tail = body.patronId[-3:] if len(body.patronId) >= 3 else body.patronId

            inferred_tier = body.tier or _random_tier_for_bet(body.sessionBetAmount)
            inferred_adt = body.adt if body.adt is not None else _random_adt(body.sessionBetAmount)
            inferred_region = body.region or _random_region()

            profile_payload = {
                "patronId": body.patronId,
                "name": body.name or f"Sim Patron {tail}",
                "maskedName": body.maskedName or f"S***{tail}",
                "tier": inferred_tier,
                "adt": inferred_adt,
                "preferredGames": _random_preferred_games(game_type),
                "riskFlags": _random_risk_flags(),
                "pointsBalance": body.pointsBalance if body.pointsBalance is not None else round(inferred_adt * random.uniform(2.8, 8.0)),
                "lastActiveAt": now,
                "region": inferred_region,
                "activities": [],
                "preferenceEmbedding": [0.0] * settings.llm.embedding_dim,
                "createdAt": now,
                "updatedAt": now,
            }
            insert_profile = {
                key: value
                for key, value in profile_payload.items()
                if key not in {"lastActiveAt", "updatedAt"}
            }
            await db[cols.patrons].update_one(
                {"patronId": body.patronId},
                {
                    "$setOnInsert": insert_profile,
                    "$set": {
                        "lastActiveAt": now,
                        "updatedAt": now,
                    },
                },
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
