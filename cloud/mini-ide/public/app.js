/**
 * SuperRoo Telegram Mini IDE — Frontend App
 *
 * Features:
 * - Workspace picker with search
 * - Monaco code editor
 * - File list sidebar
 * - File upload (images, PDFs, text, Word, MD, etc.)
 * - Drag & drop file upload
 * - AI coding command panel
 * - Live logs panel
 * - Quick actions
 * - Telegram WebApp integration
 * - Terminal Brain Layer: context, planning, safe execution, error analysis, memory
 */

// ── State ──────────────────────────────────────────────────────────────────────

const state = {
 workspaces: [],
 active: null,
 files: [],
 selectedFile: "",
 code: "",
 logs: [],
 prompt: "",
 attachments: [],
 editor: null,
 telegramUser: null,
 tasks: [],
 // Terminal Brain state
 brain: {
 	activeTab: "command",
 	plan: null,
 	feedback: null,
 	errors: [],
 	fixes: [],
 	memory: null,
 	deployments: [],
 	services: [],
 	env: null,
 	approvals: [],
 	loading: false,
 },
}

// ── API Client ─────────────────────────────────────────────────────────────────

const API_BASE = "/tg/api"

function getTelegramInitData() {
	if (window.Telegram?.WebApp?.initData) {
		return window.Telegram.WebApp.initData
	}
	// Fallback: try URL params
	const params = new URLSearchParams(window.location.search)
	return params.get("initData") || params.get("tgWebAppData") || ""
}

async function apiRequest(path, options = {}) {
	const initData = getTelegramInitData()
	const headers = {
		"Content-Type": "application/json",
		"X-Telegram-Init-Data": initData,
		...(options.headers || {}),
	}

	// If no Telegram initData (browser access), try dashboard auth token
	if (!initData) {
		const dashboardToken = localStorage.getItem("superroo_auth_token")
		if (dashboardToken) {
			headers["Authorization"] = `Bearer ${dashboardToken}`
		}
	}

	// Don't set Content-Type for FormData
	if (options.body instanceof FormData) {
		delete headers["Content-Type"]
	}

	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers,
	})

	if (!res.ok) {
		const text = await res.text()
		throw new Error(text || `Request failed: ${res.status}`)
	}

	return res.json()
}

// ── Terminal Brain API ─────────────────────────────────────────────────────────
//
// These functions call the Terminal Brain Layer endpoints mounted at
// /api/terminal-brain/ on the Mini IDE server. The brain provides:
//   - Project context loading (repo-scanner)
//   - NL command planning (planner)
//   - Safe command execution (safety-guard + command-runner)
//   - Error analysis (log-parser)
//   - Terminal memory (terminal-core/memory)
//   - Fix suggestions (error-to-agent handoff)

async function brainRequest(action, payload = {}) {
	return apiRequest(`/terminal-brain/${action}`, {
		method: action === "context" || action === "memory" || action === "stats" ? "GET" : "POST",
		body: action === "context" || action === "memory" || action === "stats" ? undefined : JSON.stringify(payload),
	})
}

// ── Tab Switching ──────────────────────────────────────────────────────────────

function switchBrainTab(tabId) {
	state.brain.activeTab = tabId

	// Update tab buttons
	document.querySelectorAll(".brain-tab").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.tab === tabId)
	})

	// Show/hide panels
	document.querySelectorAll(".brain-panel").forEach((panel) => {
		panel.classList.toggle("hidden", panel.id !== `panel-${tabId}`)
	})

	// Load data on tab switch
	switch (tabId) {
		case "memory":
			loadBrainMemory()
			break
		case "errors":
			renderBrainErrors()
			break
		case "fixplan":
			renderBrainFixes()
			break
		case "deployments":
			renderBrainDeployments()
			break
		case "services":
			loadBrainServices()
			break
		case "env":
			loadBrainEnv()
			break
		case "approvals":
			renderBrainApprovals()
			break
	}
}

// ── Send Brain Command ─────────────────────────────────────────────────────────
//
// The main entry point: NL → Plan → Execute → Analyze → Fix → Verify

