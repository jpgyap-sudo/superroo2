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
	// Terminal state
	terminal: {
		visible: false,
		output: [],
		history: [],
		historyIndex: -1,
		// Block-based output
		outputBlocks: [],
		collapsedBlocks: new Set(),
		// Smart autocomplete
		smartSuggestions: [],
		showSmartSuggestions: false,
		selectedSuggestionIndex: -1,
		recentCommands: [],
		// Recording & replay
		recordings: [],
		isRecording: false,
		showRecordings: false,
		recordingBlocks: [],
	},
	// Pipeline state
	pipeline: [],
	// Agent mode
	agentMode: "auto",
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

// ── WebSocket for Real-Time Terminal Output Streaming ─────────────────────────

let ws = null
let wsReconnectTimer = null

function connectWebSocket() {
	const workspaceId = state.active ? state.active.id : "global"
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const wsUrl = `${protocol}//${window.location.host}/ws?workspace=${workspaceId}`

	if (ws) {
		try {
			ws.close()
		} catch {}
	}

	ws = new WebSocket(wsUrl)

	ws.onopen = () => {
		console.log("[Mini IDE WS] Connected")
		if (wsReconnectTimer) {
			clearTimeout(wsReconnectTimer)
			wsReconnectTimer = null
		}
	}

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)
			handleWsMessage(msg)
		} catch {
			// Ignore non-JSON messages
		}
	}

	ws.onclose = () => {
		console.log("[Mini IDE WS] Disconnected — reconnecting in 5s")
		wsReconnectTimer = setTimeout(() => connectWebSocket(), 5000)
	}

	ws.onerror = (err) => {
		console.error("[Mini IDE WS] Error:", err.message || "Unknown")
	}
}

function handleWsMessage(msg) {
	switch (msg.type) {
		case "terminal-output":
			if (msg.workspaceId === (state.active ? state.active.id : null) || msg.workspaceId === "global") {
				state.terminal.output.push(msg.line)
				addOutputBlocks([msg.line])
				renderTerminalOutput()
			}
			break

		case "pipeline-update":
			if (msg.workspaceId === (state.active ? state.active.id : null) || msg.workspaceId === "global") {
				state.pipeline = msg.pipeline || state.pipeline
				renderPipeline()
			}
			break

		case "log-entry":
			if (msg.workspaceId === (state.active ? state.active.id : null) || msg.workspaceId === "global") {
				state.logs.unshift(msg.log)
				renderLogs()
			}
			break

		case "connected":
			console.log(`[Mini IDE WS] Server confirmed connection for ${msg.workspaceId}`)
			break
	}
}

function disconnectWebSocket() {
	if (wsReconnectTimer) {
		clearTimeout(wsReconnectTimer)
		wsReconnectTimer = null
	}
	if (ws) {
		try {
			ws.close()
		} catch {}
		ws = null
	}
}

// ── Rich Memory Visualization ──────────────────────────────────────────────────

function renderRichMemory(memory) {
	const container = document.getElementById("memory-container")
	if (!container) return

	if (!memory || !memory.stats) {
		container.innerHTML = '<p class="muted">No terminal memory available yet.</p>'
		return
	}

	const stats = memory.stats
	const commands = memory.commands || []
	const errors = memory.errors || []

	// Stats summary cards
	const statsHtml = `
		<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
			<div class="memory-stat-card">
				<span class="memory-stat-value">${stats.totalCommands || 0}</span>
				<span class="memory-stat-label">Commands</span>
			</div>
			<div class="memory-stat-card">
				<span class="memory-stat-value">${stats.totalErrors || 0}</span>
				<span class="memory-stat-label">Errors</span>
			</div>
			<div class="memory-stat-card">
				<span class="memory-stat-value">${stats.totalFixes || 0}</span>
				<span class="memory-stat-label">Fixes</span>
			</div>
			<div class="memory-stat-card">
				<span class="memory-stat-value">${stats.totalDeployments || 0}</span>
				<span class="memory-stat-label">Deployments</span>
			</div>
		</div>
	`

	// Success rate bar
	const totalOps = (stats.totalCommands || 0) + (stats.totalErrors || 0)
	const successRate = totalOps > 0 ? Math.round(((stats.totalCommands || 0) / totalOps) * 100) : 100
	const barColor = successRate >= 80 ? "var(--green)" : successRate >= 50 ? "var(--yellow)" : "var(--red)"

	const rateHtml = `
		<div style="margin-bottom:10px">
			<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">
				<span>Success Rate</span>
				<span>${successRate}%</span>
			</div>
			<div style="height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden">
				<div style="height:100%;width:${successRate}%;background:${barColor};border-radius:3px;transition:width 0.5s"></div>
			</div>
		</div>
	`

	// Recent commands timeline
	let timelineHtml = ""
	if (commands.length > 0) {
		timelineHtml = `<div style="margin-bottom:8px"><strong style="font-size:12px;color:var(--text-secondary)">Recent Commands</strong></div>`
		timelineHtml += commands
			.slice(0, 8)
			.map((cmd, i) => {
				const status = cmd.status || "completed"
				const icon = status === "failed" ? "❌" : status === "running" ? "⏳" : "✅"
				const time = cmd.timestamp ? new Date(cmd.timestamp).toLocaleTimeString() : ""
				return `
				<div class="memory-timeline-item">
					<span class="memory-timeline-dot" style="background:${status === "failed" ? "var(--red)" : "var(--green)"}"></span>
					<div class="memory-timeline-body">
						<div style="font-size:11px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(cmd.command || cmd.label || "Command")}</div>
						<div style="font-size:10px;color:var(--text-muted)">${time} ${icon}</div>
					</div>
				</div>
			`
			})
			.join("")
	}

	// Recent errors list
	let errorsHtml = ""
	if (errors.length > 0) {
		errorsHtml = `<div style="margin-top:8px;margin-bottom:4px"><strong style="font-size:12px;color:var(--red)">Recent Errors (${errors.length})</strong></div>`
		errorsHtml += errors
			.slice(0, 4)
			.map(
				(err) => `
			<div style="font-size:10px;color:var(--red);padding:3px 0;border-bottom:1px solid var(--border)">
				❌ ${escapeHtml((err.message || err.type || "Error").substring(0, 60))}
			</div>
		`,
			)
			.join("")
	}

	container.innerHTML = statsHtml + rateHtml + timelineHtml + errorsHtml
}

