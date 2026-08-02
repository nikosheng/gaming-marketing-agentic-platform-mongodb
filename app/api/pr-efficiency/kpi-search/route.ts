import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { runKpiSearch } from "../../../../src/web/pr-efficiency-agent";

/**
 * POST /api/pr-efficiency/kpi-search
 *
 * Accepts a KPI description (free text or pre-defined template),
 * runs a single Atlas Vector Search across all interaction records,
 * groups results by PR agent, then generates LLM management insight.
 *
 * Body: { kpiText: string }
 *
 * Returns: { ok: true, result: KpiSearchResult }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { kpiText?: string };

    if (!body.kpiText || body.kpiText.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: "kpiText is required" },
        { status: 400 }
      );
    }

    // Voyage AI is required for vector search
    if (!process.env.VOYAGE_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "VOYAGE_API_KEY is not configured — vector search unavailable." },
        { status: 503 }
      );
    }

    const db = await getWebDb();
    const result = await runKpiSearch(db, body.kpiText.trim());

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
