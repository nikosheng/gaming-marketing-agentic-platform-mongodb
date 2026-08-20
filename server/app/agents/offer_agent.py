"""Offer-generation agent (LangGraph).

Direct port of ``src/web/offer-agent.ts``. Five nodes:
``parse → match → embed → create → summarize``.

Uses dual-track matching:
* Path A — ``$vectorSearch`` on ``patron_profiles.preferenceEmbedding``.
* Path B — numeric / enum MongoDB filter.

Strategy selection prefers the intersection, relaxes to union if the
intersection is too small, and falls back to numeric-only when vector search
is unavailable.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.collections import web_collections as cols
from app.llm.embeddings import generate_embedding
from app.llm.gateway import chat_json

OfferType = Literal[
    "HotelRoom",
    "MusicShowTicket",
    "PointsLimitedTime",
    "FNBVoucher",
    "CashRebate",
    "TransportVoucher",
]
PatronRegion = Literal[
    "Macau", "HongKong", "Guangdong", "OtherGBA", "Taiwan", "International"
]
MatchStrategy = Literal["intersection", "relaxed-union", "numeric-fallback"]

_VALID_REGIONS: set[str] = {
    "Macau", "HongKong", "Guangdong", "OtherGBA", "Taiwan", "International",
}


class _State(TypedDict, total=False):
    prompt: str
    criteria: dict[str, Any] | None
    eligibility_rules: list[str]
    matching_patron_ids: list[str]
    match_strategy: MatchStrategy | None
    offer_embedding: list[float]
    created_offer: dict[str, Any] | None
    stats: dict[str, Any] | None
    sample_matched_patrons: list[dict[str, Any]]
    requires_clarification: bool
    guidance_questions: list[dict[str, str]]
    reply: str
    error: str | None
    db: Any


_SYSTEM_PROMPT = """你是賭場行銷優惠分析助手。
用戶會用中文、英文或混合語言描述一個行銷優惠的目標受眾及條件。
你的任務是從中提取結構化資訊，並輸出 JSON 格式。

可用的 offerType 值（只能選其中之一）：
- "HotelRoom"         → 酒店客房/套房禮遇
- "MusicShowTicket"   → 演唱會/娛樂表演門票
- "PointsLimitedTime" → 限時積分兌換活動
- "FNBVoucher"        → 餐飲/飲品禮品券
- "CashRebate"        → 現金回扣/籌碼回贈
- "TransportVoucher"  → 接送/專車/直升機禮券

可用的 tier 值：Bronze, Silver, Gold, Platinum, Diamond
可用的 gameTypes 值：Baccarat, Blackjack, Roulette, SicBo, Poker
可用的 activityType 值：ChipExchange, TableBet, PointsRedeem, DrinkRedeem, ShowPurchase, HotelBooking

可用的 regions 值（賓客來源地區）：
- "Macau"          → 澳門本地賓客
- "HongKong"       → 香港賓客
- "Guangdong"      → 廣東省賓客
- "OtherGBA"       → 其他大灣區城市（深圳/珠海/佛山等）
- "Taiwan"         → 台灣賓客
- "International"  → 海外/國際賓客

輸出 JSON 格式（所有欄位均為英文 key，值可包含中文）：
{
  "tiers": [],
  "gameTypes": [],
  "regions": [],
  "minAdt": null,
  "maxAdt": null,
  "minPoints": null,
  "activeWithinDays": null,
  "activityType": null,
  "activityMinAmount": null,
  "offerType": "PointsLimitedTime",
  "offerTitle": "（10字以內的繁體中文標題）",
  "offerDescription": "（50字以內的繁體中文描述，說明優惠內容及目標受眾）",
  "estimatedCost": 500,
  "priority": 70,
  "semanticQuery": "（用於語義搜尋的繁體中文摘要，描述目標賓客特徵，如：香港及廣東省高消費鑽石等級百家樂賓客，ADT 高，近期活躍）"
}

