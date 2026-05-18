# SuperRoo Docker Deployment

Hybrid containerization: API, Dashboard, Mini-IDE, and Redis run in Docker;
Worker and Auto-Deployer stay on host PM2 (they need Docker socket / git SSH access).

## Quick Start

```bash
cd cloud/docker
docker compose up -d
```

This starts:

- **Redis** on port `6379`
- **API** on port `8787`
- **Dashboard** on port `3001`
- **Mini-IDE** on port `8081`

## Services

| Service       | Container            | Port | Memory Limit | Notes                            |
| ------------- | -------------------- | ---- | ------------ | -------------------------------- |
| Redis         | `redis:7-alpine`     | 6379 | 256 MB       | Persistent AOF volume            |
| API           | `superroo-api`       | 8787 | 256 MB       | Node.js 20, orchestrator DB      |
| Dashboard     | `superroo-dashboard` | 3001 | 256 MB       | Next.js 14 standalone            |
| Mini-IDE      | `superroo-mini-ide`  | 8081 | 256 MB       | File upload volume               |
| Worker        | **PM2 on host**      | —    | 512 MB       | Needs Docker sandbox spawn       |
| Auto-Deployer | **PM2 on host**      | —    | 128 MB       | Needs `git pull` + Docker socket |

## Why Hybrid?

- **Worker** spawns Docker sandbox containers for code execution. Running it inside Docker requires Docker-in-Docker (DinD), which is a security risk. Keeping it on host PM2 is safer.
- **Auto-Deployer** runs `git pull`, `docker build`, and `docker compose` commands. It needs the host Docker socket and SSH keys.
- **Redis** on host would require data migration. A Docker volume with AOF persistence is simpler.

## Optional Full Container Mode

If you want everything in containers (accepting the DinD trade-off):

```bash
docker compose --profile full up -d
```

This also starts `superroo-worker` and `superroo-auto-deployer` containers.
**Warning:** These containers mount `/var/run/docker.sock` and `~/.ssh` respectively.

## Environment Variables

Create a `.env` file in `cloud/docker/`:

```env
# API
REDIS_URL=redis://redis:6379
ORCHESTRATOR_DB_PATH=/opt/superroo2/cloud/orchestrator/data/orchestrator.db

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:8787

# Mini-IDE
MINI_IDE_PORT=8081
SUPERROO_API_URL=http://superroo-api:8787
```

## Health Checks

All services have Docker healthchecks:

```bash
# Check all service health
docker compose ps

# View logs
docker compose logs -f superroo-api
docker compose logs -f superroo-dashboard
```

## PM2 Services (on host)

```bash
# Worker
pm2 start cloud/worker/worker.js --name superroo-worker

# Auto-Deployer
pm2 start cloud/auto-deployer/auto-deployer.js --name superroo-auto-deployer

# Save PM2 config
pm2 save
```

## Network

All containers share a dedicated bridge network `superroo-net` (`172.28.0.0/16`).
Services communicate by container name:

- Dashboard → API: `http://superroo-api:8787`
- Mini-IDE → API: `http://superroo-api:8787`
- API → Redis: `redis://redis:6379`

## Volumes

| Volume              | Purpose                   |
| ------------------- | ------------------------- |
| `orchestrator-data` | Orchestrator SQLite DB    |
| `hermes-data`       | Hermes data files         |
| `uploads`           | Mini-IDE file uploads     |
| `logs`              | Shared logs directory     |
| `redis-data`        | Redis AOF persistence     |
| `workspaces`        | Worker sandbox workspaces |

## Updating

```bash
cd cloud/docker
docker compose pull
docker compose up -d --build
```

## Troubleshooting

**Dashboard shows "API unreachable"**

- Check `NEXT_PUBLIC_API_URL` is correct (must be reachable from browser)
- Verify API health: `curl http://localhost:8787/health`

**Worker cannot spawn sandboxes**

- Ensure Worker is running on host PM2, not in Docker
- Check Docker socket permissions

**Redis connection refused**

- Verify Redis container is healthy: `docker compose ps redis`
- Check `REDIS_URL` matches the Docker network hostname
