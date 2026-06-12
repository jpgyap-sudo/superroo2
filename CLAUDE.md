# CLAUDE.md — SuperRoo Project Guide for Claude Code

This file provides guidance to Claude Code when working with the SuperRoo repository.

## Project Overview

**SuperRoo** — A VS Code extension with ML engine, healing module, crawler agent, cloud dashboard (Next.js), Telegram bot, and learning layer. Monorepo managed with pnpm workspaces.

## Agent Routing

This project uses a model-routing workflow:

- **Codex** = planner, reviewer, tester, final verifier
- **Ollama** = primary local coder / refactor worker, embeddings (nomic-embed-text), local chat (hermes3)
- **DeepSeek** = optional context and lesson summarizer when configured
- **Central Brain** = persistent memory database / pgvector / lesson store
- **Claude** = planner, reviewer, orchestrator — delegates coding to Ollama via MCP

### Workflow Enforcement (MCP Tools)

Claude Code MUST use the `ollama` MCP server (registered in `.mcp.json`) to follow the SuperRoo agent routing workflow:

| Phase         | Tool                          | Provider     | When to Use                                                                    |
| ------------- | ----------------------------- | ------------ | ------------------------------------------------------------------------------ |
| **Plan**      | Claude's own model            | Claude       | Analyze requirements, design architecture, plan implementation                 |
| **Context**   | `build-agent-context.mjs`     | DeepSeek API | Run before coding to compress repo context into task brief                     |
| **Code**      | `ollama_chat`                 | Ollama coder | Write new code, implement features, create files                               |
| **Review**    | `ollama_chat`                 | Ollama pro   | Review code for bugs, security, performance                                    |
| **Refactor**  | `ollama_chat`                 | Ollama coder | Improve existing code structure and quality                                    |
| **Explain**   | `ollama_chat`                 | Ollama       | Understand complex code, generate docs                                         |
| **Summarize** | `ollama-summarize-lesson.mjs` | DeepSeek API | Summarize lessons after coding (DeepSeek for summaries, Ollama for embeddings) |
| **Embed**     | `ollama_embed`                | Ollama (VPS) | Generate embeddings for semantic search or RAG                                 |
| **Chat**      | `ollama_chat`                 | Ollama (VPS) | Quick questions, code explanations via local model                             |

**Workflow rule:** Claude MUST call `ollama_chat` for any substantial coding task instead of writing code directly. Claude handles planning, review, and orchestration. Ollama handles implementation, refactoring, review assistance, embeddings, and local chat.

**Ollama coding route (via `ollama` server):**

Use `ollama_chat(message, model?, system?)` with these models:

- `qwen2.5-coder:7b` — default coding implementation model.
- `qwen3:14b` — complex coding, review, and higher-risk changes.
- `hermes3:latest` — quick explanations and planning support.

Recommended coding prompt shape:

```text
Use qwen2.5-coder:7b. Implement this change using the repo's existing patterns.
Return a concise patch plan and the exact code edits needed.
```

**Ollama MCP tools (via `ollama` server, local first with VPS fallback):**

1. **`ollama_summarize(text, model?)** — [DEPRECATED] Summarize text using Ollama (hermes3). Prefer the repo context builder for task context.

2. **`ollama_embed(text)** — Generate embeddings using nomic-embed-text. Use for semantic search or RAG pipelines.

3. **`ollama_chat(message, model?, system?)** — Chat with a local model. Use for coding, refactoring, review assistance, quick questions, and code explanations.

4. **`ollama_vision(image_path, prompt?, model?)** — Analyze local images with a vision model.

5. **`ollama_list_models()`** — List available models on the configured Ollama instance.

6. **`ollama_status()`** — Check if Ollama is reachable and healthy.

## SuperRoo Extension Fix Log — MANDATORY

When working on the SuperRoo VS Code extension webview issue:

1. **Before starting:** Read `docs/logs/superroo-extension-fixes.md` to see what other agents already tried.
2. **After attempting a fix:** Append a new entry to that log file with:
   - Date and agent/model name
   - Files changed
   - What was changed and why
   - What was tested
   - Result (pass/fail/unknown)
   - Next steps
3. **Do NOT delete or overwrite** previous entries. Only append.

This prevents duplicate work and helps all agents build on prior attempts instead of repeating them.

## Learning Layer — Mandatory Sync

**ALL agents are permanently synced to the SuperRoo learning layer.** This is not optional.

### Before Coding — Build Agent Context

Run the context builder to compress repo knowledge into a task brief using DeepSeek API:

```bash
node scripts/ml/build-agent-context.mjs "<task description>"
```

Then read the generated context:

```bash
# Read the compressed context (DeepSeek API summarizes files, working tree, bugs, features, model decisions)
# Pre-computed lesson summaries from memory/lesson-summaries.json are injected directly
cat memory/context/latest-agent-context.md
```

The context builder performs 5 DeepSeek API summarization phases:

1. **Source files** — Summarize relevant files referenced by lessons
2. **Working tree** — Summarize relevant architecture sections
3. **Bug memory** — Summarize relevant bug log entries
4. **Feature knowledge** — Summarize feature knowledge
5. **Model decisions** — Summarize model decision records

Lesson summaries are pre-computed (stored in `memory/lesson-summaries.json`) and injected directly — no re-compression needed.

You can also query the LessonRetriever for additional context:

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
node scripts/ollama-summarize-lesson.mjs    # DeepSeek for summaries, Ollama for embeddings
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

# E2E test: verify MCP workflow is properly wired for Claude
node scripts/test-claude-mcp-workflow.mjs

# E2E test with verbose output
node scripts/test-claude-mcp-workflow.mjs --verbose

# Compliance check: verify workflow compliance across commits
node scripts/check-workflow-compliance.mjs

# Compliance check: verify MCP server configuration
node scripts/check-workflow-compliance.mjs --mcp-check

# Compliance check: run all checks (commits + MCP)
node scripts/check-workflow-compliance.mjs --all

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
