# =============================================================================
# SuperRoo Daemon — Dockerfile
# Multi-stage build: install all deps, then copy only what the daemon needs.
# =============================================================================

# ---- Stage 1: Install all workspace dependencies ----
FROM node:20.19.2-slim AS installer

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@10.8.1

WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY src/package.json ./src/package.json
COPY webview-ui/package.json ./webview-ui/package.json
COPY packages/memory-core/package.json ./packages/memory-core/package.json
COPY packages/brain-router/package.json ./packages/brain-router/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cloud/package.json ./packages/cloud/package.json
COPY packages/ipc/package.json ./packages/ipc/package.json
COPY packages/vscode-shim/package.json ./packages/vscode-shim/package.json
COPY packages/config-typescript/package.json ./packages/config-typescript/package.json
COPY packages/config-eslint/package.json ./packages/config-eslint/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY packages/command-runner/package.json ./packages/command-runner/package.json

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile --no-optional 2>&1

# ---- Stage 2: Build / compile ----
FROM node:20.19.2-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.8.1

WORKDIR /app

# Copy node_modules from installer
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/src/node_modules ./src/node_modules

# Copy source code
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json turbo.json ./
COPY src/ ./src/
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY config/ ./config/
COPY sql/ ./sql/
COPY scripts/ ./scripts/

# Build TypeScript (compile the daemon entry point)
RUN cd src && npx tsc --noEmit 2>&1 || true

# ---- Stage 3: Production runtime ----
FROM node:20.19.2-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.8.1

WORKDIR /app

# Copy production dependencies
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/src/node_modules ./src/node_modules

# Copy source code (needed for tsx runtime)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY src/ ./src/
COPY packages/ ./packages/
COPY config/ ./config/
COPY sql/ ./sql/
COPY scripts/ ./scripts/

# Expose daemon port
EXPOSE 3417

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3417/health || exit 1

# Run the daemon
CMD ["pnpm", "--dir", "src", "daemon"]
