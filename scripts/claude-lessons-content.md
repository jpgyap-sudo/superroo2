### Lesson: SKILL.md YAML Frontmatter Must Be Valid — Missing delimiters and unquoted colons cause extension startup errors

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: .roo/skills/commissioning-agent/SKILL.md, .roo/skills/docker-upgrade/SKILL.md, .roo/skills/terminal-brain-upgrade/SKILL.md

#### Task Summary

Three .roo/skills/\*/SKILL.md files had missing or malformed YAML frontmatter, causing the VS Code extension to emit startup errors when loading skills. Fixed by adding proper --- delimiters and quoting description strings containing colons.

#### Files Changed

- .roo/skills/commissioning-agent/SKILL.md — added --- delimiters, quoted description containing colons
- .roo/skills/docker-upgrade/SKILL.md — added missing frontmatter block (name + description)
- .roo/skills/terminal-brain-upgrade/SKILL.md — added missing closing --- delimiter

#### Bug Cause

YAML frontmatter requires --- at both the start and end of the block. Any description string containing : must be wrapped in double quotes or the YAML parser misinterprets it as a key-value pair. Skills with no frontmatter block are loaded without metadata, causing downstream errors in the skill registry.

#### Fix Applied

Added valid ---delimited frontmatter to all three files. Wrapped colon-containing description strings in double quotes.

#### Test Result

pass — extension loads without startup errors

#### Lesson Learned

When creating new .roo/skills/\*/SKILL.md files, always include a valid YAML frontmatter block with name and description fields. Any description containing : must be double-quoted. Missing or unclosed --- blocks crash the extension skill loader at startup.

#### Reusable Rule

Every SKILL.md file MUST have a ---delimited frontmatter block with at least name and description keys. Description values containing : MUST be double-quoted. Validate with a YAML linter before committing.

#### Tags

skills, frontmatter, yaml, vscode-extension, startup-error, roo-skills

---

### Lesson: ripgrep Universal Package — Add @vscode/ripgrep-universal path to getBinPath waterfall

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: src/services/ripgrep/index.ts

#### Task Summary

Modern VS Code versions ship ripgrep via @vscode/ripgrep-universal (platform-specific binary) instead of legacy @vscode/ripgrep. The extension getBinPath() only checked legacy paths, causing ripgrep to fail to resolve on newer installs. Fixed by appending two new path candidates using process.platform-process.arch as the subdirectory.

#### Files Changed

- src/services/ripgrep/index.ts — added node_modules/@vscode/ripgrep-universal/bin/[platform]/ and node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/[platform]/ to waterfall

#### Bug Cause

@vscode/ripgrep-universal stores platform binaries at bin/[platform]-[arch]/rg. The existing waterfall only covered @vscode/ripgrep and vscode-ripgrep layouts.

#### Fix Applied

Derive platform string once: const platform = process.platform + '-' + process.arch, then append both universal paths at the end of the waterfall in getBinPath().

#### Test Result

pass — ripgrep resolves correctly on both legacy and modern VS Code installs

#### Lesson Learned

VS Code extension ripgrep resolution must maintain a waterfall of all known package layouts including @vscode/ripgrep-universal/bin/[platform]-[arch]/. As VS Code evolves its bundled tool packaging, add new variants rather than replacing existing ones — older installs still need legacy paths.

#### Reusable Rule

When resolving VS Code bundled binaries from an extension, maintain an ordered waterfall of all known package paths. Derive the platform subdirectory as process.platform + '-' + process.arch. Never drop legacy paths — a modern install may still have old packages alongside new ones.

#### Tags

ripgrep, vscode-extension, binary-resolution, cross-platform, universal-package, getBinPath

---

### Lesson: Next.js Standalone Build Fails on Windows — Symlinks need Developer Mode or Admin rights

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/dashboard/next.config.js, cloud/dashboard/scripts/build-safe.mjs

#### Task Summary

Next.js output: "standalone" mode creates symlinks inside .next/standalone/node_modules. On Windows, creating symlinks requires Administrator or Developer Mode. The dashboard build failed with EPERM errors on Windows dev machines. Fixed by conditionally disabling standalone output and skipping prepare-standalone.mjs on Windows.

