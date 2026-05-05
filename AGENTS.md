# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Working Tree

The **Working Tree** ([`docs/resources/working-tree.md`](docs/resources/working-tree.md)) is the single source of truth for the SuperRoo product architecture. It documents all 18 core modules, their connections, product features, owners, and interaction flows.

**Before making any changes**, agents MUST read the Working Tree to:

- Understand which modules are affected and their connections
- Check the Feature Registry and Product Memory to avoid duplication
- Check the Bug Registry and Healing System for existing incidents
- Consider the CPU Guard and Parallel Execution Engine for resource management

The Working Tree is also visualized in the SuperRoo Cloud Dashboard under the **Working Tree** tab.

## Commit & Deploy Log

The **Commit & Deploy Log** ([`src/super-roo/product-memory/CommitDeployLog.ts`](src/super-roo/product-memory/CommitDeployLog.ts)) is THE single source of truth for all commits and deployments across all coding agents.

**ALL agents MUST follow these rules:**

1. **Record every commit**: After making code changes, call `CommitDeployLog.recordCommit()` with the commit SHA, agent name, type (feature/bugfix/refactor/docs/config/test/deploy/other), title, files changed, and features affected.

2. **Record every deploy**: When deploying, call `CommitDeployLog.recordDeploy()` with the version, commit SHA, and agent name. After the deploy completes, call `CommitDeployLog.updateDeployStatus()` with the result (healthy/unhealthy/rolled_back/failed).

3. **Check history first**: Before starting work, use `CommitDeployLog.getCommits()` and `CommitDeployLog.getDeploys()` with filters to see what other agents have done and avoid conflicts.

4. **Link to features**: Always include `featuresAffected` when recording commits so the Working Tree can track which features are being modified.

The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change). It is persisted as JSON at [`server/src/memory/commit-deploy-log.json`](server/src/memory/commit-deploy-log.json) and visualized in the dashboard Working Tree tab.

## Settings View Pattern

When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save". Wiring inputs directly to the live state causes race conditions.