async function sendBrainCommand() {
	const prompt = document.getElementById("ai-prompt").value.trim()
	if (!prompt || !state.active) {
		showNotice("❌ Select a workspace and enter a command.", true)
		return
	}

	state.brain.loading = true
	showNotice("🧠 Terminal Brain is processing...")

	try {
		// Step 1: Plan — convert NL to command sequence
		const planResult = await brainRequest("plan", { query: prompt })
		const plan = planResult.plan || planResult.commands || []
		state.brain.plan = plan
		renderBrainPlan(plan)

		// Step 2: Execute each planned command
		const allOutput = []
		const allErrors = []
		const allFixes = []

		const commands = Array.isArray(plan) ? plan : [plan]
		for (let i = 0; i < commands.length; i++) {
			const cmd = typeof commands[i] === "string" ? commands[i] : commands[i].command || commands[i]

			const execResult = await brainRequest("execute", { command: cmd })
			const feedback = execResult.feedback || execResult

			allOutput.push(feedback.output || "")

			// Collect errors
			if (feedback.errors && feedback.errors.length > 0) {
				allErrors.push(...feedback.errors)
			}

			// Collect fixes
			if (feedback.fixes && feedback.fixes.length > 0) {
				allFixes.push(...feedback.fixes)
			}

			// Add to live logs
			state.logs.unshift({
				type: feedback.status === "success" ? "ok" : feedback.status === "needs_approval" ? "warn" : "error",
				text: `[Brain] ${cmd.substring(0, 60)} → ${feedback.status}`,
				time: new Date().toLocaleTimeString(),
			})
			renderLogs()
		}

		// Step 3: Analyze output for errors
		if (allOutput.length > 0) {
			const analyzeResult = await brainRequest("analyze", { output: allOutput.join("\n") })
			if (analyzeResult.errors) {
				allErrors.push(...analyzeResult.errors)
			}
		}

		// Step 4: Get fix suggestions
		if (allErrors.length > 0) {
			const fixResult = await brainRequest("fix", { output: allOutput.join("\n") })
			if (fixResult.fixes) {
				allFixes.push(...fixResult.fixes)
			}
		}

		// Update state
		state.brain.errors = allErrors
		state.brain.fixes = allFixes

		// Render feedback
		const lastFeedback = {
			plan: prompt,
			command: commands.join(" && "),
			exitCode: 0,
			output: allOutput.join("\n\n"),
			errors: allErrors,
			fixes: allFixes,
			verification: allErrors.length === 0 ? "All commands completed successfully." : "Errors detected — see Fix Plan tab.",
			status: allErrors.length === 0 ? "success" : "failed",
		}
		state.brain.feedback = lastFeedback
		renderBrainFeedback(lastFeedback)

		// Update error count badge
		document.getElementById("error-count").textContent = allErrors.length

		// Auto-switch to errors tab if there are errors
		if (allErrors.length > 0) {
			switchBrainTab("errors")
		}

		showNotice(allErrors.length === 0 ? "✅ Brain execution complete." : "⚠️ Brain found errors — check Fix Plan tab.")
	} catch (err) {
		showNotice(`❌ Brain error: ${err.message}`, true)
	} finally {
		state.brain.loading = false
	}
}

// ── Render Brain Plan ──────────────────────────────────────────────────────────

function renderBrainPlan(plan) {
	const container = document.getElementById("plan-preview")
	const steps = document.getElementById("plan-steps")

	if (!plan || (Array.isArray(plan) && plan.length === 0)) {
		container.classList.add("hidden")
		return
	}

	container.classList.remove("hidden")

	const items = Array.isArray(plan) ? plan : [plan]
	steps.innerHTML = items
		.map((item, i) => {
			const cmd = typeof item === "string" ? item : item.command || item.action || ""
			const desc = typeof item === "string" ? "" : item.description || item.reason || ""
			return `
	       <div class="plan-step">
	         <span class="step-num">${i + 1}</span>
	         <div style="flex:1;min-width:0">
	           <div class="step-cmd">${escapeHtml(cmd)}</div>
	           ${desc ? `<div class="step-desc">${escapeHtml(desc)}</div>` : ""}
	         </div>
	       </div>
	     `
		})
		.join("")
}

// ── Render Brain Feedback ──────────────────────────────────────────────────────

function renderBrainFeedback(feedback) {
	const container = document.getElementById("brain-feedback")
	const statusEl = document.getElementById("feedback-status")
	const outputEl = document.getElementById("feedback-output")

	if (!feedback) {
		container.classList.add("hidden")
		return
	}

	container.classList.remove("hidden")

	statusEl.textContent = feedback.status || "unknown"
	statusEl.className = `pill ${feedback.status === "success" ? "green" : feedback.status === "failed" ? "red" : "yellow"}`

	// Render output with color-coded lines
	const lines = (feedback.output || "").split("\n")
	outputEl.innerHTML = lines
		.map((line) => {
			const cls = line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")
				? "error-line"
				: line.toLowerCase().includes("warn") || line.toLowerCase().includes("warning")
					? "warn-line"
					: line.toLowerCase().includes("success") || line.toLowerCase().includes("complete")
						? "ok-line"
						: ""
			return `<div class="${cls}">${escapeHtml(line)}</div>`
		})
		.join("")

	// Show verification
	if (feedback.verification) {
		outputEl.innerHTML += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);color:var(--text-secondary)">${escapeHtml(feedback.verification)}</div>`
	}
}

// ── Render Brain Errors ────────────────────────────────────────────────────────