#### Files Changed

- cloud/dashboard/next.config.js — set output to undefined on win32, standalone on other platforms
- cloud/dashboard/scripts/build-safe.mjs — skip prepare-standalone.mjs step when process.platform === "win32"

#### Bug Cause

next build with output: "standalone" calls fs.symlink() to wire node_modules into the standalone directory. Windows fs.symlink() raises EPERM unless the process has SeCreateSymbolicLinkPrivilege (requires Administrator or Developer Mode).

#### Fix Applied

Guard both Next.js config and build script with process.platform === "win32" checks. On Windows, build without standalone mode; on Linux/macOS keep standalone for Docker deployment.

#### Test Result

pass — dashboard builds successfully on Windows without EPERM errors

#### Lesson Learned

Never assume fs.symlink() works on all platforms. On Windows, symlink creation is a privileged operation. Any build script or config using symlinks must gate on process.platform !== "win32" or provide a non-symlink fallback.

#### Reusable Rule

Before using fs.symlink(), ln -s, or any framework feature creating symlinks (e.g. Next.js output: "standalone"), add a process.platform === "win32" guard. On Windows, either skip the step or use file copies. Document that Developer Mode must be enabled for symlink support.

#### Tags

nextjs, standalone, windows, symlink, EPERM, build, cross-platform, dashboard

---

### Lesson: Remove babel-plugin-react-compiler from Vite — Experimental plugin breaks VS Code webview builds

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: webview-ui/vite.config.ts

#### Task Summary

The babel-plugin-react-compiler was included in the Vite build config as a Babel plugin inside @vitejs/plugin-react. It caused build failures and runtime errors in the VS Code webview UI. Removed by replacing the complex react({ babel: { plugins: [...] } }) config with plain react().

#### Files Changed

- webview-ui/vite.config.ts — replaced react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "18" }]] } }) with react()

#### Bug Cause

babel-plugin-react-compiler is an experimental React Labs plugin. In complex VS Code webview apps with hooks, context providers, and extension-state bridges, the compiler's automatic memoization transforms break component identity and cause runtime errors. It also significantly increases build time.

#### Fix Applied

Removed the plugin entirely. Plain react() with Vite uses the standard JSX transform and Fast Refresh without experimental compiler transforms.

#### Test Result

pass — webview UI builds and loads correctly without the plugin

#### Lesson Learned

babel-plugin-react-compiler (React Compiler) is opt-in experimental technology. Do not add it to production builds without thorough testing. For VS Code extension webviews with complex state bridging, the compiler auto-memoization transforms are particularly risky.

#### Reusable Rule

Do not add babel-plugin-react-compiler to production Vite configs for VS Code extension webviews. Use plain react() without Babel plugins. Experimental Babel transforms should live behind a feature flag.

#### Tags

react-compiler, babel, vite, webview, vscode-extension, experimental, build-failure

---

### Lesson: Ollama Local-First with VPS Fallback — Prefer 127.0.0.1 before Tailscale VPS

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: scripts/ollama-mcp.mjs

#### Task Summary

Updated ollama-mcp.mjs to try the local Ollama instance (127.0.0.1:11434) before the VPS (100.64.175.88:11434). Previously the script always targeted the VPS, adding Tailscale network latency and failing silently when not on the Tailscale network.

#### Files Changed

- scripts/ollama-mcp.mjs — added local-first health check: try http://127.0.0.1:11434/api/tags first, fall back to VPS only if local is unreachable

#### Bug Cause

Hardcoded VPS URL added unnecessary Tailscale dependency. When a local Ollama instance runs (common during development), routing through VPS added latency. If the developer was not on Tailscale, all Ollama requests silently failed.

#### Fix Applied

Add health check at startup: GET http://127.0.0.1:11434/api/tags with 2s timeout. If 200, use local Ollama. If timeout/error, fall back to http://100.64.175.88:11434. Log which endpoint is selected.

#### Test Result

pass — local Ollama selected when available, VPS used as fallback

#### Lesson Learned

