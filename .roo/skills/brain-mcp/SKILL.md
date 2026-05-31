---
name: brain-mcp
description: "Complete reference for the brain MCP 4-layer workflow: Claude thinks, Hermes 3 researches/analyzes/retrieves, qwen2.5-coder implements, Claude reviews. The complete tool reference for every coding task."
---

# Brain MCP — Complete Workflow Reference

## The 4-Layer System

```
LAYER 1 — Claude          : understand task, orchestrate
LAYER 2 — Hermes 3        : research, analyze, retrieve context
LAYER 3 — qwen2.5-coder   : implement the code
LAYER 4 — Claude          : review, apply, store lesson
```

## Standard Task Flow

```
1. retrieve_context("task")       ← always first
2. collect_context("task")        ← for substantial tasks
3. code_pro(brief from step 2)    ← implement
4. review output (Claude)
5. remember(lesson, "code")       ← always last
```

---

## Layer 2 Tools — Hermes 3 Intelligence

### `retrieve_context(task, collection?, limit?)`

**Role: Memory Retriever**
Run at the START of every task. Fetches memories, filters noise, ranks by relevance.
Returns: ranked lessons, known pitfalls, established patterns.

```
retrieve_context("fix autonomous loop polling crash")
retrieve_context("add telegram command handler")
```

### `collect_context(task, code_context?, research_topic?, web_search?, collection?)`

**Role: Context Collector — the master pre-coding tool**
Combines web research + memory + project analysis into ONE coding brief.
Use before any task > 30 lines or multi-file.

```
collect_context("Add pgvector HNSW index to ollama_lessons table")
collect_context("Refactor telegram bot to use submitDirect", "<paste telegramBot.js sections>")
```

### `analyze_task(task, code_context?, collection?)`

**Role: Project Analyst**
Identifies affected files, dependencies, risks, recommended approach.
Use before architectural changes.

```
analyze_task("Migrate lesson summarization from DeepSeek to Hermes 3")
```

### `research(topic, collection?)`

**Role: Researcher with Web Search**
DuckDuckGo search + memory recall + Hermes synthesis.
Use before coding anything involving external tech.

```
research("React Server Components vs useEffect data fetching")
research("Ollama GGUF quantization q4_k_m vs q8_0 quality tradeoffs")
```

### `web_search(query, limit?)`

Quick DuckDuckGo search. Returns titles, snippets, URLs.
No Hermes synthesis — raw results only.

### `fetch_page(url, max_chars?)`

Fetch and extract text from any URL returned by web_search.

---

## Layer 3 Tools — Coders

### `code(prompt, context?)`

**Model: qwen2.5-coder:7b | Speed: 1-3s**
Quick edits, single functions, small changes.

### `code_pro(prompt, context?)`

**Model: qwen2.5-coder:14b | Speed: 3-8s**
Complex implementations, multi-file work, architecture-level code.

### `code_with_memory(prompt, collection?, memory_limit?, fast?)`

**Model: qwen2.5-coder:14b + RAG | Speed: 4-10s**
Automatically injects relevant project context from memory.
Best when task needs to follow existing project patterns.

---

## Memory Tools

### `remember(content, collection?, tags?)`

Store a lesson. Use `collection="code"` for engineering lessons.
**Always call after completing a task.**

### `recall(query, collection?, limit?)`

Raw semantic search over memory. Returns entries with similarity scores.
Use `retrieve_context` for smarter filtered results.

### `ask_hermes3_with_memory(prompt, collection?, memory_limit?)`

General Q&A with auto-injected memory context.

---

## Utility Tools

### `warmup()`

Pre-loads hermes3, qwen2.5-coder:7b, qwen2.5-coder:14b into RAM.
Run at session start for instant responses all day.

### `brain_status()`

Shows Ollama connection status, loaded models, memory stats.

### `list_collections()`

Shows all memory collections and entry counts.

---

## Decision Guide

| Task Type                  | Tool Flow                                       |
| -------------------------- | ----------------------------------------------- |
| Quick bug fix (< 20 lines) | `retrieve_context` → `code`                     |
| Feature implementation     | `collect_context` → `code_pro`                  |
| External API integration   | `research` → `collect_context` → `code_pro`     |
| Architectural change       | `analyze_task` → `collect_context` → `code_pro` |
| Project question           | `ask_hermes3_with_memory`                       |
| Learning layer sync        | `remember` after each task                      |
