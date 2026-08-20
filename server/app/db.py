"""Async MongoDB client (Motor).

Replaces ``src/db.ts`` and ``src/web/mongo.ts``. A single connection pool is
kept for the process lifetime; closed on FastAPI shutdown.
"""

from __future__ import annotations

from typing import Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.server_api import ServerApi

from app.config import settings

_client: Optional[AsyncIOMotorClient] = None


def get_client() -> AsyncIOMotorClient:
    """Return the process-wide Motor client (lazily connected)."""
    global _client
    if _client is not None:
        return _client
    if not settings.mongodb_uri:
        raise RuntimeError("Missing required env var: MONGODB_URI")

    # TLS is auto-enabled by the URI scheme (mongodb+srv:// → TLS on,
    # mongodb:// → TLS off). Only supply a CA bundle when SRV / TLS is
    # actually in use; passing tlsCAFile with a plain mongodb:// URI forces
    # TLS on even for local non-TLS instances (e.g. Docker Atlas Local).
    use_tls = settings.mongodb_uri.startswith("mongodb+srv://")
    client_kwargs: dict[str, object] = {
        "server_api": ServerApi("1", strict=False, deprecation_errors=True),
    }
    if use_tls:
        client_kwargs["tlsCAFile"] = certifi.where()

    _client = AsyncIOMotorClient(
        settings.mongodb_uri,
        **client_kwargs,
    )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    """Return the default application database."""
    return get_client()[settings.database_name]


async def close_client() -> None:
    """Close the client (idempotent)."""
    global _client
    if _client is None:
        return
    _client.close()
    _client = None
