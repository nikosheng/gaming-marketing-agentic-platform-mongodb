import { closeClient, getDb } from "../db.js";
import { collections, ensureIndexes } from "../modeling/indexes.js";
import {
  generateActivities,
  generateCampaigns,
  generateChatData,
  generateOfferCatalog,
  generatePatrons,
  generateRecommendations,
  generateSessions,
  generateTables,
} from "./mock-data.js";
import { config } from "../config.js";

const isDryRun = process.argv.includes("--dry-run");

async function clearCollections() {
  const db = await getDb();
  await Promise.all(
    Object.values(collections).map(async (name) => {
      try {
        await db.collection(name).deleteMany({});
      } catch (error) {
        console.warn(`Skip clear for ${name}:`, (error as Error).message);
      }
    })
  );
}

async function seed() {
  const patrons = generatePatrons(config.seedPatronCount);
  const tables = generateTables(config.seedTableCount);
  const sessions = generateSessions(patrons, tables);
  const activities = generateActivities(patrons, 12);
  const offers = generateOfferCatalog();
  const recommendations = generateRecommendations(patrons, offers, 2);
  const campaigns = generateCampaigns(offers, patrons, 3);
  const chat = generateChatData(patrons, 60);

  if (isDryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          db: config.databaseName,
          counts: {
            patrons: patrons.length,
            tables: tables.length,
            sessions: sessions.length,
            activities: activities.length,
            offers: offers.length,
            recommendations: recommendations.length,
            campaigns: campaigns.length,
            chatSessions: chat.sessions.length,
            chatMessages: chat.messages.length,
          },
        },
        null,
        2
      )
    );
    return;
  }

  const db = await getDb();
  await ensureIndexes(db);
  await clearCollections();

  await db.collection(collections.patrons).insertMany(patrons);
  await db.collection(collections.tables).insertMany(tables);
  if (sessions.length > 0) await db.collection(collections.sessions).insertMany(sessions);
  await db.collection(collections.activities).insertMany(activities);
  await db.collection(collections.offers).insertMany(offers);
  await db.collection(collections.recommendations).insertMany(recommendations);
  await db.collection(collections.campaigns).insertMany(campaigns);
  await db.collection(collections.chatSessions).insertMany(chat.sessions);
  await db.collection(collections.chatMessages).insertMany(chat.messages);

  console.log(
    `Seeded ${config.databaseName} with patrons=${patrons.length}, activities=${activities.length}, recommendations=${recommendations.length}`
  );
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeClient();
  });
