import { NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";

type Params = {
  params: Promise<{ tableId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { tableId } = await params;
    if (!tableId) {
      return NextResponse.json(
        { ok: false, error: "tableId is required" },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const recommendations = await db
      .collection(webCollections.minBetRecommendations)
      .find(
        { tableId },
        {
          projection: {
            _id: 0,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      ok: true,
      tableId,
      recommendations,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
