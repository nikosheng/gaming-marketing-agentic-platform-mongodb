import { Db } from "mongodb";
import { webCollections } from "./collections";

type AdminDecision = "Approve" | "Reject" | "RequestMoreInfo";

function nowIsoDateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function scoreLossChasing(input: {
  adt: number;
  sessionBetAmount: number;
  behaviorTags: string[];
}) {
  const adtSignal = Math.min(input.adt / 35000, 1);
  const betSignal = Math.min(input.sessionBetAmount / 40000, 1);
  const behaviorSignal = input.behaviorTags.includes("Aggressive")
    ? 0.9
    : input.behaviorTags.includes("PromoSeeker")
      ? 0.65
      : 0.35;
  const score = Number((adtSignal * 0.3 + betSignal * 0.45 + behaviorSignal * 0.25).toFixed(3));
  return {
    score,
    label: score >= 0.72 ? "Likely" : score >= 0.5 ? "Borderline" : "Unlikely",
    confidence: Number((0.58 + score * 0.35).toFixed(3)),
    drivers: [
      `ADT signal ${(adtSignal * 100).toFixed(0)}%`,
      `Session intensity ${(betSignal * 100).toFixed(0)}%`,
      `Behavior pattern ${(behaviorSignal * 100).toFixed(0)}%`,
    ],
    explanation:
      score >= 0.72
        ? "High-intensity betting and behavior markers indicate potential loss-chasing."
        : "Mixed behavior signals, requires admin review with AML findings.",
  };
}

function scoreFinancialRisk(input: { adt: number; pointsBalance: number; riskFlags: string[] }) {
  const highVariance = input.riskFlags.includes("HighVariance");
  const frequentCashout = input.riskFlags.includes("FrequentCashout");
  const promoSensitive = input.riskFlags.includes("PromoSensitive");

  const amlRiskScore = Number(
    (
      (highVariance ? 0.25 : 0.08) +
      (frequentCashout ? 0.28 : 0.07) +
      (promoSensitive ? 0.12 : 0.05) +
      (input.pointsBalance > 80000 ? 0.18 : 0.06)
    ).toFixed(3)
  );
  const sourceOfFundsRisk = amlRiskScore >= 0.68 ? "High" : amlRiskScore >= 0.4 ? "Medium" : "Low";
  const creditBand = input.adt >= 18000 ? "Strong" : input.adt >= 9000 ? "Good" : input.adt >= 3500 ? "Fair" : "Weak";

  return {
    amlRiskScore,
    creditBand,
    sourceOfFundsRisk,
    confidence: Number((0.62 + (1 - Math.min(amlRiskScore, 0.95)) * 0.22).toFixed(3)),
    checklist: [
      {
        key: "incomePatternConsistent",
        passed: !highVariance,
        notes: highVariance ? "Recent variance spikes detected." : "Pattern is stable vs baseline.",
      },
      {
        key: "largeCashSpike",
        passed: !frequentCashout,
        notes: frequentCashout ? "Cashout cadence is unusually frequent." : "No unusual cash spikes.",
      },
      {
        key: "chipExchangeAnomaly",
        passed: !promoSensitive,
        notes: promoSensitive ? "Promotion-led churn pattern may mask source behavior." : "Exchange behavior is normal.",
      },
      {
        key: "highRiskSourceSignal",
        passed: sourceOfFundsRisk !== "High",
        notes: sourceOfFundsRisk === "High" ? "Escalation required." : "No immediate high-risk source signal.",
      },
      {
        key: "kycProfileFresh",
        passed: true,
        notes: "KYC freshness assumed valid in MVP internal-only check.",
      },
    ],
    analystNotes:
      sourceOfFundsRisk === "High"
        ? "Escalate to senior admin before any PR action."
        : "Internal checks complete, ready for admin decision.",
  };
}

function deriveRiskLevel(lossScore: number, amlRiskScore: number): "Low" | "Medium" | "High" | "Critical" {
  if (amlRiskScore >= 0.75) return "Critical";
  if (lossScore >= 0.75 || amlRiskScore >= 0.55) return "High";
  if (lossScore >= 0.5 || amlRiskScore >= 0.35) return "Medium";
  return "Low";
}

