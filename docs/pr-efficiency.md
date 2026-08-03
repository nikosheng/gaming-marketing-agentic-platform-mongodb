# PR Efficiency — Technical Design

This document covers the complete technical design of the **PR Efficiency** feature: data model, embedding strategy, aggregation pipeline, KPI vector search, LLM insight generation, frontend UI, and demo data setup.

---

## Table of Contents

- [Purpose](#purpose)
- [Architecture](#architecture)
- [Data Model](#data-model)
  - [PatronInteractionRecord](#patroninteractionrecord)
  - [PrMetrics](#prmetrics)
  - [PrKpiResult](#prkpiresult)
  - [KpiSearchResult](#kpisearchresult)
- [MongoDB Collections & Indexes](#mongodb-collections--indexes)
- [Interaction Embedding](#interaction-embedding)
  - [Embedding Text Construction](#embedding-text-construction)
  - [Write Path](#write-path)
  - [Backfill Path](#backfill-path)
- [PR Metrics Aggregation](#pr-metrics-aggregation)
- [KPI Vector Search](#kpi-vector-search)
  - [Why Single Scan Instead of Per-PR Filter](#why-single-scan-instead-of-per-pr-filter)
  - [Pipeline Detail](#pipeline-detail)
  - [Scoring & Ranking](#scoring--ranking)
- [LLM Management Insight](#llm-management-insight)
- [API Routes](#api-routes)
- [Frontend UI](#frontend-ui)
  - [PR Metrics Grid](#pr-metrics-grid)
  - [KPI Search Panel](#kpi-search-panel)
  - [Results Display](#results-display)
- [Demo Data](#demo-data)
  - [Seed Script](#seed-script)
  - [PR Group Distribution](#pr-group-distribution)
  - [Backfill Script](#backfill-script)
- [File Reference](#file-reference)

---

## Purpose

PR Efficiency is a **management-layer analytics dashboard** that gives casino marketing managers two capabilities:

1. **Metrics Overview** — a card grid showing every PR agent's raw interaction statistics (total interactions, comp value, patrons served, tier distribution, last activity).

2. **KPI Vector Search** — management selects or types a KPI description (e.g. "為高Tier賭客安排免費房間") and the system uses semantic vector search to measure how well each PR agent's recorded interactions match that KPI. Results are ranked by achievement rate and accompanied by an LLM-generated management insight with concrete action recommendations.

The feature is deliberately **read-only from management's perspective** — it only analyses data that PR agents have already recorded via the Alert Dashboard interaction form or the Patron Detail page.

---

## Architecture

```
Management (browser)
  └── PR Efficiency section (dashboard-client.tsx)
       │
       ├── GET /api/pr-efficiency/metrics
       │    └── getPrMetrics(db)          ← MongoDB aggregation
       │         └── patron_interaction_history
       │
       └── POST /api/pr-efficiency/kpi-search  { kpiText }
            └── runKpiSearch(db, kpiText)  ← pr-efficiency-agent.ts
                 ├── generateEmbedding(kpiText, "query")  ← Voyage AI
                 ├── $vectorSearch on patron_interaction_history
                 │    └── index: interaction_embedding_idx (Atlas Vector Search)
                 ├── Application-layer grouping by recordedBy
                 ├── Per-PR: topMatchScore / matchedCount / kpiAchievementRate
                 └── generateKpiInsight()  ← Azure OpenAI

PR Agent (browser)
  └── Alert Card → [+ 記錄互動] or Patron Detail page
       └── POST /api/patrons/:patronId/interactions
            ├── insertOne → patron_interaction_history
            └── generateEmbedding(text, "document")  ← Voyage AI
                 └── interactionEmbedding stored in same document
```

---

## Data Model

### PatronInteractionRecord

Stored in `patron_interaction_history`. One document per PR interaction event.

```typescript
interface PatronInteractionRecord {
  interactionId:        string;        // "INT-{timestamp}-{patronId}-{random}"
  patronId:             string;        // links to patron_profiles
  type:                 InteractionType;
  detail:               InteractionDetail;  // type-specific fields (see below)
  totalValueHKD:        number;        // unified comp value for aggregation
  occurredAt:           Date;          // actual event time (can be back-filled)
  recordedBy:           string;        // prAgentId ("PR-0001") or "system"
  recordedAt:           Date;          // wall-clock time of DB insert
  linkedAlertId?:       string;        // optional link to patron_alerts
  patronTierAtTime?:    PatronTier;    // tier snapshot at time of interaction
  patronAdtAtTime?:     number;        // ADT snapshot at time of interaction
  interactionEmbedding?: number[];     // Voyage AI 1024-dim, set after backfill
}

type InteractionType =
  | "ROOM_COMP"     // Free room night
  | "FB_COMP"       // Restaurant / F&B voucher
  | "REBATE"        // Cash / chip rebate
  | "EVENT_INVITE"  // VIP event invitation
  | "OUTREACH"      // Phone / in-person / WeChat contact
  | "TRANSFER";     // Airport / hotel / venue transfer
```

**`detail` fields by type:**

| Type | Fields |
|---|---|
| `ROOM_COMP` | `roomType`, `roomNights`, `roomValue` |
| `FB_COMP` | `venue`, `fbAmount` |
| `REBATE` | `rebateRate` (decimal, e.g. 0.015), `rebateAmount` |
| `EVENT_INVITE` | `eventName`, `eventDate`, `attended` |
| `OUTREACH` | `channel` (Phone/In-Person/WeChat/WhatsApp), `outcome` (Positive/Neutral/No Answer/Declined), `notes` |
| `TRANSFER` | `transferType` (Airport/Hotel/Venue), `vehicleClass` (Standard/Luxury) |

---

### PrMetrics

Returned by `GET /api/pr-efficiency/metrics`. One object per PR agent.

```typescript
interface PrMetrics {
  prAgentId:          string;
  name:               string;
  active:             boolean;
  totalInteractions:  number;
  interactionsByType: Partial<Record<InteractionType, number>>;
  totalValueHKD:      number;
  uniquePatrons:      number;
  tierDistribution:   Partial<Record<PatronTier, number>>;
  lastInteractionAt?: Date;
}
```

---

### PrKpiResult

One result per PR agent in a KPI search response.

```typescript
interface PrKpiResult {
  prAgentId:           string;
  prName:              string;
  topMatchScore:       number;   // highest cosine similarity (0–1)
  matchedCount:        number;   // records with score ≥ 0.70
  totalInteractions:   number;   // all records for this PR
  kpiAchievementRate:  number;   // matchedCount / totalInteractions (0–1)
  matchedSamples:      Array<{   // top 3 matches by score
    type:        string;
    occurredAt:  string;
    score:       number;
  }>;
}
```

---

### KpiSearchResult

Top-level response from a KPI search.

```typescript
interface KpiSearchResult {
  kpiText:          string;
  results:          PrKpiResult[];  // sorted by kpiAchievementRate desc
  topPerformer?:    string;         // prAgentId of highest achiever
  bottomPerformer?: string;         // prAgentId of lowest achiever (with data)
  insight:          string;         // LLM-generated Chinese management analysis
  actions:          string[];       // LLM-generated action items (3 items)
  searchedAt:       Date;
}
```

---

## MongoDB Collections & Indexes

### `patron_interaction_history`

**Standard indexes:**

| Index | Fields | Options |
|---|---|---|
| Unique | `interactionId` | unique |
| Lookup by patron | `patronId + occurredAt` | descending occurredAt |
| Lookup by recorder | `recordedBy + occurredAt` | descending occurredAt |
| Lookup by type | `type + occurredAt` | descending occurredAt |

No TTL — interaction history is permanent.

**Vector Search index:**

| Index Name | Field | Dimensions | Similarity |
|---|---|---|---|
| `interaction_embedding_idx` | `interactionEmbedding` | 1024 | cosine |

Created via `createVectorIndexIfNeeded()` in `src/modeling/indexes.ts` on app startup. If the Voyage API key is absent, documents will have no `interactionEmbedding` field and the vector index will simply have no data to search — the metrics grid remains unaffected.

### `pr_kpi_searches` (reserved)

Indexes: `searchId` (unique), `searchedAt` (descending). Currently used for index registration only — KPI search results are not persisted (each search is fresh).

---

## Interaction Embedding

### Embedding Text Construction

The function `buildInteractionEmbeddingText()` in `src/web/embedding.ts` converts a `PatronInteractionRecord` into a semantically rich Chinese sentence. The text is engineered to be specific enough that a semantic query for a KPI like "為高Tier賭客安排免費房間" will produce a high cosine similarity with `ROOM_COMP` records for Platinum/Diamond patrons, and a lower similarity with `OUTREACH` or `REBATE` records.

Examples by type:

```
ROOM_COMP:
  "為 Platinum 等級賭客安排免費房間住宿，房型：Grand Suite，2晚，價值 HKD 14,000，日期 2026-06-15"

FB_COMP:
  "為 Gold 等級賭客安排餐飲優惠，餐廳：Dynasty Cantonese，價值 HKD 2,400，日期 2026-05-20"

REBATE:
  "為 Diamond 等級賭客提供現金或籌碼回贈，回贈率 1.5%，價值 HKD 18,000，日期 2026-07-01"

EVENT_INVITE:
  "邀請 Platinum 等級賭客參加VIP活動，活動名稱：8月 Diamond VIP 晚宴，已出席，日期 2026-08-02"

OUTREACH:
  "主動聯繫 Gold 等級賭客，渠道：WeChat，結果：Positive，備注：確認下月回訪計劃，日期 2026-06-28"

TRANSFER:
  "為 Diamond 等級賭客安排Airport接送服務，車型：Luxury，日期 2026-07-10"
```

### Write Path

When a PR agent submits the interaction form (`POST /api/patrons/:patronId/interactions`):

```
POST body received
  └── Validate required fields (type, totalValueHKD, occurredAt)
  └── Fetch patron tier + ADT snapshot from patron_profiles
  └── Build PatronInteractionRecord
  └── Call buildInteractionEmbeddingText()
  └── Call generateEmbedding(text, "document")  ← Voyage AI voyage-4
       ├── Success: record.interactionEmbedding = embedding
       └── Failure: record saved without embedding (graceful degradation)
  └── insertOne → patron_interaction_history
  └── Return 201 { ok: true, record }
```

The embedding call is **non-blocking to record creation** — a try/catch wraps the Voyage AI call and any failure only means the record is saved without `interactionEmbedding`.

### Backfill Path

`src/scripts/backfill-interaction-embeddings.ts` handles records that were created without embeddings (e.g. from `seed:interactions`):

```
Query: { interactionEmbedding: { $exists: false } }
  └── For each missing record:
       ├── buildInteractionEmbeddingText()
       ├── generateEmbedding(text, "document")
       ├── updateOne({ _id }, { $set: { interactionEmbedding } })
       └── sleep(21,000ms)  ← Voyage AI 3 RPM limit
```

Progress is logged to stdout as `[X/N] ✓ INT-... (ROOM_COMP)`.

---

## PR Metrics Aggregation

`getPrMetrics(db)` in `src/web/pr-efficiency-agent.ts` runs three parallel aggregation pipelines:

**Pipeline 1 — totals per PR:**
```javascript
db.patron_interaction_history.aggregate([
  { $group: {
    _id: "$recordedBy",
    totalInteractions: { $sum: 1 },
    totalValueHKD:     { $sum: "$totalValueHKD" },
    uniquePatrons:     { $addToSet: "$patronId" },
    lastInteractionAt: { $max: "$occurredAt" }
  }}
])
```

**Pipeline 2 — type breakdown per PR:**
```javascript
db.patron_interaction_history.aggregate([
  { $group: {
    _id: { recordedBy: "$recordedBy", type: "$type" },
    count: { $sum: 1 }
  }}
])
```

**Pipeline 3 — tier distribution per PR:**
```javascript
db.patron_interaction_history.aggregate([
  { $match: { patronTierAtTime: { $exists: true, $ne: null } } },
  { $group: {
    _id: { recordedBy: "$recordedBy", tier: "$patronTierAtTime" },
    count: { $sum: 1 }
  }}
])
```

Results are joined with `pr_agent_profiles` in application memory. Every PR agent appears in the output even if they have zero interactions — in that case all numeric fields are 0 and `lastInteractionAt` is undefined.

---

## KPI Vector Search

### Why Single Scan Instead of Per-PR Filter

MongoDB Atlas Vector Search supports a `filter` field for pre-filtering documents before ANN search. An alternative design would run one `$vectorSearch` per PR agent with `filter: { recordedBy: prAgentId }`.

**This approach was rejected** because:

- With N active PR agents, it requires N separate `$vectorSearch` executions → N network round-trips
- Each execution performs its own ANN index scan, so total work scales linearly with PR count
- A single scan with `limit: 300` covers all PRs in one index access and groups results in application memory
- Application-layer grouping is O(300) — negligible overhead compared to N index scans

The single-scan design holds as long as `limit` is large enough to include relevant records from every PR. With 24 agents × 20 records = 480 total and limit=300, the top-300 by semantic score will include meaningful coverage for all agents when searching a KPI that matches their interaction types.

### Pipeline Detail

```javascript
db.patron_interaction_history.aggregate([
  {
    $vectorSearch: {
      index:        "interaction_embedding_idx",
      path:         "interactionEmbedding",
      queryVector:  <1024-dim Voyage AI query embedding>,
      numCandidates: 600,   // ANN candidate pool
      limit:         300,   // top-N returned to application
    }
  },
  {
    $project: {
      _id:          0,
      interactionId: 1,
      patronId:     1,
      recordedBy:   1,
      type:         1,
      occurredAt:   1,
      score: { $meta: "vectorSearchScore" }
    }
  }
])
```

`numCandidates` is set to `2 × limit` (600) as a conservative tradeoff between recall and latency. For production use with larger datasets, this ratio can be tuned.

### Scoring & Ranking

After the vector search returns hits, `runKpiSearch()` groups them in application memory:

```typescript
const KPI_MATCH_THRESHOLD = 0.70;  // cosine similarity cutoff

// For each PR agent:
topMatchScore      = max(score) across all their hits in the result set
matchedCount       = count of their hits with score ≥ 0.70
kpiAchievementRate = matchedCount / totalInteractions (from separate count query)
matchedSamples     = top 3 hits sorted by score desc
```

PR agents are then sorted by `kpiAchievementRate` descending, with `topMatchScore` as a tiebreaker. Agents with zero total interactions are included but ranked last.

**Why 0.70 as the threshold?**

In practice, Voyage AI `voyage-4` cosine similarities between semantically related Chinese sentences (e.g. a ROOM_COMP interaction text vs. a query for "為高Tier賭客安排免費房間住宿") typically fall in the 0.72–0.92 range. Unrelated interactions (e.g. an OUTREACH record vs. the same room query) typically score 0.45–0.65. The 0.70 threshold separates these two populations reasonably well. After running `backfill:interactions`, you can inspect actual scores in the `matchedSamples` field.

---

## LLM Management Insight

After computing per-PR KPI results, `generateKpiInsight()` calls Azure OpenAI to produce a structured management analysis.

**System prompt:**
```
你是賭場行銷管理顧問，專責分析公關人員績效並給出管理建議。
請嚴格按指定 JSON 格式輸出。
```

**User prompt structure:**
```
KPI 目標: {kpiText}

各公關人員表現:
  {prName}（{prAgentId}）：共 {totalInteractions} 筆記錄，
  匹配 {matchedCount} 筆，達成率 {rate}%，最高相似度 {topScore}
  ...

輸出格式:
{
  "insight": "（2-3句整體分析）",
  "actions": ["（行動1）", "（行動2）", "（行動3）"]
}
```

**Parameters:**
- `max_completion_tokens: 400`
- `temperature: 0.4`
- `response_format: { type: "json_object" }`

**Fallback:** If Azure OpenAI is not configured or returns an error, a static fallback is returned: `{ insight: "資料不足，無法生成 AI 建議。", actions: ["請確保已記錄足夠的互動資料後再次搜尋。"] }`.

---

## API Routes

### `GET /api/pr-efficiency/metrics`

No query parameters. Returns aggregated statistics for all PR agents.

**Response:**
```json
{
  "ok": true,
  "metrics": [
    {
      "prAgentId": "PR-0001",
      "name": "Jacky Chan",
      "active": true,
      "totalInteractions": 15,
      "interactionsByType": { "ROOM_COMP": 6, "TRANSFER": 4, "FB_COMP": 2, "OUTREACH": 3 },
      "totalValueHKD": 88500,
      "uniquePatrons": 7,
      "tierDistribution": { "Diamond": 3, "Platinum": 4 },
      "lastInteractionAt": "2026-07-28T14:22:00.000Z"
    }
  ]
}
```

**Error:** 500 with `{ ok: false, error: "..." }`

---

### `POST /api/pr-efficiency/kpi-search`

**Body:** `{ "kpiText": "為高Tier賭客安排免費房間住宿" }`

**Precondition:** `VOYAGE_API_KEY` must be set. Returns 503 otherwise.

**Response:**
```json
{
  "ok": true,
  "result": {
    "kpiText": "為高Tier賭客安排免費房間住宿",
    "results": [
      {
        "prAgentId":          "PR-0001",
        "prName":             "Jacky Chan",
        "topMatchScore":      0.912,
        "matchedCount":       6,
        "totalInteractions":  15,
        "kpiAchievementRate": 0.400,
        "matchedSamples": [
          { "type": "ROOM_COMP", "occurredAt": "2026-06-15T00:00:00.000Z", "score": 0.912 },
          { "type": "ROOM_COMP", "occurredAt": "2026-05-22T00:00:00.000Z", "score": 0.887 },
          { "type": "ROOM_COMP", "occurredAt": "2026-04-10T00:00:00.000Z", "score": 0.871 }
        ]
      }
    ],
    "topPerformer":    "PR-0001",
    "bottomPerformer": "PR-0019",
    "insight":  "Jacky Chan 在房間安排 KPI 表現最佳（40%）...",
    "actions":  ["讓 Jacky 分享最佳實踐給其他公關", "..."],
    "searchedAt": "2026-08-03T10:15:00.000Z"
  }
}
```

---

## Frontend UI

The PR Efficiency section is rendered in `app/ui/dashboard-client.tsx` when `activeSection === "pr-efficiency"`. It is activated by the fifth nav button in the sidebar (bar-chart SVG icon).

Data is fetched via `useEffect` triggered on section activation — not on initial page load.

### PR Metrics Grid

```
.pr-metrics-grid  (CSS grid, auto-fill minmax 230px)
  └── .pr-metric-card  (one per PR agent)
       ├── .pr-metric-header
       │    ├── .pr-metric-avatar   (initials, gradient background)
       │    ├── .pr-metric-identity (name + prAgentId)
       │    └── .pr-inactive-badge  (shown if active === false)
       ├── .pr-metric-stats-row    (3 cells: total / patrons / value)
       ├── .pr-type-breakdown      (pill per InteractionType)
       ├── .pr-tier-row            (chip per PatronTier)
       └── .pr-last-active         (formatted date or "尚無互動記錄")
```

Inactive PR agents are rendered with `opacity: 0.55`.

### KPI Search Panel

```
KPI template chips  (.kpi-template-chips)
  └── .kpi-template-chip  (one per KPI_TEMPLATES entry, toggleable)

Free text input row  (.kpi-search-input-row)
  ├── .kpi-search-input   (text input, Enter triggers search)
  └── .kpi-search-btn     (disabled while searching or no input)

Active template display  (.kpi-active-template)
  └── shown when a template chip is selected
```

Template selection and custom text input are mutually exclusive — selecting a chip clears the text input and vice versa.

### Results Display

```
.kpi-results-section
  ├── .kpi-results-header   (title + query text + timestamp)
  ├── .kpi-results-table
  │    ├── .kpi-results-table-head  (4 columns)
  │    └── .kpi-results-row  (one per PR)
  │         ├── .kpi-pr-name        (with .kpi-badge-best / .kpi-badge-warn)
  │         ├── .kpi-match-count    ("8 / 15")
  │         ├── .kpi-achievement    (bar + percentage)
  │         │    ├── .kpi-achievement-bar-wrap
  │         │    │    └── .kpi-achievement-bar-fill  (width: X%)
  │         │    └── .kpi-achievement-pct
  │         └── .kpi-top-score
  ├── .kpi-samples-section  (shown if any PR has matched samples)
  └── .kpi-insight-panel    (LLM insight + action list)
       ├── .kpi-insight-title
       ├── .kpi-insight-text
       └── .kpi-action-list  (ul > li)
```

Row highlighting:
- `kpi-row-top` (green tint) — `prAgentId === topPerformer`
- `kpi-row-bottom` (red tint) — `prAgentId === bottomPerformer && totalInteractions > 0`

---

## Demo Data

### Seed Script

`src/seed/seed-interactions.ts` — run via `npm run seed:interactions`.

**What it does:**
- Reads live `pr_agent_profiles` and `patron_profiles` from MongoDB (no hardcoded IDs)
- Generates 8–20 interactions per PR agent (random, reproducible range via `MIN_PER_PR` / `MAX_PER_PR`)
- Scatters `occurredAt` randomly across the past 180 days (`HISTORY_DAYS`)
- Saves records **without** `interactionEmbedding` (that field is left for `backfill:interactions`)
- Is **additive** — does not clear or modify any existing collection

Patron selection is biased toward the PR's `preferredTiers` (70% chance of picking a patron from a preferred tier, 30% from any tier). This ensures the tier distribution in the Metrics grid reflects each PR's typical patron profile.

Supports `--dry-run` flag: `npm run seed:interactions:dry` prints a JSON summary of counts by PR and interaction type without writing to the database.

### PR Group Distribution

The 24 PR agents (sorted by `prAgentId`) are divided into 4 equal groups. Each group has a predefined interaction type weight table:

**Group A — Hosting specialists (PRs 1–6):**
```
ROOM_COMP:    40%
TRANSFER:     30%
FB_COMP:      10%
OUTREACH:     10%
EVENT_INVITE:  5%
REBATE:        5%
```

**Group B — Retention specialists (PRs 7–12):**
```
OUTREACH:     40%
EVENT_INVITE: 30%
FB_COMP:      10%
TRANSFER:     10%
ROOM_COMP:     5%
REBATE:        5%
```

**Group C — Reward specialists (PRs 13–18):**
```
REBATE:       35%
FB_COMP:      30%
OUTREACH:     15%
EVENT_INVITE: 10%
ROOM_COMP:     5%
TRANSFER:      5%
```

**Group D — Generalists (PRs 19–24):**
```
All 6 types:  ~17% each
```

This distribution is designed to create clear differentiation when KPI vector search is run:

| KPI template | Expected top group | Expected bottom group |
|---|---|---|
| 高Tier賭客房間安排 | Group A | Group C / B |
| 電話/主動聯繫 | Group B | Group A |
| 籌碼/現金回贈 | Group C | Group A |
| VIP活動邀請 | Group B | Group A |
| 機場/酒店接送 | Group A | Group C |
| 餐飲優惠安排 | Group C | Group A |

Group D (generalists) should consistently produce moderate scores across all KPIs.

### Backfill Script

`src/scripts/backfill-interaction-embeddings.ts` — run via `npm run backfill:interactions`.

- Queries `{ interactionEmbedding: { $exists: false } }` to find records needing backfill
- Processes one record at a time with a 21-second sleep between calls (Voyage AI 3 RPM)
- Estimated time: `N × 21s` (e.g. 341 records ≈ 119 minutes)
- Prints progress: `[X/N] ✓ INT-... (ROOM_COMP)` or `[X/N] ✗ INT-... — error message`
- Idempotent — safe to re-run if interrupted

After backfill completes, the Atlas Vector Search index `interaction_embedding_idx` automatically indexes the new vectors. KPI search results will be available within seconds of the index sync.

---

## File Reference

| File | Role |
|---|---|
| `src/types.ts` | `InteractionType`, `PatronInteractionRecord`, `PrMetrics`, `PrKpiResult`, `KpiSearchResult` type definitions |
| `src/web/embedding.ts` | `generateEmbedding()` (Voyage AI wrapper) + `buildInteractionEmbeddingText()` |
| `src/web/pr-efficiency-agent.ts` | `getPrMetrics()` (aggregation) + `runKpiSearch()` (vector search + LLM) |
| `src/web/collections.ts` | `patronInteractions: "patron_interaction_history"`, `prKpiSearches: "pr_kpi_searches"` |
| `src/modeling/indexes.ts` | `interaction_embedding_idx` vector index definition + `pr_kpi_searches` standard indexes |
| `app/api/pr-efficiency/metrics/route.ts` | `GET /api/pr-efficiency/metrics` |
| `app/api/pr-efficiency/kpi-search/route.ts` | `POST /api/pr-efficiency/kpi-search` |
| `app/api/patrons/[patronId]/interactions/route.ts` | Interaction CRUD — `GET` (list) + `POST` (create with embedding) |
| `app/ui/dashboard-client.tsx` | PR Efficiency section JSX, KPI template definitions, state management |
| `app/globals.css` | All PR Efficiency CSS (`.pr-metrics-grid`, `.kpi-*`, `.pr-metric-*`) |
| `src/seed/seed-interactions.ts` | Demo data generator (`npm run seed:interactions`) |
| `src/scripts/backfill-interaction-embeddings.ts` | Embedding backfill script (`npm run backfill:interactions`) |
