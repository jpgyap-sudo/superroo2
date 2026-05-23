# Latest Agent Context

Generated: 2026-05-23T05:36:06.504Z
Task: continue kimi tasks

## Relevant Lessons

1. **ML Loop NaN Loss Detection**
    - Rule: InfiniteImprovementLoop MUST detect all-NaN loss arrays and stop training with a clear warning. Do not continue training on corrupted models.
    - Why: ML training must detect corruption early and stop rather than continuing with invalid data. NaN propagation invalidates all downstream results.
2. **Claude Task Tracking System — MCP Memory Server Integration**
    - Rule: When adding a new agent type to the MCP Memory Server, always add all 8 integration points in order: constant → interfaces → tool definitions → handlers → resource → search → helpers → agent config file. Missing any one breaks the full workflow.
    - Why: When adding a new agent task tracking system to the MCP Memory Server, follow the exact pattern of existing agent implementations (Codex → Kimi → Claude). Each agent needs: (1) a JSON log file, (2) a path constant, (3) TypeScript interfaces, (4) 4 MCP tool definitions in \_registerTools(), (5) handler cases in \_handleToolCall(), (6) a resource endpoint in \_registerResources(), (7) the JSON file added to \_searchLocalMemory(), and (8) 6 helper methods (read, write, upsert, list, get, getActive). The CLAUDE.md file follows the same pattern as .codex/config.toml for Codex.
3. **Cross-Project Learning Layer — Sync Script, Retry Queue, and Systemd Timer**
    - Rule: When deploying systemd timers for cron-like tasks: use `OnCalendar=hourly`, `Persistent=true` to catch missed runs, `RandomizedDelaySec=5min` to spread load, and always run an initial sync after enabling to verify the service works end-to-end.
    - Why: When building infrastructure for cross-project learning, always verify the fallback paths work on all target OSes (Windows paths differ from Unix paths). The 3-layer fallback architecture (local JSONL → Central Brain MCP → markdown) provides graceful degradation — no single point of failure. Systemd timers with RandomizedDelaySec prevent thundering herd on Central Brain.
4. **DeepSeek V4 Coder MCP — enforce agent routing workflow for Claude Code**
    - Rule: When designing agent routing workflows for Claude Code, do NOT rely on CLAUDE.md instructions alone. Create MCP servers that expose delegated capabilities as tools — Claude auto-discovers them from .mcp.json and uses them when appropriate, making the workflow programmatically enforceable.
    - Why: CLAUDE.md is advisory text and cannot enforce agent routing. To make Claude follow a multi-model workflow (Claude plans/reviews → DeepSeek codes → Ollama summarizes), provide MCP tools that Claude can programmatically call. The MCP protocol (JSON-RPC over stdio) is the correct mechanism for Claude to delegate tasks to other models/APIs.
5. **Multi-pass Ollama summarization - chain 2-3 passes per section to make 0.5B model smarter without upgrading**
    - Rule: When constrained to a small local model (0.5B parameters), use multi-pass chaining instead of upgrading hardware. Each pass should be a simpler sub-task within the model's capability. Always provide graceful fallback (pass3→pass2→pass1→single-pass→null) so the system degrades gracefully if any intermediate step fails.
    - Why: A small 0.5B model can produce useful structured summaries through multi-pass chaining. Each pass stays within the model's limited context window (short input, short output), but the chaining produces better results than a single pass. The key insight: break the task into sub-tasks the model CAN do (extract → condense → format) rather than asking it to do everything at once.

## Active Codex Tasks

No active Codex tasks.

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

The **Orchestrator** module is the primary entry point for "continue kimi tasks," routing tasks to the **Agent System** (Coder, Debugger, PM, Tester) and managing workflow lifecycle. The **Task Queue** (BullMQ integration) handles priority-based task dispatch, while the **Safety System** enforces mode-based ACL and capability gates on agent actions. Key constraints: all task execution must flow through the Orchestrator, and the **Memory System** (SQLite) provides persistence for all entities, meaning any task continuation must maintain state consistency across these connected modules.


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

Multiple registry modules (BugRegistry, TaskQueue, FeatureRegistry, MemoryStore) crashed on corrupted database rows due to unsafe `JSON.parse()` calls without fallback handling. The fix introduced a `safeJsonParse` helper across these files, with HealingBus already having it and enhancing its usage. This pattern is critical for "continue kimi tasks" as database corruption during task persistence or retrieval could break task continuation.


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

For "continue kimi tasks", the **kimi-k2.5** model was chosen and implemented in a model routing service (`modelRouterService.ts`) that maps task types to optimal provider/model pairs based on cost, quality, and speed tradeoffs. This decision was made with high confidence from a legacy session, ensuring that kimi tasks are routed to the most suitable model for efficient continuation.



### DeepSeek File Summaries

- **src\super-roo\ml\loop\InfiniteImprovementLoop.ts**: This file exports the `InfiniteImprovementLoop` class and supporting interfaces (`LoopConfig`, `LoopStats`, `ValidationResult`). Its main purpose is to implement a self-improving ML loop that cycles through observe, learn, predict, act, evaluate, persist, sync, and loop phases, using `CodeLearner`, `DebugLearner`, `TestLearner`, `MLSyncClient`, and `ModelPersistence`. Key patterns for "continue kimi tasks" include configurable loop parameters (e.g., `maxActionsPerIteration`, `confidenceThreshold`), bidirectional cloud sync via `MLSyncClient`, and a `CancellableSleep` for idle management.

```
