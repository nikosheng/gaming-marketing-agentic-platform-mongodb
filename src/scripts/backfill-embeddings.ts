import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { config } from "../config.js";
import { webCollections } from "../web/collections.js";
import { generateEmbeddingBatch } from "../web/llm/embeddings.js";

dotenv.config();

const BATCH_SIZE = 50;

const BEHAVIOR_TAGS = ["Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker"] as const;
const GAME_TYPES = ["Baccarat", "Blackjack", "Roulette", "SicBo", "DragonTiger", "PokerRoom"] as const;

/** Pick `count` random items from an array without repeating. */
function randomSample<T>(arr: readonly T[], min: number, max: number): T[] {
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

/**
 * Batch embed via LiteLLM gateway → local TEI (voyage-4-nano, 1024 dim).
 * Fails hard if the gateway returns an all-zero result (interpreted as
 * degraded state from the shared client) — this keeps backfill data quality
 * from silently corrupting.
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

async function backfillOffers(db: any) {
  console.log("Starting backfill for offer_catalog...");
  const collection = db.collection(webCollections.offers);
  const offers = await collection.find({}).toArray();
  console.log(`Found ${offers.length} offers to process.`);

  for (let i = 0; i < offers.length; i += BATCH_SIZE) {
    // Local TEI has no RPM limit — batch pacing is unnecessary.
    const batch = offers.slice(i, i + BATCH_SIZE);
    const offerTypeZh: Record<string, string> = {
      HotelRoom: "酒店禮遇",
      MusicShowTicket: "娛樂票券",
      PointsLimitedTime: "限時積分兌換",
      FNBVoucher: "餐飲禮券",
      CashRebate: "現金回扣",
      TransportVoucher: "專車接送禮券",
    };
    const texts = batch.map((o: any) => {
      const games = (o.targetGameTypes as string[] ?? []).join("、") || "所有遊戲";
      const rules = (o.eligibilityRules as string[] ?? []).join("；") || "無特定條件";
      const typeZh = offerTypeZh[o.offerType as string] ?? o.offerType;
      return (
        `${o.title}。` +
        `${o.description} ` +
        `優惠類型：${typeZh}。` +
        `目標遊戲：${games}。` +
        `適用條件：${rules}。`
      );
    });
    
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

/**
 * Ensure every patron has at least one active session in patron_table_sessions.
 * For patrons without any active session, a synthetic session is inserted so
 * that behaviorTags are always available for embedding generation.
 */
async function ensurePatronSessions(db: any, patrons: any[]): Promise<Map<string, string[]>> {
  console.log("Ensuring all patrons have an active session...");
  const sessionsCollection = db.collection(webCollections.sessions);
  const tablesCollection = db.collection(webCollections.tables);

  // Load all active sessions and index by patronId
  const activeSessions = await sessionsCollection
    .find({ isActive: true }, { projection: { patronId: 1, behaviorTags: 1 } })
    .toArray();

  const sessionMap = new Map<string, string[]>();
  for (const s of activeSessions) {
    sessionMap.set(s.patronId, s.behaviorTags ?? []);
  }

  // Find patrons that have no active session
  const missingPatronIds = patrons
    .map((p: any) => p.patronId)
    .filter((id: string) => !sessionMap.has(id));

  if (missingPatronIds.length === 0) {
    console.log("All patrons already have an active session.");
    return sessionMap;
  }

  console.log(`Generating synthetic sessions for ${missingPatronIds.length} patrons...`);

  // Fetch a table to assign — fall back to a placeholder tableId if none exist
  const anyTable = await tablesCollection.findOne({}, { projection: { tableId: 1 } });
  const fallbackTableId = anyTable?.tableId ?? "T-0001";

  const now = new Date();
  const newSessions = missingPatronIds.map((patronId: string) => {
    const tags = randomSample(BEHAVIOR_TAGS, 1, 2);
    const seatedAt = new Date(now.getTime() - Math.random() * 3 * 60 * 60 * 1000); // up to 3h ago
    sessionMap.set(patronId, tags);
    return {
      _id: new ObjectId(),
      patronId,
      tableId: fallbackTableId,
      seatedAt,
      lastActionAt: new Date(seatedAt.getTime() + Math.random() * (now.getTime() - seatedAt.getTime())),
      sessionBetAmount: Math.floor(200 + Math.random() * 9800),
      currentStackEstimate: Math.floor(500 + Math.random() * 49500),
      behaviorTags: tags,
      isActive: true,
    };
  });

  await sessionsCollection.insertMany(newSessions);
  console.log(`Inserted ${newSessions.length} synthetic sessions.`);

  return sessionMap;
}

async function backfillPatrons(db: any) {
  console.log("Starting backfill for patron_profiles...");
  const collection = db.collection(webCollections.patrons);
  const patrons = await collection.find({}).toArray();
  console.log(`Found ${patrons.length} patrons to process.`);

  // Build a patronId -> behaviorTags map, inserting synthetic sessions where needed
  const sessionMap = await ensurePatronSessions(db, patrons);

  for (let i = 0; i < patrons.length; i += BATCH_SIZE) {
    // Local TEI has no RPM limit — batch pacing is unnecessary.
    const batch = patrons.slice(i, i + BATCH_SIZE);

    const regionZh: Record<string, string> = {
      Macau: "澳門本地",
      HongKong: "香港",
      Guangdong: "廣東省",
      OtherGBA: "大灣區",
      Taiwan: "台灣",
      International: "海外國際",
    };
    // Build a rich preference text that covers tier, games, ADT, points, risk flags, region and behavior
    const texts = batch.map((p: any) => {
      const games = (p.preferredGames as string[] ?? []).join(", ") || "unknown";
      const riskFlags = (p.riskFlags as string[] ?? []).filter((f: string) => f !== "None").join(", ") || "none";
      const behaviorTags = (sessionMap.get(p.patronId) ?? []).join(", ") || "unknown";
      const region = regionZh[p.region as string] ?? (p.region as string) ?? "不詳";
      return (
        `Patron tier ${p.tier}, ` +
        `ADT ${p.adt}, ` +
        `prefers games: ${games}, ` +
        `points balance ${p.pointsBalance ?? 0}, ` +
        `risk flags: ${riskFlags}, ` +
        `behavior: ${behaviorTags}, ` +
        `region: ${region}`
      );
    });

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
