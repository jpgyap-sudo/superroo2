"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
	useIde,
	type WorkspaceFile,
	type PipelineStep,
	type ChatMessage,
	type OpenFile,
	type WorkspaceTask,
	type CommandSnippet,
	type SplitTerminalTab,
	type TerminalNotification,
	type SharedTerminalSession,
	type TerminalResourceUsage,
} from "@/lib/ide-store"
import {
	apiFetch,
	saveFileContent,
	fetchFileContent,
	fetchDiff,
	sendTerminalCommand,
	importGithubRepo,
	openWorkspace,
	fetchOrchestratorStatus,
	fetchHermesStats,
	fetchDeployments,
} from "@/components/ide-terminal/api"
import { useWebSocket } from "@/components/ide-terminal/hooks/useWebSocket"
import type { BrainTab, DiffData } from "@/components/ide-terminal/types"

// ── Types ──────────────────────────────────────────────────────────────────

export interface AutocompleteSuggestion {
	text: string
	description: string
	type: "command" | "agent" | "recent" | "ai"
	label?: string
	command?: string
}

export interface BrainPlanStep {
	command: string
	description?: string
}

export interface BrainFeedback {
	status: string
	output: string
	exitCode?: number
	errors?: BrainError[]
	fixes?: BrainFix[]
}

export interface BrainError {
	type: string
	message: string
	rootCause?: string
	fix?: string
	confidence?: number
}

export interface BrainFix {
	title?: string
	type?: string
	description?: string
	fix?: string
	message?: string
}

export interface BrainMemory {
	stats?: {
		totalSessions: number
		totalCommands: number
		totalErrors: number
		successRate: number
	}
	commands?: { command: string; status: string; timestamp?: string }[]
}

export interface BrainDeployment {
	status: string
	version?: string
	agent?: string
	timestamp?: string
	time?: string
}

export interface BrainApproval {
	message?: string
	reason?: string
	command?: string
	action?: string
}

export interface ProjectContext {
	framework?: string
	packageManager?: string
	nodeVersion?: string
	port?: string
	branch?: string
	hasDocker?: boolean
	hasTypeScript?: boolean
}

// ── Slash command handlers ─────────────────────────────────────────────────

const slashCommandHandlers: Record<string, string> = {
	"/fix": "Fix any errors, bugs, or issues in the following code. Analyze the code carefully and provide a corrected version with explanations.",
	"/explain":
		"Explain the following code in detail. Describe what it does, how it works, and any important patterns or concepts used.",
	"/help":
		"I can help you with: coding, debugging, refactoring, testing, deployment, code review, documentation, and more. What do you need help with?",
	"/tests":
		"Generate comprehensive unit tests for the following code. Include edge cases, error handling, and main functionality tests.",
	"/optimize":
		"Optimize the following code for performance, readability, and maintainability. Suggest specific improvements with code examples.",
	"/refactor":
		"Refactor the following code to improve its structure, readability, and maintainability while preserving functionality.",
	"/docs":
		"Generate documentation for the following code including JSDoc comments, parameter descriptions, return values, and usage examples.",
	"/review":
		"Review the following code for potential issues: security vulnerabilities, performance problems, code smells, and best practices violations.",
}

const slashCommandsList = [
	{ command: "/fix", description: "Fix errors in the current file", icon: "Bug" },
	{ command: "/explain", description: "Explain the selected code", icon: "MessageCircle" },
	{ command: "/help", description: "Get help with the IDE", icon: "Lightbulb" },
	{ command: "/tests", description: "Generate tests for the current file", icon: "CheckCircle2" },
	{ command: "/optimize", description: "Optimize the current file", icon: "Zap" },
	{ command: "/refactor", description: "Refactor the current file", icon: "Wand2" },
	{ command: "/docs", description: "Generate documentation", icon: "BookOpen" },
	{ command: "/review", description: "Review code for issues", icon: "Search" },
]