Service clients supporting multiple endpoints should always prefer the lowest-latency, lowest-dependency endpoint first. For Ollama: local (127.0.0.1) before Tailscale VPS (100.64.175.88). Always log which endpoint was selected so the behavior is transparent.

#### Reusable Rule

When a service can be reached locally or over VPN/Tailscale, implement local-first resolution with a short timeout (1-2s) and remote fallback. Log the selected endpoint. Never hardcode a remote endpoint when a local instance may be available.

#### Tags

ollama, local-first, fallback, tailscale, latency, endpoint-resolution, health-check

---

### Lesson: ClineProvider Webview HTML Debugging — Try/catch and logging for resolveWebviewView

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: src/core/webview/ClineProvider.ts

#### Task Summary

The VS Code webview was occasionally showing a blank panel with no error visible. Added try/catch around HTML generation in resolveWebviewView() and detailed logging at key steps (HTML length, HTML preview, CSP source, scriptUri) to make failures visible in the Output channel.

#### Files Changed

- src/core/webview/ClineProvider.ts — wrapped getHMRHtmlContent/getHtmlContent in try/catch with log on success and on error, added log before HTML generation with scriptUri/stylesUri/cspSource

#### Bug Cause

webviewView.webview.html = await getHtmlContent() was called without error handling. Any exception from HTML generation silently crashed the webview initialization, leaving a blank panel with no error message in the Output channel.

#### Fix Applied

Wrap the HTML generation in try/catch. On success, log HTML length and a 500-char preview. On failure, log the error message and stack trace, then re-throw to propagate the failure. Add a log line before generation with all URI values.

#### Test Result

pass — webview errors now appear in Output channel with actionable context

#### Lesson Learned

VS Code webview initialization failures are silent by default. Any exception during resolveWebviewView that sets webview.html is swallowed and shown as a blank panel. Always wrap HTML generation in try/catch and log both success metrics (length) and failure details (message + stack).

#### Reusable Rule

In VS Code extensions, wrap every webview.html assignment in try/catch with logging. Log: (1) URIs used to build the HTML, (2) HTML length on success, (3) full error + stack on failure. Without this, blank panels are impossible to debug.

#### Tags

vscode-extension, webview, debugging, blank-panel, cline-provider, error-handling, html-generation

---

### Lesson: AGENTS.md Multi-Agent Workflow — Agent-specific workflows supersede MCP, learning layer is always mandatory

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: AGENTS.md

#### Task Summary

Updated AGENTS.md to clarify that agent-specific coding workflows (e.g. Claude Code using its own tools) supersede the default MCP orchestration flow, while the learning layer obligation (wf-004) remains non-negotiable for all agents.

#### Files Changed

- AGENTS.md — added clarification that agent workflows supersede MCP, emphasized shared learning layer is non-negotiable, added explicit wf-rule section

#### Bug Cause

N/A — documentation clarification to avoid over-compliance (agents routing all code through DeepSeek unnecessarily) and under-compliance (agents skipping learning layer sync).

#### Fix Applied

Added section "Agent Workflow Supersedes MCP Workflow" that states: (1) learning layer contribution is non-negotiable, (2) agents may use preferred coding workflows, (3) Central Brain is master source of truth.

#### Test Result

N/A — documentation

#### Lesson Learned

In multi-agent systems, the distinction between mandatory rules (learning layer sync) and flexible rules (which coding agent to use) must be explicit. Without this, agents either over-comply or under-comply.

#### Reusable Rule

In multi-agent architecture docs, explicitly separate mandatory protocol requirements (that every agent MUST follow) from flexible workflow preferences (that agent-specific workflows may override). Learning layer sync is always mandatory; coding tool choice is flexible.

#### Tags

agents, multi-agent, workflow, documentation, learning-layer, mcp, agents-md

---

### Lesson: MermaidBlock Simplification — Remove complex Mermaid renderer, fall back to CodeBlock on upstream breakage

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: webview-ui/src/components/common/MermaidBlock.tsx

#### Task Summary

The MermaidBlock component was a 331-line file with a full Mermaid renderer (mermaid.initialize, styled-components, useDebounceEffect, clipboard, vscode bridge). It caused build errors due to module resolution issues with mermaid v11.4.1 diagram type imports. Simplified to 13 lines that delegate to CodeBlock.

