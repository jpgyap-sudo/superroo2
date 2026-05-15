# IDE Terminal Improvements Handoff

## Goal

Finish wiring the IDE Terminal so it behaves like a real coding surface, not a shell-first facade, and make the surrounding verification reliable enough to catch regressions.

## Current State

The IDE Terminal has recently been improved so that:

- terminal mode routing now distinguishes `shell`, `agent`, and `skill`
- the UI starts in `agent` mode by default
- shell PTY sessions are opt-in
- terminal output now feeds the rendered `outputBlocks`
- PTY fallback handling works when `node-pty` is unavailable
- the older source-grep crawl scripts were updated to understand the refactored component layout

That work exposed several remaining gaps worth fixing next.

## Proposed Improvements

### 1. Make `TerminalBrain` load reliably in production

#### Problem

Several cloud files try to load raw TypeScript source directly:

- [`cloud/api/api.js`](cloud/api/api.js:2948)
- [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js:63)
- [`cloud/api/tgEndpoints.js`](cloud/api/tgEndpoints.js:532)
- [`cloud/api/routes/terminal-brain.js`](cloud/api/routes/terminal-brain.js:27)

They currently use paths like:

```js
require("../../../packages/terminal-core/src/brain")
```

At least one runtime path reports:

```txt
Terminal Brain packages not available
```

This means live code can silently fall back instead of using the real terminal-brain implementation.

#### Root Cause

[`packages/terminal-core/package.json`](packages/terminal-core/package.json) has **no build step** — only `"clean": "rimraf .turbo"` in scripts. The `exports` field points to raw `.ts` source: `".": "./src/types.ts"`. There is no `dist/` or `build/` directory. Node.js cannot natively `require()` TypeScript files, so this only works if `ts-node` or `tsx` is registered globally, which is fragile.

#### Why It Matters

The system appears wired, but terminal intelligence can be unavailable at runtime depending on loader behavior. The `_terminalBrainAvailable` flag at [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js:60-70) silently stays `false` in production, causing all Telegram brain features to fall back. The `api.js` catch block at line 2949 returns "Terminal Brain not available" responses.

#### Recommended Fix

1. Add a build script to `packages/terminal-core/package.json` (e.g., `tsc` or `tsup`)
2. Update `exports` to point to compiled output (e.g., `"./dist/index.js"`)
3. Replace all 4 `require()` calls with the package name `@superroo/terminal-core`

#### Acceptance Criteria

- no cloud runtime file imports `packages/terminal-core/src/*` directly
- `TerminalBrain` loads without fallback logs
- terminal-brain routes and Telegram brain features use the same implementation
- a smoke test proves `TerminalBrain` can be created from the cloud API process

---

### 2. Add real integration tests for IDE Terminal behavior

#### Problem

Many current terminal checks are source-pattern checks. They verify strings exist, not that behavior works.

Current test coverage:

- [`cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js`](cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js) (488 lines) — Tests reducer logic but re-implements the reducer inline rather than importing it. Covers `toOutputBlocks` conversion, `SET_TERMINAL_OUTPUT`, `APPEND_TERMINAL_OUTPUT`.
- [`cloud/dashboard/src/components/ide-terminal/__tests__/api-compute-diff.test.js`](cloud/dashboard/src/components/ide-terminal/__tests__/api-compute-diff.test.js) — Tests the diff API.
- **No integration tests** exist for mode routing, PTY creation, WebSocket output, paste, or image attachment.

#### Recommended Coverage

Add tests for:

1. `agent` mode routes plain text through agent execution
2. `skill` mode routes plain text through skill execution
3. `shell` mode creates a PTY only when selected
4. REST fallback output becomes visible terminal blocks
5. WebSocket PTY output becomes visible terminal blocks
6. terminal paste works
7. image paste still attaches files correctly

#### Acceptance Criteria

- at least one integration test covers each mode
- tests assert behavior/output, not only file contents
- failures clearly identify broken wiring

---

### 3. Replace stale source-grep crawl checks with behavior-oriented checks

#### Problem

Older crawl tests assumed all IDE terminal logic lived in one file:

