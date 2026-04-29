# Phase 7 Prompt — Memory System

Build the Super Roo memory system.

Purpose:
Store and retrieve past bugs, fixes, decisions, and deployment results.

MVP storage:
- JSON file or SQLite

Future storage:
- Supabase/Postgres
- vector search

Folder target:
`src/super-roo/memory/`

Create:
- `memory-store.ts`
- `bug-memory.ts`
- `fix-memory.ts`
- `decision-memory.ts`
- `deployment-memory.ts`
- `memory.agent.ts`

Memory records:
- id
- type
- title
- summary
- tags
- createdAt
- relatedFiles
- result

Add tests:
- save memory
- search memory by keyword
- retrieve similar bug
