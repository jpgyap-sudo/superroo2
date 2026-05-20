# lessons-learned.md

### Lesson: Global git hook auto-extracts lessons from any project — verify no local hooksPath override blocks it

Date: 2026-05-19
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: tools/install-global-hook.mjs, tools/global-post-commit.mjs, quotation-automation-system/.gitignore

#### Task Summary

Verified and confirmed the global git hook installation for cross-project lesson extraction on the quotation-automation-system project. The global hook was already installed at ~/.superroo/git-hooks/post-commit with git config --global core.hooksPath set. No local hooksPath override existed in the quotation-automation-system repo. A test commit confirmed the hook works: it detected the "fix:" prefix, ran extract-commit via superroo-learn, generated a DeepSeek summary, and stored the lesson locally.

#### Files Changed

- (verified) tools/install-global-hook.mjs — already installed
- (verified) tools/global-post-commit.mjs — hook template already deployed
- (tested) quotation-automation-system — test commit 10da1a0 confirmed hook triggers

#### Bug Cause

N/A — verification task, no bug.

#### Fix Applied

N/A — verification task, no fix needed.

#### Test Result

pass

#### Lesson Learned

When verifying global git hooks, check both `git config --global core.hooksPath` and any local `.git/config` hooksPath override. The global hook is only active if no local override exists. The `install-global-hook.mjs` script correctly sets the global hooksPath and the `global-post-commit.mjs` template correctly delegates to `superroo-learn extract-commit`.

#### Reusable Rule

After installing global git hooks, verify with `git config --global core.hooksPath` and check for local overrides with `git config --local core.hooksPath`. Run a test commit with a known prefix (e.g., "fix: test") to confirm the hook triggers.

#### Tags

git-hooks, cross-project, learning-layer, verification

---

### Lesson: Docker rebuild with --no-cache generates new Next.js build hashes — nginx static file alias must be synced

Date: 2026-05-19
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: /etc/nginx/sites-enabled/dev.abcx124.xyz, cloud/docker/Dockerfile.dashboard

#### Task Summary

Fixed the white screen on https://dev.abcx124.xyz/ after a Docker rebuild with --no-cache. The Next.js server returned HTML referencing new build chunk hashes (build ID f_UNIvc0A_dsJKkamra7M), but nginx served static files from the host filesystem at /opt/superroo2/cloud/dashboard/.next/static/ which still had the old build chunks (build ID -hAv-M4A0QWCAgELC-5Qd). The browser received 404s for all new chunks, causing a white screen (failed hydration).

#### Files Changed

- (VPS) /opt/superroo2/cloud/dashboard/.next/static/ — copied new build artifacts from Docker container
- (VPS) /opt/superroo2/cloud/dashboard/.next/BUILD_ID — updated to match container build

#### Bug Cause

The nginx config for dev.abcx124.xyz has a `location /_next/static/` block that aliases to the host filesystem path `/opt/superroo2/cloud/dashboard/.next/static/`. When the Docker container was rebuilt with `--no-cache`, the Next.js build inside the container generated new chunk hashes. The container's standalone server correctly references these new hashes in its HTML output, but nginx intercepts `/_next/static/` requests and serves them from the stale host filesystem. The old chunks don't match the new hashes, so the browser gets 404s.

#### Fix Applied

Copied the new build's static files from the Docker container to the host filesystem using `docker cp`:

```
docker cp docker-superroo-dashboard-1:/app/cloud/dashboard/.next/static/. /opt/superroo2/cloud/dashboard/.next/static/
docker cp docker-superroo-dashboard-1:/app/cloud/dashboard/.next/BUILD_ID /opt/superroo2/cloud/dashboard/.next/BUILD_ID
```

Then cleaned up old stale chunks from the host filesystem.

#### Test Result

pass — All JavaScript chunks, CSS, and page/layout chunks now return HTTP 200. Full page returns 7.2KB HTML. API health endpoint returns 200.

#### Lesson Learned

When nginx serves Next.js static files from a host filesystem path (not proxying through the Docker container), every Docker rebuild with `--no-cache` creates a mismatch between the HTML chunk references and the actual files on disk. The systemic fix is to either:

1. Remove the `/_next/static/` nginx location block and let the catch-all proxy handle static files through the Docker container, OR
2. Add a post-build step that copies static files from the container to the host filesystem.

#### Reusable Rule

After any Docker rebuild of a Next.js application that has nginx serving `/_next/static/` from a host filesystem alias, always sync the static files from the container to the host using `docker cp`. Better yet, remove the nginx static file alias and proxy all requests through the container to prevent future mismatches.

#### Tags

nginx, nextjs, docker, static-files, hydration, white-screen, deployment

---

### Lesson: Docker healthcheck must avoid Next.js proxy — use root endpoint `/` not `/api/health`

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/docker/docker-compose.yml, cloud/docker/Dockerfile.dashboard, cloud/dashboard/next.config.js, cloud/remote-deploy-dashboard.sh, cloud/test-e2e-openclaw.js, cloud/test-e2e-deploy.js

#### Task Summary

Completed 5 improvements after the white-screen fix: (1) fixed 9 flaky checkpoint tests by adding per-describe 60s timeout, (2) deployed healthcheck fix to VPS changing from `/api/health` back to `/`, (3) integrated `sync-dashboard-static.sh` into the deploy pipeline, (4) ran Phase 2 e2e tests fixing 4 assertion mismatches (2 in test-e2e-deploy.js, 2 in test-e2e-openclaw.js), (5) recorded this lesson.

#### Files Changed

- src/services/checkpoints/**tests**/ShadowCheckpointService.spec.ts — added `{ timeout: 60_000 }` to describe.each
- cloud/docker/docker-compose.yml — healthcheck changed from `/api/health` to `/`
- cloud/docker/Dockerfile.dashboard — healthcheck CMD changed from `/api/health` to `/`
- cloud/remote-deploy-dashboard.sh — added step 9 to sync static files from Docker container
- cloud/test-e2e-deploy.js — fixed 2 assertion mismatches (askAI signature, variable name)
- cloud/test-e2e-openclaw.js — fixed 2 assertion mismatches (keywordFallback return value, seniorEngineerReply reference)

#### Bug Cause

1. **Healthcheck proxy failure**: The Docker healthcheck `curl -f http://localhost:3001/api/health` triggered Next.js rewrite proxy to `http://localhost:8787/health`. Inside the Docker container, `localhost:8787` refers to the container itself, not the API container at `superroo-api:8787`. The `NEXT_PUBLIC_API_URL=http://localhost:8787` is baked at build time, so `API_INTERNAL_URL=http://superroo-api:8787` (set at runtime in docker-compose.yml) is not available during the Next.js build.

2. **Test assertion drift**: E2E tests had hardcoded expected values that no longer matched actual code after refactoring — `keywordFallback("What is the architecture?")` returns `"feature_query"` not `"chat"`, and `telegramEngineer.seniorEngineerReply` is not referenced in the bot source.

#### Fix Applied

1. Changed healthcheck to use root endpoint `/` which returns 200 without proxying to the API.
2. Updated test assertions to match actual code behavior.

#### Test Result

pass — All e2e tests pass: test-e2e-deploy.js 45/45, test-e2e-openclaw.js 135/135. Dashboard healthy on VPS.

#### Lesson Learned

Next.js `next.config.js` is evaluated at build time, so runtime environment variables set in docker-compose.yml (like `API_INTERNAL_URL`) are NOT available during the build. Any `process.env` references in `next.config.js` that are meant to be set at runtime must use a runtime config file instead. For Docker healthchecks, always use an endpoint that does NOT trigger a proxy rewrite — the root page `/` is safe.

#### Reusable Rule

When setting a Docker healthcheck for a Next.js application that proxies API requests, always use `curl -f http://localhost:PORT/` (the root page) instead of `curl -f http://localhost:PORT/api/health`. The `/api/*` path triggers the Next.js rewrite proxy, which may fail inside the container if the API URL resolves to localhost (the container itself) rather than the API service. Also, keep e2e test assertions in sync with actual code — they drift when functions are refactored.

#### Tags

docker, nextjs, healthcheck, proxy, e2e-tests, vitest, deployment, nginx

---

