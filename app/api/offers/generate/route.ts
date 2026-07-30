import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";

// ---------- Math helpers ----------

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

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

/**
 * Atlas $vectorSearch with cosine returns score = (1 + cos(theta)) / 2.
 *   orthogonal  -> 0.5
 *   identical   -> 1.0
 * The stretch maps 0.5 -> 0 and 1.0 -> 1 so the UI sees a wider spread.
 */
function stretchVector(atlasScore: number): number {
  return clamp01(2 * (atlasScore - 0.5));
}

// ---------- Rule scoring ----------

type PatronContext = {
  tier?: string;
  adt?: number;
  preferredGames?: string[];
  pointsBalance?: number;
};

type OfferContext = {
  offerType?: string;
  targetGameTypes?: string[];
  estimatedCost?: number;
};

function computeRuleScore(
  patron: PatronContext,
  offer: OfferContext
): { rulePart: number; signals: string[] } {
  const signals: string[] = [];
  const tier = (patron.tier ?? "Bronze").toString();
  const preferredGames = patron.preferredGames ?? [];
  const targets = offer.targetGameTypes ?? [];

  // game_overlap: 0 or 1 based on intersection
  let gameOverlap = 0;
  const overlap = targets.filter((g) => preferredGames.includes(g));
  if (overlap.length > 0) {
    gameOverlap = 1;
    signals.push(`game-fit:${overlap[0]}`);
  }

  // tier_eligibility: 0..1 depending on offer type and patron tier
  const premiumTiers = ["Diamond", "Platinum", "Gold"];
  let tierFit = 0.4; // small baseline for any tier
  if (
    (offer.offerType === "HotelRoom" || offer.offerType === "MusicShowTicket") &&
    premiumTiers.includes(tier)
  ) {
    tierFit = 1;
    signals.push(`tier-${tier.toLowerCase()}`);
  } else if (
    offer.offerType === "FNBVoucher" ||
    offer.offerType === "PointsLimitedTime"
  ) {
    tierFit = premiumTiers.includes(tier) ? 1 : 0.7;
    signals.push(`tier-${tier.toLowerCase()}`);
  }

  // points_fit: relevant only for PointsLimitedTime offers
  let pointsFit = 0.5;
  if (offer.offerType === "PointsLimitedTime") {
    if ((patron.pointsBalance ?? 0) >= 10000) {
      pointsFit = 1;
      signals.push("points-rich");
    } else if ((patron.pointsBalance ?? 0) >= 3000) {
      pointsFit = 0.5;
    } else {
      pointsFit = 0.2;
    }
  }

  // adt_fit: relevant for HotelRoom and MusicShowTicket
  let adtFit = 0.5;
  if (offer.offerType === "HotelRoom" || offer.offerType === "MusicShowTicket") {
    if ((patron.adt ?? 0) >= 8000) {
      adtFit = 1;
      signals.push("high-adt");
    } else if ((patron.adt ?? 0) >= 3000) {
      adtFit = 0.5;
    } else {
      adtFit = 0.2;
    }
  }

  const rulePart = clamp01(
    0.4 * gameOverlap + 0.3 * tierFit + 0.2 * pointsFit + 0.1 * adtFit
  );

  return { rulePart, signals: Array.from(new Set(signals)).slice(0, 3) };
}

function buildReason(
  strength: "Strong" | "Moderate" | "Weak",
  vectorPart: number,
  rulePart: number,
  signals: string[]
): string {
  const vec = `vector similarity ${(vectorPart * 100).toFixed(0)}%`;
  const rules = signals.length > 0 ? signals.slice(0, 2).join(" + ") : "limited rule fit";

  if (strength === "Strong") {
    return `Strong match — ${vec} reinforced by ${rules}.`;
  }
  if (strength === "Moderate") {
    return `Moderate match — ${vec}; supporting signals: ${rules}.`;
  }
  return `Weak match — best available (${vec}); rule contribution ${(rulePart * 100).toFixed(0)}%.`;
}

