# Codex -> DeepSeek -> Ollama Workflow

## Purpose

This document records the intended SuperRoo AI coding workflow.

```txt
Codex plans and reviews
DeepSeek codes
Ollama remembers and summarizes
Central Brain stores long-term lessons
```

## Runtime Flow

1. User submits a task from the VS extension, Cloud IDE, or Telegram.
2. Codex reads memory and past lessons.
3. Codex creates an implementation plan.
4. DeepSeek implements the code when that route is available and suitable.
5. Codex reviews the implementation.
6. Tests are run or requested.
7. Ollama summarizes the task into reusable lessons.
8. Central Brain stores the lesson.

## Fallbacks

If DeepSeek is unavailable:

1. Try Kimi.
2. Try Claude if configured.
3. Use Codex direct coding for urgent or small fixes.

If Ollama is unavailable:

1. Write lessons directly to markdown files.
2. Queue lesson ingestion for later.
3. Do not block the code fix.

If Central Brain is unavailable:

1. Save to local memory files.
2. Mark the lesson as `pending_ingestion`.
3. Sync later when the database is available.

## Required Lesson Output

Every task should produce:

```md
Date:
Task:
Model flow:
Root cause:
Fix:
Files changed:
Tests:
Reusable lesson:
```

## Future Upgrade Rule

When SuperRoo upgrades to a stronger Ollama, Llama, or Qwen server, do not reset memory.

Point the new model to the same:

- `memory/`
- `docs/updates/`
- Central Brain database
- vector embeddings store

The new model becomes smarter by reading the existing accumulated lessons.
