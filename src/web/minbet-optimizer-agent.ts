import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Db } from "mongodb";
import { webCollections } from "./collections";

// ---------- Types ----------

type GameType = "Baccarat" | "Blackjack" | "Roulette" | "SicBo" | "Poker";
type OccupancyTrend = "Rising" | "Stable" | "Falling";

type TableSnapshot = {
  tableId: string;
  tableName: string;
  zone: string;
  gameType: GameType;
  minBet: number;
  maxBet: number;
  status: string;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
};

type ActiveSession = {
  patronId: string;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  tier: string;
};

type HistoryPoint = {
  refreshedAt: Date;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
};

type TrendResult = {
  label: OccupancyTrend;
  velocity: number; // -1..+1
  samples: number;
};

type DistributionResult = {
  p50: number;
  p75: number;
  p90: number;
  lowBetShare: number;
  betHeadroom: number;
  tierMix: Record<string, number>;
};

type Candidate = {
  minBet: number;
  deltaPct: number;
  expectedRevenuePct: number; // change vs current baseline
  estimatedRetentionPct: number;
};

type Decision = {
  recommendedMinBet: number;
  deltaPct: number;
  expectedRevenueUpliftPct: number;
  confidence: number;
  reasons: string[];
  skipped: boolean;
  skipReason?: string;
};

type Recommendation = {
  recommendationId: string;
  tableId: string;
  runId: string;
  currentMinBet: number;
  recommendedMinBet: number;
  deltaPct: number;
  expectedRevenueUpliftPct: number;
  confidence: number;
  rationale: string;
  reasons: string[];
  drivers: {
    occupancyTrend: OccupancyTrend;
    occupancyVelocity: number;
    occupancyRate: number;
    betHeadroom: number;
    lowBetShare: number;
    p50Bet: number;
    p75Bet: number;
    p90Bet: number;
    tierMix: Record<string, number>;
    zone: string;
    gameType: GameType;
  };
  candidates: Candidate[];
  status: "Proposed" | "Skipped";
  skipReason?: string;
  createdAt: string;
  expiresAt: string;
};

// ---------- Constants / guardrails ----------

const COOLDOWN_MINUTES = 20;
const PROPOSAL_TTL_MINUTES = 30;
const MAX_DELTA = 0.25; // ±25%
const HIGH_ROLLER_MAX_DELTA = 0.1; // ±10%
const HIGH_ROLLER_KEYWORDS = ["VIP", "High Roller", "HighRoller", "Premium"];

const GAME_FLOORS: Record<GameType, number> = {
  Baccarat: 100,
  Blackjack: 50,
  Roulette: 25,
  SicBo: 25,
  Poker: 100,
};

// Allowed min-bet steps per game (snap target to nearest step).
const GAME_STEPS: Record<GameType, number[]> = {
  Baccarat: [100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000],
  Blackjack: [50, 100, 200, 300, 500, 1000, 2000, 5000, 10000],
  Roulette: [25, 50, 100, 200, 500, 1000, 2000, 5000],
  SicBo: [25, 50, 100, 200, 500, 1000, 2000],
  Poker: [100, 200, 500, 1000, 2000, 5000, 10000],
};

// ---------- Helpers ----------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
}

