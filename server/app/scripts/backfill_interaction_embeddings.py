"""Fill ``interactionEmbedding`` for ``patron_interaction_history``.

Reads every record missing ``interactionEmbedding``, batches them (128 per
voyage call, 3 batches in parallel), and writes back the embedding using
``build_interaction_embedding_text``.

Port of ``src/scripts/backfill-interaction-embeddings.ts``.

Run with::

    uv run python -m app.scripts.backfill_interaction_embeddings
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.collections import web_collections as cols
from app.db import close_client, get_db
from app.llm.embeddings import build_interaction_embedding_text, generate_embedding_batch

BATCH_SIZE = 128
CONCURRENCY = 3


async def _process_batch(
    coll: Any,
    batch: list[dict[str, Any]],
    batch_index: int,
    total_batches: int,
) -> tuple[int, int]:
    texts = [
        build_interaction_embedding_text(
            type_=rec.get("type"),
            total_value_hkd=float(rec.get("totalValueHKD") or 0),
            tier=rec.get("patronTierAtTime"),
            detail=rec.get("detail") or {},
            occurred_at=rec.get("occurredAt"),
        )
        for rec in batch
    ]

    embeddings = await generate_embedding_batch(texts, "document")

    success = 0
    failed = 0

    async def _write(rec: dict[str, Any], embedding: list[float]) -> None:
        nonlocal success, failed
        is_non_zero = any(v != 0 for v in embedding)
        if is_non_zero:
            await coll.update_one(
                {"_id": rec["_id"]},
                {"$set": {"interactionEmbedding": embedding}},
            )
            success += 1
        else:
            print(
                f"  ⚠ {rec.get('interactionId')} — zero embedding returned, skipped"
            )
            failed += 1

    await asyncio.gather(
        *[_write(rec, emb) for rec, emb in zip(batch, embeddings, strict=False)]
    )

    print(
        f"  Batch {batch_index + 1}/{total_batches} done — "
        f"{success} ok, {failed} skipped"
    )

    return success, failed


async def main() -> None:
    db = get_db()
    coll = db[cols.patron_interactions]

    missing = await (
        coll.find(
            {"interactionEmbedding": {"$exists": False}},
            projection={
                "_id": 1,
                "interactionId": 1,
                "type": 1,
                "totalValueHKD": 1,
                "patronTierAtTime": 1,
                "detail": 1,
                "occurredAt": 1,
            },
        ).to_list(length=None)
    )

    total = len(missing)
    if total == 0:
        print("All interaction records already have embeddings. Nothing to do.")
        return

    batches: list[list[dict[str, Any]]] = [
        missing[i : i + BATCH_SIZE] for i in range(0, total, BATCH_SIZE)
    ]
    total_batches = len(batches)

    print(f"\nFound {total} records without embeddings.")
    print(
        f"Batches: {total_batches} × up to {BATCH_SIZE} records, "
        f"concurrency {CONCURRENCY}"
    )
    print("Estimated time: a few seconds\n")

    total_success = 0
    total_failed = 0

    for i in range(0, len(batches), CONCURRENCY):
        window = batches[i : i + CONCURRENCY]
        results = await asyncio.gather(
            *[
                _process_batch(coll, batch, i + j, total_batches)
                for j, batch in enumerate(window)
            ]
        )
        for s, f in results:
            total_success += s
            total_failed += f

    print(
        f"\nBackfill complete: {total_success} succeeded, "
        f"{total_failed} failed out of {total} records."
    )

    if total_success > 0:
        print(
            "\nThe Atlas Vector Search index \"interaction_embedding_idx\" will "
            "index the new embeddings automatically."
        )
        print("You can now use the KPI Vector Search in the PR Efficiency tab.\n")


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
