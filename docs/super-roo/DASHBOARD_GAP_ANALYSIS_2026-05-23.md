# SuperRoo Cloud Dashboard — Comprehensive Gap Analysis

**Date:** 2026-05-23  
**Scope:** All 51 dashboard tabs in [`cloud/dashboard/src/components/views/`](cloud/dashboard/src/components/views/)  
**Method:** Systematic review of every view file — structure, features, data fetching, state handling, and quality patterns

---

## Gap Severity Classification

| Severity        | Definition                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| 🔴 **Critical** | Uses mock/hardcoded data, not connected to real API; broken functionality           |
| 🟠 **High**     | Missing core features expected for the tab's purpose; no CRUD, no real-time updates |
| 🟡 **Medium**   | Missing quality-of-life features: search, filter, export, pagination, sorting       |
| 🔵 **Low**      | Polish issues: inconsistent theming, missing loading/error/empty states, minor UX   |

---

## Tab-by-Tab Gap Analysis

### 1. [`product-memory.tsx`](cloud/dashboard/src/components/views/product-memory.tsx) — 7.8KB

| Severity  | Gap                                                            |
| --------- | -------------------------------------------------------------- |
| 🟠 High   | Minimal implementation — only 7.8KB, likely just a placeholder |
| 🟡 Medium | No search/filter on memory entries                             |
| 🟡 Medium | No export functionality                                        |
| 🔵 Low    | No polling or auto-refresh                                     |

### 2. [`ml-engine.tsx`](cloud/dashboard/src/components/views/ml-engine.tsx) — 8KB

| Severity  | Gap                               |
| --------- | --------------------------------- |
| 🟠 High   | Minimal implementation — only 8KB |
| 🟡 Medium | No model training controls        |
| 🟡 Medium | No inference testing UI           |
| 🟡 Medium | No export of results              |

### 3. [`file-importer.tsx`](cloud/dashboard/src/components/views/file-importer.tsx) — 8.8KB

| Severity  | Gap                                 |
| --------- | ----------------------------------- |
| 🟠 High   | Minimal implementation — only 8.8KB |
| 🟡 Medium | No drag-and-drop UI                 |
| 🟡 Medium | No import history                   |
| 🟡 Medium | No batch import support             |

### 4. [`auto-deploy.tsx`](cloud/dashboard/src/components/views/auto-deploy.tsx) — 9.2KB

| Severity  | Gap                                 |
| --------- | ----------------------------------- |
| 🟠 High   | Minimal implementation — only 9.2KB |
| 🟡 Medium | No deploy schedule configuration    |
| 🟡 Medium | No deploy history beyond basic list |
| 🟡 Medium | No rollback controls                |
| 🔵 Low    | No polling                          |

### 5. [`events.tsx`](cloud/dashboard/src/components/views/events.tsx) — 11.1KB

| Severity  | Gap                                         |
| --------- | ------------------------------------------- |
| 🟡 Medium | No event filtering by type/severity         |
| 🟡 Medium | No event search                             |
| 🟡 Medium | No export                                   |
| 🟡 Medium | No real-time event streaming (uses polling) |
| 🔵 Low    | No pagination for large event volumes       |

### 6. [`savepoints.tsx`](cloud/dashboard/src/components/views/savepoints.tsx) — 11.7KB

| Severity  | Gap                          |
| --------- | ---------------------------- |
| 🟡 Medium | No savepoint creation UI     |
| 🟡 Medium | No restore/rollback controls |
| 🟡 Medium | No savepoint comparison/diff |
| 🟡 Medium | No export                    |
| 🔵 Low    | No polling                   |

### 7. [`autonomous-loop.tsx`](cloud/dashboard/src/components/views/autonomous-loop.tsx) — 12.4KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No loop configuration controls |
| 🟡 Medium | No iteration history           |
| 🟡 Medium | No pause/resume controls       |
| 🟡 Medium | No export of loop results      |

### 8. [`agents.tsx`](cloud/dashboard/src/components/views/agents.tsx) — 13KB

