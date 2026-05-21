/**
 * SuperRoo Mini IDE — Frontend v3 (Unified API)
 *
 * Supports BOTH /api/* (Mini IDE) and /ide-workspace/* (Dashboard) backends.
 * Auto-detects which API is available and adapts data shapes.
 *
 * Layout: VS Code:-like (activity bar, sidebar, tabs, panel, status bar).
 */

// ── State ────────────────────────────────────────────────────────────────────

const state = {
	workspaces: [],
	active: null,
	files: [],
	openFiles: [],
	activeFilePath: null,
	code: "",
	logs: [],
	prompt: "",
	attachments: [],
	editor: null,
	editorReady: false,
	telegramUser: null,
	tasks: [],
	agentMode: "auto",
	brain: {
		activeTab: "command",
		plan: null,
		feedback: null,
		errors: [],
		fixes: [],
		memory: null,
		loading: false,
	},
	terminal: {
		visible: true,
		output: [],
		outputBlocks: [],
		collapsedBlocks: new Set(),
		history: [],
		historyIndex: -1,
		recentCommands: [],
	},
	panel: "terminal",
	panelCollapsed: false,
	sidebarView: "explorer",
	searchQuery: "",
	searchResults: [],
	gitStatus: [],
	isRecording: false,
	recordings: [],
	// Dashboard-synced fields
	repoName: "",
	branch: "main",
	pipeline: [],
	chatMessages: [],
	terminalSessions: [],
	settings: {
		fontSize: 13,
		wordWrap: "on",
		theme: "dark",
		minimap: true,
	},
	collapsedFolders: new Set(),
}

// ── API Mode Detection ───────────────────────────────────────────────────────

const API_BASE = (() => {
	if (window.location.pathname.startsWith("/tg/")) return "/tg"
	const params = new URLSearchParams(window.location.search)
	if (params.get("api_base")) return params.get("api_base")
	return ""
})()

let apiMode = "mini" // "mini" | "dashboard"

async function detectApiMode() {
	try {
		const res = await fetch(`${API_BASE}/ide-workspace/workspace`, {
			headers: { "Content-Type": "application/json" },
		})
		if (res.ok) {
			apiMode = "dashboard"
			console.log("[API] Dashboard mode detected (/ide-workspace/*)")
			return
		}
	} catch {}
	apiMode = "mini"
	console.log("[API] Mini IDE mode detected (/api/*)")
}

function getTelegramInitData() {
	if (window.Telegram?.WebApp?.initData) return window.Telegram.WebApp.initData
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
	if (!initData) {
		const token = localStorage.getItem("superroo_auth_token")
		if (token) headers["Authorization"] = `Bearer ${token}`
	}
	if (options.body instanceof FormData) delete headers["Content-Type"]

	try {
		const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
		if (!res.ok) {
			const text = await res.text()
			throw new Error(text || `Request failed: ${res.status}`)
		}
		return await res.json()
	} catch (err) {
		console.error(`[API] ${path} failed:`, err.message)
		throw err
	}
}

// Dashboard-style request helpers
async function dashRequest(path, options = {}) {
	return apiRequest(`/ide-workspace${path}`, options)
}

// ── Monaco ───────────────────────────────────────────────────────────────────

function loadSettings() {
	try {
		const raw = localStorage.getItem("miniide_settings")
		if (raw) {
			const parsed = JSON.parse(raw)
			state.settings = { ...state.settings, ...parsed }
		}
	} catch {}
}

function saveSettings() {
	try {
		localStorage.setItem("miniide_settings", JSON.stringify(state.settings))
	} catch {}
}

function applySettings() {
	const s = state.settings
	// Update DOM inputs
	const fontInput = document.getElementById("setting-fontsize")
	const wrapInput = document.getElementById("setting-wordwrap")
	const themeInput = document.getElementById("setting-theme")
	const minimapInput = document.getElementById("setting-minimap")
	if (fontInput) fontInput.value = s.fontSize
	if (wrapInput) wrapInput.value = s.wordWrap
	if (themeInput) themeInput.value = s.theme
	if (minimapInput) minimapInput.value = s.minimap ? "on" : "off"

	// Apply to Monaco
	if (state.editor && state.editorReady) {
		state.editor.updateOptions({
			fontSize: s.fontSize,
			wordWrap: s.wordWrap,
			minimap: { enabled: s.minimap },
		})
		monaco.editor.setTheme(s.theme === "light" ? "vs" : "vs-dark")
	}

	// Apply theme to body
	document.body.classList.toggle("theme-light", s.theme === "light")
}

function initEditor() {
	loadSettings()
	require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" } })
	require(["vs/editor/editor.main"], function () {
		const s = state.settings
		state.editor = monaco.editor.create(document.getElementById("editor-container"), {
			value: "",
			language: "plaintext",
			theme: s.theme === "light" ? "vs" : "vs-dark",
			minimap: { enabled: s.minimap },
			fontSize: s.fontSize,
			fontFamily: "'JetBrains Mono', 'Fira Code:', monospace",
			lineNumbers: "on",
			scrollBeyondLastLine: false,
			automaticLayout: true,
			tabSize: 2,
			wordWrap: s.wordWrap,
			padding: { top: 12 },
		})
		state.editorReady = true

		state.editor.onDidChangeCursorPosition((e) => {
			updateStatusCursor(e.position.lineNumber, e.position.column)
		})

		state.editor.onDidChangeModelContent(() => {
			markDirty(state.activeFilePath, true)
			triggerAutoSave()
		})

		state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			saveFile()
		})

		// Apply any saved settings now that Monaco is ready
		applySettings()
	})
}

