# lessons-learned.md

Initialized by SuperRoo workflow check.

---

## Legacy Lessons Migrated — 2026-05-17

### Legacy Lesson: Safe JSON Parsing in Database Registries

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/bugs/BugRegistry.ts, src/super-roo/queue/TaskQueue.ts, src/super-roo/features/FeatureRegistry.ts, src/super-roo/memory/MemoryStore.ts, src/super-roo/healing/HealingBus.ts

#### Task Summary

Identified critical bug where multiple registry modules use `JSON.parse()` without safe fallback, causing crashes on corrupted database rows.

#### Files Changed

- `src/super-roo/bugs/BugRegistry.ts` — Added safeJsonParse helper
- `src/super-roo/queue/TaskQueue.ts` — Added safeJsonParse helper
- `src/super-roo/features/FeatureRegistry.ts` — Added safeJsonParse helper
- `src/super-roo/memory/MemoryStore.ts` — Added safeJsonParse helper
- `src/super-roo/healing/HealingBus.ts` — Already had safeJsonParse, enhanced usage

#### Bug Cause

Database rows containing malformed JSON (due to corruption, manual edits, or migration bugs) would cause `JSON.parse()` to throw uncaught `SyntaxError`, crashing the registry method and potentially the calling agent.

#### Fix Applied

Implemented `safeJsonParse<T>(json, fallback)` helper pattern across all registries. HealingBus already used this pattern; extended it to BugRegistry, TaskQueue, FeatureRegistry, and MemoryStore.

#### Test Result

Unknown — migrated from legacy Roo Code history. The bug testing plan documented this as a critical fix needed.

#### Lesson Learned

Always use safe JSON parsing with fallback values when reading from persistent storage. Database corruption can happen at any time; code should be resilient.

#### Reusable Rule

**All registry modules MUST use safeJsonParse() instead of raw JSON.parse() when reading from database.**

#### Tags

memory, database, json, error-handling, superroo-core

---

### Legacy Lesson: Tensor Division by Zero Protection

Date: 2026-04-30
Source: Roo Code legacy session  
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/engine/Tensor.ts

#### Task Summary

Identified ML engine bug where `Tensor.div(0)` returns Infinity values that silently corrupt neural network training.

#### Files Changed

- `src/super-roo/ml/engine/Tensor.ts` — Added division-by-zero guards

#### Bug Cause

`Tensor.div(0)` returns a tensor full of `Infinity` values. Since there's no validation, this can silently propagate through neural network training, corrupting weights and causing the optimizer to produce `NaN`.

#### Fix Applied

Added guard against division by zero with appropriate epsilon values to prevent silent corruption.

#### Test Result

Unknown — migrated from legacy Roo Code history.

#### Lesson Learned

ML operations must validate inputs and prevent silent propagation of Infinity/NaN values. Silent failures in training loops waste compute and produce invalid models.

#### Reusable Rule

**All Tensor mathematical operations MUST validate for edge cases (division by zero, sqrt of negative, log of non-positive) and either throw or clamp to safe values.**

#### Tags

ml-engine, tensor, neural-network, math, validation

---

### Legacy Lesson: Intent-to-Agent Routing Fix

Date: 2026-05-10
Source: Roo Code legacy session
Model/API used: unknown
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/worker/orchestratorWorker.js

#### Task Summary

Fixed critical routing bug where natural language "fix" requests were routed to debugger agent instead of coder agent.

#### Files Changed

- Intent classifier configuration
- Telegram orchestrator bridge

#### Bug Cause

The NLP intent classifier was routing natural language coding requests like "fix the login bug" to the debug_plan agent instead of the coder agent. This caused a mismatch between user intent and actual execution.

#### Fix Applied

Updated classifier routing logic to properly map 'coding' intents to the coder agent. Added feedback loop for classifier improvements.

#### Test Result

Verified working in production — coding requests now properly routed to coder agent.

#### Lesson Learned

Intent classification must be continuously validated against actual outcomes. Routing mismatches cause user frustration and wasted compute cycles.

#### Reusable Rule

**Always verify intent-to-agent routing with real user queries. Add classifier feedback loops to detect and correct routing errors.**

#### Tags

telegram, nlp, routing, classifier, orchestration

---

### Legacy Lesson: Webview Hydration Recovery

Date: 2026-05-17
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: webview-ui/src/App.tsx, webview-ui/src/context/ExtensionStateContext.tsx

#### Task Summary

Fixed webview recovery after missed hydration handshake between VS Code extension and webview UI.

#### Files Changed

- `webview-ui/src/App.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `webview-ui/src/__tests__/App.spec.tsx`
- `webview-ui/src/context/__tests__/ExtensionStateContext.spec.tsx`

#### Bug Cause

Webview could get stuck in a state where it missed the initial hydration handshake from the extension, leaving the UI non-responsive or showing stale data.

#### Fix Applied

Implemented recovery mechanism that detects missed hydration and re-requests state from the extension. Added timeout-based recovery.

#### Test Result

Tests added and passing.

#### Lesson Learned

Webview/extension communication is unreliable. Always implement recovery mechanisms for missed handshakes and state synchronization.

#### Reusable Rule

**Implement timeout-based hydration recovery in all webview contexts. Never assume initial state sync succeeds.**

#### Tags

webview, vscode-extension, hydration, state-sync, ui

---

### Legacy Lesson: PM2 Process Name Mapping

Date: 2026-05-09
Source: Roo Code legacy session
Model/API used: unknown
Confidence: medium
Related files: cloud/api/lib/terminalCore.js, cloud/worker/agentRunners.js

#### Task Summary

Fixed PM2 process name mapping issue where short names like 'api', 'worker', 'dashboard' didn't map to actual PM2 process names with 'superroo-' prefix.

#### Files Changed

- Terminal core readLogs function
- Worker restart function

#### Bug Cause

Users would reference processes by short names but PM2 used full prefixed names. This caused "process not found" errors when trying to read logs or restart workers.

#### Fix Applied

Added mapping logic to convert short names to full PM2 process names before executing PM2 commands.

#### Test Result

Verified working in production.

#### Lesson Learned

External tool naming conventions (like PM2) may not match internal abstractions. Always normalize names at integration boundaries.

#### Reusable Rule

**Create explicit name mapping layers between internal abstractions and external tool naming conventions.**

#### Tags

pm2, deployment, process-management, terminal

---

### Legacy Lesson: Docker Build Context Dependencies

Date: 2026-05-08
Source: Roo Code legacy session
Model/API used: unknown
Confidence: high
Related files: cloud/sandbox/Dockerfile, cloud/deploy-sandbox.sh

#### Task Summary

Fixed Docker build failures due to missing workspace package.json files in build context and pnpm resolution issues.

#### Files Changed

- Dockerfile (added missing workspace deps)
- Deploy scripts (added --shamefully-hoist flag)
- Build context configuration

#### Bug Cause

Docker build was failing because:

1. Missing workspace package.json files in build context
2. pnpm strict resolution couldn't find transitive dependencies
3. esbuild linux binary not installed due to --no-optional flag

#### Fix Applied

- Added all workspace package.json files to Docker build context
- Used --shamefully-hoist for transitive dependency resolution
- Removed --no-optional flag to ensure esbuild binary available
- Added --ignore-scripts to skip bootstrap in Docker

#### Test Result

Docker builds now succeeding consistently.

#### Lesson Learned

Docker builds with monorepos require careful handling of workspace dependencies. pnpm's strict resolution needs explicit configuration in containerized environments.

#### Reusable Rule

**For monorepo Docker builds: include all workspace package.json files, use --shamefully-hoist, and ensure platform-specific binaries are available.**

#### Tags

docker, pnpm, monorepo, build, deployment

---

### Legacy Lesson: Tailscale SSH Deployment Standard

Date: 2026-05-08
Source: Roo Code legacy session (AGENTS.md rule)
Model/API used: unknown
Confidence: high
Related files: docs/super-roo/DEPLOYMENT_GUIDE.md, .roo/skills/tailscale/SKILL.md

#### Task Summary

Established mandatory Tailscale SSH for all deployments instead of public IP SSH.

#### Files Changed

- Deployment documentation
- Deploy scripts
- All SSH-based deployment automation

#### Bug Cause

Security risk from using public IP for SSH connections. Some deployment scripts were incorrectly using public IPs.

#### Fix Applied

Mandated Tailscale IP (100.64.175.88) for all SSH connections. Updated all deploy scripts and documentation.

#### Test Result

All deployments now use Tailscale SSH exclusively.

#### Lesson Learned

Security practices must be enforced at the tooling level, not just documented. Automated systems will fall back to insecure defaults without explicit constraints.

#### Reusable Rule

**ALL deployments MUST use Tailscale SSH (100.64.175.88). Never use public IP (104.248.225.250) for SSH.**

#### Tags

deployment, security, tailscale, ssh, vps

---

### Legacy Lesson: CommitDeployLog as Single Source of Truth

Date: 2026-05-08
Source: Roo Code legacy session (AGENTS.md rule)
Model/API used: unknown
Confidence: high
Related files: src/super-roo/product-memory/CommitDeployLog.ts, server/src/memory/commit-deploy-log.json

#### Task Summary

Established centralized logging system for all commits and deployments across all coding agents.

#### Files Changed

- `src/super-roo/product-memory/CommitDeployLog.ts` (new)
- `server/src/memory/commit-deploy-log.json` (persistent storage)
- AGENTS.md (documentation)

#### Bug Cause

No centralized tracking of which agent made which changes, making it difficult to coordinate work and prevent conflicts.

#### Fix Applied

Created CommitDeployLog class that:

- Records every commit with agent name, type, files changed, features affected
- Records every deploy with status, health checks, rollbacks
- Is append-only (no deletions, only status updates)
- Is agent-aware and feature-linked

#### Test Result

Successfully tracking all commits and deploys across agents.

#### Lesson Learned

Multi-agent systems require centralized coordination logs. Without them, agents duplicate work and create conflicts.

#### Reusable Rule

**ALL agents MUST call CommitDeployLog.recordCommit() after making changes and CommitDeployLog.recordDeploy() when deploying.**

#### Tags

memory, coordination, agents, deployment, logging

---

### Legacy Lesson: Settings View cachedState Pattern

Date: 2026-05-01
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: webview-ui/src/components/settings/SettingsView.tsx

#### Task Summary

Fixed race conditions in settings by ensuring inputs bind to cachedState, not live extension state.

#### Files Changed

- Settings view components

#### Bug Cause

Inputs were wired directly to live `useExtensionState()`, causing race conditions between user edits and ContextProxy updates.

#### Fix Applied

Inputs now bind to local `cachedState` which acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save".

#### Test Result

Race conditions eliminated in settings UI.

#### Lesson Learned

Live state bindings in React can cause race conditions with async updates. Use local cached state for form inputs, only sync on explicit save.

#### Reusable Rule

**SettingsView inputs MUST bind to local cachedState, NOT live useExtensionState(). Wire inputs directly to cachedState to prevent race conditions.**

#### Tags

vscode-extension, react, state-management, ui

---

### Legacy Lesson: SafeWriteJson for Atomic File Operations

Date: 2026-05-01
Source: Roo Code legacy session (.roo/rules-code/use-safeWriteJson.md)
Model/API used: unknown
Confidence: high
Related files: src/utils/safeWriteJson.ts

#### Task Summary

Enforced atomic JSON file writes to prevent data corruption.

#### Files Changed

- Created `src/utils/safeWriteJson.ts`
- Updated all file writing code to use safeWriteJson

#### Bug Cause

Using `JSON.stringify` with direct file writes can cause data corruption if the process crashes mid-write or if multiple writes happen concurrently.

#### Fix Applied

Created `safeWriteJson(filePath, data)` that:

- Uses atomic writes with locking
- Streams the write to minimize memory footprint
- Creates parent directories if necessary

#### Test Result

All file writes now use safeWriteJson.

#### Lesson Learned

File writes can fail or corrupt data. Always use atomic write patterns for critical data files.

#### Reusable Rule

**MUST use safeWriteJson(filePath, data) from src/utils/safeWriteJson.ts instead of JSON.stringify with file-write operations.**

#### Tags

file-system, json, safety, data-integrity

---

### Legacy Lesson: Model Router Service Task Routing

Date: 2026-05-08
Source: Roo Code legacy session
Model/API used: unknown
Confidence: high
Related files: src/super-roo/settings/services/modelRouterService.ts

#### Task Summary

Implemented model routing service that maps task types to optimal provider/model pairs.

#### Files Changed

- `src/super-roo/settings/services/modelRouterService.ts` (new)

#### Implementation

Created routing table mapping tasks to primary/fallback providers:

- coding → anthropic/claude-sonnet, deepseek/deepseek-chat, openai/gpt-4o
- debugging → deepseek, anthropic, kimi
- crawling → groq, deepseek, kimi
- planning → anthropic, openai, deepseek
- architecture → openai, anthropic, kimi
- fast_fix → groq, deepseek, openai

#### Lesson Learned

Different AI providers excel at different task types. A routing layer improves both cost-efficiency and output quality.

#### Reusable Rule

**Use the Model Router for all AI calls. Route by task type, not just by user preference. Always have fallback providers configured.**

#### Tags

model-router, ai-providers, cost-optimization, routing

---

### Legacy Lesson: ML Loop NaN Loss Detection

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/loop/InfiniteImprovementLoop.ts

#### Task Summary

Enhanced ML training loop to detect and handle NaN losses that indicate model corruption.

#### Files Changed

- `src/super-roo/ml/loop/InfiniteImprovementLoop.ts`

#### Bug Cause

When all training losses are NaN (indicating corrupted models), the loop would warn but continue training, wasting compute cycles.

#### Fix Applied

Added detection for all-NaN loss arrays and proper handling (stopping training, warning with actionable message).

#### Test Result

Unknown — migrated from legacy Roo Code history.

#### Lesson Learned

ML training must detect corruption early and stop rather than continuing with invalid data. NaN propagation invalidates all downstream results.

#### Reusable Rule

**InfiniteImprovementLoop MUST detect all-NaN loss arrays and stop training with a clear warning. Do not continue training on corrupted models.**

#### Tags

ml-engine, training, nan-detection, infinite-loop

---

### Legacy Lesson: Terminal Output Import Path Correction

Date: 2026-05-17
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx

#### Task Summary

Fixed incorrect import path for terminal output component.

#### Files Changed

- `webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx`

#### Bug Cause

Import path was incorrect, causing module resolution failure.

#### Fix Applied

Corrected import path to match actual file location.

#### Test Result

Build now succeeds.

#### Lesson Learned

Import paths must be verified after refactoring. Automated builds catch these, but only if CI is running.

#### Reusable Rule

**Always verify imports after moving files. Run build after refactoring to catch path errors.**

#### Tags

typescript, imports, build, refactoring

---

### Legacy Lesson: Context Condensation Pattern Preservation

Date: 2026-02-19 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: claude/anthropic (based on CHANGELOG author)
Confidence: medium
Related files: src/core/context-condensing/\*

#### Task Summary

Implemented Smart Code Folding that preserves lightweight code maps during context condensation.

#### Files Changed

- Context condensation system
- Context preservation logic

#### Implementation

Context condensation now intelligently preserves:

- Function signatures
- Class declarations
- Type definitions
- Files prioritized by recent access
- ~50k character budget for latest work

#### Lesson Learned

When condensing context for large conversations, preserve structural information (signatures, types) that the model needs to continue working accurately.

#### Reusable Rule

**Context condensation MUST preserve function signatures, class declarations, and type definitions. Prioritize by recency with a character budget.**

#### Tags

context-management, ai-context, condensation, memory

---

### Legacy Lesson: Auto-Retry on Empty Assistant Response

Date: 2026-01-27 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: unknown
Confidence: medium
Related files: src/core/task/Task.ts

#### Task Summary

Added auto-retry mechanism for empty assistant responses to prevent task failures.

#### Bug Cause

Some API providers occasionally return empty responses, which would previously fail the task.

#### Fix Applied

Implemented auto-retry with exponential backoff for empty responses.

#### Lesson Learned

APIs can return empty responses due to transient issues. Auto-retry with backoff improves reliability without user intervention.

#### Reusable Rule

**Implement auto-retry with exponential backoff for empty API responses. Log each retry attempt.**

#### Tags

api, retry-logic, error-handling, reliability

---

### Legacy Lesson: Terminal Output Buffer Memory Leak Fix

Date: 2026-02-20 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: unknown
Confidence: high
Related files: src/integrations/terminal/\*

#### Task Summary

Fixed memory leak in terminal output buffers that caused gray screens and performance degradation.

#### Bug Cause

Terminal output buffers were never cleared, accumulating unbounded memory usage over long sessions.

#### Fix Applied

Implemented buffer size limits with automatic cleanup of old output.

#### Test Result

Memory usage now stable during long sessions.

#### Lesson Learned

Long-running processes need bounded buffers. Unbounded growth leads to OOM and performance issues.

#### Reusable Rule

**All buffers MUST have size limits with automatic cleanup. Never allow unbounded memory growth.**

#### Tags

terminal, memory-leak, performance, buffer-management

---

### Legacy Lesson: Test Execution from Correct Directory

Date: 2026-05-01
Source: Roo Code legacy session (.roo/rules/rules.md)
Model/API used: unknown
Confidence: high
Related files: vitest.config.ts files

#### Task Summary

Established rule for running vitest from correct workspace directories.

#### Bug Cause

Running tests from project root caused "vitest: command not found" errors because vitest wasn't in root node_modules.

#### Fix Applied

Documented that tests must be run from the same directory as the package.json that specifies vitest in devDependencies.

#### Lesson Learned

Monorepos have multiple vitest installations. Tests must run from their local workspace context.

#### Reusable Rule

**Tests MUST be run from the same directory as the package.json that specifies vitest in devDependencies. Run: `cd src && npx vitest run path/to/test-file`**

#### Tags

testing, vitest, monorepo, build

---

### Legacy Lesson: Model Warmup for CLI Performance

Date: 2026-02-18 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: unknown
Confidence: medium
Related files: apps/cli/src/commands/cli/run.ts

#### Task Summary

Implemented model warmup on CLI startup for faster initial responses.

#### Implementation

CLI now warms up the Roo model on startup, reducing latency for first user request.

#### Lesson Learned

Cold starts affect user experience. Proactive warmup improves perceived performance.

#### Reusable Rule

**Warm up AI models on service startup to reduce cold start latency. Handle warmup failures gracefully.**

#### Tags

cli, performance, model-loading, user-experience

---

### Auto-Extracted Lesson: Feat(intelligence): migrate legacy Roo Code lessons and add enhancement system

Date: 2026-05-17
Source: Git commit 19ebf885
Model/API used: unknown
Confidence: medium
Related files: .github/workflows/lesson-extraction.yml, .husky/post-commit, docs/intelligence-layer/legacy-roocode-migration-report.md, memory/backups/2026-05-17-bugs-fixed.backup.md, memory/backups/2026-05-17-lessons-learned.backup.md

#### Task Summary

feat(intelligence): migrate legacy Roo Code lessons and add enhancement system

#### Files Changed

- `.github/workflows/lesson-extraction.yml`
- `.husky/post-commit`
- `docs/intelligence-layer/legacy-roocode-migration-report.md`
- `memory/backups/2026-05-17-bugs-fixed.backup.md`
- `memory/backups/2026-05-17-lessons-learned.backup.md`
- `memory/backups/2026-05-17-model-decisions.backup.md`
- `memory/bugs-fixed.md`
- `memory/central-brain-store-log.json`
- `memory/feature-knowledge.md`
- `memory/lesson-index.jsonl`
- `memory/lesson-summaries.json`
- `memory/lessons-learned.md`
- `memory/model-decisions.md`
- `scripts/central-brain-store-lesson.mjs`
- `scripts/extract-lesson-from-commit.mjs`
- `scripts/ollama-summarize-lesson.mjs`
- `scripts/run-migration-post-processing.sh`
- `src/super-roo/lessons/LessonRetriever.ts`
- `src/super-roo/lessons/PromptEnhancer.ts`
- `src/super-roo/lessons/index.ts`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 19ebf885.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 19ebf885 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

general

---

### Auto-Extracted Lesson: NL routing now passes goal+projectPath so coder intents trigger real coding

Date: 2026-05-17
Source: Git commit 45cebc23
Model/API used: unknown
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: NL routing now passes goal+projectPath so coder intents trigger real coding

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 45cebc23.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 45cebc23 by JPG Yap.

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

### Auto-Extracted Lesson: Feat: add DeepSeek-V4-Flash and DeepSeek-V4-Pro models with agent re-routing

Date: 2026-05-17
Source: Git commit 844c8b11
Model/API used: unknown
Confidence: medium
Related files: .roo/skills/deepseek-api/SKILL.md, cloud/api/api.js, cloud/api/telegramBot.js, docs/resources/deepseek-api.md, packages/types/src/providers/deepseek.ts

#### Task Summary

feat: add DeepSeek-V4-Flash and DeepSeek-V4-Pro models with agent re-routing

#### Files Changed

- `.roo/skills/deepseek-api/SKILL.md`
- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `docs/resources/deepseek-api.md`
- `packages/types/src/providers/deepseek.ts`
- `server/src/memory/commit-deploy-log.json`
- `server/src/memory/kimi.json`
- `src/super-roo/product-memory/WorkflowEnforcer.ts`
- `src/super-roo/settings/config/agentRouting.ts`
- `src/super-roo/settings/config/providers.ts`
- `src/super-roo/settings/services/modelRouter.ts`
- `src/super-roo/settings/services/modelRouterService.ts`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 844c8b11.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 844c8b11 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, deployment

---

### Auto-Extracted Lesson: Force shell intent for VPS queries, relax policy to allow non-blocked intents

Date: 2026-05-17
Source: Git commit 73ea276d
Model/API used: unknown
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/api/telegramPolicy.js

#### Task Summary

fix: force shell intent for VPS queries, relax policy to allow non-blocked intents

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/telegramPolicy.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 73ea276d.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 73ea276d by JPG Yap.

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

### Auto-Extracted Lesson: Feat: add Memory Explorer — engineering lessons database with search and tag ...

Date: 2026-05-17
Source: Git commit 0f0d446f
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/components/views/memory-explorer.tsx, memory/lessons.jsonl

#### Task Summary

feat: add Memory Explorer — engineering lessons database with search and tag filtering

#### Files Changed

- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/memory-explorer.tsx`
- `memory/lessons.jsonl`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 0f0d446f.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 0f0d446f by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

