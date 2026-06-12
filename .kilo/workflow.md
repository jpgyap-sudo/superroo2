# Kilo Code Workflow

## ? Health Check Protocol

**All agents MUST check Kilo Cloud availability before starting tasks.** This ensures you know immediately if you're on fallback mode vs. cloud mode.

```bash
# Check before every task/deploy/debug
curl -s -m 3 https://api.kilo.ai/health && echo "? Kilo Cloud UP" || echo "?? Kilo Cloud DOWN — using fallback"
```

**On fallback (Kilo Cloud unavailable):**

- The agent must ask the user for approval before switching to local `qwen3:14b`
- If the user approves, the agent will print: `?? Kilo Cloud unavailable — using local qwen3:14b fallback per your approval.`
- If the user declines, the agent should stop and explain that the normal local `qwen3:14b` route is required
- Local `qwen3:14b` (Ollama) only takes over after explicit user consent

## Overview

Kilo Code uses a multi-agent workflow with specialized roles and model selection.

### Core Workflow

```
Codex Brain context + memory
        |
        v
Context Preflight -> Context Summarizer -> Thinker Agent -> Architect Agent -> Coder Agent -> Reviewer Agent
       |                  |              |                 |                |
risk gate          phi4:latest      kilo-auto/free qwen3:14b       qwen2.5-coder:7b   qwen3:14b
(block raw)        (compact brief)  (planning)       (design)           (implementation)   (review)
```

### Supporting Agents

- **Researcher** - Codebase exploration and pattern discovery
- **Project Analyst** - Feature tracking and cross-project insights
- **Memory Retriever** - Lesson querying and retrieval
- **Context Collector** - Context gathering and organization
- **Context Summarizer** - Local Phi pre-thinker compaction for oversized sessions

## Model Selection Guide

| Model                     | Size  | Best For                                                                 |
| ------------------------- | ----- | ------------------------------------------------------------------------ |
| `qwen2.5-coder:7b`        | 4.7GB | **General coding tasks** (current default)                               |
| `qwen3:14b`               | 8.9GB | **Planning, review, and complex coding** requiring more reasoning        |
| `phi4:latest`             | 9.1GB | **Reasoning-heavy tasks** and pre-thinker summarization overflow rescue  |
| `nomic-embed-text:latest` | 274MB | **Embeddings** for semantic search (used by code-search skill)           |
| `llava:7b`                | 4.5GB | **Vision tasks** - image analysis, OCR, diagram understanding (fallback) |

### Vision Models

| Model         | Size  | Best For                             |
| ------------- | ----- | ------------------------------------ |
| `llava:7b`    | 4.5GB | **Local vision** - screenshots, docs |
| `llava:13b`   | 8.0GB | **Local vision** - complex images    |
| `bakllava:7b` | 4.5GB | **Local vision** - alternative       |

## Agent Workflow

### Context Summarizer Agent (`context-summarizer`)

**Purpose**: Rescue oversized sessions before they reach the thinker.

**Steps**:

1. Detect `ContextOverflowError`, `too large to compact`, or context-limit failures.
2. Strip media/tool blocks to text and chunk the transcript.
3. Summarize each chunk with local Ollama `phi4:latest`.
4. Merge chunk summaries into one continuation brief.
5. Emit `COMPACT_BRIEF_READY: true`.
6. Pass only the compact brief, current task, unresolved decisions, and next action to `thinker`.

**When to use**: Before `thinker` whenever the session is near the model context limit, contains huge raw tool/log output, is media-heavy, or compaction has already failed.

### Vision Agent (`vision`)

**Purpose**: Image analysis and understanding

**Steps**:

1. Receive image path or URL
2. Use vision model to analyze
3. Extract text, diagrams, UI elements
4. Store findings via MCP if needed

**When to use**: Analyzing screenshots, diagrams, documents, UI layouts

### Thinker Agent (`thinker`)

**Purpose**: Initial reasoning and task routing

**Steps**:

