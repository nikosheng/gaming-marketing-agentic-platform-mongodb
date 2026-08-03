/**
 * backfill-patron-region.ts
 * Assigns a region to every patron in patron_profiles that is missing one.
 * Distribution matches Macau casino visitor demographics:
 *   HongKong 30%, Guangdong 28%, Macau 18%, OtherGBA 10%, Taiwan 8%, International 6%
 *
 * Run: npx tsx src/scripts/backfill-patron-region.ts
 */
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { config } from "../config.js";
import { webCollections } from "../web/collections.js";

dotenv.config();

type PatronRegion = "Macau" | "HongKong" | "Guangdong" | "OtherGBA" | "Taiwan" | "International";

const REGION_WEIGHTS: Array<{ region: PatronRegion; weight: number }> = [
  { region: "HongKong",      weight: 30 },
  { region: "Guangdong",     weight: 28 },
  { region: "Macau",         weight: 18 },
  { region: "OtherGBA",      weight: 10 },
  { region: "Taiwan",        weight: 8  },
  { region: "International", weight: 6  },
];

function pickRegion(): PatronRegion {
  const total = REGION_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * total;
  for (const { region, weight } of REGION_WEIGHTS) {
    rand -= weight;
    if (rand <= 0) return region;
  }
  return "International";
}

async function run() {
  if (!config.mongodbUri) throw new Error("MONGODB_URI is missing");

  const client = new MongoClient(config.mongodbUri);
  try {
    await client.connect();
    const db = client.db(config.databaseName);
    const coll = db.collection(webCollections.patrons);

    // Only update patrons that have no region field
    const patrons = await coll
      .find({ region: { $exists: false } }, { projection: { _id: 1, patronId: 1 } })
      .toArray();

    console.log(`Found ${patrons.length} patrons without region.`);
    if (patrons.length === 0) {
      console.log("All patrons already have a region. Nothing to do.");
      return;
    }

    // Bulk update in batches of 500
    const BATCH = 500;
    let updated = 0;
    for (let i = 0; i < patrons.length; i += BATCH) {
      const batch = patrons.slice(i, i + BATCH);
      const ops = batch.map((p) => ({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { region: pickRegion(), updatedAt: new Date() } },
        },
      }));
      const res = await coll.bulkWrite(ops, { ordered: false });
      updated += res.modifiedCount;
      console.log(`  Updated ${updated}/${patrons.length} patrons...`);
    }

    // Print distribution summary
    const dist = await coll
      .aggregate([
        { $group: { _id: "$region", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    console.log("\nRegion distribution after backfill:");
    const total = dist.reduce((s, d) => s + (d.count as number), 0);
    for (const d of dist) {
      const pct = ((d.count as number / total) * 100).toFixed(1);
      console.log(`  ${String(d._id).padEnd(15)} ${d.count}  (${pct}%)`);
    }
    console.log(`\nDone. ${updated} patrons assigned a region.`);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