<!-- TODO: Extract reusable lesson -->

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

<!-- TODO: Define a specific rule for future agents -->

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

general

---

### Lesson: TOML Duplicate Table Key in Codex Config

Date: 2026-05-17
Source: Codex task completion
Model/API used: codex
Confidence: high
Related files: .codex/config.toml

#### Task Summary

Fixed a TOML parse error in `.codex/config.toml` where the `[commands]` table key was duplicated, preventing the Codex extension from starting chat.

#### Files Changed

- `.codex/config.toml`

#### Bug Cause

A second `[commands]` section was appended to the file (line 184) while the original section remained at line 104. TOML parsers reject duplicate table keys.

#### Fix Applied

Merged both `[commands]` sections into a single table, keeping all unique commands (read_lessons, find_lessons_for_file, find_lessons_for_task, check_compliance, check_compliance_since, verify_api_key, generate_compliance_report).

#### Test Result

Config file now parses correctly (verified by visual inspection).

#### Lesson Learned

When adding new configuration keys to TOML files, always check if the table already exists. Appending a duplicate `[table]` header will break parsing.

#### Reusable Rule

Before adding a new `[table]` section to any `.toml` config file, grep for existing instances of that table name and merge keys into the existing section rather than creating a duplicate.

#### Tags

toml, config, codex, duplicate-key, parsing

---

### Auto-Extracted Lesson: Tighten shell keyword detection, add /shell command, add page labels

Date: 2026-05-17 20:54:13 +0800
Source: Git commit 37ecd8df
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/**tests**/run-tests.js, cloud/api/**tests**/test-telegram-policy.test.js, cloud/api/telegramBot.js, cloud/api/telegramClassifier.js, cloud/api/telegramPolicy.js

#### Task Summary

fix: tighten shell keyword detection, add /shell command, add page labels

#### Files Changed

- `cloud/api/__tests__/run-tests.js`
- `cloud/api/__tests__/test-telegram-policy.test.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramClassifier.js`
- `cloud/api/telegramPolicy.js`
- `cloud/api/tgEndpoints.js`
- `cloud/dashboard/src/app/page.tsx`

#### Bug Cause

Unknown — extracted from commit 37ecd8df.

#### Fix Applied

See commit 37ecd8df by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, telegram, bugfix

---

### Auto-Extracted Lesson: Parse query params manually for native http server

Date: 2026-05-17 20:36:26 +0800
Source: Git commit 50c3bda6
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/routes/workflow-compliance.js

#### Task Summary

fix: parse query params manually for native http server

#### Files Changed

- `cloud/api/routes/workflow-compliance.js`

#### Bug Cause

Unknown — extracted from commit 50c3bda6.

#### Fix Applied

See commit 50c3bda6 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Replace Express-style res.json with sendJson for native http server

Date: 2026-05-17 20:34:11 +0800
Source: Git commit 47218fea
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/routes/workflow-compliance.js

#### Task Summary

fix: replace Express-style res.json with sendJson for native http server

#### Files Changed

- `cloud/api/routes/workflow-compliance.js`

#### Bug Cause

Unknown — extracted from commit 47218fea.

#### Fix Applied

See commit 47218fea by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Add workflow-compliance routes to auth bypass whitelist

Date: 2026-05-17 20:32:17 +0800
Source: Git commit 65b164eb
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/auth.js

#### Task Summary

fix: add workflow-compliance routes to auth bypass whitelist

#### Files Changed

- `cloud/api/auth.js`

#### Bug Cause

Unknown — extracted from commit 65b164eb.

#### Fix Applied

See commit 65b164eb by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Update workflow compliance view to use existing UI components

Date: 2026-05-17 20:24:51 +0800
Source: Git commit edff8d29
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/workflow-compliance.tsx

#### Task Summary

fix: update workflow compliance view to use existing UI components

#### Files Changed

- `cloud/dashboard/src/components/views/workflow-compliance.tsx`

#### Bug Cause

Unknown — extracted from commit edff8d29.

#### Fix Applied

See commit edff8d29 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Feat: add workflow compliance tracking system with DeepSeek delegation

Date: 2026-05-17 20:12:02 +0800
Source: Git commit c80b27a9
Model/API used: JPG Yap
Confidence: medium
Related files: .codex/config.toml, .mcp.json, AGENTS.md, cloud/api/api.js, cloud/api/auth.js

#### Task Summary

feat: add workflow compliance tracking system with DeepSeek delegation

#### Files Changed

