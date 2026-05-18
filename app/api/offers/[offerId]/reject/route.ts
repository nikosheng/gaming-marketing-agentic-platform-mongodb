import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";

type Params = {
  params: Promise<{ offerId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json(
        { ok: false, error: "offerId is required" },
        { status: 400 }
      );
    }

    let actorId = "console-user";
    let rationale = "";
    try {
      const body = (await request.json()) as { actorId?: string; rationale?: string };
      if (body?.actorId) actorId = body.actorId;
      if (typeof body?.rationale === "string") rationale = body.rationale.trim();
    } catch {
      // body optional but rationale required below
    }

    if (!rationale) {
      return NextResponse.json(
        { ok: false, error: "rationale is required to reject an offer" },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const offer = await db
      .collection(webCollections.offers)
      .findOne({ offerId }, { projection: { _id: 0, status: 1, offerId: 1 } });

    if (!offer) {
      return NextResponse.json(
        { ok: false, error: "Offer not found" },
        { status: 404 }
      );
    }
    if (offer.status !== "Proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: `Offer status is ${offer.status}; only Proposed offers can be rejected`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    await db.collection(webCollections.offers).updateOne(
      { offerId },
      {
        $set: {
          status: "Rejected",
          updatedAt: now,
          approvalReview: {
            decision: "Reject",
            rationale,
            actorId,
            decidedAt: now,
          },
        },
      }
    );

    await db.collection(webCollections.offerApprovalAudit).insertOne({
      offerId,
      fromStatus: "Proposed",
      toStatus: "Rejected",
      decision: "Reject",
      actorId,
      rationale,
      decidedAt: now,
    });

    const updated = await db
      .collection(webCollections.offers)
      .findOne(
        { offerId },
        {
          projection: {
            _id: 0,
            offerId: 1,
            offerType: 1,
            title: 1,
            status: 1,
            priority: 1,
            estimatedCost: 1,
            createdBy: 1,
            approvalReview: 1,
          },
        }
      );

    return NextResponse.json({ ok: true, offer: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
