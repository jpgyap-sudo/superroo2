# Advanced Features Gap Analysis

> **Date**: 2026-05-20
> **Focus**: Experimental & Active modules — functional completeness, integration depth, API coverage, dashboard coverage, test coverage, and documentation gaps
> **Method**: Deep-dive source code analysis of all advanced feature modules across TypeScript (`src/super-roo/`) and JavaScript cloud ports (`cloud/orchestrator/modules/`), cross-referenced against API endpoints, dashboard views, and the Working Tree

---

## Summary

| Category | Count |
|---|---|
| Advanced modules analyzed | 8 (ML Engine, Debug Team, Parallel Execution, Self-Healing, Autonomous Loop, Commissioning Loop, HermesClaw, Learning Gateway) |
| Dashboard views for advanced features | 29 total (7 directly for advanced features) |
| **Functional gaps found** | **14** |
| **Integration gaps found** | **6** |
| **API coverage gaps found** | **4** |
| **Test coverage gaps found** | **8** |
| **Documentation gaps found** | **5** |

---

## Fix Status (2026-05-20)

This section tracks which gaps were addressed during the advanced features gap fix session.

### ✅ Fixed Gaps

| # | Gap | Fix Applied |
|---|---|---|
| **G6** | No tests for ML engine | 186 tests added across 4 test files: Learners, InfiniteImprovementLoop, MLSyncClient, DebugTeamComponents |
| **G10** | No tests for SuperDebugLoop | Tests added in DebugTeamComponents.test.ts |
| **G11** | No parallel execution dashboard view | Created `parallel-execution.tsx` dashboard view |
| **G14** | No tests for ParallelExecutor | Tests added in DebugTeamComponents.test.ts |
| **G18** | No autonomous loop dashboard view | Created `autonomous-loop.tsx` dashboard view |
| **G20** | No tests for AutonomousLoop | Tests added in DebugTeamComponents.test.ts |
| **G21** | No commissioning dashboard view | Created `commissioning-loop.tsx` dashboard view |
| **G23** | No tests for CommissioningLoop | Tests added in DebugTeamComponents.test.ts |
| **G24** | No dedicated HermesClaw dashboard view | Created `hermes-claw.tsx` dashboard view |
| **G26** | No tests for HermesClaw | Tests added in DebugTeamComponents.test.ts |
| **G28** | No tests for LearningGateway | Tests added in DebugTeamComponents.test.ts |
| **A1** | `POST /orchestrator/ml/train` | Added ML train API endpoint |
| **A2** | `GET /orchestrator/ml/model` | Added ML model API endpoint |
| **A3** | `GET /orchestrator/ml/learners` | Added ML learners API endpoint |
| **A4** | `POST /orchestrator/commissioning/report` | Added commissioning report API endpoint |
| **D1** | ML Engine architecture doc | Written: `docs/super-roo/ML_ENGINE_GUIDE.md` |
| **D2** | Debug Team operations guide | Written: `docs/super-roo/DEBUG_TEAM_GUIDE.md` |
| **D3** | Autonomous Loop runbook | Written: `docs/super-roo/AUTONOMOUS_LOOP_GUIDE.md` |
| **D4** | Commissioning Loop runbook | Written: `docs/super-roo/COMMISSIONING_LOOP_GUIDE.md` |
| **D5** | HermesClaw API reference | Written: `docs/super-roo/HERMES_CLAW_GUIDE.md` |
| **I1** | Debug Team → Self-Healing not wired in cloud | Wired: Debug failures now trigger healing incidents |
| **I2** | ML Engine → Debug Team not wired | Wired: Debug lessons feed into learning loop |
| **I4** | Commissioning Loop → Bug Registry not wired | Wired: Test failures auto-create bug entries |
| **I5** | FeatureAnswerer → Learning Gateway not wired | Wired: Lessons cross-reference with feature docs |
| **I6** | No cross-module health check | Added cross-module health check endpoint |

### ⏳ Pending Gaps