- `.codex/config.toml`
- `.mcp.json`
- `AGENTS.md`
- `cloud/api/api.js`
- `cloud/api/auth.js`
- `cloud/api/routes/workflow-compliance.js`
- `cloud/api/telegramClassifier.js`
- `cloud/api/telegramEngineer.js`
- `cloud/api/telegramNotifier.js`
- `cloud/api/tgEndpoints.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/brain.tsx`
- `cloud/dashboard/src/components/views/commit-deploy.tsx`
- `cloud/dashboard/src/components/views/workflow-compliance.tsx`
- `cloud/ecosystem.config.js`
- `cloud/orchestrator/modules/CodexTaskLog.js`
- `cloud/orchestrator/modules/HermesClaw.js`
- `cloud/orchestrator/stores/BugKnowledgeStore.js`
- `cloud/sql/ollama-rag-schema.sql`
- `cloud/worker/agentRunners.js`
- `cloud/worker/worker.js`
- `commissioning/test-results.md`
- `console.log('ERR`
- `docs/agent-workflow/codex-deepseek-ollama.md`
- `docs/super-roo/CENTRAL_BRAIN.md`
- `docs/super-roo/WORKFLOW_COMPLIANCE_TRACKING.md`
- `docs/super-roo/ollama-activation.md`
- `docs/super-roo/ollama-prompts.md`
- `examples/workflow-tracking-integration.ts`
- `memory/lessons-learned.md`
- `packages/types/src/vscode-extension-host.ts`
- `packages/types/src/vscode.ts`
- `pnpm-lock.yaml`
- `scripts/check-workflow-compliance.mjs`
- `scripts/codex-deepseek-ollama-check.mjs`
- `scripts/deploy-intelligence-layer.ps1`
- `scripts/install-ollama-vps.sh`
- `scripts/mcp-client.js`
- `scripts/pull-ollama-models.sh`
- `scripts/test-dashboard-workflow.mjs`
- `scripts/test-deepseek-api.mjs`
- `server/src/memory/McpMemoryServer.ts`
- `server/src/memory/codextask.json`
- `server/src/memory/commit-deploy-log.json`
- `src/activate/registerCommands.ts`
- `src/core/webview/ClineProvider.ts`
- `src/core/webview/__tests__/ClineProvider.spec.ts`
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/package.json`
- `src/package.nls.json`
- `src/super-roo/cli/ollama-test.ts`
- `src/super-roo/ollama/CodexBriefBuilder.ts`
- `src/super-roo/ollama/ContextCompressor.ts`
- `src/super-roo/ollama/DeepSeekTaskBuilder.ts`
- `src/super-roo/ollama/LogSummarizer.ts`
- `src/super-roo/ollama/OllamaClient.ts`
- `src/super-roo/ollama/OllamaPipeline.ts`
- `src/super-roo/ollama/index.ts`
- `src/super-roo/product-memory/CommitDeployLog.ts`
- `src/super-roo/product-memory/ModelUsageTracker.ts`
- `src/super-roo/product-memory/WorkflowEnforcer.ts`
- `src/super-roo/product-memory/__tests__/ModelUsageTracker.test.ts`
- `src/super-roo/product-memory/__tests__/WorkflowEnforcer.test.ts`
- `src/super-roo/product-memory/index.ts`
- `src/super-roo/settings/routes/modelRouterRoutes.ts`
- `src/super-roo/settings/routes/providerRoutes.ts`
- `test-e2e-brain.sh`
- `tmp-check-dlq.js`
- `webview-ui/src/App.tsx`
- `webview-ui/src/__tests__/App.spec.tsx`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/super-roo/hooks/SrContext.tsx`
- `webview-ui/src/components/super-roo/messaging/protocol.ts`
- `webview-ui/src/components/super-roo/tabs/MemoryLogTab.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `{`

#### Bug Cause

Unknown — extracted from commit c80b27a9.

#### Fix Applied

See commit c80b27a9 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, deployment, telegram

---

### Auto-Extracted Lesson: Correct terminal output import path

Date: 2026-05-17 16:42:47 +0800
Source: Git commit 4c7da1fb
Model/API used: JPG Yap
Confidence: medium
Related files: webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx

#### Task Summary

fix: correct terminal output import path

#### Files Changed

- `webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx`

#### Bug Cause

Unknown — extracted from commit 4c7da1fb.

#### Fix Applied

See commit 4c7da1fb by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

ui, terminal, bugfix

---

### Auto-Extracted Lesson: Recover webview after missed hydration handshake

Date: 2026-05-17 16:40:30 +0800
Source: Git commit 86b94254
Model/API used: JPG Yap
Confidence: medium
Related files: webview-ui/src/App.tsx, webview-ui/src/**tests**/App.spec.tsx, webview-ui/src/context/ExtensionStateContext.tsx, webview-ui/src/context/**tests**/ExtensionStateContext.spec.tsx

#### Task Summary

fix: recover webview after missed hydration handshake

#### Files Changed

- `webview-ui/src/App.tsx`
- `webview-ui/src/__tests__/App.spec.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `webview-ui/src/context/__tests__/ExtensionStateContext.spec.tsx`

#### Bug Cause

Unknown — extracted from commit 86b94254.

#### Fix Applied

See commit 86b94254 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, bugfix

---

### Auto-Extracted Lesson: Add --no-verify to commit runner, increase timeouts, allow partial apply to p...

Date: 2026-05-17 01:41:47 +0800
Source: Git commit e904a14d
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/worker/agentRunners.js

#### Task Summary

fix: add --no-verify to commit runner, increase timeouts, allow partial apply to proceed

#### Files Changed

- `cloud/worker/agentRunners.js`

#### Bug Cause

Unknown — extracted from commit e904a14d.

#### Fix Applied

See commit e904a14d by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: NL routing now passes goal+projectPath so coder intents trigger real coding

Date: 2026-05-16 21:48:24 +0800
Source: Git commit c02038ad
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: NL routing now passes goal+projectPath so coder intents trigger real coding

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit c02038ad.

#### Fix Applied

See commit c02038ad by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Notify:status callback now uses correct /telegram/tasks/:id/status route

Date: 2026-05-16 21:37:50 +0800
Source: Git commit 1394dc63
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramNotifier.js

#### Task Summary

fix: notify:status callback now uses correct /telegram/tasks/:id/status route

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramNotifier.js`

#### Bug Cause

Unknown — extracted from commit 1394dc63.

#### Fix Applied

See commit 1394dc63 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Add defensive guard in handleMenuCallback, create orchestrator agent, suppres...

Date: 2026-05-16 20:51:39 +0800
Source: Git commit f4caa3be
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/agents/superroo-orchestrator-agent/agent.json, cloud/agents/superroo-orchestrator-agent/resources/orchestrator-checklist.md, cloud/agents/superroo-orchestrator-agent/skills/agent-routing.md, cloud/agents/superroo-orchestrator-agent/skills/result-aggregation.md, cloud/agents/superroo-orchestrator-agent/skills/task-decomposition.md

#### Task Summary

fix: add defensive guard in handleMenuCallback, create orchestrator agent, suppress LSP errors

#### Files Changed

- `cloud/agents/superroo-orchestrator-agent/agent.json`
- `cloud/agents/superroo-orchestrator-agent/resources/orchestrator-checklist.md`
- `cloud/agents/superroo-orchestrator-agent/skills/agent-routing.md`
- `cloud/agents/superroo-orchestrator-agent/skills/result-aggregation.md`
- `cloud/agents/superroo-orchestrator-agent/skills/task-decomposition.md`
- `cloud/agents/superroo-orchestrator-agent/workflows/orchestrate-task.md`
- `cloud/api/lsp-bridge.js`
- `cloud/api/telegramMenu.js`
- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

Unknown — extracted from commit f4caa3be.

#### Fix Applied

See commit f4caa3be by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, deployment, telegram, bugfix

---

### Auto-Extracted Lesson: Make cloud/api/lib/terminalCore.js self-contained with built-in TerminalBrain

Date: 2026-05-16 19:03:53 +0800
Source: Git commit 5d76dcc9
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/lib/terminalCore.js

#### Task Summary

fix: make cloud/api/lib/terminalCore.js self-contained with built-in TerminalBrain

#### Files Changed

- `cloud/api/lib/terminalCore.js`

#### Bug Cause

Unknown — extracted from commit 5d76dcc9.

#### Fix Applied

See commit 5d76dcc9 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, terminal, bugfix

---

### Auto-Extracted Lesson: Align handleMenuCallback signature with actual caller (telegramBot.js)

Date: 2026-05-16 18:57:41 +0800
Source: Git commit 8443a71b
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramMenu.js, cloud/test-telegram-intelligence.js

#### Task Summary

fix: align handleMenuCallback signature with actual caller (telegramBot.js)

#### Files Changed

- `cloud/api/telegramMenu.js`
- `cloud/test-telegram-intelligence.js`

#### Bug Cause

Unknown — extracted from commit 8443a71b.

#### Fix Applied

See commit 8443a71b by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, telegram, bugfix

---

### Auto-Extracted Lesson: Add @superroo/terminal-core dependency to cloud/package.json

Date: 2026-05-16 18:52:20 +0800
Source: Git commit b376fdfe
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/package.json

#### Task Summary

fix: add @superroo/terminal-core dependency to cloud/package.json

#### Files Changed

- `cloud/package.json`

#### Bug Cause

Unknown — extracted from commit b376fdfe.

#### Fix Applied

See commit b376fdfe by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Intent-to-agent routing bug - 'route to coder agent' was routed to debugger a...

Date: 2026-05-16 18:13:24 +0800
Source: Git commit 5a3b828f
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/api/telegramClassifier.js

#### Task Summary

fix: intent-to-agent routing bug - 'route to coder agent' was routed to debugger agent

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/telegramClassifier.js`

#### Bug Cause

Unknown — extracted from commit 5a3b828f.

#### Fix Applied

See commit 5a3b828f by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Wire up debug team end-to-end flow with proper notifications

Date: 2026-05-16 15:42:53 +0800
Source: Git commit b9f8d43a
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/worker/debugJobRunner.js, cloud/worker/worker.js

#### Task Summary

fix: wire up debug team end-to-end flow with proper notifications

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/worker/debugJobRunner.js`
- `cloud/worker/worker.js`

#### Bug Cause

Unknown — extracted from commit b9f8d43a.

#### Fix Applied

See commit b9f8d43a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Add Ollama fallback provider, classifier feedback, and improved askAI error m...

Date: 2026-05-16 14:54:28 +0800
Source: Git commit f950658e
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramBot.js, cloud/api/telegramClassifier.js

#### Task Summary

fix: add Ollama fallback provider, classifier feedback, and improved askAI error messages

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramClassifier.js`

#### Bug Cause

Unknown — extracted from commit f950658e.

#### Fix Applied

See commit f950658e by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Make TelegramOrchestratorBridge.createTask() async so .catch() works

Date: 2026-05-16 14:45:10 +0800
Source: Git commit f909deb5
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/orchestrator/TelegramOrchestratorBridge.js

#### Task Summary

fix: make TelegramOrchestratorBridge.createTask() async so .catch() works

#### Files Changed

- `cloud/orchestrator/TelegramOrchestratorBridge.js`

#### Bug Cause

Unknown — extracted from commit f909deb5.

#### Fix Applied

See commit f909deb5 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Classifier now routes 'fix' requests to coder instead of debug_plan

Date: 2026-05-16 14:09:38 +0800
Source: Git commit 19bd7280
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramClassifier.js

#### Task Summary

fix: classifier now routes 'fix' requests to coder instead of debug_plan

#### Files Changed

- `cloud/api/telegramClassifier.js`

#### Bug Cause

Unknown — extracted from commit 19bd7280.

#### Fix Applied

See commit 19bd7280 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Read_logs intent now replies with AI-analyzed natural language instead of raw...

Date: 2026-05-16 13:53:44 +0800
Source: Git commit 61ba0032
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: read_logs intent now replies with AI-analyzed natural language instead of raw log dump

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit 61ba0032.

#### Fix Applied

See commit 61ba0032 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Strip box-drawing chars from pm2 show log path regex

Date: 2026-05-16 13:45:20 +0800
Source: Git commit dcdccd40
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/tgEndpoints.js

#### Task Summary

fix: strip box-drawing chars from pm2 show log path regex

#### Files Changed

- `cloud/api/tgEndpoints.js`

#### Bug Cause

Unknown — extracted from commit dcdccd40.

#### Fix Applied

See commit dcdccd40 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Use tail -n syntax instead of tail -NUM for BusyBox compatibility

Date: 2026-05-16 13:40:07 +0800
Source: Git commit 9cd1608b
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/tgEndpoints.js

#### Task Summary

fix: use tail -n syntax instead of tail -NUM for BusyBox compatibility

#### Files Changed

- `cloud/api/tgEndpoints.js`

#### Bug Cause

Unknown — extracted from commit 9cd1608b.

#### Fix Applied

See commit 9cd1608b by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Docs: record NLP coder routing fix in CommitDeployLog

Date: 2026-05-16 13:33:47 +0800
Source: Git commit fdfd0199
Model/API used: JPG Yap
Confidence: medium
Related files: server/src/memory/commit-deploy-log.json

#### Task Summary

docs: record NLP coder routing fix in CommitDeployLog

#### Files Changed

- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

Unknown — extracted from commit fdfd0199.

#### Fix Applied

See commit fdfd0199 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Route natural language coding requests to coder agent instead of debugger

Date: 2026-05-16 13:32:26 +0800
Source: Git commit 1795dbee
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/api/telegramClassifier.js

#### Task Summary

fix: route natural language coding requests to coder agent instead of debugger

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/telegramClassifier.js`

#### Bug Cause

Unknown — extracted from commit 1795dbee.

#### Fix Applied

See commit 1795dbee by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Map short PM2 names (api, worker, dashboard) to superroo- prefixed names in r...

Date: 2026-05-16 13:25:06 +0800
Source: Git commit 08b8e8bf
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/tgEndpoints.js

#### Task Summary

fix: map short PM2 names (api, worker, dashboard) to superroo- prefixed names in readLogs and restartWorker

#### Files Changed

- `cloud/api/tgEndpoints.js`

#### Bug Cause

Unknown — extracted from commit 08b8e8bf.

#### Fix Applied

See commit 08b8e8bf by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Avoid duplicate shared telegram history writes

Date: 2026-05-16 13:12:09 +0800
Source: Git commit f0d7e846
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, server/src/memory/commit-deploy-log.json

#### Task Summary

fix: avoid duplicate shared telegram history writes

#### Files Changed

- `cloud/api/telegramBot.js`
- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

Unknown — extracted from commit f0d7e846.

#### Fix Applied

See commit f0d7e846 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, deployment, telegram, bugfix

---

### Auto-Extracted Lesson: Feat: add conversational history system with Telegram integration

Date: 2026-05-16 13:01:15 +0800
Source: Git commit 0c1a581b
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/**tests**/test-telegram-bot.test.js, cloud/api/api.js, cloud/api/telegramBot.js, cloud/api/telegramNotifier.js, src/super-roo/conversation-history/ConversationHistoryManager.ts

#### Task Summary

feat: add conversational history system with Telegram integration

#### Files Changed

- `cloud/api/__tests__/test-telegram-bot.test.js`
- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramNotifier.js`
- `src/super-roo/conversation-history/ConversationHistoryManager.ts`
- `src/super-roo/conversation-history/ConversationMonitorAgent.ts`
- `src/super-roo/conversation-history/TelegramConversationBridge.js`
- `src/super-roo/conversation-history/TelegramConversationBridge.ts`
- `src/super-roo/conversation-history/__tests__/ConversationHistoryManager.test.ts`
- `src/super-roo/conversation-history/index.ts`
- `src/super-roo/conversation-history/types.ts`

#### Bug Cause

Unknown — extracted from commit 0c1a581b.

#### Fix Applied

See commit 0c1a581b by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, telegram

---

### Auto-Extracted Lesson: Add auth token to Quick Actions fetch calls in overview dashboard

Date: 2026-05-16 12:30:38 +0800
Source: Git commit 185b38bd
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/overview.tsx

#### Task Summary

fix: add auth token to Quick Actions fetch calls in overview dashboard

#### Files Changed

- `cloud/dashboard/src/components/views/overview.tsx`

#### Bug Cause

Unknown — extracted from commit 185b38bd.

#### Fix Applied

See commit 185b38bd by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Wire overview dashboard Quick Actions and fix orchestrator route query params

Date: 2026-05-16 12:04:18 +0800
Source: Git commit c202230a
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: wire overview dashboard Quick Actions and fix orchestrator route query params

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit c202230a.

#### Fix Applied

See commit c202230a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Export splitLongMessage and set global.\_\_redisClient for Telegram mapping hea...

Date: 2026-05-16 11:28:41 +0800
Source: Git commit 550ea5ef
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramBot.js

#### Task Summary

fix: export splitLongMessage and set global.\_\_redisClient for Telegram mapping health check

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit 550ea5ef.

#### Fix Applied

See commit 550ea5ef by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Add Central Brain proxy route for /brain/\* requests (Cloud IDE terminal)

Date: 2026-05-16 11:24:22 +0800
Source: Git commit 3a10b4c0
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: add Central Brain proxy route for /brain/\* requests (Cloud IDE terminal)

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 3a10b4c0.

#### Fix Applied

See commit 3a10b4c0 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Extend session TTL to 24h and improve readLogs error handling

Date: 2026-05-16 11:08:13 +0800
Source: Git commit ee82bd90
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/api/tgEndpoints.js

#### Task Summary

fix: extend session TTL to 24h and improve readLogs error handling

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/api/tgEndpoints.js`

#### Bug Cause

Unknown — extracted from commit ee82bd90.

#### Fix Applied

See commit ee82bd90 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Wire Telegram coding flow end-to-end with Docker sandbox isolation

Date: 2026-05-15 23:19:54 +0800
Source: Git commit 1043f65a
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/telegramBot.js, cloud/api/telegramNotifier.js, cloud/worker/agentRunners.js, cloud/worker/coder-sandbox.js

#### Task Summary

fix: wire Telegram coding flow end-to-end with Docker sandbox isolation

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramNotifier.js`
- `cloud/worker/agentRunners.js`
- `cloud/worker/coder-sandbox.js`
- `cloud/worker/sandboxRunner.js`
- `cloud/worker/worker.js`

#### Bug Cause

Unknown — extracted from commit 1043f65a.

#### Fix Applied

See commit 1043f65a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Move secrets from ecosystem.config.js to .env file (env_file: ./.\_env)

Date: 2026-05-15 22:41:45 +0800
Source: Git commit 85fa387f
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/ecosystem.config.js

#### Task Summary

fix: move secrets from ecosystem.config.js to .env file (env_file: ./.\_env)

#### Files Changed

- `cloud/ecosystem.config.js`

#### Bug Cause

Unknown — extracted from commit 85fa387f.

#### Fix Applied

See commit 85fa387f by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Bypass auth for /telegram/mapping endpoint

Date: 2026-05-15 22:14:30 +0800
Source: Git commit 0118f49e
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/auth.js

#### Task Summary

fix: bypass auth for /telegram/mapping endpoint

#### Files Changed

- `cloud/api/auth.js`

#### Bug Cause

Unknown — extracted from commit 0118f49e.

#### Fix Applied

See commit 0118f49e by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Add checkWebhook and checkCommand to telegramRateLimiter for api.js compatibi...

Date: 2026-05-15 21:37:50 +0800
Source: Git commit 04420682
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramRateLimiter.js

#### Task Summary

fix: add checkWebhook and checkCommand to telegramRateLimiter for api.js compatibility

#### Files Changed

- `cloud/api/telegramRateLimiter.js`

#### Bug Cause

Unknown — extracted from commit 04420682.

#### Fix Applied

See commit 04420682 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Feat: telegram response fixes (rate limiter, typing indicators, error message...

Date: 2026-05-15 21:09:01 +0800
Source: Git commit 7bca6ef1
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/pty-server.js, cloud/api/routes/skills.js, cloud/api/telegramBot.js, cloud/api/telegramRateLimiter.js

#### Task Summary

feat: telegram response fixes (rate limiter, typing indicators, error messages) + Skills Generator API + IDE Terminal improvements

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/pty-server.js`
- `cloud/api/routes/skills.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramRateLimiter.js`
- `cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js`
- `cloud/dashboard/src/components/ide-terminal/api.ts`
- `cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts`
- `cloud/dashboard/src/components/views/skill-generator.tsx`
- `cloud/dashboard/src/lib/ide-store.tsx`
- `cloud/test-ide-smartness-comparison.js`
- `cloud/test-smart-terminal-e2e.js`
- `docs/super-roo/IDE_TERMINAL_IMPROVEMENTS_HANDOFF.md`

#### Bug Cause

Unknown — extracted from commit 7bca6ef1.

#### Fix Applied

See commit 7bca6ef1 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, telegram, terminal, bugfix

---

### Auto-Extracted Lesson: Add Login nav tab and prominent Sign Out button in header

Date: 2026-05-15 19:10:12 +0800
Source: Git commit fd6ff284
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx

#### Task Summary

fix: add Login nav tab and prominent Sign Out button in header

#### Files Changed

- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`

#### Bug Cause

Unknown — extracted from commit fd6ff284.

#### Fix Applied

See commit fd6ff284 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add login tab with server-side token verification and logout button

Date: 2026-05-15 18:26:55 +0800
Source: Git commit 4adca511
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx

#### Task Summary

fix: add login tab with server-side token verification and logout button

#### Files Changed

- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`

#### Bug Cause

Unknown — extracted from commit 4adca511.

#### Fix Applied

See commit 4adca511 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Telegram critical gaps - chatId 0, field mismatch, stub endpoints, WebSocket

Date: 2026-05-15 15:29:50 +0800
Source: Git commit 023fee46
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/telegram.tsx

#### Task Summary

fix: telegram critical gaps - chatId 0, field mismatch, stub endpoints, WebSocket

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/telegram.tsx`

#### Bug Cause

Unknown — extracted from commit 023fee46.

#### Fix Applied

See commit 023fee46 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Wire all mock dashboard views to real APIs + PM2 stability

Date: 2026-05-15 15:04:57 +0800
Source: Git commit 7d2d42cc
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/approvals.tsx, cloud/dashboard/src/components/views/bugs.tsx, cloud/dashboard/src/components/views/docker.tsx, cloud/dashboard/src/components/views/logs.tsx, cloud/dashboard/src/components/views/queue.tsx

#### Task Summary

fix: wire all mock dashboard views to real APIs + PM2 stability

#### Files Changed

- `cloud/dashboard/src/components/views/approvals.tsx`
- `cloud/dashboard/src/components/views/bugs.tsx`
- `cloud/dashboard/src/components/views/docker.tsx`
- `cloud/dashboard/src/components/views/logs.tsx`
- `cloud/dashboard/src/components/views/queue.tsx`
- `cloud/dashboard/src/components/views/skill-generator.tsx`
- `cloud/ecosystem.config.js`

#### Bug Cause

Unknown — extracted from commit 7d2d42cc.

#### Fix Applied

See commit 7d2d42cc by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

docker, bugfix

---

### Auto-Extracted Lesson: Change IDE terminal API endpoint from /ide-workspace/terminal to /ide-workspa...

Date: 2026-05-15 13:14:42 +0800
Source: Git commit 6726830e
Model/API used: JPG Yap
Confidence: medium
Related files: .github/workflows/cloud-api-tests.yml, apps/indexer-worker/eslint.config.mjs, apps/indexer-worker/package.json, apps/indexer-worker/src/cli.js, apps/indexer-worker/src/worker.js

#### Task Summary

fix: change IDE terminal API endpoint from /ide-workspace/terminal to /ide-workspace/terminal/execute

#### Files Changed

- `.github/workflows/cloud-api-tests.yml`
- `apps/indexer-worker/eslint.config.mjs`
- `apps/indexer-worker/package.json`
- `apps/indexer-worker/src/cli.js`
- `apps/indexer-worker/src/worker.js`
- `cloud/api/__tests__/test-log-rotator.test.js`
- `cloud/api/__tests__/test-migration-runner.test.js`
- `cloud/api/__tests__/test-monitoring-engine.test.js`
- `cloud/api/__tests__/test-rate-limiter.test.js`
- `cloud/api/__tests__/test-telegram-classifier.test.js`
- `cloud/api/__tests__/test-telegram-learner.test.js`
- `cloud/api/api.js`
- `cloud/api/dashboardWebSocket.js`
- `cloud/api/generate-openapi-part2.js`
- `cloud/api/generate-openapi.js`
- `cloud/api/lib/migrationRunner.js`
- `cloud/api/lib/telegramLearnerDb.js`
- `cloud/api/logRotator.js`
- `cloud/api/migrations/0001_create_telegram_learner.sql`
- `cloud/api/migrations/0002_create_orchestrator_store.sql`
- `cloud/api/migrations/0003_create_pgvector_schema.sql`
- `cloud/api/monitoringEngine.js`
- `cloud/api/openapi.json`
- `cloud/api/rateLimiter.js`
- `cloud/api/routes/ml.js`
- `cloud/api/routes/monitoring.js`
- `cloud/api/telegramLearner.js`
- `cloud/api/tenantManager.js`
- `cloud/dashboard/package.json`
- `cloud/dashboard/scripts/check-pnpm-store.mjs`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/ErrorBoundary.tsx`
- `cloud/dashboard/src/components/ide-terminal/api.ts`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/ui/__tests__/utils.test.ts`
- `cloud/dashboard/src/components/ui/data-display.tsx`
- `cloud/dashboard/src/components/ui/index.ts`
- `cloud/dashboard/src/components/ui/panel.tsx`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`
- `cloud/dashboard/src/components/views/ml.tsx`
- `cloud/dashboard/src/components/views/tenants.tsx`
- `cloud/dashboard/src/hooks/useApiFetch.ts`
- `cloud/dashboard/src/hooks/useDashboardWebSocket.ts`
- `cloud/dashboard/src/lib/utils.ts`
- `cloud/dashboard/vitest.config.ts`
- `cloud/docker/DEPLOY_DOCKER.md`
- `cloud/docker/Dockerfile.worker`
- `cloud/docker/docker-compose.yml`
- `cloud/package.json`
- `cloud/test-e2e-full-stack.js`
- `cloud/tsconfig.json`
- `cloud/vitest.config.ts`
- `packages/command-runner/package.json`
- `packages/command-runner/src/runner.ts`
- `packages/command-runner/tsconfig.json`
- `packages/memory-core/eslint.config.mjs`
- `packages/terminal-core/package.json`
- `pnpm-lock.yaml`

#### Bug Cause

Unknown — extracted from commit 6726830e.

#### Fix Applied

See commit 6726830e by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, telegram, docker, terminal, bugfix

---

### Auto-Extracted Lesson: Feat: refactor IDE Terminal - decompose 1808-line component into hooks, add W...

Date: 2026-05-15 09:02:49 +0800
Source: Git commit 8d901a16
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/e2e/ide-terminal-hooks.spec.ts, cloud/dashboard/src/components/ide-terminal/**tests**/api-compute-diff.test.js, cloud/dashboard/src/components/ide-terminal/**tests**/ide-store-reducer.test.js, cloud/dashboard/src/components/ide-terminal/**tests**/run-ide-tests.js, cloud/dashboard/src/components/ide-terminal/**tests**/test-helpers.js

#### Task Summary

feat: refactor IDE Terminal - decompose 1808-line component into hooks, add WebSocket timeout, useCallback optimization, rate limiting, and 45 unit tests

#### Files Changed

- `cloud/dashboard/e2e/ide-terminal-hooks.spec.ts`
- `cloud/dashboard/src/components/ide-terminal/__tests__/api-compute-diff.test.js`
- `cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js`
- `cloud/dashboard/src/components/ide-terminal/__tests__/run-ide-tests.js`
- `cloud/dashboard/src/components/ide-terminal/__tests__/test-helpers.js`
- `cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts`
- `cloud/dashboard/src/components/ide-terminal/hooks/useWebSocket.ts`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`

#### Bug Cause

Unknown — extracted from commit 8d901a16.

#### Fix Applied

See commit 8d901a16 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, terminal, refactor

---

### Auto-Extracted Lesson: Feat(ide-terminal): Monaco Editor, LSP Bridge, Problems/Settings/Extensions p...

Date: 2026-05-14 15:47:36 +0800
Source: Git commit e07b3716
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/ide-vscode-parity/SKILL.md, .roo/skills/ui-builder/SKILL.md, .roo/skills/visual-crawler-e2e/SKILL.md, .superroo/memory/session-summary.md, AUTONOMOUS-REPORT-2026-05-13-1522.md

#### Task Summary

feat(ide-terminal): Monaco Editor, LSP Bridge, Problems/Settings/Extensions panels

#### Files Changed

- `.roo/skills/ide-vscode-parity/SKILL.md`
- `.roo/skills/ui-builder/SKILL.md`
- `.roo/skills/visual-crawler-e2e/SKILL.md`
- `.superroo/memory/session-summary.md`
- `AUTONOMOUS-REPORT-2026-05-13-1522.md`
- `MCP_SETUP_GUIDE.md`
- `cloud/api/api.js`
- `cloud/api/lib/centralBrainClient.js`
- `cloud/api/lsp-bridge.js`
- `cloud/dashboard/e2e-report/index.html`
- `cloud/dashboard/e2e/gui-agents.spec.ts`
- `cloud/dashboard/e2e/ide-terminal-debug.spec.ts`
- `cloud/dashboard/e2e/ide-terminal-dom-check.spec.ts`
- `cloud/dashboard/e2e/screenshots/agents-registry.png`
- `cloud/dashboard/e2e/screenshots/agents-view.png`
- `cloud/dashboard/e2e/screenshots/debug-page.png`
- `cloud/dashboard/e2e/screenshots/deployed-after-reload.png`
- `cloud/dashboard/e2e/screenshots/deployed-after-tab-switch.png`
- `cloud/dashboard/e2e/screenshots/deployed-ai-panel-closeup.png`
- `cloud/dashboard/e2e/screenshots/deployed-before-tab-switch.png`
- `cloud/dashboard/e2e/screenshots/deployed-context-summary.png`
- `cloud/dashboard/e2e/screenshots/deployed-dom-check.png`
- `cloud/dashboard/e2e/screenshots/deployed-formatted-messages.png`
- `cloud/dashboard/e2e/screenshots/deployed-ide-terminal-loaded.png`
- `cloud/dashboard/e2e/screenshots/deployed-on-overview.png`
- `cloud/dashboard/e2e/screenshots/deployed-recent-tasks.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-agent-suggestions.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-ai-chat.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-ai-closed.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-command-output.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-file-toggle.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-loaded.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-paste.png`
- `cloud/dashboard/e2e/screenshots/ide-terminal-shortcuts.png`
- `cloud/dashboard/e2e/screenshots/telegram-assistant.png`
- `cloud/dashboard/e2e/screenshots/telegram-view.png`
- `cloud/dashboard/e2e/telegram-assistant.spec.ts`
- `cloud/dashboard/next.config.js`
- `cloud/dashboard/package.json`
- `cloud/dashboard/playwright.config.ts`
- `cloud/dashboard/src/components/ide-terminal/CodeEditor.tsx`
- `cloud/dashboard/src/components/ide-terminal/ExtensionsPanel.tsx`
- `cloud/dashboard/src/components/ide-terminal/MonacoEditor.tsx`
- `cloud/dashboard/src/components/ide-terminal/ProblemsPanel.tsx`
- `cloud/dashboard/src/components/ide-terminal/SettingsPanel.tsx`
- `cloud/dashboard/src/components/views/ai-chat.tsx`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`
- `cloud/dashboard/src/lib/ai-chat-api.ts`
- `cloud/dashboard/test-results/.last-run.json`
- `cloud/docker-compose.indexing.yml`
- `cloud/docker/Dockerfile.indexer`
- `cloud/test-telegram-intelligence.js`
- `console.log('ERR`
- `docs/repo-indexing-architecture.md`
- `docs/resources/ui-architecture.md`
- `mcp-superroo-config.json`
- `memory/repo-index-schema.md`
- `packages/types/src/global-settings.ts`
- `packages/types/src/vscode-extension-host.ts`
- `pnpm-lock.yaml`
- `server/src/memory/McpMemoryServer.ts`
- `server/src/memory/ProjectMemoryManager.ts`
- `server/src/memory/chunker.ts`
- `server/src/memory/commit-deploy-log.json`
- `server/src/memory/qdrant-client.ts`
- `server/src/memory/repo-indexer.ts`
- `server/src/memory/repo-search.ts`
- `src/api/providers/central-brain.ts`
- `src/core/webview/ClineProvider.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/package.json`
- `src/super-roo-daemon/DaemonAgentAdapter.ts`
- `src/super-roo-host/registerSuperRooCommands.ts`
- `src/super-roo/core/SuperRooOrchestrator.ts`
- `superroo-3.53.1.zip`
- `superroo-vsix/[Content_Types].xml`
- `superroo-vsix/extension.vsixmanifest`
- `superroo-vsix/extension/LICENSE.txt`
- `superroo-vsix/extension/assets/codicons/codicon.css`
- `superroo-vsix/extension/assets/codicons/codicon.ttf`
- `superroo-vsix/extension/assets/icons/icon-nightly.png`
- `superroo-vsix/extension/assets/icons/icon.png`
- `superroo-vsix/extension/assets/icons/icon.svg`
- `superroo-vsix/extension/assets/icons/panel_dark.png`
- `superroo-vsix/extension/assets/icons/panel_dark.svg`
- `superroo-vsix/extension/assets/icons/panel_light.png`
- `superroo-vsix/extension/assets/icons/panel_light.svg`
- `superroo-vsix/extension/assets/images/openrouter.png`
- `superroo-vsix/extension/assets/images/requesty.png`
- `superroo-vsix/extension/assets/images/roo-logo.svg`
- `superroo-vsix/extension/assets/images/roo.png`
- `superroo-vsix/extension/assets/vscode-material-icons/icon-map.json`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/3d.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/abap.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/abc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/actionscript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ada.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/adonis.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/advpl_include.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/advpl_prw.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/advpl_ptm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/advpl_tlpp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/android.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-component.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-directive.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-guard.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-pipe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-resolver.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular-service.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/angular.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/antlr.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/apiblueprint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/apollo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/applescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/apps-script.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/appveyor.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/architecture.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/arduino.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/asciidoc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/assembly.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/astro.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/astyle.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/audio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/aurelia.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/authors.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/auto.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/auto_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/autohotkey.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/autoit.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/azure-pipelines.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/azure.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/babel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ballerina.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bazel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bicep.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/biome.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bitbucket.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bithound.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/blink.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/blink_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/blitz.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bower.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/brainfuck.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/browserlist.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/browserlist_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/buck.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bucklescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/buildkite.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bun.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/bun_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/c.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cabal.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/caddy.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cadence.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cake.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/capacitor.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/capnp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/certificate.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/changelog.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/chess.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/chess_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/chrome.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/circleci.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/circleci_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/clojure.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cloudfoundry.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cmake.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/coala.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cobol.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/coconut.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/code-climate.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/code-climate_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/codecov.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/codeowners.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/coffee.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/coldfusion.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/command.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/commitlint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/concourse.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/conduct.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/console.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/contributing.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cpp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/craco.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/credits.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/crystal.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/crystal_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/csharp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/css-map.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/css.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cucumber.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cuda.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/cypress.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/d.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dart.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dart_generated.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/database.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/denizenscript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/deno.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/deno_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dependabot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dhall.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/diff.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dinophp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/disc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/django.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dll.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/docker.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/document.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dotjs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/drawio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/drone.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/drone_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/dune.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/edge.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/editorconfig.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ejs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/elixir.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/elm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/email.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ember.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/erlang.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/esbuild.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/eslint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/exe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/fastlane.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/favicon.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/figma.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/file.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/firebase.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/flash.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/flow.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-admin-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-admin.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-android-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-android.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-angular-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-angular.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-animation-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-animation.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ansible-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ansible.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-api-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-api.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-apollo-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-apollo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-app-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-app.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-archive-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-archive.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-audio-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-audio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-aurelia-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-aurelia.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-aws-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-aws.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-azure-pipelines-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-azure-pipelines.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-base-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-base.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-batch-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-batch.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-benchmark-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-benchmark.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-bower-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-bower.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-buildkite-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-buildkite.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cart-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cart.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-changesets-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-changesets.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ci-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ci.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-circleci-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-circleci.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-class-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-class.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-client-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-client.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cloudflare-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cloudflare.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cluster-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cluster.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cobol-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cobol.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-command-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-command.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-components-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-components.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-config-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-config.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-connection-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-connection.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-console-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-console.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-constant-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-constant.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-container-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-container.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-content-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-content.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-context-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-context.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-contract-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-contract.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-controller-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-controller.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-core-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-core.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-coverage-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-coverage.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-css-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-css.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-custom-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-custom.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cypress-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-cypress.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-database-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-database.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-debug-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-debug.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-decorators-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-decorators.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-delta-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-delta.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-desktop-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-desktop.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-dist-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-dist.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-docker-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-docker.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-docs-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-docs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-download-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-download.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-dump-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-dump.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-enum-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-enum.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-environment-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-environment.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-error-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-error.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-event-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-event.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-examples-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-examples.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-expo-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-expo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-export-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-export.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-fastlane-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-fastlane.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-firebase-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-firebase.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-flow-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-flow.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-font-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-font.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-functions-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-functions.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gamemaker-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gamemaker.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-generator-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-generator.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-git-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-git.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-github-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-github.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gitlab-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gitlab.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-global-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-global.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-godot-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-godot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gradle-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gradle.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-graphql-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-graphql.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-guard-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-guard.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gulp-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-gulp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-helper-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-helper.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-home-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-home.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-hook-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-hook.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-husky-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-husky.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-i18n-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-i18n.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-images-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-images.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-import-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-import.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-include-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-include.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-intellij-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-intellij-open_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-intellij.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-intellij_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-interface-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-interface.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ios-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ios.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-java-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-java.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-javascript-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-javascript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-jinja-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-jinja-open_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-jinja.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-jinja_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-job-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-job.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-json-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-json.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-keys-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-keys.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-kubernetes-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-kubernetes.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-layout-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-layout.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-less-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-less.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lib-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lib.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-linux-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-linux.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-log-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-log.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lottie-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lottie.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lua-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-lua.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-macos-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-macos.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mail-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mail.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mappings-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mappings.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-markdown-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-markdown.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mercurial-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mercurial.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-messages-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-messages.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-meta-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-meta.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-middleware-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-middleware.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mjml-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mjml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mobile-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mobile.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mock-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mock.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mojo-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-mojo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-moon-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-moon.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-netlify-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-netlify.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-next-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-next.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-actions-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-actions.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-effects-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-effects.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-entities-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-entities.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-reducer-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-reducer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-selectors-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-selectors.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-state-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-state.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-store-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-ngrx-store.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-node-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-node.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-nuxt-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-nuxt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-other-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-other.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-packages-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-packages.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pdf-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pdf.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pdm-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pdm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-php-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-php.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-phpmailer-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-phpmailer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pipe-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-pipe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-plastic-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-plastic.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-plugin-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-plugin.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-prisma-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-prisma.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-private-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-private.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-project-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-project.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-proto-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-proto.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-public-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-public.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-python-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-python.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-quasar-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-quasar.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-queue-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-queue.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-react-components-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-react-components.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-actions-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-actions.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-reducer-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-reducer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-selector-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-selector.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-store-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-redux-store.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-resolver-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-resolver.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-resource-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-resource.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-review-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-review.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-robot-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-robot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-root-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-root.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-routes-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-routes.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-rules-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-rules.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-sass-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-sass.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-scala-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-scala.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-scripts-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-scripts.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-secure-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-secure.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-seeders-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-seeders.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-server-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-server.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-serverless-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-serverless.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-shader-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-shader.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-shared-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-shared.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-src-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-src.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stack-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stencil-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stencil.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-storybook-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-storybook.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stylus-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-stylus.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-sublime-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-sublime.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-supabase-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-supabase.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-svelte-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-svelte.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-svg-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-svg.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-syntax-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-syntax.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-target-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-target.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-taskfile-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-taskfile.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-tasks-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-tasks.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-television-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-television.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-temp-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-temp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-template-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-template.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-terraform-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-terraform.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-test-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-test.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-theme-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-theme.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-tools-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-tools.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-typescript-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-typescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-unity-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-unity.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-update-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-update.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-upload-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-upload.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-utils-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-utils.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vercel-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vercel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-verdaccio-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-verdaccio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-video-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-video.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-views-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-views.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vm-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vscode-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vscode.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vue-directives-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vue-directives.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vue-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vue.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vuepress-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vuepress.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vuex-store-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-vuex-store.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-wakatime-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-wakatime.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-webpack-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-webpack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-windows-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-windows.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-wordpress-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-wordpress.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-yarn-open.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder-yarn.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/folder.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/font.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/forth.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/fortran.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/foxpro.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/fsharp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/fusebox.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gamemaker.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gatsby.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gcp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gemfile.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gemini.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/git.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gitlab.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gitpod.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gleam.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/go-mod.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/go.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/go_gopher.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/godot-assets.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/godot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gradle.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/grain.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/graphcool.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/graphql.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gridsome.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/groovy.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/grunt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/gulp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/h.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/haml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/handlebars.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hardhat.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/haskell.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/haxe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hcl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hcl_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/helm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/heroku.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hex.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hjson.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/horusec.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/hpp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/html.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/http.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/huff.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/huff_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/husky.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/i18n.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/idris.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ifanr-cloud.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/image.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/imba.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ionic.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/istanbul.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jar.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/java.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/javaclass.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/javascript-map.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/javascript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jenkins.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jest.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jinja.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jinja_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jsconfig.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/json.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/julia.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/jupyter.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/karma.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/key.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/kivy.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/kl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/knip.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/kotlin.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/kubernetes.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/kusto.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/laravel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lerna.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/less.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lib.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lighthouse.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lilypond.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/liquid.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lisp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/livescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lock.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/log.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lolcode.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lottie.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/lua.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/makefile.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/markdown.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/markojs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mathematica.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/matlab.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/maven.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mdsvex.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mdx.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mercurial.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/merlin.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mermaid.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/meson.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/minecraft.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mjml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mocha.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/modernizr.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mojo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/moon.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/moonscript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/mxml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nano-staged.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nano-staged_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ndst.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-controller.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-decorator.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-filter.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-gateway.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-guard.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-middleware.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-module.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-pipe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-resolver.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest-service.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nest.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/netlify.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/netlify_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/next.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/next_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nginx.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-actions.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-effects.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-entity.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-reducer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-selectors.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ngrx-state.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nim.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nix.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nodejs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nodejs_alt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nodemon.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/npm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nuget.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nunjucks.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nuxt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/nx.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/objective-c.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/objective-cpp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ocaml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/odin.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/opa.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/opam.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/openapi.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/openapi_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/otne.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/panda.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/parcel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pascal.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pawn.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/payload.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/payload_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pdf.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pdm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/percy.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/perl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/php-cs-fixer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/php.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/php_elephant.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/php_elephant_pink.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/phpunit.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pinejs.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pipeline.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pkl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/plastic.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/playwright.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/plop.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pnpm.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pnpm_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/poetry.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/postcss.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/posthtml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/powerpoint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/powershell.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/prettier.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/prisma.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/processing.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/prolog.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/proto.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/protractor.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/pug.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/puppet.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/puppeteer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/purescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/python-misc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/python.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/qsharp.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/quasar.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/quokka.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/qwik.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/r.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/racket.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/raml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/razor.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/react.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/react_ts.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/readme.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/reason.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/red.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/redux-action.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/redux-reducer.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/redux-selector.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/redux-store.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/remix.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/remix_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/renovate.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/replit.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rescript-interface.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/restql.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/riot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/roadmap.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/roblox.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/robot.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/robots.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rollup.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rome.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/routing.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rspec.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rubocop.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rubocop_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/ruby.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/rust.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/salesforce.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/san.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sas.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sass.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sbt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/scala.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/scheme.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/search.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/semantic-release.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/semantic-release_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/semgrep.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sentry.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sequelize.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/serverless.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/settings.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/shader.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/shaderlab.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/silverstripe.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/siyuan.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sketch.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/slim.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/slug.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/smarty.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/snowpack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/snowpack_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/snyk.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/solidity.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sonarcloud.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/spwn.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stan.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/steadybit.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stencil.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stitches.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stitches_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/storybook.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stryker.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stylable.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stylelint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stylelint_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/stylus.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/sublime.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/supabase.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/svelte.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/svg.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/svgo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/svgr.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/swagger.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/swc.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/swift.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/syncpack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/table.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tailwindcss.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/taskfile.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tauri.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tcl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/teal.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/templ.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/template.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/terraform.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/test-js.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/test-jsx.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/test-ts.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tex.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/textlint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tilt.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tldraw.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tldraw_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tobi.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tobimake.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/todo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/travis.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tree.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tsconfig.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/tune.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/turborepo.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/turborepo_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/twig.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/twine.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/typescript-def.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/typescript.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/typst.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/uml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/uml_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/unocss.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/url.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vagrant.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vala.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vedic.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/velocity.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vercel.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vercel_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/verdaccio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/verilog.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vfl.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/video.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vim.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/virtual.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/visualstudio.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vite.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vitest.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vlang.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vscode.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vue-config.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vue.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/vuex-store.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/wakatime.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/wakatime_light.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/wallaby.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/watchman.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/webassembly.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/webhint.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/webpack.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/wepy.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/werf.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/windicss.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/wolframlanguage.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/word.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/xaml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/xml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/yaml.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/yang.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/yarn.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/zig.svg`
- `superroo-vsix/extension/assets/vscode-material-icons/icons/zip.svg`
- `superroo-vsix/extension/changelog.md`
- `superroo-vsix/extension/integrations/theme/default-themes/dark_modern.json`
- `superroo-vsix/extension/integrations/theme/default-themes/dark_plus.json`
- `superroo-vsix/extension/integrations/theme/default-themes/dark_vs.json`
- `superroo-vsix/extension/integrations/theme/default-themes/hc_black.json`
- `superroo-vsix/extension/integrations/theme/default-themes/hc_light.json`
- `superroo-vsix/extension/integrations/theme/default-themes/light_modern.json`
- `superroo-vsix/extension/integrations/theme/default-themes/light_plus.json`
- `superroo-vsix/extension/integrations/theme/default-themes/light_vs.json`
- `superroo-vsix/extension/package.json`
- `superroo-vsix/extension/package.nls.ca.json`
- `superroo-vsix/extension/package.nls.de.json`
- `superroo-vsix/extension/package.nls.es.json`
- `superroo-vsix/extension/package.nls.fr.json`
- `superroo-vsix/extension/package.nls.hi.json`
- `superroo-vsix/extension/package.nls.id.json`
- `superroo-vsix/extension/package.nls.it.json`
- `superroo-vsix/extension/package.nls.ja.json`
- `superroo-vsix/extension/package.nls.json`
- `superroo-vsix/extension/package.nls.ko.json`
- `superroo-vsix/extension/package.nls.nl.json`
- `superroo-vsix/extension/package.nls.pl.json`
- `superroo-vsix/extension/package.nls.pt-BR.json`
- `superroo-vsix/extension/package.nls.ru.json`
- `superroo-vsix/extension/package.nls.tr.json`
- `superroo-vsix/extension/package.nls.vi.json`
- `superroo-vsix/extension/package.nls.zh-CN.json`
- `superroo-vsix/extension/package.nls.zh-TW.json`
- `superroo-vsix/extension/readme.md`
- `superroo-vsix/extension/webview-ui/audio/celebration.wav`
- `superroo-vsix/extension/webview-ui/audio/notification.wav`
- `superroo-vsix/extension/webview-ui/audio/progress_loop.wav`
- `superroo-vsix/extension/webview-ui/build/assets/chunk--Ycre7K_.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk--Ycre7K_.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-1DNp92w6.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-1DNp92w6.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-25uR9ifH.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-25uR9ifH.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3e1v2bzS.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3e1v2bzS.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3ipgsugG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3ipgsugG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3mfGJbgy.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-3mfGJbgy.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-4A_iFExJ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-4A_iFExJ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-5i3qLPDT.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-5i3qLPDT.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-6nHXG8SA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-6nHXG8SA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-7i6GEmcB.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-7i6GEmcB.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-85-TOEBH.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-85-TOEBH.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B0YXbBSa.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B0YXbBSa.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B0m2ddpp.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B0m2ddpp.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B1dDrJ26.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B1dDrJ26.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B1yitclQ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B1yitclQ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B47ASqzZ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B47ASqzZ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B5tOyCc9.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B5tOyCc9.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B6aJPvgy.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B6aJPvgy.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B7mTdjB0.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B7mTdjB0.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B9xm8XSJ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B9xm8XSJ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BAAX8Kh4.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BAAX8Kh4.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BEDo0Tqx.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BEDo0Tqx.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BERRCDM3.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BERRCDM3.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BETggiCN.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BETggiCN.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BEwlwnbL.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BEwlwnbL.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFVdkX1U.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFVdkX1U.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFfxhgS-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFfxhgS-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFvZA1X9.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BFvZA1X9.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BHrmToEH.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BHrmToEH.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BIGW1oBm.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BIGW1oBm.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BM1_JUlF.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BM1_JUlF.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BMMyXqK5.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BMMyXqK5.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BMWR74SV.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BMWR74SV.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BP3HzMA6.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BP3HzMA6.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BQ8w6xss.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BQ8w6xss.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BR7mELCv.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BR7mELCv.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BRHolxvo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BRHolxvo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BSCcYQo-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BSCcYQo-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BTJTHyun.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BTJTHyun.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BU0udk1K.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BU0udk1K.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BV7otONQ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BV7otONQ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BWvSN4gD.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BWvSN4gD.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BXkSAIEj.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BXkSAIEj.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BYCUR9qn.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BYCUR9qn.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BYunw83y.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BYunw83y.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B_m7g4N7.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B_m7g4N7.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B_vNuMnf.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-B_vNuMnf.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BaML1QMV.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BaML1QMV.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BbcW6ACK.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BbcW6ACK.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bc2xwClX.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bc2xwClX.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BcOcwvcX.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BcOcwvcX.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BdImnpbu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BdImnpbu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BdnUsdx6.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BdnUsdx6.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BepWV7mh.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BepWV7mh.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BfHTSMKl.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BfHTSMKl.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BfjtVDDH.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BfjtVDDH.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgDCqdQA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgDCqdQA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgEskmCb.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgEskmCb.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgfZh1f1.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BgfZh1f1.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BhOHFoWU.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BhOHFoWU.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BkPM1oy1.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BkPM1oy1.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BkioyH1T.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BkioyH1T.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bkuqu6BP.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bkuqu6BP.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bl2oy6fF.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bl2oy6fF.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BmXAJ9_W.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BmXAJ9_W.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BnD7D7ah.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BnD7D7ah.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BoKiGodi.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BoKiGodi.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bp6g37R7.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bp6g37R7.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BqYA7rlc.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BqYA7rlc.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BrYkhBEK.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BrYkhBEK.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BsS91CYL.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BsS91CYL.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BspZqrRM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BspZqrRM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtCnVYZw.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtCnVYZw.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtOb2qkB.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtOb2qkB.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BthQWCQV.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BthQWCQV.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtqSS_iP.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BtqSS_iP.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bty6elJm.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bty6elJm.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Btyk0a-E.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Btyk0a-E.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Buea-lGh.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Buea-lGh.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BvAqAH-y.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BvAqAH-y.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bw305WKR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Bw305WKR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BzJJZx-M.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-BzJJZx-M.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-C_nZcE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-C_nZcE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-HMFfM3.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-HMFfM3.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-SQnVFl.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C-SQnVFl.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C0HS_06l.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C0HS_06l.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C0hk2d4L.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C0hk2d4L.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C151Ov-r.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C151Ov-r.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C2t-YnRu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C2t-YnRu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C2tOF0e5.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C2tOF0e5.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C39BiMTA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C39BiMTA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3B-1QV4.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3B-1QV4.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3IMAYVA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3IMAYVA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3khCPGq.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3khCPGq.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3mMm8J8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3mMm8J8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3rowuyE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C3rowuyE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C4IJs8-o.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C4IJs8-o.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C8M2exoo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C8M2exoo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C8lEn-DE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C8lEn-DE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C98Dy4si.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C98Dy4si.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9XAeP06.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9XAeP06.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9dXKwCe.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9dXKwCe.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9tDr53Z.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9tDr53Z.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9tS-k6U.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-C9tS-k6U.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDVJQ6XC.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDVJQ6XC.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDuzWNpe.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDuzWNpe.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDx5xZoG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CDx5xZoG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CEL-wOlO.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CEL-wOlO.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CEu0bR-o.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CEu0bR-o.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CF10PKvl.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CF10PKvl.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CG6Dc4jp.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CG6Dc4jp.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHLpvVh8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHLpvVh8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHM0blh-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHM0blh-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHadp7IV.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHadp7IV.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHh-QcGE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CHh-QcGE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CJOTNe-S.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CJOTNe-S.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CJc9bBzg.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CJc9bBzg.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CK-KhNJq.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CK-KhNJq.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CKIfxQSi.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CKIfxQSi.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CLIx6TIR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CLIx6TIR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CLxacb5B.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CLxacb5B.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CMUws-av.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CMUws-av.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CMdgaOU9.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CMdgaOU9.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-COkxafJQ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-COkxafJQ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-COt5Ahok.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-COt5Ahok.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CS3Unz2-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CS3Unz2-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CSPye00a.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CSPye00a.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CTRr51gU.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CTRr51gU.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CUBwRw-F.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CUBwRw-F.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CUz34qUM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CUz34qUM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CVO1_9PV.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CVO1_9PV.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CXhxxCfG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CXhxxCfG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CXtECtnM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CXtECtnM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CafNBF8u.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CafNBF8u.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CbFg5uaA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CbFg5uaA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CbfX1IO0.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CbfX1IO0.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CdTSL8YE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CdTSL8YE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CdggvHu8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CdggvHu8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CeAyd5Ju.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CeAyd5Ju.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cf4Oy6XI.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cf4Oy6XI.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CfQXZHmo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CfQXZHmo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CfeIJUat.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CfeIJUat.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cg-RD9OK.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cg-RD9OK.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-ChMvpjG-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-ChMvpjG-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CiIkovmz.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CiIkovmz.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cj5Yp3dK.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cj5Yp3dK.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CkByrt1z.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CkByrt1z.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CkXjmgJE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CkXjmgJE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cmh6b_Ma.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cmh6b_Ma.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CnK8MTSM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CnK8MTSM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cne5dW8M.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cne5dW8M.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CnnmHF94.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CnnmHF94.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cno5XSCQ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cno5XSCQ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Co6uUVPk.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Co6uUVPk.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Colysff4.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Colysff4.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cp-IABpG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cp-IABpG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CrJ-YhoI.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CrJ-YhoI.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CsfeWuGM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CsfeWuGM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Csfq5Kiy.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Csfq5Kiy.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CtrldY6v.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CtrldY6v.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cu1ofpgu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cu1ofpgu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cuk6v7N8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cuk6v7N8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cv9koXgw.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Cv9koXgw.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CyktbL80.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CyktbL80.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CylS5w8V.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CylS5w8V.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CzjqYRUi.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-CzjqYRUi.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D-2ljcwZ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D-2ljcwZ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D08WgyRC.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D08WgyRC.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D0YGMca9.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D0YGMca9.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D0r3Knsf.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D0r3Knsf.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D17OF-Vu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D17OF-Vu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1K3uGbs.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1K3uGbs.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1_LrSGp.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1_LrSGp.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1j8_8rp.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D1j8_8rp.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D22FLkUw.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D22FLkUw.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D2CYqzqI.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D2CYqzqI.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D32k8WzR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D32k8WzR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D3lLCCz7.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D3lLCCz7.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D4h5O-jR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D4h5O-jR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D5-asLiD.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D5-asLiD.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D5KoaKCx.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D5KoaKCx.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D7o27uSR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D7o27uSR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D7oLnXFd.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D7oLnXFd.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D82EKSYY.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D82EKSYY.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D93ZcfNL.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D93ZcfNL.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D97Zzqfu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D97Zzqfu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D9kx8fwg.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D9kx8fwg.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DAi9KRSo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DAi9KRSo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DEd0xgAf.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DEd0xgAf.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFQXde-d.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFQXde-d.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFR6f4Jn.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFR6f4Jn.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFXneXwc.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DFXneXwc.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DGztddWO.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DGztddWO.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DH5Ifo-i.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DH5Ifo-i.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DHCkPAjA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DHCkPAjA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DHJKELXO.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DHJKELXO.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DIHx2sdZ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DIHx2sdZ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DMzUqQB5.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DMzUqQB5.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DNNlxIVo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DNNlxIVo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DO0LZyKx.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DO0LZyKx.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DP8w0yq8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DP8w0yq8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DPfMkruS.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DPfMkruS.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DQ46CBc_.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DQ46CBc_.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DRBVVfo7.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DRBVVfo7.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DRg8JJMk.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DRg8JJMk.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DSnTR2wu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DSnTR2wu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DU1UobuO.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DU1UobuO.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DUszq2jm.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DUszq2jm.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVFEvuxE.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVFEvuxE.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVMEJ2y_.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVMEJ2y_.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVxCFoDh.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DVxCFoDh.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DWedfzmr.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DWedfzmr.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DWkon8Hs.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DWkon8Hs.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXETW7eA.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXETW7eA.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXHVBXt-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXHVBXt-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXbdFlpD.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXbdFlpD.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXmwc3jG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXmwc3jG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXvB9xmW.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DXvB9xmW.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D_Q5rh1f.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-D_Q5rh1f.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Da5cRb03.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Da5cRb03.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DbjXokdF.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DbjXokdF.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DcaNXYhu.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DcaNXYhu.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dcsh5twl.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dcsh5twl.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dd19v3D-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dd19v3D-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DdkO51Og.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DdkO51Og.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Ddv68eIx.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Ddv68eIx.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Des-eS-w.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Des-eS-w.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Df68jz8_.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Df68jz8_.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Df6bDoY_.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Df6bDoY_.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DfEE3Bzs.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DfEE3Bzs.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DjjNbUIW.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DjjNbUIW.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DkwncUOv.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DkwncUOv.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DlfHMoPT.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DlfHMoPT.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DljmTZ5-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DljmTZ5-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DnULxvSX.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DnULxvSX.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DouSy6O5.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DouSy6O5.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DpOm0zC4.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DpOm0zC4.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dpen1YoG.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dpen1YoG.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DqwNpetd.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DqwNpetd.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DsOJ9woJ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DsOJ9woJ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Du0Ki9n9.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Du0Ki9n9.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dx-B1_4e.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Dx-B1_4e.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DyJlTyXw.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DyJlTyXw.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DyxjwDmM.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-DyxjwDmM.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-E3gJ1_iC.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-E3gJ1_iC.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Hhtzho9R.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Hhtzho9R.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-I3RK9BU8.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-I3RK9BU8.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-IeuSbFQv.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-IeuSbFQv.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Jcf2cZT6.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Jcf2cZT6.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-L9t79GZl.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-L9t79GZl.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-MzD3tlZU.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-MzD3tlZU.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-NleAzG8P.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-NleAzG8P.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-OpcvBqEo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-OpcvBqEo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-P80f7IUj.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-P80f7IUj.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-PEFJdsE-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-PEFJdsE-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Pmp26Uib.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Pmp26Uib.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-PoHY5YXO.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-PoHY5YXO.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-QIJgUcNo.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-QIJgUcNo.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-QX45V2Sx.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-QX45V2Sx.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-RrBGtqGR.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-RrBGtqGR.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-T7J2jLj3.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-T7J2jLj3.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Yzrsuije.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-Yzrsuije.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-_ykCGR6B.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-_ykCGR6B.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-bCR0ucgS.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-bCR0ucgS.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-bN70gL4F.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-bN70gL4F.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-brDaU2vB.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-brDaU2vB.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-c1G5yEKj.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-c1G5yEKj.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-dwOrl1Do.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-dwOrl1Do.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-fuZLfV_i.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-fuZLfV_i.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-fve9TYiY.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-fve9TYiY.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-g9-lgVsj.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-g9-lgVsj.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-gcz8RCvz.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-gcz8RCvz.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-hegEt444.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-hegEt444.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-irsrSlf-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-irsrSlf-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-jQY0bNUL.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-jQY0bNUL.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-lXgVvXCa.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-lXgVvXCa.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-leinZj1a.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-leinZj1a.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-p5EVAoC-.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-p5EVAoC-.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-q-j0iyEw.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-q-j0iyEw.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-sVvOI5da.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-sVvOI5da.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-sYKpKAhk.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-sYKpKAhk.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-vGWfd6FD.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-vGWfd6FD.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-vbB5lEOJ.js`
- `superroo-vsix/extension/webview-ui/build/assets/chunk-vbB5lEOJ.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_AMS-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_AMS-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_AMS-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Bold.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Bold.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Bold.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Caligraphic-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Bold.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Bold.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Bold.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Fraktur-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Bold.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Bold.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Bold.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-BoldItalic.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-BoldItalic.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-BoldItalic.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Italic.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Italic.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Italic.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Main-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-BoldItalic.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-BoldItalic.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-BoldItalic.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-Italic.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-Italic.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Math-Italic.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Bold.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Bold.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Bold.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Italic.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Italic.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Italic.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_SansSerif-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Script-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Script-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Script-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size1-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size1-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size1-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size2-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size2-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size2-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size3-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size3-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size4-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size4-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Size4-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Typewriter-Regular.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Typewriter-Regular.woff`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/KaTeX_Typewriter-Regular.woff2`
- `superroo-vsix/extension/webview-ui/build/assets/fonts/codicon.ttf`
- `superroo-vsix/extension/webview-ui/build/assets/index.css`
- `superroo-vsix/extension/webview-ui/build/assets/index.js`
- `superroo-vsix/extension/webview-ui/build/assets/index.js.map`
- `superroo-vsix/extension/webview-ui/build/assets/mermaid-bundle.js`
- `superroo-vsix/extension/webview-ui/build/assets/mermaid-bundle.js.map`
- `tmp_add_brain_proxies.sh`
- `tmp_fix_proxy2.py`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `webview-ui/src/i18n/locales/en/chat.json`

#### Bug Cause

Unknown — extracted from commit e07b3716.

#### Fix Applied

See commit e07b3716 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, deployment, telegram, docker, terminal

---

### Auto-Extracted Lesson: (e2e): fix IDE Terminal tests for SPA navigation and React state handling

Date: 2026-05-14 10:54:27 +0800
Source: Git commit f746ff63
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/e2e/ide-terminal-deployed.spec.ts, cloud/dashboard/e2e/ide-terminal.spec.ts

#### Task Summary

fix(e2e): fix IDE Terminal tests for SPA navigation and React state handling

#### Files Changed

- `cloud/dashboard/e2e/ide-terminal-deployed.spec.ts`
- `cloud/dashboard/e2e/ide-terminal.spec.ts`

#### Bug Cause

Unknown — extracted from commit f746ff63.

#### Fix Applied

See commit f746ff63 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, terminal, bugfix

---

### Auto-Extracted Lesson: (telegram): lazy-load telegramAgentManager to prevent crash on missing module

Date: 2026-05-14 02:06:22 +0800
Source: Git commit 67355559
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramAgentManager.js, cloud/api/telegramBot.js, cloud/api/telegramMenu.js

#### Task Summary

fix(telegram): lazy-load telegramAgentManager to prevent crash on missing module

#### Files Changed

- `cloud/api/telegramAgentManager.js`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramMenu.js`

#### Bug Cause

Unknown — extracted from commit 67355559.

#### Fix Applied

See commit 67355559 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Orchestrator auth exemption + AgentRegistry method name correction

Date: 2026-05-14 01:51:37 +0800
Source: Git commit 89778354
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/api/auth.js

#### Task Summary

fix: orchestrator auth exemption + AgentRegistry method name correction

#### Files Changed

- `cloud/api/api.js`
- `cloud/api/auth.js`

#### Bug Cause

Unknown — extracted from commit 89778354.

#### Fix Applied

See commit 89778354 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Consolidate safeJsonParse into shared utility + update autonomous reports

Date: 2026-05-14 00:04:30 +0800
Source: Git commit 99cf63fb
Model/API used: JPG Yap
Confidence: medium
Related files: AUTONOMOUS_IMPROVEMENT_REPORT.md, BUG_FIX_LOG.md, src/super-roo/bugs/BugRegistry.ts, src/super-roo/features/FeatureRegistry.ts, src/super-roo/healing/HealingBus.ts

#### Task Summary

refactor: consolidate safeJsonParse into shared utility + update autonomous reports

#### Files Changed

- `AUTONOMOUS_IMPROVEMENT_REPORT.md`
- `BUG_FIX_LOG.md`
- `src/super-roo/bugs/BugRegistry.ts`
- `src/super-roo/features/FeatureRegistry.ts`
- `src/super-roo/healing/HealingBus.ts`
- `src/super-roo/memory/MemoryStore.ts`
- `src/super-roo/queue/TaskQueue.ts`
- `src/super-roo/utils/index.ts`
- `src/super-roo/utils/safeJsonParse.ts`

#### Bug Cause

Unknown — extracted from commit 99cf63fb.

#### Fix Applied

See commit 99cf63fb by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

refactor

---

### Auto-Extracted Lesson: Use --shamefully-hoist in Docker pnpm install to resolve transitive deps

Date: 2026-05-13 02:18:38 +0800
Source: Git commit b9944689
Model/API used: JPG Yap
Confidence: medium
Related files: Dockerfile

#### Task Summary

fix: use --shamefully-hoist in Docker pnpm install to resolve transitive deps

#### Files Changed

- `Dockerfile`

#### Bug Cause

Unknown — extracted from commit b9944689.

#### Fix Applied

See commit b9944689 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add pg transitive deps explicitly to memory-core package.json for pnpm strict...

Date: 2026-05-13 02:10:32 +0800
Source: Git commit 05b5d861
Model/API used: JPG Yap
Confidence: medium
Related files: packages/memory-core/package.json

#### Task Summary

fix: add pg transitive deps explicitly to memory-core package.json for pnpm strict resolution

#### Files Changed

- `packages/memory-core/package.json`

#### Bug Cause

Unknown — extracted from commit 05b5d861.

#### Fix Applied

See commit 05b5d861 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Remove --no-optional flag so esbuild linux binary is installed

Date: 2026-05-13 02:02:33 +0800
Source: Git commit f7c70f12
Model/API used: JPG Yap
Confidence: medium
Related files: Dockerfile

#### Task Summary

fix: remove --no-optional flag so esbuild linux binary is installed

#### Files Changed

- `Dockerfile`

#### Bug Cause

Unknown — extracted from commit f7c70f12.

#### Fix Applied

See commit f7c70f12 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add --ignore-scripts to Docker pnpm install to skip bootstrap

Date: 2026-05-13 01:57:55 +0800
Source: Git commit 5787521c
Model/API used: JPG Yap
Confidence: medium
Related files: Dockerfile

#### Task Summary

fix: add --ignore-scripts to Docker pnpm install to skip bootstrap

#### Files Changed

- `Dockerfile`

#### Bug Cause

Unknown — extracted from commit 5787521c.

#### Fix Applied

See commit 5787521c by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add missing workspace package.json files to Docker build context

Date: 2026-05-13 01:56:27 +0800
Source: Git commit badc6873
Model/API used: JPG Yap
Confidence: medium
Related files: Dockerfile

#### Task Summary

fix: add missing workspace package.json files to Docker build context

#### Files Changed

- `Dockerfile`

#### Bug Cause

Unknown — extracted from commit badc6873.

#### Fix Applied

See commit badc6873 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Use --no-frozen-lockfile in Docker build for command-runner package

Date: 2026-05-13 01:55:24 +0800
Source: Git commit c081dbfd
Model/API used: JPG Yap
Confidence: medium
Related files: Dockerfile

#### Task Summary

fix: use --no-frozen-lockfile in Docker build for command-runner package

#### Files Changed

- `Dockerfile`

#### Bug Cause

Unknown — extracted from commit c081dbfd.

#### Fix Applied

See commit c081dbfd by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Feat: wire brain + memory system into daemon with Docker Compose deployment

Date: 2026-05-13 01:47:58 +0800
Source: Git commit 42c0dbd3
Model/API used: JPG Yap
Confidence: medium
Related files: .dockerignore, Dockerfile, commissioning/COMMISSIONING_REPORT_BRAIN_MEMORY_2026-05-12.md, config/env.example, config/memory-routing.config.json

#### Task Summary

feat: wire brain + memory system into daemon with Docker Compose deployment

#### Files Changed

- `.dockerignore`
- `Dockerfile`
- `commissioning/COMMISSIONING_REPORT_BRAIN_MEMORY_2026-05-12.md`
- `config/env.example`
- `config/memory-routing.config.json`
- `docker-compose.yml`
- `docker/.env.example`
- `docker/ollama-entrypoint.sh`
- `package.json`
- `packages/brain-router/package.json`
- `packages/brain-router/src/BrainRouter.ts`
- `packages/brain-router/src/LocalOllamaProvider.ts`
- `packages/brain-router/src/ToolRegistry.ts`
- `packages/brain-router/src/__tests__/BrainRouter.test.ts`
- `packages/brain-router/src/__tests__/ToolRegistry.test.ts`
- `packages/brain-router/src/index.ts`
- `packages/brain-router/src/types.ts`
- `packages/brain-router/tsconfig.json`
- `packages/brain-router/vitest.config.ts`
- `packages/memory-core/package.json`
- `packages/memory-core/src/MemoryClient.ts`
- `packages/memory-core/src/OllamaEmbeddingProvider.ts`
- `packages/memory-core/src/PgVectorStore.ts`
- `packages/memory-core/src/RagContextBuilder.ts`
- `packages/memory-core/src/__tests__/OllamaEmbeddingProvider.test.ts`
- `packages/memory-core/src/index.ts`
- `packages/memory-core/src/types.ts`
- `packages/memory-core/tsconfig.json`
- `packages/memory-core/vitest.config.ts`
- `pnpm-lock.yaml`
- `scripts/index-codebase.ts`
- `scripts/migrate-existing-memory.ts`
- `sql/001_pgvector_schema.sql`
- `src/package.json`
- `src/super-roo-daemon/brain-routes.ts`
- `src/super-roo-daemon/index.ts`
- `src/super-roo/brain/AgentRuntimeWrapper.ts`
- `src/super-roo/brain/BrainEnabledAgent.ts`
- `src/super-roo/brain/CentralBrain.ts`
- `src/super-roo/brain/TelegramBrainBridge.ts`
- `src/super-roo/brain/UnifiedTaskRouter.ts`
- `src/super-roo/brain/VscodeBrainBridge.ts`
- `src/super-roo/brain/buildContextPacket.ts`
- `src/super-roo/brain/index.ts`
- `src/super-roo/index.ts`

#### Bug Cause

Unknown — extracted from commit 42c0dbd3.

#### Fix Applied

See commit 42c0dbd3 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, docker

---

### Auto-Extracted Lesson: Use ref for \_hydrated check to prevent API data overwriting localStorage stat...

Date: 2026-05-12 22:16:22 +0800
Source: Git commit c4779990
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/ide-terminal.tsx

#### Task Summary

fix: use ref for \_hydrated check to prevent API data overwriting localStorage state on remount

#### Files Changed

- `cloud/dashboard/src/components/views/ide-terminal.tsx`

#### Bug Cause

Unknown — extracted from commit c4779990.

#### Fix Applied

See commit c4779990 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

terminal, bugfix

---

### Auto-Extracted Lesson: IDE chat assistant now reconstructs user intent, provides direct solutions, a...

Date: 2026-05-12 18:43:45 +0800
Source: Git commit 224812d5
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: IDE chat assistant now reconstructs user intent, provides direct solutions, and asks if user wants integration

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 224812d5.

#### Fix Applied

See commit 224812d5 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Exclude playwright.config.ts and e2e from Next.js build to prevent build failure

Date: 2026-05-12 12:35:55 +0800
Source: Git commit 3ffbbecd
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/tsconfig.json

#### Task Summary

fix: exclude playwright.config.ts and e2e from Next.js build to prevent build failure

#### Files Changed

- `cloud/dashboard/tsconfig.json`

#### Bug Cause

Unknown — extracted from commit 3ffbbecd.

#### Fix Applied

See commit 3ffbbecd by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Increase listenWithRetry to 20 retries with fuser kill after 3 failures

Date: 2026-05-12 10:18:43 +0800
Source: Git commit ef9edbce
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: increase listenWithRetry to 20 retries with fuser kill after 3 failures

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit ef9edbce.

#### Fix Applied

See commit ef9edbce by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: InfiniteImprovementLoop also expects opts.memoryStore, not orchestrator object

Date: 2026-05-12 10:12:23 +0800
Source: Git commit 1a92b8ac
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: InfiniteImprovementLoop also expects opts.memoryStore, not orchestrator object

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 1a92b8ac.

#### Fix Applied

See commit 1a92b8ac by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Call orchestrator.start() before registering modules to ensure memory is init...

Date: 2026-05-12 10:10:59 +0800
Source: Git commit 1f0a8217
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: call orchestrator.start() before registering modules to ensure memory is initialized

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 1f0a8217.

#### Fix Applied

See commit 1f0a8217 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Destructure named exports from safeRequire to prevent 'not a constructor' errors

Date: 2026-05-12 10:07:46 +0800
Source: Git commit 2ffbfca7
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: destructure named exports from safeRequire to prevent 'not a constructor' errors

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 2ffbfca7.

#### Fix Applied

See commit 2ffbfca7 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Crash resilience - auto-deployer cooldown (10min), PM2 port retry, unhandled ...

Date: 2026-05-12 09:56:19 +0800
Source: Git commit 1b8018e7
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/ecosystem.config.js, cloud/worker/autoDeployer.js

#### Task Summary

fix: crash resilience - auto-deployer cooldown (10min), PM2 port retry, unhandled rejection handler, safe module require

#### Files Changed

- `cloud/api/api.js`
- `cloud/ecosystem.config.js`
- `cloud/worker/autoDeployer.js`

#### Bug Cause

Unknown — extracted from commit 1b8018e7.

#### Fix Applied

See commit 1b8018e7 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Feat: implement bidirectional ML sync between local VS Code and cloud

Date: 2026-05-12 03:55:46 +0800
Source: Git commit f9b844b9
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/orchestrator/ml/FeatureMapper.js, cloud/orchestrator/ml/FederatedMerge.js, cloud/orchestrator/ml/ModelSerializer.js, cloud/orchestrator/modules/InfiniteImprovementLoop.js

#### Task Summary

feat: implement bidirectional ML sync between local VS Code and cloud

#### Files Changed

- `cloud/api/api.js`
- `cloud/orchestrator/ml/FeatureMapper.js`
- `cloud/orchestrator/ml/FederatedMerge.js`
- `cloud/orchestrator/ml/ModelSerializer.js`
- `cloud/orchestrator/modules/InfiniteImprovementLoop.js`
- `cloud/orchestrator/stores/schema.sql`
- `src/super-roo/ml/loop/InfiniteImprovementLoop.ts`
- `src/super-roo/ml/sync/MLSyncClient.ts`

#### Bug Cause

Unknown — extracted from commit f9b844b9.

#### Fix Applied

See commit f9b844b9 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

ml-engine, api

---

### Auto-Extracted Lesson: Change autonomous command from trading to coding and debugging focus

Date: 2026-05-12 03:20:30 +0800
Source: Git commit 82680357
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/autonomous/SKILL.md, cloud/api/api.js, cloud/orchestrator/modules/AutonomousLoop.js

#### Task Summary

refactor: change autonomous command from trading to coding and debugging focus

#### Files Changed

- `.roo/skills/autonomous/SKILL.md`
- `cloud/api/api.js`
- `cloud/orchestrator/modules/AutonomousLoop.js`

#### Bug Cause

Unknown — extracted from commit 82680357.

#### Fix Applied

See commit 82680357 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, refactor

---

### Auto-Extracted Lesson: Add better-sqlite3 dependency to cloud/package.json for orchestrator SQLite s...

Date: 2026-05-12 02:59:12 +0800
Source: Git commit 37467bc2
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/package.json

#### Task Summary

fix: add better-sqlite3 dependency to cloud/package.json for orchestrator SQLite store

#### Files Changed

- `cloud/package.json`

#### Bug Cause

Unknown — extracted from commit 37467bc2.

#### Fix Applied

See commit 37467bc2 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Change terminalRef type from HTMLPreElement to HTMLDivElement to fix build error

Date: 2026-05-12 01:39:11 +0800
Source: Git commit 03fcd5ff
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/ide-terminal.tsx

#### Task Summary

fix: change terminalRef type from HTMLPreElement to HTMLDivElement to fix build error

#### Files Changed

- `cloud/dashboard/src/components/views/ide-terminal.tsx`

#### Bug Cause

Unknown — extracted from commit 03fcd5ff.

#### Fix Applied

See commit 03fcd5ff by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

terminal, bugfix

---

### Auto-Extracted Lesson: Deploy: sync all uncommitted updates before deployment

Date: 2026-05-12 01:35:27 +0800
Source: Git commit eef58594
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/terminal-brain-upgrade/SKILL.md, NEXT_IMPROVEMENTS.md, cloud/api/api.js, cloud/api/auth.js, cloud/api/routes/healing-metrics.js

#### Task Summary

deploy: sync all uncommitted updates before deployment

#### Files Changed

- `.roo/skills/terminal-brain-upgrade/SKILL.md`
- `NEXT_IMPROVEMENTS.md`
- `cloud/api/api.js`
- `cloud/api/auth.js`
- `cloud/api/routes/healing-metrics.js`
- `cloud/api/routes/monitoring.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/healing.tsx`
- `cloud/dashboard/src/components/views/monitoring.tsx`
- `docs/resources/smart-terminal-research.md`
- `docs/super-roo/ARCHITECTURE_DIAGRAMS.md`
- `docs/super-roo/HEALING_MODULE_GUIDE.md`
- `docs/super-roo/ML_ENGINE_API.md`
- `docs/super-roo/TROUBLESHOOTING.md`
- `docs/super-roo/UPDATES.md`
- `memory/healing-incidents.json`
- `memory/healing-metrics.json`
- `pnpm-lock.yaml`
- `src/core/task-persistence/__tests__/workRecord.spec.ts`
- `src/core/tools/__tests__/editTool.spec.ts`
- `src/core/tools/__tests__/writeToFileTool.spec.ts`
- `src/package.json`
- `src/super-roo/__tests__/ml/engine.test.ts`
- `src/super-roo/cpu-guard/__tests__/AgentLoopGuard.test.ts`
- `src/super-roo/healing/HealingBus.ts`
- `src/super-roo/healing/HealingMetrics.ts`
- `src/super-roo/healing/RepairPlanBuilder.ts`
- `src/super-roo/healing/RootCauseClassifier.ts`
- `src/super-roo/healing/SelfHealingLoop.ts`
- `src/super-roo/healing/__tests__/HealingMetrics.test.ts`
- `src/super-roo/healing/__tests__/RootCauseClassifier.test.ts`
- `src/super-roo/healing/index.ts`
- `src/super-roo/index.ts`
- `src/super-roo/infrastructure/LogAggregator.ts`
- `src/super-roo/infrastructure/index.ts`
- `src/super-roo/ml/engine/LRScheduler.ts`
- `src/super-roo/ml/engine/Loss.ts`
- `src/super-roo/ml/engine/ModelPersistence.ts`
- `src/super-roo/ml/engine/Optimizer.ts`
- `src/super-roo/ml/engine/checkpoint.ts`
- `src/super-roo/ml/engine/index.ts`
- `src/super-roo/ml/engine/layers/conv.ts`
- `src/super-roo/types/index.ts`

#### Bug Cause

Unknown — extracted from commit eef58594.

#### Fix Applied

See commit eef58594 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ml-engine, api, terminal

---

### Auto-Extracted Lesson: Feat: smart terminal upgrade - NL chat, inline exec, error handling, block ou...

Date: 2026-05-11 22:17:33 +0800
Source: Git commit 7bcfaabb
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js, cloud/dashboard/src/components/views/ide-terminal.tsx, cloud/mini-ide/public/app.js, cloud/mini-ide/public/index.html, cloud/mini-ide/public/styles.css

#### Task Summary

feat: smart terminal upgrade - NL chat, inline exec, error handling, block output, autocomplete, recording

#### Files Changed

- `cloud/api/telegramBot.js`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`
- `cloud/mini-ide/public/app.js`
- `cloud/mini-ide/public/index.html`
- `cloud/mini-ide/public/styles.css`
- `cloud/test-smart-terminal-e2e.js`

#### Bug Cause

Unknown — extracted from commit 7bcfaabb.

#### Fix Applied

See commit 7bcfaabb by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, telegram, terminal

---

### Auto-Extracted Lesson: Feat: Terminal Brain Layer - full upgrade across dashboard IDE, Mini IDE, and...

Date: 2026-05-11 20:22:14 +0800
Source: Git commit 78f27cef
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/telegram-integration/SKILL.md, 1778391856793), agents/terminal-agent/agent.json, agents/terminal-agent/terminal-agent.md, cloud/add-callback-handlers.py

#### Task Summary

feat: Terminal Brain Layer - full upgrade across dashboard IDE, Mini IDE, and Telegram bot

#### Files Changed

- `.roo/skills/telegram-integration/SKILL.md`
- `1778391856793)`
- `agents/terminal-agent/agent.json`
- `agents/terminal-agent/terminal-agent.md`
- `cloud/add-callback-handlers.py`
- `cloud/add-project-sync.py`
- `cloud/add-smtp-creds.py`
- `cloud/add-welcome-message.py`
- `cloud/agents/superroo-debugger-agent/agent.json`
- `cloud/agents/telegram-agent/agent.json`
- `cloud/agents/telegram-agent/resources/project-context.md`
- `cloud/agents/telegram-agent/resources/superroo-architecture.md`
- `cloud/agents/telegram-agent/skills/code-context.md`
- `cloud/agents/telegram-agent/skills/conversation-flow.md`
- `cloud/agents/telegram-agent/skills/intent-analysis.md`
- `cloud/agents/telegram-agent/skills/telegram-response.md`
- `cloud/agents/telegram-agent/workflows/analyze-and-respond.md`
- `cloud/agents/telegram-agent/workflows/research-and-answer.md`
- `cloud/agents/telegram-agent/workflows/route-to-agent.md`
- `cloud/agents/telegram-improver-agent/agent.json`
- `cloud/agents/telegram-improver-agent/resources/improvement-prioritization.md`
- `cloud/agents/telegram-improver-agent/resources/telegram-bot-architecture.md`
- `cloud/agents/telegram-improver-agent/skills/chat-log-analysis.md`
- `cloud/agents/telegram-improver-agent/skills/code-upgrade-request.md`
- `cloud/agents/telegram-improver-agent/skills/skill-gap-detection.md`
- `cloud/agents/telegram-improver-agent/workflows/code-upgrade-trigger.md`
- `cloud/agents/telegram-improver-agent/workflows/daily-chat-log-review.md`
- `cloud/agents/telegram-improver-agent/workflows/skill-improvement-loop.md`
- `cloud/api/api.js`
- `cloud/api/auth.js`
- `cloud/api/fix_miniapp_route.py`
- `cloud/api/insert_deleteMessage.py`
- `cloud/api/patch_sendmessage.py`
- `cloud/api/patch_telegram_bot.py`
- `cloud/api/patch_telegram_email_otp.py`
- `cloud/api/routes/terminal-brain.js`
- `cloud/api/telegram-miniapp.html`
- `cloud/api/telegramBot.js`
- `cloud/api/telegramBot_email_otp_patch.py`
- `cloud/api/telegramClassifier.js`
- `cloud/api/telegramEngineer.js`
- `cloud/api/telegramLearner.js`
- `cloud/api/telegramNotifier.js`
- `cloud/api/tgEndpoints.js`
- `cloud/auto-deploy-windows.ps1`
- `cloud/auto-deploy.sh`
- `cloud/cleanup-test-project.py`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/api-keys.tsx`
- `cloud/dashboard/src/components/views/auto-deploy.tsx`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`
- `cloud/dashboard/src/components/views/telegram.tsx`
- `cloud/deploy-via-ssh.ps1`
- `cloud/ecosystem.config.js`
- `cloud/fix-auth-exports-and-whitelist.py`
- `cloud/fix-duplicate-code.py`
- `cloud/fix-eco-dupes.py`
- `cloud/fix-email-otp.py`
- `cloud/fix-whitelist-v2.py`
- `cloud/fix_telegram_bot.py`
- `cloud/mini-ide/public/app.js`
- `cloud/mini-ide/public/index.html`
- `cloud/mini-ide/public/styles.css`
- `cloud/mini-ide/server.js`
- `cloud/remove-smtp-creds.py`
- `cloud/test-consultant-deploy.js`
- `cloud/test-e2e-deploy.js`
- `cloud/test-e2e-projects.py`
- `cloud/test-model-router-e2e.js`
- `cloud/test-smtp.js`
- `cloud/test-sync-vps.py`
- `cloud/test-telegram-bot-updates.js`
- `cloud/test-verify-fixes.js`
- `cloud/worker/autoDeployer.js`
- `cloud/worker/debugJobRunner.js`
- `cloud/worker/worker.js`
- `docs/resources/working-tree.md`
- `packages/command-runner/src/runner.ts`
- `packages/log-parser/src/parser.ts`
- `packages/repo-scanner/src/scanner.ts`
- `packages/safety-guard/src/guard.ts`
- `packages/terminal-core/src/brain.ts`
- `packages/terminal-core/src/memory.ts`
- `packages/terminal-core/src/planner.ts`
- `packages/terminal-core/src/types.ts`
- `server/src/memory/commit-deploy-log.json`
- `server/src/memory/fix_commit_log.py`
- `src/super-roo/debug-team/__tests__/SuperDebugLoop.test.ts`
- `src/super-roo/debug-team/adapters/HermesClawAdapter.ts`
- `src/super-roo/debug-team/adapters/OpenClawAdapter.ts`
- `src/super-roo/debug-team/engines/FeatureSyncOrchestrator.ts`
- `src/super-roo/debug-team/engines/HypothesisEngine.ts`
- `src/super-roo/debug-team/engines/PhaseBreakdownEngine.ts`
- `src/super-roo/debug-team/engines/SkillsGenerator.ts`
- `src/super-roo/debug-team/sandbox/ContainerSandbox.ts`
- `src/super-roo/debug-team/sandbox/RollbackManager.ts`
- `src/super-roo/settings/services/ideWorkspaceService.ts`
- `src/super-roo/settings/services/ideWorkspaceTypes.ts`

#### Bug Cause

Unknown — extracted from commit 78f27cef.

#### Fix Applied

See commit 78f27cef by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, deployment, telegram, terminal

---

### Auto-Extracted Lesson: Provide default LoopConfig values for InfiniteImprovementLoop initialization

Date: 2026-05-11 00:49:05 +0800
Source: Git commit 0d3daa6a
Model/API used: JPG Yap
Confidence: medium
Related files: src/super-roo/debug-team/SuperDebugLoop.ts

#### Task Summary

fix: provide default LoopConfig values for InfiniteImprovementLoop initialization

#### Files Changed

- `src/super-roo/debug-team/SuperDebugLoop.ts`

#### Bug Cause

Unknown — extracted from commit 0d3daa6a.

#### Fix Applied

See commit 0d3daa6a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Feat: add /aceteam command for fully autonomous coding and debugging with ML ...

Date: 2026-05-11 00:41:45 +0800
Source: Git commit 81308346
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/debug-team/SKILL.md, cloud/api/telegramBot.js, cloud/api/tgEndpoints.js, src/super-roo/debug-team/SuperDebugLoop.ts, src/super-roo/debug-team/index.ts

#### Task Summary

feat: add /aceteam command for fully autonomous coding and debugging with ML insights and Telegram reports

#### Files Changed

- `.roo/skills/debug-team/SKILL.md`
- `cloud/api/telegramBot.js`
- `cloud/api/tgEndpoints.js`
- `src/super-roo/debug-team/SuperDebugLoop.ts`
- `src/super-roo/debug-team/index.ts`
- `src/super-roo/debug-team/reporting/AceTeamReportGenerator.ts`

#### Bug Cause

Unknown — extracted from commit 81308346.

#### Fix Applied

See commit 81308346 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram

---

### Auto-Extracted Lesson: Allow PUBLIC_COMMANDS (including /login) to bypass boss-only guard in group c...

Date: 2026-05-11 00:22:53 +0800
Source: Git commit 3bdd3ab1
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: allow PUBLIC_COMMANDS (including /login) to bypass boss-only guard in group chats

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit 3bdd3ab1.

#### Fix Applied

See commit 3bdd3ab1 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Telegram bot group chat support + login 404 URL

Date: 2026-05-09 23:43:12 +0800
Source: Git commit efd066d8
Model/API used: JPG Yap
Confidence: medium
Related files: apps/web-superroo/src/lib/constants.ts, server/src/memory/commit-deploy-log.json, src/telegram/**tests**/bot.test.ts, src/telegram/bot.ts

#### Task Summary

fix: Telegram bot group chat support + login 404 URL

#### Files Changed

- `apps/web-superroo/src/lib/constants.ts`
- `server/src/memory/commit-deploy-log.json`
- `src/telegram/__tests__/bot.test.ts`
- `src/telegram/bot.ts`

#### Bug Cause

Unknown — extracted from commit efd066d8.

#### Fix Applied

See commit efd066d8 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, deployment, telegram, bugfix

---

### Auto-Extracted Lesson: Fix Markdown parse errors in bot messages and add message logging

Date: 2026-05-09 22:20:42 +0800
Source: Git commit 00aad04a
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/telegramBot.js

#### Task Summary

fix: fix Markdown parse errors in bot messages and add message logging

#### Files Changed

- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit 00aad04a.

#### Fix Applied

See commit 00aad04a by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Exempt /telegram/webhook from auth catch-all in handleAuthRoute

Date: 2026-05-09 21:52:14 +0800
Source: Git commit 62cdbb4d
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/auth.js

#### Task Summary

fix: exempt /telegram/webhook from auth catch-all in handleAuthRoute

#### Files Changed

- `cloud/api/auth.js`

#### Bug Cause

Unknown — extracted from commit 62cdbb4d.

#### Fix Applied

See commit 62cdbb4d by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Group chat support — /command@bot detection, DM login redirect, cross-chat se...

Date: 2026-05-09 21:36:49 +0800
Source: Git commit df08c98f
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/auth.js, cloud/api/telegramBot.js

#### Task Summary

fix: group chat support — /command@bot detection, DM login redirect, cross-chat sessions

#### Files Changed

- `cloud/api/auth.js`
- `cloud/api/telegramBot.js`

#### Bug Cause

Unknown — extracted from commit df08c98f.

#### Fix Applied

See commit df08c98f by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, telegram, bugfix

---

### Auto-Extracted Lesson: Use corepack pnpm instead of broken /usr/bin/pnpm symlink

Date: 2026-05-09 21:18:20 +0800
Source: Git commit 3f5e3eb1
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/deploy-dashboard.sh

#### Task Summary

fix: use corepack pnpm instead of broken /usr/bin/pnpm symlink

#### Files Changed

- `cloud/deploy-dashboard.sh`

#### Bug Cause

Unknown — extracted from commit 3f5e3eb1.

#### Fix Applied

See commit 3f5e3eb1 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Use bash -lc in run_with_timeout to load corepack/pnpm PATH

Date: 2026-05-09 21:15:55 +0800
Source: Git commit 5ae5ea68
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/deploy-dashboard.sh

#### Task Summary

fix: use bash -lc in run_with_timeout to load corepack/pnpm PATH

#### Files Changed

- `cloud/deploy-dashboard.sh`

#### Bug Cause

Unknown — extracted from commit 5ae5ea68.

#### Fix Applied

See commit 5ae5ea68 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Prevent SSH hangs with ServerAliveInterval + timeout guards

Date: 2026-05-09 21:11:23 +0800
Source: Git commit 60003689
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/deploy-dashboard.sh, cloud/remote-deploy-dashboard.sh, src/super-roo/deploy/DeployOrchestrator.ts, src/super-roo/remote/RemoteShell.ts

#### Task Summary

fix: prevent SSH hangs with ServerAliveInterval + timeout guards

#### Files Changed

- `cloud/deploy-dashboard.sh`
- `cloud/remote-deploy-dashboard.sh`
- `src/super-roo/deploy/DeployOrchestrator.ts`
- `src/super-roo/remote/RemoteShell.ts`

#### Bug Cause

Unknown — extracted from commit 60003689.

#### Fix Applied

See commit 60003689 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Feat: upgrade deployer pipeline with parallel execution, filtered installs, t...

Date: 2026-05-09 20:45:51 +0800
Source: Git commit c63de6bc
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/deployer/SKILL.md, cloud/deploy-dashboard.sh, cloud/remote-deploy-dashboard.sh, server/src/memory/commit-deploy-log.json, src/super-roo/deploy/DeployOrchestrator.ts

#### Task Summary

feat: upgrade deployer pipeline with parallel execution, filtered installs, timeout monitoring, and stuck deploy fix

#### Files Changed

- `.roo/skills/deployer/SKILL.md`
- `cloud/deploy-dashboard.sh`
- `cloud/remote-deploy-dashboard.sh`
- `server/src/memory/commit-deploy-log.json`
- `src/super-roo/deploy/DeployOrchestrator.ts`
- `src/super-roo/product-memory/CommitDeployLog.ts`

#### Bug Cause

Unknown — extracted from commit c63de6bc.

#### Fix Applied

See commit c63de6bc by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Improve mobile responsiveness across cloud dashboard

Date: 2026-05-08 13:25:45 +0800
Source: Git commit 61581624
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/public/manifest.json, cloud/dashboard/src/app/globals.css, cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/components/views/overview.tsx

#### Task Summary

fix: improve mobile responsiveness across cloud dashboard

#### Files Changed

- `cloud/dashboard/public/manifest.json`
- `cloud/dashboard/src/app/globals.css`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/overview.tsx`
- `cloud/dashboard/src/components/views/settings.tsx`

#### Bug Cause

Unknown — extracted from commit 61581624.

#### Fix Applied

See commit 61581624 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: (dashboard): break next symlink in standalone output to fix styled-jsx requir...

Date: 2026-05-08 10:35:22 +0800
Source: Git commit 2658a6c0
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/scripts/prepare-standalone.mjs

#### Task Summary

fix(dashboard): break next symlink in standalone output to fix styled-jsx require-hook resolution

#### Files Changed

- `cloud/dashboard/scripts/prepare-standalone.mjs`

#### Bug Cause

Unknown — extracted from commit 2658a6c0.

#### Fix Applied

See commit 2658a6c0 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Resolve pnpm store path to root node_modules for styled-jsx copy

Date: 2026-05-08 10:31:46 +0800
Source: Git commit aabdfb5d
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/scripts/prepare-standalone.mjs

#### Task Summary

fix: resolve pnpm store path to root node_modules for styled-jsx copy

#### Files Changed

- `cloud/dashboard/scripts/prepare-standalone.mjs`

#### Bug Cause

Unknown — extracted from commit aabdfb5d.

#### Fix Applied

See commit aabdfb5d by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Resolve 502 Bad Gateway by copying styled-jsx/react-dom to standalone output;...

Date: 2026-05-08 09:49:21 +0800
Source: Git commit 0f332714
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/public/sw.js, cloud/dashboard/scripts/prepare-standalone.mjs

#### Task Summary

fix: resolve 502 Bad Gateway by copying styled-jsx/react-dom to standalone output; fix stale SW cache

#### Files Changed

- `cloud/dashboard/public/sw.js`
- `cloud/dashboard/scripts/prepare-standalone.mjs`

#### Bug Cause

Unknown — extracted from commit 0f332714.

#### Fix Applied

See commit 0f332714 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Resolve BUG-001 (memory leak), BUG-006 (Redis reconnect), BUG-008 (health che...

Date: 2026-05-07 20:37:33 +0800
Source: Git commit 01abfc32
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/bugs.tsx, src/super-roo/cpu-guard/queue.ts, src/super-roo/deploy/DeployOrchestrator.ts, src/super-roo/ml/engine/Metrics.ts, src/super-roo/utils/CancellableSleep.ts

#### Task Summary

fix: resolve BUG-001 (memory leak), BUG-006 (Redis reconnect), BUG-008 (health check timeout) + clean up bugs.tsx

#### Files Changed

- `cloud/dashboard/src/components/views/bugs.tsx`
- `src/super-roo/cpu-guard/queue.ts`
- `src/super-roo/deploy/DeployOrchestrator.ts`
- `src/super-roo/ml/engine/Metrics.ts`
- `src/super-roo/utils/CancellableSleep.ts`

#### Bug Cause

Unknown — extracted from commit 01abfc32.

#### Fix Applied

See commit 01abfc32 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

ml-engine, deployment, bugfix

---

### Auto-Extracted Lesson: Wire up BugsView in page.tsx and clean up bugs.tsx code quality

Date: 2026-05-07 20:31:31 +0800
Source: Git commit bea80535
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/views/bugs.tsx

#### Task Summary

fix: wire up BugsView in page.tsx and clean up bugs.tsx code quality

#### Files Changed

- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/views/bugs.tsx`

#### Bug Cause

Unknown — extracted from commit bea80535.

#### Fix Applied

See commit bea80535 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add onClick handlers, toast notifications, remove dead priorityColors code

Date: 2026-05-07 20:23:04 +0800
Source: Git commit ade822c9
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/src/components/views/skill-generator.tsx

#### Task Summary

fix: add onClick handlers, toast notifications, remove dead priorityColors code

#### Files Changed

- `cloud/dashboard/src/components/views/skill-generator.tsx`

#### Bug Cause

Unknown — extracted from commit ade822c9.

#### Fix Applied

See commit ade822c9 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Make Generate button always visible, add Generate All button, add draft summa...

Date: 2026-05-07 20:17:53 +0800
Source: Git commit efc182d7
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/dashboard/package.json, cloud/dashboard/src/components/views/skill-generator.tsx

#### Task Summary

fix: make Generate button always visible, add Generate All button, add draft summary bar

#### Files Changed

- `cloud/dashboard/package.json`
- `cloud/dashboard/src/components/views/skill-generator.tsx`

#### Bug Cause

Unknown — extracted from commit efc182d7.

#### Fix Applied

See commit efc182d7 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

bugfix

---

### Auto-Extracted Lesson: Add parseBody calls to IDE workspace routes that need request body

Date: 2026-05-07 08:56:05 +0800
Source: Git commit a980e3c1
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix: add parseBody calls to IDE workspace routes that need request body

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit a980e3c1.

#### Fix Applied

See commit a980e3c1 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: IDE Terminal API response field mismatches and missing import-github endpoint

Date: 2026-05-07 08:49:29 +0800
Source: Git commit b3c7f6e9
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/ide-terminal.tsx

#### Task Summary

fix: IDE Terminal API response field mismatches and missing import-github endpoint

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/ide-terminal.tsx`

#### Bug Cause

Unknown — extracted from commit b3c7f6e9.

#### Fix Applied

See commit b3c7f6e9 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, terminal, bugfix

---

### Auto-Extracted Lesson: Feat: add IDE Terminal tab with full workspace UI

Date: 2026-05-06 20:22:00 +0800
Source: Git commit d57d7563
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, src/super-roo/settings/**tests**/ideWorkspaceService.test.ts, src/super-roo/settings/routes/ideWorkspaceRoutes.ts, src/super-roo/settings/services/ideWorkspaceService.ts, src/super-roo/settings/services/ideWorkspaceTypes.ts

#### Task Summary

feat: add IDE Terminal tab with full workspace UI

#### Files Changed

- `cloud/api/api.js`
- `src/super-roo/settings/__tests__/ideWorkspaceService.test.ts`
- `src/super-roo/settings/routes/ideWorkspaceRoutes.ts`
- `src/super-roo/settings/services/ideWorkspaceService.ts`
- `src/super-roo/settings/services/ideWorkspaceTypes.ts`
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx`
- `webview-ui/src/components/super-roo/lib/ideWorkspaceApi.ts`
- `webview-ui/src/components/super-roo/tabs/IdeTerminalView.tsx`
- `webview-ui/src/components/super-roo/tabs/ide-terminal/AssistantPane.tsx`
- `webview-ui/src/components/super-roo/tabs/ide-terminal/FileTree.tsx`
- `webview-ui/src/components/super-roo/tabs/ide-terminal/PipelineBar.tsx`
- `webview-ui/src/components/super-roo/tabs/ide-terminal/StatusBar.tsx`
- `webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx`

#### Bug Cause

Unknown — extracted from commit d57d7563.

#### Fix Applied

See commit d57d7563 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, terminal

---

### Auto-Extracted Lesson: Feat: AI Model Router tab + fix commit-deploy-log schema + cloud dashboard in...

Date: 2026-05-06 18:48:40 +0800
Source: Git commit 1ba18999
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/components/views/model-router.tsx, server/src/memory/commit-deploy-log.json

#### Task Summary

feat: AI Model Router tab + fix commit-deploy-log schema + cloud dashboard integration

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/model-router.tsx`
- `server/src/memory/commit-deploy-log.json`
- `src/super-roo/settings/__tests__/modelRouterService.test.ts`
- `src/super-roo/settings/routes/modelRouterRoutes.ts`
- `src/super-roo/settings/services/modelRouterProviderRegistry.ts`
- `src/super-roo/settings/services/modelRouterService.ts`
- `src/super-roo/settings/services/modelRouterTypes.ts`
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx`
- `webview-ui/src/components/super-roo/lib/modelRouterApi.ts`
- `webview-ui/src/components/super-roo/tabs/ModelRouterView.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/AgentSync.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/CostOptimizer.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/FallbackRules.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/PerformanceMonitor.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/ProviderStatusStrip.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/RouteTable.tsx`
- `webview-ui/src/components/super-roo/tabs/model-router/SafetyRules.tsx`

#### Bug Cause

Unknown — extracted from commit 1ba18999.

#### Fix Applied

See commit 1ba18999 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, deployment, bugfix

---

### Auto-Extracted Lesson: Update commit-deploy-log with real git SHA 1ff6829f1

Date: 2026-05-06 18:06:36 +0800
Source: Git commit 89f7815c
Model/API used: JPG Yap
Confidence: medium
Related files: server/src/memory/commit-deploy-log.json

#### Task Summary

fix: update commit-deploy-log with real git SHA 1ff6829f1

#### Files Changed

- `server/src/memory/commit-deploy-log.json`

#### Bug Cause

Unknown — extracted from commit 89f7815c.

#### Fix Applied

See commit 89f7815c by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

deployment, bugfix

---

### Auto-Extracted Lesson: Feat: upgrade GitHub tab to Repository Operations Center with live data

Date: 2026-05-06 17:32:53 +0800
Source: Git commit 1ff6829f
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/views/github.tsx, packages/types/src/github.ts, packages/types/src/index.ts

#### Task Summary

feat: upgrade GitHub tab to Repository Operations Center with live data

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/views/github.tsx`
- `packages/types/src/github.ts`
- `packages/types/src/index.ts`
- `server/src/memory/commit-deploy-log.json`
- `src/super-roo/github/GitHubDashboardService.ts`
- `src/super-roo/github/__tests__/GitHubDashboardService.test.ts`
- `src/super-roo/github/index.ts`
- `webview-ui/src/App.tsx`
- `webview-ui/src/components/github/GitHubView.tsx`

#### Bug Cause

Unknown — extracted from commit 1ff6829f.

#### Fix Applied

See commit 1ff6829f by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api, deployment

---

### Auto-Extracted Lesson: Feat: add centralized Commit & Deploy Log system

Date: 2026-05-06 02:19:44 +0800
Source: Git commit 68d54a05
Model/API used: JPG Yap
Confidence: medium
Related files: AGENTS.md, cloud/dashboard/package.json, cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/sidebar.tsx, cloud/dashboard/src/components/views/working-tree.tsx

#### Task Summary

feat: add centralized Commit & Deploy Log system

#### Files Changed

- `AGENTS.md`
- `cloud/dashboard/package.json`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/sidebar.tsx`
- `cloud/dashboard/src/components/views/working-tree.tsx`
- `docs/resources/working-tree.md`
- `src/super-roo/index.ts`
- `src/super-roo/product-memory/CommitDeployLog.ts`
- `src/super-roo/product-memory/__tests__/CommitDeployLog.test.ts`
- `src/super-roo/product-memory/__tests__/WorkingTreeAgent.test.ts`
- `src/super-roo/product-memory/agents/WorkingTreeAgent.ts`
- `src/super-roo/product-memory/agents/index.ts`
- `src/super-roo/product-memory/index.ts`

#### Bug Cause

Unknown — extracted from commit 68d54a05.

#### Fix Applied

See commit 68d54a05 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing

---

### Auto-Extracted Lesson: (deploy): update dashboard deployment scripts, nginx config, and API wiring

Date: 2026-05-05 23:19:26 +0800
Source: Git commit 9993562d
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/DASHBOARD_DEPLOY_MANUAL.md, cloud/add-next-static-to-https.py, cloud/agents/superroo-deployer-agent/agent.json, cloud/agents/superroo-deployer-agent/memory/vps-memory.md, cloud/agents/superroo-deployer-agent/resources/deploy-checklist.md

#### Task Summary

fix(deploy): update dashboard deployment scripts, nginx config, and API wiring

#### Files Changed

- `cloud/DASHBOARD_DEPLOY_MANUAL.md`
- `cloud/add-next-static-to-https.py`
- `cloud/agents/superroo-deployer-agent/agent.json`
- `cloud/agents/superroo-deployer-agent/memory/vps-memory.md`
- `cloud/agents/superroo-deployer-agent/resources/deploy-checklist.md`
- `cloud/agents/superroo-deployer-agent/skills/vps-deploy.md`
- `cloud/agents/superroo-deployer-agent/workflows/full-deploy.md`
- `cloud/api/api.js`
- `cloud/dashboard/README.md`
- `cloud/dashboard/next.config.js`
- `cloud/dashboard/package.json`
- `cloud/dashboard/scripts/clean-next.mjs`
- `cloud/dashboard/scripts/prepare-standalone.mjs`
- `cloud/dashboard/scripts/verify-next-css.mjs`
- `cloud/deploy-dashboard-windows.ps1`
- `cloud/deploy-dashboard.sh`
- `cloud/ecosystem.config.js`
- `cloud/nginx-dashboard.conf`
- `cloud/remote-deploy-dashboard.sh`
- `src/super-roo/deploy/DeployOrchestrator.ts`
- `src/super-roo/remote/RemoteShell.ts`
- `src/super-roo/remote/__tests__/RemoteShell.test.ts`
- `src/super-roo/remote/index.ts`
- `website_response.html`

#### Bug Cause

Unknown — extracted from commit 9993562d.

#### Fix Applied

See commit 9993562d by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, api, deployment, bugfix

---

### Auto-Extracted Lesson: (api): normalize URL to strip /api prefix for Next.js rewrite compatibility

Date: 2026-05-04 13:34:44 +0800
Source: Git commit 07406e47
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js

#### Task Summary

fix(api): normalize URL to strip /api prefix for Next.js rewrite compatibility

#### Files Changed

- `cloud/api/api.js`

#### Bug Cause

Unknown — extracted from commit 07406e47.

#### Fix Applied

See commit 07406e47 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

api, bugfix

---

### Auto-Extracted Lesson: Feat(settings): wire frontend to backend API and deploy settings endpoints

Date: 2026-05-04 13:10:31 +0800
Source: Git commit dd607cb2
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/api.js, src/super-roo/settings/**tests**/approvalEngine.test.ts, src/super-roo/settings/**tests**/modelRouter.test.ts, src/super-roo/settings/**tests**/providerSync.test.ts, src/super-roo/settings/**tests**/secretVault.test.ts

#### Task Summary

feat(settings): wire frontend to backend API and deploy settings endpoints

#### Files Changed

- `cloud/api/api.js`
- `src/super-roo/settings/__tests__/approvalEngine.test.ts`
- `src/super-roo/settings/__tests__/modelRouter.test.ts`
- `src/super-roo/settings/__tests__/providerSync.test.ts`
- `src/super-roo/settings/__tests__/secretVault.test.ts`
- `src/super-roo/settings/config/agentRouting.ts`
- `src/super-roo/settings/config/providers.ts`
- `src/super-roo/settings/index.ts`
- `src/super-roo/settings/routes/providerRoutes.ts`
- `src/super-roo/settings/routes/routingRoutes.ts`
- `src/super-roo/settings/routes/settingsRoutes.ts`
- `src/super-roo/settings/services/approvalEngine.ts`
- `src/super-roo/settings/services/modelRouter.ts`
- `src/super-roo/settings/services/providerSync.ts`
- `src/super-roo/settings/services/providerTest.ts`
- `src/super-roo/settings/services/secretVault.ts`
- `src/super-roo/settings/types.ts`
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx`
- `webview-ui/src/components/super-roo/hooks/SrContext.tsx`
- `webview-ui/src/components/super-roo/messaging/protocol.ts`
- `webview-ui/src/components/super-roo/tabs/settings/AdvancedVpsSettingsTab.tsx`
- `webview-ui/src/components/super-roo/tabs/settings/ApiKeysProvidersTab.tsx`

#### Bug Cause

Unknown — extracted from commit dd607cb2.

#### Fix Applied

See commit dd607cb2 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui, api

---

### Auto-Extracted Lesson: Feat(cpu-guard): integrate CPU/RAM-aware agent loop guard with event system, ...

Date: 2026-05-04 11:33:52 +0800
Source: Git commit 7aa9a765
Model/API used: JPG Yap
Confidence: medium
Related files: src/super-roo/cpu-guard/AgentLoopGuard.ts, src/super-roo/cpu-guard/**tests**/AgentLoopGuard.test.ts, src/super-roo/cpu-guard/**tests**/autonomousController.test.ts, src/super-roo/cpu-guard/**tests**/cpuGuard.test.ts, src/super-roo/cpu-guard/autonomousController.ts

#### Task Summary

feat(cpu-guard): integrate CPU/RAM-aware agent loop guard with event system, RAM monitoring, and graceful shutdown

#### Files Changed

- `src/super-roo/cpu-guard/AgentLoopGuard.ts`
- `src/super-roo/cpu-guard/__tests__/AgentLoopGuard.test.ts`
- `src/super-roo/cpu-guard/__tests__/autonomousController.test.ts`
- `src/super-roo/cpu-guard/__tests__/cpuGuard.test.ts`
- `src/super-roo/cpu-guard/autonomousController.ts`
- `src/super-roo/cpu-guard/cpuGuard.ts`
- `src/super-roo/cpu-guard/index.ts`
- `src/super-roo/cpu-guard/queue.ts`
- `src/super-roo/index.ts`

#### Bug Cause

Unknown — extracted from commit 7aa9a765.

#### Fix Applied

See commit 7aa9a765 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing

---

### Auto-Extracted Lesson: Feat(product-memory): Add product memory module with parallel execution engine

Date: 2026-05-04 10:18:58 +0800
Source: Git commit 8e0e9e59
Model/API used: JPG Yap
Confidence: medium
Related files: .gitignore, cloud/nginx-dashboard.conf, pnpm-lock.yaml, pnpm-workspace.yaml, server/src/memory/agent-notes.json

#### Task Summary

feat(product-memory): Add product memory module with parallel execution engine

#### Files Changed

- `.gitignore`
- `cloud/nginx-dashboard.conf`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `server/src/memory/agent-notes.json`
- `server/src/memory/bug-feature-map.json`
- `server/src/memory/feature-test-history.json`
- `server/src/memory/product-features.json`
- `server/src/memory/product-updates.json`
- `src/super-roo/index.ts`
- `src/super-roo/orchestrator/SuperRooOrchestrator.ts`
- `src/super-roo/parallel/AgentBus.ts`
- `src/super-roo/parallel/ParallelExecutor.ts`
- `src/super-roo/parallel/ParallelHealingPipeline.ts`
- `src/super-roo/parallel/ParallelMLTrainer.ts`
- `src/super-roo/parallel/__tests__/AgentBus.test.ts`
- `src/super-roo/parallel/__tests__/ParallelExecutor.test.ts`
- `src/super-roo/parallel/__tests__/ParallelHealingPipeline.test.ts`
- `src/super-roo/parallel/__tests__/ParallelMLTrainer.test.ts`
- `src/super-roo/parallel/index.ts`
- `src/super-roo/product-memory/ProductMemoryService.ts`
- `src/super-roo/product-memory/__tests__/ProductMemoryService.test.ts`
- `src/super-roo/product-memory/agents/BugFeatureMapperAgent.ts`
- `src/super-roo/product-memory/agents/FeatureTesterAgent.ts`
- `src/super-roo/product-memory/agents/ProductFeatureAgent.ts`
- `src/super-roo/product-memory/agents/ProductUpdatesAgent.ts`
- `src/super-roo/product-memory/agents/index.ts`
- `src/super-roo/product-memory/index.ts`
- `src/super-roo/product-memory/types.ts`
- `src/tests/cloud/agent-runtime/agentRegistry.test.js`
- `src/tests/cloud/agent-runtime/safety.test.js`
- `src/tests/cloud/agent-runtime/schemaValidator.test.js`
- `superroo-daemon.service`
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx`
- `webview-ui/src/components/super-roo/messaging/protocol.ts`
- `webview-ui/src/components/super-roo/tabs/MemoryLogTab.tsx`
- `webview-ui/src/components/super-roo/tabs/ProductFeaturesTab.tsx`
- `webview-ui/src/components/super-roo/tabs/ProductUpdatesTab.tsx`

#### Bug Cause

Unknown — extracted from commit 8e0e9e59.

#### Fix Applied

See commit 8e0e9e59 by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ui

---

### Auto-Extracted Lesson: Resolve deployment blockers

Date: 2026-05-03 13:00:42 +0800
Source: Git commit f5647deb
Model/API used: JPG Yap
Confidence: medium
Related files: .roo/skills/deployer/SKILL.md, .roo/skills/project-artifact-generator/SKILL.md, .roo/skills/workspace-domain-guard/SKILL.md, apps/web-evals/next-env.d.ts, packages/types/package.json

#### Task Summary

fix: resolve deployment blockers

#### Files Changed

- `.roo/skills/deployer/SKILL.md`
- `.roo/skills/project-artifact-generator/SKILL.md`
- `.roo/skills/workspace-domain-guard/SKILL.md`
- `apps/web-evals/next-env.d.ts`
- `packages/types/package.json`
- `packages/types/src/code-change.ts`
- `packages/types/src/history.ts`
- `packages/types/src/index.ts`
- `packages/types/src/vscode-extension-host.ts`
- `packages/types/src/work-record.ts`
- `src/core/code-change/CodeChangeStore.ts`
- `src/core/code-change/__tests__/CodeChangeStore.spec.ts`
- `src/core/domain-guard/WorkspaceDomainGuard.ts`
- `src/core/domain-guard/__tests__/WorkspaceDomainGuard.spec.ts`
- `src/core/prompts/sections/rules.ts`
- `src/core/task-persistence/TaskHistoryStore.ts`
- `src/core/task-persistence/__tests__/exportWorkRecord.spec.ts`
- `src/core/task-persistence/__tests__/workRecord.spec.ts`
- `src/core/task-persistence/__tests__/workRecord.toolNames.spec.ts`
- `src/core/task-persistence/exportWorkRecord.ts`
- `src/core/task-persistence/index.ts`
- `src/core/task-persistence/taskMetadata.ts`
- `src/core/task-persistence/workRecord.ts`
- `src/core/task/Task.ts`
- `src/core/tools/ApplyDiffTool.ts`
- `src/core/tools/EditTool.ts`
- `src/core/tools/WriteToFileTool.ts`
- `src/core/webview/ClineProvider.ts`
- `src/core/webview/__tests__/skillsMessageHandler.spec.ts`
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`
- `src/core/webview/skillsMessageHandler.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/integrations/misc/process-images.ts`
- `src/package.json`
- `src/services/skills/SkillsManager.ts`
- `src/services/skills/__tests__/SkillsManager.getSkillsForMode.spec.ts`
- `src/services/skills/__tests__/SkillsManager.spec.ts`
- `src/super-roo-host/registerSuperRooCommands.ts`
- `src/super-roo/__tests__/CrawlerAgent.test.ts`
- `src/super-roo/__tests__/SuperRooOrchestrator.test.ts`
- `src/super-roo/__tests__/ml/learners.test.ts`
- `src/super-roo/__tests__/ml/loop.test.ts`
- `src/super-roo/__tests__/ml/metrics.test.ts`
- `src/super-roo/__tests__/ml/tensor.test.ts`
- `src/super-roo/core/SuperRooOrchestrator.ts`
- `src/super-roo/core/__tests__/SuperRooOrchestrator.test.ts`
- `src/super-roo/crawler/CrawlerAgent.ts`
- `src/super-roo/ml/engine/Layer.ts`
- `src/super-roo/ml/engine/Loss.ts`
- `src/super-roo/ml/engine/Metrics.ts`
- `src/super-roo/ml/engine/ModelPersistence.ts`
- `src/super-roo/ml/engine/NeuralNetwork.ts`
- `src/super-roo/ml/engine/Tensor.ts`
- `src/super-roo/ml/engine/index.ts`
- `src/super-roo/ml/learning/CodeLearner.ts`
- `src/super-roo/ml/learning/DebugLearner.ts`
- `src/super-roo/ml/learning/LearnerUtils.ts`
- `src/super-roo/ml/learning/TestLearner.ts`
- `src/super-roo/ml/learning/index.ts`
- `src/super-roo/orchestrator/SuperRooOrchestrator.ts`
- `superroo_files_in_git.txt`
- `tmp_all_git.txt`
- `tmp_git.txt`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/CodeChangesPanel.tsx`
- `webview-ui/src/components/chat/TaskActions.tsx`
- `webview-ui/src/components/chat/__tests__/ChatView.file-attachments.spec.tsx`
- `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`
- `webview-ui/src/components/settings/SkillsSettings.tsx`
- `webview-ui/src/components/settings/__tests__/SkillsSettings.spec.tsx`
- `webview-ui/src/i18n/locales/en/settings.json`

#### Bug Cause

Unknown — extracted from commit f5647deb.

#### Fix Applied

See commit f5647deb by JPG Yap.

#### Test Result

Tests were included in this commit.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

testing, ml-engine, ui, deployment, bugfix

---

### Auto-Extracted Lesson: (super-roo): resolve 7 bugs from autonomous bug crawl

Date: 2026-05-02 22:06:43 +0800
Source: Git commit bc1d9614
Model/API used: JPG Yap
Confidence: medium
Related files: BUG_CRAWL_REPORT_2026-05-02.md, src/super-roo/agents/SelfHealingAgent.ts, src/super-roo/crawler/CrawlerAgent.ts, src/super-roo/deploy/DeployOrchestrator.ts, src/super-roo/healing/HealingBus.ts

#### Task Summary

fix(super-roo): resolve 7 bugs from autonomous bug crawl

#### Files Changed

- `BUG_CRAWL_REPORT_2026-05-02.md`
- `src/super-roo/agents/SelfHealingAgent.ts`
- `src/super-roo/crawler/CrawlerAgent.ts`
- `src/super-roo/deploy/DeployOrchestrator.ts`
- `src/super-roo/healing/HealingBus.ts`
- `src/super-roo/healing/SelfHealingLoop.ts`
- `src/super-roo/import/FileImporter.ts`
- `src/super-roo/ml/loop/InfiniteImprovementLoop.ts`
- `src/super-roo/utils/CancellableSleep.ts`
- `src/super-roo/utils/index.ts`

#### Bug Cause

Unknown — extracted from commit bc1d9614.

#### Fix Applied

See commit bc1d9614 by JPG Yap.

#### Test Result

Unknown — no test files detected.

#### Lesson Learned

To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule

**TODO: Add a specific, actionable rule based on this commit.**

#### Tags

ml-engine, deployment, bugfix

---

### Auto-Extracted Lesson: handle mixed-schema readiness checks, add e2e tests

Date: 2026-05-17
Source: Git commit 65f9882c
Model/API used: JPG Yap
Confidence: medium
Related files: cloud/api/**tests**/test-ollama-growth.test.js, cloud/api/api.js, cloud/dashboard/src/components/views/ollama-growth.tsx

#### Task Summary

fix(ollama-growth): handle mixed-schema readiness checks, add e2e tests

#### Files Changed

- `cloud/api/__tests__/test-ollama-growth.test.js`
- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/ollama-growth.tsx`

#### Bug Cause

Not recorded.

#### Fix Applied

See the linked commit.

#### Test Result

Not recorded.

#### Lesson Learned

Document the durable insight from this change.

#### Reusable Rule

**Add a specific reusable rule before relying on this lesson.**

#### Tags

api, testing, bugfix

---

### Lesson: Comprehensive Gap Analysis and Full-Stack Improvement Execution

Date: 2026-05-17  
Source: DeepSeek task completion  
Model/API used: deepseek-chat  
Confidence: high  
Related files: cloud/api/api.js, src/super-roo/healing/HealingBus.ts, src/super-roo/ml/engine/Layer.ts, src/super-roo/deploy/**tests**/DeployOrchestrator.test.ts, src/super-roo/crawler/**tests**/CrawlerAgent.test.ts, src/super-roo/import/**tests**/FileImporter.test.ts, src/super-roo/lessons/**tests**/LessonRetriever.test.ts, src/super-roo/logging/**tests**/EventLog.test.ts, src/super-roo/healing/**tests**/HealingBus.test.ts, webview-ui/src/components/super-roo/tabs/**tests**/DashboardTab.spec.tsx, docs/super-roo/ONBOARDING_GUIDE.md

#### Task Summary

Scanned the entire SuperRoo codebase (37+ gaps identified across 7 categories), then systematically implemented all improvements across 7 phases: critical bug fixes, missing tests (68 new tests across 5 modules), ML Engine enhancements (dropout rate scheduling), Healing Module enhancements (repair plan execution, detailed metrics, escalation rules), WebView Dashboard wiring verification + tests, i18n/documentation verification, and infrastructure/security (rate limiting).

#### Files Changed

- cloud/api/api.js -- Added in-memory sliding-window rate limiter with IP tracking, X-Forwarded-For support, configurable limits/env vars, health endpoint bypass, and rate limit response headers
- src/super-roo/ml/engine/Layer.ts -- Added dropout rate scheduling (setRate/getRate/resetRate)
- src/super-roo/healing/HealingBus.ts -- Added executeRepairPlan, getRepairPlans, getDetailedHealingMetrics, needsEscalation, getEscalatedIncidents, escalateIncident
- src/super-roo/deploy/**tests**/DeployOrchestrator.test.ts -- 13 new tests (created)
- src/super-roo/crawler/**tests**/CrawlerAgent.test.ts -- 4 new tests (created)
- src/super-roo/import/**tests**/FileImporter.test.ts -- 4 new tests (created)
- src/super-roo/lessons/**tests**/LessonRetriever.test.ts -- 24 tests (rewritten with proper ESM mocking)
- src/super-roo/logging/**tests**/EventLog.test.ts -- 32 new tests (created)
- src/super-roo/healing/**tests**/HealingBus.test.ts -- 12 new tests added (31 total)
- webview-ui/src/components/super-roo/tabs/**tests**/DashboardTab.spec.tsx -- 12 new tests (created)
- docs/super-roo/ONBOARDING_GUIDE.md -- Created comprehensive onboarding guide

#### Bug Cause

N/A -- improvement task, not bug fix

#### Fix Applied

N/A

#### Test Result

pass -- 68 new tests across 5 backend modules + 12 WebView dashboard tests = 80 total new tests, all passing

#### Lesson Learned

When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.

#### Reusable Rule

Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.

#### Tags

gap-analysis, testing, rate-limiting, healing-module, ml-engine, documentation, i18n, infrastructure

---

### Auto-Extracted Lesson: Feat(intelligence-layer): fix data accuracy, add 6 new panels, improve Ollama...

Date: 2026-05-17
Source: Git commit 4d2f655f
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/app/page.tsx, cloud/dashboard/src/components/views/intelligence-layer.tsx, cloud/orchestrator/modules/HermesClaw.js

#### Task Summary

feat(intelligence-layer): fix data accuracy, add 6 new panels, improve Ollama scoring

#### Files Changed

- `cloud/api/api.js`
- `cloud/dashboard/src/app/page.tsx`
- `cloud/dashboard/src/components/views/intelligence-layer.tsx`
- `cloud/orchestrator/modules/HermesClaw.js`

#### Bug Cause

<!-- TODO: Document what caused the issue -->

Unknown — extracted from commit 4d2f655f.

#### Fix Applied

<!-- TODO: Document the solution -->

See commit 4d2f655f by JPG Yap.

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

### Auto-Extracted Lesson: Feat(gap-analysis): comprehensive full-stack improvements across 7 phases

Date: 2026-05-17
Source: Git commit a1475162
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, docs/super-roo/ONBOARDING_GUIDE.md, memory/lessons-learned.md, src/super-roo/crawler/__tests__/CrawlerAgent.test.ts, src/super-roo/deploy/__tests__/DeployOrchestrator.test.ts

#### Task Summary
feat(gap-analysis): comprehensive full-stack improvements across 7 phases

#### Files Changed
- `cloud/api/api.js`
- `docs/super-roo/ONBOARDING_GUIDE.md`
- `memory/lessons-learned.md`
- `src/super-roo/crawler/__tests__/CrawlerAgent.test.ts`
- `src/super-roo/deploy/__tests__/DeployOrchestrator.test.ts`
- `src/super-roo/healing/HealingBus.ts`
- `src/super-roo/healing/__tests__/HealingBus.test.ts`
- `src/super-roo/import/__tests__/FileImporter.test.ts`
- `src/super-roo/lessons/LearningClient.ts`
- `src/super-roo/lessons/__tests__/LessonRetriever.test.ts`
- `src/super-roo/logging/__tests__/EventLog.test.ts`
- `src/super-roo/ml/engine/Layer.ts`
- `src/super-roo/types/index.ts`
- `webview-ui/src/components/super-roo/tabs/__tests__/DashboardTab.spec.tsx`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit a1475162.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit a1475162 by JPG Yap.

#### Test Result
Tests were included in this commit.

#### Lesson Learned
<!-- TODO: Extract reusable lesson -->
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
<!-- TODO: Define a specific rule for future agents -->
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
testing, ml-engine, ui, api, deployment

---

### Auto-Extracted Lesson: Feat(gap-analysis): comprehensive full-stack improvements across 7 phases

Date: 2026-05-17
Source: Git commit faa919c9
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, docs/super-roo/ONBOARDING_GUIDE.md, memory/lessons-learned.md, src/super-roo/crawler/__tests__/CrawlerAgent.test.ts, src/super-roo/deploy/__tests__/DeployOrchestrator.test.ts

#### Task Summary
feat(gap-analysis): comprehensive full-stack improvements across 7 phases

#### Files Changed
- `cloud/api/api.js`
- `docs/super-roo/ONBOARDING_GUIDE.md`
- `memory/lessons-learned.md`
- `src/super-roo/crawler/__tests__/CrawlerAgent.test.ts`
- `src/super-roo/deploy/__tests__/DeployOrchestrator.test.ts`
- `src/super-roo/healing/HealingBus.ts`
- `src/super-roo/healing/__tests__/HealingBus.test.ts`
- `src/super-roo/import/__tests__/FileImporter.test.ts`
- `src/super-roo/lessons/LearningClient.ts`
- `src/super-roo/lessons/__tests__/LessonRetriever.test.ts`
- `src/super-roo/logging/__tests__/EventLog.test.ts`
- `src/super-roo/ml/engine/Layer.ts`
- `src/super-roo/types/index.ts`
- `webview-ui/src/components/super-roo/tabs/__tests__/DashboardTab.spec.tsx`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit faa919c9.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit faa919c9 by JPG Yap.

#### Test Result
Tests were included in this commit.

#### Lesson Learned
<!-- TODO: Extract reusable lesson -->
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
<!-- TODO: Define a specific rule for future agents -->
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
testing, ml-engine, ui, api, deployment

---

### Auto-Extracted Lesson: Feat: add learning layer curation workflow

Date: 2026-05-17
Source: Git commit 61043e28
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/intelligence-layer.tsx, cloud/orchestrator/CloudOrchestrator.js, cloud/orchestrator/modules/LearningGateway.js, cloud/orchestrator/modules/LearningPolicy.js

#### Task Summary
feat: add learning layer curation workflow

#### Files Changed
- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/intelligence-layer.tsx`
- `cloud/orchestrator/CloudOrchestrator.js`
- `cloud/orchestrator/modules/LearningGateway.js`
- `cloud/orchestrator/modules/LearningPolicy.js`
- `cloud/orchestrator/modules/TaskExecutor.js`
- `cloud/orchestrator/stores/BugKnowledgeStore.js`
- `cloud/worker/agentRunners.js`
- `docs/intelligence-layer/learning-gateway.md`
- `memory/lesson-index.jsonl`
- `scripts/extract-lesson-from-commit.mjs`
- `scripts/lesson-capture.mjs`
- `scripts/ml/build-agent-context.mjs`
- `scripts/regenerate-lesson-index.mjs`
- `src/super-roo/lessons/LessonRetriever.ts`
- `src/super-roo/lessons/PromptEnhancer.ts`
- `src/super-roo/lessons/index.ts`
- `src/tests/cloud/learning-gateway.test.js`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit 61043e28.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit 61043e28 by JPG Yap.

#### Test Result
Tests were included in this commit.

#### Lesson Learned
<!-- TODO: Extract reusable lesson -->
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
<!-- TODO: Define a specific rule for future agents -->
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
testing, ml-engine, api

---

### Auto-Extracted Lesson: (dashboard): skip ESLint during build, fix memory-limited VPS builds

Date: 2026-05-17
Source: Git commit 49285962
Model/API used: unknown
Confidence: medium
Related files: cloud/dashboard/next.config.js

#### Task Summary
fix(dashboard): skip ESLint during build, fix memory-limited VPS builds

#### Files Changed
- `cloud/dashboard/next.config.js`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit 49285962.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit 49285962 by JPG Yap.

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

### Auto-Extracted Lesson: Feat: complete Codex's learning layer release + security hardening + telegram...

Date: 2026-05-17
Source: Git commit 43376e24
Model/API used: unknown
Confidence: medium
Related files: .codex/config.toml, .roo/skills/deepseek-api/SKILL.md, .roo/skills/lesson-sync/SKILL.md, AGENTS.md, cloud/.env.example

#### Task Summary
feat: complete Codex's learning layer release + security hardening + telegram improvements

#### Files Changed
- `.codex/config.toml`
- `.roo/skills/deepseek-api/SKILL.md`
- `.roo/skills/lesson-sync/SKILL.md`
- `AGENTS.md`
- `cloud/.env.example`
- `cloud/api/api.js`
- `cloud/api/telegramBot.js`
- `cloud/dashboard/test-results/ide-terminal-IDE-Terminal--38fca-nt-panel-toggles-open-close-chromium/error-context.md`
- `cloud/dashboard/test-results/ide-terminal-IDE-Terminal--3bc66-is-focused-not-AI-textarea--chromium/error-context.md`
- `cloud/dashboard/test-results/ide-terminal-IDE-Terminal--d7774-ste-works-in-terminal-input-chromium/error-context.md`
- `cloud/dashboard/test-results/ide-terminal-IDE-Terminal-page-loads-and-renders-terminal-UI-chromium/error-context.md`
- `cloud/ecosystem.config.js`
- `cloud/orchestrator/TelegramOrchestratorBridge.js`
- `cloud/orchestrator/modules/FeatureAnswerer.js`
- `cloud/remote-deploy-dashboard.sh`
- `memory/central-brain-store-log.json`
- `memory/context/latest-agent-context.md`
- `memory/learning-events.jsonl`
- `memory/lesson-index.jsonl`
- `memory/lessons-learned.md`
- `memory/skill-promotion-candidates.jsonl`
- `scripts/backfill-lessons.mjs`
- `server/src/memory/codextask.json`
- `server/src/memory/commit-deploy-log.json`
- `server/src/memory/kimi.json`
- `src/core/prompts/responses.ts`
- `src/telegram/bot.ts`
- `webview-ui/src/components/chat/ChatRow.tsx`
- `webview-ui/src/i18n/locales/en/chat.json`
- `{try{const`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit 43376e24.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit 43376e24 by JPG Yap.

#### Test Result
Unknown — no test files detected.

#### Lesson Learned
<!-- TODO: Extract reusable lesson -->
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
<!-- TODO: Define a specific rule for future agents -->
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
testing, ui, api, deployment

---

### Auto-Extracted Lesson: (intelligence-layer): normalize model names, fix lessonsByDay grouping, add b...

Date: 2026-05-17
Source: Git commit 2fac5c57
Model/API used: unknown
Confidence: medium
Related files: cloud/api/api.js, cloud/dashboard/src/components/views/intelligence-layer.tsx, cloud/orchestrator/modules/LearningGateway.js

#### Task Summary
fix(intelligence-layer): normalize model names, fix lessonsByDay grouping, add brain offline flag

#### Files Changed
- `cloud/api/api.js`
- `cloud/dashboard/src/components/views/intelligence-layer.tsx`
- `cloud/orchestrator/modules/LearningGateway.js`

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit 2fac5c57.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit 2fac5c57 by JPG Yap.

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

### Lesson: Complete Codex's Unfinished Learning Layer Release + Security Hardening

Date: 2026-05-17
Source: Roo task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/ecosystem.config.js, cloud/orchestrator/TelegramOrchestratorBridge.js, cloud/orchestrator/modules/FeatureAnswerer.js, src/core/prompts/responses.ts, webview-ui/src/components/chat/ChatRow.tsx, src/telegram/bot.ts, .roo/skills/deepseek-api/SKILL.md, AGENTS.md, .codex/config.toml, server/src/memory/codextask.json

#### Task Summary
Completed Codex's unfinished "learning layer release" task: committed and deployed 19 uncommitted files including security hardening (secrets moved to env vars), telegram improvements (per-chat rate limiting, Ollama chat client, env-var-ized URLs, fixed agent routing), file attachment display in ChatRow, DeepSeek V4 model configs, and learning layer workflow updates.

#### Files Changed
- cloud/api/telegramBot.js - Fixed DASHBOARD_URL literal string bug (3 occurrences), added per-chat rate limiting, _callOllamaChat, env-var-ized URLs, fixed agent routing
- cloud/ecosystem.config.js - Moved secrets from hardcoded to process.env
- cloud/orchestrator/TelegramOrchestratorBridge.js - Added tgTaskId, agentId, source metadata
- cloud/orchestrator/modules/FeatureAnswerer.js - Fixed Ollama env var priority
- src/core/prompts/responses.ts - Added formatFileAttachments function
- webview-ui/src/components/chat/ChatRow.tsx - Added file attachment display
- src/telegram/bot.ts - Fixed bot username extraction
- .roo/skills/deepseek-api/SKILL.md - Added V4 Flash/V4 Pro model configs
- AGENTS.md - Updated learning layer sync and lesson capture workflow
- .codex/config.toml - Removed duplicate sections
- server/src/memory/codextask.json - Marked task as completed

#### Bug Cause
Codex's env-var-ized DASHBOARD_URL was used as a literal string in template/message strings instead of being interpolated via template literals, causing broken URLs in Telegram bot messages.

#### Fix Applied
Replaced all 3 occurrences of literal "DASHBOARD_URL" with `${DASHBOARD_URL}` template literal interpolation.

#### Test Result
pass - All 7 PM2 services online after deployment

#### Lesson Learned
When env-var-izing hardcoded URLs, always search for ALL usages of the old value — including string concatenation and template literals. A variable declaration change without updating all consumers creates silent bugs that manifest as broken links in production.

#### Reusable Rule
When converting a hardcoded string to a runtime variable in JavaScript, always use a regex search for the exact old string value across the entire file to catch all string literal usages that need template literal interpolation.

#### Tags
codex, learning-layer, telegram, security, env-vars, bugfix

---

### Auto-Extracted Lesson: add Claude task tracking system (claudetask.json + MCP actions + CLAUDE.md)

Date: 2026-05-17
Source: Git commit 99b7468f
Model/API used: JPG Yap
Confidence: medium
Related files: CLAUDE.md, server/src/memory/McpMemoryServer.ts, server/src/memory/claudetask.json

#### Task Summary
feat: add Claude task tracking system (claudetask.json + MCP actions + CLAUDE.md)

#### Files Changed
- `CLAUDE.md`
- `server/src/memory/McpMemoryServer.ts`
- `server/src/memory/claudetask.json`

#### Bug Cause
Not recorded.

#### Fix Applied
See the linked commit.

#### Test Result
Not recorded.

#### Lesson Learned
Document the durable insight from this change.

#### Reusable Rule
**Add a specific reusable rule before relying on this lesson.**

#### Tags
learning-layer

---
