"""Patron analysis report + next-action recommendations."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel
from app.schemas.enums import InteractionType

ReportStatus = Literal["Draft", "Acknowledged", "Actioned"]
ActionType = Union[InteractionType, Literal["TIER_UPGRADE", "CUSTOM"]]


class NextActionRecommendation(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    priority: Literal[1, 2, 3]
    action_type: ActionType = Field(alias="actionType")
    title: str
    rationale: str
    urgency: Literal["Immediate", "Within48h", "ThisWeek"]
    estimated_value: Optional[float] = Field(default=None, alias="estimatedValue")


class PatronAnalysisReport(MongoModel):
    report_id: str = Field(alias="reportId")
    patron_id: str = Field(alias="patronId")
    triggered_by_alert_id: str = Field(alias="triggeredByAlertId")
    profile_summary: str = Field(alias="profileSummary")
    interaction_history: str = Field(alias="interactionHistory")
    behavior_pattern: str = Field(alias="behaviorPattern")
    risk_assessment: str = Field(alias="riskAssessment")
    recommendations: list[NextActionRecommendation] = Field(default_factory=list)
    suggested_pr_id: Optional[str] = Field(default=None, alias="suggestedPrId")
    suggested_pr_name: Optional[str] = Field(default=None, alias="suggestedPrName")
    generated_at: datetime = Field(alias="generatedAt")
    model_used: str = Field(alias="modelUsed")
    status: ReportStatus