function initSettingsListeners() {
	const fontInput = document.getElementById("setting-fontsize")
	const wrapInput = document.getElementById("setting-wordwrap")
	const themeInput = document.getElementById("setting-theme")
	const minimapInput = document.getElementById("setting-minimap")

	if (fontInput) {
		fontInput.addEventListener("change", () => {
			state.settings.fontSize = Math.max(8, Math.min(32, Number(fontInput.value) || 13))
			saveSettings()
			applySettings()
		})
	}
	if (wrapInput) {
		wrapInput.addEventListener("change", () => {
			state.settings.wordWrap = wrapInput.value
			saveSettings()
			applySettings()
		})
	}
	if (themeInput) {
		themeInput.addEventListener("change", () => {
			state.settings.theme = themeInput.value
			saveSettings()
			applySettings()
		})
	}
	if (minimapInput) {
		minimapInput.addEventListener("change", () => {
			state.settings.minimap = minimapInput.value === "on"
			saveSettings()
			applySettings()
		})
	}
}

window.resetSettings = function () {
	state.settings = { fontSize: 13, wordWrap: "on", theme: "dark", minimap: true }
	saveSettings()
	applySettings()
	showNotice("🔄 Settings reset")
}

// ── Activity Bar ─────────────────────────────────────────────────────────────

function initActivityBar() {
	document.querySelectorAll(".activity-bar-item[data-view]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const view = btn.dataset.view
			toggleSidebarView(view)
		})
	})
}

function toggleSidebarView(view) {
	state.sidebarView = view
	document
		.querySelectorAll(".activity-bar-item")
		.forEach((b) => b.classList.toggle("active", b.dataset.view === view))
	document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `sidebar-${view}`))
	if (view === "brain") loadBrainMemory()
	if (view === "explorer") renderFileTree()
	if (view === "git") refreshGitStatus()
}

// ── Workspaces ─────────────────────────────────────────────────────────────────

