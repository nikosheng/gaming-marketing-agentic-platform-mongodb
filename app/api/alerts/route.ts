import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../src/web/mongo";
import { webCollections } from "../../../src/web/collections";
import type { PatronAlert } from "../../../src/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get("tableId") ?? undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam))) : 50;

    const db = await getWebDb();

    const filter: Record<string, unknown> = {};
    if (tableId) filter.tableId = tableId;

    const alerts = await db
      .collection<PatronAlert>(webCollections.patronAlerts)
      .find(filter)
      .sort({ triggeredAt: -1 })
      .limit(limit)
      .toArray();

    // Compute summary stats
    const total = alerts.length;
    const newCount = alerts.filter((a) => a.status === "New").length;

    const byRule: Record<string, number> = {};
    for (const a of alerts) {
      byRule[a.ruleName] = (byRule[a.ruleName] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      alerts,
      stats: { total, newCount, byRule },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
