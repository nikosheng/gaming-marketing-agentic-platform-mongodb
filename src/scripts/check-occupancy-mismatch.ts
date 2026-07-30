/**
 * Diagnose why the heatmap occupancy and the min-bet optimizer occupancy
 * disagree for a given table.
 *
 * Usage:
 *   npx tsx src/scripts/check-occupancy-mismatch.ts T-019
 */
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const tableId = process.argv[2] ?? "T-019";
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? "casino_marketing_demo";
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    // 1) Stored snapshot fields
    const tableDoc = await db.collection("table_state_snapshots").findOne(
      { tableId },
      {
        projection: {
          _id: 0,
          tableId: 1,
          tableName: 1,
          minBet: 1,
          patronCount: 1,
          avgBetAmount: 1,
          occupancyRate: 1,
        },
      }
    );

    // 2) Heatmap-style aggregation (live count from active sessions)
    const heatmapAgg = await db
      .collection("patron_table_sessions")
      .aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: "$tableId",
            patronCount: { $sum: 1 },
            avgBetAmount: { $avg: "$sessionBetAmount" },
          },
        },
      ])
      .toArray();
    const heatmapForTable = heatmapAgg.find((r) => String(r._id) === tableId);
    const heatmapPatronCount = Number(heatmapForTable?.patronCount ?? 0);
    const heatmapAvgBet = Math.round(Number(heatmapForTable?.avgBetAmount ?? 0));
    const heatmapOccupancy = Number(Math.min(1, heatmapPatronCount / 9).toFixed(3));

    // 3) Optimizer-style aggregation (live count, scoped to this table)
    const optimizerAgg = await db
      .collection("patron_table_sessions")
      .aggregate([
        { $match: { tableId, isActive: true } },
        {
          $project: {
            _id: 0,
            patronId: 1,
            sessionBetAmount: 1,
          },
        },
      ])
      .toArray();
    const optimizerPatronCount = optimizerAgg.length;
    const optimizerAvgBet =
      optimizerPatronCount > 0
        ? Math.round(
            optimizerAgg.reduce(
              (sum, s) => sum + Number(s.sessionBetAmount ?? 0),
              0
            ) / optimizerPatronCount
          )
        : 0;
    const optimizerOccupancy = Number(
      Math.min(1, optimizerPatronCount / 9).toFixed(3)
    );

    // 4) Raw count of all sessions for this table (any status)
    const allSessionsCount = await db
      .collection("patron_table_sessions")
      .countDocuments({ tableId });
    const inactiveCount = await db
      .collection("patron_table_sessions")
      .countDocuments({ tableId, isActive: false });
    const activeCount = await db
      .collection("patron_table_sessions")
      .countDocuments({ tableId, isActive: true });

    console.log("=".repeat(70));
    console.log(`Table: ${tableId} (${tableDoc?.tableName ?? "unknown"})`);
    console.log("=".repeat(70));

    console.log("\n[ Stored snapshot fields in table_state_snapshots ]");
    console.log(`  patronCount   = ${tableDoc?.patronCount}`);
    console.log(`  avgBetAmount  = ${tableDoc?.avgBetAmount}`);
    console.log(`  occupancyRate = ${tableDoc?.occupancyRate}`);
    console.log(`  minBet        = ${tableDoc?.minBet}`);

    console.log("\n[ Heatmap aggregation (live, $match isActive:true, $group by tableId) ]");
    console.log(`  patronCount   = ${heatmapPatronCount}`);
    console.log(`  avgBetAmount  = ${heatmapAvgBet}`);
    console.log(`  occupancyRate = ${heatmapOccupancy}  (${(heatmapOccupancy * 100).toFixed(0)}%)`);

    console.log("\n[ Optimizer aggregation (live, $match tableId+isActive) ]");
    console.log(`  patronCount   = ${optimizerPatronCount}`);
    console.log(`  avgBetAmount  = ${optimizerAvgBet}`);
    console.log(`  occupancyRate = ${optimizerOccupancy}  (${(optimizerOccupancy * 100).toFixed(0)}%)`);

    console.log("\n[ Raw session counts ]");
    console.log(`  total sessions for this table = ${allSessionsCount}`);
    console.log(`  active   = ${activeCount}`);
    console.log(`  inactive = ${inactiveCount}`);

    const match = heatmapPatronCount === optimizerPatronCount;
    console.log("\n=".repeat(35));
    console.log(
      `Heatmap vs Optimizer counts: ${match ? "✅ MATCH" : "❌ MISMATCH"} (${heatmapPatronCount} vs ${optimizerPatronCount})`
    );
    console.log("=".repeat(70));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
