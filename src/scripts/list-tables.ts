import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "casino_marketing_demo");
  const tables = await db
    .collection("table_state_snapshots")
    .find({}, { projection: { _id: 0, tableId: 1, tableName: 1, occupancyRate: 1, patronCount: 1 } })
    .sort({ tableId: 1 })
    .toArray();
  console.log("Total tables:", tables.length);
  console.log("\nFirst 10:");
  for (const t of tables.slice(0, 10)) {
    console.log(`  ${t.tableId} - ${t.tableName} (stored occupancy=${t.occupancyRate}, patronCount=${t.patronCount})`);
  }
  console.log("\nLast 10:");
  for (const t of tables.slice(-10)) {
    console.log(`  ${t.tableId} - ${t.tableName} (stored occupancy=${t.occupancyRate}, patronCount=${t.patronCount})`);
  }
  const t19 = tables.find(
    (t) => t.tableName === "Table 19" || String(t.tableId).endsWith("19")
  );
  console.log("\nFor 'Table 19':", t19 ?? "not found");
  await client.close();
}
main();