1. **Hard Context Preflight** - Refuse risky raw context unless it contains `COMPACT_BRIEF_READY: true`
2. **Think and Plan** - Analyze task complexity, identify required expertise
3. **Read Context** - Load AGENTS.md, .kilo/kilo.json, agent configs
4. **Retrieve Codex Brain Context** - Call `retrieve_context` or `collect_context`
5. **Risk Preflight** - Call `risk_assess` before coding, config changes, deploys, deletes, restarts, or migrations
6. **Register Lesson Intent** - Call `brain_register_lesson_intent` via MCP
7. **Delegate** - Route to architect or coder based on task type

**When to use**: Complex tasks that need planning before implementation

### Architect Agent (`architect`)

**Purpose**: System design and task breakdown

**Steps**:

1. Receive pre-analyzed task from thinker
2. Retrieve relevant lessons from Codex Brain
3. Design system architecture
4. Break down into discrete tasks with acceptance criteria
5. Delegate to coder with full context

**When to use**: Architecture decisions, feature planning, task breakdown

### Coder Agent (`coder`)

**Purpose**: Code implementation

**Steps**:

1. Receive structured plan from architect
2. Call `code_with_memory` for local Ollama implementation help when useful
3. Implement tasks sequentially
4. Run tests and verify
5. Store lesson via `brain_store_lesson` MCP tool and `record_outcome` in Codex Brain

**When to use**: Writing, editing, and implementing code

### Reviewer Agent (`reviewer`)

**Purpose**: Code review and quality assurance

**Steps**:

1. Receive implemented code from coder
2. Review for bugs, security, performance, best practices
3. Verify tests pass and acceptance criteria met
4. Store review findings via `brain_store_lesson` MCP tool

**When to use**: Code review, quality assurance, final verification

### Researcher Agent (`researcher`)

**Purpose**: Codebase exploration and pattern discovery

**Steps**:

1. Analyze research scope and requirements
2. Use code-search and web-search to find patterns
3. Synthesize findings for downstream agents

**When to use**: Before implementation to understand existing patterns

### Project Analyst Agent (`project-analyst`)

**Purpose**: Feature tracking and cross-project insights

**Steps**:

1. Load Working Tree and Feature Registry
2. Analyze feature status and dependencies
3. Provide roadmap and priority recommendations

**When to use**: Project-level analysis and planning

### Memory Retriever Agent (`memory-retriever`)

**Purpose**: Query and retrieve relevant lessons

**Steps**:

1. Understand query requirements
2. Query lessons via MCP or local index
3. Rank and synthesize results

**When to use**: Before coding to gather relevant past experiences

### Context Collector Agent (`context-collector`)

**Purpose**: Gather and organize task context

**Steps**:

1. Identify all context sources
2. Collect from AGENTS.md, Working Tree, lessons
3. Package context for thinker agent

**When to use**: Before planning to ensure complete context

## MCP Servers

### Available Servers