規則：
- 若無法確定 offerType，默認為 "PointsLimitedTime"
- estimatedCost 默認 500，priority 默認 70
- semanticQuery 必須用繁體中文，包含地區、tier、遊戲偏好、消費模式等目標賓客特徵
- 若用戶沒有提及某個欄位，設為 null 或空陣列
- tiers、gameTypes、regions 必須使用上方列出的英文枚舉值
- 大灣區 = HongKong + Guangdong + OtherGBA（若用戶提及「大灣區」，填入這三個）"""


_RELEVANT_RE = re.compile(
    r"(offer|promotion|campaign|reward|voucher|points|hotel|show|ticket|"
    r"優惠|促銷|活動|禮遇|積分|酒店|演唱|門票|餐飲|接送|回扣|賓客|賭客|玩家)",
    re.IGNORECASE,
)


def _is_prompt_relevant(prompt: str) -> bool:
    return bool(_RELEVANT_RE.search(prompt or ""))


def _guidance_questions() -> list[dict[str, str]]:
    return [
        {
            "id": "offer-type",
            "question": "您希望提供什麼類型的優惠？",
            "example": "酒店套房、演唱會門票、積分兌換、餐飲禮券、現金回扣或專車接送",
        },
        {
            "id": "target-segment",
            "question": "目標賓客是哪個等級或遊戲偏好？",
            "example": "鑽石及白金等級偏好百家樂的賓客",
        },
        {
            "id": "thresholds",
            "question": "有哪些數字門檻要求？",
            "example": "ADT >= 8,000，積分餘額 >= 20,000",
        },
        {
            "id": "recency-activity",
            "question": "對活躍時間或近期活動有要求嗎？",
            "example": "14 天內有桌面下注記錄",
        },
    ]


async def _parse_criteria_with_llm(prompt: str) -> dict[str, Any] | None:
    raw = await chat_json(
        system=_SYSTEM_PROMPT, user=prompt, temperature=0.2, max_tokens=1500
    )
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None

    tiers = parsed.get("tiers") if isinstance(parsed.get("tiers"), list) else []
    game_types = parsed.get("gameTypes") if isinstance(parsed.get("gameTypes"), list) else []
    regions_raw = parsed.get("regions") if isinstance(parsed.get("regions"), list) else []
    regions = [r for r in regions_raw if r in _VALID_REGIONS]

    def _num(v: Any) -> float | None:
        return v if isinstance(v, (int, float)) else None

    offer_title = parsed.get("offerTitle")
    if not isinstance(offer_title, str) or not offer_title.strip():
        offer_title = f"AI 優惠 {datetime.now(timezone.utc).date().isoformat()}"
    else:
        offer_title = offer_title.strip()

    offer_desc = parsed.get("offerDescription")
    if isinstance(offer_desc, str):
        offer_desc = offer_desc[:200]
    else:
        offer_desc = prompt[:200]

    priority = parsed.get("priority")
    priority = int(max(1, min(100, priority))) if isinstance(priority, (int, float)) else 70

    semantic = parsed.get("semanticQuery")
    if not isinstance(semantic, str) or not semantic.strip():
        semantic = prompt[:200]
    else:
        semantic = semantic.strip()

    return {
        "tiers": tiers,
        "gameTypes": game_types,
        "regions": regions,
        "minAdt": _num(parsed.get("minAdt")),
        "maxAdt": _num(parsed.get("maxAdt")),
        "minPoints": _num(parsed.get("minPoints")),
        "activeWithinDays": _num(parsed.get("activeWithinDays")),
        "activityType": parsed.get("activityType") if isinstance(parsed.get("activityType"), str) else None,
        "activityMinAmount": _num(parsed.get("activityMinAmount")),
        "offerType": parsed.get("offerType") or "PointsLimitedTime",
        "offerTitle": offer_title,
        "offerDescription": offer_desc,
        "estimatedCost": parsed.get("estimatedCost") if isinstance(parsed.get("estimatedCost"), (int, float)) else 500,
        "priority": priority,
        "semanticQuery": semantic,
    }


def _build_eligibility_rules(c: dict[str, Any]) -> list[str]:
    rules: list[str] = []
    if c.get("tiers"):
        rules.append(f"tier in [{', '.join(c['tiers'])}]")
    if c.get("gameTypes"):
        rules.append(f"preferredGames includes [{', '.join(c['gameTypes'])}]")
    if c.get("regions"):
        rules.append(f"region in [{', '.join(c['regions'])}]")
    if c.get("minAdt"):
        rules.append(f"adt >= {c['minAdt']}")
    if c.get("maxAdt"):
        rules.append(f"adt < {c['maxAdt']}")
    if c.get("minPoints"):
        rules.append(f"pointsBalance >= {c['minPoints']}")
    if c.get("activeWithinDays"):
        rules.append(f"lastActiveAt within {c['activeWithinDays']} days")
    if c.get("activityType"):
        min_amt = c.get("activityMinAmount")
        if min_amt:
            rules.append(f"{c['activityType']} amount >= {min_amt}")
        else:
            rules.append(f"{c['activityType']} exists")
    if not rules:
        rules.append("no strict filter (all active patrons)")
    return rules


async def _find_matching_patron_ids(db, c: dict[str, Any]) -> tuple[list[str], MatchStrategy]:
    patron_coll = db[cols.patrons]

    # Path B — numeric filter
    patron_filter: dict[str, Any] = {}
    if c.get("tiers"):
        patron_filter["tier"] = {"$in": c["tiers"]}
    if c.get("gameTypes"):
        patron_filter["preferredGames"] = {"$in": c["gameTypes"]}
    if c.get("regions"):
        patron_filter["region"] = {"$in": c["regions"]}
    if c.get("minAdt"):
        patron_filter["adt"] = {"$gte": c["minAdt"]}
    if c.get("maxAdt"):
        adt_flt = patron_filter.get("adt", {})
        adt_flt["$lt"] = c["maxAdt"]
        patron_filter["adt"] = adt_flt
    if c.get("minPoints"):
        patron_filter["pointsBalance"] = {"$gte": c["minPoints"]}

    from_date: datetime | None = None
    if c.get("activeWithinDays"):
        from_date = datetime.now(timezone.utc) - timedelta(days=float(c["activeWithinDays"]))
        patron_filter["lastActiveAt"] = {"$gte": from_date}

    if c.get("activityType"):
        act_match: dict[str, Any] = {"activityType": c["activityType"]}
        if c.get("activityMinAmount"):
            act_match["amount"] = {"$gte": c["activityMinAmount"]}
        if from_date is not None:
            act_match["eventTime"] = {"$gte": from_date}
        patron_filter["activities"] = {"$elemMatch": act_match}

    has_numeric_filter = bool(patron_filter)
    if has_numeric_filter:
        docs = await patron_coll.find(
            patron_filter, {"_id": 0, "patronId": 1}
        ).limit(5000).to_list(length=5000)
        numeric_ids = {d["patronId"] for d in docs}
    else:
        numeric_ids = set()

    # Path A — $vectorSearch
    vector_ids: set[str] = set()
    try:
        query_embedding = await generate_embedding(c["semanticQuery"], "query")
        if any(v != 0 for v in query_embedding):
            vec_docs = await patron_coll.aggregate(
                [
                    {
                        "$vectorSearch": {
                            "index": "patron_preference_vector_idx",
                            "path": "preferenceEmbedding",
                            "queryVector": query_embedding,
                            "numCandidates": 300,
                            "limit": 150,
                        }
                    },
                    {"$project": {"_id": 0, "patronId": 1}},
                ]
            ).to_list(length=None)
            vector_ids = {d["patronId"] for d in vec_docs}
    except Exception:  # noqa: BLE001
        vector_ids = set()

    has_vector = bool(vector_ids)
    has_numeric = bool(numeric_ids)

    if has_vector and has_numeric:
        intersection = list(vector_ids & numeric_ids)
        if len(intersection) >= 5:
            return intersection, "intersection"
        return list(vector_ids | numeric_ids), "relaxed-union"
    if has_vector and not has_numeric:
        return list(vector_ids), "intersection"
    if has_numeric and not has_vector:
        return list(numeric_ids), "numeric-fallback"
    return [], "numeric-fallback"


async def _build_generation_stats(db, matching_ids: list[str]) -> dict[str, Any]:
    total_patrons = await db[cols.patrons].count_documents({})
    if not matching_ids:
        return {
            "totalPatrons": total_patrons,
            "matchedPatrons": 0,
            "matchRate": 0,
            "avgMatchedAdt": 0,
            "tierBreakdown": [],
            "gameBreakdown": [],
        }

    coll = db[cols.patrons]
    tier_task = coll.aggregate(
        [
            {"$match": {"patronId": {"$in": matching_ids}}},
            {"$group": {"_id": "$tier", "value": {"$sum": 1}}},
            {"$sort": {"value": -1}},
            {"$limit": 5},
        ]
    ).to_list(length=None)
    game_task = coll.aggregate(
        [
            {"$match": {"patronId": {"$in": matching_ids}}},
            {"$unwind": "$preferredGames"},
            {"$group": {"_id": "$preferredGames", "value": {"$sum": 1}}},
            {"$sort": {"value": -1}},
            {"$limit": 5},
        ]
    ).to_list(length=None)
    adt_task = coll.aggregate(
        [
            {"$match": {"patronId": {"$in": matching_ids}}},
            {"$group": {"_id": None, "avgMatchedAdt": {"$avg": "$adt"}}},
        ]
    ).to_list(length=None)

    import asyncio as _asyncio  # local to avoid top-level dep churn

    tier_rows, game_rows, adt_rows = await _asyncio.gather(tier_task, game_task, adt_task)

    return {
        "totalPatrons": total_patrons,
        "matchedPatrons": len(matching_ids),
        "matchRate": (len(matching_ids) / total_patrons) if total_patrons > 0 else 0,
        "avgMatchedAdt": int(round((adt_rows[0].get("avgMatchedAdt") if adt_rows else 0) or 0)),
        "tierBreakdown": [{"label": str(r["_id"]), "value": int(r["value"])} for r in tier_rows],
        "gameBreakdown": [{"label": str(r["_id"]), "value": int(r["value"])} for r in game_rows],
    }


async def _create_offer_document(
    db, criteria: dict[str, Any], eligibility_rules: list[str], offer_embedding: list[float]
) -> dict[str, Any]:
    offer_id = f"OFFER-AI-{int(time.time() * 1000)}"
    now = datetime.now(timezone.utc)
    priority = max(1, min(100, int(criteria.get("priority") or 70)))
    doc = {
        "offerId": offer_id,
        "offerType": criteria["offerType"],
        "title": criteria["offerTitle"],
        "description": criteria["offerDescription"],
        "eligibilityRules": eligibility_rules,
        "estimatedCost": criteria.get("estimatedCost", 500),
        "targetGameTypes": criteria.get("gameTypes", []),
        "priority": priority,
        "status": "Proposed",
        "createdBy": "AIAgent",
        "offerEmbedding": offer_embedding,
        "createdAt": now,
        "updatedAt": now,
    }
    await db[cols.offers].insert_one(doc)
    return {
        "offerId": doc["offerId"],
        "title": doc["title"],
        "offerType": doc["offerType"],
        "status": doc["status"],
        "priority": doc["priority"],
        "estimatedCost": doc["estimatedCost"],
        "eligibilityRules": doc["eligibilityRules"],
        "createdBy": doc["createdBy"],
    }


def _strategy_label(strategy: MatchStrategy) -> str:
    return {
        "intersection": "語義搜尋 × 數字條件交集",
        "relaxed-union": "條件放寬聯集（交集賓客數不足，已擴展範圍）",
        "numeric-fallback": "數字條件篩選（向量搜尋暫不可用）",
    }[strategy]


# ---------- Nodes ----------


async def _node_parse(state: _State) -> dict[str, Any]:
    prompt = (state.get("prompt") or "").strip()
    if not prompt:
        return {"error": "message is required"}
    if not _is_prompt_relevant(prompt):
        return {
            "criteria": None,
            "requires_clarification": True,
            "guidance_questions": _guidance_questions(),
            "eligibility_rules": [],
        }
    criteria = await _parse_criteria_with_llm(prompt)
    if not criteria:
        return {
            "criteria": None,
            "requires_clarification": True,
            "guidance_questions": _guidance_questions(),
            "eligibility_rules": [],
        }
    return {
        "criteria": criteria,
        "requires_clarification": False,
        "guidance_questions": [],
        "eligibility_rules": _build_eligibility_rules(criteria),
    }


async def _node_match(state: _State) -> dict[str, Any]:
    if state.get("error") or not state.get("criteria") or state.get("requires_clarification"):
        return {}
    db = state["db"]
    ids, strategy = await _find_matching_patron_ids(db, state["criteria"])
    stats = await _build_generation_stats(db, ids)

    if not ids:
        sample = []
    else:
        sample = await db[cols.patrons].aggregate(
            [
                {"$match": {"patronId": {"$in": ids}}},
                {"$sort": {"adt": -1}},
                {"$limit": 3},
                {
                    "$project": {
                        "_id": 0,
                        "patronId": 1,
                        "maskedName": 1,
                        "tier": 1,
                        "adt": 1,
                        "pointsBalance": 1,
                        "preferredGames": 1,
                    }
                },
            ]
        ).to_list(length=3)

    return {
        "matching_patron_ids": ids,
        "match_strategy": strategy,
        "stats": stats,
        "sample_matched_patrons": sample,
    }


async def _node_embed(state: _State) -> dict[str, Any]:
    if state.get("error") or not state.get("criteria") or state.get("requires_clarification"):
        return {}
    c = state["criteria"]
    text = (
        f"{c['offerTitle']}。{c['offerDescription']}。"
        f"{'；'.join(state.get('eligibility_rules') or [])}"
    )
    embedding = await generate_embedding(text, "document")
    return {"offer_embedding": embedding}


async def _node_create(state: _State) -> dict[str, Any]:
    if state.get("error") or not state.get("criteria") or state.get("requires_clarification"):
        return {}
    db = state["db"]
    created = await _create_offer_document(
        db, state["criteria"], state.get("eligibility_rules") or [], state.get("offer_embedding") or []
    )
    return {"created_offer": created}


def _node_summarize(state: _State) -> dict[str, Any]:
    if state.get("error"):
        return {"reply": state["error"]}

    if state.get("requires_clarification"):
        guide = "\n".join(
            f"{i + 1}. {q['question']}（例如：{q['example']}）"
            for i, q in enumerate(state.get("guidance_questions") or [])
        )
        return {"reply": "在生成優惠前，需要您提供更多資訊，請回答以下問題：\n" + guide}

    created = state.get("created_offer")
    if not created:
        return {"reply": "無法根據提供的描述創建優惠，請嘗試提供更具體的條件。"}

    strategy = state.get("match_strategy") or "numeric-fallback"
    strat_desc = _strategy_label(strategy)
    match_count = len(state.get("matching_patron_ids") or [])

    parts = [
        f"優惠「{created['title']}」（{created['offerId']}）已提交，等待管理員審批。",
        f"匹配策略：{strat_desc}。",
        f"符合條件的賓客：{match_count} 人。",
        f"篩選條件：{'；'.join(state.get('eligibility_rules') or [])}。",
        "最高消費樣本賓客已顯示於影響圖表中。"
        if match_count > 0
        else "目前沒有賓客符合此條件，請考慮放寬條件。",
        "請在「Offer Catalog」的「Proposed」篩選器中進行審核。",
    ]
    return {"reply": " ".join(parts)}


# ---------- Graph builder ----------


def _build_graph() -> Any:
    g = StateGraph(_State)
    g.add_node("parse", _node_parse)
    g.add_node("match", _node_match)
    g.add_node("embed", _node_embed)
    g.add_node("create", _node_create)
    g.add_node("summarize", _node_summarize)
    g.add_edge(START, "parse")
    g.add_edge("parse", "match")
    g.add_edge("match", "embed")
    g.add_edge("embed", "create")
    g.add_edge("create", "summarize")
    g.add_edge("summarize", END)
    return g.compile()


_GRAPH = _build_graph()


async def create_offer_from_prompt(db, prompt: str) -> dict[str, Any]:
    result = await _GRAPH.ainvoke(
        {
            "prompt": prompt,
            "criteria": None,
            "eligibility_rules": [],
            "matching_patron_ids": [],
            "match_strategy": None,
            "offer_embedding": [],
            "created_offer": None,
            "stats": None,
            "sample_matched_patrons": [],
            "requires_clarification": False,
            "guidance_questions": [],
            "reply": "",
            "error": None,
            "db": db,
        }
    )

    matching = result.get("matching_patron_ids") or []
    return {
        "reply": result.get("reply", ""),
        "createdOffer": result.get("created_offer"),
        "matchedPatronCount": len(matching),
        "matchedPatronSample": matching[:12],
        "sampleMatchedPatrons": result.get("sample_matched_patrons") or [],
        "stats": result.get("stats"),
        "requiresClarification": bool(result.get("requires_clarification")),
        "guidanceQuestions": result.get("guidance_questions") or [],
        "engine": "langgraph",
    }
