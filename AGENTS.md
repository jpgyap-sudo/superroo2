# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Superoo Agent Routing

Default orchestration flow:

1. Superoo retrieves relevant lessons from memory.
2. Ollama summarizes and compresses the relevant lessons.
3. Superoo builds compact task context.
4. DeepSeek is the default implementation coder.
5. Codex reviews architecture, safety, tests, and regressions.
6. New lessons are extracted after task completion.
7. Ollama summarizes the new lesson.
8. Central Brain stores the lesson permanently.

Important:

- Ollama is NOT the default coder.
- DeepSeek is the primary coding worker.
- Codex is the planner/reviewer.
- Superoo orchestrates all models.

## Required Before Coding

Run:

```bash
node scripts/ml/build-agent-context.mjs "<task>"
```

Read:

```text
memory/context/latest-agent-context.md
```

## Required After Coding

Run:

```bash
node scripts/extract-lesson-from-commit.mjs --interactive
```

Or for batch backfill of historical commits:

```bash
node scripts/backfill-lessons.mjs --since YYYY-MM-DD
```

Optional if available:

```bash
node scripts/ollama-summarize-lesson.mjs
node scripts/central-brain-store-lesson.mjs
```

**Every completed task MUST produce a lesson** in `memory/lessons-learned.md` using the standard format:

```markdown
### Lesson: [Short descriptive title]

Date: [YYYY-MM-DD]
Source: [Agent name] task completion
Model/API used: [model]
Confidence: [high/medium/low]
Related files: [comma-separated list]

#### Task Summary
[What was accomplished?]

#### Files Changed
- [file1]
- [file2]

#### Bug Cause
[Root cause if applicable]

#### Fix Applied
[What fixed it?]

#### Test Result
[pass/fail/unknown]

#### Lesson Learned
[Reusable engineering insight]

#### Reusable Rule
[Specific actionable rule for future agents]

#### Tags
[tag1, tag2, tag3]

---
```

## Working Tree

The **Working Tree** ([`docs/resources/working-tree.md`](docs/resources/working-tree.md)) is the single source of truth for the SuperRoo product architecture. It documents all 18 core modules, their connections, product features, owners, and interaction flows.

**Before making any changes**, agents MUST read the Working Tree to:

- Understand which modules are affected and their connections
- Check the Feature Registry and Product Memory to avoid duplication
- Check the Bug Registry and Healing System for existing incidents
- Consider the CPU Guard and Parallel Execution Engine for resource management

The Working Tree is also visualized in the SuperRoo Cloud Dashboard under the **Working Tree** tab.

## Commit & Deploy Log

The **Commit & Deploy Log** ([`src/super-roo/product-memory/CommitDeployLog.ts`](src/super-roo/product-memory/CommitDeployLog.ts)) is THE single source of truth for all commits and deployments across all coding agents.

**ALL agents MUST follow these rules:**

1. **Record every commit**: After making code changes, call `CommitDeployLog.recordCommit()` with the commit SHA, agent name, type (feature/bugfix/refactor/docs/config/test/deploy/other), title, files changed, and features affected.

2. **Record every deploy**: When deploying, call `CommitDeployLog.recordDeploy()` with the version, commit SHA, and agent name. After the deploy completes, call `CommitDeployLog.updateDeployStatus()` with the result (healthy/unhealthy/rolled_back/failed).

3. **Check history first**: Before starting work, use `CommitDeployLog.getCommits()` and `CommitDeployLog.getDeploys()` with filters to see what other agents have done and avoid conflicts.

4. **Link to features**: Always include `featuresAffected` when recording commits so the Working Tree can track which features are being modified.

The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change). It is persisted as JSON at [`server/src/memory/commit-deploy-log.json`](server/src/memory/commit-deploy-log.json) and visualized in the dashboard Working Tree tab.

## Codex Task Memory

The persistent Codex task log lives at [`server/src/memory/codextask.json`](server/src/memory/codextask.json) and is exposed through the SuperRoo brain/MCP actions `codex_task_upsert`, `codex_task_list`, `codex_task_get`, and `codex_task_get_active`.

**Codex-style agents MUST follow these rules:**

1. Before starting work, call `codex_task_list` or `codex_task_get_active` so they can recover recent context.
2. When a task starts, call `codex_task_upsert` with `status: "active"`, a clear title, summary, and affected features when known.
3. When the task changes materially, update the same task ID instead of creating duplicates.
4. When the task ends, update it with `status: "completed"`, `"blocked"`, or `"cancelled"` and include the final summary, changed files, and affected features.

