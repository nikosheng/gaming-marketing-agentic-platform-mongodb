import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { config } from "../config.js";
import { webCollections } from "../web/collections.js";

dotenv.config();

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4";
const BATCH_SIZE = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const apiKey = config.voyageApiKey;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is missing in .env");
  }

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
  return data.data.map((item: any) => item.embedding);
}

async function backfillOffers(db: any) {
  console.log("Starting backfill for offer_catalog...");
  const collection = db.collection(webCollections.offers);
  const offers = await collection.find({}).toArray();
  console.log(`Found ${offers.length} offers to process.`);

  for (let i = 0; i < offers.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(21000); // 3 RPM limit
    const batch = offers.slice(i, i + BATCH_SIZE);
    const texts = batch.map((o: any) => `${o.title} ${o.description}`);
    
    console.log(`Processing offers batch ${i / BATCH_SIZE + 1}...`);
    const embeddings = await generateEmbeddingsBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      await collection.updateOne(
        { _id: batch[j]._id },
        { $set: { offerEmbedding: embeddings[j], updatedAt: new Date() } }
      );
    }
  }
  console.log("Offer catalog backfill complete.");
}

async function backfillPatrons(db: any) {
  console.log("Starting backfill for patron_profiles...");
  const collection = db.collection(webCollections.patrons);
  const patrons = await collection.find({}).toArray();
  console.log(`Found ${patrons.length} patrons to process.`);

  for (let i = 0; i < patrons.length; i += BATCH_SIZE) {
    // Always sleep before patron batches because we just finished offers
    await sleep(21000); 
    const batch = patrons.slice(i, i + BATCH_SIZE);
    // For patrons, we embed their tier and preferred games as a proxy for "preference"
    const texts = batch.map((p: any) => 
      `Patron tier ${p.tier} who prefers games: ${p.preferredGames.join(", ")}`
    );
    
    console.log(`Processing patrons batch ${i / BATCH_SIZE + 1}...`);
    const embeddings = await generateEmbeddingsBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      await collection.updateOne(
        { _id: batch[j]._id },
        { $set: { preferenceEmbedding: embeddings[j], updatedAt: new Date() } }
      );
    }
  }
  console.log("Patron profiles backfill complete.");
}

async function run() {
  if (!config.mongodbUri) {
    throw new Error("MONGODB_URI is missing");
  }

  const client = new MongoClient(config.mongodbUri);
  try {
    await client.connect();
    const db = client.db(config.databaseName);

    console.log("Waiting 21s to reset rate limits...");
    await sleep(21000);

    await backfillOffers(db);
    await backfillPatrons(db);

    console.log("ALL BACKFILLS COMPLETED SUCCESSFULLY.");
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
