# Latest Agent Context

Generated: 2026-05-22T02:49:58.818Z
Task: Investigate Telegram message experience when user asks recommendations then asks coder to proceed upgrade or improvement

## Relevant Lessons

1. **Telegram dashboard coding flow must enqueue real coder phases**
    - Rule: When wiring a dashboard or Telegram Mini App coding console, do not point a /code UI at a generic connectivity endpoint. The frontend should POST /telegram/tasks/create with stripped instruction and a
    - Why: When wiring a dashboard or Telegram Mini App coding console, do not point a /code UI at a generic connectivity endpoint. The frontend should POST /telegram/tasks/create with stripped instruction and auto flag; backend create should enqueue coder-plan jobs with phase/task metadata, and dashboard appr
2. **DeepSeek V4 Coder MCP — enforce agent routing workflow for Claude Code**
    - Rule: When designing agent routing workflows for Claude Code, do NOT rely on CLAUDE.md instructions alone. Create MCP servers that expose delegated capabilities as tools — Claude auto-discovers them from .mcp.json and uses them when appropriate, making the workflow programmatically enforceable.
    - Why: CLAUDE.md is advisory text and cannot enforce agent routing. To make Claude follow a multi-model workflow (Claude plans/reviews → DeepSeek codes → Ollama summarizes), provide MCP tools that Claude can programmatically call. The MCP protocol (JSON-RPC over stdio) is the correct mechanism for Claude to delegate tasks to other models/APIs.
3. **Deterministic product-to-image pattern matching with scoring system**
    - Rule: Prefer deterministic pattern matching over AI for structured data matching tasks. Implement multiple matching strategies with weighted scoring. Set confidence thresholds. Only fall back to AI when deterministic score is below threshold.
    - Why: AI-based product-to-image matching was unreliable and expensive. Implemented a deterministic scoring system that matches product codes (e.g., "ABC-123") to image filenames using multiple pattern strategies with weighted scores.
4. **Telegram Bot Frictionless Coding & Context Awareness Improvements**
    - Rule: Hide manual approval UI in auto-mode; use persistent reply keyboards; pass conversation context to classifiers; bound typing indicators with timeouts; handle new callbacks in both notifier and bot routing.
    - Why: Fixed auto-mode UX confusion by hiding approval buttons when auto-chaining, added phase-transition progress messages, persistent reply keyboard, typing indicators, similar/audit buttons, and enhanced classifier with conversation context.
5. **Separate Retryable System Failures from User Clarification**
    - Rule: Before chaining promise methods onto an integration helper, verify whether it actually returns a promise; for Telegram workflows, keep clarification and retryable_failure as distinct states with distinct copy and recovery actions.
    - Why: Telegram coding tasks were throwing because a synchronous bridge method was treated like a promise, and retryable model failures were mislabeled as user clarification. Fixed by using try/catch for the sync bridge path and adding a separate retryable failure flow that preserves retry context.

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

The investigation affects the **Orchestrator** (task dispatch, workflow orchestration), **Agent System** (specifically the Coder agent for upgrades/improvements), and **Memory System** (SQLite persistence for conversation context). The flow requires the Orchestrator to route the recommendation request to the appropriate agent, then pass the coder's upgrade task through the **Safety System** (mode-based ACL) before execution. Architecture constraints include the **Task Queue** (BullMQ) for priority-based task ordering and the **Event Log** for observability of the entire interaction sequence.


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

The bug entries reveal a recurring pattern of crashes caused by unsafe `JSON.parse()` usage across multiple registry modules (`BugRegistry.ts`, `TaskQueue.ts`, `FeatureRegistry.ts`, `MemoryStore.ts`) when encountering corrupted database rows. The root cause is the lack of a safe fallback mechanism for JSON parsing, leading to unhandled exceptions. The fix involves adding a `safeJsonParse` helper function to each affected file, with one module (`HealingBus.ts`) already having it and receiving enhanced usage.


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

For the Telegram message experience where a user asks for recommendations and then requests an upgrade or improvement, the model router service (using `kimi-k2.5`) was chosen to map task types to optimal provider/model pairs, balancing cost, quality, and speed for both recommendation and coding tasks.



### DeepSeek File Summaries

- **scripts\deepseek-coder-mcp.mjs**: This file exports a DeepSeek Coder MCP server that exposes coding tools (deepseek_code, deepseek_review, deepseek_refactor, deepseek_explain, deepseek_status) via JSON-RPC 2.0 over stdio. Its main purpose is to delegate coding tasks from Claude to DeepSeek, following the SuperRoo agent routing workflow (Claude plans/reviews, DeepSeek codes, Ollama summarizes). Key patterns include environment-based configuration (DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_API_URL), a custom loadEnvFile function for .env loading, and MCP protocol helpers for sending JSON-RPC messages over stdout.
- **.mcp.json**: This file exports an MCP server configuration defining three services: `superroo-brain` (central memory and workflow enforcement), `deepseek-coder` (delegates coding tasks to DeepSeek V4), and `ollama` (handles embeddings and local chat). Its main purpose is to orchestrate a workflow where Claude plans/reviews, DeepSeek codes and summarizes, and Ollama handles embeddings only. For the Telegram recommendation upgrade task, note the pattern that DeepSeek is mandated for coding and summarization, while Ollama is restricted to embeddings, and the `superroo-brain` enforces lesson obligations and workflow rules.

```
