import { Db } from "mongodb";
import type { AlertRule, ConditionType, PatronAlert, TableRoundSnapshot } from "../types";
import { webCollections } from "./collections";
import { chatText } from "./llm/gateway";

// ---------- Types ----------

interface ConditionHit {
  patronId: string;
  tier: string;
  adt: number;
  maskedName: string;
  evidence: Record<string, unknown>;
}

interface TriggeredPatron {
  patronId: string;
  triggeredConditions: Array<{
    type: ConditionType;
    evidence: Record<string, unknown>;
  }>;
}

// ---------- MQL Executors (one per ConditionType) ----------

async function execConsecutiveRoundsBetThreshold(
  db: Db,
  tableId: string,
  roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const rounds = Number(params.rounds ?? 3);
  const threshold = Number(params.threshold ?? 10000);
  const fromRound = roundNumber - rounds + 1;

  const rows = await db
    .collection(webCollections.tableRoundHistory)
    .aggregate<{
      _id: string;
      count: number;
      minBet: number;
      bets: Array<{ round: number; amount: number }>;
      tier: string;
      adt: number;
      maskedName: string;
    }>([
      {
        $match: {
          tableId,
          roundNumber: { $gte: fromRound, $lte: roundNumber },
        },
      },
      {
        $group: {
          _id: "$patronId",
          count: { $sum: 1 },
          minBet: { $min: "$betAmount" },
          bets: { $push: { round: "$roundNumber", amount: "$betAmount" } },
          tier: { $first: "$tier" },
          adt: { $first: "$adt" },
          maskedName: { $first: "$maskedName" },
        },
      },
      {
        $match: {
          count: { $gte: rounds },
          minBet: { $gt: threshold },
        },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r._id,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
      rounds,
      threshold,
      consecutiveRounds: r.count,
      minBet: r.minBet,
      bets: r.bets.sort((a, b) => a.round - b.round),
    },
  }));
}

async function execCumulativeRoundsBetThreshold(
  db: Db,
  tableId: string,
  roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const rounds = Number(params.rounds ?? 5);
  const totalThreshold = Number(params.totalThreshold ?? 50000);
  const fromRound = roundNumber - rounds + 1;

  const rows = await db
    .collection(webCollections.tableRoundHistory)
    .aggregate<{
      _id: string;
      count: number;
      total: number;
      bets: number[];
      tier: string;
      adt: number;
      maskedName: string;
    }>([
      {
        $match: {
          tableId,
          roundNumber: { $gte: fromRound, $lte: roundNumber },
        },
      },
      {
        $group: {
          _id: "$patronId",
          count: { $sum: 1 },
          total: { $sum: "$betAmount" },
          bets: { $push: "$betAmount" },
          tier: { $first: "$tier" },
          adt: { $first: "$adt" },
          maskedName: { $first: "$maskedName" },
        },
      },
      {
        $match: {
          count: { $gte: rounds },
          total: { $gt: totalThreshold },
        },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r._id,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "CUMULATIVE_ROUNDS_BET_THRESHOLD",
      rounds,
      totalThreshold,
      actualRounds: r.count,
      totalBet: r.total,
      bets: r.bets,
    },
  }));
}

async function execSingleRoundAdtMultiplier(
  db: Db,
  tableId: string,
  roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const multiplier = Number(params.multiplier ?? 5);

  const rows = await db
    .collection(webCollections.tableRoundHistory)
    .aggregate<{
      patronId: string;
      betAmount: number;
      adt: number;
      tier: string;
      maskedName: string;
    }>([
      {
        $match: { tableId, roundNumber },
      },
      {
        $match: {
          $expr: {
            $gt: ["$betAmount", { $multiply: ["$adt", multiplier] }],
          },
        },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r.patronId,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "SINGLE_ROUND_ADT_MULTIPLIER",
      multiplier,
      betAmount: r.betAmount,
      adt: r.adt,
      adtRatio: r.adt > 0 ? Number((r.betAmount / r.adt).toFixed(2)) : null,
      adtThreshold: r.adt * multiplier,
    },
  }));
}

