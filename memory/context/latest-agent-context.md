# Latest Agent Context

Generated: 2026-05-18T12:42:47.173Z
Task: improve Telegram coding task error and clarification flow shown in screenshot

## Relevant Lessons
1. **Auto-Retry on Empty Assistant Response**
   - Rule: Implement auto-retry with exponential backoff for empty API responses. Log each retry attempt.
   - Why: APIs can return empty responses due to transient issues. Auto-retry with backoff improves reliability without user intervention.
2. **Safe JSON Parsing in Database Registries**
   - Rule: All registry modules MUST use safeJsonParse() instead of raw JSON.parse() when reading from database.
   - Why: Always use safe JSON parsing with fallback values when reading from persistent storage. Database corruption can happen at any time; code should be resilient.
3. **Intent-to-Agent Routing Fix**
   - Rule: Always verify intent-to-agent routing with real user queries. Add classifier feedback loops to detect and correct routing errors.
   - Why: Intent classification must be continuously validated against actual outcomes. Routing mismatches cause user frustration and wasted compute cycles.
4. **Model Router Service Task Routing**
   - Rule: Use the Model Router for all AI calls. Route by task type, not just by user preference. Always have fallback providers configured.
   - Why: Different AI providers excel at different task types. A routing layer improves both cost-efficiency and output quality.
5. **Complete Codex's Unfinished Learning Layer Release + Security Hardening**
   - Rule: When converting a hardcoded string to a runtime variable in JavaScript, always use a regex search for the exact old string value across the entire file to catch all string literal usages that need template literal interpolation.
   - Why: When env-var-izing hardcoded URLs, always search for ALL usages of the old value — including string concatenation and template literals. A variable declaration change without updating all consumers creates silent bugs that manifest as broken links in production.

## Active Codex Tasks
- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder
# SuperRoo Working Tree

> **Purpose**: This document is the single source of truth for the SuperRoo product architecture. All agents should read this to understand the system structure, module interactions, and product features before making changes.

## Overview

The SuperRoo system is organized into **18 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.

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
