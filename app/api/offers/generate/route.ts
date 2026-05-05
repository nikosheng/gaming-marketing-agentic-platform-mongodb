import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { patronId?: string };
    if (!body.patronId) {
      return NextResponse.json(
        {
          ok: false,
          error: "patronId is required",
        },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const patron = await db
      .collection(webCollections.patrons)
      .findOne({ patronId: body.patronId }, { projection: { _id: 0 } });
    if (!patron) {
      return NextResponse.json(
        {
          ok: false,
          error: "Patron not found",
        },
        { status: 404 }
      );
    }

    const offers = await db
      .collection(webCollections.offers)
      .find({}, { projection: { _id: 0 } })
      .limit(100)
      .toArray();

    const topOffers = offers
      .map((offer) => ({
        offerId: offer.offerId,
        title: offer.title,
        offerType: offer.offerType,
        score: cosineSimilarity(
          patron.preferenceEmbedding as number[],
          (offer.offerEmbedding as number[]) ?? []
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return NextResponse.json({
      ok: true,
      patron: {
        patronId: patron.patronId,
        tier: patron.tier,
        adt: patron.adt,
      },
      generatedOffers: topOffers,
      generator: "similarity-fallback",
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
