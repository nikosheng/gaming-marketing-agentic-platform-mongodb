import { closeClient, getDb } from "../db.js";
import { collections, ensureIndexes } from "../modeling/indexes.js";
import {
  generateActivities,
  generateCampaigns,
  generateChatData,
  generateOfferCatalog,
  generatePatrons,
  generatePRAgents,
  generatePRAssignments,
  generateRecommendations,
  generateRiskCases,
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
  const activitiesByPatron = generateActivities(patrons, 12);
  const patronsWithActivities = patrons.map((patron) => ({
    ...patron,
    activities: activitiesByPatron[patron.patronId] ?? [],
  }));
  const activityCount = Object.values(activitiesByPatron).reduce(
    (total, activities) => total + activities.length,
    0
  );
  const offers = generateOfferCatalog();
  const recommendations = generateRecommendations(patrons, offers, 2);
  const campaigns = generateCampaigns(offers, patrons, 3);
  const chat = generateChatData(patrons, 60);
  const prAgents = generatePRAgents(24);
  const riskCases = generateRiskCases(patronsWithActivities, tables, sessions);
  const prAssignments = generatePRAssignments(riskCases, prAgents);

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
            activities: activityCount,
            offers: offers.length,
            recommendations: recommendations.length,
            campaigns: campaigns.length,
            chatSessions: chat.sessions.length,
            chatMessages: chat.messages.length,
            riskCases: riskCases.length,
            prAgents: prAgents.length,
            prAssignments: prAssignments.length,
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

  await db.collection(collections.patrons).insertMany(patronsWithActivities);
  await db.collection(collections.tables).insertMany(tables);
  if (sessions.length > 0) await db.collection(collections.sessions).insertMany(sessions);
  await db.collection(collections.offers).insertMany(offers);
  await db.collection(collections.recommendations).insertMany(recommendations);
  await db.collection(collections.campaigns).insertMany(campaigns);
  await db.collection(collections.chatSessions).insertMany(chat.sessions);
  await db.collection(collections.chatMessages).insertMany(chat.messages);
  await db.collection(collections.riskCases).insertMany(riskCases);
  await db.collection(collections.prAgents).insertMany(prAgents);
  if (prAssignments.length > 0) {
    await db.collection(collections.prAssignments).insertMany(prAssignments);
  }

  console.log(
    `Seeded ${config.databaseName} with patrons=${patrons.length}, activities=${activityCount}, recommendations=${recommendations.length}, riskCases=${riskCases.length}, prAssignments=${prAssignments.length}`
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