async function loadWorkspaces() {
	if (apiMode === "dashboard") {
		try {
			const data = await dashRequest("/workspace")
			state.repoName = data.repoName || "superroo2"
			state.branch = data.branch || "main"
			state.pipeline = data.pipeline || []
			state.chatMessages = data.chatMessages || []
			state.terminalSessions = data.terminalSessions || []
			state.files = flattenFiles(data.files || [])
			// Create a synthetic workspace
			state.workspaces = [
				{
					id: state.repoName,
					name: state.repoName,
					repo: state.repoName,
					status: "Running",
					branch: state.branch,
					agents: 0,
					bugs: 0,
				},
			]
			updateStatusBranch(state.branch)
			renderPipeline()
			renderChatHistory()
			return
		} catch (err) {
			console.warn("[Workspaces] Dashboard API failed, falling back:", err.message)
		}
	}

	// Mini mode fallback
	try {
		const data = await apiRequest("/api/workspaces")
		state.workspaces = data.workspaces || []
	} catch (err) {
		console.warn("[Workspaces] API failed, using demo data:", err.message)
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
}

function flattenFiles(tree) {
	const result = []
	function walk(nodes) {
		for (const node of nodes || []) {
			if (node.kind === "file") result.push(node.path.replace(/^\//, ""))
			if (node.children) walk(node.children)
		}
	}
	walk(tree)
	return result
}

function renderWorkspaces() {
	const list = document.getElementById("workspace-list-sidebar")
	if (!list) return
	list.innerHTML = state.workspaces
		.map((ws) => {
			const isActive = state.active?.id === ws.id
			return `
				<div class="ws-sidebar-item ${isActive ? "active" : ""}" onclick="selectWorkspace('${ws.id}')">
					<span class="ws-status ${ws.status === "Running" ? "running" : "idle"}"></span>
					<span class="ws-name">${escapeHtml(ws.name)}</span>
				</div>
			`
		})
		.join("")
}

window.selectWorkspace = async function (id) {
	const ws = state.workspaces.find((w) => w.id === id)
	if (!ws) return
	state.active = ws
	renderWorkspaces()

	const sub = document.getElementById("sidebar-workspace-name")
	if (sub) sub.textContent = ws.repo

	updateStatusBranch(ws.branch)

	if (apiMode === "dashboard") {
		// Files already loaded in loadWorkspaces
		renderFileTree()
		if (state.files.length > 0 && !state.activeFilePath) {
			openFile(state.files[0])
		}
	} else {
		await loadFiles(ws.id)
	}
	connectWebSocket()
}

// ── Sidebar: File Tree ───────────────────────────────────────────────────────

async function loadFiles(workspaceId) {
	try {
		const data = await apiRequest(`/api/workspaces/${workspaceId}/files`)
		state.files = data.files || []
	} catch {
		state.files = ["src/app.tsx", "src/lib/utils.ts", "package.json", "README.md"]
	}
	renderFileTree()
	if (state.files.length > 0 && !state.activeFilePath) {
		openFile(state.files[0])
	}
}

function buildTree(paths) {
	const root = { name: "", children: {} }
	paths.forEach((p) => {
		const parts = p.split("/")
		let node = root
		parts.forEach((part, i) => {
			if (!node.children[part]) {
				node.children[part] = {
					name: part,
					path: parts.slice(0, i + 1).join("/"),
					children: {},
					isFile: i === parts.length - 1,
				}
			}
			node = node.children[part]
		})
	})
	return root
}

function renderTreeNode(node, depth = 0) {
	if (node.name === "") {
		return Object.values(node.children)
			.sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
			.map((c) => renderTreeNode(c, depth))
			.join("")
	}
	if (!node.isFile) {
		const isExpanded = !state.collapsedFolders.has(node.path)
		const childrenHtml = isExpanded
			? Object.values(node.children)
					.sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
					.map((c) => renderTreeNode(c, depth + 1))
					.join("")
			: ""
		const chevron = isExpanded ? "▼" : "▶"
		return `
			<div class="file-tree-item folder-item" onclick="toggleFolder('${node.path.replace(/'/g, "\\'")}')" style="padding-left:${12 + depth * 14}px">
				<span class="folder-chevron">${chevron}</span>
				<span class="icon">📁</span>
				<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(node.name)}</span>
			</div>
			${childrenHtml}
		`
	}
	const isActive = state.activeFilePath === node.path
	const icon = getFileIcon(node.name)
	return `
		<div class="file-tree-item ${isActive ? "active" : ""}" onclick="openFile('${node.path.replace(/'/g, "\\'")}')" oncontextmenu="event.preventDefault();showFileContextMenu(event,'${node.path.replace(/'/g, "\\'")}')" style="padding-left:${12 + depth * 14}px">
			<span class="folder-chevron" style="visibility:hidden">▶</span>
			<span class="icon">${icon}</span>
			<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(node.name)}</span>
			<span class="file-tree-actions" onclick="event.stopPropagation();deleteFile('${node.path.replace(/'/g, "\\'")}')">✕</span>
		</div>
	`
}

window.toggleFolder = function (folderPath) {
	if (state.collapsedFolders.has(folderPath)) {
		state.collapsedFolders.delete(folderPath)
	} else {
		state.collapsedFolders.add(folderPath)
	}
	renderFileTree()
}

function renderFileTree() {
	const tree = document.getElementById("file-tree")
	if (!tree) return
	const root = buildTree(state.files)
	tree.innerHTML = renderTreeNode(root)
}

window.refreshFileTree = async function () {
	if (apiMode === "dashboard") {
		await loadWorkspaces()
	} else if (state.active) {
		await loadFiles(state.active.id)
	}
	renderFileTree()
	showNotice("🔄 Refreshed")
}

function promptModal(title, placeholder, onConfirm) {
	const overlay = document.createElement("div")
	overlay.className = "prompt-modal-overlay"
	overlay.innerHTML = `
		<div class="prompt-modal-box">
			<h3>${escapeHtml(title)}</h3>
			<input type="text" id="prompt-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
			<div class="prompt-modal-actions">
				<button class="btn secondary small" id="prompt-cancel">Cancel</button>
				<button class="btn primary small" id="prompt-ok">OK</button>
			</div>
		</div>
	`
	document.body.appendChild(overlay)
	const input = overlay.querySelector("#prompt-input")
	input.focus()
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			confirm()
		}
		if (e.key === "Escape") {
			cancel()
		}
	})
	function cleanup() {
		overlay.remove()
	}
	function confirm() {
		const value = input.value.trim()
		cleanup()
		if (value) onConfirm(value)
	}
	function cancel() {
		cleanup()
	}
	overlay.querySelector("#prompt-ok").addEventListener("click", confirm)
	overlay.querySelector("#prompt-cancel").addEventListener("click", cancel)
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) cancel()
	})
}

window.createNewFile = function () {
	if (!state.active && apiMode !== "dashboard") {
		showNotice("❌ No workspace selected", true)
		return
	}
	promptModal("New File", "path/to/file.ts", async (name) => {
		try {
			if (apiMode === "dashboard") {
				await dashRequest("/file/create", { method: "POST", body: JSON.stringify({ path: "/" + name }) })
			} else {
				await apiRequest(`/api/workspaces/${state.active.id}/file/create`, {
					method: "POST",
					body: JSON.stringify({ path: name }),
				})
			}
			state.files.push(name)
			renderFileTree()
			openFile(name)
			showNotice(`📄 Created ${name}`)
		} catch (err) {
			showNotice(`❌ ${err.message}`, true)
		}
	})
}

window.createNewFolder = function () {
	if (!state.active && apiMode !== "dashboard") {
		showNotice("❌ No workspace selected", true)
		return
	}
	promptModal("New Folder", "path/to/folder", async (name) => {
		try {
			if (apiMode === "dashboard") {
				await dashRequest("/folder/create", { method: "POST", body: JSON.stringify({ path: "/" + name }) })
			} else {
				await apiRequest(`/api/workspaces/${state.active.id}/folder/create`, {
					method: "POST",
					body: JSON.stringify({ path: name }),
				})
			}
			await refreshFileTree()
			showNotice(`📁 Created ${name}`)
		} catch (err) {
			showNotice(`❌ ${err.message}`, true)
		}
	})
}

