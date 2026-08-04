/**
 * gateway.smoke.ts — end-to-end smoke test for the LiteLLM gateway.
 *
 * Run:
 *   npm run llm:smoke
 *
 * Expected output:
 *   ✓ chat completion returned N chars
 *   ✓ embedding returned <dim> floats, first value = ...
 *
 * Requires:
 *   - `npm run llm:up` (docker-compose stack running)
 *   - .env with LITELLM_BASE_URL + LITELLM_API_KEY
 */

import { chatText, isGatewayConfigured } from "../gateway";
import { generateEmbedding } from "../embeddings";
import { config } from "../../../config";

async function main() {
  console.log("LLM Gateway smoke test");
  console.log("-----------------------");
  console.log(`baseUrl        : ${config.llm.baseUrl}`);
  console.log(`chatModel      : ${config.llm.chatModel}`);
  console.log(`embeddingModel : ${config.llm.embeddingModel}`);
  console.log(`embeddingDim   : ${config.llm.embeddingDim}`);
  console.log(`apiKey set?    : ${config.llm.apiKey ? "yes" : "NO"}`);
  console.log("");

  if (!isGatewayConfigured()) {
    console.error("✗ Gateway is not configured (missing LITELLM_API_KEY?)");
    process.exit(1);
  }

  // 1. Chat
  console.log("→ Testing chat completion...");
  const t0 = Date.now();
  const chatOut = await chatText({
    system: "You are a helpful assistant. Reply in one short sentence.",
    user: "Say hello in Traditional Chinese.",
    maxTokens: 60,
  });
  const chatMs = Date.now() - t0;
  if (!chatOut) {
    console.error("✗ chat completion returned null");
    process.exit(1);
  }
  console.log(`✓ chat OK (${chatMs}ms): ${chatOut}`);
  console.log("");

  // 2. Embedding
  console.log("→ Testing embedding...");
  const e0 = Date.now();
  const vec = await generateEmbedding("鑽石等級賭客偏好百家樂", "document");
  const embMs = Date.now() - e0;
  const nonZero = vec.some((v) => v !== 0);
  if (!nonZero) {
    console.error("✗ embedding returned a zero vector");
    process.exit(1);
  }
  console.log(
    `✓ embedding OK (${embMs}ms): dim=${vec.length}, first=${vec[0].toFixed(6)}, last=${vec[vec.length - 1].toFixed(6)}`
  );
  console.log("");
  console.log("All checks passed.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