| # | Gap | Severity | Reason |
|---|---|---|---|
| **G1** | Neural network not ported to cloud | HIGH | Requires full TypeScript→JavaScript port of NeuralNetwork.ts |
| **G3** | Individual learner progress not exposed | MEDIUM | API endpoint added (A3) but no dashboard visualization |
| **G4** | Model serialization/federated merge not wired | MEDIUM | Dead code — ModelSerializer/FederatedMerge never called |
| **G7** | No cloud port of SuperDebugLoop | HIGH | Requires porting 1499-line TypeScript state machine to JS |
| **G8** | Debug job history not persisted | MEDIUM | Requires database migration for debug jobs |
| **G9** | No debug job detail view | LOW | Dashboard shows list but no drill-down |
| **G12** | Parallel ML Trainer is dead code | HIGH | Working Tree feature with no implementation |
| **G13** | Parallel Healing Pipeline is dead code | HIGH | Working Tree feature with no implementation |
| **G15** | No circuit breaker visualization | LOW | Dashboard enhancement for healing view |
| **G16** | No notification route configuration UI | LOW | Requires settings form for notification routes |
| **G17** | No tests for SelfHealingLoop | MEDIUM | 987-line state machine still untested |
| **G19** | No TypeScript source for AutonomousLoop | MEDIUM | Exists only as JavaScript cloud port |
| **G22** | No TypeScript source for CommissioningLoop | MEDIUM | Exists only as JavaScript cloud port |
| **G25** | No TypeScript source for HermesClaw | MEDIUM | Exists only as JavaScript cloud port |
| **G27** | No learning policy configuration UI | LOW | Requires settings form for LearningPolicy thresholds |
| **I3** | Parallel Executor → ML Engine not wired | MEDIUM | Parallel ML Trainer feature doesn't exist |

---

## 1. Machine Learning Engine (Module #10)

**Status**: `experimental`
**Source**: [`src/super-roo/ml/engine/NeuralNetwork.ts`](../src/super-roo/ml/engine/NeuralNetwork.ts) (257 lines), [`src/super-roo/ml/loop/InfiniteImprovementLoop.ts`](../src/super-roo/ml/loop/InfiniteImprovementLoop.ts) (723 lines)
**Cloud port**: [`cloud/orchestrator/modules/InfiniteImprovementLoop.js`](../cloud/orchestrator/modules/InfiniteImprovementLoop.js) (778 lines)

### What Exists

- Full neural network implementation in TypeScript: Dense, ReLU, Tanh, Sigmoid, Softmax, Dropout, BatchNorm layers
- AdamOptimizer, SGD, Momentum optimizers
- MSE, CrossEntropy, BinaryCrossEntropy loss functions
- InfiniteImprovementLoop with 8-step cycle (OBSERVE → LEARN → PREDICT → ACT → EVALUATE → PERSIST → SYNC → LOOP)
- Three learners: CodeLearner, DebugLearner, TestLearner
- MLSyncClient for bidirectional sync
- Cloud port with SQLite-backed persistence and linear regression model

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G1** | **Neural network not ported to cloud** | HIGH | The TypeScript `NeuralNetwork.ts` has full deep learning capabilities (257 lines, 7 layer types, 3 optimizers, 3 loss functions). The cloud port `InfiniteImprovementLoop.js` uses only linear regression. The neural network is never actually used in production — only the regression model runs. |
| **G2** | **No neural network training API endpoint** | HIGH | The `/orchestrator/improvement/stats` endpoint exposes only basic loop stats (loopsRun, predictionsMade). There is no endpoint to: train the neural network, inspect tensor operations, view layer weights, or trigger model serialization. |
| **G3** | **Individual learner progress not exposed** | MEDIUM | CodeLearner, DebugLearner, TestLearner each have their own training state, but there is no API or dashboard to see: which learner is active, what it's learning, its accuracy, or its training history. |
| **G4** | **Model serialization/federated merge not wired** | MEDIUM | The cloud port has `ModelSerializer`, `FeatureMapper`, and `FederatedMerge` classes but they are never called from any API endpoint or dashboard. Federated learning across agents exists in code but is dead code. |
| **G5** | **No ML Engine dashboard view** | MEDIUM | The `ollama-growth` and `intelligence-layer` views cover lesson curation but not the core ML training pipeline. No view shows: neural network architecture, training progress, loss curves, learner accuracy, or model version history. |
| **G6** | **No tests for ML engine** | HIGH | `NeuralNetwork.ts` has no test file. `InfiniteImprovementLoop.ts` has no test file. The cloud port has no test file. This is the most mathematically complex subsystem with zero test coverage. |

