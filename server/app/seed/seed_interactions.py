"""Seed ``patron_interaction_history`` with realistic PR-agent interactions.

Port of ``src/seed/seed-interactions.ts``. ADDITIVE — does NOT clear the
collection. After seeding, run
``uv run python -m app.scripts.backfill_interaction_embeddings`` to fill
``interactionEmbedding``.

Run with::

    uv run python -m app.seed.seed_interactions              # seed
    uv run python -m app.seed.seed_interactions --dry-run    # preview
"""

from __future__ import annotations

import asyncio
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from app.collections import web_collections as cols
from app.db import close_client, get_db

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MIN_PER_PR = 8
MAX_PER_PR = 20
HISTORY_DAYS = 180


# ---------------------------------------------------------------------------
# Interaction type distribution per PR group
# ---------------------------------------------------------------------------


def _type_weights(group_index: int, total_groups: int) -> list[tuple[str, int]]:
    """Weighted interaction-type distribution based on the PR's group quarter."""
    quarter = int((group_index / total_groups) * 4) if total_groups > 0 else 0
    if quarter == 0:
        # Group A — Room & Transfer specialists (high-roller hosting)
        return [
            ("ROOM_COMP", 40),
            ("TRANSFER", 30),
            ("FB_COMP", 10),
            ("OUTREACH", 10),
            ("EVENT_INVITE", 5),
            ("REBATE", 5),
        ]
    if quarter == 1:
        # Group B — Outreach & Event specialists (patron retention)
        return [
            ("OUTREACH", 40),
            ("EVENT_INVITE", 30),
            ("FB_COMP", 10),
            ("TRANSFER", 10),
            ("ROOM_COMP", 5),
            ("REBATE", 5),
        ]
    if quarter == 2:
        # Group C — Rebate & F&B specialists (volume reward)
        return [
            ("REBATE", 35),
            ("FB_COMP", 30),
            ("OUTREACH", 15),
            ("EVENT_INVITE", 10),
            ("ROOM_COMP", 5),
            ("TRANSFER", 5),
        ]
    # Group D — Generalist
    return [
        ("ROOM_COMP", 17),
        ("FB_COMP", 17),
        ("REBATE", 17),
        ("EVENT_INVITE", 17),
        ("OUTREACH", 16),
        ("TRANSFER", 16),
    ]


def _pick_weighted_type(weights: list[tuple[str, int]]) -> str:
    total = sum(w for _, w in weights)
    r = random.random() * total
    for value, weight in weights:
        r -= weight
        if r <= 0:
            return value
    return weights[-1][0]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _rand_int(min_val: int, max_val: int) -> int:
    return random.randint(min_val, max_val)


def _rand_from(seq):
    return random.choice(seq)


def _random_date(days_back: int) -> datetime:
    now = datetime.now(timezone.utc)
    ms = random.random() * days_back * 24 * 60 * 60 * 1000
    return now - timedelta(milliseconds=ms)


# ---------------------------------------------------------------------------
# Detail builders
# ---------------------------------------------------------------------------


def _build_detail(
    interaction_type: str, tier: str | None
) -> tuple[dict[str, Any], float]:
    if interaction_type == "ROOM_COMP":
        is_plat_diamond = tier in ("Platinum", "Diamond")
        room_types = (
            ["Grand Suite", "Presidential Suite", "VIP Harbour Suite"]
            if is_plat_diamond
            else ["Superior Room", "Deluxe Room", "Premier Room"]
        )
        room_type = _rand_from(room_types)
        room_nights = _rand_int(1, 3 if is_plat_diamond else 2)
        night_rate = (
            _rand_int(6000, 15000) if is_plat_diamond else _rand_int(2000, 6000)
        )
        room_value = room_nights * night_rate
        return (
            {"roomType": room_type, "roomNights": room_nights, "roomValue": room_value},
            room_value,
        )

    if interaction_type == "FB_COMP":
        venues = [
            "The Starlight Restaurant",
            "Dynasty Cantonese",
            "La Maison Brasserie",
            "Jade Garden",
            "Skyview Lounge",
        ]
        venue = _rand_from(venues)
        fb_amount = _rand_int(800, 6000)
        return {"venue": venue, "fbAmount": fb_amount}, fb_amount

    if interaction_type == "REBATE":
        rebate_rate = _rand_from([0.005, 0.008, 0.010, 0.012, 0.015, 0.018, 0.020])
        rebate_amount = _rand_int(3000, 25000)
        return (
            {"rebateRate": rebate_rate, "rebateAmount": rebate_amount},
            rebate_amount,
        )

    if interaction_type == "EVENT_INVITE":
        events = [
            "8月 Diamond VIP 晚宴",
            "中秋貴賓品酒會",
            "新年 Platinum 專屬招待",
            "週年慶 VIP 音樂盛典",
            "高爾夫球友誼賽",
            "私人藝術品鑑會",
        ]
        event_name = _rand_from(events)
        attended = random.random() > 0.25
        return (
            {"eventName": event_name, "attended": attended},
            _rand_int(500, 3000),
        )

    if interaction_type == "OUTREACH":
        channels = ["Phone", "WeChat", "WhatsApp", "In-Person"]
        outcomes = ["Positive", "Positive", "Positive", "Neutral", "No Answer", "Declined"]
        channel = _rand_from(channels)
        outcome = _rand_from(outcomes)
        note_options = [
            "確認下月回訪計劃",
            "賭客表示近期會帶朋友前來",
            "已安排下次桌位預留",
            "詢問最新優惠詳情",
            "賭客對本次服務表示滿意",
            "跟進上次 VIP 活動反饋",
        ]
        notes = _rand_from(note_options) if outcome != "No Answer" else None
        detail: dict[str, Any] = {"channel": channel, "outcome": outcome}
        if notes is not None:
            detail["notes"] = notes
        return detail, 0

    if interaction_type == "TRANSFER":
        transfer_types = ["Airport", "Hotel", "Venue"]
        vehicle_classes = (
            ["Luxury"] if tier in ("Platinum", "Diamond") else ["Standard", "Luxury"]
        )
        transfer_type = _rand_from(transfer_types)
        vehicle_class = _rand_from(vehicle_classes)
        value = (
            _rand_int(800, 2500) if vehicle_class == "Luxury" else _rand_int(300, 800)
        )
        return (
            {"transferType": transfer_type, "vehicleClass": vehicle_class},
            value,
        )

    # Unknown type — mirrors TS behaviour (no explicit default, so return empty)
    return {}, 0


