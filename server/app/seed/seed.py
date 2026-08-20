"""Primary Mongo seed script.

Ports ``src/seed/seed.ts`` to Python. Populates ``patron_profiles``,
``table_state_snapshots``, ``patron_table_sessions``, ``offer_catalog``,
``offer_recommendations``, ``patron_risk_cases``, ``pr_agent_profiles``, and
``pr_assignments``.

Run with::

    uv run python -m app.seed.seed             # writes to Mongo
    uv run python -m app.seed.seed --dry-run   # prints counts, no writes

Note: the TypeScript version additionally seeds ``campaign_runs``,
``chat_sessions`` and ``chat_messages``. Those collection constants are not
part of ``app.collections.web_collections`` in the Python port, so the Python
seeder omits inserting them (the factories are still produced for dry-run
count parity).
"""

from __future__ import annotations

import asyncio
import json
import sys

from app.collections import web_collections as cols
from app.config import settings
from app.db import close_client, get_db
from app.seed.mock_data import (
    generate_activities,
    generate_campaigns,
    generate_chat_data,
    generate_offer_catalog,
    generate_patrons,
    generate_pr_agents,
    generate_pr_assignments,
    generate_recommendations,
    generate_risk_cases,
    generate_sessions,
    generate_tables,
)


_CLEARABLE_COLLECTIONS: tuple[str, ...] = (
    cols.patrons,
    cols.tables,
    cols.sessions,
    cols.offers,
    cols.recommendations,
    cols.risk_cases,
    cols.pr_agents,
    cols.pr_assignments,
)


async def _clear_collections() -> None:
    db = get_db()
    for name in _CLEARABLE_COLLECTIONS:
        try:
            await db[name].delete_many({})
        except Exception as exc:  # noqa: BLE001
            print(f"Skip clear for {name}: {exc}", file=sys.stderr)


async def main() -> None:
    is_dry_run = "--dry-run" in sys.argv

    patrons = generate_patrons(settings.seed_patron_count)
    tables = generate_tables(settings.seed_table_count)
    sessions = generate_sessions(patrons, tables)
    activities_by_patron = generate_activities(patrons, 12)

    patrons_with_activities = [
        {**patron, "activities": activities_by_patron.get(patron["patronId"], [])}
        for patron in patrons
    ]
    activity_count = sum(len(v) for v in activities_by_patron.values())

    offers = generate_offer_catalog()
    recommendations = generate_recommendations(patrons, offers, 2)
    campaigns = generate_campaigns(offers, patrons, 3)
    chat = generate_chat_data(patrons, 60)
    pr_agents = generate_pr_agents(24)
    risk_cases = generate_risk_cases(patrons_with_activities, tables, sessions)
    pr_assignments = generate_pr_assignments(risk_cases, pr_agents)

    if is_dry_run:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "db": settings.database_name,
                    "counts": {
                        "patrons": len(patrons),
                        "tables": len(tables),
                        "sessions": len(sessions),
                        "activities": activity_count,
                        "offers": len(offers),
                        "recommendations": len(recommendations),
                        "campaigns": len(campaigns),
                        "chatSessions": len(chat["sessions"]),
                        "chatMessages": len(chat["messages"]),
                        "riskCases": len(risk_cases),
                        "prAgents": len(pr_agents),
                        "prAssignments": len(pr_assignments),
                    },
                },
                indent=2,
                default=str,
            )
        )
        return

    db = get_db()
    await _clear_collections()

    await db[cols.patrons].insert_many(patrons_with_activities)
    await db[cols.tables].insert_many(tables)
    if sessions:
        await db[cols.sessions].insert_many(sessions)
    await db[cols.offers].insert_many(offers)
    await db[cols.recommendations].insert_many(recommendations)
    await db[cols.risk_cases].insert_many(risk_cases)
    await db[cols.pr_agents].insert_many(pr_agents)
    if pr_assignments:
        await db[cols.pr_assignments].insert_many(pr_assignments)

    print(
        f"Seeded {settings.database_name} with "
        f"patrons={len(patrons)}, activities={activity_count}, "
        f"recommendations={len(recommendations)}, riskCases={len(risk_cases)}, "
        f"prAssignments={len(pr_assignments)}"
    )


async def _entrypoint() -> None:
    try:
        await main()
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
