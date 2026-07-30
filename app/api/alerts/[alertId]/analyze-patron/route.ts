import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";
import { runPatronProfileAnalysis } from "../../../../../src/web/patron-profile-agent";
import type { PatronAlert, PatronAnalysisReport } from "../../../../../src/types";

type Params = { params: Promise<{ alertId: string }> };

/**
 * POST /api/alerts/[alertId]/analyze-patron
 *
 * Triggers LLM-powered patron history analysis for the patron linked to
 * the given alert. Returns a cached report if one already exists for this
 * alertId.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { alertId } = await params;

    if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Azure OpenAI is not configured." },
        { status: 503 }
      );
    }

    const db = await getWebDb();

    // Check for existing cached report for this alertId
    const existing = await db
      .collection<PatronAnalysisReport>(webCollections.patronAnalysisReports)
      .findOne({ triggeredByAlertId: alertId }, { projection: { _id: 0 } });

    if (existing) {
      return NextResponse.json({ ok: true, report: existing, cached: true });
    }

    // Fetch the alert to get patronId
    const alert = await db
      .collection<PatronAlert>(webCollections.patronAlerts)
      .findOne({ alertId }, { projection: { _id: 0, patronId: 1 } });

    if (!alert) {
      return NextResponse.json(
        { ok: false, error: "Alert not found" },
        { status: 404 }
      );
    }

    // Run the LLM analysis
    const report = await runPatronProfileAnalysis(db, alert.patronId, alertId);

    return NextResponse.json({ ok: true, report, cached: false }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