---

## 2. Debug Team (Module #13)

**Status**: `active`
**Source**: [`src/super-roo/debug-team/SuperDebugLoop.ts`](../src/super-roo/debug-team/SuperDebugLoop.ts) (1499 lines)
**Cloud port**: None (delegates to AutonomousLoop)

### What Exists

- Full SuperDebugLoop with 12-state state machine (idle → analyzing → planning → snapshot → patching → testing → critic_review → [pass/fail/stop])
- PhaseBreakdownEngine, HypothesisEngine, ContainerSandbox, RollbackManager, FeatureSyncOrchestrator, SkillsGenerator
- Auto-approval mode (all approvals auto-granted, all deployments auto-run)
- Integrates with SelfHealingLoop, InfiniteImprovementLoop, ParallelExecutor, HealingBus, BugRegistry, FeatureRegistry
- DebugJob type with 14 statuses, phases, hypotheses, snapshots, lessons
- Dashboard view: `debug-team.tsx` with start/stop controls, live progress, step timeline, recent jobs
- API endpoints: `GET /debug-team/status`, `POST /debug-team/start`, `POST /debug-team/stop`, `GET /debug-team/jobs`, `POST /debug-team/test-telegram`

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G7** | **No cloud port of SuperDebugLoop** | HIGH | The cloud API's `/debug-team/start` endpoint creates an `AutonomousLoop` instance, not a `SuperDebugLoop`. The full 1499-line TypeScript debug loop with its 12-state state machine, HypothesisEngine, ContainerSandbox, and RollbackManager is never used in the cloud deployment. The cloud debug team is just a thin wrapper around the autonomous loop. |
| **G8** | **Debug job history not persisted** | MEDIUM | The `debug-team.tsx` dashboard view fetches jobs from memory (`orchestrator.tasks`), not from a database. If the server restarts, all debug job history is lost. The TypeScript `SuperDebugLoop` has no persistence layer. |
| **G9** | **No debug job detail view** | LOW | The dashboard shows a list of recent debug jobs but clicking into a job shows no detail — no phase breakdown, no hypothesis tree, no snapshot diff, no lesson extracted. |
| **G10** | **No tests for SuperDebugLoop** | HIGH | `SuperDebugLoop.ts` (1499 lines, the largest file in the system) has zero tests. The state machine has 12 states with complex transitions that are impossible to verify manually. |

---

## 3. Parallel Execution Engine (Module #14)

**Status**: `experimental`
**Source**: [`src/super-roo/parallel/ParallelExecutor.ts`](../src/super-roo/parallel/ParallelExecutor.ts) (306 lines)
**Cloud port**: [`cloud/orchestrator/modules/ParallelExecutor.js`](../cloud/orchestrator/modules/ParallelExecutor.js)

### What Exists

