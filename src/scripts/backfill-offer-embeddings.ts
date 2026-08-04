/**
 * backfill-offer-embeddings.ts
 * Regenerates offerEmbedding for all offers in offer_catalog using
 * semantically rich Chinese text to improve $vectorSearch match quality.
 * Run: npx tsx src/scripts/backfill-offer-embeddings.ts
 */
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { config } from "../config.js";
import { webCollections } from "../web/collections.js";
import { generateEmbeddingBatch } from "../web/llm/embeddings.js";

dotenv.config();

const BATCH_SIZE = 50;

const offerTypeZh: Record<string, string> = {
  HotelRoom: "酒店禮遇",
  MusicShowTicket: "娛樂票券",
  PointsLimitedTime: "限時積分兌換",
  FNBVoucher: "餐飲禮券",
  CashRebate: "現金回扣",
  TransportVoucher: "專車接送禮券",
};

/**
 * Batch embed via LiteLLM gateway → local TEI (voyage-4-nano, 1024 dim).
 * Fails hard if the gateway returns an all-zero result — this keeps backfill
 * data quality from silently degrading.
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (!config.llm.apiKey) {
    throw new Error("LITELLM_API_KEY is missing — please configure LLM gateway credentials.");
  }
  const vectors = await generateEmbeddingBatch(texts, "document");
  const anyZero = vectors.some((v) => v.every((x) => x === 0));
  if (anyZero) {
    throw new Error("LLM gateway returned zero-vector(s) — check LiteLLM/TEI health.");
  }
  return vectors;
}

function buildOfferEmbeddingText(offer: Record<string, unknown>): string {
  const typeZh = offerTypeZh[offer.offerType as string] ?? String(offer.offerType);
  const games = (offer.targetGameTypes as string[] ?? []).join("、") || "所有遊戲";
  const rules = (offer.eligibilityRules as string[] ?? []).join("；") || "無特定條件";
  return (
    `${offer.title}。` +
    `${offer.description} ` +
    `優惠類型：${typeZh}。` +
    `目標遊戲：${games}。` +
    `適用條件：${rules}。`
  );
}

async function run() {
  if (!config.mongodbUri) throw new Error("MONGODB_URI is missing");

  const client = new MongoClient(config.mongodbUri);
  try {
    await client.connect();
    const db = client.db(config.databaseName);
    const coll = db.collection(webCollections.offers);

    const offers = await coll.find({}).toArray();
    console.log(`Found ${offers.length} offers to embed.`);

    let updated = 0;
    for (let i = 0; i < offers.length; i += BATCH_SIZE) {
      // Local TEI has no RPM limit — batch pacing is unnecessary.
      const batch = offers.slice(i, i + BATCH_SIZE);
      const texts = batch.map((o) => buildOfferEmbeddingText(o as Record<string, unknown>));

      console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} offers)...`);
      const embeddings = await generateEmbeddingsBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        await coll.updateOne(
          { _id: batch[j]._id },
          { $set: { offerEmbedding: embeddings[j], updatedAt: new Date() } }
        );
        updated++;
      }
      console.log(`  → Updated ${updated}/${offers.length} offers so far.`);
    }

    console.log(`\nDone. ${updated} offer embeddings regenerated with Chinese semantic text.`);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
