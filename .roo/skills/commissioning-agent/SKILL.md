---
name: commissioning-agent
description: "🧪 Commissioning Agent — Full-stack QA engineer that verifies ALL features work as a real user. Runs 14 phases: repo inspection, env validation, app boot, Playwright UI testing, API/backend verification, database validation, integration testing, queue/worker testing, file upload testing, security/auth validation, performance testing, autonomous debugging, deployment readiness, and final commissioning report. Invoke with `/commissioning`."
---

# Commissioning Agent

## Overview

Acts as a senior QA engineer, commissioning engineer, autonomous debugger, DevOps tester, and real-user Playwright operator.

**Mission**: Fully verify that the SuperRoo Cloud Dashboard + API + Worker + Mini-IDE + Telegram Bot are production-ready.

**A feature DOES NOT PASS** just because an API returns HTTP 200. A feature only passes if:

- The real UI works
- Backend works
- Database updates correctly
- Integrations work
- User sees correct result
- No hidden console/network errors exist

## Invocation

Type `/commissioning` in the coding agent to execute ALL phases.

## Phase 1 — Repository & Architecture Inspection

Inspect the entire repository structure.

Identify:

- Frontend framework (Next.js, React, Tailwind)
- Backend framework (Node.js, Express)
- Database system (SQLite via better-sqlite3, Redis via BullMQ)
- Auth/session system (JWT, Telegram OTP)
- WebSocket/realtime system (WebSocket server)
- Queue system (BullMQ with Redis)
- Background jobs (worker.js, autoDeployer.js)
- Docker architecture (Product Image Studio container)
- CI/CD workflows (GitHub webhooks, auto-deployer)
- File upload systems (dashboard uploads)
- Cloud integrations (OpenAI, DeepSeek, Gemini, Telegram Bot API)
- External APIs (OpenAI, DeepSeek, Gemini, Stability AI, Fal.ai)
- Webhooks (GitHub push webhook)

Map:

- All dashboard pages (21 pages in page.tsx)
- All API routes (api.js ~6200 lines)
- All forms, buttons, tabs, menus, modals
- All upload fields
- All settings panels
- All API dependencies

Output: `commissioning/feature-inventory.md`

## Phase 2 — Dependency & Environment Validation

Detect package manager: pnpm (pnpm-lock.yaml exists)

Validate:

- Required env variables exist (`.env` file)
- API keys exist (OpenAI, DeepSeek, Gemini, Telegram)
- Database credentials valid (SQLite paths)
- Docker services valid (Product Image Studio)
- Ports available (8787 API, 3001 Dashboard, 8081 Mini-IDE, 8790 Auto-deployer)
- Dependency conflicts
- Build requirements

Run:

```bash
pnpm install
pnpm run build
```

Check:

- TypeScript errors
- Build failures
- Missing dependencies
- Version conflicts

Output: `commissioning/environment-validation.md`

## Phase 3 — Application Boot Verification

Verify all services on VPS (Tailscale IP: 100.64.175.88):

```bash
# Check PM2 status
ssh root@100.64.175.88 "pm2 status"

# Check API health
curl http://100.64.175.88:8787/api/health

# Check Dashboard
curl -I http://100.64.175.88:3001

# Check Docker containers
ssh root@100.64.175.88 "docker ps"

# Check Redis
ssh root@100.64.175.88 "redis-cli ping"
```

Verify:

- API reachable (port 8787)
- Dashboard reachable (port 3001)
- Mini-IDE reachable (port 8081)
- Auto-deployer reachable (port 8790)
- Redis reachable
- Docker containers healthy
- PM2 processes stable (no restart loops)

Check:

- Startup crashes
- Boot loops
- Port conflicts
- Missing env errors

Output: `commissioning/boot-verification.md`

## Phase 4 — Real User UI Testing (Playwright)

CRITICAL: Use Playwright browser automation. Do NOT only test APIs.

Launch a real browser and test visually like a real human user.

