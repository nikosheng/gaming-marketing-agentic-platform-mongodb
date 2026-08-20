"""PR agent profiles, assignments, and KPI efficiency models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel
from app.schemas.enums import InteractionType, PatronTier, TableGameType


class PRAgentProfile(MongoModel):
    pr_agent_id: str = Field(alias="prAgentId")
    name: str
    active: bool
    max_active_patrons: int = Field(alias="maxActivePatrons")
    current_active_patrons: int = Field(default=0, alias="currentActivePatrons")
    preferred_tiers: list[PatronTier] = Field(default_factory=list, alias="preferredTiers")
    preferred_games: list[TableGameType] = Field(default_factory=list, alias="preferredGames")
    preferred_languages: list[str] = Field(default_factory=list, alias="preferredLanguages")
    specialty_tags: list[str] = Field(default_factory=list, alias="specialtyTags")
    last_assigned_at: Optional[datetime] = Field(default=None, alias="lastAssignedAt")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class PRAssignment(MongoModel):
    assignment_id: str = Field(alias="assignmentId")
    case_id: str = Field(alias="caseId")
    patron_id: str = Field(alias="patronId")
    pr_agent_id: str = Field(alias="prAgentId")
    fit_score: float = Field(alias="fitScore")
    status: Literal["Assigned", "Accepted", "Declined", "Completed"]
    assigned_at: datetime = Field(alias="assignedAt")
    accepted_at: Optional[datetime] = Field(default=None, alias="acceptedAt")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")


class PrMetrics(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    pr_agent_id: str = Field(alias="prAgentId")
    name: str
    active: bool
    total_interactions: int = Field(alias="totalInteractions")
    interactions_by_type: dict[InteractionType, int] = Field(
        default_factory=dict, alias="interactionsByType"
    )
    total_value_hkd: float = Field(alias="totalValueHKD")
    unique_patrons: int = Field(alias="uniquePatrons")
    tier_distribution: dict[PatronTier, int] = Field(
        default_factory=dict, alias="tierDistribution"
    )
    last_interaction_at: Optional[datetime] = Field(default=None, alias="lastInteractionAt")


class PrKpiMatchedSample(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    type: str
    occurred_at: str = Field(alias="occurredAt")
    score: float


class PrKpiResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    pr_agent_id: str = Field(alias="prAgentId")
    pr_name: str = Field(alias="prName")
    top_match_score: float = Field(alias="topMatchScore")
    matched_count: int = Field(alias="matchedCount")
    total_interactions: int = Field(alias="totalInteractions")
    kpi_achievement_rate: float = Field(alias="kpiAchievementRate")
    matched_samples: list[PrKpiMatchedSample] = Field(
        default_factory=list, alias="matchedSamples"
    )


class KpiSearchResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    kpi_text: str = Field(alias="kpiText")
    results: list[PrKpiResult] = Field(default_factory=list)
    top_performer: Optional[str] = Field(default=None, alias="topPerformer")
    bottom_performer: Optional[str] = Field(default=None, alias="bottomPerformer")
    insight: str
    actions: list[str] = Field(default_factory=list)
    searched_at: datetime = Field(alias="searchedAt")
