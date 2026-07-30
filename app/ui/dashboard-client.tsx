"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

type HeatmapTable = {
  tableId: string;
  tableName: string;
  zone: string;
  gameType: string;
  status: string;
  minBet: number;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
};

type HeatmapResponse = {
  ok: boolean;
  metrics: {
    totalTables: number;
    totalPatrons: number;
    hotTables: number;
    openOrBusyTables: number;
  };
  tables: HeatmapTable[];
};

type PatronRow = {
  patronId: string;
  maskedName: string;
  tier: string;
  adt: number;
  pointsBalance: number;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  lastActionAt: string;
};

type PatronResponse = {
  ok: boolean;
  tableId: string;
  patronCount: number;
  patrons: PatronRow[];
};

type TableAnalysisResponse = {
  ok: boolean;
  tableId: string;
  analyzedAt: string;
  summary: {
    totalPatrons: number;
    highPotentialCount: number;
    mediumPotentialCount: number;
    avgPotentialScore: number;
    bestTargetPatronId: string | null;
  };
  rankedPatrons: Array<{
    patronId: string;
    maskedName: string;
    tier: string;
    adt: number;
    pointsBalance: number;
    sessionBetAmount: number;
    currentStackEstimate: number;
    behaviorTags: string[];
    lossPotentialScore: number;
    lossPotentialLabel: "High" | "Medium" | "Low";
    confidence: number;
    expectedLossRange: { min: number; max: number };
    recommendation: string;
    reasons: string[];
    suggestedOffers: Array<{
      offerId: string;
      title: string;
      offerType: string;
      score: number;
    }>;
  }>;
  engine: string;
};

type OfferDashboardResponse = {
  ok: boolean;
  summary: {
    offerCount: number;
    recommendationCount: number;
    recentActivityCount: number;
    recommendationStatusCounts: Record<string, number>;
    offerStatusCounts?: Record<string, number>;
    proposedCount?: number;
  };
  offers: Array<{
    offerId: string;
    offerType: string;
    title: string;
    status: string;
    priority: number;
    estimatedCost: number;
    createdBy?: "Manual" | "AIAgent";
    approvalReview?: {
      decision: "Approve" | "Reject";
      rationale?: string;
      actorId: string;
      decidedAt: string;
    };
  }>;
  recommendations: Array<{
    recommendationId: string;
    patronId: string;
    offerId: string;
    relevanceScore: number;
    confidence: number;
    status: string;
    generatedAt: string;
    expiresAt?: string;
    reasonSummary?: string;
    nextBestAction: string;
  }>;
  recentActivities: Array<{
    eventId: string;
    patronId: string;
    activityType: string;
    source: string;
    amount: number;
    pointsDelta: number;
    eventTime: string;
  }>;
};

type GeneratedOffer = {
  offerId: string;
  title: string;
  offerType: string;
  estimatedCost?: number;
  score: number;
  reason?: string;
  matchSignals?: string[];
  strength?: "Strong" | "Moderate" | "Weak";
  breakdown?: {
    atlasScore: number;
    vectorPart: number;
    rulePart: number;
  };
};

type GeneratedPatronSummary = {
  patronId: string;
  tier: string;
  adt: number;
  preferredGames?: string[];
  pointsBalance?: number;
  behaviorTags?: string[];
} | null;

type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

type GuidanceQuestion = {
  id: string;
  question: string;
  example: string;
};

type OfferGenerationStats = {
  totalPatrons: number;
  matchedPatrons: number;
  matchRate: number;
  avgMatchedAdt: number;
  tierBreakdown: Array<{ label: string; value: number }>;
  gameBreakdown: Array<{ label: string; value: number }>;
};

type SampleMatchedPatron = {
  patronId: string;
  maskedName: string;
  tier: string;
  adt: number;
  pointsBalance: number;
  preferredGames: string[];
};

type RiskCasePayload = {
  caseId: string;
  patronId: string;
  tableId: string;
  status: string;
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  escalationTier: "Standard" | "Senior";
  lossChasingAssessment: {
    score: number;
    label: string;
    confidence: number;
    drivers: string[];
    explanation: string;
  };
  financialAssessment: {
    amlRiskScore: number;
    creditBand: string;
    sourceOfFundsRisk: string;
    confidence: number;
    checklist: Array<{ key: string; passed: boolean; notes?: string }>;
    analystNotes: string;
  };
  timeline: Array<{
    eventType: string;
    actorType: string;
    actorId: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  nodeStates?: Array<{
    nodeName: string;
    status: "Pending" | "Running" | "Completed" | "Failed";
    startedAt?: string;
    completedAt?: string;
  }>;
  adminReview?: {
    decision: string;
    rationale: string;
    createdAt: string;
  };
};

type PRAssignmentPayload = {
  assignmentId: string;
  prAgentId: string;
  fitScore: number;
  status: string;
  assignedAt: string;
};

type PRAgentProfileDTO = {
  prAgentId: string;
  name: string;
  active: boolean;
  maxActivePatrons: number;
  currentActivePatrons: number;
  preferredTiers: string[];
  preferredGames: string[];
  preferredLanguages: string[];
  specialtyTags: string[];
  lastAssignedAt?: string;
} | null;

type MinBetRecommendation = {
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
  drivers: {
    occupancyTrend: "Rising" | "Stable" | "Falling";
    occupancyVelocity: number;
    occupancyRate: number;
    betHeadroom: number;
    lowBetShare: number;
    p50Bet: number;
    p75Bet: number;
    p90Bet: number;
    tierMix: Record<string, number>;
    zone: string;
    gameType: string;
  };
  candidates: Array<{
    minBet: number;
    deltaPct: number;
    expectedRevenuePct: number;
    estimatedRetentionPct: number;
  }>;
  status: "Proposed" | "Approved" | "Applied" | "Rejected" | "Expired" | "Skipped";
  skipReason?: string;
  createdAt: string;
  expiresAt: string;
};

type SimulateScenario = "full-high" | "full-mixed" | "low-sticky" | "empty";

type SimulateResponse = {
  ok: boolean;
  scenario: SimulateScenario;
  injectedCount: number;
  avgBet: number;
  occupancyRate: number;
  error?: string;
};

type ConsoleSection = "patron-eyes" | "offer-catalog" | "patron-insight" | "alert-dashboard";

// ---------- Alert Dashboard types ----------

type InteractionType =
  | "ROOM_COMP"
  | "FB_COMP"
  | "REBATE"
  | "EVENT_INVITE"
  | "OUTREACH"
  | "TRANSFER";

const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  ROOM_COMP:    "免費房間",
  FB_COMP:      "餐飲優惠",
  REBATE:       "現金/籌碼回贈",
  EVENT_INVITE: "活動邀請",
  OUTREACH:     "電話/親身接觸",
  TRANSFER:     "交通接送",
};

type NextActionRecommendation = {
  priority: 1 | 2 | 3;
  actionType: string;
  title: string;
  rationale: string;
  urgency: "Immediate" | "Within48h" | "ThisWeek";
  estimatedValue?: number;
};

type PatronAnalysisReport = {
  reportId: string;
  patronId: string;
  triggeredByAlertId: string;
  profileSummary: string;
  interactionHistory: string;
  behaviorPattern: string;
  riskAssessment: string;
  recommendations: NextActionRecommendation[];
  suggestedPrId?: string;
  suggestedPrName?: string;
  generatedAt: string;
  modelUsed: string;
  status: "Draft" | "Acknowledged" | "Actioned";
};

type InteractionFormState = {
  type: InteractionType;
  totalValueHKD: string;
  occurredAt: string;
  notes: string;
  // type-specific
  roomType: string;
  roomNights: string;
  venue: string;
  rebateRate: string;
  eventName: string;
  channel: string;
  outcome: string;
  transferType: string;
};

const DEFAULT_INTERACTION_FORM: InteractionFormState = {
  type: "OUTREACH",
  totalValueHKD: "0",
  occurredAt: new Date().toISOString().slice(0, 10),
  notes: "",
  roomType: "",
  roomNights: "",
  venue: "",
  rebateRate: "",
  eventName: "",
  channel: "Phone",
  outcome: "Positive",
  transferType: "Airport",
};

type ParsedCondition = {
  type: string;
  params: Record<string, number | string | string[]>;
  confidence: number;
};

type AlertRulePreview = {
  ruleName: string;
  nlDescription: string;
  conditions: ParsedCondition[];
  needsClarification: boolean;
  clarificationQuestion?: string;
};

type AlertRule = {
  ruleId: string;
  name: string;
  nlDescription: string;
  conditions: ParsedCondition[];
  conditionLogic: "OR";
  status: "Active" | "Paused";
  totalTriggered: number;
  lastTriggeredAt?: string;
  createdAt: string;
};

