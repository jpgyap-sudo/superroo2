# SuperRoo Fully Containerized Docker Deployment

## Architecture

```
Docker Compose (all services containerized):
  ├── redis                ← BullMQ queue backend (port 6379)
  ├── superroo-api         ← Node.js HTTP API (port 8787)
  ├── superroo-worker      ← BullMQ job processor (port 8790, Docker socket)
  ├── superroo-dashboard   ← Next.js frontend (port 3001)
  └── superroo-mini-ide    ← Telegram Mini IDE (port 8081)

Host (PM2 — optional, for legacy services):
  ├── superroo-auto-deployer ← can remain on PM2 if needed
  └── nginx                  ← reverse proxy (stays on host)
```

**Key changes from hybrid approach:**

- **Redis is now containerized** — no dependency on host Redis
- **Worker is now containerized** — uses Docker socket mount for sandbox spawning
- **All services communicate via Docker DNS** — no `host.docker.internal` needed
- **No PM2 needed for core services** — Docker Compose handles restart/resilience

## Prerequisites

- Docker and Docker Compose v2 installed on VPS
- `.env` file with secrets (see below)
- PM2 still optional for auto-deployer (or migrate to Docker)

## Environment Variables

Create `cloud/docker/.env`:

```bash
# Required
TELEGRAM_BOT_TOKEN=8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ
SUPERROO_VAULT_KEY=D16PFwmjzXtmpEfFSYrAepsaveOB+fLuneeuQrvTYVw=

# SMTP (optional, for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=marketing.homeu1@gmail.com
SMTP_PASS=ouhx sjib hyoj aayv
SMTP_FROM=marketing.homeu1@gmail.com

# Worker (optional, defaults provided)
BOSS_TELEGRAM_CHAT_ID=8485794779
```

## Deploy

```bash
# 1. SSH into VPS via Tailscale
ssh root@100.64.175.88

# 2. Navigate to project
cd /opt/superroo2

# 3. Pull latest code
git pull

# 4. Build and start all containers
docker compose -f cloud/docker/docker-compose.yml --env-file cloud/docker/.env up -d --build

# 5. Verify all services are healthy
docker compose -f cloud/docker/docker-compose.yml ps

# 6. Check health endpoints
curl -f http://localhost:8787/api/health    # API
curl -f http://localhost:3001               # Dashboard
curl -f http://localhost:8081               # Mini IDE
curl -f http://localhost:8790/health        # Worker
redis-cli ping                              # Redis

# 7. Stop old PM2 services (only after Docker is verified)
pm2 stop superroo-api superroo-dashboard superroo-mini-ide superroo-worker
pm2 delete superroo-api superroo-dashboard superroo-mini-ide superroo-worker
pm2 save
```

## Service Dependencies

```
redis (healthy)
  ├── superroo-api (depends_on: redis)
  │     ├── superroo-worker (depends_on: redis, superroo-api)
  │     ├── superroo-dashboard (depends_on: superroo-api)
  │     └── superroo-mini-ide (depends_on: superroo-api)
```

## Rollback

```bash
# Stop Docker containers
docker compose -f cloud/docker/docker-compose.yml down

# Restart PM2 services (if previously used)
cd /opt/superroo2/cloud
pm2 start ecosystem.config.js --only superroo-api,superroo-dashboard,superroo-mini-ide,superroo-worker
pm2 save
```

## Monitoring

```bash
# Container logs (all services)
docker compose -f cloud/docker/docker-compose.yml logs -f

# Individual service logs
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-api
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-worker
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-dashboard
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-mini-ide
docker compose -f cloud/docker/docker-compose.yml logs -f redis

# Container stats
docker stats

# PM2 logs (auto-deployer only, if still on PM2)
pm2 logs superroo-auto-deployer
```

## Rebuild After Code Changes

```bash
cd /opt/superroo2
git pull
docker compose -f cloud/docker/docker-compose.yml up -d --build
```

## Data Persistence

All persistent data is stored in Docker volumes:

| Volume                       | Purpose                             | Path in Container                        |
| ---------------------------- | ----------------------------------- | ---------------------------------------- |
| `superroo-redis-data`        | Redis RDB/AOF files                 | `/data`                                  |
| `superroo-orchestrator-data` | Orchestrator SQLite DB              | `/opt/superroo2/cloud/orchestrator/data` |
| `superroo-hermes-data`       | Hermes Claw / Telegram Learner data | `/opt/superroo2/cloud/data`              |
| `superroo-sandbox-data`      | Job scripts for sandbox             | `/opt/superroo2/cloud/sandbox/jobs`      |
| `superroo-uploads`           | Mini IDE file uploads               | `/opt/superroo2/cloud/mini-ide/uploads`  |
| `superroo-logs`              | API/Worker/Dashboard logs           | `/opt/superroo2/cloud/logs`              |

To backup volumes:

```bash
docker run --rm -v superroo-redis-data:/source -v $(pwd)/backup:/backup alpine tar czf /backup/redis-data.tar.gz -C /source .
```

## Troubleshooting

### Worker cannot spawn sandbox containers

The worker needs access to the Docker socket. Verify the mount:

```bash
docker exec superroo-worker docker ps
```

If this fails, ensure `/var/run/docker.sock` exists on the host and is mounted correctly.

### Redis connection refused

```bash
docker compose -f cloud/docker/docker-compose.yml logs redis
```

Check that Redis started successfully and the API/Worker are using `redis://redis:6379` (not `127.0.0.1`).

### Port conflicts with host services

If host services are already using ports 6379, 8787, 3001, 8081, or 8790:

1. Stop the host services: `pm2 stop superroo-api superroo-worker superroo-dashboard superroo-mini-ide`
2. Or change the mapped ports in docker-compose.yml (e.g., `"8788:8787"`)

### Container keeps restarting

```bash
# Check container logs
docker compose -f cloud/docker/docker-compose.yml logs superroo-api

# Check container exit code
docker inspect superroo-api --format '{{.State.ExitCode}}'

# Restart with clean state
docker compose -f cloud/docker/docker-compose.yml down
docker compose -f cloud/docker/docker-compose.yml up -d
```

## Notes

- **Worker needs Docker socket** (`/var/run/docker.sock`) to spawn sandbox containers for job execution. This is a Docker-in-Docker pattern, which is acceptable because the worker only manages sandbox containers, not the Compose stack itself.
- **nginx stays on host** — it proxies to `localhost:8787`, `localhost:3001`, `localhost:8081` as before.
- **Auto-deployer can stay on PM2** — it needs to run `git pull` and `docker compose` commands, which is simpler on the host.
- **All container-to-container communication** uses Docker DNS service names (e.g., `redis:6379`, `superroo-api:8787`).
- **No `host.docker.internal` needed** — all dependencies are containerized.
