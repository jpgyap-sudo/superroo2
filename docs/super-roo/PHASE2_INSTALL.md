# Super Roo — Phase 2 (cumulative: P1 + P2)

This is the **cumulative** deliverable. It contains everything from Phase 1 plus the new Phase 2 code, so you can drop it onto a fresh Roo fork in one go (no need to also extract the Phase 1 zip).

**Phase 2 adds:** the Coder Agent and the Roo Task adapter (headless interface + host implementation + auto-approval translator + 22 new tests).

## Contents

```
super-roo-phase2-deliverable/
└── src/
    ├── super-roo/                              ← drop into superroo2/src/
    │   ├── README.md                           Updated Phase 1+2 design doc
    │   ├── (everything from Phase 1)
    │   └── agents/                             ← NEW IN PHASE 2
    │       ├── RooTaskAdapter.ts               headless RooTaskRunner interface
    │       ├── CoderAgent.ts                   first concrete agent
    │       ├── index.ts
    │       └── __tests__/CoderAgent.test.ts    22 unit tests with fake runner
    └── super-roo-host/                         ← NEW IN PHASE 2
        ├── RooTaskRunner.ts                    wraps ClineProvider.createTask
        ├── RooApprovalAdapter.ts               SafetyMode → SuperRooSettings flags
        └── index.ts
```

## Install (Phase 2 — fresh from a clean Roo fork)

```bash
# 1. Drop both directories into the source tree
cp -r path/to/super-roo-phase2-deliverable/src/super-roo superroo2/src/
cp -r path/to/super-roo-phase2-deliverable/src/super-roo-host superroo2/src/

# 2. (Phase 1) If you haven't already, apply the Phase 1 package.json patches.
#    Phase 2 adds NO new dependencies. Just pnpm install if you skipped Phase 1.

# 3. Verify
cd superroo2
pnpm install
pnpm --filter superroo check-types
pnpm --filter superroo test super-roo super-roo-host
```

All ~102 tests should pass.

## Install (Phase 2 on top of an existing Phase 1)

```bash
# 1. Add the new agents/ subdir
cp -r path/to/super-roo-phase2-deliverable/src/super-roo/agents superroo2/src/super-roo/

# 2. Replace the README and the public barrel (both updated for Phase 2)
cp path/to/super-roo-phase2-deliverable/src/super-roo/README.md superroo2/src/super-roo/
cp path/to/super-roo-phase2-deliverable/src/super-roo/index.ts superroo2/src/super-roo/

# 3. Add the host tree (new in Phase 2)
cp -r path/to/super-roo-phase2-deliverable/src/super-roo-host superroo2/src/

# 4. Verify
pnpm --filter superroo check-types
pnpm --filter superroo test super-roo super-roo-host
```

## What changed in Roo

**Phase 2 changes nothing in SuperRoo's existing code.** No edits to `extension.ts`, no new dependencies, no edits to existing tools or the webview. The host adapter imports from SuperRoo's existing modules (`ClineProvider`, `Task`, `@superroo/types`) but doesn't touch them.

## What's NOT in Phase 2

By design, deferred to Phase 2.5:
- ❌ Debugger Agent
- ❌ Product Manager Agent
- ❌ Tester Agent
- ❌ `BugRegistry` (CRUD for the bugs/fixes tables)

By design, deferred to Phase 3+:
- ❌ Wiring into `extension.ts` (no auto-activation yet)
- ❌ Webview/dashboard UI
- ❌ Telegram, deploy, crawler

## Architecture: headless vs host

The codebase is now split deliberately:

```
src/super-roo/          ← HEADLESS. No vscode, no ClineProvider imports.
src/super-roo-host/     ← HOST. Allowed to import vscode, ClineProvider.
```

The headless tree is reusable from the CLI app, tests, and a future sidecar. The host tree exists to bridge the headless world into Roo's real Task loop. **If you ever see a `vscode` or `ClineProvider` import inside `src/super-roo/`, that's a bug.**

## SafetyMode → Roo auto-approval mapping

Translation lives in `src/super-roo-host/RooApprovalAdapter.ts`. The full preset table is documented in `src/super-roo/README.md`. Headline:

| SafetyMode | autoApproval | Read | Write | Execute | MCP | Mode switch |
|---|---|---|---|---|---|---|
| `OFF`/`MANUAL` | off | ✗ | ✗ | ✗ | ✗ | ✗ |
| `SAFE`/`SAFE_AUTO` | on | ✓ | ✗ | ✗ | ✗ | ✗ |
| `AUTO` | on | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FULL_AUTONOMOUS` | on | ✓ | ✓ + protected/outside-ws | ✓ | ✓ | ✓ |

## Honest caveats

- Headless code was type-checked in the sandbox using shims (no internet → no real `pnpm install`). Real `zod`/`better-sqlite3`/`@types/node` are API-compatible with the shims used. Production typecheck on your machine is the real test.
- Host code (`RooTaskRunner`, `RooApprovalAdapter`) was adapted to this fork's real `ClineProvider`/`Task`/`@superroo/types` imports and verified with `pnpm --filter superroo check-types`.
- All tests are written but were not executed in the sandbox. They run for the first time on your machine.

See `src/super-roo/README.md` for the full Phase 1+2 design doc, including the complete approval-flag mapping and Phase 2.5+ roadmap.
