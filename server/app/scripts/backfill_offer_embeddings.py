"""Regenerate ``offerEmbedding`` for every doc in ``offer_catalog``.

Uses semantically rich Chinese text so ``$vectorSearch`` produces meaningful
matches. Ports ``src/scripts/backfill-offer-embeddings.ts``.

Run with::

    uv run python -m app.scripts.backfill_offer_embeddings
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.collections import web_collections as cols
from app.db import close_client, get_db
from app.llm.embeddings import generate_embedding_batch

BATCH_SIZE = 50

_OFFER_TYPE_ZH: dict[str, str] = {
    "HotelRoom": "酒店禮遇",
    "MusicShowTicket": "娛樂票券",
    "PointsLimitedTime": "限時積分兌換",
    "FNBVoucher": "餐飲禮券",
    "CashRebate": "現金回扣",
    "TransportVoucher": "專車接送禮券",
}


async def _generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Fail hard on zero-vectors (voyage local down)."""
    vectors = await generate_embedding_batch(texts, "document")
    for v in vectors:
        if all(x == 0 for x in v):
            raise RuntimeError(
                "voyage embed returned zero-vector(s) — check voyage local runtime."
            )
    return vectors


def _build_offer_embedding_text(offer: dict[str, Any]) -> str:
    offer_type = offer.get("offerType")
    type_zh = _OFFER_TYPE_ZH.get(str(offer_type), str(offer_type))
    games = "、".join(offer.get("targetGameTypes") or []) or "所有遊戲"
    rules = "；".join(offer.get("eligibilityRules") or []) or "無特定條件"
    return (
        f"{offer.get('title')}。"
        f"{offer.get('description')} "
        f"優惠類型：{type_zh}。"
        f"目標遊戲：{games}。"
        f"適用條件：{rules}。"
    )


async def main() -> None:
    db = get_db()
    coll = db[cols.offers]

    offers = await coll.find({}).to_list(length=None)
    print(f"Found {len(offers)} offers to embed.")

    updated = 0
    now = datetime.now(timezone.utc)
    for i in range(0, len(offers), BATCH_SIZE):
        batch = offers[i : i + BATCH_SIZE]
        texts = [_build_offer_embedding_text(o) for o in batch]
        print(
            f"Embedding batch {i // BATCH_SIZE + 1} ({len(batch)} offers)..."
        )
        embeddings = await _generate_embeddings_batch(texts)
        for offer, embedding in zip(batch, embeddings, strict=False):
            await coll.update_one(
                {"_id": offer["_id"]},
                {"$set": {"offerEmbedding": embedding, "updatedAt": now}},
            )
            updated += 1
        print(f"  → Updated {updated}/{len(offers)} offers so far.")

    print(
        f"\nDone. {updated} offer embeddings regenerated with Chinese semantic text."
    )


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
