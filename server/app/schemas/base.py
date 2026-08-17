"""Common Pydantic base and helpers."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field


class MongoModel(BaseModel):
    """Base for models that map to Mongo documents.

    ``_id`` is exposed as ``id`` (string) so it survives JSON serialization
    without importing ``bson.ObjectId``. Motor is happy to accept extra fields.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        extra="allow",
        arbitrary_types_allowed=True,
    )

    id: Annotated[str | None, Field(default=None, alias="_id")] = None


PrimitiveMap = dict[str, Any]
