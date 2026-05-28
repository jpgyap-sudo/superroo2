# Local Docker Build — Mandatory Rule for Deployer Agent

## Rule

**ALL build and deploy operations MUST use local Docker for building.** This is a mandatory rule for the deployer agent and any agent performing build or deploy operations.

## Why

Building with local Docker ensures:

- **Reproducibility**: The build environment is identical to production (same Dockerfile, same base images)
- **Isolation**: Dependencies are resolved in a clean container environment, not polluted by local dev state
- **Cache efficiency**: Docker layer caching on the local machine preserves build caches across deploys
- **No remote build dependency**: Building does not require SSH access to the VPS or any remote build server
- **Consistency with CI/CD**: Local Docker build mirrors what CI/CD pipelines do

## Mandatory Requirements

### 1. Always Use `docker compose build`

**NEVER** run `pnpm build`, `npm run build`, or any direct build command on the host machine for deployment builds. Always use:

```bash
# Build all services
docker compose build

# Build a specific service
docker compose build superroo-api
docker compose build superroo-dashboard
```

### 2. Enable BuildKit for Multi-Layer Optimization

Always set BuildKit environment variables before building:

```bash
set DOCKER_BUILDKIT=1
set COMPOSE_DOCKER_CLI_BUILD=1
```

Or use the one-liner:

```bash
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose build
```

### 3. Preserve Build Caches

- Docker layer cache is preserved automatically by Docker (no `--no-cache` unless explicitly requested)
- BuildKit cache mounts persist `pnpm store` and `.next/cache` across builds
- Do NOT run `docker builder prune` or `docker system prune` before builds

### 4. Build Before Deploy

The build and deploy steps are separate:

1. **Build locally**: `docker compose build` — produces images on the local machine
2. **Push/transfer images**: `docker save` or push to registry, then load on VPS
3. **Deploy on VPS**: `docker compose up -d` with the new images

### 5. Verify Build Output

After building, verify:

1. Exit code is 0
2. Images are created: `docker images` shows the expected images
3. Image sizes are reasonable

### 6. Performance Budgets

| Metric                        | Target  | Action if Exceeded                           |
| ----------------------------- | ------- | -------------------------------------------- |
| Docker build (all services)   | < 300s  | Check layer cache, use BuildKit cache mounts |
| Docker build (single service) | < 120s  | Check if dependency layer is cached          |
| Image size (API)              | < 500MB | Check for unnecessary devDependencies        |
| Image size (Dashboard)        | < 500MB | Check for unnecessary devDependencies        |

## Enforcement

This rule is enforced by:

1. This rule file (`.roo/rules-code/local-docker-build.md`)
2. The [`deployer`](../skills/deployer/SKILL.md) skill — references local Docker build as mandatory
3. The [`multi-layer-build`](../skills/multi-layer-build/SKILL.md) skill — ensures layer optimization

## Exceptions

The only exceptions to local Docker build are:

1. **First-time setup** where Docker is not installed on the local machine
2. **Explicit user override** — user says "skip Docker" or "build on VPS directly"
3. **CI/CD pipeline** where the build runs in a GitHub Actions runner (still uses Docker, just not local)
