"""Alert-rule NL parser (LangGraph).

Port of ``src/web/alert-rule-agent.ts``. Four nodes:
``parse_intent → map_conditions → validate → persist_rule``.

Modes:
* ``preview``  — parse and return a preview (no DB write).
* ``persist``  — same as preview + write the rule to Mongo.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.condition_catalog import (
    CONDITION_CATALOG,
    SEED_RULE_TEMPLATES,
    build_catalog_prompt_section,
    get_catalog_by_type,
)
from app.collections import web_collections as cols
from app.llm.gateway import chat_json, is_gateway_configured
from app.schemas.alert import ConditionType

AgentMode = Literal["preview", "persist"]


class _State(TypedDict, total=False):
    nl_description: str
    mode: AgentMode
    llm_result: dict[str, Any] | None
    validated_conditions: list[dict[str, Any]]
    rule_name: str
    preview: dict[str, Any] | None
    rule_id: str | None
    error: str | None
    # DB reference threaded through nodes (populated via config in ainvoke)
    db: Any


def _build_system_prompt() -> str:
    return (
        "You are a casino alert rule configuration assistant.\n"
        "Analyze the user's natural language description and identify which conditions\n"
        "from the catalog below are being requested. Extract all numeric parameters precisely.\n\n"
        f"Condition Catalog:\n{build_catalog_prompt_section()}\n\n"
        "Return ONLY valid JSON (no extra text, no markdown):\n"
        "{\n"
        "  \"matchedConditions\": [\n"
        "    {\n"
        "      \"type\": \"<ConditionType from catalog>\",\n"
        "      \"confidence\": <0.0-1.0>,\n"
        "      \"extractedParams\": { \"<param_name>\": <extracted_value> }\n"
        "    }\n"
        "  ],\n"
        "  \"ruleName\": \"<concise name in Traditional Chinese, max 15 chars>\",\n"
        "  \"needsClarification\": <true|false>,\n"
        "  \"clarificationQuestion\": \"<Traditional Chinese question, only if needsClarification is true>\"\n"
        "}\n\n"
        "Number extraction rules:\n"
        "- \"3輪\" → rounds: 3\n"
        "- \"20000港幣\" or \"兩萬\" or \"2萬\" → threshold: 20000\n"
        "- \"5萬\" → 50000, \"10萬\" → 100000, \"百萬\" → 1000000\n"
        "- \"5倍\" → multiplier: 5, \"十倍\" → 10\n"
        "- If a param is not mentioned, use the catalog default value\n"
        "- If param is ambiguous, use default and set confidence < 0.75\n\n"
        "Condition matching rules:\n"
        "- ONLY use condition types from the catalog — never invent new types\n"
        "- Multiple conditions are allowed (they will be combined with OR logic)\n"
        "- If the description clearly matches a condition, set confidence >= 0.85\n"
        "- If no condition can be matched at all, set needsClarification: true\n"
        "- Do not output any explanation outside the JSON"
    )


# ---------- Nodes ----------


async def _parse_intent(state: _State) -> dict[str, Any]:
    if not is_gateway_configured():
        return {
            "error": (
                "AI_NOT_CONFIGURED: 請配置 LITELLM_BASE_URL 和 "
                "LITELLM_API_KEY 環境變量以使用 NL 規則解析功能。"
            )
        }

    raw = await chat_json(
        system=_build_system_prompt(),
        user=f'用戶描述: "{state["nl_description"]}"',
        temperature=0.1,
        max_tokens=800,
    )
    if not raw:
        return {"error": "LLM_CALL_FAILED: 無法調用 AI 服務，請稍後重試。"}

    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return {
            "error": f"LLM_PARSE_ERROR: AI 返回了無效的 JSON 格式。原始響應: {raw[:200]}"
        }
    return {"llm_result": parsed}


def _map_conditions(state: _State) -> dict[str, Any]:
    if state.get("error") or not state.get("llm_result"):
        return {}

    llm = state["llm_result"]
    if llm.get("needsClarification") or not llm.get("matchedConditions"):
        return {"validated_conditions": [], "rule_name": ""}

    validated: list[dict[str, Any]] = []
    for mc in llm.get("matchedConditions") or []:
        definition = get_catalog_by_type(mc.get("type"))
        if not definition:
            continue

        extracted_params = mc.get("extractedParams") or {}
        final_params: dict[str, Any] = {}

        for param_name, schema in definition.params.items():
            extracted = extracted_params.get(param_name)
            if extracted is not None:
                if schema.type == "string[]":
                    arr = extracted if isinstance(extracted, list) else [extracted]
                    str_arr = [str(v) for v in arr]
                    if schema.allowed_values:
                        valid = [v for v in str_arr if v in schema.allowed_values]
                        final_params[param_name] = valid if valid else list(schema.default)
                    else:
                        final_params[param_name] = str_arr
                else:
                    try:
                        num = float(extracted)
                    except (TypeError, ValueError):
                        final_params[param_name] = schema.default
                        continue
                    if schema.min is not None:
                        num = max(schema.min, num)
                    if schema.max is not None:
                        num = min(schema.max, num)
                    final_params[param_name] = (
                        int(round(num)) if schema.type == "integer" else num
                    )
            else:
                final_params[param_name] = schema.default

        confidence = float(mc.get("confidence", 0))
        confidence = max(0.0, min(1.0, confidence))
        validated.append(
            {"type": mc.get("type"), "params": final_params, "confidence": confidence}
        )

    return {
        "validated_conditions": validated,
        "rule_name": llm.get("ruleName") or "自定義高價值規則",
    }


def _validate(state: _State) -> dict[str, Any]:
    if state.get("error"):
        return {}

    llm = state.get("llm_result")
    nl = state.get("nl_description", "")

    if not llm:
        return {
            "preview": {
                "ruleName": "",
                "nlDescription": nl,
                "conditions": [],
                "needsClarification": True,
                "clarificationQuestion": "無法解析您的描述，請重新嘗試。",
            }
        }

    validated = state.get("validated_conditions") or []
    if llm.get("needsClarification") or not validated:
        return {
            "preview": {
                "ruleName": "",
                "nlDescription": nl,
                "conditions": [],
                "needsClarification": True,
                "clarificationQuestion": (
                    llm.get("clarificationQuestion")
                    or "請提供更具體的條件描述，例如下注輪次數和金額閾值。"
                ),
            }
        }

    return {
        "preview": {
            "ruleName": state.get("rule_name", ""),
            "nlDescription": nl,
            "conditions": validated,
            "needsClarification": False,
        }
    }


async def _persist_rule(state: _State) -> dict[str, Any]:
    if state.get("error") or state.get("mode") != "persist":
        return {}
    preview = state.get("preview")
    if not preview or preview.get("needsClarification") or not preview.get("conditions"):
        return {}

    db: AsyncIOMotorDatabase | None = state.get("db")
    if db is None:
        return {"error": "DB_NOT_AVAILABLE"}

    rule_id = f"RULE-{int(time.time() * 1000)}"
    now = datetime.now(timezone.utc)
    rule = {
        "ruleId": rule_id,
        "name": preview["ruleName"],
        "nlDescription": preview["nlDescription"],
        "conditions": preview["conditions"],
        "conditionLogic": "OR",
        "status": "Active",
        "totalTriggered": 0,
        "createdAt": now,
    }
    await db[cols.alert_rules].insert_one(rule)
    return {"rule_id": rule_id}


# ---------- Graph builder ----------


def _build_graph() -> Any:
    graph = StateGraph(_State)
    graph.add_node("parse_intent", _parse_intent)
    graph.add_node("map_conditions", _map_conditions)
    graph.add_node("validate", _validate)
    graph.add_node("persist_rule", _persist_rule)
    graph.add_edge(START, "parse_intent")
    graph.add_edge("parse_intent", "map_conditions")
    graph.add_edge("map_conditions", "validate")
    graph.add_edge("validate", "persist_rule")
    graph.add_edge("persist_rule", END)
    return graph.compile()


_GRAPH = _build_graph()


# ---------- Public API ----------


async def preview_alert_rule(
    db: AsyncIOMotorDatabase, nl_description: str
) -> dict[str, Any]:
    """Return ``{"preview": ..., "error": ...}``."""
    result = await _GRAPH.ainvoke(
        {
            "nl_description": nl_description,
            "mode": "preview",
            "llm_result": None,
            "validated_conditions": [],
            "rule_name": "",
            "preview": None,
            "rule_id": None,
            "error": None,
            "db": db,
        }
    )
    return {"preview": result.get("preview"), "error": result.get("error")}


async def persist_alert_rule(
    db: AsyncIOMotorDatabase, preview: dict[str, Any]
) -> dict[str, Any]:
    """Persist a confirmed preview. Frontend passes ``preview`` back verbatim."""
    if preview.get("needsClarification") or not preview.get("conditions"):
        return {
            "ruleId": None,
            "error": "INVALID_PREVIEW: 預覽包含未解決的問題，無法創建規則。",
        }

    rule_id = f"RULE-{int(time.time() * 1000)}"
    now = datetime.now(timezone.utc)
    rule = {
        "ruleId": rule_id,
        "name": preview["ruleName"],
        "nlDescription": preview["nlDescription"],
        "conditions": preview["conditions"],
        "conditionLogic": "OR",
        "status": "Active",
        "totalTriggered": 0,
        "createdAt": now,
    }
    await db[cols.alert_rules].insert_one(rule)
    return {"ruleId": rule_id, "error": None}


async def seed_template_rules_if_empty(
    db: AsyncIOMotorDatabase,
) -> list[dict[str, Any]]:
    """Seed 3 template rules if the collection is empty; otherwise return existing."""
    existing = await db[cols.alert_rules].count_documents({})
    if existing > 0:
        return (
            await db[cols.alert_rules]
            .find({})
            .sort("createdAt", -1)
            .to_list(length=None)
        )

    now = datetime.now(timezone.utc)
    rules: list[dict[str, Any]] = []
    for i, t in enumerate(SEED_RULE_TEMPLATES):
        rules.append(
            {
                "ruleId": f"RULE-SEED-00{i + 1}",
                "name": t.name,
                "nlDescription": t.nl_description,
                "conditions": [
                    {"type": c.type, "params": c.params, "confidence": c.confidence}
                    for c in t.conditions
                ],
                "conditionLogic": "OR",
                "status": "Active",
                "totalTriggered": 0,
                "createdAt": datetime.fromtimestamp(now.timestamp() - i, tz=timezone.utc),
            }
        )
    await db[cols.alert_rules].insert_many(rules)
    for r in rules:
        r.pop("_id", None)
    return rules


__all__ = [
    "AgentMode",
    "persist_alert_rule",
    "preview_alert_rule",
    "seed_template_rules_if_empty",
]

# Silence pyright unused import warning until offer/minbet migrations import it.
_ = ConditionType
_ = CONDITION_CATALOG
