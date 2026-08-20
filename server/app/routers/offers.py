"""``/api/offers`` endpoints (dashboard + generate + agent-chat + approve/reject)."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.offer_agent import create_offer_from_prompt
from app.collections import web_collections as cols
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["offers"])


# ---------- Math helpers (mirror dashboard/generate math from TS) ----------


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    length = min(len(a), len(b))
    if length == 0:
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for i in range(length):
        dot += a[i] * b[i]
        norm_a += a[i] * a[i]
        norm_b += b[i] * b[i]
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def _stretch_vector(atlas_score: float) -> float:
    return _clamp01(2 * (atlas_score - 0.5))


def _compute_rule_score(patron: dict[str, Any], offer: dict[str, Any]) -> dict[str, Any]:
    signals: list[str] = []
    tier = str(patron.get("tier") or "Bronze")
    adt = float(patron.get("adt") or 0)
    points = float(patron.get("pointsBalance") or 0)
    preferred_games = patron.get("preferredGames") or []
    targets = offer.get("targetGameTypes") or []
    offer_type = offer.get("offerType") or ""
    region = patron.get("region") or ""

    # game_overlap (0.35)
    game_overlap = 0.0
    overlap = [g for g in targets if g in preferred_games]
    if overlap:
        game_overlap = 1.0
        signals.append(f"遊戲:{overlap[0]}")

    # tier_fit (0.25)
    diamond_platinum = {"Diamond", "Platinum"}
    premium_tiers = {"Diamond", "Platinum", "Gold"}
    if offer_type == "CashRebate":
        tier_fit = 1.0 if tier == "Diamond" else 0.5 if tier == "Platinum" else 0.1
        if tier == "Diamond":
            signals.append("等級:鑽石")
    elif offer_type == "TransportVoucher":
        tier_fit = 1.0 if tier in diamond_platinum else 0.6 if tier == "Gold" else 0.2
        if tier in diamond_platinum:
            signals.append(f"等級:{'鑽石' if tier == 'Diamond' else '白金'}")
    elif offer_type in ("HotelRoom", "MusicShowTicket"):
        tier_fit = (
            1.0 if tier == "Diamond"
            else 0.9 if tier == "Platinum"
            else 0.6 if tier == "Gold"
            else 0.3
        )
        if tier in premium_tiers:
            label = "鑽石" if tier == "Diamond" else "白金" if tier == "Platinum" else "黃金"
            signals.append(f"等級:{label}")
    else:
        # FNBVoucher, PointsLimitedTime
        tier_fit = 1.0 if tier in premium_tiers else 0.75 if tier == "Silver" else 0.5
        signals.append(f"等級:{tier}")

    # adt_fit (0.20)
    adt_fit = 0.5
    if offer_type == "CashRebate":
        adt_fit = (
            1.0 if adt >= 20000 else 0.6 if adt >= 10000 else 0.3 if adt >= 5000 else 0.1
        )
        if adt >= 20000:
            signals.append("ADT>=20k")
        elif adt >= 10000:
            signals.append("ADT>=10k")
    elif offer_type == "HotelRoom":
        adt_fit = (
            1.0 if adt >= 15000 else 0.7 if adt >= 8000 else 0.4 if adt >= 3000 else 0.15
        )
        if adt >= 8000:
            signals.append("ADT>=8k")
    elif offer_type == "MusicShowTicket":
        adt_fit = (
            1.0 if adt >= 10000 else 0.7 if adt >= 5000 else 0.4 if adt >= 2000 else 0.2
        )
        if adt >= 5000:
            signals.append("ADT>=5k")
    elif offer_type == "TransportVoucher":
        adt_fit = 1.0 if adt >= 8000 else 0.6 if adt >= 4000 else 0.25
        if adt >= 8000:
            signals.append("ADT>=8k")

    # points_fit (0.15)
    points_fit = 0.5
    if offer_type == "PointsLimitedTime":
        points_fit = (
            1.0 if points >= 20000
            else 0.75 if points >= 10000
            else 0.5 if points >= 5000
            else 0.3 if points >= 500
            else 0.1
        )
        if points >= 10000:
            signals.append("積分豐富")
        elif points >= 5000:
            signals.append("積分>=5k")
    elif offer_type == "MusicShowTicket":
        points_fit = 0.8 if points >= 5000 else 0.5 if points >= 1000 else 0.3

    # region_fit (0.05)
    gba_regions = {"HongKong", "Guangdong", "OtherGBA", "Macau"}
    region_fit = 0.5
    region_label = {
        "HongKong": "香港",
        "Guangdong": "廣東",
        "OtherGBA": "大灣區",
        "Macau": "澳門",
        "Taiwan": "台灣",
        "International": "國際",
    }
    if offer_type == "TransportVoucher":
        region_fit = 1.0 if region in gba_regions else 0.6 if region == "Taiwan" else 0.3
        if region in gba_regions:
            signals.append(f"地區:{region_label.get(region, region)}")
    elif region and region in region_label:
        signals.append(f"地區:{region_label[region]}")

    rule_part = _clamp01(
        0.35 * game_overlap + 0.25 * tier_fit + 0.20 * adt_fit + 0.15 * points_fit + 0.05 * region_fit
    )
    return {"rulePart": rule_part, "signals": list(dict.fromkeys(signals))[:4]}


def _build_reason(strength: str, vector_part: float, rule_part: float, signals: list[str]) -> str:
    vec = f"語義相似度 {int(vector_part * 100)}%"
    rules = "、".join(signals[:3]) if signals else "規則匹配有限"
    if strength == "Strong":
        return f"高度匹配 — {vec}，佐以 {rules}。"
    if strength == "Moderate":
        return f"中等匹配 — {vec}；支持信號：{rules}。"
    return f"低度匹配 — 現有最佳選項（{vec}），規則貢獻 {int(rule_part * 100)}%。"


# ---------- Routes ----------


@router.get("/offers/dashboard")
async def dashboard(db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        offers = await db[cols.offers].find(
            {},
            {
                "_id": 0,
                "offerId": 1,
                "offerType": 1,
                "title": 1,
                "status": 1,
                "priority": 1,
                "estimatedCost": 1,
                "createdBy": 1,
                "approvalReview": 1,
                "createdAt": 1,
            },
        ).sort([("priority", -1), ("createdAt", -1)]).limit(40).to_list(length=40)

        recommendations = await db[cols.recommendations].find(
            {},
            {
                "_id": 0,
                "recommendationId": 1,
                "patronId": 1,
                "offerId": 1,
                "relevanceScore": 1,
                "confidence": 1,
                "status": 1,
                "generatedAt": 1,
                "expiresAt": 1,
                "reasonSummary": 1,
                "nextBestAction": 1,
            },
        ).sort("generatedAt", -1).limit(40).to_list(length=40)

        recent_activities = await db[cols.patrons].aggregate(
            [
                {"$unwind": "$activities"},
                {
                    "$project": {
                        "_id": 0,
                        "eventId": "$activities.eventId",
                        "patronId": "$patronId",
                        "activityType": "$activities.activityType",
                        "source": "$activities.source",
                        "amount": "$activities.amount",
                        "pointsDelta": "$activities.pointsDelta",
                        "eventTime": "$activities.eventTime",
                    }
                },
                {"$sort": {"eventTime": -1}},
                {"$limit": 40},
            ]
        ).to_list(length=40)

        status_counts: dict[str, int] = {}
        for r in recommendations:
            key = r.get("status") or "Unknown"
            status_counts[key] = status_counts.get(key, 0) + 1

        offer_status_counts: dict[str, int] = {}
        for o in offers:
            key = str(o.get("status") or "Unknown")
            offer_status_counts[key] = offer_status_counts.get(key, 0) + 1

        return ok_response(
            summary={
                "offerCount": len(offers),
                "recommendationCount": len(recommendations),
                "recentActivityCount": len(recent_activities),
                "recommendationStatusCounts": status_counts,
                "offerStatusCounts": offer_status_counts,
                "proposedCount": offer_status_counts.get("Proposed", 0),
            },
            offers=offers,
            recommendations=recommendations,
            recentActivities=recent_activities,
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/offers/generate")
async def generate(request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        body = await request.json()
        patron_id = body.get("patronId")
        if not patron_id:
            return error_response("patronId is required", status_code=400)

        patron = await db[cols.patrons].find_one(
            {"patronId": patron_id}, {"_id": 0}
        )
        if not patron:
            return error_response("Patron not found", status_code=404)

        session = await db[cols.sessions].find_one(
            {"patronId": patron_id, "isActive": True}, {"_id": 0, "behaviorTags": 1}
        )
        behavior_tags = (session or {}).get("behaviorTags") or []

        preference_embedding = patron.get("preferenceEmbedding") or []

        candidates: list[dict[str, Any]] = []
        generator = "vector-search-rerank"

        try:
            candidates = await db[cols.offers].aggregate(
                [
                    {
                        "$vectorSearch": {
                            "index": "offer_vector_idx",
                            "path": "offerEmbedding",
                            "queryVector": preference_embedding,
                            "numCandidates": 100,
                            "limit": 10,
                        }
                    },
                    {
                        "$project": {
                            "_id": 0,
                            "offerId": 1,
                            "title": 1,
                            "offerType": 1,
                            "targetGameTypes": 1,
                            "estimatedCost": 1,
                            "atlasScore": {"$meta": "vectorSearchScore"},
                        }
                    },
                ]
            ).to_list(length=10)
        except Exception:  # noqa: BLE001
            candidates = []

        if not candidates:
            generator = "cosine-fallback-rerank"
            offers = await db[cols.offers].find(
                {}, {"_id": 0}
            ).limit(100).to_list(length=100)
            candidates = []
            for offer in offers:
                cos = _cosine_similarity(preference_embedding, offer.get("offerEmbedding") or [])
                candidates.append(
                    {
                        "offerId": str(offer.get("offerId")),
                        "title": str(offer.get("title")),
                        "offerType": str(offer.get("offerType")),
                        "targetGameTypes": offer.get("targetGameTypes"),
                        "estimatedCost": offer.get("estimatedCost"),
                        "atlasScore": (1 + cos) / 2,
                    }
                )
            candidates.sort(key=lambda x: x["atlasScore"], reverse=True)
            candidates = candidates[:10]

        patron_ctx = {
            "tier": patron.get("tier"),
            "adt": patron.get("adt"),
            "preferredGames": patron.get("preferredGames"),
            "pointsBalance": patron.get("pointsBalance"),
            "region": patron.get("region"),
        }

        reranked = []
        for c in candidates:
            vec_part = _stretch_vector(c["atlasScore"])
            rule = _compute_rule_score(
                patron_ctx,
                {
                    "offerType": c["offerType"],
                    "targetGameTypes": c.get("targetGameTypes"),
                    "estimatedCost": c.get("estimatedCost"),
                },
            )
            final_score = _clamp01(0.6 * vec_part + 0.4 * rule["rulePart"])
            strength = (
                "Strong" if final_score >= 0.7
                else "Moderate" if final_score >= 0.45
                else "Weak"
            )
            reason = _build_reason(strength, vec_part, rule["rulePart"], rule["signals"])
            reranked.append(
                {
                    "offerId": c["offerId"],
                    "title": c["title"],
                    "offerType": c["offerType"],
                    "estimatedCost": c.get("estimatedCost"),
                    "score": round(final_score, 4),
                    "breakdown": {
                        "atlasScore": round(c["atlasScore"], 4),
                        "vectorPart": round(vec_part, 4),
                        "rulePart": round(rule["rulePart"], 4),
                    },
                    "strength": strength,
                    "reason": reason,
                    "matchSignals": rule["signals"],
                }
            )
        reranked.sort(key=lambda x: x["score"], reverse=True)
        reranked = reranked[:3]

        return ok_response(
            patron={
                "patronId": patron.get("patronId"),
                "tier": patron.get("tier"),
                "adt": patron.get("adt"),
                "preferredGames": patron.get("preferredGames") or [],
                "pointsBalance": patron.get("pointsBalance") or 0,
                "region": patron.get("region"),
                "behaviorTags": behavior_tags,
            },
            generatedOffers=reranked,
            generator=generator,
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/offers/agent-chat")
async def agent_chat(
    request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        message = (body.get("message") or "").strip()
        if not message:
            return error_response("message is required", status_code=400)
        result = await create_offer_from_prompt(db, message)
        return ok_response(**result)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


async def _decide_offer(
    db: AsyncIOMotorDatabase,
    offer_id: str,
    decision: str,
    body: dict[str, Any],
) -> Any:
    if not offer_id:
        return error_response("offerId is required", status_code=400)
    actor_id = body.get("actorId") or "console-user"
    rationale = (body.get("rationale") or "").strip() or None

    if decision == "Reject" and not rationale:
        return error_response(
            "rationale is required to reject an offer", status_code=400
        )

    offer = await db[cols.offers].find_one(
        {"offerId": offer_id}, {"_id": 0, "status": 1, "offerId": 1}
    )
    if not offer:
        return error_response("Offer not found", status_code=404)
    if offer.get("status") != "Proposed":
        return error_response(
            f"Offer status is {offer.get('status')}; only Proposed offers can be "
            f"{'approved' if decision == 'Approve' else 'rejected'}",
            status_code=409,
        )

    now = datetime.now(timezone.utc)
    to_status = "Active" if decision == "Approve" else "Rejected"

    await db[cols.offers].update_one(
        {"offerId": offer_id},
        {
            "$set": {
                "status": to_status,
                "updatedAt": now,
                "approvalReview": {
                    "decision": decision,
                    "rationale": rationale,
                    "actorId": actor_id,
                    "decidedAt": now,
                },
            }
        },
    )
    await db[cols.offer_approval_audit].insert_one(
        {
            "offerId": offer_id,
            "fromStatus": "Proposed",
            "toStatus": to_status,
            "decision": decision,
            "actorId": actor_id,
            "rationale": rationale,
            "decidedAt": now,
        }
    )
    updated = await db[cols.offers].find_one(
        {"offerId": offer_id},
        {
            "_id": 0,
            "offerId": 1,
            "offerType": 1,
            "title": 1,
            "status": 1,
            "priority": 1,
            "estimatedCost": 1,
            "createdBy": 1,
            "approvalReview": 1,
        },
    )
    return ok_response(offer=updated)


@router.post("/offers/{offer_id}/approve")
async def approve_offer(
    offer_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        return await _decide_offer(db, offer_id, "Approve", body)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/offers/{offer_id}/reject")
async def reject_offer(
    offer_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        return await _decide_offer(db, offer_id, "Reject", body)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
