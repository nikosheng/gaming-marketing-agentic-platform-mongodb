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

dotenv.config();

const VOYAGE_API_URL = "https://ai.mongodb.com/v1/embeddings";
const MODEL = "voyage-4";
const BATCH_SIZE = 50;

const offerTypeZh: Record<string, string> = {
  HotelRoom: "酒店禮遇",
  MusicShowTicket: "娛樂票券",
  PointsLimitedTime: "限時積分兌換",
  FNBVoucher: "餐飲禮券",
  CashRebate: "現金回扣",
  TransportVoucher: "專車接送禮券",
};

async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const apiKey = config.voyageApiKey;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is missing in .env");

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      input_type: "document",
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Voyage AI API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  return (data.data as Array<{ index: number; embedding: number[] }>)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
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
      if (i > 0) {
        console.log("Waiting 22s for Voyage AI rate limit...");
        await new Promise((r) => setTimeout(r, 22000));
      }
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
