import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";

type Params = {
  params: Promise<{ tableId: string }>;
};

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    const db = await getWebDb();

    const pipeline = [
      { $match: { tableId, isActive: true } },
      { $sort: { sessionBetAmount: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: webCollections.patrons,
          localField: "patronId",
          foreignField: "patronId",
          as: "patron",
        },
      },
      { $unwind: "$patron" },
      {
        $project: {
          _id: 0,
          patronId: "$patron.patronId",
          maskedName: "$patron.maskedName",
          tier: "$patron.tier",
          adt: "$patron.adt",
          pointsBalance: "$patron.pointsBalance",
          region: "$patron.region",
          sessionBetAmount: 1,
          currentStackEstimate: 1,
          behaviorTags: 1,
          lastActionAt: 1,
        },
      },
    ];

    const patrons = await db.collection(webCollections.sessions).aggregate(pipeline).toArray();

    return NextResponse.json({
      ok: true,
      tableId,
      patronCount: patrons.length,
      patrons,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
