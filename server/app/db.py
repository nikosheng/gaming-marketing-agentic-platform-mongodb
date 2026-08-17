"""Async MongoDB client (Motor).

Replaces ``src/db.ts`` and ``src/web/mongo.ts``. A single connection pool is
kept for the process lifetime; closed on FastAPI shutdown.
"""

from __future__ import annotations

from typing import Optional

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

    client_kwargs: dict[str, object] = {
        "server_api": ServerApi("1", strict=False, deprecation_errors=True)
    }
    if settings.mongodb_tls_insecure:
        # Convenience switch to bypass TLS certificate and hostname validation.
        client_kwargs["tls"] = True
        client_kwargs["tlsAllowInvalidCertificates"] = True
        client_kwargs["tlsAllowInvalidHostnames"] = True
    else:
        if settings.mongodb_tls_allow_invalid_certificates:
            client_kwargs["tls"] = True
            client_kwargs["tlsAllowInvalidCertificates"] = True
        if settings.mongodb_tls_allow_invalid_hostnames:
            client_kwargs["tls"] = True
            client_kwargs["tlsAllowInvalidHostnames"] = True

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
