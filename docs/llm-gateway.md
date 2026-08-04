# LLM Gateway (LiteLLM + local Voyage embedding)

This document describes the LLM infrastructure that fronts every AI call in
the app. The gateway lives under `infra/` and is deployed as a docker-compose
stack targeted at Debian 12 x86_64 (CPU-only).

---

## 1. Architecture

```
┌───────────────────────────┐    Bearer LITELLM_API_KEY
│  Next.js App              │────────────────────────────────┐
│  (src/web/llm/gateway.ts) │                                │
│  (src/web/llm/embeddings) │       OpenAI-compatible /v1    │
└───────────────────────────┘                                ▼
                                                ┌──────────────────────┐
                                                │  LiteLLM  :4000      │
                                                │  (docker)            │
                                                └───┬──────────┬───────┘
                                                    │          │
                    chat-primary alias  ────────────┘          └──────────── voyage-4-nano alias
                                    │                                                 │
                                    ▼                                                 ▼
                        ┌────────────────────┐                            ┌──────────────────────┐
                        │  Azure OpenAI      │                            │  TEI (docker)        │
                        │  (cloud, primary)  │                            │  :8080 → :80         │
                        └────────────────────┘                            │  voyageai/           │
                                                                          │  voyage-4-nano       │
                        (OpenAI fallback slot                              │  dim=1024 (MRL)      │
                         reserved but disabled)                           └──────────────────────┘
```

**Key properties**

- Single source of truth for provider routing: `infra/litellm/config.yaml`.
  The app only knows two aliases: `chat-primary` and `voyage-4-nano`.
- Physical model, provider, key rotation, retries, and caching are the
  gateway's responsibility. Code changes are not required to swap providers.
- Embedding output is truncated to 1024 dim via voyage-4-nano's Matryoshka
  Representation Learning, keeping existing Mongo Atlas Vector Search
  indexes valid.
- Voyage 4 family shares an embedding space, so vectors produced locally by
  `voyage-4-nano` remain comparable with historical vectors produced by the
  cloud `voyage-4` model — no re-indexing required.

---

## 2. Repository layout

```
infra/
├── docker-compose.yml       # 3 services: litellm, tei, redis
├── .env.example             # provider secrets (copy to infra/.env)
└── litellm/
    └── config.yaml          # model_list + router + cache

src/web/llm/
├── gateway.ts               # chatText() / chatJson() / isGatewayConfigured()
├── embeddings.ts            # generateEmbedding() / generateEmbeddingBatch()
└── __smoke__/
    └── gateway.smoke.ts     # `npm run llm:smoke`

src/web/embedding.ts          # thin re-export shim → llm/embeddings
```

---

## 3. `model_list` reference

Aliases the app is allowed to request:

| Alias | Backend | Purpose |
|-------|---------|---------|
| `chat-primary` | Azure OpenAI `gpt-5.4-mini-2` | All chat completions |
| `voyage-4-nano` | Local TEI (`http://tei:80`) | All embeddings, 1024 dim |

A commented-out slot for `openai/gpt-4o-mini` fallback exists in
`litellm/config.yaml`. See section 5 to enable it.

---

## 4. Environment variables

**App-side** (`.env.local`)

| Variable | Default | Notes |
|----------|---------|-------|
| `LITELLM_BASE_URL` | `http://localhost:4000` | Gateway base URL |
| `LITELLM_API_KEY` | — | Must match `LITELLM_MASTER_KEY` on the gateway |
| `LLM_CHAT_MODEL` | `chat-primary` | Alias used by `gateway.chatText/chatJson` |
| `LLM_EMBEDDING_MODEL` | `voyage-4-nano` | Alias used by `generateEmbedding` |
| `VECTOR_EMBEDDING_DIM` | `1024` | Passed to TEI via OpenAI-compatible `dimensions` param |

**Gateway-side** (`infra/.env`, never read by the app)

| Variable | Notes |
|----------|-------|
| `AZURE_OPENAI_ENDPOINT` | Azure resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_API_VERSION` | Default `2024-12-01-preview` |
| `OPENAI_API_KEY` | Only needed once the fallback slot is enabled |
| `LITELLM_MASTER_KEY` | Bearer token clients must present |
| `HF_TOKEN` | Optional; not needed for voyage-4-nano |

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

2. In `infra/.env`, set `OPENAI_API_KEY`.
3. Restart the gateway:

   ```
   docker compose -f infra/docker-compose.yml restart litellm
   ```

No app-side change is required.

---

## 6. Switching / adding embedding models

Everything lives in `infra/litellm/config.yaml` under a new `model_list`
entry. Example — adding an OpenAI fallback for embeddings:

```yaml
- model_name: voyage-4-nano   # keep the same alias
  litellm_params:
    model: openai/text-embedding-3-small
    api_key: os.environ/OPENAI_API_KEY
```

If dimensions change, update `VECTOR_EMBEDDING_DIM` in `.env.local` **and**
rebuild the Atlas Vector Search indexes.

---

## 7. Adding Langfuse (deferred to a later phase)

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

No app-side code change is needed — LiteLLM emits traces automatically.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `LITELLM_API_KEY is not set` at app boot | Missing app-side env | Set `LITELLM_API_KEY` in `.env.local` |
| Embeddings return zero-vectors | TEI still downloading model | Wait ~1 min; `docker compose logs tei` |
| 401 from gateway | Master key mismatch | Ensure `LITELLM_API_KEY == LITELLM_MASTER_KEY` |
| Chat returns null in agents | Azure key invalid / expired | Rotate in Azure Portal, update `infra/.env`, restart litellm |
| TEI OOM on Debian | Insufficient RAM | 4 GB is comfortable for CPU voyage-4-nano; lower `--max-batch-tokens` |
| Slow embeddings | CPU-only inference | Expected; use batching, or attach a GPU and switch TEI image tag |

Health-check the stack:

```
curl http://localhost:4000/health/liveliness
curl http://localhost:8080/health
```
