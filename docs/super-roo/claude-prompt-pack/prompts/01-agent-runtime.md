# Phase 1 Prompt — Agent Runtime

Build the foundational Super Roo agent runtime in TypeScript.

Requirements:
- Agent interface
- Task interface
- Agent registry
- Task router
- Simple in-memory task queue
- Loop controller with max iterations
- Permission system with approval levels 0 to 4
- Structured logging

Folder target:
`src/super-roo/runtime/`
`src/super-roo/types/`

Create these files:
- `src/super-roo/types/agent.ts`
- `src/super-roo/types/task.ts`
- `src/super-roo/runtime/agent-registry.ts`
- `src/super-roo/runtime/task-router.ts`
- `src/super-roo/runtime/task-queue.ts`
- `src/super-roo/runtime/loop-controller.ts`
- `src/super-roo/runtime/permissions.ts`

Add unit tests for:
- registering agents
- dispatching tasks
- stopping at max iterations
- blocking tasks above permission level

Use the output format from master instructions.