type PatronAlert = {
  alertId: string;
  ruleId: string;
  ruleName: string;
  patronId: string;
  tableId: string;
  triggeredConditions: Array<{
    type: string;
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
  triggeredAt: string;
};

type SimulateRoundResponse = {
  ok: boolean;
  tableId: string;
  roundNumber: number;
  sessionsInjected: number;
  alertsTriggered: Array<{
    alertId: string;
    ruleId: string;
    ruleName: string;
    patronId: string;
    conditionTypes: string[];
  }>;
  error?: string;
};

const promptTemplates = [
  "Create a premium hotel offer for Platinum baccarat patrons with ADT >= 10000 active within 7 days.",
  "Offer: Weekend Show Bundle. Build a show ticket offer for Diamond patrons with table bet activity in last 14 days.",
  "Create a points limited-time offer for Gold and Platinum patrons with points >= 20000 and chip exchange >= 8000.",
];

const metricHelpText = {
  score:
    "Loss Potential Score is a weighted signal from session bet intensity, ADT, stack estimate, points balance, and behavior risk. Higher means stronger potential to lose more.",
  confidence:
    "Confidence indicates signal strength quality, driven by behavior-risk and betting intensity. High (80-100%): Aggressive + high bets. Med (70-80%): Solid history + avg session. Low (60-70%): Conservative + small bets.",
  expectedLoss:
    "Expected Loss is an estimated range from current session bet amount adjusted by tier loss factor, shown as a likely min-max window for this session.",
};

function SectionIcon({ section }: { section: ConsoleSection }) {
  if (section === "patron-eyes") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12zm10 3.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (section === "patron-insight") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (section === "alert-dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2a7 7 0 0 0-7 7c0 2.4.9 4.5 2.3 6.1L6 18h12l-1.3-2.9A8.96 8.96 0 0 0 19 9a7 7 0 0 0-7-7zm0 18a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm2 3v2h12V7H6zm0 5v2h8v-2H6z"
        fill="currentColor"
      />
    </svg>
  );
}

function normalizeRiskTone(value: string): "low" | "medium" | "high" | "critical" {
  const text = value.toLowerCase();
  if (text.includes("critical")) return "critical";
  if (text.includes("high") || text.includes("likely")) return "high";
  if (text.includes("medium") || text.includes("borderline")) return "medium";
  return "low";
}

function getChecklistDisplay(
  item: { key: string; passed: boolean; notes?: string },
  financial: { amlRiskScore: number; sourceOfFundsRisk: string; creditBand: string }
) {
  switch (item.key) {
    case "incomePatternConsistent":
      return {
        title: "Income Pattern Consistency",
        reason: item.passed
          ? "Current chip buy-in pattern remains within the patron's historical variance baseline."
          : "Recent buy-in variance exceeds baseline threshold, indicating possible source-of-funds inconsistency.",
        logic:
          "Rule: HighVariance = (Current Session Buy-In > Historical Max Buy-In * 2.0). Checklist passes when HighVariance is false.",
      };
    case "largeCashSpike":
      return {
        title: "Large Cash Spike Detection",
        reason: item.passed
          ? "No unusual short-interval cashout spikes are detected versus normal historical cadence."
          : "Cashout frequency or amount is unusually high compared with the patron's normal profile.",
        logic:
          "AML contribution: FrequentCashout adds +0.28 if detected, otherwise +0.07. This item passes when FrequentCashout is false.",
      };
    case "chipExchangeAnomaly":
      return {
        title: "Chip Exchange Behavior Consistency",
        reason: item.passed
          ? "Chip exchange pattern aligns with typical play behavior and normal promotion usage."
          : "Promotion-led churn or exchange irregularity may mask source-of-funds behavior.",
        logic:
          "AML contribution: PromoSensitive adds +0.12 if detected, otherwise +0.05. This item passes when PromoSensitive is false.",
      };
    case "highRiskSourceSignal":
      return {
        title: "Source of Funds High-Risk Signal",
        reason: item.passed
          ? "Source-of-funds risk score is below the high-risk escalation threshold."
          : "Source-of-funds model indicates high risk and requires senior escalation.",
        logic: `Current AML Risk Score = ${(financial.amlRiskScore * 100).toFixed(
          1
        )}%. Thresholds: High >= 68%, Medium 40-67%, Low < 40%. Current label: ${
          financial.sourceOfFundsRisk
        }.`,
      };
    case "kycProfileFresh":
      return {
        title: "KYC Profile Freshness",
        reason: item.passed
          ? "KYC profile is considered valid and up-to-date for this internal workflow stage."
          : "KYC profile freshness appears insufficient and requires profile refresh verification.",
        logic:
          "MVP rule: KYC freshness is currently assumed valid in internal flow (default pass). Future phase should bind to actual KYC expiry timestamp checks.",
      };
    default:
      return {
        title: item.key,
        reason: item.notes ?? "No additional rationale available.",
        logic: "No formal calculation logic configured for this checklist key.",
      };
  }
}

type AgentGraphStep = {
  id: string;
  title: string;
  detail: string;
  status: "Pending" | "Running" | "Completed";
};

function getAgentStepStatus(
  riskCase: RiskCasePayload,
  nodeName: string
): "Pending" | "Running" | "Completed" {
  const node = riskCase.nodeStates?.find((n) => n.nodeName === nodeName);
  if (!node) return "Pending";
  if (node.status === "Completed") return "Completed";
  if (node.status === "Running") return "Running";
  return "Pending";
}

function buildLossAgentSteps(riskCase: RiskCasePayload): AgentGraphStep[] {
  const hasLossEvent = riskCase.timeline.some((t) => t.eventType === "LossAssessmentCompleted");
  const hasDrivers = riskCase.lossChasingAssessment.drivers.length > 0;
  return [
    {
      id: "loss-data",
      title: "Session Context Loaded",
      detail: "Collect ADT, session bet amount, and behavior tags for scoring input.",
      status: getAgentStepStatus(riskCase, "initialize_case"),
    },
    {
      id: "loss-signals",
      title: "Behavior Signals Computed",
      detail: "Compute ADT signal, session intensity, and behavior pattern weights.",
      status: hasLossEvent ? "Completed" : getAgentStepStatus(riskCase, "evaluate_loss_chasing"),
    },
    {
      id: "loss-score",
      title: "Loss-Chasing Score Emitted",
      detail: `Final score ${(riskCase.lossChasingAssessment.score * 100).toFixed(1)}% with label ${
        riskCase.lossChasingAssessment.label
      }.`,
      status: hasDrivers ? "Completed" : "Pending",
    },
  ];
}

function buildAmlAgentSteps(riskCase: RiskCasePayload): AgentGraphStep[] {
  const hasFinancialEvent = riskCase.timeline.some((t) => t.eventType === "FinancialAssessmentCompleted");
  const hasChecklist = riskCase.financialAssessment.checklist.length > 0;
  const hasRiskBand = Boolean(riskCase.financialAssessment.sourceOfFundsRisk);
  return [
    {
      id: "aml-data",
      title: "Financial Profile Loaded",
      detail: "Load points balance, risk flags, and ADT profile for AML scoring.",
      status: getAgentStepStatus(riskCase, "initialize_case"),
    },
    {
      id: "aml-rules",
      title: "AML Rules Executed",
      detail: "Apply variance, cashout cadence, promo sensitivity, and points-balance logic.",
      status: hasFinancialEvent ? "Completed" : getAgentStepStatus(riskCase, "evaluate_financial_credit_aml"),
    },
    {
      id: "aml-output",
      title: "SoF Risk & Checklist Generated",
      detail: `AML score ${(riskCase.financialAssessment.amlRiskScore * 100).toFixed(1)}% -> ${
        riskCase.financialAssessment.sourceOfFundsRisk
      } risk.`,
      status: hasChecklist && hasRiskBand ? "Completed" : "Pending",
    },
  ];
}

// ---------- Risk modal helpers ----------

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (hue1 + 50) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 65% 45%))`;
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function humanizeEventType(t: string): string {
  return t.replace(/([A-Z])/g, " $1").trim();
}

function getActorTone(actorType: string): "system" | "agent" | "admin" | "pr" {
  if (actorType === "System") return "system";
  if (actorType === "Agent") return "agent";
  if (actorType === "Admin") return "admin";
  return "pr";
}

function getPayloadSummary(
  eventType: string,
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  switch (eventType) {
    case "LossAssessmentCompleted":
      return `Score ${(num(payload.score) * 100).toFixed(0)}% · ${payload.label ?? "-"}`;
    case "FinancialAssessmentCompleted":
      return `AML ${(num(payload.amlRiskScore) * 100).toFixed(0)}% · SoF ${
        payload.sourceOfFundsRisk ?? "-"
      }`;
    case "Escalated":
      return `Tier: ${payload.escalationTier ?? "-"}`;
    case "AdminDecisionSubmitted":
      return `${payload.decision ?? "-"}`;
    case "PRAssignmentCreated":
      return `${payload.prAgentId ?? "-"} (fit ${(num(payload.fitScore) * 100).toFixed(0)}%)`;
    case "CaseClosed":
      return `Final: ${payload.finalStatus ?? "-"}`;
    case "CaseCreated":
      return payload.tableId ? `Table ${payload.tableId}` : null;
    default:
      return null;
  }
}

export default function DashboardClient() {
  const [activeSection, setActiveSection] = useState<ConsoleSection>("patron-eyes");
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [patrons, setPatrons] = useState<PatronResponse | null>(null);
  const [tableAnalysis, setTableAnalysis] = useState<TableAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [offerDashboard, setOfferDashboard] = useState<OfferDashboardResponse | null>(null);
  const [generatePatronId, setGeneratePatronId] = useState<string>("");
  const [generatedOffers, setGeneratedOffers] = useState<GeneratedOffer[]>([]);
  const [generatedPatron, setGeneratedPatron] = useState<GeneratedPatronSummary>(null);
  const [recoStatusFilter, setRecoStatusFilter] = useState<string>("All");
  const [offerStatusFilter, setOfferStatusFilter] = useState<string>("All");
  const [rejectOfferId, setRejectOfferId] = useState<string | null>(null);
  const [rejectOfferTitle, setRejectOfferTitle] = useState<string>("");
  const [rejectRationale, setRejectRationale] = useState<string>("");
  const [offerActionLoading, setOfferActionLoading] = useState<string | null>(null);
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentQuestions, setAgentQuestions] = useState<GuidanceQuestion[]>([]);
  const [agentStats, setAgentStats] = useState<OfferGenerationStats | null>(null);
  const [sampleMatchedPatrons, setSampleMatchedPatrons] = useState<SampleMatchedPatron[]>([]);
  const [copiedPatronId, setCopiedPatronId] = useState<string | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "Tell me the offer and patron criteria. Example: Create a hotel offer for Gold/Platinum baccarat patrons with ADT >= 5000 active within 7 days.",
    },
  ]);
  const [riskCaseLoading, setRiskCaseLoading] = useState<boolean>(false);
  const [riskCaseModalOpen, setRiskCaseModalOpen] = useState<boolean>(false);
  const [riskCase, setRiskCase] = useState<RiskCasePayload | null>(null);
  const [prAssignment, setPrAssignment] = useState<PRAssignmentPayload | null>(null);
  const [prAgentProfile, setPrAgentProfile] = useState<PRAgentProfileDTO>(null);
  const [riskCasePatronId, setRiskCasePatronId] = useState<string>("");
  const [adminDecision, setAdminDecision] = useState<"Approve" | "Reject" | "RequestMoreInfo">("Approve");
  const [adminRationale, setAdminRationale] = useState<string>("");
  const [minBetRecommendation, setMinBetRecommendation] = useState<MinBetRecommendation | null>(null);
  const [minBetHistory, setMinBetHistory] = useState<MinBetRecommendation[]>([]);
  const [minBetLoading, setMinBetLoading] = useState<boolean>(false);
  const [minBetActionLoading, setMinBetActionLoading] = useState<boolean>(false);
  const [simulatePanelOpen, setSimulatePanelOpen] = useState<boolean>(false);
  const [simulateLoading, setSimulateLoading] = useState<boolean>(false);
  const [simulateScenario, setSimulateScenario] = useState<SimulateScenario>("full-high");
  const [drillDrawerOpen, setDrillDrawerOpen] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // ---------- Alert Dashboard state ----------
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertRulesLoading, setAlertRulesLoading] = useState<boolean>(false);
  const [alerts, setAlerts] = useState<PatronAlert[]>([]);
  const [alertStats, setAlertStats] = useState<{ total: number; newCount: number; byRule: Record<string, number> } | null>(null);
  const [alertsLoading, setAlertsLoading] = useState<boolean>(false);
  const [nlInput, setNlInput] = useState<string>("");
  const [nlParsing, setNlParsing] = useState<boolean>(false);
  const [rulePreview, setRulePreview] = useState<AlertRulePreview | null>(null);
  const [rulePreviewError, setRulePreviewError] = useState<string>("");
  const [ruleConfirming, setRuleConfirming] = useState<boolean>(false);
  // Simulate Round state
  const [roundNumbers, setRoundNumbers] = useState<Record<string, number>>({});
  const [simulateRoundLoading, setSimulateRoundLoading] = useState<boolean>(false);
  const [lastRoundResult, setLastRoundResult] = useState<SimulateRoundResponse | null>(null);
  // ---------- Patron Analysis state ----------
  const [analyzingAlertId, setAnalyzingAlertId] = useState<string | null>(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState<Record<string, PatronAnalysisReport>>({});
  const [interactionFormAlertId, setInteractionFormAlertId] = useState<string | null>(null);
  const [interactionForm, setInteractionForm] = useState<InteractionFormState>(DEFAULT_INTERACTION_FORM);
  const [interactionSubmitting, setInteractionSubmitting] = useState<boolean>(false);

  useEffect(() => {
    async function fetchHeatmap() {
      const res = await fetch("/api/tables/heatmap", { cache: "no-store" });
      const data = (await res.json()) as HeatmapResponse;
      if (!data.ok) return;
      setHeatmap(data);
      if (!selectedTableId && data.tables.length > 0) {
        setSelectedTableId(data.tables[0].tableId);
      }
    }

    async function fetchOffers() {
      const res = await fetch("/api/offers/dashboard", { cache: "no-store" });
      const data = (await res.json()) as OfferDashboardResponse;
      if (!data.ok) return;
      setOfferDashboard(data);
    }

    fetchHeatmap().catch((err) => setError((err as Error).message));
    fetchOffers().catch((err) => setError((err as Error).message));
    const interval = window.setInterval(fetchHeatmap, 60000);
    return () => window.clearInterval(interval);
  }, [selectedTableId]);

  // Fetch alert rules + alerts when alert-dashboard section is activated
  useEffect(() => {
    if (activeSection !== "alert-dashboard") return;
    async function fetchAlertRules() {
      setAlertRulesLoading(true);
      try {
        const res = await fetch("/api/alert-rules", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; rules?: AlertRule[] };
        if (data.ok) setAlertRules(data.rules ?? []);
      } finally {
        setAlertRulesLoading(false);
      }
    }
    async function fetchAlerts() {
      setAlertsLoading(true);
      try {
        const res = await fetch("/api/alerts?limit=50", { cache: "no-store" });
        const data = (await res.json()) as {
          ok: boolean;
          alerts?: PatronAlert[];
          stats?: { total: number; newCount: number; byRule: Record<string, number> };
        };
        if (data.ok) {
          setAlerts(data.alerts ?? []);
          setAlertStats(data.stats ?? null);
        }
      } finally {
        setAlertsLoading(false);
      }
    }
    fetchAlertRules().catch(() => undefined);
    fetchAlerts().catch(() => undefined);
  }, [activeSection]);

  useEffect(() => {
    if (!selectedTableId) return;
    setTableAnalysis(null);
    setMinBetRecommendation(null);
    setMinBetHistory([]);
    setSimulatePanelOpen(false);
    async function fetchPatrons() {
      const res = await fetch(`/api/tables/${selectedTableId}/patrons`, { cache: "no-store" });
      const data = (await res.json()) as PatronResponse;
      if (!data.ok) return;
      setPatrons(data);
      setGeneratePatronId((current) => current || data.patrons[0]?.patronId || "");
    }
    async function fetchMinBetHistory() {
      const res = await fetch(`/api/tables/${selectedTableId}/minbet-recommendations`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        recommendations?: MinBetRecommendation[];
      };
      if (!data.ok) return;
      setMinBetHistory(data.recommendations ?? []);
    }
    fetchPatrons().catch((err) => setError((err as Error).message));
    fetchMinBetHistory().catch(() => undefined);
  }, [selectedTableId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!drillDrawerOpen) {
      document.body.classList.remove("drawer-open");
      return;
    }
    document.body.classList.add("drawer-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrillDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("drawer-open");
    };
  }, [drillDrawerOpen]);

  const filteredRecommendations = useMemo(() => {
    const all = offerDashboard?.recommendations ?? [];
    if (recoStatusFilter === "All") return all.slice(0, 12);
    return all.filter((r) => r.status === recoStatusFilter).slice(0, 12);
  }, [offerDashboard, recoStatusFilter]);

  const activeOfferCount = useMemo(
    () => (offerDashboard?.offers ?? []).filter((o) => o.status === "Active").length,
    [offerDashboard]
  );

  const offerStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      All: 0,
      Proposed: 0,
      Active: 0,
      Draft: 0,
      Rejected: 0,
      Expired: 0,
    };
    for (const o of offerDashboard?.offers ?? []) {
      counts.All += 1;
      const key = o.status;
      if (counts[key] !== undefined) counts[key] += 1;
    }
    return counts;
  }, [offerDashboard]);

  const filteredOffers = useMemo(() => {
    const all = offerDashboard?.offers ?? [];
    if (offerStatusFilter === "All") return all.slice(0, 16);
    return all.filter((o) => o.status === offerStatusFilter).slice(0, 16);
  }, [offerDashboard, offerStatusFilter]);

  function onCopyPatronId(patronId: string) {
    const fallback = () => {
      setCopiedPatronId(patronId);
      window.setTimeout(() => {
        setCopiedPatronId((current) => (current === patronId ? null : current));
      }, 1500);
    };
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(patronId).then(fallback, fallback);
    } else {
      fallback();
    }
  }

  async function refreshOfferDashboard() {
    const res = await fetch("/api/offers/dashboard", { cache: "no-store" });
    const data = (await res.json()) as OfferDashboardResponse;
    if (data.ok) setOfferDashboard(data);
  }

  async function onApproveOffer(offerId: string) {
    if (offerActionLoading) return;
    setOfferActionLoading(offerId);
    try {
      const res = await fetch(`/api/offers/${offerId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to approve offer.");
        return;
      }
      await refreshOfferDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOfferActionLoading(null);
    }
  }

  function openRejectModal(offerId: string, title: string) {
    setRejectOfferId(offerId);
    setRejectOfferTitle(title);
    setRejectRationale("");
  }

  function closeRejectModal() {
    setRejectOfferId(null);
    setRejectOfferTitle("");
    setRejectRationale("");
  }

  async function onConfirmReject() {
    if (!rejectOfferId || !rejectRationale.trim() || offerActionLoading) return;
    setOfferActionLoading(rejectOfferId);
    try {
      const res = await fetch(`/api/offers/${rejectOfferId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rationale: rejectRationale.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to reject offer.");
        return;
      }
      await refreshOfferDashboard();
      closeRejectModal();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOfferActionLoading(null);
    }
  }

  function formatAmount(value: number) {
    return value.toLocaleString();
  }

  async function onGenerateOffers() {
    if (!generatePatronId) return;
    const res = await fetch("/api/offers/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patronId: generatePatronId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      patron?: GeneratedPatronSummary;
      generatedOffers: GeneratedOffer[];
      error?: string;
    };
    if (!data.ok) {
      setError(data.error ?? "Failed to generate offers");
      return;
    }
    setGeneratedOffers(data.generatedOffers);
    setGeneratedPatron(data.patron ?? null);
  }

  async function onSubmitAgentPrompt() {
    const message = agentInput.trim();
    if (!message || agentLoading) return;
    setAgentMessages((current) => [...current, { role: "user", content: message }]);
    setAgentInput("");
    setAgentLoading(true);
    try {
      const res = await fetch("/api/offers/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reply?: string;
        error?: string;
        stats?: OfferGenerationStats | null;
        sampleMatchedPatrons?: SampleMatchedPatron[];
        guidanceQuestions?: GuidanceQuestion[];
        requiresClarification?: boolean;
      };
      if (!data.ok) {
        setAgentMessages((current) => [
          ...current,
          { role: "assistant", content: data.error ?? "Failed to process request." },
        ]);
        return;
      }
      setAgentMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply ?? "Offer created." },
      ]);
      setAgentQuestions(data.guidanceQuestions ?? []);
      setAgentStats(data.requiresClarification ? null : (data.stats ?? null));
      setSampleMatchedPatrons(
        data.requiresClarification ? [] : (data.sampleMatchedPatrons ?? [])
      );

      const offersRes = await fetch("/api/offers/dashboard", { cache: "no-store" });
      const offersData = (await offersRes.json()) as OfferDashboardResponse;
      if (offersData.ok) setOfferDashboard(offersData);
    } catch (err) {
      setAgentMessages((current) => [
        ...current,
        { role: "assistant", content: (err as Error).message },
      ]);
    } finally {
      setAgentLoading(false);
    }
  }

  async function onAnalyzeTable() {
    if (!selectedTableId || analysisLoading) return;
    setAnalysisLoading(true);
    try {
      const res = await fetch(`/api/tables/${selectedTableId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as TableAnalysisResponse & { error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to analyze table patrons.");
        return;
      }
      setTableAnalysis(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function onOptimizeMinBet() {
    if (!selectedTableId || minBetLoading) return;
    setMinBetLoading(true);
    try {
      const res = await fetch(`/api/tables/${selectedTableId}/optimize-minbet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        recommendation?: MinBetRecommendation;
        error?: string;
      };
      if (!data.ok || !data.recommendation) {
        setError(data.error ?? "Failed to optimize min bet.");
        return;
      }
      setMinBetRecommendation(data.recommendation);
      const histRes = await fetch(`/api/tables/${selectedTableId}/minbet-recommendations`, {
        cache: "no-store",
      });
      const histData = (await histRes.json()) as {
        ok: boolean;
        recommendations?: MinBetRecommendation[];
      };
      if (histData.ok) setMinBetHistory(histData.recommendations ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMinBetLoading(false);
    }
  }

  async function onApplyMinBet() {
    if (!selectedTableId || !minBetRecommendation || minBetActionLoading) return;
    setMinBetActionLoading(true);
    try {
      const res = await fetch(
        `/api/tables/${selectedTableId}/minbet-recommendations/${minBetRecommendation.recommendationId}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = (await res.json()) as {
        ok: boolean;
        oldMinBet?: number;
        newMinBet?: number;
        error?: string;
      };
      if (!data.ok) {
        setError(data.error ?? "Failed to apply recommendation.");
        return;
      }
      // Refresh heatmap and history.
      const [heatmapRes, histRes] = await Promise.all([
        fetch("/api/tables/heatmap", { cache: "no-store" }),
        fetch(`/api/tables/${selectedTableId}/minbet-recommendations`, { cache: "no-store" }),
      ]);
      const heatmapData = (await heatmapRes.json()) as HeatmapResponse;
      if (heatmapData.ok) setHeatmap(heatmapData);
      const histData = (await histRes.json()) as {
        ok: boolean;
        recommendations?: MinBetRecommendation[];
      };
      if (histData.ok) setMinBetHistory(histData.recommendations ?? []);
      setMinBetRecommendation((current) =>
        current ? { ...current, status: "Applied" } : current
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMinBetActionLoading(false);
    }
  }

  async function onRejectMinBet() {
    if (!selectedTableId || !minBetRecommendation || minBetActionLoading) return;
    setMinBetActionLoading(true);
    try {
      const res = await fetch(
        `/api/tables/${selectedTableId}/minbet-recommendations/${minBetRecommendation.recommendationId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to reject recommendation.");
        return;
      }
      setMinBetRecommendation((current) =>
        current ? { ...current, status: "Rejected" } : current
      );
      const histRes = await fetch(`/api/tables/${selectedTableId}/minbet-recommendations`, {
        cache: "no-store",
      });
      const histData = (await histRes.json()) as {
        ok: boolean;
        recommendations?: MinBetRecommendation[];
      };
      if (histData.ok) setMinBetHistory(histData.recommendations ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMinBetActionLoading(false);
    }
  }

  async function onSimulateAndOptimize() {
    if (!selectedTableId || simulateLoading) return;
    setSimulateLoading(true);
    try {
      // Step 1: inject simulated sessions (also clears cooldown audit)
      const simRes = await fetch(`/api/tables/${selectedTableId}/simulate-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: simulateScenario }),
      });
      const simData = (await simRes.json()) as SimulateResponse;
      if (!simData.ok) {
        setError(simData.error ?? "Failed to inject simulation data.");
        return;
      }
      // Step 2: immediately run optimizer against the new session data
      const optRes = await fetch(`/api/tables/${selectedTableId}/optimize-minbet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const optData = (await optRes.json()) as {
        ok: boolean;
        recommendation?: MinBetRecommendation;
        error?: string;
      };
      if (!optData.ok || !optData.recommendation) {
        setError(optData.error ?? "Failed to run optimizer.");
        return;
      }
      setMinBetRecommendation(optData.recommendation);
      // Step 3: refresh history + heatmap in parallel
      const [histRes, heatmapRes] = await Promise.all([
        fetch(`/api/tables/${selectedTableId}/minbet-recommendations`, { cache: "no-store" }),
        fetch("/api/tables/heatmap", { cache: "no-store" }),
      ]);
      const histData = (await histRes.json()) as {
        ok: boolean;
        recommendations?: MinBetRecommendation[];
      };
      if (histData.ok) setMinBetHistory(histData.recommendations ?? []);
      const heatmapData = (await heatmapRes.json()) as HeatmapResponse;
      if (heatmapData.ok) setHeatmap(heatmapData);
      setSimulatePanelOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSimulateLoading(false);
    }
  }

  async function onStartRiskReview(patronId: string) {
    if (!selectedTableId) return;
    setRiskCaseLoading(true);
    setRiskCasePatronId(patronId);
    setRiskCaseModalOpen(true);
    try {
      const res = await fetch(`/api/patrons/${patronId}/risk-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: selectedTableId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        case?: RiskCasePayload;
        error?: string;
      };
      if (!data.ok || !data.case) {
        setError(data.error ?? "Failed to start risk review.");
        return;
      }
      setRiskCase(data.case);

      const latestRes = await fetch(`/api/patrons/${patronId}/risk-case/latest`, { cache: "no-store" });
      const latestData = (await latestRes.json()) as {
        ok: boolean;
        case?: RiskCasePayload;
        assignment?: PRAssignmentPayload | null;
        prAgentProfile?: PRAgentProfileDTO;
      };
      if (latestData.ok && latestData.case) {
        setRiskCase(latestData.case);
        setPrAssignment(latestData.assignment ?? null);
        setPrAgentProfile(latestData.prAgentProfile ?? null);
      } else {
        setPrAssignment(null);
        setPrAgentProfile(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRiskCaseLoading(false);
    }
  }

  // ---------- Alert Dashboard handlers ----------

  async function onParseRule() {
    const desc = nlInput.trim();
    if (!desc || nlParsing) return;
    setNlParsing(true);
    setRulePreview(null);
    setRulePreviewError("");
    try {
      const res = await fetch("/api/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", nlDescription: desc }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        preview?: AlertRulePreview;
        error?: string;
      };
      if (!data.ok || !data.preview) {
        setRulePreviewError(data.error ?? "Failed to parse rule.");
        return;
      }
      setRulePreview(data.preview);
    } catch (err) {
      setRulePreviewError((err as Error).message);
    } finally {
      setNlParsing(false);
    }
  }

  async function onConfirmRule() {
    if (!rulePreview || ruleConfirming) return;
    setRuleConfirming(true);
    try {
      const res = await fetch("/api/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", preview: rulePreview }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        rule?: AlertRule;
        error?: string;
      };
      if (!data.ok) {
        setRulePreviewError(data.error ?? "Failed to create rule.");
        return;
      }
      if (data.rule) setAlertRules((prev) => [data.rule!, ...prev]);
      setRulePreview(null);
      setNlInput("");
    } catch (err) {
      setRulePreviewError((err as Error).message);
    } finally {
      setRuleConfirming(false);
    }
  }

  async function onToggleRuleStatus(ruleId: string, current: "Active" | "Paused") {
    const next = current === "Active" ? "Paused" : "Active";
    try {
      const res = await fetch(`/api/alert-rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) return;
      setAlertRules((prev) =>
        prev.map((r) => (r.ruleId === ruleId ? { ...r, status: next } : r))
      );
    } catch {
      // silent
    }
  }

  async function handleResolveAlert(alertId: string, patronId: string) {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, { method: "DELETE" });
      if (!res.ok) return;
      // Optimistically remove all alerts for this patron from local state
      setAlerts((prev) => prev.filter((a) => a.patronId !== patronId));
      setAlertStats((prev) => {
        if (!prev) return prev;
        const remaining = alerts.filter((a) => a.patronId !== patronId);
        const newCount = remaining.filter((a) => a.status === "New").length;
        const byRule: Record<string, number> = {};
        for (const a of remaining) {
          byRule[a.ruleName] = (byRule[a.ruleName] ?? 0) + 1;
        }
        return { total: remaining.length, newCount, byRule };
      });
    } catch {
      // silent
    }
  }

  async function handleAnalyzePatron(alertId: string) {
    if (analyzingAlertId) return;
    // If already have result, toggle off
    if (expandedAnalysis[alertId]) {
      setExpandedAnalysis((prev) => {
        const next = { ...prev };
        delete next[alertId];
        return next;
      });
      return;
    }
    setAnalyzingAlertId(alertId);
    try {
      const res = await fetch(`/api/alerts/${alertId}/analyze-patron`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; report?: PatronAnalysisReport; error?: string };
      if (data.ok && data.report) {
        setExpandedAnalysis((prev) => ({ ...prev, [alertId]: data.report! }));
      }
    } catch {
      // silent
    } finally {
      setAnalyzingAlertId(null);
    }
  }

  async function handleSubmitInteraction(patronId: string, alertId: string) {
    if (interactionSubmitting) return;
    setInteractionSubmitting(true);
    try {
      const detail: Record<string, unknown> = { notes: interactionForm.notes };
      switch (interactionForm.type) {
        case "ROOM_COMP":
          detail.roomType = interactionForm.roomType;
          detail.roomNights = interactionForm.roomNights ? Number(interactionForm.roomNights) : undefined;
          break;
        case "FB_COMP":
          detail.venue = interactionForm.venue;
          break;
        case "REBATE":
          detail.rebateRate = interactionForm.rebateRate ? Number(interactionForm.rebateRate) / 100 : undefined;
          break;
        case "EVENT_INVITE":
          detail.eventName = interactionForm.eventName;
          break;
        case "OUTREACH":
          detail.channel = interactionForm.channel;
          detail.outcome = interactionForm.outcome;
          break;
        case "TRANSFER":
          detail.transferType = interactionForm.transferType;
          break;
      }
      const res = await fetch(`/api/patrons/${patronId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: interactionForm.type,
          totalValueHKD: Number(interactionForm.totalValueHKD),
          occurredAt: interactionForm.occurredAt,
          recordedBy: "system",
          linkedAlertId: alertId,
          detail,
        }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setInteractionFormAlertId(null);
        setInteractionForm(DEFAULT_INTERACTION_FORM);
      }
    } catch {
      // silent
    } finally {
      setInteractionSubmitting(false);
    }
  }

  async function onSimulateRound() {
    if (!selectedTableId || simulateRoundLoading) return;
    setSimulateRoundLoading(true);
    setLastRoundResult(null);
    try {
      const res = await fetch(`/api/tables/${selectedTableId}/simulate-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as SimulateRoundResponse;
      if (!data.ok) {
        setError(data.error ?? "Failed to simulate round.");
        return;
      }
      setLastRoundResult(data);
      setRoundNumbers((prev) => ({ ...prev, [selectedTableId]: data.roundNumber }));
      // Refresh alert feed if any alerts were triggered
      if (data.alertsTriggered.length > 0) {
        const alertRes = await fetch("/api/alerts?limit=50", { cache: "no-store" });
        const alertData = (await alertRes.json()) as {
          ok: boolean;
          alerts?: PatronAlert[];
          stats?: { total: number; newCount: number; byRule: Record<string, number> };
        };
        if (alertData.ok) {
          setAlerts(alertData.alerts ?? []);
          setAlertStats(alertData.stats ?? null);
        }
        // Also refresh alert rules to update totalTriggered counts
        const rulesRes = await fetch("/api/alert-rules", { cache: "no-store" });
        const rulesData = (await rulesRes.json()) as { ok: boolean; rules?: AlertRule[] };
        if (rulesData.ok) setAlertRules(rulesData.rules ?? []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSimulateRoundLoading(false);
    }
  }

  function renderConditionLabel(type: string, params: Record<string, number | string | string[]>): string {
    switch (type) {
      case "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
        return `連續 ${params.rounds ?? "?"} 輪 每輪 > HKD ${Number(params.threshold ?? 0).toLocaleString()}`;
      case "CUMULATIVE_ROUNDS_BET_THRESHOLD":
        return `${params.rounds ?? "?"} 輪累計 > HKD ${Number(params.totalThreshold ?? 0).toLocaleString()}`;
      case "SINGLE_ROUND_ADT_MULTIPLIER":
        return `單輪下注 > ADT × ${params.multiplier ?? "?"}`;
      case "SESSION_BET_ABOVE":
        return `本場累計 > HKD ${Number(params.threshold ?? 0).toLocaleString()}`;
      case "TIER_MATCH":
        return `Tier: ${Array.isArray(params.tiers) ? (params.tiers as string[]).join(", ") : params.tiers}`;
      case "BEHAVIOR_TAG_MATCH":
        return `行為標籤: ${Array.isArray(params.tags) ? (params.tags as string[]).join(", ") : params.tags}`;
      default:
        return type;
    }
  }

  function formatAlertEvidence(type: string, evidence: Record<string, unknown>): string {
    switch (type) {
      case "CONSECUTIVE_ROUNDS_BET_THRESHOLD": {
        const bets = (evidence.bets as Array<{ round: number; amount: number }> | undefined) ?? [];
        return bets.map((b) => `HKD ${b.amount.toLocaleString()}`).join(" → ") || "—";
      }
      case "CUMULATIVE_ROUNDS_BET_THRESHOLD": {
        const bets = (evidence.bets as number[] | undefined) ?? [];
        return `${bets.map((b) => `HKD ${b.toLocaleString()}`).join(" + ")} = HKD ${Number(evidence.totalBet ?? 0).toLocaleString()}`;
      }
      case "SINGLE_ROUND_ADT_MULTIPLIER":
        return `HKD ${Number(evidence.betAmount ?? 0).toLocaleString()} (${evidence.adtRatio}× ADT)`;
      case "SESSION_BET_ABOVE":
        return `Session HKD ${Number(evidence.sessionBetAmount ?? 0).toLocaleString()}`;
      default:
        return JSON.stringify(evidence).slice(0, 80);
    }
  }

  async function onSubmitAdminDecision() {
    if (!riskCase?.caseId || !adminRationale.trim()) return;
    setRiskCaseLoading(true);
    try {
      const res = await fetch(`/api/risk-cases/${riskCase.caseId}/admin-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: adminDecision,
          rationale: adminRationale.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        case?: RiskCasePayload;
        assignment?: PRAssignmentPayload | null;
        prAgentProfile?: PRAgentProfileDTO;
        error?: string;
      };
      if (!data.ok || !data.case) {
        setError(data.error ?? "Failed to submit admin decision.");
        return;
      }
      setRiskCase(data.case);
      setPrAssignment(data.assignment ?? null);
      setPrAgentProfile(data.prAgentProfile ?? null);
      setAdminRationale("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRiskCaseLoading(false);
    }
  }

  return (
    <main className="modern-page console-layout">
      <aside className="console-sidebar">
        <div className="console-brand">
          <h1>Management Console</h1>
          <p>Marketing Ops</p>
        </div>
        <button
          className={`console-nav-btn ${activeSection === "patron-eyes" ? "active" : ""}`}
          onClick={() => setActiveSection("patron-eyes")}
          type="button"
        >
          <span className="console-nav-icon">
            <SectionIcon section="patron-eyes" />
          </span>
          <span>Patron Eyes</span>
        </button>
        <button
          className={`console-nav-btn ${activeSection === "offer-catalog" ? "active" : ""}`}
          onClick={() => setActiveSection("offer-catalog")}
          type="button"
        >
          <span className="console-nav-icon">
            <SectionIcon section="offer-catalog" />
          </span>
          <span>Offer Catalog</span>
        </button>
        <button
          className={`console-nav-btn ${activeSection === "patron-insight" ? "active" : ""}`}
          onClick={() => setActiveSection("patron-insight")}
          type="button"
        >
          <span className="console-nav-icon">
            <SectionIcon section="patron-insight" />
          </span>
          <span>Patron Insight</span>
        </button>
        <button
          className={`console-nav-btn ${activeSection === "alert-dashboard" ? "active" : ""}`}
          onClick={() => setActiveSection("alert-dashboard")}
          type="button"
        >
          <span className="console-nav-icon">
            <SectionIcon section="alert-dashboard" />
          </span>
          <span>Alert Dashboard</span>
          {alertStats && alertStats.newCount > 0 ? (
            <span style={{ marginLeft: "auto", fontSize: "0.65rem", fontWeight: 700, color: "#ff6b35",
              background: "rgba(255,107,53,0.15)", border: "1px solid rgba(255,107,53,0.35)",
              borderRadius: "10px", padding: "1px 6px" }}>
              {alertStats.newCount}
            </span>
          ) : null}
        </button>
      </aside>

      <section className="console-content">
        <header className="hero">
          <div>
            <h2 className="hero-title">
              {activeSection === "patron-eyes"
                ? "Patron Eyes"
                : activeSection === "alert-dashboard"
                  ? "Alert Dashboard"
                  : "Offer Catalog"}
            </h2>
            <p className="hero-subtitle">
              {activeSection === "patron-eyes"
                ? "Monitor live table activity, drill into active patrons, and run instant loss-potential analysis."
                : activeSection === "alert-dashboard"
                  ? "Define high-value patron rules in natural language. Simulate betting rounds and receive instant AI-powered alerts."
                  : "Manage promotion inventory, run quick lookups, and generate strategy-ready offers with AI support."}
            </p>
          </div>
          <div className="hero-metrics">
            <span className="hero-chip">Tables {heatmap?.metrics.totalTables ?? "-"}</span>
            <span className="hero-chip">Patrons {heatmap?.metrics.totalPatrons ?? "-"}</span>
            <span className="hero-chip">Offers {offerDashboard?.summary.offerCount ?? "-"}</span>
          </div>
        </header>
        {error ? <p className="error-banner">{error}</p> : null}

        {activeSection === "patron-eyes" ? (
          <>
          <div className="section-stack">
            <article className="panel-card">
              <h2 className="panel-title">Table Heatmap</h2>
              <div className="metric-row">
                <span className="metric-chip">Hot {heatmap?.metrics.hotTables ?? "-"}</span>
                <span className="metric-chip">Open/Busy {heatmap?.metrics.openOrBusyTables ?? "-"}</span>
                <span className="metric-chip">Refresh 1m</span>
              </div>
              <div className="tables">
                {(heatmap?.tables ?? []).map((table) => (
                  <button
                    key={table.tableId}
                    className={`table-btn ${selectedTableId === table.tableId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedTableId(table.tableId);
                      setDrillDrawerOpen(true);
                    }}
                  >
                    <div className="table-head">
                      <span className="table-name">{table.tableName}</span>
                      <span className="table-patron-badge">
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="12" height="12">
                          <path
                            d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                            fill="currentColor"
                          />
                        </svg>
                        {table.patronCount}
                      </span>
                    </div>
                    <div className="table-tags">
                      <span className={`table-chip game-${table.gameType.toLowerCase()}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="11" height="11">
                          <path
                            d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-7 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
                            fill="currentColor"
                          />
                        </svg>
                        {table.gameType}
                      </span>
                      <span className="table-chip zone-chip">
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="11" height="11">
                          <path
                            d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
                            fill="currentColor"
                          />
                        </svg>
                        {table.zone}
                      </span>
                    </div>
                    <div
                      className={`table-occupancy-bar ${
                        table.occupancyRate >= 0.8
                          ? "high"
                          : table.occupancyRate >= 0.5
                            ? "medium"
                            : "low"
                      }`}
                    >
                      <div
                        className="table-occupancy-fill"
                        style={{ width: `${Math.round(table.occupancyRate * 100)}%` }}
                      />
                    </div>
                    <div className="table-card-footer">
                      <div
                        className={`table-card-footer-item ${
                          table.occupancyRate >= 0.8
                            ? "high"
                            : table.occupancyRate >= 0.5
                              ? "medium"
                              : "low"
                        }`}
                      >
                        <span className="table-card-footer-label">Occ.</span>
                        <span className="table-occupancy-value">
                          {Math.round(table.occupancyRate * 100)}
                          <em>%</em>
                        </span>
                      </div>
                      <div className="table-card-footer-item">
                        <span className="table-card-footer-label">Min Bet</span>
                        <span className="table-minbet-value">{formatAmount(table.minBet)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </article>

          </div>
          {/* === Table Drill-Down Drawer === */}
          <div
            className={`drilldown-overlay ${drillDrawerOpen ? "open" : ""}`}
        onClick={() => setDrillDrawerOpen(false)}
        role="presentation"
        aria-hidden={!drillDrawerOpen}
      />
      <aside
        className={`drilldown-drawer ${drillDrawerOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Table Drill-Down"
      >
        <header className="drilldown-drawer-head">
          <div>
            <h2 className="panel-title">Table {selectedTableId || "-"}</h2>
            <p className="small">
              {heatmap?.tables.find((t) => t.tableId === selectedTableId)?.tableName ?? ""}
              {heatmap?.tables.find((t) => t.tableId === selectedTableId)?.gameType
                ? ` · ${heatmap?.tables.find((t) => t.tableId === selectedTableId)?.gameType}`
                : ""}
            </p>
          </div>
          <div className="drilldown-drawer-actions">
            <button
              className="button analysis-button"
              onClick={onAnalyzeTable}
              type="button"
              disabled={!selectedTableId || analysisLoading}
            >
              {analysisLoading ? "Analyzing..." : "Start Loss Potential Agent"}
            </button>
            <button
              className="drilldown-drawer-close"
              type="button"
              aria-label="Close drill-down"
              onClick={() => setDrillDrawerOpen(false)}
            >
              ✕
            </button>
          </div>
        </header>
        <div className="drilldown-drawer-body">
          <section className="panel-card" key={`patrons-${selectedTableId}`}>
            <h3 className="panel-title">Active Patrons</h3>
            <div className="patron-list">
              {(patrons?.patrons ?? []).map((patron) => (
                <div className="patron-row" key={patron.patronId}>
                  <div className="patron-head">
                    <strong>{patron.patronId}</strong>
                    <span className="small">{patron.tier}</span>
                  </div>
                  <div className="split small">
                    <span>Bet {formatAmount(patron.sessionBetAmount)}</span>
                    <span>ADT {formatAmount(patron.adt)}</span>
                    <span>Points {formatAmount(patron.pointsBalance)}</span>
                    <span>Stack {formatAmount(patron.currentStackEstimate)}</span>
                  </div>
                  <div className="patron-actions">
                    <button
                      className="button risk-review-btn"
                      type="button"
                      onClick={() => onStartRiskReview(patron.patronId).catch(() => undefined)}
                    >
                      Start Risk Review
                    </button>
                  </div>
                </div>
              ))}
              {(patrons?.patrons ?? []).length === 0 ? (
                <p className="small">No active patrons on this table.</p>
              ) : null}
            </div>
          </section>

          <section className="panel-card minbet-shell" key={`minbet-${selectedTableId}`}>
            <div className="drilldown-head minbet-head">
              <h3 className="panel-title minbet-title">Min-Bet Optimization</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="simulate-ghost-btn"
                  onClick={() => setSimulatePanelOpen((v) => !v)}
                  type="button"
                  disabled={!selectedTableId || simulateLoading}
                >
                  {simulatePanelOpen ? "Close Simulate" : "Simulate"}
                </button>
                <button
                  className="button analysis-button"
                  onClick={() => onOptimizeMinBet().catch(() => undefined)}
                  type="button"
                  disabled={!selectedTableId || minBetLoading}
                >
                  {minBetLoading ? "Optimizing..." : "Run Optimizer Agent"}
                </button>
              </div>
            </div>
            {(() => {
              const t = heatmap?.tables.find((t) => t.tableId === selectedTableId);
              if (!t) return null;
              return (
                <div className="minbet-current-banner">
                  <div className="minbet-current-banner-label">Current Min Bet</div>
                  <div className="minbet-current-banner-value">{formatAmount(t.minBet)}</div>
                  <div className="minbet-current-banner-sub">
                    <div className="minbet-current-banner-sub-item">
                      <span className="minbet-current-banner-sub-label">Occupancy</span>
                      <span className="minbet-current-banner-sub-value">
                        {Math.round(t.occupancyRate * 100)}%
                      </span>
                    </div>
                    <div className="minbet-current-banner-sub-item">
                      <span className="minbet-current-banner-sub-label">Patrons</span>
                      <span className="minbet-current-banner-sub-value">
                        {t.patronCount} / 9
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
            {simulatePanelOpen && (
              <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
                <p className="small" style={{ marginBottom: "10px", color: "var(--text-secondary)" }}>
                  Inject simulated session data to test optimizer behavior. Existing sessions and cooldown will be cleared.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                  {(
                    [
                      {
                        key: "full-high" as SimulateScenario,
                        label: "Full House — High Spender",
                        desc: "9/9 seats · all bets ≥8× floor · lowBetShare ≈ 0%",
                      },
                      {
                        key: "full-mixed" as SimulateScenario,
                        label: "Full House — Mixed",
                        desc: "9/9 seats · 2 near floor · lowBetShare ≈ 22%",
                      },
                      {
                        key: "low-sticky" as SimulateScenario,
                        label: "Low Occ — Sticky",
                        desc: "3/9 seats · high bets · demandSignal < 0.65",
                      },
                      {
                        key: "empty" as SimulateScenario,
                        label: "Empty Table",
                        desc: "0 sessions · optimizer returns HOLD",
                      },
                    ]
                  ).map(({ key, label, desc }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSimulateScenario(key)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: `1.5px solid ${simulateScenario === key ? "var(--accent, #6366f1)" : "var(--border)"}`,
                        background: simulateScenario === key ? "rgba(99,102,241,0.08)" : "transparent",
                        cursor: "pointer",
                        color: "inherit",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "12px" }}>{label}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "3px" }}>{desc}</div>
                    </button>
                  ))}
                </div>
                <button
                  className="button"
                  type="button"
                  onClick={() => onSimulateAndOptimize().catch(() => undefined)}
                  disabled={simulateLoading || !selectedTableId}
                >
                  {simulateLoading ? "Injecting & Optimizing..." : "Inject & Run Optimizer"}
                </button>
              </div>
            )}
            {minBetRecommendation ? (
                  <div className="minbet-card">
                    <div className="minbet-headline">
                      <div className="minbet-bet-block">
                        <span className="small">Current Min Bet</span>
                        <strong>{formatAmount(minBetRecommendation.currentMinBet)}</strong>
                      </div>
                      <span className="minbet-arrow">→</span>
                      <div className="minbet-bet-block">
                        <span className="small">Recommended</span>
                        <strong>{formatAmount(minBetRecommendation.recommendedMinBet)}</strong>
                      </div>
                      <span
                        className={`analysis-badge ${
                          minBetRecommendation.deltaPct > 0
                            ? "high"
                            : minBetRecommendation.deltaPct < 0
                              ? "medium"
                              : "low"
                        }`}
                      >
                        {minBetRecommendation.deltaPct >= 0 ? "+" : ""}
                        {(minBetRecommendation.deltaPct * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="analysis-metric-grid">
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>Expected Uplift</span>
                        </div>
                        <strong>
                          {minBetRecommendation.expectedRevenueUpliftPct >= 0 ? "+" : ""}
                          {(minBetRecommendation.expectedRevenueUpliftPct * 100).toFixed(1)}%
                        </strong>
                      </div>
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>Confidence</span>
                        </div>
                        <strong>{(minBetRecommendation.confidence * 100).toFixed(1)}%</strong>
                      </div>
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>Occupancy</span>
                        </div>
                        <strong>
                          {(minBetRecommendation.drivers.occupancyRate * 100).toFixed(0)}%
                          {" "}
                          ({minBetRecommendation.drivers.occupancyTrend})
                        </strong>
                      </div>
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>Bet Headroom</span>
                        </div>
                        <strong>{minBetRecommendation.drivers.betHeadroom.toFixed(2)}x</strong>
                      </div>
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>P50 / P75 / P90</span>
                        </div>
                        <strong>
                          {formatAmount(minBetRecommendation.drivers.p50Bet)} /{" "}
                          {formatAmount(minBetRecommendation.drivers.p75Bet)} /{" "}
                          {formatAmount(minBetRecommendation.drivers.p90Bet)}
                        </strong>
                      </div>
                      <div className="analysis-metric-card">
                        <div className="analysis-metric-head">
                          <span>Low-Bet Share</span>
                        </div>
                        <strong>
                          {(minBetRecommendation.drivers.lowBetShare * 100).toFixed(0)}%
                        </strong>
                      </div>
                    </div>
                    <p className="small minbet-rationale">{minBetRecommendation.rationale}</p>
                    {minBetRecommendation.reasons.length > 0 ? (
                      <ul className="minbet-reasons small">
                        {minBetRecommendation.reasons.map((reason, idx) => (
                          <li key={`reason-${idx}`}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                    {Object.keys(minBetRecommendation.drivers.tierMix).length > 0 ? (
                      <div className="offer-tag-wrap">
                        {Object.entries(minBetRecommendation.drivers.tierMix).map(([tier, count]) => (
                          <span className="offer-tag" key={`tier-${tier}`}>
                            {tier}: {count}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="composer-actions">
                      <button
                        className="button ghost-button"
                        type="button"
                        onClick={() => onRejectMinBet().catch(() => undefined)}
                        disabled={
                          minBetActionLoading ||
                          minBetRecommendation.status !== "Proposed"
                        }
                      >
                        Reject
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => onApplyMinBet().catch(() => undefined)}
                        disabled={
                          minBetActionLoading ||
                          minBetRecommendation.status !== "Proposed" ||
                          minBetRecommendation.deltaPct === 0
                        }
                      >
                        {minBetActionLoading
                          ? "Applying..."
                          : minBetRecommendation.status !== "Proposed"
                            ? minBetRecommendation.status
                            : "Approve & Apply"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="small">
                    Run the optimizer to analyze occupancy trend and bet distribution, and
                    generate a min-bet recommendation.
                  </p>
                )}
                {minBetHistory.length > 0 ? (
                  <div className="minbet-history">
                    <h4 className="small">Recent Recommendations</h4>
                    {minBetHistory.slice(0, 5).map((row) => (
                      <div className="minbet-history-row" key={row.recommendationId}>
                        <span className="small">
                          {new Date(row.createdAt).toLocaleString()}
                        </span>
                        <span className="small">
                          {formatAmount(row.currentMinBet)} → {formatAmount(row.recommendedMinBet)}
                          {" "}({row.deltaPct >= 0 ? "+" : ""}
                          {(row.deltaPct * 100).toFixed(1)}%)
                        </span>
                        <span className={`analysis-badge ${
                          row.status === "Applied"
                            ? "low"
                            : row.status === "Rejected" || row.status === "Expired"
                              ? "high"
                              : "medium"
                        }`}>
                          {row.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
          </section>

          {/* ── Simulate Round + Alert Analysis ── */}
          <section className="simulate-round-section" key={`simulate-round-${selectedTableId}`}>
            <div className="simulate-round-header">
              <span className="simulate-round-title">輪次模擬 {"&"} Alert 分析</span>
              <span className="round-counter-badge">
                Round #{roundNumbers[selectedTableId] ?? 0}
              </span>
            </div>
            <p className="simulate-round-desc">
              注入本輪確定性下注資料（含測試賭客），自動對所有 Active Alert 規則執行 MQL 分析。
              
            </p>
            <button
              className="simulate-round-btn"
              type="button"
              onClick={() => onSimulateRound().catch(() => undefined)}
              disabled={!selectedTableId || simulateRoundLoading}
            >
              {simulateRoundLoading ? "分析中..." : "▶ Simulate Round"}
            </button>
            {lastRoundResult && lastRoundResult.tableId === selectedTableId ? (
              <div className="simulate-round-result">
                {lastRoundResult.alertsTriggered.length > 0 ? (
                  <>
                    <div>
                      本輪注入 <strong>{lastRoundResult.sessionsInjected}</strong> 位賭客 ·
                      觸發 <span className="triggered-count">{lastRoundResult.alertsTriggered.length} 條 Alert</span>
                    </div>
                    <div style={{ marginTop: 5 }}>
                      {lastRoundResult.alertsTriggered.map((a) => (
                        <div key={a.alertId} style={{ fontSize: "0.75rem", color: "rgba(255,170,94,0.85)", marginTop: 3 }}>
                          · {a.ruleName}: {a.patronId} ({a.conditionTypes.join(", ")})
                        </div>
                      ))}
                    </div>
                    <button
                      className="simulate-view-dashboard-btn"
                      type="button"
                      onClick={() => setActiveSection("alert-dashboard")}
                    >
                      查看 Alert Dashboard →
                    </button>
                  </>
                ) : (
                  <div className="no-trigger">
                    本輪注入 {lastRoundResult.sessionsInjected} 位賭客 · 無 Alert 觸發
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {tableAnalysis ? (
            <section className="panel-card analysis-shell" key={`analysis-${selectedTableId}`}>
                  <div className="analysis-summary">
                    <span className="metric-chip">Analyzed {tableAnalysis.summary.totalPatrons}</span>
                    <span className="metric-chip">High Potential {tableAnalysis.summary.highPotentialCount}</span>
                    <span className="metric-chip">Medium {tableAnalysis.summary.mediumPotentialCount}</span>
                    <span className="metric-chip">
                      Avg Score {(tableAnalysis.summary.avgPotentialScore * 100).toFixed(1)}%
                    </span>
                  </div>
                  {tableAnalysis.summary.bestTargetPatronId ? (
                    <p className="small analysis-lead">
                      Best immediate target: {tableAnalysis.summary.bestTargetPatronId}
                    </p>
                  ) : (
                    <p className="small analysis-lead">No active patrons available for scoring.</p>
                  )}
                  <div className="analysis-list">
                    {tableAnalysis.rankedPatrons.slice(0, 8).map((patron) => (
                      <div className="analysis-row" key={`analysis-${patron.patronId}`}>
                        <div className="analysis-row-head">
                          <strong>{patron.patronId}</strong>
                          <span className={`analysis-badge ${patron.lossPotentialLabel.toLowerCase()}`}>
                            {patron.lossPotentialLabel}
                          </span>
                        </div>
                        <div className="analysis-bar-track">
                          <div
                            className="analysis-bar-fill"
                            style={{ width: `${Math.round(patron.lossPotentialScore * 100)}%` }}
                          />
                        </div>
                        <div className="analysis-metric-grid">
                          <div className="analysis-metric-card">
                            <div className="analysis-metric-head">
                              <span>Score</span>
                              <span className="metric-info" data-tip={metricHelpText.score} aria-label="Score info">
                                i
                              </span>
                            </div>
                            <strong>{(patron.lossPotentialScore * 100).toFixed(1)}%</strong>
                          </div>
                          <div className="analysis-metric-card">
                            <div className="analysis-metric-head">
                              <span>Confidence</span>
                              <span
                                className="metric-info"
                                data-tip={metricHelpText.confidence}
                                aria-label="Confidence info"
                              >
                                i
                              </span>
                            </div>
                            <strong>{(patron.confidence * 100).toFixed(1)}%</strong>
                          </div>
                          <div className="analysis-metric-card">
                            <div className="analysis-metric-head">
                              <span>Expected Loss</span>
                              <span
                                className="metric-info"
                                data-tip={metricHelpText.expectedLoss}
                                aria-label="Expected loss info"
                              >
                                i
                              </span>
                            </div>
                            <strong>
                              {formatAmount(patron.expectedLossRange.min)}-{formatAmount(patron.expectedLossRange.max)}
                            </strong>
                          </div>
                        </div>
                        <p className="small">{patron.recommendation}</p>
                        {patron.suggestedOffers.length > 0 ? (
                          <div className="offer-tag-wrap">
                            {patron.suggestedOffers.map((offer) => (
                              <span className="offer-tag" key={`${patron.patronId}-${offer.offerId}`}>
                                {offer.offerType} | {offer.title} ({(offer.score * 100).toFixed(1)}%)
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="small">No offer suggestion available.</p>
                        )}
                      </div>
                    ))}
                  </div>
            </section>
          ) : null}
          </div>
          </aside>
          </>
        ) : activeSection === "patron-insight" ? (
          <div className="section-grid">
            <div className="catalog-left">
              <article className="panel-card">
                <h2 className="panel-title">Quick Offer Lookup</h2>
                <p className="small">Generate top offer matches for one patron profile.</p>
                <div className="lookup-row">
                  <input
                    className="input"
                    value={generatePatronId}
                    onChange={(e) => setGeneratePatronId(e.target.value)}
                    placeholder="Patron ID (e.g. P-000001)"
                  />
                  <button className="button" onClick={onGenerateOffers}>
                    Generate
                  </button>
                </div>
                {generatedPatron ? (
                  <div className="lookup-patron-profile">
                    <div className="lookup-patron-header">
                      <span className="tier-pill">{generatedPatron.tier}</span>
                      <span className="lookup-patron-id">{generatedPatron.patronId}</span>
                    </div>
                    <div className="lookup-patron-divider" />
                    <div className="lookup-patron-row">
                      <span className="lookup-patron-label">ADT</span>
                      <div className="lookup-patron-chips">
                        <span className="patron-stat-chip">{formatAmount(generatedPatron.adt)}</span>
                      </div>
                    </div>
                    {generatedPatron.pointsBalance !== undefined ? (
                      <div className="lookup-patron-row">
                        <span className="lookup-patron-label">Points</span>
                        <div className="lookup-patron-chips">
                          <span className="patron-stat-chip">{formatAmount(generatedPatron.pointsBalance)}</span>
                        </div>
                      </div>
                    ) : null}
                    {(generatedPatron.preferredGames ?? []).length > 0 ? (
                      <div className="lookup-patron-row">
                        <span className="lookup-patron-label">Games</span>
                        <div className="lookup-patron-chips">
                          {(generatedPatron.preferredGames ?? []).map((g) => (
                            <span className="patron-game-chip" key={`pg-${g}`}>{g}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {(generatedPatron.behaviorTags ?? []).length > 0 ? (
                      <div className="lookup-patron-row">
                        <span className="lookup-patron-label">Behavior</span>
                        <div className="lookup-patron-chips">
                          {(generatedPatron.behaviorTags ?? []).map((t) => (
                            <span className="patron-behavior-chip" key={`bt-${t}`}>{t}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {generatedOffers.length > 0 ? (
                  <div className="generated-offer-grid">
                    {generatedOffers.map((item) => {
                      const typeClass = `type-${item.offerType.toLowerCase()}`;
                      const pct = Math.max(0, Math.min(100, Math.round(item.score * 100)));
                      const tone = item.score >= 0.7 ? "high" : item.score >= 0.45 ? "med" : "low";
                      const tip = item.breakdown
                        ? `Atlas raw: ${(item.breakdown.atlasScore * 100).toFixed(0)}%\n` +
                          `Vector contribution: ${(item.breakdown.vectorPart * 100).toFixed(0)}%\n` +
                          `Rule contribution:   ${(item.breakdown.rulePart * 100).toFixed(0)}%\n` +
                          `Blended (0.6 vec + 0.4 rule): ${pct}%`
                        : "";
                      return (
                        <div className="generated-offer-card" key={`${item.offerId}-${item.title}`}>
                          <div className="offer-card-head">
                            <span className={`type-chip ${typeClass}`}>{item.offerType}</span>
                            <div className="score-wrap">
                              <strong className="score-value">{pct}%</strong>
                              {item.breakdown ? (
                                <span
                                  className="score-info"
                                  data-tip={tip}
                                  aria-label="Score breakdown"
                                >
                                  i
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="offer-card-title">{item.title}</div>
                          <div className={`score-bar score-bar-${tone}`}>
                            <div style={{ width: `${pct}%` }} />
                          </div>
                          {item.reason ? <p className="small reason-text">{item.reason}</p> : null}
                          {item.matchSignals && item.matchSignals.length > 0 ? (
                            <div className="signals">
                              {item.matchSignals.map((s) => (
                                <span className="signal-chip" key={`${item.offerId}-${s}`}>
                                  {s}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            </div>
          </div>
        ) : activeSection === "offer-catalog" ? (
          <div className="section-grid">
            <div className="catalog-left">
              <article className="panel-card">
                <div className="catalog-head">
                  <h2 className="panel-title">Offer Catalog</h2>
                  <div className="metric-row">
                    <span className="metric-chip">Total {offerDashboard?.summary.offerCount ?? "-"}</span>
                    <span className="metric-chip">Active {activeOfferCount}</span>
                    <span className="metric-chip">Recs {offerDashboard?.summary.recommendationCount ?? "-"}</span>
                  </div>
                </div>
                <div className="offer-status-filter">
                  {(["All", "Proposed", "Active", "Draft", "Rejected", "Expired"] as const).map((status) => {
                    const count = offerStatusCounts[status] ?? 0;
                    const active = offerStatusFilter === status;
                    return (
                      <button
                        type="button"
                        key={status}
                        className={`offer-status-chip status-chip-${status.toLowerCase()} ${active ? "active" : ""}`}
                        onClick={() => setOfferStatusFilter(status)}
                      >
                        {status}
                        {count > 0 ? <span className="status-chip-count">{count}</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="offer-grid">
                  {filteredOffers.map((offer) => {
                    const typeClass = `type-${offer.offerType.toLowerCase()}`;
                    const statusClass = offer.status.toLowerCase();
                    const isProposed = offer.status === "Proposed";
                    const isAi = offer.createdBy === "AIAgent";
                    const actionBusy = offerActionLoading === offer.offerId;
                    return (
                      <div
                        className={`offer-card ${isProposed ? "is-proposed" : ""}`}
                        key={offer.offerId}
                      >
                        <div className="offer-card-head">
                          <span className="offer-card-title">{offer.title}</span>
                          <span className={`status-pill status-${statusClass}`}>{offer.status}</span>
                        </div>
                        <div className="offer-card-chips">
                          <span className={`type-chip ${typeClass}`}>{offer.offerType}</span>
                          {isAi ? (
                            <span className="offer-card-source" title="Created by AI Agent">
                              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  fill="currentColor"
                                  d="M12 2a2 2 0 0 1 2 2v1h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V4a2 2 0 0 1 2-2zm-3 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
                                />
                              </svg>
                              AI Agent
                            </span>
                          ) : null}
                        </div>
                        <div className="offer-card-meta">
                          <span className="small">Cost</span>
                          <strong>HK$ {formatAmount(offer.estimatedCost)}</strong>
                        </div>
                        {isProposed ? (
                          <div className="offer-card-actions">
                            <button
                              type="button"
                              className="offer-action-btn offer-action-approve"
                              onClick={() => onApproveOffer(offer.offerId).catch(() => undefined)}
                              disabled={actionBusy}
                            >
                              {actionBusy ? "..." : "✓ Approve"}
                            </button>
                            <button
                              type="button"
                              className="offer-action-btn offer-action-reject"
                              onClick={() => openRejectModal(offer.offerId, offer.title)}
                              disabled={actionBusy}
                            >
                              ✗ Reject
                            </button>
                          </div>
                        ) : offer.approvalReview ? (
                          <div className="small offer-card-review">
                            {offer.approvalReview.decision === "Reject"
                              ? `Rejected: ${offer.approvalReview.rationale ?? ""}`
                              : `Approved by ${offer.approvalReview.actorId}`}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {filteredOffers.length === 0 ? (
                    <p className="small">No offers match the {offerStatusFilter} filter.</p>
                  ) : null}
                </div>
              </article>

              <article className="panel-card">
                <div className="catalog-head">
                  <h2 className="panel-title">Active Recommendations</h2>
                  <select
                    className="input reco-filter"
                    value={recoStatusFilter}
                    onChange={(e) => setRecoStatusFilter(e.target.value)}
                  >
                    <option value="All">All Statuses</option>
                    <option value="Proposed">Proposed</option>
                    <option value="Approved">Approved</option>
                    <option value="Sent">Sent</option>
                    <option value="Accepted">Accepted</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                {filteredRecommendations.length === 0 ? (
                  <p className="small">No recommendations match the current filter.</p>
                ) : (
                  <div className="recommendation-grid">
                    {filteredRecommendations.map((rec) => {
                      const statusClass = rec.status.toLowerCase();
                      const scorePct = Math.round(rec.relevanceScore * 100);
                      const confPct = Math.round(rec.confidence * 100);
                      const scoreTone =
                        rec.relevanceScore >= 0.75 ? "high" : rec.relevanceScore >= 0.5 ? "med" : "low";
                      return (
                        <div className="reco-card" key={rec.recommendationId}>
                          <div className="offer-card-head">
                            <div className="reco-link">
                              <span className="reco-patron">{rec.patronId}</span>
                              <span className="reco-arrow"> → </span>
                              <span className="reco-offer">{rec.offerId}</span>
                            </div>
                            <span className={`status-pill status-${statusClass}`}>{rec.status}</span>
                          </div>
                          {rec.reasonSummary ? (
                            <p className="reco-reason">
                              <strong>Reason:</strong> {rec.reasonSummary}
                            </p>
                          ) : null}
                          {rec.nextBestAction ? (
                            <p className="reco-action">
                              <strong>Next:</strong> {rec.nextBestAction}
                            </p>
                          ) : null}
                          <div className="reco-bars">
                            <div className="reco-bar-block">
                              <div className="reco-bar-head">
                                <span className="small">Score</span>
                                <strong>{scorePct}%</strong>
                              </div>
                              <div className={`score-bar score-bar-${scoreTone}`}>
                                <div style={{ width: `${scorePct}%` }} />
                              </div>
                            </div>
                            <div className="reco-bar-block">
                              <div className="reco-bar-head">
                                <span className="small">Confidence</span>
                                <strong>{confPct}%</strong>
                              </div>
                              <div className="priority-bar">
                                <div style={{ width: `${confPct}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            </div>

            <section className="agent-column">
              <article className="agent-shell">
            <div className="agent-topbar">
              <div>
                <h2 className="panel-title">Offer Agent</h2>
                <p className="small">
                  Describe campaign goals and patron criteria. The agent creates draft offers and reports
                  match volume instantly.
                </p>
              </div>
              <div className="status-badge">{agentLoading ? "Processing..." : "LangGraph Online"}</div>
            </div>
            <div className="suggestion-row">
              {promptTemplates.map((prompt) => (
                <button
                  key={prompt}
                  className="suggestion-chip"
                  onClick={() => setAgentInput(prompt)}
                  type="button"
                >
                  Use Template
                </button>
              ))}
            </div>
            <div className="chat-canvas">
              {agentMessages.map((msg, index) => (
                <div
                  key={`${msg.role}-${index}`}
                  className={`chat-bubble ${msg.role === "assistant" ? "assistant-bubble" : "user-bubble"}`}
                >
                  {msg.content}
                </div>
              ))}
            </div>
            <div className="composer">
              <textarea
                className="agent-textarea"
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                placeholder="Example: Create a music show offer for Diamond and Platinum patrons with ADT >= 12000 and table bet activity within 14 days."
                rows={4}
              />
              <div className="composer-actions">
                <button className="button ghost-button" onClick={() => setAgentInput("")} type="button">
                  Clear
                </button>
                <button
                  className="button"
                  onClick={() => onSubmitAgentPrompt().catch(() => undefined)}
                  type="button"
                >
                  {agentLoading ? "Working..." : "Send To Agent"}
                </button>
              </div>
            </div>
            {agentQuestions.length > 0 ? (
              <div className="guidance-panel">
                <h3>Guided Questions</h3>
                <div className="guidance-list">
                  {agentQuestions.map((q) => (
                    <button
                      key={q.id}
                      className="guidance-card"
                      type="button"
                      onClick={() =>
                        setAgentInput(
                          `Create a ${q.example}. Target segment: ${q.example}. Criteria: `
                        )
                      }
                    >
                      <strong>{q.question}</strong>
                      <span>{q.example}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {agentStats ? (
              <div className="impact-panel">
                <div className="impact-head">
                  <h3>Offer Impact Graph</h3>
                  <span>{Math.round(agentStats.matchRate * 100)}% match rate</span>
                </div>
                <div className="impact-grid">
                  <div className="donut-wrap">
                    <div
                      className="donut"
                      style={
                        {
                          "--pct": `${Math.max(0, Math.min(100, Math.round(agentStats.matchRate * 100)))}%`,
                        } as CSSProperties
                      }
                    >
                      <div className="donut-inner">
                        <strong>{agentStats.matchedPatrons}</strong>
                        <span>Matched Patrons</span>
                      </div>
                    </div>
                    <p className="small">Total patrons: {agentStats.totalPatrons}</p>
                  </div>
                  <div className="bars-wrap">
                    <h4>Tier Distribution</h4>
                    {agentStats.tierBreakdown.map((row) => {
                      const max = agentStats.tierBreakdown[0]?.value || 1;
                      const width = Math.round((row.value / max) * 100);
                      return (
                        <div className="bar-row" key={`tier-${row.label}`}>
                          <span>{row.label}</span>
                          <div className="bar-track">
                            <div className="bar-fill tier" style={{ width: `${width}%` }} />
                          </div>
                          <em>{row.value}</em>
                        </div>
                      );
                    })}
                    <h4>Game Preference</h4>
                    {agentStats.gameBreakdown.map((row) => {
                      const max = agentStats.gameBreakdown[0]?.value || 1;
                      const width = Math.round((row.value / max) * 100);
                      return (
                        <div className="bar-row" key={`game-${row.label}`}>
                          <span>{row.label}</span>
                          <div className="bar-track">
                            <div className="bar-fill game" style={{ width: `${width}%` }} />
                          </div>
                          <em>{row.value}</em>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {sampleMatchedPatrons.length > 0 ? (
                  <div className="impact-samples">
                    <h4>Sample Matched Patrons</h4>
                    <div className="impact-sample-list">
                      {sampleMatchedPatrons.map((p) => {
                        const tierKey = (p.tier || "Bronze").toLowerCase();
                        const copied = copiedPatronId === p.patronId;
                        return (
                          <button
                            type="button"
                            key={p.patronId}
                            className={`impact-sample-card ${copied ? "is-copied" : ""}`}
                            onClick={() => onCopyPatronId(p.patronId)}
                            title={copied ? "Copied!" : "Click to copy patron ID"}
                          >
                            <div className="impact-sample-head">
                              <div
                                className="impact-sample-avatar"
                                style={{ background: avatarGradient(p.patronId) }}
                                aria-hidden="true"
                              >
                                {getInitials(p.maskedName || p.patronId)}
                              </div>
                              <div className="impact-sample-identity">
                                <strong>{p.maskedName || p.patronId}</strong>
                                <span className="mono-pill">{p.patronId}</span>
                              </div>
                              <span className={`tier-chip tier-chip-${tierKey}`}>
                                {p.tier}
                              </span>
                            </div>
                            <div className="impact-sample-meta">
                              <span className="muted-chip">
                                ADT {formatAmount(p.adt)}
                              </span>
                              <span className="muted-chip">
                                Points {formatAmount(p.pointsBalance)}
                              </span>
                            </div>
                            {p.preferredGames && p.preferredGames.length > 0 ? (
                              <div className="impact-sample-games">
                                {p.preferredGames.map((g) => (
                                  <span
                                    className="pr-chip pr-chip-game"
                                    key={`${p.patronId}-${g}`}
                                  >
                                    {g}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {copied ? (
                              <span className="impact-sample-copied">Copied!</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="impact-foot">
                  <span className="metric-chip">Avg ADT {formatAmount(agentStats.avgMatchedAdt)}</span>
                  <span className="metric-chip">Matched {formatAmount(agentStats.matchedPatrons)}</span>
                </div>
              </div>
            ) : null}
              </article>
            </section>
          </div>
        ) : null}
        {activeSection === "alert-dashboard" ? (
          <div className="section-stack">
            {/* ── NL Rule Definition ── */}
            <article className="panel-card">
              <div className="alert-dashboard-header">
                <div className="alert-dashboard-title">
                  <span className="alert-dashboard-title-dot" />
                  Alert Rules
                </div>
              </div>

              {/* NL input */}
              <div className="nl-input-section">
                <div className="nl-input-label">用自然語言定義高價值賭客條件</div>
                <textarea
                  className="nl-textarea"
                  rows={3}
                  placeholder="例如：找到連續下注3輪每輪超過20000港幣的賭客；或：找單輪下注超過個人ADT 5倍的激進賭客"
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                />
                <button
                  className="nl-parse-btn"
                  type="button"
                  onClick={() => onParseRule().catch(() => undefined)}
                  disabled={!nlInput.trim() || nlParsing}
                >
                  {nlParsing ? "AI 解析中..." : "AI 解析並預覽 →"}
                </button>
                {nlParsing ? (
                  <div className="nl-parsing-indicator">
                    <span>正在調用 AI 識別條件類型與提取參數...</span>
                  </div>
                ) : null}
                {rulePreviewError ? (
                  <div className="nl-error-msg">{rulePreviewError}</div>
                ) : null}
              </div>

              {/* Preview card */}
              {rulePreview ? (
                rulePreview.needsClarification ? (
                  <div className="rule-preview-clarification">
                    <span>⚠</span>
                    <span>{rulePreview.clarificationQuestion ?? "請提供更具體的描述。"}</span>
                  </div>
                ) : (
                  <div className="rule-preview-card">
                    <div className="rule-preview-title">AI 解析結果</div>
                    <div className="rule-preview-name">{rulePreview.ruleName}</div>
                    {rulePreview.conditions.map((cond, idx) => (
                      <div className="rule-preview-condition" key={`prev-cond-${idx}`}>
                        <div className="rule-preview-condition-type">
                          {cond.type.replace(/_/g, " ").toLowerCase()}
                        </div>
                        <div className="rule-preview-condition-params">
                          <strong>{renderConditionLabel(cond.type, cond.params)}</strong>
                          <div className="rule-confidence-bar-wrap">
                            <div className="rule-confidence-bar">
                              <div
                                className="rule-confidence-bar-fill"
                                style={{ width: `${Math.round(cond.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="rule-confidence-label">
                              信心 {Math.round(cond.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="rule-preview-actions">
                      <button
                        className="rule-confirm-btn"
                        type="button"
                        onClick={() => onConfirmRule().catch(() => undefined)}
                        disabled={ruleConfirming}
                      >
                        {ruleConfirming ? "創建中..." : "確認創建規則"}
                      </button>
                      <button
                        className="rule-reset-btn"
                        type="button"
                        onClick={() => { setRulePreview(null); setNlInput(""); setRulePreviewError(""); }}
                      >
                        重新輸入
                      </button>
                    </div>
                  </div>
                )
              ) : null}

              {/* Template cards — shown if no user-created rules */}
              {alertRules.filter((r) => !r.ruleId.startsWith("RULE-SEED")).length === 0 && !rulePreview ? (
                <div style={{ marginTop: 16 }}>
                  <div className="nl-input-label" style={{ marginBottom: 10 }}>建議規則模板（點擊即可使用）</div>
                  {alertRulesLoading ? (
                    <p className="small">載入模板中...</p>
                  ) : (
                    alertRules.filter((r) => r.ruleId.startsWith("RULE-SEED")).map((t) => (
                      <div className="alert-template-card" key={t.ruleId}
                        onClick={() => setNlInput(t.nlDescription)}>
                        <div className="alert-template-name">{t.name}</div>
                        <div className="alert-template-nl">"{t.nlDescription}"</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                          {t.conditions.map((c, ci) => (
                            <span className="alert-rule-condition-pill" key={`tc-${ci}`}>
                              {renderConditionLabel(c.type, c.params)}
                            </span>
                          ))}
                        </div>
                        <button className="alert-template-use-btn" type="button"
                          onClick={(e) => { e.stopPropagation(); setNlInput(t.nlDescription); }}>
                          使用此模板
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </article>

            {/* ── Active Rules List ── */}
            <article className="panel-card">
              <h2 className="panel-title" style={{ marginBottom: 14 }}>Active Rules</h2>
              {alertRulesLoading ? (
                <p className="small">載入規則...</p>
              ) : alertRules.length === 0 ? (
                <p className="small">尚無 Alert 規則。請用上方輸入框創建第一條規則。</p>
              ) : (
                alertRules.map((rule) => (
                  <div className="alert-rule-row" key={rule.ruleId}>
                    <div className="alert-rule-row-header">
                      <span className="alert-rule-id">{rule.ruleId}</span>
                      <span className="alert-rule-name">{rule.name}</span>
                      <span className={`alert-rule-status-badge ${rule.status === "Active" ? "active" : "paused"}`}>
                        {rule.status}
                      </span>
                      <button
                        className={`alert-rule-toggle-btn ${rule.status === "Active" ? "pause" : "resume"}`}
                        type="button"
                        onClick={() => onToggleRuleStatus(rule.ruleId, rule.status).catch(() => undefined)}
                      >
                        {rule.status === "Active" ? "Pause" : "Resume"}
                      </button>
                    </div>
                    <div className="alert-rule-nl">"{rule.nlDescription}"</div>
                    <div className="alert-rule-conditions-row">
                      {rule.conditions.map((c, ci) => (
                        <span className="alert-rule-condition-pill" key={`rc-${ci}`}>
                          {renderConditionLabel(c.type, c.params)}
                        </span>
                      ))}
                    </div>
                    <div className="alert-rule-stats">
                      觸發次數：<span>{rule.totalTriggered}</span>
                      {rule.lastTriggeredAt ? (
                        <> · 最後觸發：<span>{new Date(rule.lastTriggeredAt).toLocaleString("zh-HK")}</span></>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </article>

            {/* ── Alert Feed ── */}
            <article className="panel-card">
              <div className="alert-dashboard-header">
                <div className="alert-dashboard-title">
                  <span className="alert-dashboard-title-dot" />
                  Alert Feed
                </div>
              </div>
              {alertStats ? (
                <div className="alert-stats-grid">
                  <div className="alert-stat-cell">
                    <span className="alert-stat-cell-value total">{alertStats.total}</span>
                    <span className="alert-stat-cell-label">Total</span>
                  </div>
                  <div className="alert-stat-cell">
                    <span className="alert-stat-cell-value new">{alertStats.newCount}</span>
                    <span className="alert-stat-cell-label">New</span>
                  </div>
                  {Object.entries(alertStats.byRule).map(([ruleName, count]) => (
                    <div className="alert-stat-cell" key={`stat-${ruleName}`}>
                      <span className="alert-stat-cell-value rule">{count}</span>
                      <span className="alert-stat-cell-label">{ruleName}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {alertsLoading ? (
                <p className="small">載入 Alerts...</p>
              ) : alerts.length === 0 ? (
                <div className="alert-empty-state">
                  尚無 Alert。請在任一 Table 的 Drill-down 中點擊「Simulate Round」以觸發分析。
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    className={`alert-feed-card ${alert.status === "Acknowledged" ? "acknowledged" : ""}`}
                    key={alert.alertId}
                  >
                    {/* ── Header row ── */}
                    <div className="alert-card-header">
                      {alert.status === "New" ? (
                        <span className="alert-new-badge">NEW</span>
                      ) : null}
                      <span className="alert-patron-name">{alert.patronSnapshot.maskedName}</span>
                      <span className="tier-pill" style={{ fontSize: "0.70rem" }}>
                        {alert.patronSnapshot.tier}
                      </span>
                      <span className="alert-table-info">
                        {alert.tableSnapshot.tableName} · {alert.tableSnapshot.gameType} · {alert.tableSnapshot.zone}
                      </span>
                      <div className="alert-card-actions">
                        <button
                          className={`alert-analyze-btn ${expandedAnalysis[alert.alertId] ? "active" : ""}`}
                          title="用 AI 分析此賭客的歷史行為並給出銷售建議"
                          onClick={() => handleAnalyzePatron(alert.alertId)}
                          disabled={analyzingAlertId === alert.alertId}
                        >
                          {analyzingAlertId === alert.alertId ? "分析中…" : expandedAnalysis[alert.alertId] ? "收起分析" : "分析賭客"}
                        </button>
                        <button
                          className={`alert-add-interaction-btn ${interactionFormAlertId === alert.alertId ? "active" : ""}`}
                          title="記錄與此賭客的互動（送房、comp、電話等）"
                          onClick={() =>
                            setInteractionFormAlertId((prev) =>
                              prev === alert.alertId ? null : alert.alertId
                            )
                          }
                        >
                          {interactionFormAlertId === alert.alertId ? "收起" : "+ 記錄互動"}
                        </button>
                        <button
                          className="alert-resolve-btn"
                          title="Resolve — 清除此賭客所有 Alert 記錄，下次可重新觸發"
                          onClick={() => handleResolveAlert(alert.alertId, alert.patronId)}
                        >
                          Resolve
                        </button>
                      </div>
                    </div>

                    {/* ── Condition tags ── */}
                    <div style={{ marginBottom: 6 }}>
                      <span className="alert-rule-tag">{alert.ruleName}</span>
                      {alert.triggeredConditions.map((tc, tci) => (
                        <span className="alert-condition-chip" key={`tc-${tci}`}>
                          {renderConditionLabel(tc.type, {})}
                        </span>
                      ))}
                    </div>

                    {/* ── Evidence rows ── */}
                    {alert.triggeredConditions.map((tc, tci) => (
                      <div className="alert-evidence-row" key={`ev-${tci}`}>
                        {tc.type === "CONSECUTIVE_ROUNDS_BET_THRESHOLD" &&
                          Array.isArray((tc.evidence as Record<string, unknown>).bets) ? (
                          ((tc.evidence as Record<string, unknown>).bets as Array<{ round: number; amount: number }>).map((b, bi, arr) => (
                            <span key={`b-${bi}`}>
                              <span className="alert-bet-badge">HKD {b.amount.toLocaleString()}</span>
                              {bi < arr.length - 1 ? <span className="alert-evidence-arrow"> → </span> : null}
                            </span>
                          ))
                        ) : (
                          <span className="alert-bet-badge">{formatAlertEvidence(tc.type, tc.evidence as Record<string, unknown>)}</span>
                        )}
                      </div>
                    ))}

                    {/* ── Meta row ── */}
                    <div className="alert-meta-row">
                      <span><span className="alert-meta-label">ADT</span>HKD {alert.patronSnapshot.adt.toLocaleString()}</span>
                      {alert.patronSnapshot.behaviorTags.length > 0 ? (
                        <span><span className="alert-meta-label">Tags</span>{alert.patronSnapshot.behaviorTags.join(", ")}</span>
                      ) : null}
                      {alert.patronSnapshot.riskFlags.filter((f) => f !== "None").length > 0 ? (
                        <span><span className="alert-meta-label">Risk</span>{alert.patronSnapshot.riskFlags.filter((f) => f !== "None").join(", ")}</span>
                      ) : null}
                      <span><span className="alert-meta-label">Games</span>{alert.patronSnapshot.preferredGames.join(", ") || "—"}</span>
                    </div>

                    {/* ── LLM rationale ── */}
                    {alert.llmRationale ? (
                      <div className="alert-rationale">{alert.llmRationale}</div>
                    ) : null}

                    <div className="alert-timestamp">
                      {new Date(alert.triggeredAt).toLocaleString("zh-HK")} · {alert.tableId}
                    </div>

                    {/* ── Interaction Form Panel ── */}
                    {interactionFormAlertId === alert.alertId ? (
                      <div className="interaction-form-panel">
                        <div className="interaction-form-title">記錄互動</div>
                        <div className="interaction-form-row">
                          <label className="interaction-form-label">互動類型</label>
                          <select
                            className="interaction-form-select"
                            value={interactionForm.type}
                            onChange={(e) =>
                              setInteractionForm((f) => ({ ...f, type: e.target.value as InteractionType }))
                            }
                          >
                            {(Object.keys(INTERACTION_TYPE_LABELS) as InteractionType[]).map((t) => (
                              <option key={t} value={t}>{INTERACTION_TYPE_LABELS[t]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="interaction-form-row">
                          <label className="interaction-form-label">優惠總值 (HKD)</label>
                          <input
                            className="interaction-form-input"
                            type="number"
                            min="0"
                            value={interactionForm.totalValueHKD}
                            onChange={(e) => setInteractionForm((f) => ({ ...f, totalValueHKD: e.target.value }))}
                          />
                        </div>
                        <div className="interaction-form-row">
                          <label className="interaction-form-label">發生日期</label>
                          <input
                            className="interaction-form-input"
                            type="date"
                            value={interactionForm.occurredAt}
                            onChange={(e) => setInteractionForm((f) => ({ ...f, occurredAt: e.target.value }))}
                          />
                        </div>

                        {/* Type-specific fields */}
                        {interactionForm.type === "ROOM_COMP" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">房型</label>
                            <input
                              className="interaction-form-input"
                              type="text"
                              placeholder="e.g. Superior Suite"
                              value={interactionForm.roomType}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, roomType: e.target.value }))}
                            />
                          </div>
                        )}
                        {interactionForm.type === "ROOM_COMP" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">晚數</label>
                            <input
                              className="interaction-form-input"
                              type="number"
                              min="1"
                              value={interactionForm.roomNights}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, roomNights: e.target.value }))}
                            />
                          </div>
                        )}
                        {interactionForm.type === "FB_COMP" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">餐廳名稱</label>
                            <input
                              className="interaction-form-input"
                              type="text"
                              value={interactionForm.venue}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, venue: e.target.value }))}
                            />
                          </div>
                        )}
                        {interactionForm.type === "REBATE" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">回贈率 (%)</label>
                            <input
                              className="interaction-form-input"
                              type="number"
                              step="0.1"
                              min="0"
                              value={interactionForm.rebateRate}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, rebateRate: e.target.value }))}
                            />
                          </div>
                        )}
                        {interactionForm.type === "EVENT_INVITE" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">活動名稱</label>
                            <input
                              className="interaction-form-input"
                              type="text"
                              value={interactionForm.eventName}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, eventName: e.target.value }))}
                            />
                          </div>
                        )}
                        {interactionForm.type === "OUTREACH" && (
                          <>
                            <div className="interaction-form-row">
                              <label className="interaction-form-label">聯繫渠道</label>
                              <select
                                className="interaction-form-select"
                                value={interactionForm.channel}
                                onChange={(e) => setInteractionForm((f) => ({ ...f, channel: e.target.value }))}
                              >
                                {["Phone", "In-Person", "WeChat", "WhatsApp"].map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </div>
                            <div className="interaction-form-row">
                              <label className="interaction-form-label">回應結果</label>
                              <select
                                className="interaction-form-select"
                                value={interactionForm.outcome}
                                onChange={(e) => setInteractionForm((f) => ({ ...f, outcome: e.target.value }))}
                              >
                                {["Positive", "Neutral", "No Answer", "Declined"].map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                        {interactionForm.type === "TRANSFER" && (
                          <div className="interaction-form-row">
                            <label className="interaction-form-label">接送類型</label>
                            <select
                              className="interaction-form-select"
                              value={interactionForm.transferType}
                              onChange={(e) => setInteractionForm((f) => ({ ...f, transferType: e.target.value }))}
                            >
                              {["Airport", "Hotel", "Venue"].map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="interaction-form-row">
                          <label className="interaction-form-label">備注</label>
                          <textarea
                            className="interaction-form-textarea"
                            rows={2}
                            placeholder="備注（選填）"
                            value={interactionForm.notes}
                            onChange={(e) => setInteractionForm((f) => ({ ...f, notes: e.target.value }))}
                          />
                        </div>
                        <div className="interaction-form-footer">
                          <button
                            className="interaction-form-submit"
                            disabled={interactionSubmitting}
                            onClick={() => handleSubmitInteraction(alert.patronId, alert.alertId)}
                          >
                            {interactionSubmitting ? "提交中…" : "提交記錄"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* ── Analysis Report Panel ── */}
                    {expandedAnalysis[alert.alertId] ? (() => {
                      const rpt = expandedAnalysis[alert.alertId];
                      return (
                        <div className="patron-analysis-panel">
                          <div className="patron-analysis-section">
                            <div className="patron-analysis-section-title">個人 Profile</div>
                            <div className="patron-analysis-text">{rpt.profileSummary}</div>
                          </div>
                          <div className="patron-analysis-section">
                            <div className="patron-analysis-section-title">歷史互動摘要</div>
                            <div className="patron-analysis-text" style={{ whiteSpace: "pre-line" }}>{rpt.interactionHistory}</div>
                          </div>
                          <div className="patron-analysis-section">
                            <div className="patron-analysis-section-title">行為規律</div>
                            <div className="patron-analysis-text">{rpt.behaviorPattern}</div>
                          </div>
                          <div className="patron-analysis-section">
                            <div className="patron-analysis-section-title">機會 / 風險評估</div>
                            <div className="patron-analysis-text">{rpt.riskAssessment}</div>
                          </div>
                          <div className="patron-analysis-section">
                            <div className="patron-analysis-section-title">下一步銷售建議</div>
                            <div className="patron-recommendation-list">
                              {rpt.recommendations.map((rec, ri) => (
                                <div className="patron-recommendation-item" key={`rec-${ri}`}>
                                  <div className="patron-recommendation-header">
                                    <span className="patron-rec-priority">P{rec.priority}</span>
                                    <span className="patron-rec-urgency urgency-{rec.urgency.toLowerCase()}">
                                      {rec.urgency === "Immediate" ? "立即" : rec.urgency === "Within48h" ? "48小時內" : "本週"}
                                    </span>
                                    <span className="patron-rec-title">{rec.title}</span>
                                    {rec.estimatedValue ? (
                                      <span className="patron-rec-value">~HKD {rec.estimatedValue.toLocaleString()}</span>
                                    ) : null}
                                  </div>
                                  <div className="patron-rec-rationale">{rec.rationale}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {rpt.suggestedPrName ? (
                            <div className="patron-analysis-section">
                              <div className="patron-analysis-section-title">建議公關</div>
                              <div className="patron-analysis-pr-row">
                                <span className="patron-analysis-pr-name">{rpt.suggestedPrName}</span>
                                {rpt.suggestedPrId ? (
                                  <span className="patron-analysis-pr-id">{rpt.suggestedPrId}</span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <div className="patron-analysis-footer">
                            <span>分析報告 · {new Date(rpt.generatedAt).toLocaleString("zh-HK")} · {rpt.modelUsed}</span>
                            <a
                              href={`/patron-detail/${alert.patronId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="patron-detail-link"
                            >
                              查看完整 Patron Detail →
                            </a>
                          </div>
                        </div>
                      );
                    })() : null}
                  </div>
                ))
              )}
            </article>
          </div>
        ) : null}
      </section>
      {riskCaseModalOpen ? (
        <div className="risk-modal-overlay" onClick={() => setRiskCaseModalOpen(false)} role="presentation">
          <div className="risk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="risk-modal-head">
              <div className="risk-modal-head-left">
                <h3>Patron Risk Workflow</h3>
                <div className="risk-modal-head-chips">
                  <span className="mono-pill">{riskCasePatronId || riskCase?.patronId || "—"}</span>
                  <span className="mono-pill">{riskCase?.caseId ?? "Initializing..."}</span>
                </div>
              </div>
              {riskCase ? (
                <span
                  className={`risk-badge-big risk-${normalizeRiskTone(riskCase.riskLevel)}`}
                  aria-label={`Risk level ${riskCase.riskLevel}`}
                >
                  {riskCase.riskLevel.toUpperCase()} RISK
                </span>
              ) : null}
              <button
                className="drilldown-drawer-close"
                onClick={() => setRiskCaseModalOpen(false)}
                type="button"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {riskCaseLoading ? <p className="small">Loading workflow...</p> : null}
            {riskCase ? (
              <div className="risk-modal-body">
                {(() => {
                  const overallTone = normalizeRiskTone(riskCase.riskLevel);
                  const lossTone = normalizeRiskTone(riskCase.lossChasingAssessment.label);
                  const amlTone = normalizeRiskTone(riskCase.financialAssessment.sourceOfFundsRisk);
                  return (
                    <>
                <div className="risk-chip-row">
                  <span className={`gradient-pill gradient-pill-status`}>Status: {riskCase.status}</span>
                  <span
                    className={`gradient-pill gradient-pill-escalation ${
                      riskCase.escalationTier === "Senior" ? "is-senior" : ""
                    }`}
                  >
                    Escalation: {riskCase.escalationTier}
                  </span>
                  <span className={`gradient-pill gradient-pill-risk risk-${overallTone}`}>
                    {riskCase.riskLevel} Risk
                  </span>
                </div>

                <div className="risk-cards-grid">
                  <div className={`analysis-metric-card risk-score-card risk-${lossTone}`}>
                    <div className="analysis-metric-head">
                      <span>Loss Chasing Agent</span>
                    </div>
                    <strong>{(riskCase.lossChasingAssessment.score * 100).toFixed(1)}%</strong>
                    <p className="small risk-score-label">Label {riskCase.lossChasingAssessment.label}</p>
                    <p className="small">{riskCase.lossChasingAssessment.explanation}</p>
                    <p className="small">Confidence {(riskCase.lossChasingAssessment.confidence * 100).toFixed(1)}%</p>
                  </div>
                  <div className={`analysis-metric-card risk-score-card risk-${amlTone}`}>
                    <div className="analysis-metric-head">
                      <span>Financial / AML Agent</span>
                    </div>
                    <strong>{(riskCase.financialAssessment.amlRiskScore * 100).toFixed(1)}%</strong>
                    <p className="small risk-score-label">
                      Source Risk {riskCase.financialAssessment.sourceOfFundsRisk}
                    </p>
                    <p className="small">
                      Credit {riskCase.financialAssessment.creditBand} | SoF Risk{" "}
                      {riskCase.financialAssessment.sourceOfFundsRisk}
                    </p>
                    <p className="small">{riskCase.financialAssessment.analystNotes}</p>
                  </div>
                </div>

                <div className="risk-agent-graph-grid">
                  <div className="risk-agent-graph-card">
                    <h4>Loss Chasing Agent Graph</h4>
                    <div className="risk-agent-steps">
                      {buildLossAgentSteps(riskCase).map((step, idx, arr) => (
                        <div className="risk-agent-step" key={step.id}>
                          <div className={`risk-agent-node ${step.status.toLowerCase()}`}>
                            <span>{idx + 1}</span>
                          </div>
                          <div className="risk-agent-step-body">
                            <div className="risk-agent-step-head">
                              <strong>{step.title}</strong>
                              <span className={`analysis-badge risk-level-chip ${step.status === "Completed" ? "risk-low" : step.status === "Running" ? "risk-medium" : "risk-high"}`}>
                                {step.status}
                              </span>
                            </div>
                            <p className="small">{step.detail}</p>
                          </div>
                          {idx < arr.length - 1 ? <div className="risk-agent-connector" /> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="risk-agent-graph-card">
                    <h4>Financial / AML Agent Graph</h4>
                    <div className="risk-agent-steps">
                      {buildAmlAgentSteps(riskCase).map((step, idx, arr) => (
                        <div className="risk-agent-step" key={step.id}>
                          <div className={`risk-agent-node ${step.status.toLowerCase()}`}>
                            <span>{idx + 1}</span>
                          </div>
                          <div className="risk-agent-step-body">
                            <div className="risk-agent-step-head">
                              <strong>{step.title}</strong>
                              <span className={`analysis-badge risk-level-chip ${step.status === "Completed" ? "risk-low" : step.status === "Running" ? "risk-medium" : "risk-high"}`}>
                                {step.status}
                              </span>
                            </div>
                            <p className="small">{step.detail}</p>
                          </div>
                          {idx < arr.length - 1 ? <div className="risk-agent-connector" /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="risk-checklist">
                  <h4>AML Checklist</h4>
                  {riskCase.financialAssessment.checklist.map((item) => (
                    (() => {
                      const display = getChecklistDisplay(item, riskCase.financialAssessment);
                      return (
                        <details className="risk-check-accordion" key={item.key}>
                          <summary className="risk-check-summary">
                            <span className={`analysis-badge risk-level-chip ${item.passed ? "risk-low" : "risk-high"}`}>
                              {item.passed ? "Pass" : "Flag"}
                            </span>
                            <strong>{display.title}</strong>
                            <span className="small risk-check-expand-hint">Expand</span>
                          </summary>
                          <div className="risk-check-content">
                            <p className="small">
                              {item.passed ? "Why Passed: " : "Why Flagged: "}
                              {display.reason}
                            </p>
                            <div className="risk-calc-box">
                              <span className="risk-calc-title">Calculation Logic</span>
                              <p className="small risk-calc-text">{display.logic}</p>
                            </div>
                            {item.notes ? (
                              <p className="small">
                                Signal Detail: {item.notes}
                              </p>
                            ) : null}
                          </div>
                        </details>
                      );
                    })()
                  ))}
                </div>

                <div className="risk-admin-box">
                  <h4>Admin Approval</h4>
                  <div className="segmented-control" role="radiogroup" aria-label="Admin decision">
                    {(["Approve", "Reject", "RequestMoreInfo"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={adminDecision === opt}
                        className={`segmented-control-btn segmented-${opt.toLowerCase()} ${
                          adminDecision === opt ? "active" : ""
                        }`}
                        onClick={() => setAdminDecision(opt)}
                      >
                        {opt === "RequestMoreInfo" ? "Request More Info" : opt}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="agent-textarea"
                    value={adminRationale}
                    onChange={(e) => setAdminRationale(e.target.value)}
                    rows={3}
                    placeholder="Enter decision rationale for audit..."
                  />
                  <div className="composer-actions">
                    <button
                      className="button"
                      type="button"
                      onClick={() => onSubmitAdminDecision().catch(() => undefined)}
                      disabled={riskCaseLoading || !adminRationale.trim()}
                    >
                      {riskCaseLoading ? "Submitting..." : "Submit Decision"}
                    </button>
                  </div>
                </div>

                <section className="pr-profile-card">
                  <h4>PR Assignment</h4>
                  {prAssignment && prAgentProfile ? (
                    <>
                      <div className="pr-profile-head">
                        <div
                          className="pr-avatar"
                          style={{ background: avatarGradient(prAgentProfile.prAgentId) }}
                          aria-hidden="true"
                        >
                          {getInitials(prAgentProfile.name)}
                        </div>
                        <div className="pr-profile-identity">
                          <strong className="pr-name">{prAgentProfile.name}</strong>
                          <div className="small">
                            <span className="mono-pill">{prAgentProfile.prAgentId}</span>{" "}
                            <span className={prAgentProfile.active ? "tag-active" : "tag-inactive"}>
                              ● {prAgentProfile.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div
                            className="small"
                            title={new Date(prAssignment.assignedAt).toLocaleString()}
                          >
                            Assigned {formatRelative(prAssignment.assignedAt)}
                          </div>
                        </div>
                        <div className="pr-fit-block">
                          <span className="small">Fit Score</span>
                          <strong
                            className={`pr-fit-value pr-fit-${
                              prAssignment.fitScore >= 0.7
                                ? "high"
                                : prAssignment.fitScore >= 0.5
                                  ? "med"
                                  : "low"
                            }`}
                          >
                            {(prAssignment.fitScore * 100).toFixed(0)}%
                          </strong>
                        </div>
                      </div>

                      <div className="pr-capacity">
                        <div className="pr-capacity-head">
                          <span className="small">Capacity</span>
                          <strong>
                            {prAgentProfile.currentActivePatrons} / {prAgentProfile.maxActivePatrons}{" "}
                            patrons
                          </strong>
                        </div>
                        <div className="pr-capacity-bar">
                          <div
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (prAgentProfile.currentActivePatrons /
                                    Math.max(1, prAgentProfile.maxActivePatrons)) *
                                    100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>

                      {prAgentProfile.preferredTiers?.length ? (
                        <div className="pr-chip-group">
                          <span className="pr-chip-label">Preferred Tiers</span>
                          <div className="pr-chip-row">
                            {prAgentProfile.preferredTiers.map((t) => (
                              <span className="pr-chip pr-chip-tier" key={`tier-${t}`}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {prAgentProfile.preferredGames?.length ? (
                        <div className="pr-chip-group">
                          <span className="pr-chip-label">Preferred Games</span>
                          <div className="pr-chip-row">
                            {prAgentProfile.preferredGames.map((g) => (
                              <span className="pr-chip pr-chip-game" key={`game-${g}`}>
                                {g}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {prAgentProfile.preferredLanguages?.length ? (
                        <div className="pr-chip-group">
                          <span className="pr-chip-label">Languages</span>
                          <div className="pr-chip-row">
                            {prAgentProfile.preferredLanguages.map((l) => (
                              <span className="pr-chip pr-chip-lang" key={`lang-${l}`}>
                                {l}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {prAgentProfile.specialtyTags?.length ? (
                        <div className="pr-chip-group">
                          <span className="pr-chip-label">Specialties</span>
                          <div className="pr-chip-row">
                            {prAgentProfile.specialtyTags.map((s) => (
                              <span className="pr-chip pr-chip-spec" key={`spec-${s}`}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="pr-profile-foot">
                        <span
                          className={`status-pill status-${prAssignment.status.toLowerCase()}`}
                        >
                          ● {prAssignment.status}
                        </span>
                        {prAgentProfile.lastAssignedAt ? (
                          <span
                            className="small"
                            title={new Date(prAgentProfile.lastAssignedAt).toLocaleString()}
                          >
                            Last assignment {formatRelative(prAgentProfile.lastAssignedAt)}
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : prAssignment ? (
                    <p className="small">
                      PR Agent {prAssignment.prAgentId} — profile loading…
                    </p>
                  ) : (
                    <div className="pr-profile-empty">
                      <p className="small">
                        No assignment yet. Approve the case to trigger PR assignment.
                      </p>
                    </div>
                  )}
                </section>

                <section className="risk-timeline-rail">
                  <h4>Timeline</h4>
                  <ol className="risk-timeline-list">
                    {riskCase.timeline
                      .slice()
                      .reverse()
                      .map((event, idx) => {
                        const tone = getActorTone(event.actorType);
                        const summary = getPayloadSummary(
                          event.eventType,
                          event.payload as Record<string, unknown> | undefined
                        );
                        const isLatest = idx === 0;
                        return (
                          <li className="risk-timeline-row" key={`${event.eventType}-${idx}`}>
                            <div
                              className={`risk-event-dot risk-event-${tone} ${
                                isLatest ? "is-latest" : ""
                              }`}
                            >
                              {isLatest ? <span className="risk-event-pulse" /> : null}
                            </div>
                            <div className="risk-event-body">
                              <div className="risk-event-head">
                                <strong>{humanizeEventType(event.eventType)}</strong>
                                <span
                                  className="small risk-event-time"
                                  title={new Date(event.createdAt).toLocaleString()}
                                >
                                  {formatRelative(event.createdAt)}
                                </span>
                              </div>
                              <div className="small risk-event-actor">
                                <span className={`actor-chip actor-${tone}`}>{event.actorType}</span>
                                <span>{event.actorId}</span>
                              </div>
                              {summary ? (
                                <div className="small risk-event-summary">{summary}</div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                  </ol>
                </section>
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="small">No workflow case loaded yet.</p>
            )}
          </div>
        </div>
      ) : null}
      {rejectOfferId ? (
        <div
          className="reject-modal-overlay"
          onClick={closeRejectModal}
          role="presentation"
        >
          <div
            className="reject-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="reject-modal-head">
              <h3>Reject Offer</h3>
              <button
                className="drilldown-drawer-close"
                type="button"
                onClick={closeRejectModal}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="small">
              <strong>{rejectOfferTitle}</strong> ({rejectOfferId})
            </p>
            <p className="small">
              Provide a rationale for rejection. This will be recorded in the
              audit log.
            </p>
            <textarea
              className="agent-textarea"
              rows={4}
              placeholder="Reason for rejecting this offer..."
              value={rejectRationale}
              onChange={(e) => setRejectRationale(e.target.value)}
            />
            <div className="composer-actions">
              <button
                className="button ghost-button"
                type="button"
                onClick={closeRejectModal}
              >
                Cancel
              </button>
              <button
                className="button offer-action-reject reject-confirm-btn"
                type="button"
                onClick={() => onConfirmReject().catch(() => undefined)}
                disabled={
                  !rejectRationale.trim() ||
                  offerActionLoading === rejectOfferId
                }
              >
                {offerActionLoading === rejectOfferId
                  ? "Rejecting..."
                  : "Reject Offer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
