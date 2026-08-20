"""String-literal type aliases (union types) used across the domain models."""

from __future__ import annotations

from typing import Literal

TableGameType = Literal["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"]
TableStatus = Literal["Open", "Busy", "Closed"]
PatronTier = Literal["Bronze", "Silver", "Gold", "Platinum", "Diamond"]
ActivityType = Literal[
    "ChipExchange",
    "TableBet",
    "PointsRedeem",
    "ShowPurchase",
    "HotelBooking",
    "DrinkRedeem",
]
OfferType = Literal[
    "HotelRoom",
    "MusicShowTicket",
    "PointsLimitedTime",
    "FNBVoucher",
    "CashRebate",
    "TransportVoucher",
]
OfferStatus = Literal["Proposed", "Draft", "Active", "Expired", "Rejected"]
OfferCreatedBy = Literal["Manual", "AIAgent"]
OfferApprovalDecision = Literal["Approve", "Reject"]
RecommendationStatus = Literal["Proposed", "Approved", "Sent", "Accepted", "Rejected"]

RiskCaseStatus = Literal[
    "Draft",
    "InReview",
    "AwaitingAdmin",
    "Approved",
    "Rejected",
    "Assigned",
    "Closed",
]
RiskLevel = Literal["Low", "Medium", "High", "Critical"]
AgentNodeStatus = Literal["Pending", "Running", "Completed", "Failed", "Skipped"]
AdminDecision = Literal["Approve", "Reject", "RequestMoreInfo"]
EscalationTier = Literal["Standard", "Senior"]
CreditBand = Literal["Weak", "Fair", "Good", "Strong"]
SourceOfFundsRisk = Literal["Low", "Medium", "High"]
PatronRegion = Literal[
    "Macau",
    "HongKong",
    "Guangdong",
    "OtherGBA",
    "Taiwan",
    "International",
]

OccupancyTrend = Literal["Rising", "Stable", "Falling"]

InteractionType = Literal[
    "ROOM_COMP",
    "FB_COMP",
    "REBATE",
    "EVENT_INVITE",
    "OUTREACH",
    "TRANSFER",
]

ChatRole = Literal["system", "user", "assistant", "tool"]
