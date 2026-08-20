"""Shared helpers for FastAPI route handlers.

Every endpoint in the previous Next.js codebase returned JSON in a consistent
shape (``{ok, ...}`` on success, ``{ok: false, error}`` on error). We preserve
that contract so the existing UI needs no changes.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db import get_db


def db_dep() -> AsyncIOMotorDatabase:
    """FastAPI dependency: returns the Motor DB handle."""
    return get_db()


def ok_response(status_code: int = 200, **payload: Any) -> JSONResponse:
    """Return ``{ok: True, ...payload}`` with the given HTTP status.

    Uses ``fastapi.encoders.jsonable_encoder`` under the hood via
    ``JSONResponse`` so ObjectIds / datetimes get serialised correctly.
    """
    from fastapi.encoders import jsonable_encoder

    return JSONResponse(jsonable_encoder({"ok": True, **payload}), status_code=status_code)


def error_response(message: str, status_code: int = 500) -> JSONResponse:
    return JSONResponse({"ok": False, "error": message}, status_code=status_code)


def raise_error(message: str, status_code: int = 500) -> None:
    raise HTTPException(status_code=status_code, detail=message)


def strip_id(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Remove the Mongo ``_id`` (an ObjectId) so orjson can serialize the doc."""
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


def strip_ids(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [strip_id(d) or {} for d in docs]
