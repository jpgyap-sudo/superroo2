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
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────

interface WorkspaceFile {
	path: string
	name: string
	kind: "file" | "folder"
	modified?: boolean
	children?: WorkspaceFile[]
}

interface PipelineStep {
	id: string
	label: string
	status: "pending" | "running" | "done" | "approval" | "blocked" | "failed"
	agent?: string
	duration?: string
}

interface ChatAttachment {
	id: string
	filename: string
	type: string
	size: string
}

interface ChatMessage {
	id: string
	role: "user" | "assistant" | "agent"
	author: string
	meta?: string
	time: string
	content: string
	attachments?: ChatAttachment[]
}

interface TerminalSession {
	id: string
	name: string
	cwd: string
	output: string[]
}

interface WorkspaceStatus {
	connected: boolean
	docker: boolean
	redis: boolean
	cpu: string
	ram: string
}

// Terminal Brain types
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
	verification?: string
}

interface BrainError {
	type: string
	message: string
	confidence?: number
	rootCause?: string
	fix?: string
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
		totalFixes: number
		totalDeployments: number
		successRate: number
	}
	commands?: Array<{ command: string; timestamp?: string; status?: string }>
}

interface BrainDeployment {
	version?: string
	id?: string
	status: string
	timestamp?: string
	time?: string
	agent?: string
}

interface BrainApproval {
	command?: string
	action?: string
	reason?: string
	message?: string
}

interface ProjectContext {
	name?: string
	framework?: string
	packageManager?: string
	nodeVersion?: string
	port?: number
	branch?: string
	hasDocker?: boolean
	hasTypeScript?: boolean
}

// ─── API helper ──────────────────────────────────────────────────────────

const API_BASE = "/api/ide-workspace"
const BRAIN_API = "/api/terminal-brain"

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }))
		throw new Error(err.error || `API error ${res.status}`)
	}
	return res.json()
}

async function brainApi<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
	const method = payload ? "POST" : "GET"
	const res = await fetch(`${BRAIN_API}/${action}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(payload ? { body: JSON.stringify(payload) } : {}),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }))
		throw new Error(err.error || `Brain API error ${res.status}`)
	}
	return res.json()
}

// ─── Pipeline icon helper ─────────────────────────────────────────────────

function PipelineIcon({ status }: { status: string }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={14} className="text-green-400" />
		case "running":
			return <Loader2 size={14} className="text-blue-400 animate-spin" />
		case "approval":
			return <AlertTriangle size={14} className="text-yellow-400" />
		case "blocked":
			return <XCircle size={14} className="text-red-400" />
		case "failed":
			return <XCircle size={14} className="text-red-400" />
		default:
			return <Clock size={14} className="text-gray-500" />
	}
}

// ─── FileTree component ───────────────────────────────────────────────────

function FileTree({
	items,
	depth = 0,
	onFileClick,
	searchQuery,
}: {
	items: WorkspaceFile[]
	depth?: number
	onFileClick?: (path: string, name: string) => void
	searchQuery?: string
}) {
	const filtered = searchQuery
		? items.filter((item) => {
				const nameMatch = item.name.toLowerCase().includes(searchQuery.toLowerCase())
				const childrenMatch = item.children
					? item.children.some((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
					: false
				return nameMatch || childrenMatch
			})
		: items

	return (
		<>
			{filtered.map((item) => (
				<div key={item.path}>
					<div
						onClick={() => item.kind === "file" && onFileClick?.(item.path, item.name)}
						className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${item.kind === "file" ? "cursor-pointer hover:bg-[#1e2535]" : ""} ${item.modified ? "text-violet-300" : "text-gray-400"}`}
						style={{ paddingLeft: `${10 + depth * 14}px` }}>
						{item.kind === "folder" ? (
							<Folder size={14} className="text-yellow-500" />
						) : (
							<FileText size={14} className="text-blue-400" />
						)}
						<span>{item.name}</span>
						{item.modified && <span className="ml-auto text-[10px] font-bold text-orange-400">M</span>}
					</div>
					{item.children && (
						<FileTree
							items={item.children}
							depth={depth + 1}
							onFileClick={onFileClick}
							searchQuery={searchQuery}
						/>
					)}
				</div>
			))}
		</>
	)
}

