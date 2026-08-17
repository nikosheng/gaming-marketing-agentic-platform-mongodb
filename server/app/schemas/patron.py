"""Patron profile, activity events, and interaction history."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel
from app.schemas.enums import (
    ActivityType,
    InteractionType,
    PatronRegion,
    PatronTier,
    TableGameType,
)


class PatronActivityEvent(MongoModel):
    event_id: str = Field(alias="eventId")
    activity_type: ActivityType = Field(alias="activityType")
    source: Literal["TableSystem", "Cage", "Loyalty", "POS"]
    amount: float
    points_delta: float = Field(alias="pointsDelta")
    metadata: dict[str, Any] = Field(default_factory=dict)
    activity_embedding: list[float] = Field(default_factory=list, alias="activityEmbedding")
    event_time: datetime = Field(alias="eventTime")


class PatronProfile(MongoModel):
    patron_id: str = Field(alias="patronId")
    name: str
    masked_name: str = Field(alias="maskedName")
    tier: PatronTier
    adt: float
    preferred_games: list[TableGameType] = Field(default_factory=list, alias="preferredGames")
    risk_flags: list[str] = Field(default_factory=list, alias="riskFlags")
    points_balance: float = Field(default=0, alias="pointsBalance")
    last_active_at: datetime = Field(alias="lastActiveAt")
    region: PatronRegion
    activities: list[PatronActivityEvent] = Field(default_factory=list)
    preference_embedding: list[float] = Field(
        default_factory=list, alias="preferenceEmbedding"
    )
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class PatronInteractionDetail(BaseModel):
    """Type-specific fields for a ``PatronInteractionRecord``.

    All fields optional; only the ones relevant to ``type`` are populated.
    """

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    # ROOM_COMP
    room_type: Optional[str] = Field(default=None, alias="roomType")
    check_in: Optional[datetime] = Field(default=None, alias="checkIn")
    check_out: Optional[datetime] = Field(default=None, alias="checkOut")
    room_nights: Optional[int] = Field(default=None, alias="roomNights")
    room_value: Optional[float] = Field(default=None, alias="roomValue")
    # FB_COMP
    venue: Optional[str] = None
    fb_amount: Optional[float] = Field(default=None, alias="fbAmount")
    # REBATE
    rebate_amount: Optional[float] = Field(default=None, alias="rebateAmount")
    rebate_rate: Optional[float] = Field(default=None, alias="rebateRate")
    # EVENT_INVITE
    event_name: Optional[str] = Field(default=None, alias="eventName")
    event_date: Optional[datetime] = Field(default=None, alias="eventDate")
    attended: Optional[bool] = None
    # OUTREACH
    channel: Optional[Literal["Phone", "In-Person", "WeChat", "WhatsApp"]] = None
    outcome: Optional[Literal["Positive", "Neutral", "No Answer", "Declined"]] = None
    notes: Optional[str] = None
    # TRANSFER
    transfer_type: Optional[Literal["Airport", "Hotel", "Venue"]] = Field(
        default=None, alias="transferType"
    )
    vehicle_class: Optional[Literal["Standard", "Luxury"]] = Field(
        default=None, alias="vehicleClass"
    )


class PatronInteractionRecord(MongoModel):
    interaction_id: str = Field(alias="interactionId")
    patron_id: str = Field(alias="patronId")
    type: InteractionType
    detail: dict[str, Any] = Field(default_factory=dict)
    total_value_hkd: float = Field(alias="totalValueHKD")
    occurred_at: datetime = Field(alias="occurredAt")
    recorded_by: str = Field(alias="recordedBy")
    recorded_at: datetime = Field(alias="recordedAt")
    linked_alert_id: Optional[str] = Field(default=None, alias="linkedAlertId")
    patron_tier_at_time: Optional[PatronTier] = Field(default=None, alias="patronTierAtTime")
    patron_adt_at_time: Optional[float] = Field(default=None, alias="patronAdtAtTime")
    interaction_embedding: Optional[list[float]] = Field(
        default=None, alias="interactionEmbedding"
    )
