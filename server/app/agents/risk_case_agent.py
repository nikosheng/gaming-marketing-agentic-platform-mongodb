"""Risk-case orchestration (loss-chasing + financial AML scoring, admin review, PR assignment).

Direct port of ``src/web/risk-case-agent.ts``. Behaviour and constants
(weights, thresholds, tier bands) are preserved 1:1.
"""

from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Any, Literal

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.collections import web_collections as cols

AdminDecision = Literal["Approve", "Reject", "RequestMoreInfo"]


def _now_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


def _round3(v: float) -> float:
    return round(v, 3)


def _score_loss_chasing(
    *, adt: float, session_bet_amount: float, behavior_tags: list[str]
) -> dict[str, Any]:
    adt_signal = min(adt / 35000, 1)
    bet_signal = min(session_bet_amount / 40000, 1)
    if "Aggressive" in behavior_tags:
        behavior_signal = 0.9
    elif "PromoSeeker" in behavior_tags:
        behavior_signal = 0.65
    else:
        behavior_signal = 0.35
    score = _round3(adt_signal * 0.3 + bet_signal * 0.45 + behavior_signal * 0.25)
    label = "Likely" if score >= 0.72 else "Borderline" if score >= 0.5 else "Unlikely"
    return {
        "score": score,
        "label": label,
        "confidence": _round3(0.58 + score * 0.35),
        "drivers": [
            f"ADT signal {int(adt_signal * 100)}%",
            f"Session intensity {int(bet_signal * 100)}%",
            f"Behavior pattern {int(behavior_signal * 100)}%",
        ],
        "explanation": (
            "High-intensity betting and behavior markers indicate potential loss-chasing."
            if score >= 0.72
            else "Mixed behavior signals, requires admin review with AML findings."
        ),
    }


def _score_financial_risk(
    *, adt: float, points_balance: float, risk_flags: list[str]
) -> dict[str, Any]:
    high_variance = "HighVariance" in risk_flags
    frequent_cashout = "FrequentCashout" in risk_flags
    promo_sensitive = "PromoSensitive" in risk_flags

    aml_risk_score = _round3(
        (0.25 if high_variance else 0.08)
        + (0.28 if frequent_cashout else 0.07)
        + (0.12 if promo_sensitive else 0.05)
        + (0.18 if points_balance > 80000 else 0.06)
    )
    source_of_funds_risk = (
        "High" if aml_risk_score >= 0.68 else "Medium" if aml_risk_score >= 0.4 else "Low"
    )
    if adt >= 18000:
        credit_band = "Strong"
    elif adt >= 9000:
        credit_band = "Good"
    elif adt >= 3500:
        credit_band = "Fair"
    else:
        credit_band = "Weak"

    return {
        "amlRiskScore": aml_risk_score,
        "creditBand": credit_band,
        "sourceOfFundsRisk": source_of_funds_risk,
        "confidence": _round3(0.62 + (1 - min(aml_risk_score, 0.95)) * 0.22),
        "checklist": [
            {
                "key": "incomePatternConsistent",
                "passed": not high_variance,
                "notes": (
                    "Recent variance spikes detected."
                    if high_variance
                    else "Pattern is stable vs baseline."
                ),
            },
            {
                "key": "largeCashSpike",
                "passed": not frequent_cashout,
                "notes": (
                    "Cashout cadence is unusually frequent."
                    if frequent_cashout
                    else "No unusual cash spikes."
                ),
            },
            {
                "key": "chipExchangeAnomaly",
                "passed": not promo_sensitive,
                "notes": (
                    "Promotion-led churn pattern may mask source behavior."
                    if promo_sensitive
                    else "Exchange behavior is normal."
                ),
            },
            {
                "key": "highRiskSourceSignal",
                "passed": source_of_funds_risk != "High",
                "notes": (
                    "Escalation required."
                    if source_of_funds_risk == "High"
                    else "No immediate high-risk source signal."
                ),
            },
            {
                "key": "kycProfileFresh",
                "passed": True,
                "notes": "KYC freshness assumed valid in MVP internal-only check.",
            },
        ],
        "analystNotes": (
            "Escalate to senior admin before any PR action."
            if source_of_funds_risk == "High"
            else "Internal checks complete, ready for admin decision."
        ),
    }


def _derive_risk_level(loss_score: float, aml_risk_score: float) -> str:
    if aml_risk_score >= 0.75:
        return "Critical"
    if loss_score >= 0.75 or aml_risk_score >= 0.55:
        return "High"
    if loss_score >= 0.5 or aml_risk_score >= 0.35:
        return "Medium"
    return "Low"


