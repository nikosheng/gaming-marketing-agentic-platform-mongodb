import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Db } from "mongodb";
import { webCollections } from "./collections";

type TablePatronProfile = {
  patronId: string;
  maskedName: string;
  tier: string;
  adt: number;
  pointsBalance: number;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
};

type TablePatronForScoring = TablePatronProfile & {
  preferenceEmbedding: number[];
};

type PatronOfferSuggestion = {
  offerId: string;
  title: string;
  offerType: string;
  score: number;
};

type RankedPatron = TablePatronProfile & {
  lossPotentialScore: number;
  lossPotentialLabel: "High" | "Medium" | "Low";
  confidence: number;
  expectedLossRange: { min: number; max: number };
  recommendation: string;
  reasons: string[];
  suggestedOffers: PatronOfferSuggestion[];
};

type TableAnalysisSummary = {
  totalPatrons: number;
  highPotentialCount: number;
  mediumPotentialCount: number;
  avgPotentialScore: number;
  bestTargetPatronId: string | null;
};

type TableDrilldownAnalysis = {
  tableId: string;
  analyzedAt: string;
  summary: TableAnalysisSummary;
  rankedPatrons: RankedPatron[];
};

const TableAgentState = Annotation.Root({
  tableId: Annotation<string>,
  patrons: Annotation<TablePatronForScoring[]>,
  rankedPatrons: Annotation<RankedPatron[]>,
  summary: Annotation<TableAnalysisSummary | null>,
  reply: Annotation<string>,
  error: Annotation<string | null>,
});

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function behaviorRiskScore(tags: string[]): number {
  let score = 0.2;
  if (tags.includes("Aggressive")) score += 0.4;
  if (tags.includes("LateNight")) score += 0.15;
  if (tags.includes("PromoSeeker")) score += 0.1;
  if (tags.includes("CardCounterWatch")) score += 0.1;
  if (tags.includes("Conservative")) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

function tierLossFactor(tier: string): number {
  switch (tier) {
    case "Diamond":
      return 0.18;
    case "Platinum":
      return 0.16;
    case "Gold":
      return 0.14;
    case "Silver":
      return 0.12;
    default:
      return 0.1;
  }
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

function buildRecommendation(patron: TablePatronProfile, score: number): string {
  if (score >= 0.75) {
    if (patron.tier === "Diamond" || patron.tier === "Platinum") {
      return "Offer premium hotel/show bundle with host outreach now.";
    }
    return "Offer high-value points multiplier package in-session.";
  }
  if (score >= 0.5) {
    return "Offer timed F&B + points booster to extend play duration.";
  }
  return "Use lightweight retention voucher and monitor next session behavior.";
}

async function findTopOffersForPatron(
  db: Db,
  preferenceEmbedding: number[]
): Promise<PatronOfferSuggestion[]> {
  if (!Array.isArray(preferenceEmbedding) || preferenceEmbedding.length === 0) {
    return [];
  }

  try {
    const vectorMatches = await db
      .collection(webCollections.offers)
      .aggregate<PatronOfferSuggestion>([
        {
          $vectorSearch: {
            index: "offer_vector_idx",
            path: "offerEmbedding",
            queryVector: preferenceEmbedding,
            numCandidates: 40,
            limit: 3,
          },
        },
        {
          $project: {
            _id: 0,
            offerId: 1,
            title: 1,
            offerType: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();
    return vectorMatches.map((row) => ({ ...row, score: Number(row.score.toFixed(4)) }));
  } catch {
    const offers = await db
      .collection(webCollections.offers)
      .find({}, { projection: { _id: 0, offerId: 1, title: 1, offerType: 1, offerEmbedding: 1 } })
      .limit(100)
      .toArray();
    return offers
      .map((offer) => ({
        offerId: String(offer.offerId),
        title: String(offer.title),
        offerType: String(offer.offerType),
        score: Number(
          cosineSimilarity(preferenceEmbedding, (offer.offerEmbedding as number[]) ?? []).toFixed(4)
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }
}

async function loadTablePatrons(db: Db, tableId: string): Promise<TablePatronForScoring[]> {
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
        preferenceEmbedding: "$patron.preferenceEmbedding",
        sessionBetAmount: 1,
        currentStackEstimate: 1,
        behaviorTags: 1,
      },
    },
  ];

  return db.collection(webCollections.sessions).aggregate<TablePatronForScoring>(pipeline).toArray();
}

function buildTableDrilldownAgent(db: Db) {
  return new StateGraph(TableAgentState)
    .addNode("load", async (state) => {
      const patrons = await loadTablePatrons(db, state.tableId);
      if (patrons.length === 0) {
        return {
          patrons: [],
          rankedPatrons: [],
          summary: {
            totalPatrons: 0,
            highPotentialCount: 0,
            mediumPotentialCount: 0,
            avgPotentialScore: 0,
            bestTargetPatronId: null,
          },
          reply: "No active patrons found on this table right now.",
        };
      }
      return { patrons };
    })
    .addNode("score", async (state) => {
      if (state.patrons.length === 0) return {};

      const maxBet = Math.max(...state.patrons.map((p) => p.sessionBetAmount), 1);
      const maxAdt = Math.max(...state.patrons.map((p) => p.adt), 1);
      const maxPoints = Math.max(...state.patrons.map((p) => p.pointsBalance), 1);
      const maxStack = Math.max(...state.patrons.map((p) => p.currentStackEstimate), 1);

      const rankedBase = state.patrons
        .map((patron) => {
          const betSignal = normalize(patron.sessionBetAmount, maxBet);
          const adtSignal = normalize(patron.adt, maxAdt);
          const pointsSignal = normalize(patron.pointsBalance, maxPoints);
          const stackSignal = normalize(patron.currentStackEstimate, maxStack);
          const behaviorSignal = behaviorRiskScore(patron.behaviorTags);

          const score =
            betSignal * 0.35 +
            adtSignal * 0.25 +
            stackSignal * 0.15 +
            pointsSignal * 0.1 +
            behaviorSignal * 0.15;
          const roundedScore = Number(score.toFixed(4));

          const label: RankedPatron["lossPotentialLabel"] =
            roundedScore >= 0.72 ? "High" : roundedScore >= 0.5 ? "Medium" : "Low";
          const confidence = Number((0.6 + behaviorSignal * 0.2 + betSignal * 0.2).toFixed(4));
          const lossFactor = tierLossFactor(patron.tier);
          const centerLoss = patron.sessionBetAmount * lossFactor;
          const expectedLossRange = {
            min: Math.round(centerLoss * 0.75),
            max: Math.round(centerLoss * 1.35),
          };

          const reasons = [
            `Session bet intensity ${(betSignal * 100).toFixed(0)}%`,
            `ADT signal ${(adtSignal * 100).toFixed(0)}%`,
            `Behavior risk ${(behaviorSignal * 100).toFixed(0)}%`,
          ];

          return {
            ...patron,
            lossPotentialScore: roundedScore,
            lossPotentialLabel: label,
            confidence,
            expectedLossRange,
            recommendation: buildRecommendation(patron, roundedScore),
            reasons,
          };
        })
        .sort((a, b) => b.lossPotentialScore - a.lossPotentialScore);

      const ranked = await Promise.all(
        rankedBase.map(async (patron) => ({
          patronId: patron.patronId,
          maskedName: patron.maskedName,
          tier: patron.tier,
          adt: patron.adt,
          pointsBalance: patron.pointsBalance,
          sessionBetAmount: patron.sessionBetAmount,
          currentStackEstimate: patron.currentStackEstimate,
          behaviorTags: patron.behaviorTags,
          lossPotentialScore: patron.lossPotentialScore,
          lossPotentialLabel: patron.lossPotentialLabel,
          confidence: patron.confidence,
          expectedLossRange: patron.expectedLossRange,
          recommendation: patron.recommendation,
          reasons: patron.reasons,
          suggestedOffers: await findTopOffersForPatron(db, patron.preferenceEmbedding ?? []),
        }))
      );

      const highPotentialCount = ranked.filter((p) => p.lossPotentialLabel === "High").length;
      const mediumPotentialCount = ranked.filter((p) => p.lossPotentialLabel === "Medium").length;
      const avgPotentialScore = Number(
        (ranked.reduce((acc, row) => acc + row.lossPotentialScore, 0) / ranked.length).toFixed(4)
      );

      return {
        rankedPatrons: ranked,
        summary: {
          totalPatrons: ranked.length,
          highPotentialCount,
          mediumPotentialCount,
          avgPotentialScore,
          bestTargetPatronId: ranked[0]?.patronId ?? null,
        },
        reply: `Analyzed ${ranked.length} patrons. Top target: ${ranked[0]?.patronId ?? "N/A"}.`,
      };
    })
    .addEdge(START, "load")
    .addEdge("load", "score")
    .addEdge("score", END)
    .compile();
}

export async function analyzeTablePatrons(db: Db, tableId: string): Promise<TableDrilldownAnalysis> {
  const graph = buildTableDrilldownAgent(db);
  const result = await graph.invoke({
    tableId,
    patrons: [],
    rankedPatrons: [],
    summary: null,
    reply: "",
    error: null,
  });

  return {
    tableId,
    analyzedAt: new Date().toISOString(),
    summary: result.summary ?? {
      totalPatrons: 0,
      highPotentialCount: 0,
      mediumPotentialCount: 0,
      avgPotentialScore: 0,
      bestTargetPatronId: null,
    },
    rankedPatrons: result.rankedPatrons,
  };
}
