import { ObjectId } from "mongodb";

export type TableGameType = "Baccarat" | "Blackjack" | "Roulette" | "SicBo" | "Poker";
export type TableStatus = "Open" | "Busy" | "Closed";
export type PatronTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
export type ActivityType =
  | "ChipExchange"
  | "TableBet"
  | "PointsRedeem"
  | "ShowPurchase"
  | "HotelBooking"
  | "DrinkRedeem";
export type OfferType = "HotelRoom" | "MusicShowTicket" | "PointsLimitedTime" | "FNBVoucher";
export type OfferStatus = "Draft" | "Active" | "Expired";
export type RecommendationStatus = "Proposed" | "Approved" | "Sent" | "Accepted" | "Rejected";
export type ChatRole = "system" | "user" | "assistant" | "tool";
export type RiskCaseStatus =
  | "Draft"
  | "InReview"
  | "AwaitingAdmin"
  | "Approved"
  | "Rejected"
  | "Assigned"
  | "Closed";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type AgentNodeStatus = "Pending" | "Running" | "Completed" | "Failed" | "Skipped";
export type AdminDecision = "Approve" | "Reject" | "RequestMoreInfo";
export type EscalationTier = "Standard" | "Senior";
export type CreditBand = "Weak" | "Fair" | "Good" | "Strong";
export type SourceOfFundsRisk = "Low" | "Medium" | "High";

export interface PatronProfile {
  _id?: ObjectId;
  patronId: string;
  name: string;
  maskedName: string;
  tier: PatronTier;
  adt: number;
  preferredGames: TableGameType[];
  riskFlags: string[];
  pointsBalance: number;
  lastActiveAt: Date;
  activities: PatronActivityEvent[];
  preferenceEmbedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TableStateSnapshot {
  _id?: ObjectId;
  tableId: string;
  tableName: string;
  zone: string;
  gameType: TableGameType;
  minBet: number;
  maxBet: number;
  status: TableStatus;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
  refreshedAt: Date;
}

export interface PatronTableSession {
  _id?: ObjectId;
  patronId: string;
  tableId: string;
  seatedAt: Date;
  lastActionAt: Date;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  isActive: boolean;
}

export interface PatronActivityEvent {
  _id?: ObjectId;
  eventId: string;
  activityType: ActivityType;
  source: "TableSystem" | "Cage" | "Loyalty" | "POS";
  amount: number;
  pointsDelta: number;
  metadata: Record<string, string | number | boolean>;
  activityEmbedding: number[];
  eventTime: Date;
}

export interface OfferCatalog {
  _id?: ObjectId;
  offerId: string;
  offerType: OfferType;
  title: string;
  description: string;
  eligibilityRules: string[];
  estimatedCost: number;
  targetGameTypes: TableGameType[];
  priority: number;
  status: OfferStatus;
  offerEmbedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferRecommendation {
  _id?: ObjectId;
  recommendationId: string;
  patronId: string;
  offerId: string;
  reasonSummary: string;
  relevanceScore: number;
  confidence: number;
  nextBestAction: string;
  status: RecommendationStatus;
  generatedBy: "RuleEngine" | "LLM";
  generatedAt: Date;
  expiresAt: Date;
}

export interface LossChasingAssessment {
  score: number;
  label: "Likely" | "Borderline" | "Unlikely";
  confidence: number;
  drivers: string[];
  explanation: string;
}

export interface FinancialChecklistItem {
  key:
    | "incomePatternConsistent"
    | "largeCashSpike"
    | "chipExchangeAnomaly"
    | "highRiskSourceSignal"
    | "kycProfileFresh";
  passed: boolean;
  notes?: string;
}

export interface FinancialAssessment {
  amlRiskScore: number;
  creditBand: CreditBand;
  sourceOfFundsRisk: SourceOfFundsRisk;
  confidence: number;
  checklist: FinancialChecklistItem[];
  analystNotes: string;
}

export interface AgentNodeState {
  nodeName:
    | "initialize_case"
    | "evaluate_loss_chasing"
    | "evaluate_financial_credit_aml"
    | "risk_escalation_router"
    | "await_admin_review"
    | "assign_pr_agent"
    | "emit_assignment_notice"
    | "finalize_case";
  status: AgentNodeStatus;
  startedAt?: Date;
  completedAt?: Date;
  message?: string;
}

export interface AdminReviewRecord {
  adminUserId: string;
  adminDisplayName: string;
  decision: AdminDecision;
  rationale: string;
  requestedActions: string[];
  createdAt: Date;
}

export interface RiskCaseTimelineEvent {
  eventType:
    | "CaseCreated"
    | "LossAssessmentCompleted"
    | "FinancialAssessmentCompleted"
    | "Escalated"
    | "AdminDecisionSubmitted"
    | "PRAssignmentCreated"
    | "CaseClosed";
  actorType: "System" | "Agent" | "Admin" | "PRAgent";
  actorId: string;
  payload: Record<string, string | number | boolean>;
  createdAt: Date;
}

export interface PatronRiskCase {
  _id?: ObjectId;
  caseId: string;
  patronId: string;
  tableId: string;
  analysisRunId: string;
  status: RiskCaseStatus;
  riskLevel: RiskLevel;
  escalationTier: EscalationTier;
  currentNode: AgentNodeState["nodeName"];
  nodeStates: AgentNodeState[];
  lossChasingAssessment: LossChasingAssessment;
  financialAssessment: FinancialAssessment;
  adminReview?: AdminReviewRecord;
  createdBy: string;
  timeline: RiskCaseTimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PRAgentProfile {
  _id?: ObjectId;
  prAgentId: string;
  name: string;
  active: boolean;
  maxActivePatrons: number;
  currentActivePatrons: number;
  preferredTiers: PatronTier[];
  preferredGames: TableGameType[];
  preferredLanguages: string[];
  specialtyTags: string[];
  lastAssignedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PRAssignment {
  _id?: ObjectId;
  assignmentId: string;
  caseId: string;
  patronId: string;
  prAgentId: string;
  fitScore: number;
  status: "Assigned" | "Accepted" | "Declined" | "Completed";
  assignedAt: Date;
  acceptedAt?: Date;
  completedAt?: Date;
}

export interface CampaignRun {
  _id?: ObjectId;
  campaignId: string;
  name: string;
  goal: "Retention" | "Upsell" | "CrossSell" | "Reactivation";
  segmentCriteria: string[];
  includedOfferIds: string[];
  targetPatronIds: string[];
  startAt: Date;
  endAt: Date;
  status: "Planned" | "Running" | "Completed";
  metrics: {
    sent: number;
    accepted: number;
    redemptionValue: number;
  };
}

export interface ChatSession {
  _id?: ObjectId;
  sessionId: string;
  channel: "WebAdmin";
  marketingUserId: string;
  patronContextIds: string[];
  startedAt: Date;
  lastMessageAt: Date;
  state: "Open" | "Closed";
}

export interface ChatMessage {
  _id?: ObjectId;
  sessionId: string;
  messageId: string;
  role: ChatRole;
  content: string;
  model: string;
  agentName: string;
  references: string[];
  createdAt: Date;
}
