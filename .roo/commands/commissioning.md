# /commissioning

Act as a senior QA engineer, commissioning engineer, autonomous debugger, DevOps tester, and real-user Playwright operator.

Your mission is to fully verify that the SuperRoo Cloud application is production-ready.

You must verify:

- Frontend (Dashboard, Mini-IDE)
- Backend (API server)
- APIs (all REST endpoints)
- Database (SQLite, Redis)
- Queues (BullMQ)
- Workers (worker.js, autoDeployer.js, orchestratorWorker.js)
- Auth (JWT, Telegram OTP)
- Webhooks (GitHub push)
- Cloud integrations (OpenAI, DeepSeek, Gemini, Telegram)
- Docker services (Product Image Studio)
- File uploads
- WebSocket/realtime
- Responsive UI
- Error handling
- Deployment readiness

A feature DOES NOT PASS just because an API returns HTTP 200.

A feature only passes if:

- The real UI works
- Backend works
- Database updates correctly
- Integrations work
- User sees correct result
- No hidden console/network errors exist

You must behave like a real human tester using browser automation.

---

## Invocation Behavior

When the user types `/commissioning`, execute ALL phases below.

Do not ask for confirmation unless a destructive action is required.

If something fails:

1. diagnose
2. fix
3. retest
4. document

Continue until all critical flows pass or the blocker is clearly documented.

---

## PHASE 1 — Repository & Architecture Inspection

Inspect the entire repository structure.

Identify:

- frontend framework (Next.js, React, Tailwind)
- backend framework (Node.js, Express)
- database system (SQLite, Redis)
- auth/session system (JWT, Telegram OTP)
- websocket/realtime system (WebSocket server)
- queue system (BullMQ)
- cron/background jobs (worker.js, autoDeployer.js)
- Docker architecture (Product Image Studio)
- CI/CD workflows (GitHub webhooks, auto-deployer)
- file upload systems
- cloud integrations (OpenAI, DeepSeek, Gemini, Telegram)
- external APIs
- webhooks

Map:

- all dashboard pages (21 pages)
- all API routes
- all forms, buttons, tabs, menus, modals
- all upload fields
- all settings panels
- all API dependencies

Generate an internal feature inventory before testing.

Output file: `commissioning/feature-inventory.md`

---

## PHASE 2 — Dependency & Environment Validation

Package manager: pnpm

Validate:

- required env variables exist
- API keys exist (OpenAI, DeepSeek, Gemini, Telegram)
- database credentials valid
- Docker services valid
- ports available (8787, 3001, 8081, 8790)
- dependency conflicts
- build requirements

Run:

```bash
pnpm install
pnpm run build
```

Check:

- TypeScript errors
- build failures
- missing dependencies
- version conflicts

Output file: `commissioning/environment-validation.md`

---

## PHASE 3 — Application Boot Verification

Verify all services on VPS (Tailscale IP: 100.64.175.88):

