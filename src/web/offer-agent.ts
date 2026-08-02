import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Db } from "mongodb";
import { webCollections } from "./collections";
import { generateEmbedding } from "./embedding";

type ParsedCriteria = {
  tiers: string[];
  gameTypes: string[];
  minAdt?: number;
  minPoints?: number;
  activeWithinDays?: number;
  activityType?: string;
  activityMinAmount?: number;
  offerType: "HotelRoom" | "MusicShowTicket" | "PointsLimitedTime" | "FNBVoucher";
  offerTitle: string;
  offerDescription: string;
  estimatedCost: number;
  priority: number;
};

type CreatedOfferSummary = {
  offerId: string;
  title: string;
  offerType: "HotelRoom" | "MusicShowTicket" | "PointsLimitedTime" | "FNBVoucher";
  status: "Proposed";
  priority: number;
  estimatedCost: number;
  eligibilityRules: string[];
  createdBy: "AIAgent";
};

type GuidanceQuestion = {
  id: string;
  question: string;
  example: string;
};

type OfferGenerationStats = {
  totalPatrons: number;
  matchedPatrons: number;
  matchRate: number;
  avgMatchedAdt: number;
  tierBreakdown: Array<{ label: string; value: number }>;
  gameBreakdown: Array<{ label: string; value: number }>;
};

type SampleMatchedPatron = {
  patronId: string;
  maskedName: string;
  tier: string;
  adt: number;
  pointsBalance: number;
  preferredGames: string[];
};

const OfferAgentState = Annotation.Root({
  prompt: Annotation<string>,
  criteria: Annotation<ParsedCriteria | null>,
  eligibilityRules: Annotation<string[]>,
  matchingPatronIds: Annotation<string[]>,
  offerEmbedding: Annotation<number[]>,
  createdOffer: Annotation<CreatedOfferSummary | null>,
  stats: Annotation<OfferGenerationStats | null>,
  sampleMatchedPatrons: Annotation<SampleMatchedPatron[]>,
  requiresClarification: Annotation<boolean>,
  guidanceQuestions: Annotation<GuidanceQuestion[]>,
  reply: Annotation<string>,
  error: Annotation<string | null>,
});

function readAmount(text: string, regexes: RegExp[]): number | undefined {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) {
      return Number(match[1].replaceAll(",", ""));
    }
  }
  return undefined;
}

function parseCriteria(message: string): ParsedCriteria {
  const lower = message.toLowerCase();
  const tiers = ["bronze", "silver", "gold", "platinum", "diamond"]
    .filter((tier) => lower.includes(tier))
    .map((tier) => `${tier.slice(0, 1).toUpperCase()}${tier.slice(1)}`);

  const gameTypes = [
    { key: "baccarat", value: "Baccarat" },
    { key: "blackjack", value: "Blackjack" },
    { key: "roulette", value: "Roulette" },
    { key: "sicbo", value: "SicBo" },
    { key: "sic bo", value: "SicBo" },
    { key: "poker", value: "Poker" },
  ]
    .filter((item) => lower.includes(item.key))
    .map((item) => item.value);

  const minAdt = readAmount(lower, [
    /adt\s*(?:>=|>|at least|min(?:imum)?|above)?\s*\$?(\d[\d,]*)/,
    /(?:high roller|high-roller)\s*\$?(\d[\d,]*)/,
  ]);
  const minPoints = readAmount(lower, [
    /points?\s*(?:>=|>|at least|min(?:imum)?|above)?\s*\$?(\d[\d,]*)/,
  ]);

  const daysMatch =
    lower.match(/within\s*(\d+)\s*days/) ||
    lower.match(/last\s*(\d+)\s*days/) ||
    lower.match(/active\s*in\s*(\d+)\s*days/);
  const activeWithinDays = daysMatch?.[1] ? Number(daysMatch[1]) : undefined;

  let activityType: ParsedCriteria["activityType"];
  if (lower.includes("chip exchange")) activityType = "ChipExchange";
  if (lower.includes("table bet")) activityType = "TableBet";
  if (lower.includes("points redeem")) activityType = "PointsRedeem";
  if (lower.includes("drink redeem")) activityType = "DrinkRedeem";

  const activityMinAmount = readAmount(lower, [
    /(?:exchange|redeem|bet|amount)\s*(?:>=|>|at least|min(?:imum)?|above)?\s*\$?(\d[\d,]*)/,
  ]);

  let offerType: ParsedCriteria["offerType"] = "PointsLimitedTime";
  if (lower.includes("hotel")) offerType = "HotelRoom";
  else if (lower.includes("show") || lower.includes("ticket")) offerType = "MusicShowTicket";
  else if (lower.includes("drink") || lower.includes("f&b") || lower.includes("food")) {
    offerType = "FNBVoucher";
  }

  const titleMatch = message.match(/title\s*:\s*([^\n.]+)/i) || message.match(/offer\s*:\s*([^\n.]+)/i);
  const offerTitle = titleMatch?.[1]?.trim() || `${offerType} Auto Offer ${new Date().toISOString().slice(0, 10)}`;
  const offerDescription = message.slice(0, 180);
  const estimatedCost = readAmount(lower, [/cost\s*(?:>=|>|=)?\s*\$?(\d[\d,]*)/]) ?? 300;
  const priority = readAmount(lower, [/priority\s*(\d{1,3})/]) ?? 70;

  return {
    tiers,
    gameTypes,
    minAdt,
    minPoints,
    activeWithinDays,
    activityType,
    activityMinAmount,
    offerType,
    offerTitle,
    offerDescription,
    estimatedCost,
    priority,
  };
}

