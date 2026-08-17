"""``/api/analysis-reports`` endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.collections import web_collections as cols
from app.routers._common import db_dep, error_response, ok_response

router = APIRouter(tags=["analysis-reports"])

_VALID_STATUSES = {"Draft", "Acknowledged", "Actioned"}


@router.patch("/analysis-reports/{report_id}/status")
async def update_report_status(
    report_id: str, request: Request, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        body = await request.json()
        status = body.get("status")
        if status not in _VALID_STATUSES:
            return error_response(
                f"status must be one of: {', '.join(sorted(_VALID_STATUSES))}",
                status_code=400,
            )
        updated = await db[cols.patron_analysis_reports].find_one_and_update(
            {"reportId": report_id},
            {"$set": {"status": status}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            return error_response("Report not found", status_code=404)
        return ok_response(report=updated)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