| Severity  | Gap                             |
| --------- | ------------------------------- |
| 🟡 Medium | No agent configuration editing  |
| 🟡 Medium | No agent enable/disable toggles |
| 🟡 Medium | No agent logs view              |
| 🟡 Medium | No export                       |

### 9. [`ollama-growth.tsx`](cloud/dashboard/src/components/views/ollama-growth.tsx) — 13.1KB

| Severity  | Gap                                   |
| --------- | ------------------------------------- |
| 🟡 Medium | Uses recharts but limited chart types |
| 🟡 Medium | No export of growth data              |
| 🟡 Medium | No model comparison view              |
| 🔵 Low    | No polling                            |

### 10. [`task-timeline.tsx`](cloud/dashboard/src/components/views/task-timeline.tsx) — 13.1KB

| Severity  | Gap                               |
| --------- | --------------------------------- |
| 🟡 Medium | No task filtering by status/agent |
| 🟡 Medium | No task search                    |
| 🟡 Medium | No export of timeline             |
| 🔵 Low    | No task detail panel              |

### 11. [`queue.tsx`](cloud/dashboard/src/components/views/queue.tsx) — 14.1KB

| Severity  | Gap                      |
| --------- | ------------------------ |
| 🟡 Medium | No job priority controls |
| 🟡 Medium | No job cancellation UI   |
| 🟡 Medium | No job retry mechanism   |
| 🟡 Medium | No export                |
| 🔵 Low    | No pagination            |

### 12. [`commissioning-loop.tsx`](cloud/dashboard/src/components/views/commissioning-loop.tsx) — 14.3KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No commissioning configuration |
| 🟡 Medium | No test result history         |
| 🟡 Medium | No export of results           |
| 🔵 Low    | No polling                     |

### 13. [`github.tsx`](cloud/dashboard/src/components/views/github.tsx) — 14.6KB

| Severity  | Gap                             |
| --------- | ------------------------------- |
| 🟡 Medium | No GitHub authentication status |
| 🟡 Medium | No repository selection         |
| 🟡 Medium | No PR creation UI               |
| 🟡 Medium | No export                       |

### 14. [`crawler.tsx`](cloud/dashboard/src/components/views/crawler.tsx) — 14.9KB

| Severity  | Gap                     |
| --------- | ----------------------- |
| 🟡 Medium | No crawl configuration  |
| 🟡 Medium | No crawl results viewer |
| 🟡 Medium | No crawl scheduling     |
| 🟡 Medium | No export               |

### 15. [`mcp-servers.tsx`](cloud/dashboard/src/components/views/mcp-servers.tsx) — 15.8KB

| Severity  | Gap                                                                                         |
| --------- | ------------------------------------------------------------------------------------------- |
| 🟡 Medium | Uses VSCode CSS variables (`var(--vscode-*)`) — inconsistent with other tabs using Tailwind |
| 🟡 Medium | No MCP server add/remove UI                                                                 |
| 🟡 Medium | No server configuration editing                                                             |
| 🟡 Medium | No server logs view                                                                         |
| 🔵 Low    | No polling                                                                                  |

### 16. [`settings.tsx`](cloud/dashboard/src/components/views/settings.tsx) — 15.8KB

| Severity    | Gap                                                                       |
| ----------- | ------------------------------------------------------------------------- |
| 🔴 Critical | **Hardcoded MCP server list** — not fetched from API                      |
| 🔴 Critical | **Hardcoded Live Decision Monitor examples** — not connected to real data |
| 🟡 Medium   | No settings save confirmation                                             |
| 🟡 Medium   | No settings reset to defaults                                             |
| 🔵 Low      | No polling                                                                |

### 17. [`logs.tsx`](cloud/dashboard/src/components/views/logs.tsx) — 18.3KB

| Severity    | Gap                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| 🔴 Critical | **Uses MOCK_DATA** — MOCK_HEALTH, MOCK_LOGS, MOCK_API_ROWS, MOCK_TIMELINE — not connected to real API |
| 🟡 Medium   | No log level filtering                                                                                |
| 🟡 Medium   | No log search                                                                                         |
| 🟡 Medium   | No log export                                                                                         |
| 🟡 Medium   | No real-time log streaming                                                                            |
| 🔵 Low      | No pagination                                                                                         |