async function execSessionBetAbove(
  db: Db,
  tableId: string,
  _roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const threshold = Number(params.threshold ?? 30000);

  // Join sessions with patron_profiles to get tier/adt/maskedName
  const rows = await db
    .collection(webCollections.sessions)
    .aggregate<{
      patronId: string;
      sessionBetAmount: number;
      tier: string;
      adt: number;
      maskedName: string;
    }>([
      {
        $match: {
          tableId,
          isActive: true,
          sessionBetAmount: { $gt: threshold },
        },
      },
      {
        $lookup: {
          from: webCollections.patrons,
          localField: "patronId",
          foreignField: "patronId",
          as: "patron",
        },
      },
      {
        $unwind: { path: "$patron", preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          _id: 0,
          patronId: 1,
          sessionBetAmount: 1,
          tier: { $ifNull: ["$patron.tier", "Bronze"] },
          adt: { $ifNull: ["$patron.adt", 0] },
          maskedName: { $ifNull: ["$patron.maskedName", "$patronId"] },
        },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r.patronId,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "SESSION_BET_ABOVE",
      threshold,
      sessionBetAmount: r.sessionBetAmount,
    },
  }));
}

async function execTierMatch(
  db: Db,
  tableId: string,
  roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const tiers = Array.isArray(params.tiers)
    ? (params.tiers as string[])
    : ["Gold", "Platinum", "Diamond"];

  const rows = await db
    .collection(webCollections.tableRoundHistory)
    .aggregate<{
      patronId: string;
      betAmount: number;
      tier: string;
      adt: number;
      maskedName: string;
    }>([
      {
        $match: { tableId, roundNumber, tier: { $in: tiers } },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r.patronId,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "TIER_MATCH",
      matchedTiers: tiers,
      patronTier: r.tier,
      betAmount: r.betAmount,
    },
  }));
}

async function execBehaviorTagMatch(
  db: Db,
  tableId: string,
  roundNumber: number,
  params: Record<string, number | string | string[]>
): Promise<ConditionHit[]> {
  const tags = Array.isArray(params.tags) ? (params.tags as string[]) : ["Aggressive"];

  const rows = await db
    .collection(webCollections.tableRoundHistory)
    .aggregate<{
      patronId: string;
      betAmount: number;
      tier: string;
      adt: number;
      maskedName: string;
      behaviorTags: string[];
    }>([
      {
        $match: { tableId, roundNumber, behaviorTags: { $in: tags } },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    patronId: r.patronId,
    tier: r.tier,
    adt: r.adt,
    maskedName: r.maskedName,
    evidence: {
      conditionType: "BEHAVIOR_TAG_MATCH",
      requiredTags: tags,
      matchedTags: r.behaviorTags.filter((t) => tags.includes(t)),
      betAmount: r.betAmount,
    },
  }));
}

// ---------- Executor dispatch ----------

const EXECUTORS: Record<
  ConditionType,
  (
    db: Db,
    tableId: string,
    roundNumber: number,
    params: Record<string, number | string | string[]>
  ) => Promise<ConditionHit[]>
> = {
  CONSECUTIVE_ROUNDS_BET_THRESHOLD: execConsecutiveRoundsBetThreshold,
  CUMULATIVE_ROUNDS_BET_THRESHOLD: execCumulativeRoundsBetThreshold,
  SINGLE_ROUND_ADT_MULTIPLIER: execSingleRoundAdtMultiplier,
  SESSION_BET_ABOVE: execSessionBetAbove,
  TIER_MATCH: execTierMatch,
  BEHAVIOR_TAG_MATCH: execBehaviorTagMatch,
};

// ---------- Optional LLM rationale ----------

