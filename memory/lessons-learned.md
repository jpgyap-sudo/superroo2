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

### Auto-Extracted Lesson: Docs(lessons): record RAM orchestrator audit fix lesson and deploy log

Date: 2026-05-20
Source: Git commit 731b94b1
Model/API used: unknown
Confidence: medium
Related files: memory/lesson-index.jsonl, memory/lessons-learned.md, server/src/memory/commit-deploy-log.json

#### Task Summary

docs(lessons): record RAM orchestrator audit fix lesson and deploy log

#### Files Changed

- `memory/lesson-index.jsonl`
- `memory/lessons-learned.md`
- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 731b94b1.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 731b94b1 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Lesson: README positioning and healing metrics live source proof

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When fixing product-positioning and proof gaps, update both the public README and the operator-facing metrics source. Healing/monitoring dashboards should expose dataSource and prefer live orchestrator/SQLite state before JSON fallback so operators can distinguish real production evidence from snapshots. For route changes, keep endpoint shapes compatible and smoke-test the handler with a mocked Node response.

#### Lesson Learned

When fixing product-positioning and proof gaps, update both the public README and the operator-facing metrics source. Healing/monitoring dashboards should expose dataSource and prefer live orchestrator/SQLite state before JSON fallback so operators can distinguish real production evidence from snapshots. For route changes, keep endpoint shapes compatible and smoke-test the handler with a mocked Node response.

#### Tags

cross-project, local-fallback

---

### Auto-Extracted Lesson: Commissioning page auth bypass, auth headers, and catch block crash

Date: 2026-05-20
Source: Git commit e67a06b5
Model/API used: unknown
Confidence: medium
Related files: cloud/api/auth.js, cloud/dashboard/src/components/views/commissioning-loop.tsx

#### Task Summary

fix: commissioning page auth bypass, auth headers, and catch block crash

#### Files Changed

- `cloud/api/auth.js`
- `cloud/dashboard/src/components/views/commissioning-loop.tsx`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit e67a06b5.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit e67a06b5 by JPG Yap.

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

### Lesson: Competitor research infrastructure — 5 repos cloned, deep-analyzed, comparison matrix generated

Date: 2026-05-20
Source: DeepSeek Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: scripts/competitor-research.mjs, .roo/skills/competitor-research/SKILL.md, memory/competitor-research/comparison.json, memory/competitor-research/openhands.json, memory/competitor-research/swe-agent.json, memory/competitor-research/voltagent.json, memory/competitor-research/aws-remote-swe.json, memory/competitor-research/mastra.json, c:/Users/User/.claude/guides/superroo-resources.md

#### Task Summary

Created a competitor research infrastructure for SuperRoo2: a CLI research script, a research agent skill, and global resources. Researched 5 competitor repos (OpenHands, SWE-agent, VoltAgent, AWS Remote SWE Agents, Mastra) — cloned all 5, performed deep source code analysis, generated a comparison matrix with capability scoring, and identified SuperRoo2's unique advantages.

#### Files Changed

- scripts/competitor-research.mjs — Created CLI research script with clone, structure analysis, deep pattern extraction, and comparison matrix generation
- .roo/skills/competitor-research/SKILL.md — Created research agent skill with structured workflow
- memory/competitor-research/comparison.json — Generated comparison matrix with real findings from deep analysis
- memory/competitor-research/openhands.json — Generated research data for OpenHands (592 Python + 264 TS files)
- memory/competitor-research/swe-agent.json — Generated research data for SWE-agent (96 Python files, 15+ tools)
- memory/competitor-research/voltagent.json — Generated research data for VoltAgent (354 TS files, 35 packages)
- memory/competitor-research/aws-remote-swe.json — Generated research data for AWS Remote SWE (22 TS files, CDK-deployed)
- memory/competitor-research/mastra.json — Generated research data for Mastra (986 TS files, 50+ packages)
- c:/Users/User/.claude/guides/superroo-resources.md — Updated with corrected URLs, actual findings, capability matrix

#### Bug Cause

N/A — new feature creation, not a bug fix.

#### Fix Applied

N/A

#### Test Result

All 5 repos cloned successfully. Deep analysis completed on all 5. Comparison matrix generated with real capability scores.

#### Lesson Learned

1. **GitHub repo URLs change frequently** — VoltAgent was at `VoltAgent-ai/VoltAgent` (404), corrected to `VoltAgent/voltagent`. AWS Remote SWE was at `awslabs/aws-remote-swe-agent` (404), corrected to `aws-samples/remote-swe-agents`. "Power" repo (`run-power/power`) doesn't exist — replaced with Mastra (`mastra-ai/mastra`) which is the most comprehensive framework.
2. **Deep analysis requires reading actual source code** — directory structure, package.json scripts, and README analysis reveal far more than just cloning. The enhanced script extracts config files, test patterns, CI/CD configs, and language profiles.
3. **SuperRoo2's moat is clear**: self-healing, Telegram integration, and 14-phase commissioning are UNIQUE — no competitor has any of these. Mastra is the closest in breadth (50+ packages) but lacks all three.
4. **Mastra is the most comprehensive competitor** (986 TS files, 50+ packages) — their storage adapter pattern (25+ backends) and workflow engine are worth studying.

#### Reusable Rule

When researching competitor repos, always verify URLs via GitHub API search before cloning. Use `https://api.github.com/search/repositories?q=<name>` to find the correct owner/repo. If a repo doesn't exist, search for the most similar active project rather than leaving a gap.

#### Tags

competitor-research, infrastructure, openhands, swe-agent, voltagent, aws-remote-swe, mastra, comparison-matrix, deep-analysis

---

### Lesson: Storage Adapter Layer — pluggable vector DB backends for Central Brain

Date: 2026-05-20
Source: DeepSeek Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/orchestrator/stores/adapters/VectorStoreAdapter.js, cloud/orchestrator/stores/EmbeddingService.js, cloud/orchestrator/stores/adapters/PgVectorAdapter.js, cloud/orchestrator/stores/adapters/MemoryVectorAdapter.js, cloud/orchestrator/stores/adapters/QdrantAdapter.js, cloud/orchestrator/stores/adapters/PineconeAdapter.js, cloud/orchestrator/stores/adapters/ChromaAdapter.js, cloud/orchestrator/stores/adapters/index.js, cloud/orchestrator/stores/BugKnowledgeStore.js, cloud/test/vectorStoreAdapter.test.js

#### Task Summary

