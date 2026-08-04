import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Db } from "mongodb";
import type { AlertRule, AlertRulePreview, ConditionType, ParsedCondition } from "../types";
import { CONDITION_CATALOG, buildCatalogPromptSection, getCatalogByType } from "./condition-catalog";
import { webCollections } from "./collections";
import { chatJson, isGatewayConfigured } from "./llm/gateway";

// ---------- Types ----------

type LlmMatchedCondition = {
  type: string;
  confidence: number;
  extractedParams: Record<string, unknown>;
};

type LlmParseResult = {
  matchedConditions: LlmMatchedCondition[];
  ruleName: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
};

type AgentMode = "preview" | "persist";

const AlertRuleAgentState = Annotation.Root({
  nlDescription: Annotation<string>,
  mode: Annotation<AgentMode>,
  // parse_intent output
  llmResult: Annotation<LlmParseResult | null>,
  // map_conditions output
  validatedConditions: Annotation<ParsedCondition[]>,
  ruleName: Annotation<string>,
  // validate output
  preview: Annotation<AlertRulePreview | null>,
  // persist output
  ruleId: Annotation<string | null>,
  error: Annotation<string | null>,
});

// ---------- System prompt ----------

function buildSystemPrompt(): string {
  return `You are a casino alert rule configuration assistant.
Analyze the user's natural language description and identify which conditions
from the catalog below are being requested. Extract all numeric parameters precisely.

Condition Catalog:
${buildCatalogPromptSection()}

Return ONLY valid JSON (no extra text, no markdown):
{
  "matchedConditions": [
    {
      "type": "<ConditionType from catalog>",
      "confidence": <0.0-1.0>,
      "extractedParams": { "<param_name>": <extracted_value> }
    }
  ],
  "ruleName": "<concise name in Traditional Chinese, max 15 chars>",
  "needsClarification": <true|false>,
  "clarificationQuestion": "<Traditional Chinese question, only if needsClarification is true>"
}

Number extraction rules:
- "3輪" → rounds: 3
- "20000港幣" or "兩萬" or "2萬" → threshold: 20000
- "5萬" → 50000, "10萬" → 100000, "百萬" → 1000000
- "5倍" → multiplier: 5, "十倍" → 10
- If a param is not mentioned, use the catalog default value
- If param is ambiguous, use default and set confidence < 0.75

Condition matching rules:
- ONLY use condition types from the catalog — never invent new types
- Multiple conditions are allowed (they will be combined with OR logic)
- If the description clearly matches a condition, set confidence >= 0.85
- If no condition can be matched at all, set needsClarification: true
- Do not output any explanation outside the JSON`;
}

// ---------- Nodes ----------