function isOfferPromptRelevant(prompt: string, criteria: ParsedCriteria): boolean {
  const lower = prompt.toLowerCase();
  const hasMarketingIntent =
    /(offer|promotion|campaign|reward|voucher|points|hotel|show|ticket)/.test(lower);
  const hasPatronSignal =
    criteria.tiers.length > 0 ||
    criteria.gameTypes.length > 0 ||
    Boolean(criteria.minAdt) ||
    Boolean(criteria.minPoints) ||
    Boolean(criteria.activeWithinDays) ||
    Boolean(criteria.activityType);
  return hasMarketingIntent || hasPatronSignal;
}

function buildGuidanceQuestions(): GuidanceQuestion[] {
  return [
    {
      id: "offer-type",
      question: "What offer benefit do you want to provide?",
      example: "Hotel room, music show ticket, points redemption, or F&B voucher",
    },
    {
      id: "target-segment",
      question: "Which patron segment should be targeted?",
      example: "Diamond + Platinum patrons who prefer Baccarat",
    },
    {
      id: "thresholds",
      question: "What numerical thresholds should be applied?",
      example: "ADT >= 8000, points >= 20000",
    },
    {
      id: "recency-activity",
      question: "Any activity and recency requirement?",
      example: "Table bet activity within last 14 days",
    },
  ];
}

function buildEligibilityRules(criteria: ParsedCriteria): string[] {
  const rules: string[] = [];
  if (criteria.tiers.length > 0) rules.push(`tier in [${criteria.tiers.join(", ")}]`);
  if (criteria.gameTypes.length > 0) rules.push(`preferredGames includes [${criteria.gameTypes.join(", ")}]`);
  if (criteria.minAdt) rules.push(`adt >= ${criteria.minAdt}`);
  if (criteria.minPoints) rules.push(`pointsBalance >= ${criteria.minPoints}`);
  if (criteria.activeWithinDays) rules.push(`lastActiveAt within ${criteria.activeWithinDays} days`);
  if (criteria.activityType) {
    const activityRule = criteria.activityMinAmount
      ? `${criteria.activityType} amount >= ${criteria.activityMinAmount}`
      : `${criteria.activityType} exists`;
    rules.push(activityRule);
  }
  if (rules.length === 0) rules.push("no strict filter (all active patrons)");
  return rules;
}