## Tailscale Deployment (Mandatory)

**ALL deployments — cloud, VS Code, Telegram, workers — MUST use Tailscale SSH.**

The VPS Tailscale IP is **`100.64.175.88`** (hostname: `ubuntu-s-2vcpu-4gb-amd-nyc1`). Never use the public IP (`104.248.225.250`) for SSH connections.

```bash
# Correct — Tailscale IP
SSH_TARGET="root@100.64.175.88"

# Wrong — public IP (do not use)
SSH_TARGET="root@104.248.225.250"
```

All deploy scripts and auto-deployers have been updated. See [`docs/super-roo/DEPLOYMENT_GUIDE.md`](docs/super-roo/DEPLOYMENT_GUIDE.md) for full details and the [`tailscale`](.roo/skills/tailscale/SKILL.md) skill for reference.

## Settings View Pattern

When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save". Wiring inputs directly to the live state causes race conditions.

## Codex Workflow

This repository uses a model-routing workflow:

- **Codex** = planner, reviewer, tester, final verifier
- **DeepSeek** = primary low-cost coder / refactor worker
- **Ollama** = local memory, lessons, summaries, feature knowledge, retrieval helper
- **Central Brain** = persistent memory database / pgvector / lesson store

For Codex-led tasks, prefer this sequence:

1. Read repo rules and current context.
2. Check prior lessons and memory for related work.
3. Write the implementation plan.
4. Delegate the main coding work to DeepSeek when that route is available and appropriate.
5. Review the result, run tests, and record lessons or updates.

Codex may still code directly when the task is small, urgent, or the available tooling does not expose a DeepSeek worker path.

## Learning Layer Permanent Sync

**ALL agents are permanently synced to the SuperRoo learning layer.** This is not optional. The learning layer is the institutional memory of the project and prevents repeated mistakes.

### Before Coding — Retrieve Relevant Lessons

Agents MUST query the lesson index for relevant context:

```bash
# Get top lessons for the task at hand
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getTopLessons(5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query by file paths being modified
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForFile('src/super-roo/ml/engine/Tensor.ts', 3)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query by tags
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForTask('docker deployment', 5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"
```

Agents SHOULD also:
- Search `memory/lessons-learned.md` for keywords related to the task
- Search `memory/bugs-fixed.md` for similar bugs
- Search `memory/feature-knowledge.md` for related features

### After Coding — Record Lessons

Agents MUST append a lesson to `memory/lessons-learned.md` and ensure it is indexed in `memory/lesson-index.jsonl`. The git `post-commit` hook auto-extracts templates, but agents MUST review and complete the TODO sections.

If a commit was not made (e.g., config fix, docs update), manually append the lesson.

### Automatic Lesson Capture Infrastructure

- **Post-commit hook** (`.husky/post-commit`): auto-runs `extract-lesson-from-commit.mjs` on every commit that matches lesson indicators (fix, bug, refactor, performance, etc.)
- **Backfill script** (`scripts/backfill-lessons.mjs`): batch-processes git history to extract missed lessons. Already backfilled 104 lessons from May 2026.
- **Lesson index** (`memory/lesson-index.jsonl`): machine-readable JSONL for programmatic retrieval
- **Lesson summaries** (`memory/lesson-summaries.json`): Ollama-generated embeddings and summaries

### Agent Sync Pledge

This agent (Kimi Code CLI) is permanently synced:
- ✅ Reads lessons before every substantial coding task
- ✅ Writes lessons after every task completion
- ✅ Uses the LessonRetriever API when available
- ✅ Contributes to `memory/lessons-learned.md` and `memory/lesson-index.jsonl`
- ✅ Runs backfill when new historical context is discovered
- ✅ Queues lessons for Central Brain sync when the API is online

Before substantial code changes, check or create:

- `memory/lessons-learned.md`
- `memory/bugs-fixed.md`
- `memory/model-decisions.md`
- `memory/feature-knowledge.md`
- `docs/updates/`
- `docs/architecture/`
- `product-features/feature-status.md`
- `commissioning/test-results.md`

Ask:

1. Have we solved a similar bug before?
2. What did the previous model get wrong?
3. What files are usually involved?
4. What test catches this issue?
5. What reusable rule should be enforced?
