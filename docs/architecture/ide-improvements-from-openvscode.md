# IDE Improvements Copied from openvscode-server

**Date**: 2026-05-21
**Scope**: Concrete code copied from `gitpod-io/openvscode-server` → adapted into SuperRoo Mini IDE & Dashboard

---

## Summary

Instead of replacing your IDE, I extracted **5 production-hardened patterns** from openvscode-server and adapted them into your existing codebase. These are concrete files you can review, test, and merge.

| Pattern | Source File in openvscode-server | Your New File | What It Fixes |
|---------|----------------------------------|---------------|---------------|
| **Connection Token Auth** | `src/vs/server/node/serverConnectionToken.ts` | `cloud/mini-ide/lib/ConnectionToken.js` | Your Mini IDE has no session security beyond Telegram initData |
| **Secure File Serving** | `src/vs/server/node/webClientServer.ts` | `cloud/mini-ide/lib/serveFile.js` | `express.static()` has no path traversal or ETag caching |
| **Typed RPC over WebSocket** | `src/vs/platform/remote/common/remoteAgentConnection.ts` | `cloud/mini-ide/lib/RpcChannel.js` | Your WS messages are fire-and-forget; no request/response correlation |
| **Improved Server** | `src/vs/server/node/remoteExtensionHostAgentServer.ts` | `cloud/mini-ide/server-v2.js` | Combines all patterns + graceful shutdown + path traversal guards |
| **RPC WebSocket Client** | `src/vs/platform/remote/common/remoteAgentConnection.ts` | `cloud/mini-ide/public/rpc-client.js` | Your frontend WS has no auto-reconnect with backoff |

---

## 1. Connection Token Auth

### Copied from
`src/vs/server/node/serverConnectionToken.ts` — how openvscode-server validates the `?tkn=` parameter and cookie.

### What it does
- Generates a 256-bit random token on first startup, persists it to disk with `0o600` permissions
- Accepts token via query param (`?tkn=...`), cookie, or `X-Connection-Token` header
- Validates on **every** HTTP request and WebSocket upgrade
- Can be overridden via `CONNECTION_TOKEN` env var

### Your improvement
**Before**: Mini IDE only checks Telegram initData. Anyone who knows the URL can access the IDE if they bypass Telegram.

**After**: Dual-layer auth:
1. Connection token proves session access
2. Telegram initData (or dashboard Bearer) proves user identity

### Code to merge
```javascript
// In your existing server.js, add near the top:
const { MandatoryConnectionToken, loadOrCreateToken, requestHasValidConnectionToken } = require("./lib/ConnectionToken")

const connectionToken = new MandatoryConnectionToken(
  process.env.CONNECTION_TOKEN || loadOrCreateToken(path.join(__dirname, ".data"))
)

// Add middleware before routes:
app.use((req, res, next) => {
  if (req.path === "/api/health") return next()
  const parsedUrl = url.parse(req.url, true)
  if (!requestHasValidConnectionToken(connectionToken, req, parsedUrl)) {
    return res.status(403).json({ error: "Forbidden" })
  }
  next()
})
```

---

## 2. Secure Static File Serving

### Copied from
`src/vs/server/node/webClientServer.ts` — the `serveFile()` function with ETag generation and path traversal checks.

### What it does
- **Path traversal protection**: Resolves paths and ensures the served file is inside a whitelist root
- **ETag caching**: Generates weak ETags from `(inode, size, mtime)`. Returns `304 Not Modified` when matched
- **Proper MIME types**: Maps extensions to content types
- **Cache-Control modes**: `no-store` for HTML, `ETag` for dev assets, `max-age=31536000` for built assets

### Your improvement
**Before**: `app.use(express.static(path.join(__dirname, "public")))` — no caching, no traversal protection, wrong MIME types sometimes.

**After**: Explicit `/static/*` route with security and caching.

### Code to merge
```javascript
// Replace express.static with:
const { serveFile, CacheControl } = require("./lib/serveFile")
const PUBLIC_ROOT = path.join(__dirname, "public")

app.get("/static/*", async (req, res) => {
  const resourcePath = decodeURIComponent(req.path.substring("/static/".length))
  const filePath = path.join(PUBLIC_ROOT, resourcePath)
  const cacheMode = process.env.NODE_ENV === "production" ? CacheControl.NO_EXPIRY : CacheControl.ETAG
  await serveFile(filePath, cacheMode, req, res, {}, PUBLIC_ROOT)
})
```

---

## 3. Typed RPC over WebSocket

### Copied from
`src/vs/platform/remote/common/remoteAgentConnection.ts` — the `PersistentProtocol` + request/response correlation pattern.

### What it does
openvscode-server doesn't send loose JSON blobs over WebSocket. It uses a **structured RPC protocol**:
```typescript
// Request
{ type: "request", reqId: 1, method: "CreateProcess", args: {...} }

// Response
{ type: "response", reqId: 1, result: {...} }

// Event
{ type: "event", event: "OnProcessData", payload: {...} }
```

Benefits:
- **Correlation**: Every request gets a matching response (no guessing)
- **Timeouts**: Pending requests auto-reject after N seconds
- **Typed methods**: Server exposes a method registry, not ad-hoc message types
- **Events**: One-way broadcasts are separate from request/response

