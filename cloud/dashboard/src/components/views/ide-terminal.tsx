"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
	Bot,
	Code2,
	Search,
	GitBranch,
	Play,
	Boxes,
	User,
	Settings,
	Terminal,
	FileText,
	Folder,
	Plus,
	Bell,
	Paperclip,
	Image,
	Send,
	Mic,
	Cpu,
	Database,
	UploadCloud,
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
	AlertTriangle,
	Trash2,
	Wand2,
	Sparkles,
	Brain,
	Zap,
	Copy,
	X,
	Command,
	Keyboard,
	FileSearch,
	Upload,
	RefreshCw,
	MessageSquare,
	Bug,
	Rocket,
	BarChart3,
	Shield,
	Check,
	History,
	PlayCircle,
	StopCircle,
	Timer,
	Bookmark,
	Lightbulb,
	TerminalSquare,
	PanelLeftClose,
	PanelLeft,
	PanelRightClose,
	PanelRight,
	Maximize2,
	Minimize2,
	Github,
	Globe,
	FileCode,
	ExternalLink,
	FolderOpen,
	BookOpen,
	ListTodo,
	Workflow,
	GitPullRequest,
	GitMerge,
	Code,
	Terminal as TerminalIcon,
	FileJson,
	FileType,
	Link,
	Download,
	CheckSquare,
	Square,
	ArrowRight,
	MessageCircle,
	Lightbulb as LightbulbIcon,
	Star,
	Clock3,
	RotateCcw,
	FolderGit2,
	GitFork,
	FilePlus2,
	Terminal as TerminalIcon2,
	Slash,
	List,
	Diff,
	FileOutput,
	Eye,
	Columns,
} from "lucide-react"
import {
	useIde,
	type WorkspaceFile,
	type PipelineStep,
	type ChatMessage,
	type OutputBlock,
	type TerminalRecording,
	type WorkspaceStatus,
	type OpenFile,
	type TerminalSession,
	type ChatAttachment,
	type RecentWorkspace,
	type WorkspaceTask,
} from "@/lib/ide-store"
import ErrorBoundary from "@/components/ide-terminal/ErrorBoundary"
import FileTree from "@/components/ide-terminal/FileTree"
import CodeEditor from "@/components/ide-terminal/CodeEditor"
import TerminalPanel from "@/components/ide-terminal/TerminalPanel"
import AiChatPanel from "@/components/ide-terminal/AiChatPanel"
import SearchPanel from "@/components/ide-terminal/SearchPanel"
import GitPanel from "@/components/ide-terminal/GitPanel"
import KeyboardShortcutsModal from "@/components/ide-terminal/KeyboardShortcutsModal"
import DiffViewModal from "@/components/ide-terminal/DiffViewModal"
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
	computeDiff,
} from "@/components/ide-terminal/api"
import type { BrainTab, DiffData } from "@/components/ide-terminal/types"

// ── Local types ────────────────────────────────────────────────────────────

interface AutocompleteSuggestion {
	text: string
	description: string
	type: "command" | "agent" | "recent" | "ai"
	label?: string
	command?: string
}

interface BrainPlanStep {
	command: string
	description?: string
}

interface BrainFeedback {
	status: string
	output: string
	exitCode?: number
	errors?: BrainError[]
	fixes?: BrainFix[]
}

interface BrainError {
	type: string
	message: string
	rootCause?: string
	fix?: string
	confidence?: number
}

interface BrainFix {
	title?: string
	type?: string
	description?: string
	fix?: string
	message?: string
}

interface BrainMemory {
	stats?: {
		totalSessions: number
		totalCommands: number
		totalErrors: number
		successRate: number
	}
	commands?: { command: string; status: string; timestamp?: string }[]
}

interface BrainDeployment {
	status: string
	version?: string
	agent?: string
	timestamp?: string
	time?: string
}

interface BrainApproval {
	message?: string
	reason?: string
	command?: string
	action?: string
}

interface ProjectContext {
	framework?: string
	packageManager?: string
	nodeVersion?: string
	port?: string
	branch?: string
	hasDocker?: boolean
	hasTypeScript?: boolean
}

// ── Pipeline Icon ─────────────────────────────────────────────────────────

function PipelineIcon({ status }: { status: string }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={10} className="text-green-400" />
		case "running":
			return <Loader2 size={10} className="text-blue-400 animate-spin" />
		case "failed":
			return <XCircle size={10} className="text-red-400" />
		case "approval":
			return <Shield size={10} className="text-yellow-400" />
		case "blocked":
			return <AlertTriangle size={10} className="text-orange-400" />
		default:
			return <Clock size={10} className="text-gray-500" />
	}
}

