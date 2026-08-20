"""Table drill-down agent (LangGraph).

Direct port of ``src/web/table-drilldown-agent.ts``. Two nodes:
``load → score``. Ranks active patrons on a given table by loss-potential and
attaches vector-matched offer suggestions.
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.collections import web_collections as cols


class _State(TypedDict, total=False):
    table_id: str
    patrons: list[dict[str, Any]]
    ranked_patrons: list[dict[str, Any]]
    summary: dict[str, Any] | None
    reply: str
    error: str | None
    db: Any


def _normalize(value: float, max_v: float) -> float:
    if max_v <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_v))


def _behavior_risk_score(tags: list[str]) -> float:
    score = 0.2
    if "Aggressive" in tags:
        score += 0.4
    if "LateNight" in tags:
        score += 0.15
    if "PromoSeeker" in tags:
        score += 0.1
    if "CardCounterWatch" in tags:
        score += 0.1
    if "Conservative" in tags:
        score -= 0.2
    return max(0.0, min(1.0, score))


def _tier_loss_factor(tier: str) -> float:
    return {
        "Diamond": 0.18,
        "Platinum": 0.16,
        "Gold": 0.14,
        "Silver": 0.12,
    }.get(tier, 0.1)


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


def _build_recommendation(patron: dict[str, Any], score: float) -> str:
    if score >= 0.75:
        if patron["tier"] in ("Diamond", "Platinum"):
            return "Offer premium hotel/show bundle with host outreach now."
        return "Offer high-value points multiplier package in-session."
    if score >= 0.5:
        return "Offer timed F&B + points booster to extend play duration."
    return "Use lightweight retention voucher and monitor next session behavior."


async def _find_top_offers_for_patron(
    db, preference_embedding: list[float]
) -> list[dict[str, Any]]:
    if not preference_embedding:
        return []
    try:
        matches = await db[cols.offers].aggregate(
            [
                {
                    "$vectorSearch": {
                        "index": "offer_vector_idx",
                        "path": "offerEmbedding",
                        "queryVector": preference_embedding,
                        "numCandidates": 40,
                        "limit": 3,
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "offerId": 1,
                        "title": 1,
                        "offerType": 1,
                        "score": {"$meta": "vectorSearchScore"},
                    }
                },
            ]
        ).to_list(length=3)
        return [{**row, "score": round(float(row.get("score", 0)), 4)} for row in matches]
    except Exception:  # noqa: BLE001
        offers = await db[cols.offers].find(
            {}, {"_id": 0, "offerId": 1, "title": 1, "offerType": 1, "offerEmbedding": 1}
        ).limit(100).to_list(length=100)
        scored = [
            {
                "offerId": str(o.get("offerId")),
                "title": str(o.get("title")),
                "offerType": str(o.get("offerType")),
                "score": round(
                    _cosine_similarity(preference_embedding, o.get("offerEmbedding") or []), 4
                ),
            }
            for o in offers
        ]
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:3]


async def _load_table_patrons(db, table_id: str) -> list[dict[str, Any]]:
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
        {"$unwind": "$patron"},
        {
            "$project": {
                "_id": 0,
                "patronId": "$patron.patronId",
                "maskedName": "$patron.maskedName",
                "tier": "$patron.tier",
                "adt": "$patron.adt",
                "pointsBalance": "$patron.pointsBalance",
                "preferenceEmbedding": "$patron.preferenceEmbedding",
                "sessionBetAmount": 1,
                "currentStackEstimate": 1,
                "behaviorTags": 1,
            }
        },
    ]
    return await db[cols.sessions].aggregate(pipeline).to_list(length=None)


# ---------- Nodes ----------


async def _node_load(state: _State) -> dict[str, Any]:
    db = state["db"]
    patrons = await _load_table_patrons(db, state["table_id"])
    if not patrons:
        return {
            "patrons": [],
            "ranked_patrons": [],
            "summary": {
                "totalPatrons": 0,
                "highPotentialCount": 0,
                "mediumPotentialCount": 0,
                "avgPotentialScore": 0,
                "bestTargetPatronId": None,
            },
            "reply": "No active patrons found on this table right now.",
        }
    return {"patrons": patrons}


async def _node_score(state: _State) -> dict[str, Any]:
    patrons = state.get("patrons") or []
    if not patrons:
        return {}

    max_bet = max((p.get("sessionBetAmount") or 0 for p in patrons), default=1) or 1
    max_adt = max((p.get("adt") or 0 for p in patrons), default=1) or 1
    max_points = max((p.get("pointsBalance") or 0 for p in patrons), default=1) or 1
    max_stack = max((p.get("currentStackEstimate") or 0 for p in patrons), default=1) or 1

    ranked_base: list[dict[str, Any]] = []
    for patron in patrons:
        bet_signal = _normalize(patron.get("sessionBetAmount") or 0, max_bet)
        adt_signal = _normalize(patron.get("adt") or 0, max_adt)
        points_signal = _normalize(patron.get("pointsBalance") or 0, max_points)
        stack_signal = _normalize(patron.get("currentStackEstimate") or 0, max_stack)
        behavior_signal = _behavior_risk_score(patron.get("behaviorTags") or [])

        score = (
            bet_signal * 0.35
            + adt_signal * 0.25
            + stack_signal * 0.15
            + points_signal * 0.1
            + behavior_signal * 0.15
        )
        rounded = round(score, 4)
        label = "High" if rounded >= 0.72 else "Medium" if rounded >= 0.5 else "Low"
        confidence = round(0.6 + behavior_signal * 0.2 + bet_signal * 0.2, 4)
        loss_factor = _tier_loss_factor(patron.get("tier", ""))
        center_loss = (patron.get("sessionBetAmount") or 0) * loss_factor
        expected_loss_range = {
            "min": round(center_loss * 0.75),
            "max": round(center_loss * 1.35),
        }
        reasons = [
            f"Session bet intensity {int(bet_signal * 100)}%",
            f"ADT signal {int(adt_signal * 100)}%",
            f"Behavior risk {int(behavior_signal * 100)}%",
        ]
        ranked_base.append(
            {
                **patron,
                "lossPotentialScore": rounded,
                "lossPotentialLabel": label,
                "confidence": confidence,
                "expectedLossRange": expected_loss_range,
                "recommendation": _build_recommendation(patron, rounded),
                "reasons": reasons,
            }
        )

    ranked_base.sort(key=lambda p: p["lossPotentialScore"], reverse=True)

    db = state["db"]

    async def _attach_offers(patron: dict[str, Any]) -> dict[str, Any]:
        suggestions = await _find_top_offers_for_patron(
            db, patron.get("preferenceEmbedding") or []
        )
        return {
            "patronId": patron["patronId"],
            "maskedName": patron["maskedName"],
            "tier": patron["tier"],
            "adt": patron["adt"],
            "pointsBalance": patron["pointsBalance"],
            "sessionBetAmount": patron["sessionBetAmount"],
            "currentStackEstimate": patron["currentStackEstimate"],
            "behaviorTags": patron["behaviorTags"],
            "lossPotentialScore": patron["lossPotentialScore"],
            "lossPotentialLabel": patron["lossPotentialLabel"],
            "confidence": patron["confidence"],
            "expectedLossRange": patron["expectedLossRange"],
            "recommendation": patron["recommendation"],
            "reasons": patron["reasons"],
            "suggestedOffers": suggestions,
        }

    ranked = await asyncio.gather(*(_attach_offers(p) for p in ranked_base))

    high_count = sum(1 for p in ranked if p["lossPotentialLabel"] == "High")
    medium_count = sum(1 for p in ranked if p["lossPotentialLabel"] == "Medium")
    avg_score = round(sum(p["lossPotentialScore"] for p in ranked) / len(ranked), 4)

    return {
        "ranked_patrons": list(ranked),
        "summary": {
            "totalPatrons": len(ranked),
            "highPotentialCount": high_count,
            "mediumPotentialCount": medium_count,
            "avgPotentialScore": avg_score,
            "bestTargetPatronId": ranked[0]["patronId"] if ranked else None,
        },
        "reply": f"Analyzed {len(ranked)} patrons. Top target: "
        f"{ranked[0]['patronId'] if ranked else 'N/A'}.",
    }


def _build_graph() -> Any:
    g = StateGraph(_State)
    g.add_node("load", _node_load)
    g.add_node("score", _node_score)
    g.add_edge(START, "load")
    g.add_edge("load", "score")
    g.add_edge("score", END)
    return g.compile()


_GRAPH = _build_graph()


async def analyze_table_patrons(db, table_id: str) -> dict[str, Any]:
    result = await _GRAPH.ainvoke(
        {
            "table_id": table_id,
            "patrons": [],
            "ranked_patrons": [],
            "summary": None,
            "reply": "",
            "error": None,
            "db": db,
        }
    )
    return {
        "tableId": table_id,
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
        "summary": result.get("summary")
        or {
            "totalPatrons": 0,
            "highPotentialCount": 0,
            "mediumPotentialCount": 0,
            "avgPotentialScore": 0,
            "bestTargetPatronId": None,
        },
        "rankedPatrons": result.get("ranked_patrons") or [],
    }
