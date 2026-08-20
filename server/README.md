# MGM Marketing AI — Python backend

FastAPI + Motor (async MongoDB) + LangGraph service that replaces the former
Next.js API routes in `app/api/**`.

## Quick start

```bash
# from repo root
cp server/.env.example server/.env  # then fill Mongo / LiteLLM / Voyage vars
cd server
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Smoke test the LLM stack (LiteLLM chat + voyage-4-nano local embeddings):

```bash
uv run python -m app.smoke.gateway_smoke
```

The Next.js UI in `../app` proxies `/api/*` to this service (see
`next.config.mjs` at the repo root).

## Layout

```
app/
  main.py            FastAPI app factory + lifespan
  config.py          pydantic-settings, loads .env
  db.py              Motor client singleton
  collections.py     Mongo collection name constants
  llm/               Chat (LiteLLM) + embeddings (voyage local)
  schemas/           Pydantic v2 domain models (patrons, tables, offers, ...)
  agents/            Business logic: langgraph + plain async agents
  routers/           HTTP endpoints, one file per top-level /api segment
  scripts/           CLI utilities (`uv run python -m app.scripts.<name>`)
  seed/              Seed / mock-data generators
  smoke/             LLM stack smoke test
```
