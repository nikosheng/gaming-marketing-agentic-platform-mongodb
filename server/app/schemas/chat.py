"""Chat session + message models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import MongoModel
from app.schemas.enums import ChatRole


class ChatSession(MongoModel):
    session_id: str = Field(alias="sessionId")
    channel: Literal["WebAdmin"]
    marketing_user_id: str = Field(alias="marketingUserId")
    patron_context_ids: list[str] = Field(default_factory=list, alias="patronContextIds")
    started_at: datetime = Field(alias="startedAt")
    last_message_at: datetime = Field(alias="lastMessageAt")
    state: Literal["Open", "Closed"]


class ChatMessage(MongoModel):
    session_id: str = Field(alias="sessionId")
    message_id: str = Field(alias="messageId")
    role: ChatRole
    content: str
    model: str
    agent_name: str = Field(alias="agentName")
    references: list[str] = Field(default_factory=list)
    created_at: datetime = Field(alias="createdAt")
