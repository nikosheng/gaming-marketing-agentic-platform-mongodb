"""Alert-condition catalog + seed rule templates.

1:1 port of ``src/web/condition-catalog.ts``. Consumed by the alert-rule agent
(both for LLM prompt construction and for validating parsed conditions).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from app.schemas.alert import ConditionType

ParamType = Literal["integer", "number", "string[]"]


@dataclass(frozen=True)
class ConditionParamSchema:
    type: ParamType
    description: str
    default: Any
    min: Optional[float] = None
    max: Optional[float] = None
    allowed_values: Optional[list[str]] = None


@dataclass(frozen=True)
class ConditionDefinition:
    type: ConditionType
    display_name: str
    description: str
    semantic_keywords: list[str]
    params: dict[str, ConditionParamSchema]
    example_nl: str


CONDITION_CATALOG: list[ConditionDefinition] = [
    ConditionDefinition(
        type="CONSECUTIVE_ROUNDS_BET_THRESHOLD",
        display_name="連續N輪下注超閾值",
        description=(
            "同一 patron 在連續指定輪次中，每一輪的下注金額均超過閾值金額。"
            "例如連續3輪每輪超過10000港幣。"
        ),
        semantic_keywords=[
            "連續", "consecutive", "每輪", "per round", "持續下注", "continuous",
            "每次都超過", "輪次", "rounds",
        ],
        params={
            "rounds": ConditionParamSchema(
                type="integer",
                description="連續輪次數（需要連續幾輪滿足條件）",
                default=3,
                min=2,
                max=10,
            ),
            "threshold": ConditionParamSchema(
                type="number",
                description="每輪下注下限（港幣），每一輪都必須超過此金額",
                default=10000,
                min=100,
            ),
        },
        example_nl="找到連續下注3輪每輪超過10000港幣的賭客",
    ),
    ConditionDefinition(
        type="ANY_ROUND_BET_THRESHOLD",
        display_name="N輪內任意一輪超閾值",
        description=(
            "在最近 N 輪中，至少有一輪的下注金額超過閾值。"
            "例如3輪裡其中一輪下注超過1000港幣。"
            "與連續N輪不同，這裡只要任意一輪滿足即可觸發。"
        ),
        semantic_keywords=[
            "其中一輪", "任意一輪", "至少一輪", "any round", "at least one",
            "有一輪", "某一輪", "其中", "只要一輪", "有其中", "裡面有",
        ],
        params={
            "rounds": ConditionParamSchema(
                type="integer",
                description="觀察的輪次窗口大小",
                default=3,
                min=2,
                max=20,
            ),
            "threshold": ConditionParamSchema(
                type="number",
                description="單輪下注下限（港幣），任一輪超過即滿足",
                default=5000,
                min=100,
            ),
        },
        example_nl="找到3輪裡面有其中一輪下注超過1000港幣的賭客",
    ),
    ConditionDefinition(
        type="CUMULATIVE_ROUNDS_BET_THRESHOLD",
        display_name="N輪累計下注超閾值",
        description=(
            "patron 在最近 N 輪內的下注總和超過閾值。"
            "例如最近5輪累計下注總額超過50000港幣。"
        ),
        semantic_keywords=[
            "累計", "cumulative", "總額", "total", "合計", "N輪總和",
            "加起來", "累積", "total amount", "合共",
        ],
        params={
            "rounds": ConditionParamSchema(
                type="integer",
                description="統計的輪次窗口大小",
                default=5,
                min=2,
                max=20,
            ),
            "totalThreshold": ConditionParamSchema(
                type="number",
                description="N輪累計下注下限（港幣）",
                default=50000,
                min=1000,
            ),
        },
        example_nl="找5輪內總下注超過5萬港幣的賭客",
    ),
    ConditionDefinition(
        type="SINGLE_ROUND_ADT_MULTIPLIER",
        display_name="單輪下注超ADT倍數",
        description=(
            "patron 某輪下注金額超過其個人歷史平均每日消費（ADT）的 N 倍。"
            "ADT是patron的歷史平均每日下注額，突然大幅超越代表行為異常。"
        ),
        semantic_keywords=[
            "ADT", "倍", "times", "multiplier", "異常", "spike", "突增",
            "正常水平", "average daily", "平均", "超過正常",
        ],
        params={
            "multiplier": ConditionParamSchema(
                type="number",
                description="ADT 倍數閾值（下注金額需超過 ADT × multiplier）",
                default=5,
                min=1.5,
                max=50,
            ),
        },
        example_nl="找單輪下注超過個人ADT 5倍的賭客",
    ),
    ConditionDefinition(
        type="SESSION_BET_ABOVE",
        display_name="本場累計下注超閾值",
        description=(
            "patron 本次入座 session 的累計下注總額超過指定金額。"
            "這反映patron在一整場遊戲中的總投入。"
        ),
        semantic_keywords=[
            "session", "本場", "本次", "入座以來", "this session",
            "一場", "這一場", "今次", "整場",
        ],
        params={
            "threshold": ConditionParamSchema(
                type="number",
                description="session 累計下注下限（港幣）",
                default=30000,
                min=1000,
            ),
        },
        example_nl="找本場累計下注超過3萬港幣的賭客",
    ),
    ConditionDefinition(
        type="TIER_MATCH",
        display_name="Tier 級別篩選",
        description=(
            "限定只對特定 Tier 級別的 patron 觸發 Alert。"
            "可作為獨立條件，或與其他條件組合使用（OR 邏輯）。"
        ),
        semantic_keywords=[
            "gold", "platinum", "diamond", "金卡", "鉑金", "鑽石",
            "高端", "VIP", "tier", "級別", "等級", "silver", "bronze",
        ],
        params={
            "tiers": ConditionParamSchema(
                type="string[]",
                description="符合條件的 tier 列表",
                default=["Gold", "Platinum", "Diamond"],
                allowed_values=["Bronze", "Silver", "Gold", "Platinum", "Diamond"],
            ),
        },
        example_nl="找Platinum以上級別的賭客",
    ),
    ConditionDefinition(
        type="BEHAVIOR_TAG_MATCH",
        display_name="行為標籤篩選",
        description=(
            "patron 帶有特定的行為標籤，例如 Aggressive（激進下注）、"
            "LateNight（深夜賭客）、PromoSeeker（促銷敏感）等。"
        ),
        semantic_keywords=[
            "aggressive", "激進", "aggressive bettor", "LateNight", "深夜",
            "PromoSeeker", "促銷", "CardCounterWatch", "算牌", "Conservative", "保守",
        ],
        params={
            "tags": ConditionParamSchema(
                type="string[]",
                description="需要匹配的 behaviorTags 列表（任一標籤命中即滿足）",
                default=["Aggressive"],
                allowed_values=[
                    "Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker",
                ],
            ),
        },
        example_nl="找帶有激進下注行為標籤的賭客",
    ),
]


def get_catalog_by_type(type_: ConditionType) -> Optional[ConditionDefinition]:
    for c in CONDITION_CATALOG:
        if c.type == type_:
            return c
    return None


def _param_to_dict(p: ConditionParamSchema) -> dict[str, Any]:
    out: dict[str, Any] = {
        "type": p.type,
        "description": p.description,
        "default": p.default,
    }
    if p.min is not None:
        out["min"] = p.min
    if p.max is not None:
        out["max"] = p.max
    if p.allowed_values is not None:
        out["allowedValues"] = p.allowed_values
    return out


def build_catalog_prompt_section() -> str:
    """Compact JSON representation for injection into the LLM system prompt."""
    compact = [
        {
            "type": c.type,
            "displayName": c.display_name,
            "description": c.description,
            "semanticKeywords": c.semantic_keywords,
            "params": {k: _param_to_dict(v) for k, v in c.params.items()},
            "exampleNL": c.example_nl,
        }
        for c in CONDITION_CATALOG
    ]
    return json.dumps(compact, indent=2, ensure_ascii=False)


@dataclass(frozen=True)
class SeedConditionSpec:
    type: ConditionType
    params: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0


@dataclass(frozen=True)
class SeedRuleTemplate:
    name: str
    nl_description: str
    conditions: list[SeedConditionSpec]


SEED_RULE_TEMPLATES: list[SeedRuleTemplate] = [
    SeedRuleTemplate(
        name="連續3輪高額下注",
        nl_description="找到連續下注3輪每輪超過10000港幣的賭客",
        conditions=[
            SeedConditionSpec(
                type="CONSECUTIVE_ROUNDS_BET_THRESHOLD",
                params={"rounds": 3, "threshold": 10000},
                confidence=1.0,
            )
        ],
    ),
    SeedRuleTemplate(
        name="5輪累計高額下注",
        nl_description="找5輪內總下注超過5萬港幣的賭客",
        conditions=[
            SeedConditionSpec(
                type="CUMULATIVE_ROUNDS_BET_THRESHOLD",
                params={"rounds": 5, "totalThreshold": 50000},
                confidence=1.0,
            )
        ],
    ),
    SeedRuleTemplate(
        name="ADT異常突增",
        nl_description="找單輪下注超過個人ADT 5倍的賭客",
        conditions=[
            SeedConditionSpec(
                type="SINGLE_ROUND_ADT_MULTIPLIER",
                params={"multiplier": 5},
                confidence=1.0,
            )
        ],
    ),
]
