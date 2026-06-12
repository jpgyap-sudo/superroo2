# SuperRoo Central Brain

> **The canonical AI integration hub for the SuperRoo ecosystem.**
> Other AI bots connect here to access memory, context, analysis, coding, deployment, real-time events, skill generation, and agent orchestration capabilities.

## Quick Start

```bash
# Discover all capabilities (REST API)
curl https://dev.abcx124.xyz/api/brain

# Check health
curl https://dev.abcx124.xyz/api/health

# Query memory (semantic search)
curl -X POST https://dev.abcx124.xyz/api/orchestrator/hermes/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "how to deploy the app", "limit": 5}'

# Store a lesson
curl -X POST https://dev.abcx124.xyz/api/orchestrator/hermes/learn \
  -H "Content-Type: application/json" \
  -d '{"topic": "Deployment pattern", "content": "Always use Tailscale SSH, never public IP"}'

# Check commit/deploy history
curl https://dev.abcx124.xyz/api/orchestrator/commit-deploy-status?limit=5

# MCP Protocol — for Claude Code, Codex, Cursor, etc.
# Configure your MCP client to connect to:
#   command: npx tsx server/src/memory/McpMemoryServer.ts
#   env: { CENTRAL_BRAIN_URL: "http://127.0.0.1:3417" }
# Or use the REST API fallback:
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "query_memory", "params": {"query": "deployment patterns", "limit": 5}}'

# Real-Time Events (SSE stream)
curl -N https://dev.abcx124.xyz/api/brain/events

# Generate a skill from a failure pattern
curl -X POST https://dev.abcx124.xyz/api/brain/skill-generate \
  -H "Content-Type: application/json" \
  -d '{"failureType":"build","goal":"Always run tests before deploy","solution":"Add pre-deploy test hook"}'

# Agent Orchestration — run a task
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"run_task","params":{"goal":"Deploy latest","type":"deploy"}}'
```

## Base URL

| Environment      | URL                           | Description                          |
| ---------------- | ----------------------------- | ------------------------------------ |
| **Public API**   | `https://dev.abcx124.xyz/api` | REST API (port 8787 via nginx)       |
| **Internal API** | `http://127.0.0.1:8787`       | Direct REST API access               |
| **MCP Server**   | `http://127.0.0.1:3419`       | MCP protocol for Claude Code/Codex   |
| **Brain Daemon** | `http://127.0.0.1:3417`       | Docker daemon (internal MCP backend) |
| **Dashboard**    | `https://dev.abcx124.xyz`     | Web dashboard GUI                    |
| **Telegram Bot** | `@SuperRooBot` on Telegram    | Interactive bot interface            |

> **Note:** All API paths are accessible both with and without the `/api` prefix.
> E.g., both `https://dev.abcx124.xyz/api/health` and `https://dev.abcx124.xyz/health` work.

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │         External AI Bot / MCP Client │
                    │  (Claude Code, Codex, Cursor, etc.)  │
                    └──────────┬──────────┬───────────────┘
                               │          │
                    ┌──────────▼──┐ ┌─────▼──────────┐
                    │  REST API  │ │  MCP Server    │
                    │  (port 8787)│ │  (port 3419)   │
                    │  /api/brain │ │  MCP Protocol  │
                    │  /brain/mcp │ │  (fallback)    │
                    │  /brain/ws  │ │                 │
                    │  /brain/evts│ │                 │
                    └──────┬─────┘ └──────┬──────────┘
                           │              │
                    ┌──────▼──────────────▼──────┐
                    │    Central Brain Daemon    │
                    │    (port 3417, Docker)     │
                    │    /brain/mcp endpoint     │
                    └──────────┬─────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │  Hermes     │    │   Ollama    │    │   Cloud     │
    │  Claw       │    │  (Local)    │    │  Providers  │
    │  (Memory)   │    │  Cheap AI   │    │  (Coding)   │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
    ┌──────▼──────┐    ┌──────▼──────┐           │
    │ pgvector    │    │ hermes3│           │
    │ PostgreSQL  │    │ nomic-embed │           │
    │ (RAG Store) │    │ (Embeddings)│           │
    └─────────────┘    └─────────────┘           │
           │                                     │
           └──────────────┬──────────────────────┘
                          │
                 ┌────────▼────────┐
                 │  CommitDeploy   │
                 │  Log + Git      │
                 └─────────────────┘