window.deleteFile = async function (filePath) {
	if (!confirm(`Delete "${filePath.split("/").pop()}"?`)) return
	try {
		if (apiMode === "dashboard") {
			await dashRequest(`/file?path=${encodeURIComponent("/" + filePath)}`, { method: "DELETE" })
		} else {
			await apiRequest(`/api/workspaces/${state.active.id}/file?path=${encodeURIComponent(filePath)}`, {
				method: "DELETE",
			})
		}
		state.files = state.files.filter((f) => f !== filePath)
		const openIdx = state.openFiles.findIndex((f) => f.path === filePath)
		if (openIdx !== -1) {
			state.openFiles.splice(openIdx, 1)
			if (state.activeFilePath === filePath) {
				state.activeFilePath = state.openFiles.length > 0 ? state.openFiles[0].path : null
				if (state.activeFilePath) activateTab(state.activeFilePath)
				else {
					state.editor?.setValue("")
					document.getElementById("editor-placeholder")?.classList.remove("hidden")
					renderTabs()
				}
			} else {
				renderTabs()
			}
		}
		renderFileTree()
		showNotice(`🗑 Deleted ${filePath.split("/").pop()}`)
	} catch (err) {
		showNotice(`❌ ${err.message}`, true)
	}
}

window.showFileContextMenu = function (event, filePath) {
	const existing = document.querySelector(".context-menu")
	if (existing) existing.remove()
	const menu = document.createElement("div")
	menu.className = "context-menu"
	menu.style.left = event.pageX + "px"
	menu.style.top = event.pageY + "px"
	menu.innerHTML = `
		<div class="context-menu-item" onclick="openFile('${filePath.replace(/'/g, "\\'")}');document.querySelector('.context-menu')?.remove()">Open</div>
		<div class="context-menu-item" onclick="deleteFile('${filePath.replace(/'/g, "\\'")}');document.querySelector('.context-menu')?.remove()">Delete</div>
		<div class="context-menu-separator"></div>
		<div class="context-menu-item" onclick="navigator.clipboard.writeText('${filePath.replace(/'/g, "\\'")}');document.querySelector('.context-menu')?.remove()">Copy Path</div>
	`
	document.body.appendChild(menu)
	const closeMenu = () => {
		menu.remove()
		document.removeEventListener("click", closeMenu)
	}
	setTimeout(() => document.addEventListener("click", closeMenu), 0)
}

// ── Search ───────────────────────────────────────────────────────────────────

window.runSearch = async function () {
	const input = document.getElementById("search-input")
	if (!input) return
	const q = input.value.trim()
	if (!q) return
	const resultsEl = document.getElementById("search-results")
	if (resultsEl) resultsEl.innerHTML = '<p class="sidebar-empty">Searching...</p>'
	try {
		const data = await dashRequest(`/search?q=${encodeURIComponent(q)}`)
		const results = data.results || []
		if (results.length === 0) {
			if (resultsEl) resultsEl.innerHTML = '<p class="sidebar-empty">No results</p>'
			return
		}
		if (resultsEl) {
			resultsEl.innerHTML = results
				.map((r) => {
					const fileName = r.file.split("/").pop()
					const highlighted = escapeHtml(r.content).replace(
						new RegExp(`(${escapeRegExp(q)})`, "gi"),
						'<span class="qmatch">$1</span>',
					)
					return `
					<div class="search-result-item" onclick="openFile('${r.file.replace(/^\//, "").replace(/'/g, "\\'")}');if(state.editor){state.editor.setPosition({lineNumber:${r.line},column:1});state.editor.revealLineInCenter(${r.line})}">
						<div><span class="search-result-file">${escapeHtml(fileName)}</span><span class="search-result-line">:${r.line}</span></div>
						<div class="search-result-content">${highlighted}</div>
					</div>
				`
				})
				.join("")
		}
	} catch (err) {
		if (resultsEl)
			resultsEl.innerHTML = `<p class="sidebar-empty" style="color:var(--red)">Error: ${escapeHtml(err.message)}</p>`
	}
}

// ── Git ──────────────────────────────────────────────────────────────────────

window.refreshGitStatus = async function () {
	const container = document.getElementById("git-changes")
	if (!container) return
	container.innerHTML = '<p class="sidebar-empty">Loading...</p>'
	try {
		const data = await dashRequest("/git", { method: "POST", body: JSON.stringify({ action: "status" }) })
		const parsed = data.parsed
		if (!parsed || parsed.clean) {
			container.innerHTML = '<p class="sidebar-empty">No changes</p>'
			updateStatusBranch(parsed?.branch || "main")
			return
		}
		updateStatusBranch(parsed.branch)
		container.innerHTML = `
			<div class="git-branch">⎇ ${escapeHtml(parsed.branch)}</div>
			${parsed.files
				.map(
					(f) => `
				<div class="git-item" onclick="openFile('${f.path.replace(/'/g, "\\'")}')">
					<span class="git-status-dot ${f.status}"></span>
					<span class="git-item-path">${escapeHtml(f.path)}</span>
					<span style="font-size:10px;text-transform:uppercase;color:var(--text-muted)">${f.status}</span>
				</div>
			`,
				)
				.join("")}
		`
	} catch (err) {
		container.innerHTML = `<p class="sidebar-empty" style="color:var(--red)">${escapeHtml(err.message)}</p>`
	}
}

window.gitCommit = async function () {
	const message = prompt("Commit message:", "Update from Mini IDE")
	if (!message) return
	try {
		const data = await dashRequest("/git", { method: "POST", body: JSON.stringify({ action: "commit", message }) })
		showNotice(
			data.output?.includes("error") || data.output?.includes("Error")
				? `⚠️ ${data.output}`
				: `✅ ${data.output}`,
		)
		refreshGitStatus()
	} catch (err) {
		showNotice(`❌ ${err.message}`, true)
	}
}