function renderBrainErrors() {
	const container = document.getElementById("errors-container")
	const errors = state.brain.errors

	if (!errors || errors.length === 0) {
		container.innerHTML = '<p class="muted">No errors detected. Run a command to analyze output.</p>'
		return
	}

	container.innerHTML = errors
		.map(
			(err) => `
	     <div class="error-item">
	       <div class="error-type">${err.type || "unknown"}</div>
	       <div class="error-msg">${escapeHtml(err.message || err.error || "")}</div>
	       ${err.confidence ? `<div class="error-confidence">Confidence: ${Math.round(err.confidence * 100)}%</div>` : ""}
	       ${err.fix ? `<div class="error-fix">💡 ${escapeHtml(err.fix)}</div>` : ""}
	       ${err.rootCause ? `<div class="error-fix" style="background:var(--blue-bg);border-color:rgba(59,130,246,0.2);color:var(--blue);margin-top:2px">🔍 Root cause: ${escapeHtml(err.rootCause)}</div>` : ""}
	     </div>
	   `,
		)
		.join("")
}

// ── Render Brain Fixes ─────────────────────────────────────────────────────────

function renderBrainFixes() {
	const container = document.getElementById("fixes-container")
	const fixes = state.brain.fixes

	if (!fixes || fixes.length === 0) {
		container.innerHTML = '<p class="muted">No fixes suggested yet.</p>'
		return
	}

	container.innerHTML = fixes
		.map(
			(fix) => `
	     <div class="fix-item">
	       <div class="fix-title">${escapeHtml(fix.title || fix.type || "Suggested Fix")}</div>
	       <div class="fix-desc">${escapeHtml(fix.description || fix.fix || fix.message || "")}</div>
	     </div>
	   `,
		)
		.join("")
}

// ── Load Brain Memory ──────────────────────────────────────────────────────────

async function loadBrainMemory() {
	const container = document.getElementById("memory-container")
	const statsEl = document.getElementById("memory-stats")

	try {
		const result = await brainRequest("memory")
		const memory = result.memory || result

		state.brain.memory = memory
		statsEl.textContent = memory.stats ? `${memory.stats.totalCommands || 0} cmds` : "0"

		let html = ""

		// Stats section
		if (memory.stats) {
			const s = memory.stats
			html += `
	       <div style="margin-bottom:8px">
	         <div class="memory-stat-row"><span class="stat-label">Sessions</span><span class="stat-value">${s.totalSessions || 0}</span></div>
	         <div class="memory-stat-row"><span class="stat-label">Commands</span><span class="stat-value">${s.totalCommands || 0}</span></div>
	         <div class="memory-stat-row"><span class="stat-label">Errors</span><span class="stat-value">${s.totalErrors || 0}</span></div>
	         <div class="memory-stat-row"><span class="stat-label">Fixes Applied</span><span class="stat-value">${s.totalFixes || 0}</span></div>
	         <div class="memory-stat-row"><span class="stat-label">Deployments</span><span class="stat-value">${s.totalDeployments || 0}</span></div>
	         <div class="memory-stat-row"><span class="stat-label">Success Rate</span><span class="stat-value">${s.successRate ? Math.round(s.successRate * 100) + "%" : "N/A"}</span></div>
	       </div>
	     `
		}

		// Recent commands
		const commands = memory.commands || memory.recentCommands || []
		if (commands.length > 0) {
			html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Recent Commands:</div>'
			html += commands
				.slice(0, 10)
				.map(
					(cmd) => `
	         <div class="memory-record">
	           <div class="record-cmd">${escapeHtml(cmd.command || cmd)}</div>
	           <div class="record-time">${cmd.timestamp || cmd.time || ""} · ${cmd.status || ""}</div>
	         </div>
	       `,
				)
				.join("")
		}

		container.innerHTML = html || '<p class="muted">No memory data yet.</p>'
	} catch (err) {
		container.innerHTML = `<p class="muted">Failed to load memory: ${escapeHtml(err.message)}</p>`
	}
}

// ── Render Brain Deployments ───────────────────────────────────────────────────

function renderBrainDeployments() {
	const container = document.getElementById("deployments-container")
	const deploys = state.brain.deployments

	if (!deploys || deploys.length === 0) {
		container.innerHTML = '<p class="muted">No deployments recorded.</p>'
		return
	}

	container.innerHTML = deploys
		.map(
			(d) => `
	     <div class="deploy-item">
	       <div>
	         <span class="deploy-version">${escapeHtml(d.version || d.id || "v1.0")}</span>
	         <span class="deploy-status ${d.status === "healthy" ? "healthy" : "failed"}">${d.status || "unknown"}</span>
	       </div>
	       <div class="deploy-time">${d.timestamp || d.time || ""}${d.agent ? ` · by ${d.agent}` : ""}</div>
	     </div>
	   `,
		)
		.join("")
}

// ── Load Brain Services ────────────────────────────────────────────────────────

