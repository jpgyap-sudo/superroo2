/**
 * Seeds Claude's central brain with initial knowledge from the current session.
 * Run once: node scripts/seed-claude-brain.mjs
 */
import { writeFileSync, existsSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const BRAIN_DIR = path.join(ROOT, "memory/claude-brain")
const KNOWLEDGE_FILE = path.join(BRAIN_DIR, "knowledge.jsonl")
const INDEX_FILE = path.join(BRAIN_DIR, "brain-index.json")

if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true })
if (existsSync(KNOWLEDGE_FILE)) {
  console.log("Brain already seeded. Use claude-brain.mjs add to add more entries.")
  process.exit(0)
}

const entries = [
  {
    id: "cb-001", type: "observation", confidence: "high", date: "2026-05-31",
    title: "SuperRoo uses three parallel learning layer stores",
    content: "The SuperRoo learning layer maintains three synchronized stores: (1) memory/lessons-learned.md — human-readable markdown, (2) memory/lesson-index.jsonl — structured JSON index for getLessonRetriever(), (3) memory/lesson-summaries.json — AI summaries with embedding metadata. All three must be updated together.",
    context: "memory/lessons-learned.md, memory/lesson-index.jsonl, memory/lesson-summaries.json",
    tags: ["learning-layer", "architecture", "knowledge-management"],
    relatedFiles: ["memory/lessons-learned.md", "memory/lesson-index.jsonl", "memory/lesson-summaries.json"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-002", type: "fix", confidence: "high", date: "2026-05-31",
    title: "SKILL.md YAML frontmatter: always use --- delimiters and quote colons",
    content: "Three .roo/skills/*/SKILL.md files had missing --- delimiters or unquoted colons in description values. YAML treats unquoted colons as key-value pairs, breaking the frontmatter. Fix: add --- at top and bottom, wrap any description with : in double quotes.",
    context: ".roo/skills/*/SKILL.md, extension skill loader",
    tags: ["yaml", "skills", "vscode-extension", "frontmatter", "startup"],
    relatedFiles: [".roo/skills/commissioning-agent/SKILL.md", ".roo/skills/docker-upgrade/SKILL.md", ".roo/skills/terminal-brain-upgrade/SKILL.md"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-003", type: "fix", confidence: "high", date: "2026-05-31",
    title: "ripgrep resolution: add @vscode/ripgrep-universal/bin/[platform]-[arch]/ to getBinPath",
    content: "Modern VS Code ships ripgrep via @vscode/ripgrep-universal with platform-specific subdirectory (e.g. win32-x64/rg.exe). The extension's getBinPath() waterfall must include this path. Derive platform as process.platform + '-' + process.arch and append to the waterfall in src/services/ripgrep/index.ts.",
    context: "src/services/ripgrep/index.ts, VS Code ripgrep resolution",
    tags: ["ripgrep", "vscode-extension", "binary-resolution", "cross-platform"],
    relatedFiles: ["src/services/ripgrep/index.ts"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-004", type: "fix", confidence: "high", date: "2026-05-31",
    title: "Next.js standalone output: gate on process.platform !== win32 for symlinks",
    content: "Next.js output:standalone creates symlinks in .next/standalone/node_modules. On Windows, fs.symlink() throws EPERM unless the process has SeCreateSymbolicLinkPrivilege. Fix: check process.platform === 'win32' in next.config.js and build-safe.mjs to skip standalone mode on Windows.",
    context: "cloud/dashboard/next.config.js, cloud/dashboard/scripts/build-safe.mjs",
    tags: ["nextjs", "windows", "symlink", "EPERM", "build", "standalone"],
    relatedFiles: ["cloud/dashboard/next.config.js", "cloud/dashboard/scripts/build-safe.mjs"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-005", type: "fix", confidence: "high", date: "2026-05-31",
    title: "Remove babel-plugin-react-compiler — breaks VS Code webview builds",
    content: "babel-plugin-react-compiler is experimental. In complex VS Code webview apps with extension-state bridges, its auto-memoization transforms break component identity. Remove from webview-ui/vite.config.ts: replace react({ babel: { plugins: [...compiler...] } }) with plain react().",
    context: "webview-ui/vite.config.ts",
    tags: ["react-compiler", "babel", "vite", "webview", "experimental", "build"],
    relatedFiles: ["webview-ui/vite.config.ts"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-006", type: "pattern", confidence: "high", date: "2026-05-31",
    title: "Ollama: always try local 127.0.0.1:11434 before VPS 100.64.175.88:11434",
    content: "Any script using Ollama should implement local-first resolution: GET http://127.0.0.1:11434/api/tags with 1-2s timeout first, fall back to VPS (100.64.175.88:11434) if local unavailable. Log which endpoint was selected. Hardcoding the VPS URL adds unnecessary Tailscale dependency.",
    context: "scripts/ollama-mcp.mjs, any Ollama client",
    tags: ["ollama", "local-first", "tailscale", "endpoint-resolution", "pattern"],
    relatedFiles: ["scripts/ollama-mcp.mjs"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-007", type: "lesson", confidence: "high", date: "2026-05-31",
    title: "VS Code webview blank panel: wrap HTML generation in try/catch with logging",
    content: "VS Code webview failures are silent by default — an exception in resolveWebviewView shows only a blank panel. Fix: wrap getHtmlContent()/getHMRHtmlContent() calls in try/catch. On success log HTML length. On failure log error.message + stack. Also log scriptUri/stylesUri/cspSource before generation.",
    context: "src/core/webview/ClineProvider.ts, VS Code webview lifecycle",
    tags: ["vscode-extension", "webview", "debugging", "blank-panel", "error-handling"],
    relatedFiles: ["src/core/webview/ClineProvider.ts"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-008", type: "fix", confidence: "high", date: "2026-05-31",
    title: "MermaidBlock: fall back to CodeBlock when mermaid module breaks on version update",
    content: "Mermaid v11.4.1 restructured its module paths. The 331-line MermaidBlock component broke with module-not-found errors. Simplified to 13 lines delegating to CodeBlock. This unblocks the build. The complex renderer can be restored after the upstream module structure is understood.",
    context: "webview-ui/src/components/common/MermaidBlock.tsx",
    tags: ["mermaid", "webview", "build", "fallback", "simplification"],
    relatedFiles: ["webview-ui/src/components/common/MermaidBlock.tsx"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-009", type: "fix", confidence: "high", date: "2026-05-31",
    title: "DeepSeek V4 model names: deepseek-v4-flash (no -chat- infix)",
    content: "DeepSeek V4 dropped the -chat- infix. Old: deepseek-chat-v4-flash, deepseek-chat-v4-pro. New: deepseek-v4-flash, deepseek-v4-pro. API returns 404 for old names. All model names must be defined as named constants in cloud/providers/deepseek.js and imported everywhere else.",
    context: "cloud/providers/deepseek.js, cloud/api/api.js",
    tags: ["deepseek", "model-names", "api", "constants", "provider"],
    relatedFiles: ["cloud/providers/deepseek.js", "cloud/api/api.js"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-010", type: "fix", confidence: "high", date: "2026-05-31",
    title: "Telegram bot: missing brace in if(orchestratorBridge) swallows all reply logic",
    content: "A missing closing brace for if(orchestratorBridge) in telegramBot.js caused all Telegram reply logic (sendMessage, error handlers) to be inside that condition. When orchestratorBridge was null, bot sent no responses. Fix: always run Prettier after large refactors to catch brace mismatches.",
    context: "cloud/api/telegramBot.js",
    tags: ["telegram", "javascript", "brace-mismatch", "silent-failure", "debugging"],
    relatedFiles: ["cloud/api/telegramBot.js"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-011", type: "pattern", confidence: "high", date: "2026-05-31",
    title: "Telegram routing: all handler paths must go through orchestratorBridge.submitDirect()",
    content: "The Telegram bot has multiple intent paths (code, feature, bug, chat, fallback). All must route through TelegramOrchestratorBridge.submitDirect() for queue management, rate limiting, and learning layer hooks. Direct API calls bypass all of these. submitDirect() is the single entry point for all task types.",
    context: "cloud/api/telegramBot.js, cloud/orchestrator/TelegramOrchestratorBridge.js",
    tags: ["telegram", "orchestrator", "routing", "architecture", "pattern"],
    relatedFiles: ["cloud/api/telegramBot.js", "cloud/orchestrator/TelegramOrchestratorBridge.js"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-012", type: "lesson", confidence: "high", date: "2026-05-31",
    title: "node-pty + xterm.js: only correct approach for web-based interactive terminals",
    content: "exec/spawn without PTY cannot handle interactive programs (vi, python REPL, ssh). Web terminals need: (1) node-pty on the server for a real PTY process, (2) WebSocket for bidirectional I/O, (3) xterm.js on the frontend for ANSI rendering + FitAddon for resize. All three are required.",
    context: "cloud/mini-ide/server.js, cloud/mini-ide/public/app.js",
    tags: ["node-pty", "xterm", "terminal", "websocket", "pty", "interactive"],
    relatedFiles: ["cloud/mini-ide/server.js", "cloud/mini-ide/public/app.js"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-013", type: "rule", confidence: "high", date: "2026-05-31",
    title: "API polling: always check response.ok and wrap JSON.parse in try/catch",
    content: "API polling components crash when the endpoint returns an HTML error page (nginx 502/503 during restarts). Required pattern: (1) check response.ok before parsing, (2) wrap JSON.parse in try/catch, (3) show 'reconnecting' UI state on failure, never an unhandled crash.",
    context: "cloud/dashboard/src/components/views/autonomous-loop.tsx, any polling component",
    tags: ["api-polling", "json-parse", "error-handling", "react", "nginx", "rule"],
    relatedFiles: ["cloud/dashboard/src/components/views/autonomous-loop.tsx"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-014", type: "observation", confidence: "high", date: "2026-05-31",
    title: "HermesClaw already integrates with askAI for context-enriched answers",
    content: "The askAI() function in telegramBot.js (line 2749-2765) already calls orchestrator.hermesClaw.recallContext() to inject relevant past experiences into the system prompt before calling the AI. The /ask command uses this. The new /hermes ask subcommand extends this with Claude-API-specific routing.",
    context: "cloud/api/telegramBot.js askAI function",
    tags: ["hermes", "askAI", "rag", "telegram", "architecture"],
    relatedFiles: ["cloud/api/telegramBot.js"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-015", type: "decision", confidence: "high", date: "2026-05-31",
    title: "AGENTS.md: agent-specific workflows supersede MCP, but learning layer is mandatory",
    content: "Clarification added to AGENTS.md: agents may use their preferred coding workflows (Claude Code using its own tools, DeepSeek using MCP, etc.) but MUST contribute to the shared learning layer (wf-004). The Central Brain is the master source of truth. MCP orchestration is the default, not a hard requirement.",
    context: "AGENTS.md, multi-agent architecture",
    tags: ["agents", "multi-agent", "workflow", "learning-layer", "architecture", "decision"],
    relatedFiles: ["AGENTS.md"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-016", type: "lesson", confidence: "high", date: "2026-05-31",
    title: "Ollama Docker: explicit perf env vars make VPS inference dramatically faster",
    content: "Ollama defaults are conservative. On a 16+ core VPS with large RAM, set: OLLAMA_NUM_THREADS=16, OLLAMA_MAX_LOADED_MODELS=5, OLLAMA_CONTEXT_LENGTH=65536, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_QUANTIZATION=8bit, OLLAMA_BATCH_SIZE=512, OLLAMA_KEEP_ALIVE=1h. Use shell-default syntax so docker-compose can override.",
    context: "docker/ollama-entrypoint.sh",
    tags: ["ollama", "docker", "performance", "vps", "env-vars"],
    relatedFiles: ["docker/ollama-entrypoint.sh"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  },
  {
    id: "cb-017", type: "rule", confidence: "high", date: "2026-05-31",
    title: "nginx proxy: trailing slash on proxy_pass strips the location prefix",
    content: "nginx location /prefix/ { proxy_pass http://backend; } forwards the full path including /prefix/. To strip the prefix so the backend sees paths without /prefix/, use a trailing slash: proxy_pass http://backend/. This is required for mini-IDE (/tg/ prefix) and any backend that doesn't expect the routing prefix.",
    context: "cloud/nginx-site.conf",
    tags: ["nginx", "proxy", "path-stripping", "routing", "rule"],
    relatedFiles: ["cloud/nginx-site.conf"],
    source: "claude-sonnet-4-6 session 2026-05-31"
  }
]

// Write all entries
writeFileSync(KNOWLEDGE_FILE, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8")

// Build index
const idx = { byTag: {}, byType: {}, byContext: {}, count: entries.length, lastUpdated: new Date().toISOString() }
for (const e of entries) {
  for (const tag of (e.tags || [])) {
    if (!idx.byTag[tag]) idx.byTag[tag] = []
    idx.byTag[tag].push(e.id)
  }
  if (!idx.byType[e.type]) idx.byType[e.type] = []
  idx.byType[e.type].push(e.id)
}
writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), "utf8")

console.log("✅ Claude's central brain seeded with " + entries.length + " initial entries")
console.log("   Location: memory/claude-brain/")
console.log("   Query: node scripts/claude-brain.mjs search --q ripgrep")
console.log("   Recent: node scripts/claude-brain.mjs recent --n 10")
console.log("   Index: node scripts/claude-brain.mjs index")
