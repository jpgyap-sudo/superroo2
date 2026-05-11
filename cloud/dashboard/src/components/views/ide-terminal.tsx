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

// ─── API helper ──────────────────────────────────────────────────────────

const API_BASE = "/api/ide-workspace"

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

function FileTree({ items, depth = 0, onFileClick }: { items: WorkspaceFile[]; depth?: number; onFileClick?: (path: string, name: string) => void }) {
	return (
		<>
			{items.map((item) => (
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
					{item.children && <FileTree items={item.children} depth={depth + 1} onFileClick={onFileClick} />}
				</div>
			))}
		</>
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
	const [openFiles, setOpenFiles] = useState<{ path: string; name: string; content: string; language: string; modified?: boolean }[]>([])
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
	const fileInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLPreElement>(null)
	const terminalInputRef = useRef<HTMLInputElement>(null)

	// ── Agent command definitions (mirrors backend) ──────────────────────
	const agentCommands = {
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
		"/orchestrate": { agent: "orchestrator", description: "Break down and coordinate multi-step tasks", icon: "GitMerge" },
		"/auto-deploy": { agent: "auto-deployer", description: "Trigger or check auto-deployer status", icon: "Rocket" },
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
				.filter(cmd => cmd.startsWith(lower))
				.slice(0, 5)
		}
		if (lower.startsWith("@")) {
			const mention = lower.slice(1)
			return Object.values(agentCommands)
				.filter(cmd => cmd.agent !== "system" && cmd.agent.includes(mention))
				.map(cmd => `@${cmd.agent}`)
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
			// Read selected provider from localStorage (set by Model Router dropdown)
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
	const handleFileClick = useCallback(async (filePath: string, fileName: string) => {
		// Check if already open
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
	}, [openFiles])

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
				// Mark file as saved (remove modified indicator)
				setOpenFiles((prev) =>
					prev.map((f) => (f.path === activeFilePath ? { ...f, modified: false } : f)),
				)
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

		// Detect command type
		const isAgent = isAgentCommand(cmd)
		const isSkill = isSkillCommand(cmd)
		const isMention = isAgentMention(cmd)

		// Show command in terminal
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
				// If agent/skill response, wrap in visual separator
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
			// Tab for autocomplete
			if (e.key === "Tab") {
				e.preventDefault()
				const suggestions = getAgentSuggestions(terminalInput)
				if (suggestions.length === 1) {
					setTerminalInput(suggestions[0] + " ")
					setShowAgentSuggestions(false)
				}
			}
			// Escape to close suggestions
			if (e.key === "Escape") {
				setShowAgentSuggestions(false)
			}
		},
		[handleTerminalCommand, terminalInput],
	)

	// ── Terminal input change handler with autocomplete ───────────────────
	const handleTerminalInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value
		setTerminalInput(value)

		// Show suggestions for agent commands
		if (value.startsWith("/") || value.startsWith("@")) {
			const suggestions = getAgentSuggestions(value)
			setAgentSuggestions(suggestions)
			setShowAgentSuggestions(suggestions.length > 0)
		} else {
			setShowAgentSuggestions(false)
		}
	}, [])

	// ── Pipeline approval ─────────────────────────────────────────────────
	const handlePipelineAction = useCallback(async (stepId: string) => {
		try {
			await api("/pipeline", {
				method: "PATCH",
				body: JSON.stringify({ stepId, action: "approve" }),
			})
			setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "running" as const } : s)))
			setTimeout(() => {
				setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "done" as const } : s)))
			}, 2000)
		} catch (err) {
			console.error("Pipeline action failed:", err)
		}
	}, [])

	// ── GitHub import ─────────────────────────────────────────────────────
	const handleImport = useCallback(async () => {
		if (!importUrl.trim()) return
		try {
			const result = await api<{
				ok: boolean
				repoName?: string
				branch?: string
				files?: WorkspaceFile[]
				message?: string
			}>("/workspace/import-github", {
				method: "POST",
				body: JSON.stringify({ repoUrl: importUrl, branch: "main" }),
			})
			setShowImport(false)
			setImportUrl("")
			if (result.repoName) setRepoName(result.repoName)
			if (result.files?.length) setFiles(result.files)
			// Add a system message about the import
			const importMsg: ChatMessage = {
				id: `msg-${Date.now()}`,
				role: "agent",
				author: "System",
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: result.message || `Repository imported: ${importUrl}`,
			}
			setMessages((prev) => [...prev, importMsg])
		} catch (err) {
			console.error("Import failed:", err)
			const errorMsg: ChatMessage = {
				id: `msg-${Date.now()}`,
				role: "assistant",
				author: "System",
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
			}
			setMessages((prev) => [...prev, errorMsg])
		}
	}, [importUrl])

	// ── Mode switching ────────────────────────────────────────────────────
	const handleModeChange = useCallback((mode: string) => {
		setActiveMode(mode)
		const assistantMsg: ChatMessage = {
			id: `msg-${Date.now()}`,
			role: "agent",
			author: "System",
			meta: `mode: ${mode}`,
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			content: `Switched to ${mode} mode. How can I help you?`,
		}
		setMessages((prev) => [...prev, assistantMsg])
	}, [])

	// ── Context pill toggle ───────────────────────────────────────────────
	const toggleContextPill = useCallback((pill: string) => {
		setActiveContextPills((prev) => {
			const next = new Set(prev)
			if (next.has(pill)) next.delete(pill)
			else next.add(pill)
			return next
		})
	}, [])

	// ── Render ────────────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex items-center justify-center h-full bg-[#070b14] text-gray-500">
				<Loader2 size={24} className="animate-spin mr-2" />
				<span className="text-sm">Loading workspace...</span>
			</div>
		)
	}

	return (
		<div
			className="superroo-shell flex h-full bg-[#070b14] text-[#e2e8f0]"
			style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
			{/* Hidden file inputs */}
			<input ref={fileInputRef} type="file" multiple onChange={handleFilesSelected} className="hidden" />
			<input
				ref={imageInputRef}
				type="file"
				multiple
				accept="image/*"
				onChange={handleImagesSelected}
				className="hidden"
			/>

			{/* Activity Bar */}
			<aside className="flex flex-col items-center gap-2 py-3 px-1.5 bg-[#0a0e1a] border-r border-[#1e2535] shrink-0 w-12">
				<Bot size={20} className="text-violet-400" />
				<div className="w-4 h-px bg-[#1e2535]" />
				<Code2 size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Search size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<GitBranch size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Play size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Boxes size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<div className="flex-1" />
				<User size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Settings size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
			</aside>

			{/* Sidebar */}
			<aside className="w-56 shrink-0 border-r border-[#1e2535] bg-[#0a0e1a] overflow-y-auto flex flex-col">
				<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
					<span className="text-[10px] font-semibold text-gray-500 tracking-wider">WORKSPACE</span>
					<button
						onClick={() => setShowImport(!showImport)}
						className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300">
						<Plus size={12} /> Import
					</button>
				</div>

				{showImport && (
					<div className="px-3 py-2 border-b border-[#1e2535] space-y-1">
						<input
							value={importUrl}
							onChange={(e) => setImportUrl(e.target.value)}
							placeholder="GitHub repo URL..."
							className="w-full bg-[#0f1117] border border-[#1e2535] rounded px-2 py-1 text-[10px] text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-violet-600"
							onKeyDown={(e) => e.key === "Enter" && handleImport()}
						/>
						<button
							onClick={handleImport}
							className="w-full px-2 py-1 text-[10px] rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
							Import Repository
						</button>
					</div>
				)}

				<div className="px-3 py-1.5 text-xs text-gray-400 border-b border-[#1e2535]">{repoName}</div>
				<div className="flex-1 py-1">
					{files.length > 0 ? (
						<FileTree items={files} onFileClick={handleFileClick} />
					) : (
						<div className="px-3 py-2 text-[10px] text-gray-600 italic">
							No files loaded. Import a GitHub repo to get started.
						</div>
					)}
				</div>
				<div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 tracking-wider border-t border-[#1e2535]">
					OPEN EDITORS {openFiles.length > 0 && <span className="text-gray-600">({openFiles.length})</span>}
				</div>
				{openFiles.length > 0 ? (
					openFiles.map((f) => (
						<div
							key={f.path}
							onClick={() => setActiveFilePath(f.path)}
							className={`flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer transition-colors ${
								activeFilePath === f.path
									? "text-violet-300 bg-violet-600/10"
									: "text-gray-400 hover:bg-[#1e2535]"
							}`}>
							<FileText size={14} className="text-blue-400" />
							<span className="truncate">{f.name}</span>
							<button
								onClick={(e) => {
									e.stopPropagation()
									setOpenFiles((prev) => prev.filter((x) => x.path !== f.path))
									if (activeFilePath === f.path) {
										const remaining = openFiles.filter((x) => x.path !== f.path)
										setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
									}
								}}
								className="ml-auto text-gray-600 hover:text-red-400 shrink-0">
								<Trash2 size={10} />
							</button>
						</div>
					))
				) : (
					<div className="px-3 py-2 text-[10px] text-gray-600 italic">
						Click a file in the workspace tree to open it.
					</div>
				)}

				{/* Context Card */}
				<div className="mx-3 my-2 p-2 rounded-lg bg-[#0f1117] border border-[#1e2535] text-[10px] space-y-1">
					<div className="text-gray-500">
						Branch <span className="text-[#e2e8f0] font-semibold">{branch}</span>
					</div>
					<div className="text-gray-500">
						Last agent <span className="text-violet-400 font-semibold">Kimi</span>
					</div>
					<div className="text-gray-500">
						Last edited <span className="text-[#e2e8f0]">AIAssistantPanel.tsx</span>
					</div>
					<div className="text-gray-500">
						Last failure <span className="text-red-400">parallel-write test</span>
					</div>
					<div className="text-gray-500">
						Learned fix <span className="text-green-400">file-lock added</span>
					</div>
				</div>
			</aside>

			{/* Main workspace */}
			<main className="flex flex-col flex-1 min-w-0">
				{/* Top bar */}
				<header className="flex items-center justify-between px-4 py-2 border-b border-[#1e2535] bg-[#0a0e1a] shrink-0">
					<div>
						<h1 className="text-sm font-bold text-[#e2e8f0]">SuperRoo</h1>
						<p className="text-[10px] text-gray-500">
							{repoName} · {branch}
						</p>
					</div>
					<div className="flex items-center gap-3 text-[10px] text-gray-500">
						<span className="flex items-center gap-1">
							<span
								className={`w-1.5 h-1.5 rounded-full ${status.connected ? "bg-green-500" : "bg-red-500"}`}
							/>{" "}
							{status.connected ? "healthy" : "disconnected"}
						</span>
						<span className="text-gray-600">|</span>
						<span>
							loop <b className="text-[#e2e8f0]">{loopInfo.loop}</b>
						</span>
						<span className="text-gray-600">|</span>
						<span>
							phase <b className="text-yellow-400">{loopInfo.phase}</b>
						</span>
						<span className="text-gray-600">|</span>
						<span>
							agent <b className="text-violet-400">{loopInfo.agent}</b>
						</span>
						<span className="text-gray-600">|</span>
						<span className="px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400 font-semibold">
							{loopInfo.pending}
						</span>
						<span>pending</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[10px] text-gray-500">AUTONOMY</span>
						<button className="px-2 py-0.5 text-[10px] rounded bg-[#1e2535] text-gray-300 hover:bg-[#2a3347]">
							balanced
						</button>
						<button className="p-1 rounded bg-[#1e2535] text-gray-300 hover:bg-[#2a3347]">
							<Play size={12} />
						</button>
						<button className="px-2 py-0.5 text-[10px] rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
							Ask (⌘K)
						</button>
						<Bell size={14} className="text-gray-500 cursor-pointer" />
						<div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-[10px] font-bold text-white">
							K
						</div>
					</div>
				</header>

				{/* Work grid */}
				<section className="flex flex-1 min-h-0">
					{/* Center pane */}
					<section className="flex flex-col flex-1 min-w-0">
						{/* Pipeline bar */}
						<div className="flex items-center gap-2 px-3 py-1.5 bg-[#0f1117] border-b border-[#1e2535] overflow-x-auto shrink-0">
							<div className="flex items-center gap-2 text-[10px] text-gray-500 mr-2">
								Active pipeline{" "}
								<small className="text-gray-600">
									task {loopInfo.loop} · {pipeline.length}s
								</small>
							</div>
							{pipeline.map((s, i) => (
								<div key={s.id} className="flex items-center gap-1.5">
									<button
										onClick={() => s.status === "approval" && handlePipelineAction(s.id)}
										disabled={s.status !== "approval"}
										className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
											s.status === "done"
												? "bg-green-600/20 text-green-300"
												: s.status === "running"
													? "bg-blue-600/20 text-blue-300"
													: s.status === "approval"
														? "bg-yellow-600/20 text-yellow-300 cursor-pointer hover:bg-yellow-600/30"
														: "text-gray-500"
										}`}>
										<PipelineIcon status={s.status} />
										<strong>
											{s.status === "done" ? "✓ " : s.status === "approval" ? "Ⅱ " : ""}
											{s.label}
										</strong>
										<small className="text-gray-500 ml-1">
											{s.duration || "—"} · {s.agent || ""}
										</small>
									</button>
									{i < pipeline.length - 1 && <ChevronRight size={10} className="text-gray-600" />}
								</div>
							))}
						</div>

						{/* Editor card */}
						<div className="flex flex-col flex-1 m-2 rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden">
							<div className="flex items-center gap-0.5 px-2 py-1 bg-[#0f1117] border-b border-[#1e2535] overflow-x-auto shrink-0">
								{openFiles.length > 0 ? (
									openFiles.map((f) => (
										<span
											key={f.path}
											onClick={() => setActiveFilePath(f.path)}
											className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-t cursor-pointer transition-colors ${
												activeFilePath === f.path
													? "bg-[#0a0e1a] border-t border-x border-[#1e2535] text-[#e2e8f0]"
													: "text-gray-500 hover:text-gray-300"
											}`}>
											<Code2 size={12} /> {f.name}
											{f.modified && <span className="text-[9px] text-orange-400 font-bold">M</span>}
											<button
												onClick={(e) => {
													e.stopPropagation()
													setOpenFiles((prev) => prev.filter((x) => x.path !== f.path))
													if (activeFilePath === f.path) {
														const remaining = openFiles.filter((x) => x.path !== f.path)
														setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
													}
												}}
												className="ml-1 text-gray-600 hover:text-red-400">
												<Trash2 size={10} />
											</button>
										</span>
									))
								) : (
									<span className="px-2 py-0.5 text-[10px] text-gray-600 italic">
										Click a file in the workspace tree to open it
									</span>
								)}
								{/* Save button */}
								{activeFilePath && (
									<button
										onClick={handleSaveFile}
										className="ml-auto px-2 py-0.5 text-[10px] rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 shrink-0">
										Save
									</button>
								)}
							</div>
							<div className="flex-1 overflow-auto">
								{activeFilePath ? (
									<textarea
										value={openFiles.find((f) => f.path === activeFilePath)?.content || ""}
										onChange={(e) => handleEditorContentChange(activeFilePath, e.target.value)}
										className="w-full h-full p-4 font-mono text-xs leading-relaxed text-[#e2e8f0] bg-transparent border-none outline-none resize-none"
										spellCheck={false}
									/>
								) : (
									<div className="flex items-center justify-center h-full text-[10px] text-gray-600">
										Select a file from the workspace tree to view its contents
									</div>
								)}
							</div>
						</div>

						{/* Bottom split: Terminal + Debugger */}
						<div className="flex gap-2 m-2 mt-0 shrink-0" style={{ height: 180 }}>
							{/* Terminal */}
							<div className="flex-1 rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden flex flex-col">
								<div className="flex items-center gap-0.5 px-2 py-1 bg-[#0f1117] border-b border-[#1e2535] shrink-0">
									<span className="px-2 py-0.5 text-[10px] rounded-t bg-[#0a0e1a] border-t border-x border-[#1e2535] text-[#e2e8f0] flex items-center gap-1">
										<Terminal size={10} /> TERMINAL
									</span>
									{/* Agent mode indicator */}
									{agentRunning && (
										<span className="px-2 py-0.5 text-[10px] rounded bg-violet-600/20 text-violet-400 flex items-center gap-1 animate-pulse">
											<Loader2 size={10} className="animate-spin" />
											{activeAgent ? `${activeAgent} agent` : "agent"} running...
										</span>
									)}
									{terminalMode === "agent" && !agentRunning && (
										<span className="px-2 py-0.5 text-[10px] rounded bg-violet-600/10 text-violet-400 flex items-center gap-1">
											<Brain size={10} /> agent mode
										</span>
									)}
									{terminalMode === "skill" && !agentRunning && (
										<span className="px-2 py-0.5 text-[10px] rounded bg-yellow-600/10 text-yellow-400 flex items-center gap-1">
											<Sparkles size={10} /> skill mode
										</span>
									)}
									<span className="px-2 py-0.5 text-[10px] text-gray-500">
										PROBLEMS <b className="text-red-400">2</b>
									</span>
									<span className="px-2 py-0.5 text-[10px] text-gray-500">TESTS</span>
								</div>
								<pre
									ref={terminalRef}
									className="flex-1 p-2 font-mono text-[10px] leading-relaxed overflow-y-auto">
									{terminalOutput.map((line, i) => {
										// Color-code output based on content
										if (line.startsWith("╔") || line.startsWith("║") || line.startsWith("╚")) {
											return <span key={i} className="text-violet-400">{line}{"\n"}</span>
										}
										if (line.startsWith("$ ")) {
											return <span key={i} className="text-green-400">{line}{"\n"}</span>
										}
										if (line.startsWith("🤖 ") || line.startsWith("✨ ")) {
											return <span key={i} className="text-violet-300">{line}{"\n"}</span>
										}
										if (line.startsWith("[SuperRoo]")) {
											return <span key={i} className="text-blue-400">{line}{"\n"}</span>
										}
										if (line.startsWith("┌─") || line.startsWith("└─")) {
											return <span key={i} className="text-gray-500">{line}{"\n"}</span>
										}
										if (line.startsWith("Error:")) {
											return <span key={i} className="text-red-400">{line}{"\n"}</span>
										}
										if (line.startsWith("stderr:")) {
											return <span key={i} className="text-yellow-400">{line}{"\n"}</span>
										}
										return <span key={i} className="text-green-400">{line}{"\n"}</span>
									})}
								</pre>
								<div className="relative">
									{/* Autocomplete suggestions */}
									{showAgentSuggestions && agentSuggestions.length > 0 && (
										<div className="absolute bottom-full left-0 right-0 bg-[#0f1117] border border-[#1e2535] rounded-t-lg max-h-24 overflow-y-auto z-10">
											{agentSuggestions.map((suggestion) => (
												<button
													key={suggestion}
													onClick={() => {
														setTerminalInput(suggestion + " ")
														setShowAgentSuggestions(false)
														terminalInputRef.current?.focus()
													}}
													className="w-full text-left px-3 py-1 text-[10px] text-violet-400 hover:bg-violet-600/10 transition-colors">
													{suggestion}
												</button>
											))}
										</div>
									)}
									<div className="flex items-center gap-1 px-2 py-1 bg-[#0f1117] border-t border-[#1e2535]">
										{terminalInput.startsWith("/") ? (
											<Brain size={10} className="text-violet-400 shrink-0" />
										) : terminalInput.startsWith("@") ? (
											<Bot size={10} className="text-orange-400 shrink-0" />
										) : (
											<span className="text-[10px] text-green-400 shrink-0">$</span>
										)}
										<input
											ref={terminalInputRef}
											value={terminalInput}
											onChange={handleTerminalInputChange}
											onKeyDown={handleTerminalKeyDown}
											placeholder={
												terminalInput.startsWith("/") ? "Type an agent command..." :
												terminalInput.startsWith("@") ? "Mention an agent (@coder, @debugger, etc)..." :
												"Type a command... (/ for agent, @ for mention)"
											}
											className="flex-1 bg-transparent border-none outline-none text-[10px] text-[#e2e8f0] placeholder-gray-600"
											disabled={agentRunning}
										/>
										{/* Quick agent buttons */}
										{!terminalInput && !agentRunning && (
											<div className="flex items-center gap-0.5 shrink-0">
												<button
													onClick={() => setTerminalInput("/help ")}
													className="px-1.5 py-0.5 text-[9px] rounded bg-violet-600/10 text-violet-400 hover:bg-violet-600/20"
													title="Show help">
													<Bot size={10} />
												</button>
												<button
													onClick={() => setTerminalInput("/deploy ")}
													className="px-1.5 py-0.5 text-[9px] rounded bg-blue-600/10 text-blue-400 hover:bg-blue-600/20"
													title="Deploy">
													<Zap size={10} />
												</button>
												<button
													onClick={() => setTerminalInput("/status ")}
													className="px-1.5 py-0.5 text-[9px] rounded bg-green-600/10 text-green-400 hover:bg-green-600/20"
													title="Status">
													<Cpu size={10} />
												</button>
											</div>
										)}
									</div>
								</div>
							</div>

							{/* Debug card */}
							<div className="w-56 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2 flex flex-col shrink-0">
								<div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1">
									<Cpu size={12} /> AI Debugger <small className="text-gray-600">beta</small>
								</div>
								<h4 className="text-[10px] font-semibold text-[#e2e8f0] mb-0.5">Failure analysis</h4>
								<p className="text-[10px] text-gray-400 mb-0.5">
									<b className="text-red-400">parallel-write test</b> failed intermittently.
								</p>
								<p className="text-[10px] text-gray-400 mb-0.5">
									Likely cause: race condition on file lock.
								</p>
								<p className="text-[10px] text-gray-400 mb-1">Confidence: 87%</p>
								<div className="flex gap-1 mt-auto">
									<button className="px-2 py-0.5 text-[10px] rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
										Apply Fix
									</button>
									<button className="px-2 py-0.5 text-[10px] rounded text-gray-500 hover:text-gray-300">
										View details
									</button>
								</div>
							</div>
						</div>
					</section>

					{/* Assistant pane (right sidebar) */}
					<aside className="w-72 shrink-0 border-l border-[#1e2535] bg-[#0a0e1a] flex flex-col">
						{/* Assistant header */}
						<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
							<div>
								<h2 className="text-xs font-semibold text-[#e2e8f0]">AI Assistant</h2>
								<p className="text-[10px] text-gray-500">
									current: <b className="text-violet-400">{loopInfo.agent}</b> · phase{" "}
									<b className="text-yellow-400">{loopInfo.phase}</b>
								</p>
							</div>
							<div className="flex items-center gap-1.5">
								<span className="text-[10px] text-green-400 flex items-center gap-1">
									<span className="w-1.5 h-1.5 rounded-full bg-green-500" /> routed
								</span>
							</div>
						</div>

						{/* Mode buttons */}
						<div className="flex gap-0.5 px-2 py-1.5 border-b border-[#1e2535] overflow-x-auto">
							{["Auto", "Plan", "Code", "Debug", "Review", "Crawl"].map((mode) => (
								<button
									key={mode}
									onClick={() => handleModeChange(mode)}
									className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
										activeMode === mode
											? "bg-violet-600/20 text-violet-400"
											: "text-gray-500 hover:text-gray-300 hover:bg-[#1e2535]"
									}`}>
									{mode}
								</button>
							))}
						</div>

						{/* Conversation */}
						<div className="flex-1 overflow-y-auto p-2 space-y-2">
							{messages.length === 0 && (
								<div className="p-3 text-[10px] text-gray-600 italic text-center">
									No messages yet. Type a message below or attach files to get started.
								</div>
							)}
							{messages.map((m) => (
								<div key={m.id} className="p-2 rounded-lg bg-[#0f1117] border border-[#1e2535]">
									<div className="flex items-center gap-1.5 mb-1">
										<span
											className={`text-[10px] font-semibold ${
												m.role === "user"
													? "text-violet-300"
													: m.role === "agent"
														? "text-orange-300"
														: "text-blue-300"
											}`}>
											{m.author}
										</span>
										{m.meta && <span className="text-[9px] text-gray-500">· {m.meta}</span>}
										<span className="ml-auto text-[9px] text-gray-600">{m.time}</span>
									</div>
									<p className="text-[10px] text-gray-400 leading-relaxed whitespace-pre-wrap">
										{m.content}
									</p>
									{m.attachments && m.attachments.length > 0 && (
										<div className="mt-1 space-y-0.5">
											{m.attachments.map((a) => (
												<div
													key={a.id}
													className="flex items-center gap-1 text-[9px] text-gray-500">
													<FileText size={10} />
													<span>{a.filename}</span>
													<span className="ml-auto">
														{a.type} · {a.size}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							))}
							<div ref={messagesEndRef} />
							{sending && (
								<div className="flex items-center gap-1.5 p-2 text-[10px] text-gray-500">
									<Loader2 size={12} className="animate-spin" />
									<span>Kimi is thinking...</span>
								</div>
							)}
						</div>

						{/* Attachments preview */}
						{attachments.length > 0 && (
							<div className="px-2 py-1 border-t border-[#1e2535] space-y-0.5 max-h-20 overflow-y-auto">
								{attachments.map((a) => (
									<div key={a.id} className="flex items-center gap-1 text-[9px] text-gray-400">
										<FileText size={10} />
										<span className="truncate flex-1">{a.filename}</span>
										<span className="shrink-0">
											{a.type} · {a.size}
										</span>
										<button
											onClick={() => removeAttachment(a.id)}
											className="text-gray-600 hover:text-red-400 shrink-0">
											<Trash2 size={10} />
										</button>
									</div>
								))}
							</div>
						)}

						{/* Context pills */}
						<div className="flex items-center gap-1 px-2 py-1 border-t border-[#1e2535] overflow-x-auto">
							<span className="text-[9px] text-gray-600 mr-1">Context</span>
							{["3 files", "logs", "tests", "diff", "memory"].map((pill) => (
								<button
									key={pill}
									onClick={() => toggleContextPill(pill)}
									className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
										activeContextPills.has(pill)
											? "bg-violet-600/20 text-violet-400"
											: "bg-[#1e2535] text-gray-400 hover:bg-[#2a3347]"
									}`}>
									{pill}
								</button>
							))}
						</div>

						{/* Paste capture indicator */}
						{attachments.length > 0 && (
							<div className="flex items-center gap-1 px-2 py-1 bg-yellow-600/10 border-t border-yellow-600/20 text-[9px] text-yellow-400">
								<UploadCloud size={12} /> {attachments.length} file(s) attached
							</div>
						)}

						{/* Chat input */}
						<div className="border-t border-[#1e2535] bg-[#0f1117]">
							<textarea
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="Ask SuperRoo...&#10;Paste logs, images, files or @ to mention"
								className="w-full bg-transparent border-none outline-none resize-none text-[10px] text-[#e2e8f0] placeholder-gray-600 p-2"
								rows={3}
							/>
							<div className="flex items-center justify-between px-2 pb-2">
								<div className="flex items-center gap-1">
									<button
										onClick={handleFileAttach}
										className="p-1 text-gray-500 hover:text-gray-300 rounded">
										<Paperclip size={12} />
									</button>
									<button
										onClick={handleImageAttach}
										className="p-1 text-gray-500 hover:text-gray-300 rounded">
										<Image size={12} />
									</button>
									<Code2 size={12} className="text-gray-500" />
									<Terminal size={12} className="text-gray-500" />
									<Mic size={12} className="text-gray-500" />
								</div>
								<button
									onClick={handleSend}
									disabled={sending || (!input.trim() && attachments.length === 0)}
									className={`p-1 rounded transition-colors ${
										sending || (!input.trim() && attachments.length === 0)
											? "text-gray-600"
											: "bg-violet-600/20 text-violet-400 hover:bg-violet-600/30"
									}`}>
									<Send size={14} />
								</button>
							</div>
						</div>
					</aside>
				</section>

				{/* Bottom dock */}
				<footer className="flex items-center gap-4 px-3 py-1.5 bg-[#0f1117] border-t border-[#1e2535] text-[10px] text-gray-500 shrink-0 overflow-x-auto">
					<div className="flex items-center gap-1 shrink-0">
						<Bot size={12} /> PIPELINE{" "}
						<b className="text-[#e2e8f0]">
							task {loopInfo.loop} · {loopInfo.phase}
						</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Cpu size={12} /> AGENTS <b className="text-[#e2e8f0]">4 running</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Database size={12} /> MEMORY <b className="text-[#e2e8f0]">32 items</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Boxes size={12} /> OBSERVABILITY <b className="text-[#e2e8f0]">92.4% success</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<UploadCloud size={12} /> DEPLOYMENTS <b className="text-[#e2e8f0]">27 ↑</b>
					</div>
					<button className="shrink-0 text-gray-600 hover:text-gray-400">+ Add panel</button>
				</footer>

				{/* Status bar */}
				<div className="flex items-center gap-3 px-3 py-1 bg-[#0a0e1a] border-t border-[#1e2535] text-[10px] text-gray-500 shrink-0">
					<span className="text-green-400">{branch}*</span>
					<span className="text-gray-600">·</span>
					<span className="flex items-center gap-1">
						<span className={`w-1 h-1 rounded-full ${status.connected ? "bg-green-500" : "bg-red-500"}`} />{" "}
						{status.connected ? "Connected" : "Disconnected"}
					</span>
					<span className="text-gray-600">·</span>
					<span>Docker: {status.docker ? "running" : "stopped"}</span>
					<span className="text-gray-600">·</span>
					<span>Redis: {status.redis ? "ok" : "n/a"}</span>
					<span className="text-gray-600">·</span>
					<span>CPU {status.cpu}</span>
					<span className="text-gray-600">·</span>
					<span>RAM {status.ram}</span>
					<span className="ml-auto">Ln 134, Col 21</span>
					<span className="text-gray-600">·</span>
					<span>TypeScript JSX</span>
					<span className="text-gray-600">·</span>
					<span>Prettier</span>
				</div>
			</main>
		</div>
	)
}
