"""Table state snapshots, sessions, min-bet recommendations."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import MongoModel
from app.schemas.enums import OccupancyTrend, PatronTier, TableGameType, TableStatus


class TableStateSnapshot(MongoModel):
    table_id: str = Field(alias="tableId")
    table_name: str = Field(alias="tableName")
    zone: str
    game_type: TableGameType = Field(alias="gameType")
    min_bet: float = Field(alias="minBet")
    max_bet: float = Field(alias="maxBet")
    status: TableStatus
    patron_count: int = Field(alias="patronCount")
    avg_bet_amount: float = Field(alias="avgBetAmount")
    occupancy_rate: float = Field(alias="occupancyRate")
    refreshed_at: datetime = Field(alias="refreshedAt")


class PatronTableSession(MongoModel):
    patron_id: str = Field(alias="patronId")
    table_id: str = Field(alias="tableId")
    seated_at: datetime = Field(alias="seatedAt")
    last_action_at: datetime = Field(alias="lastActionAt")
    session_bet_amount: float = Field(alias="sessionBetAmount")
    current_stack_estimate: float = Field(alias="currentStackEstimate")
    behavior_tags: list[str] = Field(default_factory=list, alias="behaviorTags")
    is_active: bool = Field(alias="isActive")


class TableStateHistory(MongoModel):
    table_id: str = Field(alias="tableId")
    refreshed_at: datetime = Field(alias="refreshedAt")
    patron_count: int = Field(alias="patronCount")
    avg_bet_amount: float = Field(alias="avgBetAmount")
    occupancy_rate: float = Field(alias="occupancyRate")
    min_bet: float = Field(alias="minBet")
    max_bet: float = Field(alias="maxBet")
    status: TableStatus


MinBetRecommendationStatus = Literal[
    "Proposed", "Approved", "Applied", "Rejected", "Expired"
]
MinBetChangeSource = Literal["Agent", "Manual"]


class MinBetCandidate(MongoModel):
    min_bet: float = Field(alias="minBet")
    delta_pct: float = Field(alias="deltaPct")
    expected_revenue_pct: float = Field(alias="expectedRevenuePct")
    estimated_retention_pct: float = Field(alias="estimatedRetentionPct")


class MinBetRecommendationDrivers(MongoModel):
    occupancy_trend: OccupancyTrend = Field(alias="occupancyTrend")
    occupancy_velocity: float = Field(alias="occupancyVelocity")
    occupancy_rate: float = Field(alias="occupancyRate")
    bet_headroom: float = Field(alias="betHeadroom")
    low_bet_share: float = Field(alias="lowBetShare")
    p50_bet: float = Field(alias="p50Bet")
    p75_bet: float = Field(alias="p75Bet")
    p90_bet: float = Field(alias="p90Bet")
    tier_mix: dict[PatronTier, float] = Field(default_factory=dict, alias="tierMix")
    zone: str
    game_type: TableGameType = Field(alias="gameType")


class MinBetRecommendation(MongoModel):
    recommendation_id: str = Field(alias="recommendationId")
    table_id: str = Field(alias="tableId")
    run_id: str = Field(alias="runId")
    current_min_bet: float = Field(alias="currentMinBet")
    recommended_min_bet: float = Field(alias="recommendedMinBet")
    delta_pct: float = Field(alias="deltaPct")
    expected_revenue_uplift_pct: float = Field(alias="expectedRevenueUpliftPct")
    confidence: float
    rationale: str
    reasons: list[str] = Field(default_factory=list)
    drivers: MinBetRecommendationDrivers
    candidates: list[MinBetCandidate] = Field(default_factory=list)
    status: MinBetRecommendationStatus
    created_at: datetime = Field(alias="createdAt")
    expires_at: datetime = Field(alias="expiresAt")
    reviewed_by: Optional[str] = Field(default=None, alias="reviewedBy")
    reviewed_at: Optional[datetime] = Field(default=None, alias="reviewedAt")


class MinBetAudit(MongoModel):
    table_id: str = Field(alias="tableId")
    old_min_bet: float = Field(alias="oldMinBet")
    new_min_bet: float = Field(alias="newMinBet")
    source: MinBetChangeSource
    recommendation_id: Optional[str] = Field(default=None, alias="recommendationId")
    actor_id: str = Field(alias="actorId")
    at: datetime
