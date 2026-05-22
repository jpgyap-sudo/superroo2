<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=SuperRoo.superroo"><img src="https://img.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace"></a>
  <a href="https://x.com/superroo"><img src="https://img.shields.io/badge/superroo-000000?style=flat&logo=x&logoColor=white" alt="X"></a>
  <a href="https://youtube.com/@superrooyt?feature=shared"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://discord.gg/superroo"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join Discord"></a>
  <a href="https://www.reddit.com/r/SuperRoo/"><img src="https://img.shields.io/badge/Join%20r%2FSuperRoo-FF4500?style=flat&logo=reddit&logoColor=white" alt="Join r/SuperRoo"></a>
</p>

<h1 align="center">SuperRoo</h1>
<p align="center"><strong>Autonomous AI Engineering Platform — Central Brain · Cloud Dashboard · Telegram Control Plane · Self-Healing</strong></p>

<p align="center">
  SuperRoo is a full-stack AI engineering system that plans, codes, tests, deploys, observes, learns, and repairs — all through an auditable multi-agent workflow. It combines a VS Code extension, a cloud dashboard, a Telegram operator interface, persistent Central Brain memory, deployment orchestration, and self-healing incident pipelines.
</p>

<p align="center">
  <a href="#-one-click-demo">One-Click Demo</a> ·
  <a href="#-what-makes-superroo-different">What Makes SuperRoo Different</a> ·
  <a href="#-operator-surfaces">Operator Surfaces</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="ARCHITECTURE.md">Architecture Deep Dive</a> ·
  <a href="SECURITY_MODEL.md">Security Model</a>
</p>

---

## 🚀 One-Click Demo

```bash
# Start the full SuperRoo stack — API, Dashboard, Postgres, Redis
docker compose up -d

# Open http://localhost:3001
# The dashboard auto-discovers your agents and shows live system status
```

**What you get:** Cloud Dashboard (Next.js), Cloud API (Express), PostgreSQL + pgvector (Central Brain), Redis (queue). All containerized, zero configuration.

