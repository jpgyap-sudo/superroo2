# Latest Agent Context

Generated: 2026-05-18T13:19:34.911Z
Task: Improve workflow compliance dashboard, service health visibility, metadata diagnostics, trends, and deploy guardrails

## Relevant Lessons

1. **Comprehensive Gap Analysis and Full-Stack Improvement Execution**
    - Rule: Before implementing any improvement from a gap analysis document, verify the actual source code to confirm the gap still exists. For Vitest ESM mocking of default imports, always include "default: { ... }" alongside named exports in the mock factory.
    - Why: When doing a comprehensive codebase gap analysis, always verify which gaps have already been filled by checking the actual source code rather than relying on the gap analysis document. Many items from NEXT_IMPROVEMENTS.md had already been implemented in a previous pass. For ESM module mocking in Vitest, default imports (import fs from "fs/promises") require the "default:" key in the mock factory, not just named exports. The createPopulatedRetriever() pattern using type assertion to bypass load() is more reliable than mocking filesystem operations for filtering/sorting/formatting tests.
2. **Deploy dashboards should summarize recorded facts, not infer missing telemetry**
    - Rule: For dashboard health summaries, compute metrics from persisted backend facts and render unavailable states for absent telemetry; never pair a local-only form with copy that implies infrastructure changes were saved.
    - Why: The deploy tab fabricated failure reasons and average duration while exposing a non-persistent config editor; a canonical deploy summary endpoint and read-only target panel restored truthful operational data.
3. **Production deploys must keep source and dependency manifests in sync**
    - Rule: When production source files change together with dependencies, deploy the matching `package.json` and verify generated runtime artifacts exist before declaring recovery complete.
    - Why: Hotfixes can restore one failing layer while leaving another stale layer broken. For production recovery, validate the runtime artifact set as well as the source change, especially when a deploy spans both app code and dependency manifests.
4. **Model Router Service Task Routing**
    - Rule: Use the Model Router for all AI calls. Route by task type, not just by user preference. Always have fallback providers configured.
    - Why: Different AI providers excel at different task types. A routing layer improves both cost-efficiency and output quality.
5. **Claude Task Tracking System — MCP Memory Server Integration**
    - Rule: When adding a new agent type to the MCP Memory Server, always add all 8 integration points in order: constant → interfaces → tool definitions → handlers → resource → search → helpers → agent config file. Missing any one breaks the full workflow.
    - Why: When adding a new agent task tracking system to the MCP Memory Server, follow the exact pattern of existing agent implementations (Codex → Kimi → Claude). Each agent needs: (1) a JSON log file, (2) a path constant, (3) TypeScript interfaces, (4) 4 MCP tool definitions in \_registerTools(), (5) handler cases in \_handleToolCall(), (6) a resource endpoint in \_registerResources(), (7) the JSON file added to \_searchLocalMemory(), and (8) 6 helper methods (read, write, upsert, list, get, getActive). The CLAUDE.md file follows the same pattern as .codex/config.toml for Codex.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

         │     ├── Repair Plan Builder (structured fix generation)

- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping
- **Features**: Incident detection, Root cause classification, Repair plan generation, Auto-fix deployment, Verification cycle
    - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation
        > **IMPORTANT**: This is THE single source of truth for all commits and deployments across all coding agents. Every agent MUST use `CommitDeployLog.recordCommit()` and `CommitDeployLog.recordDeploy()` to record their work. The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change).
- **Features**: Autonomous multi-agent debugging, Complex feature problem solving, Phase-by-phase breakdown, Hypothesis-driven iteration, Safe container execution (Docker), Automatic git snapshot/rollback, Multi-feature integration sync, Auto-generated skills from failures, Auto-approval mode (all approvals auto-granted, all deployments auto-run), 24/7 unlimited iteration
- **Features**: GitHub Actions dispatch, VPS SSH deployment, Rollback management, Health check verification
- **Features**: Provider API key management, Encrypted secret storage (AES-256-GCM), Real provider connection testing, Agent routing sync, VPS control center (auto-approve, MCP, guardrails), Deployment safety validation - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
  Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify

## Task Signals

Inferred tags: ui, deployment

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
