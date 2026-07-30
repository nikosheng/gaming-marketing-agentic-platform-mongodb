import type { ConditionType } from "../types";

// ---------- Condition Parameter Schema ----------

export interface ConditionParamSchema {
  type: "integer" | "number" | "string[]";
  description: string;
  default: number | string[];
  min?: number;
  max?: number;
  allowedValues?: string[];
}

// ---------- Condition Definition ----------

export interface ConditionDefinition {
  type: ConditionType;
  displayName: string;
  description: string;
  semanticKeywords: string[];
  params: Record<string, ConditionParamSchema>;
  exampleNL: string;
}

// ---------- Catalog ----------

export const CONDITION_CATALOG: ConditionDefinition[] = [
  {
    type: "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
    displayName: "連續N輪下注超閾值",
    description:
      "同一 patron 在連續指定輪次中，每一輪的下注金額均超過閾值金額。" +
      "例如連續3輪每輪超過10000港幣。",
    semanticKeywords: [
      "連續", "consecutive", "每輪", "per round", "持續下注", "continuous",
      "每次都超過", "輪次", "rounds",
    ],
    params: {
      rounds: {
        type: "integer",
        description: "連續輪次數（需要連續幾輪滿足條件）",
        default: 3,
        min: 2,
        max: 10,
      },
      threshold: {
        type: "number",
        description: "每輪下注下限（港幣），每一輪都必須超過此金額",
        default: 10000,
        min: 100,
      },
    },
    exampleNL: "找到連續下注3輪每輪超過10000港幣的賭客",
  },

  {
    type: "CUMULATIVE_ROUNDS_BET_THRESHOLD",
    displayName: "N輪累計下注超閾值",
    description:
      "patron 在最近 N 輪內的下注總和超過閾值。" +
      "例如最近5輪累計下注總額超過50000港幣。",
    semanticKeywords: [
      "累計", "cumulative", "總額", "total", "合計", "N輪總和",
      "加起來", "累積", "total amount", "合共",
    ],
    params: {
      rounds: {
        type: "integer",
        description: "統計的輪次窗口大小",
        default: 5,
        min: 2,
        max: 20,
      },
      totalThreshold: {
        type: "number",
        description: "N輪累計下注下限（港幣）",
        default: 50000,
        min: 1000,
      },
    },
    exampleNL: "找5輪內總下注超過5萬港幣的賭客",
  },

  {
    type: "SINGLE_ROUND_ADT_MULTIPLIER",
    displayName: "單輪下注超ADT倍數",
    description:
      "patron 某輪下注金額超過其個人歷史平均每日消費（ADT）的 N 倍。" +
      "ADT是patron的歷史平均每日下注額，突然大幅超越代表行為異常。",
    semanticKeywords: [
      "ADT", "倍", "times", "multiplier", "異常", "spike", "突增",
      "正常水平", "average daily", "平均", "超過正常",
    ],
    params: {
      multiplier: {
        type: "number",
        description: "ADT 倍數閾值（下注金額需超過 ADT × multiplier）",
        default: 5,
        min: 1.5,
        max: 50,
      },
    },
    exampleNL: "找單輪下注超過個人ADT 5倍的賭客",
  },

  {
    type: "SESSION_BET_ABOVE",
    displayName: "本場累計下注超閾值",
    description:
      "patron 本次入座 session 的累計下注總額超過指定金額。" +
      "這反映patron在一整場遊戲中的總投入。",
    semanticKeywords: [
      "session", "本場", "本次", "入座以來", "this session",
      "一場", "這一場", "今次", "整場",
    ],
    params: {
      threshold: {
        type: "number",
        description: "session 累計下注下限（港幣）",
        default: 30000,
        min: 1000,
      },
    },
    exampleNL: "找本場累計下注超過3萬港幣的賭客",
  },

  {
    type: "TIER_MATCH",
    displayName: "Tier 級別篩選",
    description:
      "限定只對特定 Tier 級別的 patron 觸發 Alert。" +
      "可作為獨立條件，或與其他條件組合使用（OR 邏輯）。",
    semanticKeywords: [
      "gold", "platinum", "diamond", "金卡", "鉑金", "鑽石",
      "高端", "VIP", "tier", "級別", "等級", "silver", "bronze",
    ],
    params: {
      tiers: {
        type: "string[]",
        description: "符合條件的 tier 列表",
        default: ["Gold", "Platinum", "Diamond"],
        allowedValues: ["Bronze", "Silver", "Gold", "Platinum", "Diamond"],
      },
    },
    exampleNL: "找Platinum以上級別的賭客",
  },

  {
    type: "BEHAVIOR_TAG_MATCH",
    displayName: "行為標籤篩選",
    description:
      "patron 帶有特定的行為標籤，例如 Aggressive（激進下注）、" +
      "LateNight（深夜賭客）、PromoSeeker（促銷敏感）等。",
    semanticKeywords: [
      "aggressive", "激進", "aggressive bettor", "LateNight", "深夜",
      "PromoSeeker", "促銷", "CardCounterWatch", "算牌", "Conservative", "保守",
    ],
    params: {
      tags: {
        type: "string[]",
        description: "需要匹配的 behaviorTags 列表（任一標籤命中即滿足）",
        default: ["Aggressive"],
        allowedValues: [
          "Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker",
        ],
      },
    },
    exampleNL: "找帶有激進下注行為標籤的賭客",
  },
];

// ---------- Helpers ----------

export function getCatalogByType(type: ConditionType): ConditionDefinition | undefined {
  return CONDITION_CATALOG.find((c) => c.type === type);
}

/**
 * Build the condition catalog section for the LLM system prompt.
 * Returns a compact JSON string that fits well within the context window.
 */
export function buildCatalogPromptSection(): string {
  const compact = CONDITION_CATALOG.map((c) => ({
    type: c.type,
    displayName: c.displayName,
    description: c.description,
    semanticKeywords: c.semanticKeywords,
    params: Object.fromEntries(
      Object.entries(c.params).map(([k, v]) => [
        k,
        {
          type: v.type,
          description: v.description,
          default: v.default,
          ...(v.min !== undefined ? { min: v.min } : {}),
          ...(v.max !== undefined ? { max: v.max } : {}),
          ...(v.allowedValues ? { allowedValues: v.allowedValues } : {}),
        },
      ])
    ),
    exampleNL: c.exampleNL,
  }));
  return JSON.stringify(compact, null, 2);
}

// ---------- Seed rules (templates shown before user creates any rules) ----------

export const SEED_RULE_TEMPLATES: Array<{
  name: string;
  nlDescription: string;
  conditions: Array<{ type: ConditionType; params: Record<string, number | string | string[]>; confidence: number }>;
}> = [
  {
    name: "連續3輪高額下注",
    nlDescription: "找到連續下注3輪每輪超過10000港幣的賭客",
    conditions: [
      {
        type: "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
        params: { rounds: 3, threshold: 10000 },
        confidence: 1.0,
      },
    ],
  },
  {
    name: "5輪累計高額下注",
    nlDescription: "找5輪內總下注超過5萬港幣的賭客",
    conditions: [
      {
        type: "CUMULATIVE_ROUNDS_BET_THRESHOLD",
        params: { rounds: 5, totalThreshold: 50000 },
        confidence: 1.0,
      },
    ],
  },
  {
    name: "ADT異常突增",
    nlDescription: "找單輪下注超過個人ADT 5倍的賭客",
    conditions: [
      {
        type: "SINGLE_ROUND_ADT_MULTIPLIER",
        params: { multiplier: 5 },
        confidence: 1.0,
      },
    ],
  },
];