```

## MCP Integration (Model Context Protocol)

The SuperRoo Central Brain supports the **Model Context Protocol (MCP)** for seamless integration with Claude Code, Codex, Cursor, and any MCP-compatible client.

### Option 1: Dedicated MCP Server (Recommended)

The dedicated MCP server runs at `http://127.0.0.1:3419` and proxies to the Central Brain daemon at `http://127.0.0.1:3417`, with REST API fallback at `http://127.0.0.1:8787`.

**MCP Server Config** (`mcp-superroo-config.json`):

```json
{
	"mcpServers": {
		"superroo-brain": {
			"command": "npx",
			"args": ["tsx", "server/src/memory/McpMemoryServer.ts"],
			"env": {
				"CENTRAL_BRAIN_URL": "http://127.0.0.1:3417",
				"REST_API_FALLBACK_URL": "http://127.0.0.1:8787",
				"MCP_SERVER_PORT": "3419",
				"MCP_SERVER_HOST": "127.0.0.1"
			},
			"description": "SuperRoo Central Brain MCP Server"
		}
	}
}
```

**Available MCP Tools:**

| Tool                     | Description                                    | Parameters                                                                                                     |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `query_memory`           | Search Central Brain memory with RAG context   | `query` (required), `project`, `maxResults`, `offset` (pagination)                                             |
| `get_project_info`       | Get project namespace details                  | `project`                                                                                                      |
| `list_projects`          | List all registered projects                   | _(none)_                                                                                                       |
| `register_project`       | Register a new project in local config         | `name` (required), `directory`                                                                                 |
| `get_active_task`        | Get current active task                        | `project`                                                                                                      |
| `get_recent_bugs`        | Get recent bugs and incidents                  | `project`, `limit`                                                                                             |
| `search_code`            | Search indexed code in Qdrant                  | `query` (required), `project`, `filePattern`, `maxResults`                                                     |
| `submit_task`            | Submit a new task to the orchestrator          | `goal` (required), `project`, `agent`                                                                          |
| `hermes_recall`          | Semantic memory search via Hermes Claw         | `query` (required), `limit`                                                                                    |
| `hermes_learn`           | Store a lesson via Hermes Claw (with dedup)    | `topic` (required), `content` (required)                                                                       |
| `hermes_learn_batch`     | Store multiple lessons in one call             | `lessons` (required, array of `{topic, content}`)                                                              |
| `hermes_list_skills`     | List all created skills                        | _(none)_                                                                                                       |
| `hermes_list_resources`  | List all knowledge resources                   | _(none)_                                                                                                       |
| `hermes_stats`           | Get Hermes Claw statistics                     | _(none)_                                                                                                       |
| `commit_deploy_status`   | Get commit/deploy history                      | `limit`                                                                                                        |
| `sync_status`            | Check connectivity to all backends             | _(none)_                                                                                                       |
| `codex_task_upsert`      | Create or update persistent Codex task memory  | `title` (required), `id`, `summary`, `status`, `project`, `agent`, `filesChanged`, `featuresAffected`, `notes` |
| `codex_task_list`        | List recent persistent Codex tasks             | `limit`                                                                                                        |
| `codex_task_get`         | Get one persistent Codex task                  | `id` (required)                                                                                                |
| `codex_task_get_active`  | Get the current active Codex task              | _(none)_                                                                                                       |
| `kimi_task_upsert`       | Create or update persistent Kimi task memory   | `title` (required), `id`, `summary`, `status`, `project`, `agent`, `filesChanged`, `featuresAffected`, `notes` |
| `kimi_task_list`         | List recent persistent Kimi tasks              | `limit`                                                                                                        |
| `kimi_task_get`          | Get one persistent Kimi task                   | `id` (required)                                                                                                |
| `kimi_task_get_active`   | Get the current active Kimi task               | _(none)_                                                                                                       |
| `claude_task_upsert`     | Create or update persistent Claude task memory | `title` (required), `id`, `summary`, `status`, `project`, `agent`, `filesChanged`, `featuresAffected`, `notes` |
| `claude_task_list`       | List recent persistent Claude tasks            | `limit`                                                                                                        |
| `claude_task_get`        | Get one persistent Claude task                 | `id` (required)                                                                                                |
| `claude_task_get_active` | Get the current active Claude task             | _(none)_                                                                                                       |

