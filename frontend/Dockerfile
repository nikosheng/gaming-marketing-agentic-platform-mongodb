# =============================================================================
# Multi-stage Next.js standalone Docker image
#
# Stage 1 (deps)    – install npm dependencies
# Stage 2 (builder) – next build → .next/standalone
# Stage 3 (runner)  – lean Alpine runtime, no node_modules
# =============================================================================

# ---- Stage 1: install dependencies ------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# ---- Stage 2: build ---------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Ensure Next.js build-time rewrites resolve to the backend service in Docker.
ARG NEXT_PUBLIC_BACKEND_URL=http://backend:8000
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ARG NEXT_PUBLIC_MANAGEMENT_CONSOLE_TABS=patron-eyes,offer-catalog,patron-insight,alert-dashboard,pr-efficiency,simulate
ENV NEXT_PUBLIC_MANAGEMENT_CONSOLE_TABS=${NEXT_PUBLIC_MANAGEMENT_CONSOLE_TABS}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build emits .next/standalone because output: 'standalone' is set in
# next.config.mjs.
RUN npm run build

# ---- Stage 3: production runner (lean) --------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Least-privilege: run as a non-root user
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Standalone output contains a self-contained server.js + node_modules copy
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets must be copied separately
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
