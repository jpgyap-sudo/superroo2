# SuperRoo2 Quick Start

Get SuperRoo2 running in under 2 minutes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Desktop or Engine 24+)
- [Node.js](https://nodejs.org/) 20+ (for manual setup)
- [pnpm](https://pnpm.io/installation) (install via `npm install -g pnpm`)

## Option 1: One-Click Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/jpgyap-sudo/superroo2.git
cd superroo2

# Start the full stack — API, Dashboard, Postgres, Redis
docker compose up -d

# Open the dashboard
open http://localhost:3001
```

**What you get:**

- **Cloud Dashboard** — 50+ live views for agents, jobs, queue, memory, deployments
- **Cloud API** — 200+ endpoints for orchestration, debugging, memory, and deployment
- **PostgreSQL + pgvector** — Central Brain persistent memory
- **Redis** — Task queue and job management
- **Mini IDE** — Browser-based Monaco Editor with file tree, terminal, AI chat

## Option 2: Manual Setup

```bash
# Clone
git clone https://github.com/jpgyap-sudo/superroo2.git
cd superroo2

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start the cloud dashboard (terminal 1)
cd cloud/dashboard
pnpm dev
# → http://localhost:3000

# Start the API server (terminal 2)
cd cloud/api
node api.js
# → http://localhost:8787
```

## First-Run Checklist

1. **Open the Dashboard** at [`http://localhost:3001`](http://localhost:3001) (Docker) or [`http://localhost:3000`](http://localhost:3000) (manual)
2. **Check system health** — The Overview tab shows live agent status, queue depth, and memory stats
3. **Explore the Memory Explorer** — Browse lessons, pgvector memories, and agent scores
4. **Try the Mini IDE** — Open the Mini IDE tab to access the browser-based cloud IDE
5. **Configure providers** — Add API keys for AI providers in Settings (OpenAI, DeepSeek, Anthropic, etc.)

## Key URLs

| Service         | Docker URL              | Manual URL              |
| --------------- | ----------------------- | ----------------------- |
| Cloud Dashboard | `http://localhost:3001` | `http://localhost:3000` |
| Cloud API       | `http://localhost:8787` | `http://localhost:8787` |
| Mini IDE        | `http://localhost:8081` | `http://localhost:8081` |
| PostgreSQL      | `localhost:5432`        | (your local instance)   |
| Redis           | `localhost:6379`        | (your local instance)   |

## Next Steps

- [Architecture Deep Dive](ARCHITECTURE.md) — Understand the system design
- [Product Roadmap](ROADMAP.md) — See what's coming next
- [Security Model](SECURITY_MODEL.md) — Review security architecture
- [Onboarding Guide](docs/super-roo/ONBOARDING_GUIDE.md) — Full walkthrough
- [Deployment Guide](docs/super-roo/DEPLOYMENT_GUIDE.md) — Deploy to VPS

## Troubleshooting

**Port already in use?** Edit `docker-compose.yml` to change port mappings, or stop conflicting services.

**Docker not starting?** Ensure Docker Desktop is running and has at least 4 GB of memory allocated.

**Dashboard shows "API Unreachable"?** The API server may still be starting. Wait 10–15 seconds and refresh.

**Need help?** Join our [Discord](https://discord.gg/superroo) or post on [r/SuperRoo](https://www.reddit.com/r/SuperRoo/).
