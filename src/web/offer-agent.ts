import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Db } from "mongodb";
import { webCollections } from "./collections";
import { generateEmbedding } from "./llm/embeddings";
import { chatJson } from "./llm/gateway";

// ─── Types ────────────────────────────────────────────────────────────────────

type OfferType =
  | "HotelRoom"
  | "MusicShowTicket"
  | "PointsLimitedTime"
  | "FNBVoucher"
  | "CashRebate"
  | "TransportVoucher";

type PatronRegion = "Macau" | "HongKong" | "Guangdong" | "OtherGBA" | "Taiwan" | "International";

type ParsedCriteria = {
  tiers: string[];
  gameTypes: string[];
  regions: PatronRegion[];
  minAdt?: number;
  maxAdt?: number;
  minPoints?: number;
  activeWithinDays?: number;
  activityType?: string;
  activityMinAmount?: number;
  offerType: OfferType;
  offerTitle: string;
  offerDescription: string;
  estimatedCost: number;
  priority: number;
  /** Natural-language semantic summary used as $vectorSearch query against patron_profiles */
  semanticQuery: string;
};

type CreatedOfferSummary = {
  offerId: string;
  title: string;
  offerType: OfferType;
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

type MatchStrategy = "intersection" | "relaxed-union" | "numeric-fallback";

// ─── LangGraph State ──────────────────────────────────────────────────────────

const OfferAgentState = Annotation.Root({
  prompt: Annotation<string>,
  criteria: Annotation<ParsedCriteria | null>,
  eligibilityRules: Annotation<string[]>,
  matchingPatronIds: Annotation<string[]>,
  matchStrategy: Annotation<MatchStrategy | null>,
  offerEmbedding: Annotation<number[]>,
  createdOffer: Annotation<CreatedOfferSummary | null>,
  stats: Annotation<OfferGenerationStats | null>,
  sampleMatchedPatrons: Annotation<SampleMatchedPatron[]>,
  requiresClarification: Annotation<boolean>,
  guidanceQuestions: Annotation<GuidanceQuestion[]>,
  reply: Annotation<string>,
  error: Annotation<string | null>,
});

// ─── LLM-based criteria parser (replaces regex parseCriteria) ────────────────

async function parseCriteriaWithLLM(prompt: string): Promise<ParsedCriteria | null> {
  const systemPrompt = `你是賭場行銷優惠分析助手。
用戶會用中文、英文或混合語言描述一個行銷優惠的目標受眾及條件。
你的任務是從中提取結構化資訊，並輸出 JSON 格式。

可用的 offerType 值（只能選其中之一）：
- "HotelRoom"         → 酒店客房/套房禮遇
- "MusicShowTicket"   → 演唱會/娛樂表演門票
- "PointsLimitedTime" → 限時積分兌換活動
- "FNBVoucher"        → 餐飲/飲品禮品券
- "CashRebate"        → 現金回扣/籌碼回贈
- "TransportVoucher"  → 接送/專車/直升機禮券

可用的 tier 值：Bronze, Silver, Gold, Platinum, Diamond
可用的 gameTypes 值：Baccarat, Blackjack, Roulette, SicBo, Poker
可用的 activityType 值：ChipExchange, TableBet, PointsRedeem, DrinkRedeem, ShowPurchase, HotelBooking

可用的 regions 值（賓客來源地區）：
- "Macau"          → 澳門本地賓客
- "HongKong"       → 香港賓客
- "Guangdong"      → 廣東省賓客
- "OtherGBA"       → 其他大灣區城市（深圳/珠海/佛山等）
- "Taiwan"         → 台灣賓客
- "International"  → 海外/國際賓客

輸出 JSON 格式（所有欄位均為英文 key，值可包含中文）：
{
  "tiers": [],
  "gameTypes": [],
  "regions": [],
  "minAdt": null,
  "maxAdt": null,
  "minPoints": null,
  "activeWithinDays": null,
  "activityType": null,
  "activityMinAmount": null,
  "offerType": "PointsLimitedTime",
  "offerTitle": "（10字以內的繁體中文標題）",
  "offerDescription": "（50字以內的繁體中文描述，說明優惠內容及目標受眾）",
  "estimatedCost": 500,
  "priority": 70,
  "semanticQuery": "（用於語義搜尋的繁體中文摘要，描述目標賓客特徵，如：香港及廣東省高消費鑽石等級百家樂賓客，ADT 高，近期活躍）"
}

規則：
- 若無法確定 offerType，默認為 "PointsLimitedTime"
- estimatedCost 默認 500，priority 默認 70
- semanticQuery 必須用繁體中文，包含地區、tier、遊戲偏好、消費模式等目標賓客特徵
- 若用戶沒有提及某個欄位，設為 null 或空陣列
- tiers、gameTypes、regions 必須使用上方列出的英文枚舉值
- 大灣區 = HongKong + Guangdong + OtherGBA（若用戶提及「大灣區」，填入這三個）`;

  const raw = await chatJson({
    system: systemPrompt,
    user: prompt,
    temperature: 0.2,
    maxTokens: 1500,
  });

  if (!raw) return null;

  const VALID_REGIONS: PatronRegion[] = ["Macau", "HongKong", "Guangdong", "OtherGBA", "Taiwan", "International"];

  try {
    const parsed = JSON.parse(raw) as Partial<ParsedCriteria> & Record<string, unknown>;
    return {
      tiers: Array.isArray(parsed.tiers) ? (parsed.tiers as string[]) : [],
      gameTypes: Array.isArray(parsed.gameTypes) ? (parsed.gameTypes as string[]) : [],
      regions: Array.isArray(parsed.regions)
        ? (parsed.regions as string[]).filter((r): r is PatronRegion => VALID_REGIONS.includes(r as PatronRegion))
        : [],
      minAdt: typeof parsed.minAdt === "number" ? parsed.minAdt : undefined,
      maxAdt: typeof parsed.maxAdt === "number" ? parsed.maxAdt : undefined,
      minPoints: typeof parsed.minPoints === "number" ? parsed.minPoints : undefined,
      activeWithinDays:
        typeof parsed.activeWithinDays === "number" ? parsed.activeWithinDays : undefined,
      activityType: typeof parsed.activityType === "string" ? parsed.activityType : undefined,
      activityMinAmount:
        typeof parsed.activityMinAmount === "number" ? parsed.activityMinAmount : undefined,
      offerType: (parsed.offerType as OfferType) ?? "PointsLimitedTime",
      offerTitle:
        typeof parsed.offerTitle === "string" && parsed.offerTitle.trim()
          ? parsed.offerTitle.trim()
          : `AI 優惠 ${new Date().toISOString().slice(0, 10)}`,
      offerDescription:
        typeof parsed.offerDescription === "string" ? parsed.offerDescription.slice(0, 200) : prompt.slice(0, 200),
      estimatedCost: typeof parsed.estimatedCost === "number" ? parsed.estimatedCost : 500,
      priority: typeof parsed.priority === "number" ? Math.max(1, Math.min(100, parsed.priority)) : 70,
      semanticQuery:
        typeof parsed.semanticQuery === "string" && parsed.semanticQuery.trim()
          ? parsed.semanticQuery.trim()
          : prompt.slice(0, 200),
    };
  } catch {
    return null;
  }
}

function isOfferPromptRelevant(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /(offer|promotion|campaign|reward|voucher|points|hotel|show|ticket|優惠|促銷|活動|禮遇|積分|酒店|演唱|門票|餐飲|接送|回扣|賓客|賭客|玩家)/.test(
    lower
  );
}

function buildGuidanceQuestions(): GuidanceQuestion[] {
  return [
    {
      id: "offer-type",
      question: "您希望提供什麼類型的優惠？",
      example: "酒店套房、演唱會門票、積分兌換、餐飲禮券、現金回扣或專車接送",
    },
    {
      id: "target-segment",
      question: "目標賓客是哪個等級或遊戲偏好？",
      example: "鑽石及白金等級偏好百家樂的賓客",
    },
    {
      id: "thresholds",
      question: "有哪些數字門檻要求？",
      example: "ADT >= 8,000，積分餘額 >= 20,000",
    },
    {
      id: "recency-activity",
      question: "對活躍時間或近期活動有要求嗎？",
      example: "14 天內有桌面下注記錄",
    },
  ];
}

function buildEligibilityRules(criteria: ParsedCriteria): string[] {
  const rules: string[] = [];
  if (criteria.tiers.length > 0) rules.push(`tier in [${criteria.tiers.join(", ")}]`);
  if (criteria.gameTypes.length > 0)
    rules.push(`preferredGames includes [${criteria.gameTypes.join(", ")}]`);
  if (criteria.regions.length > 0) rules.push(`region in [${criteria.regions.join(", ")}]`);
  if (criteria.minAdt) rules.push(`adt >= ${criteria.minAdt}`);
  if (criteria.maxAdt) rules.push(`adt < ${criteria.maxAdt}`);
  if (criteria.minPoints) rules.push(`pointsBalance >= ${criteria.minPoints}`);
  if (criteria.activeWithinDays)
    rules.push(`lastActiveAt within ${criteria.activeWithinDays} days`);
  if (criteria.activityType) {
    const actRule = criteria.activityMinAmount
      ? `${criteria.activityType} amount >= ${criteria.activityMinAmount}`
      : `${criteria.activityType} exists`;
    rules.push(actRule);
  }
  if (rules.length === 0) rules.push("no strict filter (all active patrons)");
  return rules;
}

// ─── Dual-track patron matching ───────────────────────────────────────────────

async function findMatchingPatronIds(
  db: Db,
  criteria: ParsedCriteria
): Promise<{ ids: string[]; strategy: MatchStrategy }> {
  const patronColl = db.collection(webCollections.patrons);

  // ── Path B: numeric / enum MongoDB filter ──────────────────────────────────
  const patronFilter: Record<string, unknown> = {};
  if (criteria.tiers.length > 0) patronFilter.tier = { $in: criteria.tiers };
  if (criteria.gameTypes.length > 0)
    patronFilter.preferredGames = { $in: criteria.gameTypes };
  if (criteria.regions.length > 0) patronFilter.region = { $in: criteria.regions };
  if (criteria.minAdt) patronFilter.adt = { $gte: criteria.minAdt };
  if (criteria.maxAdt)
    patronFilter.adt = { ...(patronFilter.adt as object ?? {}), $lt: criteria.maxAdt };
  if (criteria.minPoints) patronFilter.pointsBalance = { $gte: criteria.minPoints };

  const fromDate = criteria.activeWithinDays
    ? new Date(Date.now() - criteria.activeWithinDays * 24 * 60 * 60 * 1000)
    : undefined;
  if (fromDate) patronFilter.lastActiveAt = { $gte: fromDate };

  if (criteria.activityType) {
    const actMatch: Record<string, unknown> = { activityType: criteria.activityType };
    if (criteria.activityMinAmount) actMatch.amount = { $gte: criteria.activityMinAmount };
    if (fromDate) actMatch.eventTime = { $gte: fromDate };
    patronFilter.activities = { $elemMatch: actMatch };
  }

  const hasNumericFilter = Object.keys(patronFilter).length > 0;

  const numericDocs = hasNumericFilter
    ? await patronColl
        .find(patronFilter, { projection: { _id: 0, patronId: 1 } })
        .limit(5000)
        .toArray()
    : [];
  const numericIds = new Set(numericDocs.map((d) => d.patronId as string));

  // ── Path A: $vectorSearch on patron_profiles ───────────────────────────────
  let vectorIds = new Set<string>();
  try {
    const queryEmbedding = await generateEmbedding(criteria.semanticQuery, "query");
    const isZeroVector = queryEmbedding.every((v) => v === 0);
    if (!isZeroVector) {
      const vectorResults = await patronColl
        .aggregate<{ patronId: string }>([
          {
            $vectorSearch: {
              index: "patron_preference_vector_idx",
              path: "preferenceEmbedding",
              queryVector: queryEmbedding,
              numCandidates: 300,
              limit: 150,
            },
          },
          { $project: { _id: 0, patronId: 1 } },
        ])
        .toArray();
      vectorIds = new Set(vectorResults.map((d) => d.patronId));
    }
  } catch {
    // $vectorSearch failed — will fall back to numeric-only
    vectorIds = new Set<string>();
  }

  // ── Strategy selection ─────────────────────────────────────────────────────
  const hasVector = vectorIds.size > 0;
  const hasNumeric = numericIds.size > 0;

  if (hasVector && hasNumeric) {
    // Primary: intersection
    const intersection = [...vectorIds].filter((id) => numericIds.has(id));
    if (intersection.length >= 5) {
      return { ids: intersection, strategy: "intersection" };
    }
    // Relaxed: union when intersection is too small
    const union = [...new Set([...vectorIds, ...numericIds])];
    return { ids: union, strategy: "relaxed-union" };
  }

  if (hasVector && !hasNumeric) {
    // No numeric constraints provided — use vector results directly
    return { ids: [...vectorIds], strategy: "intersection" };
  }

  if (!hasVector && hasNumeric) {
    // $vectorSearch unavailable — numeric-only fallback
    return { ids: [...numericIds], strategy: "numeric-fallback" };
  }

  // Nothing matched
  return { ids: [], strategy: "numeric-fallback" };
}

// ─── Stats builder ────────────────────────────────────────────────────────────

async function buildGenerationStats(
  db: Db,
  matchingPatronIds: string[]
): Promise<OfferGenerationStats> {
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
    tierBreakdown: tierRows.map((r) => ({ label: String(r._id), value: Number(r.value) })),
    gameBreakdown: gameRows.map((r) => ({ label: String(r._id), value: Number(r.value) })),
  };
}