async def _get_best_pr_agent(
    db: AsyncIOMotorDatabase, patron_tier: str, preferred_games: list[str]
) -> dict[str, Any] | None:
    agents = (
        await db[cols.pr_agents]
        .find({"active": True}, {"_id": 0})
        .limit(80)
        .to_list(length=80)
    )
    if not agents:
        return None

    scored: list[dict[str, Any]] = []
    for agent in agents:
        max_active = float(agent.get("maxActivePatrons") or 0)
        current = float(agent.get("currentActivePatrons") or 0)
        capacity_left = max(0, max_active - current)
        capacity_score = min(1, capacity_left / max(1, max_active))
        preferred_tiers = agent.get("preferredTiers") or []
        tier_match = 1 if patron_tier in preferred_tiers else 0.45
        agent_preferred_games = agent.get("preferredGames") or []
        if preferred_games:
            overlap = sum(1 for g in preferred_games if g in agent_preferred_games)
            game_overlap = overlap / len(preferred_games)
        else:
            game_overlap = 0.5
        fit_score = _round3(
            capacity_score * 0.45 + tier_match * 0.3 + game_overlap * 0.25
        )
        scored.append({"agent": agent, "fitScore": fit_score})

    scored.sort(key=lambda x: x["fitScore"], reverse=True)
    return scored[0] if scored else None


async def create_or_reuse_risk_case(
    *,
    db: AsyncIOMotorDatabase,
    patron_id: str,
    table_id: str,
    analysis_run_id: str | None = None,
) -> dict[str, Any]:
    existing = await db[cols.risk_cases].find_one(
        {
            "patronId": patron_id,
            "status": {
                "$in": ["Draft", "InReview", "AwaitingAdmin", "Approved", "Assigned"]
            },
        },
        sort=[("updatedAt", -1)],
        projection={"_id": 0},
    )
    if existing:
        return {"case": existing, "reused": True}

    patron = await db[cols.patrons].find_one(
        {"patronId": patron_id},
        {
            "_id": 0,
            "tier": 1,
            "adt": 1,
            "pointsBalance": 1,
            "riskFlags": 1,
            "preferredGames": 1,
        },
    )
    if not patron:
        raise ValueError("Patron not found")

    session = await db[cols.sessions].find_one(
        {"patronId": patron_id, "tableId": table_id, "isActive": True},
        {"_id": 0, "sessionBetAmount": 1, "behaviorTags": 1},
    )

    loss = _score_loss_chasing(
        adt=float(patron.get("adt") or 0),
        session_bet_amount=float((session or {}).get("sessionBetAmount") or 0),
        behavior_tags=(session or {}).get("behaviorTags") or [],
    )
    financial = _score_financial_risk(
        adt=float(patron.get("adt") or 0),
        points_balance=float(patron.get("pointsBalance") or 0),
        risk_flags=patron.get("riskFlags") or [],
    )
    risk_level = _derive_risk_level(loss["score"], financial["amlRiskScore"])
    escalation_tier = (
        "Senior"
        if risk_level == "Critical" or financial["sourceOfFundsRisk"] == "High"
        else "Standard"
    )

    now = datetime.now(timezone.utc)
    case_doc: dict[str, Any] = {
        "caseId": _now_id("CASE"),
        "patronId": patron_id,
        "tableId": table_id,
        "analysisRunId": analysis_run_id or _now_id("ANL"),
        "status": "AwaitingAdmin",
        "riskLevel": risk_level,
        "escalationTier": escalation_tier,
        "currentNode": "await_admin_review",
        "nodeStates": [
            {"nodeName": "initialize_case", "status": "Completed", "completedAt": now},
            {"nodeName": "evaluate_loss_chasing", "status": "Completed", "completedAt": now},
            {"nodeName": "evaluate_financial_credit_aml", "status": "Completed", "completedAt": now},
            {"nodeName": "risk_escalation_router", "status": "Completed", "completedAt": now},
            {"nodeName": "await_admin_review", "status": "Running", "startedAt": now},
            {"nodeName": "assign_pr_agent", "status": "Pending"},
            {"nodeName": "emit_assignment_notice", "status": "Pending"},
            {"nodeName": "finalize_case", "status": "Pending"},
        ],
        "lossChasingAssessment": loss,
        "financialAssessment": financial,
        "createdBy": "WEB-ADMIN",
        "timeline": [
            {
                "eventType": "CaseCreated",
                "actorType": "System",
                "actorId": "risk-case-engine",
                "payload": {"tableId": table_id, "analysisRunId": analysis_run_id or "generated"},
                "createdAt": now,
            },
            {
                "eventType": "LossAssessmentCompleted",
                "actorType": "Agent",
                "actorId": "loss-chasing-agent",
                "payload": {"score": loss["score"], "label": loss["label"]},
                "createdAt": now,
            },
            {
                "eventType": "FinancialAssessmentCompleted",
                "actorType": "Agent",
                "actorId": "financial-aml-agent",
                "payload": {
                    "amlRiskScore": financial["amlRiskScore"],
                    "sourceOfFundsRisk": financial["sourceOfFundsRisk"],
                },
                "createdAt": now,
            },
            {
                "eventType": "Escalated",
                "actorType": "System",
                "actorId": "risk-escalation-router",
                "payload": {"escalationTier": escalation_tier},
                "createdAt": now,
            },
        ],
        "createdAt": now,
        "updatedAt": now,
    }

    await db[cols.risk_cases].insert_one(case_doc)
    case_doc.pop("_id", None)
    return {"case": case_doc, "reused": False}