async function generateAlertRationale(
  patronSnapshot: PatronAlert["patronSnapshot"],
  triggeredConditions: PatronAlert["triggeredConditions"],
  tableSnapshot: PatronAlert["tableSnapshot"]
): Promise<string | null> {
  const conditionSummary = triggeredConditions
    .map((tc) => {
      const ev = tc.evidence as Record<string, unknown>;
      switch (tc.type) {
        case "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
          return `連續 ${ev.consecutiveRounds} 輪下注均超 HKD ${ev.threshold?.toLocaleString()}（最低一輪 HKD ${ev.minBet?.toLocaleString()}）`;
        case "CUMULATIVE_ROUNDS_BET_THRESHOLD":
          return `${ev.actualRounds} 輪累計下注 HKD ${(ev.totalBet as number)?.toLocaleString()}（閾值 HKD ${ev.totalThreshold?.toLocaleString()}）`;
        case "SINGLE_ROUND_ADT_MULTIPLIER":
          return `本輪下注 HKD ${(ev.betAmount as number)?.toLocaleString()}，為個人 ADT 的 ${ev.adtRatio} 倍（閾值 ${ev.multiplier} 倍）`;
        case "SESSION_BET_ABOVE":
          return `本場累計下注 HKD ${(ev.sessionBetAmount as number)?.toLocaleString()}（閾值 HKD ${ev.threshold?.toLocaleString()}）`;
        default:
          return tc.type;
      }
    })
    .join("；");

  const userPrompt = `賭場 AI 告警系統識別到一名高價值賭客。
賭客: ${patronSnapshot.maskedName}（${patronSnapshot.tier} 會員，ADT HKD ${patronSnapshot.adt.toLocaleString()}）
桌台: ${tableSnapshot.tableName}（${tableSnapshot.gameType}，${tableSnapshot.zone}）
觸發條件: ${conditionSummary}
行為標籤: ${patronSnapshot.behaviorTags.join("、") || "無"}

請用 1-2 句繁體中文寫出這個告警的重要性，並給出一個具體的服務建議（例如：立即安排 VIP 專員介入，提供XXX服務）。字數控制在 50 字以內。`;

  return chatText({
    system: "你是賭場貴賓服務 AI，專責識別高價值客戶並給出簡短服務建議。",
    user: userPrompt,
    temperature: 0.4,
    maxTokens: 120,
  });
}

// ---------- Main: analyze one rule with OR logic ----------

export async function analyzeRule(
  db: Db,
  rule: AlertRule,
  tableId: string,
  roundNumber: number
): Promise<TriggeredPatron[]> {
  // Run all conditions in parallel (OR logic)
  const allHits = await Promise.all(
    rule.conditions.map((cond) => {
      const executor = EXECUTORS[cond.type];
      if (!executor) return Promise.resolve([] as ConditionHit[]);
      return executor(db, tableId, roundNumber, cond.params).then((hits) =>
        hits.map((h) => ({ ...h, conditionType: cond.type }))
      );
    })
  );

  // Merge by patronId (OR: any condition hit counts)
  const byPatron = new Map<
    string,
    { patronId: string; triggeredConditions: Array<{ type: ConditionType; evidence: Record<string, unknown> }> }
  >();

  for (let i = 0; i < allHits.length; i++) {
    const condType = rule.conditions[i].type;
    for (const hit of allHits[i]) {
      if (!byPatron.has(hit.patronId)) {
        byPatron.set(hit.patronId, { patronId: hit.patronId, triggeredConditions: [] });
      }
      byPatron.get(hit.patronId)!.triggeredConditions.push({
        type: condType,
        evidence: hit.evidence,
      });
    }
  }

  return Array.from(byPatron.values());
}

// ---------- Main: run all active rules and write patron_alerts ----------