function getFileIcon(name) {
	const ext = name.split(".").pop()?.toLowerCase()
	const map = {
		ts: "📘",
		tsx: "⚛",
		js: "📒",
		jsx: "⚛",
		py: "🐍",
		html: "🌐",
		css: "🎨",
		scss: "🎨",
		json: "📋",
		md: "📝",
		yml: "⚙",
		yaml: "⚙",
		dockerfile: "🐳",
		env: "🔑",
		gitignore: "🙈",
		sh: "⌨",
		sql: "🗄",
	}
	return map[ext] || "📄"
}

window.openFile = async function (filePath) {
	if (!state.active && apiMode !== "dashboard") return
	const existing = state.openFiles.find((f) => f.path === filePath)
	if (existing) {
		activateTab(filePath)
		return
	}
	try {
		let data
		if (apiMode === "dashboard") {
			data = await dashRequest(`/file/read?path=${encodeURIComponent("/" + filePath)}`)
		} else {
			data = await apiRequest(`/api/workspaces/${state.active.id}/file?path=${encodeURIComponent(filePath)}`)
		}
		const content = data.content || ""
		const lang = data.language || detectLang(filePath)
		state.openFiles.push({ path: filePath, content, language: lang, dirty: false })
		activateTab(filePath)
	} catch {
		showNotice(`❌ Failed to open ${filePath}`, true)
	}
}

function activateTab(filePath) {
	state.activeFilePath = filePath
	const file = state.openFiles.find((f) => f.path === filePath)
	if (!file) return

	renderTabs()
	renderFileTree()

	if (state.editor && state.editorReady) {
		monaco.editor.setModelLanguage(state.editor.getModel(), file.language)
		state.editor.setValue(file.content)
		document.getElementById("editor-placeholder")?.classList.add("hidden")
	}

	const bc = document.getElementById("breadcrumbs")
	if (bc)
		bc.innerHTML = filePath
			.split("/")
			.map((p) => `<span class="bc-item">${escapeHtml(p)}</span>`)
			.join('<span style="color:var(--text-muted)"> / </span>')

	updateStatusLang(file.language)
}

function closeTab(filePath) {
	const file = state.openFiles.find((f) => f.path === filePath)
	if (file && file.dirty) {
		if (!confirm(`"${file.path.split("/").pop()}" has unsaved changes. Close without saving?`)) {
			return
		}
	}
	const idx = state.openFiles.findIndex((f) => f.path === filePath)
	if (idx === -1) return
	state.openFiles.splice(idx, 1)
	if (state.activeFilePath === filePath) {
		state.activeFilePath =
			state.openFiles.length > 0 ? state.openFiles[Math.min(idx, state.openFiles.length - 1)].path : null
		if (state.activeFilePath) activateTab(state.activeFilePath)
		else {
			state.editor?.setValue("")
			document.getElementById("editor-placeholder")?.classList.remove("hidden")
			renderTabs()
		}
	} else {
		renderTabs()
	}
}

function markDirty(filePath, dirty) {
	const file = state.openFiles.find((f) => f.path === filePath)
	if (file) file.dirty = dirty
	renderTabs()
}

function renderTabs() {
	const scroll = document.getElementById("tab-bar-scroll")
	if (!scroll) return
	scroll.innerHTML = state.openFiles
		.map((f) => {
			const active = f.path === state.activeFilePath
			const name = f.path.split("/").pop()
			return `
				<button class="tab-item ${active ? "active" : ""}" onclick="activateTab('${f.path.replace(/'/g, "\\'")}')">
					${f.dirty ? '<span class="tab-dirty">●</span>' : ""}
					<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</span>
					<span class="tab-close" onclick="event.stopPropagation();closeTab('${f.path.replace(/'/g, "\\'")}')">✕</span>
				</button>
			`
		})
		.join("")
}

window.activateTab = activateTab
window.closeTab = closeTab

function detectLang(path) {
	const ext = path.split(".").pop()?.toLowerCase()
	const map = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		py: "python",
		html: "html",
		css: "css",
		scss: "scss",
		json: "json",
		md: "markdown",
		yaml: "yaml",
		yml: "yaml",
		sql: "sql",
		sh: "shell",
		dockerfile: "dockerfile",
	}
	return map[ext] || "plaintext"
}

// ── Auto-save ────────────────────────────────────────────────────────────────

let autoSaveTimer = null
const AUTO_SAVE_DELAY_MS = 2000

function triggerAutoSave() {
	if (autoSaveTimer) clearTimeout(autoSaveTimer)
	autoSaveTimer = setTimeout(() => {
		const file = state.openFiles.find((f) => f.path === state.activeFilePath)
		if (file && file.dirty) {
			saveFile().catch(() => {})
		}
	}, AUTO_SAVE_DELAY_MS)
}

function hasUnsavedChanges() {
	return state.openFiles.some((f) => f.dirty)
}

// ── Save ─────────────────────────────────────────────────────────────────────