- Configurable maxConcurrency (default 2), maxTokenBudget (default 100), agent token costs
- Priority preemption support, task timeout (default 10min)
- WorkerSlot tracking with AbortController
- AgentBus for inter-agent messaging
- API endpoint: `GET /orchestrator/parallel/stats`
- Cloud port with SQLite-backed persistence

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G11** | **No parallel execution dashboard view** | MEDIUM | The existing gap scan (2026-05-18) identified this as missing. Still not built. No view to see: active parallel tasks, agent bus messages, concurrency usage, token budget consumption, or priority queue. |
| **G12** | **Parallel ML Trainer is dead code** | HIGH | The Working Tree lists "Parallel ML Trainer" as a sub-feature, but neither the TypeScript nor the cloud port has any parallel ML training implementation. The `ParallelExecutor` only handles generic task execution. |
| **G13** | **Parallel Healing Pipeline is dead code** | HIGH | The Working Tree lists "Parallel Healing Pipeline" as a sub-feature, but there is no implementation. The `SelfHealingLoop` runs sequentially. The `HealingBus` coordinates incidents but doesn't execute repairs in parallel. |
| **G14** | **No tests for ParallelExecutor** | HIGH | `ParallelExecutor.ts` (306 lines) has no tests. The cloud port has no tests. Priority preemption and concurrency control are notoriously bug-prone without tests. |

---

## 4. Self-Healing System (Module #9)

**Status**: `stable`
**Source**: [`src/super-roo/healing/SelfHealingLoop.ts`](../src/super-roo/healing/SelfHealingLoop.ts) (987 lines)
**Cloud port**: [`cloud/orchestrator/modules/SelfHealingLoop.js`](../cloud/orchestrator/modules/SelfHealingLoop.js)

### What Exists

- Full state machine: new → investigating → queued_for_fix → fixing → fix_ready → deployed → verifying → verified
- EscalationPolicy with maxRetries, category thresholds, circuit breaker
- RepairAttempt tracking with timestamps, durations, outcomes
- NotificationRoute for escalated incidents (telegram, slack, email, dashboard)
- Dashboard view: `healing.tsx`
- API endpoints: `GET /orchestrator/healing/incidents`, `GET /orchestrator/healing/metrics`, `GET /orchestrator/healing/stats`, `POST /orchestrator/healing/cycle`

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G15** | **No circuit breaker visualization** | LOW | The cloud port has circuit breaker logic (trip/recover thresholds) but the dashboard shows no circuit breaker state. Operators can't see which circuits are tripped, half-open, or closed. |
| **G16** | **No notification route configuration UI** | LOW | Notification routes (telegram, slack, email, dashboard) exist in code but there's no UI to configure them. They must be set via direct API calls. |
| **G17** | **No tests for SelfHealingLoop** | MEDIUM | `SelfHealingLoop.ts` (987 lines) has no tests. The state machine has 8 states with complex escalation logic. |

---

## 5. Autonomous Loop

**Status**: `active`
**Source**: None (only cloud port)
**Cloud port**: [`cloud/orchestrator/modules/AutonomousLoop.js`](../cloud/orchestrator/modules/AutonomousLoop.js) (1269 lines)

### What Exists

- 10-step autonomous improvement cycle: Audit → Fix → Test → Simulate (E2E) → Improve Code Quality → Pattern Learning → Dashboard → Commit → Deploy → Health Check
- 18 hard safety patterns (rm -rf, mkfs, dd, shutdown, reboot, etc.)
- API endpoints: `POST /autonomous/start`, `GET /autonomous/status`, `POST /autonomous/stop`
- Dashboard view: None dedicated (status shown in overview)

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G18** | **No autonomous loop dashboard view** | MEDIUM | The autonomous loop has start/stop/status API endpoints but no dedicated dashboard view. The overview page shows a minimal status badge. No view to see: step-by-step progress, audit findings, test results, deploy status, or health check results. |
| **G19** | **No TypeScript source** | MEDIUM | Unlike most other modules, the AutonomousLoop exists only as a JavaScript cloud port. There's no TypeScript source in `src/super-roo/`. This means no type checking, no IDE intellisense, and no shared types with the rest of the system. |
| **G20** | **No tests** | HIGH | `AutonomousLoop.js` (1269 lines) has zero tests. The 10-step cycle with 18 safety patterns, E2E simulation, and deploy/health-check steps is impossible to verify manually. |

---

## 6. Commissioning Loop

**Status**: `active`
**Source**: None (only cloud port)
**Cloud port**: [`cloud/orchestrator/modules/CommissioningLoop.js`](../cloud/orchestrator/modules/CommissioningLoop.js) (1790 lines)