async function parseIntentNode(state: typeof AlertRuleAgentState.State) {
  if (!isGatewayConfigured()) {
    return {
      error:
        "AI_NOT_CONFIGURED: 請配置 LITELLM_BASE_URL 和 LITELLM_API_KEY 環境變量以使用 NL 規則解析功能。",
    };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = `用戶描述: "${state.nlDescription}"`;

  const raw = await chatJson({
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.1,
    maxTokens: 800,
  });
  if (!raw) {
    return {
      error: "LLM_CALL_FAILED: 無法調用 AI 服務，請稍後重試。",
    };
  }

  try {
    const parsed = JSON.parse(raw) as LlmParseResult;
    return { llmResult: parsed };
  } catch {
    return {
      error: `LLM_PARSE_ERROR: AI 返回了無效的 JSON 格式。原始響應: ${raw.slice(0, 200)}`,
    };
  }
}

function mapConditionsNode(state: typeof AlertRuleAgentState.State) {
  if (state.error || !state.llmResult) return {};

  const llm = state.llmResult;

  if (llm.needsClarification || llm.matchedConditions.length === 0) {
    return {
      validatedConditions: [],
      ruleName: "",
    };
  }

  const validatedConditions: ParsedCondition[] = [];

  for (const mc of llm.matchedConditions) {
    // Validate that the type exists in the catalog
    const definition = getCatalogByType(mc.type as ConditionType);
    if (!definition) continue; // skip unknown types

    // Validate and fill params against catalog schema
    const finalParams: Record<string, number | string | string[]> = {};
    for (const [paramName, schema] of Object.entries(definition.params)) {
      const extracted = mc.extractedParams[paramName];

      if (extracted !== undefined && extracted !== null) {
        if (schema.type === "string[]") {
          // Validate each value against allowedValues if specified
          const arr = Array.isArray(extracted) ? extracted : [extracted];
          const strArr = arr.map(String);
          if (schema.allowedValues) {
            const valid = strArr.filter((v) => schema.allowedValues!.includes(v));
            finalParams[paramName] = valid.length > 0 ? valid : (schema.default as string[]);
          } else {
            finalParams[paramName] = strArr;
          }
        } else {
          // integer / number
          const num = Number(extracted);
          if (!Number.isNaN(num)) {
            const clamped =
              schema.min !== undefined && schema.max !== undefined
                ? Math.max(schema.min, Math.min(schema.max, num))
                : schema.min !== undefined
                  ? Math.max(schema.min, num)
                  : schema.max !== undefined
                    ? Math.min(schema.max, num)
                    : num;
            finalParams[paramName] =
              schema.type === "integer" ? Math.round(clamped) : clamped;
          } else {
            finalParams[paramName] = schema.default as number;
          }
        }
      } else {
        // Use catalog default
        finalParams[paramName] = schema.default as number | string[];
      }
    }

    validatedConditions.push({
      type: mc.type as ConditionType,
      params: finalParams,
      confidence: Math.max(0, Math.min(1, mc.confidence)),
    });
  }

  return {
    validatedConditions,
    ruleName: llm.ruleName || "自定義高價值規則",
  };
}

function validateNode(state: typeof AlertRuleAgentState.State) {
  if (state.error) return {};

  const llm = state.llmResult;

  if (!llm) {
    return {
      preview: {
        ruleName: "",
        nlDescription: state.nlDescription,
        conditions: [],
        needsClarification: true,
        clarificationQuestion: "無法解析您的描述，請重新嘗試。",
      } as AlertRulePreview,
    };
  }

  if (llm.needsClarification || state.validatedConditions.length === 0) {
    return {
      preview: {
        ruleName: "",
        nlDescription: state.nlDescription,
        conditions: [],
        needsClarification: true,
        clarificationQuestion:
          llm.clarificationQuestion || "請提供更具體的條件描述，例如下注輪次數和金額閾值。",
      } as AlertRulePreview,
    };
  }

  return {
    preview: {
      ruleName: state.ruleName,
      nlDescription: state.nlDescription,
      conditions: state.validatedConditions,
      needsClarification: false,
    } as AlertRulePreview,
  };
}

async function persistRuleNode(db: Db, state: typeof AlertRuleAgentState.State) {
  if (state.error || state.mode !== "persist" || !state.preview) return {};
  if (state.preview.needsClarification || state.preview.conditions.length === 0) return {};

  const ruleId = `RULE-${Date.now()}`;
  const now = new Date();

  const rule: AlertRule = {
    ruleId,
    name: state.preview.ruleName,
    nlDescription: state.preview.nlDescription,
    conditions: state.preview.conditions,
    conditionLogic: "OR",
    status: "Active",
    totalTriggered: 0,
    createdAt: now,
  };

  await db.collection(webCollections.alertRules).insertOne(rule as never);

  return { ruleId };
}

// ---------- Graph builder ----------

function buildAlertRuleGraph(db: Db) {
  return new StateGraph(AlertRuleAgentState)
    .addNode("parse_intent", async (state) => parseIntentNode(state))
    .addNode("map_conditions", async (state) => mapConditionsNode(state))
    .addNode("validate", async (state) => validateNode(state))
    .addNode("persist_rule", async (state) => persistRuleNode(db, state))
    .addEdge(START, "parse_intent")
    .addEdge("parse_intent", "map_conditions")
    .addEdge("map_conditions", "validate")
    .addEdge("validate", "persist_rule")
    .addEdge("persist_rule", END)
    .compile();
}

// ---------- Public API ----------

/**
 * Parse NL description and return a preview (no DB write).
 * Returns the preview and any error string.
 */
export async function previewAlertRule(
  db: Db,
  nlDescription: string
): Promise<{ preview: AlertRulePreview | null; error: string | null }> {
  const graph = buildAlertRuleGraph(db);
  const result = await graph.invoke({
    nlDescription,
    mode: "preview" as AgentMode,
    llmResult: null,
    validatedConditions: [],
    ruleName: "",
    preview: null,
    ruleId: null,
    error: null,
  });

  return {
    preview: result.preview,
    error: result.error ?? null,
  };
}

/**
 * Persist a confirmed preview as an AlertRule in the database.
 * The preview is passed back from the frontend after user confirmation.
 */
export async function persistAlertRule(
  db: Db,
  preview: AlertRulePreview
): Promise<{ ruleId: string | null; error: string | null }> {
  if (preview.needsClarification || preview.conditions.length === 0) {
    return { ruleId: null, error: "INVALID_PREVIEW: 預覽包含未解決的問題，無法創建規則。" };
  }

  const ruleId = `RULE-${Date.now()}`;
  const now = new Date();

  const rule: AlertRule = {
    ruleId,
    name: preview.ruleName,
    nlDescription: preview.nlDescription,
    conditions: preview.conditions,
    conditionLogic: "OR",
    status: "Active",
    totalTriggered: 0,
    createdAt: now,
  };

  await db.collection(webCollections.alertRules).insertOne(rule as never);

  return { ruleId, error: null };
}

/**
 * Seed the 3 template rules if the collection is empty.
 * Called by the GET /api/alert-rules route.
 */
export async function seedTemplateRulesIfEmpty(db: Db): Promise<AlertRule[]> {
  const { SEED_RULE_TEMPLATES } = await import("./condition-catalog");

  const existing = await db
    .collection(webCollections.alertRules)
    .countDocuments({});

  if (existing > 0) {
    return db
      .collection<AlertRule>(webCollections.alertRules)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
  }

  const now = new Date();
  const rules: AlertRule[] = SEED_RULE_TEMPLATES.map((t, i) => ({
    ruleId: `RULE-SEED-00${i + 1}`,
    name: t.name,
    nlDescription: t.nlDescription,
    conditions: t.conditions,
    conditionLogic: "OR" as const,
    status: "Active" as const,
    totalTriggered: 0,
    createdAt: new Date(now.getTime() - i * 1000),
  }));

  await db.collection(webCollections.alertRules).insertMany(rules as never[]);
  return rules;
}
