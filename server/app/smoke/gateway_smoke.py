"""Smoke test: verify LiteLLM chat + voyage local embeddings both work.

Run with::

    uv run python -m app.smoke.gateway_smoke
"""

from __future__ import annotations

import asyncio
import sys

from app.llm.embeddings import generate_embedding
from app.llm.gateway import chat_text, is_gateway_configured


async def _smoke() -> int:
    ok = True

    print("[smoke] gateway configured:", is_gateway_configured())
    if is_gateway_configured():
        text = await chat_text(
            system="You are a terse assistant.",
            user="Reply with exactly the token PONG.",
            temperature=0.0,
            max_tokens=10,
        )
        print("[smoke] chat_text →", text)
        if not text:
            ok = False
    else:
        print("[smoke] skipping chat_text (LITELLM_API_KEY not set)")

    vec = await generate_embedding("Hello, world!", "document")
    non_zero = sum(1 for v in vec if v != 0)
    print(f"[smoke] embedding dim={len(vec)} non-zero={non_zero}")
    if non_zero == 0:
        print("[smoke] WARNING: embedding is all zeros — voyage local unavailable")
        ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_smoke()))
