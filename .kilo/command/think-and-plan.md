---
description: Execute the thinker → architect → coder workflow
---

# Thinker → Architect → Coder Workflow

This command executes the three-layer thinking process for complex tasks.

## Workflow Steps

1. **Thinker Agent** - Initial reasoning with Auto Free, context loading, delegation
2. **Architect Agent** - Architecture design, task breakdown, planning
3. **Coder Agent** - Implementation, testing, documentation

## Usage

```
/think-and-plan <task description>
```

## Process

The thinker agent will:

1. Analyze task complexity using Auto Free
2. Read AGENTS.md, .kilo/kilo.json, and relevant configs
3. Delegate to architect with full context

The architect will:

1. Design system architecture
2. Break down into discrete tasks
3. Delegate to coder with acceptance criteria

The coder will:

1. Implement tasks sequentially
2. Run tests and verify
3. Extract lessons per AGENTS.md requirements
