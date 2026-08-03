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
  region?: string;
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
  const adt = patron.adt ?? 0;
  const points = patron.pointsBalance ?? 0;
  const preferredGames = patron.preferredGames ?? [];
  const targets = offer.targetGameTypes ?? [];
  const offerType = offer.offerType ?? "";

  // ── game_overlap (weight 0.35) ─────────────────────────────────────────────
  let gameOverlap = 0;
  const overlap = targets.filter((g) => preferredGames.includes(g));
  if (overlap.length > 0) {
    gameOverlap = 1;
    signals.push(`遊戲:${overlap[0]}`);
  }

  // ── tier_fit (weight 0.25) ─────────────────────────────────────────────────
  const diamondPlatinum = ["Diamond", "Platinum"];
  const premiumTiers = ["Diamond", "Platinum", "Gold"];
  let tierFit = 0.3;

  if (offerType === "CashRebate") {
    // Cash rebate is Diamond-only
    tierFit = tier === "Diamond" ? 1.0 : tier === "Platinum" ? 0.5 : 0.1;
    if (tier === "Diamond") signals.push("等級:鑽石");
  } else if (offerType === "TransportVoucher") {
    tierFit = diamondPlatinum.includes(tier) ? 1.0 : tier === "Gold" ? 0.6 : 0.2;
    if (diamondPlatinum.includes(tier)) signals.push(`等級:${tier === "Diamond" ? "鑽石" : "白金"}`);
  } else if (offerType === "HotelRoom" || offerType === "MusicShowTicket") {
    tierFit = tier === "Diamond" ? 1.0 : tier === "Platinum" ? 0.9 : tier === "Gold" ? 0.6 : 0.3;
    if (premiumTiers.includes(tier)) signals.push(`等級:${tier === "Diamond" ? "鑽石" : tier === "Platinum" ? "白金" : "黃金"}`);
  } else {
    // FNBVoucher, PointsLimitedTime — broader audience
    tierFit = premiumTiers.includes(tier) ? 1.0 : tier === "Silver" ? 0.75 : 0.5;
    signals.push(`等級:${tier}`);
  }

  // ── adt_fit (weight 0.20) ──────────────────────────────────────────────────
  let adtFit = 0.5;
  if (offerType === "CashRebate") {
    adtFit = adt >= 20000 ? 1.0 : adt >= 10000 ? 0.6 : adt >= 5000 ? 0.3 : 0.1;
    if (adt >= 20000) signals.push("ADT>=20k");
    else if (adt >= 10000) signals.push("ADT>=10k");
  } else if (offerType === "HotelRoom") {
    adtFit = adt >= 15000 ? 1.0 : adt >= 8000 ? 0.7 : adt >= 3000 ? 0.4 : 0.15;
    if (adt >= 8000) signals.push("ADT>=8k");
  } else if (offerType === "MusicShowTicket") {
    adtFit = adt >= 10000 ? 1.0 : adt >= 5000 ? 0.7 : adt >= 2000 ? 0.4 : 0.2;
    if (adt >= 5000) signals.push("ADT>=5k");
  } else if (offerType === "TransportVoucher") {
    adtFit = adt >= 8000 ? 1.0 : adt >= 4000 ? 0.6 : 0.25;
    if (adt >= 8000) signals.push("ADT>=8k");
  }
  // FNBVoucher and PointsLimitedTime: ADT neutral (0.5)

  // ── points_fit (weight 0.15) ───────────────────────────────────────────────
  let pointsFit = 0.5;
  if (offerType === "PointsLimitedTime") {
    pointsFit = points >= 20000 ? 1.0 : points >= 10000 ? 0.75 : points >= 5000 ? 0.5 : points >= 500 ? 0.3 : 0.1;
    if (points >= 10000) signals.push("積分豐富");
    else if (points >= 5000) signals.push("積分>=5k");
  } else if (offerType === "MusicShowTicket") {
    pointsFit = points >= 5000 ? 0.8 : points >= 1000 ? 0.5 : 0.3;
  }
  // Other types: points neutral (0.5)

  // ── region_fit (weight 0.05) ───────────────────────────────────────────────
  // TransportVoucher is specifically designed for GBA patrons who need transport;
  // International patrons score slightly lower (they typically use hotel shuttle).
  const region = patron.region ?? "";
  const gbaRegions = ["HongKong", "Guangdong", "OtherGBA", "Macau"];
  let regionFit = 0.5;
  if (offerType === "TransportVoucher") {
    regionFit = gbaRegions.includes(region) ? 1.0 : region === "Taiwan" ? 0.6 : 0.3;
    if (gbaRegions.includes(region)) {
      const regionLabel: Record<string, string> = {
        HongKong: "香港", Guangdong: "廣東", OtherGBA: "大灣區", Macau: "澳門",
      };
      signals.push(`地區:${regionLabel[region] ?? region}`);
    }
  } else if (region) {
    // For other offer types surface region as info signal only (no score impact)
    const regionLabel: Record<string, string> = {
      HongKong: "香港", Guangdong: "廣東", OtherGBA: "大灣區",
      Macau: "澳門", Taiwan: "台灣", International: "國際",
    };
    if (regionLabel[region]) signals.push(`地區:${regionLabel[region]}`);
  }

  const rulePart = clamp01(
    0.35 * gameOverlap + 0.25 * tierFit + 0.20 * adtFit + 0.15 * pointsFit + 0.05 * regionFit
  );

  return { rulePart, signals: Array.from(new Set(signals)).slice(0, 4) };
}

function buildReason(
  strength: "Strong" | "Moderate" | "Weak",
  vectorPart: number,
  rulePart: number,
  signals: string[]
): string {
  const vec = `語義相似度 ${(vectorPart * 100).toFixed(0)}%`;
  const rules = signals.length > 0 ? signals.slice(0, 3).join("、") : "規則匹配有限";

  if (strength === "Strong") {
    return `高度匹配 — ${vec}，佐以 ${rules}。`;
  }
  if (strength === "Moderate") {
    return `中等匹配 — ${vec}；支持信號：${rules}。`;
  }
  return `低度匹配 — 現有最佳選項（${vec}），規則貢獻 ${(rulePart * 100).toFixed(0)}%。`;
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
      region: patron.region,
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
        region: patron.region ?? null,
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
