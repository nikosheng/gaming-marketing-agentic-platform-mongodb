# ETL Integration Guide - Real-Time Heatmap + Patron Risk Review

Platform: Macau Gaming Marketing AI Console
Database: `casino_marketing_demo`
Audience: Third-party ETL / floor-system vendor
Scope: Vendor writes both profile master data and live table sessions

---

## 1. Integration Goal

You need to stream two data domains into MongoDB:

1. Patron master profile data (`patron_profiles`)
2. Live in-seat session data (`patron_table_sessions`)

Why both are required:

1. `patron_table_sessions` drives heatmap occupancy and table live metrics.
2. `patron_profiles` is required by Patron Risk Review scoring (ADT, risk flags, points, tier, game preferences).

Without `patron_profiles`, risk review can fail (`Patron not found`) or produce low-quality scoring.

---

## 2. Collections You Must Write

### 2.1 `patron_profiles` (master)

Write mode: UPSERT by `{ patronId }`

Purpose:

1. Patron identity and tier context
2. Risk-review input fields
3. Drill-down rendering fields

### 2.2 `patron_table_sessions` (realtime)

Write mode: UPSERT by `{ patronId, tableId }`

Purpose:

1. Heatmap occupancy
2. Active table patrons
3. Loss-chasing signal input

---

## 3. Required Data Contract

## 3.1 `patron_profiles` document contract

Recommended minimum payload for production integration:

```json
{
  "patronId": "P001",
  "name": "Alex Chan",
  "maskedName": "A***01",
  "tier": "Gold",
  "adt": 8500,
  "preferredGames": ["Baccarat", "Roulette"],
  "riskFlags": ["PromoSensitive"],
  "pointsBalance": 22000,
  "lastActiveAt": "2026-08-14T09:20:00.000Z",
  "region": "HongKong",
  "activities": [],
  "preferenceEmbedding": [],
  "createdAt": "2026-08-14T09:20:00.000Z",
  "updatedAt": "2026-08-14T09:20:00.000Z"
}
```

Field notes (for risk review):

1. `patronId` (required): must be unique and stable.
2. `tier` (required): `Bronze|Silver|Gold|Platinum|Diamond`.
3. `adt` (required): numeric ADT in HKD.
4. `pointsBalance` (required): numeric loyalty points balance.
5. `riskFlags` (required): list, can be empty. Common values: `HighVariance`, `FrequentCashout`, `PromoSensitive`.
6. `preferredGames` (required): list, can be empty.
7. `maskedName`, `region`, `lastActiveAt` strongly recommended for UI quality.

## 3.2 `patron_table_sessions` document contract

```json
{
  "patronId": "P001",
  "tableId": "T001",
  "seatedAt": "2026-08-14T09:20:00.000Z",
  "lastActionAt": "2026-08-14T09:31:00.000Z",
  "sessionBetAmount": 18500,
  "currentStackEstimate": 42000,
  "behaviorTags": ["Aggressive"],
  "isActive": true
}
```

Field notes:

1. `sessionBetAmount` is cumulative (running total), not per-bet amount.
2. `isActive: true` means visible in heatmap.
3. `behaviorTags` is optional but recommended for loss-chasing signal quality.

---

## 4. Write Patterns

## 4.1 Profile master upsert (daily or on change)

```js
db.patron_profiles.updateOne(
  { patronId: "P001" },
  {
    $set: {
      name: "Alex Chan",
      maskedName: "A***01",
      tier: "Gold",
      adt: 8500,
      preferredGames: ["Baccarat", "Roulette"],
      riskFlags: ["PromoSensitive"],
      pointsBalance: 22000,
      lastActiveAt: ISODate("2026-08-14T09:20:00Z"),
      region: "HongKong",
      activities: [],
      preferenceEmbedding: [],
      updatedAt: ISODate("2026-08-14T09:20:00Z")
    },
    $setOnInsert: {
      createdAt: ISODate("2026-08-14T09:20:00Z")
    }
  },
  { upsert: true }
)
```

## 4.2 Patron sits down (session upsert)

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001" },
  {
    $set: {
      seatedAt: ISODate("2026-08-14T09:20:00Z"),
      lastActionAt: ISODate("2026-08-14T09:20:00Z"),
      sessionBetAmount: 0,
      currentStackEstimate: 50000,
      behaviorTags: [],
      isActive: true
    }
  },
  { upsert: true }
)
```

## 4.3 Patron bet update (incremental)

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001", isActive: true },
  {
    $inc: { sessionBetAmount: 2000 },
    $set: {
      lastActionAt: ISODate("2026-08-14T09:31:00Z"),
      currentStackEstimate: 48000
    }
  }
)
```