export async function runAlertAnalysis(
  db: Db,
  tableId: string,
  roundNumber: number
): Promise<PatronAlert[]> {
  // Fetch all active rules
  const rules = await db
    .collection<AlertRule>(webCollections.alertRules)
    .find({ status: "Active" })
    .toArray();

  if (rules.length === 0) return [];

  // Fetch table snapshot for alert records
  const tableDoc = await db
    .collection(webCollections.tables)
    .findOne(
      { tableId },
      { projection: { _id: 0, tableName: 1, gameType: 1, zone: 1 } }
    ) as { tableName?: string; gameType?: string; zone?: string } | null;

  const tableSnapshot = {
    tableName: tableDoc?.tableName ?? tableId,
    gameType: tableDoc?.gameType ?? "Unknown",
    zone: tableDoc?.zone ?? "Unknown",
  };

  // Run all rules in parallel
  const ruleResults = await Promise.all(
    rules.map(async (rule) => {
      const triggered = await analyzeRule(db, rule, tableId, roundNumber);
      return { rule, triggered };
    })
  );

  // Collect all unique patronIds that need profile lookup
  const allPatronIds = new Set<string>();
  for (const { triggered } of ruleResults) {
    for (const t of triggered) allPatronIds.add(t.patronId);
  }

  // Batch fetch patron profiles
  const patronProfiles = new Map<
    string,
    { maskedName: string; tier: string; adt: number; behaviorTags: string[]; riskFlags: string[]; preferredGames: string[] }
  >();

  if (allPatronIds.size > 0) {
    const profileDocs = await db
      .collection(webCollections.patrons)
      .find(
        { patronId: { $in: Array.from(allPatronIds) } },
        {
          projection: {
            _id: 0,
            patronId: 1,
            maskedName: 1,
            tier: 1,
            adt: 1,
            behaviorTags: 1,
            riskFlags: 1,
            preferredGames: 1,
          },
        }
      )
      .toArray();
    type PatronDoc = {
      patronId: string; maskedName: string; tier: string; adt: number;
      behaviorTags?: string[]; riskFlags?: string[]; preferredGames?: string[];
    };
    const profiles = profileDocs as unknown as PatronDoc[];

    for (const p of profiles) {
      patronProfiles.set(p.patronId, {
        maskedName: p.maskedName,
        tier: p.tier,
        adt: p.adt,
        behaviorTags: p.behaviorTags ?? [],
        riskFlags: p.riskFlags ?? [],
        preferredGames: p.preferredGames ?? [],
      });
    }

    // Fallback for TEST patrons not in patron_profiles: use round history snapshot
    for (const patronId of allPatronIds) {
      if (!patronProfiles.has(patronId)) {
        const snap = await db
          .collection<TableRoundSnapshot>(webCollections.tableRoundHistory)
          .findOne({ tableId, patronId }, { sort: { roundNumber: -1 } });
        if (snap) {
          patronProfiles.set(patronId, {
            maskedName: snap.maskedName,
            tier: snap.tier,
            adt: snap.adt,
            behaviorTags: snap.behaviorTags,
            riskFlags: [],
            preferredGames: [],
          });
        }
      }
    }
  }

  // Build PatronAlert documents
  const alertsToInsert: PatronAlert[] = [];
  const now = new Date();

  for (const { rule, triggered } of ruleResults) {
    if (triggered.length === 0) continue;

    for (const tp of triggered) {
      const profile = patronProfiles.get(tp.patronId);
      const patronSnapshot = profile ?? {
        maskedName: tp.patronId,
        tier: "Unknown",
        adt: 0,
        behaviorTags: [],
        riskFlags: [],
        preferredGames: [],
      };

      const alert: PatronAlert = {
        alertId: `ALERT-${now.getTime()}-${tp.patronId}-${rule.ruleId}`.replace(/[^A-Z0-9-]/gi, "-"),
        ruleId: rule.ruleId,
        ruleName: rule.name,
        patronId: tp.patronId,
        tableId,
        triggeredConditions: tp.triggeredConditions,
        patronSnapshot,
        tableSnapshot,
        status: "New",
        triggeredAt: now,
      };

      // Optional LLM rationale (non-blocking)
      const rationale = await generateAlertRationale(
        patronSnapshot,
        tp.triggeredConditions,
        tableSnapshot
      ).catch(() => null);
      if (rationale) alert.llmRationale = rationale;

      alertsToInsert.push(alert);
    }

    // Update rule stats
    if (triggered.length > 0) {
      await db
        .collection(webCollections.alertRules)
        .updateOne(
          { ruleId: rule.ruleId },
          { $inc: { totalTriggered: triggered.length }, $set: { lastTriggeredAt: now } }
        );
    }
  }

  if (alertsToInsert.length > 0) {
    await db.collection(webCollections.patronAlerts).insertMany(alertsToInsert as never[]);
  }

  return alertsToInsert;
}
