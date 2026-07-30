import { faker } from "@faker-js/faker";
import { config } from "../config.js";
import type {
  AdminDecision,
  AgentNodeState,
  CampaignRun,
  ChatMessage,
  ChatSession,
  FinancialAssessment,
  LossChasingAssessment,
  OfferCatalog,
  OfferRecommendation,
  PRAgentProfile,
  PRAssignment,
  PatronRiskCase,
  PatronActivityEvent,
  PatronProfile,
  PatronTableSession,
  RiskCaseTimelineEvent,
  RiskLevel,
  TableGameType,
  TableStateSnapshot,
} from "../types.js";

const gameTypes: TableGameType[] = ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"];
const zones = ["A", "B", "C", "VIP"];

function randomEmbedding() {
  return Array.from({ length: config.vectorEmbeddingDim }, () =>
    Number(faker.number.float({ min: -1, max: 1, fractionDigits: 6 }))
  );
}

function buildPatronId(index: number): string {
  return `P-${String(index + 1).padStart(6, "0")}`;
}

function buildTableId(index: number): string {
  return `T-${String(index + 1).padStart(4, "0")}`;
}

export function generatePatrons(count: number): PatronProfile[] {
  const tiers: PatronProfile["tier"][] = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
  return Array.from({ length: count }, (_, i) => {
    const name = faker.person.fullName();
    const first = name.slice(0, 1);
    return {
      patronId: buildPatronId(i),
      name,
      maskedName: `${first}***${faker.string.alphanumeric({ length: 2, casing: "upper" })}`,
      tier: faker.helpers.arrayElement(tiers),
      adt: faker.number.int({ min: 800, max: 35000 }),
      preferredGames: faker.helpers.arrayElements(gameTypes, { min: 1, max: 3 }),
      riskFlags: faker.helpers.arrayElements(
        ["None", "HighVariance", "FrequentCashout", "NightOnly", "PromoSensitive"],
        { min: 1, max: 2 }
      ),
      pointsBalance: faker.number.int({ min: 200, max: 120000 }),
      lastActiveAt: faker.date.recent({ days: 7 }),
      activities: [],
      preferenceEmbedding: randomEmbedding(),
      createdAt: faker.date.past({ years: 2 }),
      updatedAt: new Date(),
    };
  });
}

const ALLOWED_MIN_BETS = [300, 500, 800, 1000] as const;

export function generateTables(count: number): TableStateSnapshot[] {
  return Array.from({ length: count }, (_, i) => {
    const minBet = faker.helpers.arrayElement(ALLOWED_MIN_BETS);
    return {
      tableId: buildTableId(i),
      tableName: `Table ${i + 1}`,
      zone: faker.helpers.arrayElement(zones),
      gameType: faker.helpers.arrayElement(gameTypes),
      minBet,
      maxBet: minBet * faker.number.int({ min: 20, max: 100 }),
      status: faker.helpers.arrayElement(["Open", "Busy", "Closed"] as const),
      patronCount: faker.number.int({ min: 0, max: 9 }),
      avgBetAmount: faker.number.int({ min: 100, max: 20000 }),
      occupancyRate: faker.number.float({ min: 0, max: 1, fractionDigits: 3 }),
      refreshedAt: new Date(),
    };
  });
}

export function generateSessions(
  patrons: PatronProfile[],
  tables: TableStateSnapshot[]
): PatronTableSession[] {
  const sessions: PatronTableSession[] = [];
  for (const patron of patrons) {
    if (faker.datatype.boolean(0.62)) {
      const table = faker.helpers.arrayElement(tables);
      const seatedAt = faker.date.recent({ days: 1 });
      sessions.push({
        patronId: patron.patronId,
        tableId: table.tableId,
        seatedAt,
        lastActionAt: faker.date.between({ from: seatedAt, to: new Date() }),
        sessionBetAmount: faker.number.int({ min: 200, max: 40000 }),
        currentStackEstimate: faker.number.int({ min: 100, max: 100000 }),
        behaviorTags: faker.helpers.arrayElements(
          ["Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker"],
          { min: 1, max: 2 }
        ),
        isActive: true,
      });
    }
  }
  return sessions;
}

