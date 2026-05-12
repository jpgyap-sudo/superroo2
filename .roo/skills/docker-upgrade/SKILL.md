# 🐳 Docker Upgrade Skill

**Trigger phrase**: `docker upgrade`

When the user invokes `docker upgrade`, reference this skill and the following plan documents to resume the Docker containerization work.

## Architecture Plans (Ready to Implement)

1. **[`plans/superroo-docker-architecture.md`](plans/superroo-docker-architecture.md)** — Multi-container Docker Compose design for SuperRoo (6 containers, 5 volumes)
2. **[`plans/superroo-docker-risks.md`](plans/superroo-docker-risks.md)** — Full risk analysis with mitigation strategies
3. **[`plans/superroo-docker-two-project-separation.md`](plans/superroo-docker-two-project-separation.md)** — Two-project separation: SuperRoo + Product Image Studio

## Key Decisions Already Made

- **Approach**: Multi-container Docker Compose (not single container, not Kubernetes)
- **Separation**: SuperRoo and Product Image Studio get their own Docker Compose stacks
- **Hybrid first**: Containerize API/dashboard/mini-ide first; keep worker on host PM2 (Docker-in-Docker risk)
- **Redis**: Separate Redis instance per stack (SuperRoo internal only, Product Studio on host:6380)
- **nginx**: Stays on host as shared reverse proxy
- **Migration order**: Product Studio first (already containerized), then SuperRoo

## Files to Create When Implementing

```
cloud/docker/
├── Dockerfile.api
├── Dockerfile.worker
├── Dockerfile.dashboard
├── Dockerfile.mini-ide
├── Dockerfile.auto-deployer
├── .dockerignore
└── docker-compose.yml
```

## VPS Context

- **Host**: DigitalOcean droplet, 4GB RAM, Ubuntu
- **Tailscale IP**: `100.64.175.88`
- **Public IP**: `104.248.225.250`
- **Domains**: `dev.abcx124.xyz` (SuperRoo), `render.abcx124.xyz` (Product Studio)
- **Current ports**: 8787 (API), 3001 (Dashboard), 8081 (Mini IDE), 8790 (Auto-deployer), 3002 (Product Studio)

## Current Status (As of last session)

- SuperRoo API is online with all 18 orchestrator modules initialized
- Dashboard was fixed from 502 Bad Gateway
- Old `pm2-superroo.service` (systemd) has been stopped and disabled
- Product Image Studio Docker container is running but shows `unhealthy`
- Auto-deployer PM2 process has 36 restarts and is stuck in `waiting restart`
