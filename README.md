# Macau Gaming Marketing AI Platform

A full-stack Management Console for casino marketing operations, built with Next.js, MongoDB Atlas, Voyage AI, and Azure OpenAI. The platform combines real-time table monitoring, AI-driven patron analysis, alert automation, and PR performance management into a single operator interface.

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Install & Run](#install--run)
- [Console Sections](#console-sections)
  - [Patron Eyes](#1-patron-eyes)
  - [Offer Catalog](#2-offer-catalog)
  - [Patron Insight](#3-patron-insight)
  - [Alert Dashboard](#4-alert-dashboard)
  - [PR Efficiency](#5-pr-efficiency)
- [API Reference](#api-reference)
- [MongoDB Collections](#mongodb-collections)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Scripts](#scripts)

---

## Features

| Feature | Description |
|---|---|
| Live Table Heatmap | Real-time occupancy, avg bet, min-bet across all tables, auto-refreshes every 60s |
| Min-Bet Optimizer | AI-driven min-bet recommendation engine with audit trail |
| Patron Eyes | Per-table patron drill-down with loss-potential scoring |
| Offer Catalog | AI agent generates offers from natural language; vector similarity matching |
| Patron Insight | Risk case workflow with LangGraph agent, AML assessment, PR assignment |
| Alert Dashboard | NL → LLM → condition rules; simulate betting rounds; AI alert rationale |
| Patron History Analysis | Per-patron interaction history with AI-generated sales recommendations |
| **PR Efficiency** | PR interaction metrics dashboard + KPI vector search + LLM management insight |

---

## Architecture Overview

```
Browser (Next.js App Router)
  └── Management Console (dashboard-client.tsx)
       ├── Patron Eyes        → /api/tables/*
       ├── Offer Catalog      → /api/offers/*
       ├── Patron Insight     → /api/patrons/*/risk-case
       ├── Alert Dashboard    → /api/alert-rules, /api/alerts/*
       │    └── Alert Card
       │         ├── [分析賭客]   → /api/alerts/[alertId]/analyze-patron
       │         └── [記錄互動]   → /api/patrons/[patronId]/interactions
       └── PR Efficiency      → /api/pr-efficiency/*

Patron Detail Page (/patron-detail/[patronId])
  ├── Interaction History timeline
  ├── Add interaction form
  └── Analysis reports (Acknowledged / Actioned)

Server-side Agents (src/web/)
  ├── alert-rule-agent.ts        — NL → condition catalog (Azure OpenAI)
  ├── alert-analyzer.ts          — MQL executors + LLM rationale
  ├── patron-profile-agent.ts    — Patron history LLM analysis
  ├── pr-efficiency-agent.ts     — PR metrics aggregation + KPI vector search
  ├── embedding.ts               — Shared Voyage AI embedding (document / query)
  ├── minbet-optimizer-agent.ts  — Min-bet recommendation
  ├── offer-agent.ts             — Offer generation (LangGraph)
  └── risk-case-agent.ts         — Risk workflow (LangGraph)

MongoDB Atlas
  ├── Standard indexes (unique, compound, TTL)
  └── Vector Search indexes
       ├── patron_preference_vector_idx  (patron_profiles.preferenceEmbedding)
       ├── offer_vector_idx              (offer_catalog.offerEmbedding)
       └── interaction_embedding_idx     (patron_interaction_history.interactionEmbedding)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router) · React · TypeScript |
| Database | MongoDB Atlas (`mongodb` native driver) |
| Vector Search | MongoDB Atlas Vector Search (cosine, 1024-dim) |
| Embeddings | Voyage AI `voyage-4` (document + query modes) |
| LLM | Azure OpenAI `gpt-5.4-mini-2` (`max_completion_tokens`, `response_format: json_object`) |
| Agent Framework | LangGraph (`@langchain/langgraph`) |
| Runtime | Node.js 20+ |

---

## Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `MONGODB_DB` | No | Database name (default: `casino_marketing_demo`) |
| `AZURE_OPENAI_ENDPOINT` | Yes* | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_KEY` | Yes* | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | No | Deployment name (default: `gpt-4o-mini`) |
| `AZURE_OPENAI_API_VERSION` | No | API version (default: `2024-08-01-preview`) |
| `VOYAGE_API_KEY` | Yes** | Voyage AI API key for embeddings |
| `VECTOR_EMBEDDING_DIM` | No | Embedding dimension (default: `1024`) |
| `SEED_PATRON_COUNT` | No | Number of patrons to seed (default: `300`) |
| `SEED_TABLE_COUNT` | No | Number of tables to seed (default: `30`) |

\* Required for Alert Dashboard AI rationale, Patron Analysis, and PR Efficiency KPI insight.  
\*\* Required for PR Efficiency KPI vector search and interaction embedding generation.

---

## Install & Run

```bash
npm install

# Seed demo data (clear + reload all collections)
npm run seed

# Backfill Voyage embeddings for existing offers + patron profiles
npm run backfill

# Start development server
npm run dev

# Production build
npm run build && npm run start
```

---

## Console Sections

### 1. Patron Eyes

Real-time table monitoring dashboard.

- **Heatmap** — all tables with occupancy rate, avg bet, min-bet, and status (colour-coded by occupancy level)
- **Drill-down drawer** — click any table card to open a detailed panel with:
  - Active patron list (masked names, tier, ADT, session bet, stack estimate, behavior tags)
  - AI loss-potential analysis (High / Medium / Low scoring per patron)
  - Vector-matched offer suggestions per patron
  - Min-bet optimization panel (AI recommends, operator applies / rejects, audit logged)
  - Simulate Round — injects deterministic test patrons and triggers alert analysis
  - Risk workflow trigger — opens a modal with LangGraph-driven loss-chasing + AML assessment

### 2. Offer Catalog

Offer inventory and recommendation management.

- Browse all offers with status filter (Proposed / Draft / Active / Expired / Rejected)
- AI agent chat — describe offer criteria in natural language → agent generates a structured offer with matched patron count and segment breakdown
- Approve / Reject with rationale; approval decisions logged to `offer_approval_audit`
- Recommendations feed with status tracking (Proposed → Approved → Sent → Accepted)

### 3. Patron Insight

Patron-level risk investigation and PR assignment.

- Trigger a risk case for any patron from the Patron Eyes drill-down
- LangGraph workflow runs two parallel agent nodes:
  - **Loss Chasing Agent** — scores session intensity, ADT signal, and behavior tags
  - **Financial / AML Agent** — AML risk score, credit band, source-of-funds checklist
- Risk escalation router (Standard / Senior tier) based on combined scores
- Admin decision panel (Approve / Reject / Request More Info)
- Automatic PR assignment on approval, logged to `pr_assignments`

### 4. Alert Dashboard

High-value patron detection via natural language rules and round simulation.

**Alert Rules**

- Define rules in natural language (e.g. "Alert me when a Gold or above patron bets over HKD 10,000 for 3 consecutive rounds")
- LLM maps the description to one or more typed conditions from a fixed catalog:
  - `CONSECUTIVE_ROUNDS_BET_THRESHOLD`
  - `CUMULATIVE_ROUNDS_BET_THRESHOLD`
  - `SINGLE_ROUND_ADT_MULTIPLIER`
  - `SESSION_BET_ABOVE`
  - `TIER_MATCH`
  - `BEHAVIOR_TAG_MATCH`
- 2-step preview → confirm flow; OR logic for multi-condition rules
- Toggle rules Active / Paused without deletion

**Alert Feed**

Each alert card shows triggered conditions, evidence, ADT, behavior tags, and an AI-generated service rationale (≤50 chars, Chinese).

Alert card actions:
- **Resolve** — clears all alerts for the patron so they can be re-triggered fresh
- **+ 記錄互動** — inline form to log a PR interaction (room comp, F&B, rebate, outreach, etc.) directly from the alert
- **分析賭客** — calls the Patron Profile Agent to analyze interaction history and generate next-action recommendations (see below)

**Patron Profile Analysis** (triggered from Alert Card)

When "分析賭客" is clicked:
1. Fetches the patron's most recent 20 interaction records from `patron_interaction_history`
2. Fetches the patron's profile, the triggering alert, and the top 5 active PR agents
3. Calls Azure OpenAI to generate a structured JSON report (繁體中文):
   - `profileSummary` — tier, ADT, preferred games, visit pattern
   - `interactionHistory` — bullet-point summary of past comps and their value
   - `behaviorPattern` — betting rhythm, revisit frequency
   - `riskAssessment` — commercial opportunity or risk flag
   - `recommendations` — 2–3 prioritised next actions with urgency and estimated revenue impact
   - `suggestedPrId` — recommended PR agent from the available list
4. Result expands inline within the Alert Card
5. A "查看完整 Patron Detail →" link opens the Patron Detail page in a new tab

**Patron Detail Page** (`/patron-detail/[patronId]`)

Standalone page for management review:
- Left column: basic profile (tier, ADT, games, risk flags, points) + full interaction timeline + add-interaction form
- Right column: all AI analysis reports, each with status controls (Draft → Acknowledged → Actioned)

### 5. PR Efficiency

Management-layer dashboard for evaluating PR agent performance using interaction data and KPI vector search.

#### PR Metrics Overview

Aggregated statistics for every PR agent, loaded on section activation:

| Metric | Source |
|---|---|
| Total interactions | Count of records in `patron_interaction_history` by `recordedBy` |
| Interaction type breakdown | Count per `InteractionType` (Room / F&B / Rebate / Event / Outreach / Transfer) |
| Total comp value (HKD) | Sum of `totalValueHKD` |
| Unique patrons served | Count of distinct `patronId` values |
| Tier distribution | Breakdown by `patronTierAtTime` (Diamond / Platinum / Gold / …) |
| Last activity date | Max `occurredAt` |

Displayed as card grid — one card per PR agent, inactive agents visually dimmed.

#### KPI Vector Search

Management selects a KPI from pre-defined templates or enters free text:

| Template | Embedded description |
|---|---|
| 高Tier賭客房間安排 | 為 Platinum 或 Diamond 等級賭客安排免費房間住宿 |
| 電話/主動聯繫 | 主動致電或親身接觸賭客，確認回訪意願或維繫關係 |
| 籌碼/現金回贈 | 為高額下注賭客安排現金或籌碼回贈優惠 |
| VIP活動邀請 | 邀請賭客參加 VIP 晚宴或專屬活動 |
| 機場/酒店接送 | 安排豪華車輛為賭客提供機場或酒店接送服務 |
| 餐飲優惠安排 | 為賭客安排餐廳用餐或食品飲料優惠 |

**Search pipeline:**

```
KPI text (free text or template)
  → Voyage AI voyage-4 query embedding (1024-dim)
  → $vectorSearch on patron_interaction_history
      index: interaction_embedding_idx
      limit: 300, numCandidates: 600
      (no filter — single scan covers all PRs)
  → Application-layer grouping by recordedBy
  → Per-PR metrics:
      topMatchScore      — highest cosine similarity found
      matchedCount       — records with score ≥ 0.70
      kpiAchievementRate — matchedCount / totalInteractions
      matchedSamples     — top 3 matching records (type + date + score)
  → Sort by kpiAchievementRate desc
  → Azure OpenAI LLM → JSON management insight (繁體中文):
      insight  — 2-3 sentences comparing PRs, naming best and weakest
      actions  — 3 concrete management action items
```

**Results display:**

- Ranked table: PR name · matched/total · achievement rate bar · top similarity score
- Best performer badge (最佳) · needs-improvement badge (需改善)
- High-match sample interactions per PR
- AI management insight panel with action checklist

#### Interaction Embedding

Every interaction record written via `POST /api/patrons/[patronId]/interactions` automatically generates a Voyage AI `document` embedding from a structured Chinese description of the interaction. This embedding is stored in `interactionEmbedding` and indexed by the Atlas Vector Search index `interaction_embedding_idx`.

Example embedding text generated for a ROOM_COMP record:
```
為 Platinum 等級賭客安排免費房間住宿，房型：Superior Suite，2晚，價值 HKD 12,000，日期 2026-07-01
```

If the Voyage API key is missing or the API call fails, the record is still saved without an embedding (graceful degradation).

---

## API Reference

### Tables

| Method | Path | Description |
|---|---|---|
| GET | `/api/tables/heatmap` | All tables with occupancy metrics |
| GET | `/api/tables/:tableId/patrons` | Active patrons on a table |
| POST | `/api/tables/:tableId/analyze` | AI loss-potential analysis for table |
| POST | `/api/tables/:tableId/optimize-minbet` | Generate min-bet recommendation |
| GET | `/api/tables/:tableId/minbet-recommendations` | Recommendation history |
| POST | `/api/tables/:tableId/minbet-recommendations/:recId/apply` | Apply a recommendation |
| POST | `/api/tables/:tableId/minbet-recommendations/:recId/reject` | Reject a recommendation |
| POST | `/api/tables/:tableId/simulate-round` | Inject test patrons and run alert analysis |
| POST | `/api/tables/:tableId/simulate-sessions` | Simulate multiple patron sessions |

### Offers

| Method | Path | Description |
|---|---|---|
| GET | `/api/offers/dashboard` | Offers, recommendations, recent activities |
| POST | `/api/offers/generate` | Generate offers by patronId (vector similarity) |
| POST | `/api/offers/agent-chat` | NL → structured offer via LangGraph agent |
| POST | `/api/offers/:offerId/approve` | Approve an offer |
| POST | `/api/offers/:offerId/reject` | Reject an offer with rationale |

### Alert Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/alert-rules` | List all rules (auto-seeds 3 templates on first call) |
| POST | `/api/alert-rules` | Preview or confirm a new NL rule |
| PATCH | `/api/alert-rules/:ruleId` | Toggle Active / Paused |
| GET | `/api/alerts` | Alert feed with stats (total, new, by-rule) |
| DELETE | `/api/alerts/:alertId` | Resolve — deletes all alerts for the patron |
| POST | `/api/alerts/:alertId/analyze-patron` | Trigger patron history LLM analysis (cached per alertId) |

### Patron Interactions & Analysis

| Method | Path | Description |
|---|---|---|
| GET | `/api/patrons/:patronId/interactions` | Most recent 50 interaction records |
| POST | `/api/patrons/:patronId/interactions` | Create interaction record (generates embedding) |
| GET | `/api/patrons/:patronId/analysis-reports` | All AI analysis reports, newest first |
| PATCH | `/api/analysis-reports/:reportId/status` | Update report status (Acknowledged / Actioned) |

### Risk Cases

| Method | Path | Description |
|---|---|---|
| POST | `/api/patrons/:patronId/risk-case` | Start a new risk workflow |
| GET | `/api/patrons/:patronId/risk-case/latest` | Fetch latest risk case |
| POST | `/api/risk-cases/:caseId/admin-decision` | Submit admin decision |

### PR Efficiency

| Method | Path | Description |
|---|---|---|
| GET | `/api/pr-efficiency/metrics` | Aggregated interaction stats for all PR agents |
| POST | `/api/pr-efficiency/kpi-search` | Body: `{ "kpiText": "..." }` — vector search + LLM insight |

---

## MongoDB Collections

| Collection | Purpose | TTL |
|---|---|---|
| `patron_profiles` | Patron master data with preference embedding | — |
| `table_state_snapshots` | Current table state | — |
| `patron_table_sessions` | Active session tracking | — |
| `offer_catalog` | Offer inventory with offer embedding | — |
| `offer_recommendations` | Patron-offer matches | — |
| `offer_approval_audit` | Offer decision audit trail | — |
| `patron_risk_cases` | Risk workflow state (LangGraph) | — |
| `pr_agent_profiles` | PR agent profiles | — |
| `pr_assignments` | PR-to-patron assignments | — |
| `campaign_runs` | Campaign definitions and metrics | — |
| `chat_sessions` | Agent chat sessions | — |
| `chat_messages` | Agent chat messages | — |
| `table_state_history` | Historical table snapshots | 7 days |
| `table_minbet_recommendations` | Min-bet recommendations | — |
| `table_minbet_audit` | Min-bet change audit trail | — |
| `alert_rules` | NL-defined alert rules | — |
| `patron_alerts` | Triggered alerts with evidence | 30 days |
| `table_round_history` | Per-round betting snapshots | 7 days |
| `table_round_counters` | Round number counters per table | — |
| `patron_interaction_history` | PR interaction records + embeddings | — |
| `patron_analysis_reports` | LLM-generated patron analysis | — |
| `pr_kpi_searches` | KPI search history | — |

### Vector Search Indexes

| Index Name | Collection | Field | Dimensions | Similarity |
|---|---|---|---|---|
| `patron_preference_vector_idx` | `patron_profiles` | `preferenceEmbedding` | 1024 | cosine |
| `offer_vector_idx` | `offer_catalog` | `offerEmbedding` | 1024 | cosine |
| `interaction_embedding_idx` | `patron_interaction_history` | `interactionEmbedding` | 1024 | cosine |

---

## Data Flow Diagrams

### Alert → Interaction → KPI Search

```
Simulate Round (POST /api/tables/:tableId/simulate-round)
  └── runAlertAnalysis()
       ├── 6 MQL executors (one per ConditionType)
       ├── Batch patron profile lookup
       └── generateAlertRationale() → Azure OpenAI (≤50 chars)
            ↓
       PatronAlert inserted into patron_alerts (30-day TTL)
            ↓
Alert Feed → Alert Card displayed in management console
  ├── [+ 記錄互動] clicked
  │    └── POST /api/patrons/:patronId/interactions
  │         ├── Save interaction record
  │         └── Voyage AI voyage-4 → interactionEmbedding stored
  │
  └── [分析賭客] clicked
       └── POST /api/alerts/:alertId/analyze-patron
            ├── Fetch last 20 interactions + patron profile + alert
            ├── Azure OpenAI → profileSummary, recommendations, suggestedPrId
            └── PatronAnalysisReport inserted into patron_analysis_reports
```

### PR Efficiency KPI Search

```
Management selects KPI template or types custom text
  └── POST /api/pr-efficiency/kpi-search { kpiText }
       ├── Voyage AI voyage-4 query embedding (1024-dim)
       ├── $vectorSearch on patron_interaction_history
       │    index: interaction_embedding_idx
       │    limit: 300, numCandidates: 600
       │    (single index scan — no per-PR filter)
       ├── Application-layer grouping by recordedBy
       │    per PR: topMatchScore, matchedCount (≥0.70), kpiAchievementRate
       ├── Sort by kpiAchievementRate desc
       └── Azure OpenAI → { insight, actions } (繁體中文 JSON)
            ↓
       KPI results table rendered:
         PR Name | Matched/Total | Achievement Rate Bar | Top Score
         + High-match sample interactions
         + AI management insight + action checklist
```

---

## Scripts

```bash
npm run dev           # Next.js development server
npm run build         # Production build
npm run start         # Start production server
npm run seed          # Seed all collections with demo data
npm run seed:dry      # Preview seed counts without writing
npm run backfill      # Backfill Voyage embeddings for offers + patron profiles
npm run check         # TypeScript type check (tsc --noEmit)
npm run stop          # Kill port 3000
```

---

## Additional Documentation

- [docs/data-model.md](docs/data-model.md) — full MongoDB schema reference
- [docs/alert-dashboard-design.md](docs/alert-dashboard-design.md) — alert rule catalog and MQL executor design
- [docs/minbet-optimizer-logic.md](docs/minbet-optimizer-logic.md) — min-bet recommendation algorithm
- [docs/risk-review-agent-guide.md](docs/risk-review-agent-guide.md) — LangGraph risk workflow walkthrough
- [docs/hybrid-offer-scoring.md](docs/hybrid-offer-scoring.md) — Atlas Search + vector hybrid scoring
- [docs/loss-potential-agentic-workflow.md](docs/loss-potential-agentic-workflow.md) — loss-chasing agent design
