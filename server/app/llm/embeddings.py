"""Voyage AI embeddings — in-process, local model.

Direct port of ``src/web/llm/embeddings.ts``. Key differences from the TS
version:

* Uses the official ``voyageai`` Python SDK with local weights
  (``pip install "voyageai[local]"``). No LiteLLM / TEI in the request path.
* Task-specific prompt prefixes are no longer prepended client-side — the SDK
  applies the correct prompt internally via ``input_type``.
* Output dimension is enforced via ``output_dimension`` (Matryoshka truncation)
  so existing Atlas Vector Search indexes at 1024-dim remain compatible.
* ``voyageai.Client()`` does not require an API key for local models
  (per the SDK's local-inference mode). ``VOYAGE_API_KEY`` is still read as a
  passthrough for callers that want cloud fallback.

All public functions preserve the pre-migration behaviour of returning
zero-vectors on any failure (callers detect degraded state via
``any(v != 0 for v in embedding)``).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal, Optional

from app.config import settings

logger = logging.getLogger("app.llm.embeddings")

InputType = Literal["document", "query"]

_client: Any = None  # voyageai.Client — typed as Any to keep imports lazy
_client_lock = asyncio.Lock()


def _get_client_sync() -> Optional[Any]:
    """Instantiate a voyageai client on first use.

    Returns ``None`` if the ``voyageai`` package (or its local extras) is not
    installed — callers then degrade to zero-vectors.
    """
    global _client
    if _client is not None:
        return _client
    try:
        import voyageai  # type: ignore
    except ImportError as exc:  # pragma: no cover
        logger.error("voyageai package not installed: %s", exc)
        return None

    kwargs: dict[str, Any] = {}
    if settings.llm.voyage_api_key:
        kwargs["api_key"] = settings.llm.voyage_api_key
    try:
        _client = voyageai.Client(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.error("voyageai.Client() init failed: %s", exc)
        return None
    return _client


def _zero_vector() -> list[float]:
    return [0.0] * settings.llm.embedding_dim


def _embed_sync(texts: list[str], input_type: InputType) -> list[list[float]]:
    """Blocking embed call — must be dispatched via ``asyncio.to_thread``."""
    client = _get_client_sync()
    if client is None:
        return [_zero_vector() for _ in texts]

    try:
        result = client.embed(
            texts,
            model=settings.llm.embedding_model,
            input_type=input_type,
            output_dimension=settings.llm.embedding_dim,
        )
    except TypeError:
        # Older voyageai versions may not accept output_dimension — retry
        # without it. Downstream will truncate/pad if necessary.
        try:
            result = client.embed(
                texts,
                model=settings.llm.embedding_model,
                input_type=input_type,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("voyage embed failed (no output_dimension): %s", exc)
            return [_zero_vector() for _ in texts]
    except Exception as exc:  # noqa: BLE001
        logger.error("voyage embed failed: %s", exc)
        return [_zero_vector() for _ in texts]

    embeddings = getattr(result, "embeddings", None)
    if not embeddings or len(embeddings) != len(texts):
        logger.error("voyage embed returned unexpected shape")
        return [_zero_vector() for _ in texts]

    # Ensure vectors are the expected dimension; truncate or pad defensively.
    dim = settings.llm.embedding_dim
    normalised: list[list[float]] = []
    for vec in embeddings:
        if len(vec) == dim:
            normalised.append(list(vec))
        elif len(vec) > dim:
            normalised.append(list(vec[:dim]))
        else:
            padded = list(vec) + [0.0] * (dim - len(vec))
            normalised.append(padded)
    return normalised


async def generate_embedding(text: str, input_type: InputType = "document") -> list[float]:
    """Embed a single string. Zero-vector fallback on any failure."""
    vectors = await asyncio.to_thread(_embed_sync, [text], input_type)
    return vectors[0]


async def generate_embedding_batch(
    texts: list[str], input_type: InputType = "document"
) -> list[list[float]]:
    """Batch embedding. Preserves input order."""
    if not texts:
        return []
    return await asyncio.to_thread(_embed_sync, texts, input_type)


async def warmup_embedding_client() -> None:
    """Trigger first-time model load so the first user request is snappy."""
    async with _client_lock:
        client = _get_client_sync()
        if client is None:
            logger.warning("voyage client unavailable; skipping warm-up")
            return
    try:
        await generate_embedding("warmup", "document")
        logger.info("voyage warm-up complete (model=%s)", settings.llm.embedding_model)
    except Exception as exc:  # noqa: BLE001
        logger.warning("voyage warm-up failed: %s", exc)


def build_interaction_embedding_text(
    *,
    type_: str,
    total_value_hkd: float,
    tier: Optional[str],
    detail: dict[str, Any],
    occurred_at: Any,
) -> str:
    """Turn a ``PatronInteractionRecord`` into a Chinese semantic string.

    Matches the pre-migration template in ``src/web/llm/embeddings.ts`` so
    embeddings produced here are semantically comparable to historical ones.
    """
    from datetime import datetime

    if isinstance(occurred_at, datetime):
        date_str = occurred_at.date().isoformat()
    else:
        try:
            date_str = datetime.fromisoformat(str(occurred_at).replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            date_str = str(occurred_at)[:10]

    tier_str = f"{tier}等級賭客" if tier else "賭客"
    value_str = f"，價值 HKD {int(total_value_hkd):,}" if total_value_hkd > 0 else ""

    if type_ == "ROOM_COMP":
        return (
            f"為{tier_str}安排免費房間住宿，房型：{detail.get('roomType', '不詳')}，"
            f"{detail.get('roomNights', 1)}晚{value_str}，日期 {date_str}"
        )
    if type_ == "FB_COMP":
        venue = detail.get("venue")
        venue_str = f"，餐廳：{venue}" if venue else ""
        return f"為{tier_str}安排餐飲優惠{venue_str}{value_str}，日期 {date_str}"
    if type_ == "REBATE":
        rebate_rate = detail.get("rebateRate")
        rebate_str = (
            f"，回贈率 {float(rebate_rate) * 100:.1f}%" if rebate_rate is not None else ""
        )
        return f"為{tier_str}提供現金或籌碼回贈{rebate_str}{value_str}，日期 {date_str}"
    if type_ == "EVENT_INVITE":
        event = detail.get("eventName")
        event_str = f"，活動名稱：{event}" if event else ""
        attended = "已出席" if detail.get("attended") else "邀請已發送"
        return f"邀請{tier_str}參加VIP活動{event_str}，{attended}，日期 {date_str}"
    if type_ == "OUTREACH":
        channel = detail.get("channel", "電話")
        outcome = detail.get("outcome", "不詳")
        notes = detail.get("notes")
        notes_str = f"，備注：{notes}" if notes else ""
        return f"主動聯繫{tier_str}，渠道：{channel}，結果：{outcome}{notes_str}，日期 {date_str}"
    if type_ == "TRANSFER":
        transfer_type = detail.get("transferType", "")
        vehicle = detail.get("vehicleClass", "標準")
        return f"為{tier_str}安排{transfer_type}接送服務，車型：{vehicle}，日期 {date_str}"
    return f"公關互動記錄，類型：{type_}{value_str}，日期 {date_str}"


__all__ = [
    "InputType",
    "build_interaction_embedding_text",
    "generate_embedding",
    "generate_embedding_batch",
    "warmup_embedding_client",
]