**Available MCP Resources:**

| URI                          | Description                        |
| ---------------------------- | ---------------------------------- |
| `memory://context`           | Full RAG context for superroo2     |
| `memory://tasks`             | Task list for superroo2            |
| `memory://bugs`              | Bug list for superroo2             |
| `memory://projects`          | All registered projects            |
| `memory://codex/tasks`       | Persistent Codex task history      |
| `memory://{project}/context` | RAG context for a specific project |
| `memory://{project}/tasks`   | Tasks for a specific project       |
| `memory://{project}/bugs`    | Bugs for a specific project        |

### Option 2: REST API Fallback (No MCP Client Needed)

If you don't have an MCP-compatible client, use the REST API MCP fallback endpoint:

```bash
# Query memory
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "query_memory", "params": {"query": "deployment patterns", "limit": 5}}'

# Store a lesson
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "hermes_learn", "params": {"topic": "Deploy pattern", "content": "Use Tailscale SSH"}}'

# List skills
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "hermes_list_skills"}'

# Get commit/deploy status
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "commit_deploy_status", "params": {"limit": 5}}'

# Check health
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "health"}'
```

**Supported actions:** `query_memory`, `list_projects`, `register_project`, `get_project_info`, `get_active_task`, `get_recent_bugs`, `search_code`, `submit_task`, `hermes_recall`, `hermes_learn`, `hermes_learn_batch`, `hermes_list_skills`, `hermes_list_resources`, `hermes_stats`, `commit_deploy_status`, `sync_status`, `codex_task_upsert`, `codex_task_list`, `codex_task_get`, `codex_task_get_active`, `kimi_task_upsert`, `kimi_task_list`, `kimi_task_get`, `kimi_task_get_active`, `claude_task_upsert`, `claude_task_list`, `claude_task_get`, `claude_task_get_active`, `health`, `qdrant_search`, `qdrant_collections`, `run_task`, `run_debug`, `run_deploy`, `get_pipeline`, `list_resources`, `read_resource`

### Fallback Chain

The system has a 3-tier fallback chain for MCP access:

```
1. MCP Server (port 3419) — Primary, proxies to daemon
        ↓ (if daemon unreachable)
2. REST API MCP endpoint (/api/brain/mcp) — Fallback via port 8787
        ↓ (if API unreachable)
3. Direct Daemon (port 3417) — Last resort, Docker container
```

### New Features (v2.0)

#### Rate Limiting

The MCP server enforces rate limiting to prevent abuse. Default: **120 calls per 60-second window** per tool. Configurable via environment variables:

| Variable                   | Default | Description            |
| -------------------------- | ------- | ---------------------- |
| `MCP_RATE_LIMIT_WINDOW_MS` | 60000   | Rate limit window (ms) |
| `MCP_RATE_LIMIT_MAX_CALLS` | 120     | Max calls per window   |

When exceeded, the server returns a `Rate limit exceeded` error with the reset time.

#### Pagination

The `query_memory` tool now supports pagination via the `offset` parameter:

```bash
# Get first 10 results
curl -X POST http://127.0.0.1:3419/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_memory","arguments":{"query":"deployment","maxResults":10,"offset":0}}}'

# Get next 10 results
curl -X POST http://127.0.0.1:3419/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_memory","arguments":{"query":"deployment","maxResults":10,"offset":10}}}'
```

Responses include `total`, `offset`, and `limit` fields for client-side pagination UI.

#### Deduplication

The `hermes_learn` tool now checks for duplicate lessons before storing. If a lesson with the same topic already exists in `memory/lessons-learned.md` or `memory/lesson-index.jsonl`, the server returns:

```json
{
	"success": true,
	"deduplicated": true,
	"note": "Lesson with topic \"...\" already exists."
}
```

