import { NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";

export async function GET() {
  try {
    const db = await getWebDb();

    const [offers, recommendations, recentActivities] = await Promise.all([
      db
        .collection(webCollections.offers)
        .find(
          {},
          {
            projection: {
              _id: 0,
              offerId: 1,
              offerType: 1,
              title: 1,
              status: 1,
              priority: 1,
              estimatedCost: 1,
            },
          }
        )
        .sort({ priority: -1 })
        .limit(20)
        .toArray(),
      db
        .collection(webCollections.recommendations)
        .find(
          {},
          {
            projection: {
              _id: 0,
              recommendationId: 1,
              patronId: 1,
              offerId: 1,
              relevanceScore: 1,
              confidence: 1,
              status: 1,
              generatedAt: 1,
              expiresAt: 1,
              reasonSummary: 1,
              nextBestAction: 1,
            },
          }
        )
        .sort({ generatedAt: -1 })
        .limit(40)
        .toArray(),
      db
        .collection(webCollections.patrons)
        .aggregate([
          { $unwind: "$activities" },
          {
            $project: {
              _id: 0,
              eventId: "$activities.eventId",
              patronId: "$patronId",
              activityType: "$activities.activityType",
              source: "$activities.source",
              amount: "$activities.amount",
              pointsDelta: "$activities.pointsDelta",
              eventTime: "$activities.eventTime",
            },
          },
          { $sort: { eventTime: -1 } },
        ])
        .limit(40)
        .toArray(),
    ]);

    const statusCounts = recommendations.reduce<Record<string, number>>((acc, rec) => {
      const key = rec.status ?? "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      summary: {
        offerCount: offers.length,
        recommendationCount: recommendations.length,
        recentActivityCount: recentActivities.length,
        recommendationStatusCounts: statusCounts,
      },
      offers,
      recommendations,
      recentActivities,
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