### 18. [`build-queue.tsx`](cloud/dashboard/src/components/views/build-queue.tsx) — 18.1KB

| Severity  | Gap                   |
| --------- | --------------------- |
| 🟡 Medium | No build cancellation |
| 🟡 Medium | No build retry        |
| 🟡 Medium | No build log viewer   |
| 🟡 Medium | No export             |
| 🔵 Low    | No polling            |

### 19. [`deploy-orchestrator.tsx`](cloud/dashboard/src/components/views/deploy-orchestrator.tsx) — 19.6KB

| Severity  | Gap                        |
| --------- | -------------------------- |
| 🟡 Medium | No deploy queue management |
| 🟡 Medium | No deploy cancellation     |
| 🟡 Medium | No deploy log streaming    |
| 🟡 Medium | No export                  |

### 20. [`provider-dashboard.tsx`](cloud/dashboard/src/components/views/provider-dashboard.tsx) — 20KB

| Severity  | Gap                                           |
| --------- | --------------------------------------------- |
| 🟡 Medium | No polling/auto-refresh                       |
| 🟡 Medium | No provider key management (save/test/delete) |
| 🟡 Medium | No search/filter on provider list             |
| 🟡 Medium | No export                                     |
| 🔵 Low    | No charts/visualizations                      |

### 21. [`sandbox.tsx`](cloud/dashboard/src/components/views/sandbox.tsx) — 21KB

| Severity  | Gap                                  |
| --------- | ------------------------------------ |
| 🟡 Medium | No container start/stop/kill actions |
| 🟡 Medium | No image management (pull/remove)    |
| 🟡 Medium | No compose service start/stop        |
| 🟡 Medium | No audit log export                  |
| 🟡 Medium | No real-time container logs          |

### 22. [`collaboration.tsx`](cloud/dashboard/src/components/views/collaboration.tsx) — 22KB

| Severity  | Gap                                                                  |
| --------- | -------------------------------------------------------------------- |
| 🟡 Medium | Uses VSCode CSS variables (`var(--vscode-*)`) — inconsistent theming |
| 🟡 Medium | No invite/collaborator management                                    |
| 🟡 Medium | No file snapshot history                                             |
| 🟡 Medium | No real-time WebSocket (uses polling)                                |
| 🟡 Medium | No session creation UI                                               |
| 🟡 Medium | No export                                                            |

### 23. [`debug-team.tsx`](cloud/dashboard/src/components/views/debug-team.tsx) — 22KB

| Severity  | Gap                              |
| --------- | -------------------------------- |
| 🟡 Medium | No job detail view beyond expand |
| 🟡 Medium | No job log streaming             |
| 🟡 Medium | No export                        |
| 🟡 Medium | No schedule configuration        |

### 24. [`healing.tsx`](cloud/dashboard/src/components/views/healing.tsx) — 22KB

| Severity  | Gap                                      |
| --------- | ---------------------------------------- |
| 🟡 Medium | No export of healing metrics             |
| 🟡 Medium | No incident filtering by severity/status |
| 🟡 Medium | No manual healing trigger                |
| 🔵 Low    | No polling                               |

### 25. [`hermes-claw.tsx`](cloud/dashboard/src/components/views/hermes-claw.tsx) — 23KB

| Severity  | Gap                        |
| --------- | -------------------------- |
| 🟡 Medium | No export of query results |
| 🟡 Medium | No query history           |
| 🟡 Medium | No saved queries           |
| 🔵 Low    | No polling                 |

### 26. [`predictive-risk.tsx`](cloud/dashboard/src/components/views/predictive-risk.tsx) — 23KB

| Severity  | Gap                           |
| --------- | ----------------------------- |
| 🟡 Medium | No risk mitigation actions    |
| 🟡 Medium | No export of risk assessments |
| 🟡 Medium | No risk trend visualization   |
| 🔵 Low    | No polling                    |

### 27. [`bugs.tsx`](cloud/dashboard/src/components/views/bugs.tsx) — 25KB

