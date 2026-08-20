"""Deterministic-ish factories that produce mock domain data.

Direct port of ``src/seed/mock-data.ts``. Behaviour parity is preferred over
Pythonic idioms — tier weights, activity counts, offer catalog entries and
recommendation counts all mirror the TypeScript source so downstream
consumers keep the same shape.

Vector fields (``preferenceEmbedding``, ``activityEmbedding``,
``offerEmbedding``) are emitted as zero-vectors of ``settings.llm.embedding_dim``;
the backfill scripts populate real embeddings later.
"""

from __future__ import annotations

import random
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from faker import Faker

from app.config import settings

fake = Faker()

# ---------------------------------------------------------------------------
# Shared vocabulary
# ---------------------------------------------------------------------------

GAME_TYPES: list[str] = ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"]
ZONES: list[str] = ["A", "B", "C", "VIP"]

# Macau casino visitor region distribution (weighted). Mirrors the TS file.
REGION_WEIGHTS: list[tuple[str, int]] = [
    ("HongKong", 30),
    ("Guangdong", 28),
    ("Macau", 18),
    ("OtherGBA", 10),
    ("Taiwan", 8),
    ("International", 6),
]

ALLOWED_MIN_BETS: tuple[int, ...] = (300, 500, 800, 1000)


# ---------------------------------------------------------------------------
# Small helpers that bridge the @faker-js/faker API to Python's faker + random
# ---------------------------------------------------------------------------


def _rand_int(min_val: int, max_val: int) -> int:
    """Inclusive random int (mirrors ``faker.number.int``)."""
    return random.randint(min_val, max_val)


def _rand_float(min_val: float, max_val: float, fraction_digits: int = 3) -> float:
    """Random float rounded to N digits (mirrors ``faker.number.float``)."""
    return round(random.uniform(min_val, max_val), fraction_digits)


def _rand_element(seq: Sequence[Any]) -> Any:
    """Uniform choice (mirrors ``faker.helpers.arrayElement``)."""
    return random.choice(seq)


def _rand_elements(
    seq: Sequence[Any],
    *,
    min_count: int | None = None,
    max_count: int | None = None,
    count: int | None = None,
) -> list[Any]:
    """Random unique subset. Mirrors ``faker.helpers.arrayElements``."""
    if count is None:
        assert min_count is not None and max_count is not None
        count = _rand_int(min_count, max_count)
    count = min(count, len(seq))
    return random.sample(list(seq), count)


def _weighted_choice(pairs: Iterable[tuple[Any, float]]) -> Any:
    """Weighted choice, mirrors ``faker.helpers.weightedArrayElement``."""
    pairs = list(pairs)
    total = sum(w for _, w in pairs)
    r = random.random() * total
    for value, weight in pairs:
        r -= weight
        if r <= 0:
            return value
    return pairs[-1][0]


def _bool(probability: float = 0.5) -> bool:
    """Mirrors ``faker.datatype.boolean(probability)``."""
    return random.random() < probability


def _uuid() -> str:
    return str(uuid.uuid4())


def _alphanumeric_upper(length: int) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choices(alphabet, k=length))


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _recent_date(days: int) -> datetime:
    """A datetime within the past ``days`` days. Mirrors ``faker.date.recent``."""
    now = _now_utc()
    offset = random.random() * days * 86400
    return now - timedelta(seconds=offset)


def _past_date(years: int) -> datetime:
    """Uniform datetime within the past ``years`` years."""
    now = _now_utc()
    offset = random.random() * years * 365 * 86400
    return now - timedelta(seconds=offset)


def _soon_date(days: int, ref: datetime | None = None) -> datetime:
    """A datetime within ``days`` days after ``ref`` (default now)."""
    base = ref if ref is not None else _now_utc()
    offset = random.random() * days * 86400
    return base + timedelta(seconds=offset)


def _between_dates(start: datetime, end: datetime) -> datetime:
    """Random datetime between ``start`` and ``end`` (mirrors ``faker.date.between``)."""
    if end < start:
        start, end = end, start
    span = (end - start).total_seconds()
    return start + timedelta(seconds=random.random() * span)


def _zero_embedding() -> list[float]:
    """Placeholder embedding — backfill scripts fill real vectors later."""
    return [0.0] * settings.llm.embedding_dim


def _build_patron_id(index: int) -> str:
    return f"P-{str(index + 1).zfill(6)}"


def _build_table_id(index: int) -> str:
    return f"T-{str(index + 1).zfill(4)}"


def _pick_region() -> str:
    return _weighted_choice(REGION_WEIGHTS)


# ---------------------------------------------------------------------------
# Public factories — snake_case ports of the TS ``generateX`` functions.
# ---------------------------------------------------------------------------


