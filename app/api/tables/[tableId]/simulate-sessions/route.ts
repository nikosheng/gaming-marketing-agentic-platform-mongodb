import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";

type Params = {
  params: Promise<{ tableId: string }>;
};

type SimulateScenario = "full-high" | "full-mixed" | "low-sticky" | "empty";

type RequestBody = {
  scenario?: SimulateScenario;
};

// ---------- Session generator ----------

function buildSession(
  tableId: string,
  index: number,
  sessionBetAmount: number
) {
  const now = new Date();
  return {
    patronId: `SIM-${String(index + 1).padStart(3, "0")}`,
    tableId,
    seatedAt: new Date(now.getTime() - 1000 * 60 * (30 + index * 3)),
    lastActionAt: new Date(now.getTime() - 1000 * 60 * index),
    sessionBetAmount,
    currentStackEstimate: Math.round(sessionBetAmount * (1.2 + Math.random() * 2)),
    behaviorTags: ["Aggressive"],
    isActive: true,
  };
}

function generateSessions(
  tableId: string,
  minBet: number,
  scenario: SimulateScenario
) {
  if (scenario === "empty") return [];

  if (scenario === "full-high") {
    // 9 patrons, all betting 8x–25x floor → lowBetShare ≈ 0%
    return Array.from({ length: 9 }, (_, i) => {
      const multiplier = 8 + Math.floor(Math.random() * 18); // 8..25
      return buildSession(tableId, i, minBet * multiplier);
    });
  }

  if (scenario === "full-mixed") {
    // 9 patrons: first 2 bet right at floor (1.0x–1.15x), rest 3x–10x
    // → lowBetShare ≈ 22%
    return Array.from({ length: 9 }, (_, i) => {
      const amount =
        i < 2
          ? Math.round(minBet * (1.0 + Math.random() * 0.15)) // near floor
          : minBet * (3 + Math.floor(Math.random() * 8));     // 3x–10x
      return buildSession(tableId, i, amount);
    });
  }

  // low-sticky: 3 patrons, all high bets (6x–15x floor)
  return Array.from({ length: 3 }, (_, i) => {
    const multiplier = 6 + Math.floor(Math.random() * 10); // 6..15
    return buildSession(tableId, i, minBet * multiplier);
  });
}

// ---------- Route handler ----------

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    if (!tableId) {
      return NextResponse.json(
        { ok: false, error: "tableId is required" },
        { status: 400 }
      );
    }

    let scenario: SimulateScenario = "full-high";
    try {
      const body = (await request.json()) as RequestBody;
      if (body?.scenario) scenario = body.scenario;
    } catch {
      // body is optional
    }

    const db = await getWebDb();

    // 1. Fetch current minBet so we can scale bets relative to the floor.
    const table = await db
      .collection(webCollections.tables)
      .findOne(
        { tableId },
        { projection: { _id: 0, minBet: 1 } }
      ) as { minBet?: number } | null;

    if (!table) {
      return NextResponse.json(
        { ok: false, error: `Table ${tableId} not found.` },
        { status: 404 }
      );
    }

    const minBet = table.minBet ?? 300;

    // 2. Delete all active sessions for this table.
    await db
      .collection(webCollections.sessions)
      .deleteMany({ tableId, isActive: true });

    // 3. Clear cooldown audit entries so the optimizer is not blocked by
    //    the 20-minute cooldown window during simulation.
    await db
      .collection(webCollections.minBetAudit)
      .deleteMany({ tableId });

    // 4. Clear trend history for this table so stale high-occupancy snapshots
    //    cannot inflate trend.velocity and push demandSignal above 0.65.
    //    The optimizer will compute trend from a clean slate after injection.
    await db
      .collection(webCollections.tableStateHistory)
      .deleteMany({ tableId });

    // 4. Generate and insert new simulated sessions.
    const sessions = generateSessions(tableId, minBet, scenario);
    if (sessions.length > 0) {
      await db.collection(webCollections.sessions).insertMany(sessions);
    }

    // 5. Compute summary stats for the response.
    const injectedCount = sessions.length;
    const avgBet =
      injectedCount > 0
        ? Math.round(
            sessions.reduce((sum, s) => sum + s.sessionBetAmount, 0) /
              injectedCount
          )
        : 0;
    const occupancyRate = Number(Math.min(1, injectedCount / 9).toFixed(3));

    return NextResponse.json({
      ok: true,
      scenario,
      injectedCount,
      avgBet,
      occupancyRate,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