### What Exists

- 14-phase full-stack commissioning engine: Repo Inspection → Env Validation → Boot Verification → UI Testing → API Verification → Database Validation → Integration Verification → Queue/Worker Testing → File Upload Testing → Security/Auth → Performance/Stability → Autonomous Debugging → Reporting → Cleanup
- All test execution container-sandboxed
- Same hard safety rules as AutonomousLoop
- API endpoints: `POST /commissioning/start`, `GET /commissioning/status`, `POST /commissioning/stop`

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G21** | **No commissioning dashboard view** | MEDIUM | The commissioning loop has start/stop/status API endpoints but no dashboard view. No way to see: phase-by-phase progress, test results per phase, pass/fail counts, or the final commissioning report. |
| **G22** | **No TypeScript source** | MEDIUM | Same as AutonomousLoop — exists only as JavaScript. No type safety, no shared types. |
| **G23** | **No tests** | HIGH | `CommissioningLoop.js` (1790 lines, the largest cloud module) has zero tests. The 14-phase engine with container sandboxing is the most complex module in the cloud deployment. |

---

## 7. HermesClaw (Memory & Context Agent)

**Status**: `active`
**Source**: None (only cloud port)
**Cloud port**: [`cloud/orchestrator/modules/HermesClaw.js`](../cloud/orchestrator/modules/HermesClaw.js) (1017 lines)

### What Exists

- 10 operations: create_skill, memory_summary, context_recall, improvement_suggestion, pattern_analysis, knowledge_query, best_practices, lesson_extraction, store_bug_fix, store_lesson
- pgvector-backed RAG memory via BugKnowledgeStore
- Disk persistence (survives PM2 restarts)
- API endpoints: `POST /orchestrator/hermes/query`, `POST /orchestrator/hermes/lesson`, `GET /orchestrator/hermes/stats`, `POST /orchestrator/hermes/recall`, `POST /orchestrator/hermes/learn`, `POST /orchestrator/hermes/create-skill`, `POST /orchestrator/hermes/analyze-patterns`, `POST /orchestrator/hermes/list-skills`, `POST /orchestrator/hermes/list-resources`, `POST /orchestrator/hermes/extract-lessons`
- Dashboard view: None dedicated (partial coverage via `brain.tsx` and `intelligence-layer.tsx`)

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G24** | **No dedicated HermesClaw dashboard view** | MEDIUM | HermesClaw has 10 API endpoints but no dedicated dashboard view. The `brain.tsx` view shows some Hermes stats but doesn't expose: memory search, context recall results, skill list, pattern analysis, or lesson extraction. |
| **G25** | **No TypeScript source** | MEDIUM | HermesClaw exists only as JavaScript. No shared types with the TypeScript codebase. |
| **G26** | **No tests** | HIGH | `HermesClaw.js` (1017 lines) has zero tests. The 10-operation engine with OpenAI API calls, Ollama fallback, and pgvector RAG has no automated verification. |

---

## 8. Learning Gateway

**Status**: `active`
**Source**: None (only cloud port)
**Cloud port**: [`cloud/orchestrator/modules/LearningGateway.js`](../cloud/orchestrator/modules/LearningGateway.js) (372 lines)

### What Exists

- Lesson search/store/score/curate with LearningPolicy quality evaluation
- Skill promotion candidate tracking
- Compact lesson retrieval for prompt injection
- API endpoints: `POST /learning/search`, `POST /learning/store`, `POST /learning/score`, `POST /learning/curate`
- Dashboard view: Partial via `intelligence-layer.tsx`

### Gaps

| # | Gap | Severity | Details |
|---|---|---|---|
| **G27** | **No learning policy configuration UI** | LOW | `LearningPolicy.js` has configurable quality thresholds (durable text length, placeholder patterns, promotion criteria) but there's no UI to adjust them. |
| **G28** | **No tests** | MEDIUM | `LearningGateway.js` (372 lines) and `LearningPolicy.js` (70 lines) have no tests. The scoring and curation logic is subjective and hard to verify without tests. |

