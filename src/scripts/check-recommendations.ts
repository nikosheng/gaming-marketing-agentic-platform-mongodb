import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const tableId = process.argv[2] ?? "T-0019";
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "casino_marketing_demo");

  const recs = await db
    .collection("table_minbet_recommendations")
    .find({ tableId }, { projection: { _id: 0, recommendationId: 1, status: 1, createdAt: 1, drivers: 1, currentMinBet: 1, recommendedMinBet: 1 } })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  console.log(`Recent recommendations for ${tableId}:`);
  if (recs.length === 0) {
    console.log("  (none)");
  }
  for (const r of recs) {
    console.log(
      `  ${r.recommendationId}  status=${r.status}  current=${r.currentMinBet}→${r.recommendedMinBet}  occupancy=${r.drivers?.occupancyRate}  createdAt=${new Date(r.createdAt).toLocaleString()}`
    );
  }
  await client.close();
}
main();
