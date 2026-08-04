/**
 * embeddings.ts — unified embedding client.
 *
 * Talks to the LiteLLM gateway, which forwards to a local TEI container
 * serving voyageai/voyage-4-nano. Output dimension is fixed at 1024 (MRL
 * truncation) so existing Mongo Atlas Vector Search indexes remain valid.
 *
 * Voyage-4-nano expects task-specific prompt prefixes (per the model card):
 *   query    → "Represent the query for retrieving supporting documents: "
 *   document → "Represent the document for retrieval: "
 *
 * We inject these on the client side so the gateway config stays minimal
 * (no dependency on TEI-specific --prompts CLI options).
 */

import OpenAI from "openai";
import { config } from "../../config";

// ---------- Prompt prefixes (voyage-4-nano) ----------

const QUERY_PROMPT = "Represent the query for retrieving supporting documents: ";
const DOCUMENT_PROMPT = "Represent the document for retrieval: ";

function withPrompt(text: string, inputType: "query" | "document"): string {
  return (inputType === "query" ? QUERY_PROMPT : DOCUMENT_PROMPT) + text;
}

// ---------- Client (lazy singleton) ----------

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!config.llm.apiKey || !config.llm.baseUrl) {
    return null;
  }
  if (_client) return _client;
  _client = new OpenAI({
    baseURL: config.llm.baseUrl.replace(/\/$/, "") + "/v1",
    apiKey: config.llm.apiKey,
    maxRetries: 2,
  });
  return _client;
}

function zeroVector(): number[] {
  return Array.from({ length: config.llm.embeddingDim }, () => 0);
}

// ---------- Public API ----------

/**
 * generateEmbedding — embed a single string.
 *
 * Falls back to a zero-vector on missing config or upstream failure. This
 * matches the pre-migration contract; callers check `some(v => v !== 0)`
 * to detect degraded state.
 */
export async function generateEmbedding(
  text: string,
  inputType: "document" | "query" = "document"
): Promise<number[]> {
  const client = getClient();
  if (!client) {
    console.warn("[llm/embeddings] LITELLM_API_KEY missing — returning zero vector");
    return zeroVector();
  }

  try {
    const res = await client.embeddings.create({
      model: config.llm.embeddingModel,
      input: withPrompt(text, inputType),
      // OpenAI-compatible dimensions parameter → TEI honors via MRL truncation.
      dimensions: config.llm.embeddingDim,
    });
    const embedding = res.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error("gateway returned empty embedding");
    }
    return embedding as number[];
  } catch (err) {
    console.error("[llm/embeddings] generation failed:", err);
    return zeroVector();
  }
}

/**
 * generateEmbeddingBatch — embed an array of strings in a single request.
 *
 * Returns vectors in the same order as inputs. On failure the entire batch
 * degrades to zero-vectors (again matching the pre-migration contract).
 */
export async function generateEmbeddingBatch(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  if (!client) {
    console.warn("[llm/embeddings] LITELLM_API_KEY missing — returning zero vectors");
    return texts.map(() => zeroVector());
  }

  try {
    const res = await client.embeddings.create({
      model: config.llm.embeddingModel,
      input: texts.map((t) => withPrompt(t, inputType)),
      dimensions: config.llm.embeddingDim,
    });

    if (!res.data || res.data.length === 0) {
      throw new Error("gateway returned empty batch response");
    }

    // OpenAI-compatible response guarantees data[i].index matches input order,
    // but reconstruct by index to be safe.
    const result: number[][] = Array.from({ length: texts.length }, () =>
      zeroVector()
    );
    for (const item of res.data) {
      const idx = (item as { index?: number }).index;
      if (typeof idx === "number" && item.embedding && item.embedding.length > 0) {
        result[idx] = item.embedding as number[];
      }
    }
    return result;
  } catch (err) {
    console.error("[llm/embeddings] batch generation failed:", err);
    return texts.map(() => zeroVector());
  }
}

// ---------- Domain helper (kept identical to pre-migration behaviour) ----------

/**
 * buildInteractionEmbeddingText — converts a PatronInteractionRecord
 * into a descriptive Chinese sentence suitable for semantic embedding.
 *
 * The text is designed to be semantically rich so that KPI queries like
 * "為高Tier賭客安排免費房間" will match similar records at high cosine similarity.
 */
export function buildInteractionEmbeddingText(params: {
  type: string;
  totalValueHKD: number;
  tier?: string;
  detail: Record<string, unknown>;
  occurredAt: Date | string;
}): string {
  const { type, totalValueHKD, tier, detail, occurredAt } = params;
  const date = new Date(occurredAt).toISOString().slice(0, 10);
  const tierStr = tier ? `${tier}等級賭客` : "賭客";
  const valueStr = totalValueHKD > 0 ? `，價值 HKD ${totalValueHKD.toLocaleString()}` : "";

  switch (type) {
    case "ROOM_COMP":
      return `為${tierStr}安排免費房間住宿，房型：${detail.roomType ?? "不詳"}，${detail.roomNights ?? 1}晚${valueStr}，日期 ${date}`;
    case "FB_COMP":
      return `為${tierStr}安排餐飲優惠${detail.venue ? `，餐廳：${String(detail.venue)}` : ""}${valueStr}，日期 ${date}`;
    case "REBATE":
      return `為${tierStr}提供現金或籌碼回贈${detail.rebateRate ? `，回贈率 ${(Number(detail.rebateRate) * 100).toFixed(1)}%` : ""}${valueStr}，日期 ${date}`;
    case "EVENT_INVITE":
      return `邀請${tierStr}參加VIP活動${detail.eventName ? `，活動名稱：${String(detail.eventName)}` : ""}，${detail.attended ? "已出席" : "邀請已發送"}，日期 ${date}`;
    case "OUTREACH":
      return `主動聯繫${tierStr}，渠道：${detail.channel ?? "電話"}，結果：${detail.outcome ?? "不詳"}${detail.notes ? `，備注：${String(detail.notes)}` : ""}，日期 ${date}`;
    case "TRANSFER":
      return `為${tierStr}安排${detail.transferType ?? ""}接送服務，車型：${detail.vehicleClass ?? "標準"}，日期 ${date}`;
    default:
      return `公關互動記錄，類型：${type}${valueStr}，日期 ${date}`;
  }
}