async function loadBrainServices() {
	const container = document.getElementById("services-container")

	try {
		// Try to get Docker/process info via the brain
		const result = await brainRequest("execute", { command: "docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null || echo 'Docker not available'" })
		const output = result.feedback?.output || result.output || ""

		if (output && !output.includes("Docker not available")) {
			const lines = output.trim().split("\n")
			container.innerHTML = lines
				.map((line) => {
					const parts = line.split("|")
					const name = parts[0] || "unknown"
					const status = parts[1] || ""
					const ports = parts[2] || ""
					const isRunning = status.toLowerCase().includes("up")
					return `
	             <div class="service-item">
	               <span class="service-dot ${isRunning ? "running" : "stopped"}"></span>
	               <span class="service-name">${escapeHtml(name)}</span>
	               <span class="service-port">${escapeHtml(ports)}</span>
	             </div>
	           `
				})
				.join("")
		} else {
			container.innerHTML = '<p class="muted">Docker not available or no services running.</p>'
		}
	} catch {
		container.innerHTML = '<p class="muted">Unable to query services.</p>'
	}
}

// ── Load Brain Environment ─────────────────────────────────────────────────────

async function loadBrainEnv() {
	const container = document.getElementById("env-container")

	try {
		const result = await brainRequest("context")
		const ctx = result.context || result.projectContext || result

		let html = ""

		if (ctx) {
			// Project info
			if (ctx.name) html += `<div class="env-item"><span class="env-key">Project</span><span class="env-value">${escapeHtml(ctx.name)}</span></div>`
			if (ctx.framework) html += `<div class="env-item"><span class="env-key">Framework</span><span class="env-value">${escapeHtml(ctx.framework)}</span></div>`
			if (ctx.packageManager) html += `<div class="env-item"><span class="env-key">Package Manager</span><span class="env-value">${escapeHtml(ctx.packageManager)}</span></div>`
			if (ctx.nodeVersion) html += `<div class="env-item"><span class="env-key">Node</span><span class="env-value">${escapeHtml(ctx.nodeVersion)}</span></div>`
			if (ctx.port) html += `<div class="env-item"><span class="env-key">Port</span><span class="env-value">${escapeHtml(String(ctx.port))}</span></div>`
			if (ctx.branch) html += `<div class="env-item"><span class="env-key">Branch</span><span class="env-value">${escapeHtml(ctx.branch)}</span></div>`
			if (ctx.hasDocker !== undefined) html += `<div class="env-item"><span class="env-key">Docker</span><span class="env-value">${ctx.hasDocker ? "✅ Available" : "❌ Not available"}</span></div>`
			if (ctx.hasTypeScript !== undefined) html += `<div class="env-item"><span class="env-key">TypeScript</span><span class="env-value">${ctx.hasTypeScript ? "✅ Yes" : "❌ No"}</span></div>`
		}

		container.innerHTML = html || '<p class="muted">No project context available.</p>'
	} catch {
		container.innerHTML = '<p class="muted">Failed to load environment context.</p>'
	}
}

// ── Render Brain Approvals ─────────────────────────────────────────────────────

function renderBrainApprovals() {
	const container = document.getElementById("approvals-container")
	const countEl = document.getElementById("approval-count")
	const approvals = state.brain.approvals

	if (!approvals || approvals.length === 0) {
		container.innerHTML = '<p class="muted">No pending approvals.</p>'
		countEl.textContent = "0"
		return
	}

	countEl.textContent = approvals.length

	container.innerHTML = approvals
		.map(
			(a, i) => `
	     <div class="approval-item">
	       <div class="approval-cmd">${escapeHtml(a.command || a.action || "")}</div>
	       <div class="approval-reason">${escapeHtml(a.reason || a.message || "Requires approval")}</div>
	       <div class="approval-actions">
	         <button class="btn-approve" onclick="approveAction(${i})">✅ Approve</button>
	         <button class="btn-reject" onclick="rejectAction(${i})">❌ Reject</button>
	       </div>
	     </div>
	   `,
		)
		.join("")
}

// ── Approve / Reject Actions ───────────────────────────────────────────────────

function approveAction(index) {
	const approval = state.brain.approvals[index]
	if (!approval) return

	state.brain.approvals.splice(index, 1)
	renderBrainApprovals()
	showNotice(`✅ Approved: ${(approval.command || approval.action || "").substring(0, 40)}`)
}

function rejectAction(index) {
	const approval = state.brain.approvals[index]
	if (!approval) return

	state.brain.approvals.splice(index, 1)
	renderBrainApprovals()
	showNotice(`❌ Rejected: ${(approval.command || approval.action || "").substring(0, 40)}`)
}

// ── Utility: Escape HTML ───────────────────────────────────────────────────────

function escapeHtml(str) {
	if (!str) return ""
	const div = document.createElement("div")
	div.textContent = str
	return div.innerHTML
}