async function getBestPRAgent(db: Db, patronTier: string, preferredGames: string[]) {
  const agents = await db
    .collection(webCollections.prAgents)
    .find({ active: true }, { projection: { _id: 0 } })
    .limit(80)
    .toArray();

  if (agents.length === 0) return null;

  const scored = agents.map((agent) => {
    const capacityLeft = Math.max(0, Number(agent.maxActivePatrons ?? 0) - Number(agent.currentActivePatrons ?? 0));
    const capacityScore = Math.min(1, capacityLeft / Math.max(1, Number(agent.maxActivePatrons ?? 1)));
    const tierMatch = Array.isArray(agent.preferredTiers) && agent.preferredTiers.includes(patronTier) ? 1 : 0.45;
    const gameOverlap =
      Array.isArray(agent.preferredGames) && preferredGames.length > 0
        ? preferredGames.filter((g) => agent.preferredGames.includes(g)).length / preferredGames.length
        : 0.5;
    const fitScore = Number((capacityScore * 0.45 + tierMatch * 0.3 + gameOverlap * 0.25).toFixed(3));
    return { agent, fitScore };
  });

  scored.sort((a, b) => b.fitScore - a.fitScore);
  return scored[0] ?? null;
}

export async function createOrReuseRiskCase(input: {
  db: Db;
  patronId: string;
  tableId: string;
  analysisRunId?: string;
}) {
  const { db, patronId, tableId, analysisRunId } = input;
  const existing = await db
    .collection(webCollections.riskCases)
    .findOne(
      { patronId, status: { $in: ["Draft", "InReview", "AwaitingAdmin", "Approved", "Assigned"] } },
      { sort: { updatedAt: -1 }, projection: { _id: 0 } }
    );
  if (existing) {
    return { case: existing, reused: true };
  }

  const patron = await db
    .collection(webCollections.patrons)
    .findOne({ patronId }, { projection: { _id: 0, tier: 1, adt: 1, pointsBalance: 1, riskFlags: 1, preferredGames: 1 } });
  if (!patron) {
    throw new Error("Patron not found");
  }
  const session = await db
    .collection(webCollections.sessions)
    .findOne({ patronId, tableId, isActive: true }, { projection: { _id: 0, sessionBetAmount: 1, behaviorTags: 1 } });

  const loss = scoreLossChasing({
    adt: Number(patron.adt ?? 0),
    sessionBetAmount: Number(session?.sessionBetAmount ?? 0),
    behaviorTags: (session?.behaviorTags as string[] | undefined) ?? [],
  });
  const financial = scoreFinancialRisk({
    adt: Number(patron.adt ?? 0),
    pointsBalance: Number(patron.pointsBalance ?? 0),
    riskFlags: (patron.riskFlags as string[] | undefined) ?? [],
  });
  const riskLevel = deriveRiskLevel(loss.score, financial.amlRiskScore);
  const escalationTier = riskLevel === "Critical" || financial.sourceOfFundsRisk === "High" ? "Senior" : "Standard";

  const now = new Date();
  const caseDoc = {
    caseId: nowIsoDateId("CASE"),
    patronId,
    tableId,
    analysisRunId: analysisRunId ?? nowIsoDateId("ANL"),
    status: "AwaitingAdmin",
    riskLevel,
    escalationTier,
    currentNode: "await_admin_review",
    nodeStates: [
      { nodeName: "initialize_case", status: "Completed", completedAt: now },
      { nodeName: "evaluate_loss_chasing", status: "Completed", completedAt: now },
      { nodeName: "evaluate_financial_credit_aml", status: "Completed", completedAt: now },
      { nodeName: "risk_escalation_router", status: "Completed", completedAt: now },
      { nodeName: "await_admin_review", status: "Running", startedAt: now },
      { nodeName: "assign_pr_agent", status: "Pending" },
      { nodeName: "emit_assignment_notice", status: "Pending" },
      { nodeName: "finalize_case", status: "Pending" },
    ],
    lossChasingAssessment: loss,
    financialAssessment: financial,
    createdBy: "WEB-ADMIN",
    timeline: [
      {
        eventType: "CaseCreated",
        actorType: "System",
        actorId: "risk-case-engine",
        payload: { tableId, analysisRunId: analysisRunId ?? "generated" },
        createdAt: now,
      },
      {
        eventType: "LossAssessmentCompleted",
        actorType: "Agent",
        actorId: "loss-chasing-agent",
        payload: { score: loss.score, label: loss.label },
        createdAt: now,
      },
      {
        eventType: "FinancialAssessmentCompleted",
        actorType: "Agent",
        actorId: "financial-aml-agent",
        payload: { amlRiskScore: financial.amlRiskScore, sourceOfFundsRisk: financial.sourceOfFundsRisk },
        createdAt: now,
      },
      {
        eventType: "Escalated",
        actorType: "System",
        actorId: "risk-escalation-router",
        payload: { escalationTier },
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(webCollections.riskCases).insertOne(caseDoc);
  return { case: caseDoc, reused: false };
}

export async function getLatestRiskCase(db: Db, patronId: string) {
  return db
    .collection(webCollections.riskCases)
    .findOne({ patronId }, { projection: { _id: 0 }, sort: { updatedAt: -1 } });
}

export async function submitAdminDecision(input: {
  db: Db;
  caseId: string;
  decision: AdminDecision;
  rationale: string;
}) {
  const { db, caseId, decision, rationale } = input;
  const riskCase = await db.collection(webCollections.riskCases).findOne({ caseId }, { projection: { _id: 0 } });
  if (!riskCase) throw new Error("Risk case not found");

  const now = new Date();
  const timeline = Array.isArray(riskCase.timeline) ? [...riskCase.timeline] : [];
  timeline.push({
    eventType: "AdminDecisionSubmitted",
    actorType: "Admin",
    actorId: "ADM-001",
    payload: { decision, rationale },
    createdAt: now,
  });

  if (decision === "Reject") {
    timeline.push({
      eventType: "CaseClosed",
      actorType: "System",
      actorId: "risk-case-engine",
      payload: { finalStatus: "Rejected" },
      createdAt: now,
    });
    await db.collection(webCollections.riskCases).updateOne(
      { caseId },
      {
        $set: {
          status: "Rejected",
          currentNode: "finalize_case",
          adminReview: {
            adminUserId: "ADM-001",
            adminDisplayName: "Default Admin",
            decision,
            rationale,
            requestedActions: [],
            createdAt: now,
          },
          timeline,
          updatedAt: now,
        },
      }
    );
    const updated = await db.collection(webCollections.riskCases).findOne({ caseId }, { projection: { _id: 0 } });
    return { case: updated, assignment: null };
  }

  if (decision === "RequestMoreInfo") {
    await db.collection(webCollections.riskCases).updateOne(
      { caseId },
      {
        $set: {
          status: "InReview",
          currentNode: "evaluate_financial_credit_aml",
          adminReview: {
            adminUserId: "ADM-001",
            adminDisplayName: "Default Admin",
            decision,
            rationale,
            requestedActions: ["Re-run financial AML check"],
            createdAt: now,
          },
          timeline,
          updatedAt: now,
        },
      }
    );
    const updated = await db.collection(webCollections.riskCases).findOne({ caseId }, { projection: { _id: 0 } });
    return { case: updated, assignment: null };
  }

  const patron = await db
    .collection(webCollections.patrons)
    .findOne({ patronId: riskCase.patronId }, { projection: { _id: 0, tier: 1, preferredGames: 1 } });
  const best = await getBestPRAgent(
    db,
    String(patron?.tier ?? ""),
    Array.isArray(patron?.preferredGames) ? (patron?.preferredGames as string[]) : []
  );
  let assignment = null;
  if (best) {
    assignment = {
      assignmentId: nowIsoDateId("ASG"),
      caseId,
      patronId: riskCase.patronId,
      prAgentId: best.agent.prAgentId,
      fitScore: best.fitScore,
      status: "Assigned",
      assignedAt: now,
    };
    await db.collection(webCollections.prAssignments).insertOne(assignment);
    await db
      .collection(webCollections.prAgents)
      .updateOne(
        { prAgentId: best.agent.prAgentId },
        { $inc: { currentActivePatrons: 1 }, $set: { lastAssignedAt: now, updatedAt: now } }
      );
    timeline.push({
      eventType: "PRAssignmentCreated",
      actorType: "System",
      actorId: "pr-assignment-agent",
      payload: { prAgentId: best.agent.prAgentId, fitScore: best.fitScore },
      createdAt: now,
    });
  }
  timeline.push({
    eventType: "CaseClosed",
    actorType: "System",
    actorId: "risk-case-engine",
    payload: { finalStatus: "Assigned" },
    createdAt: now,
  });

  await db.collection(webCollections.riskCases).updateOne(
    { caseId },
    {
      $set: {
        status: assignment ? "Assigned" : "Approved",
        currentNode: "finalize_case",
        adminReview: {
          adminUserId: "ADM-001",
          adminDisplayName: "Default Admin",
          decision,
          rationale,
          requestedActions: [],
          createdAt: now,
        },
        timeline,
        updatedAt: now,
      },
    }
  );
  const updated = await db.collection(webCollections.riskCases).findOne({ caseId }, { projection: { _id: 0 } });
  return { case: updated, assignment };
}