// ── Slash command handlers ────────────────────────────────────────────────

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

// ── Main Component ────────────────────────────────────────────────────────

export default function IdeTerminalView() {
	// ── Global state from store ──────────────────────────────────────────
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
	const wsRef = useRef<WebSocket | null>(null)
	const [wsConnected, setWsConnected] = useState(false)
	const [wsReconnecting, setWsReconnecting] = useState(false)
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
	const inlineEditorRef = useRef<HTMLTextAreaElement>(null)
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

	const fileInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const aiMessagesEndRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLDivElement>(null)
	const terminalInputRef = useRef<HTMLInputElement>(null)
	const terminalResizeRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const fileSearchRef = useRef<HTMLInputElement>(null)

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

	// ── AI Input change handler with slash command detection ──────────────
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

	// ── Agent command definitions ────────────────────────────────────────
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
		"/auto-deploy": {
			agent: "auto-deployer",
			description: "Trigger or check auto-deployer status",
			icon: "Rocket",
		},
		"/status": { agent: "system", description: "Show system status", icon: "Cpu" },
		"/memory": { agent: "system", description: "Show memory/context status", icon: "Database" },
		"/pipeline": { agent: "system", description: "Show current pipeline status", icon: "GitBranch" },
	}

	const isAgentCommand = (cmd: string) => cmd.startsWith("/") || cmd.startsWith("@")
	const isAgentMention = (cmd: string) => cmd.startsWith("@")

	const getAgentSuggestions = (input: string): string[] => {
		if (!input) return []
		const lower = input.toLowerCase()
		if (lower.startsWith("/")) {
			return Object.keys(agentCommands)
				.filter((cmd) => cmd.startsWith(lower))
				.slice(0, 5)
		}
		if (lower.startsWith("@")) {
			const mention = lower.slice(1)
			return Object.values(agentCommands)
				.filter((cmd) => cmd.agent !== "system" && cmd.agent.includes(mention))
				.map((cmd) => `@${cmd.agent}`)
				.slice(0, 5)
		}
		return []
	}

	// ── Load workspace data on mount ──────────────────────────────────────
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
					terminalSessions: TerminalSession[]
					recentWorkspaces: RecentWorkspace[]
					workspaceTasks: WorkspaceTask[]
					status: WorkspaceStatus
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

	// ── Keyboard shortcuts (global) ──────────────────────────────────────
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.key === "`") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_TERMINAL", payload: !state.showTerminal })
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "b") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_FILE_PANEL", payload: !showFilePanel })
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "f" && !showFilePanel) {
				e.preventDefault()
				setShowSearchPanel((v) => !v)
			}
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_AI_PANEL", payload: !showAiPanel })
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "g") {
				e.preventDefault()
				setShowGitPanel((v) => !v)
			}
			if (e.key === "Escape") {
				setShowSearchPanel(false)
				setShowGitPanel(false)
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown)
		return () => window.removeEventListener("keydown", handleGlobalKeyDown)
	}, [dispatch, showFilePanel, showAiPanel, state.showTerminal])

	// ── WebSocket connection ─────────────────────────────────────────────
	useEffect(() => {
		function connect() {
			const SESSION_KEY = "superroo-chat-session"
			let sessionId = localStorage.getItem(SESSION_KEY) || ""
			if (!sessionId) {
				sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
				localStorage.setItem(SESSION_KEY, sessionId)
			}
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
			const wsUrl = `${protocol}//${window.location.host}/api/ws/chat?session=${sessionId}`
			try {
				const ws = new WebSocket(wsUrl)
				ws.onopen = () => {
					setWsConnected(true)
					setWsReconnecting(false)
					const pingInterval = setInterval(() => {
						if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }))
					}, 30000)
					ws.addEventListener("close", () => clearInterval(pingInterval))
				}
				ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data)
						switch (data.type) {
							case "assistant-start": {
								const msg: ChatMessage = {
									id: `msg-${Date.now()}`,
									role: "assistant",
									author: data.agent || "AI",
									meta: data.meta,
									time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
									content: "",
								}
								dispatch({ type: "ADD_AI_MESSAGE", payload: msg })
								break
							}
							case "token": {
								dispatch({ type: "UPDATE_LAST_AI_MESSAGE", payload: data.text })
								break
							}
							case "done":
								dispatch({ type: "SET_AI_SENDING", payload: false })
								if (data.suggestions?.length) {
									dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: data.suggestions })
								}
								break
							case "suggestions":
								setSmartSuggestions(
									data.suggestions?.map((s: string) => ({
										text: s,
										description: "AI suggestion",
										type: "ai" as const,
									})) || [],
								)
								dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: true })
								break
							case "error":
								dispatch({ type: "SET_AI_SENDING", payload: false })
								const errMsg: ChatMessage = {
									id: `msg-${Date.now()}`,
									role: "assistant",
									author: "System",
									time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
									content: `Error: ${data.message || "Unknown error"}`,
								}
								dispatch({ type: "ADD_AI_MESSAGE", payload: errMsg })
								break
							case "cancelled":
								dispatch({ type: "SET_AI_SENDING", payload: false })
								break
						}
					} catch {
						// ignore parse errors
					}
				}
				ws.onclose = () => {
					setWsConnected(false)
					setWsReconnecting(true)
					reconnectTimer = setTimeout(() => {
						connect()
					}, 3000)
				}
				ws.onerror = () => {
					ws.close()
				}
				wsRef.current = ws
			} catch {
				setWsReconnecting(true)
				reconnectTimer = setTimeout(() => connect(), 3000)
			}
		}
		let reconnectTimer: ReturnType<typeof setTimeout>
		connect()
		return () => {
			clearTimeout(reconnectTimer)
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
			}
		}
	}, [dispatch])

	// ── Fetch orchestrator status ────────────────────────────────────────
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
			// silent
		}
	}, [dispatch])

	const fetchHermesStatsData = useCallback(async () => {
		try {
			const data = await fetchHermesStats()
			if (data.stats) {
				dispatch({ type: "SET_HERMES_STATS", payload: data.stats })
			}
		} catch {
			// silent
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
			// silent
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
			if (files && files.length > 0) {
				handleFilesSelectedFromList(Array.from(files))
			}
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
	}, [])

	// ── File selection helper ────────────────────────────────────────────
	async function handleFilesSelectedFromList(fileList: File[]) {
		for (const file of fileList) {
			if (file.type.startsWith("image/")) {
				const reader = new FileReader()
				reader.onload = (e) => {
					const dataUrl = e.target?.result as string
					const attachment: ChatAttachment = {
						id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
						filename: file.name,
						type: "image",
						size: `${(file.size / 1024).toFixed(1)} KB`,
					}
					dispatch({ type: "ADD_AI_ATTACHMENT", payload: attachment })
				}
				reader.readAsDataURL(file)
			} else {
				const text = await file.text()
				const attachment: ChatAttachment = {
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: "file",
					size: `${(file.size / 1024).toFixed(1)} KB`,
				}
				dispatch({ type: "ADD_AI_ATTACHMENT", payload: attachment })
			}
		}
	}

	// ── UNIFIED AI Chat Send (WebSocket) ──────────────────────────────────
	const handleAiSend = useCallback(async () => {
		const SESSION_KEY = "superroo-chat-session"
		let sessionId = ""
		if (typeof window !== "undefined") {
			sessionId = localStorage.getItem(SESSION_KEY) || ""
			if (!sessionId) {
				sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
				localStorage.setItem(SESSION_KEY, sessionId)
			}
		}

		let text = aiInput.trim()
		if (!text && aiAttachments.length === 0) return

		let slashCommandUsed = ""
		if (text.startsWith("/")) {
			const cmd = text.split(" ")[0].toLowerCase()
			const rest = text.slice(cmd.length).trim()
			if (slashCommandHandlers[cmd]) {
				slashCommandUsed = cmd
				const fileContext = activeFilePath
					? `\n\nCurrent file: ${activeFilePath}\n\`\`\`\n${(openFiles.find((f) => f.path === activeFilePath)?.content || "").slice(0, 3000)}\n\`\`\``
					: ""
				const selectionContext = currentFileSelection
					? `\n\nSelected code:\n\`\`\`\n${currentFileSelection}\n\`\`\``
					: ""
				text = `${slashCommandHandlers[cmd]}${fileContext}${selectionContext}${rest ? `\n\nAdditional context: ${rest}` : ""}`
			}
		}

		const userMsg: ChatMessage = {
			id: `msg-${Date.now()}`,
			role: "user",
			author: "You",
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			content: slashCommandUsed
				? `${slashCommandUsed} ${aiInput.trim().slice(slashCommandUsed.length).trim()}`
				: text || "Sent files",
			attachments: aiAttachments.length > 0 ? [...aiAttachments] : undefined,
		}

		dispatch({ type: "ADD_AI_MESSAGE", payload: userMsg })
		dispatch({ type: "SET_AI_INPUT", payload: "" })
		dispatch({ type: "SET_AI_ATTACHMENTS", payload: [] })
		dispatch({ type: "SET_AI_SENDING", payload: true })
		dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: [] })
		dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })

		let currentFile = undefined
		if (activeFilePath) {
			const openFile = openFiles.find((f) => f.path === activeFilePath)
			if (openFile) {
				currentFile = {
					path: openFile.path,
					content: openFile.content,
					language: openFile.language,
					selection: currentFileSelection || undefined,
				}
			}
		}

		const allOpenFiles = openFiles.map((f) => ({
			path: f.path,
			name: f.name,
			language: f.language,
			modified: f.modified,
			content: f.path === activeFilePath ? undefined : f.content.slice(0, 2000),
		}))

		const workspaceFiles = files.map((f) => ({
			name: f.name,
			path: f.path,
			kind: f.kind,
		}))

		const terminalContext = terminalOutput.slice(-30)
		const recentHistory = aiMessages.slice(-6).map((m) => ({
			role: m.role,
			author: m.author,
			content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
		}))
		const pendingTasks = workspaceTasks.filter((t) => t.status === "pending").map((t) => t.title)

		const contextParts: string[] = []
		if (repoName) contextParts.push(`**Workspace:** ${repoName}${branch ? ` (${branch})` : ""}`)
		if (currentFile) contextParts.push(`**Active file:** \`${currentFile.path}\``)
		if (allOpenFiles.length > 1)
			contextParts.push(`**Open files:** ${allOpenFiles.map((f) => `\`${f.path}\``).join(", ")}`)
		if (terminalContext.length > 0)
			contextParts.push(`**Recent terminal output:**\n\`\`\`\n${terminalContext.join("\n")}\n\`\`\``)
		if (pendingTasks.length > 0) contextParts.push(`**Pending tasks:** ${pendingTasks.join(", ")}`)
		if (currentFileSelection) contextParts.push(`**Selected code:**\n\`\`\`\n${currentFileSelection}\n\`\`\``)

		const contextSummary = contextParts.length > 0 ? `\n\n---\n${contextParts.join("\n")}` : ""

		const payload = {
			type: "chat",
			message: text + contextSummary,
			sessionId,
			attachments: aiAttachments.map((a) => ({ filename: a.filename, type: a.type })),
			context: {
				currentFile,
				openFiles: allOpenFiles,
				workspaceFiles,
				recentHistory,
				pendingTasks,
				repoName,
				branch,
			},
		}

		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(payload))
		} else {
			try {
				const data = await apiFetch<{ reply: string; suggestions?: string[] }>("/brain/ask", {
					method: "POST",
					body: JSON.stringify({
						message: text + contextSummary,
						sessionId,
						context: {
							openFiles: allOpenFiles,
							workspaceFiles,
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
	}, [
		aiInput,
		aiAttachments,
		activeFilePath,
		openFiles,
		files,
		terminalOutput,
		aiMessages,
		workspaceTasks,
		repoName,
		branch,
		currentFileSelection,
		dispatch,
	])

	// ── Handle file selection from tree ──────────────────────────────────
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

	// ── Handle file save (CodeEditor calls onSave(value: string)) ────────
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

	// ── Handle terminal command execution ────────────────────────────────
	const handleTerminalCommand = useCallback(
		async (cmd: string) => {
			if (!cmd.trim()) return
			dispatch({ type: "SET_TERMINAL_INPUT", payload: "" })
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
		[dispatch],
	)

	// ── Handle import GitHub repo ────────────────────────────────────────
	const handleImportGithub = useCallback(async () => {
		if (!importGithubUrl.trim()) return
		setImportGithubLoading(true)
		setImportGithubError("")
		try {
			const result = await importGithubRepo(importGithubUrl, importGithubBranch)
			if (result.success) {
				// Reload workspace after import
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

	// ── Handle open workspace ────────────────────────────────────────────
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

	// ── Handle diff view ─────────────────────────────────────────────────
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

	// ── Handle inline AI button ──────────────────────────────────────────
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

	// ── Handle selection detection for inline AI button ──────────────────
	const handleEditorMouseUp = useCallback(() => {
		const selection = window.getSelection()
		if (selection && selection.toString().trim().length > 10) {
			setCurrentFileSelection(selection.toString())
			const range = selection.getRangeAt(0)
			const rect = range.getBoundingClientRect()
			setInlineSelectionPos({ top: rect.top - 40, left: rect.left })
			dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: true })
		} else {
			setCurrentFileSelection("")
			dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: false })
			setInlineSelectionPos(null)
		}
	}, [dispatch])

	// ── Loading state ────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex items-center justify-center h-full bg-[#1e1e1e]">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="animate-spin text-blue-400" size={32} />
					<span className="text-sm text-gray-400">Loading IDE...</span>
				</div>
			</div>
		)
	}

	// ══════════════════════════════════════════════════════════════════════
	// RENDER
	// ══════════════════════════════════════════════════════════════════════
	return (
		<ErrorBoundary>
			<div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200 overflow-hidden">
				{/* ── Header ─────────────────────────────────────────────── */}
				<header className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<TerminalIcon2 size={16} className="text-blue-400" />
							<span className="text-sm font-semibold text-gray-100">{repoName || "IDE Terminal"}</span>
						</div>
						{branch && (
							<span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-[#2d2d2d] rounded text-gray-400 border border-[#3c3c3c]">
								<GitBranch size={10} />
								{branch}
							</span>
						)}
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span className="flex items-center gap-1">
								<Cpu size={10} /> {status.cpu}
							</span>
							<span className="flex items-center gap-1">
								<Database size={10} /> {status.ram}
							</span>
							<span
								className={`flex items-center gap-1 ${wsConnected ? "text-green-400" : "text-red-400"}`}>
								<span
									className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400" : "bg-red-400"}`}
								/>
								{wsConnected ? "Connected" : wsReconnecting ? "Reconnecting..." : "Disconnected"}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<button
							onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Import from GitHub">
							<Github size={12} /> Import
						</button>
						<button
							onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Open Workspace">
							<FolderOpen size={12} /> Open
						</button>
						<button
							onClick={() => setShowRecentTasks((v) => !v)}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Recent Tasks">
							<ListTodo size={12} /> Tasks
						</button>
						<button
							onClick={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Keyboard Shortcuts">
							<Keyboard size={12} />
						</button>
					</div>
				</header>

				{/* ── Main Content ───────────────────────────────────────── */}
				<div className="flex flex-1 overflow-hidden">
					{/* ── File Panel ─────────────────────────────────────── */}
					{showFilePanel && (
						<ErrorBoundary>
							<aside className="w-56 shrink-0 border-r border-[#3c3c3c] bg-[#252526] flex flex-col overflow-hidden">
								<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
									<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
										Explorer
									</span>
									<div className="flex items-center gap-1">
										<button
											onClick={() => dispatch({ type: "SET_SHOW_FILE_PANEL", payload: false })}
											className="p-0.5 text-gray-500 hover:text-gray-300">
											<PanelLeftClose size={12} />
										</button>
									</div>
								</div>
								<div className="flex-1 overflow-y-auto">
									<FileTree
										items={files}
										activeFilePath={activeFilePath}
										onFileClick={handleFileSelect}
										filter={fileSearchQuery}
									/>
								</div>
							</aside>
						</ErrorBoundary>
					)}

					{/* ── Center: Editor + Terminal ──────────────────────── */}
					<div className="flex-1 flex flex-col overflow-hidden">
						{/* ── Pipeline Bar ────────────────────────────────── */}
						{pipeline.length > 0 && (
							<div className="px-4 py-1.5 bg-[#252526] border-b border-[#3c3c3c] flex items-center gap-2 text-xs overflow-x-auto shrink-0">
								<Workflow size={12} className="text-gray-500 shrink-0" />
								{pipeline.map((step) => (
									<span key={step.id} className="flex items-center gap-1 whitespace-nowrap">
										<PipelineIcon status={step.status} />
										<span
											className={
												step.status === "done"
													? "text-green-400"
													: step.status === "failed"
														? "text-red-400"
														: "text-gray-400"
											}>
											{step.label}
										</span>
										{step.duration && <span className="text-gray-600">({step.duration})</span>}
										<ChevronRight size={10} className="text-gray-600" />
									</span>
								))}
							</div>
						)}

						{/* ── Code Editor ─────────────────────────────────── */}
						<div className="flex-1 overflow-hidden relative" onMouseUp={handleEditorMouseUp}>
							{activeFilePath ? (
								<ErrorBoundary>
									<CodeEditor
										filePath={activeFilePath}
										value={currentFileContent}
										language={currentFileLanguage}
										readOnly={false}
										onSave={handleFileSave}
									/>
								</ErrorBoundary>
							) : (
								<div className="flex items-center justify-center h-full text-gray-600">
									<div className="text-center">
										<Code2 size={48} className="mx-auto mb-3 opacity-30" />
										<p className="text-sm">Select a file from the explorer to start editing</p>
										<p className="text-xs mt-1">Or use Ctrl+B to toggle the file panel</p>
									</div>
								</div>
							)}

							{/* ── Inline AI Button ────────────────────────── */}
							{showInlineAiButton && inlineSelectionPos && (
								<div
									className="absolute z-50 flex items-center gap-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md shadow-lg px-1 py-0.5"
									style={{ top: inlineSelectionPos.top, left: inlineSelectionPos.left }}>
									<button
										onClick={() => handleInlineAiAction("fix")}
										className="p-1 text-xs text-gray-400 hover:text-yellow-400 hover:bg-[#3c3c3c] rounded"
										title="Fix">
										<Bug size={12} />
									</button>
									<button
										onClick={() => handleInlineAiAction("explain")}
										className="p-1 text-xs text-gray-400 hover:text-blue-400 hover:bg-[#3c3c3c] rounded"
										title="Explain">
										<MessageCircle size={12} />
									</button>
									<button
										onClick={() => handleInlineAiAction("optimize")}
										className="p-1 text-xs text-gray-400 hover:text-green-400 hover:bg-[#3c3c3c] rounded"
										title="Optimize">
										<Zap size={12} />
									</button>
									<button
										onClick={() => handleInlineAiAction("review")}
										className="p-1 text-xs text-gray-400 hover:text-purple-400 hover:bg-[#3c3c3c] rounded"
										title="Review">
										<Search size={12} />
									</button>
								</div>
							)}
						</div>

						{/* ── Terminal ───────────────────────────────────── */}
						{showTerminal && (
							<ErrorBoundary>
								<div
									ref={terminalResizeRef}
									className="shrink-0 border-t border-[#3c3c3c] bg-[#1e1e1e] flex flex-col"
									style={{ height: isTerminalMaximized ? "50%" : terminalHeight }}>
									<div className="flex items-center justify-between px-3 py-1 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
										<div className="flex items-center gap-2">
											<TerminalIcon size={12} className="text-gray-500" />
											<span className="text-xs text-gray-400 font-medium">Terminal</span>
											<div className="flex items-center gap-1 ml-2">
												{(["shell", "agent", "skill"] as const).map((mode) => (
													<button
														key={mode}
														onClick={() => setTerminalMode(mode)}
														className={`px-1.5 py-0.5 text-[10px] rounded ${
															terminalMode === mode
																? "bg-blue-600 text-white"
																: "text-gray-500 hover:text-gray-300"
														}`}>
														{mode === "shell" ? "SH" : mode === "agent" ? "AG" : "SK"}
													</button>
												))}
											</div>
										</div>
										<div className="flex items-center gap-1">
											<button
												onClick={() =>
													dispatch({
														type: "SET_IS_TERMINAL_MAXIMIZED",
														payload: !isTerminalMaximized,
													})
												}
												className="p-0.5 text-gray-500 hover:text-gray-300">
												{isTerminalMaximized ? (
													<Minimize2 size={12} />
												) : (
													<Maximize2 size={12} />
												)}
											</button>
											<button
												onClick={() => dispatch({ type: "SET_SHOW_TERMINAL", payload: false })}
												className="p-0.5 text-gray-500 hover:text-gray-300">
												<X size={12} />
											</button>
										</div>
									</div>
									<div className="flex-1 overflow-hidden">
										<TerminalPanel
											outputBlocks={outputBlocks}
											terminalMode={terminalMode}
											terminalInput={terminalInput}
											onTerminalInputChange={(val: string) =>
												dispatch({ type: "SET_TERMINAL_INPUT", payload: val })
											}
											onTerminalCommand={() => handleTerminalCommand(terminalInput)}
											onTerminalKeyDown={(e: React.KeyboardEvent) => {
												if (e.key === "Enter") {
													handleTerminalCommand(terminalInput)
												}
											}}
											onCopyTerminal={(index: number, content: string) => {
												navigator.clipboard.writeText(content)
												setCopiedIndex(index)
												setTimeout(() => setCopiedIndex(null), 2000)
											}}
											onToggleBlockCollapse={(id: string) => {
												const next = new Set(collapsedBlocks)
												next.has(id) ? next.delete(id) : next.add(id)
												dispatch({ type: "SET_COLLAPSED_BLOCKS", payload: next })
											}}
											onClearTerminal={() =>
												dispatch({ type: "SET_TERMINAL_OUTPUT", payload: [] })
											}
											isRecording={isRecording}
											recordings={recordings}
											onStartRecording={() =>
												dispatch({ type: "SET_IS_RECORDING", payload: true })
											}
											onStopRecording={() =>
												dispatch({ type: "SET_IS_RECORDING", payload: false })
											}
											onShowRecordings={() =>
												dispatch({ type: "SET_SHOW_RECORDINGS", payload: true })
											}
											agentSuggestions={agentSuggestions}
											smartSuggestions={smartSuggestions.map((s) => ({
												label: s.label,
												command: s.command,
											}))}
											onSuggestionClick={(cmd: string) => {
												dispatch({ type: "SET_TERMINAL_INPUT", payload: cmd })
											}}
											terminalRef={terminalRef}
											terminalInputRef={terminalInputRef}
										/>
									</div>
								</div>
							</ErrorBoundary>
						)}
					</div>

					{/* ── AI Chat Panel ──────────────────────────────────── */}
					{showAiPanel && (
						<ErrorBoundary>
							<aside className="w-80 shrink-0 border-l border-[#3c3c3c] bg-[#252526] flex flex-col overflow-hidden">
								<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
									<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
										AI Chat
									</span>
									<div className="flex items-center gap-1">
										<button
											onClick={() => dispatch({ type: "SET_SHOW_AI_PANEL", payload: false })}
											className="p-0.5 text-gray-500 hover:text-gray-300">
											<PanelRightClose size={12} />
										</button>
									</div>
								</div>
								<div className="flex-1 overflow-hidden">
									<AiChatPanel
										aiMessages={aiMessages}
										aiInput={aiInput}
										onAiInputChange={(val: string) =>
											dispatch({ type: "SET_AI_INPUT", payload: val })
										}
										onAiSend={handleAiSend}
										onAiKeyDown={(e: React.KeyboardEvent) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault()
												handleAiSend()
											}
										}}
										isAiLoading={aiSending}
										canCancel={aiSending}
										onCancelAi={() => {
											// WebSocket close triggers cancellation
											if (wsRef.current) {
												wsRef.current.close()
											}
										}}
										aiAttachments={aiAttachments}
										onRemoveAttachment={(index: number) => {
											dispatch({
												type: "SET_AI_ATTACHMENTS",
												payload: aiAttachments.filter((_, i) => i !== index),
											})
										}}
										onFilesClick={() => fileInputRef.current?.click()}
										onImagesClick={() => imageInputRef.current?.click()}
										activeBrainTab={aiTab as BrainTab}
										onBrainTabChange={(tab: BrainTab) =>
											dispatch({ type: "SET_AI_TAB", payload: tab })
										}
										brainPlan={brainPlan}
										brainFeedback={brainFeedback ? [brainFeedback] : []}
										brainErrors={brainErrors}
										brainFixes={brainFixes}
										brainMemory={brainMemory}
										brainDeployments={brainDeployments}
										brainApprovals={brainApprovals}
										brainLoading={brainLoading}
										workspaceTasks={workspaceTasks}
										proactiveSuggestions={proactiveSuggestions}
										onSuggestionClick={(suggestion: string) => {
											dispatch({ type: "SET_AI_INPUT", payload: suggestion })
										}}
										onApplyCode={(code: string, language: string) => {
											setCurrentFileContent(code)
										}}
										onRunInTerminal={(code: string) => {
											dispatch({ type: "SET_TERMINAL_INPUT", payload: code })
										}}
										onFileLinkClick={(path: string) => {
											handleFileSelect(path)
										}}
										aiMessagesEndRef={aiMessagesEndRef}
										textareaRef={textareaRef}
										slashCommandFilter={slashCommandFilter}
									/>
								</div>
							</aside>
						</ErrorBoundary>
					)}
				</div>

				{/* ── Hidden file inputs ─────────────────────────────────── */}
				<input
					ref={fileInputRef}
					type="file"
					className="hidden"
					multiple
					onChange={(e) => {
						if (e.target.files) handleFilesSelectedFromList(Array.from(e.target.files))
					}}
				/>
				<input
					ref={imageInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					multiple
					onChange={(e) => {
						if (e.target.files) handleFilesSelectedFromList(Array.from(e.target.files))
					}}
				/>

				{/* ── Drag overlay ──────────────────────────────────────── */}
				{dragOver && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
						<div className="flex flex-col items-center gap-3 p-8 rounded-lg border-2 border-dashed border-blue-400 bg-[#1e1e1e]/90">
							<UploadCloud size={40} className="text-blue-400" />
							<span className="text-sm text-gray-300">Drop files to attach to AI chat</span>
						</div>
					</div>
				)}

				{/* ── Modals ─────────────────────────────────────────────── */}

				{/* Import GitHub Modal */}
				{showImportGithub && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<Github size={16} /> Import from GitHub
							</h3>
							<input
								type="text"
								placeholder="GitHub URL (e.g. https://github.com/user/repo)"
								value={importGithubUrl}
								onChange={(e) => setImportGithubUrl(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-2"
							/>
							<input
								type="text"
								placeholder="Branch (default: main)"
								value={importGithubBranch}
								onChange={(e) => setImportGithubBranch(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
							/>
							{importGithubError && <p className="text-xs text-red-400 mb-2">{importGithubError}</p>}
							<div className="flex justify-end gap-2">
								<button
									onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}
									className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
									Cancel
								</button>
								<button
									onClick={handleImportGithub}
									disabled={importGithubLoading || !importGithubUrl.trim()}
									className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
									{importGithubLoading ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Github size={12} />
									)}
									Import
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Open Workspace Modal */}
				{showOpenWorkspace && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<FolderOpen size={16} /> Open Workspace
							</h3>
							<input
								type="text"
								placeholder="Workspace path (e.g. /home/user/project)"
								value={openWorkspacePath}
								onChange={(e) => setOpenWorkspacePath(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
							/>
							{openWorkspaceError && <p className="text-xs text-red-400 mb-2">{openWorkspaceError}</p>}
							<div className="flex justify-end gap-2">
								<button
									onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}
									className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
									Cancel
								</button>
								<button
									onClick={handleOpenWorkspace}
									disabled={openWorkspaceLoading || !openWorkspacePath.trim()}
									className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
									{openWorkspaceLoading ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<FolderOpen size={12} />
									)}
									Open
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Recent Tasks Modal */}
				{showRecentTasks && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setShowRecentTasks(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl max-h-96 overflow-y-auto"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<ListTodo size={16} /> Recent Tasks
							</h3>
							{workspaceTasks.length === 0 ? (
								<p className="text-xs text-gray-500">No tasks yet</p>
							) : (
								<div className="space-y-2">
									{workspaceTasks.map((task) => (
										<div
											key={task.id}
											className="flex items-center justify-between px-2 py-1.5 bg-[#1e1e1e] rounded text-xs">
											<span className="text-gray-300 truncate flex-1">{task.title}</span>
											<span
												className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
													task.status === "done"
														? "bg-green-900 text-green-300"
														: task.status === "failed"
															? "bg-red-900 text-red-300"
															: "bg-yellow-900 text-yellow-300"
												}`}>
												{task.status}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}

				{/* Search Panel Modal */}
				{showSearchPanel && (
					<SearchPanel
						onClose={() => setShowSearchPanel(false)}
						onFileClick={(path: string, name: string) => {
							handleFileSelect(path)
							setShowSearchPanel(false)
						}}
					/>
				)}

				{/* Git Panel Modal */}
				{showGitPanel && (
					<GitPanel
						onClose={() => setShowGitPanel(false)}
						onFileClick={(path: string, name: string) => {
							handleFileSelect(path)
						}}
					/>
				)}

				{/* Diff View Modal */}
				{showDiffView && diffData && (
					<DiffViewModal
						diffData={diffData}
						onClose={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}
						onApply={() => {
							// Apply diff - reload the file content
							if (diffData.filePath) {
								handleFileSelect(diffData.filePath)
							}
							dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })
						}}
						onDiscard={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}
					/>
				)}

				{/* Keyboard Shortcuts Modal */}
				{showShortcuts && (
					<KeyboardShortcutsModal onClose={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: false })} />
				)}
			</div>
		</ErrorBoundary>
	)
}
