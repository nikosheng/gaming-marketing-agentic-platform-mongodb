# Macau Gaming Marketing AI Platform

A full-stack Management Console for casino marketing operations. The frontend is Next.js, the backend is a Python **FastAPI** service under [`server/`](server/), and the AI stack uses **voyageai `voyage-4-nano` (local, in-process)** for embeddings and **Azure OpenAI (via LiteLLM)** for chat. The platform combines real-time table monitoring, AI-driven patron analysis, alert automation, and PR performance management into a single operator interface.

> **Migration note (2026-08):** the former Next.js API routes and TypeScript agents were replaced by a Python service. See [`server/README.md`](server/README.md).

---

## Overview

The platform is designed around a single-page **Management Console** with five functional sections, each targeting a different operational role in a casino marketing team:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Management Console                             │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  Sidebar     │  Content Area                                        │
│              │                                                      │
│  Patron Eyes │  ● Live heatmap of all tables                        │
│              │  ● Click-to-drill: patrons, betting, AI scoring      │
│  Offer       │  ● Min-bet optimizer + audit trail                   │
│  Catalog     │  ● Simulate betting rounds → trigger alerts          │
│              │  ● Risk workflow modal (LangGraph)                   │
│  Patron      │                                                      │
│  Insight     │  ● NL → LLM → alert rule creation                   │
│              │  ● Alert feed with evidence + AI rationale           │
│  Alert       │  ● Per-alert: record PR interaction (comp/room/etc)  │
│  Dashboard   │  ● Per-alert: AI patron analysis + next-action reco  │
│              │                                                      │
│  PR          │  ● PR metrics grid (interactions, value, patrons)    │
│  Efficiency  │  ● KPI vector search across all PR agents            │
│              │  ● LLM management insight + ranked PR table          │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Core AI capabilities:**

| Capability | Technology | Where Used |
|---|---|---|
| Natural language → condition rules | Azure OpenAI | Alert Dashboard rule creation |
| Alert rationale generation | Azure OpenAI | Alert Feed cards |
| Patron history analysis | Azure OpenAI | Alert Card "分析賭客" |
| PR KPI management insight | Azure OpenAI | PR Efficiency KPI search |
| Interaction semantic embedding | Voyage AI `voyage-4-nano` (local) | patron_interaction_history |
| Patron preference embedding | Voyage AI `voyage-4-nano` (local) | patron_profiles |
| Offer content embedding | Voyage AI `voyage-4-nano` (local) | offer_catalog |
| KPI vector search | MongoDB Atlas Vector Search | PR Efficiency |
| Offer–patron matching | MongoDB Atlas Vector Search | Offer Catalog |
| Risk + AML workflow | LangGraph (Python) | Patron Insight |
| Offer generation | LangGraph (Python) | Offer Catalog |

**Data lifecycle for PR Efficiency:**