// ── Error Badge Counts on Brain Tabs ───────────────────────────────────────────

function updateBrainTabBadges() {
	const errorCount = state.brain.errors ? state.brain.errors.length : 0
	const fixCount = state.brain.fixes ? state.brain.fixes.length : 0
	const approvalCount = state.brain.approvals ? state.brain.approvals.length : 0

	// Update error tab badge
	const errorTab = document.querySelector('.brain-tab[data-tab="errors"]')
	if (errorTab) {
		const existing = errorTab.querySelector(".tab-badge")
		if (errorCount > 0) {
			if (existing) {
				existing.textContent = errorCount
			} else {
				const badge = document.createElement("span")
				badge.className = "tab-badge tab-badge-error"
				badge.textContent = errorCount
				errorTab.appendChild(badge)
			}
		} else if (existing) {
			existing.remove()
		}
	}

	// Update fix plan tab badge
	const fixTab = document.querySelector('.brain-tab[data-tab="fixplan"]')
	if (fixTab) {
		const existing = fixTab.querySelector(".tab-badge")
		if (fixCount > 0) {
			if (existing) {
				existing.textContent = fixCount
			} else {
				const badge = document.createElement("span")
				badge.className = "tab-badge tab-badge-fix"
				badge.textContent = fixCount
				fixTab.appendChild(badge)
			}
		} else if (existing) {
			existing.remove()
		}
	}

	// Update approvals tab badge
	const approvalTab = document.querySelector('.brain-tab[data-tab="approvals"]')
	if (approvalTab) {
		const existing = approvalTab.querySelector(".tab-badge")
		if (approvalCount > 0) {
			if (existing) {
				existing.textContent = approvalCount
			} else {
				const badge = document.createElement("span")
				badge.className = "tab-badge tab-badge-approval"
				badge.textContent = approvalCount
				approvalTab.appendChild(badge)
			}
		} else if (existing) {
			existing.remove()
		}
	}
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

	// Add pipeline steps
	state.pipeline = [
		{ label: "Plan", status: "running" },
		{ label: "Execute", status: "pending" },
		{ label: "Analyze", status: "pending" },
		{ label: "Fix", status: "pending" },
		{ label: "Verify", status: "pending" },
	]
	renderPipeline()

	try {
		// Step 1: Plan — convert NL to command sequence
		const planResult = await brainRequest("plan", { query: prompt })
		const plan = planResult.plan || planResult.commands || []
		state.brain.plan = plan
		renderBrainPlan(plan)
		updatePipelineStep("Plan", "success")
		updatePipelineStep("Execute", "running")

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

		updatePipelineStep("Execute", "success")

		// Step 3: Analyze output for errors
		if (allOutput.length > 0) {
			const analyzeResult = await brainRequest("analyze", { output: allOutput.join("\n") })
			if (analyzeResult.errors) {
				allErrors.push(...analyzeResult.errors)
			}
		}

		// Step 4: Get fix suggestions
		updatePipelineStep("Analyze", "running")
		if (allErrors.length > 0) {
			const fixResult = await brainRequest("fix", { output: allOutput.join("\n") })
			if (fixResult.fixes) {
				allFixes.push(...fixResult.fixes)
			}
		}
		updatePipelineStep("Analyze", "success")
		updatePipelineStep("Fix", allErrors.length > 0 ? "running" : "success")

		if (allErrors.length > 0) {
			updatePipelineStep("Fix", "success")
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
			verification:
				allErrors.length === 0 ? "All commands completed successfully." : "Errors detected — see Fix Plan tab.",
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

		// Final pipeline status
		updatePipelineStep("Verify", allErrors.length === 0 ? "success" : "failed")

		// Update badge counts on brain tabs
		updateBrainTabBadges()

		showNotice(
			allErrors.length === 0 ? "✅ Brain execution complete." : "⚠️ Brain found errors — check Fix Plan tab.",
		)
	} catch (err) {
		updatePipelineStep("Execute", "failed")
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
			const cls =
				line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")
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

		// Use rich visualization
		renderRichMemory(memory)
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
		const result = await brainRequest("execute", {
			command:
				"docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null || echo 'Docker not available'",
		})
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
			if (ctx.name)
				html += `<div class="env-item"><span class="env-key">Project</span><span class="env-value">${escapeHtml(ctx.name)}</span></div>`
			if (ctx.framework)
				html += `<div class="env-item"><span class="env-key">Framework</span><span class="env-value">${escapeHtml(ctx.framework)}</span></div>`
			if (ctx.packageManager)
				html += `<div class="env-item"><span class="env-key">Package Manager</span><span class="env-value">${escapeHtml(ctx.packageManager)}</span></div>`
			if (ctx.nodeVersion)
				html += `<div class="env-item"><span class="env-key">Node</span><span class="env-value">${escapeHtml(ctx.nodeVersion)}</span></div>`
			if (ctx.port)
				html += `<div class="env-item"><span class="env-key">Port</span><span class="env-value">${escapeHtml(String(ctx.port))}</span></div>`
			if (ctx.branch)
				html += `<div class="env-item"><span class="env-key">Branch</span><span class="env-value">${escapeHtml(ctx.branch)}</span></div>`
			if (ctx.hasDocker !== undefined)
				html += `<div class="env-item"><span class="env-key">Docker</span><span class="env-value">${ctx.hasDocker ? "✅ Available" : "❌ Not available"}</span></div>`
			if (ctx.hasTypeScript !== undefined)
				html += `<div class="env-item"><span class="env-key">TypeScript</span><span class="env-value">${ctx.hasTypeScript ? "✅ Yes" : "❌ No"}</span></div>`
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

	// Reconnect WebSocket for this workspace
	connectWebSocket()
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

// ── Terminal ────────────────────────────────────────────────────────────────────

function toggleTerminal() {
	state.terminal.visible = !state.terminal.visible
	const section = document.getElementById("terminal-section")
	if (section) {
		section.classList.toggle("hidden", !state.terminal.visible)
	}
	if (state.terminal.visible) {
		setTimeout(() => {
			const input = document.getElementById("terminal-input")
			if (input) input.focus()
		}, 100)
	}
}

// ── Block-Based Output Helpers ────────────────────────────────────────────────────

function parseOutputLine(line, index) {
	const trimmed = line.trim()
	const timestamp = new Date().toLocaleTimeString()
	const id = "block-" + Date.now() + "-" + index

	// Agent/Skill blocks
	if (trimmed.startsWith("🤖") || trimmed.startsWith("✨") || trimmed.startsWith("@")) {
		return { id, type: "agent", timestamp, content: line, collapsed: false }
	}

	// Command blocks
	if (trimmed.startsWith("$ ")) {
		return { id, type: "command", timestamp, content: line, command: trimmed.slice(2), collapsed: false }
	}

	// Error blocks
	if (
		trimmed.startsWith("error:") ||
		trimmed.startsWith("Error:") ||
		trimmed.startsWith("❌") ||
		trimmed.toLowerCase().includes("error") ||
		trimmed.toLowerCase().includes("failed")
	) {
		return { id, type: "error", timestamp, content: line, collapsed: false }
	}

	// Success blocks
	if (
		trimmed.startsWith("✅") ||
		trimmed.toLowerCase().includes("success") ||
		trimmed.toLowerCase().includes("completed")
	) {
		return { id, type: "success", timestamp, content: line, collapsed: false }
	}

	// Divider blocks
	if (
		trimmed.startsWith("┌") ||
		trimmed.startsWith("└") ||
		trimmed.startsWith("╔") ||
		trimmed.startsWith("╚") ||
		trimmed.startsWith("─") ||
		trimmed.startsWith("═")
	) {
		return { id, type: "divider", timestamp, content: line, collapsed: false }
	}

	// Info blocks
	if (trimmed.startsWith("→") || trimmed.startsWith("ℹ️") || trimmed.startsWith("Running")) {
		return { id, type: "info", timestamp, content: line, collapsed: false }
	}

	// Default: output block
	return { id, type: "output", timestamp, content: line, collapsed: false }
}

function convertToBlocks(lines) {
	const blocks = []
	let currentCommand = null

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.trim()

		if (trimmed.startsWith("$ ")) {
			// Start a new command block
			if (currentCommand) {
				blocks.push(currentCommand)
			}
			currentCommand = parseOutputLine(line, i)
		} else if (currentCommand && currentCommand.type === "command") {
			// Merge consecutive output lines into the current command block
			currentCommand.content += "\n" + line
		} else {
			if (currentCommand) {
				blocks.push(currentCommand)
				currentCommand = null
			}
			blocks.push(parseOutputLine(line, i))
		}
	}

	if (currentCommand) {
		blocks.push(currentCommand)
	}

	return blocks
}

function addOutputBlocks(lines, command) {
	const blocks = convertToBlocks(lines)
	state.terminal.outputBlocks.push(...blocks)

	// If recording, add to recording blocks
	if (state.terminal.isRecording) {
		state.terminal.recordingBlocks.push(...blocks)
	}

	renderTerminalOutput()
}

function toggleBlockCollapse(blockId) {
	if (state.terminal.collapsedBlocks.has(blockId)) {
		state.terminal.collapsedBlocks.delete(blockId)
	} else {
		state.terminal.collapsedBlocks.add(blockId)
	}
	renderTerminalOutput()
}

// ── Block-Based Terminal Output ────────────────────────────────────────────────────

function renderTerminalOutput() {
	const container = document.getElementById("terminal-output")
	if (!container) return

	// Use block-based rendering
	if (state.terminal.outputBlocks.length > 0) {
		container.innerHTML = state.terminal.outputBlocks
			.map((block) => {
				const isCollapsed = state.terminal.collapsedBlocks.has(block.id)
				const toggleIcon = isCollapsed ? "▶" : "▼"

				// Block type icon
				let typeIcon = ""
				switch (block.type) {
					case "command":
						typeIcon = "$"
						break
					case "error":
						typeIcon = "✕"
						break
					case "success":
						typeIcon = "✓"
						break
					case "agent":
						typeIcon = "◆"
						break
					case "info":
						typeIcon = "ℹ"
						break
					case "divider":
						typeIcon = "─"
						break
					default:
						typeIcon = " "
				}

				// Block CSS class
				const typeClass = "term-block-" + block.type

				if (block.type === "divider") {
					return `<div class="term-block term-block-divider" data-block-id="${block.id}">
						<span class="term-block-toggle" onclick="toggleBlockCollapse('${block.id}')">${toggleIcon}</span>
						<span class="term-block-content">${escapeHtml(block.content)}</span>
					</div>`
				}

				if (isCollapsed) {
					const preview = block.content.split("\n")[0].substring(0, 60)
					return `<div class="term-block term-block-collapsed" data-block-id="${block.id}" onclick="toggleBlockCollapse('${block.id}')">
						<span>▶</span>
						<span class="term-block-content">${escapeHtml(preview)}... (${block.content.split("\n").length} lines)</span>
						<span class="term-block-timestamp">${block.timestamp}</span>
					</div>`
				}

				return `<div class="term-block ${typeClass}" data-block-id="${block.id}">
					<span class="term-block-toggle" onclick="event.stopPropagation();toggleBlockCollapse('${block.id}')">${toggleIcon}</span>
					<span class="term-block-icon">${typeIcon}</span>
					<span class="term-block-content">${escapeHtml(block.content)}</span>
					<span class="term-block-timestamp">${block.timestamp}</span>
				</div>`
			})
			.join("")
	} else {
		// Fallback to flat output if no blocks
		container.innerHTML = state.terminal.output
			.map((line) => {
				const cls =
					line.startsWith("error:") || line.startsWith("Error:") || line.startsWith("❌")
						? "term-line-error"
						: line.startsWith("warn:") || line.startsWith("Warn:") || line.startsWith("⚠️")
							? "term-line-warn"
							: line.startsWith("→") || line.startsWith("ℹ️")
								? "term-line-info"
								: line.startsWith("#") || line.startsWith("//")
									? "term-line-muted"
									: ""
				return `<div class="${cls}">${escapeHtml(line)}</div>`
			})
			.join("")
	}

	container.scrollTop = container.scrollHeight
}

// ── Smart Autocomplete ────────────────────────────────────────────────────────────

const COMMON_COMMANDS = [
	{ cmd: "npm run dev", desc: "Start dev server", type: "command" },
	{ cmd: "npm run build", desc: "Build project", type: "command" },
	{ cmd: "npm test", desc: "Run tests", type: "command" },
	{ cmd: "npm install", desc: "Install dependencies", type: "command" },
	{ cmd: "git status", desc: "Check git status", type: "command" },
	{ cmd: "git pull", desc: "Pull latest changes", type: "command" },
	{ cmd: "git push", desc: "Push to remote", type: "command" },
	{ cmd: "git add .", desc: "Stage all changes", type: "command" },
	{ cmd: "git commit -m", desc: "Commit changes", type: "command" },
	{ cmd: "cd ..", desc: "Go up one directory", type: "command" },
	{ cmd: "ls -la", desc: "List all files", type: "command" },
	{ cmd: "pwd", desc: "Print working directory", type: "command" },
	{ cmd: "clear", desc: "Clear terminal", type: "command" },
	{ cmd: "docker ps", desc: "List Docker containers", type: "command" },
	{ cmd: "pm2 status", desc: "Check PM2 processes", type: "command" },
	{ cmd: "pm2 logs", desc: "View PM2 logs", type: "command" },
	{ cmd: "npx vitest run", desc: "Run vitest tests", type: "command" },
	{ cmd: "node -v", desc: "Check Node version", type: "command" },
]

const AGENT_COMMANDS = [
	{ cmd: "@debugger", desc: "Delegate to debug agent", type: "agent" },
	{ cmd: "@deployer", desc: "Delegate to deploy agent", type: "agent" },
	{ cmd: "@tester", desc: "Delegate to test agent", type: "agent" },
	{ cmd: "@coder", desc: "Delegate to coding agent", type: "agent" },
	{ cmd: "@reviewer", desc: "Delegate to review agent", type: "agent" },
	{ cmd: "@orchestrator", desc: "Delegate to orchestrator", type: "agent" },
]

function getSmartSuggestions(input) {
	if (!input || input.length === 0) return []
	const val = input.toLowerCase()

	const suggestions = []

	// Agent commands (starts with @)
	if (val.startsWith("@")) {
		const agentVal = val.slice(1)
		AGENT_COMMANDS.forEach((a) => {
			const cmdName = a.cmd.slice(1)
			if (cmdName.startsWith(agentVal) || cmdName.includes(agentVal)) {
				suggestions.push({ ...a, score: 100 })
			}
		})
		return suggestions.sort((a, b) => b.score - a.score).slice(0, 8)
	}

	// Common commands
	COMMON_COMMANDS.forEach((c) => {
		if (c.cmd.startsWith(val) || c.cmd.includes(val)) {
			let score = c.cmd.startsWith(val) ? 70 : 50
			suggestions.push({ ...c, score })
		}
	})

	// Recent commands
	state.terminal.recentCommands.forEach((rc) => {
		if (rc.startsWith(val) || rc.includes(val)) {
			if (!suggestions.find((s) => s.cmd === rc)) {
				suggestions.push({ cmd: rc, desc: "Recent command", type: "recent", score: 60 })
			}
		}
	})

	return suggestions.sort((a, b) => b.score - a.score).slice(0, 8)
}

function showTerminalSuggestions() {
	const input = document.getElementById("terminal-input")
	if (!input) return
	const val = input.value
	const container = document.getElementById("terminal-suggestions")
	if (!container) return

	const suggestions = getSmartSuggestions(val)

	state.terminal.smartSuggestions = suggestions
	state.terminal.showSmartSuggestions = suggestions.length > 0 && val.length > 0
	state.terminal.selectedSuggestionIndex = -1

	if (!state.terminal.showSmartSuggestions) {
		container.classList.add("hidden")
		return
	}

	container.innerHTML = suggestions
		.map((s, idx) => {
			const typeIcon = s.type === "agent" ? "🤖" : s.type === "recent" ? "🕐" : s.type === "command" ? "⚡" : "📋"
			const activeClass = idx === state.terminal.selectedSuggestionIndex ? "active" : ""
			return `<div class="suggestion-item ${activeClass}" data-index="${idx}" onclick="selectTerminalSuggestion('${s.cmd.replace(/'/g, "\\'")}')">
					<span class="suggestion-left">
						<span class="suggestion-type-icon">${typeIcon}</span>
						<span>${escapeHtml(s.cmd)}</span>
						<span class="suggestion-desc">${escapeHtml(s.desc)}</span>
					</span>
					<span class="suggestion-score">${s.score}</span>
				</div>`
		})
		.join("")
	container.classList.remove("hidden")
}

function hideTerminalSuggestions() {
	state.terminal.showSmartSuggestions = false
	state.terminal.selectedSuggestionIndex = -1
	const container = document.getElementById("terminal-suggestions")
	if (container) container.classList.add("hidden")
}

function selectTerminalSuggestion(cmd) {
	const input = document.getElementById("terminal-input")
	if (input) {
		input.value = cmd
		input.focus()
	}
	hideTerminalSuggestions()
}

// ── Terminal Recording & Replay ────────────────────────────────────────────────────

function createRecording(blocks, name) {
	const commandCount = blocks.filter((b) => b.type === "command").length
	const startTime = blocks.length > 0 ? blocks[0].timestamp : new Date().toLocaleTimeString()
	const endTime = blocks.length > 0 ? blocks[blocks.length - 1].timestamp : startTime
	// Calculate approximate duration
	const duration = commandCount > 0 ? commandCount + " commands" : "0 commands"

	return {
		id: "rec-" + Date.now(),
		name: name || "Recording " + (state.terminal.recordings.length + 1),
		startedAt: startTime,
		duration: duration,
		blocks: blocks,
		commandCount: commandCount,
	}
}

function handleStartRecording() {
	if (state.terminal.isRecording) return
	state.terminal.isRecording = true
	state.terminal.recordingBlocks = []
	showNotice("⏺ Recording terminal session...")

	// Show recording indicator
	const indicator = document.getElementById("terminal-recording-indicator")
	if (indicator) indicator.classList.remove("hidden")

	// Toggle buttons
	const btnRecord = document.getElementById("btn-record")
	const btnStop = document.getElementById("btn-stop-rec")
	if (btnRecord) btnRecord.style.display = "none"
	if (btnStop) btnStop.style.display = "inline-block"
}

function handleStopRecording() {
	if (!state.terminal.isRecording) return
	state.terminal.isRecording = false

	// Hide recording indicator
	const indicator = document.getElementById("terminal-recording-indicator")
	if (indicator) indicator.classList.add("hidden")

	// Toggle buttons
	const btnRecord = document.getElementById("btn-record")
	const btnStop = document.getElementById("btn-stop-rec")
	if (btnRecord) btnRecord.style.display = "inline-block"
	if (btnStop) btnStop.style.display = "none"

	// Create recording from captured blocks
	if (state.terminal.recordingBlocks.length > 0) {
		const recording = createRecording(state.terminal.recordingBlocks)
		state.terminal.recordings.push(recording)
		showNotice("✅ Recording saved! " + recording.commandCount + " commands captured.")
	} else {
		showNotice("⚠️ No commands recorded.")
	}

	state.terminal.recordingBlocks = []
}

function showRecordings() {
	state.terminal.showRecordings = !state.terminal.showRecordings
	const dropdown = document.getElementById("terminal-recordings-dropdown")
	if (!dropdown) return

	if (!state.terminal.showRecordings || state.terminal.recordings.length === 0) {
		dropdown.classList.add("hidden")
		return
	}

	dropdown.innerHTML =
		`<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;font-weight:600">📼 Recordings</div>` +
		state.terminal.recordings
			.map(
				(rec, i) => `
			<div class="recording-item" onclick="handleReplayRecording(${i})">
				<span class="rec-name">${escapeHtml(rec.name)}</span>
				<span class="rec-meta">${rec.commandCount} cmds · ${rec.startedAt}</span>
			</div>
		`,
			)
			.join("")

	dropdown.classList.remove("hidden")
}

function handleReplayRecording(index) {
	const recording = state.terminal.recordings[index]
	if (!recording) return

	// Clear current output and replay blocks
	state.terminal.outputBlocks = []
	state.terminal.output = []

	// Replay blocks one by one with delay
	let delay = 0
	recording.blocks.forEach((block, i) => {
		setTimeout(() => {
			state.terminal.outputBlocks.push({ ...block, id: "replay-" + Date.now() + "-" + i })
			state.terminal.output.push(block.content)
			renderTerminalOutput()
		}, delay)
		delay += 100 // 100ms between blocks for visual effect
	})

	showNotice("📼 Replaying: " + recording.name)
	state.terminal.showRecordings = false
	const dropdown = document.getElementById("terminal-recordings-dropdown")
	if (dropdown) dropdown.classList.add("hidden")
}

// ── Terminal Command Execution ────────────────────────────────────────────────────

async function executeTerminalCommand() {
	const input = document.getElementById("terminal-input")
	if (!input) return
	const cmd = input.value.trim()
	if (!cmd) return

	// Add command as block
	const cmdBlock = parseOutputLine("$ " + cmd, state.terminal.outputBlocks.length)
	state.terminal.outputBlocks.push(cmdBlock)
	state.terminal.output.push("$ " + cmd)
	state.terminal.history.push(cmd)
	state.terminal.historyIndex = state.terminal.history.length

	// Track recent commands for autocomplete
	state.terminal.recentCommands = state.terminal.recentCommands.filter((c) => c !== cmd)
	state.terminal.recentCommands.unshift(cmd)
	if (state.terminal.recentCommands.length > 10) {
		state.terminal.recentCommands.pop()
	}

	input.value = ""

	// If recording, add to recording blocks
	if (state.terminal.isRecording) {
		state.terminal.recordingBlocks.push(cmdBlock)
	}

	// Hide suggestions
	hideTerminalSuggestions()

	// Check for @agent mentions
	if (cmd.startsWith("@")) {
		const agentName = cmd.split(" ")[0].slice(1)
		const infoBlock = parseOutputLine("→ Delegating to @" + agentName + "...", state.terminal.outputBlocks.length)
		state.terminal.outputBlocks.push(infoBlock)
		state.terminal.output.push("→ Delegating to @" + agentName + "...")
		renderTerminalOutput()
		try {
			const result = await apiRequest(`/workspaces/${state.active.id}/command`, {
				method: "POST",
				body: JSON.stringify({ prompt: cmd, agent: agentName }),
			})
			const outputLines = (result.output || result.message || "✅ @" + agentName + " completed.").split("\n")
			outputLines.forEach((line, i) => {
				const block = parseOutputLine(line, state.terminal.outputBlocks.length)
				state.terminal.outputBlocks.push(block)
				state.terminal.output.push(line)
				if (state.terminal.isRecording) {
					state.terminal.recordingBlocks.push(block)
				}
			})
		} catch (err) {
			const errBlock = parseOutputLine("❌ Agent error: " + err.message, state.terminal.outputBlocks.length)
			state.terminal.outputBlocks.push(errBlock)
			state.terminal.output.push("❌ Agent error: " + err.message)
			if (state.terminal.isRecording) {
				state.terminal.recordingBlocks.push(errBlock)
			}
		}
		renderTerminalOutput()
		return
	}

	// Execute command via API
	const runningBlock = parseOutputLine("→ Running...", state.terminal.outputBlocks.length)
	state.terminal.outputBlocks.push(runningBlock)
	state.terminal.output.push("→ Running...")
	renderTerminalOutput()

	try {
		const result = await apiRequest(`/workspaces/${state.active.id}/command`, {
			method: "POST",
			body: JSON.stringify({ prompt: cmd, terminal: true }),
		})
		const output = result.output || result.message || "✅ Command completed."
		const lines = Array.isArray(output) ? output : output.split("\n")
		lines.forEach((line, i) => {
			const block = parseOutputLine(line, state.terminal.outputBlocks.length)
			state.terminal.outputBlocks.push(block)
			state.terminal.output.push(line)
			if (state.terminal.isRecording) {
				state.terminal.recordingBlocks.push(block)
			}
		})
	} catch (err) {
		const errBlock = parseOutputLine("❌ " + err.message, state.terminal.outputBlocks.length)
		state.terminal.outputBlocks.push(errBlock)
		state.terminal.output.push("❌ " + err.message)
		if (state.terminal.isRecording) {
			state.terminal.recordingBlocks.push(errBlock)
		}
	}

	renderTerminalOutput()

	// Add to logs
	state.logs.unshift({
		type: "ok",
		text: `Terminal: "${cmd.substring(0, 50)}${cmd.length > 50 ? "..." : ""}"`,
		time: new Date().toLocaleTimeString(),
	})
	renderLogs()
}

function handleTerminalKeyDown(e) {
	if (e.key === "Enter") {
		e.preventDefault()
		executeTerminalCommand()
	} else if (e.key === "ArrowUp") {
		e.preventDefault()
		if (state.terminal.showSmartSuggestions && state.terminal.smartSuggestions.length > 0) {
			// Navigate suggestions up
			if (state.terminal.selectedSuggestionIndex > 0) {
				state.terminal.selectedSuggestionIndex--
				highlightSuggestion()
			}
		} else if (state.terminal.history.length > 0 && state.terminal.historyIndex > 0) {
			state.terminal.historyIndex--
			const input = document.getElementById("terminal-input")
			if (input) input.value = state.terminal.history[state.terminal.historyIndex]
		}
	} else if (e.key === "ArrowDown") {
		e.preventDefault()
		if (state.terminal.showSmartSuggestions && state.terminal.smartSuggestions.length > 0) {
			// Navigate suggestions down
			if (state.terminal.selectedSuggestionIndex < state.terminal.smartSuggestions.length - 1) {
				state.terminal.selectedSuggestionIndex++
				highlightSuggestion()
			}
		} else if (state.terminal.historyIndex < state.terminal.history.length - 1) {
			state.terminal.historyIndex++
			const input = document.getElementById("terminal-input")
			if (input) input.value = state.terminal.history[state.terminal.historyIndex]
		} else {
			state.terminal.historyIndex = state.terminal.history.length
			const input = document.getElementById("terminal-input")
			if (input) input.value = ""
		}
	} else if (e.key === "Tab") {
		e.preventDefault()
		if (state.terminal.showSmartSuggestions && state.terminal.smartSuggestions.length > 0) {
			// Cycle through suggestions
			const nextIdx = (state.terminal.selectedSuggestionIndex + 1) % state.terminal.smartSuggestions.length
			state.terminal.selectedSuggestionIndex = nextIdx
			highlightSuggestion()
		} else {
			showTerminalSuggestions()
		}
	} else if (e.key === "Escape") {
		hideTerminalSuggestions()
	}
}

function highlightSuggestion() {
	const container = document.getElementById("terminal-suggestions")
	if (!container) return
	const items = container.querySelectorAll(".suggestion-item")
	items.forEach((item, idx) => {
		item.classList.toggle("active", idx === state.terminal.selectedSuggestionIndex)
	})
	// Scroll into view
	if (state.terminal.selectedSuggestionIndex >= 0 && items[state.terminal.selectedSuggestionIndex]) {
		items[state.terminal.selectedSuggestionIndex].scrollIntoView({ block: "nearest" })
	}
}

function clearTerminal() {
	state.terminal.output = []
	state.terminal.outputBlocks = []
	state.terminal.collapsedBlocks = new Set()
	renderTerminalOutput()
}

function copyTerminal() {
	const text = state.terminal.outputBlocks.map((b) => b.content).join("\n")
	navigator.clipboard
		.writeText(text)
		.then(() => {
			showNotice("📋 Terminal output copied.")
		})
		.catch(() => {})
}

// ── Pipeline ────────────────────────────────────────────────────────────────────

function renderPipeline() {
	const bar = document.getElementById("pipeline-bar")
	const steps = document.getElementById("pipeline-steps")
	const status = document.getElementById("pipeline-status")
	if (!bar || !steps) return

	if (state.pipeline.length === 0) {
		bar.classList.add("hidden")
		return
	}

	bar.classList.remove("hidden")
	steps.innerHTML = state.pipeline
		.map(
			(s) => `
		<div class="pipeline-step step-${s.status || "pending"}" onclick="quickAction('${s.label}')">
			<span class="step-icon">${s.status === "success" ? "✅" : s.status === "failed" ? "❌" : s.status === "running" ? "⏳" : "⏸️"}</span>
			<span class="step-label">${escapeHtml(s.label)}</span>
		</div>
	`,
		)
		.join("")

	const running = state.pipeline.find((s) => s.status === "running")
	const failed = state.pipeline.find((s) => s.status === "failed")
	if (status) {
		status.textContent = running ? "Running" : failed ? "Failed" : "Completed"
		status.className = `pill ${running ? "yellow" : failed ? "red" : "green"}`
	}
}

function addPipelineStep(label) {
	state.pipeline.push({ label, status: "pending" })
	renderPipeline()
}

function updatePipelineStep(label, status) {
	const step = state.pipeline.find((s) => s.label === label)
	if (step) {
		step.status = status
		renderPipeline()
	}
}

// ── Agent Mode ──────────────────────────────────────────────────────────────────

function setAgentMode(mode) {
	state.agentMode = mode
	document.querySelectorAll(".agent-mode").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.mode === mode)
	})
	const label = document.getElementById("agent-mode-label")
	if (label) {
		const labels = { auto: "Auto", plan: "Plan", code: "Code", debug: "Debug", review: "Review", crawl: "Crawl" }
		label.textContent = labels[mode] || mode
	}
	showNotice(`🤖 Agent mode switched to ${mode}`)
}

