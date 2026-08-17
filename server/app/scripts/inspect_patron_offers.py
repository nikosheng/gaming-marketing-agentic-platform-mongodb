"""Inspect why a specific patron gets Light/Moderate/Strong offer matches.

Run with::

    uv run python -m app.scripts.inspect_patron_offers               # P-000050
    uv run python -m app.scripts.inspect_patron_offers P-000042      # custom
"""

from __future__ import annotations

import asyncio
import math
import sys

from app.collections import web_collections as cols
from app.db import close_client, get_db


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    length = min(len(a), len(b))
    if length == 0:
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for i in range(length):
        dot += a[i] * b[i]
        norm_a += a[i] * a[i]
        norm_b += b[i] * b[i]
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def _strength_label(score: float) -> str:
    if score >= 0.75:
        return "Strong"
    if score >= 0.5:
        return "Moderate"
    return "Light"


async def main() -> None:
    patron_id = sys.argv[1] if len(sys.argv) > 1 else "P-000050"
    db = get_db()

    patron = await db[cols.patrons].find_one(
        {"patronId": patron_id},
        projection={
            "_id": 0,
            "patronId": 1,
            "tier": 1,
            "adt": 1,
            "preferredGames": 1,
            "pointsBalance": 1,
            "preferenceEmbedding": 1,
        },
    )

    if patron is None:
        print(f"Patron {patron_id} not found", file=sys.stderr)
        return

    embedding: list[float] = patron.get("preferenceEmbedding") or []
    non_zero = sum(1 for x in embedding if x != 0)
    norm = math.sqrt(sum(v * v for v in embedding))

    bar = "=" * 70
    print(bar)
    print(f"Patron: {patron.get('patronId')}")
    print(f"  tier:           {patron.get('tier')}")
    print(f"  adt:            {patron.get('adt')}")
    print(f"  preferredGames: {patron.get('preferredGames')}")
    print(f"  pointsBalance:  {patron.get('pointsBalance')}")
    print(
        f"  embedding:      dim={len(embedding)}, nonZero={non_zero}, norm={norm:.4f}"
    )
    if norm < 1e-6:
        print(
            "  ⚠ Embedding is effectively zero — scores will all be ~0 ⇒ all 'Light'."
        )
        print(
            "    Run `uv run python -m app.scripts.backfill_embeddings` to generate "
            "real Voyage embeddings."
        )

    offers = await (
        db[cols.offers]
        .find(
            {},
            projection={
                "_id": 0,
                "offerId": 1,
                "title": 1,
                "offerType": 1,
                "targetGameTypes": 1,
                "estimatedCost": 1,
                "offerEmbedding": 1,
            },
        )
        .to_list(length=None)
    )

    scored = []
    for offer in offers:
        o_emb: list[float] = offer.get("offerEmbedding") or []
        score = _cosine_similarity(embedding, o_emb)
        o_non_zero = sum(1 for x in o_emb if x != 0)
        scored.append(
            {
                "offerId": offer.get("offerId"),
                "title": offer.get("title"),
                "offerType": offer.get("offerType"),
                "targetGameTypes": offer.get("targetGameTypes"),
                "score": score,
                "oNonZero": o_non_zero,
            }
        )
    scored.sort(key=lambda s: s["score"], reverse=True)

    print("\nTop 5 offers (by cosine similarity):")
    print("-" * 70)
    for i, row in enumerate(scored[:5]):
        print(
            f"{i + 1}. {str(row['offerId']):<10} {_strength_label(row['score']):<8} "
            f"score={row['score']:.4f}  {str(row['offerType']):<20} {row['title']}"
        )
        print(
            f"   targetGames={row['targetGameTypes']}  "
            f"offerEmbedNonZero={row['oNonZero']}"
        )

    dist = {
        "strong": sum(1 for s in scored if s["score"] >= 0.75),
        "moderate": sum(1 for s in scored if 0.5 <= s["score"] < 0.75),
        "light": sum(1 for s in scored if s["score"] < 0.5),
    }

    print("\nOverall match distribution across the catalog:")
    print(f"  Strong   (≥0.75): {dist['strong']}")
    print(f"  Moderate (≥0.50): {dist['moderate']}")
    print(f"  Light    (<0.50): {dist['light']}")
    print(f"  Total offers:     {len(scored)}")
    print(bar)


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
