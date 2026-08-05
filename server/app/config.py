"""Application configuration.

Loaded once at import time from environment variables (`.env` file supported).
Mirrors ``src/config.ts`` from the pre-migration TypeScript codebase.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LlmSettings(BaseSettings):
    """LLM-related settings.

    Chat traffic goes through the LiteLLM gateway (``base_url``).
    Embeddings are produced in-process by the ``voyageai`` SDK — the gateway
    is not involved for embeddings anymore.
    """

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    base_url: str = Field(default="http://localhost:4000", validation_alias="LITELLM_BASE_URL")
    api_key: str = Field(default="", validation_alias="LITELLM_API_KEY")
    chat_model: str = Field(default="chat-primary", validation_alias="LLM_CHAT_MODEL")
    embedding_model: str = Field(default="voyage-4-nano", validation_alias="LLM_EMBEDDING_MODEL")
    embedding_dim: int = Field(default=1024, validation_alias="VECTOR_EMBEDDING_DIM")
    voyage_api_key: str = Field(default="", validation_alias="VOYAGE_API_KEY")
    embed_warmup_on_start: bool = Field(default=True, validation_alias="EMBED_WARMUP_ON_START")


class Settings(BaseSettings):
    """Root settings object."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    mongodb_uri: str | None = Field(default=None, validation_alias="MONGODB_URI")
    database_name: str = Field(default="casino_marketing_demo", validation_alias="MONGODB_DB")

    vector_embedding_dim: int = Field(default=1024, validation_alias="VECTOR_EMBEDDING_DIM")
    seed_patron_count: int = Field(default=300, validation_alias="SEED_PATRON_COUNT")
    seed_table_count: int = Field(default=30, validation_alias="SEED_TABLE_COUNT")

    host: str = Field(default="0.0.0.0", validation_alias="HOST")
    port: int = Field(default=8000, validation_alias="PORT")

    log_level: Literal["debug", "info", "warning", "error"] = Field(
        default="info", validation_alias="LOG_LEVEL"
    )

    llm: LlmSettings = Field(default_factory=LlmSettings)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton settings instance."""
    return Settings()


# Convenience alias so call sites can ``from app.config import settings``.
settings = get_settings()
