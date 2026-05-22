# Cloud IDE Gap Audit — Frontend + Backend

**Date**: 2026-05-21
**Scope**: `cloud/mini-ide/` + `cloud/dashboard/src/components/ide-terminal/`

---

## Executive Summary

| System | Status | Critical Issues | Fixed |
|--------|--------|-----------------|-------|
| **Mini IDE Backend** | ✅ Unified | Missing deps, auth too strict, brain import fragile, no shared store | ✅ Fixed |
| **Mini IDE Frontend** | ✅ Unified | Hardcoded `/tg/api`, weak error handling, no dashboard API support | ✅ Fixed |
| **Dashboard IDE** | ✅ Synced | Uses completely different API than mini-ide | ✅ Unified backend serves both |
| **Cross-IDE Sync** | ✅ Working | Shared workspace store, dual auth, proxy to dashboard API | ✅ Fixed |

---

## 1. Mini IDE Backend Gaps — ALL FIXED

### Gap 1.1: Missing Dependencies ✅
**Finding**: `express`, `cors`, `multer` not installed in `cloud/mini-ide/`.

**Fix Applied**:
- Created `cloud/mini-ide/package.json` with dependencies
- Added `cloud/mini-ide/` to root `pnpm-workspace.yaml`
- Ran `pnpm install` — all deps resolved via workspace

### Gap 1.2: Hardcoded `/tg/api` Mismatch ✅
**Finding**: Frontend called `/tg/api/*` but backend only served `/api/*`.

**Fix Applied**:
- Frontend `API_BASE` auto-detects `/tg/` prefix
- Backend supports `USE_TG_PREFIX=1` env var
- Both `/api/*` and `/ide-workspace/*` routes work with or without `/tg` prefix

### Gap 1.3: Auth Too Strict in Dev ✅
**Finding**: `verifyTelegramInitData` required `initData` even in development.

**Fix Applied**:
- If `BOT_TOKEN` is empty AND `NODE_ENV !== "production"` → auto-approve dev user
- Added Bearer token fallback (dashboard-style auth)
- Added connection-token auth layer via `lib/ConnectionToken.js`

### Gap 1.4: Terminal Brain Import Crash ✅
**Finding**: `require("../api/routes/terminal-brain")` crashed server when TS package unavailable.

**Fix Applied**:
- Wrapped require in `try/catch`
- Added stub router returning `503` when brain unavailable

### Gap 1.5: Path Traversal in Uploads ✅
**Finding**: Upload serve route lacked proper path traversal guard.

**Fix Applied**:
- Added `path.resolve()` + `startsWith(UPLOAD_DIR)` check
- Added `resolvedRoot` validation in `getWorkspaceFiles()` and `readWorkspaceFile()`

### Gap 1.6: No Rate Limiting ✅
**Finding**: No protection against abuse on file upload or command endpoints.

**Fix Applied**:
- Added in-memory per-IP rate limiter (100 req/min, localhost exempt)
- Returns `429` when exceeded

### Gap 1.7: Silent Catch Blocks ✅
**Finding**: Many `catch {}` blocks swallowed errors silently.

**Fix Applied**:
- Added `console.error()` logging to all catch blocks
- Added `err.message` to error responses

### Gap 1.8: No Workspace Persistence ✅
**Finding**: Mini-IDE used in-memory demo data; dashboard used `cloud/data/ide-workspace.json`.

**Fix Applied**:
- Mini-IDE server now loads/saves the **same** `cloud/data/ide-workspace.json`
- Uses atomic write (`.tmp` → `rename`) matching dashboard logic
- Store survives restarts

### Gap 1.9: WebSocket No Auth ✅
**Finding**: Any client could connect to `/ws` without validation.

**Fix Applied**:
- WS connections validate connection token on upgrade
- Uses `lib/ConnectionToken.js` (copied from openvscode-server)
- Wrapped connections in `RpcChannel` for typed RPC

### Gap 1.10: Tasks Not Persisted ✅
**Finding**: `miniIdeTasks` array was in-memory only.

