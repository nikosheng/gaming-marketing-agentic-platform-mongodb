# ETL Integration Guide — Real-Time Heatmap Demo

**Platform:** Macau Gaming Marketing AI Console  
**MongoDB Database:** `casino_marketing_demo`  
**Integration Scope:** Phase 1 — Real-Time Table Heatmap

---

## Overview

The goal of this integration is to stream live seat-tracking and betting data from an external floor management or POS system into MongoDB. Once data lands in the target collection, the platform's heatmap automatically reflects the updated occupancy, patron counts, and average bet amounts on the next poll cycle (every 60 seconds).

No backend code changes are required. The heatmap reads directly from MongoDB at runtime.

---

## Target Collection

### `patron_table_sessions`

**Database:** `casino_marketing_demo`  
**Collection:** `patron_table_sessions`  
**Write pattern:** Upsert by `{ patronId, tableId }`

This is the **only collection** the ETL tool needs to write to for Phase 1. The heatmap aggregates live stats from this collection on every refresh.

---

## Document Schema

Each document represents one patron's active session at one table.

```json
{
  "patronId":             "P001",
  "tableId":              "T001",
  "seatedAt":             "2026-08-07T14:30:00.000Z",
  "lastActionAt":         "2026-08-07T15:02:45.000Z",
  "sessionBetAmount":     18500,
  "currentStackEstimate": 42000,
  "behaviorTags":         ["Aggressive"],
  "isActive":             true
}
```