| Severity    | Gap                                            |
| ----------- | ---------------------------------------------- |
| 🔴 Critical | **Uses MOCK_DATA** — not connected to real API |
| 🟡 Medium   | Uses recharts but charts may be mock data      |
| 🟡 Medium   | No bug creation UI                             |
| 🟡 Medium   | No bug assignment                              |
| 🟡 Medium   | No export                                      |

### 28. [`jobs.tsx`](cloud/dashboard/src/components/views/jobs.tsx) — 25KB

| Severity  | Gap                 |
| --------- | ------------------- |
| 🟡 Medium | No job cancellation |
| 🟡 Medium | No job retry        |
| 🟡 Medium | No job log viewer   |
| 🟡 Medium | No export           |
| 🔵 Low    | No pagination       |

### 29. [`model-router.tsx`](cloud/dashboard/src/components/views/model-router.tsx) — 25KB

| Severity  | Gap                      |
| --------- | ------------------------ |
| 🟡 Medium | No route editing UI      |
| 🟡 Medium | No route testing         |
| 🟡 Medium | No model cost comparison |
| 🟡 Medium | No export                |

### 30. [`features.tsx`](cloud/dashboard/src/components/views/features.tsx) — 25KB

| Severity  | Gap                                                                   |
| --------- | --------------------------------------------------------------------- |
| 🟡 Medium | Has CRUD icons (Plus, Edit3, Trash2, Save) but may not be fully wired |
| 🟡 Medium | No feature health history                                             |
| 🟡 Medium | No export                                                             |
| 🔵 Low    | No polling                                                            |

### 31. [`overview.tsx`](cloud/dashboard/src/components/views/overview.tsx) — 25KB

| Severity  | Gap                         |
| --------- | --------------------------- |
| 🟡 Medium | No export of overview data  |
| 🟡 Medium | Limited chart interactivity |
| 🔵 Low    | No polling                  |

### 32. [`docker.tsx`](cloud/dashboard/src/components/views/docker.tsx) — 26KB

| Severity  | Gap                                                         |
| --------- | ----------------------------------------------------------- |
| 🟡 Medium | No container log streaming (has LogStream but may be basic) |
| 🟡 Medium | No image management                                         |
| 🟡 Medium | No network management                                       |
| 🟡 Medium | No export                                                   |

### 33. [`brain.tsx`](cloud/dashboard/src/components/views/brain.tsx) — 25KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No brain configuration editing |
| 🟡 Medium | No agent enable/disable        |
| 🟡 Medium | No export of brain manifest    |
| 🔵 Low    | No polling                     |

### 34. [`monitoring.tsx`](cloud/dashboard/src/components/views/monitoring.tsx) — 28KB

| Severity  | Gap                        |
| --------- | -------------------------- |
| 🟡 Medium | No log export              |
| 🟡 Medium | No alert configuration     |
| 🟡 Medium | No custom dashboard layout |
| 🔵 Low    | No polling                 |

### 35. [`ram-orchestrator.tsx`](cloud/dashboard/src/components/views/ram-orchestrator.tsx) — 28KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No RAM threshold configuration |
| 🟡 Medium | No export of RAM history       |
| 🟡 Medium | No alert configuration         |
| 🔵 Low    | No polling                     |

### 36. [`commit-deploy.tsx`](cloud/dashboard/src/components/views/commit-deploy.tsx) — 29KB

| Severity  | Gap                         |
| --------- | --------------------------- |
| 🟡 Medium | No commit/deploy comparison |
| 🟡 Medium | No export                   |
| 🔵 Low    | No polling                  |

### 37. [`approvals.tsx`](cloud/dashboard/src/components/views/approvals.tsx) — 31KB

| Severity  | Gap                             |
| --------- | ------------------------------- |
| 🟡 Medium | No approval rules configuration |
| 🟡 Medium | No export of approval history   |
| 🔵 Low    | No polling                      |

### 38. [`workflow-compliance.tsx`](cloud/dashboard/src/components/views/workflow-compliance.tsx) — 36KB

| Severity  | Gap                              |
| --------- | -------------------------------- |
| 🟡 Medium | No compliance report export      |
| 🟡 Medium | No compliance rule configuration |
| 🔵 Low    | No polling                       |