// ── Monaco Editor Setup ────────────────────────────────────────────────────────

let editorReady = false

function initEditor() {
	require.config({
		paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" },
	})

	require(["vs/editor/editor.main"], function () {
		const container = document.getElementById("editor-container")
		if (!container) return

		state.editor = monaco.editor.create(container, {
			value: "// Select a file to edit\n",
			language: "typescript",
			theme: "vs-dark",
			minimap: { enabled: false },
			fontSize: 13,
			fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
			lineNumbers: "on",
			scrollBeyondLastLine: false,
			automaticLayout: true,
			tabSize: 2,
			wordWrap: "on",
		})

		editorReady = true
	})
}

// ── Show Notice ────────────────────────────────────────────────────────────────

function showNotice(message, isError = false) {
	const notice = document.getElementById("notice")
	notice.textContent = message
	notice.className = `notice ${isError ? "error" : ""}`
	notice.classList.remove("hidden")
	setTimeout(() => notice.classList.add("hidden"), 4000)
}

// ── Load Workspaces ────────────────────────────────────────────────────────────

async function loadWorkspaces() {
	try {
		const data = await apiRequest("/workspaces")
		state.workspaces = data.workspaces || []
	} catch {
		// Demo fallback
		state.workspaces = [
			{
				id: "productgenerator",
				name: "Product Generator",
				repo: "jpgyap-sudo/productgenerator",
				status: "Running",
				branch: "main",
				agents: 4,
				bugs: 2,
			},
			{
				id: "superroo2",
				name: "SuperRoo2",
				repo: "jpgyap-sudo/superroo2",
				status: "Running",
				branch: "dev",
				agents: 6,
				bugs: 5,
			},
			{
				id: "xsjprd55",
				name: "Trading Signals",
				repo: "jpgyap-sudo/xsjprd55",
				status: "Idle",
				branch: "main",
				agents: 3,
				bugs: 1,
			},
		]
	}

	renderWorkspaces()
}

function renderWorkspaces() {
	const list = document.getElementById("workspace-list")
	const search = document.getElementById("workspace-search").value.toLowerCase()

	const filtered = state.workspaces.filter(
		(w) =>
			w.name.toLowerCase().includes(search) ||
			w.id.toLowerCase().includes(search) ||
			w.repo.toLowerCase().includes(search),
	)

	list.innerHTML = filtered
		.map(
			(ws) => `
    <button class="workspace-item ${state.active?.id === ws.id ? "active" : ""}"
            onclick="selectWorkspace(workspaceFromId('${ws.id}'))">
      <div>
        <strong>📂 ${ws.name}</strong>
        <span>›</span>
      </div>
      <p>${ws.repo}</p>
    </button>
  `,
		)
		.join("")
}

function workspaceFromId(id) {
	return state.workspaces.find((w) => w.id === id)
}

function filterWorkspaces(query) {
	renderWorkspaces()
}

// ── Select Workspace ───────────────────────────────────────────────────────────

async function selectWorkspace(ws) {
	if (!ws) return
	state.active = ws
	renderWorkspaces()

	// Update workspace header
	document.getElementById("ws-name").innerHTML =
		`${ws.name} <span class="pill ${ws.status === "Running" ? "green" : "yellow"}">${ws.status}</span>`
	document.getElementById("ws-repo").textContent = ws.repo

	// Update stats
	const stats = [
		{ label: "Agents", value: ws.agents, icon: "🤖" },
		{ label: "Bugs", value: ws.bugs, icon: "⚠️" },
		{ label: "Docker", value: ws.status, icon: "🐳" },
		{ label: "Branch", value: ws.branch, icon: "🌿" },
	]

	document.getElementById("stats-grid").innerHTML = stats
		.map((s) => `<div class="stat"><span>${s.icon} ${s.label}</span><strong>${s.value}</strong></div>`)
		.join("")

	// Load files
	await loadFiles(ws.id)
	// Load logs
	await loadLogs(ws.id)
	// Load Terminal Brain context
	try {
		const ctxResult = await brainRequest("context")
		state.brain.env = ctxResult.context || ctxResult.projectContext || ctxResult
	} catch {}
	// Load Terminal Brain memory
	try {
		await loadBrainMemory()
	} catch {}
}

// ── Load Files ─────────────────────────────────────────────────────────────────

async function loadFiles(workspaceId) {
	try {
		const data = await apiRequest(`/workspaces/${workspaceId}/files`)
		state.files = data.files || []
	} catch {
		state.files = [
			"src/app/render-queue/page.tsx",
			"src/components/CompletedRenders.tsx",
			"src/server/queueWorker.ts",
			"src/lib/geminiFixer.ts",
			"docker-compose.yml",
			".env.example",
		]
	}

	renderFiles()
	if (state.files.length > 0) {
		selectFile(state.files[0])
	}
}