export function generateActivities(
  patrons: PatronProfile[],
  countPerPatron = 12
): Record<string, PatronActivityEvent[]> {
  const eventsByPatron: Record<string, PatronActivityEvent[]> = {};
  const activityTypes = [
    "ChipExchange",
    "TableBet",
    "PointsRedeem",
    "ShowPurchase",
    "HotelBooking",
    "DrinkRedeem",
  ] as const;
  for (const patron of patrons) {
    const patronEvents: PatronActivityEvent[] = [];
    for (let i = 0; i < countPerPatron; i += 1) {
      const type = faker.helpers.arrayElement(activityTypes);
      const source =
        type === "ChipExchange"
          ? "Cage"
          : type === "DrinkRedeem"
            ? "POS"
            : type === "PointsRedeem"
              ? "Loyalty"
              : "TableSystem";
      patronEvents.push({
        eventId: faker.string.uuid(),
        activityType: type,
        source,
        amount: faker.number.int({ min: 50, max: 50000 }),
        pointsDelta:
          type === "PointsRedeem"
            ? -faker.number.int({ min: 200, max: 2000 })
            : faker.number.int({ min: 20, max: 1500 }),
        metadata: {
          venue: faker.helpers.arrayElement(["MainFloor", "VIPLounge", "Theater", "Hotel"]),
          channel: faker.helpers.arrayElement(["InPerson", "Mobile", "HostDesk"]),
          isVip: patron.tier === "Platinum" || patron.tier === "Diamond",
        },
        activityEmbedding: randomEmbedding(),
        eventTime: faker.date.recent({ days: 14 }),
      });
    }
    eventsByPatron[patron.patronId] = patronEvents.sort(
      (a, b) => b.eventTime.getTime() - a.eventTime.getTime()
    );
  }
  return eventsByPatron;
}

export function generateOfferCatalog(): OfferCatalog[] {
  const now = new Date();
  const items: Array<{ title: string; offerType: OfferCatalog["offerType"]; description: string }> = [
    {
      title: "Premium Hotel Suite - 1 Night",
      offerType: "HotelRoom",
      description: "Complimentary one-night stay in premium suite for high-value patrons.",
    },
    {
      title: "Music Show VIP Ticket Pair",
      offerType: "MusicShowTicket",
      description: "Two VIP tickets for partner entertainment events.",
    },
    {
      title: "2x Limited-Time Point Redemption",
      offerType: "PointsLimitedTime",
      description: "Short-window 2x value for loyalty point redemption.",
    },
    {
      title: "Lounge Beverage Voucher",
      offerType: "FNBVoucher",
      description: "Lounge drink package for active table patrons.",
    },
  ];

  return items.map((item, index) => ({
    offerId: `OFFER-${String(index + 1).padStart(4, "0")}`,
    offerType: item.offerType,
    title: item.title,
    description: item.description,
    eligibilityRules: [
      "adt >= 1000",
      "lastActiveAt <= 7 days",
      "riskFlags does not include ResponsibleGamingHold",
    ],
    estimatedCost: faker.number.int({ min: 80, max: 1500 }),
    targetGameTypes: faker.helpers.arrayElements(gameTypes, { min: 1, max: 3 }),
    priority: 100 - index * 10,
    status: "Active",
    offerEmbedding: randomEmbedding(),
    createdAt: now,
    updatedAt: now,
  }));
}

export function generateRecommendations(
  patrons: PatronProfile[],
  offers: OfferCatalog[],
  countPerPatron = 2
): OfferRecommendation[] {
  const output: OfferRecommendation[] = [];
  for (const patron of patrons) {
    const chosen = faker.helpers.arrayElements(offers, countPerPatron);
    for (const offer of chosen) {
      output.push({
        recommendationId: faker.string.uuid(),
        patronId: patron.patronId,
        offerId: offer.offerId,
        reasonSummary: `${patron.tier} patron with ADT ${patron.adt} and recent activity match.`,
        relevanceScore: faker.number.float({ min: 0.6, max: 0.99, fractionDigits: 3 }),
        confidence: faker.number.float({ min: 0.55, max: 0.98, fractionDigits: 3 }),
        nextBestAction: faker.helpers.arrayElement([
          "Send offer now",
          "Let host call patron",
          "Bundle with hotel package",
        ]),
        status: faker.helpers.arrayElement(["Proposed", "Approved", "Sent"] as const),
        generatedBy: faker.helpers.arrayElement(["RuleEngine", "LLM"] as const),
        generatedAt: faker.date.recent({ days: 2 }),
        expiresAt: faker.date.soon({ days: 7 }),
      });
    }
  }
  return output;
}