### Your improvement
**Before**: Your server broadcasts `{ type: "terminal-output", line: "..." }` but has no way for the client to ask "what files are in this workspace?" and get a guaranteed answer.

**After**: Full RPC in both directions.

### Server-side (merge into your server.js)
```javascript
const { RpcChannel } = require("./lib/RpcChannel")

// Replace your ws.on("connection", ...) with:
wss.on("connection", (ws, req) => {
  const channel = new RpcChannel(ws, { timeoutMs: 30000 })
  
  channel._handleIncomingRequest = async (msg) => {
    switch (msg.method) {
      case "workspace:files":
        const files = await getWorkspaceFiles(msg.args.workspaceId)
        channel.sendResponse(msg.reqId, { files }, null)
        break
      case "workspace:read":
        const content = await readWorkspaceFile(msg.args.workspaceId, msg.args.filePath)
        channel.sendResponse(msg.reqId, { content }, null)
        break
      // ... etc
    }
  }
})
```

### Client-side (add to your app.js)
```javascript
// Include <script src="/static/rpc-client.js"></script>
const rpc = new RpcClient(`wss://${location.host}/ws?workspace=${workspaceId}`, { token: CONNECTION_TOKEN })
rpc.connect()

// Now you can do:
const { files } = await rpc.call("workspace:files", { workspaceId: "superroo2" })
const { content } = await rpc.call("workspace:read", { workspaceId: "superroo2", filePath: "package.json" })

// Events still work:
rpc.on("terminal-output", ({ line }) => {
  state.terminal.output.push(line)
})
```

---

## 4. Graceful Shutdown

### Copied from
`src/vs/server/node/remoteExtensionHostAgentServer.ts` — the `SHUTDOWN_TIMEOUT` + connection draining logic.

### What it does
- Stops accepting new HTTP/WebSocket connections
- Sends `1001 Going Away` to all existing WebSocket clients
- Waits for clean close, then exits
- Hard-exits after a timeout if something is stuck

### Your improvement
**Before**: Your server immediately terminates on SIGINT, potentially dropping in-flight file saves.

**After**: 10-second graceful drain.

### Code to merge
```javascript
let isShuttingDown = false
function shutdown() {
  if (isShuttingDown) return
  isShuttingDown = true
  server.close(() => console.log("HTTP closed"))
  wss.clients.forEach(ws => ws.close(1001, "Server shutting down"))
  wss.close(() => { console.log("WS closed"); process.exit(0) })
  setTimeout(() => process.exit(1), 10000)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

---

## 5. Frontend RPC Client with Auto-Reconnect

### Copied from
`src/vs/platform/remote/common/remoteAgentConnection.ts` — the `createSocket` + `PromiseWithTimeout` + reconnection pattern.

### What it does
- **Exponential backoff**: Reconnects at 5s, then 10s, 20s, up to 30s max
- **Request timeouts**: Rejects pending calls if no response in 30s
- **Promise-based**: `await rpc.call("method", args)` instead of callback hell
- **Legacy bridge**: `LegacyWsBridge` wrapper so your existing `app.js` code doesn't break immediately

### Your improvement
**Before**: Your `connectWebSocket()` reconnects every 5s fixed, and has no way to correlate a sent message with a server response.

**After**: Smart reconnect + typed RPC.

---

## Quick Start: Test the Improvements

```bash
# 1. The new files are already created:
ls cloud/mini-ide/lib/
# ConnectionToken.js  RpcChannel.js  serveFile.js

# 2. Review the new server (non-destructive, it's server-v2.js)
cat cloud/mini-ide/server-v2.js | head -50

# 3. To test, you can temporarily swap:
cd cloud/mini-ide
node server-v2.js

# 4. The frontend RPC client is at:
# cloud/mini-ide/public/rpc-client.js
# Include it in your index.html before app.js:
# <script src="/static/rpc-client.js"></script>
```

---

## Dashboard IDE: Patterns to Copy Next

These same patterns apply to your Dashboard IDE (`cloud/dashboard/`):

| Pattern | Dashboard Location | Improvement |
|---------|-------------------|-------------|
| Connection Token | `cloud/dashboard/src/lib/ide-store.tsx` | Add token to API client headers |
| RPC over WS | `cloud/dashboard/src/components/ide-terminal/hooks/useWebSocket.ts` | Replace with Promise-based RPC |
| ETag Caching | Dashboard Next.js static serving | Already handled by Next.js, but API file responses could add ETag |
| Graceful Shutdown | `cloud/dashboard/package.json` scripts | Add `prestop` hook for connection drain |

---

## Files Created

```
cloud/mini-ide/lib/
├── ConnectionToken.js       # Token auth (from serverConnectionToken.ts)
├── RpcChannel.js            # Server-side RPC channel (from remoteAgentConnection.ts)
└── serveFile.js             # Secure file server (from webClientServer.ts)

cloud/mini-ide/
├── server-v2.js             # Improved server combining all patterns
└── public/
    └── rpc-client.js        # Browser RPC client with reconnect

docs/architecture/
└── ide-improvements-from-openvscode.md   # This document
```

---

*All patterns are adapted (not copied verbatim) to fit SuperRoo's Express + vanilla JS architecture. The original openvscode-server code is TypeScript with VS Code's internal IPC abstractions; these versions are plain Node.js/JavaScript.*
