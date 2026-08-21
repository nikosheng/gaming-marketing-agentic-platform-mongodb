"""Alert rules, alert instances, table round snapshots."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel

ConditionType = Literal[
    "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
    "CUMULATIVE_ROUNDS_BET_THRESHOLD",
    "ANY_ROUND_BET_THRESHOLD",
    "SINGLE_ROUND_ADT_MULTIPLIER",
    "SESSION_BET_ABOVE",
    "TIER_MATCH",
    "BEHAVIOR_TAG_MATCH",
]


class ParsedCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    type: ConditionType
    params: dict[str, Any] = Field(default_factory=dict)
    confidence: float


class AlertRule(MongoModel):
    rule_id: str = Field(alias="ruleId")
    name: str
    nl_description: str = Field(alias="nlDescription")
    conditions: list[ParsedCondition] = Field(default_factory=list)
    condition_logic: Literal["OR"] = Field(default="OR", alias="conditionLogic")
    status: Literal["Active", "Paused"]
    total_triggered: int = Field(default=0, alias="totalTriggered")
    last_triggered_at: Optional[datetime] = Field(default=None, alias="lastTriggeredAt")
    created_at: datetime = Field(alias="createdAt")


class TableRoundSnapshot(MongoModel):
    table_id: str = Field(alias="tableId")
    round_number: int = Field(alias="roundNumber")
    patron_id: str = Field(alias="patronId")
    bet_amount: float = Field(alias="betAmount")
    adt: float
    tier: str
    behavior_tags: list[str] = Field(default_factory=list, alias="behaviorTags")
    masked_name: str = Field(alias="maskedName")
    recorded_at: datetime = Field(alias="recordedAt")


class PatronAlert(MongoModel):
    alert_id: str = Field(alias="alertId")
    rule_id: str = Field(alias="ruleId")
    rule_name: str = Field(alias="ruleName")
    patron_id: str = Field(alias="patronId")
    table_id: str = Field(alias="tableId")
    triggered_conditions: list[dict[str, Any]] = Field(
        default_factory=list, alias="triggeredConditions"
    )
    patron_snapshot: dict[str, Any] = Field(default_factory=dict, alias="patronSnapshot")
    table_snapshot: dict[str, Any] = Field(default_factory=dict, alias="tableSnapshot")
    llm_rationale: Optional[str] = Field(default=None, alias="llmRationale")
    status: Literal["New", "Acknowledged"]
    triggered_at: datetime = Field(alias="triggeredAt")


class AlertRulePreview(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    rule_name: str = Field(alias="ruleName")
    nl_description: str = Field(alias="nlDescription")
    conditions: list[ParsedCondition]
    needs_clarification: bool = Field(alias="needsClarification")
    clarification_question: Optional[str] = Field(default=None, alias="clarificationQuestion")
