"""Find patrons whose top offer match is "Strong" (cosine similarity ≥ 0.75).

Run with::

    uv run python -m app.scripts.find_strong_match_patrons          # top 3
    uv run python -m app.scripts.find_strong_match_patrons 5        # top 5
"""

from __future__ import annotations

import asyncio
import math
import sys
from typing import Any

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


async def main() -> None:
    wanted = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    db = get_db()

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
                "offerEmbedding": 1,
            },
        )
        .to_list(length=None)
    )

    if not offers:
        print("No offers found", file=sys.stderr)
        return

    print(f"Loaded {len(offers)} offers. Scanning patrons...")

    patron_cursor = db[cols.patrons].find(
        {},
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

    all_ranked: list[dict[str, Any]] = []
    scanned = 0
    zero_embedding = 0

    async for patron in patron_cursor:
        scanned += 1
        embedding = patron.get("preferenceEmbedding") or []
        norm = math.sqrt(sum(v * v for v in embedding))
        if norm < 1e-6:
            zero_embedding += 1
            continue

        scored = [
            {
                "offerId": str(offer.get("offerId")),
                "title": str(offer.get("title")),
                "offerType": str(offer.get("offerType")),
                "score": _cosine_similarity(embedding, offer.get("offerEmbedding") or []),
            }
            for offer in offers
        ]
        scored.sort(key=lambda s: s["score"], reverse=True)

        all_ranked.append(
            {
                "patronId": str(patron.get("patronId")),
                "tier": str(patron.get("tier")),
                "adt": int(patron.get("adt") or 0),
                "preferredGames": patron.get("preferredGames") or [],
                "pointsBalance": int(patron.get("pointsBalance") or 0),
                "topMatches": [
                    {
                        "offerId": s["offerId"],
                        "title": s["title"],
                        "offerType": s["offerType"],
                        "score": round(s["score"], 4),
                    }
                    for s in scored[:3]
                ],
            }
        )

    all_ranked.sort(
        key=lambda p: (p["topMatches"][0]["score"] if p["topMatches"] else 0.0),
        reverse=True,
    )
    strong_patrons = [
        p
        for p in all_ranked
        if (p["topMatches"][0]["score"] if p["topMatches"] else 0.0) >= 0.75
    ]

    # Score distribution
    dist = {"strong": 0, "moderate": 0, "weak": 0}
    for p in all_ranked:
        top = p["topMatches"][0]["score"] if p["topMatches"] else 0.0
        if top >= 0.75:
            dist["strong"] += 1
        elif top >= 0.5:
            dist["moderate"] += 1
        else:
            dist["weak"] += 1
    print(
        f"\nDistribution of top-match scores: "
        f"Strong={dist['strong']}  Moderate={dist['moderate']}  Weak={dist['weak']}"
    )

    bar = "=" * 72
    print(bar)
    print(f"Scanned {scanned} patrons.")
    if zero_embedding > 0:
        print(
            f"⚠ Skipped {zero_embedding} patrons with zero-norm embeddings "
            f"(no Voyage backfill)."
        )
    print(f"Found {len(strong_patrons)} patrons with a Strong top match (≥0.75).")
    print(bar)

    if not strong_patrons:
        print("\nNo Strong-match patrons (≥0.75). Showing closest available instead:")

    listing = strong_patrons if strong_patrons else all_ranked
    print(f"\nTop {min(wanted, len(listing))} patrons:\n")
    for i, p in enumerate(listing[:wanted]):
        print(f"#{i + 1}  {p['patronId']}")
        print(f"     tier={p['tier']}  adt={p['adt']}  points={p['pointsBalance']}")
        print(f"     preferredGames={p['preferredGames']}")
        for j, m in enumerate(p["topMatches"]):
            score = m["score"]
            if score >= 0.75:
                label = "Strong"
            elif score >= 0.5:
                label = "Moderate"
            else:
                label = "Weak"
            print(
                f"       {j + 1}. {m['offerId']:<10} {label:<8} "
                f"{score * 100:.1f}%  {m['offerType']:<20} {m['title']}"
            )
        print("")


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
