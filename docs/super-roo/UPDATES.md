# SuperRoo — Update Log

All notable changes to the SuperRoo module are recorded here.
Format: `[DATE] [AUTHOR] — Description`

> For parallel AI coding workflows, each entry includes a **coder** field
> so any contributor (human or AI) can trace who changed what and why.

---

## 2026-04-30

### Bug Fixes — Audit Round 1–4 (Coder: Claude Sonnet 4.6)

#### `src/super-roo/import/FileImporter.ts`
- **Fixed: command injection via execSync**
  `extractTar` and `extractTarGz` used string-interpolated `execSync` which
  allowed file paths to be interpreted as shell commands.
  Fix: replaced with `spawnSync` using an explicit args array.

#### `src/super-roo/ml/learning/DebugLearner.ts`
- **Fixed: feature vector dimension mismatch**
  `typeVec` had 6 elements but `inputDim: 8` expects 5 type-bits + 3 float
  values = 8. Trimmed `typeVec` to 5 elements.

#### `src/super-roo/orchestrator/SuperRooOrchestrator.ts`
- **Fixed: workspacePathOverride bypassed the self-improve boundary**
  Agents could pass `payload.workspacePathOverride` to redirect file writes
  into the SuperRoo codebase even when `selfImprove = false`.
  Fix: added `checkSelfImproveBoundary()` check at the orchestrator dispatch
  layer before any agent is invoked.

#### `src/super-roo/crawler/CrawlerAgent.ts`
- **Fixed: signal ID collision**
  Signal IDs were `${sourceId}_${doc.fetchedAt}`, causing collisions when
  multiple docs from the same source share the same millisecond timestamp in
  one crawl batch.
  Fix: appended loop index `_${i}` to make IDs unique per batch.

#### `src/super-roo/queue/TaskQueue.ts`
- **Fixed: wrong log level for cancelled tasks**
  `"cancelled"` status fell through to `"error"` log level in the event
  ternary. Cancelled is not an error — it should be `"warn"`.
  Fix: restructured ternary so `"failed"` → error, all others → warn.
- **Removed: dead `PRIORITY_RANK` constant**
  The constant was declared but never read (SQL `CASE` handles priority
  ordering in `dequeue()`). Removed to eliminate TS6133 lint noise.

#### `src/super-roo/agents/PmAgent.ts`
- **Fixed: deprecated features unconditionally reset to "building"**
  When a feature was found with status `"deprecated"`, the PM Agent
  overwrote it to `"building"` and queued a Coder rebuild, ignoring the
  deprecation.
  Fix: early return with `ok: false` when `feature.status === "deprecated"`.

---

### Bug Fixes — CLI Audit (Coder: Claude Sonnet 4.6)

#### `src/cli/index.ts`
- **Fixed: daemon URL base-path silently stripped**
  `new URL("/tasks", daemonUrl)` drops any path segment in `SUPERROO_DAEMON_URL`
  (e.g. `http://host/api` → `/tasks` instead of `/api/tasks`).
  Fix: string concatenation `daemonUrl.replace(/\/$/, "") + "/tasks"`.
- **Fixed: autonomous command dropped all CLI options in daemon path**
  `--hours`, `--project`, `--auto-approve`, `--no-deploy` were all ignored
  when building the task submitted to the daemon.
  Fix: passed all options via `workspacePath` and `payload` in `runAutonomous`.
- **Removed: dead code guard in `task` command**
  `if (!goal.length)` was unreachable — Commander enforces `<goal...>` as a
  required variadic arg before the action fires.
- **Fixed: indentation in `.catch()` body**
  `parseAsync` catch handler body was at column 0 (de-indented).

#### `src/core/commands/check-vps.ts`
- **Fixed: no delay between retry attempts**
  All retries fired in rapid succession with no back-off.
  Fix: 2-second wait between each failed attempt.

#### `src/core/utils/shell.ts`
- **Removed: dead `all: true` execa option**
  `all: true` merges stdout/stderr into `result.all`, but `result.all` was
  never read. Removed to avoid confusion.

---

### Bug Fixes — Daemon / Deployment (Coder: Claude Sonnet 4.6)

#### `src/super-roo-daemon/index.ts`
- **Fixed: invalid JSON body returned 500 instead of 400**
  `JSON.parse(body)` was unguarded; a malformed payload caused an unhandled
  parse error caught by the outer handler, returning HTTP 500.
  Fix: wrapped in a try/catch that returns HTTP 400 `{ error: "invalid_json" }`.
- **Fixed: null/primitive body crashed `parseTaskSubmission`**
  If `body` was valid JSON but not an object (e.g. `"null"`, `"42"`),
  accessing `raw.source` would throw a TypeError.
  Fix: added an explicit `typeof parsed !== "object"` guard returning HTTP 400.

#### `.husky/pre-commit` and `.husky/pre-push`
- **Fixed: hooks fail on Windows Git Bash**
  Hooks hardcoded `pnpm.cmd` / `npx.cmd` which are not executable directly
  in the Git Bash POSIX shell environment.
  Fix: use `cmd //C pnpm` / `cmd //C npx` on `Windows_NT`, with graceful
  warn-and-continue fallback if tools are still unavailable.

---

---

### Coder Signature System — Implemented (Coder: Claude Sonnet 4.6)

**Status:** Shipped 2026-04-30
**Why:** Multiple AI coders debug in parallel; every task, event, and session
needs a `codedBy` stamp so any contributor can trace who changed what and why.

**What was changed:**

| Layer | Change |
|---|---|
| `src/super-roo/types/index.ts` | `codedBy?: string` added to `TaskInputRaw`, `Task`, `LogEvent`, `AgentRunContext`, `OrchestratorConfig` |
| `src/super-roo/memory/MemoryStore.ts` | Migration v2: `ALTER TABLE tasks ADD COLUMN coded_by TEXT` + same on `events`; index on `events.coded_by` |
| `src/super-roo/logging/EventLog.ts` | `codedBy?` added to `emit()` extra param; persisted to DB |
| `src/super-roo/queue/TaskQueue.ts` | `TaskRow.coded_by`, `rowToTask()` mapping, INSERT includes `coded_by` |
| `src/super-roo/orchestrator/SuperRooOrchestrator.ts` | `codedBy = task.codedBy ?? config.codedBy` threaded through `AgentRunContext` and all emitted events |
| `src/super-roo-daemon/index.ts` | Reads `SUPERROO_CODER_ID` env → `DaemonConfig.codedBy` → stamps tasks that don't supply their own |
| `src/super-roo/core/types.ts` | `SuperRooRuntime.codedBy?: string` |
| `src/super-roo/core/createDefaultRuntime.ts` | Accepts and forwards `codedBy` from input |
| `src/core/SuperRooTask.ts` | `codedBy?: string` in schema + `superRooTaskToTaskInput` carries it |
| `src/cli/index.ts` | `--coder <name>` on `autonomous` and `task` commands; falls back to `SUPERROO_CODER_ID` env var |

**Usage:**
```bash
# via CLI flag
superroo autonomous --coder "claude-sonnet-4-6"
superroo task "fix the login bug" --coder "claude-opus-4-7"

# via env var (preferred for daemon/VPS)
SUPERROO_CODER_ID=claude-sonnet-4-6 superroo autonomous
```
