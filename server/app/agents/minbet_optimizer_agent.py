"""Min-bet optimizer (LangGraph).

Direct port of ``src/web/minbet-optimizer-agent.ts``. Eight nodes:

    observe_state → compute_trend → compute_distribution → score_elasticity
    → apply_guardrails → check_cooldown → generate_rationale → persist_recommendation

Behavioural parity is preserved with the TS version, including the empty-table
special cases, direction-aware step snapping, cooldown short-circuit, and the
LLM-vs-deterministic rationale fallback.
"""

from __future__ import annotations

import random
import string
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.collections import web_collections as cols
from app.llm.gateway import chat_text

GameType = Literal["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"]
OccupancyTrend = Literal["Rising", "Stable", "Falling"]

COOLDOWN_MINUTES = 20
PROPOSAL_TTL_MINUTES = 30
HIGH_ROLLER_KEYWORDS = ("VIP", "High Roller", "HighRoller", "Premium")

GAME_FLOORS: dict[str, int] = {
    "Baccarat": 300,
    "Blackjack": 300,
    "Roulette": 300,
    "SicBo": 300,
    "Poker": 300,
}

GAME_STEPS: dict[str, list[int]] = {
    "Baccarat": [300, 500, 800, 1000],
    "Blackjack": [300, 500, 800, 1000],
    "Roulette": [300, 500, 800, 1000],
    "SicBo": [300, 500, 800, 1000],
    "Poker": [300, 500, 800, 1000],
}


class _State(TypedDict, total=False):
    table_id: str
    run_id: str
    actor_id: str
    table: dict[str, Any] | None
    sessions: list[dict[str, Any]]
    history: list[dict[str, Any]]
    trend: dict[str, Any] | None
    distribution: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    decision: dict[str, Any] | None
    rationale: str
    recommendation_id: str | None
    error: str | None
    db: Any


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = int(_clamp(int((len(sorted_vals) - 1) * p), 0, len(sorted_vals) - 1))
    return sorted_vals[idx]