```bash
ssh root@100.64.175.88 "pm2 status"
curl http://100.64.175.88:8787/api/health
curl -I http://100.64.175.88:3001
ssh root@100.64.175.88 "docker ps"
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

- startup crashes
- boot loops
- port conflicts
- missing env errors

Output file: `commissioning/boot-verification.md`

---

## PHASE 4 — Real User UI Testing

CRITICAL: You MUST use Playwright browser automation.

Do NOT only test APIs.

Launch a real browser and test visually like a real human user.

### Run Existing Test Suites

```bash
cd cloud && node test-smart-terminal-e2e.js
cd cloud && node test-full-stack-crawl.js
cd cloud && node test-ide-smartness-comparison.js
cd cloud/dashboard && npx playwright test --reporter=list
```

### Manual UI Verification

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

Take evidence during failures:

- screenshots
- Playwright traces
- videos
- logs

Output files:

- `commissioning/ui-test-results.md`
- `commissioning/evidence/`

---

## PHASE 5 — API & Backend Verification

Verify ALL backend routes.

Check:

- request validation
- authentication
- authorization
- error handling
- response consistency

Verify:

- database writes
- database reads
- transactions

Check:

- slow endpoints
- timeout handling
- memory leaks

Output file: `commissioning/api-backend-results.md`

---

## PHASE 6 — Database Validation

Verify:

- file integrity (valid JSON)
- schema consistency
- data integrity
- read/write operations

Databases:

- `server/src/memory/commit-deploy-log.json`
- `server/src/memory/agent-notes.json`
- `server/src/memory/bug-feature-map.json`
- `server/src/memory/feature-test-history.json`
- `memory/healing-incidents.json`
- `memory/healing-metrics.json`

Output file: `commissioning/database-validation.md`

---

## PHASE 7 — Integration & External Service Verification

Verify ALL integrations:

- OpenAI API
- DeepSeek API
- Gemini API
- Telegram Bot API
- GitHub Webhooks
- Redis
- Docker
- PM2
- Nginx
- Tailscale

Confirm:

- systems connected properly
- retries work
- fallback logic works
- error handling works

Output file: `commissioning/integration-results.md`

---

## PHASE 8 — Queue, Worker & Background Job Testing

Verify:

- BullMQ queues process correctly
- Worker processes jobs
- Auto-deployer handles deployments
- Orchestrator worker processes sub-tasks
- Agent runners execute agent work
- Failed jobs retry correctly

Check:

- stuck jobs
- infinite loops
- memory leaks
- duplicate processing

Output file: `commissioning/queue-worker-results.md`

---

## PHASE 9 — File Upload & Storage Testing

Test:

- image uploads
- file uploads
- drag/drop uploads
- large file uploads

Verify:

- upload progress
- storage persistence
- preview rendering
- deletion handling

Output file: `commissioning/file-upload-storage-results.md`

---

## PHASE 10 — Security & Auth Validation

Verify:

- route protection (401 for unauthenticated endpoints)
- session handling
- token expiration
- CORS configuration
- secret exposure
- unsafe uploads

Test:

- invalid permissions
- expired sessions
- unauthorized requests
- broken auth flows

Output file: `commissioning/security-auth-results.md`

---

## PHASE 11 — Performance & Stability Testing

Verify:

- memory usage
- CPU spikes
- API response times
- PM2 restart stability
- Docker container health
- disk usage

Check:

- slow endpoints
- timeout handling
- memory leaks
- retry storms

Output file: `commissioning/performance-stability-results.md`

---

## PHASE 12 — Autonomous Debugging & Recovery

If ANY test fails:

1. inspect logs
2. inspect network requests
3. inspect console errors
4. inspect stack traces
5. identify root cause
6. patch the issue
7. rerun tests
8. verify no regression introduced
9. repeat until resolved

Do NOT stop after first failure.

Continue autonomously until:

- feature fully passes
  OR
- blocker fully documented

Output file: `commissioning/fixes-applied.md`

---

## PHASE 13 — Deployment Readiness Verification

Verify production readiness:

- PM2 ecosystem config valid
- Nginx config valid
- SSL/TLS configured
- Health checks exist
- Logs accessible
- Restart recovery works
- Containers auto-recover
- Monitoring available

Check:

- missing secrets
- invalid production configs
- build reproducibility

Output file: `commissioning/deployment-readiness.md`

---

## PHASE 14 — Final Commissioning Report

Generate a FINAL COMMISSIONING REPORT.

Output file: `commissioning/final-commissioning-report.md`

Include:

### Overall Status

- PASS
- FAIL
- PARTIAL

### Feature Checklist

PASS/FAIL per feature.

### Technical Failures

- failed builds
- failed tests
- broken APIs
- DB failures
- worker failures
- Docker failures

### UI Failures

- broken buttons
- layout issues
- console errors
- network failures
- stuck loading states
- dead routes

### Root Cause Analysis

Explain:

- exact issue source
- affected systems
- severity

### Fixes Applied

List:

- files changed
- functions changed
- configs changed
- migrations applied

### Remaining Risks

List unresolved issues.

### Evidence

Attach:

- screenshots
- traces
- videos
- logs
- console errors
- network failures

---

## Important Rules

NEVER assume something works.

VERIFY EVERYTHING.

Do NOT mark a feature as PASS unless:

- UI verified
- backend verified
- DB verified
- integrations verified
- no hidden console/network issues exist

Test like a REAL HUMAN USER.

Act like a production commissioning engineer before a public launch.
