# SuperRoo Hybrid Docker Deployment

## Architecture

```
Host (PM2):
  ├── superroo-worker        ← keeps Docker sandbox access
  ├── superroo-auto-deployer ← keeps deploy script access
  └── redis                  ← keeps existing data

Docker Compose:
  ├── superroo-api           ← containerized (port 8787)
  ├── superroo-dashboard     ← containerized (port 3001)
  └── superroo-mini-ide      ← containerized (port 8081)
```

## Prerequisites

- Docker and Docker Compose installed on VPS
- `.env` file with secrets (see below)
- PM2 still running for worker, auto-deployer, redis

## Environment Variables

Create `cloud/docker/.env`:

```bash
TELEGRAM_BOT_TOKEN=8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ
SUPERROO_VAULT_KEY=D16PFwmjzXtmpEfFSYrAepsaveOB+fLuneeuQrvTYVw=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=marketing.homeu1@gmail.com
SMTP_PASS=ouhx sjib hyoj aayv
SMTP_FROM=marketing.homeu1@gmail.com
```

## Deploy

```bash
# 1. SSH into VPS via Tailscale
ssh root@100.64.175.88

# 2. Navigate to project
cd /opt/superroo2

# 3. Pull latest code
git pull

# 4. Build and start containers
docker compose -f cloud/docker/docker-compose.yml --env-file cloud/docker/.env up -d --build

# 5. Verify health
docker compose -f cloud/docker/docker-compose.yml ps
curl -f http://localhost:8787/api/health
curl -f http://localhost:3001
curl -f http://localhost:8081

# 6. Stop old PM2 services (only after Docker is verified)
pm2 stop superroo-api superroo-dashboard superroo-mini-ide
pm2 delete superroo-api superroo-dashboard superroo-mini-ide
pm2 save
```

## Rollback

```bash
# Stop Docker containers
docker compose -f cloud/docker/docker-compose.yml down

# Restart PM2 services
cd /opt/superroo2/cloud
pm2 start ecosystem.config.js --only superroo-api,superroo-dashboard,superroo-mini-ide
pm2 save
```

## Monitoring

```bash
# Container logs
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-api
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-dashboard
docker compose -f cloud/docker/docker-compose.yml logs -f superroo-mini-ide

# Container stats
docker stats

# PM2 logs (worker, auto-deployer, redis)
pm2 logs superroo-worker
pm2 logs superroo-auto-deployer
```

## Rebuild After Code Changes

```bash
cd /opt/superroo2
git pull
docker compose -f cloud/docker/docker-compose.yml up -d --build
```

## Notes

- **Worker stays on PM2** because it needs to spawn Docker sandbox containers (Docker-in-Docker is a security risk)
- **Auto-deployer stays on PM2** because it needs to run `git pull` and `docker compose` commands
- **Redis stays on host** to avoid data migration risk
- Containers connect to host Redis via `host.docker.internal:6379`
- Container-to-container communication uses Docker DNS (`superroo-api:8787`)
- nginx stays on host, proxies to `localhost:8787`, `localhost:3001`, `localhost:8081`
