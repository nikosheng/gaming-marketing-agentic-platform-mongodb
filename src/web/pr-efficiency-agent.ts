import { Db } from "mongodb";
import type {
  PrMetrics,
  PrKpiResult,
  KpiSearchResult,
  InteractionType,
  PatronTier,
  PRAgentProfile,
} from "../types";
import { webCollections } from "./collections";
import { generateEmbedding } from "./llm/embeddings";
import { chatJson, isGatewayConfigured } from "./llm/gateway";

// ---------- PR Metrics ----------

/**
 * getPrMetrics — aggregates all interaction records by PR agent,
 * returning statistical summaries for the management dashboard.
 */
export async function getPrMetrics(db: Db): Promise<PrMetrics[]> {
  // 1. Aggregate interaction records by recordedBy (prAgentId)
  type InteractionAgg = {
    _id: string;
    totalInteractions: number;
    totalValueHKD: number;
    uniquePatrons: string[];
    lastInteractionAt: Date;
    byType: Array<{ type: string; count: number }>;
  };

  const interactionAgg = await db
    .collection(webCollections.patronInteractions)
    .aggregate<InteractionAgg>([
      {
        $group: {
          _id: "$recordedBy",
          totalInteractions: { $sum: 1 },
          totalValueHKD: { $sum: "$totalValueHKD" },
          uniquePatrons: { $addToSet: "$patronId" },
          lastInteractionAt: { $max: "$occurredAt" },
          tierAtTimes: { $push: "$patronTierAtTime" },
          types: { $push: "$type" },
        },
      },
    ])
    .toArray();

  // 2. Re-aggregate to get per-type breakdowns and tier distributions
  // We need a second pass to get type breakdown per PR
  type TypeBreakdownAgg = {
    _id: { recordedBy: string; type: string };
    count: number;
  };
  const typeBreakdowns = await db
    .collection(webCollections.patronInteractions)
    .aggregate<TypeBreakdownAgg>([
      {
        $group: {
          _id: { recordedBy: "$recordedBy", type: "$type" },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  type TierBreakdownAgg = {
    _id: { recordedBy: string; tier: string };
    count: number;
  };
  const tierBreakdowns = await db
    .collection(webCollections.patronInteractions)
    .aggregate<TierBreakdownAgg>([
      { $match: { patronTierAtTime: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: { recordedBy: "$recordedBy", tier: "$patronTierAtTime" },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  // 3. Fetch all active PR profiles
  const prProfiles = await db
    .collection<PRAgentProfile>(webCollections.prAgents)
    .find({}, { projection: { prAgentId: 1, name: 1, active: 1 } })
    .toArray();

  // 4. Build lookup maps
  const interactionMap = new Map(interactionAgg.map((r) => [r._id, r]));

  const typeMap = new Map<string, Partial<Record<InteractionType, number>>>();
  for (const tb of typeBreakdowns) {
    const prId = tb._id.recordedBy;
    if (!typeMap.has(prId)) typeMap.set(prId, {});
    typeMap.get(prId)![tb._id.type as InteractionType] = tb.count;
  }

  const tierMap = new Map<string, Partial<Record<PatronTier, number>>>();
  for (const tb of tierBreakdowns) {
    const prId = tb._id.recordedBy;
    if (!tierMap.has(prId)) tierMap.set(prId, {});
    tierMap.get(prId)![tb._id.tier as PatronTier] = tb.count;
  }

  // 5. Assemble PrMetrics for every PR profile
  return prProfiles.map((pr) => {
    const agg = interactionMap.get(pr.prAgentId);
    return {
      prAgentId: pr.prAgentId,
      name: pr.name,
      active: pr.active,
      totalInteractions: agg?.totalInteractions ?? 0,
      interactionsByType: typeMap.get(pr.prAgentId) ?? {},
      totalValueHKD: agg?.totalValueHKD ?? 0,
      uniquePatrons: agg?.uniquePatrons.length ?? 0,
      tierDistribution: tierMap.get(pr.prAgentId) ?? {},
      lastInteractionAt: agg?.lastInteractionAt,
    };
  });
}

// ---------- KPI Search ----------

const KPI_MATCH_THRESHOLD = 0.70; // cosine similarity threshold for a "match"
const VECTOR_SEARCH_LIMIT = 300;  // pull top-N records from the index (covers all PRs)
const VECTOR_NUM_CANDIDATES = 600;

/**
 * runKpiSearch — performs a single $vectorSearch across all interaction records,
 * groups results by PR, computes per-PR KPI achievement, then calls LLM for insight.
 */
export async function runKpiSearch(db: Db, kpiText: string): Promise<KpiSearchResult> {
  const now = new Date();

  // 1. Embed the KPI query text
  const queryVector = await generateEmbedding(kpiText, "query");

  // 2. Single $vectorSearch — no filter, group in application layer
  type VectorHit = {
    interactionId: string;
    patronId: string;
    recordedBy: string;
    type: string;
    occurredAt: Date;
    score: number;
  };

  let vectorHits: VectorHit[] = [];
  try {
    vectorHits = await db
      .collection(webCollections.patronInteractions)
      .aggregate<VectorHit>([
        {
          $vectorSearch: {
            index: "interaction_embedding_idx",
            path: "interactionEmbedding",
            queryVector,
            numCandidates: VECTOR_NUM_CANDIDATES,
            limit: VECTOR_SEARCH_LIMIT,
          },
        },
        {
          $project: {
            _id: 0,
            interactionId: 1,
            patronId: 1,
            recordedBy: 1,
            type: 1,
            occurredAt: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();
  } catch (err) {
    // Vector index may not exist yet (no data) — return graceful empty result
    console.warn("[pr-efficiency-agent] vectorSearch failed:", err);
  }

  // 3. Fetch all PR profiles and total interaction counts
  const [prProfiles, totalCountsAgg] = await Promise.all([
    db
      .collection<PRAgentProfile>(webCollections.prAgents)
      .find({ active: true }, { projection: { prAgentId: 1, name: 1 } })
      .toArray(),
    db
      .collection(webCollections.patronInteractions)
      .aggregate<{ _id: string; total: number }>([
        { $group: { _id: "$recordedBy", total: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const totalCountMap = new Map(totalCountsAgg.map((r) => [r._id, r.total]));

  // 4. Group vector hits by recordedBy
  type HitGroup = {
    matchedHits: VectorHit[];
    topScore: number;
  };
  const hitsByPr = new Map<string, HitGroup>();

  for (const hit of vectorHits) {
    const prId = hit.recordedBy;
    if (!hitsByPr.has(prId)) hitsByPr.set(prId, { matchedHits: [], topScore: 0 });
    const group = hitsByPr.get(prId)!;
    if (hit.score >= KPI_MATCH_THRESHOLD) {
      group.matchedHits.push(hit);
    }
    if (hit.score > group.topScore) group.topScore = hit.score;
  }

  // 5. Build PrKpiResult for each active PR
  const results: PrKpiResult[] = prProfiles.map((pr) => {
    const group = hitsByPr.get(pr.prAgentId);
    const totalInteractions = totalCountMap.get(pr.prAgentId) ?? 0;
    const matchedCount = group?.matchedHits.length ?? 0;
    const topMatchScore = group?.topScore ?? 0;
    const kpiAchievementRate =
      totalInteractions > 0 ? matchedCount / totalInteractions : 0;

    const matchedSamples = (group?.matchedHits ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((h) => ({
        type: h.type,
        occurredAt: h.occurredAt instanceof Date
          ? h.occurredAt.toISOString()
          : String(h.occurredAt),
        score: Math.round(h.score * 1000) / 1000,
      }));

    return {
      prAgentId: pr.prAgentId,
      prName: pr.name,
      topMatchScore: Math.round(topMatchScore * 1000) / 1000,
      matchedCount,
      totalInteractions,
      kpiAchievementRate: Math.round(kpiAchievementRate * 1000) / 1000,
      matchedSamples,
    };
  });

  // Sort by achievement rate desc, then by topMatchScore desc
  results.sort((a, b) =>
    b.kpiAchievementRate !== a.kpiAchievementRate
      ? b.kpiAchievementRate - a.kpiAchievementRate
      : b.topMatchScore - a.topMatchScore
  );

  const topPerformer = results.find((r) => r.totalInteractions > 0)?.prAgentId;
  const bottomPerformer = [...results]
    .reverse()
    .find((r) => r.totalInteractions > 0)?.prAgentId;

  // 6. Call LLM for management insight
  const { insight, actions } = await generateKpiInsight(kpiText, results);

  return {
    kpiText,
    results,
    topPerformer,
    bottomPerformer,
    insight,
    actions,
    searchedAt: now,
  };
}

// ---------- LLM Insight ----------

async function generateKpiInsight(
  kpiText: string,
  results: PrKpiResult[]
): Promise<{ insight: string; actions: string[] }> {
  const fallback = {
    insight: "資料不足，無法生成 AI 建議。",
    actions: ["請確保已記錄足夠的互動資料後再次搜尋。"],
  };

  if (!isGatewayConfigured()) return fallback;

  const prSummary = results
    .map(
      (r) =>
        `${r.prName}（${r.prAgentId}）：共 ${r.totalInteractions} 筆記錄，匹配 ${r.matchedCount} 筆，達成率 ${(r.kpiAchievementRate * 100).toFixed(0)}%，最高相似度 ${r.topMatchScore}`
    )
    .join("\n");

  const userPrompt = `
你是賭場行銷管理顧問。請根據以下公關人員的 KPI 達成情況，輸出 JSON 格式的管理建議（繁體中文）。

KPI 目標：${kpiText}

各公關人員表現：
${prSummary}

輸出格式：
{
  "insight": "（2-3句整體分析，指出表現差異、可能原因）",
  "actions": [
    "（針對管理層的具體行動建議1）",
    "（針對管理層的具體行動建議2）",
    "（針對管理層的具體行動建議3）"
  ]
}

要求：
- insight 著重橫向比較，點名表現最佳和最需改善的公關
- actions 提供管理層可以立即執行的具體步驟
- 若所有人達成率均為 0%，建議管理層先建立此類互動的記錄習慣
`.trim();

  const raw = await chatJson({
    system:
      "你是賭場行銷管理顧問，專責分析公關人員績效並給出管理建議。請嚴格按指定 JSON 格式輸出。",
    user: userPrompt,
    temperature: 0.4,
    maxTokens: 10000,
  });

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as { insight?: string; actions?: string[] };
    return {
      insight: parsed.insight ?? fallback.insight,
      actions:
        Array.isArray(parsed.actions) && parsed.actions.length > 0
          ? parsed.actions
          : fallback.actions,
    };
  } catch {
    return fallback;
  }
}
