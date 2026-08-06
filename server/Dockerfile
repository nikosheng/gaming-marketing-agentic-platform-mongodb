# =============================================================================
# Python FastAPI backend — built with uv for reproducible installs
#
# The Voyage AI local model weights (~700 MB) are NOT baked into the image.
# Mount the named volume `voyage-model-cache` at /root/.cache/voyageai so
# the weights are downloaded once and reused across container restarts.
# =============================================================================

FROM python:3.11-slim

# Install uv (fast Python package installer / resolver)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Copy dependency manifests first for better layer caching.
# uv.lock guarantees a fully reproducible install.
COPY pyproject.toml uv.lock ./

# Install runtime dependencies only (skip dev extras).
# --no-install-project: don't install the project itself yet (source not copied).
RUN uv sync --frozen --no-dev --no-install-project

# Copy application source
COPY app/ ./app/

# Install the project package (app/) into the venv
RUN uv sync --frozen --no-dev

EXPOSE 8000

# Unbuffered output so logs appear immediately in docker compose logs
ENV PYTHONUNBUFFERED=1

# Voyage AI caches model weights under ~/.cache/voyageai.
# Mount the named volume `voyage-model-cache` here to persist across restarts.
# VOLUME /root/.cache/voyageai  ← declared in docker-compose.yml instead

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