// ─── Offer document creator ───────────────────────────────────────────────────

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

// ─── Strategy label for reply ─────────────────────────────────────────────────

function strategyLabel(strategy: MatchStrategy): string {
  switch (strategy) {
    case "intersection":
      return "語義搜尋 × 數字條件交集";
    case "relaxed-union":
      return "條件放寬聯集（交集賓客數不足，已擴展範圍）";
    case "numeric-fallback":
      return "數字條件篩選（向量搜尋暫不可用）";
  }
}

// ─── LangGraph graph ──────────────────────────────────────────────────────────

function buildOfferAgentGraph(db: Db) {
  return new StateGraph(OfferAgentState)
    .addNode("parse", async (state) => {
      if (!state.prompt?.trim()) {
        return { error: "message is required" };
      }

      if (!isOfferPromptRelevant(state.prompt)) {
        return {
          criteria: null,
          requiresClarification: true,
          guidanceQuestions: buildGuidanceQuestions(),
          eligibilityRules: [],
        };
      }

      const criteria = await parseCriteriaWithLLM(state.prompt);
      if (!criteria) {
        // LLM unavailable — return clarification
        return {
          criteria: null,
          requiresClarification: true,
          guidanceQuestions: buildGuidanceQuestions(),
          eligibilityRules: [],
        };
      }

      return {
        criteria,
        requiresClarification: false,
        guidanceQuestions: [],
        eligibilityRules: buildEligibilityRules(criteria),
      };
    })
    .addNode("match", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) return {};

      const { ids: matchingPatronIds, strategy: matchStrategy } = await findMatchingPatronIds(
        db,
        state.criteria
      );
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

      return { matchingPatronIds, matchStrategy, stats, sampleMatchedPatrons };
    })
    .addNode("embed", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) return {};
      // Embed using the rich Chinese description for better cosine alignment with patron vectors
      const textToEmbed = `${state.criteria.offerTitle}。${state.criteria.offerDescription}。${state.eligibilityRules.join("；")}`;
      const embedding = await generateEmbedding(textToEmbed, "document");
      return { offerEmbedding: embedding };
    })
    .addNode("create", async (state) => {
      if (state.error || !state.criteria || state.requiresClarification) return {};
      const createdOffer = await createOfferDocument(
        db,
        state.criteria,
        state.eligibilityRules,
        state.offerEmbedding ?? []
      );
      return { createdOffer };
    })
    .addNode("summarize", async (state) => {
      if (state.error) return { reply: state.error };

      if (state.requiresClarification) {
        const guideText = state.guidanceQuestions
          .map((q, i) => `${i + 1}. ${q.question}（例如：${q.example}）`)
          .join("\n");
        return {
          reply:
            "在生成優惠前，需要您提供更多資訊，請回答以下問題：\n" + guideText,
        };
      }

      if (!state.createdOffer) {
        return { reply: "無法根據提供的描述創建優惠，請嘗試提供更具體的條件。" };
      }

      const stratDesc = strategyLabel(state.matchStrategy ?? "numeric-fallback");
      const matchCount = state.matchingPatronIds.length;

      const replyParts = [
        `優惠「${state.createdOffer.title}」（${state.createdOffer.offerId}）已提交，等待管理員審批。`,
        `匹配策略：${stratDesc}。`,
        `符合條件的賓客：${matchCount} 人。`,
        `篩選條件：${state.eligibilityRules.join("；")}。`,
        matchCount > 0
          ? `最高消費樣本賓客已顯示於影響圖表中。`
          : "目前沒有賓客符合此條件，請考慮放寬條件。",
        `請在「Offer Catalog」的「Proposed」篩選器中進行審核。`,
      ];
      return { reply: replyParts.join(" ") };
    })
    .addEdge(START, "parse")
    .addEdge("parse", "match")
    .addEdge("match", "embed")
    .addEdge("embed", "create")
    .addEdge("create", "summarize")
    .addEdge("summarize", END)
    .compile();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createOfferFromPrompt(db: Db, prompt: string) {
  const graph = buildOfferAgentGraph(db);
  const finalState = await graph.invoke({
    prompt,
    criteria: null,
    eligibilityRules: [],
    matchingPatronIds: [],
    matchStrategy: null,
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