// ── Keyboard Shortcuts Modal ────────────────────────────────────────────────────

function showKeyboardShortcuts() {
	const modal = document.getElementById("shortcuts-modal")
	if (modal) modal.classList.remove("hidden")
}

function closeShortcutsModal(event) {
	if (event && event.target !== event.currentTarget) return
	const modal = document.getElementById("shortcuts-modal")
	if (modal) modal.classList.add("hidden")
}

// ── Global Keyboard Shortcuts ───────────────────────────────────────────────────

document.addEventListener("keydown", function (e) {
	// Ctrl+` : Toggle terminal
	if (e.ctrlKey && e.key === "`") {
		e.preventDefault()
		toggleTerminal()
	}
	// Ctrl+K : Clear terminal (only if terminal is focused)
	if (e.ctrlKey && e.key === "k") {
		const active = document.activeElement
		if (active && active.id === "terminal-input") {
			e.preventDefault()
			clearTerminal()
		}
	}
	// Ctrl+S : Save file
	if (e.ctrlKey && e.key === "s") {
		e.preventDefault()
		saveFile()
	}
	// Ctrl+Shift+M : Show shortcuts modal
	if (e.ctrlKey && e.shiftKey && (e.key === "m" || e.key === "M")) {
		e.preventDefault()
		showKeyboardShortcuts()
	}
	// Escape : Close modals
	if (e.key === "Escape") {
		closeShortcutsModal()
		hideTerminalSuggestions()
	}
	// Ctrl+Enter : Send AI command (from ai-prompt)
	if (e.ctrlKey && e.key === "Enter") {
		const active = document.activeElement
		if (active && active.id === "ai-prompt") {
			e.preventDefault()
			sendBrainCommand()
		}
	}
	// Ctrl+Shift+Enter : Send brain command
	if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
		e.preventDefault()
		sendBrainCommand()
	}
})

// ── Terminal input keydown handler (attached on init) ───────────────────────────

function initTerminalInput() {
	const input = document.getElementById("terminal-input")
	if (input) {
		input.addEventListener("keydown", handleTerminalKeyDown)
		input.addEventListener("input", showTerminalSuggestions)
		input.addEventListener("blur", () => setTimeout(hideTerminalSuggestions, 200))
	}
	// Close recordings dropdown when clicking outside
	document.addEventListener("click", function (e) {
		const dropdown = document.getElementById("terminal-recordings-dropdown")
		const btn = document.querySelector('[onclick*="showRecordings"]')
		if (dropdown && !dropdown.classList.contains("hidden")) {
			if (!dropdown.contains(e.target) && !btn?.contains(e.target)) {
				dropdown.classList.add("hidden")
				state.terminal.showRecordings = false
			}
		}
	})
}

// ── Commit ──────────────────────────────────────────────────────────────────────

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

		// Initialize terminal input handler
		initTerminalInput()

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
