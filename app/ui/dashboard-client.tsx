"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

type HeatmapTable = {
  tableId: string;
  tableName: string;
  zone: string;
  gameType: string;
  status: string;
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
  };
  offers: Array<{
    offerId: string;
    offerType: string;
    title: string;
    status: string;
    priority: number;
    estimatedCost: number;
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

type ConsoleSection = "patron-eyes" | "offer-catalog";

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
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentQuestions, setAgentQuestions] = useState<GuidanceQuestion[]>([]);
  const [agentStats, setAgentStats] = useState<OfferGenerationStats | null>(null);
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
  const [riskCasePatronId, setRiskCasePatronId] = useState<string>("");
  const [adminDecision, setAdminDecision] = useState<"Approve" | "Reject" | "RequestMoreInfo">("Approve");
  const [adminRationale, setAdminRationale] = useState<string>("");
  const [minBetRecommendation, setMinBetRecommendation] = useState<MinBetRecommendation | null>(null);
  const [minBetHistory, setMinBetHistory] = useState<MinBetRecommendation[]>([]);
  const [minBetLoading, setMinBetLoading] = useState<boolean>(false);
  const [minBetActionLoading, setMinBetActionLoading] = useState<boolean>(false);
  const [drillDrawerOpen, setDrillDrawerOpen] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

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

  useEffect(() => {
    if (!selectedTableId) return;
    setTableAnalysis(null);
    setMinBetRecommendation(null);
    setMinBetHistory([]);
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
      };
      if (latestData.ok && latestData.case) {
        setRiskCase(latestData.case);
        setPrAssignment(latestData.assignment ?? null);
      } else {
        setPrAssignment(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRiskCaseLoading(false);
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
        error?: string;
      };
      if (!data.ok || !data.case) {
        setError(data.error ?? "Failed to submit admin decision.");
        return;
      }
      setRiskCase(data.case);
      setPrAssignment(data.assignment ?? null);
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
      </aside>

      <section className="console-content">
        <header className="hero">
          <div>
            <h2 className="hero-title">
              {activeSection === "patron-eyes" ? "Patron Eyes" : "Offer Catalog"}
            </h2>
            <p className="hero-subtitle">
              {activeSection === "patron-eyes"
                ? "Monitor live table activity, drill into active patrons, and run instant loss-potential analysis."
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
                    <div
                      className={`table-occupancy-footer ${
                        table.occupancyRate >= 0.8
                          ? "high"
                          : table.occupancyRate >= 0.5
                            ? "medium"
                            : "low"
                      }`}
                    >
                      <span className="table-occupancy-label-text">Occupancy</span>
                      <span className="table-occupancy-value">
                        {Math.round(table.occupancyRate * 100)}
                        <em>%</em>
                      </span>
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
              <button
                className="button analysis-button"
                onClick={() => onOptimizeMinBet().catch(() => undefined)}
                type="button"
                disabled={!selectedTableId || minBetLoading}
              >
                {minBetLoading ? "Optimizing..." : "Run Optimizer Agent"}
              </button>
            </div>
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
        ) : (
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
                <div className="offer-grid">
                  {(offerDashboard?.offers ?? []).slice(0, 12).map((offer) => {
                    const typeClass = `type-${offer.offerType.toLowerCase()}`;
                    const statusClass = offer.status.toLowerCase();
                    const priorityPct = Math.max(0, Math.min(100, Math.round((offer.priority / 10) * 100)));
                    return (
                      <div className="offer-card" key={offer.offerId}>
                        <div className="offer-card-head">
                          <span className="offer-card-title">{offer.title}</span>
                          <span className={`status-pill status-${statusClass}`}>{offer.status}</span>
                        </div>
                        <span className={`type-chip ${typeClass}`}>{offer.offerType}</span>
                        <div className="offer-card-meta">
                          <span className="small">Cost</span>
                          <strong>HK$ {formatAmount(offer.estimatedCost)}</strong>
                        </div>
                        <div className="offer-card-priority">
                          <div className="small">Priority {offer.priority}/10</div>
                          <div className="priority-bar">
                            <div style={{ width: `${priorityPct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(offerDashboard?.offers ?? []).length === 0 ? (
                    <p className="small">No offers loaded.</p>
                  ) : null}
                </div>
              </article>

              <article className="panel-card">
                <h2 className="panel-title">Quick Offer Lookup</h2>
                <p className="small">Generate top matches for one patron profile.</p>
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
                  <div className="lookup-patron-chip">
                    <span className="tier-pill">{generatedPatron.tier}</span>
                    <span className="small">{generatedPatron.patronId}</span>
                    <span className="muted-chip">ADT {formatAmount(generatedPatron.adt)}</span>
                    {(generatedPatron.preferredGames ?? []).map((g) => (
                      <span className="muted-chip" key={`pg-${g}`}>
                        {g}
                      </span>
                    ))}
                    {generatedPatron.pointsBalance !== undefined ? (
                      <span className="muted-chip">
                        Points {formatAmount(generatedPatron.pointsBalance)}
                      </span>
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
                <div className="impact-foot">
                  <span className="metric-chip">Avg ADT {formatAmount(agentStats.avgMatchedAdt)}</span>
                  <span className="metric-chip">Matched {formatAmount(agentStats.matchedPatrons)}</span>
                </div>
              </div>
            ) : null}
              </article>
            </section>
          </div>
        )}
      </section>
      {riskCaseModalOpen ? (
        <div className="risk-modal-overlay" onClick={() => setRiskCaseModalOpen(false)} role="presentation">
          <div className="risk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="risk-modal-head">
              <div>
                <h3>Patron Risk Workflow</h3>
                <p className="small">
                  {riskCasePatronId || riskCase?.patronId} | Case {riskCase?.caseId ?? "Initializing..."}
                </p>
              </div>
              <button className="button ghost-button" onClick={() => setRiskCaseModalOpen(false)} type="button">
                Close
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
                  <span className={`analysis-badge risk-level-chip risk-${overallTone}`}>
                    {riskCase.riskLevel} Risk
                  </span>
                  <span className="metric-chip">Status {riskCase.status}</span>
                  <span className="metric-chip">Escalation {riskCase.escalationTier}</span>
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
                  <div className="actions">
                    <select
                      className="input"
                      value={adminDecision}
                      onChange={(e) =>
                        setAdminDecision(e.target.value as "Approve" | "Reject" | "RequestMoreInfo")
                      }
                    >
                      <option value="Approve">Approve</option>
                      <option value="Reject">Reject</option>
                      <option value="RequestMoreInfo">Request More Info</option>
                    </select>
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

                {prAssignment ? (
                  <div className="risk-assignment-box">
                    <h4>PR Assignment</h4>
                    <p className="small">
                      PR Agent {prAssignment.prAgentId} | Fit {(prAssignment.fitScore * 100).toFixed(1)}% |{" "}
                      {prAssignment.status}
                    </p>
                  </div>
                ) : (
                  <div className="risk-assignment-box">
                    <h4>PR Assignment</h4>
                    <p className="small">No assignment yet. Approve case to trigger PR assignment.</p>
                  </div>
                )}

                <div className="risk-timeline">
                  <h4>Timeline</h4>
                  {riskCase.timeline
                    .slice()
                    .reverse()
                    .map((event, idx) => (
                      <div className="risk-timeline-item" key={`${event.eventType}-${idx}`}>
                        <strong>{event.eventType}</strong>
                        <span className="small">
                          {event.actorType} ({event.actorId}) | {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
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
    </main>
  );
}
