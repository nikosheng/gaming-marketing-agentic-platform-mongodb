"""``/api/alerts`` endpoints (list + delete + trigger patron analysis)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.agents.patron_profile_agent import run_patron_profile_analysis
from app.collections import web_collections as cols
from app.llm.gateway import is_gateway_configured
from app.routers._common import db_dep, error_response, ok_response, strip_ids

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
async def list_alerts(
    table_id: Optional[str] = Query(default=None, alias="tableId"),
    limit: Optional[int] = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(db_dep),
) -> Any:
    try:
        effective_limit = 50 if limit is None else max(1, min(200, int(limit)))
        filt: dict[str, Any] = {}
        if table_id:
            filt["tableId"] = table_id
        alerts = (
            await db[cols.patron_alerts]
            .find(filt)
            .sort("triggeredAt", -1)
            .limit(effective_limit)
            .to_list(length=effective_limit)
        )
        alerts = strip_ids(alerts)
        new_count = sum(1 for a in alerts if a.get("status") == "New")
        by_rule: dict[str, int] = {}
        for a in alerts:
            key = a.get("ruleName") or "(unknown)"
            by_rule[key] = by_rule.get(key, 0) + 1
        return ok_response(
            alerts=alerts,
            stats={"total": len(alerts), "newCount": new_count, "byRule": by_rule},
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.delete("/alerts/{alert_id}")
async def resolve_alert(
    alert_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    """Deleting an alert resolves all alerts for the same patron."""
    try:
        alert = await db[cols.patron_alerts].find_one({"alertId": alert_id})
        if not alert:
            return error_response("Alert not found", status_code=404)
        patron_id = alert["patronId"]
        result = await db[cols.patron_alerts].delete_many({"patronId": patron_id})
        return ok_response(patronId=patron_id, deletedCount=result.deleted_count)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))


@router.post("/alerts/{alert_id}/analyze-patron", status_code=201)
async def analyze_patron_from_alert(
    alert_id: str, db: AsyncIOMotorDatabase = Depends(db_dep)
) -> Any:
    try:
        if not is_gateway_configured():
            return error_response(
                "LLM gateway is not configured (LITELLM_BASE_URL / LITELLM_API_KEY missing).",
                status_code=503,
            )
        # Cached report first
        existing = await db[cols.patron_analysis_reports].find_one(
            {"triggeredByAlertId": alert_id}, {"_id": 0}
        )
        if existing:
            return ok_response(report=existing, cached=True)

        alert = await db[cols.patron_alerts].find_one(
            {"alertId": alert_id}, {"_id": 0, "patronId": 1}
        )
        if not alert:
            return error_response("Alert not found", status_code=404)

        report = await run_patron_profile_analysis(db, alert["patronId"], alert_id)
        return ok_response(status_code=201, report=report, cached=False)
    except Exception as exc:  # noqa: BLE001
        return error_response(str(exc))
