# SuperRoo Phase 3 Implementation Guide

## Goal

Wire SuperRoo into the existing VS Code extension and add a CLI runner using the same shared core.

## Do Not Break

- Existing Roo Code extension activation
- Existing webview behavior
- Existing task provider behavior
- Existing package scripts

## Implementation Steps

### 1. Add source folders

Created:

```text
src/super-roo/core/
  types.ts
  createDefaultRuntime.ts
  AgentRegistry.ts
  SuperRooOrchestrator.ts

src/super-roo/agents/phase3/
  debuggerAgent.ts
  deployCheckerAgent.ts
  productManagerAgent.ts
  testerAgent.ts
  index.ts

src/super-roo-host/
  registerSuperRooCommands.ts

src/extension/superroo/
  activationPatch.ts

webview-ui/src/components/superroo/
  SuperRooDashboard.tsx
```

### 2. Patch extension activation

In `src/extension.ts`, imported and called:

```ts
import { registerSuperRooCommands } from "./super-roo-host/registerSuperRooCommands"

registerSuperRooCommands(context)
```

Placed inside `activate(context)` after `registerCommands(...)`.

### 3. Patch package.json

- `bin` already contains `"superroo": "./dist/cli/index.js"` from Phase 2.
- Added scripts:
  - `superroo:cli`
  - `superroo:autonomous`
  - `superroo:check-vps`
  - `superroo:deploy`
  - `superroo:debug-api`
- Added commands under `contributes.commands`:
  - `superroo.status`
  - `superroo.autonomousSafe`
  - `superroo.checkVps`

### 4. Patch CLI entrypoint

In `src/cli/index.ts`, wired Phase 3 `SuperRooOrchestrator` into each commander action so both the new shared core and existing Phase 2 commands run together.

### 5. Build and test

```bash
pnpm install
pnpm build
pnpm superroo:cli
pnpm superroo:autonomous
pnpm superroo:check-vps
```

### 6. Test in VS Code

Open command palette and test:

```text
SuperRoo: Show Status
SuperRoo: Run Autonomous Safe Mode
SuperRoo: Check VPS Deployment
```

## Done Criteria

- Existing Roo extension still launches.
- SuperRoo commands appear in command palette.
- CLI runs after build.
- CLI and VS Code extension use the same `SuperRooOrchestrator`.
- No production deploy happens yet.