The `hermes_learn_batch` tool processes each lesson independently — deduplicated lessons are skipped with a `"deduplicated"` status.

#### Project Registration

Projects can be registered in `~/.superroo/config.json` via the `register_project` tool:

```bash
curl -X POST http://127.0.0.1:3419/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"register_project","arguments":{"name":"my-project","directory":"/path/to/project"}}}'
```

The `list_projects` tool reads from this config file. If no projects are registered, it falls back to `["superroo2"]`.

#### Sync Status

The `sync_status` tool checks connectivity to all three backends (daemon, REST API, local fallback) and returns:

```json
{
  "success": true,
  "status": {
    "server": { "uptime": 12345, "uptimeSeconds": 12, "startedAt": "..." },
    "backends": {
      "daemon": { "reachable": true, "url": "http://127.0.0.1:3417" },
      "restApi": { "reachable": false, "url": "http://127.0.0.1:8787", "error": "..." },
      "localFallback": { "reachable": true, "source": "local_json_fallback" }
    },
    "overall": "healthy" | "degraded" | "offline"
  }
}
```

#### Rich Health Endpoint

The `/health` HTTP endpoint now returns detailed diagnostics:

```bash
curl http://127.0.0.1:3419/health
```

Response includes uptime, tool count, rate limiter config, backend URLs, and memory directory paths.

## Real-Time Events (SSE)

The Central Brain provides a **Server-Sent Events (SSE)** endpoint for real-time event streaming:

```bash
# Connect to SSE stream
curl -N https://dev.abcx124.xyz/api/brain/events
```

**Event types:**

- `connected` — Initial connection confirmation
- `heartbeat` — Every 30 seconds (keepalive)
- `skill_generated` — When a new skill is created via the skill generation pipeline
- `message` — Generic events (task status changes, system events)

**Emit an event programmatically:**

```bash
curl -X POST https://dev.abcx124.xyz/api/brain/events/emit \
  -H "Content-Type: application/json" \
  -d '{"event":"custom_event","data":{"message":"Hello from AI bot"}}'
```

## WebSocket Support

The Central Brain provides a **WebSocket endpoint** for bidirectional real-time communication:

```
ws://dev.abcx124.xyz/api/brain/ws
```

**Supported actions (send as JSON messages):**

- `health` — Check system health
- `list_projects` — List all projects
- `get_active_task` — Get current active task
- `get_recent_bugs` — Get recent bugs
- `commit_deploy_status` — Get commit/deploy history
- `hermes_recall` — Semantic memory search
- `hermes_learn` — Store a lesson
- `hermes_list_skills` — List skills
- `hermes_list_resources` — List resources
- `hermes_stats` — Get Hermes Claw stats
- `qdrant_search` — Search Qdrant vector DB
- `qdrant_collections` — List Qdrant collections
- `run_task` — Submit a task
- `run_debug` — Submit a debug task
- `run_deploy` — Submit a deploy task
- `get_pipeline` — Get pipeline status
- `list_resources` — List brain:// resources
- `read_resource` — Read a brain:// resource
- `subscribe` — Subscribe to event types
- `unsubscribe` — Unsubscribe from event types

**Example WebSocket connection (JavaScript):**

```javascript
const ws = new WebSocket("wss://dev.abcx124.xyz/api/brain/ws")

ws.onopen = () => {
	ws.send(JSON.stringify({ action: "health" }))
	ws.send(JSON.stringify({ action: "subscribe", events: ["skill_generated"] }))
}

ws.onmessage = (e) => {
	const msg = JSON.parse(e.data)
	console.log("Brain event:", msg)
}
```

## MCP Resources (brain:// URIs)

The REST API fallback supports MCP-style resource access via `list_resources` and `read_resource` actions:

```bash
# List all available resources
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "list_resources"}'

# Read a specific resource
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "read_resource", "params": {"uri": "brain://context"}}'
```

**Available brain:// URIs:**

