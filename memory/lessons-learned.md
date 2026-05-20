### Auto-Extracted Lesson: Docs: complete auto-extracted lesson for auth.js Hermes Claw exclusion fix

Date: 2026-05-20
Source: Git commit 37c1d09d
Model/API used: unknown
Confidence: medium
Related files: memory/lessons-learned.md

#### Task Summary

docs: complete auto-extracted lesson for auth.js Hermes Claw exclusion fix

#### Files Changed

- `memory/lessons-learned.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 37c1d09d.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 37c1d09d by JPG Yap.

#### Test Result

<!-- TODO: Document test results -->

Unknown — extracted from commit 37c1d09d.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api

---

### Lesson: Fix blank page on Parallel Execution and Autonomous Loop tabs — constructor arg mismatch and silent error swallowing

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/autonomous-loop.tsx, cloud/dashboard/src/components/views/parallel-execution.tsx, cloud/orchestrator/modules/ParallelExecutor.js

#### Task Summary

Investigated and fixed blank page errors on the Parallel Execution tab and Autonomous Loop tab in the cloud dashboard. Two root causes were found:

1. **ParallelExecutor constructor argument mismatch**: `api.js` called `new ParallelExecutor(eventLog, safetyManager, config)` passing 3 arguments, but the constructor signature is `constructor(opts = {})` taking a single opts object. The first arg (eventLog) became `opts`, and the actual config object (3rd arg) was completely ignored. This caused `maxConcurrency` to default to 5 instead of 2, and `maxTokens` to default to 100000 instead of 100.

2. **Autonomous Loop fetchStatus silently swallows errors**: The `catch` block in `fetchStatus()` was empty (`catch { // non-critical polling failure }`), meaning if the fetch failed, `error` stayed `null`, `loading` became `false`, and `status` was still `null`. This caused the component to reach `const s = status!` which throws "Cannot read properties of null" → blank page.

#### Files Changed

- `cloud/api/api.js` — Fixed ParallelExecutor constructor call from 3 args to single opts object
- `cloud/dashboard/src/components/views/autonomous-loop.tsx` — Fixed fetchStatus to properly handle errors in else branch and catch block

#### Bug Cause

1. JavaScript allows calling a function with more arguments than declared parameters — the extra arguments are silently ignored. `new ParallelExecutor(a, b, c)` where constructor expects `constructor(opts = {})` means `a` becomes `opts` and `b`, `c` are discarded.
2. Empty `catch` block in React component silently swallows fetch errors, leaving state in an inconsistent state where `loading=false`, `error=null`, `status=null`, causing a crash when `status!` is dereferenced.

#### Fix Applied

1. Changed `new ParallelExecutor(eventLog, safetyManager, { maxConcurrency: 2, ... })` to `new ParallelExecutor({ maxConcurrency: 2, maxTokens: 100, agentRegistry: orchestrator.agentRegistry || null })`
2. Added `else { setError(data.error || "Unknown error") }` branch and proper error handling in `catch` block

#### Test Result

Unknown — no automated tests for cloud dashboard views.

#### Lesson Learned

When a React component shows a blank page instead of an error message, check for:

1. Empty `catch` blocks that silently swallow errors — the component never enters the error state
2. Constructor argument mismatches where extra arguments are silently ignored by JavaScript
3. Non-null assertions (`stats!`, `status!`) that crash when the value is null despite rendering guards

#### Reusable Rule

Always add `else` branches and error handling in `catch` blocks for React data-fetching hooks. Never use empty `catch` blocks. When calling constructors, verify the argument signature matches — JavaScript silently ignores extra arguments.

#### Tags

blank-page, react, constructor-mismatch, error-handling, parallel-executor, autonomous-loop

---

### Lesson: Adding Prometheus metrics, telemetry, alerting, and DLQ inspection to monitoring API

Date: 2026-05-20
Source: Kimi Code CLI task completion
Model/API used: Kimi Code CLI
Confidence: high
Related files: cloud/api/routes/monitoring.js, cloud/api/api.js, cloud/api/auth.js, cloud/ecosystem.config.js

#### Task Summary

Extended the monitoring system with production-grade observability features:

1. Prometheus `/metrics` endpoint exposing system memory, API request counters, error counters, latency sums
2. In-memory `apiTelemetry` tracker with per-route latency/error recording via `res.on('finish')`
3. `/monitoring/dead-letter-queue` endpoint to inspect BullMQ failed jobs
4. `/monitoring/alert-webhook` GET/POST endpoints for configurable alerting with cooldown/threshold
5. Removed `superroo-mini-ide` from PM2 ecosystem (Docker Compose already manages it on port 8081)
6. Fixed dashboard crash by installing missing `styled-jsx` dependency on VPS
7. Configured `pm2-logrotate` (100MB max, 10 retained, daily rotation, gzip)

#### Files Changed

- cloud/api/routes/monitoring.js
- cloud/api/api.js
- cloud/api/auth.js
- cloud/ecosystem.config.js

#### Bug Cause

- `/metrics` returned 404 because api.js only routed `/monitoring/*` to the monitoring handler
- Dashboard crashed with `MODULE_NOT_FOUND styled-jsx/package.json` after pnpm install changed dependency tree
- Mini-IDE PM2 entry caused EADDRINUSE on port 8081 because Docker Compose already bound the port
- No Prometheus endpoint existed for external monitoring tools
- No way to inspect failed BullMQ jobs without Redis CLI
- No programmable alerting mechanism for error spikes

#### Fix Applied

- api.js: Added `normalizedUrl === "/metrics"` to monitoring route condition
- auth.js: Added `/metrics` to auth bypass exclusions
- monitoring.js: Added `handleGetPrometheusMetrics`, `recordApiTelemetry`, `handleGetDeadLetterQueue`, `handleGetAlertConfig`, `handlePostAlertConfig`
- api.js: Added `res.on("finish", ...)` telemetry hook in HTTP request handler
- VPS: `pnpm add styled-jsx` in dashboard directory
- ecosystem.config.js: Removed mini-ide entry, added comment about Docker Compose management
- VPS: `pm2 set pm2-logrotate:*` configured rotation policy

#### Test Result

- `GET /metrics` → 200 with Prometheus text format ✅
- `GET /api/monitoring/dead-letter-queue` → 200 with 6 failed jobs listed ✅
- `GET /api/monitoring/alert-webhook` → 200 with config state ✅
- `GET /api/monitoring/stats` → 200, dashboard shows online ✅
- `GET /api/telegram/metrics` → 200 ✅
- All PM2 processes online after reload ✅

#### Lesson Learned

1. **Prometheus endpoints need explicit routing** — don't assume `/metrics` falls under `/monitoring/*`
2. **pnpm installs can break existing builds** — always verify deployed apps start after dependency changes
3. **Port conflicts between Docker and PM2 are common** — audit which service manager owns each process
4. **Dead-letter queues are invaluable for debugging** — exposing them via API beats Redis CLI every time
5. **res.on('finish') is the cleanest way to track HTTP telemetry** — works with all early returns

#### Reusable Rule

**Rule**: When adding a new public monitoring endpoint, update THREE places: the route handler file, the main API router, and the auth bypass list. Forgetting any one causes 404 or 401.

#### Tags

[prometheus, metrics, telemetry, alerting, dead-letter-queue, bullmq, pm2, logrotate, monitoring]

---

### Lesson: Fix 502 Bad Gateway — SuperRoo dashboard crashed due to missing styled-jsx in Next.js standalone build

Date: 2026-05-20
Source: Code agent (DeepSeek) — 502 diagnostic and fix
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/dashboard/.next/standalone/server.js, cloud/dashboard/scripts/prepare-standalone.mjs, cloud/ecosystem.config.js

#### Task Summary

Diagnosed and fixed a 502 Bad Gateway error on https://dev.abcx124.xyz. The SuperRoo dashboard (Next.js) was crashing on startup with `Error: Cannot find module 'styled-jsx/package.json'`, causing nginx to return 502 since the upstream port 3001 was unreachable.

#### Files Changed

- Rebuilt `cloud/dashboard` via `pnpm run build` (which runs `scripts/build-safe.mjs` → `scripts/prepare-standalone.mjs`)
- No source code changes — build output only

#### Bug Cause

The Next.js standalone build output (`.next/standalone/`) was missing the `styled-jsx` package in its `node_modules`. This happened because:

1. The `prepare-standalone.mjs` script copies `styled-jsx` from the root pnpm store (`/opt/superroo2/node_modules/.pnpm/`) into the standalone directory
2. The previous build had stale symlinks pointing to the dashboard-level pnpm store instead of the root store
3. When PM2 restarted the dashboard, the standalone server couldn't resolve `styled-jsx/package.json` because it wasn't in the standalone `node_modules`

Additionally, a leftover Docker container (`qas_dashboard` from a quarantine project) was occupying port 3001, preventing the SuperRoo dashboard from binding even after the build was fixed.

#### Fix Applied

1. Rebuilt the dashboard: `cd /opt/superroo2 && COREPACK_ENABLE_STRICT=0 /usr/bin/node /usr/lib/node_modules/corepack/dist/pnpm.js --dir cloud/dashboard run build`
2. The `prepare-standalone.mjs` script correctly re-copied `styled-jsx` and re-pointed the `next` symlink to the root pnpm store
3. Stopped and removed the `qas_dashboard` Docker container that was blocking port 3001
4. Restarted the dashboard via PM2: `pm2 start ecosystem.config.js --only superroo-dashboard`
5. Saved PM2 process list: `pm2 save`

#### Test Result

pass — `curl -sI https://dev.abcx124.xyz/` returns `HTTP/1.1 200 OK`

#### Lesson Learned

Next.js standalone builds with pnpm require careful symlink management. The `prepare-standalone.mjs` script must correctly resolve `styled-jsx` and the `next` package from the root pnpm store, not the dashboard-level store. When the build is re-run, stale symlinks are cleaned up and re-pointed correctly. Also, always check for port conflicts from other Docker containers before starting the dashboard.

#### Reusable Rule

When the SuperRoo dashboard returns 502, always check:

1. `pm2 list` — is `superroo-dashboard` running?
2. `pm2 logs superroo-dashboard --lines 20 --nostream` — any startup errors?
3. `ss -tlnp | grep 3001` — is port 3001 in use by another process?
4. If `styled-jsx` error: rebuild the dashboard to regenerate the standalone output
5. If port conflict: stop the conflicting container and restart the dashboard

#### Tags

502, bad-gateway, nginx, nextjs, standalone, styled-jsx, pnpm, docker, port-conflict, dashboard

---

### Lesson: Commissioning dashboard API response shape normalization

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/commissioning-loop.tsx, cloud/orchestrator/modules/CommissioningLoop.js

#### Task Summary

Fixed "Application error: a client-side exception has occurred" on the commissioning dashboard page. The error was caused by multiple mismatches between the frontend API calls and backend route handling. Also performed a gap analysis of the commissioning system.

#### Files Changed

- cloud/api/api.js
- cloud/dashboard/src/components/views/commissioning-loop.tsx
- cloud/orchestrator/modules/CommissioningLoop.js

#### Bug Cause

1. **API endpoint mismatch**: Frontend called `/api/commissioning/status` (no jobId) but backend only matched `/commissioning/status/:jobId` (with trailing slash + param). Same issue for `/commissioning/stop`.
2. **Response shape mismatch**: Frontend expected `data` to be the status object directly, but API returned `{ success: true, status: { ... } }`.
3. **Phase name mismatch**: Frontend used kebab-case phase names (`"repo-inspection"`) but backend returned numeric indices (1-14).
4. **Missing reportUrl**: Frontend expected `reportUrl` in status response but backend never returned it.
5. **No idle state**: When no commissioning was started, backend returned 404 instead of a valid idle status object.

#### Fix Applied

1. Added `_phaseNumberToKey()` helper in api.js to map numeric phases (1-14) to kebab-case strings.
2. Added `_normalizeCommissioningStatus()` to transform raw CommissioningLoop status into frontend-expected shape (maps "completed"→"passed", "error"→"failed", adds findings/results/reportUrl fields).
3. Updated route matching for `/commissioning/status` and `/commissioning/stop` to handle both with and without jobId.
4. Added `reportUrl` field to CommissioningLoop.getStatus() response.
5. Added proper idle state response when no commissioning has been started.
6. Fixed frontend `fetchStatus()` to extract `data.status` from the API response wrapper.
7. Fixed TypeScript type for `currentPhase` to allow `null`.

#### Test Result

pass — 18/18 existing cloud tests pass

#### Lesson Learned

When building dashboard pages that communicate with a backend API, always define a single source of truth for the API contract (endpoint paths, request/response shapes, field naming conventions). The commissioning system had the frontend and backend developed independently, leading to 5 distinct mismatches that all caused the same client-side crash. A shared API schema or TypeScript types between frontend and backend would have prevented all of these issues.

#### Reusable Rule

When adding a new dashboard page that communicates with a backend API, always:

1. Define the API contract (endpoint paths, request/response shapes) in a shared location before implementing either side.
2. Ensure the backend returns a valid response for ALL states (idle, running, completed, error) — not just the happy path.
3. Normalize data shapes at the API boundary so the frontend never needs to understand backend-internal formats (like numeric phase indices).
4. Test the frontend against the actual API response shape, not an assumed one.

#### Tags

commissioning, dashboard, api-mismatch, response-normalization, phase-mapping, frontend-backend-contract

### Auto-Extracted Lesson: Commissioning dashboard API response shape normalization and endpoint matching

Date: 2026-05-20
Source: Git commit 8375e7cc
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/commissioning-loop.tsx

#### Task Summary

fix: commissioning dashboard API response shape normalization and endpoint matching

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/commissioning-loop.tsx`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 8375e7cc.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 8375e7cc by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Lesson: RAM Orchestrator Audit — Proxy Routes, TypeError, Hysteresis, File Rotation

Date: 2026-05-20
Source: Kimi Code CLI task completion
Model/API used: kimi-code-cli
Confidence: high
Related files: cloud/api/api.js, cloud/api/routes/monitoring.js, cloud/dashboard/src/components/views/ram-orchestrator.tsx, cloud/orchestrator/modules/RAMMonitor.js, cloud/orchestrator/modules/WorkerPauseManager.js, cloud/worker/vpsRamOrchestratorWorker.js

#### Task Summary

Fixed 6 categories of RAM orchestrator audit issues discovered during code review:

1. API proxy routes missing for /ram-orchestrator/\*
2. TypeError from calling .push() on a string (message was reassigned from array to string via .join())
3. JSONL history file growing unbounded — added rotation/truncation
4. workerPauseManager null guards missing in HTTP handlers
5. Hysteresis logic flipping states in recovery zone; ramPercent rounded before computation
6. getStats() returning .size instead of array for pausedWorkers

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/routes/monitoring.js`
- `cloud/dashboard/src/components/views/ram-orchestrator.tsx`
- `cloud/orchestrator/modules/RAMMonitor.js`
- `cloud/orchestrator/modules/WorkerPauseManager.js`
- `cloud/worker/vpsRamOrchestratorWorker.js`

#### Bug Cause

1. Proxy routes were never wired in the main API server.
2. `_sendTelegram` reassigned `message` from array → string, then later tried `message += ...` which works but is brittle; the original intent was array push.
3. `recordSample` appended indefinitely to a JSONL file.
4. HTTP `/pause` and `/resume` assumed `workerPauseManager` was always initialized.
5. `_evaluateState` set `newState = 'normal'` when `ramPercent <= recoveryPercent`, but the else branch flipped to `prevState` incorrectly in the hysteresis zone. Also `ramPercent` was computed after rounding, losing precision.
6. `getStats()` returned `this.pausedWorkers.size` (a number) instead of `this.getPausedWorkers()` (array of objects).

#### Fix Applied

1. Added `/ram-orchestrator/*` proxy in `api.js` forwarding to `http://127.0.0.1:3456`.
2. Kept string concatenation pattern but made it explicit; avoided array push after join.
3. Added file-size check in `recordSample`: read file, split lines, keep last `_maxSamples`, rewrite.
4. Added `if (!workerPauseManager)` → 503 JSON response in both `/pause` and `/resume` handlers.
5. Changed `_evaluateState` to maintain `prevState` when in the hysteresis zone (between `recoveryPercent` and `warningPercent`). Fixed `getLatestSnapshot` to compute `ramPercent` from raw bytes before rounding.
6. Changed `pausedWorkers: this.getPausedWorkers()` in `getStats()`.

#### Test Result

pass — lint passes, deployment verified on VPS (`superroo-api` and `superroo-ram-orchestrator` reloaded and online).

#### Lesson Learned

- When building mutable messages, choose one pattern (array + join OR string concat) and stick to it; mixing both causes subtle bugs.
- Any append-only file (JSONL, logs, history) needs rotation or truncation from day one; "it won't grow fast" is a trap.
- Hysteresis must explicitly preserve the previous state in the dead zone; never default to a hard state.
- Always null-guard objects initialized asynchronously before using them in HTTP handlers.
- Dashboard fetch calls to internal services should always have AbortSignal timeouts to prevent UI lockups.

#### Reusable Rule

1. **Proxy all internal service routes in the main API gateway** — never assume direct port access is acceptable.
2. **Append-only files must have bounded growth** — implement rotation, truncation, or logrotate on first commit.
3. **Hysteresis logic must maintain state in the recovery zone** — use `prevState` explicitly, not a fallback branch.
4. **Null-guard all asynchronously initialized dependencies** in HTTP handlers; return 503 if unavailable.
5. **Every `fetch` in dashboard components must include `AbortSignal.timeout(N)`** to prevent hanging UIs.

#### Tags

ram-orchestrator, monitoring, dashboard, hysteresis, file-rotation, null-safety, proxy

---