window.saveFile = async function () {
	if (!state.activeFilePath) return
	const file = state.openFiles.find((f) => f.path === state.activeFilePath)
	if (!file) return
	const content = state.editor ? state.editor.getValue() : file.content
	try {
		if (apiMode === "dashboard") {
			await dashRequest("/file/save", {
				method: "POST",
				body: JSON.stringify({ path: "/" + state.activeFilePath, content }),
			})
		} else {
			await apiRequest(`/api/workspaces/${state.active.id}/file`, {
				method: "POST",
				body: JSON.stringify({ path: state.activeFilePath, content }),
			})
		}
		file.content = content
		markDirty(state.activeFilePath, false)
		showNotice("✅ Saved")
	} catch (err) {
		showNotice(`❌ Save failed: ${err.message}`, true)
	}
}

// ── Bottom Panel ─────────────────────────────────────────────────────────────

window.switchBottomPanel = function (name) {
	state.panel = name
	document.querySelectorAll(".bp-tab").forEach((t) => t.classList.toggle("active", t.dataset.panel === name))
	document.querySelectorAll(".bp-content").forEach((c) => c.classList.toggle("active", c.id === `bp-${name}`))
}

window.toggleBottomPanel = function () {
	state.panelCollapsed = !state.panelCollapsed
	document.getElementById("bottom-panel").classList.toggle("hidden", state.panelCollapsed)
	document.querySelector(".ide-shell").classList.toggle("panel-collapsed", state.panelCollapsed)
}

window.toggleBottomPanelSize = function () {
	const bp = document.getElementById("bottom-panel")
	if (bp.style.maxHeight === "50vh") bp.style.maxHeight = "80vh"
	else bp.style.maxHeight = "50vh"
}

// ── Terminal ─────────────────────────────────────────────────────────────────

window.toggleTerminal = function () {
	if (state.panelCollapsed) {
		state.panelCollapsed = false
		document.getElementById("bottom-panel").classList.remove("hidden")
		document.querySelector(".ide-shell").classList.remove("panel-collapsed")
	}
	switchBottomPanel("terminal")
	setTimeout(() => document.getElementById("terminal-input")?.focus(), 100)
}

window.executeTerminalCommand = async function () {
	const input = document.getElementById("terminal-input")
	if (!input) return
	const cmd = input.value.trim()
	if (!cmd) return
	input.value = ""

	appendTerminal(`$ ${cmd}`, "command")
	if (apiMode === "dashboard" || state.active) {
		try {
			let res
			if (apiMode === "dashboard") {
				res = await dashRequest("/terminal/execute", {
					method: "POST",
					body: JSON.stringify({ command: cmd, terminalId: "term-1" }),
				})
			} else {
				res = await apiRequest(`/api/workspaces/${state.active.id}/command`, {
					method: "POST",
					body: JSON.stringify({ prompt: cmd, terminal: true }),
				})
			}
			const out = res.output || res.message || JSON.stringify(res, null, 2)
			if (Array.isArray(out)) {
				out.forEach((l) => appendTerminal(l, l.includes("error") || l.includes("Error") ? "error" : "output"))
			} else {
				out.split("\n").forEach((l) =>
					appendTerminal(l, l.includes("error") || l.includes("Error") ? "error" : "output"),
				)
			}
		} catch (err) {
			appendTerminal(`❌ ${err.message}`, "error")
		}
	} else {
		appendTerminal("❌ No workspace selected", "error")
	}
}

function appendTerminal(text, type = "output") {
	const container = document.getElementById("terminal-output")
	if (!container) return
	const div = document.createElement("div")
	div.className = `term-block term-block-${type}`
	div.textContent = text
	container.appendChild(div)
	container.scrollTop = container.scrollHeight
}

window.clearTerminal = function () {
	const el = document.getElementById("terminal-output")
	if (el) el.innerHTML = ""
}

window.copyTerminal = function () {
	const el = document.getElementById("terminal-output")
	if (!el) return
	const text = Array.from(el.children)
		.map((c) => c.textContent)
		.join("\n")
	navigator.clipboard.writeText(text).then(() => showNotice("📋 Copied"))
}

window.toggleRecording = function () {
	state.isRecording = !state.isRecording
	const btn = document.getElementById("btn-rec")
	if (btn) btn.textContent = state.isRecording ? "⏹" : "⏺"
	showNotice(state.isRecording ? "⏺ Recording" : "⏹ Stopped")
}

// ── AI Chat Panel ────────────────────────────────────────────────────────────

window.sendAiChat = async function () {
	const input = document.getElementById("ai-chat-input")
	if (!input) return
	const text = input.value.trim()
	if (!text) return
	input.value = ""

	const msgs = document.getElementById("ai-chat-messages")
	if (!msgs) return

	const userBubble = document.createElement("div")
	userBubble.className = "ai-chat-bubble user"
	userBubble.innerHTML = `<div>${escapeHtml(text)}</div><div class="bubble-meta">You · ${new Date().toLocaleTimeString()}</div>`
	msgs.appendChild(userBubble)
	msgs.scrollTop = msgs.scrollHeight

	try {
		let res
		if (apiMode === "dashboard") {
			res = await dashRequest("/chat", {
				method: "POST",
				body: JSON.stringify({ message: text }),
			})
		} else if (state.active) {
			res = await apiRequest(`/api/workspaces/${state.active.id}/command`, {
				method: "POST",
				body: JSON.stringify({ prompt: text }),
			})
		} else {
			throw new Error("No workspace selected")
		}
		const reply = res.reply || res.output || res.message || "✅ Done"
		const assistantBubble = document.createElement("div")
		assistantBubble.className = "ai-chat-bubble assistant"
		assistantBubble.innerHTML = `<div>${escapeHtml(reply)}</div><div class="bubble-meta">SuperRoo · ${new Date().toLocaleTimeString()}</div>`
		msgs.appendChild(assistantBubble)
		msgs.scrollTop = msgs.scrollHeight
	} catch (err) {
		const errBubble = document.createElement("div")
		errBubble.className = "ai-chat-bubble assistant"
		errBubble.innerHTML = `<div style="color:var(--red)">❌ ${escapeHtml(err.message)}</div>`
		msgs.appendChild(errBubble)
	}
}

