# CLAUDE.md — SuperRoo Project Guide for Claude Code

This file provides guidance to Claude Code when working with the SuperRoo repository.

## Project Overview

**SuperRoo** — A VS Code extension with ML engine, healing module, crawler agent, cloud dashboard (Next.js), Telegram bot, and learning layer. Monorepo managed with pnpm workspaces.

## Agent Routing

This project uses a model-routing workflow:

- **Codex** = planner, reviewer, tester, final verifier
- **DeepSeek** = primary low-cost coder / refactor worker
- **Ollama** = local memory, lessons, summaries, feature knowledge, retrieval helper
- **Central Brain** = persistent memory database / pgvector / lesson store
- **Claude** = planner, reviewer, orchestrator — delegates coding to DeepSeek via MCP

### Workflow Enforcement (MCP Tools)

Claude Code MUST use the `deepseek-coder` MCP server (registered in `.mcp.json`) to delegate coding tasks to DeepSeek V4. This is how the agent routing workflow is enforced:

| Phase         | Tool                          | Provider    | When to Use                                                    |
| ------------- | ----------------------------- | ----------- | -------------------------------------------------------------- |
| **Plan**      | Claude's own model            | Claude      | Analyze requirements, design architecture, plan implementation |
| **Code**      | `deepseek_code`               | DeepSeek V4 | Write new code, implement features, create files               |
| **Review**    | `deepseek_review`             | DeepSeek V4 | Review code for bugs, security, performance                    |
| **Refactor**  | `deepseek_refactor`           | DeepSeek V4 | Improve existing code structure and quality                    |
| **Explain**   | `deepseek_explain`            | DeepSeek V4 | Understand complex code, generate docs                         |
| **Summarize** | `ollama-summarize-lesson.mjs` | Ollama      | Summarize lessons after task completion                        |

**Workflow rule:** Claude MUST call `deepseek_code` for any substantial coding task instead of writing code directly. Claude handles planning, review, and orchestration. DeepSeek handles implementation.

**Available MCP tools:**

1. **`deepseek_code(prompt, system?, model?, temperature?, max_tokens?)** — Generate code using DeepSeek V4. Pass the coding task as `prompt`. Optionally set `system` prompt for context.

2. **`deepseek_review(code, context?, model?)** — Review code using DeepSeek V4. Returns structured review with severity levels.

3. **`deepseek_refactor(code, instructions?, model?)** — Refactor code using DeepSeek V4. Pass refactoring goals as `instructions`.

4. **`deepseek_explain(code, context?, model?)** — Explain code using DeepSeek V4. Returns detailed explanation with design patterns and data flow.

5. \*\*`deepseek_status()` — Check if DeepSeek API is configured and reachable.

## Learning Layer — Mandatory Sync

**ALL agents are permanently synced to the SuperRoo learning layer.** This is not optional.

### Before Coding — Retrieve Relevant Lessons

```bash
# Get top lessons for the task at hand
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getTopLessons(5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query by file paths being modified
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForFile('src/super-roo/ml/engine/Tensor.ts', 3)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query by tags
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForTask('docker deployment', 5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"
```

Also search:

- `memory/lessons-learned.md` for keywords related to the task
- `memory/bugs-fixed.md` for similar bugs
- `memory/feature-knowledge.md` for related features

### After Coding — Record Lessons

Every completed task MUST produce a lesson in `memory/lessons-learned.md`:

```markdown
### Lesson: [Short descriptive title]

Date: [YYYY-MM-DD]
Source: Claude Code task completion
Model/API used: claude
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

Then run:

```bash
node scripts/extract-lesson-from-commit.mjs --interactive
node scripts/ollama-summarize-lesson.mjs    # when Ollama is running
node scripts/central-brain-store-lesson.mjs  # when Central Brain is running
```

## Working Tree

The **Working Tree** ([`docs/resources/working-tree.md`](docs/resources/working-tree.md)) is the single source of truth for the SuperRoo product architecture. Before making changes, read it to understand which modules are affected.

## Commit & Deploy Log

The **Commit & Deploy Log** ([`src/super-roo/product-memory/CommitDeployLog.ts`](src/super-roo/product-memory/CommitDeployLog.ts)) is the single source of truth for all commits and deployments.

**ALL agents MUST:**

1. Record every commit via `CommitDeployLog.recordCommit()`
2. Record every deploy via `CommitDeployLog.recordDeploy()`
3. Check history first with `CommitDeployLog.getCommits()` / `getDeploys()`
4. Link commits to affected features

## Tailscale Deployment (Mandatory)

**ALL deployments MUST use Tailscale SSH.** Never use the public IP.

```bash
SSH_TARGET="root@100.64.175.88"       # Correct — Tailscale IP
# SSH_TARGET="root@104.248.225.250"   # Wrong — public IP (do not use)
```

## Key Commands

```bash
# Build agent context before coding
node scripts/ml/build-agent-context.mjs "<task>"

# Run tests (from correct directory)
cd src && npx vitest run path/to/test-file
cd webview-ui && npx vitest run src/path/to/test-file

# Deploy
bash cloud/remote-deploy-dashboard.sh
```

## Code Quality Rules

1. **Test Coverage**: All code changes must have test coverage. All tests must pass before submitting.
2. **Lint Rules**: Never disable any lint rules without explicit approval.
3. **Styling**: Use Tailwind CSS classes instead of inline style objects for new markup.
4. **JSON Writing**: Use `safeWriteJson()` from `src/utils/safeWriteJson.ts` for atomic JSON writes.

## Claude Task Memory

Claude Code has persistent task memory at [`server/src/memory/claudetask.json`](server/src/memory/claudetask.json), following the same schema as Codex and Kimi task memory.

**Rules:**

1. Before starting work, read `server/src/memory/claudetask.json` to recover recent context.
2. When a task starts, upsert a task with `status: "active"`, a clear title, summary, and affected features.
3. When the task changes materially, update the same task ID instead of creating duplicates.
4. When the task ends, update it with `status: "completed"`, `"blocked"`, or `"cancelled"` and include the final summary, changed files, and affected features.

Available MCP tools (when MCP memory server is running): `claude_task_upsert`, `claude_task_list`, `claude_task_get`, `claude_task_get_active`.

The task log is also searchable via the MCP memory server's `query_memory` tool and exposed as a resource at `memory://claude/tasks`.

## Settings View Pattern

When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits until "Save" is clicked.
