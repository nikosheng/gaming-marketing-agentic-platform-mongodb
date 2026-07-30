import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";
import type { ReportStatus, PatronAnalysisReport } from "../../../../../src/types";

type Params = { params: Promise<{ reportId: string }> };

const VALID_STATUSES: ReportStatus[] = ["Draft", "Acknowledged", "Actioned"];

/**
 * PATCH /api/analysis-reports/[reportId]/status
 * Updates the status of a patron analysis report.
 *
 * Body: { status: "Acknowledged" | "Actioned" }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { reportId } = await params;
    const body = (await req.json()) as { status?: ReportStatus };

    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { ok: false, error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getWebDb();

    const result = await db
      .collection<PatronAnalysisReport>(webCollections.patronAnalysisReports)
      .findOneAndUpdate(
        { reportId },
        { $set: { status: body.status } },
        { returnDocument: "after", projection: { _id: 0 } }
      );

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Report not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, report: result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
