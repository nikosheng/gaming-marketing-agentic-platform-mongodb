"""List the first/last 10 tables in ``table_state_snapshots``.

Run with::

    uv run python -m app.scripts.list_tables
"""

from __future__ import annotations

import asyncio

from app.collections import web_collections as cols
from app.db import close_client, get_db


async def main() -> None:
    db = get_db()
    tables = await (
        db[cols.tables]
        .find(
            {},
            projection={
                "_id": 0,
                "tableId": 1,
                "tableName": 1,
                "occupancyRate": 1,
                "patronCount": 1,
            },
        )
        .sort("tableId", 1)
        .to_list(length=None)
    )
    print(f"Total tables: {len(tables)}")
    print("\nFirst 10:")
    for t in tables[:10]:
        print(
            f"  {t.get('tableId')} - {t.get('tableName')} "
            f"(stored occupancy={t.get('occupancyRate')}, patronCount={t.get('patronCount')})"
        )
    print("\nLast 10:")
    for t in tables[-10:]:
        print(
            f"  {t.get('tableId')} - {t.get('tableName')} "
            f"(stored occupancy={t.get('occupancyRate')}, patronCount={t.get('patronCount')})"
        )

    t19 = next(
        (
            t
            for t in tables
            if t.get("tableName") == "Table 19" or str(t.get("tableId", "")).endswith("19")
        ),
        None,
    )
    print(f"\nFor 'Table 19': {t19 if t19 is not None else 'not found'}")


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