// ---------- Route ----------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { patronId?: string };
    if (!body.patronId) {
      return NextResponse.json(
        { ok: false, error: "patronId is required" },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const patron = await db
      .collection(webCollections.patrons)
      .findOne({ patronId: body.patronId }, { projection: { _id: 0 } });

    if (!patron) {
      return NextResponse.json(
        { ok: false, error: "Patron not found" },
        { status: 404 }
      );
    }

    // Fetch behaviorTags from the patron's most recent active session
    const session = await db
      .collection(webCollections.sessions)
      .findOne(
        { patronId: body.patronId, isActive: true },
        { projection: { _id: 0, behaviorTags: 1 } }
      );
    const behaviorTags: string[] = (session?.behaviorTags as string[]) ?? [];

    const preferenceEmbedding = (patron.preferenceEmbedding ?? []) as number[];

    type Candidate = {
      offerId: string;
      title: string;
      offerType: string;
      targetGameTypes?: string[];
      estimatedCost?: number;
      atlasScore: number;
    };

    let candidates: Candidate[] = [];
    let generator: "vector-search-rerank" | "cosine-fallback-rerank" =
      "vector-search-rerank";

    // ── Path A: Atlas $vectorSearch ──
    try {
      const vectorResults = await db
        .collection(webCollections.offers)
        .aggregate<Candidate>([
          {
            $vectorSearch: {
              index: "offer_vector_idx",
              path: "offerEmbedding",
              queryVector: preferenceEmbedding,
              numCandidates: 100,
              limit: 10,
            },
          },
          {
            $project: {
              _id: 0,
              offerId: 1,
              title: 1,
              offerType: 1,
              targetGameTypes: 1,
              estimatedCost: 1,
              atlasScore: { $meta: "vectorSearchScore" },
            },
          },
        ])
        .toArray();
      candidates = vectorResults;
    } catch {
      candidates = [];
    }

    // ── Path B: client-side cosine fallback ──
    if (candidates.length === 0) {
      generator = "cosine-fallback-rerank";
      const offers = await db
        .collection(webCollections.offers)
        .find({}, { projection: { _id: 0 } })
        .limit(100)
        .toArray();

      candidates = offers
        .map((offer) => {
          const cos = cosineSimilarity(
            preferenceEmbedding,
            (offer.offerEmbedding as number[]) ?? []
          );
          // Convert raw cosine [-1, 1] to Atlas-equivalent [0, 1] so the
          // downstream stretch step is identical for both paths.
          const atlasEquivalent = (1 + cos) / 2;
          return {
            offerId: String(offer.offerId),
            title: String(offer.title),
            offerType: String(offer.offerType),
            targetGameTypes: offer.targetGameTypes,
            estimatedCost: offer.estimatedCost,
            atlasScore: atlasEquivalent,
          } as Candidate;
        })
        .sort((a, b) => b.atlasScore - a.atlasScore)
        .slice(0, 10);
    }

    const patronCtx: PatronContext = {
      tier: patron.tier,
      adt: patron.adt,
      preferredGames: patron.preferredGames,
      pointsBalance: patron.pointsBalance,
    };

    const reranked = candidates
      .map((c) => {
        const vectorPart = stretchVector(c.atlasScore);
        const { rulePart, signals } = computeRuleScore(patronCtx, {
          offerType: c.offerType,
          targetGameTypes: c.targetGameTypes,
          estimatedCost: c.estimatedCost,
        });
        const finalScore = clamp01(0.6 * vectorPart + 0.4 * rulePart);
        const strength: "Strong" | "Moderate" | "Weak" =
          finalScore >= 0.7 ? "Strong" : finalScore >= 0.45 ? "Moderate" : "Weak";
        const reason = buildReason(strength, vectorPart, rulePart, signals);
        return {
          offerId: c.offerId,
          title: c.title,
          offerType: c.offerType,
          estimatedCost: c.estimatedCost,
          score: Number(finalScore.toFixed(4)),
          breakdown: {
            atlasScore: Number(c.atlasScore.toFixed(4)),
            vectorPart: Number(vectorPart.toFixed(4)),
            rulePart: Number(rulePart.toFixed(4)),
          },
          strength,
          reason,
          matchSignals: signals,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return NextResponse.json({
      ok: true,
      patron: {
        patronId: patron.patronId,
        tier: patron.tier,
        adt: patron.adt,
        preferredGames: patron.preferredGames ?? [],
        pointsBalance: patron.pointsBalance ?? 0,
        behaviorTags,
      },
      generatedOffers: reranked,
      generator,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
