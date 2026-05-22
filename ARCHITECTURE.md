# 🏗️ SuperRoo Architecture

> **High-level overview of the SuperRoo system — how agents, memory, orchestration, and infrastructure fit together.**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    SuperRoo Orchestrator                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │ PM Agent │ │Coder Agent│ │Debugger  │ │ Tester   │ │Safety  │  │  │
│  │  │          │ │          │ │Agent     │ │ Agent    │ │Manager │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ Healing  │ │ ML Engine│ │ Infinite │ │ Product Memory       │  │  │
│  │  │ Module   │ │(Learners)│ │Improve.  │ │ (Features, Bugs)     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ CPU Guard│ │ Parallel │ │ Crawler  │ │ LogAggregator        │  │  │
│  │  │          │ │Executor  │ │ Agent    │ │ (buffered JSONL)     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud Dashboard (Next.js 14)                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Overview │ Working Tree │ Memory Explorer │ Deploy Orchestrator  │  │
│  │  Agents   │ Jobs/Queue   │ Model Router    │ Settings / API Keys  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud API (Express, port 8787)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Telegram │ │ Auth     │ │Monitoring│ │ Healing  │ │ Savepoint    │  │
│  │ Bot      │ │ (JWT/OTP)│ │ Routes   │ │ Metrics  │ │ Service      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud Workers                                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────┐  │
│  │ Auto-Deployer    │ │ Debug Job Runner │ │ Sandbox Runner        │  │
│  │ (watches GitHub) │ │ (runs debug jobs)│ │ (isolated containers) │  │
│  └──────────────────┘ └──────────────────┘ └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         External Services                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ GitHub   │ │ Supabase │ │ Telegram │ │DigitalOcean│ │ n8n          │  │
│  │ (CI/CD)  │ │ (DB/Auth)│ │ (Bot API)│ │ (VPS)     │ │ (Workflows)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### 1. Orchestrator

The central task dispatcher. Routes work to the right agent, manages agent lifecycle, and coordinates workflows.

- **Source**: [`src/super-roo/orchestrator/`](src/super-roo/orchestrator/)
- **Status**: Stable
- **Connections**: All agents, Safety System, Memory System, Task Queue

### 2. Agent System

A registry of specialized AI agents that handle different types of work:

| Agent                  | Role                                    |
| ---------------------- | --------------------------------------- |
| **Coder Agent**        | Code generation & implementation        |
| **Debugger Agent**     | Bug investigation & root cause analysis |
| **PM Agent**           | Product management & feature tracking   |
| **Tester Agent**       | Test execution & coverage analysis      |
| **Self-Healing Agent** | Automatic incident detection & repair   |

- **Source**: [`src/super-roo/agents/`](src/super-roo/agents/)
- **Status**: Stable

### 3. Safety System

Mode-based access control, capability gating, and approval workflows. Ensures agents operate within their allowed scope.

- **Source**: [`src/super-roo/safety/`](src/super-roo/safety/)
- **Status**: Stable

### 4. Memory System

Persistent storage for all entities — tasks, agents, features, bugs, events. Uses SQLite for the VS Code extension and PostgreSQL/pgvector for the cloud.

- **Source**: [`src/super-roo/memory/`](src/super-roo/memory/)
- **Status**: Stable

### 5. Central Brain (v2)

The cross-project AI integration hub. Provides semantic memory search, lesson storage, MCP protocol support, and real-time events.

- **Source**: [`server/src/memory/`](server/src/memory/)
- **Database**: PostgreSQL + pgvector
- **MCP Server**: Port 3419
- **Status**: Stable

### 6. Self-Healing System

Detects incidents, classifies root causes, builds repair plans, applies fixes, and verifies success — all autonomously.

- **Components**: Healing Bus, Root Cause Classifier, Repair Plan Builder, Self-Healing Loop
- **Status**: Beta

### 7. ML Engine

Neural network infrastructure with Tensor operations, layers, optimizers, and loss functions. Powers CodeLearner, DebugLearner, and TestLearner.

- **Status**: Beta (cloud port in progress)

### 8. Debug Team

Autonomous multi-agent debugging system. Breaks complex problems into phases, runs hypothesis-driven iteration, and auto-generates skills from failures.

- **Components**: Super Debug Loop, Phase Breakdown Engine, Hypothesis Engine, Container Sandbox, Rollback Manager
- **Status**: Beta

### 9. Parallel Execution Engine

Enables parallel healing pipelines and parallel ML training across multiple workers.

- **Status**: Alpha

### 10. Cloud Sandbox

Docker-based container orchestration for safe, isolated code execution. Supports snapshot/restore, network simulation, and self-healing containers.

- **Source**: [`cloud/orchestrator/modules/`](cloud/orchestrator/modules/)
- **Status**: Stable

