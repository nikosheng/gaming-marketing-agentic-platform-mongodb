import { NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";

export async function GET() {
  try {
    const db = await getWebDb();
    const [tables, liveSessionStats] = (await Promise.all([
      db
      .collection(webCollections.tables)
      .find(
        {},
        {
          projection: {
            _id: 0,
            tableId: 1,
            tableName: 1,
            zone: 1,
            gameType: 1,
            minBet: 1,
            maxBet: 1,
            status: 1,
            patronCount: 1,
            avgBetAmount: 1,
            occupancyRate: 1,
            refreshedAt: 1,
          },
        }
      )
      .sort({ zone: 1, tableName: 1 })
      .toArray(),
      db
        .collection(webCollections.sessions)
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
        .toArray(),
    ])) as [Array<Record<string, any>>, Array<Record<string, any>>];

    const liveByTable = new Map(
      liveSessionStats.map((row) => [
        String(row._id),
        {
          patronCount: Number(row.patronCount ?? 0),
          avgBetAmount: Math.round(Number(row.avgBetAmount ?? 0)),
        },
      ])
    );

    const tablesWithLiveCounts = tables.map((table) => {
      const live = liveByTable.get(table.tableId);
      if (!live) {
        return {
          ...table,
          status: table.status,
          patronCount: 0,
          avgBetAmount: 0,
          occupancyRate: 0,
        };
      }
      const occupancyRate = Math.min(1, live.patronCount / 9);
      return {
        ...table,
        status: table.status,
        patronCount: live.patronCount,
        avgBetAmount: live.avgBetAmount,
        occupancyRate: Number(occupancyRate.toFixed(3)),
      };
    });

    const metrics = tablesWithLiveCounts.reduce(
      (acc, table) => {
        acc.totalTables += 1;
        acc.totalPatrons += table.patronCount ?? 0;
        if ((table.occupancyRate ?? 0) >= 0.8) acc.hotTables += 1;
        if (table.status === "Open" || table.status === "Busy") acc.openOrBusyTables += 1;
        return acc;
      },
      {
        totalTables: 0,
        totalPatrons: 0,
        hotTables: 0,
        openOrBusyTables: 0,
      }
    );

    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      metrics,
      tables: tablesWithLiveCounts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