---

## 9. Integration Gaps

These are gaps in how the advanced features connect to each other.

| # | Gap | Severity | Details |
|---|---|---|---|
| **I1** | **Debug Team → Self-Healing not wired in cloud** | HIGH | The TypeScript `SuperDebugLoop` integrates with `SelfHealingLoop` via `HealingBus`. The cloud `AutonomousLoop` (used as debug team backend) has no self-healing integration. Debug failures in the cloud don't trigger healing incidents. |
| **I2** | **ML Engine → Debug Team not wired** | MEDIUM | The TypeScript `InfiniteImprovementLoop` integrates with `SuperDebugLoop` for debug-specific learning. The cloud `InfiniteImprovementLoop.js` has no debug team integration. Debug lessons are not fed into the learning loop. |
| **I3** | **Parallel Executor → ML Engine not wired** | MEDIUM | The "Parallel ML Trainer" feature listed in the Working Tree doesn't exist. The `ParallelExecutor` has no integration with the `InfiniteImprovementLoop` or `NeuralNetwork`. |
| **I4** | **Commissioning Loop → Bug Registry not wired** | LOW | The Commissioning Loop runs 14 phases of tests but doesn't automatically create bug entries in the Bug Registry when tests fail. Failures are logged but not tracked as bugs. |
| **I5** | **FeatureAnswerer → Learning Gateway not wired** | LOW | `FeatureAnswerer` answers questions about features using FTS5-indexed docs. `LearningGateway` stores lessons. They don't share data — a lesson about a feature won't appear in FeatureAnswerer results. |
| **I6** | **No cross-module health check** | MEDIUM | There's no single endpoint that reports the health of all advanced modules together. The `/health` endpoint checks basic system health. The `/intelligence-layer` endpoint aggregates stats but doesn't report module health status. |

---

## 10. API Coverage Gaps

| # | Missing Endpoint | Module | Details |
|---|---|---|---|
| **A1** | `POST /orchestrator/ml/train` | ML Engine | No way to trigger neural network training via API |
| **A2** | `GET /orchestrator/ml/model` | ML Engine | No way to inspect model weights, architecture, or training history |
| **A3** | `GET /orchestrator/ml/learners` | ML Engine | No way to see individual learner (CodeLearner, DebugLearner, TestLearner) status |
| **A4** | `POST /orchestrator/commissioning/report` | Commissioning Loop | No way to retrieve the final commissioning report as a structured document |

---

## 11. Test Coverage Summary

| Module | Lines of Code | Test Files | Status |
|---|---|---|---|
| ML Engine (NeuralNetwork.ts) | 257 | 0 | ❌ No tests |
| ML Engine (InfiniteImprovementLoop.ts) | 723 | 0 | ❌ No tests |
| Debug Team (SuperDebugLoop.ts) | 1,499 | 0 | ❌ No tests |
| Parallel Execution (ParallelExecutor.ts) | 306 | 0 | ❌ No tests |
| Self-Healing (SelfHealingLoop.ts) | 987 | 0 | ❌ No tests |
| Autonomous Loop (AutonomousLoop.js) | 1,269 | 0 | ❌ No tests |
| Commissioning Loop (CommissioningLoop.js) | 1,790 | 0 | ❌ No tests |
| HermesClaw (HermesClaw.js) | 1,017 | 0 | ❌ No tests |
| Learning Gateway (LearningGateway.js) | 372 | 0 | ❌ No tests |
| **Total** | **8,220** | **0** | **❌ 100% untested** |

---

## 12. Documentation Gaps