// ── Pipeline (dashboard mode) ──────────────────────────────────────────────────

function renderPipeline() {
	const container = document.getElementById("pipeline-container")
	if (!container) return
	if (apiMode !== "dashboard" || !state.pipeline.length) {
		container.innerHTML = '<p class="sidebar-empty">Pipeline not available</p>'
		return
	}
	container.innerHTML = state.pipeline
		.map((step) => {
			const statusIcon =
				step.status === "done" ? "✓" : step.status === "running" ? "●" : step.status === "failed" ? "✗" : "○"
			const statusColor =
				step.status === "done"
					? "var(--green)"
					: step.status === "running"
						? "var(--blue)"
						: step.status === "failed"
							? "var(--red)"
							: "var(--text-muted)"
			return `
			<div class="pipeline-step" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">
				<span style="color:${statusColor};font-weight:bold">${statusIcon}</span>
				<span style="color:var(--text-secondary)">${escapeHtml(step.label)}</span>
			</div>
		`
		})
		.join("")
}

function renderChatHistory() {
	const msgs = document.getElementById("ai-chat-messages")
	if (!msgs || apiMode !== "dashboard") return
	msgs.innerHTML = ""
	for (const msg of state.chatMessages || []) {
		const bubble = document.createElement("div")
		bubble.className = `ai-chat-bubble ${msg.role === "user" ? "user" : "assistant"}`
		const author = msg.author || (msg.role === "user" ? "You" : "SuperRoo")
		const time = msg.time || new Date().toLocaleTimeString()
		bubble.innerHTML = `<div>${escapeHtml(msg.content || "")}</div><div class="bubble-meta">${escapeHtml(author)} · ${time}</div>`
		msgs.appendChild(bubble)
	}
	msgs.scrollTop = msgs.scrollHeight
}

// ── Brain Tabs (sidebar) ─────────────────────────────────────────────────────

window.switchBrainTab = function (tab) {
	state.brain.activeTab = tab
	document.querySelectorAll(".brain-tab-s").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab))
	document.querySelectorAll(".brain-panel-s").forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${tab}-s`))
}

window.sendBrainCommand = async function () {
	const el = document.getElementById("ai-prompt")
	if (!el || !state.active) return
	const prompt = el.value.trim()
	if (!prompt) return
	el.value = ""
	showNotice("🧠 Processing...")
	try {
		const res = await apiRequest("/api/terminal-brain/plan", {
			method: "POST",
			body: JSON.stringify({ query: prompt }),
		})
		const plan = res.plan || res.commands || []
		state.brain.plan = plan
		const preview = document.getElementById("plan-preview-s")
		if (preview) {
			preview.classList.remove("hidden")
			preview.innerHTML = plan
				.map(
					(p, i) =>
						`<div style="padding:4px 0;font-size:12px;color:var(--text-secondary)">${i + 1}. ${escapeHtml(typeof p === "string" ? p : p.command || p)}</div>`,
				)
				.join("")
		}
		showNotice("✅ Plan ready")
	} catch (err) {
		showNotice(`❌ ${err.message}`, true)
	}
}

async function loadBrainMemory() {
	const container = document.getElementById("memory-container-s")
	if (!container) return
	try {
		const res = await apiRequest("/api/terminal-brain/memory")
		const mem = res.memory || res
		container.innerHTML = `<pre style="font-size:11px;color:var(--text-secondary);overflow:auto">${escapeHtml(JSON.stringify(mem, null, 2))}</pre>`
	} catch {
		container.innerHTML = '<p class="sidebar-empty">No memory yet</p>'
	}
}

// ── Quick Open ───────────────────────────────────────────────────────────────

window.showQuickOpen = function () {
	const modal = document.getElementById("quick-open")
	if (!modal) return
	modal.classList.remove("hidden")
	const input = document.getElementById("quick-open-input")
	if (input) {
		input.value = ""
		input.focus()
		filterQuickOpen("")
	}
}

window.closeQuickOpen = function () {
	document.getElementById("quick-open")?.classList.add("hidden")
}

window.filterQuickOpen = function (query) {
	const results = document.getElementById("quick-open-results")
	if (!results) return
	const q = query.toLowerCase()
	const matches = state.files.filter((f) => f.toLowerCase().includes(q)).slice(0, 20)
	results.innerHTML = matches
		.map((f) => {
			const parts = f.split(new RegExp(`(${escapeRegExp(query)})`, "gi"))
			const highlighted = parts
				.map((p) => (p.toLowerCase() === q ? `<span class="qmatch">${escapeHtml(p)}</span>` : escapeHtml(p)))
				.join("")
			return `<div class="quick-open-item" onclick="openFile('${f.replace(/'/g, "\\'")}');closeQuickOpen()">${highlighted}</div>`
		})
		.join("")
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