#### Files Changed

- webview-ui/src/components/common/MermaidBlock.tsx — stripped from 331 lines to 13 lines, removed all mermaid/styled-components/clipboard deps, now renders as a code block

#### Bug Cause

Mermaid v11.4.1 changed its module structure. Static imports of individual diagram type paths valid in earlier versions caused module-not-found errors at build time. The complexity of the component (debounced rendering, bridge, clipboard) made it fragile.

#### Fix Applied

Remove all mermaid rendering complexity. Fall back to rendering mermaid diagrams as syntax-highlighted code blocks via CodeBlock. Users see mermaid source code instead of a rendered diagram.

#### Test Result

pass — webview builds without module errors; mermaid content displayed as code

#### Lesson Learned

When a complex renderer causes build failures due to upstream package restructuring, fall back immediately to a simpler representation (code block) to unblock the build. Add the complex renderer back only after the upstream package new module structure is understood.

#### Reusable Rule

When a renderer component causes build failures from upstream breaking changes, immediately fall back to a safe simple representation (code/text display) and log it as a regression. Do not block the build on cosmetic renderer features.

#### Tags

mermaid, webview, build-failure, simplification, fallback, vscode-extension, styled-components

---

### Lesson: Ollama Docker Entrypoint Optimization — env vars for high-memory VPS performance

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: docker/ollama-entrypoint.sh

#### Task Summary

Updated the Ollama Docker entrypoint to export performance env vars for high-memory systems: OLLAMA_NUM_THREADS=16, OLLAMA_MAX_LOADED_MODELS=5, OLLAMA_CONTEXT_LENGTH=65536, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_QUANTIZATION=8bit, OLLAMA_BATCH_SIZE=512, OLLAMA_KEEP_ALIVE=1h. All use shell default-value syntax so they remain overridable.

#### Files Changed

- docker/ollama-entrypoint.sh — added 8 performance env var exports before ollama serve, all using shell default syntax for override support

#### Bug Cause

Default Ollama settings are conservative (low thread count, short context, no flash attention). On a VPS with 16+ cores and large RAM, these defaults waste capacity and result in slower inference.

#### Fix Applied

Export all relevant performance settings before calling ollama serve. Use shell default syntax so any ENV set in docker-compose.yml or at runtime overrides these defaults.

#### Test Result

pass — Ollama on VPS runs with optimized settings

#### Lesson Learned

Ollama performance on server hardware requires explicit configuration. Key settings: OLLAMA_NUM_THREADS (CPU parallelism), OLLAMA_MAX_LOADED_MODELS (concurrent model slots), OLLAMA_CONTEXT_LENGTH (max context window), OLLAMA_FLASH_ATTENTION (memory-efficient attention). Always use shell-default syntax so settings remain override-able without editing the script.

#### Reusable Rule

For Ollama Docker deployments on high-memory servers, set OLLAMA_NUM_THREADS, OLLAMA_MAX_LOADED_MODELS, OLLAMA_CONTEXT_LENGTH, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_QUANTIZATION=8bit, and OLLAMA_KEEP_ALIVE. Use shell-default syntax for all so runtime overrides remain possible.

#### Tags

ollama, docker, performance, entrypoint, env-vars, server-optimization

---

### Lesson: nginx mini-IDE Path Prefix — Strip /tg/ prefix when proxying to mini-IDE

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/nginx-site.conf

#### Task Summary

The mini-IDE was accessed at /tg/ but the nginx proxy was forwarding the full /tg/ prefix to the mini-IDE server, which only expected paths starting from /. Fixed by stripping the /tg/ prefix in the nginx location block.

#### Files Changed

- cloud/nginx-site.conf — changed proxy_pass to strip the /tg prefix so mini-IDE receives paths without the routing prefix

#### Bug Cause

nginx location /tg/ blocks forward the full path including the /tg/ prefix unless you use a trailing slash on proxy_pass or rewrite rules. The mini-IDE server registered routes without the /tg prefix, causing 404s.

#### Fix Applied

Added trailing slash on proxy_pass or rewrite rule to strip the /tg/ prefix before forwarding to the mini-IDE upstream.

