import { config } from "../config";

/** Atlas-hosted Voyage AI endpoint (uses Atlas API key with al- prefix) */
const VOYAGE_ENDPOINT = "https://ai.mongodb.com/v1/embeddings";

/**
 * generateEmbedding — shared Voyage AI embedding function.
 *
 * input_type:
 *   "document" — for content being indexed (interactions, offers, patron profiles)
 *   "query"    — for search queries (KPI text, semantic search terms)
 *
 * Falls back to a zero-vector when VOYAGE_API_KEY is missing or the API fails.
 */
export async function generateEmbedding(
  text: string,
  inputType: "document" | "query" = "document"
): Promise<number[]> {
  const apiKey = config.voyageApiKey;
  const dim = config.vectorEmbeddingDim ?? 1024;
  const fallback = Array.from({ length: dim }, () => 0);

  if (!apiKey) {
    console.warn("[embedding] VOYAGE_API_KEY missing — returning zero vector");
    return fallback;
  }

  try {
    const res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [text],
        model: "voyage-4",
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage AI error (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error("Voyage AI returned empty embedding");
    }
    return embedding;
  } catch (err) {
    console.error("[embedding] generation failed:", err);
    return fallback;
  }
}

/**
 * generateEmbeddingBatch — generates embeddings for multiple texts in a single
 * Voyage AI API call (up to 128 inputs per request).
 *
 * Returns an array of 1024-dim vectors in the same order as the input texts.
 * Falls back to zero-vectors for the entire batch on API failure.
 */
export async function generateEmbeddingBatch(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  const apiKey = config.voyageApiKey;
  const dim = config.vectorEmbeddingDim ?? 1024;
  const fallback = texts.map(() => Array.from({ length: dim }, () => 0));

  if (!apiKey) {
    console.warn("[embedding] VOYAGE_API_KEY missing — returning zero vectors");
    return fallback;
  }

  if (texts.length === 0) return [];

  try {
    const res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: "voyage-4",
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage AI error (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      data?: Array<{ index: number; embedding?: number[] }>;
    };

    if (!data.data || data.data.length === 0) {
      throw new Error("Voyage AI returned empty batch response");
    }

    // Reconstruct in original order using the index field
    const result: number[][] = Array.from({ length: texts.length }, () =>
      Array.from({ length: dim }, () => 0)
    );
    for (const item of data.data) {
      if (item.embedding && item.embedding.length > 0) {
        result[item.index] = item.embedding;
      }
    }
    return result;
  } catch (err) {
    console.error("[embedding] batch generation failed:", err);
    return fallback;
  }
}

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
