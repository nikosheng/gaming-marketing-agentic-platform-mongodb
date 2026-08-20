"""Assign a region to every ``patron_profiles`` document missing one.

Distribution matches Macau casino visitor demographics::

    HongKong 30%, Guangdong 28%, Macau 18%, OtherGBA 10%, Taiwan 8%, International 6%

Pure data migration — no embeddings. Run with::

    uv run python -m app.scripts.backfill_patron_region
"""

from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone

from pymongo import UpdateOne

from app.collections import web_collections as cols
from app.db import close_client, get_db


REGION_WEIGHTS: list[tuple[str, int]] = [
    ("HongKong", 30),
    ("Guangdong", 28),
    ("Macau", 18),
    ("OtherGBA", 10),
    ("Taiwan", 8),
    ("International", 6),
]


def _pick_region() -> str:
    total = sum(w for _, w in REGION_WEIGHTS)
    r = random.random() * total
    for region, weight in REGION_WEIGHTS:
        r -= weight
        if r <= 0:
            return region
    return "International"


async def main() -> None:
    db = get_db()
    coll = db[cols.patrons]

    patrons = await (
        coll.find(
            {"region": {"$exists": False}},
            projection={"_id": 1, "patronId": 1},
        ).to_list(length=None)
    )

    print(f"Found {len(patrons)} patrons without region.")
    if not patrons:
        print("All patrons already have a region. Nothing to do.")
        return

    batch_size = 500
    updated = 0
    now = datetime.now(timezone.utc)
    for i in range(0, len(patrons), batch_size):
        batch = patrons[i : i + batch_size]
        ops = [
            UpdateOne(
                {"_id": p["_id"]},
                {"$set": {"region": _pick_region(), "updatedAt": now}},
            )
            for p in batch
        ]
        result = await coll.bulk_write(ops, ordered=False)
        updated += result.modified_count
        print(f"  Updated {updated}/{len(patrons)} patrons...")

    # Distribution summary
    dist = await (
        coll.aggregate(
            [
                {"$group": {"_id": "$region", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
            ]
        ).to_list(length=None)
    )

    print("\nRegion distribution after backfill:")
    total = sum(d["count"] for d in dist)
    for d in dist:
        pct = (d["count"] / total * 100) if total else 0
        region = str(d.get("_id"))
        print(f"  {region:<15} {d['count']}  ({pct:.1f}%)")
    print(f"\nDone. {updated} patrons assigned a region.")


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
