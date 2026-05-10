/**
 * SuperRoo Telegram Mini App — Control Center Dashboard
 *
 * Full-featured dashboard with task management, approvals, deployments,
 * rollback savepoints, agent selection, and live activity feed.
 *
 * Architecture follows the Telegram Mini App kit design:
 *   - Sidebar navigation with session timer
 *   - Stats grid with pending approvals, running tasks, deployments, rollback points
 *   - Task flow visualization (Plan → Savepoint → Coding → Review → Deploy)
 *   - Quick actions for New Task, Consultant, Tests, Deploy, Rollback, Logs
 *   - Dedicated pages for each action
 */

;(function () {
	"use strict"

	// ─── Configuration ────────────────────────────────────────────────

	var API_BASE = "/api"
	var POLL_INTERVAL = 10000 // 10 seconds

	// ─── State ────────────────────────────────────────────────────────

	var state = {
		currentPage: "dashboard",
		sessionTimer: 28 * 60 + 45, // 28:45 in seconds
		sessionInterval: null,
		pollInterval: null,
		tasks: [],
		approvals: [],
		deployments: [],
		savepoints: [],
		projects: [],
		agents: [],
		logs: [],
		telegramUserId: null,
		chatId: null,
	}

	// ─── Telegram Mini App Bridge ─────────────────────────────────────

	var tg = null
	try {
		if (window.Telegram && window.Telegram.WebApp) {
			tg = window.Telegram.WebApp
			tg.ready()
			tg.expand()
		}
	} catch (e) {
		console.log("[tg-miniapp] Not running inside Telegram WebView")
	}

	function hapticSuccess() {
		try {
			if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success")
		} catch (e) {}
	}

	function hapticWarning() {
		try {
			if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("warning")
		} catch (e) {}
	}

	// ─── DOM References ───────────────────────────────────────────────

	var $ = function (id) {
		return document.getElementById(id)
	}

	// ─── Navigation ───────────────────────────────────────────────────

	function showPage(pageId) {
		// Hide all pages
		var pages = document.querySelectorAll(".page")
		for (var i = 0; i < pages.length; i++) {
			pages[i].style.display = "none"
		}

		// Show requested page
		var target = $("page-" + pageId)
		if (target) {
			target.style.display = "block"
		}

		// Update sidebar active state
		var navBtns = document.querySelectorAll(".nav-btn")
		for (var j = 0; j < navBtns.length; j++) {
			navBtns[j].classList.remove("active")
			if (navBtns[j].getAttribute("data-page") === pageId) {
				navBtns[j].classList.add("active")
			}
		}

		state.currentPage = pageId
	}

	// ─── API Client ───────────────────────────────────────────────────

	async function apiGet(path) {
		try {
			var res = await fetch(API_BASE + path)
			if (!res.ok) return null
			return await res.json()
		} catch (e) {
			console.error("[tg-miniapp] API GET error:", e.message)
			return null
		}
	}

	async function apiPost(path, body) {
		try {
			var res = await fetch(API_BASE + path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body || {}),
			})
			if (!res.ok) return null
			return await res.json()
		} catch (e) {
			console.error("[tg-miniapp] API POST error:", e.message)
			return null
		}
	}

	// ─── Data Fetching ────────────────────────────────────────────────

	async function fetchTasks() {
		var data = await apiGet("/telegram/tasks")
		if (data && data.tasks) {
			state.tasks = data.tasks
			renderTaskList()
			renderApprovalsList()
			updateStats()
		}
	}

	async function fetchDeployments() {
		var data = await apiGet("/telegram/deployments")
		if (data && data.deployments) {
			state.deployments = data.deployments
			renderDeployList()
			renderDeployHistory()
		}
	}

	async function fetchSavepoints() {
		var data = await apiGet("/telegram/savepoints")
		if (data && data.savepoints) {
			state.savepoints = data.savepoints
			renderSavepointList()
			updateStats()
		}
	}

	async function fetchProjects() {
		var data = await apiGet("/telegram/projects")
		if (data && data.projects) {
			state.projects = data.projects
			renderProjectsList()
		}
	}

	async function fetchAgents() {
		var data = await apiGet("/telegram/agents")
		if (data && data.agents) {
			state.agents = data.agents
			renderAgentsGrid()
		}
	}

	async function fetchLogs() {
		var data = await apiGet("/telegram/logs")
		if (data && data.logs) {
			state.logs = data.logs
			renderLogs()
		}
	}

	async function fetchAll() {
		await Promise.all([
			fetchTasks(),
			fetchDeployments(),
			fetchSavepoints(),
			fetchProjects(),
			fetchAgents(),
			fetchLogs(),
		])
	}

	// ─── Render Functions ─────────────────────────────────────────────

	function updateStats() {
		var pendingApprovals = state.tasks.filter(function (t) {
			return t.status === "waiting_approval" || t.status === "review"
		}).length
		var runningTasks = state.tasks.filter(function (t) {
			return t.status === "running" || t.status === "coding" || t.status === "testing"
		}).length
		var deploymentsThisWeek = state.deployments.length
		var savepointsCount = state.savepoints.length

		var statApprovals = $("stat-approvals")
		var statTasks = $("stat-tasks")
		var statDeployments = $("stat-deployments")
		var statRollbacks = $("stat-rollbacks")
		var approvalsCount = $("approvals-count")

		if (statApprovals) statApprovals.textContent = pendingApprovals
		if (statTasks) statTasks.textContent = runningTasks
		if (statDeployments) statDeployments.textContent = deploymentsThisWeek
		if (statRollbacks) statRollbacks.textContent = savepointsCount
		if (approvalsCount) approvalsCount.textContent = pendingApprovals
	}

	function renderTaskList() {
		var container = $("task-list")
		if (!container) return

		if (state.tasks.length === 0) {
			container.innerHTML =
				'<div class="task" style="justify-content:center;color:var(--text-muted);padding:24px">No tasks yet. Create one with Quick Actions!</div>'
			return
		}

		var colors = ["amber", "green", "blue", "purple", "red"]
		var statusLabels = {
			queued: "QUEUED",
			running: "RUNNING",
			waiting_approval: "REVIEW",
			approved: "APPROVED",
			rejected: "REJECTED",
			testing: "TESTING",
			failed: "FAILED",
			completed: "DONE",
			review: "REVIEW",
			coding: "CODING",
			deployed: "DEPLOYED",
		}

		var html = ""
		for (var i = 0; i < Math.min(state.tasks.length, 5); i++) {
			var t = state.tasks[i]
			var color = colors[i % colors.length]
			var label = statusLabels[t.status] || t.status.toUpperCase()
			html +=
				'<div class="task" data-task-id="' +
				t.id +
				'">' +
				'<i class="' +
				color +
				'"></i>' +
				"<div><b>" +
				escapeHtml(t.title || t.instruction || "Task " + t.id) +
				"</b>" +
				"<p>" +
				(t.agent || "Agent") +
				" · Created " +
				(t.createdAgo || "recently") +
				"</p></div>" +
				'<span class="badge ' +
				label.toLowerCase() +
				'">' +
				label +
				"</span>" +
				"<small>" +
				t.id +
				"</small>" +
				"<b>›</b></div>"
		}
		container.innerHTML = html
	}

	function renderApprovalsList() {
		var container = $("approvals-list")
		if (!container) return

		var pending = state.tasks.filter(function (t) {
			return t.status === "waiting_approval" || t.status === "review"
		})

		if (pending.length === 0) {
			container.innerHTML =
				'<div class="card" style="padding:32px;text-align:center;color:var(--text-muted)">✅ No pending approvals. Everything is up to date!</div>'
			return
		}

		var html = ""
		for (var i = 0; i < pending.length; i++) {
			var t = pending[i]
			html +=
				'<div class="approval-card" data-task-id="' +
				t.id +
				'">' +
				"<h4>" +
				escapeHtml(t.title || t.instruction || "Task " + t.id) +
				"</h4>" +
				"<p>" +
				t.id +
				" · " +
				(t.changedFiles || "?") +
				" files changed · " +
				(t.linesAdded || "?") +
				" lines added</p>" +
				'<div class="approval-actions">' +
				'<button class="btn-approve" data-action="approve" data-task-id="' +
				t.id +
				'">✅ Approve</button>' +
				'<button class="btn-view-diff" data-action="diff" data-task-id="' +
				t.id +
				'">📄 View Diff</button>' +
				'<button class="btn-reject" data-action="reject" data-task-id="' +
				t.id +
				'">❌ Reject</button>' +
				"</div></div>"
		}
		container.innerHTML = html

		// Bind approval action buttons
		container.querySelectorAll("[data-action]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var action = btn.getAttribute("data-action")
				var taskId = btn.getAttribute("data-task-id")
				handleApprovalAction(action, taskId)
			})
		})
	}

	function renderDeployList() {
		var container = $("deploy-list")
		if (!container) return

		var items = state.deployments.slice(0, 3)
		if (items.length === 0) {
			items = [
				{ name: "superroo2 (Production)", version: "v2.6.4", ago: "1h", status: "healthy" },
				{ name: "superroo2 (Staging)", version: "v2.6.3", ago: "3h", status: "healthy" },
				{ name: "alpha.example.com", version: "v2.6.2", ago: "6h", status: "warnings" },
			]
		}

		var html = ""
		for (var i = 0; i < items.length; i++) {
			var d = items[i]
			var statusClass = d.status === "warnings" || d.status === "warning" ? "warn" : "healthy"
			var statusLabel = d.status === "warnings" || d.status === "warning" ? "WARNINGS" : "HEALTHY"
			html +=
				'<div class="deploy">' +
				'<span style="color:var(--accent-green)">✓</span>' +
				"<div><b>" +
				escapeHtml(d.name || d.project || "Unknown") +
				"</b>" +
				"<p>" +
				(d.version || "") +
				" · Deployed " +
				(d.ago || "recently") +
				"</p></div>" +
				'<span class="' +
				statusClass +
				'">' +
				statusLabel +
				"</span>" +
				'<span style="color:var(--text-muted);font-size:16px">↗</span></div>'
		}
		container.innerHTML = html
	}

	function renderDeployHistory() {
		var container = $("deploy-history")
		if (!container) return

		if (state.deployments.length === 0) {
			container.innerHTML =
				'<div class="card" style="padding:24px;text-align:center;color:var(--text-muted)">No deployments yet.</div>'
			return
		}

		var html = '<div class="card"><div class="card-head"><h3>Deployment History</h3></div>'
		for (var i = 0; i < state.deployments.length; i++) {
			var d = state.deployments[i]
			html +=
				'<div class="deploy" style="padding:12px 20px">' +
				'<span style="color:' +
				(d.success ? "var(--accent-green)" : "var(--accent-red)") +
				'">' +
				(d.success ? "✓" : "✗") +
				"</span>" +
				"<div><b>" +
				escapeHtml(d.environment || "Unknown") +
				"</b>" +
				"<p>" +
				(d.version || "") +
				" · " +
				(d.timestamp || "") +
				"</p></div>" +
				'<span class="' +
				(d.success ? "healthy" : "warn") +
				'">' +
				(d.success ? "SUCCESS" : "FAILED") +
				"</span></div>"
		}
		html += "</div>"
		container.innerHTML = html
	}

	function renderSavepointList() {
		var container = $("savepoint-list")
		if (!container) return

		if (state.savepoints.length === 0) {
			container.innerHTML =
				'<div class="card" style="padding:24px;text-align:center;color:var(--text-muted)">No savepoints yet. Savepoints are created automatically before coding tasks.</div>'
			return
		}

		var html = ""
		for (var i = 0; i < state.savepoints.length; i++) {
			var sp = state.savepoints[i]
			html +=
				'<div class="savepoint-card">' +
				'<div class="savepoint-info">' +
				"<h4>" +
				escapeHtml(sp.id || "SP-" + (i + 1)) +
				"</h4>" +
				"<p>" +
				escapeHtml(sp.description || "Before: " + (sp.taskTitle || "Unknown task")) +
				"</p>" +
				'<p style="font-size:11px;color:var(--text-muted);margin-top:4px">' +
				(sp.status || "Safe") +
				" · Expires: " +
				(sp.expires || "24h") +
				"</p></div>" +
				'<div class="savepoint-actions">' +
				'<button class="btn-restore" data-savepoint="' +
				sp.id +
				'">⏪ Restore</button>' +
				"</div></div>"
		}
		container.innerHTML = html

		container.querySelectorAll(".btn-restore").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var spId = btn.getAttribute("data-savepoint")
				handleRollback(spId)
			})
		})
	}

	function renderProjectsList() {
		var container = $("projects-list")
		if (!container) return

		if (state.projects.length === 0) {
			container.innerHTML =
				'<div class="card" style="padding:24px;text-align:center;color:var(--text-muted)">No projects found.</div>'
			return
		}

		var html = ""
		for (var i = 0; i < state.projects.length; i++) {
			var p = state.projects[i]
			html +=
				'<div class="project-card">' +
				"<div><h4>" +
				escapeHtml(p.name || "Project " + (i + 1)) +
				"</h4>" +
				"<p>" +
				escapeHtml(p.description || "") +
				"</p></div>" +
				(p.is_active
					? '<span class="active-badge">ACTIVE</span>'
					: '<button class="btn-view-diff" style="padding:6px 14px;font-size:12px" data-project-id="' +
						p.id +
						'">Select</button>') +
				"</div>"
		}
		container.innerHTML = html
	}

	function renderAgentsGrid() {
		var container = $("agents-grid")
		if (!container) return

		var defaultAgents = [
			{ name: "Coder", icon: "💻", desc: "Write and modify code" },
			{ name: "Consultant", icon: "🧠", desc: "Research and advise" },
			{ name: "Tester", icon: "🧪", desc: "Run and write tests" },
			{ name: "Deployer", icon: "🚀", desc: "Deploy to environments" },
			{ name: "Bug Hunter", icon: "🐛", desc: "Find and fix bugs" },
		]

		var agents = state.agents.length > 0 ? state.agents : defaultAgents
		var html = ""
		for (var i = 0; i < agents.length; i++) {
			var a = agents[i]
			html +=
				'<div class="agent-info-card">' +
				"<b>" +
				(a.icon || "🤖") +
				"</b>" +
				"<h4>" +
				escapeHtml(a.name || a.id || "Agent") +
				"</h4>" +
				"<p>" +
				escapeHtml(a.description || a.desc || "") +
				"</p></div>"
		}
		container.innerHTML = html
	}

	function renderLogs() {
		var container = $("logs-container")
		if (!container) return

		if (state.logs.length === 0) {
			container.innerHTML =
				'<div class="card" style="padding:24px;text-align:center;color:var(--text-muted)">No log entries yet.</div>'
			return
		}

		var html = ""
		for (var i = Math.max(0, state.logs.length - 20); i < state.logs.length; i++) {
			var log = state.logs[i]
			var level = log.level || "info"
			html +=
				'<div class="log-entry">' +
				'<span class="log-time">' +
				escapeHtml(log.timestamp || "") +
				"</span>" +
				'<span class="log-level ' +
				level +
				'">[' +
				level.toUpperCase() +
				"]</span>" +
				escapeHtml(log.message || "") +
				"</div>"
		}
		container.innerHTML = html
	}

	// ─── Action Handlers ──────────────────────────────────────────────

	async function handleApprovalAction(action, taskId) {
		hapticSuccess()
		var result = null
		if (action === "approve") {
			result = await apiPost("/telegram/tasks/" + taskId + "/approve")
		} else if (action === "reject") {
			result = await apiPost("/telegram/tasks/" + taskId + "/reject")
		} else if (action === "diff") {
			// Open diff in new tab or show inline
			window.open(API_BASE + "/telegram/tasks/" + taskId + "/diff", "_blank")
			return
		}

		if (result && result.success) {
			await fetchTasks()
		}
	}

	async function handleRollback(savepointId) {
		if (!confirm("Are you sure you want to restore savepoint " + savepointId + "?")) return
		hapticWarning()
		var result = await apiPost("/telegram/rollback", { savepointId: savepointId })
		if (result && result.success) {
			await fetchSavepoints()
		}
	}

	async function createTask() {
		var description = $("task-description")
		var selectedAgent = document.querySelector(".agent-card.selected")
		if (!description || !description.value.trim()) {
			alert("Please enter a task description")
			return
		}

		var agent = selectedAgent ? selectedAgent.getAttribute("data-agent") : "coder"
		hapticSuccess()

		var result = await apiPost("/telegram/tasks/create", {
			instruction: description.value.trim(),
			agent: agent,
		})

		if (result && result.success) {
			description.value = ""
			showPage("dashboard")
			await fetchAll()
		} else {
			alert("Failed to create task. Please try again.")
		}
	}

	async function askConsultant() {
		var question = $("consultant-question")
		var response = $("consultant-response")
		if (!question || !question.value.trim()) {
			alert("Please enter a question")
			return
		}

		hapticSuccess()
		response.innerHTML = '<div style="text-align:center;color:var(--text-muted)">Thinking...</div>'

		var result = await apiPost("/telegram/consultant", {
			question: question.value.trim(),
		})

		if (result && result.answer) {
			response.innerHTML = escapeHtml(result.answer)
		} else {
			response.innerHTML = "Sorry, I couldn't process your question. Please try again."
		}
	}

	async function analyzeBug() {
		var description = $("bug-description")
		if (!description || !description.value.trim()) {
			alert("Please describe the bug")
			return
		}

		hapticSuccess()
		var result = await apiPost("/telegram/bug-hunt", {
			description: description.value.trim(),
		})

		if (result && result.analysis) {
			showPage("dashboard")
			await fetchAll()
		}
	}

	async function deployTo(environment) {
		hapticWarning()
		var result = await apiPost("/telegram/deploy", {
			environment: environment,
		})

		if (result && result.success) {
			await fetchDeployments()
		}
	}

	// ─── Session Timer ────────────────────────────────────────────────

	function startSessionTimer() {
		if (state.sessionInterval) clearInterval(state.sessionInterval)
		state.sessionInterval = setInterval(function () {
			state.sessionTimer--
			if (state.sessionTimer <= 0) {
				state.sessionTimer = 0
				clearInterval(state.sessionInterval)
			}
			updateSessionDisplay()
		}, 1000)
		updateSessionDisplay()
	}

	function updateSessionDisplay() {
		var el = $("session-timer-value")
		if (!el) return
		var mins = Math.floor(state.sessionTimer / 60)
		var secs = state.sessionTimer % 60
		el.textContent = String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
	}

	function extendSession() {
		state.sessionTimer = 30 * 60 // 30 more minutes
		hapticSuccess()
		apiPost("/telegram/session/extend").catch(function () {})
	}

	// ─── Polling ──────────────────────────────────────────────────────

	function startPolling() {
		if (state.pollInterval) clearInterval(state.pollInterval)
		state.pollInterval = setInterval(fetchAll, POLL_INTERVAL)
	}

	// ─── Utility ──────────────────────────────────────────────────────

	function escapeHtml(str) {
		if (!str) return ""
		var div = document.createElement("div")
		div.textContent = str
		return div.innerHTML
	}

	// ─── Initialization ───────────────────────────────────────────────

	function init() {
		// Parse URL params
		var params = new URLSearchParams(window.location.search)
		state.telegramUserId = params.get("telegram_id") || null
		state.chatId = params.get("chat_id") || null

		console.log("[tg-miniapp] Initialized with chat_id=" + state.chatId + ", telegram_id=" + state.telegramUserId)

		// ── Navigation ──
		document.querySelectorAll(".nav-btn").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var page = btn.getAttribute("data-page")
				if (page) showPage(page)
			})
		})

		// ── Close Button ──
		var closeBtn = $("btn-close-miniapp")
		if (closeBtn) {
			closeBtn.addEventListener("click", function () {
				try {
					if (tg) tg.close()
					else window.close()
				} catch (e) {
					window.close()
				}
			})
		}

		// ── Refresh Button ──
		var refreshBtn = $("btn-refresh")
		if (refreshBtn) {
			refreshBtn.addEventListener("click", function () {
				hapticSuccess()
				fetchAll()
			})
		}

		// ── Go to Approvals ──
		var goApprovals = $("btn-go-approvals")
		if (goApprovals) {
			goApprovals.addEventListener("click", function () {
				showPage("approvals")
			})
		}

		// ── Create Task ──
		var createBtn = $("btn-create-task")
		if (createBtn) {
			createBtn.addEventListener("click", createTask)
		}

		// ── Agent Selection ──
		document.querySelectorAll(".agent-card").forEach(function (card) {
			card.addEventListener("click", function () {
				document.querySelectorAll(".agent-card").forEach(function (c) {
					c.classList.remove("selected")
				})
				card.classList.add("selected")
			})
		})

		// ── Quick Actions ──
		document.querySelectorAll(".action-btn").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var action = btn.getAttribute("data-action")
				if (action === "new-task") showPage("new-task")
				else if (action === "consultant") showPage("consultant")
				else if (action === "run-tests") {
					hapticSuccess()
					apiPost("/telegram/tasks/run-tests").then(function () {
						fetchTasks()
					})
				} else if (action === "deploy") showPage("deployments")
				else if (action === "rollback") showPage("rollback")
				else if (action === "logs") showPage("logs")
			})
		})

		// ── Consultant ──
		var askBtn = $("btn-ask-consultant")
		if (askBtn) {
			askBtn.addEventListener("click", askConsultant)
		}

		// ── Bug Hunter ──
		var huntBtn = $("btn-hunt-bug")
		if (huntBtn) {
			huntBtn.addEventListener("click", analyzeBug)
		}

		// ── Deploy Buttons ──
		var deployStaging = $("btn-deploy-staging")
		var deployProduction = $("btn-deploy-production")
		if (deployStaging)
			deployStaging.addEventListener("click", function () {
				deployTo("staging")
			})
		if (deployProduction)
			deployProduction.addEventListener("click", function () {
				deployTo("production")
			})

		// ── Extend Session ──
		var extendBtn = $("btn-extend-session")
		if (extendBtn) {
			extendBtn.addEventListener("click", extendSession)
		}

		// ── Start Session Timer ──
		startSessionTimer()

		// ── Initial Data Fetch ──
		fetchAll()

		// ── Start Polling ──
		startPolling()

		console.log("[tg-miniapp] Dashboard initialized successfully")
	}

	// ─── Boot ─────────────────────────────────────────────────────────

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init)
	} else {
		init()
	}
})()
