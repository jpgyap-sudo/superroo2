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

#### Test Result

Tests pass. Bug testing plan documented this as fixed.

#### Lesson Learned

Always use safe JSON parsing with fallback values when reading from persistent storage. Database corruption can happen at any time; code should be resilient.

#### Reusable Rule

**All registry modules MUST use safeJsonParse() instead of raw JSON.parse() when reading from database.**

#### Tags

memory, database, json, error-handling, superroo-core, crash-prevention

---

### Legacy Lesson: Tensor Division by Zero

Date: 2026-04-30
Source: Roo Code legacy session  
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/engine/Tensor.ts

#### Task Summary

Fixed ML engine bug where `Tensor.div(0)` returns Infinity values that silently corrupt neural network training.

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

ml-engine, tensor, neural-network, math, nan-prevention

---

### Legacy Lesson: Tensor sqrt on Negative Values

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/engine/Tensor.ts (line 231-234)

#### Task Summary

Fixed bug where `Tensor.sqrt()` on negative values produces NaN, silently corrupting downstream computations.

#### Bug Cause

`sqrt()` applies `Math.sqrt()` element-wise without checking for negative values. In neural networks with ReLU/LReLU, negative activations are common. NaN silently corrupts downstream computations.

#### Fix Applied

Clamp negative inputs to >=0 or use `Math.sqrt(Math.max(0, x))`.

#### Test Result

Unknown — migrated from legacy Roo Code history.

#### Lesson Learned

Mathematical operations on ML tensors must handle domain errors. NaN propagation invalidates all downstream results.

#### Reusable Rule

**Tensor.sqrt() MUST clamp negative values to zero before applying square root.**

#### Tags

ml-engine, tensor, math, nan-prevention

---

### Legacy Lesson: Tensor log on Non-Positive Values

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/engine/Tensor.ts (line 237-240)

#### Task Summary

Fixed bug where `Tensor.log()` on negative values produces NaN (though log(0) was guarded with +1e-8).

#### Bug Cause

While `log(0)` was guarded, negative values still produce `NaN`. This is relevant for gradient computations.

#### Fix Applied

Added validation for negative inputs in log operations.

#### Test Result

Unknown — migrated from legacy Roo Code history.

#### Tags

ml-engine, tensor, math, nan-prevention

---

### Legacy Lesson: Intent-to-Agent Routing Bug

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

### Legacy Lesson: Terminal Output Import Path

Date: 2026-05-17
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx

#### Task Summary

Fixed incorrect import path for terminal output component that caused build failure.

#### Files Changed

- `webview-ui/src/components/super-roo/tabs/ide-terminal/TerminalPane.tsx`

#### Bug Cause

Import path was incorrect after refactoring, causing module resolution failure.

#### Fix Applied

Corrected import path to match actual file location.

#### Test Result

Build now succeeds.

#### Tags

typescript, imports, build, refactoring

---

### Legacy Lesson: PM2 Process Name Mapping

Date: 2026-05-09
Source: Roo Code legacy session
Model/API used: unknown
Confidence: medium
Related files: cloud/api/lib/terminalCore.js, cloud/worker/agentRunners.js

#### Task Summary

Fixed PM2 process name mapping where short names like 'api', 'worker', 'dashboard' didn't map to actual PM2 process names.

#### Files Changed

- Terminal core readLogs function
- Worker restart function

#### Bug Cause

Users would reference processes by short names but PM2 used full prefixed names (superroo-api, superroo-worker). This caused "process not found" errors.

#### Fix Applied

Added mapping logic to convert short names to full PM2 process names before executing PM2 commands.

#### Test Result

Verified working in production.

#### Tags

pm2, deployment, process-management

---

### Legacy Lesson: Terminal Output Buffer Memory Leak

Date: 2026-02-20 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: unknown
Confidence: high
Related files: src/integrations/terminal/\*

#### Task Summary

Fixed memory leak in terminal output buffers causing gray screens and performance degradation.

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

### Legacy Lesson: Settings cachedState Race Condition

Date: 2026-05-01
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: webview-ui/src/components/settings/SettingsView.tsx

#### Task Summary

Fixed race conditions in settings by ensuring inputs bind to cachedState, not live extension state.

#### Bug Cause

Inputs were wired directly to live `useExtensionState()`, causing race conditions between user edits and ContextProxy updates.

#### Fix Applied

Inputs now bind to local `cachedState` which acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save".

#### Test Result

Race conditions eliminated in settings UI.

#### Tags

vscode-extension, react, state-management, race-condition

---

### Legacy Lesson: InfiniteImprovementLoop NaN Loss Handling

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/ml/loop/InfiniteImprovementLoop.ts (lines 163-185)

#### Task Summary

Fixed ML training loop to properly handle NaN losses that indicate model corruption.

#### Bug Cause

When all training losses are NaN, the loop would warn but continue training, wasting cycles on corrupted models.

#### Fix Applied

Added detection for all-NaN loss arrays and proper handling (stopping training with actionable warning).

#### Test Result

Unknown — migrated from legacy Roo Code history.

#### Tags

ml-engine, training, nan-detection, infinite-loop

---

### Legacy Lesson: Missing RegisterCommand Mock

Date: 2026-05-01 (from CODERS_CHANGELOG)
Source: Roo Code legacy session
Model/API used: Code Assistant (kimi-k2.5)
Confidence: high
Related files: src/**tests**/extension.spec.ts

#### Task Summary

Fixed failing extension tests by adding missing registerCommand mock.

#### Bug Cause

Tests were failing because vscode.commands.registerCommand was not mocked.

#### Fix Applied

Added registerCommand mock to vscode.commands mock.

#### Test Result

All 5,658 tests now passing.

#### Tags

testing, mocking, vscode-extension

---