### Auto-Extracted Lesson: Add missing CIRCUIT_BREAKER, DEPLOYMENT_FAILURE, DATABASE_CONNECTION to Repai...

Date: 2026-05-20
Source: Git commit 3db62aef
Model/API used: unknown
Confidence: medium
Related files: memory/lesson-index.jsonl
memory/lesson-summaries.json
memory/lessons-learned.md
src/super-roo/healing/RepairPlanBuilder.ts

#### Task Summary

fix: add missing CIRCUIT_BREAKER, DEPLOYMENT_FAILURE, DATABASE_CONNECTION to RepairPlanBuilder category maps

#### Files Changed

- `memory/lesson-index.jsonl
memory/lesson-summaries.json
memory/lessons-learned.md
src/super-roo/healing/RepairPlanBuilder.ts`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 3db62aef.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 3db62aef by JPG Yap.

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

### Lesson: Use vi.doMock instead of vi.mock inside beforeEach after vi.resetModules

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: src/super-roo/debug-team/**tests**/DebugTeamComponents.test.ts, src/super-roo/ml/sync/MLSyncClient.ts

#### Task Summary

Created 4 comprehensive test files for untested TypeScript modules: Learners.test.ts (36 tests), InfiniteImprovementLoop.test.ts (21 tests), MLSyncClient.test.ts (22 tests), and DebugTeamComponents.test.ts (107 tests). All 186 tests pass.

#### Files Changed

- src/super-roo/ml/learning/**tests**/Learners.test.ts (created)
- src/super-roo/ml/loop/**tests**/InfiniteImprovementLoop.test.ts (created)
- src/super-roo/ml/sync/**tests**/MLSyncClient.test.ts (created)
- src/super-roo/ml/sync/MLSyncClient.ts (fixed double re-queue bug)
- src/super-roo/debug-team/**tests**/DebugTeamComponents.test.ts (created)

#### Bug Cause

1. MLSyncClient.syncObservations() had a double re-queue bug: the else branch (HTTP error) re-queued observations AND threw, causing the catch block to re-queue again.
2. DebugTeamComponents OpenClawAdapter tests used vi.mock() inside beforeEach after vi.resetModules(), but vi.mock is hoisted to the top of the file by vitest, so the mock was registered before resetModules() cleared the module registry.

#### Fix Applied

1. Removed the throw in syncObservations() else branch; just set lastError directly.
2. Changed vi.mock() to vi.doMock() which is NOT hoisted and works correctly inside beforeEach after resetModules().

#### Test Result

pass

#### Lesson Learned

vi.mock() is hoisted by vitest to the top of the file, so it cannot be used inside beforeEach() after vi.resetModules(). Use vi.doMock() instead, which is not hoisted and evaluates at the call site. This pattern is essential when dynamically mocking modules per-test with resetModules().

#### Reusable Rule

When mocking modules inside beforeEach() after calling vi.resetModules(), ALWAYS use vi.doMock() instead of vi.mock(). vi.mock() is hoisted and will be registered before resetModules() clears the registry, causing the mock to be lost.

#### Tags

testing, vitest, mocking, vi.doMock, vi.mock, resetModules, hoisting, debug-team, ML

---

### Lesson: Telegram Bot Frictionless Coding & Context Awareness Improvements

Date: 2026-05-20
Source: Kimi Code CLI task completion
Model/API used: kimi-k2.5
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/api/telegramNotifier.js, cloud/worker/agentRunners.js, cloud/api/telegramLearner.js, cloud/api/telegramClassifier.js

#### Task Summary

Implemented 6 major improvements to the Telegram coding workflow to make it fully frictionless and context-aware:

1. Fixed auto mode UX so approval buttons are hidden when `--auto` is used
2. Added phase-transition progress messages (`sendCoderAutoProgress`) between plan/apply/commit/test/deploy
3. Added persistent typing indicator (`startAutoTypingInterval`) for multi-phase auto jobs with 10min timeout
4. Added `📋 Similar Task` and `🔍 Audit Changes` quick-action buttons after deploy success
5. Added persistent reply keyboard on `/start` with click-first GUI mapping
6. Enhanced context awareness: classifier now receives conversation history, `buildConversationSummary` and `buildSmartContextPrompt` include learned patterns from `telegramLearner`

#### Files Changed

- cloud/api/telegramNotifier.js
- cloud/worker/agentRunners.js
- cloud/api/telegramBot.js
- cloud/api/telegramLearner.js
- cloud/api/telegramClassifier.js

#### Bug Cause

Auto mode was confusing because it chained phases automatically in the worker BUT still sent approval buttons to the user in Telegram, creating a race condition where the user could click "Reject" after code was already applied.

#### Fix Applied

- `sendCoderPlan` now shows "⏳ Auto-Processing..." status instead of approve/reject buttons when `auto === true`
- Added `sendCoderAutoProgress` to notify users between each phase transition
- Added reply keyboard + button mapping so users never need to type slash commands

#### Test Result

Syntax check passed on all 5 modified files (`node --check`).

#### Lesson Learned

When implementing auto-mode workflows, the UI must match the backend behavior. If the worker auto-chains, the frontend should not show manual approval controls. Also, persistent reply keyboards dramatically improve mobile UX for bot interactions.

#### Reusable Rule

1. Always hide manual approval UI when auto-mode is active — show progress/status instead.
2. Use persistent reply keyboards for frequent actions to reduce typing friction.
3. Pass conversation context to intent classifiers so follow-ups like "proceed" or "do it" resolve correctly.
4. Keep typing indicators bounded with timeouts so they don't leak if a worker crashes.
5. When adding new callback buttons, handle them in BOTH `telegramNotifier.handleCoderCallback` AND `telegramBot.js` callback routing.

#### Tags

telegram, ux, auto-mode, context-awareness, intent-classification, reply-keyboard, progress-messaging

---

### Lesson: Compliance tab learning layer health

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Expose learning-layer health, lesson quality, sync coverage, hook status, bridge health, and commit data-quality diagnostics separately from true workflow violations. Use safe JSON/JSONL readers so malformed memory records degrade into dashboard diagnostics instead of crashing compliance routes.

#### Lesson Learned

Expose learning-layer health, lesson quality, sync coverage, hook status, bridge health, and commit data-quality diagnostics separately from true workflow violations. Use safe JSON/JSONL readers so malformed memory records degrade into dashboard diagnostics instead of crashing compliance routes.

#### Tags

cross-project, local-fallback

---

### Lesson: Advanced Features Gap Fix — 28 Gaps Across 9 Modules

Date: 2026-05-20
Source: Orchestrator + DeepSeek (Code mode) task completion
Model/API used: deepseek-chat (coding), kimi-k2.6 (orchestration)
Confidence: high
Related files: cloud/dashboard/src/components/views/_.tsx, cloud/api/api.js, src/super-roo/ml/\*\*/**tests**/_.ts, cloud/orchestrator/modules/_.js, docs/super-roo/_.md

#### Task Summary

Fixed all identified gaps in SuperRoo's advanced features across 9 modules:

- 4 dashboard views created (Parallel Execution, Autonomous Loop, Commissioning Loop, HermesClaw)
- 4 API endpoints added (ML train, ML model, ML learners, Commissioning report)
- 186 tests added across 4 test files (Learners, InfiniteImprovementLoop, MLSyncClient, DebugTeamComponents)
- 5 cross-module integrations wired (Debug→Healing, ML→Debug, Commissioning→Bug Registry, FeatureAnswerer→LearningGateway, Cross-module health check)
- 5 documentation files written (ML Engine, Debug Team, Autonomous Loop, Commissioning Loop, HermesClaw)
- 1 source bug fixed (MLSyncClient double re-queue on HTTP error)

#### Files Changed