| URI                          | Maps To                 | Description                  |
| ---------------------------- | ----------------------- | ---------------------------- |
| `brain://context`            | `hermes_recall`         | Full RAG context             |
| `brain://tasks`              | `get_active_task`       | Active tasks                 |
| `brain://bugs`               | `get_recent_bugs`       | Recent bugs                  |
| `brain://projects`           | `list_projects`         | All projects                 |
| `brain://skills`             | `hermes_list_skills`    | Created skills               |
| `brain://resources`          | `hermes_list_resources` | Knowledge resources          |
| `brain://stats`              | `hermes_stats`          | Hermes Claw stats            |
| `brain://health`             | `health`                | System health                |
| `brain://commits`            | `commit_deploy_status`  | Commit history               |
| `brain://deploys`            | `commit_deploy_status`  | Deploy history               |
| `brain://pipeline`           | `get_pipeline`          | Pipeline status              |
| `brain://codex/tasks`        | `codex_task_list`       | Persistent Codex task memory |
| `brain://qdrant/collections` | `qdrant_collections`    | Qdrant collections           |

## Qdrant Vector Search

The Central Brain integrates directly with **Qdrant** (vector database running at `http://127.0.0.1:6333`) for code search and vector similarity:

```bash
# List all Qdrant collections
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "qdrant_collections"}'

# Search Qdrant with semantic query
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "qdrant_search", "params": {"query": "deployment script", "collection": "code_chunks", "limit": 5}}'
```

The search automatically generates embeddings via Ollama `nomic-embed-text` (768 dimensions) before querying Qdrant.

## Agent Orchestration

The Central Brain provides MCP actions for agent orchestration — submitting tasks, debug sessions, and deployments:

```bash
# Run a coding task
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "run_task", "params": {"goal": "Fix login bug", "type": "feature"}}'

# Run a debug session
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "run_debug", "params": {"goal": "Investigate 502 errors"}}'

# Run a deployment
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "run_deploy", "params": {"goal": "Deploy to production"}}'

# Check pipeline status
curl -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action": "get_pipeline"}'
```

## Skill Generation Pipeline

The Central Brain can automatically generate reusable skills from failure patterns:

```bash
curl -X POST https://dev.abcx124.xyz/api/brain/skill-generate \
  -H "Content-Type: application/json" \
  -d '{
    "failureType": "build",
    "goal": "Always run tests before deploy",
    "solution": "Add pre-deploy test hook in package.json scripts",
    "rootCause": "Skipping tests caused production regression",
    "verificationSteps": ["npm test", "npm run build"],
    "relatedFiles": ["package.json", ".github/workflows/deploy.yml"],
    "tags": ["deploy", "testing", "ci"]
  }'
```

The pipeline:

1. Creates a skill via Hermes Claw
2. Stores the lesson in BugKnowledgeStore (pgvector)
3. Broadcasts a `skill_generated` event to all SSE and WebSocket clients
4. Returns the created skill with metadata

## Telegram Bridge

The Central Brain provides a Telegram bridge endpoint that routes MCP actions through the Telegram bot:

```bash
curl -X POST https://dev.abcx124.xyz/api/brain/mcp/telegram \
  -H "Content-Type: application/json" \
  -d '{"action": "hermes_stats", "chatId": 8485794779}'
```

**Telegram `/mcp` command:**
The Telegram bot supports `/mcp <action> [params]` for executing MCP actions directly from Telegram:

```
/mcp health
/mcp hermes_stats
/mcp commit_deploy_status {"limit":3}
/mcp hermes_recall {"query":"deployment patterns","limit":2}
```

## Agents

### 1. Hermes Claw — Memory & Context Agent

The primary memory system. Stores and retrieves context using vector embeddings (768-dim via `nomic-embed-text`) with pgvector-powered semantic search.

**Base:** `POST /api/orchestrator/hermes/{operation}`

| Operation          | Description                      | Required Body Fields                                  |
| ------------------ | -------------------------------- | ----------------------------------------------------- |
| `recall`           | Semantic memory search           | `query` (string), `limit` (number, optional)          |
| `learn`            | Store a lesson                   | `topic` (string), `content` (string)                  |
| `create-skill`     | Create reusable skill            | `failureType`, `goal`, `solution`                     |
| `analyze-patterns` | Analyze failure patterns         | `tasks` (array, optional), `scope` (string, optional) |
| `list-skills`      | List all created skills          | _(none)_                                              |
| `list-resources`   | List all knowledge resources     | _(none)_                                              |
| `extract-lessons`  | Extract lessons from interaction | `phases` (array), `context` (object)                  |
| `stats`            | Get Hermes Claw statistics       | _(none)_                                              |