// ─── Keyboard Shortcuts Modal ─────────────────────────────────────────────

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
	const shortcuts = [
		{ key: "Ctrl+`", desc: "Toggle terminal focus" },
		{ key: "Ctrl+P", desc: "File search" },
		{ key: "Ctrl+S", desc: "Save current file" },
		{ key: "Ctrl+Enter", desc: "Send chat message" },
		{ key: "Ctrl+Shift+P", desc: "Command palette" },
		{ key: "Ctrl+K", desc: "Clear terminal" },
		{ key: "Escape", desc: "Close modals / suggestions" },
		{ key: "Tab", desc: "Autocomplete agent command" },
	]
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 max-w-md w-full mx-4"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-semibold text-[#e2e8f0] flex items-center gap-2">
						<Keyboard size={14} /> Keyboard Shortcuts
					</h3>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-300">
						<X size={14} />
					</button>
				</div>
				<div className="space-y-1">
					{shortcuts.map((s) => (
						<div key={s.key} className="flex items-center justify-between py-1 text-[11px]">
							<span className="text-gray-400">{s.desc}</span>
							<kbd className="px-1.5 py-0.5 rounded bg-[#1e2535] text-violet-400 font-mono text-[10px]">
								{s.key}
							</kbd>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

// ─── Main component ───────────────────────────────────────────────────────

export default function IdeTerminalView() {
	const [input, setInput] = useState("")
	const [terminalInput, setTerminalInput] = useState("")
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [terminalOutput, setTerminalOutput] = useState<string[]>([
		"Welcome to SuperRoo IDE Terminal",
		"Type a command to get started...",
		"",
		"╔══════════════════════════════════════════════╗",
		"║  Agent Mode: Prefix commands with / or @    ║",
		"║  /help — Show all agent commands            ║",
		"║  /skills — List available skills            ║",
		"║  /deploy — Deploy the project               ║",
		"║  /orchestrate — Break down complex tasks    ║",
		"║  @coder <task> — Delegate to Coder agent    ║",
		"╚══════════════════════════════════════════════╝",
		"",
	])
	const [pipeline, setPipeline] = useState<PipelineStep[]>([])
	const [files, setFiles] = useState<WorkspaceFile[]>([])
	const [openFiles, setOpenFiles] = useState<
		{ path: string; name: string; content: string; language: string; modified?: boolean }[]
	>([])
	const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
	const [status, setStatus] = useState<WorkspaceStatus>({
		connected: true,
		docker: false,
		redis: false,
		cpu: "0%",
		ram: "0MB",
	})
	const [activeMode, setActiveMode] = useState("Auto")
	const [activeContextPills, setActiveContextPills] = useState<Set<string>>(new Set(["3 files"]))
	const [attachments, setAttachments] = useState<ChatAttachment[]>([])
	const [sending, setSending] = useState(false)
	const [loading, setLoading] = useState(true)
	const [loopInfo] = useState({ loop: "#841", phase: "approval", agent: "Kimi", pending: 3 })
	const [repoName, setRepoName] = useState("superroo2")
	const [branch, setBranch] = useState("auto-improvement")
	const [importUrl, setImportUrl] = useState("")
	const [showImport, setShowImport] = useState(false)
	// ── Agent/Skill awareness state ──────────────────────────────────────
	const [terminalMode, setTerminalMode] = useState<"shell" | "agent" | "skill">("shell")
	const [activeAgent, setActiveAgent] = useState<string | null>(null)
	const [agentRunning, setAgentRunning] = useState(false)
	const [agentSuggestions, setAgentSuggestions] = useState<string[]>([])
	const [showAgentSuggestions, setShowAgentSuggestions] = useState(false)
	// ── File search ──────────────────────────────────────────────────────
	const [fileSearchQuery, setFileSearchQuery] = useState("")
	const [showFileSearch, setShowFileSearch] = useState(false)
	const fileSearchRef = useRef<HTMLInputElement>(null)
	// ── Keyboard shortcuts modal ─────────────────────────────────────────
	const [showShortcuts, setShowShortcuts] = useState(false)
	// ── Terminal Brain state ─────────────────────────────────────────────
	const [brainTab, setBrainTab] = useState<string>("command")
	const [brainPlan, setBrainPlan] = useState<BrainPlanStep[]>([])
	const [brainFeedback, setBrainFeedback] = useState<BrainFeedback | null>(null)
	const [brainErrors, setBrainErrors] = useState<BrainError[]>([])
	const [brainFixes, setBrainFixes] = useState<BrainFix[]>([])
	const [brainMemory, setBrainMemory] = useState<BrainMemory | null>(null)
	const [brainDeployments, setBrainDeployments] = useState<BrainDeployment[]>([])
	const [brainApprovals, setBrainApprovals] = useState<BrainApproval[]>([])
	const [brainContext, setBrainContext] = useState<ProjectContext | null>(null)
	const [brainLoading, setBrainLoading] = useState(false)
	const [brainInput, setBrainInput] = useState("")
	// ── Drag & drop ──────────────────────────────────────────────────────
	const [dragOver, setDragOver] = useState(false)
	const dragCounter = useRef(0)
	// ── Copy feedback ────────────────────────────────────────────────────
	const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLPreElement>(null)
	const terminalInputRef = useRef<HTMLInputElement>(null)

	// ── Agent command definitions (mirrors backend) ──────────────────────
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
			icon: "GitMerge",
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

	// ── Detect if input is an agent command ──────────────────────────────
	const isAgentCommand = (cmd: string) => cmd.startsWith("/") || cmd.startsWith("@")
	const isSkillCommand = (cmd: string) => cmd.startsWith("/skill ") || cmd.startsWith("/skills ")
	const isAgentMention = (cmd: string) => cmd.startsWith("@")

	// ── Get matching suggestions for autocomplete ────────────────────────
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
	useEffect(() => {
		async function load() {
			try {
				const data = await api<{
					workspaceId: string | null
					repoName: string | null
					branch: string
					files: WorkspaceFile[]
					pipeline: PipelineStep[]
					terminalSessions: TerminalSession[]
					chatMessages: ChatMessage[]
					status: WorkspaceStatus
				}>("/workspace")
				if (data.repoName) setRepoName(data.repoName)
				if (data.branch) setBranch(data.branch)
				if (data.files?.length) setFiles(data.files)
				if (data.pipeline?.length) setPipeline(data.pipeline)
				if (data.chatMessages?.length) setMessages(data.chatMessages)
				if (data.status) setStatus(data.status)
				if (data.terminalSessions?.length) {
					setTerminalOutput(data.terminalSessions[0].output)
				}
				// Load Terminal Brain context
				try {
					const ctx = await brainApi<{ context?: ProjectContext; projectContext?: ProjectContext }>("context")
					setBrainContext(ctx.context || ctx.projectContext || null)
				} catch {}
				// Load Terminal Brain memory
				try {
					const mem = await brainApi<{ memory?: BrainMemory }>("memory")
					setBrainMemory(mem.memory || null)
				} catch {}
			} catch (err) {
				console.error("Failed to load workspace:", err)
			} finally {
				setLoading(false)
			}
		}
		load()
	}, [])

	// ── Auto-scroll messages ──────────────────────────────────────────────
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages])

	// ── Auto-scroll terminal ──────────────────────────────────────────────
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight
		}
	}, [terminalOutput])

	// ── Keyboard shortcuts ────────────────────────────────────────────────
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			if (e.ctrlKey && e.key === "`") {
				e.preventDefault()
				terminalInputRef.current?.focus()
			}
			if (e.ctrlKey && e.key === "p") {
				e.preventDefault()
				setShowFileSearch(true)
				setTimeout(() => fileSearchRef.current?.focus(), 50)
			}
			if (e.ctrlKey && e.key === "s") {
				e.preventDefault()
				handleSaveFile()
			}
			if (e.ctrlKey && e.shiftKey && e.key === "P") {
				e.preventDefault()
				setShowShortcuts(true)
			}
			if (e.key === "Escape") {
				setShowFileSearch(false)
				setShowShortcuts(false)
				setShowAgentSuggestions(false)
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown)
		return () => window.removeEventListener("keydown", handleGlobalKeyDown)
	}, [])

	// ── Drag & drop handlers ─────────────────────────────────────────────
	useEffect(() => {
		function handleDragEnter(e: DragEvent) {
			e.preventDefault()
			dragCounter.current++
			if (dragCounter.current === 1) setDragOver(true)
		}
		function handleDragLeave(e: DragEvent) {
			e.preventDefault()
			dragCounter.current--
			if (dragCounter.current === 0) setDragOver(false)
		}
		function handleDragOver(e: DragEvent) {
			e.preventDefault()
		}
		function handleDrop(e: DragEvent) {
			e.preventDefault()
			dragCounter.current = 0
			setDragOver(false)
			const files = e.dataTransfer?.files
			if (files && files.length > 0) {
				const newAttachments: ChatAttachment[] = []
				for (let i = 0; i < files.length; i++) {
					const file = files[i]
					const ext = file.name.split(".").pop()?.toUpperCase() || "FILE"
					newAttachments.push({
						id: `att-${Date.now()}-${i}`,
						filename: file.name,
						type: ext,
						size: `${(file.size / 1024).toFixed(1)} KB`,
					})
				}
				setAttachments((prev) => [...prev, ...newAttachments])
			}
		}
		window.addEventListener("dragenter", handleDragEnter)
		window.addEventListener("dragleave", handleDragLeave)
		window.addEventListener("dragover", handleDragOver)
		window.addEventListener("drop", handleDrop)
		return () => {
			window.removeEventListener("dragenter", handleDragEnter)
			window.removeEventListener("dragleave", handleDragLeave)
			window.removeEventListener("dragover", handleDragOver)
			window.removeEventListener("drop", handleDrop)
		}
	}, [])

	// ── Ctrl+V paste handler for files/images ────────────────────────────
	useEffect(() => {
		function handlePaste(e: ClipboardEvent) {
			const items = e.clipboardData?.items
			if (!items) return

			const newAttachments: ChatAttachment[] = []
			for (let i = 0; i < items.length; i++) {
				const item = items[i]
				if (item.kind === "file") {
					const file = item.getAsFile()
					if (!file) continue
					const ext = file.name.split(".").pop()?.toUpperCase() || "FILE"
					const type = file.type.startsWith("image/") ? "IMAGE" : ext
					newAttachments.push({
						id: `att-${Date.now()}-${i}`,
						filename: file.name || `pasted-${Date.now()}.${ext.toLowerCase()}`,
						type,
						size: `${(file.size / 1024).toFixed(1)} KB`,
					})
				}
			}
			if (newAttachments.length > 0) {
				e.preventDefault()
				setAttachments((prev) => [...prev, ...newAttachments])
			}
		}

		const textarea = document.querySelector("textarea")
		if (textarea) {
			textarea.addEventListener("paste", handlePaste)
			return () => textarea.removeEventListener("paste", handlePaste)
		}
	}, [])

	// ── Send chat message ─────────────────────────────────────────────────
	const handleSend = useCallback(async () => {
		const text = input.trim()
		if (!text && attachments.length === 0) return

		const userMsg: ChatMessage = {
			id: `msg-${Date.now()}`,
			role: "user",
			author: "You",
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			content: text || "Sent files",
			attachments: attachments.length > 0 ? [...attachments] : undefined,
		}

		setMessages((prev) => [...prev, userMsg])
		setInput("")
		setAttachments([])
		setSending(true)

		try {
			const body: Record<string, unknown> = {
				message: text,
				attachments: attachments.map((a) => ({ filename: a.filename, type: a.type, size: a.size })),
			}
			const storedProvider = typeof window !== "undefined" ? localStorage.getItem("superroo-chat-provider") : null
			if (storedProvider && storedProvider !== "auto") {
				body.provider = storedProvider
			}
			const result = await api<{
				ok: boolean
				message?: string
				reply?: string
				provider?: string
				model?: string
				intent?: string
				intentConfidence?: number
				agent?: string
			}>("/chat", {
				method: "POST",
				body: JSON.stringify(body),
			})

			const replyText = result.reply || result.message || "Message received. Processing your request..."
			const intentLabel = result.intent || "chat"
			const confidence = result.intentConfidence ? `${(result.intentConfidence * 100).toFixed(0)}%` : ""
			const agentName = result.agent || "chat"
			const providerName = result.provider || "AI"
			const metaParts = [agentName]
			if (confidence) metaParts.push(`conf ${confidence}`)
			if (result.model) metaParts.push(result.model)
			const assistantMsg: ChatMessage = {
				id: `msg-${Date.now() + 1}`,
				role: "agent",
				author: providerName,
				meta: metaParts.join(" · "),
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: replyText,
			}
			setMessages((prev) => [...prev, assistantMsg])
		} catch (err) {
			const errorMsg: ChatMessage = {
				id: `msg-${Date.now() + 1}`,
				role: "assistant",
				author: "System",
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: `Error: ${err instanceof Error ? err.message : "Failed to send message"}`,
			}
			setMessages((prev) => [...prev, errorMsg])
		} finally {
			setSending(false)
		}
	}, [input, attachments])

	// ── Handle Enter key in chat ──────────────────────────────────────────
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleSend()
			}
		},
		[handleSend],
	)

	// ── File attachment ───────────────────────────────────────────────────
	const handleFileAttach = useCallback(() => {
		fileInputRef.current?.click()
	}, [])

	const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const fileList = e.target.files
		if (!fileList) return

		const newAttachments: ChatAttachment[] = []
		for (let i = 0; i < fileList.length; i++) {
			const file = fileList[i]
			const ext = file.name.split(".").pop()?.toUpperCase() || "FILE"
			newAttachments.push({
				id: `att-${Date.now()}-${i}`,
				filename: file.name,
				type: ext,
				size: `${(file.size / 1024).toFixed(1)} KB`,
			})
		}
		setAttachments((prev) => [...prev, ...newAttachments])
		e.target.value = ""
	}, [])

	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => prev.filter((a) => a.id !== id))
	}, [])

	// ── Image attachment ──────────────────────────────────────────────────
	const handleImageAttach = useCallback(() => {
		imageInputRef.current?.click()
	}, [])

	const handleImagesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const fileList = e.target.files
		if (!fileList) return

		const newAttachments: ChatAttachment[] = []
		for (let i = 0; i < fileList.length; i++) {
			const file = fileList[i]
			newAttachments.push({
				id: `att-${Date.now()}-${i}`,
				filename: file.name,
				type: "IMAGE",
				size: `${(file.size / 1024).toFixed(1)} KB`,
			})
		}
		setAttachments((prev) => [...prev, ...newAttachments])
		e.target.value = ""
	}, [])

	// ── File click handler — open file from tree ──────────────────────────
	const handleFileClick = useCallback(
		async (filePath: string, fileName: string) => {
			if (openFiles.some((f) => f.path === filePath)) {
				setActiveFilePath(filePath)
				return
			}

			try {
				const result = await api<{
					ok: boolean
					content?: string
					language?: string
					error?: string
				}>(`/file/read?path=${encodeURIComponent(filePath)}`)

				if (result.ok && result.content !== undefined) {
					const newFile = {
						path: filePath,
						name: fileName,
						content: result.content,
						language: result.language || "text",
					}
					setOpenFiles((prev) => [...prev, newFile])
					setActiveFilePath(filePath)
				}
			} catch (err) {
				console.error("Failed to open file:", err)
			}
		},
		[openFiles],
	)

	// ── Save file handler ─────────────────────────────────────────────────
	const handleSaveFile = useCallback(async () => {
		if (!activeFilePath) return
		const file = openFiles.find((f) => f.path === activeFilePath)
		if (!file) return

		try {
			const result = await api<{ ok: boolean; error?: string }>("/file/save", {
				method: "POST",
				body: JSON.stringify({ path: file.path, content: file.content }),
			})
			if (result.ok) {
				setOpenFiles((prev) => prev.map((f) => (f.path === activeFilePath ? { ...f, modified: false } : f)))
			}
		} catch (err) {
			console.error("Failed to save file:", err)
		}
	}, [activeFilePath, openFiles])

	// ── Track content changes for modified indicator ──────────────────────
	const handleEditorContentChange = useCallback((filePath: string, newContent: string) => {
		setOpenFiles((prev) =>
			prev.map((f) => (f.path === filePath ? { ...f, content: newContent, modified: true } : f)),
		)
	}, [])

	// ── Terminal command execution (agent-aware) ──────────────────────────
	const handleTerminalCommand = useCallback(async () => {
		const cmd = terminalInput.trim()
		if (!cmd) return

		const isAgent = isAgentCommand(cmd)
		const isSkill = isSkillCommand(cmd)
		const isMention = isAgentMention(cmd)

		const modePrefix = isAgent ? "🤖" : isSkill ? "✨" : "$"
		setTerminalOutput((prev) => [...prev, `${modePrefix} ${cmd}`])
		setTerminalInput("")
		setShowAgentSuggestions(false)

		if (isAgent || isSkill) {
			setTerminalMode(isSkill ? "skill" : "agent")
			setAgentRunning(true)
			const agentName = isMention ? cmd.split(" ")[0].slice(1) : cmd.split(" ")[0].slice(1)
			setActiveAgent(agentName || "agent")
		}

		try {
			const result = await api<{
				ok: boolean
				output?: string[]
				message?: string
				agent?: string
				skill?: boolean
			}>("/terminal/execute", {
				method: "POST",
				body: JSON.stringify({ command: cmd, terminalId: "term-1" }),
			})

			if (result.output?.length) {
				if (isAgent || isSkill) {
					const agentLabel = result.agent || "agent"
					setTerminalOutput((prev) => [
						...prev,
						`┌─ [${result.skill ? "✨ Skill" : "🤖 Agent"}: ${agentLabel}] ─────────────────────`,
						...result.output!,
						`└──────────────────────────────────────────────────`,
					])
				} else {
					setTerminalOutput((prev) => [...prev, ...result.output!])
				}
			} else if (result.message) {
				setTerminalOutput((prev) => [...prev, result.message!])
			} else {
				setTerminalOutput((prev) => [...prev, `Command executed: ${cmd}`])
			}
		} catch (err) {
			setTerminalOutput((prev) => [...prev, `Error: ${err instanceof Error ? err.message : "Command failed"}`])
		} finally {
			setAgentRunning(false)
			setActiveAgent(null)
			setTerminalMode("shell")
		}
	}, [terminalInput])

	const handleTerminalKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault()
				handleTerminalCommand()
			}
			if (e.key === "Tab") {
				e.preventDefault()
				const suggestions = getAgentSuggestions(terminalInput)
				if (suggestions.length === 1) {
					setTerminalInput(suggestions[0] + " ")
					setShowAgentSuggestions(false)
				}
			}
			if (e.key === "Escape") {
				setShowAgentSuggestions(false)
			}
		},
		[handleTerminalCommand, terminalInput],
	)

	const handleTerminalInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value
		setTerminalInput(value)

		if (value.startsWith("/") || value.startsWith("@")) {
			const suggestions = getAgentSuggestions(value)
			setAgentSuggestions(suggestions)
			setShowAgentSuggestions(suggestions.length > 0)
		} else {
			setShowAgentSuggestions(false)
		}
	}, [])

	// ── Clear terminal ────────────────────────────────────────────────────
	const handleClearTerminal = useCallback(() => {
		setTerminalOutput([])
	}, [])

	// ── Copy terminal output ──────────────────────────────────────────────
	const handleCopyTerminal = useCallback(() => {
		const text = terminalOutput.join("\n")
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopiedIndex(0)
				setTimeout(() => setCopiedIndex(null), 2000)
			})
			.catch(() => {})
	}, [terminalOutput])

	// ── Terminal Brain handlers ───────────────────────────────────────────
	const handleBrainSend = useCallback(async () => {
		const query = brainInput.trim()
		if (!query) return
		setBrainLoading(true)
		setBrainPlan([])
		setBrainFeedback(null)
		setBrainErrors([])
		setBrainFixes([])
		try {
			const planResult = await brainApi<{
				plan?: BrainPlanStep[]
				steps?: BrainPlanStep[]
				intent?: string
				confidence?: number
			}>("plan", { query })
			const steps = planResult.plan || planResult.steps || []
			setBrainPlan(steps)
			setBrainTab("command")
			let allOutput = ""
			const allErrors: BrainError[] = []
			const allFixes: BrainFix[] = []
			for (const step of steps) {
				const execResult = await brainApi<{
					feedback?: BrainFeedback
					output?: string
					exitCode?: number
					errors?: BrainError[]
					fixes?: BrainFix[]
				}>("execute", { command: step.command })
				const fb = execResult.feedback || {
					status: "done",
					output: execResult.output || "",
					exitCode: execResult.exitCode,
					errors: execResult.errors,
					fixes: execResult.fixes,
				}
				allOutput += fb.output + "\n"
				if (fb.errors?.length) allErrors.push(...fb.errors)
				if (fb.fixes?.length) allFixes.push(...fb.fixes)
			}
			setBrainFeedback({
				status: allErrors.length > 0 ? "error" : "done",
				output: allOutput.trim(),
				errors: allErrors,
				fixes: allFixes,
			})
			setBrainErrors(allErrors)
			setBrainFixes(allFixes)
			if (allErrors.length > 0) setBrainTab("errors")
		} catch (err) {
			setBrainFeedback({
				status: "error",
				output: `Error: ${err instanceof Error ? err.message : "Brain command failed"}`,
			})
		} finally {
			setBrainLoading(false)
			setBrainInput("")
		}
	}, [brainInput])

	const handleBrainKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleBrainSend()
			}
		},
		[handleBrainSend],
	)

	const handleApproveAction = useCallback(
		async (index: number) => {
			const approval = brainApprovals[index]
			if (!approval) return
			try {
				const result = await brainApi<{ ok: boolean; output?: string }>("execute", {
					command: approval.command || approval.action,
				})
				setBrainApprovals((prev) => prev.filter((_, i) => i !== index))
				setBrainFeedback((prev) =>
					prev
						? {
								...prev,
								output:
									(prev.output || "") +
									"\n✅ Approved: " +
									(approval.command || approval.action || "") +
									"\n" +
									(result.output || ""),
							}
						: prev,
				)
			} catch (err) {
				setBrainFeedback((prev) =>
					prev
						? {
								...prev,
								output:
									(prev.output || "") +
									"\n❌ Failed: " +
									(err instanceof Error ? err.message : "Approval execution failed"),
							}
						: prev,
				)
			}
		},
		[brainApprovals],
	)

	const handleRejectAction = useCallback((index: number) => {
		setBrainApprovals((prev) => prev.filter((_, i) => i !== index))
	}, [])

	// ── Loading state ─────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex items-center justify-center h-full bg-[#0a0e1a]">
				<div className="flex flex-col items-center gap-3">
					<Loader2 size={24} className="text-violet-400 animate-spin" />
					<span className="text-xs text-gray-500">Loading workspace...</span>
				</div>
			</div>
		)
	}

	// ── Render ────────────────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full bg-[#0a0e1a] text-[#c8d0e0]">
			{/* Drag & drop overlay */}
			{dragOver && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0e1a]/80 border-2 border-dashed border-violet-500/50 pointer-events-none">
					<div className="flex flex-col items-center gap-3 text-violet-400">
						<UploadCloud size={48} />
						<span className="text-lg font-semibold">Drop files to attach</span>
					</div>
				</div>
			)}

			{/* File search overlay */}
			{showFileSearch && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60"
					onClick={() => setShowFileSearch(false)}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-3 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center gap-2 px-2 py-1 mb-2 border border-[#1e2535] rounded bg-[#0a0e1a]">
							<Search size={14} className="text-gray-500" />
							<input
								ref={fileSearchRef}
								type="text"
								value={fileSearchQuery}
								onChange={(e) => setFileSearchQuery(e.target.value)}
								placeholder="Search files..."
								className="flex-1 bg-transparent border-none outline-none text-xs text-[#e2e8f0] placeholder-gray-600"
							/>
						</div>
						<div className="max-h-60 overflow-y-auto">
							<FileTree
								items={files}
								onFileClick={(path, name) => {
									handleFileClick(path, name)
									setShowFileSearch(false)
									setFileSearchQuery("")
								}}
								searchQuery={fileSearchQuery}
							/>
						</div>
					</div>
				</div>
			)}

			{/* Keyboard Shortcuts Modal */}
			{showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

			{/* Top bar */}
			<header className="flex items-center justify-between px-4 py-2 border-b border-[#1e2535] bg-[#0a0e1a] shrink-0">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Code2 size={16} className="text-violet-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">{repoName}</span>
					</div>
					<span className="text-[10px] text-gray-600">|</span>
					<div className="flex items-center gap-1.5 text-[10px] text-gray-500">
						<GitBranch size={11} />
						<span>{branch}</span>
					</div>
					<span className="text-[10px] text-gray-600">|</span>
					<div className="flex items-center gap-2 text-[10px]">
						<span
							className={`inline-block w-1.5 h-1.5 rounded-full ${status.connected ? "bg-green-400" : "bg-red-400"}`}
						/>
						<span className="text-gray-500">{status.connected ? "Connected" : "Disconnected"}</span>
						<span className="text-gray-600">CPU {status.cpu}</span>
						<span className="text-gray-600">RAM {status.ram}</span>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowShortcuts(true)}
						className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
						title="Keyboard Shortcuts">
						<Keyboard size={11} />
						<span>Shortcuts</span>
					</button>
					<button
						onClick={() => setShowFileSearch(true)}
						className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
						title="Search files (Ctrl+P)">
						<Search size={11} />
						<span>Search</span>
					</button>
					<button className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors">
						<Settings size={11} />
					</button>
				</div>
			</header>

			{/* Main content */}
			<section className="flex flex-1 min-h-0">
				{/* Left sidebar: File tree */}
				<aside className="w-56 shrink-0 border-r border-[#1e2535] bg-[#0a0e1a] overflow-y-auto flex flex-col">
					<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
						<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Files</span>
						<div className="flex items-center gap-1">
							<button className="p-0.5 text-gray-500 hover:text-gray-300 rounded" title="Refresh files">
								<RefreshCw size={11} />
							</button>
							<button className="p-0.5 text-gray-500 hover:text-gray-300 rounded" title="New file">
								<Plus size={11} />
							</button>
						</div>
					</div>
					<div className="flex-1 overflow-y-auto py-1">
						<FileTree items={files} onFileClick={handleFileClick} />
					</div>
				</aside>

				{/* Center: Editor + Terminal + Chat */}
				<main className="flex flex-col flex-1 min-w-0">
					{/* Editor tabs */}
					{openFiles.length > 0 && (
						<div className="flex items-center border-b border-[#1e2535] bg-[#0a0e1a] overflow-x-auto shrink-0">
							{openFiles.map((f) => (
								<button
									key={f.path}
									onClick={() => setActiveFilePath(f.path)}
									className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-[#1e2535] transition-colors whitespace-nowrap ${activeFilePath === f.path ? "bg-[#1e2535] text-[#e2e8f0]" : "text-gray-500 hover:text-gray-300"}`}>
									<FileText size={12} />
									<span>{f.name}</span>
									{f.modified && <span className="text-orange-400 text-[10px] font-bold">●</span>}
									<button
										onClick={(e) => {
											e.stopPropagation()
											setOpenFiles((prev) => prev.filter((x) => x.path !== f.path))
											if (activeFilePath === f.path) setActiveFilePath(null)
										}}
										className="ml-1 text-gray-600 hover:text-gray-300">
										<X size={10} />
									</button>
								</button>
							))}
						</div>
					)}

					{/* Editor area */}
					{activeFilePath ? (
						<div className="flex-1 overflow-hidden bg-[#0a0e1a]">
							{(() => {
								const file = openFiles.find((f) => f.path === activeFilePath)
								if (!file) return null
								return (
									<textarea
										value={file.content}
										onChange={(e) => handleEditorContentChange(file.path, e.target.value)}
										className="w-full h-full p-4 font-mono text-xs leading-relaxed bg-transparent text-[#e2e8f0] resize-none outline-none border-none"
										spellCheck={false}
									/>
								)
							})()}
						</div>
					) : (
						<div className="flex-1 flex items-center justify-center bg-[#0a0e1a]">
							<div className="text-center">
								<Code2 size={32} className="mx-auto mb-2 text-gray-700" />
								<p className="text-xs text-gray-600">
									Select a file from the explorer to start editing
								</p>
							</div>
						</div>
					)}

					{/* Pipeline bar */}
					{pipeline.length > 0 && (
						<div className="flex items-center gap-2 px-3 py-1.5 border-t border-b border-[#1e2535] bg-[#0f1117] overflow-x-auto shrink-0">
							<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1">
								Pipeline
							</span>
							{pipeline.map((s, i) => (
								<div key={s.id} className="flex items-center gap-1.5">
									{i > 0 && <ChevronRight size={10} className="text-gray-600" />}
									<div
										className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${s.status === "done" ? "bg-green-900/30 text-green-400" : s.status === "running" ? "bg-blue-900/30 text-blue-400" : s.status === "failed" ? "bg-red-900/30 text-red-400" : "bg-[#1e2535] text-gray-400"}`}>
										<PipelineIcon status={s.status} />
										<span>{s.label}</span>
										{s.agent && <span className="text-[9px] text-gray-500">({s.agent})</span>}
									</div>
								</div>
							))}
						</div>
					)}

					{/* Terminal */}
					<div
						className="border-t border-[#1e2535] bg-[#0a0e1a] flex flex-col shrink-0"
						style={{ height: "180px" }}>
						<div className="flex items-center justify-between px-3 py-1 border-b border-[#1e2535] shrink-0">
							<div className="flex items-center gap-2">
								<Terminal size={12} className="text-gray-500" />
								<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
									Terminal
								</span>
								{agentRunning && (
									<span className="flex items-center gap-1 text-[10px] text-violet-400">
										<Loader2 size={10} className="animate-spin" /> Running {activeAgent}...
									</span>
								)}
							</div>
							<div className="flex items-center gap-1">
								<button
									onClick={handleCopyTerminal}
									className="p-1 text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
									title="Copy terminal output">
									{copiedIndex === 0 ? (
										<Check size={11} className="text-green-400" />
									) : (
										<Copy size={11} />
									)}
								</button>
								<button
									onClick={handleClearTerminal}
									className="p-1 text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
									title="Clear terminal (Ctrl+K)">
									<Trash2 size={11} />
								</button>
							</div>
						</div>
						<pre
							ref={terminalRef}
							className="flex-1 p-2 font-mono text-xs leading-relaxed text-green-400/90 overflow-auto whitespace-pre-wrap break-all">
							{terminalOutput.join("\n")}
						</pre>
						<div className="flex items-center gap-1 px-2 py-1 border-t border-[#1e2535] bg-[#0f1117] shrink-0 relative">
							{agentRunning && <Loader2 size={10} className="text-violet-400 animate-spin shrink-0" />}
							<span className="text-[10px] text-green-400 shrink-0">
								{terminalMode === "agent" ? "🤖" : terminalMode === "skill" ? "✨" : "$"}
							</span>
							<input
								ref={terminalInputRef}
								type="text"
								value={terminalInput}
								onChange={handleTerminalInputChange}
								onKeyDown={handleTerminalKeyDown}
								placeholder={
									terminalMode === "agent" ? "Type /command or @agent..." : "Type a command..."
								}
								className="flex-1 bg-transparent border-none outline-none text-xs text-[#e2e8f0] placeholder-gray-600 font-mono"
								disabled={agentRunning}
							/>
							{showAgentSuggestions && (
								<div className="absolute bottom-full left-0 right-0 mb-1 mx-2 bg-[#0f1117] border border-[#1e2535] rounded shadow-lg z-10">
									{agentSuggestions.map((s) => {
										const cmd = agentCommands[s]
										return (
											<button
												key={s}
												onClick={() => {
													setTerminalInput(s + " ")
													setShowAgentSuggestions(false)
													terminalInputRef.current?.focus()
												}}
												className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-left hover:bg-[#1e2535] transition-colors">
												<span className="text-violet-400 font-semibold">{s}</span>
												{cmd && <span className="text-gray-500">— {cmd.description}</span>}
											</button>
										)
									})}
								</div>
							)}
						</div>
					</div>

					{/* Chat area */}
					<div
						className="border-t border-[#1e2535] bg-[#0a0e1a] flex flex-col shrink-0"
						style={{ height: "200px" }}>
						<div className="flex items-center justify-between px-3 py-1 border-b border-[#1e2535] shrink-0">
							<div className="flex items-center gap-2">
								<MessageSquare size={12} className="text-gray-500" />
								<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
									Chat
								</span>
							</div>
							<div className="flex items-center gap-1">
								{["Auto", "Plan", "Code", "Debug", "Review", "Crawl"].map((mode) => (
									<button
										key={mode}
										onClick={() => setActiveMode(mode)}
										className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${activeMode === mode ? "bg-violet-600/30 text-violet-300" : "text-gray-500 hover:text-gray-300"}`}>
										{mode}
									</button>
								))}
							</div>
						</div>
						<div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
							{messages.length === 0 && (
								<div className="flex items-center justify-center h-full text-[11px] text-gray-600">
									Start a conversation or use the terminal to execute commands
								</div>
							)}
							{messages.map((m) => (
								<div key={m.id} className="text-[11px]">
									<div className="flex items-center gap-2 mb-0.5">
										<span
											className={`font-semibold ${m.role === "user" ? "text-blue-400" : m.role === "agent" ? "text-violet-400" : "text-gray-400"}`}>
											{m.author}
										</span>
										{m.meta && <span className="text-[9px] text-gray-600">{m.meta}</span>}
										<span className="text-[9px] text-gray-700 ml-auto">{m.time}</span>
									</div>
									<p className="text-gray-400 leading-relaxed whitespace-pre-wrap">{m.content}</p>
									{m.attachments && m.attachments.length > 0 && (
										<div className="flex flex-wrap gap-1 mt-1">
											{m.attachments.map((a) => (
												<span
													key={a.id}
													className="px-1.5 py-0.5 text-[9px] rounded bg-[#1e2535] text-gray-400">
													{a.filename}
												</span>
											))}
										</div>
									)}
								</div>
							))}
							<div ref={messagesEndRef} />
						</div>
						<div className="border-t border-[#1e2535] bg-[#0f1117] px-3 py-2 shrink-0">
							{attachments.length > 0 && (
								<div className="flex flex-wrap gap-1 mb-1">
									{attachments.map((a) => (
										<span
											key={a.id}
											className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-[#1e2535] text-gray-400">
											<Paperclip size={9} />
											{a.filename}
											<button
												onClick={() => removeAttachment(a.id)}
												className="text-gray-600 hover:text-gray-300">
												<X size={9} />
											</button>
										</span>
									))}
								</div>
							)}
							<div className="flex items-center gap-2">
								<textarea
									value={input}
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="Type a message... (Ctrl+Enter to send)"
									className="flex-1 bg-[#0a0e1a] border border-[#1e2535] rounded px-2 py-1 text-xs text-[#e2e8f0] placeholder-gray-600 resize-none outline-none focus:border-violet-500/50 transition-colors"
									rows={1}
								/>
								<div className="flex items-center gap-1">
									<button
										onClick={handleFileAttach}
										className="p-1 text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
										title="Attach file">
										<Paperclip size={13} />
									</button>
									<button
										onClick={handleImageAttach}
										className="p-1 text-gray-500 hover:text-gray-300 rounded hover:bg-[#1e2535] transition-colors"
										title="Attach image">
										<Image size={13} />
									</button>
									<button
										onClick={handleSend}
										disabled={sending || (!input.trim() && attachments.length === 0)}
										className="p-1 text-violet-400 hover:text-violet-300 rounded hover:bg-[#1e2535] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
										{sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
									</button>
								</div>
							</div>
						</div>
					</div>
				</main>

				{/* Right sidebar: Terminal Brain */}
				<aside className="w-72 shrink-0 border-l border-[#1e2535] bg-[#0a0e1a] flex flex-col overflow-y-auto">
					<div className="flex items-center border-b border-[#1e2535] bg-[#0f1117] overflow-x-auto shrink-0">
						{[
							{ id: "command", label: "🧠 AI", badge: 0 },
							{ id: "errors", label: "❌ Errors", badge: brainErrors.length },
							{ id: "fixplan", label: "🔧 Fix", badge: brainFixes.length },
							{ id: "memory", label: "💾 Mem", badge: 0 },
							{ id: "deploy", label: "🚀 Deploy", badge: 0 },
							{ id: "approvals", label: "🔐 Approve", badge: brainApprovals.length },
						].map((tab) => (
							<button
								key={tab.id}
								onClick={() => setBrainTab(tab.id)}
								className={`relative flex items-center gap-1 px-2 py-1.5 text-[10px] border-r border-[#1e2535] transition-colors whitespace-nowrap ${brainTab === tab.id ? "bg-[#1e2535] text-[#e2e8f0]" : "text-gray-500 hover:text-gray-300"}`}>
								<span>{tab.label}</span>
								{tab.badge > 0 && (
									<span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] font-bold rounded-full bg-red-500/20 text-red-400">
										{tab.badge}
									</span>
								)}
							</button>
						))}
					</div>

					{/* AI Command tab */}
					{brainTab === "command" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Brain size={14} className="text-violet-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									AI Command
								</span>
							</div>
							<div className="flex gap-1">
								<input
									type="text"
									value={brainInput}
									onChange={(e) => setBrainInput(e.target.value)}
									onKeyDown={handleBrainKeyDown}
									placeholder="Describe what to do..."
									className="flex-1 bg-[#0f1117] border border-[#1e2535] rounded px-2 py-1 text-[11px] text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-violet-500/50 transition-colors"
									disabled={brainLoading}
								/>
								<button
									onClick={handleBrainSend}
									disabled={brainLoading || !brainInput.trim()}
									className="px-2 py-1 bg-violet-600/30 text-violet-300 rounded text-[10px] hover:bg-violet-600/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
									{brainLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
								</button>
							</div>
							{brainPlan.length > 0 && (
								<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2">
									<span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
										Plan
									</span>
									<div className="space-y-1">
										{brainPlan.map((step, i) => (
											<div key={i} className="flex items-start gap-1.5 text-[10px]">
												<span className="text-violet-400 font-mono shrink-0 mt-0.5">
													{i + 1}.
												</span>
												<div>
													<code className="text-green-400 font-mono">{step.command}</code>
													{step.description && (
														<p className="text-gray-500 mt-0.5">{step.description}</p>
													)}
												</div>
											</div>
										))}
									</div>
								</div>
							)}
							{brainFeedback && (
								<div className="flex-1 bg-[#0f1117] border border-[#1e2535] rounded p-2 overflow-y-auto">
									<span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
										Output
									</span>
									<pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all text-gray-400">
										{brainFeedback.output}
									</pre>
								</div>
							)}
							{brainContext && (
								<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2">
									<span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
										Context
									</span>
									<div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
										{brainContext.framework && (
											<>
												<span className="text-gray-500">Framework</span>
												<span className="text-gray-300 text-right">
													{brainContext.framework}
												</span>
											</>
										)}
										{brainContext.packageManager && (
											<>
												<span className="text-gray-500">PM</span>
												<span className="text-gray-300 text-right">
													{brainContext.packageManager}
												</span>
											</>
										)}
										{brainContext.nodeVersion && (
											<>
												<span className="text-gray-500">Node</span>
												<span className="text-gray-300 text-right">
													{brainContext.nodeVersion}
												</span>
											</>
										)}
										{brainContext.port && (
											<>
												<span className="text-gray-500">Port</span>
												<span className="text-gray-300 text-right">{brainContext.port}</span>
											</>
										)}
										{brainContext.branch && (
											<>
												<span className="text-gray-500">Branch</span>
												<span className="text-gray-300 text-right">{brainContext.branch}</span>
											</>
										)}
										{brainContext.hasDocker !== undefined && (
											<>
												<span className="text-gray-500">Docker</span>
												<span
													className={`text-right ${brainContext.hasDocker ? "text-green-400" : "text-gray-600"}`}>
													{brainContext.hasDocker ? "✓" : "✗"}
												</span>
											</>
										)}
										{brainContext.hasTypeScript !== undefined && (
											<>
												<span className="text-gray-500">TS</span>
												<span
													className={`text-right ${brainContext.hasTypeScript ? "text-green-400" : "text-gray-600"}`}>
													{brainContext.hasTypeScript ? "✓" : "✗"}
												</span>
											</>
										)}
									</div>
								</div>
							)}
						</div>
					)}

					{/* Errors tab */}
					{brainTab === "errors" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Bug size={14} className="text-red-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Error Analysis
								</span>
							</div>
							{brainErrors.length === 0 ? (
								<div className="flex items-center justify-center flex-1 text-[11px] text-gray-600">
									No errors detected
								</div>
							) : (
								<div className="flex-1 overflow-y-auto space-y-2">
									{brainErrors.map((err, i) => (
										<div key={i} className="bg-[#0f1117] border border-red-900/30 rounded p-2">
											<div className="flex items-center gap-1.5 mb-1">
												<span className="px-1 py-0.5 text-[9px] font-bold rounded bg-red-500/20 text-red-400 uppercase">
													{err.type}
												</span>
												{err.confidence !== undefined && (
													<span className="text-[9px] text-gray-500">
														{Math.round(err.confidence * 100)}%
													</span>
												)}
											</div>
											<p className="text-[10px] text-gray-300 mb-1">{err.message}</p>
											{err.rootCause && (
												<p className="text-[9px] text-gray-500">Root: {err.rootCause}</p>
											)}
											{err.fix && (
												<p className="text-[9px] text-green-400 mt-1">Fix: {err.fix}</p>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Fix Plan tab */}
					{brainTab === "fixplan" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Wand2 size={14} className="text-green-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Fix Suggestions
								</span>
							</div>
							{brainFixes.length === 0 ? (
								<div className="flex items-center justify-center flex-1 text-[11px] text-gray-600">
									No fixes suggested
								</div>
							) : (
								<div className="flex-1 overflow-y-auto space-y-2">
									{brainFixes.map((fix, i) => (
										<div key={i} className="bg-[#0f1117] border border-green-900/30 rounded p-2">
											{fix.title && (
												<p className="text-[10px] font-semibold text-green-400 mb-1">
													{fix.title}
												</p>
											)}
											{fix.type && (
												<span className="px-1 py-0.5 text-[9px] rounded bg-green-500/20 text-green-400">
													{fix.type}
												</span>
											)}
											{fix.description && (
												<p className="text-[10px] text-gray-300 mt-1">{fix.description}</p>
											)}
											{fix.fix && (
												<pre className="mt-1 p-1 bg-[#0a0e1a] rounded text-[9px] font-mono text-green-400/80 overflow-x-auto">
													{fix.fix}
												</pre>
											)}
											{fix.message && (
												<p className="text-[10px] text-gray-400 mt-1">{fix.message}</p>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Memory tab */}
					{brainTab === "memory" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Database size={14} className="text-blue-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Terminal Memory
								</span>
							</div>
							{brainMemory?.stats ? (
								<div className="grid grid-cols-2 gap-2">
									<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2 text-center">
										<div className="text-lg font-bold text-violet-400">
											{brainMemory.stats.totalSessions}
										</div>
										<div className="text-[9px] text-gray-500">Sessions</div>
									</div>
									<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2 text-center">
										<div className="text-lg font-bold text-blue-400">
											{brainMemory.stats.totalCommands}
										</div>
										<div className="text-[9px] text-gray-500">Commands</div>
									</div>
									<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2 text-center">
										<div className="text-lg font-bold text-red-400">
											{brainMemory.stats.totalErrors}
										</div>
										<div className="text-[9px] text-gray-500">Errors</div>
									</div>
									<div className="bg-[#0f1117] border border-[#1e2535] rounded p-2 text-center">
										<div className="text-lg font-bold text-green-400">
											{brainMemory.stats.successRate}%
										</div>
										<div className="text-[9px] text-gray-500">Success</div>
									</div>
								</div>
							) : (
								<div className="flex items-center justify-center flex-1 text-[11px] text-gray-600">
									No memory data available
								</div>
							)}
							{brainMemory?.commands && brainMemory.commands.length > 0 && (
								<div className="flex-1 overflow-y-auto">
									<span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
										Recent Commands
									</span>
									<div className="space-y-1">
										{brainMemory.commands.slice(0, 10).map((c, i) => (
											<div key={i} className="flex items-center gap-1.5 text-[10px]">
												<span
													className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === "done" ? "bg-green-400" : c.status === "error" ? "bg-red-400" : "bg-gray-600"}`}
												/>
												<code className="text-gray-300 font-mono truncate">{c.command}</code>
												{c.timestamp && (
													<span className="text-[8px] text-gray-600 ml-auto">
														{c.timestamp}
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{/* Deploy tab */}
					{brainTab === "deploy" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Rocket size={14} className="text-orange-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Deployments
								</span>
							</div>
							{brainDeployments.length === 0 ? (
								<div className="flex items-center justify-center flex-1 text-[11px] text-gray-600">
									No deployments yet
								</div>
							) : (
								<div className="flex-1 overflow-y-auto space-y-1">
									{brainDeployments.map((d, i) => (
										<div key={i} className="bg-[#0f1117] border border-[#1e2535] rounded p-2">
											<div className="flex items-center gap-1.5 mb-1">
												<span
													className={`px-1 py-0.5 text-[9px] font-bold rounded ${d.status === "healthy" ? "bg-green-500/20 text-green-400" : d.status === "deploying" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"}`}>
													{d.status}
												</span>
												{d.version && (
													<span className="text-[10px] text-gray-300">{d.version}</span>
												)}
											</div>
											{d.agent && <p className="text-[9px] text-gray-500">Agent: {d.agent}</p>}
											{(d.timestamp || d.time) && (
												<p className="text-[9px] text-gray-600">{d.timestamp || d.time}</p>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Approvals tab */}
					{brainTab === "approvals" && (
						<div className="flex flex-col flex-1 p-2 space-y-2">
							<div className="flex items-center gap-1.5">
								<Shield size={14} className="text-yellow-400 shrink-0" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Pending Approvals
								</span>
							</div>
							{brainApprovals.length === 0 ? (
								<div className="flex items-center justify-center flex-1 text-[11px] text-gray-600">
									No pending approvals
								</div>
							) : (
								<div className="flex-1 overflow-y-auto space-y-2">
									{brainApprovals.map((a, i) => (
										<div key={i} className="bg-[#0f1117] border border-yellow-900/30 rounded p-2">
											<p className="text-[10px] text-gray-300 mb-1">
												{a.message || a.reason || "Approve this action?"}
											</p>
											<code className="text-[10px] text-green-400 font-mono block mb-2">
												{a.command || a.action}
											</code>
											<div className="flex gap-1">
												<button
													onClick={() => handleApproveAction(i)}
													className="flex-1 px-2 py-1 text-[9px] bg-green-600/30 text-green-400 rounded hover:bg-green-600/50 transition-colors">
													Approve
												</button>
												<button
													onClick={() => handleRejectAction(i)}
													className="flex-1 px-2 py-1 text-[9px] bg-red-600/30 text-red-400 rounded hover:bg-red-600/50 transition-colors">
													Reject
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</aside>
			</section>
		</div>
	)
}
