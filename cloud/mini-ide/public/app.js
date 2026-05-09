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
				`Welcome, ${name}! Open a workspace, edit files, send coding instructions, and approve agent changes inside Telegram.`
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
