"""Risk case, financial + loss-chasing assessments, timeline."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import MongoModel
from app.schemas.enums import (
    AdminDecision,
    AgentNodeStatus,
    CreditBand,
    EscalationTier,
    RiskCaseStatus,
    RiskLevel,
    SourceOfFundsRisk,
)


NodeName = Literal[
    "initialize_case",
    "evaluate_loss_chasing",
    "evaluate_financial_credit_aml",
    "risk_escalation_router",
    "await_admin_review",
    "assign_pr_agent",
    "emit_assignment_notice",
    "finalize_case",
]

ChecklistKey = Literal[
    "incomePatternConsistent",
    "largeCashSpike",
    "chipExchangeAnomaly",
    "highRiskSourceSignal",
    "kycProfileFresh",
]


class LossChasingAssessment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    score: float
    label: Literal["Likely", "Borderline", "Unlikely"]
    confidence: float
    drivers: list[str] = Field(default_factory=list)
    explanation: str


class FinancialChecklistItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    key: ChecklistKey
    passed: bool
    notes: Optional[str] = None


class FinancialAssessment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    aml_risk_score: float = Field(alias="amlRiskScore")
    credit_band: CreditBand = Field(alias="creditBand")
    source_of_funds_risk: SourceOfFundsRisk = Field(alias="sourceOfFundsRisk")
    confidence: float
    checklist: list[FinancialChecklistItem] = Field(default_factory=list)
    analyst_notes: str = Field(alias="analystNotes")


class AgentNodeState(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    node_name: NodeName = Field(alias="nodeName")
    status: AgentNodeStatus
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")
    message: Optional[str] = None


class AdminReviewRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    admin_user_id: str = Field(alias="adminUserId")
    admin_display_name: str = Field(alias="adminDisplayName")
    decision: AdminDecision
    rationale: str
    requested_actions: list[str] = Field(default_factory=list, alias="requestedActions")
    created_at: datetime = Field(alias="createdAt")


class RiskCaseTimelineEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    event_type: Literal[
        "CaseCreated",
        "LossAssessmentCompleted",
        "FinancialAssessmentCompleted",
        "Escalated",
        "AdminDecisionSubmitted",
        "PRAssignmentCreated",
        "CaseClosed",
    ] = Field(alias="eventType")
    actor_type: Literal["System", "Agent", "Admin", "PRAgent"] = Field(alias="actorType")
    actor_id: str = Field(alias="actorId")
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(alias="createdAt")


class PatronRiskCase(MongoModel):
    case_id: str = Field(alias="caseId")
    patron_id: str = Field(alias="patronId")
    table_id: str = Field(alias="tableId")
    analysis_run_id: str = Field(alias="analysisRunId")
    status: RiskCaseStatus
    risk_level: RiskLevel = Field(alias="riskLevel")
    escalation_tier: EscalationTier = Field(alias="escalationTier")
    current_node: NodeName = Field(alias="currentNode")
    node_states: list[AgentNodeState] = Field(default_factory=list, alias="nodeStates")
    loss_chasing_assessment: LossChasingAssessment = Field(alias="lossChasingAssessment")
    financial_assessment: FinancialAssessment = Field(alias="financialAssessment")
    admin_review: Optional[AdminReviewRecord] = Field(default=None, alias="adminReview")
    created_by: str = Field(alias="createdBy")
    timeline: list[RiskCaseTimelineEvent] = Field(default_factory=list)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
