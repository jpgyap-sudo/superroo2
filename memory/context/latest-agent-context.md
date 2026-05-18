# Latest Agent Context

Generated: 2026-05-18T02:22:46.116Z
Task: verify live memory explorer tab end to end and improve backend frontend wiring

## Relevant Lessons

1. **Protected dashboard views must use authenticated fetches and canonical data sources**
    - Rule: For protected dashboard endpoints, reuse the authenticated request pattern already used elsewhere in the app, and point new views at the canonical backend data source rather than a one-off legacy file.
    - Why: A dashboard route can exist and still fail if the frontend omits the expected auth contract or reads from an obsolete source. Verify the integration boundary, not just file presence.
2. **Production deploys must keep source and dependency manifests in sync**
    - Rule: When production source files change together with dependencies, deploy the matching `package.json` and verify generated runtime artifacts exist before declaring recovery complete.
    - Why: Hotfixes can restore one failing layer while leaving another stale layer broken. For production recovery, validate the runtime artifact set as well as the source change, especially when a deploy spans both app code and dependency manifests.
3. **TOML Duplicate Table Key in Codex Config**
    - Rule: Before adding a new `[table]` section to any `.toml` config file, grep for existing instances of that table name and merge keys into the existing section rather than creating a duplicate.
    - Why: When adding new configuration keys to TOML files, always check if the table already exists. Appending a duplicate `[table]` header will break parsing.
4. **Comprehensive Gap Analysis and Full-Stack Improvement Execution**
    - Rule: Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.
    - Why: When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.
5. **Claude Task Tracking System — MCP Memory Server Integration**
    - Rule: When adding a new agent type to the MCP Memory Server, always add all 8 integration points in order: constant → interfaces → tool definitions → handlers → resource → search → helpers → agent config file. Missing any one breaks the full workflow.
    - Why: When adding a new agent task tracking system to the MCP Memory Server, follow the exact pattern of existing agent implementations (Codex → Kimi → Claude). Each agent needs: (1) a JSON log file, (2) a path constant, (3) TypeScript interfaces, (4) 4 MCP tool definitions in \_registerTools(), (5) handler cases in \_handleToolCall(), (6) a resource endpoint in \_registerResources(), (7) the JSON file added to \_searchLocalMemory(), and (8) 6 helper methods (read, write, upsert, list, get, getActive). The CLAUDE.md file follows the same pattern as .codex/config.toml for Codex.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

The SuperRoo system is organized into **18 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.
│ ├── Repair Plan Builder (structured fix generation)
│ └── Infinite Improvement Loop (continuous learning)

- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping
    - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation

### 10. Machine Learning Engine

- **Features**: Neural network training, Code pattern learning, Debug pattern learning, Test pattern learning, Infinite improvement loop - **Learners** ([`src/super-roo/ml/learning/`](../src/super-roo/ml/learning/)) - CodeLearner, DebugLearner, TestLearner - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
  Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

## Task Signals

Inferred tags: ui, learning

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
