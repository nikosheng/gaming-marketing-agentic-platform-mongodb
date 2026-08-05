"""Patron profile analysis agent (Draft report generator).

Port of ``src/web/patron-profile-agent.ts``. Pulls patron + interactions +
alert + PR pool in parallel, asks the LLM (via LiteLLM gateway) for a
Chinese JSON analysis, falls back to a deterministic report on failure.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.collections import web_collections as cols
from app.config import settings
from app.llm.gateway import chat_json


_TYPE_LABEL = {
    "ROOM_COMP": "免費房間",
    "FB_COMP": "餐飲優惠",
    "REBATE": "現金/籌碼回贈",
    "EVENT_INVITE": "活動邀請",
    "OUTREACH": "電話/親身接觸",
    "TRANSFER": "交通接送",
}


def _hkd(v: Any) -> str:
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return "0"


def _fmt_interaction(rec: dict[str, Any]) -> str:
    occurred = rec.get("occurredAt")
    if isinstance(occurred, datetime):
        date_str = occurred.strftime("%Y/%m/%d")
    else:
        date_str = str(occurred)[:10]

    type_label = _TYPE_LABEL.get(rec.get("type", ""), rec.get("type", ""))
    total = rec.get("totalValueHKD", 0)
    value = f"（HKD {_hkd(total)}）" if total > 0 else ""

    detail = ""
    d = rec.get("detail") or {}
    t = rec.get("type")
    if t == "ROOM_COMP":
        rt = d.get("roomType")
        nights = d.get("roomNights")
        if rt:
            detail = f"{rt}" + (f" {nights}晚" if nights else "")
    elif t == "FB_COMP":
        detail = d.get("venue") or ""
    elif t == "REBATE":
        if d.get("rebateRate") is not None:
            detail = f"回贈率 {float(d['rebateRate']) * 100:.1f}%"
        else:
            detail = f"HKD {_hkd(d.get('rebateAmount', 0))}"
    elif t == "EVENT_INVITE":
        ename = d.get("eventName")
        if ename:
            attended = d.get("attended")
            suffix = "" if attended is None else ("（出席）" if attended else "（未出席）")
            detail = f"{ename}{suffix}"
    elif t == "OUTREACH":
        parts = [str(x) for x in (d.get("channel"), d.get("outcome")) if x]
        detail = "，".join(parts)
        if d.get("notes"):
            detail = f"{detail}：{d['notes']}"
    elif t == "TRANSFER":
        parts = [str(x) for x in (d.get("transferType"), d.get("vehicleClass")) if x]
        detail = " · ".join(parts)

    return f"• {date_str} [{type_label}]{value}" + (f" — {detail}" if detail else "")


_ID_SAFE = re.compile(r"[^A-Z0-9-]", re.IGNORECASE)


async def run_patron_profile_analysis(
    db: AsyncIOMotorDatabase, patron_id: str, alert_id: str
) -> dict[str, Any]:
    patron_doc, interactions, alert_doc, pr_agent_docs = await asyncio.gather(
        db[cols.patrons].find_one(
            {"patronId": patron_id},
            {"_id": 0, "preferenceEmbedding": 0, "activities": 0},
        ),
        db[cols.patron_interactions]
        .find({"patronId": patron_id})
        .sort("occurredAt", -1)
        .limit(20)
        .to_list(length=20),
        db[cols.patron_alerts].find_one({"alertId": alert_id}, {"_id": 0}),
        db[cols.pr_agents].find({"active": True}).limit(5).to_list(length=5),
    )

    interaction_lines = (
        "\n".join(_fmt_interaction(r) for r in interactions)
        if interactions
        else "（暫無歷史互動記錄）"
    )
    total_comp_value = sum(r.get("totalValueHKD", 0) or 0 for r in interactions)

    alert_context = "（未能獲取告警詳情）"
    if alert_doc:
        parts: list[str] = []
        for tc in alert_doc.get("triggeredConditions") or []:
            ev = tc.get("evidence") or {}
            t = tc.get("type")
            if t == "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
                parts.append(
                    f"連續 {ev.get('consecutiveRounds')} 輪下注均超 HKD {_hkd(ev.get('threshold'))}"
                )
            elif t == "CUMULATIVE_ROUNDS_BET_THRESHOLD":
                parts.append(
                    f"{ev.get('actualRounds')} 輪累計下注 HKD {_hkd(ev.get('totalBet'))}"
                )
            elif t == "SINGLE_ROUND_ADT_MULTIPLIER":
                parts.append(
                    f"本輪下注 HKD {_hkd(ev.get('betAmount'))}"
                    f"（ADT 的 {ev.get('adtRatio')} 倍）"
                )
            elif t == "SESSION_BET_ABOVE":
                parts.append(f"本場累計 HKD {_hkd(ev.get('sessionBetAmount'))}")
            else:
                parts.append(str(t))
        cond_summary = "；".join(parts)
        ts = alert_doc.get("tableSnapshot") or {}
        alert_context = (
            f"規則「{alert_doc.get('ruleName')}」觸發：{cond_summary}。"
            f"桌台：{ts.get('tableName')}（{ts.get('gameType')}，{ts.get('zone')}）"
        )

    if pr_agent_docs:
        pr_list_text = "\n".join(
            f"  - prAgentId: \"{p.get('prAgentId')}\", name: \"{p.get('name')}\", "
            f"tiers: [{', '.join(p.get('preferredTiers') or [])}], "
            f"languages: [{', '.join(p.get('preferredLanguages') or [])}], "
            f"tags: [{', '.join(p.get('specialtyTags') or [])}]"
            for p in pr_agent_docs
        )
    else:
        pr_list_text = "  （暫無可用公關）"

    if patron_doc:
        risk_flags = patron_doc.get("riskFlags") or []
        patron_info = (
            f"tier: {patron_doc.get('tier')}, ADT: HKD {_hkd(patron_doc.get('adt'))}, "
            f"pointsBalance: {patron_doc.get('pointsBalance', 0)}, "
            f"preferredGames: [{', '.join(patron_doc.get('preferredGames') or [])}], "
            f"riskFlags: [{', '.join(risk_flags) if risk_flags else '無'}]"
        )
    else:
        patron_info = f"patronId: {patron_id}（無詳細資料）"

    user_prompt = (
        "請根據以下資料，用繁體中文分析此賭客並輸出 JSON。\n\n"
        "【賭客基本資料】\n"
        f"patronId: {patron_id}\n{patron_info}\n\n"
        "【觸發告警】\n"
        f"{alert_context}\n\n"
        "【歷史互動記錄（最近20筆）】\n"
        f"{interaction_lines}\n"
        f"歷史累計優惠總值：HKD {_hkd(total_comp_value)}\n\n"
        "【可用公關人員】\n"
        f"{pr_list_text}\n\n"
        "請輸出以下 JSON 格式（所有文字使用繁體中文）：\n"
        "{\n"
        "  \"profileSummary\": \"（80字以內，包含tier、ADT、主要遊戲偏好、回訪習慣等）\",\n"
        "  \"interactionHistory\": \"（條列式摘要歷史互動重點，著重已給予的優惠價值和效果）\",\n"
        "  \"behaviorPattern\": \"（分析賭博行為規律、下注模式、回訪頻率等）\",\n"
        "  \"riskAssessment\": \"（此時機的商業機會點或潛在風險，50字以內）\",\n"
        "  \"recommendations\": [\n"
        "    {\n"
        "      \"priority\": 1,\n"
        "      \"actionType\": \"ROOM_COMP\",\n"
        "      \"title\": \"（簡短動作標題，15字以內）\",\n"
        "      \"rationale\": \"（建議理由，40字以內）\",\n"
        "      \"urgency\": \"Immediate\",\n"
        "      \"estimatedValue\": 50000\n"
        "    }\n"
        "  ],\n"
        "  \"suggestedPrId\": \"（從可用公關列表中選最合適的 prAgentId，若無合適則填 null）\"\n"
        "}\n\n"
        "recommendations 請提供 2-3 條，按 priority 排列。\n"
        "urgency 只能為 \"Immediate\"、\"Within48h\"、\"ThisWeek\" 之一。\n"
        "actionType 只能為 \"ROOM_COMP\"、\"FB_COMP\"、\"REBATE\"、\"EVENT_INVITE\"、"
        "\"OUTREACH\"、\"TRANSFER\"、\"TIER_UPGRADE\"、\"CUSTOM\" 之一。"
    )

    system_prompt = (
        "你是澳門貴賓廳行銷分析師，專責分析高價值賭客的歷史行為並給出銷售行動建議。"
        "請嚴格按照指定 JSON 格式輸出，不要添加任何額外說明文字。"
    )

    llm_raw = await chat_json(
        system=system_prompt,
        user=user_prompt,
        temperature=0.5,
        max_tokens=800,
    )

    fallback = {
        "profileSummary": (
            f"{(patron_doc or {}).get('tier', '未知')} 會員，"
            f"ADT HKD {_hkd((patron_doc or {}).get('adt', 0))}。"
        ),
        "interactionHistory": interaction_lines,
        "behaviorPattern": "行為資料分析中。",
        "riskAssessment": "請聯繫公關跟進。",
        "recommendations": [
            {
                "priority": 1,
                "actionType": "OUTREACH",
                "title": "主動聯繫確認需求",
                "rationale": "賭客正在高活躍期，及時聯繫可提升轉化機會。",
                "urgency": "Immediate",
            }
        ],
        "suggestedPrId": None,
    }

    parsed = fallback
    if llm_raw:
        try:
            data = json.loads(llm_raw)
            recs = data.get("recommendations")
            if isinstance(recs, list) and recs:
                parsed = data
        except (ValueError, TypeError):
            pass

    suggested_pr_id = parsed.get("suggestedPrId") or None
    suggested_pr_name: str | None = None
    if suggested_pr_id:
        for p in pr_agent_docs:
            if p.get("prAgentId") == suggested_pr_id:
                suggested_pr_name = p.get("name")
                break

    now = datetime.now(timezone.utc)
    report_id_raw = f"RPT-{int(now.timestamp() * 1000)}-{patron_id}"
    report: dict[str, Any] = {
        "reportId": _ID_SAFE.sub("-", report_id_raw),
        "patronId": patron_id,
        "triggeredByAlertId": alert_id,
        "profileSummary": parsed.get("profileSummary", ""),
        "interactionHistory": parsed.get("interactionHistory", ""),
        "behaviorPattern": parsed.get("behaviorPattern", ""),
        "riskAssessment": parsed.get("riskAssessment", ""),
        "recommendations": parsed.get("recommendations", []),
        "suggestedPrId": suggested_pr_id,
        "suggestedPrName": suggested_pr_name,
        "generatedAt": now,
        "modelUsed": settings.llm.chat_model,
        "status": "Draft",
    }

    await db[cols.patron_analysis_reports].insert_one(report)
    # Motor mutates the dict with an _id ObjectId; strip it before returning
    # so callers can JSON-encode without extra hoops.
    report.pop("_id", None)
    return report
