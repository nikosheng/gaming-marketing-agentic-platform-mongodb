"""Batch-embed ``offer_catalog`` + ``patron_profiles`` via voyage-4-nano.

Port of ``src/scripts/backfill-embeddings.ts``. Uses ``BATCH_SIZE=50`` and
``generate_embedding_batch(texts, "document")``. Fails hard if any returned
vector is all-zero (means voyage local failed — silent zero fallback would
otherwise corrupt data).

Additional behaviour: patrons that lack an active session get a synthetic
``patron_table_sessions`` row inserted so ``behaviorTags`` are always
available when composing the embedding text.

Run with::

    uv run python -m app.scripts.backfill_embeddings
"""

from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from app.collections import web_collections as cols
from app.db import close_client, get_db
from app.llm.embeddings import generate_embedding_batch

BATCH_SIZE = 50

_BEHAVIOR_TAGS = ("Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker")

_OFFER_TYPE_ZH: dict[str, str] = {
    "HotelRoom": "酒店禮遇",
    "MusicShowTicket": "娛樂票券",
    "PointsLimitedTime": "限時積分兌換",
    "FNBVoucher": "餐飲禮券",
    "CashRebate": "現金回扣",
    "TransportVoucher": "專車接送禮券",
}

_REGION_ZH: dict[str, str] = {
    "Macau": "澳門本地",
    "HongKong": "香港",
    "Guangdong": "廣東省",
    "OtherGBA": "大灣區",
    "Taiwan": "台灣",
    "International": "海外國際",
}


def _random_sample(seq, min_count: int, max_count: int) -> list[Any]:
    count = min_count + int(random.random() * (max_count - min_count + 1))
    count = min(count, len(seq))
    return random.sample(list(seq), count)


async def _generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Batch embed. Fails hard on zero-vectors (voyage local unavailable)."""
    vectors = await generate_embedding_batch(texts, "document")
    if any(all(x == 0 for x in v) for v in vectors):
        raise RuntimeError(
            "voyage embed returned zero-vector(s) — check voyage local runtime."
        )
    return vectors


async def _backfill_offers(db: Any) -> None:
    print("Starting backfill for offer_catalog...")
    coll = db[cols.offers]
    offers = await coll.find({}).to_list(length=None)
    print(f"Found {len(offers)} offers to process.")

    for i in range(0, len(offers), BATCH_SIZE):
        batch = offers[i : i + BATCH_SIZE]
        texts: list[str] = []
        for o in batch:
            games = "、".join(o.get("targetGameTypes") or []) or "所有遊戲"
            rules = "；".join(o.get("eligibilityRules") or []) or "無特定條件"
            type_zh = _OFFER_TYPE_ZH.get(str(o.get("offerType")), str(o.get("offerType")))
            texts.append(
                f"{o.get('title')}。"
                f"{o.get('description')} "
                f"優惠類型：{type_zh}。"
                f"目標遊戲：{games}。"
                f"適用條件：{rules}。"
            )

        print(f"Processing offers batch {i // BATCH_SIZE + 1}...")
        embeddings = await _generate_embeddings_batch(texts)

        now = datetime.now(timezone.utc)
        for offer, embedding in zip(batch, embeddings, strict=False):
            await coll.update_one(
                {"_id": offer["_id"]},
                {"$set": {"offerEmbedding": embedding, "updatedAt": now}},
            )
    print("Offer catalog backfill complete.")


async def _ensure_patron_sessions(
    db: Any, patrons: list[dict[str, Any]]
) -> dict[str, list[str]]:
    """Return a ``patronId -> behaviorTags`` map. Insert synthetic sessions
    for any patron that lacks an active one so the embedding text can always
    include behavior tags."""
    print("Ensuring all patrons have an active session...")
    sessions_coll = db[cols.sessions]
    tables_coll = db[cols.tables]

    active_sessions = await (
        sessions_coll.find(
            {"isActive": True},
            projection={"patronId": 1, "behaviorTags": 1},
        ).to_list(length=None)
    )

    session_map: dict[str, list[str]] = {}
    for s in active_sessions:
        session_map[s["patronId"]] = s.get("behaviorTags") or []

    missing_patron_ids = [
        p["patronId"] for p in patrons if p["patronId"] not in session_map
    ]

    if not missing_patron_ids:
        print("All patrons already have an active session.")
        return session_map

    print(f"Generating synthetic sessions for {len(missing_patron_ids)} patrons...")

    any_table = await tables_coll.find_one({}, projection={"tableId": 1})
    fallback_table_id = (any_table or {}).get("tableId") or "T-0001"

    now = datetime.now(timezone.utc)
    new_sessions: list[dict[str, Any]] = []
    for patron_id in missing_patron_ids:
        tags = _random_sample(_BEHAVIOR_TAGS, 1, 2)
        seated_at = now - timedelta(seconds=random.random() * 3 * 60 * 60)
        last_action_at = seated_at + timedelta(
            seconds=random.random() * max((now - seated_at).total_seconds(), 0)
        )
        session_map[patron_id] = tags
        new_sessions.append(
            {
                "patronId": patron_id,
                "tableId": fallback_table_id,
                "seatedAt": seated_at,
                "lastActionAt": last_action_at,
                "sessionBetAmount": int(200 + random.random() * 9800),
                "currentStackEstimate": int(500 + random.random() * 49500),
                "behaviorTags": tags,
                "isActive": True,
            }
        )

    if new_sessions:
        await sessions_coll.insert_many(new_sessions)
    print(f"Inserted {len(new_sessions)} synthetic sessions.")

    return session_map


async def _backfill_patrons(db: Any) -> None:
    print("Starting backfill for patron_profiles...")
    coll = db[cols.patrons]
    patrons = await coll.find({}).to_list(length=None)
    print(f"Found {len(patrons)} patrons to process.")

    session_map = await _ensure_patron_sessions(db, patrons)

    for i in range(0, len(patrons), BATCH_SIZE):
        batch = patrons[i : i + BATCH_SIZE]
        texts: list[str] = []
        for p in batch:
            games = ", ".join(p.get("preferredGames") or []) or "unknown"
            risk_flags = (
                ", ".join(f for f in (p.get("riskFlags") or []) if f != "None")
                or "none"
            )
            behavior_tags = ", ".join(session_map.get(p["patronId"], [])) or "unknown"
            region = _REGION_ZH.get(str(p.get("region")), str(p.get("region") or "不詳"))
            texts.append(
                f"Patron tier {p.get('tier')}, "
                f"ADT {p.get('adt')}, "
                f"prefers games: {games}, "
                f"points balance {p.get('pointsBalance', 0)}, "
                f"risk flags: {risk_flags}, "
                f"behavior: {behavior_tags}, "
                f"region: {region}"
            )

        print(f"Processing patrons batch {i // BATCH_SIZE + 1}...")
        embeddings = await _generate_embeddings_batch(texts)

        now = datetime.now(timezone.utc)
        for patron, embedding in zip(batch, embeddings, strict=False):
            await coll.update_one(
                {"_id": patron["_id"]},
                {"$set": {"preferenceEmbedding": embedding, "updatedAt": now}},
            )
    print("Patron profiles backfill complete.")


async def main() -> None:
    await _backfill_offers(get_db())
    await _backfill_patrons(get_db())
    print("ALL BACKFILLS COMPLETED SUCCESSFULLY.")


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