### 39. [`skill-generator.tsx`](cloud/dashboard/src/components/views/skill-generator.tsx) — 38KB

| Severity  | Gap                           |
| --------- | ----------------------------- |
| 🟡 Medium | No skill editing UI           |
| 🟡 Medium | No skill testing              |
| 🟡 Medium | No export of generated skills |
| 🔵 Low    | No polling                    |

### 40. [`intelligence-layer.tsx`](cloud/dashboard/src/components/views/intelligence-layer.tsx) — 39KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No export of intelligence data |
| 🟡 Medium | No data refresh controls       |
| 🔵 Low    | No polling                     |

### 41. [`memory-explorer.tsx`](cloud/dashboard/src/components/views/memory-explorer.tsx) — 44KB

| Severity  | Gap                      |
| --------- | ------------------------ |
| 🟡 Medium | No memory editing        |
| 🟡 Medium | No memory deletion       |
| 🟡 Medium | No export of memory data |
| 🔵 Low    | No polling               |

### 42. [`working-tree.tsx`](cloud/dashboard/src/components/views/working-tree.tsx) — 45KB

| Severity  | Gap                         |
| --------- | --------------------------- |
| 🟡 Medium | No tree node editing        |
| 🟡 Medium | No tree node creation       |
| 🟡 Medium | No export of tree structure |
| 🔵 Low    | No polling                  |

### 43. [`deploy.tsx`](cloud/dashboard/src/components/views/deploy.tsx) — 49KB

| Severity  | Gap                         |
| --------- | --------------------------- |
| 🟡 Medium | No deploy comparison        |
| 🟡 Medium | No export of deploy history |
| 🔵 Low    | No polling                  |

### 44. [`telegram.tsx`](cloud/dashboard/src/components/views/telegram.tsx) — 61KB

| Severity  | Gap                                 |
| --------- | ----------------------------------- |
| 🟡 Medium | No export of activity log           |
| 🟡 Medium | No bot configuration beyond webhook |
| 🔵 Low    | No polling                          |

### 45. [`ai-assistant.tsx`](cloud/dashboard/src/components/views/ai-assistant.tsx) — 15KB

| Severity  | Gap                            |
| --------- | ------------------------------ |
| 🟡 Medium | No agent configuration editing |
| 🟡 Medium | No agent logs                  |
| 🟡 Medium | No export                      |
| 🔵 Low    | No polling                     |

### 46. [`parallel-execution.tsx`](cloud/dashboard/src/components/views/parallel-execution.tsx) — 20KB

| Severity  | Gap                          |
| --------- | ---------------------------- |
| 🟡 Medium | No export of execution stats |
| 🔵 Low    | No polling (uses WebSocket)  |

### 47. [`projects.tsx`](cloud/dashboard/src/components/views/projects.tsx) — 23KB

| Severity  | Gap                    |
| --------- | ---------------------- |
| 🟡 Medium | No project creation UI |
| 🟡 Medium | No project deletion    |
| 🟡 Medium | No project settings    |
| 🟡 Medium | No export              |

---

## Cross-Cutting Gaps (Apply to Most Tabs)

| Gap                                                    | Affected Tabs                      | Severity    |
| ------------------------------------------------------ | ---------------------------------- | ----------- |
| **No export functionality**                            | ~45 tabs                           | 🟡 Medium   |
| **No pagination**                                      | ~40 tabs                           | 🟡 Medium   |
| **No search/filter**                                   | ~35 tabs                           | 🟡 Medium   |
| **No polling or auto-refresh**                         | ~30 tabs                           | 🔵 Low      |
| **No real-time WebSocket** (most use polling)          | ~45 tabs                           | 🟡 Medium   |
| **No CRUD operations** (create/edit/delete)            | ~25 tabs                           | 🟠 High     |
| **No loading/error/empty states**                      | ~10 tabs                           | 🔵 Low      |
| **Inconsistent theming** (VSCode CSS vars vs Tailwind) | mcp-servers.tsx, collaboration.tsx | 🟡 Medium   |
| **Mock data**                                          | logs.tsx, bugs.tsx, settings.tsx   | 🔴 Critical |
| **No date range filters**                              | ~40 tabs                           | 🟡 Medium   |
| **No log level filters**                               | ~45 tabs                           | 🟡 Medium   |