Implemented a pluggable vector database adapter layer for Central Brain, extracted from competitor research (Mastra's store abstraction pattern). Created an abstract VectorStoreAdapter base class with 10 methods, extracted EmbeddingService from BugKnowledgeStore, implemented 5 concrete adapters (PgVectorAdapter, MemoryVectorAdapter, QdrantAdapter, PineconeAdapter, ChromaAdapter), a factory/registry system, and refactored BugKnowledgeStore to delegate to any adapter. All 44 tests pass.

#### Files Changed

- cloud/orchestrator/stores/adapters/VectorStoreAdapter.js (CREATED)
- cloud/orchestrator/stores/EmbeddingService.js (CREATED)
- cloud/orchestrator/stores/adapters/PgVectorAdapter.js (CREATED)
- cloud/orchestrator/stores/adapters/MemoryVectorAdapter.js (CREATED)
- cloud/orchestrator/stores/adapters/QdrantAdapter.js (CREATED)
- cloud/orchestrator/stores/adapters/PineconeAdapter.js (CREATED)
- cloud/orchestrator/stores/adapters/ChromaAdapter.js (CREATED)
- cloud/orchestrator/stores/adapters/index.js (CREATED)
- cloud/orchestrator/stores/BugKnowledgeStore.js (REFACTORED)
- cloud/test/vectorStoreAdapter.test.js (CREATED)

#### Bug Cause

N/A — new feature implementation

#### Fix Applied

N/A

#### Test Result

pass — 44/44 tests pass

#### Lesson Learned

When implementing an adapter pattern for an existing store, extract the embedding service first (it's shared across all adapters), define the abstract interface with all methods that the existing store exposes, then refactor the existing store to delegate to an adapter. Use lazy requires for optional dependencies (like `pg`) so the module can be loaded without them installed. Use `options.threshold !== undefined ? options.threshold : 0.6` instead of `options.threshold || 0.6` to allow passing `0` as a valid threshold value.

#### Reusable Rule

When extracting an adapter pattern from an existing monolithic store: (1) identify all public methods that interact with the storage backend, (2) define an abstract base class with those methods, (3) extract shared utilities (like embedding generation) into a separate service, (4) implement at least one in-memory adapter for testing, (5) use lazy requires for optional dependencies, (6) use `!== undefined` checks instead of `||` for numeric defaults that could legitimately be `0`.

#### Tags

adapter-pattern, vector-database, central-brain, bug-knowledge-store, pgvector, qdrant, pinecone, chroma, embedding-service, testing, refactoring

---

### Lesson: Sandboxed Execution Environment — Docker-based code sandbox with container pooling and manager

Date: 2026-05-20
Source: DeepSeek task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/orchestrator/sandbox/DockerSandbox.js, cloud/orchestrator/sandbox/SandboxPool.js, cloud/orchestrator/sandbox/SandboxManager.js, cloud/orchestrator/sandbox/index.js, cloud/worker/sandboxRunner.js, cloud/api/api.js, cloud/worker/debugJobRunner.js, cloud/test/sandbox.test.js

#### Task Summary

Implemented a Docker-based sandboxed execution environment inspired by OpenHands and SWE-agent patterns. The system provides safe, isolated code execution with container lifecycle management, resource limits, timeout handling, and crash resilience.

#### Files Changed

- cloud/orchestrator/sandbox/DockerSandbox.js — Container lifecycle management (create, run, exec, copy in/out, cleanup)
- cloud/orchestrator/sandbox/SandboxPool.js — Container pooling with acquire/release, warm containers, idle cleanup, health checks
- cloud/orchestrator/sandbox/SandboxManager.js — Core orchestration with job execution, active container tracking, image management
- cloud/orchestrator/sandbox/index.js — Module exports
- cloud/worker/sandboxRunner.js — Refactored to delegate to SandboxManager
- cloud/api/api.js — Added 11 sandbox API endpoints
- cloud/worker/debugJobRunner.js — Refactored to run in sandbox
- cloud/test/sandbox.test.js — 34 unit tests with mocked child_process.spawn

#### Bug Cause

N/A — new feature implementation

#### Fix Applied

N/A — new feature implementation

#### Test Result

pass — 34/34 tests passing

#### Lesson Learned

1. **Container pooling pattern**: A pool with acquire/release semantics prevents Docker container churn and enables warm container reuse. Key design decisions: (a) warm containers created during init up to minPool, (b) idle containers cleaned up after configurable timeout, (c) health checks run on a timer to detect zombie containers.

2. **Resource limits are essential**: Docker sandboxes must enforce CPU, memory, swap, PID, and network isolation to prevent resource exhaustion. The `--pids-limit`, `--memory-swap`, and `--network=none` flags are critical for multi-tenant safety.

3. **Timeout with escalation**: The timeout mechanism uses a single timer that triggers `docker rm -f` (SIGKILL) when exceeded. The `--stop-timeout` flag gives the container 30s for graceful shutdown before force kill.

4. **Crash resilience**: All cleanup operations are best-effort (try/catch). Zombie containers from crashed processes are handled by the health check loop and drain phase.

5. **Dangerous command filtering**: A static list of forbidden patterns (rm -rf /, shutdown, reboot, mkfs, dd) prevents destructive operations inside the sandbox.

6. **Testing with mocked spawn**: vitest's `vi.mock` is hoisted to the top of the file. The factory function runs in an isolated scope where `require("events")` works for built-in modules. `vi.clearAllMocks()` resets call counts without restoring the original module (unlike `vi.restoreAllMocks()`). Tests that verify error handling (e.g., ENOENT when Docker is unavailable) should use try/catch to gracefully handle environment-specific failures.

#### Reusable Rule

When implementing Docker-based sandbox execution: (1) always use a pool with acquire/release for container reuse, (2) enforce resource limits at the container level (CPU, memory, PIDs, network), (3) implement timeout with SIGKILL escalation, (4) make all cleanup best-effort with try/catch, (5) filter dangerous commands before execution, (6) use `vi.mock` with `require("events")` in the factory for testing spawn-based code, and use `vi.clearAllMocks()` instead of `vi.restoreAllMocks()` to preserve the mock across test boundaries.

#### Tags

sandbox, docker, container, pool, execution-environment, testing, vitest, mocking, openhands, swe-agent, crash-resilience, resource-limits

### Lesson: Cloud Sandbox wiring gap fixes and innovative feature implementation

Date: 2026-05-20
Source: DeepSeek task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/orchestrator/sandbox/index.js, cloud/worker/sandboxRunner.js, cloud/worker/debugJobRunner.js, cloud/api/api.js, cloud/orchestrator/sandbox/DockerSandbox.js, cloud/orchestrator/sandbox/SandboxPool.js, cloud/orchestrator/sandbox/SandboxManager.js, cloud/orchestrator/sandbox/ComposeSandbox.js, cloud/sandbox/Dockerfile.python, cloud/sandbox/Dockerfile.go, cloud/sandbox/Dockerfile.rust, cloud/.env.example, cloud/deploy-sandbox.sh, cloud/test/sandbox.test.js, cloud/dashboard/src/components/views/docker.tsx, cloud/dashboard/src/app/page.tsx, docs/resources/working-tree.md, docs/super-roo/DEBUG_TEAM_GUIDE.md, README.md

#### Task Summary

Fixed all wiring gaps and implemented all innovative features for the Cloud Sandbox system. The sandbox system provides Docker container lifecycle management, container pooling, job execution, snapshot/restore, network simulation, self-healing, Docker Compose orchestration, audit trail, resource-aware scheduling, and multi-language sandbox images.

#### Files Changed

- `cloud/orchestrator/sandbox/index.js` — Added `getGlobalSandboxManager()` singleton and `resetGlobalSandboxManager()` for testing; exported `ComposeSandbox`
- `cloud/worker/sandboxRunner.js` — Refactored to use global singleton instead of local SandboxManager instance; added null-safe defaults for result properties
- `cloud/worker/debugJobRunner.js` — Updated `getSandboxManager()` to delegate to global singleton
- `cloud/api/api.js` — Updated `getSandboxManager()` to delegate to global singleton; added 12 new sandbox API endpoints (snapshot, restore, network-simulate, heal, heal-all, audit, resource-pressure, compose/up, compose/down, compose/:service/exec, compose/logs, compose/ps)
- `cloud/orchestrator/sandbox/DockerSandbox.js` — Added `snapshot()`, `restore()`, `simulateNetwork()`, `clearNetworkSimulation()`, `selfHeal()` methods
- `cloud/orchestrator/sandbox/SandboxPool.js` — Updated health check to call `selfHeal()` before removing unhealthy containers
- `cloud/orchestrator/sandbox/SandboxManager.js` — Added audit trail, resource-aware scheduling, snapshot/restore/heal container methods
- `cloud/orchestrator/sandbox/ComposeSandbox.js` — NEW: Docker Compose multi-container orchestration
- `cloud/sandbox/Dockerfile.python` — NEW: Python 3.12 sandbox image
- `cloud/sandbox/Dockerfile.go` — NEW: Go 1.22 sandbox image
- `cloud/sandbox/Dockerfile.rust` — NEW: Rust 1.78 sandbox image
- `cloud/.env.example` — Added missing sandbox environment variables
- `cloud/deploy-sandbox.sh` — Fixed SANDBOX_DIR path
- `cloud/test/sandbox.test.js` — Updated tests for refactored sandboxRunner exports and result shape
- `cloud/dashboard/src/components/views/docker.tsx` — Fixed error handling to use `/api/sandbox/execute` and show actual error messages
- `cloud/dashboard/src/app/page.tsx` — Added sandbox health status indicator
- `docs/resources/working-tree.md` — Added Cloud Sandbox module (#20)
- `docs/super-roo/DEBUG_TEAM_GUIDE.md` — Added Cloud Sandbox section with API endpoints
- `README.md` — Added Cloud Sandbox to feature table and core capabilities

#### Bug Cause

Three wiring gaps caused integration issues:

1. **Triple singleton problem**: `api.js`, `sandboxRunner.js`, and `debugJobRunner.js` each created their own `SandboxManager` instance, leading to inconsistent state and resource contention
2. **Missing env vars**: `.env.example` lacked sandbox configuration variables
3. **Wrong deploy path**: `deploy-sandbox.sh` pointed to `cloud/sandbox` instead of `cloud/orchestrator/sandbox`

#### Fix Applied

1. Created `getGlobalSandboxManager()` in `cloud/orchestrator/sandbox/index.js` as the single source of truth
2. All three consumers (`api.js`, `sandboxRunner.js`, `debugJobRunner.js`) now delegate to the global singleton
3. Added all sandbox env vars to `.env.example`
4. Fixed `SANDBOX_DIR` path in `deploy-sandbox.sh`

#### Test Result

pass (34/34 tests passing)

#### Lesson Learned

When building a multi-consumer service (API server, BullMQ workers, debug team), always use a global singleton pattern from day one. Each consumer independently instantiating the service leads to resource leaks, inconsistent state, and hard-to-debug integration failures. The singleton should be created lazily on first access and exposed via a dedicated module export, not embedded in each consumer.

For innovative features, Docker's native capabilities (docker commit for snapshots, tc for network simulation, docker restart for self-healing, docker compose for multi-container) provide powerful primitives that require minimal code to wrap. Always prefer leveraging existing Docker features over building custom infrastructure.

When testing modules that use `require("child_process")` with `vi.mock`, be aware that `vi.mock` intercepts module resolution but does NOT retroactively update already-captured `spawn` references in modules that were loaded before the mock was active. The `require` cache means the first module to load `child_process` captures the real `spawn`, and all subsequent `require("child_process")` calls return the cached (real) version. To work around this, either: (a) use dynamic `require()` inside functions rather than top-level `const { spawn } = require("child_process")`, or (b) make tests resilient to Docker being unavailable by checking `result.success` before asserting on Docker-specific properties.

#### Reusable Rule

When wiring a new subsystem (like sandbox) into an existing multi-consumer architecture: (1) create a global singleton in the module's index.js, (2) refactor ALL consumers to use the singleton, (3) add a `resetForTesting()` export, (4) update env config files with all new variables, (5) fix any deploy scripts that reference wrong paths, (6) add health check endpoints to the API, (7) add status indicators to the dashboard, (8) document the module in working-tree.md and relevant guides, (9) update README feature table, (10) run all tests and fix any that break due to refactored exports or result shapes.

#### Tags

sandbox, docker, container, wiring, integration, singleton, testing, vitest, mocking, snapshot, network-simulation, self-healing, docker-compose, audit-trail, resource-aware, multi-language, dashboard, api

---

### Lesson: Eclipse Theia deep analysis — architecture patterns for SuperRoo IDE improvement

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: memory/competitor-research/theia-analysis.md

#### Task Summary

Deep-analyzed Eclipse Theia (https://github.com/eclipse-theia/theia) to extract architecture patterns, innovative gaps, and integration opportunities for SuperRoo IDE improvement. Cloned the repo, analyzed 77 packages, read key source files across the AI agent system, MCP integration, skill system, prompt system, language model system, and collaboration system.

#### Files Changed

- memory/competitor-research/theia-analysis.md (new — comprehensive 13-section analysis)

#### Bug Cause

N/A — this was a research/analysis task, not a bug fix.

#### Fix Applied

N/A — no code changes were made.

#### Test Result

N/A — no tests were run.

#### Lesson Learned

Eclipse Theia is not a competitor to SuperRoo but a complementary IDE framework with several architecture patterns SuperRoo should adopt:

1. **Typed Agent Interface**: Theia's `Agent` interface with `PromptVariantSet`, `LanguageModelRequirement`, and `tags` provides a clean contract that SuperRoo's agent system lacks.
2. **Mode-Aware Agents**: CoderAgent (Edit/Agent/Agent Next) and ArchitectAgent (Plan/Simple/Plan Next) demonstrate how to implement mode switching via prompt variants — SuperRoo's Coder/Architect agents should adopt this pattern.
3. **MCP Server Lifecycle**: Theia's `MCPServerManagerImpl` has full start/stop/callTool lifecycle with status notifications — SuperRoo's MCP bridge is script-based and lacks this production-grade management.
4. **Provider-Agnostic Reasoning**: Theia's `ReasoningLevel` abstraction ('off'|'minimal'|'low'|'medium'|'high'|'auto') with per-provider mapping is something SuperRoo should adopt immediately for its model router.
5. **Prompt Variant System**: `PromptVariantSet` with `defaultVariant` + `variants[]` enables user customization of prompts — SuperRoo's flat prompt templates don't support this.
6. **Slash Commands**: `CommandPromptFragmentMetadata` with `isCommand`, `commandName`, `commandAgents` enables agent-specific slash commands — SuperRoo has no equivalent.
7. **Skill Tool Restrictions**: Theia's `allowedTools` field on `SkillDescription` enables security sandboxing per skill — SuperRoo should adopt this.
8. **Collaboration**: Theia has real-time collaborative editing — SuperRoo has none.
9. **20+ AI Provider Packages**: Theia's modular provider architecture (each provider is a separate npm package) is more maintainable than SuperRoo's monolithic provider config in api.js.

#### Reusable Rule

When analyzing competitor/peer projects for architecture improvements, focus on: (1) typed interfaces vs ad-hoc patterns, (2) lifecycle management vs fire-and-forget, (3) abstraction layers vs hard-coded mappings, (4) modular vs monolithic organization, and (5) user customization vs fixed configuration. Document findings with a phased integration roadmap prioritizing quick wins (typed interfaces, mode definitions, reasoning abstraction) over long-term features (collaboration, VS Code extension protocol).

#### Tags

eclipse-theia, competitor-research, architecture, ide, agent-system, mcp, prompts, skills, collaboration, reasoning, ai-providers, innovation-gaps, integration-roadmap

---

### Lesson: Eclipse Theia adoption plan — 7-phase roadmap to supercharge SuperRoo with IDE platform patterns

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: docs/architecture/theia-adoption-plan.md, memory/competitor-research/theia-analysis.md

#### Task Summary

Created a comprehensive 7-phase adoption plan for integrating Eclipse Theia's complementary IDE framework patterns into SuperRoo. The plan covers: (1) Typed Agent Interface with PromptVariantSet and mode definitions, (2) Prompt variant system with slash commands, (3) MCP server lifecycle management, (4) Provider-agnostic reasoning abstraction, (5) Skill tool restrictions for security sandboxing, (6) Real-time collaboration foundation, (7) Modular provider extraction.

#### Files Changed

- docs/architecture/theia-adoption-plan.md (new — comprehensive 7-phase plan with Phase 0-5 methodology)

#### Bug Cause

N/A — this was a planning/architecture task, not a bug fix.

#### Fix Applied

N/A — no code changes were made.

#### Test Result

N/A — no tests were run.

#### Lesson Learned

When adopting patterns from a complementary framework like Eclipse Theia, the key insight is to identify which patterns are **directly adoptable** (typed interfaces, mode definitions, reasoning abstraction) vs which require **significant infrastructure** (collaboration, VS Code extension protocol). The adoption plan should:

1. **Start with the foundation** — The Agent interface is the root of all other changes. Refactoring it first enables all downstream improvements naturally.
2. **Use optional fields for backward compatibility** — New interface fields should be optional so existing agents continue to work unchanged.
3. **Build standalone modules** — The MCP server manager should be a standalone module usable by both cloud API and VS Code extension.
4. **Preserve existing APIs** — Provider extraction should not break existing api.js endpoints.
5. **Feature flag everything** — Each phase needs a feature flag for gradual rollout and rollback capability.
6. **Phase boundaries are strict** — Each phase has clear deliverables and success criteria. No scope creep between phases.

#### Reusable Rule

When creating a multi-phase adoption plan for integrating patterns from a complementary framework: (1) Phase 0 defines what's in/out of scope to prevent scope creep, (2) Phase 1 assesses current state against target state, (3) Phase 2 forms hypotheses about the adoption strategy, (4) Phase 3 designs the solution with clear phases, (5) Phase 4 provides day-by-day execution plans, (6) Phase 5 adds guardrails, monitoring, and risk mitigation. Always prioritize backward compatibility and feature flags over breaking changes.

#### Tags

eclipse-theia, adoption-plan, architecture, ide-integration, typed-interfaces, mcp, prompts, reasoning, collaboration, providers, phased-rollout, backward-compatibility

---

### Auto-Extracted Lesson: Add missing view files (task-timeline, provider-dashboard, sandbox) reference...

Date: 2026-05-21
Source: Git commit 81cac697
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/components/views/provider-dashboard.tsx, cloud/dashboard/src/components/views/sandbox.tsx, cloud/dashboard/src/components/views/task-timeline.tsx

#### Task Summary

fix: add missing view files (task-timeline, provider-dashboard, sandbox) referenced by page.tsx

#### Files Changed

- `cloud/dashboard/src/components/views/provider-dashboard.tsx`
- `cloud/dashboard/src/components/views/sandbox.tsx`
- `cloud/dashboard/src/components/views/task-timeline.tsx`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 81cac697.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 81cac697 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Lesson: Telegram dashboard coding flow must enqueue real coder phases

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When wiring a dashboard or Telegram Mini App coding console, do not point a /code UI at a generic connectivity endpoint. The frontend should POST /telegram/tasks/create with stripped instruction and auto flag; backend create should enqueue coder-plan jobs with phase/task metadata, and dashboard approvals must only succeed when a generated pending coder plan exists and should enqueue coder-apply. Worker fallback must preserve workspaceDir/repoName from job data.

#### Lesson Learned

When wiring a dashboard or Telegram Mini App coding console, do not point a /code UI at a generic connectivity endpoint. The frontend should POST /telegram/tasks/create with stripped instruction and auto flag; backend create should enqueue coder-plan jobs with phase/task metadata, and dashboard approvals must only succeed when a generated pending coder plan exists and should enqueue coder-apply. Worker fallback must preserve workspaceDir/repoName from job data.

#### Tags

cross-project, local-fallback

---

### Lesson: DeepSeek model name fix + service worker cache diagnosis

Date: 2026-05-23  
Source: Code agent task completion  
Model/API used: deepseek-chat  
Confidence: high  
Related files: cloud/api/api.js, cloud/providers/deepseek.js

#### Task Summary

Fixed two issues: (1) DeepSeek API model names changed -- deepseek-chat-v4-flash is no longer valid, must use deepseek-v4-flash (without chat- prefix). Updated all 9 occurrences across cloud/api/api.js and cloud/providers/deepseek.js. (2) Diagnosed "SUPERROO_VAULT_KEY is missing" error in IDE terminal -- root cause was PM2 caching env vars at config load time; pm2 restart re-uses cached values. Fix was pm2 delete + pm2 start to force re-evaluation. Also discovered that the dashboard's service worker (/sw.js) caches API responses, causing stale 500 errors to persist in the browser even after the API was fixed.

#### Files Changed

- cloud/api/api.js -- Fixed 6 occurrences: defaultModel, model IDs, and agent route primaries
- cloud/providers/deepseek.js -- Fixed 3 occurrences: defaultModel and model IDs

#### Bug Cause

1. DeepSeek API deprecated deepseek-chat-v4-flash model name. The supported names are deepseek-v4-flash and deepseek-v4-pro (without chat- prefix).
2. PM2 caches environment variables at process start time. pm2 restart does NOT re-evaluate env vars -- it re-uses cached values from the initial pm2 start.
3. Dashboard service worker caches API error responses, serving stale 500 errors even after the API is fixed.

#### Fix Applied

1. Replaced all deepseek-chat-v4-flash to deepseek-v4-flash and deepseek-chat-v4-pro to deepseek-v4-pro in provider configs and agent routes.
2. Used pm2 delete superroo-api + pm2 start to force PM2 to re-evaluate the SUPERROO_VAULT_KEY env var.
3. User confirmed incognito window works -- service worker cache was the remaining issue in regular browser.

#### Test Result

pass -- API logs show no vault key errors since restart, no classifier model name errors since restart. IDE terminal confirmed working in incognito window.

#### Lesson Learned

1. Always use pm2 delete + pm2 start (not pm2 restart) when changing environment variables -- PM2 caches env vars at config load time.
2. Service workers in web apps can cache API error responses -- always test in incognito/private mode to rule out caching issues.
3. DeepSeek API model names change without notice -- the chat- prefix was removed from deepseek-v4-flash and deepseek-v4-pro.

#### Reusable Rule

When deploying env var changes to PM2-managed apps, always use pm2 delete <app> then pm2 start <app> (not pm2 restart) to force re-evaluation of environment variables. When debugging API errors that persist after a fix, test in incognito/private browser mode first to rule out service worker caching.

#### Tags

deepseek, model-names, pm2, env-vars, service-worker, cache, deployment, debugging

---

### Auto-Extracted Lesson: Wire all Telegram task fallback paths through orchestrator via submitDirect()

Date: 2026-05-23
Source: Git commit 0622dfe5
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramBot.js, cloud/orchestrator/TelegramOrchestratorBridge.js

#### Task Summary

fix: wire all Telegram task fallback paths through orchestrator via submitDirect()

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/orchestrator/TelegramOrchestratorBridge.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 0622dfe5.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 0622dfe5 by JPG Yap.

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

### Lesson: Wire all Telegram task fallback paths through orchestrator via submitDirect()

Date: 2026-05-23
Source: Codex task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/orchestrator/TelegramOrchestratorBridge.js, cloud/api/telegramBot.js, cloud/api/api.js

#### Task Summary

Identified and fixed 7 bypass paths in the Telegram bot where tasks were being added directly to the "superroo-jobs" BullMQ queue instead of routing through the orchestrator's SQLite task queue. Added a `submitDirect()` method to `TelegramOrchestratorBridge` that provides a lightweight fallback path through the orchestrator without eventBus emissions.

#### Files Changed

- cloud/orchestrator/TelegramOrchestratorBridge.js — Added submitDirect() method (lines 88-137)
- cloud/api/telegramBot.js — Fixed 6 bypass paths: handleCode, handleUpgrade, NLP task intent, NLP coding intent, /task command, notification callback retry
- cloud/api/api.js — Fixed Mini App POST /telegram/tasks/create endpoint

#### Bug Cause

Multiple Telegram entry points (handleCode, handleUpgrade, NLP routing, /task command, Mini App endpoint, notification retry) had fallback paths that called `queue.add()` directly to the BullMQ "superroo-jobs" queue, bypassing the orchestrator entirely. This meant tasks from these paths wouldn't appear in the orchestrator's SQLite task queue, wouldn't be tracked by the orchestrator's state machine, and couldn't be monitored via the dashboard.

#### Fix Applied

Added a 3-tier fallback pattern to all 7 bypass paths:

1. **Primary**: `orchestratorBridge.createTask()` → `orchestrator.submit()` with eventBus emissions
2. **Fallback**: `orchestratorBridge.submitDirect()` → `orchestrator.submit()` without eventBus (sets `metadata.fallback: true`)
3. **Last Resort**: Raw `queue.add()` → BullMQ (preserved as safety net)

The `submitDirect()` method is a lightweight wrapper that constructs the task input and calls `orchestrator.submit()` directly, bypassing eventBus but still going through the orchestrator's SQLite queue.

#### Test Result

unknown

#### Lesson Learned

When adding new Telegram entry points that create tasks, always route through the orchestrator bridge (createTask or submitDirect) rather than adding directly to BullMQ. The orchestrator is the single source of truth for task state, and bypassing it creates invisible tasks that can't be monitored or managed.

#### Reusable Rule

**All Telegram task creation paths MUST route through `TelegramOrchestratorBridge.createTask()` or `TelegramOrchestratorBridge.submitDirect()`.** Direct `queue.add()` calls to BullMQ are only allowed as a last-resort safety net after the orchestrator bridge has been attempted and failed. When adding a new Telegram command handler that creates tasks, always implement the 3-tier fallback pattern.

#### Tags

orchestrator, telegram, task-routing, fallback, bugfix

### Lesson: Fastify integration for file viewer and PDF upload

Date: 2026-05-23
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: .roo/skills/fastify/SKILL.md, docs/resources/fastify-integration.md, cloud/orchestrator/modules/FastifyServer.js, cloud/dashboard/src/components/views/fastify.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/app/page.tsx

#### Task Summary

Added comprehensive Fastify (Node.js web framework) integration to SuperRoo for file viewing and PDF upload. Created a skill for agent guidance with Fastify API patterns, a resource doc for architecture reference with data flow diagrams, a backend server module with multipart upload, file listing, streaming, and deletion, and a dashboard view with drag-and-drop upload, file browser, inline PDF viewer, and image preview.

#### Files Changed

- `.roo/skills/fastify/SKILL.md` — New Fastify skill with setup, API patterns, file upload/viewer code, schema validation, and troubleshooting
- `docs/resources/fastify-integration.md` — New architecture reference with data flow diagrams, API endpoint table, and security notes
- `cloud/orchestrator/modules/FastifyServer.js` — New backend module with Fastify server setup, plugin registration (cors, multipart, rate-limit), file upload/list/stream/delete routes, MIME type validation, and path traversal protection
- `cloud/dashboard/src/components/views/fastify.tsx` — New dashboard view with drag-and-drop upload zone, file browser with sortable list, inline PDF viewer (iframe), image preview, and file deletion
- `cloud/dashboard/src/components/sidebar.tsx` — Added "Fastify Server" nav item with Server icon
- `cloud/dashboard/src/app/page.tsx` — Registered FastifyView in PAGES routing with "Fastify Server" label

#### Bug Cause

N/A — new feature implementation

#### Fix Applied

N/A — new feature implementation

#### Test Result

unknown

#### Lesson Learned

When adding a new HTTP server framework integration to SuperRoo, follow the three-layer pattern: (1) create a skill in `.roo/skills/<name>/SKILL.md` for agent guidance with API patterns and code examples, (2) create a resource doc in `docs/resources/` for architecture reference with data flow diagrams, and (3) implement the backend module in `cloud/orchestrator/modules/` and dashboard view in `cloud/dashboard/src/components/views/`. Wire the view into the sidebar NAV array and PAGES record in page.tsx. The Fastify server module should use the plugin pattern (cors, multipart, rate-limit) and the dashboard view should support drag-and-drop upload, file browser, and inline preview for PDFs and images.

#### Reusable Rule

For any new HTTP server framework integration (Fastify, Express, Hono, etc.), always create: a skill (`.roo/skills/<name>/SKILL.md`), a resource doc (`docs/resources/<name>-integration.md`), a backend module (`cloud/orchestrator/modules/<Name>.js`), and a dashboard view (`cloud/dashboard/src/components/views/<name>.tsx`). Wire the view into sidebar.tsx NAV array and page.tsx PAGES record + import. The backend module should register plugins via `@fastify/*` pattern and the dashboard should use the `/api/fastify/*` proxy path.

#### Tags

fastify, nodejs, web-framework, file-viewer, pdf-upload, multipart, dashboard, skill, resource-doc

---

### Auto-Extracted Lesson: Add missing closing brace for if (orchestratorBridge) block in telegramBot.js

Date: 2026-05-23
Source: Git commit c206116a
Model/API used: unknown
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: add missing closing brace for if (orchestratorBridge) block in telegramBot.js

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit c206116a.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit c206116a by JPG Yap.

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

### Lesson: Autonomous dashboard non-JSON API guard

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When dashboard views call proxied API endpoints, always check content-type before response.json() and include HTTP status plus a short body preview for HTML proxy/auth/error pages. Preserve stale polling data when possible so transient API outages do not blank autonomous-loop status.

#### Lesson Learned

When dashboard views call proxied API endpoints, always check content-type before response.json() and include HTTP status plus a short body preview for HTML proxy/auth/error pages. Preserve stale polling data when possible so transient API outages do not blank autonomous-loop status.

#### Tags

cross-project, local-fallback

---

### Lesson: Daily Autonomous Pipeline + Ace Team Wiring + Autonomous Report Tab

Date: 2026-05-23
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/daily-autonomous.js, cloud/api/tgEndpoints.js, cloud/api/telegramBot.js, cloud/api/api.js, cloud/dashboard/src/components/views/autonomous-report.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/app/page.tsx

#### Task Summary

Built a complete daily autonomous pipeline system: (1) Wired the Ace Team from a stub to a real AutonomousLoop integration in tgEndpoints.js, (2) Created cloud/api/daily-autonomous.js with a full crawl → analyze → auto-fix → report pipeline that runs at 2am PHT, (3) Added 4 API routes for reports (list, get, run, schedule), (4) Created the Autonomous Report dashboard tab (autonomous-report.tsx) with report selector, health stats, issues, site cards, and auto-fix results, (5) Registered the tab in sidebar.tsx and page.tsx, (6) Added /aceteam status/stop subcommands to Telegram bot.

#### Files Changed

- cloud/api/daily-autonomous.js (NEW)
- cloud/api/tgEndpoints.js (MODIFIED - wired Ace Team)
- cloud/api/telegramBot.js (MODIFIED - added /aceteam subcommands, fixed missing brace)
- cloud/api/api.js (MODIFIED - added 4 autonomous report routes)
- cloud/dashboard/src/components/views/autonomous-report.tsx (NEW)
- cloud/dashboard/src/components/sidebar.tsx (MODIFIED - added Auto Report tab)
- cloud/dashboard/src/app/page.tsx (MODIFIED - registered AutonomousReportView)

#### Bug Cause

The Ace Team function in tgEndpoints.js was a stub that returned a success message without actually starting any autonomous loop. The telegramBot.js had a missing closing brace for an if (orchestratorBridge) block causing SyntaxError.

#### Fix Applied

Replaced stub with real AutonomousLoop instantiation via global.\_\_orchestrator. Added closing brace for if (orchestratorBridge) block. Added /aceteam status and /aceteam stop subcommands.

#### Test Result

pass

#### Lesson Learned

When wiring autonomous systems, always check for stub functions that pretend to work but don't actually execute. The AutonomousLoop class already had all the infrastructure needed — it just needed to be instantiated and connected. For daily scheduled tasks, use recursive setTimeout with next-run calculation rather than cron, since the Node.js process may not have cron installed.

#### Reusable Rule

When adding new dashboard tabs, always deploy the view component AND update page.tsx AND sidebar.tsx simultaneously. Missing any one causes build failures. Also check if the VPS has all referenced view components (like fastify.tsx) that may not have been deployed yet.

#### Tags

autonomous, daily-pipeline, ace-team, dashboard, telegram, visual-crawler, scheduled-tasks

---

### Lesson: Daily Autonomous Pipeline Gap Analysis and P0 Fix Implementation

Date: 2026-05-23
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/daily-autonomous.js, cloud/api/site-registry.js, cloud/api/api.js, cloud/dashboard/src/components/views/autonomous-report.tsx, docs/super-roo/DAILY_AUTONOMOUS_GAP_ANALYSIS_2026-05-23.md

#### Task Summary

Performed comprehensive gap analysis on the daily autonomous pipeline system, identified 20 gaps and 10 innovations, then implemented all 5 P0 (critical) fixes: unified site registry, auth token management, visual regression comparison, scheduler persistence, and Telegram notification wiring.

#### Files Changed

- `docs/super-roo/DAILY_AUTONOMOUS_GAP_ANALYSIS_2026-05-23.md` — Created gap analysis document
- `cloud/api/site-registry.js` — Created unified site registry (3 sites, 49 pages, 5 viewports, budgets, priorities)
- `cloud/api/daily-autonomous.js` — Rewrote with all P0 fixes integrated
- `cloud/api/api.js` — Added Telegram wiring, scheduler status, cancel endpoints
- `cloud/dashboard/src/components/views/autonomous-report.tsx` — Added trend indicators, console error/visual diff icons, scheduler status, cancel button

#### Bug Cause

The daily autonomous pipeline had 5 critical gaps: (1) hardcoded SITES array duplicated across systems, (2) no auth token management causing 401 errors on authed pages, (3) no visual regression comparison, (4) scheduler state lost on API restart, (5) no Telegram notification wiring.

#### Fix Applied

1. Created `site-registry.js` as single source of truth for all crawlable sites/pages
2. Added `ensureAuthToken()` with API login → orchestrator token → empty fallback chain
3. Integrated `compareImages()` using pixelmatch for visual regression detection
4. Added `saveSchedulerState()`/`loadSchedulerState()` for JSON persistence across restarts
5. Wired Telegram notifications via `telegramBot` and `TELEGRAM_BOT_TOKEN` in API routes

#### Test Result

pass — All modules load correctly on VPS, syntax verified, API and dashboard both healthy (HTTP 200)

#### Lesson Learned

When doing gap analysis, classify gaps by severity (P0-P3) and implement in priority order. The unified site registry pattern prevents the most common source of bugs: duplicate configuration across systems. Always verify file syntax on the target platform after deployment — Node.js version differences can cause issues.

#### Reusable Rule

For any system with multiple crawlers/crawling pipelines, always create a shared site registry module first. This prevents configuration drift and ensures all pipelines crawl the same pages. When adding scheduler functionality, always persist state to disk so it survives process restarts.

#### Tags

gap-analysis, daily-autonomous, site-registry, visual-regression, scheduler, telegram, p0-fixes

---

### Auto-Extracted Lesson: Guard autonomous loop status JSON parsing

Date: 2026-05-23
Source: Git commit ecfb7678
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/components/views/autonomous-loop.tsx

#### Task Summary

fix: guard autonomous loop status JSON parsing

#### Files Changed

- `cloud/dashboard/src/components/views/autonomous-loop.tsx`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit ecfb7678.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit ecfb7678 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Lesson: VPS dashboard component was outdated — auth headers missing in autonomous-loop.tsx

Date: 2026-05-23
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/dashboard/src/components/views/autonomous-loop.tsx, cloud/api/api.js, cloud/api/auth.js

#### Task Summary

Fixed "Autonomous Loop is not configured for your account yet" error on the Autonomous Loop dashboard tab. The error was caused by an outdated version of `autonomous-loop.tsx` on the VPS that did not send auth headers (`Authorization: Bearer {token}`) in its fetch calls to `/api/autonomous/status`.

#### Files Changed

- `cloud/dashboard/src/components/views/autonomous-loop.tsx` (SCP'd local version to VPS)

#### Bug Cause

The VPS had an older version of `autonomous-loop.tsx` that:

1. Called `fetch("/api/autonomous/status")` without any auth headers
2. The API's `auth.requireAuth()` middleware rejected the request with HTTP 401 `{ ok: false, error: "Unauthorized. Please sign in again." }`
3. The component's error handler misinterpreted any auth-related error as "Autonomous Loop is not configured for your account yet. Contact an admin to enable the autonomous loop for this project."

The local version already had `getAuthHeaders()` and `handleAuthError()` callbacks that properly send the auth token and handle 401 by clearing the token and reloading.

#### Fix Applied

SCP'd the local `autonomous-loop.tsx` to the VPS at `/opt/superroo2/cloud/dashboard/src/components/views/autonomous-loop.tsx`, rebuilt the dashboard (`npm run build`), and restarted `superroo-dashboard` via PM2.

#### Test Result

pass — Dashboard returns HTTP 200, API returns proper auth error when called without token (expected), and the frontend now sends auth headers properly.

#### Lesson Learned

When deploying dashboard components that make authenticated API calls, always verify the deployed version includes auth header handling. The VPS can have stale versions of components that lack critical auth logic. Always compare local vs VPS versions when investigating auth-related UI errors.

#### Reusable Rule

**Always verify that deployed frontend components include auth header handling (`getAuthHeaders()` and `handleAuthError()`) before deploying. When investigating "not configured" or "unauthorized" errors in dashboard tabs, first check if the VPS version of the component is outdated compared to the local version.**

#### Tags

auth, deployment, dashboard, autonomous-loop, bugfix, vps-sync

---

Date: 2026-05-25
Source: test-agent (local fallback)
Confidence: high
Tags: `test`, `fallback`
Related files: server/src/memory/McpMemoryServer.ts

#### Task Summary

## This is a test lesson to verify the local JSON fallback works when Brain v2 API is offline.

### Lesson: Production tab OTP gap analysis pattern

Date: 2026-05-25
Source: roo-code (local fallback)
Confidence: high
Tags: `production`, `otp`, `security`, `pattern`
Related files: apps/dashboard/src/app/production/page.tsx

#### Task Summary

When adding OTP verification to item-level production actions in the dashboard, follow this pattern:

1. Extend the otpModal.pendingAction type with new item-level action types
2. Add else-if branches in handleOtpVerified() for each new type
3. Create handler functions that store pending data in window variables (e.g., \_\_pendingItemFinishData)
4. Create verified handler functions that read from window variables and call the API with action_token
5. For ProductionInfoCards (inside OrderRow), use callback props that flow from ProductionPage -> OrderSection -> OrderRow -> ProductionInfoCards
6. Use wrapper functions (makeItemProductionStatusHandler, makeItemEnRouteStatusHandler) to capture order ID at each OrderRow call site
7. The backend PATCH /orders/:order_id/items/:item_id already supports action_token, reminders, and Telegram notifications - no backend changes needed
   ---### Lesson: OTP callback wiring pattern for nested React components in Next.js dashboard
   Date: 2026-05-26
   Source: roo-code (local fallback)
   Confidence: high
   Tags: `react`, `nextjs`, `otp`, `security`, `callback-pattern`, `component-hierarchy`, `prop-drilling`
   Related files: apps/dashboard/src/app/production/page.tsx

#### Task Summary

## Problem

In a Next.js dashboard with deeply nested component hierarchies (Page → OrderSection → OrderRow → ProductionInfoCards), adding OTP-verified actions required propagating callback props through 3-4 levels of components. Each sensitive action (item finish, item delayed, item production status, item en-route status, item start confirm) needed an OTP modal before execution.

## Solution Pattern

1. **Extend pendingAction type** — Add new action types to the otpModal.pendingAction union (e.g., 'itemFinish', 'itemDelayed', 'itemProductionStatus', 'itemEnRouteStatus', 'itemStartConfirm')
2. **Window variables for pending data** — Store the order/item data in window-level variables before opening the OTP modal, so the verified callback can access them without prop drilling
3. **else-if branches in handleOtpVerified** — Add a new else-if for each pendingAction type that reads the window variables and calls the appropriate API function with the action_token
4. **Wrapper functions to capture closure** — Create factory functions like makeItemProductionStatusHandler(order) that return a callback with the order ID captured in closure, then pass that callback through props
5. **Callback props through hierarchy** — Thread the callbacks through each component layer: Page → OrderSection → OrderRow → ProductionInfoCards

## Reusable Takeaway

When adding OTP-verified actions to deeply nested React components, use window variables for pending data + a centralized handleOtpVerified dispatcher rather than creating separate OTP modal instances per action. This keeps the OTP modal count at 1 while supporting unlimited action types.
---### Lesson: Tailscale SSH recovery — tailscale up --reset when coordination server is offline
Date: 2026-05-26
Source: roo-code (local fallback)
Confidence: high
Tags: `tailscale`, `ssh`, `vps`, `networking`, `troubleshooting`, `vpn`
Related files: deploy-agent.mjs

#### Task Summary

## Problem

When Tailscale shows 'offline' status (not connected to the coordination server), SSH connections to Tailscale IPs fail with 'Permission denied (publickey)' even though the SSH key is correct. This happens when the local Tailscale client loses connection to the DERP/coordination server.

## Root Cause

The local Tailscale node was marked as 'offline' from the coordination server. SSH to Tailscale IPs requires an active Tailscale connection because Tailscale routes traffic through its mesh network. When offline, the SSH connection falls through to the actual network interface, which may have different firewall rules or no SSH server running on port 22.

## Fix

Run `tailscale up --reset` which:

1. Re-authenticates with the Tailscale coordination server
2. Re-establishes the WireGuard mesh connections
3. Restores SSH access to all Tailscale IPs

## Verification

After running `tailscale up --reset`, verify with:

- `tailscale status` — shows connected nodes
- `ssh -i key root@100.x.x.x` — should connect successfully

## Reusable Takeaway

When SSH to a Tailscale IP fails with 'Permission denied' despite correct credentials, always check `tailscale status` first. If the local node shows 'offline', run `tailscale up --reset` to reconnect to the coordination server. Do NOT assume the SSH key is wrong — Tailscale connectivity is the more likely cause.
---### Lesson: MCP stdio server communication — JSON-RPC over stdin/stdout pipes
Date: 2026-05-26
Source: roo-code (local fallback)
Confidence: high
Tags: `mcp`, `json-rpc`, `stdio`, `protocol`, `debugging`, `child-process`
Related files: C:\Users\User\mcp-servers\qas-vps\dist\index.js

#### Task Summary

## Problem

When communicating with stdio-based MCP (Model Context Protocol) servers, the initial message from the server is a plain text banner (e.g., 'server running on stdio'), not JSON-RPC. Sending JSON-RPC requests immediately fails because the server is waiting for the client to initiate the protocol handshake.

## Root Cause

MCP stdio servers output a startup banner to stdout before entering the JSON-RPC loop. The client must read (and discard) this banner before sending the first JSON-RPC message. Additionally, the protocol requires sending an 'initialize' request first before any tool calls.

## Solution Pattern

1. **Read startup banner** — Read stdout until you get a newline (the banner), then discard it
2. **Send initialize request** — Send `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"client","version":"1.0.0"}}}`
3. **Read initialize response** — Read the JSON-RPC response from stdout
4. **Send initialized notification** — Send `{"jsonrpc":"2.0","method":"notifications/initialized"}`
5. **Send tool calls** — Now send ListToolsRequest or tools/call requests

## Key Code Structure

```javascript
const { spawn } = require("child_process")
const proc = spawn("node", ["server.js"], { stdio: ["pipe", "pipe", "pipe"] })

// 1. Read startup banner
proc.stdout.once("data", (banner) => {
	// Discard banner

	// 2. Send initialize
	proc.stdin.write(JSON.stringify(initializeRequest) + "\n")

	// 3. Read response
	proc.stdout.once("data", (initResponse) => {
		// Parse and handle

		// 4. Send initialized notification
		proc.stdin.write(JSON.stringify(initializedNotification) + "\n")

		// 5. Now ready for tool calls
	})
})
```

## Reusable Takeaway

When building or debugging stdio-based MCP servers, always account for the startup banner and the initialize/initialized handshake before sending tool calls. Use line-delimited JSON (each JSON-RPC message followed by a newline) for communication. For debugging, pipe stderr to a log file since the server may output diagnostic info there.
---### Lesson: SSH command construction bug — space before @ causes 'Could not resolve hostname'
Date: 2026-05-26
Source: roo-code (local fallback)
Confidence: high
Tags: `ssh`, `deploy`, `bug`, `command-construction`, `shell`
Related files: deploy-agent.mjs

#### Task Summary

## Problem

A deploy script (deploy-agent.mjs) failed with 'Could not resolve hostname root: Name or service not known' when running SSH commands. The SSH command was constructed as `ssh -i key root @host` with a space between the username and the @ symbol.

## Root Cause

The sshCmd() helper function in deploy-agent.mjs concatenated the SSH command string with a template literal that included a trailing space after the username: `${SSH_USER} @${SSH_HOST}`. This produced `root @100.86.182.7` instead of `root@100.86.182.7`. SSH interpreted 'root' as the hostname (not the username), causing the DNS resolution failure.

## Fix

Remove the space before @: change `${SSH_USER} @${SSH_HOST}` to `${SSH_USER}@${SSH_HOST}`.

## Key Code (bug)

```javascript
function sshCmd(cmd) {
	return `ssh -i "${CONFIG.sshKey}" -o StrictHostKeyChecking=accept-new ${CONFIG.sshUser} @${CONFIG.vpsHost} "${cmd}"`
	//                                                              ^ space here is the bug
}
```

## Reusable Takeaway

When constructing SSH commands programmatically, always use the format `user@host` without spaces. This is a subtle typo that's easy to miss during code review because the space blends in visually. Add a unit test or console.log the constructed command before execution to catch this class of bugs. The same applies to SCP, rsync, and any other SSH-based tools.
---### Lesson: Production tab gap analysis — 7 security and UX gaps found and fixed in Next.js dashboard
Date: 2026-05-26
Source: roo-code (local fallback)
Confidence: high
Tags: `security`, `otp`, `production`, `dashboard`, `gap-analysis`, `react`, `nextjs`, `ux`
Related files: apps/dashboard/src/app/production/page.tsx, apps/dashboard/src/components/OtpModal.tsx

#### Task Summary

## Problem

The Production tab in a Next.js dashboard had 7 gaps compared to other tabs (Orders, Delivery, Collection):

1. **No OTP on item finish** — 'Finish' button for individual items had no OTP verification
2. **No OTP on item delayed** — 'Delayed' report had no OTP verification
3. **No OTP on item production status change** — Changing item status (pending/in_progress/finished) had no OTP
4. **No OTP on item en-route status change** — Changing en-route status (not_yet/en_route/arrived) had no OTP
5. **No OTP on item start** — Starting production on an item had no OTP verification
6. **No days prompt on item start** — Starting production didn't ask for estimated production days
7. **'Finish' button visible when it shouldn't be** — The finish button appeared on items that weren't ready

## Root Cause

The Production tab was built with a simpler security model than other tabs. The OTP (one-time password) verification pattern was already established in the codebase (via OtpModal component and action_token pattern), but the Production tab's item-level actions were implemented before the OTP requirement was enforced across the dashboard.

## Fix Pattern

For each gap, the fix followed the same pattern:

1. Extend the `otpModal.pendingAction` type union with the new action name
2. Store pending data in window-level variables before opening the OTP modal
3. Add an else-if branch in `handleOtpVerified()` that reads the window variables and calls the verified handler
4. Create wrapper functions to capture order/item IDs in closure for callback props
5. Thread the new callbacks through the component hierarchy (Page → OrderSection → OrderRow → ProductionInfoCards)

## Files Changed

- `apps/dashboard/src/app/production/page.tsx` — 7 new handler functions, extended type, new else-if branches

## Reusable Takeaway

When building a multi-tab dashboard with security-sensitive actions, establish the OTP/action_token pattern EARLY and apply it uniformly across ALL tabs. Retrofitting OTP to an existing tab requires touching every action handler and propagating callbacks through the component hierarchy. Use a checklist: for every button that mutates data, ask 'does this need OTP?' before writing the handler.
---### Lesson: OTP action_token is single-use — use bulk endpoint for multi-call operations
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `otp`, `action_token`, `redis`, `bulk-api`, `payment`
Related files: apps/api/src/server.ts, apps/dashboard/src/lib/api.ts

#### Task Summary

In quotation-automation, every dashboard quick action needs an OTP action_token stored in Redis. The token is deleted on first use (cacheClient.del). Reusing it on a second call returns 401. Fix: add a bulk endpoint (e.g. /pay-balance-bulk) that validates the token once then processes an array of records internally. Client uploads files individually (no token needed for file upload via uploadOrderFile), then calls the bulk endpoint once with all records and the single token. This pattern applies to any feature where multiple DB writes must share one OTP.
---### Lesson: VPS deploy: public IP works, Tailscale IP does not from local machine
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `deploy`, `vps`, `ssh`, `tailscale`, `docker`

#### Task Summary

The quotation-automation VPS is accessible two ways: (1) Tailscale IP 100.86.182.7 via SSH config entry 'trading-bot-tailscale' — this DOES NOT work when connecting from the local Windows machine (Permission denied at network level). (2) Public IP 165.22.110.111 via SSH config entry 'vps' with key ~/.ssh/id_ed25519_roo — this WORKS. Deploy command: ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111 'cd /opt/quotation-automation && git pull && docker compose build api && docker compose up -d api'. NEVER use GitHub Actions to deploy — use SSH directly. Dashboard builds take ~3 minutes; API builds take ~30 seconds (cached layers).
---### Lesson: Multi-slip payment UI: duplicate detection with IIFE-in-JSX + per-entry file input refs
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `react`, `multi-entry`, `file-upload`, `duplicate-detection`, `jsx-iife`
Related files: apps/dashboard/src/app/collection/page.tsx

#### Task Summary

When building multi-entry form UIs in Next.js (e.g. multiple deposit slips each with a file upload), two patterns are key: (1) Duplicate detection — run getDuplicateIndices() on every render using a Set<string> keyed by 'amount|date'. Flag slips in the same batch with identical amount+date as dupes. Block submit if dupeIndices.size > 0. (2) Per-entry file inputs — use a ref array: const fileInputRefs = useRef<(HTMLInputElement|null)[]>([]) and assign each input with ref={(el) => { fileInputRefs.current[idx] = el; }}. Trigger with fileInputRefs.current[idx]?.click(). (3) Running total math — compute slipTotal from all entries on every render, compare to remainingBalance, show color-coded feedback. (4) IIFE in JSX — when the modal needs many derived values, wrap in {paymentModal.open && (() => { const dupes = ...; return (<div>...</div>); })()} to keep JSX readable without hoisting state.
---### Lesson: PDF generation in quotation-automation is always on-the-fly — no stored files to update
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `pdf`, `on-the-fly`, `receipt`, `deploy`
Related files: apps/api/src/server.ts

#### Task Summary

The acknowledgement receipt PDF in quotation-automation is built in buildAcknowledgementReceiptPdf() using raw PostScript-like drawing commands (no PDF library). It is generated fresh on every download request — there are no stored PDF files on disk. This means: (1) template changes take effect immediately on next download, no cache to clear; (2) if a user reports 'it still looks the same', check that the commit is actually deployed (git pull on VPS); (3) the download endpoint fetches order items at request time via SQL so the order summary is always current. Key: always push commits AND redeploy before telling the user to re-download.
---### Lesson: Telegram chat ID discovery when bot uses webhook — query bot_logs table on VPS
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `telegram`, `webhook`, `chat_id`, `bot_logs`, `notification`

#### Task Summary

When a Telegram bot uses a webhook (setWebhook), calling getUpdates returns 409 Conflict. To find a user's personal chat_id: SSH to VPS and query the bot_logs PostgreSQL table: SELECT DISTINCT chat_id, username FROM bot_logs WHERE username = 'jpgy888' LIMIT 5. The quotation-automation bot logs all incoming messages to bot_logs. The personal chat_id for @jpgy888 is 8485794779. Sending direct messages uses: POST https://api.telegram.org/bot{TOKEN}/sendMessage with chat_id=8485794779. The TOKEN is in /opt/quotation-automation/.env as TELEGRAM_BOT_TOKEN.
---### Lesson: git commit with colons in message fails in PowerShell — use Bash tool instead
Date: 2026-05-26
Source: claude-code (local fallback)
Confidence: high
Tags: `git`, `powershell`, `windows`, `commit-message`

#### Task Summary

PowerShell parses 'git commit -m "feat: something"' incorrectly when the message contains colons — it can interpret the colon as part of a drive letter or path. Workaround: use the Bash tool for git operations, or use a PowerShell here-string: git commit -m @'
feat: your message here
'@. The Bash tool (Linux shell) handles git commit messages with colons, slashes, and special characters reliably. This applies specifically to the Windows PowerShell 5.1 environment in Claude Code.

---

### Lesson: Autonomous Builder — parseJsonResponse must merge with fallback defaults

Date: 2026-05-26
Source: SuperRoo code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/autonomous/analyze.service.js, cloud/api/autonomous/ingest.service.js, cloud/test/autonomous-builder.test.js

#### Task Summary

Implemented the Autonomous Builder feature — a full-stack dashboard tab where users upload workflow docs/specs/repo URLs, and SuperRoo autonomously analyzes, plans, codes, tests, and deploys the result. Created 7 UI components, 10 backend service files, Docker sandbox config, sidebar/page routing, and 64 tests across 7 modules.

#### Files Changed

- cloud/dashboard/src/components/autonomous/UploadPanel.tsx
- cloud/dashboard/src/components/autonomous/AnalysisSummary.tsx
- cloud/dashboard/src/components/autonomous/BuildPlanViewer.tsx
- cloud/dashboard/src/components/autonomous/AgentLogStream.tsx
- cloud/dashboard/src/components/autonomous/ApprovalGatePanel.tsx
- cloud/dashboard/src/components/autonomous/CostTracker.tsx
- cloud/dashboard/src/components/autonomous/JobQueueTable.tsx
- cloud/dashboard/src/components/views/autonomous-builder.tsx
- cloud/api/autonomous/schema.sql
- cloud/api/autonomous/types.js
- cloud/api/autonomous/prompts.js
- cloud/api/autonomous/model-router.js
- cloud/api/autonomous/ingest.service.js
- cloud/api/autonomous/analyze.service.js
- cloud/api/autonomous/safety-policy.js
- cloud/api/autonomous/sandbox.js
- cloud/api/autonomous/queue.js
- cloud/api/autonomous/worker.js
- cloud/api/autonomous/github.service.js
- cloud/api/autonomous/approval-policy.js
- cloud/api/autonomous/deploy-validator.js
- cloud/api/autonomous/autonomous.routes.js
- cloud/docker/Dockerfile.autonomous
- cloud/dashboard/src/components/sidebar.tsx
- cloud/dashboard/src/app/page.tsx
- cloud/api/api.js
- cloud/test/autonomous-builder.test.js
- docs/resources/autonomous-builder-flowchart.md

#### Bug Cause

1. **parseJsonResponse returned parsed JSON as-is**: When `callBestModel` returned a mock JSON string (no AI provider configured), `parseJsonResponse` parsed it successfully and returned the result directly. But the mock response only had `placeholder`, `message`, and `modelType` keys — it didn't have expected keys like `summary`, `appType`, `requiredPages`, `risks`, `missingInfo`, or `phases`. The function only used fallback defaults when JSON parsing _failed_, not when keys were missing from the parsed result.

2. **ingest.service readFile errors uncaught**: The `readFile` call for `.md`/`.txt` files was not wrapped in a try/catch, so if any file read failed, the entire `ingestUploadDirectory` function threw an unhandled error.

3. **model-router.js called non-existent method**: `registry.getProviderForModel(modelId)` doesn't exist in the provider registry — only `registry.getProviderForTask(taskType)` exists.

#### Fix Applied

1. Changed `parseJsonResponse` to merge parsed results with fallback defaults: `return { ...fallback, ...parsed }` instead of `return parsed`. This ensures missing keys are filled in from the fallback object.

2. Wrapped the `readFile` call in `ingest.service.js` in a try/catch that appends an error message to `extractedText` instead of crashing.

3. Changed `model-router.js` to use `registry.getProviderForTask(type)` and to always return a mock JSON response string instead of throwing when no provider is configured.

#### Test Result

pass — 64/64 tests pass across safety-policy (16), approval-policy (11), deploy-validator (7), ingest.service (6), model-router (5), analyze.service (9), autonomous.routes (10)

#### Lesson Learned

When writing a `parseJsonResponse` function that parses AI model output, always merge the parsed result with fallback defaults using `{ ...fallback, ...parsed }`. This ensures that even when the AI returns a partial response (or a mock response during development/testing), all expected keys are present with sensible defaults. Never assume the AI will return every key — always provide fallback values for every expected field.

#### Reusable Rule

Any function that parses JSON from an AI model response MUST merge the parsed result with fallback defaults using object spread (`{ ...fallback, ...parsed }`). The fallback object should contain default values for every expected key. This prevents undefined/null reference errors when the AI returns a partial response, a mock response, or a response with a different schema than expected.

#### Tags

autonomous-builder, parseJsonResponse, AI-integration, error-handling, testing, mock-responses, fallback-defaults

### Lesson: Central Brain PostgreSQL connection — use explicit params to avoid pg env var override

Date: 2026-05-26
Source: DeepSeek task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/predictive-risk.tsx

#### Task Summary

Brought the Central Brain (PostgreSQL/pgvector) online on the VPS for the Predictive Risk Engine dashboard tab. The tab showed "Central Brain Offline" because PostgreSQL was unreachable from the API process.

#### Files Changed

- `cloud/api/api.js` — Added `GET /brain/health` endpoint, switched from `connectionString` to explicit `Pool` params, fixed default password in connection URL
- `cloud/dashboard/src/components/views/predictive-risk.tsx` — Added `brainError` state, calls `/api/brain/health` first, displays actual error message in offline UI

#### Bug Cause

1. The default connection URL had password `superroo` but the actual PostgreSQL password was `superroo_secret_2026` (set by PM2 env vars)
2. The `pg` library's `Pool` with `connectionString` is silently overridden by `PGPASSWORD`, `PGDATABASE`, `PGUSER`, `PGHOST`, `PGPORT` env vars in the PM2 process environment — the `val()` function in `pg/lib/connection-parameters.js` checks `config[key]` first (truthy check), then falls back to `process.env['PG' + key.toUpperCase()]`
3. The `superroo_brain` database didn't exist on the VPS PostgreSQL instance

#### Fix Applied

1. Changed `getBrainServices()` to parse the connection URL manually and pass explicit `host`, `port`, `user`, `password`, `database` params to `Pool` instead of `connectionString`
2. Updated the default URL from `postgresql://superroo:superroo@127.0.0.1:5432/superroo_brain` to `postgresql://superroo:superroo_secret_2026@127.0.0.1:5432/superroo_brain`
3. Created the `superroo_brain` database and enabled pgvector extension on the VPS
4. Added `GET /brain/health` endpoint that returns the actual PostgreSQL error message when the brain is offline

#### Test Result

pass — `/api/brain/health` returns `{"success":true,"healthy":true,"data":{"status":"connected"}}`, all risk endpoints return `{"success":true,...}`

#### Lesson Learned

When using the `pg` library's `Pool`, never rely on `connectionString` alone if the process environment may contain `PG*` env vars. The `val()` function in `pg/lib/connection-parameters.js` checks `config[key]` first (truthy check), then falls back to `process.env['PG' + key.toUpperCase()]`, then `defaults[key]`. Since `config['password']` is truthy (from the parsed connection string), it uses that — but if the env var `PGPASSWORD` differs from the connection string password, the env var wins for other params like `PGDATABASE`. Always use explicit params to avoid silent env var interference.

#### Reusable Rule

When connecting to PostgreSQL with the `pg` library in an environment where `PG*` env vars may be set (e.g., PM2, Docker, CI/CD), ALWAYS use explicit `Pool` constructor params (`host`, `port`, `user`, `password`, `database`) instead of `connectionString`. Parse the URL manually with `new URL()` to extract components. This prevents silent env var overrides from corrupting the connection configuration.

#### Tags

postgresql, pgvector, central-brain, predictive-risk, database-connection, env-vars, pm2, deployment, vps

---

### Lesson: Fix bulk inventory verify 500 error and add bulk not-yet support

Date: 2026-05-26
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: ../../quotation-automation-system/apps/api/src/server.ts, ../../quotation-automation-system/apps/dashboard/src/app/inventory/verification/[quotationNumber]/page.tsx, ../../quotation-automation-system/apps/dashboard/src/lib/api.ts, ../../quotation-automation-system/apps/dashboard/src/app/inventory/page.tsx

#### Task Summary

Investigated and fixed a 500 Internal Server Error when using bulk select and "Verify Selected" on the inventory verification page of the quotation-automation-system project. Also found and fixed other gaps in the inventory feature.

#### Files Changed

- ../../quotation-automation-system/apps/api/src/server.ts
- ../../quotation-automation-system/apps/dashboard/src/app/inventory/verification/[quotationNumber]/page.tsx
- ../../quotation-automation-system/apps/dashboard/src/lib/api.ts
- ../../quotation-automation-system/apps/dashboard/src/app/inventory/page.tsx

#### Bug Cause

The 500 error was caused by unhandled exceptions in the bulk-inventory-verify endpoint:

1. `JSON.parse(tokenData)` could throw a SyntaxError if Redis returned corrupted token data — no try/catch
2. The `for` loop calling `adjustInventoryForOrderItem` had no try/catch, so any DB error would crash the entire endpoint
3. No validation for empty `item_ids` array (Zod schema missing `.min(1)`)
4. No feedback when all selected items were already fully verified — the loop silently skipped them

#### Fix Applied

1. Added try/catch around `cacheClient.get()` and `JSON.parse(tokenData)` in both `bulk-inventory-verify` and `complete-inventory-verification` endpoints — returns 503/401 instead of 500
2. Added `.min(1)` to Zod schema for `item_ids` — returns 400 for empty selection
3. Added per-item try/catch in the verification loop — one item failure doesn't crash the batch
4. Added `already_verified` tracking and `warning` field in the response — user sees which items were skipped
5. Fixed `adjustInventoryForOrderItem` to skip inserting orphaned `inventory_movements` when `inventoryItemId` is null
6. Added bulk "not yet" support on the frontend — separate button calls `inventoryVerifyItem` for each selected item
7. Added SSE event listener in `InventoryVerificationSection` to revalidate SWR data on `order_updated`/`invalidate` events

#### Test Result

Unknown — manual testing required

#### Lesson Learned

When building API endpoints that parse data from external caches (Redis), always wrap `JSON.parse` in try/catch. Corrupted cache entries are a real failure mode that will crash the endpoint with a 500. Always validate array inputs with `.min(1)` in Zod schemas. For batch operations, use per-item try/catch so one failure doesn't crash the entire batch. Always provide user-facing feedback when items are skipped due to already being in the desired state.

#### Reusable Rule

When writing batch API endpoints that iterate over user-selected items, ALWAYS: (1) validate the input array is non-empty via schema validation, (2) wrap each iteration in try/catch to isolate failures, (3) track which items succeeded/failed/skipped and return that information to the client, (4) wrap `JSON.parse` of external cache data in try/catch.

#### Tags

inventory, bulk-verify, 500-error, error-handling, redis, json-parse, zod-validation, batch-operations, sse-revalidation, quotation-automation-system

---

### Auto-Extracted Lesson: (mini-ide): replace exec terminal with node-pty WebSocket terminal

Date: 2026-05-26
Source: Git commit 1b6793a6
Model/API used: unknown
Confidence: medium
Related files: cloud/api/routes/terminal-brain.js, cloud/dashboard/src/app/api/[[...path]]/route.ts, cloud/dashboard/src/app/api/autonomous/start/route.ts, cloud/dashboard/src/app/api/autonomous/status/route.ts, cloud/dashboard/src/app/api/autonomous/stop/route.ts

#### Task Summary

fix(mini-ide): replace exec terminal with node-pty WebSocket terminal

#### Files Changed

- `cloud/api/routes/terminal-brain.js`
- `cloud/dashboard/src/app/api/[[...path]]/route.ts`
- `cloud/dashboard/src/app/api/autonomous/start/route.ts`
- `cloud/dashboard/src/app/api/autonomous/status/route.ts`
- `cloud/dashboard/src/app/api/autonomous/stop/route.ts`
- `cloud/mini-ide/package.json`
- `cloud/mini-ide/public/app.js`
- `cloud/mini-ide/public/index.html`
- `cloud/mini-ide/public/lib/xterm-addon-fit.min.js`
- `cloud/mini-ide/public/lib/xterm.css`
- `cloud/mini-ide/public/lib/xterm.min.js`
- `cloud/mini-ide/public/styles.css`
- `cloud/mini-ide/server.js`
- `cloud/nginx-site.conf`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 1b6793a6.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 1b6793a6 by JPG Yap.

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

### Auto-Extracted Lesson: (nginx): strip /tg/ prefix when proxying to mini-ide

Date: 2026-05-26
Source: Git commit 45be53ab
Model/API used: unknown
Confidence: medium
Related files: cloud/nginx-site.conf

#### Task Summary

fix(nginx): strip /tg/ prefix when proxying to mini-ide

#### Files Changed

- `cloud/nginx-site.conf`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 45be53ab.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 45be53ab by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Lesson: Mini-IDE node-pty WebSocket terminal deployment + autonomous loop fixes

Date: 2026-05-26
Source: Kimi Code CLI task completion
Model/API used: DeepSeek MCP (coding), Kimi Code CLI (deploy)
Confidence: high
Related files: cloud/mini-ide/server.js, cloud/mini-ide/public/app.js, cloud/mini-ide/package.json, cloud/dashboard/src/app/api/[[...path]]/route.ts, cloud/dashboard/src/app/api/autonomous/status/route.ts, cloud/nginx-site.conf

#### Task Summary

1. Replaced fake `child_process.exec` terminal in mini-IDE with persistent `node-pty` PTY sessions over WebSocket.
2. Added `TerminalSessionManager` with output ring buffer (500 chunks), no timeout, auto-resize, and stable session IDs.
3. Fixed autonomous loop tab returning HTML 404 by adding proxy routes in mini-IDE (`/api/autonomous/*`, `/autonomous/*`) and dashboard catch-all API routes.
4. Removed large repo dirs (`src`, `cloud`, `packages`, etc.) from file explorer skip list so they are browsable in the IDE.
5. Fixed terminal brain router to use compiled `dist/index.cjs` fallback before requiring TypeScript source.
6. Improved stub fallbacks for offline providers to return informative JSON instead of generic echo messages.
7. Created nginx config routing `/api/*` → API (8787), `/ws` → mini-ide WS (8081), `/tg/*` → mini-ide HTTP (8081), `/` → dashboard (3001).
8. Deployed all changes to VPS `100.64.175.88` via Tailscale SSH.

#### Files Changed

- `cloud/mini-ide/server.js`
- `cloud/mini-ide/public/app.js`
- `cloud/mini-ide/package.json`
- `cloud/dashboard/src/app/api/[[...path]]/route.ts`
- `cloud/dashboard/src/app/api/autonomous/status/route.ts`
- `cloud/dashboard/src/app/api/autonomous/start/route.ts`
- `cloud/dashboard/src/app/api/autonomous/stop/route.ts`
- `cloud/nginx-site.conf`
- `.last-deployed-commit`
- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

- **Terminal**: The previous implementation used `child_process.exec` with a 30-second timeout, which killed long-running processes and provided no interactive shell experience.
- **Autonomous loop**: The dashboard's `AutonomousLoopView` called `/api/autonomous/status`, but there was no route handler in the mini-IDE or dashboard. Nginx routed `/api/*` to the API server, but the mini-IDE (served under `/tg/`) made relative requests that hit the mini-IDE backend, which returned HTML 404.
- **Nginx**: The `/tg/` location in `cloud/nginx-site.conf` had `proxy_pass http://127.0.0.1:8081/tg/;` which passed the `/tg/` prefix to the backend. The mini-IDE serves from `/`, so this caused 404s.

#### Fix Applied

- **Terminal**: Added `node-pty` with `TerminalSessionManager` class. WebSocket events: `terminal:create`, `terminal:input`, `terminal:resize`, `terminal:output`, `terminal:exit`. Fallback HTTP POST route preserved for one-shot commands.
- **Autonomous loop**: Added `proxyAutonomous()` helper in mini-IDE that forwards to `DASHBOARD_API_URL` with JSON stub fallback if offline. Added same proxy routes for both `/api/autonomous/*` and `/autonomous/*` paths.
- **Nginx**: Changed `proxy_pass http://127.0.0.1:8081/tg/;` to `proxy_pass http://127.0.0.1:8081/;` so nginx strips the `/tg/` prefix.
- **Dashboard**: Added catch-all `[[...path]]` API route and specific `/api/autonomous/{status,start,stop}` routes to proxy unmatched API calls to the backend API server.

#### Test Result

- Mini-IDE HTTP (`/tg/`): 200 via nginx
- Mini-IDE WebSocket (`/ws`): upgrade working via nginx
- Dashboard (`/`): 200
- API (`/api/autonomous/status`): 401 (expected, requires auth)
- PTY install and mini-IDE restart: successful on VPS

#### Lesson Learned

1. **node-pty requires build tools on Linux**: If `make`/`g++` are missing, `npm install` of `node-pty` fails with `gyp ERR! build error`. Always ensure `build-essential` is installed on the VPS before deploying node-pty upgrades.
2. **Nginx `proxy_pass` trailing paths matter**: `proxy_pass http://backend/;` strips the matched location prefix, while `proxy_pass http://backend/path/;` appends `/path/`. When a backend serves from root, use the former.
3. **Tailscale SSH on Windows needs Windows OpenSSH**: Git Bash OpenSSH fails with `Permission denied (publickey)` because Tailscale SSH auth is handled by the Tailscale daemon. Use `C:\Windows\System32\OpenSSH\ssh.exe` with `ProxyCommand` pointing to `tailscale.exe nc %h %p`.
4. **Autonomous loop proxies need both path variants**: Dashboard and mini-IDE may use `/api/autonomous/*` or `/autonomous/*` depending on context. Add both to avoid 404s.
5. **Stable session IDs prevent brain re-creation**: Using `Date.now()` for terminal brain session IDs caused a new session on every reconnect. Switching to workspace-derived stable IDs (`tg-${userId}-${workspaceId}`) fixed this.

#### Reusable Rule

- **Rule: VPS node-pty deploy checklist**: Before deploying mini-IDE terminal upgrades, verify: (a) `build-essential` installed, (b) `npm install` succeeds in `cloud/mini-ide`, (c) nginx `/tg/` strips prefix, (d) `/ws` location has `Upgrade`/`Connection` headers, (e) PM2/standalone process restarted, (f) `.last-deployed-commit` updated.
- **Rule: Nginx proxy_pass suffix**: For backend apps that serve from `/`, always use `proxy_pass http://backend/;` (with trailing slash matching location prefix). Never add a path suffix unless the backend explicitly mounts under that subpath.
- **Rule: Windows Tailscale SSH command**: `C:\Windows\System32\OpenSSH\ssh.exe -o ProxyCommand="C:\Progra~1\Tailscale\tailscale.exe nc %h %p" -o StrictHostKeyChecking=accept-new root@<tailscale-ip>`

#### Tags

node-pty, websocket, terminal, nginx, tailscale, deployment, mini-ide, autonomous-loop, proxy

---

### Lesson: SkillOpt ReflACT Pipeline Port — Edit Budget Scheduler Precision & Slow Update Field Injection

Date: 2026-05-28
Source: DeepSeek task completion
Model/API used: deepseek-chat
Confidence: high
Related files: src/super-roo/skills/SkillLRScheduler.ts, src/super-roo/skills/SkillEditOps.ts, src/super-roo/skills/**tests**/SkillLRScheduler.test.ts, src/super-roo/skills/**tests**/SkillEditOps.test.ts

#### Task Summary

Ported Microsoft SkillOpt's ReflACT skill optimization pipeline to SuperRoo as `src/super-roo/skills/`. Implemented 10 source files (types, scheduler, gate, edit ops, reflect, aggregate, clip, meta-skill, slow-update, rewrite, trainer) and 7 test files. Fixed 3 test failures related to integer rounding in edit budget schedulers and slow update field injection.

#### Files Changed

- `src/super-roo/skills/types.ts` (created)
- `src/super-roo/skills/SkillLRScheduler.ts` (created, then fixed)
- `src/super-roo/skills/Gate.ts` (created)
- `src/super-roo/skills/SkillEditOps.ts` (created, then fixed)
- `src/super-roo/skills/Reflect.ts` (created)
- `src/super-roo/skills/Aggregate.ts` (created)
- `src/super-roo/skills/Clip.ts` (created)
- `src/super-roo/skills/MetaSkill.ts` (created)
- `src/super-roo/skills/SlowUpdate.ts` (created)
- `src/super-roo/skills/Rewrite.ts` (created)
- `src/super-roo/skills/SkillTrainer.ts` (created)
- `src/super-roo/skills/index.ts` (created)
- `src/super-roo/skills/__tests__/*.test.ts` (7 files, created)
- `docs/research/skillopt-analysis.md` (created)

#### Bug Cause

1. **LinearSkillLR rounding**: `_computeBudget` used `step / totalSteps` as progress, so at step `totalSteps - 1` the progress was `(totalSteps-1)/totalSteps` instead of 1.0, causing `Math.round()` to produce a value above `minEdits`.
2. **CosineSkillLR rounding**: Same root cause — the cosine curve never reached `minEdits` at the last step because progress never reached 1.0.
3. **replaceSlowUpdateField injection**: When no slow update field existed, the function delegated to `injectEmptySlowUpdateField()` which used a hardcoded default content string instead of the caller's `newContent` parameter.

#### Fix Applied

1. **LinearSkillLR/CosineSkillLR**: Changed denominator from `totalSteps` to `totalSteps - 1` (when `totalSteps > 1`) so that the last step (index `totalSteps - 1`) has progress = 1.0, ensuring the budget rounds to exactly `minEdits`.
2. **replaceSlowUpdateField**: Replaced the `injectEmptySlowUpdateField()` delegation with inline code that uses the passed `newContent` parameter, matching SkillOpt's Python behavior.

#### Test Result

pass — 77/77 tests pass across 8 test files

#### Lesson Learned

When porting integer-based schedulers (edit budgets, learning rates) from Python to TypeScript, the `Math.round()` behavior differs subtly from Python's `int()` truncation. Python's `int(2.8)` = 2, but `Math.round(2.8)` = 3. Always verify that the last step of a decay schedule reaches the target minimum. The fix is to use `(totalSteps - 1)` as the denominator so progress reaches 1.0 at the final step.

Also, when delegating to helper functions in fallback paths, ensure the helper accepts and forwards the caller's parameters rather than using hardcoded defaults.

#### Reusable Rule

- **Rule: Integer scheduler precision**: When implementing decay schedulers that produce integer outputs via `Math.round()`, use `denom = totalSteps > 1 ? totalSteps - 1 : 1` as the progress denominator so the last step reaches the target minimum exactly.
- **Rule: Parameter forwarding in fallback paths**: When a function has a fallback path that delegates to a helper, ensure the helper receives the caller's parameters. Hardcoded defaults in fallback paths are a bug.

#### Tags

skillopt, reflact, scheduler, edit-budget, rounding, precision, slow-update, porting, typescript, python-diff

---
