"""Offer catalog, recommendations, campaigns."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel
from app.schemas.enums import (
    OfferApprovalDecision,
    OfferCreatedBy,
    OfferStatus,
    OfferType,
    RecommendationStatus,
    TableGameType,
)


class OfferApprovalReview(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    decision: OfferApprovalDecision
    rationale: Optional[str] = None
    actor_id: str = Field(alias="actorId")
    decided_at: datetime = Field(alias="decidedAt")


class OfferCatalog(MongoModel):
    offer_id: str = Field(alias="offerId")
    offer_type: OfferType = Field(alias="offerType")
    title: str
    description: str
    eligibility_rules: list[str] = Field(default_factory=list, alias="eligibilityRules")
    estimated_cost: float = Field(alias="estimatedCost")
    target_game_types: list[TableGameType] = Field(
        default_factory=list, alias="targetGameTypes"
    )
    priority: int
    status: OfferStatus
    offer_embedding: list[float] = Field(default_factory=list, alias="offerEmbedding")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    created_by: Optional[OfferCreatedBy] = Field(default=None, alias="createdBy")
    approval_review: Optional[OfferApprovalReview] = Field(default=None, alias="approvalReview")


class OfferApprovalAudit(MongoModel):
    offer_id: str = Field(alias="offerId")
    from_status: OfferStatus = Field(alias="fromStatus")
    to_status: OfferStatus = Field(alias="toStatus")
    decision: OfferApprovalDecision
    actor_id: str = Field(alias="actorId")
    rationale: Optional[str] = None
    decided_at: datetime = Field(alias="decidedAt")


class OfferRecommendation(MongoModel):
    recommendation_id: str = Field(alias="recommendationId")
    patron_id: str = Field(alias="patronId")
    offer_id: str = Field(alias="offerId")
    reason_summary: str = Field(alias="reasonSummary")
    relevance_score: float = Field(alias="relevanceScore")
    confidence: float
    next_best_action: str = Field(alias="nextBestAction")
    status: RecommendationStatus
    generated_by: Literal["RuleEngine", "LLM"] = Field(alias="generatedBy")
    generated_at: datetime = Field(alias="generatedAt")
    expires_at: datetime = Field(alias="expiresAt")


class CampaignRun(MongoModel):
    campaign_id: str = Field(alias="campaignId")
    name: str
    goal: Literal["Retention", "Upsell", "CrossSell", "Reactivation"]
    segment_criteria: list[str] = Field(default_factory=list, alias="segmentCriteria")
    included_offer_ids: list[str] = Field(default_factory=list, alias="includedOfferIds")
    target_patron_ids: list[str] = Field(default_factory=list, alias="targetPatronIds")
    start_at: datetime = Field(alias="startAt")
    end_at: datetime = Field(alias="endAt")
    status: Literal["Planned", "Running", "Completed"]
    metrics: dict[str, float] = Field(
        default_factory=lambda: {"sent": 0, "accepted": 0, "redemptionValue": 0}
    )
