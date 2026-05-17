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