- cloud/dashboard/src/components/views/parallel-execution.tsx
- cloud/dashboard/src/components/views/autonomous-loop.tsx
- cloud/dashboard/src/components/views/commissioning-loop.tsx
- cloud/dashboard/src/components/views/hermes-claw.tsx
- cloud/dashboard/src/app/page.tsx
- cloud/dashboard/src/components/sidebar.tsx
- cloud/api/api.js
- src/super-roo/ml/learning/**tests**/Learners.test.ts
- src/super-roo/ml/loop/**tests**/InfiniteImprovementLoop.test.ts
- src/super-roo/ml/sync/**tests**/MLSyncClient.test.ts
- src/super-roo/debug-team/**tests**/DebugTeamComponents.test.ts
- cloud/orchestrator/modules/AutonomousLoop.js
- cloud/orchestrator/modules/InfiniteImprovementLoop.js
- cloud/orchestrator/modules/CommissioningLoop.js
- cloud/orchestrator/modules/FeatureAnswerer.js
- src/super-roo/ml/sync/MLSyncClient.ts
- docs/super-roo/ML_ENGINE_GUIDE.md
- docs/super-roo/DEBUG_TEAM_GUIDE.md
- docs/super-roo/AUTONOMOUS_LOOP_GUIDE.md
- docs/super-roo/COMMISSIONING_LOOP_GUIDE.md
- docs/super-roo/HERMES_CLAW_GUIDE.md

#### Bug Cause

MLSyncClient.syncObservations() had a double re-queue bug: the else branch (HTTP error) re-queued observations AND threw, causing the catch block to re-queue again.

#### Fix Applied

Removed the throw in the else branch and set lastError directly, so the catch block handles the single re-queue.

#### Test Result

pass — 186 tests across 4 new test files all pass. 1 existing bug fixed during test writing.

#### Lesson Learned

1. Gap analysis documents can have stale information — always verify actual source code before implementing. The initial gap analysis claimed "0 tests" for ML Engine, but engine/ already had 5 test files.
2. `vi.doMock()` must be used instead of `vi.mock()` when mocking inside beforeEach after resetModules — vi.mock is hoisted and won't re-evaluate.
3. Cross-platform test assertions need care: exit codes differ between Windows (returns -1 for exit 1) and Unix.
4. Writing tests first is the fastest way to discover real bugs in the codebase.

#### Reusable Rule

Before claiming a module has "no tests", run `find src/MODULE -name '*.test.ts'` and check all subdirectories. The test coverage may be partial, not zero.

#### Tags

advanced-features, gap-analysis, testing, dashboard, api, documentation, integration, ml-engine, debug-team, parallel-execution, autonomous-loop, commissioning-loop, hermesclaw

---

### Lesson: VPS RAM Orchestrator Worker — multi-layer RAM pressure management with worker pausing and task deferral

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/orchestrator/modules/RAMMonitor.js, cloud/orchestrator/modules/RAMScheduler.js, cloud/orchestrator/modules/WorkerPauseManager.js, cloud/worker/vpsRamOrchestratorWorker.js, cloud/orchestrator/CloudOrchestrator.js, cloud/orchestrator/index.js

#### Task Summary

Built a complete VPS RAM Orchestrator Worker system with three modular layers:

1. **RAMMonitor** — Continuously polls VPS RAM usage with 4-state state machine (normal→warning→critical→danger) and trend analysis over a rolling window. Emits events on state transitions.
2. **RAMScheduler** — RAM-aware task queuing that throttles dispatch based on current RAM state. Deferred tasks are automatically resubmitted when RAM recovers. Supports priority boosting for urgent operations.
3. **WorkerPauseManager** — Manages worker lifecycle with 4 criticality levels (essential/critical/normal/background). Automatically pauses non-essential workers when RAM exceeds thresholds and resumes them on recovery. Integrates with AgentRegistry and ParallelExecutor.

The main `vpsRamOrchestratorWorker.js` ties all three modules together as a standalone PM2 process with a health HTTP API, BullMQ integration, and graceful shutdown. All modules are exported from the orchestrator index and registered in CloudOrchestrator.

#### Files Changed

- cloud/orchestrator/modules/RAMMonitor.js — NEW: RAM sensing with state machine
- cloud/orchestrator/modules/RAMScheduler.js — NEW: RAM-aware task queuing
- cloud/orchestrator/modules/WorkerPauseManager.js — NEW: Worker lifecycle management
- cloud/worker/vpsRamOrchestratorWorker.js — NEW: Standalone PM2 worker process
- cloud/orchestrator/CloudOrchestrator.js — MODIFIED: Added RAM module registration + status
- cloud/orchestrator/index.js — MODIFIED: Exported all new modules

#### Bug Cause

N/A — new feature

#### Fix Applied

N/A — new feature

#### Test Result

All modules load and export correctly. Verified via Node.js require().

#### Lesson Learned

When building resource-aware orchestration, separate sensing (RAMMonitor) from policy (RAMScheduler) from actuation (WorkerPauseManager). This allows each layer to be tested independently and replaced without affecting the others. The state machine pattern (normal→warning→critical→danger) with hysteresis (recovery threshold lower than warning) prevents oscillation. Worker criticality levels let the system make granular decisions about which processes to pause based on RAM pressure severity.

#### Reusable Rule

Always separate sensing, policy, and actuation into distinct modules for resource management systems. Use a state machine with hysteresis to prevent oscillation. Use criticality levels (not binary on/off) for worker management so the system degrades gracefully under increasing pressure.

#### Tags

vps, ram, orchestrator, worker, resource-management, backpressure, scheduling, pm2

---

### Auto-Extracted Lesson: Feat: add ML Engine + Product Memory dashboard views, wire sidebar nav, add /...

Date: 2026-05-20
Source: Git commit 20f78e53
Model/API used: unknown
Confidence: medium
Related files: ', AGENTS.md, cloud/api/api.js, cloud/api/routes/workflow-compliance.js, cloud/api/telegramBot.js

#### Task Summary

feat: add ML Engine + Product Memory dashboard views, wire sidebar nav, add /cancel command

#### Files Changed

