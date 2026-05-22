# Latest Agent Context

Generated: 2026-05-22T00:50:58.643Z
Task: fix all dashboard frontend backend disconnections - approvals ide-terminal skill-generator parallel-execution file-importer intelligence-layer hermes-claw ml-engine product-memory deploy-orchestrator debug-team overview task-timeline memory-explorer ram-orchestrator

## Relevant Lessons
1. **Advanced Features Gap Fix — 28 Gaps Across 9 Modules**
   - Rule: Before claiming a module has 'no tests', run `find src/MODULE -name '*.test.ts'` and check all subdirectories. The test coverage may be partial, not zero.
   - Why: Fixed all identified gaps in SuperRoo's advanced features across 9 modules: 4 dashboard views created, 4 API endpoints added, 186 tests added across 4 test files, 5 cross-module integrations wired, 5 documentation files written, 1 source bug fixed (MLSyncClient double re-queue on HTTP error).
2. **Complete Codex's Unfinished Learning Layer Release + Security Hardening**
   - Rule: When converting a hardcoded string to a runtime variable in JavaScript, always use a regex search for the exact old string value across the entire file to catch all string literal usages that need template literal interpolation.
   - Why: When env-var-izing hardcoded URLs, always search for ALL usages of the old value — including string concatenation and template literals. A variable declaration change without updating all consumers creates silent bugs that manifest as broken links in production.
3. **Comprehensive Gap Analysis and Full-Stack Improvement Execution**
   - Rule: Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.
   - Why: When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.
4. **Protected dashboard views must use authenticated fetches and canonical data sources**
   - Rule: For protected dashboard endpoints, reuse the authenticated request pattern already used elsewhere in the app, and point new views at the canonical backend data source rather than a one-off legacy file.
   - Why: A dashboard route can exist and still fail if the frontend omits the expected auth contract, reads from an obsolete source, or assumes request/data helpers that do not actually exist. Verify the whole integration boundary, not just file presence.
5. **Production deploys must keep source and dependency manifests in sync**
   - Rule: When production source files change together with dependencies, deploy the matching `package.json` and verify generated runtime artifacts exist before declaring recovery complete.
   - Why: Hotfixes can restore one failing layer while leaving another stale layer broken. For production recovery, validate the runtime artifact set as well as the source change, especially when a deploy spans both app code and dependency manifests.


## Active Codex Tasks
- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder
The SuperRoo system is organized into **21 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, cloud sandbox, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.
         │     ├── Repair Plan Builder (structured fix generation)
         │     └── Infinite Improvement Loop (continuous learning)
- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping
- **Features**: Incident detection, Root cause classification, Repair plan generation, Auto-fix deployment, Verification cycle
    - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation
### 10. Machine Learning Engine
- **Features**: Neural network training, Code pattern learning, Debug pattern learning, Test pattern learning, Infinite improvement loop
    - **Learners** ([`src/super-roo/ml/learning/`](../src/super-roo/ml/learning/)) - CodeLearner, DebugLearner, TestLearner
    > **IMPORTANT**: This is THE single source of truth for all commits and deployments across all coding agents. Every agent MUST use `CommitDeployLog.recordCommit()` and `CommitDeployLog.recordDeploy()` to record their work. The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change).
- **Features**: Autonomous multi-agent debugging, Complex feature problem solving, Phase-by-phase breakdown, Hypothesis-driven iteration, Safe container execution (Docker), Automatic git snapshot/rollback, Multi-feature integration sync, Auto-generated skills from failures, Auto-approval mode (all approvals auto-granted, all deployments auto-run), 24/7 unlimited iteration
- **Features**: GitHub Actions dispatch, VPS SSH deployment, Rollback management, Health check verification
    - **SandboxPool** ([`cloud/orchestrator/sandbox/SandboxPool.js`](../cloud/orchestrator/sandbox/SandboxPool.js)) - Container pooling with warm containers, idle cleanup, health checks with self-healing, acquire/release pattern
- **Features**: Provider API key management, Encrypted secret storage (AES-256-GCM), Real provider connection testing, Agent routing sync, VPS control center (auto-approve, MCP, guardrails), Deployment safety validation
    - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

### DeepSeek Architecture Summary

The dashboard frontend-backend disconnections affect the **Self-Healing Loop** (Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Fix → Verify), **Machine Learning Engine** (Learners for code/debug/test patterns), and **CommitDeployLog** (append-only, agent-aware source of truth for all commits/deployments). These modules connect through the **Healing Bus** for incident propagation, **Repair Plan Builder** for structured fix generation, and the **Infinite Improvement Loop** for continuous learning. Architecture constraints include: the CommitDeployLog is append-only with no deletions, all agents must use `recordCommit()`/`recordDeploy()`, and the Self-Healing Loop requires verification cycles before fixes are considered complete.


## Task Signals
Inferred tags: ui, learning, deployment

## Feature Knowledge
# feature-knowledge.md

Initialized by SuperRoo workflow check.