### 2. OpenClaw — Analysis Agent (Read-Only)

Analyzes code, traces dependencies, inspects configurations, and assesses impact. **Never writes code.**

Accessible via Telegram bot or direct API routing through the orchestrator.

### 3. Ollama — Cheap Local AI

Handles cheap, repetitive tasks locally:

| Model              | Purpose                            |
| ------------------ | ---------------------------------- |
| `hermes3`     | Ultra-cheap chat and summarization |
| `qwen2.5:1.5b`     | Fallback deeper summarization      |
| `nomic-embed-text` | Text embeddings (768 dimensions)   |

**Ollama API:** `http://127.0.0.1:11434` (internal only)

### 4. Cloud Coder — Complex Coding Agent

Handles complex coding, debugging, and high-risk changes using cloud LLMs.

**Supported Providers:** OpenAI, Anthropic, DeepSeek, OpenRouter, Groq

## Capabilities

### Memory & Context (RAG Pipeline)

```
User Query → nomic-embed-text (768-dim) → pgvector similarity search
  → BugKnowledgeStore → HermesClaw context injection → LLM response
```

- **Vector Store:** PostgreSQL + pgvector 0.8.2 with HNSW index
- **Embedding Model:** `nomic-embed-text` (768 dimensions)
- **Similarity Search:** Cosine similarity via pgvector `<->` operator
- **Knowledge Types:** Bug fixes, lessons, patterns, skills, best practices

### Commit & Deploy Tracking

**Endpoint:** `GET /api/orchestrator/commit-deploy-status?limit=5`

Tracks every commit and deployment across all coding agents. Returns:

- Recent commits (SHA, agent, type, title, files changed, features affected)
- Recent deploys (version, SHA, agent, status, timestamp)
- Total counts

### Real-Time Events

**Endpoints:**

- `GET /api/brain/events` — SSE stream for real-time events
- `POST /api/brain/events/emit` — Emit an event to all connected SSE clients
- `ws://dev.abcx124.xyz/api/brain/ws` — WebSocket for bidirectional communication

Events are broadcast to all connected SSE and WebSocket clients when:

- Skills are generated
- Tasks are submitted/completed
- System events occur

### Skill Generation

**Endpoint:** `POST /api/brain/skill-generate`

Automatically generates reusable skills from failure patterns. The pipeline:

1. Creates a skill via Hermes Claw
2. Stores the lesson in BugKnowledgeStore
3. Broadcasts event to SSE/WebSocket clients

### Agent Orchestration

**Endpoint:** `POST /api/brain/mcp` (with `run_task`, `run_debug`, `run_deploy`, `get_pipeline` actions)

Submit tasks, debug sessions, and deployments directly through the Central Brain MCP interface.

### Telegram Bot Interface

**Bot:** `@SuperRooBot` on Telegram

| Command                  | Description                            |
| ------------------------ | -------------------------------------- |
| `/code <task>`           | Route a coding task to the Coder agent |
| `/deploy`                | Deploy the latest changes              |
| `/test`                  | Run tests                              |
| `/logs`                  | View recent logs                       |
| `/status`                | Check system status                    |
| `/hermes <op> <args>`    | Query Hermes Claw directly             |
| `/skills`                | List created skills                    |
| `/resources`             | List knowledge resources               |
| `/upgrade`               | Trigger self-improvement               |
| `/brain`                 | Show Central Brain info                |
| `/mcp <action> [params]` | Execute MCP actions directly           |
| `/menu`                  | Show interactive menu                  |
| `/help`                  | Show help                              |

### Learning Loop

The system runs an infinite learning loop:

1. **Every interaction** is analyzed by `TelegramLearner` for patterns
2. **Lessons are extracted** by `HermesClaw.extractLessons()`
3. **Knowledge is stored** in pgvector via `BugKnowledgeStore`
4. **Future queries** retrieve relevant context via RAG
5. **Skills are created** from recurring patterns
6. **The bot improves** over time without manual intervention

## Dashboard GUI

The web dashboard at `https://dev.abcx124.xyz` provides GUI views for:

- **Central Brain** — Full brain overview with 6 tabs: Overview, Agents, Capabilities, MCP Console, Real-Time, Integration
    - Overview: Status cards, MCP Server Configuration, Fallback Chain
    - Agents: All agents with endpoints
    - Capabilities: All capabilities with descriptions
    - MCP Console: Click-to-execute MCP actions with JSON result viewer
    - Real-Time: SSE event log and WebSocket connection info
    - Integration: For AI Bots guide, cURL examples, MCP Server Config
- **Commit/Deploy Log** — Visual commit and deployment history
- **Telegram** — Bot status, commands, activity, tasks
- **System** — Health metrics, queue stats, provider status
- **Working Tree** — Product architecture visualization

## Integration Examples

### Python AI Bot

```python
import requests

BRAIN_URL = "https://dev.abcx124.xyz/api"

# 1. Discover capabilities
brain = requests.get(f"{BRAIN_URL}/brain").json()
print(f"Connected to: {brain['brain']['name']}")

# 2. Query memory
result = requests.post(f"{BRAIN_URL}/orchestrator/hermes/recall", json={
    "query": "deployment patterns",
    "limit": 3
}).json()
for item in result["result"]:
    print(f"  - {item['topic']}: {item['summary']}")

# 3. Store what you learned
requests.post(f"{BRAIN_URL}/orchestrator/hermes/learn", json={
    "topic": "New deployment pattern discovered",
    "content": "Use blue-green deployment with nginx upstream switching"
})

# 4. Check system health
health = requests.get(f"{BRAIN_URL}/health").json()
print(f"System: {health['status']}, Hermes: {'hermesClaw' in str(health)}")

# 5. Subscribe to real-time events (SSE)
import sseclient
response = requests.get(f"{BRAIN_URL}/brain/events", stream=True)
client = sseclient.SSEClient(response)
for event in client.events():
    print(f"Event: {event.event} -> {event.data}")
```

### JavaScript/Node.js AI Bot

```javascript
const BRAIN = "https://dev.abcx124.xyz/api"

async function connectToSuperRoo() {
	// Discover
	const brain = await fetch(`${BRAIN}/brain`).then((r) => r.json())
	console.log(`Connected to ${brain.brain.name} v${brain.brain.version}`)

	// Query memory
	const memory = await fetch(`${BRAIN}/orchestrator/hermes/recall`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query: "how to deploy", limit: 5 }),
	}).then((r) => r.json())

	// Check commits
	const commits = await fetch(`${BRAIN}/orchestrator/commit-deploy-status?limit=3`).then((r) => r.json())
	console.log(`Last deploy: ${commits.deploys[0]?.status}`)

	// Connect via WebSocket for real-time events
	const ws = new WebSocket(`wss://dev.abcx124.xyz/api/brain/ws`)
	ws.onopen = () => ws.send(JSON.stringify({ action: "subscribe", events: ["skill_generated"] }))
	ws.onmessage = (e) => console.log("Brain event:", e.data)
}