def generate_patrons(count: int) -> list[dict[str, Any]]:
    """Build a list of patron_profiles documents."""
    tiers = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"]
    now = _now_utc()
    out: list[dict[str, Any]] = []
    for i in range(count):
        name = fake.name()
        first = name[:1] if name else "?"
        out.append(
            {
                "patronId": _build_patron_id(i),
                "name": name,
                "maskedName": f"{first}***{_alphanumeric_upper(2)}",
                "tier": _rand_element(tiers),
                "adt": _rand_int(800, 35000),
                "preferredGames": _rand_elements(GAME_TYPES, min_count=1, max_count=3),
                "riskFlags": _rand_elements(
                    ["None", "HighVariance", "FrequentCashout", "NightOnly", "PromoSensitive"],
                    min_count=1,
                    max_count=2,
                ),
                "pointsBalance": _rand_int(200, 120000),
                "lastActiveAt": _recent_date(7),
                "region": _pick_region(),
                "activities": [],
                "preferenceEmbedding": _zero_embedding(),
                "createdAt": _past_date(2),
                "updatedAt": now,
            }
        )
    return out


def generate_tables(count: int) -> list[dict[str, Any]]:
    """Build a list of table_state_snapshots documents."""
    now = _now_utc()
    out: list[dict[str, Any]] = []
    for i in range(count):
        min_bet = _rand_element(ALLOWED_MIN_BETS)
        out.append(
            {
                "tableId": _build_table_id(i),
                "tableName": f"Table {i + 1}",
                "zone": _rand_element(ZONES),
                "gameType": _rand_element(GAME_TYPES),
                "minBet": min_bet,
                "maxBet": min_bet * _rand_int(20, 100),
                "status": _rand_element(["Open", "Busy", "Closed"]),
                "patronCount": _rand_int(0, 9),
                "avgBetAmount": _rand_int(100, 20000),
                "occupancyRate": _rand_float(0, 1, 3),
                "refreshedAt": now,
            }
        )
    return out