const agentCommands: Record<string, { agent: string; description: string; icon: string }> = {
	"/help": { agent: "system", description: "Show all agent and skill commands", icon: "Bot" },
	"/agents": { agent: "system", description: "List all available agents", icon: "Brain" },
	"/skills": { agent: "system", description: "List all available skills", icon: "Sparkles" },
	"/deploy": { agent: "deployer", description: "Deploy the current project", icon: "Zap" },
	"/autonomous": { agent: "autonomous", description: "Run autonomous system scan", icon: "Bot" },
	"/debug": { agent: "debugger", description: "Start a debug session", icon: "Search" },
	"/test": { agent: "tester", description: "Run tests", icon: "CheckCircle2" },
	"/crawl": { agent: "crawler", description: "Run crawler agent", icon: "Bot" },
	"/plan": { agent: "planner", description: "Create a plan for a task", icon: "FileText" },
	"/code": { agent: "coder", description: "Execute a coding task", icon: "Code2" },
	"/heal": { agent: "self-healing", description: "Run self-healing cycle", icon: "AlertTriangle" },
	"/orchestrate": {
		agent: "orchestrator",
		description: "Break down and coordinate multi-step tasks",
		icon: "GitBranch",
	},
	"/auto-deploy": { agent: "auto-deployer", description: "Trigger or check auto-deployer status", icon: "Rocket" },
	"/status": { agent: "system", description: "Show system status", icon: "Cpu" },
	"/memory": { agent: "system", description: "Show memory/context status", icon: "Database" },
	"/pipeline": { agent: "system", description: "Show current pipeline status", icon: "GitBranch" },
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useIdeTerminal() {
	const { state, dispatch } = useIde()
	const {
		aiMessages,
		aiInput,
		aiSending,
		aiAttachments,
		aiTab,
		proactiveSuggestions,
		terminalInput,
		terminalOutput,
		outputBlocks,
		collapsedBlocks,
		recentCommands,
		recordings,
		isRecording,
		recordingBlocks,
		showRecordings,
		files,
		openFiles,
		activeFilePath,
		fileSearchQuery,
		showFileSearch,
		pipeline,
		status,
		repoName,
		branch,
		loading,
		showFilePanel,
		showAiPanel,
		showTerminal,
		terminalHeight,
		isTerminalMaximized,
		showShortcuts,
		showImportGithub,
		showOpenWorkspace,
		showDiffView,
		showSlashCommands,
		showAgentSuggestions,
		showSmartSuggestions,
		showInlineAiButton,
		showQuickActions,
		recentWorkspaces,
		workspaceTasks,
		_hydrated,
		// New PTY state
		ptySessionId,
		ptyConnected,
		ptyShell,
		ptyCwd,
		persistedSessions,
		splitTerminals,
		activeSplitTerminal,
		terminalSearchQuery,
		terminalSearchResults,
		terminalSearchActiveIndex,
		terminalNotifications,
		commandSnippets,
		showSnippetsPanel,
		sharedSessions,
		showShareDialog,
		terminalResources,
	} = state

	// ── Local-only state ─────────────────────────────────────────────────
	const [activeMode, setActiveMode] = useState("Auto")
	const [terminalMode, setTerminalMode] = useState<"shell" | "agent" | "skill">("shell")
	const [activeAgent, setActiveAgent] = useState<string | null>(null)
	const [agentRunning, setAgentRunning] = useState(false)
	const [agentSuggestions, setAgentSuggestions] = useState<string[]>([])
	const [dragOver, setDragOver] = useState(false)
	const dragCounter = useRef(0)
	const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
	const [currentFilePath, setCurrentFilePath] = useState<string>("")
	const [currentFileContent, setCurrentFileContent] = useState<string>("")
	const [currentFileLanguage, setCurrentFileLanguage] = useState<string>("text")
	const [currentFileSelection, setCurrentFileSelection] = useState<string>("")
	const [importGithubUrl, setImportGithubUrl] = useState("")
	const [importGithubBranch, setImportGithubBranch] = useState("main")
	const [importGithubLoading, setImportGithubLoading] = useState(false)
	const [importGithubError, setImportGithubError] = useState("")
	const [openWorkspacePath, setOpenWorkspacePath] = useState("")
	const [openWorkspaceLoading, setOpenWorkspaceLoading] = useState(false)
	const [openWorkspaceError, setOpenWorkspaceError] = useState("")
	const [smartSuggestions, setSmartSuggestions] = useState<{ label: string; command: string }[]>([])
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
	const [diffData, setDiffData] = useState<DiffData | null>(null)
	const [inlineSelectionPos, setInlineSelectionPos] = useState<{ top: number; left: number } | null>(null)
	const [slashCommandFilter, setSlashCommandFilter] = useState("")
	const [brainPlan, setBrainPlan] = useState<BrainPlanStep[]>([])
	const [brainFeedback, setBrainFeedback] = useState<BrainFeedback | null>(null)
	const [brainErrors, setBrainErrors] = useState<BrainError[]>([])
	const [brainFixes, setBrainFixes] = useState<BrainFix[]>([])
	const [brainMemory, setBrainMemory] = useState<BrainMemory | null>(null)
	const [brainDeployments, setBrainDeployments] = useState<BrainDeployment[]>([])
	const [brainApprovals, setBrainApprovals] = useState<BrainApproval[]>([])
	const [brainContext, setBrainContext] = useState<ProjectContext | null>(null)
	const [brainLoading, setBrainLoading] = useState(false)
	const [showRecentTasks, setShowRecentTasks] = useState(false)
	const [showSearchPanel, setShowSearchPanel] = useState(false)
	const [showGitPanel, setShowGitPanel] = useState(false)
	const [showProblemsPanel, setShowProblemsPanel] = useState(false)
	const [showSettingsPanel, setShowSettingsPanel] = useState(false)
	const [showExtensionsPanel, setShowExtensionsPanel] = useState(false)
	const [editorProblems, setEditorProblems] = useState<any[]>([])
	const [lspConnected, setLspConnected] = useState(false)
	// Terminal search local state
	const [terminalSearchLocalQuery, setTerminalSearchLocalQuery] = useState("")
	// Snippet input
	const [snippetNameInput, setSnippetNameInput] = useState("")
	// Share dialog input
	const [shareSessionId, setShareSessionId] = useState("")

	// ── Refs for values that shouldn't trigger useCallback re-creation ────
	const aiInputRef = useRef(aiInput)
	const aiAttachmentsRef = useRef(aiAttachments)
	const activeFilePathRef = useRef(activeFilePath)
	const openFilesRef = useRef(openFiles)
	const filesRef = useRef(files)
	const terminalOutputRef = useRef(terminalOutput)
	const aiMessagesRef = useRef(aiMessages)
	const workspaceTasksRef = useRef(workspaceTasks)
	const repoNameRef = useRef(repoName)
	const branchRef = useRef(branch)
	const currentFileSelectionRef = useRef(currentFileSelection)

	// Keep refs in sync
	useEffect(() => {
		aiInputRef.current = aiInput
	}, [aiInput])
	useEffect(() => {
		aiAttachmentsRef.current = aiAttachments
	}, [aiAttachments])
	useEffect(() => {
		activeFilePathRef.current = activeFilePath
	}, [activeFilePath])
	useEffect(() => {
		openFilesRef.current = openFiles
	}, [openFiles])
	useEffect(() => {
		filesRef.current = files
	}, [files])
	useEffect(() => {
		terminalOutputRef.current = terminalOutput
	}, [terminalOutput])
	useEffect(() => {
		aiMessagesRef.current = aiMessages
	}, [aiMessages])
	useEffect(() => {
		workspaceTasksRef.current = workspaceTasks
	}, [workspaceTasks])
	useEffect(() => {
		repoNameRef.current = repoName
	}, [repoName])
	useEffect(() => {
		branchRef.current = branch
	}, [branch])
	useEffect(() => {
		currentFileSelectionRef.current = currentFileSelection
	}, [currentFileSelection])

	// ── Refs for DOM elements ────────────────────────────────────────────
	const fileInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const aiMessagesEndRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLDivElement>(null)
	const terminalInputRef = useRef<HTMLInputElement>(null)
	const terminalResizeRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const fileSearchRef = useRef<HTMLInputElement>(null)
	const lspWsRef = useRef<WebSocket | null>(null)

	// ── PTY output buffer (accumulates output for the active session) ────
	const [ptyOutputBuffer, setPtyOutputBuffer] = useState<string>("")
	const ptyOutputBufferRef = useRef("")

	// ── WebSocket ────────────────────────────────────────────────────────
	const {
		wsRef,
		wsConnected,
		wsReconnecting,
		sendMessage: wsSend,
	} = useWebSocket({
		dispatch,
		onSuggestions: (suggestions) => {
			setSmartSuggestions(suggestions.map((s) => ({ label: s.text, command: s.text })))
		},
		onShowSmartSuggestions: (show) => {
			dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: show })
		},
		// PTY callbacks
		onPtyOutput: (sessionId, data) => {
			if (sessionId === ptySessionId) {
				ptyOutputBufferRef.current += data
				setPtyOutputBuffer(ptyOutputBufferRef.current)
				// Also append to terminal output for display
				dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [data] })
			}
		},
		onPtyExit: (sessionId, exitCode, signal) => {
			if (sessionId === ptySessionId) {
				dispatch({ type: "SET_PTY_CONNECTED", payload: false })
				dispatch({
					type: "APPEND_TERMINAL_OUTPUT",
					payload: [`[Process exited with code ${exitCode} (signal: ${signal})]`],
				})
			}
		},
		onPtyCreated: (sessionId, shell, cwd) => {
			dispatch({ type: "SET_PTY_SESSION_ID", payload: sessionId })
			dispatch({ type: "SET_PTY_CONNECTED", payload: true })
			dispatch({ type: "SET_PTY_SHELL", payload: shell })
			dispatch({ type: "SET_PTY_CWD", payload: cwd })
		},
		onPtyBuffer: (sessionId, buffer) => {
			if (sessionId === ptySessionId) {
				ptyOutputBufferRef.current = buffer
				setPtyOutputBuffer(buffer)
			}
		},
		onPtyList: (sessions) => {
			dispatch({
				type: "SET_PERSISTED_SESSIONS",
				payload: (sessions as any[]).map((s) => ({
					id: s.id,
					name: s.name || `Session ${s.id.slice(0, 8)}`,
					outputBlocks: s.outputBlocks || [],
					createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(s.createdAt).toISOString(),
					lastActivity:
						typeof s.lastActivity === "string" ? s.lastActivity : new Date(s.lastActivity).toISOString(),
					commandCount: s.commandCount || 0,
				})),
			})
		},
	})

	// ── Rate limiting for AI send ────────────────────────────────────────
	const lastSendTimeRef = useRef(0)
	const SEND_COOLDOWN_MS = 1000

	const canSend = useCallback((): boolean => {
		const now = Date.now()
		if (now - lastSendTimeRef.current < SEND_COOLDOWN_MS) return false
		lastSendTimeRef.current = now
		return true
	}, [])

	// ── LSP WebSocket (with reconnect) ───────────────────────────────────
	useEffect(() => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
		const wsUrl = `${protocol}//${window.location.host}/api/ws/lsp`

		let reconnectTimer: ReturnType<typeof setTimeout>

		function connectLsp() {
			try {
				const ws = new WebSocket(wsUrl)
				ws.onopen = () => setLspConnected(true)
				ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data)
						if (data.type === "status") setLspConnected(data.available)
					} catch {
						/* ignore */
					}
				}
				ws.onclose = () => {
					setLspConnected(false)
					reconnectTimer = setTimeout(connectLsp, 3000)
				}
				lspWsRef.current = ws
			} catch {
				setLspConnected(false)
				reconnectTimer = setTimeout(connectLsp, 3000)
			}
		}

		connectLsp()

		return () => {
			clearTimeout(reconnectTimer)
			if (lspWsRef.current) {
				lspWsRef.current.close()
				lspWsRef.current = null
			}
		}
	}, [])

	// ── Load workspace data on mount ─────────────────────────────────────
	const hydratedRef = useRef(_hydrated)
	hydratedRef.current = _hydrated

	useEffect(() => {
		async function load() {
			try {
				const data = await apiFetch<{
					workspaceId: string | null
					repoName: string | null
					branch: string
					files: WorkspaceFile[]
					pipeline: PipelineStep[]
					terminalSessions: any[]
					recentWorkspaces: any[]
					workspaceTasks: WorkspaceTask[]
					status: any
				}>("/workspace")
				if (hydratedRef.current) return
				if (data.files) dispatch({ type: "SET_FILES", payload: data.files })
				if (data.repoName) dispatch({ type: "SET_REPO_NAME", payload: data.repoName })
				if (data.branch) dispatch({ type: "SET_BRANCH", payload: data.branch })
				if (data.pipeline) dispatch({ type: "SET_PIPELINE", payload: data.pipeline })
				if (data.recentWorkspaces) dispatch({ type: "SET_RECENT_WORKSPACES", payload: data.recentWorkspaces })
				if (data.workspaceTasks) dispatch({ type: "SET_WORKSPACE_TASKS", payload: data.workspaceTasks })
				if (data.status) dispatch({ type: "SET_STATUS", payload: data.status })
			} catch (err) {
				console.error("Failed to load workspace:", err)
			} finally {
				dispatch({ type: "SET_LOADING", payload: false })
			}
		}
		load()
	}, [dispatch])

	// ── Fetch orchestrator / hermes / deployments ────────────────────────
	const fetchOrchestratorStatusData = useCallback(async () => {
		try {
			const data = await fetchOrchestratorStatus()
			if (data.tasks) {
				dispatch({
					type: "SET_WORKSPACE_TASKS",
					payload: data.tasks.map((t: any) => ({
						id: t.id,
						title: t.description || t.type || "Task",
						status: t.status,
						priority: t.priority,
						createdAt: t.createdAt,
					})),
				})
			}
		} catch {
			/* silent */
		}
	}, [dispatch])

	const fetchHermesStatsData = useCallback(async () => {
		try {
			const data = await fetchHermesStats()
			if (data.stats) dispatch({ type: "SET_HERMES_STATS", payload: data.stats })
		} catch {
			/* silent */
		}
	}, [dispatch])

	const fetchDeploymentsData = useCallback(async () => {
		try {
			const data = await fetchDeployments()
			if (data.deployments) {
				dispatch({
					type: "SET_DEPLOYMENTS",
					payload: data.deployments.map((d: any) => ({
						id: d.id,
						status: d.status,
						branch: d.branch,
						timestamp: d.timestamp || d.createdAt,
						url: d.url,
					})),
				})
			}
		} catch {
			/* silent */
		}
	}, [dispatch])

	useEffect(() => {
		fetchOrchestratorStatusData()
		fetchHermesStatsData()
		fetchDeploymentsData()
		const interval = setInterval(fetchOrchestratorStatusData, 30000)
		return () => clearInterval(interval)
	}, [fetchOrchestratorStatusData, fetchHermesStatsData, fetchDeploymentsData])

	// ── Drag & drop ──────────────────────────────────────────────────────
	useEffect(() => {
		function handleDragEnter(e: DragEvent) {
			e.preventDefault()
			dragCounter.current++
			if (e.dataTransfer?.types.includes("Files")) setDragOver(true)
		}
		function handleDragLeave(e: DragEvent) {
			e.preventDefault()
			dragCounter.current--
			if (dragCounter.current <= 0) {
				dragCounter.current = 0
				setDragOver(false)
			}
		}
		function handleDrop(e: DragEvent) {
			e.preventDefault()
			dragCounter.current = 0
			setDragOver(false)
			const files = e.dataTransfer?.files
			if (files && files.length > 0) handleFilesSelectedFromList(Array.from(files))
		}
		window.addEventListener("dragenter", handleDragEnter)
		window.addEventListener("dragover", (e) => e.preventDefault())
		window.addEventListener("dragleave", handleDragLeave)
		window.addEventListener("drop", handleDrop)
		return () => {
			window.removeEventListener("dragenter", handleDragEnter)
			window.removeEventListener("dragover", (e) => e.preventDefault())
			window.removeEventListener("dragleave", handleDragLeave)
			window.removeEventListener("drop", handleDrop)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// ── Paste handler ────────────────────────────────────────────────────
	useEffect(() => {
		function handlePaste(e: ClipboardEvent) {
			const items = e.clipboardData?.items
			if (!items) return
			const imageFiles: File[] = []
			for (let i = 0; i < items.length; i++) {
				if (items[i].type.startsWith("image/")) {
					const file = items[i].getAsFile()
					if (file) imageFiles.push(file)
				}
			}
			if (imageFiles.length > 0) {
				e.preventDefault()
				handleFilesSelectedFromList(imageFiles)
			}
		}
		window.addEventListener("paste", handlePaste)
		return () => window.removeEventListener("paste", handlePaste)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// ── File selection helper ────────────────────────────────────────────
	async function handleFilesSelectedFromList(fileList: File[]) {
		for (const file of fileList) {
			if (file.type.startsWith("image/")) {
				const reader = new FileReader()
				reader.onload = () => {
					const attachment = {
						id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
						filename: file.name,
						type: "image",
						size: `${(file.size / 1024).toFixed(1)} KB`,
					}
					dispatch({ type: "ADD_AI_ATTACHMENT", payload: attachment })
				}
				reader.readAsDataURL(file)
			} else {
				await file.text()
				const attachment = {
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: "file",
					size: `${(file.size / 1024).toFixed(1)} KB`,
				}
				dispatch({ type: "ADD_AI_ATTACHMENT", payload: attachment })
			}
		}
	}

	// ── AI Input change handler ──────────────────────────────────────────
	const handleAiInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const val = e.target.value
			dispatch({ type: "SET_AI_INPUT", payload: val })
			if (val.startsWith("/")) {
				const cmd = val.split(" ")[0].toLowerCase()
				setSlashCommandFilter(cmd)
				const hasMatch = slashCommandsList.some((sc) => sc.command.startsWith(cmd))
				dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: hasMatch })
			} else {
				dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })
			}
		},
		[dispatch],
	)

	// ── AI Send (with rate limiting + ref-based deps) ────────────────────
	const handleAiSend = useCallback(async () => {
		if (!canSend()) return

		const SESSION_KEY = "superroo-chat-session"
		let sessionId = ""
		if (typeof window !== "undefined") {
			sessionId = localStorage.getItem(SESSION_KEY) || ""
			if (!sessionId) {
				sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
				localStorage.setItem(SESSION_KEY, sessionId)
			}
		}

		// Use refs to avoid stale closures — only 3 deps needed
		const text = aiInputRef.current.trim()
		const attachments = aiAttachmentsRef.current
		const currentFilePath = activeFilePathRef.current
		const currentOpenFiles = openFilesRef.current
		const workspaceFiles = filesRef.current
		const termOutput = terminalOutputRef.current
		const recentHistory = aiMessagesRef.current.slice(-6).map((m) => ({
			role: m.role,
			author: m.author,
			content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
		}))
		const pendingTasks = workspaceTasksRef.current.filter((t) => t.status === "pending").map((t) => t.title)
		const currentRepoName = repoNameRef.current
		const currentBranch = branchRef.current
		const selection = currentFileSelectionRef.current

		if (!text && attachments.length === 0) return

		let slashCommandUsed = ""
		let finalText = text
		if (text.startsWith("/")) {
			const cmd = text.split(" ")[0].toLowerCase()
			const rest = text.slice(cmd.length).trim()
			if (slashCommandHandlers[cmd]) {
				slashCommandUsed = cmd
				const fileContext = currentFilePath
					? `\n\nCurrent file: ${currentFilePath}\n\`\`\`\n${(currentOpenFiles.find((f) => f.path === currentFilePath)?.content || "").slice(0, 3000)}\n\`\`\``
					: ""
				const selectionContext = selection ? `\n\nSelected code:\n\`\`\`\n${selection}\n\`\`\`` : ""
				finalText = `${slashCommandHandlers[cmd]}${fileContext}${selectionContext}${rest ? `\n\nAdditional context: ${rest}` : ""}`
			}
		}

		const userMsg: ChatMessage = {
			id: `msg-${Date.now()}`,
			role: "user",
			author: "You",
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			content: slashCommandUsed
				? `${slashCommandUsed} ${text.slice(slashCommandUsed.length).trim()}`
				: finalText || "Sent files",
			attachments: attachments.length > 0 ? [...attachments] : undefined,
		}

		dispatch({ type: "ADD_AI_MESSAGE", payload: userMsg })
		dispatch({ type: "SET_AI_INPUT", payload: "" })
		dispatch({ type: "SET_AI_ATTACHMENTS", payload: [] })
		dispatch({ type: "SET_AI_SENDING", payload: true })
		dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: [] })
		dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })

		let currentFile = undefined
		if (currentFilePath) {
			const openFile = currentOpenFiles.find((f) => f.path === currentFilePath)
			if (openFile) {
				currentFile = {
					path: openFile.path,
					content: openFile.content,
					language: openFile.language,
					selection: selection || undefined,
				}
			}
		}

		const allOpenFiles = currentOpenFiles.map((f) => ({
			path: f.path,
			name: f.name,
			language: f.language,
			modified: f.modified,
			content: f.path === currentFilePath ? undefined : f.content.slice(0, 2000),
		}))

		const contextParts: string[] = []
		if (currentRepoName)
			contextParts.push(`**Workspace:** ${currentRepoName}${currentBranch ? ` (${currentBranch})` : ""}`)
		if (currentFile) contextParts.push(`**Active file:** \`${currentFile.path}\``)
		if (allOpenFiles.length > 1)
			contextParts.push(`**Open files:** ${allOpenFiles.map((f) => `\`${f.path}\``).join(", ")}`)
		if (termOutput.length > 0)
			contextParts.push(`**Recent terminal output:**\n\`\`\`\n${termOutput.slice(-30).join("\n")}\n\`\`\``)
		if (pendingTasks.length > 0) contextParts.push(`**Pending tasks:** ${pendingTasks.join(", ")}`)
		if (selection) contextParts.push(`**Selected code:**\n\`\`\`\n${selection}\n\`\`\``)

		const contextSummary = contextParts.length > 0 ? `\n\n---\n${contextParts.join("\n")}` : ""

		const payload = {
			type: "chat",
			message: finalText + contextSummary,
			sessionId,
			attachments: attachments.map((a) => ({ filename: a.filename, type: a.type })),
			context: {
				currentFile,
				openFiles: allOpenFiles,
				workspaceFiles: workspaceFiles.map((f) => ({ name: f.name, path: f.path, kind: f.kind })),
				recentHistory,
				pendingTasks,
				repoName: currentRepoName,
				branch: currentBranch,
			},
		}

		const sent = wsSend(payload)
		if (!sent) {
			// Fallback to REST
			try {
				const data = await apiFetch<{ reply: string; suggestions?: string[] }>("/brain/ask", {
					method: "POST",
					body: JSON.stringify({
						message: finalText + contextSummary,
						sessionId,
						context: {
							openFiles: allOpenFiles,
							workspaceFiles: workspaceFiles.map((f) => ({ name: f.name, path: f.path })),
							recentHistory,
						},
					}),
				})
				const replyMsg: ChatMessage = {
					id: `msg-${Date.now()}`,
					role: "assistant",
					author: "AI",
					time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
					content: data.reply || "No response",
				}
				dispatch({ type: "ADD_AI_MESSAGE", payload: replyMsg })
				if (data.suggestions?.length) {
					dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: data.suggestions })
				}
			} catch (err: any) {
				const errMsg: ChatMessage = {
					id: `msg-${Date.now()}`,
					role: "assistant",
					author: "System",
					time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
					content: `Failed to send message: ${err.message}`,
				}
				dispatch({ type: "ADD_AI_MESSAGE", payload: errMsg })
			} finally {
				dispatch({ type: "SET_AI_SENDING", payload: false })
			}
		}
	}, [dispatch, canSend, wsSend])

	// ── File operations ──────────────────────────────────────────────────
	const handleFileSelect = useCallback(
		async (filePath: string) => {
			setCurrentFilePath(filePath)
			try {
				const result = await fetchFileContent(filePath)
				const content = result.content
				const ext = filePath.split(".").pop() || ""
				const langMap: Record<string, string> = {
					ts: "typescript",
					tsx: "typescript",
					js: "javascript",
					jsx: "javascript",
					json: "json",
					md: "markdown",
					html: "html",
					css: "css",
					py: "python",
					rs: "rust",
					go: "go",
					yaml: "yaml",
					yml: "yaml",
					toml: "toml",
					sql: "sql",
					sh: "bash",
					bash: "bash",
				}
				const language = langMap[ext] || "text"
				setCurrentFileContent(content)
				setCurrentFileLanguage(language)
				const existing = openFiles.find((f) => f.path === filePath)
				if (!existing) {
					const name = filePath.split("/").pop() || filePath
					const newFile: OpenFile = { path: filePath, name, content, language, modified: false }
					dispatch({ type: "SET_OPEN_FILES", payload: [...openFiles, newFile] })
				}
				dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: filePath })
			} catch (err) {
				console.error("Failed to load file:", err)
			}
		},
		[openFiles, dispatch],
	)

	const handleFileSave = useCallback(
		async (content: string) => {
			const path = currentFilePath
			if (!path) return
			try {
				await saveFileContent(path, content)
				dispatch({
					type: "SET_OPEN_FILES",
					payload: openFiles.map((f) => (f.path === path ? { ...f, content, modified: false } : f)),
				})
				setCurrentFileContent(content)
			} catch (err) {
				console.error("Failed to save file:", err)
			}
		},
		[currentFilePath, openFiles, dispatch],
	)

	// ── PTY Terminal Operations ──────────────────────────────────────────

	/** Create a new PTY session */
	const handlePtyCreate = useCallback(
		(options?: { shell?: string; cwd?: string; cols?: number; rows?: number }) => {
			const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			wsSend({
				type: "pty:create",
				sessionId,
				...options,
			})
		},
		[wsSend],
	)

	/** Send input to the active PTY session */
	const handlePtyInput = useCallback(
		(data: string) => {
			if (!ptySessionId) return
			wsSend({
				type: "pty:input",
				sessionId: ptySessionId,
				data,
			})
		},
		[wsSend, ptySessionId],
	)

	/** Resize the active PTY session */
	const handlePtyResize = useCallback(
		(cols: number, rows: number) => {
			if (!ptySessionId) return
			wsSend({
				type: "pty:resize",
				sessionId: ptySessionId,
				cols,
				rows,
			})
		},
		[wsSend, ptySessionId],
	)

	/** Kill the active PTY session */
	const handlePtyKill = useCallback(() => {
		if (!ptySessionId) return
		wsSend({
			type: "pty:kill",
			sessionId: ptySessionId,
		})
		dispatch({ type: "SET_PTY_CONNECTED", payload: false })
		dispatch({ type: "SET_PTY_SESSION_ID", payload: null })
	}, [wsSend, ptySessionId, dispatch])

	/** List all PTY sessions */
	const handlePtyList = useCallback(() => {
		wsSend({ type: "pty:list" })
	}, [wsSend])

	/** Get buffer from a PTY session */
	const handlePtyGetBuffer = useCallback(
		(sessionId: string) => {
			wsSend({
				type: "pty:getBuffer",
				sessionId,
			})
		},
		[wsSend],
	)

	// ── Split Terminal Operations (#4) ────────────────────────────────────

	const handleAddSplitTerminal = useCallback(
		(orientation: "horizontal" | "vertical" = "vertical") => {
			const newTab: SplitTerminalTab = {
				id: `split-${Date.now()}`,
				name: `Terminal ${splitTerminals.length + 1}`,
				sessionId: "",
				outputBlocks: [],
				terminalInput: "",
				recentCommands: [],
				isRecording: false,
				recordingBlocks: [],
			}
			dispatch({ type: "ADD_SPLIT_TERMINAL", payload: newTab })
		},
		[splitTerminals.length, dispatch],
	)

	const handleRemoveSplitTerminal = useCallback(
		(id: string) => {
			dispatch({ type: "REMOVE_SPLIT_TERMINAL", payload: id })
		},
		[dispatch],
	)

	const handleSetActiveSplitTerminal = useCallback(
		(id: string) => {
			dispatch({ type: "SET_ACTIVE_SPLIT_TERMINAL", payload: id })
		},
		[dispatch],
	)

	const handleUpdateSplitTerminal = useCallback(
		(id: string, changes: Partial<SplitTerminalTab>) => {
			dispatch({ type: "UPDATE_SPLIT_TERMINAL", payload: { id, changes } })
		},
		[dispatch],
	)

	// ── Terminal Search/Filter (#6) ───────────────────────────────────────

	const handleTerminalSearch = useCallback(
		(query: string) => {
			setTerminalSearchLocalQuery(query)
			dispatch({ type: "SET_TERMINAL_SEARCH_QUERY", payload: query })
			if (!query.trim()) {
				dispatch({ type: "SET_TERMINAL_SEARCH_RESULTS", payload: [] })
				dispatch({ type: "SET_TERMINAL_SEARCH_ACTIVE_INDEX", payload: -1 })
				return
			}
			const lower = query.toLowerCase()
			const results = outputBlocks
				.map((block, idx) => ({ block, idx, text: block.content || "" }))
				.filter(({ text }) => text.toLowerCase().includes(lower))
				.map(({ idx }) => idx)
			dispatch({ type: "SET_TERMINAL_SEARCH_RESULTS", payload: results })
			dispatch({ type: "SET_TERMINAL_SEARCH_ACTIVE_INDEX", payload: results.length > 0 ? 0 : -1 })
		},
		[outputBlocks, dispatch],
	)

	const handleTerminalSearchNext = useCallback(() => {
		if (terminalSearchResults.length === 0) return
		const next = (terminalSearchActiveIndex + 1) % terminalSearchResults.length
		dispatch({ type: "SET_TERMINAL_SEARCH_ACTIVE_INDEX", payload: next })
	}, [terminalSearchResults, terminalSearchActiveIndex, dispatch])

	const handleTerminalSearchPrev = useCallback(() => {
		if (terminalSearchResults.length === 0) return
		const prev = (terminalSearchActiveIndex - 1 + terminalSearchResults.length) % terminalSearchResults.length
		dispatch({ type: "SET_TERMINAL_SEARCH_ACTIVE_INDEX", payload: prev })
	}, [terminalSearchResults, terminalSearchActiveIndex, dispatch])

	// ── Terminal Notifications (#9) ───────────────────────────────────────

	const handleDismissNotification = useCallback(
		(id: string) => {
			dispatch({ type: "DISMISS_TERMINAL_NOTIFICATION", payload: id })
		},
		[dispatch],
	)

	// ── Command Snippets (#10) ────────────────────────────────────────────

	const handleAddSnippet = useCallback(
		(name: string, command: string) => {
			const snippet: CommandSnippet = {
				id: `snippet-${Date.now()}`,
				name,
				command,
				description: "",
				category: "custom",
				createdAt: new Date().toISOString(),
				pinned: false,
			}
			dispatch({ type: "ADD_COMMAND_SNIPPET", payload: snippet })
		},
		[dispatch],
	)

	const handleRemoveSnippet = useCallback(
		(id: string) => {
			dispatch({ type: "REMOVE_COMMAND_SNIPPET", payload: id })
		},
		[dispatch],
	)

	const handleToggleSnippetsPanel = useCallback(() => {
		dispatch({ type: "SET_SHOW_SNIPPETS_PANEL", payload: !showSnippetsPanel })
	}, [showSnippetsPanel, dispatch])

	// ── Terminal Sharing (#11) ────────────────────────────────────────────

	const handleToggleShareDialog = useCallback(() => {
		dispatch({ type: "SET_SHOW_SHARE_DIALOG", payload: !showShareDialog })
	}, [showShareDialog, dispatch])

	const handleShareSession = useCallback(
		(targetSessionId: string) => {
			if (!ptySessionId) return
			const shared: SharedTerminalSession = {
				id: `shared-${Date.now()}`,
				shareId: targetSessionId,
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
				blocks: outputBlocks,
				sharedBy: "current-user",
			}
			dispatch({ type: "SET_SHARED_SESSIONS", payload: [...sharedSessions, shared] })
			dispatch({ type: "SET_SHOW_SHARE_DIALOG", payload: false })
		},
		[ptySessionId, sharedSessions, outputBlocks, dispatch],
	)

	// ── Terminal Resource Monitoring (#12) ────────────────────────────────

	useEffect(() => {
		// Poll CPU/memory usage every 5 seconds for the terminal
		const interval = setInterval(async () => {
			try {
				const data = await apiFetch<{ cpu: number; memory: number; processes?: number }>("/system/resources")
				const resources: TerminalResourceUsage = {
					cpu: data.cpu || 0,
					memory: data.memory || 0,
					processCount: data.processes || 0,
					uptime: 0,
				}
				dispatch({ type: "SET_TERMINAL_RESOURCES", payload: resources })
			} catch {
				// silent
			}
		}, 5000)
		return () => clearInterval(interval)
	}, [dispatch])

	// ── Terminal command handler (with PTY support) ───────────────────────

	const handleTerminalCommand = useCallback(
		async (cmd: string) => {
			if (!cmd.trim()) return
			dispatch({ type: "SET_TERMINAL_INPUT", payload: "" })

			if (ptyConnected && ptySessionId) {
				// Send via PTY for real shell interaction
				handlePtyInput(cmd + "\n")
				return
			}

			// Fallback to REST-based command execution
			dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`$ ${cmd}`] })
			try {
				const result = await sendTerminalCommand(cmd)
				if (result.output) {
					dispatch({
						type: "APPEND_TERMINAL_OUTPUT",
						payload: Array.isArray(result.output) ? result.output : [result.output],
					})
				}
			} catch (err: any) {
				dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`Error: ${err.message}`] })
			}
		},
		[dispatch, ptyConnected, ptySessionId, handlePtyInput],
	)

	// ── Import / Open workspace ───────────────────────────────────────────

	const handleImportGithub = useCallback(async () => {
		if (!importGithubUrl.trim()) return
		setImportGithubLoading(true)
		setImportGithubError("")
		try {
			const result = await importGithubRepo(importGithubUrl, importGithubBranch)
			if (result.success) {
				const wsResult = await openWorkspace()
				if (wsResult.files) dispatch({ type: "SET_FILES", payload: wsResult.files })
			}
			dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })
			setImportGithubUrl("")
		} catch (err: any) {
			setImportGithubError(err.message || "Import failed")
		} finally {
			setImportGithubLoading(false)
		}
	}, [importGithubUrl, importGithubBranch, dispatch])

	const handleOpenWorkspace = useCallback(async () => {
		if (!openWorkspacePath.trim()) return
		setOpenWorkspaceLoading(true)
		setOpenWorkspaceError("")
		try {
			const result = await openWorkspace(openWorkspacePath)
			if (result.files) dispatch({ type: "SET_FILES", payload: result.files })
			dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })
			setOpenWorkspacePath("")
		} catch (err: any) {
			setOpenWorkspaceError(err.message || "Failed to open workspace")
		} finally {
			setOpenWorkspaceLoading(false)
		}
	}, [openWorkspacePath, dispatch])

	const handleViewDiff = useCallback(
		async (filePath: string) => {
			try {
				const content = currentFileContent
				const diff = await fetchDiff(filePath, content)
				setDiffData(diff)
				dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: true })
			} catch (err) {
				console.error("Failed to load diff:", err)
			}
		},
		[currentFileContent, dispatch],
	)

	const handleInlineAiAction = useCallback(
		(action: string) => {
			if (!currentFileSelection) return
			const cmd = `/${action}`
			const handler = slashCommandHandlers[cmd]
			if (handler) {
				const text = `${handler}\n\nSelected code:\n\`\`\`\n${currentFileSelection}\n\`\`\``
				dispatch({ type: "SET_AI_INPUT", payload: text })
				dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: false })
				setInlineSelectionPos(null)
			}
		},
		[currentFileSelection, dispatch],
	)

	const handleEditorMouseUp = useCallback(() => {
		const sel = window.getSelection()
		if (sel && sel.toString().trim().length > 0) {
			setCurrentFileSelection(sel.toString())
			const range = sel.getRangeAt(0)
			const rect = range.getBoundingClientRect()
			setInlineSelectionPos({ top: rect.top - 40, left: rect.left })
			dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: true })
		} else {
			setCurrentFileSelection("")
			dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: false })
			setInlineSelectionPos(null)
		}
	}, [dispatch])

	// ── Agent suggestions ────────────────────────────────────────────────

	function getAgentSuggestions(input: string): string[] {
		if (!input.startsWith("@")) return []
		const query = input.slice(1).toLowerCase()
		return Object.entries(agentCommands)
			.filter(([cmd]) => cmd.slice(1).toLowerCase().includes(query))
			.map(([cmd, info]) => `${cmd} — ${info.description}`)
	}

	function isAgentCommand(input: string): boolean {
		const cmd = input.split(" ")[0].toLowerCase()
		return cmd in agentCommands
	}

	function isAgentMention(input: string): boolean {
		return input.includes("@")
	}

	// ── Return ───────────────────────────────────────────────────────────

	return {
		// State
		aiMessages,
		aiInput,
		aiSending,
		aiAttachments,
		aiTab,
		proactiveSuggestions,
		terminalInput,
		terminalOutput,
		outputBlocks,
		collapsedBlocks,
		recentCommands,
		recordings,
		isRecording,
		recordingBlocks,
		showRecordings,
		files,
		openFiles,
		activeFilePath,
		fileSearchQuery,
		showFileSearch,
		pipeline,
		status,
		repoName,
		branch,
		loading,
		showFilePanel,
		showAiPanel,
		showTerminal,
		terminalHeight,
		isTerminalMaximized,
		showShortcuts,
		showImportGithub,
		showOpenWorkspace,
		showDiffView,
		showSlashCommands,
		showAgentSuggestions,
		showSmartSuggestions,
		showInlineAiButton,
		showQuickActions,
		recentWorkspaces,
		workspaceTasks,

		// New state
		ptySessionId,
		ptyConnected,
		ptyShell,
		ptyCwd,
		ptyOutputBuffer,
		persistedSessions,
		splitTerminals,
		activeSplitTerminal,
		terminalSearchQuery,
		terminalSearchResults,
		terminalSearchActiveIndex,
		terminalSearchLocalQuery,
		terminalNotifications,
		commandSnippets,
		showSnippetsPanel,
		sharedSessions,
		showShareDialog,
		terminalResources,
		snippetNameInput,
		setSnippetNameInput,
		shareSessionId,
		setShareSessionId,

		// Local state
		activeMode,
		setActiveMode,
		terminalMode,
		setTerminalMode,
		activeAgent,
		setActiveAgent,
		agentRunning,
		setAgentRunning,
		agentSuggestions,
		dragOver,
		copiedIndex,
		setCopiedIndex,
		currentFilePath,
		currentFileContent,
		setCurrentFileContent,
		currentFileLanguage,
		currentFileSelection,
		importGithubUrl,
		setImportGithubUrl,
		importGithubBranch,
		setImportGithubBranch,
		importGithubLoading,
		importGithubError,
		openWorkspacePath,
		setOpenWorkspacePath,
		openWorkspaceLoading,
		openWorkspaceError,
		smartSuggestions,
		setSmartSuggestions,
		selectedSuggestionIndex,
		setSelectedSuggestionIndex,
		diffData,
		setDiffData,
		inlineSelectionPos,
		slashCommandFilter,
		setSlashCommandFilter,
		brainPlan,
		setBrainPlan,
		brainFeedback,
		setBrainFeedback,
		brainErrors,
		setBrainErrors,
		brainFixes,
		setBrainFixes,
		brainMemory,
		setBrainMemory,
		brainDeployments,
		setBrainDeployments,
		brainApprovals,
		setBrainApprovals,
		brainContext,
		setBrainContext,
		brainLoading,
		setBrainLoading,
		showRecentTasks,
		setShowRecentTasks,
		showSearchPanel,
		setShowSearchPanel,
		showGitPanel,
		setShowGitPanel,
		showProblemsPanel,
		setShowProblemsPanel,
		showSettingsPanel,
		setShowSettingsPanel,
		showExtensionsPanel,
		setShowExtensionsPanel,
		editorProblems,
		setEditorProblems,
		lspConnected,

		// Refs
		fileInputRef,
		imageInputRef,
		aiMessagesEndRef,
		terminalRef,
		terminalInputRef,
		terminalResizeRef,
		textareaRef,
		fileSearchRef,

		// WebSocket
		wsRef: wsRef,
		wsConnected,
		wsReconnecting,

		// Handlers
		handleAiInputChange,
		handleAiSend,
		handleFileSelect,
		handleFileSave,
		handleTerminalCommand,
		handleImportGithub,
		handleOpenWorkspace,
		handleViewDiff,
		handleInlineAiAction,
		handleEditorMouseUp,
		handleFilesSelectedFromList,
		getAgentSuggestions,
		isAgentCommand,
		isAgentMention,

		// PTY handlers
		handlePtyCreate,
		handlePtyInput,
		handlePtyResize,
		handlePtyKill,
		handlePtyList,
		handlePtyGetBuffer,

		// Split terminal handlers
		handleAddSplitTerminal,
		handleRemoveSplitTerminal,
		handleSetActiveSplitTerminal,
		handleUpdateSplitTerminal,

		// Search handlers
		handleTerminalSearch,
		handleTerminalSearchNext,
		handleTerminalSearchPrev,

		// Notification handlers
		handleDismissNotification,

		// Snippet handlers
		handleAddSnippet,
		handleRemoveSnippet,
		handleToggleSnippetsPanel,

		// Share handlers
		handleToggleShareDialog,
		handleShareSession,
	}
}
