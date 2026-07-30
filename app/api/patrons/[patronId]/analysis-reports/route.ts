import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";
import type { PatronAnalysisReport } from "../../../../../src/types";

type Params = { params: Promise<{ patronId: string }> };

/**
 * GET /api/patrons/[patronId]/analysis-reports
 * Returns all analysis reports for a patron, newest first.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { patronId } = await params;
    const db = await getWebDb();

    const reports = await db
      .collection<PatronAnalysisReport>(webCollections.patronAnalysisReports)
      .find({ patronId }, { projection: { _id: 0 } })
      .sort({ generatedAt: -1 })
      .toArray();

    return NextResponse.json({ ok: true, patronId, reports });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
