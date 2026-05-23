# Product Feature Gap Scan

> Date: 2026-05-18  
> Branch: fix/webview-recovery  
> Method: Cross-reference Working Tree modules ↔ Dashboard views ↔ API endpoints

---

## Summary

| Category                | Count                                  |
| ----------------------- | -------------------------------------- |
| Working Tree modules    | 20                                     |
| Dashboard sidebar items | 27                                     |
| Dashboard view files    | 29 (2 orphaned)                        |
| API endpoint families   | ~45                                    |
| **Gaps found**          | **6 missing views + 2 orphaned views** |

---

## 1. Orphaned Views (Built But Unwired)

These view components exist in `cloud/dashboard/src/components/views/` but are **NOT** registered in `app/page.tsx` or `sidebar.tsx`.

### 1.1 Auto-Deploy (`auto-deploy.tsx`) ✅ FIXED

- **What it does**: Shows deploy status, attempts, trigger controls, success/failure history
- **API coverage**: `GET /api/auto-deploy/status`, `POST /api/auto-deploy/trigger`
- **Fix**: Added to `PAGES` in `page.tsx` and `NAV` in `sidebar.tsx`
- **Nav label**: "Auto Deploy" — placed after "Deploy"

### 1.2 Commit & Deploy Log (`commit-deploy.tsx`) ✅ FIXED

- **What it does**: Visualizes commit history, deploy history, success rates, failure reasons
- **API coverage**: `GET /api/commit-deploy-log/commits`, `GET /api/commit-deploy-log/deploys`, `GET /api/commit-deploy-log/stats`
- **Fix**: Added to `PAGES` in `page.tsx` and `NAV` in `sidebar.tsx`
- **Nav label**: "Commits" — placed after "Deploy"
- **Note**: The Working Tree view already embeds a mini commit-deploy panel, but this dedicated view is much richer.

---

## 2. Missing Dedicated Dashboard Views

These Working Tree modules have **API endpoints** but no dedicated dashboard view.

### 2.1 Debug Team (Module #13) ✅ FIXED

- **Working Tree status**: `active`
- **Features**: Super Debug Loop, Phase Breakdown, Hypothesis Engine, Container Sandbox, Rollback Manager, Feature Sync, Skills Generator, 24/7 autonomous iteration
- **API coverage**: `GET /debug-team/status`, `POST /debug-team/start`, `POST /debug-team/stop`, `GET /debug-team/jobs`
- **Dashboard view**: `debug-team.tsx` with start/stop controls, live progress, step timeline, recent jobs
- **Priority**: **HIGH** — Done

### 2.2 Parallel Execution Engine (Module #14) ✅ FIXED

- **Working Tree status**: `experimental`
- **Features**: Parallel task execution, inter-agent messaging, parallel healing, parallel ML training
- **API coverage**: `GET /orchestrator/parallel/stats`
- **Dashboard view**: `parallel-execution.tsx` with StatCards (active/submitted/completed/failed), token budget bar with color-coded usage, agent token costs table with horizontal bars, auto-refresh every 10s
- **Priority**: MEDIUM — Done

### 2.3 File Importer (Module #18) ✅ FIXED

- **Working Tree status**: `stable`
- **Features**: File import, content extraction, type validation
- **API coverage**: `POST /orchestrator/file-importer/import`, `GET /orchestrator/file-importer/stats`
- **Dashboard view**: `file-importer.tsx` with import form (textarea + submit), stats cards (total imports/files/errors/last import), recent imports history, auto-refresh
- **Priority**: LOW — Done

### 2.4 Remote Shell (Module #19)

- **Working Tree status**: `experimental`
- **Features**: SSH command execution, remote file operations
- **API coverage**: **NONE found** in api.js
- **Gap**: No backend API and no frontend view for remote shell operations
- **Priority**: LOW — Experimental; the VPS control center in Settings partially covers SSH deploy

### 2.5 Machine Learning Engine (Module #10) ✅ FIXED

- **Working Tree status**: `experimental`
- **Features**: Neural network training, CodeLearner, DebugLearner, TestLearner, Infinite Improvement Loop
- **Dashboard view**: `ml-engine.tsx` with model stats (type/loops/observations/predictions), learner status panel (CodeLearner, DebugLearner, TestLearner with sample counts), Infinite Improvement Loop panel (cycles/lessons/skills), "Train Cycle" button, auto-refresh every 15s
- **Remaining gap**: Neural network training status / Tensor operations and model serialization / federated merge status are still not surfaced in the dashboard
- **Priority**: MEDIUM — Core ML Engine view exists; training internals are a future enhancement

### 2.6 Product Memory (Module #11) ✅ FIXED

- **Working Tree status**: `stable`
- **Features**: Product feature tracking, update timeline, feature test history, bug-to-feature mapping, agent notes
- **Dashboard view**: `product-memory.tsx` with features table (status badges), bugs table (severity badges), Hermes stats (memory entries/operations/avg duration), auto-refresh every 30s
- **Remaining gap**: Update timeline (ProductUpdatesAgent), feature test records (FeatureTesterAgent), bug-to-feature mappings (BugFeatureMapperAgent), and agent notes are still not surfaced
- **Priority**: MEDIUM — Core Product Memory view exists; agent-specific outputs are a future enhancement