function renderFiles() {
	const list = document.getElementById("file-list")
	list.innerHTML = state.files
		.map(
			(f) =>
				`<button class="${state.selectedFile === f ? "selected" : ""}" onclick="selectFile('${f.replace(/'/g, "\\'")}')">${f}</button>`,
		)
		.join("")
}

// ── Select File ────────────────────────────────────────────────────────────────

async function selectFile(filePath) {
	state.selectedFile = filePath
	renderFiles()

	document.getElementById("file-label").textContent = `📄 ${filePath}`

	if (!state.active) return

	try {
		const data = await apiRequest(`/workspaces/${state.active.id}/file?path=${encodeURIComponent(filePath)}`)
		state.code = data.content || ""
	} catch {
		state.code = `// ${filePath}\n// Unable to load file content.\n`
	}

	if (state.editor && editorReady) {
		// Detect language from extension
		const ext = filePath.split(".").pop()
		const langMap = {
			js: "javascript",
			jsx: "javascript",
			ts: "typescript",
			tsx: "typescript",
			py: "python",
			rb: "ruby",
			go: "go",
			rs: "rust",
			java: "java",
			kt: "kotlin",
			swift: "swift",
			html: "html",
			css: "css",
			scss: "scss",
			less: "less",
			json: "json",
			xml: "xml",
			yaml: "yaml",
			yml: "yaml",
			md: "markdown",
			sql: "sql",
			sh: "shell",
			bash: "shell",
			dockerfile: "dockerfile",
			conf: "ini",
			ini: "ini",
			txt: "plaintext",
			env: "plaintext",
		}
		const language = langMap[ext] || "plaintext"
		monaco.editor.setModelLanguage(state.editor.getModel(), language)
		state.editor.setValue(state.code)
	}
}

// ── Save File ──────────────────────────────────────────────────────────────────

async function saveFile() {
	if (!state.active || !state.selectedFile) return

	const content = state.editor ? state.editor.getValue() : state.code

	try {
		await apiRequest(`/workspaces/${state.active.id}/file`, {
			method: "POST",
			body: JSON.stringify({ path: state.selectedFile, content }),
		})
		showNotice("✅ File saved successfully.")
	} catch (err) {
		showNotice(`❌ Save failed: ${err.message}`, true)
	}
}

// ── Load Logs ──────────────────────────────────────────────────────────────────

async function loadLogs(workspaceId) {
	try {
		const data = await apiRequest(`/workspaces/${workspaceId}/logs`)
		state.logs = data.logs || []
	} catch {
		state.logs = [
			{ type: "ok", text: "Telegram session verified", time: new Date().toLocaleTimeString() },
			{ type: "ok", text: `Workspace ${workspaceId} mounted`, time: new Date().toLocaleTimeString() },
			{
				type: "warn",
				text: "Demo mode — connect WORKSPACE_ROOT for real files",
				time: new Date().toLocaleTimeString(),
			},
		]
	}

	renderLogs()
}

function renderLogs() {
	const container = document.getElementById("logs-container")
	container.innerHTML = state.logs
		.map(
			(log) =>
				`<div class="log">
      <span>${log.type === "ok" ? "✅" : log.type === "warn" ? "⚠️" : "❌"}</span>
      <div>
        <p>${log.text}</p>
        <small>${log.time}</small>
      </div>
    </div>`,
		)
		.join("")
}

// ── Send AI Command ────────────────────────────────────────────────────────────