---

## Data Flow

### Agent Task Execution

```
User Request
    │
    ▼
Orchestrator ──► Safety Check ──► Agent Selection
    │                                      │
    │                                      ▼
    │                              Agent Execution
    │                              │
    │                              ├──► Read Memory (lessons, context)
    │                              ├──► Execute Task
    │                              ├──► Write Memory (new lessons)
    │                              └──► Report Result
    │                                      │
    ▼                                      ▼
Event Log ◄────────────────────────── Result + Metrics
```

### Lesson Lifecycle

```
Agent completes task
    │
    ▼
Extract lesson (post-commit hook or manual)
    │
    ├──► Local: memory/lessons-learned.md + memory/lesson-index.jsonl
    │
    └──► Central Brain (via MCP): brain_store_lesson
              │
              ▼
         pgvector semantic search
              │
              ▼
         Other agents query lessons before starting work
```

### Deployment Pipeline

```
Agent commits code
    │
    ▼
CommitDeployLog.recordCommit()
    │
    ▼
DeployOrchestrator.deploy()
    │
    ├──► Health check (pre-deploy)
    ├──► Build via UnifiedBuilder / BuildQueue
    ├──► Deploy to VPS (Tailscale SSH)
    ├──► Health check (post-deploy)
    │
    ├── Healthy? ──► Record deploy success
    └── Unhealthy? ──► Auto-rollback to last good version
```

---

## Infrastructure

### Local Development

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│  VS Code  │    │  API     │    │  Redis   │
│  Extension│◄──►│  :8787   │◄──►│  :6379   │
└──────────┘    └────┬─────┘    └──────────┘
                     │
                     ▼
              ┌──────────┐    ┌──────────┐
              │ Postgres │    │  Ollama  │
              │  :5432   │    │  :11434  │
              └──────────┘    └──────────┘
```

### Production (VPS)

```
DigitalOcean Droplet (4GB RAM, 2 vCPU)
    │
    ├──► Docker: API, Dashboard, Mini-IDE, Worker, Auto-Deployer
    ├──► Docker: Redis, PostgreSQL + pgvector
    ├──► Host: Ollama (local LLM + embeddings)
    ├──► Host: MCP Server (port 3419)
    │
    └──► Tailscale SSH (100.64.175.88)
```

### Port Map

| Port  | Service      | Description            |
| ----- | ------------ | ---------------------- |
| 3001  | Dashboard    | Next.js web UI         |
| 8787  | API          | Express REST API       |
| 6379  | Redis        | Queue backend          |
| 5432  | PostgreSQL   | Central Brain database |
| 11434 | Ollama       | Local LLM + embeddings |
| 3417  | Brain Daemon | Central Brain daemon   |
| 3419  | MCP Server   | MCP protocol server    |
| 8081  | Mini-IDE     | Cloud IDE terminal     |

---

## Technology Stack

| Layer          | Technology                                           |
| -------------- | ---------------------------------------------------- |
| **Extension**  | TypeScript, VS Code API, React                       |
| **Dashboard**  | Next.js 14, React 18, Tailwind CSS, Recharts, Lucide |
| **API**        | Node.js, Express, BullMQ, IORedis                    |
| **Database**   | PostgreSQL 16 + pgvector, SQLite                     |
| **Queue**      | Redis 7 + BullMQ                                     |
| **AI Models**  | OpenAI, Anthropic, DeepSeek, Ollama (local)          |
| **Container**  | Docker, Docker Compose                               |
| **Deployment** | Tailscale SSH, DigitalOcean                          |
| **MCP**        | Model Context Protocol (stdio + HTTP)                |
| **CI/CD**      | GitHub Actions                                       |

---

## Key Design Decisions

1. **Local-first memory**: Lessons are stored locally (JSONL + Markdown) before syncing to Central Brain. No single point of failure.

2. **Tailscale for all SSH**: Never use public IPs for SSH. Tailscale provides encrypted mesh networking with automatic key rotation.

3. **DeepSeek as default coder**: Cost-effective coding with Ollama for local embeddings. OpenAI/Anthropic reserved for complex reasoning.

4. **BullMQ for task queuing**: Redis-backed priority queues with job deduplication, retry, and scheduling.

5. **pgvector for semantic search**: PostgreSQL extension enables vector similarity search alongside relational queries — no separate vector database needed.

6. **MCP for agent communication**: Model Context Protocol provides a standardized interface for AI agents to interact with the system.

---

_For detailed module documentation, see [`docs/resources/working-tree.md`](docs/resources/working-tree.md). For architecture diagrams, see [`docs/super-roo/ARCHITECTURE_DIAGRAMS.md`](docs/super-roo/ARCHITECTURE_DIAGRAMS.md)._