## Recent Bug Memory
# bugs-fixed.md

Initialized by SuperRoo workflow check.

---

## Legacy Bug Fixes Migrated — 2026-05-17

### Legacy Lesson: Safe JSON Parsing in Database Registries

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/bugs/BugRegistry.ts, src/super-roo/queue/TaskQueue.ts, src/super-roo/features/FeatureRegistry.ts, src/super-roo/memory/MemoryStore.ts, src/super-roo/healing/HealingBus.ts

#### Task Summary

Fixed critical bug where multiple registry modules use `JSON.parse()` without safe fallback, causing crashes on corrupted database rows.

#### Files Changed

- `src/super-roo/bugs/BugRegistry.ts` — Added safeJsonParse helper (line 42-46, 103)
- `src/super-roo/queue/TaskQueue.ts` — Added safeJsonParse helper (line 58-59)
- `src/super-roo/features/FeatureRegistry.ts` — Added safeJsonParse helper (line 48-50)
- `src/super-roo/memory/MemoryStore.ts` — Added safeJsonParse helper (line 310-311, 387)
- `src/super-roo/healing/HealingBus.ts` — Already had safeJsonParse, enhanced usage

#### Bug Cause

If database rows contain malformed JSON (due to corruption, manual edits, or migration bugs), `JSON.parse()` will throw uncaught `SyntaxError`, crashing the registry method and potentially the calling agent.

#### Fix Applied

Implemented `safeJsonParse<T>(json, fallback)` helper function that:

- Wraps JSON.parse in try/catch
- Returns fallback value on parse failure
- Applied consistently across all registry modules
- HealingBus already used this pattern; extended to other registries

### DeepSeek Bug Memory Summary

The primary bug pattern is unsafe `JSON.parse()` usage across multiple registry and queue modules (`BugRegistry.ts`, `TaskQueue.ts`, `FeatureRegistry.ts`, `MemoryStore.ts`), causing crashes on corrupted database rows. The root cause is a lack of fallback handling for malformed JSON data. The fix involves adding a `safeJsonParse` helper function to each affected file, with `HealingBus.ts` already having the helper and receiving enhanced usage.


## Model Decisions
# model-decisions.md

Initialized by SuperRoo workflow check.

---

## Legacy Model/API Decisions Migrated — 2026-05-17

### Legacy Lesson: Model Router Task-Based Routing

Date: 2026-05-08
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/settings/services/modelRouterService.ts

#### Task Summary

Implemented model routing service that maps task types to optimal provider/model pairs based on cost, quality, and speed tradeoffs.

#### Files Changed

- `src/super-roo/settings/services/modelRouterService.ts`

#### Decision Made

Created routing table with primary and fallback providers:

| Task Type    | Primary Provider | Primary Model            | Fallback 1 | Fallback 2               |
| ------------ | ---------------- | ------------------------ | ---------- | ------------------------ |
| coding       | anthropic        | claude-sonnet-4-20250514 | deepseek   | deepseek-chat            |
| debugging    | deepseek         | deepseek-chat            | anthropic  | claude-sonnet-4-20250514 |
| crawling     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |
| planning     | anthropic        | claude-sonnet-4-20250514 | openai     | gpt-4o                   |
| architecture | openai           | gpt-4o                   | anthropic  | claude-sonnet-4-20250514 |
| fast_fix     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |

#### Rationale

- Claude excels at coding and planning tasks

### DeepSeek Model Decision Summary

For the dashboard disconnection fixes, the key decision was to use **kimi-k2.5** for the model router service, chosen for its optimal balance of cost, quality, and speed. This model powers the task-based routing logic in `modelRouterService.ts`, which maps task types to provider/model pairs to handle the diverse components (e.g., approvals, file-importer, ml-engine). The high-confidence migration ensures consistent, efficient routing across all listed modules.



### DeepSeek File Summaries

- **cloud\dashboard\src\components\views\parallel-execution.tsx**: This file exports a single React component `ParallelExecutionView` that displays real-time parallel execution statistics from the backend API endpoint `/api/orchestrator/parallel/stats`. It fetches stats on mount and polls every 10 seconds, mapping the backend response shape to a `ParallelStats` interface with fields like `maxConcurrency`, `activeTasks`, and `tokenBudgetRemaining`. The component handles loading, error (with retry button), and data states, using utility functions like `formatToken` and UI primitives (`StatCard`, `Badge`, `cn`) consistent with the dashboard's pattern.
- **cloud\dashboard\src\components\views\autonomous-loop.tsx**: This file exports the `AutonomousLoopView` component, which provides a real-time dashboard for monitoring and controlling an autonomous CI/CD pipeline. It fetches status from `/api/autonomous/status` every 5 seconds and allows starting/stopping the loop via POST requests to `/api/autonomous/start` and `/api/autonomous/stop`. Key patterns include polling with `setInterval`, optimistic UI updates after actions, and a structured status object with step results, cycle count, and timestamps—critical for debugging disconnections between the frontend and backend APIs.

