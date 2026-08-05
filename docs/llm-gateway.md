# LLM Gateway (LiteLLM chat) + in-process Voyage embeddings

This document describes the LLM infrastructure that fronts every AI call in
the app. After the Aug-2026 migration to a Python backend, the two paths are
independent:

- **Chat** goes through a local **LiteLLM** gateway (Docker) that fronts
  Azure OpenAI, with an optional OpenAI fallback slot.
- **Embeddings** run **in-process** inside the FastAPI backend using the
  official `voyageai[local]` Python SDK. There is no longer a TEI container
  or any external embedding service.

The gateway lives under `infra/` and is deployed as a docker-compose stack
targeted at Debian 12 x86_64 (CPU-only).

---

## 1. Architecture

```
┌───────────────────────────┐
│  Next.js UI               │
│  browser fetch /api/*     │
└───────────────┬───────────┘
                │ next.config.mjs rewrite
                ▼
┌───────────────────────────────────┐        Bearer LITELLM_API_KEY
│  FastAPI backend (server/)        │───────────────────────────┐
│    app/llm/gateway.py  (chat)     │                           │
│    app/llm/embeddings.py (voyage) │───┐                       │
└───────────────────────────────────┘   │  in-process           │
                                        ▼                       ▼
                          ┌───────────────────────┐   ┌──────────────────────┐
                          │  voyageai[local]      │   │  LiteLLM :4000       │
                          │  voyage-4-nano        │   │  (docker)            │
                          │  dim=1024             │   └───┬──────────────────┘
                          └───────────────────────┘       │
                                                          ▼
                                              ┌────────────────────┐
                                              │  Azure OpenAI      │
                                              │  (chat-primary)    │
                                              └────────────────────┘
                                          (OpenAI fallback slot reserved)
```

**Key properties**

- Single source of truth for chat routing: `infra/litellm/config.yaml`.
  The backend only knows one chat alias: `chat-primary`.
- Provider, key rotation, retries, and caching are the gateway's
  responsibility for chat. No code change is required to swap chat providers.
- Embeddings are dimensioned to 1024 via voyage-4-nano's Matryoshka
  Representation Learning (`output_dimension=1024`), keeping existing Mongo
  Atlas Vector Search indexes valid.
- The Voyage-4 family shares an embedding space; vectors produced locally
  by `voyage-4-nano` remain broadly comparable with historical vectors
  produced by the cloud `voyage-4` model. After the migration we recommend
  running the three backfill scripts once to regenerate all vectors with the
  local model.

---

## 2. Repository layout

```
infra/
├── docker-compose.yml       # 2 services: litellm, redis
├── .env.example             # provider secrets (mirror at repo root .env)
└── litellm/
    └── config.yaml          # model_list + router + cache

server/app/llm/
├── gateway.py               # chat_text() / chat_json() / is_gateway_configured()
└── embeddings.py            # generate_embedding() / generate_embedding_batch()

server/app/smoke/
└── gateway_smoke.py         # `uv run python -m app.smoke.gateway_smoke`
```

---

## 3. `model_list` reference

Aliases the app is allowed to request:

| Alias | Backend | Purpose |
|-------|---------|---------|
| `chat-primary` | Azure OpenAI `gpt-5.4-mini-2` | All chat completions |

A commented-out slot for `openai/gpt-4o-mini` fallback exists in
`litellm/config.yaml`. See section 5 to enable it.

**Embeddings are NOT listed here.** They are produced by the Python
`voyageai` SDK. See `server/app/llm/embeddings.py`.

---

## 4. Environment variables

**Backend-side** (`.env` at repo root — read by both Next.js and the Python
service via `pydantic-settings`)

| Variable | Default | Notes |
|----------|---------|-------|
| `LITELLM_BASE_URL` | `http://localhost:4000` | Gateway base URL |
| `LITELLM_API_KEY` | — | Must match `LITELLM_MASTER_KEY` on the gateway |
| `LLM_CHAT_MODEL` | `chat-primary` | Alias used by `chat_text` / `chat_json` |
| `LLM_EMBEDDING_MODEL` | `voyage-4-nano` | Voyage model name |
| `VECTOR_EMBEDDING_DIM` | `1024` | Passed to voyage SDK as `output_dimension` |
| `VOYAGE_API_KEY` | — | Optional — only if you switch to the hosted API |
| `EMBED_WARMUP_ON_START` | `true` | Preload voyage weights during FastAPI lifespan |

**Gateway-side** (also in the same `.env`; the LiteLLM container reads them)

| Variable | Notes |
|----------|-------|
| `AZURE_OPENAI_ENDPOINT` | Azure resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_API_VERSION` | Default `2024-12-01-preview` |
| `OPENAI_API_KEY` | Only needed once the fallback slot is enabled |
| `LITELLM_MASTER_KEY` | Bearer token clients must present |

---

## 5. Enabling the OpenAI fallback

The `chat-primary` alias supports multiple entries. LiteLLM will try them in
order on failure. To activate OpenAI as fallback:

1. In `infra/litellm/config.yaml`, uncomment this block:

   ```yaml
   - model_name: chat-primary
     litellm_params:
       model: openai/gpt-4o-mini
       api_key: os.environ/OPENAI_API_KEY
   ```

2. Set `OPENAI_API_KEY` in your `.env`.
3. Restart the gateway:

   ```
   docker compose -f infra/docker-compose.yml restart litellm
   ```

No backend code change is required.

---

## 6. Switching embedding models

Because embeddings are done in-process, there's no gateway config to touch.
Set `LLM_EMBEDDING_MODEL` to any Voyage model name supported by
`voyageai[local]` and restart the FastAPI service. If dimensions change,
update `VECTOR_EMBEDDING_DIM` **and** rebuild the Atlas Vector Search
indexes.

To go back to the hosted Voyage API (paid), set `VOYAGE_API_KEY` — the SDK
will use it automatically. The rest of the code path is unchanged.

---

## 7. Adding Langfuse (deferred)

To enable observability later, append to `litellm/config.yaml`:

```yaml
litellm_settings:
  success_callback: ["langfuse"]
  failure_callback: ["langfuse"]
```

Plus these env vars on the gateway:

```
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_HOST=https://cloud.langfuse.com   # or self-hosted URL
```

No backend code change is needed for chat — LiteLLM emits traces
automatically. Embeddings are outside the gateway, so they will not be
traced by LiteLLM/Langfuse.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `chat_text` returns `None` at server boot | Missing `LITELLM_API_KEY` | Set it in `.env` and restart the backend |
| Embeddings return zero-vectors | First-run voyage weights still downloading | Wait; the smoke test at `app/smoke/gateway_smoke.py` will tell you |
| 401 from gateway | Master-key mismatch | Ensure `LITELLM_API_KEY == LITELLM_MASTER_KEY` |
| Chat returns null in agents | Azure key invalid / expired | Rotate in Azure Portal, update `.env`, restart litellm container |
| Voyage local OOM | Not enough RAM | 2 GB is enough for voyage-4-nano CPU |
| First request very slow | Cold model load | Set `EMBED_WARMUP_ON_START=true` |

Health-check chat:

```
curl http://localhost:4000/health/liveliness
```

Smoke-check both paths end-to-end:

```
cd server && uv run python -m app.smoke.gateway_smoke
```
