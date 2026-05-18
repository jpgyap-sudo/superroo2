# Latest Agent Context

Generated: 2026-05-18T07:08:37.504Z
Task: repair dashboard next install and continue dashboard improvements

## Relevant Lessons

1. **Comprehensive Gap Analysis and Full-Stack Improvement Execution**
    - Rule: Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.
    - Why: When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.
2. **Repair malformed JSX at the first broken boundary before chasing follow-on parser errors**
    - Rule: For JSX parse cascades, inspect the first reported malformed element and nearby unmatched closing tags before making broad edits elsewhere in the file.
    - Why: A malformed rollback button and mismatched closing tag caused a JSX parser cascade; fixing the earliest broken boundary restored the file and exposed the next real compiler issue.
3. **A missing pnpm package payload can masquerade as a React runtime bug**
    - Rule: For startup-time React/Next failures, verify require.resolve, package symlink targets, and actual package contents before assuming a version mismatch.
    - Why: The dashboard build failed before app code because the local pnpm store had an empty react@18.3.1 payload; inspecting package contents revealed install corruption rather than a framework incompatibility.
4. **Next.js dev WebSocket proxying, Redis NoopQueue fallback, LSP Bridge Backend**
    - Rule: Next.js rewrites do not proxy WebSocket upgrades. In dev, connect WS directly to the API server. Make Redis optional in dev with a NoopQueue fallback. LSP stdio requires Content-Length JSON-RPC framing with buffered reads.
    - Why: Implemented full LSP Bridge Backend for Cloud IDE, fixed Next.js dev WebSocket proxy issue by connecting directly to API port, and eliminated Redis reconnect loops in dev via NoopQueue fallback.
5. **Overview dashboards should summarize canonical live sources, not parallel mock state**
    - Rule: For dashboard overview surfaces, derive summaries from existing canonical endpoints, prioritize exceptions and next actions, and avoid hard-coded operational metrics once live sources exist.
    - Why: Overview pages earn trust when they compose canonical live sources into decisions and next actions instead of mixing a few live values with hard-coded operational panels.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

         │     ├── Repair Plan Builder (structured fix generation)

- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
  Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

## Task Signals

Inferred tags: ui

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