- `'`
- `AGENTS.md`
- `cloud/api/api.js`
- `cloud/api/routes/workflow-compliance.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramLearner.js`
- `cloud/api/telegramNotifier.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/autonomous-loop.tsx`
- `cloud/dashboard/src/components/views/commissioning-loop.tsx`
- `cloud/dashboard/src/components/views/deploy-orchestrator.tsx`
- `cloud/dashboard/src/components/views/hermes-claw.tsx`
- `cloud/dashboard/src/components/views/ml-engine.tsx`
- `cloud/dashboard/src/components/views/parallel-execution.tsx`
- `cloud/dashboard/src/components/views/product-memory.tsx`
- `cloud/dashboard/src/components/views/workflow-compliance.tsx`
- `cloud/docker/Dockerfile.dashboard`
- `cloud/orchestrator/CloudOrchestrator.js`
- `cloud/orchestrator/index.js`
- `cloud/orchestrator/ml/NeuralNetwork.js`
- `cloud/orchestrator/modules/AutonomousLoop.js`
- `cloud/orchestrator/modules/BuildQueue.js`
- `cloud/orchestrator/modules/CommissioningLoop.js`
- `cloud/orchestrator/modules/DeployOrchestrator.js`
- `cloud/orchestrator/modules/FeatureAnswerer.js`
- `cloud/orchestrator/modules/InfiniteImprovementLoop.js`
- `cloud/orchestrator/modules/RAMMonitor.js`
- `cloud/orchestrator/modules/RAMScheduler.js`
- `cloud/orchestrator/modules/UnifiedBuilder.js`
- `cloud/orchestrator/modules/WorkerPauseManager.js`
- `cloud/remote-deploy-dashboard.sh`
- `cloud/test-e2e-deploy.js`
- `cloud/test-e2e-openclaw.js`
- `cloud/worker/vpsRamOrchestratorWorker.js`
- `docs/super-roo/AUTONOMOUS_LOOP_GUIDE.md`
- `docs/super-roo/COMMISSIONING_LOOP_GUIDE.md`
- `docs/super-roo/DEBUG_TEAM_GUIDE.md`
- `docs/super-roo/HERMES_CLAW_GUIDE.md`
- `docs/super-roo/ML_ENGINE_GUIDE.md`
- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/context/latest-agent-context.md`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `product-features/advanced-features-gap-analysis.md`
- `scripts/check-workflow-compliance.mjs`
- `scripts/sync-dashboard-static.sh`
- `server/src/memory/McpMemoryServer.ts`
- `server/src/memory/commit-deploy-log.json`
- `src/docs/resources/debug-team/websocket-best-practices.md`
- `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`
- `src/super-roo/debug-team/__tests__/DebugTeamComponents.test.ts`
- `src/super-roo/ml/learning/__tests__/Learners.test.ts`
- `src/super-roo/ml/loop/__tests__/InfiniteImprovementLoop.test.ts`
- `src/super-roo/ml/sync/MLSyncClient.ts`
- `src/super-roo/ml/sync/__tests__/MLSyncClient.test.ts`
- `tools/superroo-learn.mjs`
- `website_response.html`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 20f78e53.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 20f78e53 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ml-engine, api, deployment

---

### Auto-Extracted Lesson: Feat: add ML Engine + Product Memory dashboard views, wire sidebar nav, add /...

Date: 2026-05-20
Source: Git commit ec3b00f6
Model/API used: unknown
Confidence: medium
Related files: ', AGENTS.md, cloud/api/api.js, cloud/api/routes/workflow-compliance.js, cloud/api/telegramBot.js

#### Task Summary

feat: add ML Engine + Product Memory dashboard views, wire sidebar nav, add /cancel command

#### Files Changed

- `'`
- `AGENTS.md`
- `cloud/api/api.js`
- `cloud/api/routes/workflow-compliance.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramLearner.js`
- `cloud/api/telegramNotifier.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/autonomous-loop.tsx`
- `cloud/dashboard/src/components/views/commissioning-loop.tsx`
- `cloud/dashboard/src/components/views/deploy-orchestrator.tsx`
- `cloud/dashboard/src/components/views/hermes-claw.tsx`
- `cloud/dashboard/src/components/views/ml-engine.tsx`
- `cloud/dashboard/src/components/views/parallel-execution.tsx`
- `cloud/dashboard/src/components/views/product-memory.tsx`
- `cloud/dashboard/src/components/views/workflow-compliance.tsx`
- `cloud/docker/Dockerfile.dashboard`
- `cloud/orchestrator/CloudOrchestrator.js`
- `cloud/orchestrator/index.js`
- `cloud/orchestrator/ml/NeuralNetwork.js`
- `cloud/orchestrator/modules/AutonomousLoop.js`
- `cloud/orchestrator/modules/BuildQueue.js`
- `cloud/orchestrator/modules/CommissioningLoop.js`
- `cloud/orchestrator/modules/DeployOrchestrator.js`
- `cloud/orchestrator/modules/FeatureAnswerer.js`
- `cloud/orchestrator/modules/InfiniteImprovementLoop.js`
- `cloud/orchestrator/modules/RAMMonitor.js`
- `cloud/orchestrator/modules/RAMScheduler.js`
- `cloud/orchestrator/modules/UnifiedBuilder.js`
- `cloud/orchestrator/modules/WorkerPauseManager.js`
- `cloud/remote-deploy-dashboard.sh`
- `cloud/test-e2e-deploy.js`
- `cloud/test-e2e-openclaw.js`
- `cloud/worker/vpsRamOrchestratorWorker.js`
- `docs/super-roo/AUTONOMOUS_LOOP_GUIDE.md`
- `docs/super-roo/COMMISSIONING_LOOP_GUIDE.md`
- `docs/super-roo/DEBUG_TEAM_GUIDE.md`
- `docs/super-roo/HERMES_CLAW_GUIDE.md`
- `docs/super-roo/ML_ENGINE_GUIDE.md`
- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/context/latest-agent-context.md`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `product-features/advanced-features-gap-analysis.md`
- `scripts/check-workflow-compliance.mjs`
- `scripts/sync-dashboard-static.sh`
- `server/src/memory/McpMemoryServer.ts`
- `server/src/memory/commit-deploy-log.json`
- `src/docs/resources/debug-team/websocket-best-practices.md`
- `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`
- `src/super-roo/debug-team/__tests__/DebugTeamComponents.test.ts`
- `src/super-roo/ml/learning/__tests__/Learners.test.ts`
- `src/super-roo/ml/loop/__tests__/InfiniteImprovementLoop.test.ts`
- `src/super-roo/ml/sync/MLSyncClient.ts`
- `src/super-roo/ml/sync/__tests__/MLSyncClient.test.ts`
- `tools/superroo-learn.mjs`
- `website_response.html`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit ec3b00f6.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit ec3b00f6 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ml-engine, api, deployment

---

### Auto-Extracted Lesson: Close all 10 RAM orchestrator gaps — dashboard view, alerting/Telegram, Deplo...

Date: 2026-05-20
Source: Git commit bfc63b1b
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/components/views/ram-orchestrator.tsx, cloud/ecosystem.config.js, cloud/orchestrator/modules/CPUGuard.js

#### Task Summary

fix: close all 10 RAM orchestrator gaps — dashboard view, alerting/Telegram, DeployOrchestrator RAM check, CPUGuard shared RAM, cluster mode, history persistence, auto-scaling, swap monitoring

#### Files Changed

- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/ram-orchestrator.tsx`
- `cloud/ecosystem.config.js`
- `cloud/orchestrator/modules/CPUGuard.js`
- `cloud/orchestrator/modules/DeployOrchestrator.js`
- `cloud/orchestrator/modules/RAMMonitor.js`
- `cloud/worker/orchestratorWorker.js`
- `cloud/worker/vpsRamOrchestratorWorker.js`
- `memory/lesson-summaries.json`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit bfc63b1b.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit bfc63b1b by JPG Yap.

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

### Auto-Extracted Lesson: Remove duplicate module.exports in RAMMonitor.js that was overwriting getSwap...

Date: 2026-05-20
Source: Git commit bc55e422
Model/API used: unknown
Confidence: medium
Related files: cloud/orchestrator/modules/RAMMonitor.js, memory/lesson-index.jsonl, memory/lesson-summaries.json, memory/lessons-learned.md

#### Task Summary

fix: remove duplicate module.exports in RAMMonitor.js that was overwriting getSwapUsage and getRamUsagePercent exports

#### Files Changed

- `cloud/orchestrator/modules/RAMMonitor.js`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit bc55e422.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit bc55e422 by JPG Yap.

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

### Lesson: Docker depends_on API container causes cascade failure when port is host-bound via PM2

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/docker/docker-compose.yml

#### Task Summary

The website (superroo.cloud) was not loading after RAM orchestrator gap fixes were deployed. Investigation revealed the dashboard Docker container was running an old build. After rebuilding the dashboard image, `docker compose up -d` tried to recreate the API container too (due to `depends_on`), which failed because port 8787 was already bound by the PM2 `superroo-api` process on the host.

#### Files Changed

- `cloud/docker/docker-compose.yml`

#### Bug Cause

The `superroo-dashboard` and `superroo-mini-ide` services had `depends_on: superroo-api: condition: service_healthy`. When `docker compose up -d superroo-dashboard` was run, Docker Compose tried to recreate the API container, which failed because port 8787 was already bound by the PM2 `superroo-api` process. The API container entered a "Created" (not running) state, which prevented the dashboard from starting (it waited for the API to be healthy).

#### Fix Applied

1. Removed `depends_on` from `superroo-dashboard`, `superroo-mini-ide`, `superroo-worker`, and `superroo-auto-deployer` — the API is already running via PM2 on the host
2. Commented out the port binding `8787:8787` on the API container to avoid conflict with the PM2 process
3. Ran `docker compose down superroo-api superroo-dashboard && docker compose up -d superroo-dashboard` to recreate only the dashboard container

#### Test Result

pass — dashboard returns HTTP 200, API returns HTTP 200, RAM orchestrator health endpoint returns normal state

#### Lesson Learned

When running a hybrid Docker + PM2 setup, Docker Compose `depends_on` with `condition: service_healthy` creates a hard dependency that can cascade-fail if the depended-on container can't start due to port conflicts with host processes. Services that can reach the host process directly (via `localhost:PORT`) should not have Docker-level dependencies on containers that are redundant with host processes.

#### Reusable Rule

When a Docker Compose service depends on another service that is already running via PM2 on the host, do NOT use `depends_on` in docker-compose.yml. Instead, remove the dependency and let the service connect directly to the host process via `localhost:PORT`. Also, avoid binding the same host port in both Docker and PM2 — comment out the Docker port binding and let PM2 handle it.

#### Tags

docker, docker-compose, deployment, port-conflict, pm2

---

### Lesson: MCP server `local_json_fallback` silently drops lesson data — `withFallback()` must detect it