async function sendCommand() {
	const prompt = document.getElementById("ai-prompt").value.trim()
	if (!prompt || !state.active) return

	try {
		const attachments = state.attachments.map((a) => ({
			name: a.name,
			type: a.type,
			url: a.url,
			size: a.size,
		}))

		const data = await apiRequest(`/workspaces/${state.active.id}/command`, {
			method: "POST",
			body: JSON.stringify({ prompt, attachments }),
		})

		showNotice(data.message || "✅ Command sent to orchestrator.")
		document.getElementById("ai-prompt").value = ""

		// Add to logs
		state.logs.unshift({
			type: "ok",
			text: `Command sent: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
			time: new Date().toLocaleTimeString(),
		})
		renderLogs()

		// Sync task to cloud (cross-platform memory)
		try {
			await apiRequest("/tasks/sync", {
				method: "POST",
				body: JSON.stringify({
					workspaceId: state.active.id,
					action: "command",
					description: prompt,
					files: attachments.map((a) => a.name),
					status: "pending",
				}),
			})
			// Reload tasks to show the new one
			await loadTasks()
		} catch {}
	} catch (err) {
		showNotice(`❌ Command failed: ${err.message}`, true)
	}
}

// ── File Upload (via button) ───────────────────────────────────────────────────

function uploadFiles() {
	document.getElementById("file-input").click()
}

async function handleFileSelect(event) {
	const files = event.target.files
	if (!files || files.length === 0) return

	await uploadSelectedFiles(files)
	event.target.value = "" // Reset input
}

async function uploadSelectedFiles(fileList) {
	if (!state.active) {
		showNotice("❌ Select a workspace first.", true)
		return
	}

	const formData = new FormData()
	for (const file of fileList) {
		formData.append("files", file)
	}

	try {
		const data = await apiRequest(`/workspaces/${state.active.id}/upload`, {
			method: "POST",
			body: formData,
		})

		if (data.ok && data.files) {
			for (const f of data.files) {
				state.attachments.push({
					name: f.originalName,
					type: f.mimetype,
					url: f.url,
					size: f.size,
					data: null,
				})
			}
			renderAttachments()
			showNotice(`📎 ${data.files.length} file(s) uploaded.`)
		}
	} catch (err) {
		showNotice(`❌ Upload failed: ${err.message}`, true)
	}
}

// ── Drag & Drop ────────────────────────────────────────────────────────────────

let dragCounter = 0

document.addEventListener("dragenter", (e) => {
	e.preventDefault()
	dragCounter++
	if (dragCounter === 1) {
		showDragOverlay()
	}
})

document.addEventListener("dragleave", (e) => {
	e.preventDefault()
	dragCounter--
	if (dragCounter === 0) {
		hideDragOverlay()
	}
})

document.addEventListener("dragover", (e) => {
	e.preventDefault()
})

document.addEventListener("drop", async (e) => {
	e.preventDefault()
	dragCounter = 0
	hideDragOverlay()

	const files = e.dataTransfer.files
	if (files && files.length > 0) {
		await uploadSelectedFiles(files)
	}
})

function showDragOverlay() {
	let overlay = document.getElementById("drag-overlay")
	if (!overlay) {
		overlay = document.createElement("div")
		overlay.id = "drag-overlay"
		overlay.className = "drag-overlay"
		overlay.innerHTML = `
      <div class="drag-overlay-content">
        <div class="icon">📎</div>
        <p>Drop files here</p>
        <small>Images, PDFs, documents, code files — all supported</small>
      </div>
    `
		document.body.appendChild(overlay)
	}
	overlay.style.display = "flex"
}

function hideDragOverlay() {
	const overlay = document.getElementById("drag-overlay")
	if (overlay) overlay.style.display = "none"
}

// ── Render Attachments ─────────────────────────────────────────────────────────

function renderAttachments() {
	const panel = document.getElementById("attachments-panel")
	const grid = document.getElementById("attachments-grid")

	if (state.attachments.length === 0) {
		panel.classList.add("hidden")
		return
	}

	panel.classList.remove("hidden")

	grid.innerHTML = state.attachments
		.map((a, i) => {
			const isImage = a.type?.startsWith("image/")
			const icon = isImage ? "" : getFileIcon(a.name)

			return `
      <div class="attachment-item">
        ${isImage ? `<img class="preview" src="${a.url}" alt="${a.name}" />` : `<span class="file-icon">${icon}</span>`}
        <div class="info">
          <div class="name">${a.name}</div>
          <div class="size">${formatSize(a.size)}</div>
        </div>
        <span class="remove" onclick="removeAttachment(${i})">✕</span>
      </div>
    `
		})
		.join("")
}

function getFileIcon(name) {
	const ext = name.split(".").pop()?.toLowerCase()
	const icons = {
		pdf: "📕",
		doc: "📘",
		docx: "📘",
		xls: "📗",
		xlsx: "📗",
		ppt: "📙",
		pptx: "📙",
		txt: "📄",
		md: "📝",
		json: "📋",
		js: "📜",
		ts: "📜",
		py: "🐍",
		html: "🌐",
		css: "🎨",
		zip: "📦",
		rar: "📦",
		gz: "📦",
		tar: "📦",
		mp4: "🎬",
		mov: "🎬",
		avi: "🎬",
		mp3: "🎵",
		wav: "🎵",
		ogg: "🎵",
		csv: "📊",
		sql: "🗄️",
		yaml: "⚙️",
		yml: "⚙️",
		env: "🔑",
		gitignore: "🙈",
	}
	return icons[ext] || "📎"
}

function formatSize(bytes) {
	if (!bytes) return ""
	if (bytes < 1024) return bytes + " B"
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
	return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

function removeAttachment(index) {
	state.attachments.splice(index, 1)
	renderAttachments()
}

function clearAttachments() {
	state.attachments = []
	renderAttachments()
}

// ── Quick Actions ──────────────────────────────────────────────────────────────

async function quickAction(action) {
	if (!state.active) {
		showNotice("❌ Select a workspace first.", true)
		return
	}

	const prompts = {
		Build: `Run the build process for workspace ${state.active.id}. Report any errors.`,
		Test: `Run the test suite for workspace ${state.active.id}. Show results.`,
		Deploy: `Deploy the current state of workspace ${state.active.id}.`,
		Diff: `Show the latest git diff for workspace ${state.active.id}.`,
		Docker: `Show Docker container status for workspace ${state.active.id}.`,
		Approve: `Show pending approvals for workspace ${state.active.id}.`,
	}

	document.getElementById("ai-prompt").value = prompts[action] || action
	await sendCommand()
}

// ── Sync Extension ─────────────────────────────────────────────────────────────

async function syncExtension() {
	showNotice("↻ Syncing with VS Code extension...")
	try {
		const data = await apiRequest("/session")
		showNotice(`✅ Synced. User: ${data.user?.username || data.user?.id || "unknown"}`)
	} catch (err) {
		showNotice(`❌ Sync failed: ${err.message}`, true)
	}
}

// ── Run Agent ──────────────────────────────────────────────────────────────────

async function runAgent() {
	if (!state.active) {
		showNotice("❌ Select a workspace first.", true)
		return
	}
	document.getElementById("ai-prompt").value =
		`Run autonomous agent on workspace ${state.active.id}. Analyze code, suggest improvements, and fix bugs.`
	await sendCommand()
}

// ── Terminal / Commit ──────────────────────────────────────────────────────────

function openTerminal() {
	showNotice("⌨ Terminal feature — coming soon.")
}

function commitChanges() {
	if (!state.active) return
	document.getElementById("ai-prompt").value =
		`Commit and push changes for workspace ${state.active.id}. Generate a meaningful commit message.`
}

// ── Task Sync (cross-platform memory) ──────────────────────────────────────────

async function loadTasks() {
	try {
		const data = await apiRequest("/tasks?limit=20")
		state.tasks = data.tasks || []
	} catch {
		state.tasks = []
	}
	renderTasks()
}

function renderTasks() {
	const container = document.getElementById("tasks-container")
	const count = document.getElementById("task-count")

	count.textContent = state.tasks.length

	if (state.tasks.length === 0) {
		container.innerHTML = '<p class="muted">No recent tasks. Send a command to get started.</p>'
		return
	}

	container.innerHTML = state.tasks
		.map((task) => {
			const icon =
				task.source === "telegram-miniide"
					? "📱"
					: task.source === "cloud"
						? "☁️"
						: task.source === "vscode"
							? "💻"
							: "📋"
			const statusClass =
				task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "pending"
			const time = task.timestamp || task.createdAt || ""
			const timeStr = time ? new Date(time).toLocaleTimeString() : ""
			const title = task.title || task.description || task.action || "Task"
			const source = task.source || "unknown"

			return `
      <div class="task-item">
        <span class="task-icon">${icon}</span>
        <div class="task-body">
          <div class="task-title">${title.substring(0, 80)}</div>
          <div class="task-meta">
            <span class="task-source">${source}</span>
            <span class="task-time">${timeStr}</span>
            <span class="task-status ${statusClass}">${task.status || "pending"}</span>
          </div>
        </div>
      </div>
    `
		})
		.join("")
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
	try {
		// Initialize Telegram WebApp
		if (window.Telegram?.WebApp) {
			window.Telegram.WebApp.ready()
			window.Telegram.WebApp.expand()
		}

		// Check session
		let sessionData = null
		try {
			sessionData = await apiRequest("/session")
			state.telegramUser = sessionData.user
		} catch {
			// Continue in demo mode
		}

		// Update hero subtitle
		if (state.telegramUser) {
			const name = state.telegramUser.first_name || state.telegramUser.username || "User"
			document.getElementById("hero-subtitle").textContent =
				`Welcome, ${name}! Use the Terminal Brain 🧠 to plan, execute, and debug commands. Edit files, approve changes, and track memory.`
		}

		// Hide loading, show main app
		document.getElementById("loading-screen").classList.add("hidden")
		document.getElementById("main-app").classList.remove("hidden")

		// Initialize Monaco editor
		initEditor()

		// Load workspaces
		await loadWorkspaces()

		// Check URL params for workspace (before auto-selecting default)
		const params = new URLSearchParams(window.location.search)
		const wsParam = params.get("workspace")
		let targetWorkspace = null
		if (wsParam) {
			targetWorkspace = state.workspaces.find((w) => w.id === wsParam)
		}

		// Select workspace (URL param takes priority, otherwise first)
		if (targetWorkspace) {
			selectWorkspace(targetWorkspace)
		} else if (state.workspaces.length > 0) {
			selectWorkspace(state.workspaces[0])
		}

		// Load recent tasks (cross-platform memory)
		await loadTasks()
	} catch (err) {
		document.getElementById("loading-screen").classList.add("hidden")
		document.getElementById("error-screen").classList.remove("hidden")
		document.getElementById("error-message").textContent =
			err.message || "Unable to connect to the Mini IDE server."
	}
}

// ── Start ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init)