async def get_latest_risk_case(
    db: AsyncIOMotorDatabase, patron_id: str
) -> dict[str, Any] | None:
    return await db[cols.risk_cases].find_one(
        {"patronId": patron_id},
        projection={"_id": 0},
        sort=[("updatedAt", -1)],
    )


async def submit_admin_decision(
    *,
    db: AsyncIOMotorDatabase,
    case_id: str,
    decision: AdminDecision,
    rationale: str,
) -> dict[str, Any]:
    risk_case = await db[cols.risk_cases].find_one({"caseId": case_id}, {"_id": 0})
    if not risk_case:
        raise ValueError("Risk case not found")

    now = datetime.now(timezone.utc)
    timeline: list[dict[str, Any]] = list(risk_case.get("timeline") or [])
    timeline.append(
        {
            "eventType": "AdminDecisionSubmitted",
            "actorType": "Admin",
            "actorId": "ADM-001",
            "payload": {"decision": decision, "rationale": rationale},
            "createdAt": now,
        }
    )

    if decision == "Reject":
        timeline.append(
            {
                "eventType": "CaseClosed",
                "actorType": "System",
                "actorId": "risk-case-engine",
                "payload": {"finalStatus": "Rejected"},
                "createdAt": now,
            }
        )
        await db[cols.risk_cases].update_one(
            {"caseId": case_id},
            {
                "$set": {
                    "status": "Rejected",
                    "currentNode": "finalize_case",
                    "adminReview": {
                        "adminUserId": "ADM-001",
                        "adminDisplayName": "Default Admin",
                        "decision": decision,
                        "rationale": rationale,
                        "requestedActions": [],
                        "createdAt": now,
                    },
                    "timeline": timeline,
                    "updatedAt": now,
                }
            },
        )
        updated = await db[cols.risk_cases].find_one({"caseId": case_id}, {"_id": 0})
        return {"case": updated, "assignment": None}

    if decision == "RequestMoreInfo":
        await db[cols.risk_cases].update_one(
            {"caseId": case_id},
            {
                "$set": {
                    "status": "InReview",
                    "currentNode": "evaluate_financial_credit_aml",
                    "adminReview": {
                        "adminUserId": "ADM-001",
                        "adminDisplayName": "Default Admin",
                        "decision": decision,
                        "rationale": rationale,
                        "requestedActions": ["Re-run financial AML check"],
                        "createdAt": now,
                    },
                    "timeline": timeline,
                    "updatedAt": now,
                }
            },
        )
        updated = await db[cols.risk_cases].find_one({"caseId": case_id}, {"_id": 0})
        return {"case": updated, "assignment": None}

    # decision == "Approve"
    patron = await db[cols.patrons].find_one(
        {"patronId": risk_case["patronId"]}, {"_id": 0, "tier": 1, "preferredGames": 1}
    )
    best = await _get_best_pr_agent(
        db,
        str((patron or {}).get("tier") or ""),
        list((patron or {}).get("preferredGames") or []),
    )
    assignment: dict[str, Any] | None = None
    if best:
        assignment = {
            "assignmentId": _now_id("ASG"),
            "caseId": case_id,
            "patronId": risk_case["patronId"],
            "prAgentId": best["agent"]["prAgentId"],
            "fitScore": best["fitScore"],
            "status": "Assigned",
            "assignedAt": now,
        }
        await db[cols.pr_assignments].insert_one(dict(assignment))
        assignment.pop("_id", None)
        await db[cols.pr_agents].update_one(
            {"prAgentId": best["agent"]["prAgentId"]},
            {
                "$inc": {"currentActivePatrons": 1},
                "$set": {"lastAssignedAt": now, "updatedAt": now},
            },
        )
        timeline.append(
            {
                "eventType": "PRAssignmentCreated",
                "actorType": "System",
                "actorId": "pr-assignment-agent",
                "payload": {
                    "prAgentId": best["agent"]["prAgentId"],
                    "fitScore": best["fitScore"],
                },
                "createdAt": now,
            }
        )

    timeline.append(
        {
            "eventType": "CaseClosed",
            "actorType": "System",
            "actorId": "risk-case-engine",
            "payload": {"finalStatus": "Assigned"},
            "createdAt": now,
        }
    )

    await db[cols.risk_cases].update_one(
        {"caseId": case_id},
        {
            "$set": {
                "status": "Assigned" if assignment else "Approved",
                "currentNode": "finalize_case",
                "adminReview": {
                    "adminUserId": "ADM-001",
                    "adminDisplayName": "Default Admin",
                    "decision": decision,
                    "rationale": rationale,
                    "requestedActions": [],
                    "createdAt": now,
                },
                "timeline": timeline,
                "updatedAt": now,
            }
        },
    )
    updated = await db[cols.risk_cases].find_one({"caseId": case_id}, {"_id": 0})
    return {"case": updated, "assignment": assignment}