---

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `patronId` | string | **Yes** | Patron identifier. Must match an existing document in `patron_profiles`. |
| `tableId` | string | **Yes** | Table identifier. Must match an existing document in `table_state_snapshots`. See [Valid Table IDs](#valid-table-ids). |
| `seatedAt` | datetime (ISO 8601, UTC) | **Yes** | Timestamp when the patron sat down at the table. |
| `lastActionAt` | datetime (ISO 8601, UTC) | **Yes** | Timestamp of the patron's most recent bet action. Update on every new bet event. |
| `sessionBetAmount` | float (HKD) | **Yes** | Cumulative total of all bets placed in this session. This is the source for `avgBetAmount` displayed on each heatmap card. |
| `currentStackEstimate` | float (HKD) | **Yes** | Current estimated chip stack value for this patron at this table. |
| `isActive` | boolean | **Yes** | `true` = patron is currently seated. `false` = patron has left the table. **Only `isActive: true` sessions are counted by the heatmap.** |
| `behaviorTags` | string[] | Optional | Behavioral signals observed for this patron in this session. See [Valid Behavior Tags](#valid-behavior-tags). |

---

## Write Pattern Details

### Patron sits down — INSERT or UPSERT

When a patron is seated at a table, insert a new document or upsert if a session for that `(patronId, tableId)` pair already exists:

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001" },
  {
    $set: {
      seatedAt:             ISODate("2026-08-07T14:30:00Z"),
      lastActionAt:         ISODate("2026-08-07T14:30:00Z"),
      sessionBetAmount:     0,
      currentStackEstimate: 50000,
      behaviorTags:         [],
      isActive:             true
    }
  },
  { upsert: true }
)
```

### Patron places a bet — UPDATE

Increment `sessionBetAmount` and update `lastActionAt` and `currentStackEstimate`:

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001", isActive: true },
  {
    $inc: { sessionBetAmount: 2000 },
    $set: {
      lastActionAt:         ISODate("2026-08-07T14:45:00Z"),
      currentStackEstimate: 48000
    }
  }
)
```

### Patron leaves the table — UPDATE

Set `isActive: false`. The patron immediately disappears from the heatmap on the next poll:

```js
db.patron_table_sessions.updateOne(
  { patronId: "P001", tableId: "T001" },
  {
    $set: {
      isActive:     false,
      lastActionAt: ISODate("2026-08-07T15:10:00Z")
    }
  }
)
```

---

## How the Heatmap Consumes This Data

The platform runs the following aggregation against `patron_table_sessions` on every heatmap refresh (every 60 seconds):

```js
db.patron_table_sessions.aggregate([
  { $match: { isActive: true } },
  {
    $group: {
      _id:           "$tableId",
      patronCount:   { $sum: 1 },
      avgBetAmount:  { $avg: "$sessionBetAmount" }
    }
  }
])
```

The result is merged with static table metadata from `table_state_snapshots`. The `occupancyRate` is computed as:

```
occupancyRate = min(1.0, patronCount / 9)
```

Max table capacity is **9 seats**. `occupancyRate` is capped at `1.0`.

---

## What Updates on the Dashboard

Each time new session data arrives and the heatmap polls:

| Dashboard Element | Driven By |
|---|---|
| Patron count badge on each table card | `patronCount` (count of active sessions per table) |
| Table card background color | `occupancyRate` — red tint ≥80%, amber tint ≥50%, navy <50% |
| Occupancy progress bar color and fill width | `occupancyRate` |
| "Occ." percentage in card footer | `occupancyRate` |
| **Total Patrons** stat tile | Sum of all `patronCount` across all tables |
| **Top 3 Tables** stat tile | Top 3 tables sorted by `patronCount` descending |
| **Hottest Zone** stat tile | Zone (`A`, `B`, `C`, or `VIP`) with the highest total patron count |

---

## Lookup References

### Valid Table IDs

Tables are stored in `table_state_snapshots`. The `tableId` values follow the pattern `T001` through `T030` (30 tables total). Query the collection directly to get the live list:

```js
db.table_state_snapshots.find({}, { tableId: 1, tableName: 1, zone: 1, gameType: 1, _id: 0 })
```

Example entries:

| `tableId` | `tableName` | `zone` | `gameType` |
|---|---|---|---|
| `T001` | Table 1 | `A` | Baccarat |
| `T008` | Table 8 | `VIP` | Blackjack |
| `T015` | Table 15 | `B` | Roulette |
| `T022` | Table 22 | `C` | SicBo |

Zones are always one of: **`A`**, **`B`**, **`C`**, **`VIP`**.

### Valid Patron IDs

Patrons are stored in `patron_profiles`. Query to get the live list:

```js
db.patron_profiles.find({}, { patronId: 1, maskedName: 1, tier: 1, adt: 1, _id: 0 })
```

Patron IDs follow the pattern `P001` through `P300` (300 patrons seeded by default).

### Valid Behavior Tags

| Tag | Meaning |
|---|---|
| `Aggressive` | High-volume, fast-paced betting |
| `Conservative` | Low-volume, cautious betting |
| `LateNight` | Active during late-night hours |
| `CardCounterWatch` | Under surveillance for card-counting suspicion |
| `PromoSeeker` | Frequently engages with promotions |

---

## Constraints & Validation

| Rule | Detail |
|---|---|
| One active session per patron-table pair | A patron can only have one `isActive: true` session per table at a time. Upsert by `{ patronId, tableId }`. |
| `patronId` must exist | The platform does not create patron profiles on the fly. Only upsert sessions for patron IDs that exist in `patron_profiles`. |
| `tableId` must exist | Only write sessions for table IDs that exist in `table_state_snapshots`. |
| `sessionBetAmount` is cumulative | This is the **running total** for the entire session, not the per-bet amount. Increment it with each new bet. |
| Datetime format | All datetime fields must be UTC ISO 8601 strings or BSON `Date` objects. |
| `isActive` drives visibility | A session with `isActive: false` is invisible to the heatmap. Always set this field explicitly. |

---

## Connection Details

| Parameter | Value |
|---|---|
| Host | `localhost:27017` (or as configured in your environment) |
| Database | `casino_marketing_demo` |
| Auth | None required for local Atlas deployment |
| Replica set | `rs0` (single-node replica set — required for Atlas Local vector search) |

MongoDB connection string:

```
mongodb://localhost:27017/casino_marketing_demo?replicaSet=rs0&directConnection=true
```

---

## End-to-End Demo Flow

1. ETL tool connects to MongoDB using the connection string above.
2. ETL streams floor events and upserts documents into `patron_table_sessions`.
3. Platform heatmap polls `GET /api/tables/heatmap` every 60 seconds (or on page load).
4. Heatmap aggregates live sessions, computes `patronCount`, `avgBetAmount`, and `occupancyRate` per table.
5. Dashboard renders updated table cards with occupancy-tinted backgrounds and refreshed Stats Bar tiles (Total Patrons, Top 3 Tables, Hottest Zone).

---

*Last updated: 2026-08-07*  
*Platform version: gaming-marketing-agentic-platform-mongodb*
