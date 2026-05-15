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
    const recommendation = await db
      .collection(webCollections.minBetRecommendations)
      .findOne({ recommendationId: recId, tableId });

    if (!recommendation) {
      return NextResponse.json(
        { ok: false, error: "Recommendation not found" },
        { status: 404 }
      );
    }
    if (recommendation.status !== "Proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: `Recommendation is ${recommendation.status} and cannot be applied`,
        },
        { status: 409 }
      );
    }
    const expiresAt = recommendation.expiresAt instanceof Date
      ? recommendation.expiresAt
      : new Date(recommendation.expiresAt);
    if (expiresAt.getTime() < Date.now()) {
      await db
        .collection(webCollections.minBetRecommendations)
        .updateOne(
          { recommendationId: recId },
          { $set: { status: "Expired", reviewedAt: new Date(), reviewedBy: actorId } }
        );
      return NextResponse.json(
        { ok: false, error: "Recommendation has expired" },
        { status: 410 }
      );
    }

    const oldMinBet = Number(recommendation.currentMinBet ?? 0);
    const newMinBet = Number(recommendation.recommendedMinBet ?? 0);
    if (newMinBet <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid recommended min bet" },
        { status: 400 }
      );
    }

    const now = new Date();

    await db
      .collection(webCollections.tables)
      .updateOne(
        { tableId },
        { $set: { minBet: newMinBet, refreshedAt: now } }
      );

    await db.collection(webCollections.minBetAudit).insertOne({
      tableId,
      oldMinBet,
      newMinBet,
      source: "Agent",
      recommendationId: recId,
      actorId,
      at: now,
    });

    await db
      .collection(webCollections.minBetRecommendations)
      .updateOne(
        { recommendationId: recId },
        {
          $set: {
            status: "Applied",
            reviewedBy: actorId,
            reviewedAt: now,
          },
        }
      );

    return NextResponse.json({
      ok: true,
      tableId,
      recommendationId: recId,
      oldMinBet,
      newMinBet,
      appliedAt: now.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