---

## 3. Modules with Partial Coverage

These modules have dashboard presence but may be missing sub-features.

### 3.1 CPU Guard (Module #15)

- **Coverage**: `monitoring` view shows CPU/RAM usage charts; `system/resources` API exists
- **Gap**: No dedicated CPU Guard view for:
    - Autonomous throttling configuration
    - Resource-aware scheduling rules
    - Agent loop guard settings
- **Priority**: LOW — Monitoring view is sufficient for observability

### 3.2 Safety System (Module #3)

- **Coverage**: `settings` view has orchestrator mode toggle and approval evaluation; `approvals` view shows pending approvals
- **Gap**: No dedicated Safety dashboard for:
    - Capability gating rules
    - Blocklist management
    - Safety event history
- **Priority**: LOW — Settings + Approvals covers the main user flows

### 3.3 Event Log (Module #6)

- **Coverage**: `logs` view shows log entries; `orchestrator/events` API exists
- **Gap**: The logs view uses mock/static data in some places and may not fully leverage the event sourcing API
- **Priority**: LOW — Functional but could be deepened

---

## 4. Quick-Wins Checklist

| #   | Fix                                            | Files                     | Effort                                    |
| --- | ---------------------------------------------- | ------------------------- | ----------------------------------------- |
| 1   | ~~Wire `auto-deploy.tsx` into dashboard~~ ✅   | `page.tsx`, `sidebar.tsx` | Done                                      |
| 2   | ~~Wire `commit-deploy.tsx` into dashboard~~ ✅ | `page.tsx`, `sidebar.tsx` | Done                                      |
| 3   | Add icon imports for new nav items             | `sidebar.tsx`             | Done (Rocket, GitCommit already imported) |
| 4   | ~~Create `debug-team.tsx` view~~ ✅            | new file + wiring         | Done                                      |
| 5   | Create `parallel-execution.tsx` view           | new file + wiring         | 30 min                                    |
| 6   | Create `file-importer.tsx` view                | new file + wiring         | 30 min                                    |

---

## 5. Appendix: Full Mapping

### Working Tree → Dashboard View → API

| #   | Module                    | Status       | Dashboard View                              | API Family                                   |
| --- | ------------------------- | ------------ | ------------------------------------------- | -------------------------------------------- |
| 1   | Orchestrator              | stable       | jobs, queue, agents, overview               | `/orchestrator/*`, `/jobs/*`, `/queue/*`     |
| 2   | Agent System              | stable       | agents, skill-generator, ai                 | `/agents/*`, `/brain/skill-generate`         |
| 3   | Safety System             | stable       | settings, approvals                         | `/settings/approval/*`, `/orchestrator/mode` |
| 4   | Memory System             | stable       | memory-explorer                             | `/memory-explorer/*`                         |
| 5   | Task Queue                | stable       | queue                                       | `/queue/*`                                   |
| 6   | Event Log                 | stable       | logs                                        | `/logs/*`, `/orchestrator/events`            |
| 7   | Feature Registry          | stable       | working-tree (partial)                      | `/orchestrator/features/*`                   |
| 8   | Bug Registry              | stable       | bugs                                        | `/orchestrator/bugs/*`                       |
| 9   | Self-Healing System       | stable       | healing                                     | `/healing/*`, `/orchestrator/healing/*`      |
| 10  | ML Engine                 | experimental | ollama-growth, intelligence-layer (partial) | `/ollama-growth`, `/learning/*`              |
| 11  | Product Memory            | stable       | intelligence-layer (partial)                | `/learning/*`                                |
| 12  | Commit & Deploy Log       | active       | `commit-deploy` ✅                          | `/commit-deploy-log/*`, `/deploy/summary`    |
| 13  | Debug Team                | active       | **MISSING**                                 | `/autonomous/start`                          |
| 14  | Parallel Execution Engine | experimental | **MISSING**                                 | `/orchestrator/parallel/stats`               |
| 15  | CPU Guard                 | stable       | monitoring (partial)                        | `/system/resources`                          |
| 16  | Deploy System             | stable       | deploy                                      | `/deploy/summary`, `/auto-deploy/*`          |
| 17  | Crawler Agent             | experimental | visual-crawler                              | `/visual-crawler/*`                          |
| 18  | File Importer             | stable       | **MISSING**                                 | `/orchestrator/file-importer/*`              |
| 19  | Remote Shell              | experimental | **MISSING**                                 | **NONE**                                     |
| 20  | Settings & API Keys       | active       | settings, api-keys, model-router            | `/settings/*`, `/model-router/*`             |

### Bonus: Orphaned view

| View            | Status       | API Coverage                                  |
| --------------- | ------------ | --------------------------------------------- |
| auto-deploy.tsx | **ORPHANED** | `/auto-deploy/status`, `/auto-deploy/trigger` |
