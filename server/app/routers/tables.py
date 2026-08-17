"""``/api/tables`` endpoints (heatmap, per-table drill-down, simulation, min-bet)."""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
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
) -> None:
    sim_sessions = [s for s in sessions if str(s.get("patronId", "")).startswith("SIM-")]
    if not sim_sessions:
        return
    now = datetime.now(timezone.utc)
    for session in sim_sessions:
        patron_id = str(session.get("patronId") or "")
        if not patron_id:
            continue
        profile = _build_sim_profile(
            patron_id=patron_id,
            game_type=game_type,
            session_bet_amount=float(session.get("sessionBetAmount") or 0),
            now=now,
        )
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


# ---------- Simulate-round (test patrons + alert analysis) ----------


_TEST_BET_SEQUENCES: dict[str, list[int]] = {
    "TEST-S1-P1": [12000, 15500, 11200, 5000, 8000, 12000, 15500, 11200, 5000, 8000],
    "TEST-S1-P2": [4000, 6000, 3500, 5000, 7000, 4000, 6000, 3500, 5000, 7000],
    "TEST-S2-P1": [8000, 9500, 12000, 14000, 11000, 8000, 9500, 12000, 14000, 11000],
    "TEST-S3-P1": [18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000],
    "TEST-S3-P2": [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
}

_TEST_PATRON_PROFILES: list[dict[str, Any]] = [
    {
        "patronId": "TEST-S1-P1",
        "name": "Test Alpha",
        "maskedName": "T***AP",
        "tier": "Gold",
        "adt": 8500,
        "preferredGames": ["Baccarat"],
        "riskFlags": ["HighVariance"],
        "pointsBalance": 45000,
        "region": "HongKong",
    },
    {
        "patronId": "TEST-S1-P2",
        "name": "Test Beta",
        "maskedName": "T***BT",
        "tier": "Bronze",
        "adt": 2000,
        "preferredGames": ["SicBo"],
        "riskFlags": ["None"],
        "pointsBalance": 3000,
        "region": "Macau",
    },
    {
        "patronId": "TEST-S2-P1",
        "name": "Test Gamma",
        "maskedName": "T***GM",
        "tier": "Silver",
        "adt": 5200,
        "preferredGames": ["Blackjack"],
        "riskFlags": ["None"],
        "pointsBalance": 12000,
        "region": "Guangdong",
    },
    {
        "patronId": "TEST-S3-P1",
        "name": "Test Delta",
        "maskedName": "T***DT",
        "tier": "Bronze",
        "adt": 3000,
        "preferredGames": ["Baccarat"],
        "riskFlags": ["HighVariance"],
        "pointsBalance": 5000,
        "region": "Guangdong",
    },
    {
        "patronId": "TEST-S3-P2",
        "name": "Test Epsilon",
        "maskedName": "T***EP",
        "tier": "Silver",
        "adt": 3000,
        "preferredGames": ["Roulette"],
        "riskFlags": ["None"],
        "pointsBalance": 8000,
        "region": "HongKong",
    },
]


def _random_bet(min_bet: float) -> float:
    multiplier = 3 + random.randint(0, 11)
    return min_bet * multiplier


async def _upsert_test_patrons(db: AsyncIOMotorDatabase) -> None:
    now = datetime.now(timezone.utc)
    for patron in _TEST_PATRON_PROFILES:
        payload = {
            **patron,
            "lastActiveAt": now,
            "activities": [],
            "preferenceEmbedding": [0.0] * 1024,
            "createdAt": now,
            "updatedAt": now,
        }
        await db[cols.patrons].update_one(
            {"patronId": patron["patronId"]},
            {"$setOnInsert": payload},
            upsert=True,
        )


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
    table_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not table_id:
            return error_response("tableId is required", status_code=400)

        table = await db[cols.tables].find_one(
            {"tableId": table_id}, {"_id": 0, "minBet": 1}
        )
        if not table:
            return error_response(f"Table {table_id} not found.", status_code=404)
        min_bet = float(table.get("minBet") or 300)

        counter = await db[cols.table_round_counters].find_one_and_update(
            {"tableId": table_id},
            {"$inc": {"roundNumber": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        round_number = int((counter or {}).get("roundNumber") or 1)

        await _upsert_test_patrons(db)

        now = datetime.now(timezone.utc)
        all_sessions: list[dict[str, Any]] = []
        for patron_id, sequence in _TEST_BET_SEQUENCES.items():
            bet_amount = sequence[(round_number - 1) % len(sequence)]
            behavior_tags = (
                ["Aggressive"] if ("S1" in patron_id or "S3" in patron_id) else ["Conservative"]
            )
            all_sessions.append(
                {
                    "patronId": patron_id,
                    "tableId": table_id,
                    "seatedAt": now - timedelta(hours=1),
                    "lastActionAt": now,
                    "sessionBetAmount": bet_amount,
                    "currentStackEstimate": round(bet_amount * (1.5 + random.random())),
                    "behaviorTags": behavior_tags,
                    "isActive": True,
                }
            )
        for i in range(1, 5):
            bet = _random_bet(min_bet)
            all_sessions.append(
                {
                    "patronId": f"SIM-RND-{str(i).zfill(3)}",
                    "tableId": table_id,
                    "seatedAt": now - timedelta(minutes=45),
                    "lastActionAt": now,
                    "sessionBetAmount": bet,
                    "currentStackEstimate": round(bet * (1.2 + random.random() * 2)),
                    "behaviorTags": ["Aggressive"] if random.random() > 0.5 else ["Conservative"],
                    "isActive": True,
                }
            )

        await _upsert_sim_patron_profiles(
            db,
            all_sessions,
            str(table.get("gameType") or "Baccarat"),
        )

        patron_ids = [s["patronId"] for s in all_sessions]
        await db[cols.sessions].delete_many(
            {"tableId": table_id, "patronId": {"$in": patron_ids}}
        )
        await db[cols.sessions].insert_many(all_sessions)

        profiles = await db[cols.patrons].find(
            {"patronId": {"$in": patron_ids}},
            {"_id": 0, "patronId": 1, "adt": 1, "tier": 1, "maskedName": 1},
        ).to_list(length=None)
        profile_map = {p["patronId"]: p for p in profiles}

        snapshots = []
        for s in all_sessions:
            p = profile_map.get(s["patronId"], {})
            snapshots.append(
                {
                    "tableId": table_id,
                    "roundNumber": round_number,
                    "patronId": s["patronId"],
                    "betAmount": s["sessionBetAmount"],
                    "adt": p.get("adt", 1000),
                    "tier": p.get("tier", "Bronze"),
                    "behaviorTags": s["behaviorTags"],
                    "maskedName": p.get("maskedName", s["patronId"]),
                    "recordedAt": now,
                }
            )
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
            sessionsInjected=len(all_sessions),
            alertsTriggered=alert_summary,
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