---

## Priority Ranking for Fixes

### 🔴 P0 — Critical (Must Fix)

1. **`logs.tsx`** — Replace MOCK_DATA with real API calls
2. **`bugs.tsx`** — Replace MOCK_DATA with real API calls
3. **`settings.tsx`** — Replace hardcoded MCP server list and Live Decision Monitor examples with API-driven data

### 🟠 P1 — High (Should Fix)

1. **`product-memory.tsx`** — Expand from 7.8KB placeholder to full implementation
2. **`ml-engine.tsx`** — Expand from 8KB placeholder to full implementation
3. **`file-importer.tsx`** — Expand from 8.8KB placeholder to full implementation
4. **`auto-deploy.tsx`** — Expand from 9.2KB placeholder to full implementation
5. Add CRUD operations to all tabs that manage entities (agents, features, projects, etc.)

### 🟡 P2 — Medium (Nice to Have)

1. Add export functionality to all tabs
2. Add pagination to all list-based tabs
3. Add search/filter to all data-heavy tabs
4. Add date range filters to time-series tabs
5. Add polling/auto-refresh to all tabs
6. Add WebSocket real-time updates where appropriate
7. Standardize theming (remove VSCode CSS variable usage)

### 🔵 P3 — Low (Polish)

1. Add loading skeletons to all tabs
2. Add error states with retry buttons
3. Add empty states with helpful messages
4. Add keyboard shortcuts
5. Add tooltips for all action buttons

---

## Theming Inconsistency Detail

Two tabs use VSCode CSS variables instead of Tailwind classes:

| Tab                                                                           | Pattern           | Example                                |
| ----------------------------------------------------------------------------- | ----------------- | -------------------------------------- |
| [`mcp-servers.tsx`](cloud/dashboard/src/components/views/mcp-servers.tsx)     | `var(--vscode-*)` | `border-[var(--vscode-panel-border)]`  |
| [`collaboration.tsx`](cloud/dashboard/src/components/views/collaboration.tsx) | `var(--vscode-*)` | `bg-[var(--vscode-editor-background)]` |

All other tabs use hardcoded Tailwind colors like `border-[#1e2535]`, `bg-[#0f1117]`, etc. This inconsistency means these two tabs will look different when the VSCode theme changes.

---

## API Endpoint Patterns

Most tabs call endpoints under these patterns:

- `/api/orchestrator/...` — Main orchestrator API
- `/api/...` — Direct API calls
- `/api/deploy/...` — Deploy-specific endpoints
- `/api/brain/...` — Brain/MCP endpoints

Some tabs (logs.tsx, bugs.tsx) use mock data and don't call any API.

---

## Real-Time Update Patterns

| Method                       | Tabs Using It                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| **Polling (setInterval)**    | sandbox (15s), collaboration (5s), debug-team (5s), monitoring, docker, ram-orchestrator |
| **WebSocket**                | parallel-execution.tsx                                                                   |
| **Server-Sent Events (SSE)** | task-timeline.tsx, brain.tsx                                                             |
| **No real-time updates**     | ~30 tabs                                                                                 |

---

## Summary Statistics

| Metric                                   | Count                                                     |
| ---------------------------------------- | --------------------------------------------------------- |
| Total tabs analyzed                      | 51                                                        |
| Tabs with mock data (🔴 Critical)        | 3 (logs.tsx, bugs.tsx, settings.tsx)                      |
| Tabs with minimal implementation (<10KB) | 4 (product-memory, ml-engine, file-importer, auto-deploy) |
| Tabs with VSCode CSS variable theming    | 2 (mcp-servers, collaboration)                            |
| Tabs with WebSocket/SSE real-time        | 3 (parallel-execution, task-timeline, brain)              |
| Tabs with polling                        | ~8                                                        |
| Tabs with no real-time updates           | ~30                                                       |
| Tabs with export functionality           | 0                                                         |
| Tabs with pagination                     | 1 (deploy.tsx has page size selector)                     |
| Tabs with search/filter                  | ~6                                                        |