| Server          | Purpose                   | Tools                                                                                                                                                 |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ollama`        | Local model access        | `ollama_embed`, `ollama_chat`, `ollama_list_models`, `ollama_status`                                                                                  |
| `central-brain` | Lesson storage & workflow | `brain_register_lesson_intent`, `brain_store_lesson`, `brain_lesson_status`, `brain_get_workflow_rules`, `brain_search_memory`, `brain_analyze_image` |
| `codex-brain`   | Local agent RAG workflow  | `retrieve_context`, `collect_context`, `code_with_memory`, `code_pro_verified`, `remember`, `recall`, `record_outcome`                                |

### Central Brain Tools

- `brain_register_lesson_intent(agent, projectId?, task?)` - Register intent before coding
- `brain_store_lesson(title, content, agent, projectId?, tags?, files?, summary?, confidence?)` - Store lesson after completion
- `brain_lesson_status(agent?)` - Check pending lesson obligations
- `brain_get_workflow_rules()` - Get mandated workflow rules
- `brain_search_memory(query, limit?)` - Search lessons in learning layer
- `brain_analyze_image(image_path, prompt?)` - Analyze image with vision model

### Codex Brain Tools

- `brain_status()` - Check local Ollama models and memory health
- `retrieve_context(task, limit?)` - Retrieve relevant local lessons with hybrid RAG
- `collect_context(task, files?, limit?)` - Gather task, file, and memory context
- `code_with_memory(task, context?, files?)` - Use Ollama coding with retrieved lessons
- `code_pro_verified(task, context?, files?)` - Use larger local model plus review pass
- `remember(text, metadata?, collection?)` - Append a new local memory
- `recall(query, limit?, collection?)` - Search Codex Brain memory
- `record_outcome(task, outcome, files?, tests?, lesson?)` - Append task outcome memory

## Workflow Choice

| Mode                    | When to use                                        | Coder model                                      |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------ |
| **Kilo Local**          | Exploration, fast iteration, config/docs           | `qwen3:14b` (default), `qwen2.5-coder:7b` (fast) |
| **SuperRoo Production** | Production features, auth, payments, DB migrations | DeepSeek V4 via `deepseek-coder` MCP             |

## Workflow Rules (Mandatory)

1. **wf-001**: Kilo agents use `qwen3:14b` (default) or `qwen2.5-coder:7b` (fast) for coding; `hermes3` for planning
2. **wf-002**: Ollama is the DEFAULT embeddings provider for semantic search
3. **wf-003**: Central Brain (pgvector) is the canonical shared lesson store
4. **wf-004**: Every coding agent MUST contribute at least one lesson per session via `brain_store_lesson`
5. **wf-005**: Vision tasks use llava:7b as fallback; cloud vision models only when explicitly configured
6. **wf-006**: Thinker MUST call `retrieve_context(task)` before delegating; `collect_context` for substantial tasks
7. **wf-007**: After every completed task, update `ACTIVE_WORK.md` and run `node scripts/sync-all-brains.mjs --awareness`
8. **wf-008**: If a session is oversized, near-limit, media/tool-heavy, or recently hit Poolside/OpenRouter/context-limit errors, run the local Phi context summarizer before `thinker`; never send the full risky transcript to planner routing.
9. **wf-009**: Risky sessions must include `COMPACT_BRIEF_READY: true` before `thinker` or `kilo-auto/free` may proceed.

## Commands

### `/think-and-plan <task>`

Execute the thinker -> architect -> coder -> reviewer workflow for a complex task.

### `/analyze-image <path>`

Analyze an image using the vision agent (llava:7b or cloud vision model).

## File Locations

| File                                | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `.kilo/agent/thinker.md`            | Thinker agent configuration           |
| `.kilo/agent/context-summarizer.md` | Pre-thinker local Phi summarizer      |
| `.kilo/agent/architect.md`          | Architect agent configuration         |
| `.kilo/agent/coder.md`              | Coder agent configuration             |
| `.kilo/agent/reviewer.md`           | Reviewer agent configuration          |
| `.kilo/agent/researcher.md`         | Researcher agent configuration        |
| `.kilo/agent/project-analyst.md`    | Project analyst agent configuration   |
| `.kilo/agent/memory-retriever.md`   | Memory retriever agent configuration  |
| `.kilo/agent/context-collector.md`  | Context collector agent configuration |
| `.kilo/agent/vision.md`             | Vision agent configuration            |
| `.kilo/command/think-and-plan.md`   | Think-and-plan command documentation  |
| `.mcp.json`                         | MCP server configuration              |
| `scripts/central-brain-mcp.mjs`     | Central Brain MCP server              |
| `scripts/codex-brain-mcp.mjs`       | Codex Brain MCP server                |
| `memory/lessons-learned.md`         | Lesson storage (markdown)             |
| `memory/lesson-index.jsonl`         | Lesson index (JSONL)                  |

## Quick Start

```bash
# Start Central Brain with PostgreSQL/pgvector
docker compose up -d postgres

# Start Central Brain MCP server
node scripts/central-brain-mcp.mjs

# Pull vision model for image analysis
ollama pull llava:7b

# Analyze an image
# Use MCP tool: brain_analyze_image
```

## PostgreSQL/pgvector Integration

The Central Brain MCP connects to PostgreSQL with pgvector for persistent memory storage:

- **Host**: localhost:5432
- **Database**: superroo_brain
- **User**: superroo
- **Password**: superroo

If PostgreSQL is unavailable, the MCP server falls back to JSONL file storage in `memory/lesson-index.jsonl`.

### Schema

The `agent_memory` table stores lessons with:

- 768-dimension embeddings (nomic-embed-text)
- Project isolation
- Memory types: lesson, bug, pattern, decision, insight, reference
- Status: candidate, approved, archived, rejected
