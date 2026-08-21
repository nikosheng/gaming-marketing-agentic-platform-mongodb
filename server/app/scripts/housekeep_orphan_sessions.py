"""Housekeep simulation/test patron stubs from both collections.

Two-pass cleanup:

  Pass 1 — Profile-based: find ``patron_profiles`` whose ``patronId`` starts
  with ``SIM-`` or ``TEST-``, delete their sessions and then the profiles.

  Pass 2 — Orphan sweep: find any remaining ``patron_table_sessions`` whose
  ``patronId`` has no matching ``patron_profiles`` document (catches leftover
  session rows after profiles were already removed).

Dry-run by default — no writes are made unless ``--execute`` is supplied.

Usage::

    # Preview what would be removed (no writes)
    uv run python -m app.scripts.housekeep_orphan_sessions

    # Actually delete the stubs from both collections
    uv run python -m app.scripts.housekeep_orphan_sessions --execute

Run from the ``server/`` directory::

    cd server
    uv run python -m app.scripts.housekeep_orphan_sessions [--execute]
"""

from __future__ import annotations

import asyncio
import re
import sys
from datetime import datetime, timezone

from app.collections import web_collections as cols
from app.db import close_client, get_db

# Patron ID prefixes that identify simulation / test stubs.
_STUB_PATTERN = re.compile(r"^(SIM|TEST)-", re.IGNORECASE)


async def main(*, execute: bool) -> None:
    db = get_db()
    patrons_coll = db[cols.patrons]
    sessions_coll = db[cols.sessions]

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    any_work = False

    # ==================================================================
    # PASS 1: Profile-based — SIM-* / TEST-* patron_profiles + sessions
    # ==================================================================
    print("=== Pass 1: Scanning patron_profiles for SIM-* / TEST-* stubs ===")
    all_patron_docs = await patrons_coll.find(
        {}, projection={"patronId": 1, "name": 1, "_id": 1}
    ).to_list(length=None)

    stub_docs = [d for d in all_patron_docs if _STUB_PATTERN.match(d.get("patronId", ""))]
    stub_ids = [d["patronId"] for d in stub_docs]

    if not stub_ids:
        print("  No SIM-* / TEST-* patron profiles found.")
    else:
        any_work = True
        print(f"  Found {len(stub_ids)} stub patron profile(s):")
        for d in sorted(stub_docs, key=lambda x: x.get("patronId", "")):
            print(f"    [{d['patronId']}]  {d.get('name', '(no name)')}")

        session_count = await sessions_coll.count_documents(
            {"patronId": {"$in": stub_ids}}
        )
        print(f"\n  Records to remove:")
        print(f"    patron_profiles      : {len(stub_ids)}")
        print(f"    patron_table_sessions: {session_count}")

        if execute:
            sessions_result = await sessions_coll.delete_many(
                {"patronId": {"$in": stub_ids}}
            )
            print(f"\n  [EXECUTE] Deleted {sessions_result.deleted_count} session(s).")
            patrons_result = await patrons_coll.delete_many(
                {"patronId": {"$in": stub_ids}}
            )
            print(f"  [EXECUTE] Deleted {patrons_result.deleted_count} patron profile(s).")

    # ==================================================================
    # PASS 2: Orphan sweep — sessions with no matching patron_profile
    # ==================================================================
    print("\n=== Pass 2: Orphan sweep — sessions with no patron_profile ===")
    known_ids_docs = await patrons_coll.find(
        {}, projection={"patronId": 1, "_id": 0}
    ).to_list(length=None)
    known_ids: set[str] = {d["patronId"] for d in known_ids_docs if "patronId" in d}

    session_patron_ids: list[str] = await sessions_coll.distinct("patronId")
    orphan_ids = [pid for pid in session_patron_ids if pid not in known_ids]

    if not orphan_ids:
        print("  No orphaned sessions found.")
    else:
        any_work = True
        orphan_doc_count = await sessions_coll.count_documents(
            {"patronId": {"$in": orphan_ids}}
        )
        print(f"  Found {len(orphan_ids)} orphaned patronId(s) ({orphan_doc_count} session doc(s)):")
        for pid in sorted(orphan_ids):
            print(f"    - {pid}")

        if execute:
            orphan_result = await sessions_coll.delete_many(
                {"patronId": {"$in": orphan_ids}}
            )
            print(f"\n  [EXECUTE] Deleted {orphan_result.deleted_count} orphaned session(s).")

    # ==================================================================
    # Summary
    # ==================================================================
    if not execute:
        if any_work:
            print(
                "\n[DRY-RUN] No changes made. "
                "Re-run with --execute to perform the deletion."
            )
        else:
            print("\nAll clean — nothing to housekeep.")
    else:
        print(f"\nHousekeeping complete at {now}.")


async def _entrypoint() -> None:
    execute = "--execute" in sys.argv
    try:
        await main(execute=execute)
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(_entrypoint())