export function generatePRAgents(count = 24): PRAgentProfile[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const preferredTiers = faker.helpers.arrayElements(
      ["Silver", "Gold", "Platinum", "Diamond"] as const,
      { min: 1, max: 3 }
    );
    const preferredGames = faker.helpers.arrayElements(gameTypes, { min: 1, max: 3 });
    return {
      prAgentId: `PR-${String(index + 1).padStart(4, "0")}`,
      name: faker.person.fullName(),
      active: faker.datatype.boolean(0.9),
      maxActivePatrons: faker.number.int({ min: 6, max: 18 }),
      currentActivePatrons: faker.number.int({ min: 0, max: 9 }),
      preferredTiers,
      preferredGames,
      preferredLanguages: faker.helpers.arrayElements(
        ["Cantonese", "Mandarin", "English", "Portuguese", "Thai"],
        { min: 1, max: 3 }
      ),
      specialtyTags: faker.helpers.arrayElements(
        ["HighRoller", "EntertainmentVIP", "PremiumMass", "FamilyOffice", "LateNightOps"],
        { min: 1, max: 3 }
      ),
      lastAssignedAt: faker.date.recent({ days: 10 }),
      createdAt: faker.date.past({ years: 2 }),
      updatedAt: now,
    };
  });
}

function buildLossAssessment(
  patron: PatronProfile,
  session: PatronTableSession | undefined
): LossChasingAssessment {
  const sessionSignal = session ? Math.min(session.sessionBetAmount / 40000, 1) : 0.2;
  const adtSignal = Math.min(patron.adt / 35000, 1);
  const behaviorSignal = session?.behaviorTags.includes("Aggressive")
    ? 0.9
    : session?.behaviorTags.includes("PromoSeeker")
      ? 0.65
      : 0.35;
  const score = Number((sessionSignal * 0.45 + adtSignal * 0.3 + behaviorSignal * 0.25).toFixed(3));
  const label: LossChasingAssessment["label"] =
    score >= 0.72 ? "Likely" : score >= 0.5 ? "Borderline" : "Unlikely";
  return {
    score,
    label,
    confidence: Number((0.58 + score * 0.37).toFixed(3)),
    drivers: [
      `Session intensity ${(sessionSignal * 100).toFixed(0)}%`,
      `ADT signal ${(adtSignal * 100).toFixed(0)}%`,
      `Behavior pattern ${(behaviorSignal * 100).toFixed(0)}%`,
    ],
    explanation:
      label === "Likely"
        ? "Repeated high-intensity play and behavior markers indicate elevated loss-chasing potential."
        : label === "Borderline"
          ? "Some risk markers are present but require admin judgement with financial context."
          : "Current behavior appears controlled with limited loss-chasing indicators.",
  };
}

function buildFinancialAssessment(patron: PatronProfile): FinancialAssessment {
  const spike = faker.datatype.boolean(0.25);
  const exchangeAnomaly = faker.datatype.boolean(0.22);
  const highRiskSource = faker.datatype.boolean(0.12);
  const freshKyc = faker.datatype.boolean(0.84);
  const consistentPattern = !(spike || exchangeAnomaly);
  const amlRiskScore = Number(
    (
      (spike ? 0.27 : 0.05) +
      (exchangeAnomaly ? 0.26 : 0.05) +
      (highRiskSource ? 0.32 : 0.04) +
      (freshKyc ? 0.06 : 0.2)
    ).toFixed(3)
  );
  const sourceOfFundsRisk: FinancialAssessment["sourceOfFundsRisk"] =
    amlRiskScore >= 0.68 ? "High" : amlRiskScore >= 0.4 ? "Medium" : "Low";
  const creditBand: FinancialAssessment["creditBand"] =
    patron.adt >= 18000 ? "Strong" : patron.adt >= 9000 ? "Good" : patron.adt >= 3500 ? "Fair" : "Weak";

  return {
    amlRiskScore,
    creditBand,
    sourceOfFundsRisk,
    confidence: Number((0.62 + (1 - Math.min(amlRiskScore, 0.9)) * 0.25).toFixed(3)),
    checklist: [
      {
        key: "incomePatternConsistent",
        passed: consistentPattern,
        notes: consistentPattern ? "Betting profile aligns with historical baseline." : "Recent variance spike observed.",
      },
      {
        key: "largeCashSpike",
        passed: !spike,
        notes: spike ? "Large cash exchange spikes detected in recent activities." : "No unusual cash spike pattern.",
      },
      {
        key: "chipExchangeAnomaly",
        passed: !exchangeAnomaly,
        notes: exchangeAnomaly ? "Potentially anomalous chip exchange cadence." : "Chip exchange cadence within expected range.",
      },
      {
        key: "highRiskSourceSignal",
        passed: !highRiskSource,
        notes: highRiskSource ? "Watchlist-aligned source indicator found." : "No high-risk source signals found.",
      },
      {
        key: "kycProfileFresh",
        passed: freshKyc,
        notes: freshKyc ? "KYC profile recently refreshed." : "KYC refresh is overdue.",
      },
    ],
    analystNotes:
      sourceOfFundsRisk === "High"
        ? "Escalate to senior reviewer; source-of-funds confidence is insufficient."
        : sourceOfFundsRisk === "Medium"
          ? "Proceed with caution and require admin rationale before PR assignment."
          : "Financial profile appears acceptable for standard workflow.",
  };
}

