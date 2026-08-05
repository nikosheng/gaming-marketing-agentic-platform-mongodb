"""FastAPI application entry point.

Mounts all routers under ``/api`` so the existing Next.js UI can keep calling
the same URLs. Handles Mongo connection + optional Voyage warm-up in the
lifespan hook.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import close_client, get_client
from app.llm.embeddings import warmup_embedding_client
from app.routers import (
    alert_rules,
    alerts,
    analysis_reports,
    offers,
    patrons,
    pr_efficiency,
    risk_cases,
    tables,
)

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application startup / shutdown hooks."""
    if settings.mongodb_uri:
        try:
            # Force a connection so we fail fast on bad credentials.
            await get_client().admin.command("ping")
            logger.info("Mongo ping OK (%s)", settings.database_name)
        except Exception as exc:  # pragma: no cover
            logger.warning("Mongo ping failed at startup: %s", exc)
    else:
        logger.warning("MONGODB_URI not set; DB calls will error at request time")

    if settings.llm.embed_warmup_on_start:
        try:
            await warmup_embedding_client()
        except Exception as exc:  # pragma: no cover
            logger.warning("Embedding warm-up failed: %s", exc)

    try:
        yield
    finally:
        await close_client()


def create_app() -> FastAPI:
    """Application factory."""
    app = FastAPI(
        title="MGM Marketing AI",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS — Next.js dev server on :3000 calls FastAPI on :8000.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(patrons.router, prefix="/api")
    app.include_router(tables.router, prefix="/api")
    app.include_router(offers.router, prefix="/api")
    app.include_router(alerts.router, prefix="/api")
    app.include_router(alert_rules.router, prefix="/api")
    app.include_router(risk_cases.router, prefix="/api")
    app.include_router(analysis_reports.router, prefix="/api")
    app.include_router(pr_efficiency.router, prefix="/api")

    return app


app = create_app()


def run() -> None:
    """`mgm-server` script entry point (installed by pyproject)."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    run()