async function findMatchingPatronIds(db: Db, criteria: ParsedCriteria): Promise<string[]> {
  const patronFilter: Record<string, unknown> = {};
  if (criteria.tiers.length > 0) patronFilter.tier = { $in: criteria.tiers };
  if (criteria.gameTypes.length > 0) patronFilter.preferredGames = { $in: criteria.gameTypes };
  if (criteria.minAdt) patronFilter.adt = { $gte: criteria.minAdt };
  if (criteria.minPoints) patronFilter.pointsBalance = { $gte: criteria.minPoints };
  const fromDate = criteria.activeWithinDays
    ? new Date(Date.now() - criteria.activeWithinDays * 24 * 60 * 60 * 1000)
    : undefined;
  if (fromDate) patronFilter.lastActiveAt = { $gte: fromDate };

  if (criteria.activityType) {
    const activityMatch: Record<string, unknown> = { activityType: criteria.activityType };
    if (criteria.activityMinAmount) activityMatch.amount = { $gte: criteria.activityMinAmount };
    if (fromDate) activityMatch.eventTime = { $gte: fromDate };
    patronFilter.activities = { $elemMatch: activityMatch };
  }

  const matchedPatrons = await db
    .collection(webCollections.patrons)
    .find(patronFilter, { projection: { _id: 0, patronId: 1 } })
    .limit(5000)
    .toArray();
  return matchedPatrons.map((item) => item.patronId as string);
}