def _linear_slope(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(values) / n
    num = 0.0
    den = 0.0
    for i, v in enumerate(values):
        num += (i - mean_x) * (v - mean_y)
        den += (i - mean_x) * (i - mean_x)
    return num / den if den else 0.0


def _is_high_roller_zone(zone: str) -> bool:
    z = (zone or "").lower()
    return any(k.lower() in z for k in HIGH_ROLLER_KEYWORDS)


def _rand_suffix() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------- LLM + deterministic rationale ----------


async def _llm_rationale(
    table: dict[str, Any],
    trend: dict[str, Any],
    dist: dict[str, Any],
    decision: dict[str, Any],
) -> str | None:
    user_prompt = (
        "You are a casino floor analyst. Write a concise 2-3 sentence explanation "
        "for a proposed min-bet change.\n\n"
        f"Table: {table['tableName']} ({table['gameType']}, zone {table['zone']})\n"
        f"Current min bet: {table['minBet']}\n"
        f"Recommended min bet: {decision['recommendedMinBet']} "
        f"(Δ {decision['deltaPct'] * 100:.1f}%)\n"
        f"Expected revenue uplift: {decision['expectedRevenueUpliftPct'] * 100:.1f}%\n"
        f"Occupancy: {table['occupancyRate'] * 100:.0f}% "
        f"(trend {trend['label']}, velocity {trend['velocity']:.2f})\n"
        f"Bet headroom (avg/min): {dist['betHeadroom']:.2f}\n"
        f"Bet percentiles: p50 {dist['p50']}, p75 {dist['p75']}, p90 {dist['p90']}\n"
        f"Low-bet share: {dist['lowBetShare'] * 100:.0f}%\n"
        f"Reasons (bullets): {'; '.join(decision.get('reasons') or [])}\n\n"
        "Explain the recommendation in plain business language. Do not invent numbers."
    )
    return await chat_text(
        system="You write concise casino operations analyst rationales.",
        user=user_prompt,
        temperature=0.3,
        max_tokens=200,
    )


def _deterministic_rationale(
    table: dict[str, Any],
    trend: dict[str, Any],
    dist: dict[str, Any],
    decision: dict[str, Any],
) -> str:
    if decision.get("skipped"):
        return f"No change recommended for {table['tableName']}. {decision.get('skipReason') or ''}".strip()
    if decision["deltaPct"] > 0:
        direction = "raise"
    elif decision["deltaPct"] < 0:
        direction = "lower"
    else:
        direction = "hold"
    if direction == "hold":
        return (
            f"Current min bet at {table['tableName']} is already optimal. "
            f"Occupancy {table['occupancyRate'] * 100:.0f}% with trend {trend['label']}, "
            f"bet headroom {dist['betHeadroom']:.2f}x indicates no clear uplift opportunity."
        )
    return (
        f"Recommend {direction} of min bet to {decision['recommendedMinBet']} "
        f"({decision['deltaPct'] * 100:.1f}% change) at {table['tableName']}. "
        f"Driver: {trend['label']} occupancy at {table['occupancyRate'] * 100:.0f}% "
        f"with avg bet {dist['betHeadroom']:.2f}x the current floor and "
        f"low-bet share {dist['lowBetShare'] * 100:.0f}%. "
        f"Expected revenue uplift ~{decision['expectedRevenueUpliftPct'] * 100:.1f}%."
    )


# ---------- Nodes ----------


async def _node_observe(state: _State) -> dict[str, Any]:
    db = state["db"]
    table_id = state["table_id"]
    table = await db[cols.tables].find_one(
        {"tableId": table_id},
        {
            "_id": 0,
            "tableId": 1,
            "tableName": 1,
            "zone": 1,
            "gameType": 1,
            "minBet": 1,
            "maxBet": 1,
            "status": 1,
            "patronCount": 1,
            "avgBetAmount": 1,
            "occupancyRate": 1,
        },
    )
    if not table:
        return {"error": f"Table {table_id} not found."}

    sessions = await db[cols.sessions].aggregate(
        [
            {"$match": {"tableId": table_id, "isActive": True}},
            {
                "$lookup": {
                    "from": cols.patrons,
                    "localField": "patronId",
                    "foreignField": "patronId",
                    "as": "patron",
                }
            },
            {"$unwind": {"path": "$patron", "preserveNullAndEmptyArrays": True}},
            {
                "$project": {
                    "_id": 0,
                    "patronId": 1,
                    "sessionBetAmount": 1,
                    "currentStackEstimate": 1,
                    "behaviorTags": 1,
                    "tier": {"$ifNull": ["$patron.tier", "Bronze"]},
                }
            },
        ]
    ).to_list(length=None)

    if sessions:
        live_patron_count = len(sessions)
        live_avg_bet = round(
            sum(float(s.get("sessionBetAmount") or 0) for s in sessions) / live_patron_count
        )
        live_occupancy = round(min(1.0, live_patron_count / 9), 3)
        table["patronCount"] = live_patron_count
        table["avgBetAmount"] = live_avg_bet
        table["occupancyRate"] = live_occupancy
    else:
        table["patronCount"] = 0
        table["avgBetAmount"] = 0
        table["occupancyRate"] = 0

    history = await db[cols.table_state_history].find(
        {"tableId": table_id},
        {"_id": 0, "refreshedAt": 1, "patronCount": 1, "avgBetAmount": 1, "occupancyRate": 1},
    ).sort("refreshedAt", -1).limit(20).to_list(length=20)
    history.reverse()

    return {"table": table, "sessions": sessions, "history": history}


def _node_trend(state: _State) -> dict[str, Any]:
    if not state.get("table"):
        return {}
    counts = [float(h.get("patronCount") or 0) for h in state.get("history") or []]
    samples = len(counts)
    if samples < 2:
        return {"trend": {"label": "Stable", "velocity": 0, "samples": samples}}
    slope = _linear_slope(counts)
    velocity = _clamp(slope / 1.5, -1, 1)
    if velocity > 0.15:
        label = "Rising"
    elif velocity < -0.15:
        label = "Falling"
    else:
        label = "Stable"
    return {"trend": {"label": label, "velocity": velocity, "samples": samples}}


def _node_distribution(state: _State) -> dict[str, Any]:
    if not state.get("table"):
        return {}
    table = state["table"]
    min_bet = table.get("minBet") or 1
    bets = sorted(
        b for b in (float(s.get("sessionBetAmount") or 0) for s in state.get("sessions") or []) if b > 0
    )

    p50 = round(_percentile(bets, 0.5))
    p75 = round(_percentile(bets, 0.75))
    p90 = round(_percentile(bets, 0.9))

    if table.get("avgBetAmount"):
        avg_bet = float(table["avgBetAmount"])
    else:
        avg_bet = (sum(bets) / len(bets)) if bets else 0
    bet_headroom = round(avg_bet / min_bet, 3) if min_bet else 0

    low_bet_count = sum(1 for b in bets if b <= min_bet * 1.2)
    low_bet_share = round(low_bet_count / len(bets), 3) if bets else 0

    tier_mix: dict[str, int] = {}
    for s in state.get("sessions") or []:
        tier = s.get("tier") or "Bronze"
        tier_mix[tier] = tier_mix.get(tier, 0) + 1

    return {
        "distribution": {
            "p50": p50,
            "p75": p75,
            "p90": p90,
            "lowBetShare": low_bet_share,
            "betHeadroom": bet_headroom,
            "tierMix": tier_mix,
        }
    }


def _node_elasticity(state: _State) -> dict[str, Any]:
    table = state.get("table")
    trend = state.get("trend")
    dist = state.get("distribution")
    if not (table and trend and dist):
        return {}

    occupancy_score = _clamp(table["occupancyRate"], 0, 1)
    velocity_pos = _clamp((trend["velocity"] + 1) / 2, 0, 1)

    has_active_sessions = bool(state.get("sessions"))
    stickiness = 1 - dist["lowBetShare"] if has_active_sessions else 0

    raw_demand = _clamp(0.5 * occupancy_score + 0.3 * velocity_pos + 0.2 * stickiness, 0, 1)
    demand_signal = 0 if table["patronCount"] == 0 else raw_demand

    true_patron_count = table["patronCount"]
    baseline_patrons = max(1, true_patron_count)
    baseline_avg_bet = max(1, table["avgBetAmount"])
    baseline_revenue = 0 if true_patron_count == 0 else baseline_patrons * baseline_avg_bet

    delta_set = [-0.25, -0.10, 0, 0.10, 0.25]
    candidates: list[dict[str, Any]] = []
    for delta in delta_set:
        target_min_bet = table["minBet"] * (1 + delta)

        if delta > 0:
            retention = 1 - _clamp(delta * (dist["lowBetShare"] + 0.2) * 2, 0, 0.7)
        elif delta < 0:
            if true_patron_count == 0:
                retention = 1 + _clamp(abs(delta) * 3.0 * (1 - occupancy_score), 0, 2.0)
            else:
                retention = 1 + _clamp(abs(delta) * 0.4 * (1 - occupancy_score), 0, 0.25)
        else:
            retention = 1
        retention = _clamp(retention, 0.2, 3.0)

        anchored_floor = target_min_bet * 1.15
        if delta > 0:
            estimated_avg_bet = max(anchored_floor, dist["p50"], baseline_avg_bet * (1 + 0.5 * delta))
        else:
            estimated_avg_bet = max(target_min_bet, dist["p50"], baseline_avg_bet * (1 + 0.2 * delta))

        estimated_patrons = baseline_patrons * retention
        estimated_revenue = estimated_patrons * estimated_avg_bet
        if baseline_revenue == 0:
            expected_revenue_pct = estimated_revenue / max(1, table["minBet"])
        else:
            expected_revenue_pct = (estimated_revenue - baseline_revenue) / baseline_revenue

        candidates.append(
            {
                "minBet": round(target_min_bet),
                "deltaPct": delta,
                "expectedRevenuePct": round(expected_revenue_pct, 4),
                "estimatedRetentionPct": round(retention, 4),
            }
        )

    if demand_signal >= 0.65:
        filtered = [c for c in candidates if c["deltaPct"] >= 0]
    elif demand_signal <= 0.35:
        filtered = [c for c in candidates if c["deltaPct"] <= 0]
    else:
        filtered = candidates
    ranked = sorted(filtered, key=lambda c: c["expectedRevenuePct"], reverse=True)
    return {"candidates": ranked}


def _node_guardrails(state: _State) -> dict[str, Any]:
    table = state.get("table")
    dist = state.get("distribution")
    trend = state.get("trend")
    candidates = state.get("candidates") or []
    if not (table and dist and trend) or not candidates:
        return {
            "decision": {
                "recommendedMinBet": (table or {}).get("minBet") or 0,
                "deltaPct": 0,
                "expectedRevenueUpliftPct": 0,
                "confidence": 0,
                "reasons": ["Insufficient data to compute optimization."],
                "skipped": True,
                "skipReason": "Insufficient data",
            }
        }

    is_high_roller = _is_high_roller_zone(table["zone"])
    game_floor = GAME_FLOORS.get(table["gameType"], 25)
    steps = GAME_STEPS.get(table["gameType"], [25, 50, 100, 200, 500, 1000])

    top = candidates[0]
    if top["deltaPct"] < 0:
        direction = "lower"
    elif top["deltaPct"] > 0:
        direction = "raise"
    else:
        direction = "hold"

    if direction == "lower":
        lower_steps = [s for s in steps if s < table["minBet"] and s >= game_floor]
        snapped = max(lower_steps) if lower_steps else table["minBet"]
    elif direction == "raise":
        raise_steps = [s for s in steps if s > table["minBet"]]
        snapped = min(raise_steps) if raise_steps else table["minBet"]
    else:
        snapped = table["minBet"]

    final_delta = (snapped - table["minBet"]) / max(1, table["minBet"])

    reasons: list[str] = [
        f"Occupancy {table['occupancyRate'] * 100:.0f}% with {trend['label'].lower()} trend "
        f"(velocity {trend['velocity']:.2f})",
        f"Average bet is {dist['betHeadroom']:.2f}x current min; p75 {dist['p75']}, p90 {dist['p90']}",
        f"Low-bet share {dist['lowBetShare'] * 100:.0f}%",
    ]
    if is_high_roller:
        reasons.append("High-roller zone applied")
    if final_delta == 0 and direction == "lower":
        reasons.append(f"Already at floor ({game_floor}) — cannot lower further")
    if final_delta == 0 and direction == "raise":
        reasons.append(f"Already at ceiling ({steps[-1]}) — cannot raise further")

    history_conf = _clamp(trend["samples"] / 10, 0, 1) * 0.4
    uplift_conf = _clamp(abs(top["expectedRevenuePct"]) * 4, 0, 1) * 0.4
    stickiness_conf = (1 - dist["lowBetShare"]) * 0.2
    confidence = history_conf + uplift_conf + stickiness_conf
    if is_high_roller:
        confidence = min(confidence, 0.65)
    confidence = round(_clamp(confidence, 0.2, 0.95), 3)

    return {
        "decision": {
            "recommendedMinBet": snapped,
            "deltaPct": round(final_delta, 4),
            "expectedRevenueUpliftPct": top["expectedRevenuePct"],
            "confidence": confidence,
            "reasons": reasons,
            "skipped": False,
        }
    }


async def _node_cooldown(state: _State) -> dict[str, Any]:
    decision = state.get("decision")
    if not decision or decision.get("skipped") or decision.get("deltaPct") == 0:
        return {}
    db = state["db"]
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=COOLDOWN_MINUTES)
    recent = await db[cols.min_bet_audit].find_one(
        {"tableId": state["table_id"], "at": {"$gte": cutoff}}
    )
    if not recent:
        return {}
    at_val = recent.get("at")
    at_str = at_val.isoformat() if isinstance(at_val, datetime) else str(at_val)
    return {
        "decision": {
            **decision,
            "recommendedMinBet": (state.get("table") or {}).get("minBet") or 0,
            "deltaPct": 0,
            "expectedRevenueUpliftPct": 0,
            "skipped": True,
            "skipReason": f"Cooldown active (last change within {COOLDOWN_MINUTES} minutes)",
            "reasons": [
                *(decision.get("reasons") or []),
                f"Cooldown active — last change at {at_str}",
            ],
        }
    }