function snapToStep(target: number, steps: number[]): number {
  if (steps.length === 0) return Math.max(1, Math.round(target));
  let best = steps[0];
  let bestDist = Math.abs(target - best);
  for (const step of steps) {
    const dist = Math.abs(target - step);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

function linearSlope(values: number[]): number {
  // Simple least-squares slope using indices as x.
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  if (den === 0) return 0;
  return num / den;
}

function isHighRollerZone(zone: string): boolean {
  const z = zone.toLowerCase();
  return HIGH_ROLLER_KEYWORDS.some((k) => z.includes(k.toLowerCase()));
}

// ---------- Optional LLM rationale ----------

async function generateLlmRationale(
  table: TableSnapshot,
  trend: TrendResult,
  dist: DistributionResult,
  decision: Decision
): Promise<string | null> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.1-mini";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview";

  if (!endpoint || !apiKey) return null;

  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const userPrompt = `You are a casino floor analyst. Write a concise 2-3 sentence explanation for a proposed min-bet change.

Table: ${table.tableName} (${table.gameType}, zone ${table.zone})
Current min bet: ${table.minBet}
Recommended min bet: ${decision.recommendedMinBet} (Δ ${(decision.deltaPct * 100).toFixed(1)}%)
Expected revenue uplift: ${(decision.expectedRevenueUpliftPct * 100).toFixed(1)}%
Occupancy: ${(table.occupancyRate * 100).toFixed(0)}% (trend ${trend.label}, velocity ${trend.velocity.toFixed(2)})
Bet headroom (avg/min): ${dist.betHeadroom.toFixed(2)}
Bet percentiles: p50 ${dist.p50}, p75 ${dist.p75}, p90 ${dist.p90}
Low-bet share: ${(dist.lowBetShare * 100).toFixed(0)}%
Reasons (bullets): ${decision.reasons.join("; ")}

Explain the recommendation in plain business language. Do not invent numbers.`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You write concise casino operations analyst rationales." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

function buildDeterministicRationale(
  table: TableSnapshot,
  trend: TrendResult,
  dist: DistributionResult,
  decision: Decision
): string {
  if (decision.skipped) {
    return `No change recommended for ${table.tableName}. ${decision.skipReason ?? ""}`.trim();
  }

  const direction =
    decision.deltaPct > 0 ? "raise" : decision.deltaPct < 0 ? "lower" : "hold";
  if (direction === "hold") {
    return `Current min bet at ${table.tableName} is already optimal. Occupancy ${(table.occupancyRate * 100).toFixed(0)}% with trend ${trend.label}, bet headroom ${dist.betHeadroom.toFixed(2)}x indicates no clear uplift opportunity.`;
  }
  return `Recommend ${direction} of min bet to ${decision.recommendedMinBet} (${(decision.deltaPct * 100).toFixed(1)}% change) at ${table.tableName}. Driver: ${trend.label} occupancy at ${(table.occupancyRate * 100).toFixed(0)}% with avg bet ${dist.betHeadroom.toFixed(2)}x the current floor and low-bet share ${(dist.lowBetShare * 100).toFixed(0)}%. Expected revenue uplift ~${(decision.expectedRevenueUpliftPct * 100).toFixed(1)}%.`;
}

// ---------- LangGraph state ----------

const AgentState = Annotation.Root({
  tableId: Annotation<string>,
  runId: Annotation<string>,
  actorId: Annotation<string>,
  table: Annotation<TableSnapshot | null>,
  sessions: Annotation<ActiveSession[]>,
  history: Annotation<HistoryPoint[]>,
  trend: Annotation<TrendResult | null>,
  distribution: Annotation<DistributionResult | null>,
  candidates: Annotation<Candidate[]>,
  decision: Annotation<Decision | null>,
  rationale: Annotation<string>,
  recommendationId: Annotation<string | null>,
  error: Annotation<string | null>,
});

// ---------- Node implementations ----------

async function observeNode(db: Db, state: typeof AgentState.State) {
  const table = await db
    .collection(webCollections.tables)
    .findOne<{
      tableId: string;
      tableName: string;
      zone: string;
      gameType: GameType;
      minBet: number;
      maxBet: number;
      status: string;
      patronCount: number;
      avgBetAmount: number;
      occupancyRate: number;
    }>(
      { tableId: state.tableId },
      {
        projection: {
          _id: 0,
          tableId: 1,
          tableName: 1,
          zone: 1,
          gameType: 1,
          minBet: 1,
          maxBet: 1,
          status: 1,
          patronCount: 1,
          avgBetAmount: 1,
          occupancyRate: 1,
        },
      }
    );

  if (!table) {
    return { error: `Table ${state.tableId} not found.` };
  }

  const sessions = (await db
    .collection(webCollections.sessions)
    .aggregate([
      { $match: { tableId: state.tableId, isActive: true } },
      {
        $lookup: {
          from: webCollections.patrons,
          localField: "patronId",
          foreignField: "patronId",
          as: "patron",
        },
      },
      { $unwind: { path: "$patron", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          patronId: 1,
          sessionBetAmount: 1,
          currentStackEstimate: 1,
          behaviorTags: 1,
          tier: { $ifNull: ["$patron.tier", "Bronze"] },
        },
      },
    ])
    .toArray()) as ActiveSession[];

  const history = (await db
    .collection(webCollections.tableStateHistory)
    .find(
      { tableId: state.tableId },
      {
        projection: {
          _id: 0,
          refreshedAt: 1,
          patronCount: 1,
          avgBetAmount: 1,
          occupancyRate: 1,
        },
      }
    )
    .sort({ refreshedAt: -1 })
    .limit(20)
    .toArray()) as unknown as HistoryPoint[];

  return {
    table: table as TableSnapshot,
    sessions,
    history: history.reverse(),
  };
}

function trendNode(state: typeof AgentState.State) {
  if (!state.table) return {};
  const counts = state.history.map((h) => h.patronCount);
  const samples = counts.length;

  // Fallback when no history yet: use 0 velocity, Stable.
  if (samples < 2) {
    return {
      trend: { label: "Stable" as OccupancyTrend, velocity: 0, samples },
    };
  }

  const slope = linearSlope(counts);
  // Normalize velocity to roughly [-1, 1] based on table capacity (~9 seats).
  const velocity = clamp(slope / 1.5, -1, 1);
  const label: OccupancyTrend =
    velocity > 0.15 ? "Rising" : velocity < -0.15 ? "Falling" : "Stable";
  return { trend: { label, velocity, samples } };
}

function distributionNode(state: typeof AgentState.State) {
  if (!state.table) return {};
  const minBet = state.table.minBet || 1;
  const bets = state.sessions
    .map((s) => Number(s.sessionBetAmount ?? 0))
    .filter((b) => b > 0)
    .sort((a, b) => a - b);

  const p50 = Math.round(percentile(bets, 0.5));
  const p75 = Math.round(percentile(bets, 0.75));
  const p90 = Math.round(percentile(bets, 0.9));
  const avgBet = state.table.avgBetAmount || (bets.length ? bets.reduce((a, b) => a + b, 0) / bets.length : 0);
  const betHeadroom = Number((avgBet / minBet).toFixed(3));

  const lowBetCount = bets.filter((b) => b <= minBet * 1.2).length;
  const lowBetShare = bets.length === 0 ? 0 : Number((lowBetCount / bets.length).toFixed(3));

  const tierMix: Record<string, number> = {};
  for (const session of state.sessions) {
    const tier = session.tier || "Bronze";
    tierMix[tier] = (tierMix[tier] ?? 0) + 1;
  }

  return {
    distribution: { p50, p75, p90, lowBetShare, betHeadroom, tierMix },
  };
}

function elasticityNode(state: typeof AgentState.State) {
  if (!state.table || !state.trend || !state.distribution) return {};

  const table = state.table;
  const dist = state.distribution;
  const trend = state.trend;

  const occupancyScore = clamp(table.occupancyRate, 0, 1);
  const velocityPos = clamp((trend.velocity + 1) / 2, 0, 1); // 0..1
  const stickiness = 1 - dist.lowBetShare; // 0..1 (higher = less price-sensitive)

  // Composite demand signal (0..1). Strong demand favors raising min bet.
  const demandSignal = clamp(
    0.5 * occupancyScore + 0.3 * velocityPos + 0.2 * stickiness,
    0,
    1
  );

  const baselinePatrons = Math.max(1, table.patronCount);
  const baselineAvgBet = Math.max(1, table.avgBetAmount);
  const baselineRevenue = baselinePatrons * baselineAvgBet;

  const deltaSet = [-0.25, -0.1, 0, 0.1, 0.25];
  const candidates: Candidate[] = deltaSet.map((delta) => {
    const targetMinBet = table.minBet * (1 + delta);

    // Estimated retention: raising drives away low-bet share proportionally;
    // lowering attracts marginal patrons (modest).
    let retention = 1;
    if (delta > 0) {
      retention = 1 - clamp(delta * (dist.lowBetShare + 0.2) * 2, 0, 0.7);
    } else if (delta < 0) {
      retention = 1 + clamp(Math.abs(delta) * 0.4 * (1 - occupancyScore), 0, 0.25);
    }
    retention = clamp(retention, 0.2, 1.3);

    // Estimated avg bet: anchored to max(new floor * 1.15, current p50).
    // When raising, average drifts up; when lowering, average drifts toward p50.
    const anchoredFloor = targetMinBet * 1.15;
    const estimatedAvgBet =
      delta > 0
        ? Math.max(anchoredFloor, dist.p50, baselineAvgBet * (1 + 0.5 * delta))
        : Math.max(targetMinBet, dist.p50, baselineAvgBet * (1 + 0.2 * delta));

    const estimatedPatrons = baselinePatrons * retention;
    const estimatedRevenue = estimatedPatrons * estimatedAvgBet;
    const expectedRevenuePct = (estimatedRevenue - baselineRevenue) / baselineRevenue;

    return {
      minBet: Math.round(targetMinBet),
      deltaPct: delta,
      expectedRevenuePct: Number(expectedRevenuePct.toFixed(4)),
      estimatedRetentionPct: Number(retention.toFixed(4)),
    };
  });

  // Bias selection by demandSignal: if low demand, lean toward 0/negative; if high, allow positive.
  const filteredByDemand = candidates.filter((c) => {
    if (demandSignal >= 0.65) return c.deltaPct >= 0; // confident to hold or raise
    if (demandSignal <= 0.35) return c.deltaPct <= 0; // soft demand: hold or cut
    return true;
  });

  const ranked = filteredByDemand
    .slice()
    .sort((a, b) => b.expectedRevenuePct - a.expectedRevenuePct);

  return { candidates: ranked };
}

function guardrailsNode(state: typeof AgentState.State) {
  if (!state.table || state.candidates.length === 0 || !state.distribution || !state.trend) {
    return {
      decision: {
        recommendedMinBet: state.table?.minBet ?? 0,
        deltaPct: 0,
        expectedRevenueUpliftPct: 0,
        confidence: 0,
        reasons: ["Insufficient data to compute optimization."],
        skipped: true,
        skipReason: "Insufficient data",
      } as Decision,
    };
  }

  const table = state.table;
  const dist = state.distribution;
  const trend = state.trend;
  const isHighRoller = isHighRollerZone(table.zone);
  const maxDelta = isHighRoller ? HIGH_ROLLER_MAX_DELTA : MAX_DELTA;

  const gameFloor = GAME_FLOORS[table.gameType] ?? 25;
  const steps = GAME_STEPS[table.gameType] ?? [25, 50, 100, 200, 500, 1000];

  // Filter by max delta cap and absolute floor.
  const allowed = state.candidates.filter((c) => Math.abs(c.deltaPct) <= maxDelta);
  const top = allowed[0];

  if (!top) {
    return {
      decision: {
        recommendedMinBet: table.minBet,
        deltaPct: 0,
        expectedRevenueUpliftPct: 0,
        confidence: 0.4,
        reasons: ["All candidates exceed delta guardrail. Holding current min bet."],
        skipped: false,
      } as Decision,
    };
  }

  // Snap target to allowed step and enforce game floor.
  let snapped = snapToStep(top.minBet, steps);
  if (snapped < gameFloor) snapped = gameFloor;

  const realizedDelta = (snapped - table.minBet) / Math.max(1, table.minBet);
  if (Math.abs(realizedDelta) > maxDelta) {
    // Snapping pushed past cap — choose nearest in-range step.
    const inRangeSteps = steps.filter(
      (s) => Math.abs((s - table.minBet) / Math.max(1, table.minBet)) <= maxDelta && s >= gameFloor
    );
    if (inRangeSteps.length > 0) {
      snapped = snapToStep(table.minBet * (1 + top.deltaPct), inRangeSteps);
    } else {
      snapped = table.minBet;
    }
  }

  const finalDelta = (snapped - table.minBet) / Math.max(1, table.minBet);

  // Reasons.
  const reasons: string[] = [];
  reasons.push(
    `Occupancy ${(table.occupancyRate * 100).toFixed(0)}% with ${trend.label.toLowerCase()} trend (velocity ${trend.velocity.toFixed(2)})`
  );
  reasons.push(
    `Average bet is ${dist.betHeadroom.toFixed(2)}x current min; p75 ${dist.p75}, p90 ${dist.p90}`
  );
  reasons.push(`Low-bet share ${(dist.lowBetShare * 100).toFixed(0)}%`);
  if (isHighRoller) reasons.push("High-roller zone: tighter ±10% cap applied");
  if (finalDelta === 0) reasons.push("No materially better option than holding current min bet");

  // Confidence: based on history depth, demand consistency, and absolute uplift size.
  const historyConfidence = clamp(trend.samples / 10, 0, 1) * 0.4;
  const upliftConfidence = clamp(Math.abs(top.expectedRevenuePct) * 4, 0, 1) * 0.4;
  const stickinessConfidence = (1 - dist.lowBetShare) * 0.2;
  let confidence = historyConfidence + upliftConfidence + stickinessConfidence;
  if (isHighRoller) confidence = Math.min(confidence, 0.65);
  confidence = Number(clamp(confidence, 0.2, 0.95).toFixed(3));

  return {
    decision: {
      recommendedMinBet: snapped,
      deltaPct: Number(finalDelta.toFixed(4)),
      expectedRevenueUpliftPct: top.expectedRevenuePct,
      confidence,
      reasons,
      skipped: false,
    } as Decision,
  };
}

async function cooldownCheckNode(db: Db, state: typeof AgentState.State) {
  if (!state.decision || state.decision.skipped || state.decision.deltaPct === 0) return {};
  const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60_000);
  const recent = await db
    .collection(webCollections.minBetAudit)
    .findOne({ tableId: state.tableId, at: { $gte: cutoff } });
  if (recent) {
    return {
      decision: {
        ...state.decision,
        recommendedMinBet: state.table?.minBet ?? 0,
        deltaPct: 0,
        expectedRevenueUpliftPct: 0,
        skipped: true,
        skipReason: `Cooldown active (last change within ${COOLDOWN_MINUTES} minutes)`,
        reasons: [
          ...state.decision.reasons,
          `Cooldown active — last change at ${recent.at instanceof Date ? recent.at.toISOString() : String(recent.at)}`,
        ],
      } as Decision,
    };
  }
  return {};
}

async function rationaleNode(state: typeof AgentState.State) {
  if (!state.table || !state.decision || !state.trend || !state.distribution) {
    return { rationale: "Unable to generate rationale due to missing inputs." };
  }

  // Try LLM first; fall back to deterministic prose on any failure.
  const llm = await generateLlmRationale(
    state.table,
    state.trend,
    state.distribution,
    state.decision
  ).catch(() => null);

  if (llm && llm.length > 0) {
    return { rationale: llm };
  }
  return {
    rationale: buildDeterministicRationale(
      state.table,
      state.trend,
      state.distribution,
      state.decision
    ),
  };
}

async function persistNode(db: Db, state: typeof AgentState.State) {
  if (!state.table || !state.decision || !state.trend || !state.distribution) {
    return { recommendationId: null };
  }

  const now = new Date();
  const recommendationId = `MBR-${now.getTime().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000);

  const doc = {
    recommendationId,
    tableId: state.table.tableId,
    runId: state.runId,
    currentMinBet: state.table.minBet,
    recommendedMinBet: state.decision.recommendedMinBet,
    deltaPct: state.decision.deltaPct,
    expectedRevenueUpliftPct: state.decision.expectedRevenueUpliftPct,
    confidence: state.decision.confidence,
    rationale: state.rationale,
    reasons: state.decision.reasons,
    drivers: {
      occupancyTrend: state.trend.label,
      occupancyVelocity: state.trend.velocity,
      occupancyRate: state.table.occupancyRate,
      betHeadroom: state.distribution.betHeadroom,
      lowBetShare: state.distribution.lowBetShare,
      p50Bet: state.distribution.p50,
      p75Bet: state.distribution.p75,
      p90Bet: state.distribution.p90,
      tierMix: state.distribution.tierMix,
      zone: state.table.zone,
      gameType: state.table.gameType,
    },
    candidates: state.candidates,
    status: state.decision.skipped ? "Skipped" : "Proposed",
    skipReason: state.decision.skipReason,
    createdAt: now,
    expiresAt,
  };

  if (!state.decision.skipped) {
    await db.collection(webCollections.minBetRecommendations).insertOne(doc as any);
  }

  return { recommendationId: state.decision.skipped ? null : recommendationId };
}

// ---------- Graph builder ----------

function buildOptimizerGraph(db: Db) {
  return new StateGraph(AgentState)
    .addNode("observe_state", async (state) => observeNode(db, state))
    .addNode("compute_trend", async (state) => trendNode(state))
    .addNode("compute_distribution", async (state) => distributionNode(state))
    .addNode("score_elasticity", async (state) => elasticityNode(state))
    .addNode("apply_guardrails", async (state) => guardrailsNode(state))
    .addNode("check_cooldown", async (state) => cooldownCheckNode(db, state))
    .addNode("generate_rationale", async (state) => rationaleNode(state))
    .addNode("persist_recommendation", async (state) => persistNode(db, state))
    .addEdge(START, "observe_state")
    .addEdge("observe_state", "compute_trend")
    .addEdge("compute_trend", "compute_distribution")
    .addEdge("compute_distribution", "score_elasticity")
    .addEdge("score_elasticity", "apply_guardrails")
    .addEdge("apply_guardrails", "check_cooldown")
    .addEdge("check_cooldown", "generate_rationale")
    .addEdge("generate_rationale", "persist_recommendation")
    .addEdge("persist_recommendation", END)
    .compile();
}

// ---------- Public API ----------

export async function runMinBetOptimizer(
  db: Db,
  tableId: string,
  actorId: string = "system"
): Promise<Recommendation | null> {
  const graph = buildOptimizerGraph(db);
  const runId = `RUN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const result = await graph.invoke({
    tableId,
    runId,
    actorId,
    table: null,
    sessions: [],
    history: [],
    trend: null,
    distribution: null,
    candidates: [],
    decision: null,
    rationale: "",
    recommendationId: null,
    error: null,
  });

  if (result.error || !result.table || !result.decision || !result.trend || !result.distribution) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000);

  return {
    recommendationId: result.recommendationId ?? `MBR-SKIPPED-${Date.now().toString(36)}`,
    tableId: result.table.tableId,
    runId,
    currentMinBet: result.table.minBet,
    recommendedMinBet: result.decision.recommendedMinBet,
    deltaPct: result.decision.deltaPct,
    expectedRevenueUpliftPct: result.decision.expectedRevenueUpliftPct,
    confidence: result.decision.confidence,
    rationale: result.rationale,
    reasons: result.decision.reasons,
    drivers: {
      occupancyTrend: result.trend.label,
      occupancyVelocity: result.trend.velocity,
      occupancyRate: result.table.occupancyRate,
      betHeadroom: result.distribution.betHeadroom,
      lowBetShare: result.distribution.lowBetShare,
      p50Bet: result.distribution.p50,
      p75Bet: result.distribution.p75,
      p90Bet: result.distribution.p90,
      tierMix: result.distribution.tierMix,
      zone: result.table.zone,
      gameType: result.table.gameType,
    },
    candidates: result.candidates,
    status: result.decision.skipped ? "Skipped" : "Proposed",
    skipReason: result.decision.skipReason,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}
