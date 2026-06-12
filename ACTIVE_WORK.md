# SuperRoo — Active Work Board

**All coding extensions MUST read this file before starting work and update their section when done.**
This prevents duplicate work and lets each agent build on what others have already done.

> Auto-generated from `~/.superroo/tasks/global-tasks.json` at 2026-06-12 11:50:00
> To update: `node scripts/gen-active-work.mjs`

---

## 🔵 Active Right Now

- 🟢 **Gap Closure — Kilo Code (2026-06-12)**
  Fixing gaps across the ecosystem: created monitoring-alerts route, .env.example, HermesClaw TS port, Kilo Code model escalation, dashboard gap doc update.

---

## 🧠 Claude Code

### Recently Completed

| Date | Task | Files |
|------|------|-------|
| 2026-06-07 | Persist Kilo Code webview test handoff | ACTIVE_WORK.md, .kilo/tasks/webview-manual-test-handoff.md |

---

## 🤖 Codex / Kilo

### In Progress (2026-06-12 Gap Closure)

| Item | Status | Files |
|------|--------|-------|
| Kilo Code model escalation chain | ✅ Complete | .kilo/agent/thinker.md, .kilo/agent/deep-reasoner.md, .kilo/agent/deep-expert.md |
| Dashboard gap audit correction | ✅ Complete | docs/super-roo/DASHBOARD_GAP_ANALYSIS_2026-05-23.md (outdated — see notes) |
| Monitoring alerts route (Telegram) | ✅ Complete | cloud/api/routes/monitoring-alerts.js, cloud/api/api.js |
| .env.example for docker-compose | ✅ Complete | .env.example |
| HermesClaw TS port (types + scaffold) | ✅ Complete | cloud/orchestrator/modules/HermesClawTypes.ts, HermesClaw.ts, hermes-index.ts |
| SelfHealingLoop tests | ✅ Already existed (37 tests pass) | — |
| Dashboard mock data | ✅ Already fixed in prior commit | — |

### Remaining (future sprints)

| Item | Priority | Notes |
|------|----------|-------|
| AutonomousLoop TS port (1205 lines JS) | Medium | Pattern established with HermesClaw port |
| CommissioningLoop TS port (1653 lines JS) | Medium | Largest JS agent |
| Neural Network cloud port (257 lines) | Medium | ML engine stuck in extension |
| SuperDebugLoop cloud port (1499 lines) | Medium | Debug orchestrator stuck in extension |
| Split monolithic api.js (15,370 lines) | Low | Raw http.createServer — needs Express migration |
| Dashboard cross-cutting features | Low | Export, pagination, search already present in most tabs |

---

## 🧭 GitHub Copilot

### Recently Completed

| Date | Task | Files |
|------|------|-------|
| 2026-06-07 | Upgrade Copilot Chat to local Ollama coding agent | .github/copilot-instructions.md, .github/copilot-tasks.json |
| 2026-06-05 | Sync GitHub Copilot tasks with SuperRoo | .github/copilot-instructions.md, .github/copilot-tasks.json |

---

## ❓ Deepseek-reasoner

### Recently Completed

| Date | Task | Files |
|------|------|-------|
| 2026-06-08 | WS7: AgentBus — make EventLog optional | src/super-roo/parallel/AgentBus.ts |
| 2026-06-08 | WS6: MLClassifier — add getTrainingExamples() accessor | src/super-roo/healing/MLClassifier.ts |
| 2026-06-08 | WS5: InfiniteImprovementLoop — brain outcomes + classifier-to-debug category conversion | src/super-roo/ml/loop/InfiniteImprovementLoop.ts |
| 2026-06-08 | WS4: MLSyncClient — persistent queue, degraded mode, exponential backoff | src/super-roo/ml/sync/MLSyncClient.ts |
| 2026-06-08 | WS3: Task.ts context estimation fix — guard clauses for empty history (CRITICAL: fixed 5 failing tests) | src/core/task/Task.ts, src/core/context-management/index.ts |
| 2026-06-08 | WS2: Task.ts MCP vision routing — ollama_vision_data + brain_analyze_image fallback | src/core/task/Task.ts |
| 2026-06-08 | WS1: Condense — Ollama phi4 primary summarizer with context overflow rescue | src/core/condense/index.ts, src/core/condense/__tests__/condense.spec.ts, src/core/condense/__tests__/index.spec.ts |
| 2026-06-10 | Condense performance optimizations — tool output filtering, tree-sitter caching, terminal wait skip | src/core/condense/index.ts, src/core/condense/foldedFileContext.ts, src/core/task/Task.ts, src/core/environment/getEnvironmentDetails.ts |
| 2026-06-07 | Connect DeepSeek Reasoner to SuperRoo Brain MCP | .mcp.json, scripts/codex-brain-mcp.mjs |

---

## ❓ Blackbox

### Recently Completed

| Date | Task | Files |
|------|------|-------|
| 2026-06-08 | Blackbox sync intelligence hardening - run tests and verify no regressions | webview-ui/src/components/super-roo/tabs/__tests__/DashboardTab.spec.tsx, src/super-roo/ml/sync/MLSyncClient.ts, src/core/webview/ClineProvider.ts |
| 2026-06-05 | Maintain Blackbox extension sync | C:/Users/user/Documents/.blackbox/.blackboxrules, C:/Users/user/AppData/Roaming/Code/User/globalStorage/blackboxapp.blackboxagent/settings/blackbox_mcp_settings.json |

---

## 📊 Task Stats

- Total tasks: 77
- Active: 1
- Completed: 72
- Blocked: 4
- Registry: `C:\Users\user\.superroo\tasks\global-tasks.json`