## 4.4 Patron leaves table

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001" },
  {
    $set: {
      isActive: false,
      lastActionAt: ISODate("2026-08-14T10:05:00Z")
    }
  }
)
```

---

## 5. Mock Data Generation (for vendor integration)

Use this when vendor has no live feed yet.

## 5.1 Mock generation principles

1. Generate profile first, then sessions.
2. `patron_table_sessions.patronId` must exist in `patron_profiles`.
3. Keep ranges realistic:
- ADT: 800 to 35000
- pointsBalance: 200 to 120000
- sessionBetAmount: 300 to 50000

## 5.2 Values Vendor Must Provide

Vendor can use any ETL or scripting tool. Only two collections need vendor input: `patron_profiles` and `patron_table_sessions`.

`table_state_snapshots` is platform-managed and pre-provisioned. Vendor does not need to prepare or update that collection.

### A. `patron_profiles` value pools

For each profile row, provide:

1. `tier`: `Bronze`, `Silver`, `Gold`, `Platinum`, `Diamond`.
2. `region`: `Macau`, `HongKong`, `Guangdong`, `OtherGBA`, `Taiwan`, `International`.
3. `preferredGames`: choose 1 to 3 from `Baccarat`, `Blackjack`, `Roulette`, `SicBo`, `Poker`.
4. `riskFlags`: choose 0 to 2 from `HighVariance`, `FrequentCashout`, `PromoSensitive`.
5. `adt` range: 800 to 35000.
6. `pointsBalance` range: 200 to 120000.
7. `lastActiveAt`, `createdAt`, `updatedAt`: valid ISO datetime.

### B. `patron_table_sessions` value pools

For each active session row, provide:

1. `patronId`: must exist in `patron_profiles`.
2. `tableId`: must use a valid platform-provisioned table ID (for example `T-0001`).
3. `sessionBetAmount` range: 300 to 65000.
4. `currentStackEstimate` range: 0.8x to 5.0x of `sessionBetAmount`.
5. `behaviorTags`: choose 0 to 3 from `Aggressive`, `Conservative`, `LateNight`, `CardCounterWatch`, `PromoSeeker`.
6. `isActive`: `true` for in-seat patrons shown on heatmap.
7. `seatedAt`, `lastActionAt`: valid ISO datetime.


---

## 6. Vendor Runtime Cadence

Recommended ETL schedule:

1. `patron_profiles`: full sync every 15 to 60 minutes, plus CDC/on-change upsert.
2. `patron_table_sessions`: near real-time event upsert (1 to 5 seconds latency target).

---

## 7. Pre-Go-Live Validation Checklist

## 7.1 Referential checks

```js
// sessions whose patronId does not exist in patron_profiles

db.patron_table_sessions.aggregate([
  { $match: { isActive: true } },
  {
    $lookup: {
      from: "patron_profiles",
      localField: "patronId",
      foreignField: "patronId",
      as: "p"
    }
  },
  { $match: { p: { $size: 0 } } },
  { $project: { _id: 0, patronId: 1, tableId: 1 } }
])
```

Expected: zero rows.

## 7.2 Required profile fields check

```js
db.patron_profiles.find(
  {
    $or: [
      { adt: { $exists: false } },
      { tier: { $exists: false } },
      { pointsBalance: { $exists: false } },
      { riskFlags: { $exists: false } },
      { preferredGames: { $exists: false } }
    ]
  },
  { _id: 0, patronId: 1, tier: 1, adt: 1, pointsBalance: 1, riskFlags: 1, preferredGames: 1 }
)
```

Expected: zero rows.

## 7.3 Heatmap sanity check

```js
db.patron_table_sessions.aggregate([
  { $match: { isActive: true } },
  {
    $group: {
      _id: "$tableId",
      patronCount: { $sum: 1 },
      avgBetAmount: { $avg: "$sessionBetAmount" }
    }
  },
  { $sort: { patronCount: -1 } },
  { $limit: 5 }
])
```

Expected: top tables align with dashboard cards.

---

## 8. Risk Review Data Dependency (Important)

Patron Risk Review reads the following inputs:

1. From `patron_profiles`:
- `tier`
- `adt`
- `pointsBalance`
- `riskFlags`
- `preferredGames`

2. From `patron_table_sessions` (active row by `patronId + tableId`):
- `sessionBetAmount`
- `behaviorTags`

If session is missing, risk flow still runs with fallback defaults (`sessionBetAmount=0`, `behaviorTags=[]`), but quality is lower.
If profile is missing, risk case creation fails.

---

## 9. What Updates on the Dashboard

Each time new active-session data arrives and the heatmap polls:

| Dashboard Element | Driven By |
|---|---|
| Patron count badge on each table card | `patronCount` (count of active sessions per table) |
| Table card background color | `occupancyRate` — red tint >=80%, amber tint >=50%, navy <50% |
| Occupancy progress bar color and fill width | `occupancyRate` |
| "Occ." percentage in card footer | `occupancyRate` |
| Total Patrons stat tile | Sum of all `patronCount` across all tables |
| Top 3 Tables stat tile | Top 3 tables sorted by `patronCount` descending |
| Hottest Zone stat tile | Zone (`A`, `B`, `C`, or `VIP`) with highest total patron count |

---

## 10. End-to-End UAT Flow for Vendor

1. Sync 100+ records into `patron_profiles`.
2. Upsert active rows into `patron_table_sessions`.
3. Open dashboard and confirm heatmap changes within one polling cycle (~5s).
4. Trigger Patron Risk Review from any active patron.
5. Confirm case includes Loss/AML scores and AI/Policy blocks.
6. Submit Approve/Reject/RequestMoreInfo to validate lifecycle.

---

Last updated: 2026-08-14
Platform version: gaming-marketing-agentic-platform-mongodb
