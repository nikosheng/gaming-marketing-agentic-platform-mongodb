"""Alert-analyzer — runs each active ``AlertRule`` against a new table round
and produces ``PatronAlert`` documents.

Direct port of ``src/web/alert-analyzer.ts``. MQL aggregation pipelines are
kept byte-compatible so field names and indexes on the Mongo side don't need
to change.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.collections import web_collections as cols
from app.llm.gateway import chat_text
from app.schemas.alert import ConditionType

# ---------- Types (dict-shaped for speed) ----------

ConditionHit = dict[str, Any]
TriggeredPatron = dict[str, Any]
Params = dict[str, Any]


# ---------- MQL executors (one per ConditionType) ----------


async def _exec_consecutive_rounds_bet_threshold(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    rounds = int(params.get("rounds", 3))
    threshold = float(params.get("threshold", 10000))
    from_round = round_number - rounds + 1

    cursor = db[cols.table_round_history].aggregate(
        [
            {"$match": {"tableId": table_id, "roundNumber": {"$gte": from_round, "$lte": round_number}}},
            {
                "$group": {
                    "_id": "$patronId",
                    "count": {"$sum": 1},
                    "minBet": {"$min": "$betAmount"},
                    "bets": {"$push": {"round": "$roundNumber", "amount": "$betAmount"}},
                    "tier": {"$first": "$tier"},
                    "adt": {"$first": "$adt"},
                    "maskedName": {"$first": "$maskedName"},
                }
            },
            {"$match": {"count": {"$gte": rounds}, "minBet": {"$gt": threshold}}},
        ]
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["_id"],
            "tier": r["tier"],
            "adt": r["adt"],
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
                "rounds": rounds,
                "threshold": threshold,
                "consecutiveRounds": r["count"],
                "minBet": r["minBet"],
                "bets": sorted(r.get("bets") or [], key=lambda b: b.get("round", 0)),
            },
        }
        for r in rows
    ]


async def _exec_cumulative_rounds_bet_threshold(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    rounds = int(params.get("rounds", 5))
    total_threshold = float(params.get("totalThreshold", 50000))
    from_round = round_number - rounds + 1

    cursor = db[cols.table_round_history].aggregate(
        [
            {"$match": {"tableId": table_id, "roundNumber": {"$gte": from_round, "$lte": round_number}}},
            {
                "$group": {
                    "_id": "$patronId",
                    "count": {"$sum": 1},
                    "total": {"$sum": "$betAmount"},
                    "bets": {"$push": "$betAmount"},
                    "tier": {"$first": "$tier"},
                    "adt": {"$first": "$adt"},
                    "maskedName": {"$first": "$maskedName"},
                }
            },
            {"$match": {"count": {"$gte": rounds}, "total": {"$gt": total_threshold}}},
        ]
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["_id"],
            "tier": r["tier"],
            "adt": r["adt"],
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "CUMULATIVE_ROUNDS_BET_THRESHOLD",
                "rounds": rounds,
                "totalThreshold": total_threshold,
                "actualRounds": r["count"],
                "totalBet": r["total"],
                "bets": r.get("bets", []),
            },
        }
        for r in rows
    ]


async def _exec_any_round_bet_threshold(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    rounds = int(params.get("rounds", 3))
    threshold = float(params.get("threshold", 5000))
    from_round = round_number - rounds + 1

    cursor = db[cols.table_round_history].aggregate(
        [
            {"$match": {"tableId": table_id, "roundNumber": {"$gte": from_round, "$lte": round_number}}},
            {
                "$group": {
                    "_id": "$patronId",
                    "count": {"$sum": 1},
                    "qualifyingRounds": {
                        "$sum": {"$cond": [{"$gt": ["$betAmount", threshold]}, 1, 0]}
                    },
                    "maxBet": {"$max": "$betAmount"},
                    "bets": {"$push": {"round": "$roundNumber", "amount": "$betAmount"}},
                    "tier": {"$first": "$tier"},
                    "adt": {"$first": "$adt"},
                    "maskedName": {"$first": "$maskedName"},
                }
            },
            {"$match": {"qualifyingRounds": {"$gte": 1}}},
        ]
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["_id"],
            "tier": r["tier"],
            "adt": r["adt"],
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "ANY_ROUND_BET_THRESHOLD",
                "rounds": rounds,
                "threshold": threshold,
                "qualifyingRounds": r["qualifyingRounds"],
                "maxBet": r["maxBet"],
                "bets": sorted(r.get("bets") or [], key=lambda b: b.get("round", 0)),
            },
        }
        for r in rows
    ]


async def _exec_single_round_adt_multiplier(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    multiplier = float(params.get("multiplier", 5))

    cursor = db[cols.table_round_history].aggregate(
        [
            {"$match": {"tableId": table_id, "roundNumber": round_number}},
            {"$match": {"$expr": {"$gt": ["$betAmount", {"$multiply": ["$adt", multiplier]}]}}},
        ]
    )
    rows = await cursor.to_list(length=None)
    hits: list[ConditionHit] = []
    for r in rows:
        adt = r.get("adt", 0) or 0
        bet = r.get("betAmount", 0) or 0
        adt_ratio = round(bet / adt, 2) if adt > 0 else None
        hits.append(
            {
                "patronId": r["patronId"],
                "tier": r["tier"],
                "adt": adt,
                "maskedName": r["maskedName"],
                "evidence": {
                    "conditionType": "SINGLE_ROUND_ADT_MULTIPLIER",
                    "multiplier": multiplier,
                    "betAmount": bet,
                    "adt": adt,
                    "adtRatio": adt_ratio,
                    "adtThreshold": adt * multiplier,
                },
            }
        )
    return hits


async def _exec_session_bet_above(
    db: AsyncIOMotorDatabase, table_id: str, _round_number: int, params: Params
) -> list[ConditionHit]:
    threshold = float(params.get("threshold", 30000))

    cursor = db[cols.sessions].aggregate(
        [
            {
                "$match": {
                    "tableId": table_id,
                    "isActive": True,
                    "sessionBetAmount": {"$gt": threshold},
                }
            },
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
                    "patronId": 1,
                    "sessionBetAmount": 1,
                    "tier": {"$ifNull": ["$patron.tier", "Bronze"]},
                    "adt": {"$ifNull": ["$patron.adt", 0]},
                    "maskedName": {"$ifNull": ["$patron.maskedName", "$patronId"]},
                }
            },
        ]
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["patronId"],
            "tier": r["tier"],
            "adt": r["adt"],
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "SESSION_BET_ABOVE",
                "threshold": threshold,
                "sessionBetAmount": r["sessionBetAmount"],
            },
        }
        for r in rows
    ]


async def _exec_tier_match(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    tiers = params.get("tiers")
    if not isinstance(tiers, list):
        tiers = ["Gold", "Platinum", "Diamond"]

    cursor = db[cols.table_round_history].find(
        {"tableId": table_id, "roundNumber": round_number, "tier": {"$in": tiers}}
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["patronId"],
            "tier": r["tier"],
            "adt": r.get("adt", 0),
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "TIER_MATCH",
                "matchedTiers": tiers,
                "patronTier": r["tier"],
                "betAmount": r.get("betAmount", 0),
            },
        }
        for r in rows
    ]


async def _exec_behavior_tag_match(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int, params: Params
) -> list[ConditionHit]:
    tags = params.get("tags")
    if not isinstance(tags, list):
        tags = ["Aggressive"]

    cursor = db[cols.table_round_history].find(
        {"tableId": table_id, "roundNumber": round_number, "behaviorTags": {"$in": tags}}
    )
    rows = await cursor.to_list(length=None)
    return [
        {
            "patronId": r["patronId"],
            "tier": r["tier"],
            "adt": r.get("adt", 0),
            "maskedName": r["maskedName"],
            "evidence": {
                "conditionType": "BEHAVIOR_TAG_MATCH",
                "requiredTags": tags,
                "matchedTags": [t for t in (r.get("behaviorTags") or []) if t in tags],
                "betAmount": r.get("betAmount", 0),
            },
        }
        for r in rows
    ]


Executor = Callable[
    [AsyncIOMotorDatabase, str, int, Params], Awaitable[list[ConditionHit]]
]

_EXECUTORS: dict[ConditionType, Executor] = {
    "CONSECUTIVE_ROUNDS_BET_THRESHOLD": _exec_consecutive_rounds_bet_threshold,
    "CUMULATIVE_ROUNDS_BET_THRESHOLD": _exec_cumulative_rounds_bet_threshold,
    "ANY_ROUND_BET_THRESHOLD": _exec_any_round_bet_threshold,
    "SINGLE_ROUND_ADT_MULTIPLIER": _exec_single_round_adt_multiplier,
    "SESSION_BET_ABOVE": _exec_session_bet_above,
    "TIER_MATCH": _exec_tier_match,
    "BEHAVIOR_TAG_MATCH": _exec_behavior_tag_match,
}


# ---------- Optional LLM rationale ----------


def _format_hkd(v: Any) -> str:
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return str(v)


async def _generate_alert_rationale(
    patron_snapshot: dict[str, Any],
    triggered_conditions: list[dict[str, Any]],
    table_snapshot: dict[str, Any],
) -> str | None:
    parts: list[str] = []
    for tc in triggered_conditions:
        ev = tc.get("evidence", {})
        t = tc.get("type")
        if t == "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
            parts.append(
                f"連續 {ev.get('consecutiveRounds')} 輪下注均超 HKD "
                f"{_format_hkd(ev.get('threshold'))}（最低一輪 HKD {_format_hkd(ev.get('minBet'))}）"
            )
        elif t == "CUMULATIVE_ROUNDS_BET_THRESHOLD":
            parts.append(
                f"{ev.get('actualRounds')} 輪累計下注 HKD "
                f"{_format_hkd(ev.get('totalBet'))}（閾值 HKD {_format_hkd(ev.get('totalThreshold'))}）"
            )
        elif t == "SINGLE_ROUND_ADT_MULTIPLIER":
            parts.append(
                f"本輪下注 HKD {_format_hkd(ev.get('betAmount'))}，"
                f"為個人 ADT 的 {ev.get('adtRatio')} 倍（閾值 {ev.get('multiplier')} 倍）"
            )
        elif t == "ANY_ROUND_BET_THRESHOLD":
            parts.append(
                f"最近 {ev.get('rounds')} 輪中有 {ev.get('qualifyingRounds')} 輪下注超 "
                f"HKD {_format_hkd(ev.get('threshold'))}（最高一輪 HKD {_format_hkd(ev.get('maxBet'))}）"
            )
        elif t == "SESSION_BET_ABOVE":
            parts.append(
                f"本場累計下注 HKD {_format_hkd(ev.get('sessionBetAmount'))}"
                f"（閾值 HKD {_format_hkd(ev.get('threshold'))}）"
            )
        else:
            parts.append(str(t))

    condition_summary = "；".join(parts)
    tags = patron_snapshot.get("behaviorTags") or []
    tags_str = "、".join(tags) if tags else "無"

    user_prompt = (
        "賭場 AI 告警系統識別到一名高價值賭客。\n"
        f"賭客: {patron_snapshot.get('maskedName')}"
        f"（{patron_snapshot.get('tier')} 會員，ADT HKD {_format_hkd(patron_snapshot.get('adt'))}）\n"
        f"桌台: {table_snapshot.get('tableName')}"
        f"（{table_snapshot.get('gameType')}，{table_snapshot.get('zone')}）\n"
        f"觸發條件: {condition_summary}\n"
        f"行為標籤: {tags_str}\n\n"
        "請用 1-2 句繁體中文寫出這個告警的重要性，"
        "並給出一個具體的服務建議（例如：立即安排 VIP 專員介入，提供XXX服務）。"
        "字數控制在 50 字以內。"
    )

    return await chat_text(
        system="你是賭場貴賓服務 AI，專責識別高價值客戶並給出簡短服務建議。",
        user=user_prompt,
        temperature=0.4,
        max_tokens=120,
    )


# ---------- Public API ----------


async def analyze_rule(
    db: AsyncIOMotorDatabase, rule: dict[str, Any], table_id: str, round_number: int
) -> list[TriggeredPatron]:
    """Evaluate a single rule (OR-logic across its conditions)."""

    conditions = rule.get("conditions") or []

    async def _run_condition(cond: dict[str, Any]) -> tuple[str, list[ConditionHit]]:
        executor = _EXECUTORS.get(cond.get("type"))
        if executor is None:
            return cond.get("type"), []
        hits = await executor(db, table_id, round_number, cond.get("params") or {})
        return cond.get("type"), hits

    results = await asyncio.gather(*(_run_condition(c) for c in conditions))

    by_patron: dict[str, TriggeredPatron] = {}
    for cond_type, hits in results:
        for hit in hits:
            entry = by_patron.setdefault(
                hit["patronId"], {"patronId": hit["patronId"], "triggeredConditions": []}
            )
            entry["triggeredConditions"].append({"type": cond_type, "evidence": hit["evidence"]})
    return list(by_patron.values())


_ID_SAFE = re.compile(r"[^A-Z0-9-]", re.IGNORECASE)


async def run_alert_analysis(
    db: AsyncIOMotorDatabase, table_id: str, round_number: int
) -> list[dict[str, Any]]:
    """Run every ``Active`` rule; write ``PatronAlert`` docs; return them."""

    rules = await db[cols.alert_rules].find({"status": "Active"}).to_list(length=None)
    if not rules:
        return []

    table_doc = await db[cols.tables].find_one(
        {"tableId": table_id},
        {"_id": 0, "tableName": 1, "gameType": 1, "zone": 1},
    )
    table_snapshot = {
        "tableName": (table_doc or {}).get("tableName", table_id),
        "gameType": (table_doc or {}).get("gameType", "Unknown"),
        "zone": (table_doc or {}).get("zone", "Unknown"),
    }

    rule_results = []
    for rule in rules:
        triggered = await analyze_rule(db, rule, table_id, round_number)
        rule_results.append((rule, triggered))

    all_patron_ids: set[str] = set()
    for _rule, triggered in rule_results:
        for t in triggered:
            all_patron_ids.add(t["patronId"])

    patron_profiles: dict[str, dict[str, Any]] = {}
    if all_patron_ids:
        docs = await db[cols.patrons].find(
            {"patronId": {"$in": list(all_patron_ids)}},
            {
                "_id": 0,
                "patronId": 1,
                "maskedName": 1,
                "tier": 1,
                "adt": 1,
                "behaviorTags": 1,
                "riskFlags": 1,
                "preferredGames": 1,
            },
        ).to_list(length=None)
        for p in docs:
            patron_profiles[p["patronId"]] = {
                "maskedName": p.get("maskedName"),
                "tier": p.get("tier"),
                "adt": p.get("adt", 0),
                "behaviorTags": p.get("behaviorTags") or [],
                "riskFlags": p.get("riskFlags") or [],
                "preferredGames": p.get("preferredGames") or [],
            }
        # Fallback for TEST patrons: round history snapshot
        for patron_id in all_patron_ids:
            if patron_id in patron_profiles:
                continue
            snap = await db[cols.table_round_history].find_one(
                {"tableId": table_id, "patronId": patron_id}, sort=[("roundNumber", -1)]
            )
            if snap:
                patron_profiles[patron_id] = {
                    "maskedName": snap.get("maskedName"),
                    "tier": snap.get("tier"),
                    "adt": snap.get("adt", 0),
                    "behaviorTags": snap.get("behaviorTags") or [],
                    "riskFlags": [],
                    "preferredGames": [],
                }

    alerts_to_insert: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for rule, triggered in rule_results:
        if not triggered:
            continue
        for tp in triggered:
            profile = patron_profiles.get(
                tp["patronId"],
                {
                    "maskedName": tp["patronId"],
                    "tier": "Unknown",
                    "adt": 0,
                    "behaviorTags": [],
                    "riskFlags": [],
                    "preferredGames": [],
                },
            )
            raw_id = f"ALERT-{int(now.timestamp() * 1000)}-{tp['patronId']}-{rule['ruleId']}"
            alert = {
                "alertId": _ID_SAFE.sub("-", raw_id),
                "ruleId": rule["ruleId"],
                "ruleName": rule.get("name"),
                "patronId": tp["patronId"],
                "tableId": table_id,
                "triggeredConditions": tp["triggeredConditions"],
                "patronSnapshot": profile,
                "tableSnapshot": table_snapshot,
                "status": "New",
                "triggeredAt": now,
            }
            try:
                rationale = await _generate_alert_rationale(
                    profile, tp["triggeredConditions"], table_snapshot
                )
                if rationale:
                    alert["llmRationale"] = rationale
            except Exception:  # noqa: BLE001
                pass
            alerts_to_insert.append(alert)

        await db[cols.alert_rules].update_one(
            {"ruleId": rule["ruleId"]},
            {"$inc": {"totalTriggered": len(triggered)}, "$set": {"lastTriggeredAt": now}},
        )

    if alerts_to_insert:
        await db[cols.patron_alerts].insert_many(alerts_to_insert)

    return alerts_to_insert
