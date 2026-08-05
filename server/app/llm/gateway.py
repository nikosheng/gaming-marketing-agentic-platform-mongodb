"""Chat completion client that talks to the LiteLLM gateway.

Direct port of ``src/web/llm/gateway.ts``. Contract:

* ``chat_text`` / ``chat_json`` return the assistant text on success or
  ``None`` on any failure (missing config, network error, non-retryable HTTP).
* Retries are bounded to 3 attempts on 408 / 429 / 5xx / network errors, with
  exponential backoff (500ms, 1s, 2s) and ``Retry-After`` honoured.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal, Optional

import httpx
from openai import APIError, APIStatusError, AsyncOpenAI

from app.config import settings

logger = logging.getLogger("app.llm.gateway")

RETRY_STATUSES = {408, 429, 500, 502, 503, 504}
_BACKOFF_MS = (500, 1000, 2000)

Role = Literal["system", "user", "assistant"]

_client: Optional[AsyncOpenAI] = None


def is_gateway_configured() -> bool:
    """True iff we have enough env to attempt a call."""
    return bool(settings.llm.api_key and settings.llm.base_url)


def _get_client() -> Optional[AsyncOpenAI]:
    global _client
    if not is_gateway_configured():
        return None
    if _client is not None:
        return _client
    base = settings.llm.base_url.rstrip("/") + "/v1"
    _client = AsyncOpenAI(
        base_url=base,
        api_key=settings.llm.api_key,
        max_retries=0,  # we handle retries manually below
        timeout=httpx.Timeout(60.0, connect=10.0),
    )
    return _client


async def _with_retry(fn):
    """Retry ``fn()`` on retryable errors."""
    last_exc: Optional[BaseException] = None
    for attempt in range(len(_BACKOFF_MS) + 1):
        try:
            return await fn()
        except APIStatusError as exc:
            last_exc = exc
            status = exc.status_code
            if status not in RETRY_STATUSES or attempt == len(_BACKOFF_MS):
                raise
            retry_after_hdr = exc.response.headers.get("retry-after") if exc.response else None
            delay = (
                float(retry_after_hdr) * 1000
                if retry_after_hdr and retry_after_hdr.isdigit()
                else _BACKOFF_MS[attempt]
            )
            await asyncio.sleep(delay / 1000)
        except (APIError, httpx.RequestError, asyncio.TimeoutError) as exc:
            last_exc = exc
            if attempt == len(_BACKOFF_MS):
                raise
            await asyncio.sleep(_BACKOFF_MS[attempt] / 1000)
    assert last_exc is not None
    raise last_exc


async def chat_text(
    *,
    system: str,
    user: str,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 800,
) -> Optional[str]:
    """Plain-text chat completion. Returns text or ``None`` on failure."""
    client = _get_client()
    if client is None:
        return None

    model_name = model or settings.llm.chat_model

    async def _call() -> Optional[str]:
        res = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
            max_completion_tokens=max_tokens,
        )
        content = res.choices[0].message.content if res.choices else None
        return content.strip() if content else None

    try:
        return await _with_retry(_call)
    except Exception as exc:  # noqa: BLE001
        logger.error("chat_text failed: %s", exc)
        return None


async def chat_json(
    *,
    system: str,
    user: str,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> Optional[str]:
    """JSON-mode chat completion. Returns the raw JSON string or ``None``."""
    client = _get_client()
    if client is None:
        return None

    model_name = model or settings.llm.chat_model

    async def _call() -> Optional[str]:
        res = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
            max_completion_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        content = res.choices[0].message.content if res.choices else None
        return content.strip() if content else None

    try:
        return await _with_retry(_call)
    except Exception as exc:  # noqa: BLE001
        logger.error("chat_json failed: %s", exc)
        return None


__all__ = [
    "chat_json",
    "chat_text",
    "is_gateway_configured",
]

# Silence pyright unused-import in Any/Role helpers if they're introduced later.
_ = Any
_ = Role