- [`cloud/test-ide-smartness-comparison.js`](cloud/test-ide-smartness-comparison.js) (629 lines) — Reads source files via `fs.readFileSync()` and checks for string patterns like `source.includes("function detectCodingIntent")`. Brittle — any refactor that moves code between files breaks these tests.
- [`cloud/test-smart-terminal-e2e.js`](cloud/test-smart-terminal-e2e.js) (724 lines) — Same pattern: `fs.readFileSync("./api/telegramBot.js", "utf8")` then string matching.
- [`cloud/test-full-stack-crawl.js`](cloud/test-full-stack-crawl.js) (1000 lines) — Actually does HTTP requests to the VPS, which is better, but still mixed with source-grep checks.

After the IDE was split into smaller components, those checks produced false failures.

#### Recommended Fix

Move these scripts away from file-local string checks where practical.

Prefer:

- imported helper assertions
- module-level checks across the actual IDE module set
- HTTP/WebSocket behavior checks
- browser-level smoke tests

#### Acceptance Criteria

- component refactors do not break tests unless behavior changes
- the tests fail on real regressions, not file movement

---

### 4. Fix the dashboard TypeScript error in `telegram.tsx`

#### Problem

Targeted TypeScript verification currently fails with:

```txt
src/components/views/telegram.tsx(571,18): error TS2367:
This comparison appears to be unintentional because the types '1' and '0' have no overlap.
```

The offending code at [`cloud/dashboard/src/components/views/telegram.tsx`](cloud/dashboard/src/components/views/telegram.tsx:570-571):

```typescript
const chatId = botStatus.online ? 1 : 0  // literal type '1 | 0'
if (!chatId || chatId === 0) {            // TS2367: '1' and '0' have no overlap
```

The ternary produces the literal union type `1 | 0`, so `chatId === 0` is always false when `chatId` is `1`. TypeScript correctly flags this as an impossible comparison.

#### Fix Options

1. **Simplest**: Change `if (!chatId || chatId === 0)` to `if (chatId !== 1)`
2. **Type annotation**: `const chatId: number = botStatus.online ? 1 : 0`
3. **Better design**: Use a boolean or fetch the real chat ID from the API instead of sentinel values

#### Why It Matters

The dashboard cannot get back to a clean whole-app typecheck until this is fixed.

#### Acceptance Criteria

- `pnpm --dir cloud/dashboard exec tsc --noEmit` passes

---

### 5. Unify terminal state around one canonical model

#### Problem

The IDE still keeps both:

- `terminalOutput: string[]`
- `outputBlocks: OutputBlock[]`

They are now synchronized, but dual state increases drift risk.

In [`cloud/dashboard/src/lib/ide-store.tsx`](cloud/dashboard/src/lib/ide-store.tsx:165-167):

```typescript
terminalInput: string
terminalOutput: string[]       // ← legacy, kept for backward compat
outputBlocks: OutputBlock[]    // ← canonical
```

The reducer at lines 508-517 synchronizes them:

- `SET_TERMINAL_OUTPUT` sets both `terminalOutput` and converts to `outputBlocks`
- `APPEND_TERMINAL_OUTPUT` appends to both arrays
- `SET_OUTPUT_BLOCKS` only sets `outputBlocks` — **drift possible!**

#### Risk

If any code path dispatches `SET_OUTPUT_BLOCKS` without also updating `terminalOutput`, the two arrays diverge. The `TerminalPanel` component at line 523 only receives `outputBlocks`, so rendering is fine, but anything reading `terminalOutput` directly would be stale.

#### Recommended Fix

Make `outputBlocks` the canonical source of truth and derive plain text only when needed. Remove `terminalOutput` from state entirely and add a getter that maps `outputBlocks` to plain text.

#### Acceptance Criteria

- terminal rendering does not depend on two independently managed output models
- recording, search, copy, and output display all read from one canonical state shape

---

### 6. Tighten shell-mode safety

#### Problem

Shell mode is now explicit, but raw command execution remains powerful.

The terminal mode routing at [`cloud/dashboard/src/components/views/ide-terminal.tsx`](cloud/dashboard/src/components/views/ide-terminal.tsx:485-496) shows SH/AG/SK mode buttons, but there is no:

- audit logging by terminal mode
- risk checks for shell commands
- approval gating for destructive or deployment-adjacent commands
- clear distinction in logs between agent/skill/shell execution

#### Recommended Fix