```
Public Relations Agent
  └── records interaction in Alert Card or Patron Detail page
       └── POST /api/patrons/:patronId/interactions
            ├── saves to patron_interaction_history
            └── voyageai[local] voyage-4-nano → interactionEmbedding (1024-dim, in-process)

Management
  └── opens PR Efficiency tab
       ├── views PR Metrics grid (aggregated from interaction_history)
       └── runs KPI vector search
            ├── voyageai[local] → query embedding
            ├── $vectorSearch → top-300 semantically similar records
            ├── group by recordedBy → per-PR achievement rate
            └── Azure OpenAI (via LiteLLM) → ranked insight + action recommendations
```

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
  └── Management Console (app/ui/dashboard-client.tsx)
       ├── Patron Eyes        → /api/tables/*
       ├── Offer Catalog      → /api/offers/*
       ├── Patron Insight     → /api/patrons/*/risk-case
       ├── Alert Dashboard    → /api/alert-rules, /api/alerts/*
       │    └── Alert Card
       │         ├── [分析賭客]   → /api/alerts/[alertId]/analyze-patron
       │         └── [記錄互動]   → /api/patrons/[patronId]/interactions
       └── PR Efficiency      → /api/pr-efficiency/*
              │
              │  next.config.mjs rewrites /api/* → NEXT_PUBLIC_BACKEND_URL
              ▼
Python backend (server/app, FastAPI + Motor + LangGraph)
  ├── routers/          — 8 HTTP router modules, one per /api/* segment
  ├── agents/
  │    ├── alert_rule_agent.py       — NL → condition catalog (LangGraph)
  │    ├── alert_analyzer.py         — MQL executors + LLM rationale
  │    ├── patron_profile_agent.py   — Patron history LLM analysis
  │    ├── pr_efficiency_agent.py    — PR metrics aggregation + KPI vector search
  │    ├── minbet_optimizer_agent.py — Min-bet recommendation (LangGraph)
  │    ├── offer_agent.py            — Offer generation (LangGraph)
  │    ├── table_drilldown_agent.py  — Table patron scoring (LangGraph)
  │    ├── risk_case_agent.py        — Risk workflow + PR assignment
  │    └── condition_catalog.py      — Alert-condition catalog constants
  ├── llm/
  │    ├── gateway.py     — chat_text() / chat_json() → LiteLLM (Azure OpenAI)
  │    └── embeddings.py  — voyageai[local] voyage-4-nano, 1024-dim, in-process
  ├── schemas/            — Pydantic v2 domain models (patrons, offers, ...)
  ├── db.py               — AsyncIOMotorClient singleton
  └── main.py             — FastAPI factory + lifespan (voyage warm-up + Mongo ping)

Patron Detail Page (/patron-detail/[patronId])
  ├── Interaction History timeline
  ├── Add interaction form
  └── Analysis reports (Acknowledged / Actioned)

MongoDB Atlas
  ├── Standard indexes (unique, compound, TTL)
  └── Vector Search indexes
       ├── patron_preference_vector_idx  (patron_profiles.preferenceEmbedding)
       ├── offer_vector_idx              (offer_catalog.offerEmbedding)
       └── interaction_embedding_idx     (patron_interaction_history.interactionEmbedding)

LLM stack (infra/docker-compose.yml)
  ├── LiteLLM :4000  ── chat only (Azure OpenAI, OpenAI fallback slot)
  └── Redis    :6379 ── LiteLLM response cache
  (Voyage embeddings run in-process inside the Python backend, no container)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript |
| Backend | Python 3.11+ · FastAPI · Motor (async MongoDB) · Pydantic v2 |
| Database | MongoDB Atlas (`motor` async driver) |
| Vector Search | MongoDB Atlas Vector Search (cosine, 1024-dim) |
| Embeddings | Voyage AI `voyage-4-nano` (local, `voyageai[local]` in-process) |
| Chat LLM | Azure OpenAI `gpt-5.4-mini-2` via LiteLLM gateway |
| Agent Framework | LangGraph (Python) · `langgraph-checkpoint-mongodb` |
| Package manager | `uv` (Python) · `npm` (frontend) |

---

## Environment Variables

Copy the example file at the repo root and fill in your credentials. The
same `.env` is read by both the frontend and the Python backend (via
`pydantic-settings`).

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | No | Frontend proxy target for `/api/*` (default: `http://localhost:8000`) |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `MONGODB_DB` | No | Database name (default: `casino_marketing_demo`) |
| `LITELLM_BASE_URL` | Yes* | LiteLLM gateway URL (default: `http://localhost:4000`) |
| `LITELLM_API_KEY` | Yes* | LiteLLM master key (Bearer token; must match `LITELLM_MASTER_KEY` in `infra/.env`) |
| `LLM_CHAT_MODEL` | No | Chat model alias in LiteLLM (default: `chat-primary`) |
| `LLM_EMBEDDING_MODEL` | No | Voyage model name (default: `voyage-4-nano`) |
| `VECTOR_EMBEDDING_DIM` | No | Embedding dimension (default: `1024`) |
| `VOYAGE_API_KEY` | No | Only needed if you switch to the hosted Voyage API |
| `EMBED_WARMUP_ON_START` | No | Preload voyage weights during FastAPI lifespan (default: `true`) |
| `SEED_PATRON_COUNT` | No | Number of patrons to seed (default: `300`) |
| `SEED_TABLE_COUNT` | No | Number of tables to seed (default: `30`) |

\* Required for chat-driven features (Alert Dashboard AI rationale, Patron
Analysis, PR Efficiency KPI insight, Offer NL parsing). LiteLLM handles chat
routing (Azure OpenAI, optional OpenAI fallback) — see
[`docs/llm-gateway.md`](docs/llm-gateway.md). Embeddings do **not** go
through LiteLLM anymore; the backend calls `voyageai[local]` in-process.

---

## LLM Stack

Two independent pieces:

1. **Chat** — a local **LiteLLM** gateway fronts Azure OpenAI. Shipped as a
   docker-compose stack under `infra/` (litellm + redis).
2. **Embeddings** — the Python backend calls the `voyageai[local]` SDK
   in-process; no external service, no Docker container. First call
   downloads ~700 MB of `voyage-4-nano` weights into the Python venv cache.

```bash
# 1. Fill provider secrets used by LiteLLM
cp .env.example .env
# edit .env: AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / LITELLM_MASTER_KEY

# 2. Start the chat gateway (litellm + redis)
npm run llm:up

# 3. Verify end-to-end (chat via LiteLLM + voyage local embedding)
cd server && uv run python -m app.smoke.gateway_smoke
```

Useful commands:

| Command | Purpose |
|---|---|
| `npm run llm:up` | Start litellm + redis containers |
| `npm run llm:down` | Stop the stack |
| `npm run llm:logs` | Tail all container logs |
| `cd server && uv run python -m app.smoke.gateway_smoke` | End-to-end chat + embedding sanity check |

Full details of the chat gateway are in [`docs/llm-gateway.md`](docs/llm-gateway.md).

---

## Install & Run

```bash
# ---------- Backend (Python / FastAPI) ------------------------------------
cd server
uv sync                                    # install Python deps
uv run uvicorn app.main:app --reload --port 8000

# In a second terminal, seed and backfill:
uv run python -m app.seed.seed             # base collections (destructive)
uv run python -m app.seed.seed_interactions  # PR interaction history (additive)

# Backfill Voyage embeddings — fast now because voyage-4-nano runs in-process
uv run python -m app.scripts.backfill_embeddings          # offers + patrons
uv run python -m app.scripts.backfill_interaction_embeddings  # interactions
uv run python -m app.scripts.backfill_offer_embeddings    # offers only

# ---------- Frontend (Next.js) --------------------------------------------
# From the repo root:
npm install
npm run dev              # http://localhost:3000 → proxies /api/* to :8000

# Production build
npm run build && npm run start
```

The first run of any embedding script (or the server, if `EMBED_WARMUP_ON_START=true`) downloads ~700 MB of `voyage-4-nano` weights into your Python cache. Subsequent runs are instant.

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
  → voyageai[local] voyage-4-nano query embedding (1024-dim, in-process)
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
  → Azure OpenAI (via LiteLLM) → JSON management insight (繁體中文):
      insight  — 2-3 sentences comparing PRs, naming best and weakest
      actions  — 3 concrete management action items
```

**Results display:**

- Ranked table: PR name · matched/total · achievement rate bar · top similarity score
- Best performer badge (最佳) · needs-improvement badge (需改善)
- High-match sample interactions per PR
- AI management insight panel with action checklist

#### Interaction Embedding

Every interaction record written via `POST /api/patrons/[patronId]/interactions` automatically generates a Voyage AI `document` embedding from a structured Chinese description of the interaction, produced in-process by `voyageai[local]` (`voyage-4-nano`, 1024-dim). The vector is stored in `interactionEmbedding` and indexed by the Atlas Vector Search index `interaction_embedding_idx`.

Example embedding text generated for a ROOM_COMP record:
```
為 Platinum 等級賭客安排免費房間住宿，房型：Superior Suite，2晚，價值 HKD 12,000，日期 2026-07-01
```

If the voyage local model fails to load (or returns an unexpected shape), the record is still saved without an embedding (graceful degradation via zero-vector detection).

#### Demo Data Setup

Run `uv run python -m app.seed.seed_interactions` (from `server/`) to populate `patron_interaction_history` with ~300–350 simulated records. The script reads live PR agents and patrons from MongoDB — no hardcoded IDs.

PR agents are split into 4 groups by sorted `prAgentId` order, each with a distinct interaction type distribution designed to produce meaningful differences in KPI vector search results:

| Group | PRs (approx.) | Dominant types | KPI search profile |
|---|---|---|---|
| A — Hosting | First quarter | `ROOM_COMP` 40%, `TRANSFER` 30% | Scores high on room/accommodation KPIs |
| B — Retention | Second quarter | `OUTREACH` 40%, `EVENT_INVITE` 30% | Scores high on contact/event KPIs |
| C — Reward | Third quarter | `REBATE` 35%, `FB_COMP` 30% | Scores high on comp/rebate KPIs |
| D — Generalist | Final quarter | All types ~17% each | Moderate score across all KPIs |

Each PR receives 8–20 records scattered randomly across the past 180 days. Pass `--dry-run` to preview counts without writing.

After seeding, run `uv run python -m app.scripts.backfill_interaction_embeddings` to generate embeddings. Until embeddings are filled, the KPI vector search will return empty results (the metrics grid is unaffected).

> Full technical documentation: [docs/pr-efficiency.md](docs/pr-efficiency.md)

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
  └── run_alert_analysis()  [server/app/agents/alert_analyzer.py]
       ├── 6 MQL executors (one per ConditionType)
       ├── Batch patron profile lookup
       └── generate_alert_rationale() → Azure OpenAI (≤50 chars)
            ↓
       PatronAlert inserted into patron_alerts (30-day TTL)
            ↓
Alert Feed → Alert Card displayed in management console
  ├── [+ 記錄互動] clicked
  │    └── POST /api/patrons/:patronId/interactions
  │         ├── Save interaction record
  │         └── voyageai[local] voyage-4-nano → interactionEmbedding stored
  │
  └── [分析賭客] clicked
       └── POST /api/alerts/:alertId/analyze-patron
            ├── Fetch last 20 interactions + patron profile + alert
            ├── Azure OpenAI (via LiteLLM) → profileSummary, recommendations, suggestedPrId
            └── PatronAnalysisReport inserted into patron_analysis_reports
```

### PR Efficiency KPI Search

```
Management selects KPI template or types custom text
  └── POST /api/pr-efficiency/kpi-search { kpiText }
       ├── voyageai[local] voyage-4-nano query embedding (1024-dim, in-process)
       ├── $vectorSearch on patron_interaction_history
       │    index: interaction_embedding_idx
       │    limit: 300, numCandidates: 600
       │    (single index scan — no per-PR filter)
       ├── Application-layer grouping by recordedBy
       │    per PR: topMatchScore, matchedCount (≥0.70), kpiAchievementRate
       ├── Sort by kpiAchievementRate desc
       └── Azure OpenAI (via LiteLLM) → { insight, actions } (繁體中文 JSON)
            ↓
       KPI results table rendered:
         PR Name | Matched/Total | Achievement Rate Bar | Top Score
         + High-match sample interactions
         + AI management insight + action checklist
```

---

## Scripts

### Frontend (Next.js — run from repo root)

```bash
npm run dev            # Next.js development server (http://localhost:3000)
npm run build          # Production build
npm run start          # Start production server
npm run check          # TypeScript type check (tsc --noEmit)
npm run stop           # Kill port 3000
npm run llm:up         # Start LiteLLM + Redis containers
npm run llm:down       # Stop the LLM stack
npm run llm:logs       # Tail all container logs
```

### Backend (Python — run from `server/`)

```bash
uv sync                # Install / update Python deps

# Dev server
uv run uvicorn app.main:app --reload --port 8000

# Seed
uv run python -m app.seed.seed                            # base collections (destructive)
uv run python -m app.seed.seed --dry-run                  # preview counts, no write
uv run python -m app.seed.seed_interactions               # PR interaction history (additive)
uv run python -m app.seed.seed_interactions --dry-run     # preview

# Backfill Voyage embeddings (in-process voyage-4-nano)
uv run python -m app.scripts.backfill_embeddings          # patrons + synthetic sessions
uv run python -m app.scripts.backfill_offer_embeddings    # offer_catalog only
uv run python -m app.scripts.backfill_interaction_embeddings

# Data migrations / diagnostics
uv run python -m app.scripts.backfill_patron_region
uv run python -m app.scripts.migrate_activities_to_patrons
uv run python -m app.scripts.check_recommendations [tableId]
uv run python -m app.scripts.check_occupancy_mismatch
uv run python -m app.scripts.find_strong_match_patrons
uv run python -m app.scripts.inspect_patron_offers
uv run python -m app.scripts.list_tables

# Smoke test the LLM stack (LiteLLM chat + voyage local embeddings)
uv run python -m app.smoke.gateway_smoke
```

---

## Additional Documentation

- [docs/data-model.md](docs/data-model.md) — full MongoDB schema reference
- [docs/pr-efficiency.md](docs/pr-efficiency.md) — PR Efficiency complete technical design
- [docs/alert-dashboard-design.md](docs/alert-dashboard-design.md) — alert rule catalog and MQL executor design
- [docs/minbet-optimizer-logic.md](docs/minbet-optimizer-logic.md) — min-bet recommendation algorithm
- [docs/risk-review-agent-guide.md](docs/risk-review-agent-guide.md) — LangGraph risk workflow walkthrough
- [docs/hybrid-offer-scoring.md](docs/hybrid-offer-scoring.md) — Atlas Search + vector hybrid scoring
- [docs/loss-potential-agentic-workflow.md](docs/loss-potential-agentic-workflow.md) — loss-chasing agent design