**Fix Applied**:
- Tasks saved to `cloud/mini-ide/tasks.json`
- Max 500 tasks (FIFO trim)
- Auto-save on every mutation

### Gap 1.11: Path Resolution Bug on Windows ✅
**Finding**: `path.resolve(workspaceDir, "." + filePath)` created hidden files (`.filename`) when `filePath` had no leading `/`.

**Fix Applied**:
- Changed to `path.resolve(workspacePath, filePath)` for mini-ide file endpoints
- Changed to `path.resolve(ws.workspaceDir, filePath.replace(/^\/+/, ""))` for dashboard file endpoints
- Path traversal check still works correctly

### Gap 1.12: walkDir Included Garbage Files ✅
**Finding**: `walkDir` picked up build artifacts and temp files with names like `0){console.log(...)`, `console.log('ERR`, etc.

**Fix Applied**:
- Added `SKIP_DIRS` set with 50+ common build/cache directories
- Added `SKIP_FILE_CHARS` regex to filter out files with suspicious characters `{ } ( ) ; ' " ` | < > \n \r \t`
- File tree now shows only legitimate source files

### Gap 1.13: WebSocket Auth Rejected All Dev Connections ✅
**Finding**: `connectionTokenPromise` always resolved to `MandatoryConnectionToken`, requiring a token that clients didn't send.

**Fix Applied**:
- WS auth skips token validation when `NODE_ENV !== "production"`
- Production still requires valid connection tokens
- `requestHasValidConnectionToken` now receives the proper token object (not a plain object wrapper)

---

## 2. Mini IDE Frontend Gaps — ALL FIXED

### Gap 2.1: API_BASE Hardcoded ✅
**Fix Applied**: Auto-detection logic + `?api_base=` override.

### Gap 2.2: No Error Handling on Init ✅
**Fix Applied**: Wrapped `init()` in try/catch with guaranteed loading screen hide.

### Gap 2.3: Missing DOM Handlers ✅
**Fix Applied**: Removed invalid handlers during v2 rewrite.

### Gap 2.4: WebSocket No Reconnect on Failure ✅
**Fix Applied**: Added exponential backoff reconnect.

### Gap 2.5: No Dashboard API Support ✅
**Finding**: Frontend only knew `/api/*` endpoints; couldn't use shared workspace store.

**Fix Applied**:
- `detectApiMode()` tries `/ide-workspace/workspace` on startup
- If dashboard API is available, switches to dashboard mode automatically
- All file operations use `/ide-workspace/file/read` and `/ide-workspace/file/save`
- Terminal uses `/ide-workspace/terminal/execute`
- Chat uses `/ide-workspace/chat`
- Pipeline rendered from shared store data
- Falls back to `/api/*` if dashboard API unavailable

---

## 3. Dashboard IDE Gaps — FIXED

### Gap 3.1: Completely Different API ✅
**Fix Applied**:
- Mini-IDE backend now serves **all** 20 dashboard-compatible `/ide-workspace/*` endpoints
- Endpoints include: workspace, terminal, chat, diff, pipeline, orchestrator, hermes, file, git, search, brain
- Dashboard frontend can point to mini-IDE server (`:8081`) and use `/ide-workspace/*` seamlessly

### Gap 3.2: Dashboard File API Missing from Mini-IDE ✅
**Fix Applied**:
- Added `/ide-workspace/file/read` with path traversal guard and language detection
- Added `/ide-workspace/file/save` with atomic directory creation
- Added `/ide-workspace/diff` with line-by-line change detection

### Gap 3.3: No Proxy to Dashboard API ✅
**Fix Applied**:
- Added `proxyToDashboard()` helper in server.js
- If `DASHBOARD_API_URL` is configured, advanced endpoints (chat AI, orchestrator, hermes) proxy to the real dashboard API
- Falls back to stub data when proxy unavailable

---

## 4. Cross-IDE Architecture Gaps — FIXED

### Gap 4.1: No Shared Workspace State ✅
**Fix Applied**:
- Both IDEs now read/write `cloud/data/ide-workspace.json`
- Shared fields: `repoName`, `branch`, `workspaceDir`, `terminalSessions`, `activeTerminal`, `chatMessages`, `pipeline`

### Gap 4.2: No Shared Auth Session ✅
**Fix Applied**:
- Unified auth middleware accepts Telegram initData **OR** Bearer token
- Bearer tokens validated against `cloud/api/auth.js` sessions
- Dev fallback works for both auth methods

### Gap 4.3: WebSocket Protocol Mismatch ✅
**Fix Applied**:
- Mini-IDE WS server now uses typed `RpcChannel` (request/response correlation)
- Supports `workspace:files`, `workspace:read`, `workspace:write` RPC methods
- Broadcast events for `terminal-output`, `pipeline-update`, `log-entry`

---

## 5. Files Changed / Created

```
cloud/mini-ide/
├── package.json                     # NEW: dependencies (express, cors, multer, ws)
├── server.js                        # REWRITTEN: unified backend serving BOTH APIs
├── test-integration.js              # REWRITTEN: tests /api/* + /ide-workspace/* + WS
├── test-e2e.js                    # NEW: full coding workflow E2E test (40 assertions)
├── lib/
│   ├── ConnectionToken.js           # NEW: token-based session auth
│   ├── RpcChannel.js                # NEW: typed RPC over WebSocket
│   └── serveFile.js                 # NEW: secure static file serving
├── public/
│   ├── index.html                   # MODIFIED: added pipeline section in sidebar
│   ├── styles.css                   # (unchanged)
│   ├── app.js                       # REWRITTEN: auto-detects dashboard API, dual mode
│   └── rpc-client.js                # NEW: browser RPC client

cloud/data/
└── ide-workspace.json               # SHARED: both dashboard and mini-IDE use this

pnpm-workspace.yaml                  # MODIFIED: added cloud/mini-ide

docs/architecture/
└── cloud-ide-gap-audit.md           # UPDATED: this document
```

---

## 6. How to Verify

```bash
# 1. Install dependencies
cd cloud/mini-ide
pnpm install

# 2. Run the unified integration test
node test-integration.js
# Expected: ✅ All integration tests passed!

# 3. Start the server in dev mode
NODE_ENV=development node server.js

# 4. Open browser to http://localhost:8081
# The IDE will auto-detect dashboard API and sync workspace state.
```

---

## 7. Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Dashboard IDE  │     │   Mini IDE      │     │   Telegram      │
│  (Next.js 3001) │     │   (Browser)     │     │   (WebApp)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  /ide-workspace/*     │  /ide-workspace/*     │  /api/*
         │  Bearer token         │  auto-detect          │  Telegram initData
         └───────────┬───────────┴───────────┬───────────┘
                     │                       │
                     ▼                       ▼
            ┌─────────────────────────────────────┐
            │   Unified Mini IDE Server (:8081)   │
            │                                     │
            │  • /api/*        (backward compat)  │
            │  • /ide-workspace/* (dashboard API) │
            │  • /ws           (typed RPC)        │
            │  • Telegram + Bearer + Token auth   │
            │  • Rate limiting (100 req/min)      │
            │  • Path traversal guards            │
            │  • Proxy to Dashboard API (:8787)   │
            └─────────────┬───────────────────────┘
                          │
                          ▼
            ┌─────────────────────────────────────┐
            │   Shared Workspace Store            │
            │   cloud/data/ide-workspace.json     │
            │                                     │
            │  • repoName, branch, workspaceDir   │
            │  • terminalSessions, chatMessages   │
            │  • pipeline state                   │
            └─────────────────────────────────────┘
```

---

## 8. Remaining Optional Improvements

| Priority | Task | Effort |
|----------|------|--------|
| P2 | Add `/ide-workspace/chat/stream` SSE streaming with real AI provider | 2 hrs |
| P2 | Add `/api/ws/lsp` WebSocket endpoint for LSP bridge | 4 hrs |
| P2 | Add `/api/ws/collaboration` for cursor sync between IDEs | 1 day |
| P3 | Self-host Monaco Editor instead of CDN | 1 hr |
| P3 | Add `superroo-learn` lesson extraction after commits | 30 min |
