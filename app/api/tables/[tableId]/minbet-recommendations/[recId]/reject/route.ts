import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../../../src/web/mongo";
import { webCollections } from "../../../../../../../src/web/collections";

type Params = {
  params: Promise<{ tableId: string; recId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tableId, recId } = await params;
    if (!tableId || !recId) {
      return NextResponse.json(
        { ok: false, error: "tableId and recId are required" },
        { status: 400 }
      );
    }

    let actorId = "console-user";
    try {
      const body = (await request.json()) as { actorId?: string };
      if (body?.actorId) actorId = body.actorId;
    } catch {
      // body optional
    }

    const db = await getWebDb();
    const result = await db
      .collection(webCollections.minBetRecommendations)
      .findOneAndUpdate(
        { recommendationId: recId, tableId, status: "Proposed" },
        {
          $set: {
            status: "Rejected",
            reviewedBy: actorId,
            reviewedAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Recommendation not found or already reviewed" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      recommendationId: recId,
      status: "Rejected",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