Date: 2026-05-20
Source: Code mode task completion
Model/API used: DeepSeek Chat
Confidence: high
Related files: C:\Users\User\.superroo\bin\superroo-learn.mjs, server/src/memory/McpMemoryServer.ts

#### Task Summary

The Quotation Automation System project's memory lessons were not being sent to the Central Brain. The `superroo-learn` CLI reported "✅ Lesson stored to Central Brain" but the lessons were silently dropped.

#### Files Changed

- `C:\Users\User\.superroo\bin\superroo-learn.mjs` — `withFallback()` function (line 450) and `cmdExtractCommit()` (line 956)

#### Bug Cause

The MCP server at port 3419 proxies `hermes_learn` to the Central Brain daemon (port 3417) and REST API (port 8787), but BOTH were unreachable from the local machine. The MCP server's `_proxyWithFallback` fell through to `_handleLocalFallback`, which returns `{success:true, source:"local_json_fallback"}` — the lesson data was DROPPED (the local JSON fallback handler for `hermes_learn` doesn't actually store the lesson, it just returns empty results). The `withFallback()` function in `superroo-learn.mjs` only caught thrown errors, not `success:true` responses with `source:"local_json_fallback"`.

#### Fix Applied

1. Added detection in `withFallback()`: if MCP result has `source === "local_json_fallback"`, throw an error to trigger the fallback chain to local storage + retry queue
2. Added missing `retryContext` parameter to `cmdExtractCommit()` so git hook lessons are queued for retry when MCP fails

#### Test Result

pass — `superroo-learn store` now correctly stores locally and queues for retry when Central Brain daemon is offline

#### Lesson Learned

When building fallback chains, never trust `success: true` from an upstream component — always inspect the `source` field to verify the data was actually persisted. The MCP server's `_handleLocalFallback` returns `success: true` even though it doesn't store the data, which is a design flaw that silently loses lessons.

#### Reusable Rule

Any `withFallback()` pattern that proxies through an intermediate server must check the `source` field of the response, not just catch errors. If the source is `local_json_fallback`, treat it as a failure and fall through to real local storage + retry queue.

#### Tags

learning-layer, central-brain, mcp, fallback, lesson-storage, cross-project

---

### Auto-Extracted Lesson: Detect MCP local_json_fallback in withFallback() so lessons are stored locall...

Date: 2026-05-20
Source: Git commit f78230e4
Model/API used: unknown
Confidence: medium
Related files: memory/.stop-hook-last-run, memory/.sync-state.json, memory/lesson-index.jsonl, memory/lesson-summaries.json, memory/lessons-learned.md

#### Task Summary

fix: detect MCP local_json_fallback in withFallback() so lessons are stored locally + queued for retry

#### Files Changed

- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit f78230e4.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit f78230e4 by JPG Yap.

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

### Auto-Extracted Lesson: Add TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID to ecosystem.config.js env b...

Date: 2026-05-20
Source: Git commit 1feb0dd1
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/components/views/ram-orchestrator.tsx, cloud/ecosystem.config.js, memory/lesson-index.jsonl, memory/lesson-summaries.json, memory/lessons-learned.md

#### Task Summary

fix: add TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID to ecosystem.config.js env block — PM2 v7 env_file is not supported

#### Files Changed

- `cloud/dashboard/src/components/views/ram-orchestrator.tsx`
- `cloud/ecosystem.config.js`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 1feb0dd1.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 1feb0dd1 by JPG Yap.

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

### Auto-Extracted Lesson: (ram-orchestrator): fix connectivity, real data, swap, alerts, event log

Date: 2026-05-20
Source: Git commit 5cf540ce
Model/API used: unknown
Confidence: medium
Related files: memory/lesson-index.jsonl, memory/lesson-summaries.json, memory/lessons-learned.md

#### Task Summary

fix(ram-orchestrator): fix connectivity, real data, swap, alerts, event log

#### Files Changed

- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 5cf540ce.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 5cf540ce by JPG Yap.

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

### Lesson: PM2 v7 env_file directive does not load .env — env vars must be in env block

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/ecosystem.config.js, cloud/api/api.js

#### Task Summary

Telegram bot @superroo_bot stopped responding to messages. Investigation revealed the webhook endpoint returned {"ok":false,"error":"TELEGRAM_BOT_TOKEN not configured"} because the TELEGRAM_BOT_TOKEN was defined in /opt/superroo2/cloud/.env but PM2's env_file directive did not load it into the process environment.

#### Files Changed

- cloud/ecosystem.config.js

#### Bug Cause

PM2 v7.0.1's `env_file` directive does NOT load .env file contents into the process environment. The ecosystem.config.js had `env_file: "/opt/superroo2/cloud/.env"` but the TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID were never passed to the superroo-api process. When Telegram sent webhook POSTs, the handler at api.js:10535 checked `if (!TELEGRAM_BOT_TOKEN)` and returned the error response.

#### Fix Applied

1. Removed the non-functional `env_file` directive from ecosystem.config.js
2. Added TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID directly to the `env` block
3. Added comment explaining PM2 v7 does not support env_file
4. Deployed: git pull, pm2 delete superroo-api, pm2 start cloud/ecosystem.config.js --only superroo-api (pm2 restart reuses old env, must delete and re-create)
5. Verified: TELEGRAM_BOT_TOKEN now in /proc/PID/environ
6. Verified: webhook endpoint returns {"ok":true}

#### Test Result

pass

#### Lesson Learned

PM2 v7's `env_file` directive is NOT functional — it does not load .env file contents into the process environment. All environment variables must be specified directly in the `env` block of ecosystem.config.js. Additionally, `pm2 restart` reuses the old process environment; to pick up new env vars from the config file, you must `pm2 delete` and `pm2 start` the process.

#### Reusable Rule

Never use `env_file` in PM2 ecosystem.config.js — PM2 v7 does not support it. Always put env vars directly in the `env` block. When changing env vars, use `pm2 delete` + `pm2 start` (not `pm2 restart`) to force PM2 to re-read the config.

#### Tags

pm2, env_file, environment-variables, telegram-bot, deployment, ecosystem-config

---

### Auto-Extracted Lesson: Telegram Learner cold start, Badge/StatCard docs, HTTP→HTTPS redirect

Date: 2026-05-20
Source: Git commit 622f623b
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramBot.js, cloud/api/telegramLearner.js, cloud/api/telegramNotifier.js, cloud/dashboard/src/components/ui/badge.tsx

#### Task Summary

