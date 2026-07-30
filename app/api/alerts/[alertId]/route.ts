import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";
import type { PatronAlert } from "../../../../src/types";

type Params = {
  params: Promise<{ alertId: string }>;
};

/**
 * DELETE /api/alerts/[alertId]
 *
 * Resolves an alert by deleting ALL alerts for the same patronId.
 * This clears the patron from ongoing tracking so they can be
 * re-triggered fresh on the next simulate-round call.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { alertId } = await params;

    const db = await getWebDb();
    const col = db.collection<PatronAlert>(webCollections.patronAlerts);

    // Find the alert first to get the patronId
    const alert = await col.findOne({ alertId });
    if (!alert) {
      return NextResponse.json(
        { ok: false, error: "Alert not found" },
        { status: 404 }
      );
    }

    const { patronId } = alert;

    // Delete ALL alerts for this patron so they start fresh
    const result = await col.deleteMany({ patronId });

    return NextResponse.json({
      ok: true,
      patronId,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