async function buildGenerationStats(db: Db, matchingPatronIds: string[]): Promise<OfferGenerationStats> {
  const totalPatrons = await db.collection(webCollections.patrons).countDocuments({});
  if (matchingPatronIds.length === 0) {
    return {
      totalPatrons,
      matchedPatrons: 0,
      matchRate: 0,
      avgMatchedAdt: 0,
      tierBreakdown: [],
      gameBreakdown: [],
    };
  }

  const patronColl = db.collection(webCollections.patrons);

  const [tierRows, gameRows, adtRows] = await Promise.all([
    patronColl
      .aggregate([
        { $match: { patronId: { $in: matchingPatronIds } } },
        { $group: { _id: "$tier", value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 5 },
      ])
      .toArray(),
    patronColl
      .aggregate([
        { $match: { patronId: { $in: matchingPatronIds } } },
        { $unwind: "$preferredGames" },
        { $group: { _id: "$preferredGames", value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 5 },
      ])
      .toArray(),
    patronColl
      .aggregate([
        { $match: { patronId: { $in: matchingPatronIds } } },
        { $group: { _id: null, avgMatchedAdt: { $avg: "$adt" } } },
      ])
      .toArray(),
  ]);

  return {
    totalPatrons,
    matchedPatrons: matchingPatronIds.length,
    matchRate: totalPatrons > 0 ? matchingPatronIds.length / totalPatrons : 0,
    avgMatchedAdt: Math.round(adtRows[0]?.avgMatchedAdt ?? 0),
    tierBreakdown: tierRows.map((row) => ({ label: String(row._id), value: Number(row.value) })),
    gameBreakdown: gameRows.map((row) => ({ label: String(row._id), value: Number(row.value) })),
  };
}

async function createOfferDocument(
  db: Db,
  criteria: ParsedCriteria,
  eligibilityRules: string[],
  offerEmbedding: number[]
): Promise<CreatedOfferSummary> {
  const offerId = `OFFER-AI-${Date.now()}`;
  const now = new Date();
  const offerDoc = {
    offerId,
    offerType: criteria.offerType,
    title: criteria.offerTitle,
    description: criteria.offerDescription,
    eligibilityRules,
    estimatedCost: criteria.estimatedCost,
    targetGameTypes: criteria.gameTypes,
    priority: Math.max(1, Math.min(100, criteria.priority)),
    status: "Proposed" as const,
    createdBy: "AIAgent" as const,
    offerEmbedding,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(webCollections.offers).insertOne(offerDoc);

  return {
    offerId: offerDoc.offerId,
    title: offerDoc.title,
    offerType: offerDoc.offerType,
    status: offerDoc.status,
    priority: offerDoc.priority,
    estimatedCost: offerDoc.estimatedCost,
    eligibilityRules: offerDoc.eligibilityRules,
    createdBy: offerDoc.createdBy,
  };
}

function buildOfferAgentGraph(db: Db) {
  return new StateGraph(OfferAgentState)
    .addNode("parse", async (state) => {
      if (!state.prompt?.trim()) {
        return {
          error: "message is required",
        };
      }
      const criteria = parseCriteria(state.prompt);
      const requiresClarification = !isOfferPromptRelevant(state.prompt, criteria);
      return {
        criteria,
        requiresClarification,
        guidanceQuestions: requiresClarification ? buildGuidanceQuestions() : [],
        eligibilityRules: buildEligibilityRules(criteria),
      };
    })
    .addNode("match", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) {
        return {};
      }
      const matchingPatronIds = await findMatchingPatronIds(db, state.criteria);
      const stats = await buildGenerationStats(db, matchingPatronIds);
      const sampleMatchedPatrons: SampleMatchedPatron[] =
        matchingPatronIds.length === 0
          ? []
          : ((await db
              .collection(webCollections.patrons)
              .aggregate([
                { $match: { patronId: { $in: matchingPatronIds } } },
                { $sort: { adt: -1 } },
                { $limit: 3 },
                {
                  $project: {
                    _id: 0,
                    patronId: 1,
                    maskedName: 1,
                    tier: 1,
                    adt: 1,
                    pointsBalance: 1,
                    preferredGames: 1,
                  },
                },
              ])
              .toArray()) as unknown as SampleMatchedPatron[]);
      return { matchingPatronIds, stats, sampleMatchedPatrons };
    })
    .addNode("embed", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) {
        return {};
      }
      const textToEmbed = `${state.criteria.offerTitle} ${state.criteria.offerDescription}`;
      const embedding = await generateEmbedding(textToEmbed);
      return { offerEmbedding: embedding };
    })
    .addNode("create", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) {
        return {};
      }
      const createdOffer = await createOfferDocument(
        db,
        state.criteria,
        state.eligibilityRules,
        state.offerEmbedding ?? []
      );
      return { createdOffer };
    })
    .addNode("summarize", async (state) => {
      if (state.error) {
        return { reply: state.error };
      }
      if (state.requiresClarification) {
        const guideText = state.guidanceQuestions
          .map((q, index) => `${index + 1}. ${q.question} (e.g. ${q.example})`)
          .join("\n");
        return {
          reply:
            "I need a bit more offer-specific input before generating a promotion.\n" +
            "Please provide:\n" +
            guideText,
        };
      }
      if (!state.createdOffer) {
        return { reply: "Unable to create offer from provided prompt." };
      }
      const reply = [
        `✨ Offer "${state.createdOffer.title}" (${state.createdOffer.offerId}) submitted as Proposed — awaiting admin approval.`,
        `Matched patrons: ${state.matchingPatronIds.length}.`,
        `Detected criteria: ${state.eligibilityRules.join("; ")}.`,
        state.sampleMatchedPatrons && state.sampleMatchedPatrons.length > 0
          ? `Top sample patrons shown in the Impact Graph.`
          : "No patrons currently match.",
        `Use the Offer Catalog "Proposed" filter to review.`,
      ].join(" ");
      return { reply };
    })
    .addEdge(START, "parse")
    .addEdge("parse", "match")
    .addEdge("match", "embed")
    .addEdge("embed", "create")
    .addEdge("create", "summarize")
    .addEdge("summarize", END)
    .compile();
}

export async function createOfferFromPrompt(db: Db, prompt: string) {
  const graph = buildOfferAgentGraph(db);
  const finalState = await graph.invoke({
    prompt,
    criteria: null,
    eligibilityRules: [],
    matchingPatronIds: [],
    offerEmbedding: [],
    createdOffer: null,
    stats: null,
    sampleMatchedPatrons: [],
    requiresClarification: false,
    guidanceQuestions: [],
    reply: "",
    error: null,
  });

  const previewPatrons = finalState.matchingPatronIds.slice(0, 12);

  return {
    reply: finalState.reply,
    createdOffer: finalState.createdOffer,
    matchedPatronCount: finalState.matchingPatronIds.length,
    matchedPatronSample: previewPatrons,
    sampleMatchedPatrons: finalState.sampleMatchedPatrons ?? [],
    stats: finalState.stats,
    requiresClarification: finalState.requiresClarification,
    guidanceQuestions: finalState.guidanceQuestions,
    engine: "langgraph",
  };
}