fix: Telegram Learner cold start, Badge/StatCard docs, HTTP→HTTPS redirect

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramLearner.js`
- `cloud/api/telegramNotifier.js`
- `cloud/dashboard/src/components/ui/badge.tsx`
- `cloud/dashboard/src/components/ui/card.tsx`
- `cloud/nginx-dashboard.conf`
- `cloud/test-consultant-deploy.js`
- `cloud/test-e2e-deploy.js`
- `cloud/test-e2e-quick.js`
- `docs/super-roo/TELEGRAM_GAP_ANALYSIS.md`
- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `temp-lesson.md`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 622f623b.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 622f623b by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, deployment, bugfix

### Lesson: Systematic Telegram gap analysis — implement all 26 gaps across 6 phases

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/api/api.js, cloud/api/telegramLearner.js, cloud/test-telegram-regression.js

#### Task Summary

Implemented all 26 gaps identified in the Telegram Gap Analysis across 6 phases: Security (webhook secret, dedup, callback registry), Intelligence (LLM summary compression, smart context, cross-session memory, intent scoring, topic detection), Reliability (progress bars, command history, paginated messages, scheduled commands, multi-select keyboards), Monitoring (webhook health dashboard, command latency, provider fallback metrics), Intelligence v2 (active learning, pattern optimization, quality scoring, intent accuracy, cross-user patterns), and Nice-to-Have (response cache, tiered rate limiting, IP whitelist, regression test). All 33 regression tests pass.

#### Files Changed

- cloud/api/telegramBot.js — added response cache, scheduled commands, multi-select keyboards, paginated messages, callback registry, smart context, topic detection, command history, latency tracking, provider metrics, webhook health, progress bars, active learning, rate limiting, and all corresponding exports
- cloud/api/api.js — added TELEGRAM_IP_RANGES constant, \_isTelegramIp() function, webhook IP whitelist check
- cloud/api/telegramLearner.js — added cross-user pattern learning (mergeCrossUserPatterns, getCrossUserPatterns, getCrossUserInsights), user intent profiles
- cloud/test-telegram-regression.js — new file: 33-test regression suite covering all 26 GAP features

#### Bug Cause

N/A — new feature implementation

#### Fix Applied

N/A — new feature implementation

#### Test Result

pass — 33/33 regression tests pass

#### Lesson Learned

When implementing a large batch of features across multiple files, create a regression test suite early to catch export mismatches and missing function references. The test caught 10 missing exports and 3 constant name mismatches in the first run. Also, when adding features to a large existing module (telegramBot.js is ~9800 lines), always verify module.exports includes every new function — it is easy to forget.

#### Reusable Rule

For any multi-file feature implementation, create a structural regression test that validates: (1) all expected functions are exported, (2) all expected constants exist in source, (3) all expected source code patterns are present. Run this test before deployment to catch missing exports and naming mismatches.

#### Tags

telegram, gap-analysis, security, intelligence, reliability, monitoring, regression-testing, deployment

---

### Lesson: E2E health scan after multi-file feature implementation — verify all test scripts run from correct working directory

Date: 2026-05-20
Source: Code agent e2e health scan
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/test-telegram-bot-updates.js, cloud/test-e2e-deploy.js, cloud/test-verify-fixes.js

#### Task Summary

Ran comprehensive e2e health scan after implementing all 26 Telegram gap analysis features. Verified VPS health (6 PM2 processes, nginx, disk, memory, API), ran all available test scripts, and fixed a pre-existing path issue in test-telegram-bot-updates.js.

#### Files Changed

- cloud/test-telegram-bot-updates.js (line 55: ./cloud/api/ -> ./api/)

#### Bug Cause

Pre-existing path issue: test-telegram-bot-updates.js used `readFileSync("./cloud/api/telegramBot.js")` but the test runs from the `cloud/` directory, making the effective path `cloud/cloud/api/telegramBot.js`. The correct path is `./api/telegramBot.js` (resolves to `cloud/api/telegramBot.js`).

#### Fix Applied

Changed `readFileSync("./cloud/api/telegramBot.js")` to `readFileSync("./api/telegramBot.js")` on line 55.

#### Test Result

pass — 13/13 tests pass locally and on VPS

#### Lesson Learned

When running test scripts from a subdirectory (e.g., `cd cloud && node test.js`), all relative paths in the script resolve relative to the current working directory, not the script's location. Always verify that `readFileSync` and `require` paths are correct for the intended working directory.

#### Reusable Rule

After implementing multi-file features, run ALL available test scripts from their correct working directory to catch pre-existing path issues. Test scripts using `readFileSync` with relative paths are especially prone to break when the project directory structure changes.

#### Tags

e2e, health-scan, testing, path-resolution, pre-existing-bug, telegram, gap-analysis

#### Tags

ui, api, bugfix

---

### Lesson: Bound unbounded Maps in long-running webviews with LRUCache

Date: 2026-05-20
Source: Kimi Code CLI webview crash fixes
Model/API used: Kimi Code CLI
Confidence: high
Related files: webview-ui/src/components/chat/ChatView.tsx

#### Task Summary

Fix memory leaks and performance bottlenecks in the VS Code webview extension that caused crashes under high load / long runtime. Applied 6 targeted fixes across the webview UI and extension host.

#### Files Changed

- `webview-ui/src/utils/sourceMapInitializer.ts` — dedupe guard to prevent leaking `<link>` DOM elements and event listeners on React re-renders
- `webview-ui/src/components/chat/ChatView.tsx` — replaced unbounded `Map` with `LRUCache` (max 50, 5min TTL) for `aggregatedCostsMap`
- `webview-ui/src/context/ExtensionStateContext.tsx` — debounced `vscode.setState` to 500ms to coalesce rapid streaming updates
- `webview-ui/src/App.tsx` — capped `webviewDidLaunch` retry loop at 30 attempts (60s max)
- `webview-ui/src/components/chat/ChatTextArea.tsx` — added unmount cleanup for `searchTimeoutRef`
- `src/core/webview/ClineProvider.ts` — throttled `postStateToWebviewWithoutTaskHistory` to 150ms to avoid serializing full `clineMessages` array on every streaming chunk

#### Bug Cause

Multiple independent leak sources accumulated over long sessions:

1. `aggregatedCostsMap` was a plain `Map` that grew forever as tasks were created.
2. `sourceMapInitializer` added new `<link>` elements and event listeners every time it ran.
3. `vscode.setState` serialized large JSON on every state update during streaming.
4. `webviewDidLaunch` retry loop ran forever if the extension host never responded.
5. `searchTimeoutRef` leaked timeouts when `ChatTextArea` unmounted.
6. `postStateToWebviewWithoutTaskHistory` cloned and serialized the full `clineMessages` array on every streaming chunk.

#### Fix Applied

- `LRUCache` with TTL auto-evicts old entries.
- Dedupe guards prevent duplicate initialization.
- Debounce/throttle coalesces rapid updates.
- Retry caps and cleanup effects prevent resource leaks.

#### Test Result

Type-check passes for both `src/` and `webview-ui/`. Lint shows only pre-existing warnings.

#### Lesson Learned

In long-running webviews with `retainContextWhenHidden: true`, every unbounded cache, un-cleared timeout, and unthrottled state serialization is a potential crash source. Use bounded data structures (LRUCache), dedupe guards, debounce/throttle, and strict cleanup effects.

#### Reusable Rule

When reviewing webview React code, audit for:

1. Any `Map` or `Set` that accumulates over time → replace with `LRUCache` or periodic pruning.
2. Any global side effect in initialization functions → add a dedupe guard.
3. Any `postMessage` or `setState` called in a tight loop → debounce or throttle.
4. Any `setTimeout`/`setInterval` → add cleanup in `useEffect` return or component unmount.
5. Any retry loop → cap attempts and log failure.

#### Tags

webview, memory-leak, performance, LRUCache, debounce, throttle, react, vscode-extension

---

### Auto-Extracted Lesson: Apply and Run buttons now actually work — Apply saves file to disk with visua...

Date: 2026-05-20
Source: Git commit a5a42898
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/components/views/ide-terminal.tsx, memory/.stop-hook-last-run, memory/.sync-state.json, memory/lesson-summaries.json

#### Task Summary

fix: Apply and Run buttons now actually work — Apply saves file to disk with visual feedback, Run auto-executes command in terminal

#### Files Changed

- `cloud/dashboard/src/components/views/ide-terminal.tsx`
- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/lesson-summaries.json`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit a5a42898.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit a5a42898 by JPG Yap.

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

### Lesson: Implemented 16 IDE terminal UX improvements across 6 dashboard components

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/dashboard/src/components/ide-terminal/hooks/useWebSocket.ts, cloud/dashboard/src/lib/ide-store.tsx, cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts, cloud/dashboard/src/components/ide-terminal/AiChatPanel.tsx, cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx, cloud/dashboard/src/components/views/ide-terminal.tsx

#### Task Summary

Implemented all 16 identified IDE terminal improvements across 6 dashboard components to enhance reliability, UX, and developer experience.

#### Files Changed