function deriveRiskLevel(
  lossAssessment: LossChasingAssessment,
  financialAssessment: FinancialAssessment
): RiskLevel {
  if (financialAssessment.amlRiskScore >= 0.75) return "Critical";
  if (lossAssessment.score >= 0.75 || financialAssessment.amlRiskScore >= 0.55) return "High";
  if (lossAssessment.score >= 0.5 || financialAssessment.amlRiskScore >= 0.35) return "Medium";
  return "Low";
}

function buildNodeStates(status: PatronRiskCase["status"]): AgentNodeState[] {
  const allNodes: AgentNodeState["nodeName"][] = [
    "initialize_case",
    "evaluate_loss_chasing",
    "evaluate_financial_credit_aml",
    "risk_escalation_router",
    "await_admin_review",
    "assign_pr_agent",
    "emit_assignment_notice",
    "finalize_case",
  ];
  const now = new Date();

  if (status === "AwaitingAdmin") {
    return allNodes.map((node) => ({
      nodeName: node,
      status:
        node === "await_admin_review"
          ? "Running"
          : allNodes.indexOf(node) < allNodes.indexOf("await_admin_review")
            ? "Completed"
            : "Pending",
      startedAt: node === "await_admin_review" ? now : undefined,
    }));
  }

  if (status === "InReview") {
    return allNodes.map((node) => ({
      nodeName: node,
      status:
        node === "evaluate_financial_credit_aml"
          ? "Failed"
          : allNodes.indexOf(node) < allNodes.indexOf("evaluate_financial_credit_aml")
            ? "Completed"
            : "Pending",
      completedAt: allNodes.indexOf(node) < allNodes.indexOf("evaluate_financial_credit_aml") ? now : undefined,
      message: node === "evaluate_financial_credit_aml" ? "AML model confidence below threshold." : undefined,
    }));
  }

  if (status === "Rejected") {
    return allNodes.map((node) => ({
      nodeName: node,
      status:
        node === "finalize_case"
          ? "Completed"
          : node === "assign_pr_agent" || node === "emit_assignment_notice"
            ? "Skipped"
            : "Completed",
      completedAt: now,
    }));
  }

  return allNodes.map((node) => ({
    nodeName: node,
    status: "Completed",
    completedAt: now,
  }));
}

function buildTimeline(
  status: PatronRiskCase["status"],
  adminDecision?: AdminDecision
): RiskCaseTimelineEvent[] {
  const now = Date.now();
  const timeline: RiskCaseTimelineEvent[] = [
    {
      eventType: "CaseCreated",
      actorType: "System",
      actorId: "risk-case-engine",
      payload: { status },
      createdAt: new Date(now - 1000 * 60 * 40),
    },
    {
      eventType: "LossAssessmentCompleted",
      actorType: "Agent",
      actorId: "loss-chasing-agent",
      payload: { ok: true },
      createdAt: new Date(now - 1000 * 60 * 33),
    },
    {
      eventType: "FinancialAssessmentCompleted",
      actorType: "Agent",
      actorId: "financial-aml-agent",
      payload: { ok: status !== "InReview" },
      createdAt: new Date(now - 1000 * 60 * 27),
    },
  ];

  if (status === "AwaitingAdmin" || status === "Rejected" || status === "Approved" || status === "Assigned") {
    timeline.push({
      eventType: "Escalated",
      actorType: "System",
      actorId: "risk-escalation-router",
      payload: { queue: "admin" },
      createdAt: new Date(now - 1000 * 60 * 21),
    });
  }

  if (adminDecision) {
    timeline.push({
      eventType: "AdminDecisionSubmitted",
      actorType: "Admin",
      actorId: "ADM-001",
      payload: { decision: adminDecision },
      createdAt: new Date(now - 1000 * 60 * 14),
    });
  }

  if (status === "Assigned") {
    timeline.push({
      eventType: "PRAssignmentCreated",
      actorType: "System",
      actorId: "pr-assignment-agent",
      payload: { queue: "pr" },
      createdAt: new Date(now - 1000 * 60 * 8),
    });
  }

  if (status === "Rejected" || status === "Assigned") {
    timeline.push({
      eventType: "CaseClosed",
      actorType: "System",
      actorId: "risk-case-engine",
      payload: { finalStatus: status },
      createdAt: new Date(now - 1000 * 60 * 2),
    });
  }

  return timeline;
}

