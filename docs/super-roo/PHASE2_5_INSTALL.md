# Super Roo — Phase 2.5 (Debugger + PM + Tester + BugRegistry)

This phase completes the agent loop. After Phase 2.5 you have all four core agents (PM → Coder → Tester → Debugger → Coder) plus the bug-tracking surface that Phase 1 deferred.

**Phase 2.5 ships zero new runtime dependencies.** Uses Node 20.19.2's built-in `node:child_process`. Roo's existing pnpm workspace covers everything.

## What's new

### Headless (`src/super-roo/`)

| File | What it does |
|---|---|
| `bugs/BugRegistry.ts` | CRUD on bugs/fixes tables (Phase 1 declared the schema; 2.5 adds the API) |
| `bugs/index.ts` | Barrel |
| `agents/PmAgent.ts` | Plans features in Roo's `architect` mode, queues Coder tasks |
| `agents/DebuggerAgent.ts` | Records bugs, runs Roo's `debug` mode, queues Coder fix tasks |
| `agents/TesterAgent.ts` | Runs `npm test` / `npm run lint` / etc. via host TestRunner |
| `agents/TestRunner.ts` | Headless interface (host implements) |
| `__tests__/BugRegistry.test.ts` | 12 tests |
| `agents/__tests__/PmAgent.test.ts` | 6 tests |
| `agents/__tests__/DebuggerAgent.test.ts` | 7 tests |
| `agents/__tests__/TesterAgent.test.ts` | 8 tests |

### Host-side (`src/super-roo-host/`)

| File | What it does |
|---|---|
| `services/tester/TestRunnerHost.ts` | Concrete `TestRunner` using `node:child_process`. Defaults to `npm` scripts. Honors `AbortSignal` and timeouts. `shell: false` for safety. |
| `services/tester/index.ts` | Barrel |

### Updated barrels

- `src/super-roo/agents/index.ts` — exports new agents and TestRunner type
- `src/super-roo/index.ts` — exports BugRegistry
- `src/super-roo-host/index.ts` — exports TestRunnerHost
- `src/super-roo/README.md` — documents Phase 2.5 scope, agent loop, limitations

## The agent loop

After 2.5, the four agents form a complete autonomous loop:

```
PM Agent       → plans feature           → queues Coder
Coder Agent    → implements              → queues Tester
Tester Agent   → runs tests              → on fail, queues Debugger
Debugger Agent → diagnoses + records bug → queues Coder fix
                                           → loop closes when Tester reports green
```

Each agent's `AgentRunResult.followups` field drives the chain. The orchestrator `runLoop()` processes them in priority order.

## Install

### Path A — fresh install (haven't applied Phase 1/2 yet)

```bash
# 1. Drop the entire src/super-roo and src/super-roo-host trees in
cp -r path/to/super-roo-phase2.5-deliverable/src/super-roo superroo2/src/
cp -r path/to/super-roo-phase2.5-deliverable/src/super-roo-host superroo2/src/

# 2. Apply Phase 1's package.json patches
cd superroo2
patch -p1 < path/to/super-roo-phase1-deliverable/patches/root-package.json.patch
patch -p1 < path/to/super-roo-phase1-deliverable/patches/src-package.json.patch

# 3. Install + verify
pnpm install
pnpm --filter superroo check-types
pnpm --filter superroo test super-roo super-roo-host
```

### Path B — upgrading from Phase 2

```bash
# 1. Add the new bugs module
cp -r path/to/super-roo-phase2.5-deliverable/src/super-roo/bugs superroo2/src/super-roo/

# 2. Replace the agents directory (new files + updated barrel)
rm -rf superroo2/src/super-roo/agents
cp -r path/to/super-roo-phase2.5-deliverable/src/super-roo/agents superroo2/src/super-roo/

# 3. Replace top-level barrel and tests dir
cp path/to/super-roo-phase2.5-deliverable/src/super-roo/index.ts superroo2/src/super-roo/
cp path/to/super-roo-phase2.5-deliverable/src/super-roo/__tests__/BugRegistry.test.ts superroo2/src/super-roo/__tests__/

# 4. Add host services
mkdir -p superroo2/src/super-roo-host/services
cp -r path/to/super-roo-phase2.5-deliverable/src/super-roo-host/services/tester superroo2/src/super-roo-host/services/

# 5. Update host barrel
cp path/to/super-roo-phase2.5-deliverable/src/super-roo-host/index.ts superroo2/src/super-roo-host/

# 6. Update README
cp path/to/super-roo-phase2.5-deliverable/src/super-roo/README.md superroo2/src/super-roo/

# 7. No new pnpm install needed — zero new dependencies
pnpm --filter superroo check-types
pnpm --filter superroo test super-roo super-roo-host
```

## Wiring (when you're ready to turn it on)

```ts
import {
    SuperRooOrchestrator,
    CoderAgent, PmAgent, DebuggerAgent, TesterAgent,
    BugRegistry,
    SafetyMode,
} from "./super-roo"
import { RooTaskRunner, TestRunnerHost } from "./super-roo-host"

const orch = new SuperRooOrchestrator({
    dbPath: context.globalStorageUri.fsPath + "/super-roo.db",
    initialMode: SafetyMode.SAFE,
})
orch.start()

// BugRegistry — uses the same memory + events the orchestrator already owns.
const bugs = new BugRegistry(orch.memory, orch.events)

// Roo task runner (Phase 2)
const rooRunner = new RooTaskRunner({ provider: clineProvider })

// Test runner (Phase 2.5)
const testRunner = new TestRunnerHost({
    defaultCwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? "",
})

orch.agents.register(new PmAgent(rooRunner, orch.features))
orch.agents.register(new CoderAgent(rooRunner))
orch.agents.register(new TesterAgent(testRunner))
orch.agents.register(new DebuggerAgent(rooRunner, bugs))

// Submit a high-level goal
orch.submit({
    agent: "product-manager",
    goal: "Add password reset flow",
    requiredCapabilities: ["read.file"],
    payload: { featureName: "Password Reset" },
})

const loop = orch.runLoop({ idleSleepMs: 250 })
```

## Verification status (sandbox)

- **Headless type-check**: ✓ zero errors (Phase 1 + 2 + 2.5)
- **Host type-check**: ✓ zero errors (incl. TestRunnerHost against stub `node:child_process`)
- **Tests written**: 135 total (33 new in Phase 2.5)
- **Tests run**: not in sandbox (no `pnpm install`); will run on your machine

## Honest caveats

- `TestRunnerHost` defaults to npm scripts. Non-npm projects (Cargo, Go, Python) need `kind: "custom"` with explicit `command` and `args`.
- No streaming output yet — full stdout/stderr returned at end. Phase 3 dashboard may want streaming.
- DebuggerAgent's bug record stores symptoms only; Roo's actual diagnosis lives in the EventLog. Phase 3 dashboard will join them visually.
- PM Agent re-plans on every run (no memory of prior plans). Iterative re-planning is a Phase 3+ enhancement.

## Next: Phase 3 — Dashboard UI

Webview tabs reading from EventLog/queue/features/bugs. Lives in `webview-ui/src/components/super-roo/`.
