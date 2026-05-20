# Latest Agent Context

Generated: 2026-05-20T10:13:10.921Z
Task: Fix Telegram View Diff to open dashboard and persist/show real diffs

## Relevant Lessons

1. **Repair malformed JSX at the first broken boundary before chasing follow-on parser errors**
    - Rule: For JSX parse cascades, inspect the first reported malformed element and nearby unmatched closing tags before making broad edits elsewhere in the file.
    - Why: A malformed rollback button and mismatched closing tag caused a JSX parser cascade; fixing the earliest broken boundary restored the file and exposed the next real compiler issue.
2. **Audit views should preserve rich history fields instead of flattening them away**
    - Rule: When presenting canonical history records, normalize naming differences but preserve semantically important fields like start/end time, duration, environment, and failure cause instead of flattening them into decorative summaries.
    - Why: The Commit & Deploy Log adapter discarded fields that already existed in the canonical log; preserving them restored real audit value without inventing new data.
3. **Production deploys must keep source and dependency manifests in sync**
    - Rule: When production source files change together with dependencies, deploy the matching `package.json` and verify generated runtime artifacts exist before declaring recovery complete.
    - Why: Hotfixes can restore one failing layer while leaving another stale layer broken. For production recovery, validate the runtime artifact set as well as the source change, especially when a deploy spans both app code and dependency manifests.
4. **Intent-to-Agent Routing Fix**
    - Rule: Always verify intent-to-agent routing with real user queries. Add classifier feedback loops to detect and correct routing errors.
    - Why: Intent classification must be continuously validated against actual outcomes. Routing mismatches cause user frustration and wasted compute cycles.
5. **Complete Codex's Unfinished Learning Layer Release + Security Hardening**
    - Rule: When converting a hardcoded string to a runtime variable in JavaScript, always use a regex search for the exact old string value across the entire file to catch all string literal usages that need template literal interpolation.
    - Why: When env-var-izing hardcoded URLs, always search for ALL usages of the old value — including string concatenation and template literals. A variable declaration change without updating all consumers creates silent bugs that manifest as broken links in production.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

         │     ├── Repair Plan Builder (structured fix generation)

- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
  Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

### DeepSeek Architecture Summary

The **Repair Plan Builder** module (`src/super-roo/healing/RepairPlanBuilder.ts`) is the core component for structured fix generation, connected to the Self-Healing Loop pipeline (Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Fix → Verify). The **API Keys View** (`cloud/dashboard/src/components/views/api-keys.tsx`) provides the UI for managing provider keys with save/test/delete operations. Architecture constraints include priority queuing, job retry/backoff, concurrency control, and feature lifecycle tracking (planned → building → testing → working → deprecated) with health monitoring and bug-to-feature mapping.

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

### DeepSeek Bug Memory Summary

The recurring bug pattern is unsafe `JSON.parse()` calls in multiple registry modules (`BugRegistry.ts`, `TaskQueue.ts`, `FeatureRegistry.ts`, `MemoryStore.ts`) that crash on corrupted database rows. The root cause is lack of fallback handling for malformed JSON data. The fix introduces a `safeJsonParse` helper across all affected files to gracefully handle parsing failures, which is directly relevant to ensuring the Telegram View Diff feature can reliably parse and display real diffs without crashes.

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

For the "Fix Telegram View Diff" task, use **kimi-k2.5** (high confidence) for model routing logic, as it was chosen for optimal cost/quality/speed tradeoffs in task-based routing. This model powers the `modelRouterService.ts` file, which maps task types to provider/model pairs and is directly relevant to persisting and showing real diffs in the dashboard.