window.showKeyboardShortcuts = function () {
	document.getElementById("shortcuts-modal")?.classList.remove("hidden")
}

window.closeShortcutsModal = function () {
	document.getElementById("shortcuts-modal")?.classList.add("hidden")
}

window.toggleSection = function (id) {
	const el = document.getElementById(id)
	const chev = document.getElementById("chevron-" + id)
	if (el) el.classList.toggle("hidden")
	if (chev) chev.style.transform = el?.classList.contains("hidden") ? "rotate(-90deg)" : "rotate(0deg)"
}

// ── Status Bar Updates ───────────────────────────────────────────────────────

function updateStatusBranch(branch) {
	const el = document.getElementById("status-branch-text")
	if (el) el.textContent = branch || "—"
}

function updateStatusCursor(line, col) {
	const el = document.getElementById("status-cursor")
	if (el) el.textContent = `Ln ${line}, Col ${col}`
}

function updateStatusLang(lang) {
	const el = document.getElementById("status-language")
	if (el) el.textContent = lang.charAt(0).toUpperCase() + lang.slice(1)
}

// ── WebSocket ────────────────────────────────────────────────────────────────

let ws = null
let wsReconnectTimer = null

function connectWebSocket() {
	const workspaceId = state.active ? state.active.id : state.repoName || "global"
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const wsUrl = `${protocol}//${window.location.host}/ws?workspace=${workspaceId}`

	if (ws) {
		try {
			ws.close()
		} catch {}
	}

	ws = new WebSocket(wsUrl)

	ws.onopen = () => {
		updateWsStatus(true)
		if (wsReconnectTimer) {
			clearTimeout(wsReconnectTimer)
			wsReconnectTimer = null
		}
	}

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)
			if (msg.type === "terminal-output") appendTerminal(msg.line)
			if (msg.type === "log-entry") {
				state.logs.unshift(msg.log)
			}
			if (msg.type === "pipeline-update") {
				state.pipeline = msg.pipeline || []
				renderPipeline()
			}
		} catch {}
	}

	ws.onclose = () => {
		updateWsStatus(false)
		wsReconnectTimer = setTimeout(() => connectWebSocket(), 5000)
	}

	ws.onerror = () => updateWsStatus(false)
}

function updateWsStatus(connected) {
	const dot = document.getElementById("status-ws-dot")
	if (dot) dot.className = `status-dot ${connected ? "green" : "red"}`
}

// ── Uploads ──────────────────────────────────────────────────────────────────

window.uploadFiles = function () {
	document.getElementById("file-input")?.click()
}

window.handleFileSelect = async function (event) {
	const files = event.target.files
	if (!files || !files.length || !state.active) return
	const formData = new FormData()
	for (const f of files) formData.append("files", f)
	try {
		await apiRequest(`/api/workspaces/${state.active.id}/upload`, { method: "POST", body: formData })
		showNotice(`📎 ${files.length} file(s) uploaded`)
		loadFiles(state.active.id)
	} catch (err) {
		showNotice(`❌ Upload failed: ${err.message}`, true)
	}
	event.target.value = ""
}

// ── Notice ───────────────────────────────────────────────────────────────────

function showNotice(message, isError = false) {
	const el = document.getElementById("status-notify")
	if (!el) return
	el.textContent = message
	el.style.color = isError ? "var(--red)" : "var(--green)"
	setTimeout(() => {
		if (el.textContent === message) el.textContent = ""
	}, 4000)
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
	if (!str) return ""
	const div = document.createElement("div")
	div.textContent = str
	return div.innerHTML
}

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Global Keybindings ───────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === "p") {
		e.preventDefault()
		showQuickOpen()
	}
	if ((e.ctrlKey || e.metaKey) && e.key === "`") {
		e.preventDefault()
		toggleTerminal()
	}
	if ((e.ctrlKey || e.metaKey) && e.key === "b") {
		e.preventDefault()
		document.querySelector(".ide-shell").classList.toggle("sidebar-collapsed")
	}
	if ((e.ctrlKey || e.metaKey) && e.key === "j") {
		e.preventDefault()
		toggleBottomPanel()
	}
	if (e.key === "Escape") {
		closeQuickOpen()
		closeShortcutsModal()
		document.querySelector(".context-menu")?.remove()
	}
})

window.addEventListener("beforeunload", (e) => {
	if (hasUnsavedChanges()) {
		e.preventDefault()
		e.returnValue = ""
	}
})

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
	initActivityBar()
	initSettingsListeners()
	initEditor()

	try {
		await detectApiMode()
		await loadWorkspaces()
		renderWorkspaces()
		if (state.workspaces.length > 0) {
			await selectWorkspace(state.workspaces[0].id)
		}
	} catch (err) {
		console.error("[Init] Failed to load workspaces:", err)
		showNotice("⚠️ API unavailable — using demo mode", true)
	}

	// Apply settings to DOM inputs (Monaco settings are applied in initEditor callback)
	applySettings()

	document.getElementById("loading-screen")?.classList.add("hidden")
	document.getElementById("main-app")?.classList.remove("hidden")
}

init().catch((err) => {
	console.error("[Init] Fatal error:", err)
	document.getElementById("loading-screen")?.classList.add("hidden")
	document.getElementById("main-app")?.classList.remove("hidden")
	showNotice("⚠️ Init error — check console", true)
})
