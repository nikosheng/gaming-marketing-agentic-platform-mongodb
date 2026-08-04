/**
 * embedding.ts — compatibility shim.
 *
 * The embedding implementation has moved to `./llm/embeddings` (LiteLLM
 * gateway + local TEI voyage-4-nano). This file remains as a re-export so
 * existing `import { ... } from "./embedding"` call sites keep compiling.
 *
 * New code should import directly from `./llm/embeddings`.
 */

export {
  generateEmbedding,
  generateEmbeddingBatch,
  buildInteractionEmbeddingText,
} from "./llm/embeddings";
