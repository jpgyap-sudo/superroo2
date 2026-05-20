# Latest Agent Context

Generated: 2026-05-20T12:01:36.283Z
Task: Implement all Telegram improvements: OpenClaw upgrade, frictionless coding phases, Redis sessions, metrics exporter, unit tests, VSIX build

## Relevant Lessons

1. **Healing Module — Repair tracking, per-category escalation, notification routing, and circuit breaker**
    - Rule: When building self-healing systems, always include: (1) repair attempt tracking with success/failure per category, (2) configurable per-category escalation thresholds, (3) notification routing to multiple channels, (4) circuit breaker to prevent infinite retry loops. Test all 4 subsystems independently.
    - Why: Enhanced the Healing Module with 4 new subsystems: RepairTracker (records attempts, calculates success rates), CategoryEscalation (per-category maxRetries and escalation action overrides), NotificationRouter (routes alerts to Telegram/Slack/Email/Dashboard), CircuitBreaker (opens when repair failure rate exceeds 50% in a 10-attempt window). All 37 SelfHealingLoop tests and 22 HealingMetrics tests pass.
2. **Telegram Bot Frictionless Coding & Context Awareness Improvements**
    - Rule: Hide manual approval UI in auto-mode; use persistent reply keyboards; pass conversation context to classifiers; bound typing indicators with timeouts; handle new callbacks in both notifier and bot routing.
    - Why: Fixed auto-mode UX confusion by hiding approval buttons when auto-chaining, added phase-transition progress messages, persistent reply keyboard, typing indicators, similar/audit buttons, and enhanced classifier with conversation context.
3. **Ollama summarization added to build-agent-context.mjs before planning**
    - Rule: When implementing multi-model orchestration, always add graceful degradation: if the cheap local model (Ollama) is unavailable, the expensive model should still get the raw context. Never make the pipeline dependent on a local-only service.
    - Why: Added Ollama-powered summarization of lessons, source files, working tree, and bug memory to build-agent-context.mjs. The script now compresses context before feeding it to expensive coding models, with graceful fallback when Ollama is offline.
4. **Next.js dev WebSocket proxying, Redis NoopQueue fallback, LSP Bridge Backend**
    - Rule: Next.js rewrites do not proxy WebSocket upgrades. In dev, connect WS directly to the API server. Make Redis optional in dev with a NoopQueue fallback. LSP stdio requires Content-Length JSON-RPC framing with buffered reads.
    - Why: Implemented full LSP Bridge Backend for Cloud IDE, fixed Next.js dev WebSocket proxy issue by connecting directly to API port, and eliminated Redis reconnect loops in dev via NoopQueue fallback.
5. **Healing Module - add ML classification metrics, per-category escalation, repair tracking, and notification routing**
    - Rule: When enhancing a healing/self-healing module: always add per-category overrides for escalation thresholds; notification routing should use numeric action levels for reliable comparison; repair attempt tracking enables automatic circuit breaker triggers; trend metrics need a rolling window; confusion matrices are essential for monitoring classifier drift; when testing escalation logic, explicitly pass the full escalationPolicy config.
    - Why: Enhanced the Healing Module with four major improvements: (1) new root cause categories (CIRCUIT_BREAKER, DEPLOYMENT_FAILURE, DATABASE_CONNECTION) with classification patterns and diagnostic steps; (2) ML classification metrics with trend tracking, confusion matrix, precision/recall/F1; (3) repair tracking with RepairAttempt interface, repair history, per-category success rate, automatic circuit breaker; (4) per-category escalation with categoryThresholds/categoryActions overrides and notification routing. All 37 SelfHealingLoop tests and all HealingMetrics tests pass.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

         │     ├── Repair Plan Builder (structured fix generation)
         │     ├── Provider Testers (Real SDK connection testing)

- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping
    - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation
    - **Super Debug Loop** ([`src/super-roo/debug-team/SuperDebugLoop.ts`](../src/super-roo/debug-team/SuperDebugLoop.ts)) - Main orchestrating loop with state machine (idle→analyzing→planning→snapshot→patching→testing→critic_review→committing/deploying→rollback_retry)
- **Features**: Provider API key management, Encrypted secret storage (AES-256-GCM), Real provider connection testing, Agent routing sync, VPS control center (auto-approve, MCP, guardrails), Deployment safety validation - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete - **Provider Testers** ([`cloud/api/api.js`](../cloud/api/api.js)) - Real SDK connection testing for OpenAI, Anthropic, DeepSeek, Kimi, OpenRouter, Groq
  Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

### DeepSeek Architecture Summary

The **Repair Plan Builder** (`src/super-roo/healing/RepairPlanBuilder.ts`) and **Super Debug Loop** (`src/super-roo/debug-team/SuperDebugLoop.ts`) are the core modules affected, with the debug loop orchestrating a state machine (idle→analyzing→planning→snapshot→patching→testing→critic_review→committing/deploying→rollback_retry) that feeds into structured fix generation. The **Provider Testers** (`cloud/api/api.js`) and **API Keys View** (`cloud/dashboard/src/components/views/api-keys.tsx`) connect via encrypted secret storage (AES-256-GCM) and real SDK connection testing for OpenAI, Anthropic, DeepSeek, Kimi, OpenRouter, Groq. Architecture constraints include priority queuing, job retry/backoff, concurrency control, and feature lifecycle tracking (planned→building→testing→working→deprecated) with health monitoring (unknown→healthy→degraded→failing).

## Task Signals

Inferred tags: testing, ui

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

The recurring bug pattern is unsafe `JSON.parse()` calls across multiple registry modules (`BugRegistry.ts`, `TaskQueue.ts`, `FeatureRegistry.ts`, `MemoryStore.ts`) that crash on corrupted database rows. The root cause is a lack of fallback handling for malformed JSON data. The fix involves adding a `safeJsonParse` helper function to each affected file, with `HealingBus.ts` already having it and receiving enhanced usage.

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

For the Telegram improvements, the key model decision was to use **kimi-k2.5** for implementing the model routing service (`modelRouterService.ts`), chosen for its optimal balance of cost, quality, and speed when mapping task types to provider/model pairs. No other models or APIs were selected for the remaining tasks (OpenClaw upgrade, Redis sessions, metrics exporter, unit tests, VSIX build), as those are infrastructure or development workflow items rather than model-dependent decisions.

### DeepSeek File Summaries

- **src\super-roo\healing\SelfHealingLoop.ts**: This file exports the `SelfHealingLoop` class, which implements a state-machine-driven autonomous healing engine that monitors incidents, classifies root causes, generates repair plans, and tracks verification status. It exports supporting types (`EscalationAction`, `EscalationPolicy`, `IncidentSignature`, `FailureRecord`, `RepairAttempt`) and relies on `HealingBus`, `RootCauseClassifier`, and `RepairPlanBuilder` for event-driven communication and decision logic. The code follows a modular pattern with clear separation of concerns, typed interfaces for escalation policies and failure tracking, and a state machine with explicit failure branches, which aligns with the frictionless coding and Redis session requirements by ensuring deterministic, traceable healing workflows.
- **src\super-roo\healing\HealingMetrics.ts**: This file exports the `HealingMetrics` class and related TypeScript interfaces (`CategoryMetrics`, `PlanTypeMetrics`, `MetricsSnapshot`, `OutcomeRecord`, `PrecisionRecall`, `ConfusionMatrix`, `HealingMetricsOptions`). Its main purpose is to track success/failure rates for healing actions per category and plan type, persist metrics to a JSON file, and support Phase 2 enhancements like trend tracking, precision/recall, and confusion matrix evaluation. The code follows a modular pattern with clear separation of types, defaults, and class implementation, using `Map` for efficient lookups and a rolling window for trend analysis.
