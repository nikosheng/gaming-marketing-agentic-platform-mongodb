# Macau Gaming Marketing AI Platform

This project now includes:
- MongoDB Atlas data model + indexing strategy (including vector indexes).
- Mock data generator and seed pipeline for demo usage.
- Next.js web app with:
  - Table heatmap page (refreshes every minute).
  - Click-to-drill table patron panel.
  - Offer management dashboard with recommendations + activity feed.
  - Offer generation API endpoint using embedding similarity fallback.

## Tech Stack

- Web: Next.js 16 + React + TypeScript
- Database: MongoDB Atlas (`mongodb` driver)
- Vector fields: ready for Voyage embedding dimensions
- LLM reference model: Azure OpenAI `gpt-5.1-mini` (for chat/log metadata integration)

## Environment

Create `.env.local` (for web app runtime) or `.env` (for seed scripts):

```bash
cp .env.example .env.local
```

Required variables:
- `MONGODB_URI`
- `MONGODB_DB` (default: `casino_marketing_demo`)

Optional seed controls:
- `VECTOR_EMBEDDING_DIM` (default: `1024`)
- `SEED_PATRON_COUNT` (default: `300`)
- `SEED_TABLE_COUNT` (default: `30`)

## Install

```bash
npm install
```

## Seed Demo Data

Preview counts:

```bash
npm run seed:dry
```

Write to Atlas:

```bash
npm run seed
```

## Backfill Embeddings (Voyage 4)

To update all existing offers and patron profiles with real Voyage 4 embeddings:

```bash
npm run backfill
```

## Run Web App

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## APIs

- `GET /api/tables/heatmap`
  - Heatmap tables + occupancy metrics.
- `GET /api/tables/:tableId/patrons`
  - Active patrons on selected table with ADT and betting snapshot.
- `GET /api/offers/dashboard`
  - Offers, recommendation summary, recent activities.
- `POST /api/offers/generate`
  - Body: `{ "patronId": "P-000001" }`
  - Returns top offers by embedding similarity fallback.
- `POST /api/offers/agent-chat`
  - Body: `{ "message": "Create hotel offer for Gold baccarat patrons with ADT >= 5000 in last 7 days" }`
  - Creates a draft offer from natural-language criteria and returns matched patron count.

## Collections Used

- `patron_profiles`
- `table_state_snapshots`
- `patron_table_sessions`
- `patron_activity_events`
- `offer_catalog`
- `offer_recommendations`
- `campaign_runs`
- `chat_sessions`
- `chat_messages`
- `patron_risk_cases`
- `pr_agent_profiles`
- `pr_assignments`

Detailed model: [docs/data-model.md](docs/data-model.md)

## Notes

- Seed is destructive for the listed collections (clear + reload).
- Table heatmap refreshes every 60 seconds on the frontend.
