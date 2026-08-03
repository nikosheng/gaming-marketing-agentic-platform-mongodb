import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";
import { runAlertAnalysis } from "../../../../../src/web/alert-analyzer";
import type { PatronProfile, TableRoundSnapshot } from "../../../../../src/types";

type Params = {
  params: Promise<{ tableId: string }>;
};

// ---------- Deterministic bet sequences for test patrons ----------
// Index = (roundNumber - 1) % 10  →  guaranteed to hit trigger at specific rounds
// Scenario 1 (CONSECUTIVE_ROUNDS_BET_THRESHOLD, threshold=10000):
//   rounds 1-3: each > 10000 → triggers on Round 3
//   rounds 4-5: below threshold to reset the streak
// Scenario 2 (CUMULATIVE_ROUNDS_BET_THRESHOLD, totalThreshold=50000, rounds=5):
//   rounds 1-5 total = 8000+9500+12000+14000+11000 = 54500 → triggers on Round 5
// Scenario 3 (SINGLE_ROUND_ADT_MULTIPLIER, multiplier=5, adt=3000 → threshold=15000):
//   every round bet=18000 > 15000 → triggers from Round 1

const TEST_BET_SEQUENCES: Record<string, number[]> = {
  "TEST-S1-P1": [12000, 15500, 11200, 5000, 8000, 12000, 15500, 11200, 5000, 8000],
  "TEST-S1-P2": [4000, 6000, 3500, 5000, 7000, 4000, 6000, 3500, 5000, 7000],
  "TEST-S2-P1": [8000, 9500, 12000, 14000, 11000, 8000, 9500, 12000, 14000, 11000],
  "TEST-S3-P1": [18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000],
  "TEST-S3-P2": [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
};

// ---------- Test patron profile seeds ----------

const TEST_PATRON_PROFILES: Array<Omit<PatronProfile, "_id" | "activities" | "preferenceEmbedding" | "createdAt" | "updatedAt">> = [
  {
    patronId: "TEST-S1-P1",
    name: "Test Alpha",
    maskedName: "T***AP",
    tier: "Gold",
    adt: 8500,
    preferredGames: ["Baccarat"],
    riskFlags: ["HighVariance"],
    pointsBalance: 45000,
    lastActiveAt: new Date(),
    region: "HongKong",
  },
  {
    patronId: "TEST-S1-P2",
    name: "Test Beta",
    maskedName: "T***BT",
    tier: "Bronze",
    adt: 2000,
    preferredGames: ["SicBo"],
    riskFlags: ["None"],
    pointsBalance: 3000,
    lastActiveAt: new Date(),
    region: "Macau",
  },
  {
    patronId: "TEST-S2-P1",
    name: "Test Gamma",
    maskedName: "T***GM",
    tier: "Silver",
    adt: 5200,
    preferredGames: ["Blackjack"],
    riskFlags: ["None"],
    pointsBalance: 12000,
    lastActiveAt: new Date(),
    region: "Guangdong",
  },
  {
    patronId: "TEST-S3-P1",
    name: "Test Delta",
    maskedName: "T***DT",
    tier: "Bronze",
    adt: 3000,
    preferredGames: ["Baccarat"],
    riskFlags: ["HighVariance"],
    pointsBalance: 5000,
    lastActiveAt: new Date(),
    region: "Guangdong",
  },
  {
    patronId: "TEST-S3-P2",
    name: "Test Epsilon",
    maskedName: "T***EP",
    tier: "Silver",
    adt: 3000,
    preferredGames: ["Roulette"],
    riskFlags: ["None"],
    pointsBalance: 8000,
    lastActiveAt: new Date(),
    region: "HongKong",
  },
];

// ---------- Helpers ----------

function randomBet(minBet: number): number {
  const multiplier = 3 + Math.floor(Math.random() * 12); // 3x–15x floor
  return minBet * multiplier;
}

async function upsertTestPatrons(db: Awaited<ReturnType<typeof import("../../../../../src/web/mongo").getWebDb>>) {
  const now = new Date();
  for (const patron of TEST_PATRON_PROFILES) {
    await db.collection(webCollections.patrons).updateOne(
      { patronId: patron.patronId },
      {
        $setOnInsert: {
          ...patron,
          activities: [],
          preferenceEmbedding: Array.from({ length: 1024 }, () => 0),
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }
}

// ---------- Route handler ----------

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    if (!tableId) {
      return NextResponse.json(
        { ok: false, error: "tableId is required" },
        { status: 400 }
      );
    }

    const db = await getWebDb();

    // 1. Fetch current table minBet
    const table = await db
      .collection(webCollections.tables)
      .findOne({ tableId }, { projection: { _id: 0, minBet: 1 } }) as { minBet?: number } | null;

    if (!table) {
      return NextResponse.json(
        { ok: false, error: `Table ${tableId} not found.` },
        { status: 404 }
      );
    }

    const minBet = table.minBet ?? 300;

    // 2. Increment round counter (atomic upsert)
    const counterResult = await db
      .collection(webCollections.tableRoundCounters)
      .findOneAndUpdate(
        { tableId },
        { $inc: { roundNumber: 1 } },
        { upsert: true, returnDocument: "after" }
      ) as { roundNumber?: number } | null;

    const roundNumber = counterResult?.roundNumber ?? 1;

    // 3. Ensure test patrons exist in patron_profiles
    await upsertTestPatrons(db);

    // 4. Build this round's sessions
    //    TEST patrons: deterministic bet from sequence
    //    SIM patrons: random
    const now = new Date();
    const allSessions: Array<{
      patronId: string;
      tableId: string;
      seatedAt: Date;
      lastActionAt: Date;
      sessionBetAmount: number;
      currentStackEstimate: number;
      behaviorTags: string[];
      isActive: boolean;
    }> = [];

    // Test patrons
    for (const [patronId, sequence] of Object.entries(TEST_BET_SEQUENCES)) {
      const betAmount = sequence[(roundNumber - 1) % sequence.length];
      allSessions.push({
        patronId,
        tableId,
        seatedAt: new Date(now.getTime() - 1000 * 60 * 60),
        lastActionAt: now,
        sessionBetAmount: betAmount,
        currentStackEstimate: Math.round(betAmount * (1.5 + Math.random())),
        behaviorTags: patronId.includes("S1") || patronId.includes("S3") ? ["Aggressive"] : ["Conservative"],
        isActive: true,
      });
    }

    // Random SIM patrons (4 extra seats)
    for (let i = 1; i <= 4; i++) {
      const bet = randomBet(minBet);
      allSessions.push({
        patronId: `SIM-RND-${String(i).padStart(3, "0")}`,
        tableId,
        seatedAt: new Date(now.getTime() - 1000 * 60 * 45),
        lastActionAt: now,
        sessionBetAmount: bet,
        currentStackEstimate: Math.round(bet * (1.2 + Math.random() * 2)),
        behaviorTags: Math.random() > 0.5 ? ["Aggressive"] : ["Conservative"],
        isActive: true,
      });
    }

    // 5. Upsert sessions into patron_table_sessions
    //    (delete existing for this tableId + these patronIds, then insert fresh)
    const patronIdsThisRound = allSessions.map((s) => s.patronId);
    await db
      .collection(webCollections.sessions)
      .deleteMany({ tableId, patronId: { $in: patronIdsThisRound } });
    await db.collection(webCollections.sessions).insertMany(allSessions);

    // 6. Write table_round_history snapshots
    //    Join with patron_profiles to get adt/tier/maskedName (and fallback for SIM patrons)
    const patronProfileMap = new Map<
      string,
      { adt: number; tier: string; maskedName: string; behaviorTags: string[] }
    >();

    const profiles = (await db
      .collection(webCollections.patrons)
      .find(
        { patronId: { $in: patronIdsThisRound } },
        { projection: { _id: 0, patronId: 1, adt: 1, tier: 1, maskedName: 1 } }
      )
      .toArray()) as unknown as Array<{ patronId: string; adt: number; tier: string; maskedName: string }>;

    for (const p of profiles) {
      patronProfileMap.set(p.patronId, {
        adt: p.adt,
        tier: p.tier,
        maskedName: p.maskedName,
        behaviorTags: [],
      });
    }

    const roundSnapshots: TableRoundSnapshot[] = allSessions.map((s) => {
      const profile = patronProfileMap.get(s.patronId);
      return {
        tableId,
        roundNumber,
        patronId: s.patronId,
        betAmount: s.sessionBetAmount,
        adt: profile?.adt ?? 1000,
        tier: profile?.tier ?? "Bronze",
        behaviorTags: s.behaviorTags,
        maskedName: profile?.maskedName ?? s.patronId,
        recordedAt: now,
      };
    });

    await db
      .collection(webCollections.tableRoundHistory)
      .insertMany(roundSnapshots as never[]);

    // 7. Run alert analysis against all active rules
    const triggeredAlerts = await runAlertAnalysis(db, tableId, roundNumber);

    const alertSummary = triggeredAlerts.map((a) => ({
      alertId: a.alertId,
      ruleId: a.ruleId,
      ruleName: a.ruleName,
      patronId: a.patronId,
      conditionTypes: a.triggeredConditions.map((tc) => tc.type),
    }));

    return NextResponse.json({
      ok: true,
      tableId,
      roundNumber,
      sessionsInjected: allSessions.length,
      alertsTriggered: alertSummary,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// ---------- GET: return current round number ----------

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    const db = await getWebDb();

    const counter = await db
      .collection(webCollections.tableRoundCounters)
      .findOne({ tableId }) as { roundNumber?: number } | null;

    return NextResponse.json({
      ok: true,
      tableId,
      roundNumber: counter?.roundNumber ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