async def _node_rationale(state: _State) -> dict[str, Any]:
    table = state.get("table")
    decision = state.get("decision")
    trend = state.get("trend")
    dist = state.get("distribution")
    if not (table and decision and trend and dist):
        return {"rationale": "Unable to generate rationale due to missing inputs."}
    try:
        llm = await _llm_rationale(table, trend, dist, decision)
    except Exception:  # noqa: BLE001
        llm = None
    if llm:
        return {"rationale": llm}
    return {"rationale": _deterministic_rationale(table, trend, dist, decision)}


async def _node_persist(state: _State) -> dict[str, Any]:
    table = state.get("table")
    decision = state.get("decision")
    trend = state.get("trend")
    dist = state.get("distribution")
    if not (table and decision and trend and dist):
        return {"recommendation_id": None}

    now = datetime.now(timezone.utc)
    ts_36 = int(now.timestamp() * 1000)
    recommendation_id = f"MBR-{format(ts_36, 'x')}-{_rand_suffix()}"
    expires_at = now + timedelta(minutes=PROPOSAL_TTL_MINUTES)

    doc = {
        "recommendationId": recommendation_id,
        "tableId": table["tableId"],
        "runId": state["run_id"],
        "currentMinBet": table["minBet"],
        "recommendedMinBet": decision["recommendedMinBet"],
        "deltaPct": decision["deltaPct"],
        "expectedRevenueUpliftPct": decision["expectedRevenueUpliftPct"],
        "confidence": decision["confidence"],
        "rationale": state.get("rationale", ""),
        "reasons": decision.get("reasons") or [],
        "drivers": {
            "occupancyTrend": trend["label"],
            "occupancyVelocity": trend["velocity"],
            "occupancyRate": table["occupancyRate"],
            "betHeadroom": dist["betHeadroom"],
            "lowBetShare": dist["lowBetShare"],
            "p50Bet": dist["p50"],
            "p75Bet": dist["p75"],
            "p90Bet": dist["p90"],
            "tierMix": dist["tierMix"],
            "zone": table["zone"],
            "gameType": table["gameType"],
        },
        "candidates": state.get("candidates") or [],
        "status": "Skipped" if decision.get("skipped") else "Proposed",
        "skipReason": decision.get("skipReason"),
        "createdAt": now,
        "expiresAt": expires_at,
    }

    if not decision.get("skipped"):
        db = state["db"]
        await db[cols.min_bet_recommendations].insert_one(doc)
    return {"recommendation_id": None if decision.get("skipped") else recommendation_id}


