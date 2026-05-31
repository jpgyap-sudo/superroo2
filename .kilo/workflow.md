# Kilo Code Workflow

## Overview

Kilo Code uses a multi-agent workflow with specialized roles and model selection.

### Core Workflow

```
Thinker Agent → Architect Agent → Coder Agent → Reviewer Agent
     ↓              ↓              ↓              ↓
Auto Free      hermes3:latest   qwen2.5-coder:7b   kilo-auto/free
(planning)    (design)         (implementation)   (review)
```

### Supporting Agents

- **Researcher** - Codebase exploration and pattern discovery
- **Project Analyst** - Feature tracking and cross-project insights
- **Memory Retriever** - Lesson querying and retrieval
- **Context Collector** - Context gathering and organization

## Model Selection Guide

| Model                     | Size  | Best For                                                       |
| ------------------------- | ----- | -------------------------------------------------------------- |
| `qwen2.5-coder:7b`        | 4.7GB | **General coding tasks** (current default)                     |
| `qwen2.5-coder:14b`       | 9.0GB | **Complex coding tasks** requiring more reasoning              |
| `phi4:latest`             | 9.1GB | **Reasoning-heavy tasks**, debugging complex issues            |
| `nomic-embed-text:latest` | 274MB | **Embeddings** for semantic search (used by code-search skill) |
| `kilo-auto/free`          | API   | **Auto Free** - smart model routing for planning and review    |

## Agent Workflow

### Thinker Agent (`thinker`)

**Purpose**: Initial reasoning and task routing

**Steps**:

1. **Think and Plan** - Analyze task complexity, identify required expertise
2. **Read Context** - Load AGENTS.md, .kilo/kilo.json, agent configs
3. **Register Lesson Intent** - Call `brain_register_lesson_intent` via MCP
4. **Delegate** - Route to architect or coder based on task type

**When to use**: Complex tasks that need planning before implementation

### Architect Agent (`architect`)

**Purpose**: System design and task breakdown

**Steps**:

1. Receive pre-analyzed task from thinker
2. Design system architecture
3. Break down into discrete tasks with acceptance criteria
4. Delegate to coder with full context

**When to use**: Architecture decisions, feature planning, task breakdown

### Coder Agent (`coder`)

**Purpose**: Code implementation

**Steps**:

1. Receive structured plan from architect
2. Implement tasks sequentially
3. Run tests and verify
4. Store lesson via `brain_store_lesson` MCP tool

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

| Server          | Purpose                   | Tools                                                                                                                          |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ollama`        | Local model access        | `ollama_embed`, `ollama_chat`, `ollama_list_models`, `ollama_status`                                                           |
| `central-brain` | Lesson storage & workflow | `brain_register_lesson_intent`, `brain_store_lesson`, `brain_lesson_status`, `brain_get_workflow_rules`, `brain_search_memory` |

### Central Brain Tools

- `brain_register_lesson_intent(agent, projectId?, task?)` - Register intent before coding
- `brain_store_lesson(title, content, agent, projectId?, tags?, files?, summary?, confidence?)` - Store lesson after completion
- `brain_lesson_status(agent?)` - Check pending lesson obligations
- `brain_get_workflow_rules()` - Get mandated workflow rules
- `brain_search_memory(query, limit?)` - Search lessons in learning layer

## Workflow Rules (Mandatory)

1. **wf-001**: Ollama models are the DEFAULT for all tasks (qwen2.5-coder:7b for coding, hermes3 for planning)
2. **wf-002**: Ollama is the DEFAULT embeddings provider for semantic search
3. **wf-003**: Central Brain (pgvector) is the DEFAULT memory store
4. **wf-004**: Every coding agent MUST contribute at least one lesson per session

## Commands

### `/think-and-plan <task>`

Execute the thinker → architect → coder → reviewer workflow for a complex task.

## File Locations

| File                               | Purpose                               |
| ---------------------------------- | ------------------------------------- |
| `.kilo/agent/thinker.md`           | Thinker agent configuration           |
| `.kilo/agent/architect.md`         | Architect agent configuration         |
| `.kilo/agent/coder.md`             | Coder agent configuration             |
| `.kilo/agent/reviewer.md`          | Reviewer agent configuration          |
| `.kilo/agent/researcher.md`        | Researcher agent configuration        |
| `.kilo/agent/project-analyst.md`   | Project analyst agent configuration   |
| `.kilo/agent/memory-retriever.md`  | Memory retriever agent configuration  |
| `.kilo/agent/context-collector.md` | Context collector agent configuration |
| `.kilo/command/think-and-plan.md`  | Think-and-plan command documentation  |
| `.mcp.json`                        | MCP server configuration              |
| `scripts/central-brain-mcp.mjs`    | Central Brain MCP server              |
| `memory/lessons-learned.md`        | Lesson storage (markdown)             |
| `memory/lesson-index.jsonl`        | Lesson index (JSONL)                  |

## Quick Start

```bash
# Start Central Brain with PostgreSQL/pgvector
docker compose up -d postgres

# Start Central Brain MCP server
node scripts/central-brain-mcp.mjs

# Register lesson intent (before coding)
# Use MCP tool: brain_register_lesson_intent

# Store lesson (after coding)
# Use MCP tool: brain_store_lesson

# Check workflow rules
# Use MCP tool: brain_get_workflow_rules
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
