# SuperRoo Central Brain MCP Server Setup

## Overview

Connect to the SuperRoo Central Brain via MCP (Model Context Protocol) to access:
- Project memory (features, bugs, tasks, deployments)
- Code search with RAG
- Active task tracking
- Real-time project insights

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client (You)                         │
│                  Claude Code / Codex / Roo                  │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol (stdio or HTTP)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP Memory Server (port 3419)                  │
│         server/src/memory/McpMemoryServer.ts                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP Proxy
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           Central Brain Daemon (port 3417)                  │
│              /brain/mcp endpoint                            │
│        src/super-roo-daemon/brain-routes.ts                 │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Memory    │  │   Task      │  │   RAG       │
│   Store     │  │   Queue     │  │   Pipeline  │
└─────────────┘  └─────────────┘  └─────────────┘
```

## Prerequisites

- Node.js v20.19.2 (see `.nvmrc`)
- pnpm (package manager)
- TypeScript (`tsx` for running TypeScript directly)

## Installation

### 1. Install Node.js

Using nvm-windows:
```powershell
nvm install 20.19.2
nvm use 20.19.2
```

Or download from [nodejs.org](https://nodejs.org/)

### 2. Install Dependencies

```bash
# From project root
pnpm install

# Install tsx globally (or use npx)
npm install -g tsx
```

## Starting the Servers

### Option 1: Manual Start

**Terminal 1 - Start Central Brain Daemon:**
```bash
cd src
pnpm run daemon
# or: npx tsx super-roo-daemon/index.ts
```

The daemon will start on `http://127.0.0.1:3417`

**Terminal 2 - Start MCP Memory Server:**
```bash
npx tsx server/src/memory/McpMemoryServer.ts
```

The MCP server will start on `http://127.0.0.1:3419`

### Option 2: Docker Compose (Recommended)

```bash
# Start all services (PostgreSQL, Ollama, Daemon)
docker compose up -d

# View logs
docker compose logs -f daemon
```

### Option 3: Using VS Code Extension

The SuperRoo VS Code extension can start the daemon automatically when activated.

## MCP Client Configuration

### For Claude Code

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "superroo-brain": {
      "command": "npx",
      "args": ["tsx", "server/src/memory/McpMemoryServer.ts"],
      "env": {
        "CENTRAL_BRAIN_URL": "http://127.0.0.1:3417",
        "SUPERROO_DAEMON_TOKEN": ""
      }
    }
  }
}
```

### For Roo Code (VS Code Extension)

The configuration is already in `.roo/mcp.json`. Enable MCP in the Roo Code settings:

1. Open Roo Code sidebar
2. Click Settings (gear icon)
3. Enable "MCP Servers"
4. The server will auto-connect using `.roo/mcp.json`

### For Cursor

Add to Cursor's MCP config:

```json
{
  "mcpServers": {
    "superroo-brain": {
      "command": "npx",
      "args": ["tsx", "C:/Users/User/superroo/superroo2/server/src/memory/McpMemoryServer.ts"],
      "env": {
        "CENTRAL_BRAIN_URL": "http://127.0.0.1:3417"
      }
    }
  }
}
```

## Available MCP Tools

### `query_memory`

Search project memory for features, bugs, tasks, and deployments.

**Parameters:**
- `query` (string): Search query
- `project` (string, optional): Project ID (e.g., "superroo2", "productgenerator")
- `maxResults` (number, optional): Maximum results to return

**Example:**
```json
{
  "query": "authentication bug",
  "project": "superroo2",
  "maxResults": 10
}
```

### `get_project_info`

Get project namespace details including feature/bug counts.

**Parameters:**
- `project` (string): Project ID

### `list_projects`

List all registered projects.

**Parameters:** None

### `get_active_task`

Get the currently active task for a project.

**Parameters:**
- `project` (string): Project ID

### `get_recent_bugs`

Get recent bugs for a project.

**Parameters:**
- `project` (string): Project ID
- `limit` (number, optional): Number of bugs to return

### `search_code`

Search indexed code using RAG.

**Parameters:**
- `query` (string): Search query
- `project` (string, optional): Project ID
- `file_pattern` (string, optional): File pattern filter (e.g., "*.ts")

## MCP Resources

Access these resources via the MCP protocol:

- `memory://{project}/context` — Full RAG context for a project
- `memory://{project}/tasks` — Task list for a project
- `memory://{project}/bugs` — Bug list for a project

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CENTRAL_BRAIN_URL` | `http://127.0.0.1:3100` | URL of the Central Brain daemon |
| `MCP_SERVER_PORT` | `3419` | Port for MCP server |
| `MCP_SERVER_HOST` | `127.0.0.1` | Host for MCP server |
| `SUPERROO_DAEMON_PORT` | `3417` | Port for Central Brain daemon |
| `SUPERROO_DAEMON_TOKEN` | - | Authentication token (optional) |
| `SUPERROO_DAEMON_HOST` | `127.0.0.1` | Host for Central Brain daemon |

## Testing the Connection

```bash
# Test MCP server health
curl http://127.0.0.1:3419/health

# Test Central Brain daemon
curl http://127.0.0.1:3417/health

# Test MCP endpoint (requires daemon token if set)
curl -X POST http://127.0.0.1:3417/brain/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list"}'
```

## Troubleshooting

### "Cannot find module 'tsx'"

```bash
npm install -g tsx
# or
pnpm add -g tsx
```

### "ECONNREFUSED 127.0.0.1:3417"

The Central Brain daemon is not running. Start it first:
```bash
cd src && pnpm run daemon
```

### "MCP server not responding"

1. Check if MCP server is running: `curl http://127.0.0.1:3419/health`
2. Check if daemon is running: `curl http://127.0.0.1:3417/health`
3. Verify environment variables are set correctly

### Authentication Errors

If `SUPERROO_DAEMON_TOKEN` is set, include it in requests:
```bash
curl -H "Authorization: Bearer your-token" ...
```

## File Locations

| Component | File Path |
|-----------|-----------|
| MCP Server | `server/src/memory/McpMemoryServer.ts` |
| Central Brain Daemon | `src/super-roo-daemon/index.ts` |
| Brain Routes (MCP endpoint) | `src/super-roo-daemon/brain-routes.ts` |
| MCP Config for Roo | `.roo/mcp.json` |
| MCP Config (generic) | `mcp-superroo-config.json` |

## Support

- Working Tree: `docs/resources/working-tree.md`
- Deployment Guide: `docs/super-roo/DEPLOYMENT_GUIDE.md`
- Troubleshooting: `docs/super-roo/TROUBLESHOOTING.md`