# ---------- Graph builder ----------


def _build_graph() -> Any:
    g = StateGraph(_State)
    g.add_node("observe_state", _node_observe)
    g.add_node("compute_trend", _node_trend)
    g.add_node("compute_distribution", _node_distribution)
    g.add_node("score_elasticity", _node_elasticity)
    g.add_node("apply_guardrails", _node_guardrails)
    g.add_node("check_cooldown", _node_cooldown)
    g.add_node("generate_rationale", _node_rationale)
    g.add_node("persist_recommendation", _node_persist)
    g.add_edge(START, "observe_state")
    g.add_edge("observe_state", "compute_trend")
    g.add_edge("compute_trend", "compute_distribution")
    g.add_edge("compute_distribution", "score_elasticity")
    g.add_edge("score_elasticity", "apply_guardrails")
    g.add_edge("apply_guardrails", "check_cooldown")
    g.add_edge("check_cooldown", "generate_rationale")
    g.add_edge("generate_rationale", "persist_recommendation")
    g.add_edge("persist_recommendation", END)
    return g.compile()


_GRAPH = _build_graph()


async def run_min_bet_optimizer(
    db, table_id: str, actor_id: str = "system"
) -> dict[str, Any] | None:
    run_id = f"RUN-{format(int(time.time() * 1000), 'x')}-{_rand_suffix()}"
    result = await _GRAPH.ainvoke(
        {
            "table_id": table_id,
            "run_id": run_id,
            "actor_id": actor_id,
            "table": None,
            "sessions": [],
            "history": [],
            "trend": None,
            "distribution": None,
            "candidates": [],
            "decision": None,
            "rationale": "",
            "recommendation_id": None,
            "error": None,
            "db": db,
        }
    )

    if (
        result.get("error")
        or not result.get("table")
        or not result.get("decision")
        or not result.get("trend")
        or not result.get("distribution")
    ):
        return None

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=PROPOSAL_TTL_MINUTES)
    table = result["table"]
    trend = result["trend"]
    dist = result["distribution"]
    decision = result["decision"]

    return {
        "recommendationId": result.get("recommendation_id")
        or f"MBR-SKIPPED-{format(int(time.time() * 1000), 'x')}",
        "tableId": table["tableId"],
        "runId": run_id,
        "currentMinBet": table["minBet"],
        "recommendedMinBet": decision["recommendedMinBet"],
        "deltaPct": decision["deltaPct"],
        "expectedRevenueUpliftPct": decision["expectedRevenueUpliftPct"],
        "confidence": decision["confidence"],
        "rationale": result.get("rationale", ""),
        "reasons": decision.get("reasons") or [],
        "drivers": {
            "occupancyTrend": trend["label"],
            "occupancyVelocity": trend["velocity"],
            "occupancyRate": table["occupancyRate"],
            "betHeadroom": dist["betHeadroom"],
            "lowBetShare": dist["lowBetShare"],
            "p50Bet": dist["p50"],
            "p75Bet": dist["p75"],
            "p90Bet": dist["p90"],
            "tierMix": dist["tierMix"],
            "zone": table["zone"],
            "gameType": table["gameType"],
        },
        "candidates": result.get("candidates") or [],
        "status": "Skipped" if decision.get("skipped") else "Proposed",
        "skipReason": decision.get("skipReason"),
        "createdAt": now.isoformat(),
        "expiresAt": expires_at.isoformat(),
    }