Add:

- explicit audit logging by terminal mode
- risk checks for shell commands (e.g., `rm -rf`, `DROP TABLE`, `sudo`)
- optional approval gating for destructive or deployment-adjacent commands
- clear distinction in logs between agent, skill, and shell execution

#### Acceptance Criteria

- audit logs record mode and command source
- risky shell commands are visible and policy-governed
- agent/skill execution cannot be confused with raw shell execution

---

### 7. Finish PTY session lifecycle UX

#### Problem

Backend support exists for PTY sessions, listing, buffers, and split terminals, but the frontend is only partially connected.

Current wiring in [`useIdeTerminal`](cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts):

- `ptyConnected` / `ptySessionId` — status indicators (wired)
- `splitTerminals` / `activeSplitTerminal` — split terminal support (wired)
- `handleAddSplitTerminal` / `handleRemoveSplitTerminal` — CRUD for splits (wired)

The [`TerminalPanel`](cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx:69-70) accepts `ptyConnected` and `ptySessionId` props.

#### Gaps

- No visible shell and cwd display in the terminal header
- No session reconnection UI for persisted sessions
- Split terminals may not map to real independent PTY sessions
- No session restore behavior exposed to the user

#### Recommended Work

- show active shell and cwd
- support reconnecting to persisted sessions
- bind split terminal tabs to real PTY sessions
- expose session restore behavior clearly

#### Acceptance Criteria

- split terminals map to real independent sessions
- reconnecting restores useful session state
- user can tell what shell/cwd/session is active

---

### 8. Add browser-level smoke coverage

#### Problem

No browser automation tests exist for the IDE Terminal. All current verification is done via source-grep or manual HTTP requests.

#### Recommended Flow

Use browser automation (Playwright or Puppeteer) to verify:

1. dashboard loads
2. IDE Terminal opens
3. default mode is `AG`
4. plain text in agent mode is routed as agent work
5. switching to `SK` changes routing
6. switching to `SH` starts shell/PTY behavior
7. output appears in the terminal panel
8. paste and image attachment still work

#### Acceptance Criteria

- one browser smoke test covers the main user journey
- screenshots/logging make regressions easy to diagnose

---

## Suggested Order Of Work

| Priority | Improvement                             | Effort  | Current State                              | Dependencies         |
| -------- | --------------------------------------- | ------- | ------------------------------------------ | -------------------- |
| **1**    | Package and fix `TerminalBrain` loading | Medium  | ❌ All 4 files use raw TS imports          | None                 |
| **2**    | Fix `telegram.tsx` typecheck error      | Trivial | ❌ TS2367 at line 571                      | None                 |
| **3**    | Add IDE terminal integration tests      | Medium  | ⚠️ Unit tests exist, no integration tests  | #1 (for brain tests) |
| **4**    | Replace brittle crawl assertions        | Medium  | ❌ All 3 scripts use source-grep           | None                 |
| **5**    | Unify terminal state                    | Small   | ⚠️ Dual state synchronized but drift-prone | None                 |
| **6**    | Tighten shell-mode safety               | Medium  | ❌ Not implemented                         | None                 |
| **7**    | Finish PTY UX                           | Medium  | ⚠️ Partially wired                         | None                 |
| **8**    | Add browser smoke tests                 | Large   | ❌ Not implemented                         | #3 (test infra)      |

### Recommended Execution Order

1. **Package and fix `TerminalBrain` loading** — unblocks all brain-dependent features
2. **Fix `telegram.tsx` typecheck error** — quick win, restores clean typecheck
3. **Add IDE terminal integration tests** — prevents regressions during subsequent changes
4. **Replace brittle crawl assertions with behavior checks** — reduces false failures
5. **Unify terminal state** — eliminates drift risk before adding more state
6. **Finish PTY UX and shell safety polish** — user-facing improvements

## Useful Files

### Cloud API (backend)

