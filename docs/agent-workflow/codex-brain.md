# Codex Brain Workflow

Codex Brain is a local MCP + CLI wrapper around Ollama models and a Codex-owned
memory store. It mirrors the newer Claude brain workflow while keeping Codex in
charge of planning, reviewing, applying edits, and final verification.

## My Workflow

```txt
1. Codex plans and decides what needs doing
2. Codex Brain retrieves relevant memory
3. Codex Brain collects context if the task is substantial
4. Ollama local agents draft or analyze
5. Codex reviews the output, edits files directly, and runs tests
6. Codex Brain remembers the lesson
7. SuperRoo learning layer gets the final lesson
```

Codex Brain is my advisory/local-agent layer. Codex still owns final engineering
judgment, file edits, verification, and the user-facing final answer.

## Model Roles

```txt
hermes3             retrieve, collect, research, analyze, review
qwen2.5-coder:7b   quick code drafts
qwen3:14b          complex code drafts
nomic-embed-text   memory embeddings
```

## Default Command Pattern

For most coding tasks I use:

```bash
node scripts/codex-brain.mjs retrieve "task"
node scripts/codex-brain.mjs collect "task"
node scripts/codex-brain.mjs code-pro "implementation request"
node scripts/codex-brain.mjs review "file-or-code"
node scripts/codex-brain.mjs remember "lesson" --collection code
```

MCP-aware extensions use:

```bash
node scripts/codex-brain-mcp.mjs
```

The MCP server exposes:

```txt
retrieve_context
collect_context
research
analyze_task
code
code_pro
code_pro_verified
code_with_memory
remember
recall
list_collections
brain_status
warmup
record_outcome
```

## Commands

```bash
node scripts/codex-brain.mjs status
node scripts/codex-brain.mjs warmup
node scripts/codex-brain.mjs seed-lessons --limit 80

node scripts/codex-brain.mjs retrieve "task"
node scripts/codex-brain.mjs collect "task"
node scripts/codex-brain.mjs analyze "task"
node scripts/codex-brain.mjs research "topic"

node scripts/codex-brain.mjs code "small coding task"
node scripts/codex-brain.mjs code-pro "complex coding task"
node scripts/codex-brain.mjs code-verified "critical JS/TS task"
node scripts/codex-brain.mjs code-with-memory "project-aware coding task"

node scripts/codex-brain.mjs remember "lesson" --collection code --tags codex,ollama
node scripts/codex-brain.mjs recall "query" --collection code
node scripts/codex-brain.mjs collections
```

## Agents

- `retrieve`: memory retriever over Codex Brain memory using vector + BM25 + RRF.
- `collect`: context collector that combines memory, optional web search, and code context.
- `research`: web + memory synthesis through the local Hermes model.
- `analyze`: project analyst for relevant files, risks, and verification plan.
- `code`: fast coder using `qwen2.5-coder:7b`.
- `code-pro`: complex coder using `qwen3:14b`, falling back to `qwen2.5-coder:14b`.
- `code-verified`: coder with a JavaScript syntax self-correction loop.
- `code-with-memory`: coder with retrieved project memory injected.

## Storage

Codex Brain stores local memory at:

```txt
memory/codex-brain/memory.json
```

It uses `nomic-embed-text` for embeddings and tries Ollama at `127.0.0.1:11434`
before falling back to the Tailscale VPS at `100.64.175.88:11434`.

Lessons remain canonical in:

```txt
memory/lessons-learned.md
memory/lesson-index.jsonl
```

These canonical learning files are append-only. Use
`scripts/sync-local-extension-lessons.mjs` to consolidate extension memories and
`scripts/guard-append-only-lessons.mjs` to verify no existing lesson was edited,
deleted, reordered, or rewritten.

## Rule

Use Codex Brain as an advisory worker. Codex still owns file edits, tests, review,
and the final decision about what gets applied.