### Test Suites to Run

```bash
# Run existing E2E tests (129 tests)
cd cloud && node test-smart-terminal-e2e.js

# Run full-stack crawl (426 tests)
cd cloud && node test-full-stack-crawl.js

# Run smartness comparison (83 tests)
cd cloud && node test-ide-smartness-comparison.js

# Run Playwright visual tests
cd cloud/dashboard && npx playwright test --reporter=list
```

### Manual UI Verification Checklist

For EVERY feature verify:

1. UI renders correctly
2. Button actually works
3. Correct API is called
4. Request payload valid
5. Response handled correctly
6. Database updates correctly
7. UI updates correctly
8. Success/error messages appear
9. No console errors exist
10. No network failures exist
11. No dead links exist
12. No stuck loading states exist
13. No duplicate requests exist

### Dashboard Pages to Test

- Overview — health status, system stats
- Working Tree — module visualization
- Jobs — job listing, filtering
- Queue — queue management
- Agents — agent status
- Bugs — bug registry
- Healing — healing incidents
- Monitoring — system monitoring
- Skill Generator — skill creation
- Logs — log viewer
- Docker — container management
- Approvals — approval workflow
- API Keys — key management
- Settings — configuration
- AI Assistant — AI workflows
- Model Router — provider routing
- GitHub — GitHub integration
- IDE Terminal — web IDE
- Projects — project management
- Telegram — Telegram bot status
- Auto Deploy — deployment automation

Take evidence during failures:

- Screenshots
- Playwright traces
- Videos
- Logs

Output: `commissioning/ui-test-results.md`

## Phase 5 — API & Backend Verification

Verify ALL backend routes in api.js (~6200 lines).

### Public Endpoints (No Auth)

- `GET /api/health` — Health check
- `GET /api/jobs` — Job listing
- `GET /api/queue/stats` — Queue statistics
- `GET /api/logs` — Log viewer
- `GET /api/healing/incidents` — Healing incidents
- `GET /api/docker/status` — Docker status
- `POST /ide-workspace/chat` — IDE chat
- `GET /ide-workspace/chat/stream` — SSE streaming chat
- `GET /ide-workspace/workspace` — Workspace session
- `POST /ide-workspace/terminal/execute` — Execute command
- `POST /ide-workspace/terminal/create` — Create terminal
- `GET /ide-workspace/providers` — List providers
- `GET /ide-workspace/orchestrator/status` — Orchestrator status
- `POST /ide-workspace/orchestrator/submit` — Submit orchestrator task
- `GET /ide-workspace/hermes/recall` — Hermes memory recall
- `GET /ide-workspace/hermes/stats` — Hermes stats
- `GET /ide-workspace/file/read` — Read file
- `POST /ide-workspace/file/save` — Save file
- `POST /ide-workspace/workspace/import-github` — Import GitHub repo
- `GET /github/dashboard` — GitHub dashboard data
- `GET /telegram/webhook-info` — Telegram webhook status
- `POST /api/github-webhook` — GitHub webhook receiver

### Authenticated Endpoints (Require Token)

- `GET /api/status` — System status
- `GET /api/orchestrator/status` — Orchestrator status
- `GET /api/providers` — Provider list
- `GET /api/agents` — Agent list
- `GET /api/bugs` — Bug list
- `GET /api/features` — Feature list
- `GET /api/deployments` — Deployment list
- `GET /api/approvals` — Approval list
- `GET /api/auto-deploy/status` — Auto-deployer status
- `GET /api/github/status` — GitHub status
- `GET /api/orchestrator/hermes/stats` — Hermes stats
- `GET /api/telegram/status` — Telegram status
- `GET /api/skill-generator/list` — Skill list
- `GET /api/working-tree` — Working tree data

Check:

- Request validation
- Authentication
- Authorization
- Error handling
- Response consistency

Output: `commissioning/api-backend-results.md`

## Phase 6 — Database Validation