| # | Missing Documentation | Module | Details |
|---|---|---|---|
| **D1** | ML Engine architecture doc | ML Engine | No doc explaining the neural network architecture, layer types, optimizer choices, or training workflow |
| **D2** | Debug Team operations guide | Debug Team | No doc explaining the 12-state state machine, hypothesis engine workflow, or container sandbox setup |
| **D3** | Autonomous Loop runbook | Autonomous Loop | No doc explaining the 10-step cycle, safety patterns, or how to interpret step results |
| **D4** | Commissioning Loop runbook | Commissioning Loop | No doc explaining the 14 phases, what each phase tests, or how to interpret results |
| **D5** | HermesClaw API reference | HermesClaw | No doc listing the 10 operations, their parameters, return values, or example usage |

---

## 13. Priority Recommendations

### Critical (Fix Immediately)

1. **Add tests for all advanced modules** — 8,220 lines of untested code across 9 modules is a systemic risk. Start with `SuperDebugLoop.ts` (1,499 lines, most complex) and `CommissioningLoop.js` (1,790 lines, largest).
2. **Port the neural network to the cloud** — The TypeScript `NeuralNetwork.ts` has full deep learning capabilities that are never used in production. The cloud uses only linear regression.
3. **Port SuperDebugLoop to the cloud** — The cloud debug team delegates to AutonomousLoop, losing the 12-state state machine, HypothesisEngine, ContainerSandbox, and RollbackManager.

### High Priority

4. **Create ML Engine dashboard view** — Show neural network training status, learner progress, loss curves, and model versions.
5. **Create Parallel Execution dashboard view** — Show active parallel tasks, agent bus messages, concurrency usage, and token budget.
6. **Create Autonomous Loop dashboard view** — Show step-by-step progress, audit findings, test results, and deploy status.
7. **Create Commissioning Loop dashboard view** — Show phase-by-phase progress, test results, and final report.
8. **Create HermesClaw dashboard view** — Show memory search, context recall, skill list, and pattern analysis.

### Medium Priority

9. **Wire Debug Team → Self-Healing in cloud** — Debug failures should trigger healing incidents.
10. **Wire ML Engine → Debug Team in cloud** — Debug lessons should feed into the learning loop.
11. **Add ML training API endpoints** — `/orchestrator/ml/train`, `/orchestrator/ml/model`, `/orchestrator/ml/learners`.
12. **Add cross-module health check endpoint** — Single endpoint reporting health of all advanced modules.

### Low Priority

13. **Add circuit breaker visualization** to healing dashboard.
14. **Add notification route configuration UI** for self-healing.
15. **Add learning policy configuration UI** for Learning Gateway.
16. **Wire Commissioning Loop → Bug Registry** — auto-create bugs from test failures.
17. **Wire FeatureAnswerer → Learning Gateway** — cross-reference lessons with feature docs.

---

## 14. Appendix: Full Module Status Map

| Module | Working Tree Status | TypeScript Source | Cloud Port | API Endpoints | Dashboard View | Tests | Docs |
|---|---|---|---|---|---|---|---|
| ML Engine | experimental | ✅ Full | ⚠️ Regression only | ⚠️ Stats only | ⚠️ Partial | ❌ None | ❌ None |
| Debug Team | active | ✅ Full | ❌ Delegates to Auto | ✅ Full | ✅ Full | ❌ None | ❌ None |
| Parallel Execution | experimental | ✅ Full | ✅ Full | ⚠️ Stats only | ❌ Missing | ❌ None | ❌ None |
| Self-Healing | stable | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ❌ None | ❌ None |
| Autonomous Loop | active | ❌ None | ✅ Full | ✅ Full | ❌ Missing | ❌ None | ❌ None |
| Commissioning Loop | active | ❌ None | ✅ Full | ✅ Full | ❌ Missing | ❌ None | ❌ None |
| HermesClaw | active | ❌ None | ✅ Full | ✅ Full | ❌ Missing | ❌ None | ❌ None |
| Learning Gateway | active | ❌ None | ✅ Full | ✅ Full | ⚠️ Partial | ❌ None | ❌ None |

---

*Generated by automated gap crawl on 2026-05-20. See [`product-features/feature-gap-scan.md`](feature-gap-scan.md) for the previous dashboard-focused gap analysis.*
