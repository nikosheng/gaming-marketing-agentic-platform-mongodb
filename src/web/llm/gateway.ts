/**
 * gateway.ts — unified LLM client wrapping the LiteLLM gateway.
 *
 * All chat completions in the app funnel through here. The gateway is an
 * OpenAI-compatible endpoint (LiteLLM) that routes to Azure OpenAI or any
 * configured fallback (see infra/litellm/config.yaml).
 *
 * Design goals:
 *   - Model name is a gateway alias ("chat-primary"), never a provider
 *     deployment name. Physical routing is a server-side concern.
 *   - graceful degradation: on error / missing API key, return null and let
 *     the caller decide the fallback UX (matches existing agent behaviour).
 *   - lightweight retry: 3 attempts w/ exponential backoff on network / 5xx.
 */

import OpenAI from "openai";
import { config } from "../../config";

// ---------- Types ----------

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  system: string;
  user: string;
  /** Gateway model alias. Defaults to config.llm.chatModel ("chat-primary"). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** AbortController.signal for cancellation. */
  signal?: AbortSignal;
};

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
    // OpenAI SDK does its own retry; we still wrap with a manual retry loop
    // below for finer-grained control.
    maxRetries: 0,
  });
  return _client;
}

/**
 * True if the gateway has enough config to attempt a call. Agents use this
 * to decide whether to fall back to their non-LLM code paths, mirroring the
 * pre-migration behaviour that gated on AZURE_OPENAI_ENDPOINT / API_KEY.
 */
export function isGatewayConfigured(): boolean {
  return Boolean(config.llm.apiKey && config.llm.baseUrl);
}

// ---------- Retry helper ----------

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [500, 1000, 2000];
  let lastErr: unknown;
  for (let attempt = 0; attempt < delays.length + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Retry only on retryable HTTP statuses / network errors
      const status = (err as { status?: number })?.status;
      const isRetryable =
        status === undefined /* network */ ||
        RETRY_STATUSES.has(status);
      if (!isRetryable || attempt === delays.length) {
        throw err;
      }
      // Respect Retry-After if present (OpenAI SDK exposes it via headers)
      const headers = (err as { headers?: Record<string, string> })?.headers;
      const retryAfter = headers?.["retry-after"]
        ? Number(headers["retry-after"]) * 1000
        : delays[attempt];
      await new Promise((r) => setTimeout(r, retryAfter));
    }
  }
  throw lastErr;
}

// ---------- Public API ----------

/**
 * chatText — plain-text chat completion. Returns the assistant's text or null
 * on any failure (matches the pre-migration `callAzureOpenAI` contract).
 */
export async function chatText(opts: ChatOptions): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const model = opts.model ?? config.llm.chatModel;

  try {
    return await withRetry(async () => {
      const res = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature ?? 0.3,
          max_completion_tokens: opts.maxTokens ?? 800,
        },
        { signal: opts.signal }
      );
      return res.choices?.[0]?.message?.content?.trim() ?? null;
    });
  } catch (err) {
    console.error("[llm/gateway] chatText failed:", err);
    return null;
  }
}

/**
 * chatJson — chat completion with `response_format: json_object`.
 * Returns the raw JSON string (parsing is caller's responsibility, so
 * validation logic stays close to each domain type).
 */
export async function chatJson(opts: ChatOptions): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const model = opts.model ?? config.llm.chatModel;

  try {
    return await withRetry(async () => {
      const res = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature ?? 0.2,
          max_completion_tokens: opts.maxTokens ?? 1500,
          response_format: { type: "json_object" },
        },
        { signal: opts.signal }
      );
      return res.choices?.[0]?.message?.content?.trim() ?? null;
    });
  } catch (err) {
    console.error("[llm/gateway] chatJson failed:", err);
    return null;
  }
}