> **Prerequisites:** Docker, Node.js 20+. See [Local Development](#-local-development) for manual setup.

---

## 🧠 What Makes SuperRoo Different

SuperRoo isn't just another AI coding tool. It's a **complete engineering platform** that treats AI agents as first-class team members with memory, accountability, and self-healing capabilities.

### 🔁 Agents That Learn From Mistakes

Most AI coding tools start fresh every session. SuperRoo's **Central Brain** stores cross-project lessons, task history, model decisions, and reusable engineering knowledge. Agents query this memory before starting work and contribute new lessons after every task. Mistakes are captured once and never repeated.

```bash
# Query lessons across all projects
superroo-learn query "how to fix database connection leaks"

# Store a lesson manually
superroo-learn store "React performance" "Disable strict mode in production to avoid double-rendering"
```

### 🩺 Self-Healing Infrastructure

When something breaks, SuperRoo doesn't just log it — it **diagnoses, repairs, and verifies** automatically. The Self-Healing Loop detects incidents, classifies root causes, builds repair plans, tracks repair attempts, and escalates repeated failures to human operators.

### 🧪 Parallel Swarm Debugging

Instead of debugging one hypothesis at a time, SuperRoo runs **logs, Docker, database, security, regression, and memory agents simultaneously** to diagnose incidents. The Swarm Debugger coordinates these agents in parallel and synthesizes findings into a unified diagnosis.

### 🚦 Predictive Deployment Risk

Before every deployment, the **Predictive Risk Engine** assesses risk using historical failure patterns. If risk exceeds thresholds, deployments are gated behind consensus-based approval. Health checks run before and after deployment, with automatic rollback on failure.

### 🎮 Three Operator Surfaces

| Surface                     | Best For                                 |
| --------------------------- | ---------------------------------------- |
| **VS Code Extension**       | Day-to-day coding, debugging, testing    |
| **Cloud Dashboard**         | System monitoring, operations, analytics |
| **Telegram Bot / Mini IDE** | Remote operations, approvals, alerts     |

Switch between surfaces without losing context — they share the same workspace state, memory, and orchestration layer.

### 📚 Institutional Memory That Persists

Every commit, every deployment, every bug fix, every model decision is recorded in the **Commit & Deploy Log** and the **Learning Layer**. This isn't just logging — it's structured, searchable, cross-project institutional memory that makes every agent smarter over time.

### 🏗️ Built for Extensibility

- **MCP Server Manager** — Add custom MCP servers for tools, resources, and prompts
- **Provider Registry** — Auto-discovers AI providers, tracks cost/latency, selects cheapest for task type
- **Collaboration System** — Real-time multi-user sessions with cursor sync and file broadcast
- **Cloud Sandbox** — Docker container orchestration with pooling, snapshot/restore, network simulation

---

## 🎮 Operator Surfaces

### 1. VS Code Extension

Work where the code lives. The extension provides:

- Multi-agent orchestration for coding, debugging, testing, and deployment
- Persistent product memory for features, bugs, updates, commits, and deployments
- Safety controls for approval gates, autonomy levels, command restrictions, and rollback
- Model routing across provider-specific strengths

### 2. Cloud Dashboard

The main operational hub at [`cloud/dashboard/`](cloud/dashboard/):

- **50+ live views** — agents, jobs, queue, logs, monitoring, healing, deployments, model routing, product memory, workflow compliance, and more
- **Memory Explorer** — browse lessons, pgvector memories, agent scores, brain events, and pending approvals
- **Predictive Risk** — assess deployment risk, run swarm debugging, view failure patterns
- **Working Tree** — visualize all 18 core modules, their connections, and feature registry
- **PWA-ready** — installable as a standalone app with service worker caching
- **Real-time updates** — 5-second polling for system metrics, health status, and activity feed

### 3. Telegram Mini IDE

A browser-based cloud IDE with a VS Code-like interface (activity bar, sidebar, tabs, bottom panel, status bar). It shares workspace state with the Cloud Dashboard so you can switch between surfaces without losing context.

**Features:** File CRUD, collapsible file tree, auto-save, search, git integration, terminal, AI chat, diff viewer, pipeline visualization, minimap, settings persistence, WebSocket RPC.

### 4. Telegram Bot

Operate the system remotely with alerting and approval workflows. Supports:

- `/autonomous` — run autonomous improvement loop
- `/commissioning` — run commissioning tests
- `/orchestrate` — submit tasks to the orchestrator
- `/auto-deploy` — trigger automated deployment

### 5. Central Brain / Learning CLI

Query and store lessons across projects with local-first fallback:

```bash
# Query lessons across all projects
superroo-learn query "how to fix database connection leaks"

# Store a lesson manually
superroo-learn store "React performance" "Disable strict mode in production to avoid double-rendering"

# Check system health
superroo-learn health
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Operator Surfaces                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ VS Code  │  │ Cloud        │  │ Telegram         │   │
│  │ Extension│  │ Dashboard    │  │ Mini IDE / Bot   │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
│       │               │                   │             │
├───────┴───────────────┴───────────────────┴─────────────┤
│                    API Layer (Express)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Cloud    │  │ Mini IDE │  │ Telegram │  │ Brain  │  │
│  │ API      │  │ API      │  │ Bot API  │  │ API    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
├───────┴──────────────┴──────────────┴──────────────┴─────┤
│                    Core Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Orchestrator │  │ Self-Healing │  │ Deploy       │   │
│  │              │  │ Loop         │  │ Orchestrator │   │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤   │
│  │ Swarm        │  │ Predictive   │  │ Learning     │   │
│  │ Debugger     │  │ Risk Engine  │  │ Gateway      │   │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤   │
│  │ Model Router │  │ Provider     │  │ Safety       │   │
│  │              │  │ Bridge       │  │ Manager      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
├─────────┴─────────────────┴──────────────────┴──────────┤
│                    Data Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Central  │  │ pgvector │  │ Redis    │  │ Local  │  │
│  │ Brain    │  │ (memory) │  │ (queue)  │  │ Files  │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
└─────────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into each layer, data flow, and module interactions.

---

## 🧩 Core Modules

| Module                     | Location                                                                                                                   | Description                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Cloud API**              | [`cloud/api/api.js`](cloud/api/api.js)                                                                                     | Express server — 200+ endpoints for dashboard, agents, Telegram, brain, deploy, sandbox, and more |
| **Cloud Dashboard**        | [`cloud/dashboard/`](cloud/dashboard/)                                                                                     | Next.js dashboard — 50+ views, real-time monitoring, PWA                                          |
| **Orchestrator**           | [`cloud/orchestrator/`](cloud/orchestrator/)                                                                               | Task queue, parallel execution, autonomous loop, commissioning                                    |
| **Self-Healing Loop**      | [`cloud/orchestrator/modules/SelfHealingLoop.js`](cloud/orchestrator/modules/SelfHealingLoop.js)                           | Incident detection, classification, repair, verification, escalation                              |
| **Swarm Debugger**         | [`cloud/orchestrator/stores/brain/SwarmDebugger.js`](cloud/orchestrator/stores/brain/SwarmDebugger.js)                     | Parallel multi-agent debugging (logs, Docker, DB, security, regression, memory)                   |
| **Predictive Risk Engine** | [`cloud/orchestrator/stores/brain/PredictiveFailureEngine.js`](cloud/orchestrator/stores/brain/PredictiveFailureEngine.js) | Risk assessment, failure pattern tracking, deployment gating                                      |
| **Central Brain**          | [`cloud/orchestrator/stores/brain/`](cloud/orchestrator/stores/brain/)                                                     | pgvector memory, agent scores, event bus, approval system                                         |
| **Deploy Orchestrator**    | [`cloud/orchestrator/modules/DeployOrchestrator.js`](cloud/orchestrator/modules/DeployOrchestrator.js)                     | Queue, build, deploy, health check, rollback                                                      |
| **Telegram Bot**           | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js)                                                                     | Telegram integration — commands, approvals, notifications                                         |
| **Mini IDE**               | [`cloud/mini-ide/`](cloud/mini-ide/)                                                                                       | Browser-based cloud IDE with Monaco editor                                                        |
| **Learning Layer**         | [`src/super-roo/lessons/`](src/super-roo/lessons/)                                                                         | Lesson capture, indexing, retrieval, cross-project sync                                           |
| **Safety Manager**         | [`cloud/orchestrator/modules/SafetyManager.js`](cloud/orchestrator/modules/SafetyManager.js)                               | Approval gates, command restrictions, path guards                                                 |
| **Collaboration**          | [`cloud/collaboration/`](cloud/collaboration/)                                                                             | Real-time multi-user sessions, cursor sync, file broadcast                                        |
| **MCP Server Manager**     | [`cloud/orchestrator/modules/MCPServerManager.js`](cloud/orchestrator/modules/MCPServerManager.js)                         | MCP lifecycle, health checks, tool discovery                                                      |
| **Sandbox**                | [`cloud/sandbox/`](cloud/sandbox/)                                                                                         | Docker container orchestration, pooling, network simulation                                       |

---

## 🛠️ Local Development

### Prerequisites

- Node.js 20+ (see [`.nvmrc`](.nvmrc))
- pnpm (install via `npm install -g pnpm`)
- Docker (for sandbox features and one-click demo)
- Redis (for queue features)

### Quick Start (Manual)

```bash
# Clone
git clone https://github.com/SuperRooInc/SuperRoo.git
cd SuperRoo

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start the cloud dashboard
cd cloud/dashboard
pnpm dev
# Open http://localhost:3000

# Start the API server (in another terminal)
cd cloud/api
node api.js
```

### Docker (One-Click)

```bash
# Start everything — API, Dashboard, Postgres, Redis
docker compose up -d

# Open http://localhost:3001
```

### VS Code Extension Development

```bash
# Development mode — press F5 in VS Code
# This opens a new window with the extension running

# Or build and install a VSIX
pnpm install:vsix

# Manual build
pnpm vsix
# Install: code --install-extension bin/superroo-<version>.vsix
```

### Running Tests

```bash
# Backend tests
cd src && npx vitest run tests/user.test.ts

# UI tests
cd webview-ui && npx vitest run src/path/to/test-file

# Dashboard E2E tests
cd cloud/dashboard && npx playwright test
```

### Environment Variables

| Variable             | Default | Description                              |
| -------------------- | ------- | ---------------------------------------- |
| `PORT`               | `8787`  | Cloud API server port                    |
| `REDIS_URL`          | —       | Redis connection string for queue        |
| `DATABASE_URL`       | —       | PostgreSQL connection for pgvector       |
| `TELEGRAM_BOT_TOKEN` | —       | Telegram bot token                       |
| `GITHUB_TOKEN`       | —       | GitHub API token                         |
| `MINI_IDE_PORT`      | `8081`  | Mini IDE server port                     |
| `WORKSPACE_ROOT`     | `""`    | Root directory for workspace file access |
| `DASHBOARD_API_URL`  | `""`    | Proxy advanced features to dashboard API |

---

## 🔐 Security

SuperRoo handles sensitive infrastructure — MCP servers, VPS endpoints, Tailscale IPs, brain endpoints, and autonomous execution. See [SECURITY_MODEL.md](SECURITY_MODEL.md) for the full security model.

Key security measures:

- **`.gitignore`** — MCP config, SSH keys, Tailscale configs, runtime state, and test artifacts are excluded from version control
- **`.mcp.json`** — Contains local/Tailscale endpoints and model routing details; excluded from git
- **Safety Manager** — Approval gates, command restrictions, path traversal guards, self-improvement boundary checks
- **Deploy Gate** — Risk assessment before deployment, consensus-based approval, automatic rollback on health check failure
- **Auth** — Bearer token authentication for dashboard API, Telegram initData for Mini IDE
- **Rate Limiting** — IP-based rate limiting on API endpoints

> **⚠️ Production Deployment:** Never commit `.env`, `.mcp.json`, `*.pem`, `id_*`, or `tailscale-*.json` to version control. Use the [Deployment Guide](docs/super-roo/DEPLOYMENT_GUIDE.md) for secure VPS setup.

---

## 📚 Documentation

| Document                                                          | Description                               |
| ----------------------------------------------------------------- | ----------------------------------------- |
| [Architecture Deep Dive](ARCHITECTURE.md)                         | System architecture, data flow, modules   |
| [Security Model](SECURITY_MODEL.md)                               | Security architecture and threat model    |
| [Product Roadmap](ROADMAP.md)                                     | Current status and future plans           |
| [Onboarding Guide](docs/super-roo/ONBOARDING_GUIDE.md)            | Get started with SuperRoo                 |
| [Deployment Guide](docs/super-roo/DEPLOYMENT_GUIDE.md)            | Deploy to VPS with Tailscale SSH          |
| [Central Brain](docs/super-roo/CENTRAL_BRAIN.md)                  | Memory, lessons, and knowledge management |
| [Self-Healing Guide](docs/super-roo/HEALING_MODULE_GUIDE.md)      | Incident detection and repair pipeline    |
| [Debug Team Guide](docs/super-roo/DEBUG_TEAM_GUIDE.md)            | Multi-agent parallel debugging            |
| [Working Tree](docs/resources/working-tree.md)                    | Product architecture — all 18 modules     |
| [ML Engine Guide](docs/super-roo/ML_ENGINE_GUIDE.md)              | ML engine API and usage                   |
| [Autonomous Loop Guide](docs/super-roo/AUTONOMOUS_LOOP_GUIDE.md)  | Autonomous improvement loop               |
| [Commissioning Guide](docs/super-roo/COMMISSIONING_LOOP_GUIDE.md) | Commissioning tests and phases            |
| [Hermes Claw Guide](docs/super-roo/HERMES_CLAW_GUIDE.md)          | Memory and context agent                  |
| [Troubleshooting](docs/super-roo/TROUBLESHOOTING.md)              | Common issues and solutions               |
| [Architecture Diagrams](docs/super-roo/ARCHITECTURE_DIAGRAMS.md)  | System architecture diagrams              |
| [API Reference](docs/super-roo/CLOUD_ORCHESTRATOR_PLAN.md)        | Cloud orchestrator API                    |

---

## 🤝 Contributing

We love community contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- **Report bugs** — Open a GitHub issue or post on [r/SuperRoo](https://www.reddit.com/r/SuperRoo/)
- **Feature requests** — Join our [Discord](https://discord.gg/superroo) or open a discussion
- **Code contributions** — Fork, branch, commit, and PR. All agents must register lesson intents before coding and store lessons after completion.

---

## 📄 License

[Apache 2.0 © 2025 SuperRoo, Inc.](./LICENSE)

---

<p align="center">
  <strong>SuperRoo</strong> — Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build.
  <br>
  <a href="https://discord.gg/superroo">Discord</a> ·
  <a href="https://www.reddit.com/r/SuperRoo/">Reddit</a> ·
  <a href="https://x.com/superroo">X</a> ·
  <a href="https://youtube.com/@superrooyt">YouTube</a>
</p>