export function generateRiskCases(
  patrons: PatronProfile[],
  tables: TableStateSnapshot[],
  sessions: PatronTableSession[]
): PatronRiskCase[] {
  const sessionsByPatron = new Map(sessions.map((session) => [session.patronId, session]));
  const tableIds = new Set(tables.map((t) => t.tableId));
  const cases: PatronRiskCase[] = [];

  const selectedPatrons = faker.helpers.arrayElements(
    patrons,
    Math.max(20, Math.floor(patrons.length * 0.38))
  );

  for (const patron of selectedPatrons) {
    const session = sessionsByPatron.get(patron.patronId);
    const lossAssessment = buildLossAssessment(patron, session);
    const financialAssessment = buildFinancialAssessment(patron);
    const riskLevel = deriveRiskLevel(lossAssessment, financialAssessment);
    const escalationTier: PatronRiskCase["escalationTier"] =
      riskLevel === "Critical" || financialAssessment.sourceOfFundsRisk === "High" ? "Senior" : "Standard";

    const status = faker.helpers.weightedArrayElement<PatronRiskCase["status"]>([
      { value: "AwaitingAdmin", weight: 28 },
      { value: "Assigned", weight: 24 },
      { value: "Rejected", weight: 16 },
      { value: "Approved", weight: 14 },
      { value: "InReview", weight: 12 },
      { value: "Draft", weight: 6 },
    ]);
    const adminDecision: AdminDecision | undefined =
      status === "Assigned" || status === "Approved"
        ? "Approve"
        : status === "Rejected"
          ? "Reject"
          : undefined;

    const createdAt = faker.date.recent({ days: 14 });
    const updatedAt = faker.date.between({ from: createdAt, to: new Date() });
    const preferredTable = session?.tableId && tableIds.has(session.tableId)
      ? session.tableId
      : faker.helpers.arrayElement(tables).tableId;
    const timeline = buildTimeline(status, adminDecision);

    cases.push({
      caseId: `CASE-${faker.string.alphanumeric({ length: 10, casing: "upper" })}`,
      patronId: patron.patronId,
      tableId: preferredTable,
      analysisRunId: `ANL-${faker.date.recent({ days: 14 }).toISOString().slice(0, 10)}-${faker.number.int({ min: 1000, max: 9999 })}`,
      status,
      riskLevel,
      escalationTier,
      currentNode:
        status === "AwaitingAdmin"
          ? "await_admin_review"
          : status === "Draft"
            ? "initialize_case"
            : status === "InReview"
              ? "evaluate_financial_credit_aml"
              : "finalize_case",
      nodeStates: buildNodeStates(status),
      lossChasingAssessment: lossAssessment,
      financialAssessment,
      adminReview: adminDecision
        ? {
            adminUserId: faker.helpers.arrayElement(["ADM-001", "ADM-002", "ADM-SENIOR-01"]),
            adminDisplayName: faker.person.fullName(),
            decision: adminDecision,
            rationale:
              adminDecision === "Approve"
                ? "Combined risk is within acceptable threshold with clear follow-up controls."
                : "Risk and financial indicators are not acceptable for patron outreach.",
            requestedActions: adminDecision === "Approve" ? [] : ["Manual compliance review required"],
            createdAt: faker.date.between({ from: createdAt, to: updatedAt }),
          }
        : undefined,
      createdBy: faker.helpers.arrayElement(["MKT-01", "MKT-02", "RISKOPS-01"]),
      timeline,
      createdAt,
      updatedAt,
    });
  }

  return cases.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function generatePRAssignments(
  riskCases: PatronRiskCase[],
  prAgents: PRAgentProfile[]
): PRAssignment[] {
  const activeAgents = prAgents.filter((agent) => agent.active);
  const approvedCases = riskCases.filter((riskCase) =>
    riskCase.status === "Assigned" || riskCase.status === "Approved"
  );
  const assignments: PRAssignment[] = [];

  for (const riskCase of approvedCases) {
    const agent = faker.helpers.arrayElement(activeAgents.length > 0 ? activeAgents : prAgents);
    const assignedAt = faker.date.between({ from: riskCase.createdAt, to: new Date() });
    const accepted = faker.datatype.boolean(0.68);
    const status: PRAssignment["status"] = accepted
      ? faker.helpers.arrayElement(["Accepted", "Completed"] as const)
      : "Assigned";
    assignments.push({
      assignmentId: `ASG-${faker.string.alphanumeric({ length: 10, casing: "upper" })}`,
      caseId: riskCase.caseId,
      patronId: riskCase.patronId,
      prAgentId: agent.prAgentId,
      fitScore: Number(faker.number.float({ min: 0.62, max: 0.98, fractionDigits: 3 })),
      status,
      assignedAt,
      acceptedAt: status === "Accepted" || status === "Completed"
        ? faker.date.between({ from: assignedAt, to: new Date() })
        : undefined,
      completedAt: status === "Completed" ? faker.date.soon({ days: 2, refDate: assignedAt }) : undefined,
    });
  }

  return assignments;
}

export function generateCampaigns(
  offers: OfferCatalog[],
  patrons: PatronProfile[],
  count = 3
): CampaignRun[] {
  return Array.from({ length: count }, (_, i) => {
    const targetPatrons = faker.helpers.arrayElements(
      patrons.map((p) => p.patronId),
      faker.number.int({ min: 20, max: 80 })
    );
    const selectedOffers = faker.helpers.arrayElements(
      offers.map((o) => o.offerId),
      faker.number.int({ min: 1, max: 3 })
    );
    const startAt = faker.date.recent({ days: 3 });
    return {
      campaignId: `CMP-${String(i + 1).padStart(4, "0")}`,
      name: faker.helpers.arrayElement([
        "Weekend VIP Reactivation",
        "High Roller Night Push",
        "Theater Bundle Upsell",
      ]),
      goal: faker.helpers.arrayElement(["Retention", "Upsell", "CrossSell", "Reactivation"] as const),
      segmentCriteria: ["tier in [Gold, Platinum, Diamond]", "adt >= 3000", "active in past 7 days"],
      includedOfferIds: selectedOffers,
      targetPatronIds: targetPatrons,
      startAt,
      endAt: faker.date.soon({ days: 10, refDate: startAt }),
      status: faker.helpers.arrayElement(["Planned", "Running", "Completed"] as const),
      metrics: {
        sent: targetPatrons.length,
        accepted: faker.number.int({ min: 0, max: Math.floor(targetPatrons.length * 0.45) }),
        redemptionValue: faker.number.int({ min: 10000, max: 200000 }),
      },
    };
  });
}

export function generateChatData(
  patrons: PatronProfile[],
  recommendationCount = 60
): { sessions: ChatSession[]; messages: ChatMessage[] } {
  const sessions: ChatSession[] = [];
  const messages: ChatMessage[] = [];

  for (let i = 0; i < recommendationCount; i += 1) {
    const sessionId = faker.string.uuid();
    const patron = faker.helpers.arrayElement(patrons);
    const startedAt = faker.date.recent({ days: 2 });
    sessions.push({
      sessionId,
      channel: "WebAdmin",
      marketingUserId: `MKT-${faker.number.int({ min: 1, max: 25 })}`,
      patronContextIds: [patron.patronId],
      startedAt,
      lastMessageAt: faker.date.between({ from: startedAt, to: new Date() }),
      state: faker.helpers.arrayElement(["Open", "Closed"] as const),
    });

    const userPromptId = faker.string.uuid();
    messages.push({
      sessionId,
      messageId: userPromptId,
      role: "user",
      content: `Summarize ${patron.patronId} and recommend next offer.`,
      model: "n/a",
      agentName: "marketing_user",
      references: [patron.patronId],
      createdAt: startedAt,
    });

    messages.push({
      sessionId,
      messageId: faker.string.uuid(),
      role: "assistant",
      content:
        "Patron is active on baccarat and table bet volume is high. Recommend hotel+ticket bundle and host outreach.",
      model: "gpt-5.1-mini",
      agentName: "offer_strategist_agent",
      references: [patron.patronId, userPromptId],
      createdAt: faker.date.between({ from: startedAt, to: new Date() }),
    });
  }

  return { sessions, messages };
}
