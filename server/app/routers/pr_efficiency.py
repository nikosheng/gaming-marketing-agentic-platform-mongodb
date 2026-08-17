"""``/api/pr-efficiency`` endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.pr_efficiency_agent import get_pr_metrics, run_kpi_search
from app.config import settings
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["pr-efficiency"])


@router.get("/pr-efficiency/metrics")
async def metrics(db: AsyncIOMotorDatabase = Depends(db_dep)) -> Any:
    try:
        result = await get_pr_metrics(db)
        return ok_response(metrics=result)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/pr-efficiency/kpi-search")
async def kpi_search(
    request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        kpi_text = (body.get("kpiText") or "").strip()
        if not kpi_text:
            return error_response("kpiText is required", status_code=400)
        if not settings.llm.api_key:
            return error_response(
                "LITELLM_API_KEY is not configured — vector search unavailable.",
                status_code=503,
            )
        result = await run_kpi_search(db, kpi_text)
        return ok_response(result=result)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
