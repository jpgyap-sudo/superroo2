---
description: Execute the context-summarizer -> thinker -> architect -> coder workflow
---

# Context Summarizer -> Thinker -> Architect -> Coder Workflow

This command executes the Kilo planning process for complex tasks. Oversized or overflow-risk sessions are compacted locally before the thinker runs.

## Hard Preflight Gate

Before invoking `thinker` or any `kilo-auto/free` route, classify the incoming session:

- **safe**: short task, no large tool output, no media-heavy transcript, no prior context-limit error.
- **risky**: oversized transcript, near-limit history, media/tool-heavy history, huge terminal output, large generated files, lockfiles, dependency dumps, or any recent Poolside/OpenRouter/context-limit error.

If the session is **risky**, do not call `thinker` yet. Run `context-summarizer` first and continue only when its output includes:

```text
COMPACT_BRIEF_READY: true
```

Then pass only that compact continuation brief to `thinker`. Never pass the raw risky transcript to `thinker`, Auto Free, Architect, Coder, Reviewer, or cloud planning.

## Workflow Steps

1. **Context Summarizer Agent** - Local `phi4:latest` rescue summarization when the session is too large to compact
2. **Thinker Agent** - Initial reasoning, context loading, and delegation
3. **Architect Agent** - Architecture design, task breakdown, planning
4. **Coder Agent** - Implementation, testing, documentation

## Usage

```
/think-and-plan <task description>
```

## Process

If Kilo reports `ContextOverflowError`, `Session too large to compact`, or a context-limit failure:

1. Run `context-summarizer` first.
2. Confirm the output includes `COMPACT_BRIEF_READY: true`.
3. Pass only its compact continuation brief to `thinker`.
4. Continue the normal workflow from that brief.

The thinker agent will:

1. Refuse risky raw context unless it already has `COMPACT_BRIEF_READY: true`
2. Analyze task complexity using Auto Free after preflight compaction
3. Read AGENTS.md, .kilo/kilo.json, and relevant configs
4. Delegate to architect with compact, relevant context

The architect will:

1. Design system architecture
2. Break down into discrete tasks
3. Delegate to coder with acceptance criteria

The coder will:

1. Implement tasks sequentially
2. Run tests and verify
3. Extract lessons per AGENTS.md requirements