def generate_sessions(
    patrons: list[dict[str, Any]], tables: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Build patron_table_sessions documents; ~62% of patrons get a session."""
    sessions: list[dict[str, Any]] = []
    now = _now_utc()
    for patron in patrons:
        if _bool(0.62):
            table = _rand_element(tables)
            seated_at = _recent_date(1)
            sessions.append(
                {
                    "patronId": patron["patronId"],
                    "tableId": table["tableId"],
                    "seatedAt": seated_at,
                    "lastActionAt": _between_dates(seated_at, now),
                    "sessionBetAmount": _rand_int(200, 40000),
                    "currentStackEstimate": _rand_int(100, 100000),
                    "behaviorTags": _rand_elements(
                        [
                            "Aggressive",
                            "Conservative",
                            "LateNight",
                            "CardCounterWatch",
                            "PromoSeeker",
                        ],
                        min_count=1,
                        max_count=2,
                    ),
                    "isActive": True,
                }
            )
    return sessions


def generate_activities(
    patrons: list[dict[str, Any]], count_per_patron: int = 12
) -> dict[str, list[dict[str, Any]]]:
    """Build ``count_per_patron`` PatronActivityEvent objects for every patron."""
    activity_types = [
        "ChipExchange",
        "TableBet",
        "PointsRedeem",
        "ShowPurchase",
        "HotelBooking",
        "DrinkRedeem",
    ]
    events_by_patron: dict[str, list[dict[str, Any]]] = {}
    for patron in patrons:
        patron_events: list[dict[str, Any]] = []
        for _ in range(count_per_patron):
            activity_type = _rand_element(activity_types)
            if activity_type == "ChipExchange":
                source = "Cage"
            elif activity_type == "DrinkRedeem":
                source = "POS"
            elif activity_type == "PointsRedeem":
                source = "Loyalty"
            else:
                source = "TableSystem"
            points_delta = (
                -_rand_int(200, 2000)
                if activity_type == "PointsRedeem"
                else _rand_int(20, 1500)
            )
            patron_events.append(
                {
                    "eventId": _uuid(),
                    "activityType": activity_type,
                    "source": source,
                    "amount": _rand_int(50, 50000),
                    "pointsDelta": points_delta,
                    "metadata": {
                        "venue": _rand_element(["MainFloor", "VIPLounge", "Theater", "Hotel"]),
                        "channel": _rand_element(["InPerson", "Mobile", "HostDesk"]),
                        "isVip": patron["tier"] in ("Platinum", "Diamond"),
                    },
                    "activityEmbedding": _zero_embedding(),
                    "eventTime": _recent_date(14),
                }
            )
        patron_events.sort(key=lambda e: e["eventTime"], reverse=True)
        events_by_patron[patron["patronId"]] = patron_events
    return events_by_patron


def generate_offer_catalog() -> list[dict[str, Any]]:
    """Return the fixed 12-entry offer catalog (Chinese descriptions preserved)."""
    now = _now_utc()
    templates: list[dict[str, Any]] = [
        # ── HotelRoom ──────────────────────────────────────────────────────
        {
            "offerId": "OFFER-0001",
            "offerType": "HotelRoom",
            "title": "頂級豪華套房免費一晚",
            "description": (
                "專為鑽石及白金等級頂級賓客設計，ADT 15,000 以上的高消費百家樂及撲克玩家可享受一晚"
                "頂級豪華套房住宿禮遇，含早餐及行政貴賓廳使用權。"
            ),
            "eligibilityRules": [
                "tier in [Diamond, Platinum]",
                "adt >= 15000",
                "lastActiveAt within 30 days",
                "riskFlags does not include ResponsibleGamingHold",
            ],
            "estimatedCost": 3800,
            "targetGameTypes": ["Baccarat", "Poker"],
            "priority": 100,
        },
        {
            "offerId": "OFFER-0002",
            "offerType": "HotelRoom",
            "title": "高級客房週末住宿禮遇",
            "description": (
                "適合黃金等級活躍賓客，ADT 5,000 至 15,000 之間，近 14 天內有到訪紀錄，可享週末兩天"
                "一夜高級客房住宿，含自助早餐。"
            ),
            "eligibilityRules": [
                "tier in [Gold]",
                "adt >= 5000",
                "adt < 15000",
                "lastActiveAt within 14 days",
                "riskFlags does not include ResponsibleGamingHold",
            ],
            "estimatedCost": 1200,
            "targetGameTypes": ["Baccarat", "Blackjack", "Roulette"],
            "priority": 85,
        },
        # ── MusicShowTicket ────────────────────────────────────────────────
        {
            "offerId": "OFFER-0003",
            "offerType": "MusicShowTicket",
            "title": "演唱會 VIP 包廂雙人票",
            "description": (
                "白金及鑽石等級頂級賓客專屬，偏好百家樂或撲克的高消費玩家可獲贈國際知名演唱會 VIP 包廂"
                "雙人門票，含駐場服務及精緻餐飲。"
            ),
            "eligibilityRules": [
                "tier in [Platinum, Diamond]",
                "preferredGames includes [Baccarat, Poker]",
                "lastActiveAt within 30 days",
                "riskFlags does not include ResponsibleGamingHold",
            ],
            "estimatedCost": 2800,
            "targetGameTypes": ["Baccarat", "Poker"],
            "priority": 95,
        },
        {
            "offerId": "OFFER-0004",
            "offerType": "MusicShowTicket",
            "title": "週末娛樂表演雙人門票",
            "description": (
                "白銀及黃金等級積分達 5,000 點以上的賓客，可兌換週末娛樂表演雙人普通票，涵蓋多種輪盤"
                "及骰寶玩家，提升到訪率及娛樂體驗。"
            ),
            "eligibilityRules": [
                "tier in [Silver, Gold]",
                "pointsBalance >= 5000",
                "lastActiveAt within 21 days",
            ],
            "estimatedCost": 800,
            "targetGameTypes": ["Roulette", "SicBo", "Blackjack"],
            "priority": 75,
        },
        # ── PointsLimitedTime ──────────────────────────────────────────────
        {
            "offerId": "OFFER-0005",
            "offerType": "PointsLimitedTime",
            "title": "限時雙倍積分兌換禮遇（頂級版）",
            "description": (
                "鑽石及白金等級積分餘額 20,000 點以上的頂級賓客，限時 72 小時內可享雙倍積分兌換價值，"
                "適合百家樂及撲克高消費玩家加快獲取禮品。"
            ),
            "eligibilityRules": [
                "tier in [Diamond, Platinum]",
                "pointsBalance >= 20000",
                "lastActiveAt within 14 days",
            ],
            "estimatedCost": 1500,
            "targetGameTypes": ["Baccarat", "Poker"],
            "priority": 90,
        },
        {
            "offerId": "OFFER-0006",
            "offerType": "PointsLimitedTime",
            "title": "積分快閃兌換活動",
            "description": (
                "黃金及白銀等級積分達 5,000 點、近 30 天內活躍的賓客，可在限定 48 小時內以 1.5 倍積分"
                "兌換各類禮品及餐飲，刺激回訪意欲。"
            ),
            "eligibilityRules": [
                "tier in [Gold, Silver]",
                "pointsBalance >= 5000",
                "lastActiveAt within 30 days",
            ],
            "estimatedCost": 600,
            "targetGameTypes": ["Baccarat", "Blackjack", "Roulette", "SicBo"],
            "priority": 70,
        },
        {
            "offerId": "OFFER-0007",
            "offerType": "PointsLimitedTime",
            "title": "新會員積分激活禮包",
            "description": (
                "青銅及白銀等級初次兌換積分的賓客，積分餘額達 500 點即可啟動首次兌換獎勵，獲贈額外 200"
                "積分加成，鼓勵新賓客積極參與積分計劃。"
            ),
            "eligibilityRules": [
                "tier in [Bronze, Silver]",
                "pointsBalance >= 500",
                "lastActiveAt within 60 days",
            ],
            "estimatedCost": 150,
            "targetGameTypes": ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"],
            "priority": 55,
        },
        # ── FNBVoucher ─────────────────────────────────────────────────────
        {
            "offerId": "OFFER-0008",
            "offerType": "FNBVoucher",
            "title": "頂級餐廳晚宴禮品券",
            "description": (
                "白金及鑽石等級 ADT 10,000 以上的尊貴賓客，可獲贈指定頂級餐廳雙人晚宴禮品券，含酒水"
                "服務，提升高端賓客的整體體驗及忠誠度。"
            ),
            "eligibilityRules": [
                "tier in [Platinum, Diamond]",
                "adt >= 10000",
                "lastActiveAt within 30 days",
                "riskFlags does not include ResponsibleGamingHold",
            ],
            "estimatedCost": 1800,
            "targetGameTypes": ["Baccarat", "Poker"],
            "priority": 88,
        },
        {
            "offerId": "OFFER-0009",
            "offerType": "FNBVoucher",
            "title": "貴賓廳飲品免費暢飲券",
            "description": (
                "所有等級賓客，當日桌面下注金額達 3,000 元以上即可獲贈貴賓廳飲品免費暢飲券，適用於"
                "所有遊戲類型，鼓勵賓客加大下注參與。"
            ),
            "eligibilityRules": [
                "TableBet amount >= 3000",
                "lastActiveAt within 7 days",
            ],
            "estimatedCost": 300,
            "targetGameTypes": ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"],
            "priority": 65,
        },
        {
            "offerId": "OFFER-0010",
            "offerType": "FNBVoucher",
            "title": "下午茶自助餐雙人券",
            "description": (
                "白銀及黃金等級近 7 天內有到訪紀錄的活躍賓客，可獲贈酒店下午茶自助餐雙人券，適合輪盤"
                "及骰寶愛好者，提升短期回訪頻率。"
            ),
            "eligibilityRules": [
                "tier in [Silver, Gold]",
                "lastActiveAt within 7 days",
            ],
            "estimatedCost": 480,
            "targetGameTypes": ["Roulette", "SicBo", "Blackjack"],
            "priority": 60,
        },
        # ── CashRebate ─────────────────────────────────────────────────────
        {
            "offerId": "OFFER-0011",
            "offerType": "CashRebate",
            "title": "頂級現金回扣禮遇",
            "description": (
                "鑽石等級 ADT 20,000 以上的最高端百家樂及撲克玩家，可享每月最高 3% 現金回扣禮遇，"
                "以現金或籌碼形式返還，為頂級賓客提供最具競爭力的留客方案。"
            ),
            "eligibilityRules": [
                "tier in [Diamond]",
                "adt >= 20000",
                "preferredGames includes [Baccarat, Poker]",
                "lastActiveAt within 30 days",
                "riskFlags does not include ResponsibleGamingHold",
            ],
            "estimatedCost": 5000,
            "targetGameTypes": ["Baccarat", "Poker"],
            "priority": 98,
        },
        # ── TransportVoucher ───────────────────────────────────────────────
        {
            "offerId": "OFFER-0012",
            "offerType": "TransportVoucher",
            "title": "尊貴專車接送禮券",
            "description": (
                "白金及鑽石等級 ADT 8,000 以上的賓客，可享預約尊貴專車或直升機接送服務，覆蓋港澳及"
                "大灣區主要城市，提升頂級賓客的到訪便利性及尊貴感受。"
            ),
            "eligibilityRules": [
                "tier in [Platinum, Diamond]",
                "adt >= 8000",
                "lastActiveAt within 45 days",
            ],
            "estimatedCost": 2200,
            "targetGameTypes": ["Baccarat", "Poker", "Blackjack"],
            "priority": 82,
        },
    ]

    return [
        {
            **t,
            "status": "Active",
            "offerEmbedding": _zero_embedding(),
            "createdAt": now,
            "updatedAt": now,
        }
        for t in templates
    ]


def generate_recommendations(
    patrons: list[dict[str, Any]],
    offers: list[dict[str, Any]],
    count_per_patron: int = 2,
) -> list[dict[str, Any]]:
    """Build offer_recommendations for every patron."""
    out: list[dict[str, Any]] = []
    for patron in patrons:
        chosen = _rand_elements(offers, count=count_per_patron)
        for offer in chosen:
            out.append(
                {
                    "recommendationId": _uuid(),
                    "patronId": patron["patronId"],
                    "offerId": offer["offerId"],
                    "reasonSummary": (
                        f"{patron['tier']} patron with ADT {patron['adt']} "
                        f"and recent activity match."
                    ),
                    "relevanceScore": _rand_float(0.6, 0.99, 3),
                    "confidence": _rand_float(0.55, 0.98, 3),
                    "nextBestAction": _rand_element(
                        [
                            "Send offer now",
                            "Let host call patron",
                            "Bundle with hotel package",
                        ]
                    ),
                    "status": _rand_element(["Proposed", "Approved", "Sent"]),
                    "generatedBy": _rand_element(["RuleEngine", "LLM"]),
                    "generatedAt": _recent_date(2),
                    "expiresAt": _soon_date(7),
                }
            )
    return out


def generate_pr_agents(count: int = 24) -> list[dict[str, Any]]:
    """Build pr_agent_profiles documents."""
    now = _now_utc()
    out: list[dict[str, Any]] = []
    for index in range(count):
        preferred_tiers = _rand_elements(
            ["Silver", "Gold", "Platinum", "Diamond"], min_count=1, max_count=3
        )
        preferred_games = _rand_elements(GAME_TYPES, min_count=1, max_count=3)
        out.append(
            {
                "prAgentId": f"PR-{str(index + 1).zfill(4)}",
                "name": fake.name(),
                "active": _bool(0.9),
                "maxActivePatrons": _rand_int(6, 18),
                "currentActivePatrons": _rand_int(0, 9),
                "preferredTiers": preferred_tiers,
                "preferredGames": preferred_games,
                "preferredLanguages": _rand_elements(
                    ["Cantonese", "Mandarin", "English", "Portuguese", "Thai"],
                    min_count=1,
                    max_count=3,
                ),
                "specialtyTags": _rand_elements(
                    [
                        "HighRoller",
                        "EntertainmentVIP",
                        "PremiumMass",
                        "FamilyOffice",
                        "LateNightOps",
                    ],
                    min_count=1,
                    max_count=3,
                ),
                "lastAssignedAt": _recent_date(10),
                "createdAt": _past_date(2),
                "updatedAt": now,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Risk-case + PR-assignment factories (mirrors TS behaviour verbatim)
# ---------------------------------------------------------------------------


def _build_loss_assessment(
    patron: dict[str, Any], session: dict[str, Any] | None
) -> dict[str, Any]:
    session_signal = min(session["sessionBetAmount"] / 40000, 1) if session else 0.2
    adt_signal = min(patron["adt"] / 35000, 1)
    if session and "Aggressive" in session.get("behaviorTags", []):
        behavior_signal = 0.9
    elif session and "PromoSeeker" in session.get("behaviorTags", []):
        behavior_signal = 0.65
    else:
        behavior_signal = 0.35
    score = round(session_signal * 0.45 + adt_signal * 0.3 + behavior_signal * 0.25, 3)
    if score >= 0.72:
        label = "Likely"
    elif score >= 0.5:
        label = "Borderline"
    else:
        label = "Unlikely"
    explanation = (
        "Repeated high-intensity play and behavior markers indicate elevated "
        "loss-chasing potential."
        if label == "Likely"
        else "Some risk markers are present but require admin judgement with financial context."
        if label == "Borderline"
        else "Current behavior appears controlled with limited loss-chasing indicators."
    )
    return {
        "score": score,
        "label": label,
        "confidence": round(0.58 + score * 0.37, 3),
        "drivers": [
            f"Session intensity {session_signal * 100:.0f}%",
            f"ADT signal {adt_signal * 100:.0f}%",
            f"Behavior pattern {behavior_signal * 100:.0f}%",
        ],
        "explanation": explanation,
    }


def _build_financial_assessment(patron: dict[str, Any]) -> dict[str, Any]:
    spike = _bool(0.25)
    exchange_anomaly = _bool(0.22)
    high_risk_source = _bool(0.12)
    fresh_kyc = _bool(0.84)
    consistent_pattern = not (spike or exchange_anomaly)
    aml_risk_score = round(
        (0.27 if spike else 0.05)
        + (0.26 if exchange_anomaly else 0.05)
        + (0.32 if high_risk_source else 0.04)
        + (0.06 if fresh_kyc else 0.2),
        3,
    )
    if aml_risk_score >= 0.68:
        source_of_funds_risk = "High"
    elif aml_risk_score >= 0.4:
        source_of_funds_risk = "Medium"
    else:
        source_of_funds_risk = "Low"

    if patron["adt"] >= 18000:
        credit_band = "Strong"
    elif patron["adt"] >= 9000:
        credit_band = "Good"
    elif patron["adt"] >= 3500:
        credit_band = "Fair"
    else:
        credit_band = "Weak"

    analyst_notes = (
        "Escalate to senior reviewer; source-of-funds confidence is insufficient."
        if source_of_funds_risk == "High"
        else "Proceed with caution and require admin rationale before PR assignment."
        if source_of_funds_risk == "Medium"
        else "Financial profile appears acceptable for standard workflow."
    )
    return {
        "amlRiskScore": aml_risk_score,
        "creditBand": credit_band,
        "sourceOfFundsRisk": source_of_funds_risk,
        "confidence": round(0.62 + (1 - min(aml_risk_score, 0.9)) * 0.25, 3),
        "checklist": [
            {
                "key": "incomePatternConsistent",
                "passed": consistent_pattern,
                "notes": (
                    "Betting profile aligns with historical baseline."
                    if consistent_pattern
                    else "Recent variance spike observed."
                ),
            },
            {
                "key": "largeCashSpike",
                "passed": not spike,
                "notes": (
                    "Large cash exchange spikes detected in recent activities."
                    if spike
                    else "No unusual cash spike pattern."
                ),
            },
            {
                "key": "chipExchangeAnomaly",
                "passed": not exchange_anomaly,
                "notes": (
                    "Potentially anomalous chip exchange cadence."
                    if exchange_anomaly
                    else "Chip exchange cadence within expected range."
                ),
            },
            {
                "key": "highRiskSourceSignal",
                "passed": not high_risk_source,
                "notes": (
                    "Watchlist-aligned source indicator found."
                    if high_risk_source
                    else "No high-risk source signals found."
                ),
            },
            {
                "key": "kycProfileFresh",
                "passed": fresh_kyc,
                "notes": (
                    "KYC profile recently refreshed."
                    if fresh_kyc
                    else "KYC refresh is overdue."
                ),
            },
        ],
        "analystNotes": analyst_notes,
    }


def _derive_risk_level(loss: dict[str, Any], financial: dict[str, Any]) -> str:
    if financial["amlRiskScore"] >= 0.75:
        return "Critical"
    if loss["score"] >= 0.75 or financial["amlRiskScore"] >= 0.55:
        return "High"
    if loss["score"] >= 0.5 or financial["amlRiskScore"] >= 0.35:
        return "Medium"
    return "Low"


_ALL_NODES = [
    "initialize_case",
    "evaluate_loss_chasing",
    "evaluate_financial_credit_aml",
    "risk_escalation_router",
    "await_admin_review",
    "assign_pr_agent",
    "emit_assignment_notice",
    "finalize_case",
]


def _build_node_states(status: str) -> list[dict[str, Any]]:
    now = _now_utc()
    nodes = _ALL_NODES

    if status == "AwaitingAdmin":
        pivot = nodes.index("await_admin_review")
        result = []
        for node in nodes:
            idx = nodes.index(node)
            if node == "await_admin_review":
                state = "Running"
            elif idx < pivot:
                state = "Completed"
            else:
                state = "Pending"
            entry: dict[str, Any] = {"nodeName": node, "status": state}
            if node == "await_admin_review":
                entry["startedAt"] = now
            result.append(entry)
        return result

    if status == "InReview":
        pivot = nodes.index("evaluate_financial_credit_aml")
        result = []
        for node in nodes:
            idx = nodes.index(node)
            if node == "evaluate_financial_credit_aml":
                state = "Failed"
            elif idx < pivot:
                state = "Completed"
            else:
                state = "Pending"
            entry = {"nodeName": node, "status": state}
            if idx < pivot:
                entry["completedAt"] = now
            if node == "evaluate_financial_credit_aml":
                entry["message"] = "AML model confidence below threshold."
            result.append(entry)
        return result

    if status == "Rejected":
        result = []
        for node in nodes:
            if node == "finalize_case":
                state = "Completed"
            elif node in ("assign_pr_agent", "emit_assignment_notice"):
                state = "Skipped"
            else:
                state = "Completed"
            result.append({"nodeName": node, "status": state, "completedAt": now})
        return result

    return [{"nodeName": node, "status": "Completed", "completedAt": now} for node in nodes]


def _build_timeline(status: str, admin_decision: str | None) -> list[dict[str, Any]]:
    now = _now_utc()
    timeline: list[dict[str, Any]] = [
        {
            "eventType": "CaseCreated",
            "actorType": "System",
            "actorId": "risk-case-engine",
            "payload": {"status": status},
            "createdAt": now - timedelta(minutes=40),
        },
        {
            "eventType": "LossAssessmentCompleted",
            "actorType": "Agent",
            "actorId": "loss-chasing-agent",
            "payload": {"ok": True},
            "createdAt": now - timedelta(minutes=33),
        },
        {
            "eventType": "FinancialAssessmentCompleted",
            "actorType": "Agent",
            "actorId": "financial-aml-agent",
            "payload": {"ok": status != "InReview"},
            "createdAt": now - timedelta(minutes=27),
        },
    ]

    if status in ("AwaitingAdmin", "Rejected", "Approved", "Assigned"):
        timeline.append(
            {
                "eventType": "Escalated",
                "actorType": "System",
                "actorId": "risk-escalation-router",
                "payload": {"queue": "admin"},
                "createdAt": now - timedelta(minutes=21),
            }
        )

    if admin_decision:
        timeline.append(
            {
                "eventType": "AdminDecisionSubmitted",
                "actorType": "Admin",
                "actorId": "ADM-001",
                "payload": {"decision": admin_decision},
                "createdAt": now - timedelta(minutes=14),
            }
        )

    if status == "Assigned":
        timeline.append(
            {
                "eventType": "PRAssignmentCreated",
                "actorType": "System",
                "actorId": "pr-assignment-agent",
                "payload": {"queue": "pr"},
                "createdAt": now - timedelta(minutes=8),
            }
        )

    if status in ("Rejected", "Assigned"):
        timeline.append(
            {
                "eventType": "CaseClosed",
                "actorType": "System",
                "actorId": "risk-case-engine",
                "payload": {"finalStatus": status},
                "createdAt": now - timedelta(minutes=2),
            }
        )

    return timeline


def generate_risk_cases(
    patrons: list[dict[str, Any]],
    tables: list[dict[str, Any]],
    sessions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build patron_risk_cases for a subset (>=20 or 38%) of patrons."""
    sessions_by_patron = {s["patronId"]: s for s in sessions}
    table_ids = {t["tableId"] for t in tables}
    now = _now_utc()

    selected_patrons = _rand_elements(
        patrons, count=max(20, int(len(patrons) * 0.38))
    )

    status_weights = [
        ("AwaitingAdmin", 28),
        ("Assigned", 24),
        ("Rejected", 16),
        ("Approved", 14),
        ("InReview", 12),
        ("Draft", 6),
    ]

    cases: list[dict[str, Any]] = []
    for patron in selected_patrons:
        session = sessions_by_patron.get(patron["patronId"])
        loss_assessment = _build_loss_assessment(patron, session)
        financial_assessment = _build_financial_assessment(patron)
        risk_level = _derive_risk_level(loss_assessment, financial_assessment)
        escalation_tier = (
            "Senior"
            if risk_level == "Critical" or financial_assessment["sourceOfFundsRisk"] == "High"
            else "Standard"
        )

        status = _weighted_choice(status_weights)
        if status in ("Assigned", "Approved"):
            admin_decision: str | None = "Approve"
        elif status == "Rejected":
            admin_decision = "Reject"
        else:
            admin_decision = None

        created_at = _recent_date(14)
        updated_at = _between_dates(created_at, now)
        preferred_table = (
            session["tableId"]
            if session and session.get("tableId") in table_ids
            else _rand_element(tables)["tableId"]
        )
        timeline = _build_timeline(status, admin_decision)

        if status == "AwaitingAdmin":
            current_node = "await_admin_review"
        elif status == "Draft":
            current_node = "initialize_case"
        elif status == "InReview":
            current_node = "evaluate_financial_credit_aml"
        else:
            current_node = "finalize_case"

        analysis_run_id = (
            f"ANL-{_recent_date(14).date().isoformat()}-{_rand_int(1000, 9999)}"
        )

        admin_review = None
        if admin_decision:
            admin_review = {
                "adminUserId": _rand_element(["ADM-001", "ADM-002", "ADM-SENIOR-01"]),
                "adminDisplayName": fake.name(),
                "decision": admin_decision,
                "rationale": (
                    "Combined risk is within acceptable threshold with clear follow-up controls."
                    if admin_decision == "Approve"
                    else "Risk and financial indicators are not acceptable for patron outreach."
                ),
                "requestedActions": (
                    [] if admin_decision == "Approve" else ["Manual compliance review required"]
                ),
                "createdAt": _between_dates(created_at, updated_at),
            }

        cases.append(
            {
                "caseId": f"CASE-{_alphanumeric_upper(10)}",
                "patronId": patron["patronId"],
                "tableId": preferred_table,
                "analysisRunId": analysis_run_id,
                "status": status,
                "riskLevel": risk_level,
                "escalationTier": escalation_tier,
                "currentNode": current_node,
                "nodeStates": _build_node_states(status),
                "lossChasingAssessment": loss_assessment,
                "financialAssessment": financial_assessment,
                "adminReview": admin_review,
                "createdBy": _rand_element(["MKT-01", "MKT-02", "RISKOPS-01"]),
                "timeline": timeline,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

    cases.sort(key=lambda c: c["updatedAt"], reverse=True)
    return cases


def generate_pr_assignments(
    risk_cases: list[dict[str, Any]], pr_agents: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Build pr_assignments for approved / assigned cases."""
    active_agents = [a for a in pr_agents if a.get("active")]
    approved_cases = [c for c in risk_cases if c["status"] in ("Assigned", "Approved")]
    now = _now_utc()

    assignments: list[dict[str, Any]] = []
    for risk_case in approved_cases:
        pool = active_agents if active_agents else pr_agents
        agent = _rand_element(pool)
        assigned_at = _between_dates(risk_case["createdAt"], now)
        accepted = _bool(0.68)
        if accepted:
            status = _rand_element(["Accepted", "Completed"])
        else:
            status = "Assigned"

        accepted_at = (
            _between_dates(assigned_at, now)
            if status in ("Accepted", "Completed")
            else None
        )
        completed_at = _soon_date(2, assigned_at) if status == "Completed" else None

        assignments.append(
            {
                "assignmentId": f"ASG-{_alphanumeric_upper(10)}",
                "caseId": risk_case["caseId"],
                "patronId": risk_case["patronId"],
                "prAgentId": agent["prAgentId"],
                "fitScore": _rand_float(0.62, 0.98, 3),
                "status": status,
                "assignedAt": assigned_at,
                "acceptedAt": accepted_at,
                "completedAt": completed_at,
            }
        )
    return assignments


def generate_campaigns(
    offers: list[dict[str, Any]],
    patrons: list[dict[str, Any]],
    count: int = 3,
) -> list[dict[str, Any]]:
    """Build campaign_runs documents (kept for parity — seed.py does not insert)."""
    out: list[dict[str, Any]] = []
    for i in range(count):
        target_patrons = _rand_elements(
            [p["patronId"] for p in patrons], count=_rand_int(20, 80)
        )
        selected_offers = _rand_elements(
            [o["offerId"] for o in offers], count=_rand_int(1, 3)
        )
        start_at = _recent_date(3)
        out.append(
            {
                "campaignId": f"CMP-{str(i + 1).zfill(4)}",
                "name": _rand_element(
                    [
                        "Weekend VIP Reactivation",
                        "High Roller Night Push",
                        "Theater Bundle Upsell",
                    ]
                ),
                "goal": _rand_element(
                    ["Retention", "Upsell", "CrossSell", "Reactivation"]
                ),
                "segmentCriteria": [
                    "tier in [Gold, Platinum, Diamond]",
                    "adt >= 3000",
                    "active in past 7 days",
                ],
                "includedOfferIds": selected_offers,
                "targetPatronIds": target_patrons,
                "startAt": start_at,
                "endAt": _soon_date(10, start_at),
                "status": _rand_element(["Planned", "Running", "Completed"]),
                "metrics": {
                    "sent": len(target_patrons),
                    "accepted": _rand_int(0, int(len(target_patrons) * 0.45)),
                    "redemptionValue": _rand_int(10000, 200000),
                },
            }
        )
    return out


def generate_chat_data(
    patrons: list[dict[str, Any]], recommendation_count: int = 60
) -> dict[str, list[dict[str, Any]]]:
    """Build synthetic chat_sessions + chat_messages pairs (parity-only)."""
    sessions: list[dict[str, Any]] = []
    messages: list[dict[str, Any]] = []
    now = _now_utc()

    for _ in range(recommendation_count):
        session_id = _uuid()
        patron = _rand_element(patrons)
        started_at = _recent_date(2)
        sessions.append(
            {
                "sessionId": session_id,
                "channel": "WebAdmin",
                "marketingUserId": f"MKT-{_rand_int(1, 25)}",
                "patronContextIds": [patron["patronId"]],
                "startedAt": started_at,
                "lastMessageAt": _between_dates(started_at, now),
                "state": _rand_element(["Open", "Closed"]),
            }
        )

        user_prompt_id = _uuid()
        messages.append(
            {
                "sessionId": session_id,
                "messageId": user_prompt_id,
                "role": "user",
                "content": f"Summarize {patron['patronId']} and recommend next offer.",
                "model": "n/a",
                "agentName": "marketing_user",
                "references": [patron["patronId"]],
                "createdAt": started_at,
            }
        )

        messages.append(
            {
                "sessionId": session_id,
                "messageId": _uuid(),
                "role": "assistant",
                "content": (
                    "Patron is active on baccarat and table bet volume is high. "
                    "Recommend hotel+ticket bundle and host outreach."
                ),
                "model": "gpt-5.1-mini",
                "agentName": "offer_strategist_agent",
                "references": [patron["patronId"], user_prompt_id],
                "createdAt": _between_dates(started_at, now),
            }
        )
    return {"sessions": sessions, "messages": messages}


__all__ = [
    "generate_activities",
    "generate_campaigns",
    "generate_chat_data",
    "generate_offer_catalog",
    "generate_patrons",
    "generate_pr_agents",
    "generate_pr_assignments",
    "generate_recommendations",
    "generate_risk_cases",
    "generate_sessions",
    "generate_tables",
]
