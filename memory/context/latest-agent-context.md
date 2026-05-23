# Latest Agent Context

Generated: 2026-05-23T00:08:37.634Z
Task: add website flowcharts tab with diagrams for telegram debug team cloud ide and key app features

## Relevant Lessons

1. **Advanced Features Gap Fix — 28 Gaps Across 9 Modules**
    - Rule: Before claiming a module has 'no tests', run `find src/MODULE -name '*.test.ts'` and check all subdirectories. The test coverage may be partial, not zero.
    - Why: Fixed all identified gaps in SuperRoo's advanced features across 9 modules: 4 dashboard views created, 4 API endpoints added, 186 tests added across 4 test files, 5 cross-module integrations wired, 5 documentation files written, 1 source bug fixed (MLSyncClient double re-queue on HTTP error).
2. **Telegram Bot Frictionless Coding & Context Awareness Improvements**
    - Rule: Hide manual approval UI in auto-mode; use persistent reply keyboards; pass conversation context to classifiers; bound typing indicators with timeouts; handle new callbacks in both notifier and bot routing.
    - Why: Fixed auto-mode UX confusion by hiding approval buttons when auto-chaining, added phase-transition progress messages, persistent reply keyboard, typing indicators, similar/audit buttons, and enhanced classifier with conversation context.
3. **Swap Ollama to DeepSeek API for context summarization**
    - Rule: For context summarization in agent workflows, prefer a cloud API (DeepSeek, OpenAI) over local models smaller than 3B parameters. Add a lightweight .env loader (no npm dependency) for API keys. Always include graceful degradation (skip if API key missing).
    - Why: Ollama 0.5B produced poor-quality summaries (hallucinated bugs, truncated text). Swapping to DeepSeek API via standard HTTPS fetch() produced accurate, detailed summaries for all 6 phases. Added loadEnvFile() to read .env without dotenv dependency. DeepSeek API costs (~$0.14/M tokens) are negligible compared to Claude tokens saved by pre-compressed context.
4. **PM2 env_block overrides env_file - hardcode vault keys directly in ecosystem.config.js**
    - Rule: When configuring PM2 ecosystem.config.js, NEVER use `process.env.X || ""` in the `env` block for critical secrets that are defined in `env_file`. The `env` block takes precedence over `env_file`. Either hardcode the value directly, or ensure the variable is set in the shell environment before `pm2 start`. Always verify with `cat /proc/<pid>/environ | tr '\0' '\n' | grep KEY_NAME` after restart.
    - Why: PM2 env_file directive is unreliable. The env block process.env.X patterns override .env values with empty strings. Fixed by hardcoding SUPERROO_VAULT_KEY directly. Also fixed: shutdown handler, classifier prompt, markdown stripping, button URL validation, missing pg module.
5. **Production deploys must keep source and dependency manifests in sync**
    - Rule: When production source files change together with dependencies, deploy the matching `package.json` and verify generated runtime artifacts exist before declaring recovery complete.
    - Why: Hotfixes can restore one failing layer while leaving another stale layer broken. For production recovery, validate the runtime artifact set as well as the source change, especially when a deploy spans both app code and dependency manifests.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

# SuperRoo Working Tree

> **Purpose**: This document is the single source of truth for the SuperRoo product architecture. All agents should read this to understand the system structure, module interactions, and product features before making changes.

## Overview

The SuperRoo system is organized into **21 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, cloud sandbox, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.

## Module Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                                 │
│  Task dispatch, agent lifecycle, workflow orchestration             │
└──────────┬────────────────────────────────────────────────┬─────────┘
           │ routes tasks to                                  │ manages
           ▼                                                 ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│   AGENT SYSTEM   │  │   SAFETY SYSTEM  │  │      TASK QUEUE          │
│  Coder, Debugger │◄─┤  Mode-based ACL  │  │  Priority-based queue    │
│  PM, Tester, ... │  │  Capability gate │  │  BullMQ integration      │
└────────┬─────────┘  └──────────────────┘  └──────────────────────────┘
         │
         ├──► MEMORY SYSTEM (SQLite persistence for all entities)
         ├──► FEATURE REGISTRY (Feature lifecycle & health tracking)
         ├──► BUG REGISTRY (Bug tracking & fix management)
         ├──► EVENT LOG (Append-only event stream for observability)
         │

### DeepSeek Architecture Summary

The **Orchestrator** and **Agent System** (specifically the Debugger agent) are the primary modules affected, as the flowcharts tab will visualize task dispatch and agent lifecycle workflows. The **Memory System** (SQLite) and **Event Log** must provide persistence and observability data for diagram generation, while the **Cloud Sandbox** and **Task Queue** (BullMQ) constrain real-time diagram updates through their priority and execution boundaries.


## Task Signals
No strong task tags inferred.

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

The bug entries reveal a recurring pattern of unsafe `JSON.parse()` usage across multiple registry modules (`BugRegistry`, `TaskQueue`, `FeatureRegistry`, `MemoryStore`), causing crashes on corrupted database rows. Root cause is the lack of a safe fallback for JSON parsing. Fix involves adding a `safeJsonParse` helper to each affected file, with `HealingBus.ts` already having it and receiving enhanced usage.


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

For the "add website flowcharts tab" task, the **kimi-k2.5** model was chosen for implementing the model routing service (`modelRouterService.ts`) due to its high confidence in handling cost, quality, and speed tradeoffs across task types. This decision ensures optimal provider/model pair mapping for features like Telegram debug, cloud IDE, and key app flows.



### DeepSeek File Summaries

- **cloud\dashboard\src\components\views\parallel-execution.tsx**: This file exports a `ParallelExecutionView` component that displays real-time parallel execution statistics for the orchestrator. It fetches data from `/api/orchestrator/parallel/stats` every 10 seconds, mapping backend fields to a frontend interface with concurrency limits, token budgets, and agent costs. The component follows a pattern of loading/error states with retry functionality, using Shadcn UI components and Lucide icons consistent with the dashboard's design system.
- **cloud\dashboard\src\components\views\autonomous-loop.tsx**: This file exports the `AutonomousLoopView` component, which displays and controls the autonomous loop system (a cyclic process of audit, fix, test, simulate, improve, learn, dashboard, commit, deploy, health-check). It fetches status from `/api/autonomous/status` every 5 seconds and provides start/stop controls via POST to `/api/autonomous/start` and `/api/autonomous/stop`. Key patterns include: using `useCallback` for fetch functions, `useEffect` with polling interval, loading/error states, and a typed `AutonomousStatus` interface with `StepResult` array for step-by-step progress tracking.

```
