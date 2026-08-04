/**
 * backfill-interaction-embeddings.ts
 *
 * Fills in the `interactionEmbedding` field for records in
 * `patron_interaction_history` that were created without an embedding
 * (e.g. by seed-interactions.ts).
 *
 * Sends records to the LiteLLM gateway → local TEI (voyage-4-nano) in batches
 * of up to BATCH_SIZE (128), with bounded concurrency (CONCURRENCY).
 *
 * Usage:
 *   npm run backfill:interactions
 *
 * Requirements:
 *   LITELLM_BASE_URL and LITELLM_API_KEY must be set in .env
 */

import dotenv from "dotenv";
dotenv.config();

import type { Collection } from "mongodb";
import { getDb, closeClient } from "../db.js";
import { collections } from "../modeling/indexes.js";
import {
  generateEmbeddingBatch,
  buildInteractionEmbeddingText,
} from "../web/llm/embeddings.js";
import { config } from "../config.js";
import type { PatronInteractionRecord } from "../types.js";

/** Voyage AI max inputs per request */
const BATCH_SIZE = 128;

/** Number of batches to run concurrently */
const CONCURRENCY = 3;

type RecordProjection = {
  _id: unknown;
  interactionId: string;
  type: string;
  totalValueHKD: number;
  patronTierAtTime: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
};

async function processBatch(
  col: Collection<PatronInteractionRecord>,
  batch: RecordProjection[],
  batchIndex: number,
  totalBatches: number
): Promise<{ success: number; failed: number }> {
  const texts = batch.map((rec) =>
    buildInteractionEmbeddingText({
      type:          rec.type,
      totalValueHKD: rec.totalValueHKD,
      tier:          rec.patronTierAtTime,
      detail:        rec.detail ?? {},
      occurredAt:    rec.occurredAt,
    })
  );

  const embeddings = await generateEmbeddingBatch(texts, "document");

  let success = 0;
  let failed = 0;

  const writes = batch.map(async (rec, i) => {
    const embedding = embeddings[i];
    const isNonZero = embedding.some((v) => v !== 0);

    if (isNonZero) {
      await col.updateOne(
        { _id: rec._id as never },
        { $set: { interactionEmbedding: embedding } }
      );
      success++;
    } else {
      console.warn(`  ⚠ ${rec.interactionId} — zero embedding returned, skipped`);
      failed++;
    }
  });

  await Promise.all(writes);

  console.log(
    `  Batch ${batchIndex + 1}/${totalBatches} done — ${success} ok, ${failed} skipped`
  );

  return { success, failed };
}

async function backfillInteractionEmbeddings() {
  if (!config.llm.apiKey) {
    console.error("LITELLM_API_KEY is not set in .env — cannot generate embeddings.");
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const col = db.collection<PatronInteractionRecord>(collections.patronInteractions);

  // Find all records missing an embedding
  const missing = await col
    .find({ interactionEmbedding: { $exists: false } })
    .project<RecordProjection>({
      _id: 1,
      interactionId: 1,
      type: 1,
      totalValueHKD: 1,
      patronTierAtTime: 1,
      detail: 1,
      occurredAt: 1,
    })
    .toArray();

  const total = missing.length;

  if (total === 0) {
    console.log("All interaction records already have embeddings. Nothing to do.");
    return;
  }

  // Split into batches of BATCH_SIZE
  const batches: RecordProjection[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }
  const totalBatches = batches.length;

  console.log(`\nFound ${total} records without embeddings.`);
  console.log(`Batches: ${totalBatches} × up to ${BATCH_SIZE} records, concurrency ${CONCURRENCY}`);
  console.log(`Estimated time: a few seconds\n`);

  let totalSuccess = 0;
  let totalFailed = 0;

  // Process batches with bounded concurrency
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map((batch, j) =>
        processBatch(col, batch, i + j, totalBatches)
      )
    );
    for (const r of results) {
      totalSuccess += r.success;
      totalFailed  += r.failed;
    }
  }

  console.log(
    `\nBackfill complete: ${totalSuccess} succeeded, ${totalFailed} failed out of ${total} records.`
  );

  if (totalSuccess > 0) {
    console.log(
      `\nThe Atlas Vector Search index "interaction_embedding_idx" will index the new embeddings automatically.`
    );
    console.log(`You can now use the KPI Vector Search in the PR Efficiency tab.\n`);
  }
}

backfillInteractionEmbeddings()
  .catch((err) => {
    console.error("backfill-interaction-embeddings failed:", err);
    process.exitCode = 1;
  })
  .finally(closeClient);