def _build_record(
    pr_agent_id: str, patron: dict[str, Any], interaction_type: str, now: datetime
) -> dict[str, Any]:
    occurred_at = _random_date(HISTORY_DAYS)
    detail, total_value_hkd = _build_detail(interaction_type, patron.get("tier"))

    raw_suffix = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=5))
    interaction_id = (
        f"INT-{int(now.timestamp() * 1000)}-{pr_agent_id}-{patron['patronId']}-{raw_suffix}"
    ).upper()
    # TS strips anything outside [A-Z0-9-] (case-insensitive). All the pieces
    # above already satisfy that, so no substitution needed.

    return {
        "interactionId": interaction_id,
        "patronId": patron["patronId"],
        "type": interaction_type,
        "detail": detail,
        "totalValueHKD": total_value_hkd,
        "occurredAt": occurred_at,
        "recordedBy": pr_agent_id,
        "recordedAt": now,
        "patronTierAtTime": patron.get("tier"),
        "patronAdtAtTime": patron.get("adt"),
        # interactionEmbedding intentionally omitted — filled by backfill script
    }


# ---------------------------------------------------------------------------
# Patron pool helpers
# ---------------------------------------------------------------------------


def _build_tier_map(patrons: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    tier_map: dict[str, list[dict[str, Any]]] = {}
    for p in patrons:
        tier_map.setdefault(p.get("tier", ""), []).append(p)
    return tier_map


def _pick_patron(
    preferred_tiers: list[str],
    tier_map: dict[str, list[dict[str, Any]]],
    all_patrons: list[dict[str, Any]],
) -> dict[str, Any]:
    """70% chance to pick from preferred tier, else uniform over all patrons."""
    if random.random() < 0.7 and preferred_tiers:
        tier = _rand_from(preferred_tiers)
        pool = tier_map.get(tier)
        if pool:
            return _rand_from(pool)
    return _rand_from(all_patrons)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    is_dry_run = "--dry-run" in sys.argv
    db = get_db()
    now = datetime.now(timezone.utc)

    # 1. Load PR agents
    pr_docs = await (
        db[cols.pr_agents]
        .find(
            {},
            projection={
                "prAgentId": 1,
                "name": 1,
                "active": 1,
                "preferredTiers": 1,
            },
        )
        .sort("prAgentId", 1)
        .to_list(length=None)
    )

    if not pr_docs:
        print("No PR agents found. Run `uv run python -m app.seed.seed` first.", file=sys.stderr)
        sys.exit(1)

    # 2. Load up to 300 patrons
    patron_docs = await (
        db[cols.patrons]
        .find({}, projection={"patronId": 1, "tier": 1, "adt": 1})
        .to_list(length=300)
    )

    if not patron_docs:
        print("No patrons found. Run `uv run python -m app.seed.seed` first.", file=sys.stderr)
        sys.exit(1)

    tier_map = _build_tier_map(patron_docs)

    # 3. Generate records per PR
    all_records: list[dict[str, Any]] = []
    for idx, pr in enumerate(pr_docs):
        count = _rand_int(MIN_PER_PR, MAX_PER_PR)
        weights = _type_weights(idx, len(pr_docs))
        for _ in range(count):
            interaction_type = _pick_weighted_type(weights)
            patron = _pick_patron(pr.get("preferredTiers") or [], tier_map, patron_docs)
            all_records.append(_build_record(pr["prAgentId"], patron, interaction_type, now))

    # 4. Preview or insert
    if is_dry_run:
        by_pr: dict[str, dict[str, int]] = {}
        for r in all_records:
            entry = by_pr.setdefault(r["recordedBy"], {})
            entry[r["type"]] = entry.get(r["type"], 0) + 1
        print(
            json.dumps(
                {"dryRun": True, "totalRecords": len(all_records), "byPr": by_pr},
                indent=2,
                default=str,
            )
        )
        return

    await db[cols.patron_interactions].insert_many(all_records)

    # 5. Summary
    type_breakdown: dict[str, int] = {}
    for r in all_records:
        type_breakdown[r["type"]] = type_breakdown.get(r["type"], 0) + 1
    print(
        f"\n✓ Inserted {len(all_records)} interaction records across "
        f"{len(pr_docs)} PR agents."
    )
    print(f"  Type breakdown: {type_breakdown}")
    print(f"  Date range: past {HISTORY_DAYS} days")
    print(
        "\nNext step: run "
        "`uv run python -m app.scripts.backfill_interaction_embeddings` "
        "to generate embeddings for KPI vector search.\n"
    )


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