// Generate a skill
async function generateSkill() {
	await fetch(`${BRAIN}/brain/skill-generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			failureType: "build",
			goal: "Always run tests before deploy",
			solution: "Add pre-deploy test hook",
		}),
	})
}
```

### cURL (Any AI Bot)

```bash
# Full discovery
curl -s https://dev.abcx124.xyz/api/brain | jq .

# Quick health check
curl -s https://dev.abcx124.xyz/api/health | jq .

# Semantic memory search
curl -s -X POST https://dev.abcx124.xyz/api/orchestrator/hermes/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"bug fix patterns","limit":3}' | jq .

# Store knowledge
curl -s -X POST https://dev.abcx124.xyz/api/orchestrator/hermes/learn \
  -H "Content-Type: application/json" \
  -d '{"topic":"SSH key fix","content":"Use ssh -o StrictHostKeyChecking=no for automated deployments"}' | jq .

# Check deploy status
curl -s "https://dev.abcx124.xyz/api/orchestrator/commit-deploy-status?limit=5" | jq .

# MCP fallback — query memory via REST
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"query_memory","params":{"query":"bug fix patterns","limit":3}}' | jq .

# MCP fallback — store lesson
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"hermes_learn","params":{"topic":"SSH fix","content":"Use StrictHostKeyChecking=no"}}' | jq .

# MCP fallback — list skills
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"hermes_list_skills"}' | jq .

# Real-Time SSE stream
curl -N https://dev.abcx124.xyz/api/brain/events

# Generate a skill
curl -s -X POST https://dev.abcx124.xyz/api/brain/skill-generate \
  -H "Content-Type: application/json" \
  -d '{"failureType":"build","goal":"Always test before deploy","solution":"Add pre-deploy hook"}' | jq .

# Agent orchestration — run a task
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"run_task","params":{"goal":"Deploy latest","type":"deploy"}}' | jq .

# Qdrant vector search
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"action":"qdrant_search","params":{"query":"deployment script","collection":"code_chunks","limit":3}}' | jq .

# Telegram MCP Bridge
curl -s -X POST https://dev.abcx124.xyz/api/brain/mcp/telegram \
  -H "Content-Type: application/json" \
  -d '{"action":"hermes_stats","chatId":8485794779}' | jq .
```

## Connection Checklist for AI Bots

When connecting a new AI bot to the SuperRoo Central Brain:

- [ ] **Step 1:** `GET /api/brain` — Discover all capabilities and endpoints
- [ ] **Step 2:** `GET /api/health` — Verify the system is online
- [ ] **Step 3:** `POST /api/orchestrator/hermes/recall` — Query existing memory for context
- [ ] **Step 4:** `POST /api/orchestrator/hermes/learn` — Store initial knowledge
- [ ] **Step 5:** `GET /api/orchestrator/commit-deploy-status` — Check recent activity
- [ ] **Step 6:** Subscribe to Telegram bot `@SuperRooBot` for interactive access
- [ ] **Step 7 (MCP):** Configure MCP client to connect to `http://127.0.0.1:3419` or use `POST /api/brain/mcp` fallback
- [ ] **Step 8 (Real-Time):** Connect to SSE stream at `GET /api/brain/events` or WebSocket at `ws://.../api/brain/ws`
- [ ] **Step 9 (Orchestration):** Use `POST /api/brain/mcp` with `run_task`/`run_debug`/`run_deploy` actions
- [ ] **Step 10 (Skills):** Generate skills via `POST /api/brain/skill-generate` from failure patterns

## Troubleshooting

| Issue                        | Solution                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| `502 Bad Gateway`            | API was restarting — wait 10s and retry. Webhook auto-recovers.                              |
| `HermesClaw not initialized` | Orchestrator is still starting — wait and retry.                                             |
| Empty memory results         | No knowledge stored yet — use `/learn` to seed the database.                                 |
| Telegram bot not responding  | Check webhook: `GET /api/telegram/webhook-info`. Re-set if needed.                           |
| MCP server not responding    | Check daemon: `curl http://127.0.0.1:3417/health`. Use REST fallback: `POST /api/brain/mcp`. |
| MCP connection refused       | Ensure MCP server is running: `pm2 list                                                      | grep mcp`. Restart if needed. |
| SSE not connecting           | Ensure API is running on port 8787. Check for firewall/proxy issues.                         |
| WebSocket connection failed  | Ensure API WebSocket server is running. Check for proxy WebSocket support.                   |
| Skill generation fails       | Ensure Hermes Claw is initialized and BugKnowledgeStore is connected.                        |
| Qdrant search returns empty  | Ensure Qdrant is running: `curl http://127.0.0.1:6333/collections`. Seed data first.         |

## Related Documentation

- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Full deployment instructions
- [`CLOUD_ORCHESTRATOR_PLAN.md`](CLOUD_ORCHESTRATOR_PLAN.md) — Orchestrator architecture
- [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) — System architecture diagrams
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Self-healing system
