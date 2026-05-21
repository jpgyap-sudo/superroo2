# SuperRoo Dashboard

A Next.js-based dashboard for monitoring and managing the SuperRoo Cloud infrastructure.

## Features

- **Overview**: System health and metrics — including live EventBus active-task count with one-click navigate to Task Timeline
- **Jobs**: View and manage job execution
- **Queue**: Monitor the BullMQ job queue
- **Agents**: Browse available agents
- **Skill Generator**: Generate new skills
- **Logs**: View system logs
- **Docker**: Monitor Docker sandbox status
- **Task Timeline** _(OpenHands-style)_: Real-time SSE event stream per task — state-machine progress bar, expandable event payloads, 500-event history replay on connect
- **Healing**: Self-healing incident tracker with Repair Runs table — fingerprint, escalation status, cycle-count thrashing signal, and link to Supabase sync
- **Task State Machine**: 11-state lifecycle (queued → preparing → loading_context → planning → running → testing → reviewing → repairing → completed / failed / needs_user_approval) enforced across all agents
- **Provider Dashboard**: View all AI providers with connection status, usage stats, cost/latency tracking, capability matrix, and model lists — sortable by name, status, cost, or latency
- **Collaboration**: Real-time multi-user sessions with cursor sync, file change broadcast, workspace provider, and live collaborator tracking — wired to real backend API (`GET /collaboration/sessions`, `GET /collaboration/collaborators/:sessionId`, `GET /collaboration/status`) with 5-second polling, loading states, and backend availability detection
- **MCP Servers**: Monitor MCP server health and lifecycle status — summary cards (total/running/stopped/error), search/filter by name or description, expandable server cards with transport type, command, URL, uptime, tools count, and error messages. Fetches from `GET /mcp/status` and `GET /mcp/servers`

## OpenHands-Style Upgrade — Innovative Gaps

The following capabilities were added on top of the OpenHands architecture port:

| Feature                              | File(s)                              | What it does                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSE heartbeat**                    | `SuperRooEventBus.js`                | `: ping` every 25 s keeps connections alive through nginx 60 s proxy timeout                                                                                                                            |
| **SelfHealingLoop dual constructor** | `SelfHealingLoop.js`                 | Accepts both `new SelfHealingLoop(orchestrator, opts)` (legacy `api.js` form) and `new SelfHealingLoop({ healingBus, taskQueue, config })` (canonical form)                                             |
| **Central Brain lesson injection**   | `telegramBot.js` → `agentRunners.js` | `brainClient.retrieveLessons()` fetches relevant lessons before queueing; injected as first context block in `runCoderPlan()`                                                                           |
| **Repair-runs Supabase sync**        | `scripts/sync-repair-runs.mjs`       | Reads `repair-runs.jsonl` by byte offset (idempotent), upserts rows to Supabase `repair_runs` via REST API. Run with `npm run superroo:sync-repairs`. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. |
| **EventBus stats on Overview**       | `api.js` → `overview.tsx`            | `GET /orchestrator/event-bus/stats` returns `{ activeTasks, totalEvents }` from the live singleton; shown as a chip in "Work In Motion" panel + Quick Actions shortcut                                  |

### Repair-runs sync usage

```bash
# Sync new records (incremental, safe to run repeatedly)
SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... npm run superroo:sync-repairs

# Preview without uploading
node scripts/sync-repair-runs.mjs --dry-run

# Re-upload all records from scratch
node scripts/sync-repair-runs.mjs --reset
```

SQL schema: `cloud/sql/repair_runs.sql`

## New API Endpoints

The following REST endpoints were added for provider, collaboration, and MCP management:

### Provider Endpoints

| Method | Endpoint                   | Description                                                 |
| ------ | -------------------------- | ----------------------------------------------------------- |
| GET    | `/providers`               | List all providers with usage stats and connection metadata |
| GET    | `/providers/usage`         | Get aggregated provider usage statistics                    |
| GET    | `/providers/bridge/status` | Get provider registry bridge health                         |

### Collaboration Endpoints

| Method | Endpoint                                  | Description                            |
| ------ | ----------------------------------------- | -------------------------------------- |
| GET    | `/collaboration/sessions`                 | List all active collaboration sessions |
| POST   | `/collaboration/sessions`                 | Create a new collaboration session     |
| GET    | `/collaboration/sessions/:workspaceId`    | Get sessions for a workspace           |
| DELETE | `/collaboration/sessions/:sessionId`      | Close a collaboration session          |
| GET    | `/collaboration/collaborators/:sessionId` | Get collaborators in a session         |
| GET    | `/collaboration/status`                   | Get collaboration system health        |

### MCP Endpoints

| Method | Endpoint       | Description                                 |
| ------ | -------------- | ------------------------------------------- |
| GET    | `/mcp/status`  | Get MCP Server Manager health and summary   |
| GET    | `/mcp/servers` | List all registered MCP servers with status |

### WebSocket Endpoints

| Path                | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `/ws/collaboration` | Real-time collaboration WebSocket (create/join/leave sessions, cursor updates, file changes) |

## Prerequisites

- Node.js 18+ installed
- Redis running on `localhost:6379`
- SuperRoo API running on port `8787`

## Development

```bash
cd /opt/superroo2
pnpm install --frozen-lockfile
pnpm --dir cloud/dashboard dev
```

The dashboard will be available at `http://localhost:3001`

## Production Build

```bash
cd /opt/superroo2
pnpm --dir cloud/dashboard run build
PORT=3001 pnpm --dir cloud/dashboard start
```

## PM2 Deployment

The dashboard is configured in `cloud/ecosystem.config.js` as `superroo-dashboard`.

### Start all services (including dashboard):

```bash
cd /opt/superroo2/cloud
pm2 start ecosystem.config.js
pm2 save
```

### Start only the dashboard:

```bash
pm2 start ecosystem.config.js --only superroo-dashboard
```

### View dashboard logs:

```bash
pm2 logs superroo-dashboard
```

### Restart dashboard:

```bash
pm2 restart superroo-dashboard
```

## Configuration

The dashboard proxies API requests to `http://localhost:8787` via Next.js rewrites (configured in `next.config.js`).

## Troubleshooting

### Dashboard won't start

1. Check if port 3001 is available: `netstat -ano | findstr :3001` (Windows) or `lsof -i :3001` (Linux/Mac)
2. Ensure dependencies are installed from the workspace root: `pnpm install --frozen-lockfile`
3. Check if the build exists: `pnpm --dir cloud/dashboard run build`

### API connection issues

1. Verify the API is running: `curl http://localhost:8787/health`
2. Check PM2 status: `pm2 status`
3. Review API logs: `pm2 logs superroo-api`

### Redis connection issues

1. Verify Redis is running: `redis-cli ping`
2. Check Redis connection in API logs