#### Test Result

pass — mini-IDE accessible and functional at /tg/ path

#### Lesson Learned

When nginx proxies a location block with a path prefix to a backend that does not expect that prefix, the prefix must be explicitly stripped. Use either proxy_pass http://upstream/ (trailing slash strips the prefix) or a rewrite rule.

#### Reusable Rule

For nginx location /prefix/ { proxy_pass http://backend; } blocks: if the backend does not expect the /prefix/ in the path, always add a trailing slash to proxy_pass or use rewrite. Never forward a routing prefix to a backend not designed to receive it.

#### Tags

nginx, proxy, mini-ide, path-stripping, routing, location-block

---

### Lesson: mini-IDE Terminal — Replace exec with node-pty WebSocket terminal for interactive PTY support

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/mini-ide/server.js, cloud/mini-ide/public/app.js

#### Task Summary

The mini-IDE terminal was implemented using Node.js child_process.exec for running commands. This did not support interactive sessions, PTY behavior, or proper terminal emulation. Replaced with node-pty (pseudo-terminal) wrapped in a WebSocket, with xterm.js on the frontend for rendering.

#### Files Changed

- cloud/mini-ide/server.js — replaced exec terminal with node-pty spawning, added WebSocket endpoint for terminal I/O
- cloud/mini-ide/public/app.js — added xterm.js terminal rendering, connected to WebSocket PTY endpoint
- cloud/mini-ide/package.json — added node-pty dependency
- cloud/mini-ide/public/lib/ — added xterm.js bundle files

#### Bug Cause

exec-based terminals cannot handle interactive programs (vi, python REPL, ssh, etc.) because they lack a PTY. Without a PTY, programs checking isatty() behave differently or refuse to run. The frontend had no proper terminal emulator, showing raw text without ANSI support.

#### Fix Applied

Use node-pty to spawn a real PTY process (bash/sh). WebSocket relays PTY I/O bidirectionally. Frontend uses xterm.js Terminal for ANSI rendering and FitAddon for responsive sizing.

#### Test Result

pass — interactive terminal works in mini-IDE with full ANSI support

#### Lesson Learned

Any web-based terminal that needs to run interactive programs must use a PTY (node-pty on the server) and a proper terminal emulator (xterm.js on the client). exec/spawn without PTY cannot support interactive programs. WebSocket is the natural transport between PTY and browser.

#### Reusable Rule

For web-based terminals: always use node-pty (server) + WebSocket + xterm.js (client). Never use exec or spawn without pty for any terminal that users will interact with directly.

#### Tags

node-pty, xterm, terminal, websocket, mini-ide, interactive, pty, web-terminal

---

### Lesson: Autonomous Loop Status Guard — Guard JSON.parse against HTML error page responses

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/dashboard/src/components/views/autonomous-loop.tsx

#### Task Summary

The autonomous loop dashboard component was calling the status API and calling JSON.parse on the response body without guarding for non-JSON responses (HTML error pages, empty bodies). When the API was down or returned an error page, JSON.parse threw, crashing the component with an unhandled promise rejection.

#### Files Changed

- cloud/dashboard/src/components/views/autonomous-loop.tsx — wrapped status polling in try/catch, added response.ok check before parse, improved error state display

#### Bug Cause

The status endpoint sometimes returns an HTML 502/503 page from nginx when the API process is restarting. JSON.parse on HTML content throws SyntaxError. Without a try/catch around the polling loop, the entire component unmounts on error.

#### Fix Applied

Wrap the fetch+parse in try/catch. Check response.ok before parsing. If parse fails, set an error state rather than crashing. Show a "reconnecting" UI state.

#### Test Result

pass — autonomous loop UI shows reconnecting state instead of crashing when API is down

#### Lesson Learned

API polling components must guard against non-JSON responses. Always: (1) check response.ok before parsing, (2) wrap JSON.parse in try/catch, (3) handle errors with a visible UI state instead of component crash. HTML error pages from nginx are especially common during API restarts.

#### Reusable Rule

All API polling components MUST wrap fetch+JSON.parse in try/catch and check response.ok. Non-JSON responses (nginx error pages, empty bodies) will otherwise crash React components with unhandled rejections. Show a graceful reconnecting state, never an unhandled crash.

#### Tags

autonomous-loop, dashboard, json-parse, error-handling, polling, api, nginx, react

---

### Lesson: Telegram Bot Missing Brace — Silent logical bug from unmatched orchestratorBridge if-block

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/api/telegramBot.js

#### Task Summary

A missing closing brace for the if (orchestratorBridge) block in telegramBot.js caused all code after the block to be treated as inside the if-block, meaning Telegram responses were only sent when orchestratorBridge existed. Fixed by adding the missing closing brace.

#### Files Changed

- cloud/api/telegramBot.js — added missing closing brace for if (orchestratorBridge) block

#### Bug Cause

JavaScript's lack of mandatory block structure means missing braces create silent logical bugs. The if (orchestratorBridge) block was opened but its closing brace was missing, so all subsequent reply logic (sendMessage calls, error handlers) was inside the condition. When orchestratorBridge was null, no response was sent.

#### Fix Applied

Located the missing closing brace by tracing block indentation and added it at the correct position.

#### Test Result

pass — Telegram bot responds correctly regardless of orchestratorBridge presence

#### Lesson Learned

JavaScript if-blocks with mismatched braces silently swallow code into conditions. When debugging "bot does not respond sometimes", always check for brace mismatch in the main handler. Code formatters (Prettier) catch these automatically.

#### Reusable Rule

After any major refactor of a JavaScript handler that adds nested if-blocks, run a brace-matching check or Prettier format to detect mismatched braces. Unmatched braces in JS are silent — the code parses fine but behaves incorrectly.

#### Tags

telegram, javascript, brace-mismatch, bug, telegramBot, silent-failure

---

### Lesson: Telegram Orchestrator submitDirect() — Route all task paths through orchestrator bridge

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/api/telegramBot.js, cloud/api/api.js, cloud/orchestrator/TelegramOrchestratorBridge.js

#### Task Summary

Multiple Telegram task submission paths (feature requests, bug reports, general chat, fallback) were bypassing the orchestrator and going directly to the API. This meant they skipped the orchestrator queue management, rate limiting, and learning layer integration. Fixed by routing all paths through orchestratorBridge.submitDirect().

#### Files Changed

- cloud/api/telegramBot.js — rewired all task submission paths through orchestratorBridge.submitDirect()
- cloud/api/api.js — added submitDirect() endpoint support
- cloud/orchestrator/TelegramOrchestratorBridge.js — added submitDirect() method

#### Bug Cause

New Telegram message handlers were added directly calling the API without going through the bridge. The bridge was only wired for the main coding path. Other paths (analysis, feature, bug report) had direct API calls that bypassed orchestration.

#### Fix Applied

Created submitDirect() in TelegramOrchestratorBridge as a lightweight orchestrator-aware task submission path. Rewired all handler paths through it.

#### Test Result

pass — all Telegram task types flow through orchestrator

#### Lesson Learned

In a multi-path message handler (Telegram bot), all paths must route through the same orchestration layer. Adding a new handler directly to the API bypasses queue management, rate limiting, and observability. Always add new handlers through the existing orchestrator bridge.

#### Reusable Rule

When adding new Telegram message handler paths, ALWAYS route through the orchestratorBridge, never directly to the API. The bridge provides queue management, rate limiting, learning layer hooks, and observability. Direct API calls bypass all of these.

#### Tags

telegram, orchestrator, bridge, task-routing, submitDirect, queue-management

---

### Lesson: DeepSeek Model Name Format — V4 API uses deepseek-v4-flash not deepseek-chat-v4-flash

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: cloud/api/api.js, cloud/providers/deepseek.js

#### Task Summary

The DeepSeek API rejected model name "deepseek-chat-v4-flash" with a 404/model-not-found error. The correct API name is "deepseek-v4-flash" (without the -chat- infix). Fixed by updating all model name references in the providers and API files.

#### Files Changed

- cloud/api/api.js — updated model name references
- cloud/providers/deepseek.js — updated model name constants and fallback logic

#### Bug Cause

DeepSeek changed their model naming convention for V4 models. The old pattern was "deepseek-chat" for chat models; the new V4 pattern drops the "-chat-" infix: "deepseek-v4-flash" and "deepseek-v4-pro". Code hardcoding the old pattern breaks with API errors.

#### Fix Applied

Updated all model name constants to use the new format. Added a normalization function accepting both old and new formats for backwards compatibility.

#### Test Result

pass — DeepSeek API calls succeed with correct model names

#### Lesson Learned

AI provider model names change across versions without notice. Never hardcode model names as raw strings across multiple files — use a single constants file or provider module. When a provider updates their naming scheme, updating one file should fix all references.

#### Reusable Rule

All DeepSeek model names MUST be defined in cloud/providers/deepseek.js as named constants and imported everywhere else. Never hardcode "deepseek-chat-v4-flash" or similar. When DeepSeek changes naming, update one constants file.

#### Tags

deepseek, model-names, api, constants, provider, naming-convention

---

### Lesson: LocalBrain Integration in extension.ts — Instantiate in activate() and inject via constructor

Date: 2026-05-31
Source: Claude Code task completion (branch fix/extension-webview-skills-ripgrep)
Model/API used: claude-sonnet-4-6
Confidence: medium
Related files: src/extension.ts

#### Task Summary

Added LocalBrain instantiation in the extension activate() function and passed it as a parameter to the API constructor. This wires the local (in-process) brain instance into the extension API layer, enabling local memory operations without network calls to the Central Brain VPS.

#### Files Changed

- src/extension.ts — added const localBrainInstance = new LocalBrain() passed to new API constructor

#### Bug Cause

N/A — new feature wiring

#### Fix Applied

Instantiate LocalBrain in activate() after other initializations, pass to API constructor for injection throughout the extension.

#### Test Result

unknown — wiring added, tests needed

#### Lesson Learned

In VS Code extensions, service dependencies should be instantiated in activate() and passed down through constructors (dependency injection) rather than using singletons or module-level globals. This makes the service lifecycle explicit and testable.

#### Reusable Rule

When adding new service instances to a VS Code extension, always instantiate in activate() and inject via constructor into the API layer. Avoid module-level singletons — they make testing and lifecycle management difficult.

#### Tags

vscode-extension, dependency-injection, local-brain, activate, extension-api, service-wiring

---

### Lesson: Learning Layer Multi-Source Sync — All three stores must be updated together after adding lessons

Date: 2026-05-31
Source: Claude Code observation (reading existing SuperRoo learning layer)
Model/API used: claude-sonnet-4-6
Confidence: high
Related files: memory/lessons-learned.md, memory/lesson-index.jsonl, memory/lesson-summaries.json

#### Task Summary

Observed that the SuperRoo learning layer maintains lessons across three parallel stores that each serve different consumers. Adding a lesson only to lessons-learned.md leaves the JSON index and summaries stale, making the lesson invisible to automated search and context-building tools.

#### Files Changed

N/A — observational lesson

#### Bug Cause

The three stores serve different purposes: lessons-learned.md is the human-readable markdown source; lesson-index.jsonl is the structured index consumed by getLessonRetriever() and build-agent-context.mjs; lesson-summaries.json stores AI-generated summaries with embedding metadata.

#### Fix Applied

N/A — lesson documents the required sync procedure

#### Test Result

N/A — observational

#### Lesson Learned

After adding any lesson, all three stores must be updated: (1) append to memory/lessons-learned.md, (2) append to memory/lesson-index.jsonl with id, title, type, date, source, model, confidence, files, tags, relevance_score, rule_summary, lesson_summary, (3) run node scripts/ollama-summarize-lesson.mjs to regenerate lesson-summaries.json.

#### Reusable Rule

After appending any lesson to lessons-learned.md, ALWAYS also append a corresponding entry to lesson-index.jsonl with a unique lesson-NNN ID, then run node scripts/ollama-summarize-lesson.mjs to sync lesson-summaries.json. The three stores are not auto-synced.

#### Tags

learning-layer, lessons, lesson-index, lesson-summaries, sync, multi-store, knowledge-management

---
