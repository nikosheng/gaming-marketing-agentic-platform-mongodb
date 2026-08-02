/**
 * backfill-interaction-embeddings.ts
 *
 * Fills in the `interactionEmbedding` field for records in
 * `patron_interaction_history` that were created without an embedding
 * (e.g. by seed-interactions.ts).
 *
 * Voyage AI voyage-4 has a 3 RPM limit, so each request is for 1 record
 * with a 21-second delay between requests to stay within limits.
 *
 * Usage:
 *   npm run backfill:interactions
 *
 * Requirements:
 *   VOYAGE_API_KEY must be set in .env
 */

import dotenv from "dotenv";
dotenv.config();

import { getDb, closeClient } from "../db.js";
import { collections } from "../modeling/indexes.js";
import { generateEmbedding, buildInteractionEmbeddingText } from "../web/embedding.js";
import type { PatronInteractionRecord } from "../types.js";

const SLEEP_MS = 21_000; // 21 seconds between Voyage API calls (3 RPM)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function backfillInteractionEmbeddings() {
  if (!process.env.VOYAGE_API_KEY) {
    console.error("VOYAGE_API_KEY is not set in .env — cannot generate embeddings.");
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const col = db.collection<PatronInteractionRecord>(collections.patronInteractions);

  // Find all records missing an embedding (field absent OR empty array)
  const missing = await col
    .find({ interactionEmbedding: { $exists: false } })
    .project<{ _id: unknown; interactionId: string; type: string; totalValueHKD: number; patronTierAtTime: string; detail: Record<string, unknown>; occurredAt: Date }>({
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

  console.log(`\nFound ${total} records without embeddings.`);
  console.log(`Estimated time: ~${Math.ceil((total * SLEEP_MS) / 60000)} minutes (Voyage AI 3 RPM limit)\n`);

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < missing.length; i++) {
    const rec = missing[i];

    // Build semantic text for this record
    const text = buildInteractionEmbeddingText({
      type:          rec.type,
      totalValueHKD: rec.totalValueHKD,
      tier:          rec.patronTierAtTime,
      detail:        rec.detail ?? {},
      occurredAt:    rec.occurredAt,
    });

    try {
      const embedding = await generateEmbedding(text, "document");
      const isNonZero = embedding.some((v) => v !== 0);

      if (isNonZero) {
        await col.updateOne(
          { _id: rec._id as never },
          { $set: { interactionEmbedding: embedding } }
        );
        success++;
        console.log(`  [${i + 1}/${total}] ✓ ${rec.interactionId} (${rec.type})`);
      } else {
        failed++;
        console.log(`  [${i + 1}/${total}] ⚠ ${rec.interactionId} — zero embedding returned, skipped`);
      }
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${total}] ✗ ${rec.interactionId} — ${(err as Error).message}`);
    }

    // Rate limit: sleep between calls, skip on last record
    if (i < missing.length - 1) {
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\n✓ Backfill complete: ${success} succeeded, ${failed} failed out of ${total} records.`);

  if (success > 0) {
    console.log(`\nThe Atlas Vector Search index "interaction_embedding_idx" will index the new embeddings automatically.`);
    console.log(`You can now use the KPI Vector Search in the PR Efficiency tab.\n`);
  }
}

backfillInteractionEmbeddings()
  .catch((err) => {
    console.error("backfill-interaction-embeddings failed:", err);
    process.exitCode = 1;
  })
  .finally(closeClient);
