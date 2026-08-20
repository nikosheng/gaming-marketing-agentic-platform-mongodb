"""PR-efficiency analytics + KPI vector search.

Port of ``src/web/pr-efficiency-agent.ts``. Uses Atlas Vector Search
(``$vectorSearch``) against the ``patron_interaction_history`` collection.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.collections import web_collections as cols
from app.llm.embeddings import generate_embedding
from app.llm.gateway import chat_json, is_gateway_configured

logger = logging.getLogger("app.agents.pr_efficiency_agent")


async def get_pr_metrics(db: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    interaction_agg, type_breakdowns, tier_breakdowns, pr_profiles = await asyncio.gather(
        db[cols.patron_interactions]
        .aggregate(
            [
                {
                    "$group": {
                        "_id": "$recordedBy",
                        "totalInteractions": {"$sum": 1},
                        "totalValueHKD": {"$sum": "$totalValueHKD"},
                        "uniquePatrons": {"$addToSet": "$patronId"},
                        "lastInteractionAt": {"$max": "$occurredAt"},
                    }
                }
            ]
        )
        .to_list(length=None),
        db[cols.patron_interactions]
        .aggregate(
            [
                {
                    "$group": {
                        "_id": {"recordedBy": "$recordedBy", "type": "$type"},
                        "count": {"$sum": 1},
                    }
                }
            ]
        )
        .to_list(length=None),
        db[cols.patron_interactions]
        .aggregate(
            [
                {"$match": {"patronTierAtTime": {"$exists": True, "$ne": None}}},
                {
                    "$group": {
                        "_id": {"recordedBy": "$recordedBy", "tier": "$patronTierAtTime"},
                        "count": {"$sum": 1},
                    }
                },
            ]
        )
        .to_list(length=None),
        db[cols.pr_agents]
        .find({}, {"prAgentId": 1, "name": 1, "active": 1})
        .to_list(length=None),
    )

    interaction_map: dict[str, dict[str, Any]] = {r["_id"]: r for r in interaction_agg}

    type_map: dict[str, dict[str, int]] = {}
    for tb in type_breakdowns:
        pr_id = tb["_id"]["recordedBy"]
        type_map.setdefault(pr_id, {})[tb["_id"]["type"]] = tb["count"]

    tier_map: dict[str, dict[str, int]] = {}
    for tb in tier_breakdowns:
        pr_id = tb["_id"]["recordedBy"]
        tier_map.setdefault(pr_id, {})[tb["_id"]["tier"]] = tb["count"]

    results: list[dict[str, Any]] = []
    for pr in pr_profiles:
        pr_id = pr.get("prAgentId")
        agg = interaction_map.get(pr_id, {})
        results.append(
            {
                "prAgentId": pr_id,
                "name": pr.get("name"),
                "active": pr.get("active", False),
                "totalInteractions": agg.get("totalInteractions", 0),
                "interactionsByType": type_map.get(pr_id, {}),
                "totalValueHKD": agg.get("totalValueHKD", 0),
                "uniquePatrons": len(agg.get("uniquePatrons") or []),
                "tierDistribution": tier_map.get(pr_id, {}),
                "lastInteractionAt": agg.get("lastInteractionAt"),
            }
        )
    return results


# ---------- KPI Search ----------

_KPI_MATCH_THRESHOLD = 0.70
_VECTOR_SEARCH_LIMIT = 300
_VECTOR_NUM_CANDIDATES = 600


async def _generate_kpi_insight(
    kpi_text: str, results: list[dict[str, Any]]
) -> dict[str, Any]:
    fallback = {
        "insight": "資料不足，無法生成 AI 建議。",
        "actions": ["請確保已記錄足夠的互動資料後再次搜尋。"],
    }
    if not is_gateway_configured():
        return fallback

    pr_summary = "\n".join(
        f"{r['prName']}（{r['prAgentId']}）：共 {r['totalInteractions']} 筆記錄，"
        f"匹配 {r['matchedCount']} 筆，達成率 {int(r['kpiAchievementRate'] * 100)}%，"
        f"最高相似度 {r['topMatchScore']}"
        for r in results
    )

    user_prompt = (
        "你是賭場行銷管理顧問。請根據以下公關人員的 KPI 達成情況，"
        "輸出 JSON 格式的管理建議（繁體中文）。\n\n"
        f"KPI 目標：{kpi_text}\n\n"
        f"各公關人員表現：\n{pr_summary}\n\n"
        "輸出格式：\n"
        "{\n"
        "  \"insight\": \"（2-3句整體分析，指出表現差異、可能原因）\",\n"
        "  \"actions\": [\n"
        "    \"（針對管理層的具體行動建議1）\",\n"
        "    \"（針對管理層的具體行動建議2）\",\n"
        "    \"（針對管理層的具體行動建議3）\"\n"
        "  ]\n"
        "}\n\n"
        "要求：\n"
        "- insight 著重橫向比較，點名表現最佳和最需改善的公關\n"
        "- actions 提供管理層可以立即執行的具體步驟\n"
        "- 若所有人達成率均為 0%，建議管理層先建立此類互動的記錄習慣"
    )

    raw = await chat_json(
        system=(
            "你是賭場行銷管理顧問，專責分析公關人員績效並給出管理建議。"
            "請嚴格按指定 JSON 格式輸出。"
        ),
        user=user_prompt,
        temperature=0.4,
        max_tokens=10000,
    )
    if not raw:
        return fallback

    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return fallback

    return {
        "insight": parsed.get("insight") or fallback["insight"],
        "actions": parsed.get("actions") if isinstance(parsed.get("actions"), list) and parsed.get("actions") else fallback["actions"],
    }


async def run_kpi_search(db: AsyncIOMotorDatabase, kpi_text: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)

    query_vector = await generate_embedding(kpi_text, "query")

    vector_hits: list[dict[str, Any]] = []
    try:
        vector_hits = await db[cols.patron_interactions].aggregate(
            [
                {
                    "$vectorSearch": {
                        "index": "interaction_embedding_idx",
                        "path": "interactionEmbedding",
                        "queryVector": query_vector,
                        "numCandidates": _VECTOR_NUM_CANDIDATES,
                        "limit": _VECTOR_SEARCH_LIMIT,
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "interactionId": 1,
                        "patronId": 1,
                        "recordedBy": 1,
                        "type": 1,
                        "occurredAt": 1,
                        "score": {"$meta": "vectorSearchScore"},
                    }
                },
            ]
        ).to_list(length=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("vectorSearch failed: %s", exc)

    pr_profiles_task = db[cols.pr_agents].find(
        {"active": True}, {"prAgentId": 1, "name": 1}
    ).to_list(length=None)
    total_counts_task = db[cols.patron_interactions].aggregate(
        [{"$group": {"_id": "$recordedBy", "total": {"$sum": 1}}}]
    ).to_list(length=None)
    pr_profiles, total_counts_agg = await asyncio.gather(pr_profiles_task, total_counts_task)

    total_count_map = {r["_id"]: r["total"] for r in total_counts_agg}

    hits_by_pr: dict[str, dict[str, Any]] = {}
    for hit in vector_hits:
        pr_id = hit.get("recordedBy")
        group = hits_by_pr.setdefault(pr_id, {"matchedHits": [], "topScore": 0.0})
        if hit.get("score", 0) >= _KPI_MATCH_THRESHOLD:
            group["matchedHits"].append(hit)
        if hit.get("score", 0) > group["topScore"]:
            group["topScore"] = hit["score"]

    results: list[dict[str, Any]] = []
    for pr in pr_profiles:
        pr_id = pr.get("prAgentId")
        group = hits_by_pr.get(pr_id, {"matchedHits": [], "topScore": 0.0})
        total_interactions = total_count_map.get(pr_id, 0)
        matched_count = len(group["matchedHits"])
        top_score = group["topScore"]
        rate = matched_count / total_interactions if total_interactions > 0 else 0

        samples = sorted(group["matchedHits"], key=lambda h: h.get("score", 0), reverse=True)[:3]
        matched_samples = [
            {
                "type": s.get("type"),
                "occurredAt": (
                    s["occurredAt"].isoformat()
                    if isinstance(s.get("occurredAt"), datetime)
                    else str(s.get("occurredAt"))
                ),
                "score": round(s.get("score", 0), 3),
            }
            for s in samples
        ]

        results.append(
            {
                "prAgentId": pr_id,
                "prName": pr.get("name"),
                "topMatchScore": round(top_score, 3),
                "matchedCount": matched_count,
                "totalInteractions": total_interactions,
                "kpiAchievementRate": round(rate, 3),
                "matchedSamples": matched_samples,
            }
        )

    results.sort(
        key=lambda r: (r["kpiAchievementRate"], r["topMatchScore"]), reverse=True
    )

    top_performer = next((r["prAgentId"] for r in results if r["totalInteractions"] > 0), None)
    bottom_performer = next(
        (r["prAgentId"] for r in reversed(results) if r["totalInteractions"] > 0), None
    )

    insight_pack = await _generate_kpi_insight(kpi_text, results)

    return {
        "kpiText": kpi_text,
        "results": results,
        "topPerformer": top_performer,
        "bottomPerformer": bottom_performer,
        "insight": insight_pack["insight"],
        "actions": insight_pack["actions"],
        "searchedAt": now,
    }
