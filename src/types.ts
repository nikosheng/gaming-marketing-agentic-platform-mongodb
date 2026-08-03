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
export type OfferType =
  | "HotelRoom"
  | "MusicShowTicket"
  | "PointsLimitedTime"
  | "FNBVoucher"
  | "CashRebate"
  | "TransportVoucher";
export type OfferStatus = "Proposed" | "Draft" | "Active" | "Expired" | "Rejected";
export type OfferCreatedBy = "Manual" | "AIAgent";
export type OfferApprovalDecision = "Approve" | "Reject";
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
export type PatronRegion =
  | "Macau"
  | "HongKong"
  | "Guangdong"
  | "OtherGBA"
  | "Taiwan"
  | "International";

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
  region: PatronRegion;
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
  createdBy?: OfferCreatedBy;
  approvalReview?: {
    decision: OfferApprovalDecision;
    rationale?: string;
    actorId: string;
    decidedAt: Date;
  };
}

export interface OfferApprovalAudit {
  _id?: ObjectId;
  offerId: string;
  fromStatus: OfferStatus;
  toStatus: OfferStatus;
  decision: OfferApprovalDecision;
  actorId: string;
  rationale?: string;
  decidedAt: Date;
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

export type MinBetRecommendationStatus =
  | "Proposed"
  | "Approved"
  | "Applied"
  | "Rejected"
  | "Expired";
export type OccupancyTrend = "Rising" | "Stable" | "Falling";
export type MinBetChangeSource = "Agent" | "Manual";

export interface TableStateHistory {
  _id?: ObjectId;
  tableId: string;
  refreshedAt: Date;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
  minBet: number;
  maxBet: number;
  status: TableStatus;
}

export interface MinBetCandidate {
  minBet: number;
  deltaPct: number;
  expectedRevenuePct: number;
  estimatedRetentionPct: number;
}

export interface MinBetRecommendationDrivers {
  occupancyTrend: OccupancyTrend;
  occupancyVelocity: number;
  occupancyRate: number;
  betHeadroom: number;
  lowBetShare: number;
  p50Bet: number;
  p75Bet: number;
  p90Bet: number;
  tierMix: Partial<Record<PatronTier, number>>;
  zone: string;
  gameType: TableGameType;
}

export interface MinBetRecommendation {
  _id?: ObjectId;
  recommendationId: string;
  tableId: string;
  runId: string;
  currentMinBet: number;
  recommendedMinBet: number;
  deltaPct: number;
  expectedRevenueUpliftPct: number;
  confidence: number;
  rationale: string;
  reasons: string[];
  drivers: MinBetRecommendationDrivers;
  candidates: MinBetCandidate[];
  status: MinBetRecommendationStatus;
  createdAt: Date;
  expiresAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
}

export interface MinBetAudit {
  _id?: ObjectId;
  tableId: string;
  oldMinBet: number;
  newMinBet: number;
  source: MinBetChangeSource;
  recommendationId?: string;
  actorId: string;
  at: Date;
}

// ---------- Alert Dashboard ----------

export type ConditionType =
  | "CONSECUTIVE_ROUNDS_BET_THRESHOLD"
  | "CUMULATIVE_ROUNDS_BET_THRESHOLD"
  | "SINGLE_ROUND_ADT_MULTIPLIER"
  | "SESSION_BET_ABOVE"
  | "TIER_MATCH"
  | "BEHAVIOR_TAG_MATCH";

export interface ParsedCondition {
  type: ConditionType;
  params: Record<string, number | string | string[]>;
  confidence: number;
}

export interface AlertRule {
  _id?: ObjectId;
  ruleId: string;
  name: string;
  nlDescription: string;
  conditions: ParsedCondition[];
  conditionLogic: "OR";
  status: "Active" | "Paused";
  totalTriggered: number;
  lastTriggeredAt?: Date;
  createdAt: Date;
}

export interface TableRoundSnapshot {
  _id?: ObjectId;
  tableId: string;
  roundNumber: number;
  patronId: string;
  betAmount: number;
  adt: number;
  tier: string;
  behaviorTags: string[];
  maskedName: string;
  recordedAt: Date;
}

export interface PatronAlert {
  _id?: ObjectId;
  alertId: string;
  ruleId: string;
  ruleName: string;
  patronId: string;
  tableId: string;
  triggeredConditions: Array<{
    type: ConditionType;
    evidence: Record<string, unknown>;
  }>;
  patronSnapshot: {
    maskedName: string;
    tier: string;
    adt: number;
    behaviorTags: string[];
    riskFlags: string[];
    preferredGames: string[];
  };
  tableSnapshot: {
    tableName: string;
    gameType: string;
    zone: string;
  };
  llmRationale?: string;
  status: "New" | "Acknowledged";
  triggeredAt: Date;
}

export interface AlertRulePreview {
  ruleName: string;
  nlDescription: string;
  conditions: ParsedCondition[];
  needsClarification: boolean;
  clarificationQuestion?: string;
}

// ---------- Patron Interaction History ----------

export type InteractionType =
  | "ROOM_COMP"
  | "FB_COMP"
  | "REBATE"
  | "EVENT_INVITE"
  | "OUTREACH"
  | "TRANSFER";

export interface PatronInteractionRecord {
  _id?: ObjectId;
  interactionId: string;           // "INT-{uuid}"
  patronId: string;
  type: InteractionType;
  detail: {
    // ROOM_COMP
    roomType?: string;
    checkIn?: Date;
    checkOut?: Date;
    roomNights?: number;
    roomValue?: number;
    // FB_COMP
    venue?: string;
    fbAmount?: number;
    // REBATE
    rebateAmount?: number;
    rebateRate?: number;
    // EVENT_INVITE
    eventName?: string;
    eventDate?: Date;
    attended?: boolean;
    // OUTREACH
    channel?: "Phone" | "In-Person" | "WeChat" | "WhatsApp";
    outcome?: "Positive" | "Neutral" | "No Answer" | "Declined";
    notes?: string;
    // TRANSFER
    transferType?: "Airport" | "Hotel" | "Venue";
    vehicleClass?: "Standard" | "Luxury";
  };
  totalValueHKD: number;
  occurredAt: Date;
  recordedBy: string;              // prAgentId or "system"
  recordedAt: Date;
  linkedAlertId?: string;
  patronTierAtTime?: PatronTier;
  patronAdtAtTime?: number;
  interactionEmbedding?: number[]; // Voyage AI 1024-dim, for KPI vector search
}

// ---------- Patron Analysis Report ----------

export type ReportStatus = "Draft" | "Acknowledged" | "Actioned";

export interface NextActionRecommendation {
  priority: 1 | 2 | 3;
  actionType: InteractionType | "TIER_UPGRADE" | "CUSTOM";
  title: string;
  rationale: string;
  urgency: "Immediate" | "Within48h" | "ThisWeek";
  estimatedValue?: number;
}

// ---------- PR Efficiency ----------

export interface PrMetrics {
  prAgentId: string;
  name: string;
  active: boolean;
  totalInteractions: number;
  interactionsByType: Partial<Record<InteractionType, number>>;
  totalValueHKD: number;
  uniquePatrons: number;
  tierDistribution: Partial<Record<PatronTier, number>>;
  lastInteractionAt?: Date;
}

export interface PrKpiResult {
  prAgentId: string;
  prName: string;
  topMatchScore: number;       // highest cosine similarity found (0–1)
  matchedCount: number;        // records with score >= 0.70
  totalInteractions: number;
  kpiAchievementRate: number;  // matchedCount / totalInteractions (0–1)
  matchedSamples: Array<{
    type: string;
    occurredAt: string;
    score: number;
  }>;
}

export interface KpiSearchResult {
  kpiText: string;
  results: PrKpiResult[];      // sorted by kpiAchievementRate desc
  topPerformer?: string;       // prAgentId
  bottomPerformer?: string;    // prAgentId
  insight: string;             // LLM Chinese management insight
  actions: string[];           // LLM concrete action items
  searchedAt: Date;
}

export interface PatronAnalysisReport {
  _id?: ObjectId;
  reportId: string;                // "RPT-{uuid}"
  patronId: string;
  triggeredByAlertId: string;
  profileSummary: string;
  interactionHistory: string;
  behaviorPattern: string;
  riskAssessment: string;
  recommendations: NextActionRecommendation[];
  suggestedPrId?: string;
  suggestedPrName?: string;
  generatedAt: Date;
  modelUsed: string;
  status: ReportStatus;
}
