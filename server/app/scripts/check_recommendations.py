"""Print the 5 most recent min-bet recommendations for a given table.

Run with::

    uv run python -m app.scripts.check_recommendations              # T-0019
    uv run python -m app.scripts.check_recommendations T-0007       # custom
"""

from __future__ import annotations

import asyncio
import sys

from app.collections import web_collections as cols
from app.db import close_client, get_db


async def main() -> None:
    table_id = sys.argv[1] if len(sys.argv) > 1 else "T-0019"
    db = get_db()

    recs = await (
        db[cols.min_bet_recommendations]
        .find(
            {"tableId": table_id},
            projection={
                "_id": 0,
                "recommendationId": 1,
                "status": 1,
                "createdAt": 1,
                "drivers": 1,
                "currentMinBet": 1,
                "recommendedMinBet": 1,
            },
        )
        .sort("createdAt", -1)
        .to_list(length=5)
    )

    print(f"Recent recommendations for {table_id}:")
    if not recs:
        print("  (none)")
    for r in recs:
        occupancy_rate = (r.get("drivers") or {}).get("occupancyRate")
        created_at = r.get("createdAt")
        print(
            f"  {r.get('recommendationId')}  status={r.get('status')}  "
            f"current={r.get('currentMinBet')}→{r.get('recommendedMinBet')}  "
            f"occupancy={occupancy_rate}  createdAt={created_at}"
        )


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