| File                                                                       | Purpose                                                        | Key Lines                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| [`cloud/api/api.js`](cloud/api/api.js)                                     | Main API server — TerminalBrain lazy-load, agent/skill routing | 2940-2969 (brain), 3801-3839 (mode routing) |
| [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js)                     | Telegram bot — brain availability flag, brain commands         | 59-70 (flag), 2598-2834 (brain handler)     |
| [`cloud/api/tgEndpoints.js`](cloud/api/tgEndpoints.js)                     | Telegram REST endpoints — brainPlan, brainExecute, etc.        | 516-739 (brain endpoints)                   |
| [`cloud/api/routes/terminal-brain.js`](cloud/api/routes/terminal-brain.js) | Express router for Terminal Brain REST API                     | 1-156 (full file)                           |

### Terminal Core (package)

| File                                                                             | Purpose                                        | Key Lines         |
| -------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------- |
| [`packages/terminal-core/package.json`](packages/terminal-core/package.json)     | Package config — missing build step            | 1-16 (full file)  |
| [`packages/terminal-core/src/brain.ts`](packages/terminal-core/src/brain.ts)     | TerminalBrain class — Plan → Run → Verify loop | 1-345 (full file) |
| [`packages/terminal-core/src/memory.ts`](packages/terminal-core/src/memory.ts)   | Terminal memory management                     | —                 |
| [`packages/terminal-core/src/planner.ts`](packages/terminal-core/src/planner.ts) | Command planning                               | —                 |
| [`packages/terminal-core/src/types.ts`](packages/terminal-core/src/types.ts)     | TypeScript type definitions                    | —                 |

### Dashboard Frontend

| File                                                                                                                                         | Purpose                                                 | Key Lines                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| [`cloud/dashboard/src/components/views/ide-terminal.tsx`](cloud/dashboard/src/components/views/ide-terminal.tsx)                             | Main IDE Terminal view — mode buttons, pipeline, editor | 485-496 (mode routing), 522-601 (TerminalPanel) |
| [`cloud/dashboard/src/components/views/telegram.tsx`](cloud/dashboard/src/components/views/telegram.tsx)                                     | Telegram dashboard view — TS error at line 571          | 566-583 (handleSendTestMessage)                 |
| [`cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts`](cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts) | All IDE Terminal logic hook                             | 1-1437 (full file)                              |
| [`cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx`](cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx)             | Terminal panel UI component                             | 1-763 (full file)                               |
| [`cloud/dashboard/src/lib/ide-store.tsx`](cloud/dashboard/src/lib/ide-store.tsx)                                                             | State management — dual terminalOutput/outputBlocks     | 165-167 (state), 508-517 (reducer)              |

### Tests

| File                                                                                                                                                                 | Purpose                                    | Problem                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| [`cloud/test-ide-smartness-comparison.js`](cloud/test-ide-smartness-comparison.js)                                                                                   | Compares cloud IDE vs VS Code intelligence | Source-grep, brittle         |
| [`cloud/test-smart-terminal-e2e.js`](cloud/test-smart-terminal-e2e.js)                                                                                               | Tests 14 smart terminal features           | Source-grep, brittle         |
| [`cloud/test-full-stack-crawl.js`](cloud/test-full-stack-crawl.js)                                                                                                   | Full-stack HTTP crawl test                 | Mixed source-grep + HTTP     |
| [`cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js`](cloud/dashboard/src/components/ide-terminal/__tests__/ide-store-reducer.test.js) | Reducer unit tests                         | Re-implements reducer inline |
| [`cloud/dashboard/src/components/ide-terminal/__tests__/api-compute-diff.test.js`](cloud/dashboard/src/components/ide-terminal/__tests__/api-compute-diff.test.js)   | Diff API tests                             | Good, but isolated           |

## Validation Commands

```powershell
# Dashboard unit tests
pnpm --filter superroo-dashboard test

# TypeScript typecheck
pnpm --dir cloud/dashboard exec tsc --noEmit

# Crawl tests (will produce false failures until Improvement #4 is done)
node cloud/test-ide-smartness-comparison.js
node cloud/test-smart-terminal-e2e.js

# Full-stack crawl (requires VPS access)
node cloud/test-full-stack-crawl.js
```

## Definition Of Done

- `TerminalBrain` loads reliably without runtime fallback
- IDE Terminal defaults to agent behavior and shell stays opt-in
- dashboard typecheck is clean (`pnpm --dir cloud/dashboard exec tsc --noEmit` passes)
- behavior tests cover all terminal modes
- crawl tests reflect the current architecture (no source-grep false failures)
- browser smoke test proves the terminal works end to end
