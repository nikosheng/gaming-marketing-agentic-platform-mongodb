"""Migrate legacy ``patron_activity_events`` docs into ``patron_profiles.activities``.

Port of ``src/scripts/migrate-activities-to-patrons.ts``. Reads every legacy
event, embeds a normalised copy into the matching patron document via
``$addToSet``, and prints migration counts.

Run with::

    uv run python -m app.scripts.migrate_activities_to_patrons
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from app.collections import web_collections as cols
from app.db import close_client, get_db


LEGACY_ACTIVITY_COLLECTION = "patron_activity_events"
BATCH_SIZE = 500


def _to_date(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed
        except ValueError:
            pass
    return datetime.now(timezone.utc)


async def main() -> None:
    db = get_db()
    legacy = db[LEGACY_ACTIVITY_COLLECTION]
    patrons = db[cols.patrons]

    total_legacy_events = await legacy.count_documents({})
    print(f"Found {total_legacy_events} legacy activity events.")
    if total_legacy_events == 0:
        print("No legacy events found. Nothing to migrate.")
        return

    processed = 0
    migrated = 0
    skipped_missing_patron_id = 0
    skipped_missing_patron_profile = 0

    cursor = legacy.find({}, batch_size=BATCH_SIZE)
    async for raw in cursor:
        processed += 1
        patron_id = raw.get("patronId")
        if not patron_id:
            skipped_missing_patron_id += 1
            continue

        embedded_activity = {
            "eventId": raw.get("eventId") or f"migrated-{raw.get('_id')}",
            "activityType": raw.get("activityType") or "TableBet",
            "source": raw.get("source") or "TableSystem",
            "amount": raw.get("amount") or 0,
            "pointsDelta": raw.get("pointsDelta") or 0,
            "metadata": raw.get("metadata") or {},
            "activityEmbedding": (
                raw.get("activityEmbedding")
                if isinstance(raw.get("activityEmbedding"), list)
                else []
            ),
            "eventTime": _to_date(raw.get("eventTime")),
        }

        result = await patrons.update_one(
            {"patronId": patron_id},
            {
                "$set": {"updatedAt": datetime.now(timezone.utc)},
                "$addToSet": {"activities": embedded_activity},
            },
        )

        if result.matched_count == 0:
            skipped_missing_patron_profile += 1
            continue

        if result.modified_count > 0:
            migrated += 1

        if processed % BATCH_SIZE == 0:
            print(f"Processed {processed}/{total_legacy_events} events...")

    print("Migration complete.")
    unchanged = (
        processed - migrated - skipped_missing_patron_id - skipped_missing_patron_profile
    )
    print(
        json.dumps(
            {
                "totalLegacyEvents": total_legacy_events,
                "processed": processed,
                "migrated": migrated,
                "skippedMissingPatronId": skipped_missing_patron_id,
                "skippedMissingPatronProfile": skipped_missing_patron_profile,
                "unchanged": unchanged,
            },
            indent=2,
            default=str,
        )
    )
    print(
        "Optional cleanup command (run manually if results look correct): "
        "db.patron_activity_events.drop()"
    )


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
