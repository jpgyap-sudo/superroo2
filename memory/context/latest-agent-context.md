# Latest Agent Context

Generated: 2026-05-17T15:47:10.132Z
Task: replace prompt-based lesson curation with inline editor

## Relevant Lessons
1. **Safe JSON Parsing in Database Registries**
   - Rule: All registry modules MUST use safeJsonParse() instead of raw JSON.parse() when reading from database.
   - Why: Always use safe JSON parsing with fallback values when reading from persistent storage. Database corruption can happen at any time; code should be resilient.
2. **Intent-to-Agent Routing Fix**
   - Rule: Always verify intent-to-agent routing with real user queries. Add classifier feedback loops to detect and correct routing errors.
   - Why: Intent classification must be continuously validated against actual outcomes. Routing mismatches cause user frustration and wasted compute cycles.
3. **Webview Hydration Recovery**
   - Rule: Implement timeout-based hydration recovery in all webview contexts. Never assume initial state sync succeeds.
   - Why: Webview/extension communication is unreliable. Always implement recovery mechanisms for missed handshakes and state synchronization.
4. **Docker Build Context Dependencies**
   - Rule: For monorepo Docker builds: include all workspace package.json files, use --shamefully-hoist, and ensure platform-specific binaries are available.
   - Why: Docker builds with monorepos require careful handling of workspace dependencies. pnpm's strict resolution needs explicit configuration in containerized environments.
5. **Tailscale SSH Deployment Standard**
   - Rule: ALL deployments MUST use Tailscale SSH (100.64.175.88). Never use public IP (104.248.225.250) for SSH.
   - Why: Security practices must be enforced at the tooling level, not just documented. Automated systems will fall back to insecure defaults without explicit constraints.

## Active Codex Tasks
No active Codex tasks.

## Architecture Reminder
The SuperRoo system is organized into **18 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.
         │     └── Infinite Improvement Loop (continuous learning)
### 10. Machine Learning Engine
- **Features**: Neural network training, Code pattern learning, Debug pattern learning, Test pattern learning, Infinite improvement loop
    - **Learners** ([`src/super-roo/ml/learning/`](../src/super-roo/ml/learning/)) - CodeLearner, DebugLearner, TestLearner

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