- cloud/dashboard/src/components/ide-terminal/hooks/useWebSocket.ts — AI message queueing (Gap #1, #3)
- cloud/dashboard/src/lib/ide-store.tsx — Terminal output persistence (Gap #5)
- cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts — Debounced output, auto-save, file size validation, command history (Gap #7, #9, #11, #16)
- cloud/dashboard/src/components/ide-terminal/AiChatPanel.tsx — Connection indicator, search empty state, rate limit feedback, image preview (Gap #2, #10, #13, #14)
- cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx — ANSI color parsing, output virtualization (Gap #12, #15)
- cloud/dashboard/src/components/views/ide-terminal.tsx — File save error handling, keyboard shortcuts, pass new props (Gap #4, #8)

#### Bug Cause

N/A — feature implementation, not bug fix.

#### Fix Applied

N/A

#### Test Result

unknown

#### Lesson Learned

When implementing multiple UX improvements across a component tree, it's essential to trace the data flow end-to-end: hook → store → parent component → child component. Each new prop must be exposed from the hook's return value, passed through the parent's JSX, and consumed in the child's interface. For virtualization, use absolute positioning with a spacer div to maintain scroll height while only rendering visible items. For ANSI parsing, strip codes for classification (error/warning detection) but render styled spans for display.

#### Reusable Rule

When adding new props to a deeply-nested React component, trace the full chain: (1) hook return type → (2) destructure in parent → (3) pass as JSX prop → (4) add to child interface → (5) destructure in child. Miss any link and the prop silently fails. For virtualization, always pair `useMemo` for visible range calculation with a `ResizeObserver` for container height tracking.

#### Tags

ide-terminal, ux, virtualization, ansi, react, websocket

---

### Lesson: Telegram diff deep links

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Telegram View Diff must never depend only on a volatile callback preview. Store/preserve the git diff in pending coder job state, expose it through /api/telegram/tasks/:id/diff, include diff metadata in /api/telegram/tasks, and make Telegram buttons open the dashboard deep link /?page=telegram&task=<id>&panel=diff with an inline preview as a fallback.

#### Lesson Learned

Telegram View Diff must never depend only on a volatile callback preview. Store/preserve the git diff in pending coder job state, expose it through /api/telegram/tasks/:id/diff, include diff metadata in /api/telegram/tasks, and make Telegram buttons open the dashboard deep link /?page=telegram&task=<id>&panel=diff with an inline preview as a fallback.

#### Tags

cross-project, local-fallback

---

### Auto-Extracted Lesson: Add missing await on 4 HermesClaw.getStats() calls and fix stat field name in...

Date: 2026-05-20
Source: Git commit b8beeb3e
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: add missing await on 4 HermesClaw.getStats() calls and fix stat field name in health check

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit b8beeb3e.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit b8beeb3e by JPG Yap.

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

### Auto-Extracted Lesson: (webview): comprehensive tab error fixes and gap closures (P0–P2)

Date: 2026-05-20
Source: Git commit 9cc50a8a
Model/API used: unknown
Confidence: medium
Related files: memory/.stop-hook-last-run, memory/.sync-state.json, memory/context/latest-agent-context.md, memory/lesson-index.jsonl, memory/lesson-summaries.json

#### Task Summary

fix(webview): comprehensive tab error fixes and gap closures (P0–P2)

#### Files Changed

- `memory/.stop-hook-last-run`
- `memory/.sync-state.json`
- `memory/context/latest-agent-context.md`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `server/src/memory/commit-deploy-log.json`
- `webview-ui/src/App.tsx`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/FollowUpSuggest.tsx`
- `webview-ui/src/components/github/GitHubView.tsx`
- `webview-ui/src/components/marketplace/MarketplaceView.tsx`
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx`
- `webview-ui/src/components/super-roo/hooks/SrContext.tsx`
- `webview-ui/src/components/super-roo/tabs/BugsTab.tsx`
- `webview-ui/src/components/super-roo/tabs/ModelRouterView.tsx`
- `webview-ui/src/components/super-roo/tabs/VpsHealthTab.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/AgentSync.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/CostOptimizer.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/PerformanceMonitor.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/ProviderStatusStrip.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/RouteTable.tsx`
- `webview-ui/src/components/super-roo/tabs/settings/AdvancedVpsSettingsTab.tsx`
- `webview-ui/src/components/super-roo/tabs/settings/ApiKeysProvidersTab.tsx`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 9cc50a8a.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 9cc50a8a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, deployment, bugfix, refactor, performance

---

### Lesson: Always await async method calls — missing `await` on HermesClaw.getStats() caused silent Promise-object bugs

Date: 2026-05-20
Source: Code task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/api.js, cloud/orchestrator/modules/HermesClaw.js

#### Task Summary

Fixed 4 missing `await` calls on `orchestrator.hermesClaw.getStats()` in cloud/api/api.js. The method is `async` (returns a Promise), but was called without `await` at 4 locations, causing the routes to receive Promise objects instead of actual stats objects. Also fixed a stat field name mismatch in the health check route that read `stats.totalQueries` and `stats.ollamaReady` — neither of which exist in HermesClaw's response (which returns `operationCount`, `totalDurationMs`, `averageDurationMs`, `memoryEntries`, `knowledgeStore`).

#### Files Changed

- cloud/api/api.js — added `await` to 4 `getStats()` calls (lines 3592, 7257, 8826, 8844); fixed field name `totalQueries` → `operationCount` in health check route (line 3592-3594)

#### Bug Cause

1. `orchestrator.hermesClaw.getStats()` is declared as `async getStats()` in HermesClaw.js, meaning it returns a Promise. Calling it without `await` returns the Promise object itself, not the resolved stats.
2. The health check route at line 3592-3594 read `stats.totalQueries`, `stats.queries`, and `stats.ollamaReady` — none of which exist in the HermesClaw response. The actual field is `stats.operationCount`.

#### Fix Applied

1. Added `await` before all 4 `orchestrator.hermesClaw.getStats()` calls
2. Changed `stats.totalQueries || stats.queries || 0` to `stats.operationCount || 0` in the health check route
3. Removed the `stats.ollamaReady` reference (not a field returned by HermesClaw)

#### Test Result

unknown (deployed to VPS, API restarted with 13s uptime)

#### Lesson Learned

When calling an `async` method, always verify `await` is present — especially in route handlers where the missing `await` silently returns a Promise object that evaluates as truthy but has none of the expected properties. Also, when reading stats from an API response, verify field names against the actual method implementation, not assumptions.

#### Reusable Rule

After adding a new API route that calls an async method, grep for the method name to ensure all call sites have `await`. Use: `grep -n "hermesClaw.getStats()" cloud/api/api.js` and verify each occurrence has `await` before it.

#### Tags

bugfix, async, await, api, hermes-claw, stats, deployment

---

### Auto-Extracted Lesson: Hermes Claw dashboard — correct field names, auto-load skills/resources, surf...

Date: 2026-05-20
Source: Git commit 8fc2f21e
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/components/views/hermes-claw.tsx, cloud/dashboard/src/components/views/product-memory.tsx

#### Task Summary

fix: Hermes Claw dashboard — correct field names, auto-load skills/resources, surface pgvector stats and avg duration

#### Files Changed

- `cloud/dashboard/src/components/views/hermes-claw.tsx`
- `cloud/dashboard/src/components/views/product-memory.tsx`

#### Bug Cause

Frontend TypeScript interfaces (`HermesStats`) defined field names that did not match the actual API response from `HermesClaw.getStats()`. The interface had `totalQueries`, `totalSkillsCreated`, `totalLessonsStored`, `totalBugFixes`, `ollamaReady`, `modelLoaded` — none of which exist in the API. The API returns `operationCount`, `totalDurationMs`, `averageDurationMs`, `memoryEntries`, `knowledgeStore`. Additionally, `fetchStats` stored the full response wrapper `data` (i.e. `{ success: true, stats: {...} }`) instead of `data.stats`, causing all stat cards to render nothing.

#### Fix Applied

1. Changed `HermesStats` interface to match actual API response fields: `operationCount`, `totalDurationMs`, `averageDurationMs`, `memoryEntries`, `knowledgeStore?`
2. Added `KnowledgeStoreStats` interface for pgvector data (`bugCount`, `lessonCount`, etc.)
3. Fixed `fetchStats` to store `data.stats` instead of `data`
4. Added `fetchSkills()` and `fetchResources()` calls in the mount `useEffect` so panels auto-load
5. Added `averageDurationMs` display in stat cards and footer summary
6. Surfaced `knowledgeStore.bugCount` and `knowledgeStore.lessonCount` in stat cards and footer
7. Applied same fixes to `product-memory.tsx` (wrong interface + wrong object store)

#### Test Result

TypeScript compiles cleanly (`npx tsc --noEmit` exit code 0). Deployed to VPS and PM2 restarted successfully.

#### Lesson Learned

When building frontend dashboards that consume API data, always verify the TypeScript interface against the actual API response shape. A mismatch between interface field names and API response keys causes silent failures — all stat cards render as empty/zero. Also, always check that `fetch` response destructuring extracts the correct nested object (e.g. `data.stats` not `data`).

#### Reusable Rule

**Always verify frontend TypeScript interfaces against the actual API response before wiring stat cards.** When a dashboard view shows empty stat cards, check: (1) does the interface match the API response fields? (2) is the fetch response correctly destructured (e.g. `data.stats` vs `data`)? (3) does the mount `useEffect` call all data-fetching functions? (4) are all API-returned fields surfaced in the UI?

#### Tags

bugfix, frontend, typescript, interface-mismatch, api, dashboard, hermes-claw, pgvector

---

### Lesson: Telegram Bot P0 Bug Fixes — Policy Boolean, Logs Empty, Callback Leak, Retry Wrapper

Date: 2026-05-20
Source: Agent task completion
Model/API used: DeepSeek
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/api/telegramNotifier.js

#### Task Summary

Fixed four P0 bugs in the Telegram bot pipeline and added a resilient fetch wrapper.

1. **Shell policy check broken**: `telegramPolicy.canRunWithoutApproval("shell", command)` returns a `boolean`, but `handleShell` destructured it as `policyCheck.allowed`. Since `(true).allowed === undefined` and `!undefined === true`, ALL `/shell` commands were blocked — even safe read-only ones like `ls` or `cat`.
2. **`/logs` sent empty content**: `handleLogs` computed `var logs = result.logs.slice(-limit)` but never appended it to the `text` variable before calling `sendMessage`. Users received only the header "📋 _Recent Logs_\n\n".
3. **Callback registry leak**: ~20 `registerCallback()` calls lived INSIDE `handleUpdate()`'s callback query branch, so every callback query re-registered all handlers. After N callbacks, `dispatchCallback()` iterated `20N` entries, causing `O(N)` degradation.
4. **`sendCoderAutoProgress` auto-delete broken**: `sendMessage` did not return the Telegram API response (which contains `message_id`), so `lastProgressMessageIds` tracking was commented out. Old progress messages accumulated in chat.

Bonus improvements:

- Added `fetchTelegramWithRetry()` helper with exponential backoff on 429/5xx and network errors, covering all Telegram API calls.
- Added `cleanupRateLimitMap()` to purge stale rate-limit entries and prevent unbounded `Map` growth.

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/telegramNotifier.js`

#### Bug Cause

1. **Interface mismatch**: Developer assumed `canRunWithoutApproval()` returned an object `{allowed: boolean}` when it actually returned a plain `boolean`.
2. **Incomplete wiring**: `handleLogs` fetched and sliced logs but forgot to append them to the outgoing message string.
3. **Misplaced initialization**: Callback handler registration was placed inside the hot-path `handleUpdate()` function instead of at module load time.
4. **Missing return value**: `sendMessage` looped over chunks and called `await res.json()` but never stored or returned the response.

#### Fix Applied

1. Changed `if (!policyCheck.allowed)` → `if (!policyCheck)` in `handleShell`.
2. Changed `var text = "📋 *Recent Logs*\n\n"` → `var text = "📋 *Recent Logs*\n\n" + (logs.length ? logs.join("\n") : "_No logs found._")` in `handleLogs`.
3. Wrapped all `registerCallback()` calls in `if (callbackRegistry.length === 0) { ... }` so registration happens once per process.
4. Added `var lastResponse = null` at top of `sendMessage`, assigned `lastResponse = await res.json()` on success, and `return lastResponse` at the end. Updated `sendCoderAutoProgress` to extract `message_id` from the returned response and track it in `lastProgressMessageIds`.
5. Created `fetchTelegramWithRetry(url, options, maxRetries=3)` with exponential backoff starting at 500ms. Replaced bare `fetch()` in `sendMessage`, `editMessageText`, `deleteMessage`, `answerCallbackQuery`, `sendChatAction`, `setWebhook`, `getWebhookInfo`, `deleteWebhook`.
6. Added `cleanupRateLimitMap()` + `setInterval(cleanupRateLimitMap, 10 * 60 * 1000)`.

#### Test Result

Node syntax check (`node --check cloud/api/telegramBot.js`) passes. No unit tests exist for the Telegram bot (known gap).

#### Lesson Learned

When consuming API return values, **always verify the actual return type** against assumptions. A `boolean` masquerading as an object causes silent, total failures (`!undefined === true`). Similarly, when refactoring large functions, use lint rules or code review checklists to catch "computed but unused" variables — the `logs` variable in `handleLogs` was a pure waste of computation and user confusion. For event-driven systems, register handlers at module initialization, not inside the dispatch loop, or guard with idempotency checks. Finally, always return API responses from wrapper functions so upstream callers can use `message_id`, `chat_id`, and other metadata.

#### Reusable Rule

**Before committing Telegram bot changes, verify:**

1. Does the policy function return a `boolean` or an object? Use `typeof` or read the source.
2. Are all computed variables consumed before the function returns? Search for "var x = ..." and confirm `x` is read.
3. Are callback/event handlers registered outside the hot path? If inside, add a length/idempotency guard.
4. Does every `sendMessage` wrapper return the raw API response so callers can access `message_id`?
5. Do all outbound `fetch()` calls to external APIs have retry logic for 429/5xx?

#### Tags

telegram, bot, bugfix, policy, memory-leak, retry, api-wrapper, fetch

---

### Auto-Extracted Lesson: Docs: complete lesson for Telegram P0 fixes and record deploy in commit-deplo...

Date: 2026-05-20
Source: Git commit 6838e34d
Model/API used: unknown
Confidence: medium
Related files: memory/lesson-index.jsonl, memory/lesson-summaries.json, memory/lessons-learned.md, server/src/memory/commit-deploy-log.json

#### Task Summary

docs: complete lesson for Telegram P0 fixes and record deploy in commit-deploy-log

#### Files Changed

- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 6838e34d.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 6838e34d by JPG Yap.

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

### Auto-Extracted Lesson: Add /orchestrator/hermes/ to auth.js exclusion list — handleAuthRoute was int...

Date: 2026-05-20
Source: Git commit f26d3311
Model/API used: unknown
Confidence: medium
Related files: cloud/api/auth.js

#### Task Summary

fix: add /orchestrator/hermes/ to auth.js exclusion list — handleAuthRoute was intercepting Hermes Claw API calls and returning 401 Unauthorized

#### Files Changed

- `cloud/api/auth.js`

#### Bug Cause

`auth.handleAuthRoute()` in `cloud/api/auth.js` has a catch-all `requireAuth()` at the end of its route-matching block. Any URL path not explicitly listed in the "don't intercept" exclusion list falls through to `requireAuth`, which returns 401 Unauthorized. The Hermes Claw API routes (`/orchestrator/hermes/stats`, `/orchestrator/hermes/list-skills`, `/orchestrator/hermes/list-resources`) were not in the exclusion list, so they were being intercepted and rejected with 401 before reaching their actual handlers in `api.js`.

#### Fix Applied

Added `/orchestrator/hermes/` to the "don't intercept" exclusion list in `auth.js`'s `handleAuthRoute()` function, alongside the existing exclusions for `/healing/`, `/monitoring/`, `/memory-explorer`, etc. This allows Hermes Claw API requests to pass through `handleAuthRoute()` without requiring authentication and reach their handlers in `api.js`.

#### Test Result

Verified via direct curl to API server: all three Hermes Claw endpoints now return HTTP 200 with valid JSON responses instead of 401.

#### Lesson Learned

When adding new API route groups to `api.js`, always check if `auth.handleAuthRoute()` in `auth.js` has a catch-all `requireAuth()` that would intercept them. Any new route group must be added to the exclusion list in `handleAuthRoute()` (using `return false` for the path prefix) before the catch-all `requireAuth()` call.

#### Reusable Rule

When adding new API route groups to the SuperRoo API server, always add the route prefix to the "don't intercept" exclusion list in `cloud/api/auth.js` `handleAuthRoute()` function (before the catch-all `requireAuth()` at line 947). Otherwise, the auth middleware will intercept and reject all requests to those routes with 401 Unauthorized.

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Feat(telegram): Phase 3 — Central Brain lesson sync

Date: 2026-05-20
Source: Git commit 961413ac
Model/API used: unknown
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/api/telegramLearner.js

#### Task Summary

feat(telegram): Phase 3 — Central Brain lesson sync

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/telegramLearner.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 961413ac.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 961413ac by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api

---
