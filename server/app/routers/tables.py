"""``/api/tables`` endpoints (heatmap, per-table drill-down, simulation, min-bet)."""

from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from pymongo import ReturnDocument

from app.agents.alert_analyzer import run_alert_analysis
from app.agents.minbet_optimizer_agent import run_min_bet_optimizer
from app.agents.table_drilldown_agent import analyze_table_patrons
from app.collections import web_collections as cols
from app.config import settings
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["tables"])


@router.get("/tables/heatmap")
async def heatmap(db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        tables = await db[cols.tables].find(
            {},
            {
                "_id": 0,
                "tableId": 1,
                "tableName": 1,
                "zone": 1,
                "gameType": 1,
                "minBet": 1,
                "maxBet": 1,
                "status": 1,
                "patronCount": 1,
                "avgBetAmount": 1,
                "occupancyRate": 1,
                "refreshedAt": 1,
            },
        ).sort([("zone", 1), ("tableName", 1)]).to_list(length=None)

        live_stats = await db[cols.sessions].aggregate(
            [
                {"$match": {"isActive": True}},
                {
                    "$group": {
                        "_id": "$tableId",
                        "patronCount": {"$sum": 1},
                        "avgBetAmount": {"$avg": "$sessionBetAmount"},
                    }
                },
            ]
        ).to_list(length=None)

        live_by_table: dict[str, dict[str, Any]] = {
            str(row["_id"]): {
                "patronCount": int(row.get("patronCount") or 0),
                "avgBetAmount": round(float(row.get("avgBetAmount") or 0)),
            }
            for row in live_stats
        }

        enriched: list[dict[str, Any]] = []
        for t in tables:
            live = live_by_table.get(t.get("tableId"))
            if not live:
                enriched.append(
                    {**t, "patronCount": 0, "avgBetAmount": 0, "occupancyRate": 0}
                )
            else:
                enriched.append(
                    {
                        **t,
                        "patronCount": live["patronCount"],
                        "avgBetAmount": live["avgBetAmount"],
                        "occupancyRate": round(min(1, live["patronCount"] / 9), 3),
                    }
                )

        metrics = {"totalTables": 0, "totalPatrons": 0, "hotTables": 0, "openOrBusyTables": 0}
        for t in enriched:
            metrics["totalTables"] += 1
            metrics["totalPatrons"] += t.get("patronCount") or 0
            if (t.get("occupancyRate") or 0) >= 0.8:
                metrics["hotTables"] += 1
            if t.get("status") in ("Open", "Busy"):
                metrics["openOrBusyTables"] += 1

        refreshed_at = datetime.now(timezone.utc)
        if enriched:
            try:
                await db[cols.table_state_history].insert_many(
                    [
                        {
                            "tableId": t["tableId"],
                            "refreshedAt": refreshed_at,
                            "patronCount": int(t.get("patronCount") or 0),
                            "avgBetAmount": int(t.get("avgBetAmount") or 0),
                            "occupancyRate": float(t.get("occupancyRate") or 0),
                            "minBet": float(t.get("minBet") or 0),
                            "maxBet": float(t.get("maxBet") or 0),
                            "status": str(t.get("status") or "Open"),
                        }
                        for t in enriched
                    ],
                    ordered=False,
                )
            except Exception:  # noqa: BLE001
                pass

        return ok_response(
            refreshedAt=refreshed_at.isoformat(), metrics=metrics, tables=enriched
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.get("/tables/{table_id}/patrons")
async def table_patrons(
    table_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        pipeline = [
            {"$match": {"tableId": table_id, "isActive": True}},
            {"$sort": {"sessionBetAmount": -1}},
            {"$limit": 50},
            {
                "$lookup": {
                    "from": cols.patrons,
                    "localField": "patronId",
                    "foreignField": "patronId",
                    "as": "patron",
                }
            },
            {"$unwind": {"path": "$patron", "preserveNullAndEmptyArrays": True}},
            {
                "$project": {
                    "_id": 0,
                    "patronId": {"$ifNull": ["$patron.patronId", "$patronId"]},
                    "maskedName": "$patron.maskedName",
                    "tier": "$patron.tier",
                    "adt": "$patron.adt",
                    "pointsBalance": "$patron.pointsBalance",
                    "region": "$patron.region",
                    "sessionBetAmount": 1,
                    "currentStackEstimate": 1,
                    "behaviorTags": 1,
                    "lastActionAt": 1,
                }
            },
        ]
        patrons = await db[cols.sessions].aggregate(pipeline).to_list(length=50)
        return ok_response(tableId=table_id, patronCount=len(patrons), patrons=patrons)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/tables/{table_id}/analyze")
async def analyze(table_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)
        analysis = await analyze_table_patrons(db, table_id)
        return ok_response(**analysis, engine="langgraph")
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/tables/{table_id}/optimize-minbet")
async def optimize_minbet(
    table_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        actor_id = body.get("actorId") or "console-user"
        recommendation = await run_min_bet_optimizer(db, table_id, actor_id)
        if not recommendation:
            return error_response(
                f"Unable to compute min-bet recommendation for {table_id}.",
                status_code=404,
            )
        return ok_response(recommendation=recommendation, engine="langgraph")
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.get("/tables/{table_id}/minbet-recommendations")
async def list_minbet_recommendations(
    table_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)
        recs = await db[cols.min_bet_recommendations].find(
            {"tableId": table_id}, {"_id": 0}
        ).sort("createdAt", -1).limit(10).to_list(length=10)
        return ok_response(tableId=table_id, recommendations=recs)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/tables/{table_id}/minbet-recommendations/{rec_id}/apply")
async def apply_minbet_recommendation(
    table_id: str,
    rec_id: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    try:
        if not table_id or not rec_id:
            return error_response("tableId and recId are required", status_code=400)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        actor_id = body.get("actorId") or "console-user"

        rec = await db[cols.min_bet_recommendations].find_one(
            {"recommendationId": rec_id, "tableId": table_id}
        )
        if not rec:
            return error_response("Recommendation not found", status_code=404)
        if rec.get("status") != "Proposed":
            return error_response(
                f"Recommendation is {rec.get('status')} and cannot be applied",
                status_code=409,
            )

        expires_at = rec.get("expiresAt")
        if isinstance(expires_at, datetime):
            expires_dt = expires_at
        else:
            try:
                expires_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                expires_dt = datetime.now(timezone.utc)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        if expires_dt < datetime.now(timezone.utc):
            await db[cols.min_bet_recommendations].update_one(
                {"recommendationId": rec_id},
                {
                    "$set": {
                        "status": "Expired",
                        "reviewedAt": datetime.now(timezone.utc),
                        "reviewedBy": actor_id,
                    }
                },
            )
            return error_response("Recommendation has expired", status_code=410)

        old_min = float(rec.get("currentMinBet") or 0)
        new_min = float(rec.get("recommendedMinBet") or 0)
        if new_min <= 0:
            return error_response("Invalid recommended min bet", status_code=400)

        now = datetime.now(timezone.utc)

        await db[cols.tables].update_one(
            {"tableId": table_id}, {"$set": {"minBet": new_min, "refreshedAt": now}}
        )
        await db[cols.min_bet_audit].insert_one(
            {
                "tableId": table_id,
                "oldMinBet": old_min,
                "newMinBet": new_min,
                "source": "Agent",
                "recommendationId": rec_id,
                "actorId": actor_id,
                "at": now,
            }
        )
        await db[cols.min_bet_recommendations].update_one(
            {"recommendationId": rec_id},
            {
                "$set": {
                    "status": "Applied",
                    "reviewedBy": actor_id,
                    "reviewedAt": now,
                }
            },
        )
        return ok_response(
            tableId=table_id,
            recommendationId=rec_id,
            oldMinBet=old_min,
            newMinBet=new_min,
            appliedAt=now.isoformat(),
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/tables/{table_id}/minbet-recommendations/{rec_id}/reject")
async def reject_minbet_recommendation(
    table_id: str,
    rec_id: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    try:
        if not table_id or not rec_id:
            return error_response("tableId and recId are required", status_code=400)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        actor_id = body.get("actorId") or "console-user"

        result = await db[cols.min_bet_recommendations].find_one_and_update(
            {"recommendationId": rec_id, "tableId": table_id, "status": "Proposed"},
            {
                "$set": {
                    "status": "Rejected",
                    "reviewedBy": actor_id,
                    "reviewedAt": datetime.now(timezone.utc),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            return error_response(
                "Recommendation not found or already reviewed", status_code=404
            )
        return ok_response(recommendationId=rec_id, status="Rejected")
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


# ---------- Simulate sessions / rounds ----------


_Scenario = Literal["full-high", "full-mixed", "low-sticky", "empty"]


def _build_session(table_id: str, index: int, session_bet_amount: float) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "patronId": f"SIM-{str(index + 1).zfill(3)}",
        "tableId": table_id,
        "seatedAt": now - timedelta(minutes=30 + index * 3),
        "lastActionAt": now - timedelta(minutes=index),
        "sessionBetAmount": session_bet_amount,
        "currentStackEstimate": round(session_bet_amount * (1.2 + random.random() * 2)),
        "behaviorTags": ["Aggressive"],
        "isActive": True,
    }


def _pick_sim_tier(session_bet_amount: float) -> str:
    if session_bet_amount >= 20000:
        return random.choices(["Platinum", "Diamond"], weights=[0.35, 0.65], k=1)[0]
    if session_bet_amount >= 12000:
        return random.choices(["Gold", "Platinum", "Diamond"], weights=[0.2, 0.65, 0.15], k=1)[0]
    if session_bet_amount >= 8000:
        return random.choices(["Silver", "Gold", "Platinum"], weights=[0.15, 0.7, 0.15], k=1)[0]
    if session_bet_amount >= 4000:
        return random.choices(["Bronze", "Silver", "Gold"], weights=[0.25, 0.6, 0.15], k=1)[0]
    return random.choices(["Bronze", "Silver"], weights=[0.85, 0.15], k=1)[0]


def _pick_sim_region(seed: str) -> str:
    regions = ["Macau", "HongKong", "Guangdong", "OtherGBA", "Taiwan", "International"]
    return random.choices(regions, weights=[0.22, 0.26, 0.2, 0.1, 0.12, 0.1], k=1)[0]


def _build_sim_profile(
    patron_id: str,
    game_type: str,
    session_bet_amount: float,
    now: datetime,
) -> dict[str, Any]:
    tail = patron_id[-3:] if len(patron_id) >= 3 else patron_id
    tier = _pick_sim_tier(session_bet_amount)
    adt = round(max(800.0, session_bet_amount * random.uniform(0.65, 1.2)))
    games = ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"]
    primary_game = game_type if game_type in games else "Baccarat"
    other_games = [g for g in games if g != primary_game]
    if random.random() < 0.65:
        preferred_games = [primary_game]
    elif random.random() < 0.9:
        preferred_games = [primary_game, random.choice(other_games)]
    else:
        preferred_games = [primary_game, *random.sample(other_games, k=2)]

    if random.random() < 0.6:
        risk_flags = ["None"]
    else:
        risk_pool = ["HighVariance", "FrequentCashout", "NightOnly", "PromoSensitive"]
        risk_count = 1 if random.random() < 0.8 else 2
        risk_flags = random.sample(risk_pool, k=risk_count)

    return {
        "patronId": patron_id,
        "name": f"Sim Patron {tail}",
        "maskedName": f"S***{tail}",
        "tier": tier,
        "adt": adt,
        "preferredGames": preferred_games,
        "riskFlags": risk_flags,
        "pointsBalance": round(adt * random.uniform(2.8, 8.0)),
        "lastActiveAt": now,
        "region": _pick_sim_region(patron_id),
        "activities": [],
        "preferenceEmbedding": [0.0] * settings.llm.embedding_dim,
        "createdAt": now,
        "updatedAt": now,
    }


async def _upsert_sim_patron_profiles(
    db: AsyncIOMotorDatabase,
    sessions: list[dict[str, Any]],
    game_type: str,
    profile_overrides: dict[str, dict[str, Any]] | None = None,
) -> None:
    """Upsert patron_profiles for all simulated sessions (P- prefixed IDs).

    ``profile_overrides`` maps patronId → partial profile fields that should
    be used *instead of* the random _build_sim_profile defaults (used by
    targeted-alert patron generation to set specific tier / adt / behaviorTags).
    """
    eligible = [s for s in sessions if str(s.get("patronId", "")).startswith("P-")]
    if not eligible:
        return
    now = datetime.now(timezone.utc)
    overrides = profile_overrides or {}
    for session in eligible:
        patron_id = str(session.get("patronId") or "")
        if not patron_id:
            continue
        profile = _build_sim_profile(
            patron_id=patron_id,
            game_type=game_type,
            session_bet_amount=float(session.get("sessionBetAmount") or 0),
            now=now,
        )
        # Apply any targeted overrides (tier, adt, riskFlags, behaviorTags, etc.)
        if patron_id in overrides:
            profile.update(overrides[patron_id])
        insert_profile = {
            key: value
            for key, value in profile.items()
            if key not in {"lastActiveAt", "updatedAt"}
        }
        await db[cols.patrons].update_one(
            {"patronId": patron_id},
            {
                "$setOnInsert": insert_profile,
                "$set": {
                    "lastActiveAt": now,
                    "updatedAt": now,
                },
            },
            upsert=True,
        )


def _generate_sessions(
    table_id: str, min_bet: float, scenario: _Scenario
) -> list[dict[str, Any]]:
    if scenario == "empty":
        return []
    if scenario == "full-high":
        return [
            _build_session(table_id, i, min_bet * (8 + random.randint(0, 17)))
            for i in range(9)
        ]
    if scenario == "full-mixed":
        out = []
        for i in range(9):
            if i < 2:
                amount = round(min_bet * (1.0 + random.random() * 0.15))
            else:
                amount = min_bet * (3 + random.randint(0, 7))
            out.append(_build_session(table_id, i, amount))
        return out
    # low-sticky
    return [
        _build_session(table_id, i, min_bet * (6 + random.randint(0, 9)))
        for i in range(3)
    ]


@router.post("/tables/{table_id}/simulate-sessions")
async def simulate_sessions(
    table_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)
        scenario: _Scenario = "full-high"
        try:
            body = await request.json()
            if body and body.get("scenario"):
                scenario = body["scenario"]
        except Exception:  # noqa: BLE001
            pass

        table = await db[cols.tables].find_one(
            {"tableId": table_id}, {"_id": 0, "minBet": 1, "gameType": 1}
        )
        if not table:
            return error_response(f"Table {table_id} not found.", status_code=404)

        min_bet = float(table.get("minBet") or 300)

        await db[cols.sessions].delete_many({"tableId": table_id, "isActive": True})
        await db[cols.min_bet_audit].delete_many({"tableId": table_id})
        await db[cols.table_state_history].delete_many({"tableId": table_id})

        sessions = _generate_sessions(table_id, min_bet, scenario)
        if sessions:
            await db[cols.sessions].insert_many(sessions)
            await _upsert_sim_patron_profiles(
                db,
                sessions,
                str(table.get("gameType") or "Baccarat"),
            )

        injected_count = len(sessions)
        if injected_count > 0:
            avg_bet = round(
                sum(s["sessionBetAmount"] for s in sessions) / injected_count
            )
        else:
            avg_bet = 0
        occupancy_rate = round(min(1, injected_count / 9), 3)

        return ok_response(
            scenario=scenario,
            injectedCount=injected_count,
            avgBet=avg_bet,
            occupancyRate=occupancy_rate,
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


# ---------- Simulate-round (P-9xxxxx patrons + alert analysis) ----------


# ---------- Scripted base patron sequences (P-9xxxxx IDs, table-derived) ----------

# Five deterministic bet sequences (cycled per round) for the scripted patrons.
# Index 0-4 → scripted patrons; indices 5-8 → random-bet patrons.
_SCRIPTED_BET_SEQUENCES: list[list[int]] = [
    [12000, 15500, 11200, 5000, 8000, 12000, 15500, 11200, 5000, 8000],  # idx 0 – Gold/HighVariance
    [4000, 6000, 3500, 5000, 7000, 4000, 6000, 3500, 5000, 7000],        # idx 1 – Bronze/low
    [8000, 9500, 12000, 14000, 11000, 8000, 9500, 12000, 14000, 11000],   # idx 2 – Silver/climbing
    [18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000],# idx 3 – consistent high
    [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],# idx 4 – steady mid
]

_SCRIPTED_PROFILES: list[dict[str, Any]] = [
    {"tier": "Gold",   "adt": 8500, "riskFlags": ["HighVariance"],  "behaviorTags": ["Aggressive"]},
    {"tier": "Bronze", "adt": 2000, "riskFlags": ["None"],          "behaviorTags": ["Conservative"]},
    {"tier": "Silver", "adt": 5200, "riskFlags": ["None"],          "behaviorTags": ["Conservative"]},
    {"tier": "Bronze", "adt": 3000, "riskFlags": ["HighVariance"],  "behaviorTags": ["Aggressive"]},
    {"tier": "Silver", "adt": 3000, "riskFlags": ["None"],          "behaviorTags": ["Aggressive"]},
]


def _derive_sim_patron_ids(table_id: str) -> list[str]:
    """Return 9 stable P-9xxxxx IDs for this table (5 scripted + 4 random-bet).

    Derivation: strip non-digits from table_id, use as base offset.
    Table T-0001 → P-900010 … P-900018 (base = 900000 + table_num × 10).
    Supports tables T-0001 through T-9999 without collision.
    """
    num = int("".join(c for c in table_id if c.isdigit()) or "0")
    base = 900000 + num * 10
    return [f"P-{base + i:06d}" for i in range(9)]


def _random_bet(min_bet: float) -> float:
    return min_bet * (3 + random.randint(0, 11))


# ---------- Targeted patron generation (alert-rule-driven) ----------


class SimulateRoundRequest(BaseModel):
    targetRuleIds: list[str] = []


def _derive_targeted_patron_id(rule_id: str, table_id: str, condition_index: int) -> str:
    """Stable P-8xxxxx ID for a targeted patron (rule + table + condition index)."""
    key = f"{rule_id}:{table_id}:{condition_index}"
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    num = 800000 + (h % 99999)
    return f"P-{num:06d}"


def _build_targeted_session_and_profile(
    condition: dict[str, Any],
    patron_id: str,
    table_id: str,
    min_bet: float,
    now: datetime,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (session_doc, profile_override) tuned to satisfy the given condition."""
    ctype = condition.get("type", "")
    params = condition.get("params") or {}

    # --- derive session fields per condition type ---
    if ctype == "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
        threshold = float(params.get("threshold", 10000))
        bet = max(min_bet * 3, threshold * 1.2)
        adt = round(threshold * 0.3)
        tags = ["Aggressive"]
        tier = "Gold"

    elif ctype == "CUMULATIVE_ROUNDS_BET_THRESHOLD":
        rounds = int(params.get("rounds", 5))
        total = float(params.get("totalThreshold", 50000))
        bet = math.ceil(total / rounds * 1.1)
        adt = 2000
        tags = ["Aggressive"]
        tier = "Gold"

    elif ctype == "SINGLE_ROUND_ADT_MULTIPLIER":
        multiplier = float(params.get("multiplier", 5))
        adt = max(800, round(min_bet * 2))
        bet = round(adt * multiplier * 1.2)
        tags = ["Aggressive"]
        tier = "Silver"

    elif ctype == "SESSION_BET_ABOVE":
        threshold = float(params.get("threshold", 30000))
        bet = round(threshold * 1.1)
        adt = round(threshold * 0.5)
        tags = ["PromoSeeker"]
        tier = "Silver"

    elif ctype == "TIER_MATCH":
        tiers: list[str] = params.get("tiers") or ["Gold"]
        tier = tiers[0]
        bet = round(min_bet * 5)
        adt = round(min_bet * 4)
        tags = ["Conservative"]

    elif ctype == "BEHAVIOR_TAG_MATCH":
        req_tags: list[str] = params.get("tags") or ["Aggressive"]
        tags = [req_tags[0]]
        tier = "Silver"
        bet = round(min_bet * 5)
        adt = round(min_bet * 3)

    else:
        bet = round(min_bet * 5)
        adt = round(min_bet * 2)
        tags = ["Aggressive"]
        tier = "Silver"

    tail = patron_id[-3:]
    session: dict[str, Any] = {
        "patronId": patron_id,
        "tableId": table_id,
        "seatedAt": now - timedelta(hours=1),
        "lastActionAt": now,
        "sessionBetAmount": float(bet),
        "currentStackEstimate": round(bet * (1.5 + random.random())),
        "behaviorTags": tags,
        "isActive": True,
    }
    profile_override: dict[str, Any] = {
        "name": f"Targeted {tail}",
        "maskedName": f"T***{tail}",
        "tier": tier,
        "adt": float(adt),
        "riskFlags": ["HighVariance"],
        "behaviorTags": tags,
    }
    return session, profile_override


@router.get("/tables/{table_id}/simulate-round")
async def get_simulate_round_counter(
    table_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        counter = await db[cols.table_round_counters].find_one({"tableId": table_id})
        return ok_response(tableId=table_id, roundNumber=(counter or {}).get("roundNumber", 0))
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/tables/{table_id}/simulate-round")
async def simulate_round(
    table_id: str,
    body: SimulateRoundRequest = Body(default_factory=SimulateRoundRequest),
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    """Simulate one betting round for a table.

    - Default (no targetRuleIds): injects 9 scripted P-9xxxxx patrons with
      deterministic bet sequences that gradually trigger the seed alert rules
      after several rounds.
    - With targetRuleIds: replaces scripted patrons with ones whose bet amounts,
      tiers, ADTs, and behavior tags are tuned to satisfy each targeted rule's
      conditions. One patron is generated per condition per rule.
    """
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)

        table = await db[cols.tables].find_one(
            {"tableId": table_id}, {"_id": 0, "minBet": 1, "gameType": 1}
        )
        if not table:
            return error_response(f"Table {table_id} not found.", status_code=404)
        min_bet = float(table.get("minBet") or 300)
        game_type = str(table.get("gameType") or "Baccarat")

        counter = await db[cols.table_round_counters].find_one_and_update(
            {"tableId": table_id},
            {"$inc": {"roundNumber": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        round_number = int((counter or {}).get("roundNumber") or 1)

        now = datetime.now(timezone.utc)
        all_sessions: list[dict[str, Any]] = []
        profile_overrides: dict[str, dict[str, Any]] = {}
        mode = "scripted"

        if body.targetRuleIds:
            # ----------------------------------------------------------
            # Targeted mode: generate patrons tuned to trigger the chosen rules
            # ----------------------------------------------------------
            mode = "targeted"
            rules = await db[cols.alert_rules].find(
                {"ruleId": {"$in": body.targetRuleIds}}
            ).to_list(length=None)

            seen_patron_ids: set[str] = set()
            for rule in rules:
                conditions = rule.get("conditions") or []
                for cond_idx, condition in enumerate(conditions):
                    patron_id = _derive_targeted_patron_id(
                        rule["ruleId"], table_id, cond_idx
                    )
                    session, p_override = _build_targeted_session_and_profile(
                        condition, patron_id, table_id, min_bet, now
                    )
                    if patron_id not in seen_patron_ids:
                        all_sessions.append(session)
                        profile_overrides[patron_id] = p_override
                        seen_patron_ids.add(patron_id)
                    else:
                        # Same patron targeted by multiple conditions —
                        # merge: take the higher bet, merge tags
                        existing = next(s for s in all_sessions if s["patronId"] == patron_id)
                        if session["sessionBetAmount"] > existing["sessionBetAmount"]:
                            existing["sessionBetAmount"] = session["sessionBetAmount"]
                            existing["currentStackEstimate"] = session["currentStackEstimate"]
                        existing_tags = set(existing.get("behaviorTags") or [])
                        existing_tags.update(session.get("behaviorTags") or [])
                        existing["behaviorTags"] = list(existing_tags)

        else:
            # ----------------------------------------------------------
            # Default scripted mode: 5 deterministic + 4 random-bet patrons
            # ----------------------------------------------------------
            patron_ids = _derive_sim_patron_ids(table_id)

            for i, spec in enumerate(_SCRIPTED_PROFILES):
                patron_id = patron_ids[i]
                sequence = _SCRIPTED_BET_SEQUENCES[i]
                bet = float(sequence[(round_number - 1) % len(sequence)])
                all_sessions.append({
                    "patronId": patron_id,
                    "tableId": table_id,
                    "seatedAt": now - timedelta(hours=1),
                    "lastActionAt": now,
                    "sessionBetAmount": bet,
                    "currentStackEstimate": round(bet * (1.5 + random.random())),
                    "behaviorTags": spec["behaviorTags"],
                    "isActive": True,
                })
                profile_overrides[patron_id] = {
                    "tier": spec["tier"],
                    "adt": float(spec["adt"]),
                    "riskFlags": spec["riskFlags"],
                }

            for i in range(4):
                patron_id = patron_ids[5 + i]
                bet = _random_bet(min_bet)
                all_sessions.append({
                    "patronId": patron_id,
                    "tableId": table_id,
                    "seatedAt": now - timedelta(minutes=45),
                    "lastActionAt": now,
                    "sessionBetAmount": float(bet),
                    "currentStackEstimate": round(bet * (1.2 + random.random() * 2)),
                    "behaviorTags": ["Aggressive"] if random.random() > 0.5 else ["Conservative"],
                    "isActive": True,
                })

        # Upsert patron_profiles for all generated patrons
        await _upsert_sim_patron_profiles(db, all_sessions, game_type, profile_overrides)

        # Replace old sessions for these patrons at this table
        patron_ids_all = [s["patronId"] for s in all_sessions]
        await db[cols.sessions].delete_many(
            {"tableId": table_id, "patronId": {"$in": patron_ids_all}}
        )
        await db[cols.sessions].insert_many(all_sessions)

        # Write round history snapshots (used by alert MQL executors)
        profiles_cursor = await db[cols.patrons].find(
            {"patronId": {"$in": patron_ids_all}},
            {"_id": 0, "patronId": 1, "adt": 1, "tier": 1, "maskedName": 1},
        ).to_list(length=None)
        profile_map = {p["patronId"]: p for p in profiles_cursor}

        snapshots: list[dict[str, Any]] = []
        for s in all_sessions:
            p = profile_map.get(s["patronId"], {})
            # Use override values for adt/tier if available (ensures alert MQL sees correct values)
            override = profile_overrides.get(s["patronId"], {})
            snapshots.append({
                "tableId": table_id,
                "roundNumber": round_number,
                "patronId": s["patronId"],
                "betAmount": s["sessionBetAmount"],
                "adt": override.get("adt") or p.get("adt", 1000),
                "tier": override.get("tier") or p.get("tier", "Bronze"),
                "behaviorTags": s["behaviorTags"],
                "maskedName": override.get("maskedName") or p.get("maskedName", s["patronId"]),
                "recordedAt": now,
            })
        if snapshots:
            await db[cols.table_round_history].insert_many(snapshots)

        triggered_alerts = await run_alert_analysis(db, table_id, round_number)
        alert_summary = [
            {
                "alertId": a.get("alertId"),
                "ruleId": a.get("ruleId"),
                "ruleName": a.get("ruleName"),
                "patronId": a.get("patronId"),
                "conditionTypes": [tc.get("type") for tc in (a.get("triggeredConditions") or [])],
            }
            for a in triggered_alerts
        ]

        return ok_response(
            tableId=table_id,
            roundNumber=round_number,
            mode=mode,
            sessionsInjected=len(all_sessions),
            alertsTriggered=alert_summary,
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
