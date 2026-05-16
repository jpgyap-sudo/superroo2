# Phase 2 Prompt — Product Feature Manager

Build a Product Feature Manager for Super Roo.

Purpose:
Track all app features, their health, bugs, status, related files, and tests.

Requirements:
- Feature schema
- Feature registry CRUD
- Status transitions
- Health checker interface
- Bug linking
- JSON file persistence for MVP

Statuses:
- planned
- building
- testing
- working
- suspected_bug
- broken
- fixed
- deprecated

Folder target:
`src/super-roo/product/`

Create:
- `feature-status.ts`
- `feature-registry.ts`
- `feature-health-checker.ts`
- `roadmap-manager.ts`

Also create example:
- `super-roo/feature-registry.json`

Add tests for:
- create feature
- update status
- link bug
- persist and reload registry

Use the required structured output format.
