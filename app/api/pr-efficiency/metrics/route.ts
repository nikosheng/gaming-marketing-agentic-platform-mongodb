import { NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { getPrMetrics } from "../../../../src/web/pr-efficiency-agent";

/**
 * GET /api/pr-efficiency/metrics
 *
 * Returns aggregated interaction statistics for every PR agent,
 * used by the management PR Efficiency dashboard.
 */
export async function GET() {
  try {
    const db = await getWebDb();
    const metrics = await getPrMetrics(db);
    return NextResponse.json({ ok: true, metrics });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
