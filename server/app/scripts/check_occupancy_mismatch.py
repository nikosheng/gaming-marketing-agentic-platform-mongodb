"""Diagnose why heatmap occupancy vs. min-bet-optimizer occupancy disagree.

Compares three views of the same table:

1. The stored snapshot in ``table_state_snapshots``.
2. The heatmap live aggregation (group by tableId over active sessions).
3. The optimizer live aggregation (scoped to a single tableId).

Run with::

    uv run python -m app.scripts.check_occupancy_mismatch              # T-019
    uv run python -m app.scripts.check_occupancy_mismatch T-0019       # custom
"""

from __future__ import annotations

import asyncio
import sys

from app.collections import web_collections as cols
from app.db import close_client, get_db


async def main() -> None:
    table_id = sys.argv[1] if len(sys.argv) > 1 else "T-019"
    db = get_db()

    # 1) Stored snapshot fields
    table_doc = await db[cols.tables].find_one(
        {"tableId": table_id},
        projection={
            "_id": 0,
            "tableId": 1,
            "tableName": 1,
            "minBet": 1,
            "patronCount": 1,
            "avgBetAmount": 1,
            "occupancyRate": 1,
        },
    )

    # 2) Heatmap-style aggregation (live count from active sessions)
    heatmap_agg = await (
        db[cols.sessions]
        .aggregate(
            [
                {"$match": {"isActive": True}},
                {
                    "$group": {
                        "_id": "$tableId",
                        "patronCount": {"$sum": 1},
                        "avgBetAmount": {"$avg": "$sessionBetAmount"},
                    }
                },
            ]
        )
        .to_list(length=None)
    )
    heatmap_for_table = next(
        (r for r in heatmap_agg if str(r.get("_id")) == table_id), None
    )
    heatmap_patron_count = int(
        (heatmap_for_table or {}).get("patronCount", 0)
    )
    heatmap_avg_bet = round(float((heatmap_for_table or {}).get("avgBetAmount") or 0))
    heatmap_occupancy = round(min(1, heatmap_patron_count / 9), 3)

    # 3) Optimizer-style aggregation (live count scoped to this table)
    optimizer_agg = await (
        db[cols.sessions]
        .aggregate(
            [
                {"$match": {"tableId": table_id, "isActive": True}},
                {
                    "$project": {
                        "_id": 0,
                        "patronId": 1,
                        "sessionBetAmount": 1,
                    }
                },
            ]
        )
        .to_list(length=None)
    )
    optimizer_patron_count = len(optimizer_agg)
    if optimizer_patron_count > 0:
        total = sum(float(s.get("sessionBetAmount") or 0) for s in optimizer_agg)
        optimizer_avg_bet = round(total / optimizer_patron_count)
    else:
        optimizer_avg_bet = 0
    optimizer_occupancy = round(min(1, optimizer_patron_count / 9), 3)

    # 4) Raw counts
    all_sessions_count = await db[cols.sessions].count_documents({"tableId": table_id})
    inactive_count = await db[cols.sessions].count_documents(
        {"tableId": table_id, "isActive": False}
    )
    active_count = await db[cols.sessions].count_documents(
        {"tableId": table_id, "isActive": True}
    )

    bar = "=" * 70
    print(bar)
    print(f"Table: {table_id} ({(table_doc or {}).get('tableName', 'unknown')})")
    print(bar)

    print("\n[ Stored snapshot fields in table_state_snapshots ]")
    print(f"  patronCount   = {(table_doc or {}).get('patronCount')}")
    print(f"  avgBetAmount  = {(table_doc or {}).get('avgBetAmount')}")
    print(f"  occupancyRate = {(table_doc or {}).get('occupancyRate')}")
    print(f"  minBet        = {(table_doc or {}).get('minBet')}")

    print("\n[ Heatmap aggregation (live, $match isActive:true, $group by tableId) ]")
    print(f"  patronCount   = {heatmap_patron_count}")
    print(f"  avgBetAmount  = {heatmap_avg_bet}")
    print(
        f"  occupancyRate = {heatmap_occupancy}  ({heatmap_occupancy * 100:.0f}%)"
    )

    print("\n[ Optimizer aggregation (live, $match tableId+isActive) ]")
    print(f"  patronCount   = {optimizer_patron_count}")
    print(f"  avgBetAmount  = {optimizer_avg_bet}")
    print(
        f"  occupancyRate = {optimizer_occupancy}  ({optimizer_occupancy * 100:.0f}%)"
    )

    print("\n[ Raw session counts ]")
    print(f"  total sessions for this table = {all_sessions_count}")
    print(f"  active   = {active_count}")
    print(f"  inactive = {inactive_count}")

    match = heatmap_patron_count == optimizer_patron_count
    print("\n" + "=" * 35)
    verdict = "✅ MATCH" if match else "❌ MISMATCH"
    print(
        f"Heatmap vs Optimizer counts: {verdict} "
        f"({heatmap_patron_count} vs {optimizer_patron_count})"
    )
    print(bar)


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
