# Latest Agent Context

Generated: 2026-05-20T01:20:28.482Z
Task: Improve Compliance tab with learning-layer health, lesson quality, hook verification, bridge checks, and malformed workflow record handling

## Relevant Lessons
1. **Feat: comprehensive improvements across ML Engine, Healing Module, VPS stability, docs, and Central Brain sync**
   - Rule: After extending a shared union type, search for ALL Record<UnionType, ...> maps and switch statements that exhaustively match on that type, and update them before committing. Run tsc --noEmit to catch these errors early.
   - Why: Comprehensive improvements across ML Engine (CosineAnnealingScheduler, DropoutScheduler, Conv2D, MaxPool2D, Flatten, ModelCheckpoint tests), Healing Module (repair tracking, per-category escalation, notification routing, circuit breaker), VPS stability (Docker/PM2 port conflict resolution), Central Brain sync (200/239 lessons), and documentation updates.
2. **Repo-wide Ollama audit - replaced stale model refs and fetch() calls with curl helper**
   - Rule: After changing a model name or connectivity pattern, run findstr /sni old-model-name * across the entire repo and update every match. Also search for the old API pattern (e.g., fetch.*ollama.*api/generate) to catch scripts that need the curl helper.
   - Why: Systematic repo-wide audit found 9 files with stale Ollama model references or fetch() calls to Tailscale IPs. Fixed all to use curl-based helper and qwen2.5:0.5b model.
3. **Comprehensive Gap Analysis and Full-Stack Improvement Execution**
   - Rule: Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.
   - Why: When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.
4. **Complete Codex's Unfinished Learning Layer Release + Security Hardening**
   - Rule: When converting a hardcoded string to a runtime variable in JavaScript, always use a regex search for the exact old string value across the entire file to catch all string literal usages that need template literal interpolation.
   - Why: When env-var-izing hardcoded URLs, always search for ALL usages of the old value — including string concatenation and template literals. A variable declaration change without updating all consumers creates silent bugs that manifest as broken links in production.
5. **Cross-Project Learning Layer — Sync Script, Retry Queue, and Systemd Timer**
   - Rule: When deploying systemd timers for cron-like tasks: use `OnCalendar=hourly`, `Persistent=true` to catch missed runs, `RandomizedDelaySec=5min` to spread load, and always run an initial sync after enabling to verify the service works end-to-end.
   - Why: When building infrastructure for cross-project learning, always verify the fallback paths work on all target OSes (Windows paths differ from Unix paths). The 3-layer fallback architecture (local JSONL → Central Brain MCP → markdown) provides graceful degradation — no single point of failure. Systemd timers with RandomizedDelaySec prevent thundering herd on Central Brain.


## Active Codex Tasks
- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder
The SuperRoo system is organized into **18 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.
         │     └── Infinite Improvement Loop (continuous learning)
### 10. Machine Learning Engine
- **Features**: Neural network training, Code pattern learning, Debug pattern learning, Test pattern learning, Infinite improvement loop
    - **Learners** ([`src/super-roo/ml/learning/`](../src/super-roo/ml/learning/)) - CodeLearner, DebugLearner, TestLearner

### DeepSeek Architecture Summary

The Compliance tab improvement affects the **Machine Learning Engine** module, specifically its **Learners** (`CodeLearner`, `DebugLearner`, `TestLearner`) in `src/super-roo/ml/learning/`. These learners connect to the **Infinite Improvement Loop** for continuous learning, which must be integrated with hook verification and bridge checks. Architecture constraints include ensuring malformed workflow records are handled without breaking the learning pipeline and that lesson quality metrics align with the existing neural network training features.


## Task Signals
Inferred tags: learning

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

Multiple registry modules (BugRegistry, TaskQueue, FeatureRegistry, MemoryStore) crashed on corrupted database rows due to unsafe `JSON.parse()` calls. The fix introduced a `safeJsonParse` helper across all affected files, with enhanced usage in HealingBus. This pattern is directly relevant to your compliance tab work, especially for malformed workflow record handling and lesson quality checks.


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

For the Compliance tab improvements, the key decision was to use **kimi-k2.5** as the model for task-based routing in the model router service, chosen for its optimal balance of cost, quality, and speed. This model is mapped to specific task types (like lesson quality and hook verification) via `modelRouterService.ts`, ensuring efficient handling of compliance checks without over-provisioning resources.



### DeepSeek File Summaries

- **.claude\settings.json**: This file is a Claude Code configuration (`settings.json`) that defines allowed permissions for tool execution. It exports no code—its sole purpose is to whitelist specific Bash commands (e.g., `ssh`, `git`, `curl`, `scp`, `rsync`) and Vercel MCP tools for deployment and log retrieval. For your compliance task, note that this file restricts which shell commands and external integrations are permitted, so any new compliance logic (e.g., hook verification, bridge checks) must operate within these allowed actions or require a permissions update.
- **.codex\config.toml**: This file exports a TOML configuration for the SuperRoo Codex project, defining approval policy, sandbox mode, model assignments (planner=codex, coder=deepseek, reviewer=codex, memory=ollama), and a default agent flow. Its main purpose is to configure Codex to work with the MCP Codex Bridge for invoking DeepSeek and Ollama tools via CLI commands, enabling lesson retrieval, context building, and memory operations. Key patterns include using `node scripts/mcp-codex-bridge.mjs` for all tool calls, pre-task context building via `scripts/ml/build-agent-context.mjs`, and lesson retrieval via `LessonRetriever` with task type, file path, and tag queries—relevant for improving compliance tab features like learning-layer health and lesson quality.