Verify SQLite databases:

- `server/src/memory/commit-deploy-log.json` — Commit/deploy log
- `server/src/memory/agent-notes.json` — Agent notes
- `server/src/memory/bug-feature-map.json` — Bug-feature mapping
- `server/src/memory/feature-test-history.json` — Feature test history
- `memory/healing-incidents.json` — Healing incidents
- `memory/healing-metrics.json` — Healing metrics

Verify:

- File integrity (valid JSON)
- Schema consistency
- Data integrity
- Read/write operations
- Backup/restore

Output: `commissioning/database-validation.md`

## Phase 7 — Integration & External Service Verification

Verify ALL integrations:

- **OpenAI API** — Chat completions, vision
- **DeepSeek API** — Chat completions
- **Gemini API** — Chat completions, vision
- **Telegram Bot API** — Bot commands, webhooks
- **GitHub Webhooks** — Push events, auto-deploy
- **Redis** — BullMQ queues, caching
- **Docker** — Product Image Studio container
- **PM2** — Process management
- **Nginx** — Reverse proxy
- **Tailscale** — SSH connectivity

Confirm:

- Systems connected properly
- Retries work
- Fallback logic works
- Error handling works
- Invalid responses handled safely

Output: `commissioning/integration-results.md`

## Phase 8 — Queue, Worker & Background Job Testing

Verify:

- BullMQ queues process correctly (`superroo-queue`)
- Worker (`worker.js`) processes jobs
- Auto-deployer (`autoDeployer.js`) handles deployments
- Orchestrator worker (`orchestratorWorker.js`) processes sub-tasks
- Agent runners (`agentRunners.js`) execute agent work
- Failed jobs retry correctly
- Job deduplication works

Check:

- Stuck jobs
- Infinite loops
- Memory leaks
- Duplicate processing
- Race conditions

Validate:

- Queue persistence
- Recovery after restart

Output: `commissioning/queue-worker-results.md`

## Phase 9 — File Upload & Storage Testing

Test:

- Image uploads (dashboard)
- File uploads (IDE terminal)
- Drag/drop uploads
- Large file uploads

Verify:

- Upload progress
- Storage persistence
- Preview rendering
- Deletion handling

Output: `commissioning/file-upload-storage-results.md`

## Phase 10 — Security & Auth Validation

Verify:

- Route protection (401 for unauthenticated endpoints)
- Session handling
- Token expiration
- CORS configuration
- Secret exposure (`.env` in `.rooignore`)
- Unsafe uploads

Test:

- Invalid permissions
- Expired sessions
- Unauthorized requests
- Broken auth flows

Output: `commissioning/security-auth-results.md`

## Phase 11 — Performance & Stability Testing

Verify:

- Memory usage (VPS: 1.1Gi of 3.8Gi)
- CPU spikes
- API response times
- PM2 restart stability
- Docker container health
- Disk usage (58G of 77G — 76%)

Check:

- Slow endpoints
- Timeout handling
- Memory leaks
- Retry storms

Output: `commissioning/performance-stability-results.md`

## Phase 12 — Autonomous Debugging & Recovery

If ANY test fails:

1. Inspect logs
2. Inspect network requests
3. Inspect console errors
4. Inspect stack traces
5. Identify root cause
6. Patch the issue
7. Rerun tests
8. Verify no regression introduced
9. Repeat until resolved

Do NOT stop after first failure.
Continue autonomously until feature fully passes OR blocker fully documented.

Output: `commissioning/fixes-applied.md`

## Phase 13 — Deployment Readiness Verification

Verify production readiness:

- PM2 ecosystem config valid (ecosystem.config.js)
- Nginx config valid
- SSL/TLS configured
- Health checks exist (`/api/health`)
- Logs accessible (PM2 logs, error logs)
- Restart recovery works (PM2 auto-restart)
- Containers auto-recover (Docker restart policy)
- Monitoring available (dashboard health page)

Check:

- Missing secrets
- Invalid production configs
- Build reproducibility

Output: `commissioning/deployment-readiness.md`

## Phase 14 — Final Commissioning Report

Generate a FINAL COMMISSIONING REPORT.

Output: `commissioning/final-commissioning-report.md`

Include:

- Overall Status (PASS/FAIL/PARTIAL)
- Feature Checklist (PASS/FAIL per feature)
- Technical Failures (failed builds, tests, APIs, DB, workers, Docker)
- UI Failures (broken buttons, layout issues, console errors, network failures)
- Root Cause Analysis (exact issue source, affected systems, severity)
- Fixes Applied (files changed, functions changed, configs changed)
- Remaining Risks (unresolved issues)
- Evidence (screenshots, traces, videos, logs, console errors, network failures)

## Safety & Container Sandboxing

All commissioning test execution is **container-sandboxed** for safety.

### How It Works

1. **CommissioningLoop.js** (`cloud/orchestrator/modules/CommissioningLoop.js`) runs all 14 phases
2. Test suites (Phase 4) execute inside **Docker containers** via `_runInSandbox()`
3. The sandbox uses the existing `cloud/sandbox/Dockerfile` (Node 20, non-root `sandbox` user, tini init)
4. Containers run with:
    - `--memory 512m --memory-swap 512m` — Memory limit
    - `--cpus 1` — CPU limit
    - `--network host` — Access to VPS services
    - Workspace mounted as **read-only** (`:ro`)
    - `10-minute timeout` per sandbox execution
    - Auto-retry on failure (up to 2 retries)
    - Auto-cleanup on completion

### Hard Safety Rules (24 Patterns)

The following commands are **BLOCKED** even in FULL_AUTONOMOUS mode:

| Category             | Blocked Patterns                                                      |
| -------------------- | --------------------------------------------------------------------- |
| **Destructive FS**   | `rm -rf /`, `rm -rf ~`, `mkfs`, `dd if=`, `shutdown`, `reboot`        |
| **User Management**  | `passwd`, `userdel`, `usermod`, `chmod 777 /`, `chown /`              |
| **Secret Exposure**  | `cat .env`, editing `.env`, accessing `/etc/`, `~/.ssh`, `/root/.ssh` |
| **Dangerous Docker** | `docker rm`, `docker system prune`, `docker volume rm`                |
| **Destructive PM2**  | `pm2 delete` (all processes)                                          |
| **Database**         | `drop table`, `drop database`                                         |
| **Credential Leak**  | Patterns matching `privateKey`, `secretKey` in output                 |

### Container-First Execution

```javascript
// CommissioningLoop._runInSandbox() — all test suites go through this
const dockerCmd = [
	"docker",
	"run",
	"--rm",
	"--memory",
	"512m",
	"--memory-swap",
	"512m",
	"--cpus",
	"1",
	"--network",
	"host",
	"-v",
	`${workspaceRoot}:/workspace:ro`,
	"superroo-sandbox",
	"node",
	scriptPath,
]
```

### Cloud IDE Integration

The commissioning agent is fully integrated into the Cloud IDE:

- **`/commissioning`** — Terminal command (routes through `handleAgentTerminalCommand`)
- **`@commissioner`** — Agent mention (routes through `mentionToAgent`)
- **`POST /commissioning/start`** — API endpoint
- **`GET /commissioning/status/:jobId`** — Status endpoint
- **`POST /commissioning/stop/:jobId`** — Stop endpoint

All endpoints are registered in `cloud/api/api.js` and use the `CommissioningLoop` class from `cloud/orchestrator/modules/CommissioningLoop.js`.

## Important Rules

NEVER assume something works. VERIFY EVERYTHING.

Do NOT mark a feature as PASS unless:

- UI verified
- Backend verified
- DB verified
- Integrations verified
- No hidden console/network issues exist

Test like a REAL HUMAN USER. Act like a production commissioning engineer before a public launch.
