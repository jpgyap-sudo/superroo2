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
	// New icons for IDE chat improvements
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
	// Icons for 8 new functions
	FilePlus2,
	Terminal as TerminalIcon2,
	Slash,
	List,
	Diff,
	FileOutput,
	Eye,
	Columns,
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

// ── Block-Based Output Types ──────────────────────────────────────────────

interface OutputBlock {
	id: string
	type: "command" | "output" | "error" | "success" | "info" | "agent" | "divider"
	content: string
	command?: string
	timestamp: string
}

interface AutocompleteSuggestion {
	text: string
	description: string
	type: "command" | "agent" | "recent" | "ai"
}

interface TerminalRecording {
	id: string
	name: string
	blocks: OutputBlock[]
	commandCount: number
	duration: string
	createdAt: string
}

interface WorkspaceStatus {
	connected: boolean
	docker: boolean
	redis: boolean
	cpu: string
	ram: string
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

// ── API helpers ───────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const base = window.location.origin
	const res = await fetch(`${base}/api${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	})
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error")
		throw new Error(`${res.status} ${text.slice(0, 200)}`)
	}
	return res.json()
}

async function brainApi<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
	return api<T>("/ide-workspace/brain", {
		method: "POST",
		body: JSON.stringify({ action, ...payload }),
	})
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

// ── File Tree Component ───────────────────────────────────────────────────

function FileTree({
	items,
	onFileClick,
	searchQuery,
}: {
	items: WorkspaceFile[]
	onFileClick: (path: string, name: string) => void
	searchQuery?: string
}) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	const toggle = (path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}

	const filtered = searchQuery
		? items.filter((item) => {
				const q = searchQuery.toLowerCase()
				return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
			})
		: items

	return (
		<>
			{filtered.map((item) => (
				<div key={item.path}>
					<button
						onClick={() => (item.kind === "folder" ? toggle(item.path) : onFileClick(item.path, item.name))}
						className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-left hover:bg-[#1e2535]/50 transition-colors rounded-sm">
						{item.kind === "folder" && (
							<ChevronRight
								size={10}
								className={`text-gray-500 transition-transform ${expanded.has(item.path) ? "rotate-90" : ""}`}
							/>
						)}
						{item.kind === "folder" ? (
							<Folder size={12} className="text-blue-400 shrink-0" />
						) : (
							<FileText size={12} className="text-gray-500 shrink-0" />
						)}
						<span className="truncate text-gray-300">{item.name}</span>
						{item.modified && <span className="text-orange-400 text-[9px] font-bold ml-auto">●</span>}
					</button>
					{item.kind === "folder" && expanded.has(item.path) && item.children && (
						<div className="pl-3">
							<FileTree items={item.children} onFileClick={onFileClick} searchQuery={searchQuery} />
						</div>
					)}
				</div>
			))}
		</>
	)
}

// ── Keyboard Shortcuts Modal ──────────────────────────────────────────────

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
	const shortcuts = [
		{ key: "Ctrl+`", desc: "Toggle terminal" },
		{ key: "Ctrl+P", desc: "Search files" },
		{ key: "Ctrl+K", desc: "Clear terminal" },
		{ key: "Ctrl+Enter", desc: "Send AI message" },
		{ key: "Escape", desc: "Close modals / suggestions" },
		{ key: "Tab", desc: "Accept autocomplete suggestion" },
		{ key: "↑↓", desc: "Navigate command history" },
	]
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 w-full max-w-sm mx-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-2">
						<Keyboard size={14} className="text-violet-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Keyboard Shortcuts</span>
					</div>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-300">
						<X size={14} />
					</button>
				</div>
				<div className="space-y-1">
					{shortcuts.map((s) => (
						<div key={s.key} className="flex items-center justify-between py-1">
							<kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#1e2535] text-gray-300 border border-[#2a3344]">
								{s.key}
							</kbd>
							<span className="text-[11px] text-gray-500">{s.desc}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

// ── Parse output lines into blocks ────────────────────────────────────────

function parseOutputLine(line: string, index: number): OutputBlock {
	const trimmed = line.trim()
	const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

	if (trimmed.startsWith("$ ")) {
		return {
			id: `block-${index}`,
			type: "command",
			content: trimmed.slice(2),
			command: trimmed.slice(2),
			timestamp: ts,
		}
	}
	if (trimmed.startsWith("✕") || trimmed.toLowerCase().includes("error:")) {
		return { id: `block-${index}`, type: "error", content: trimmed, timestamp: ts }
	}
	if (trimmed.startsWith("✓") || trimmed.startsWith("✔")) {
		return { id: `block-${index}`, type: "success", content: trimmed, timestamp: ts }
	}
	if (trimmed.startsWith("◆")) {
		return { id: `block-${index}`, type: "agent", content: trimmed, timestamp: ts }
	}
	if (trimmed.startsWith("ℹ")) {
		return { id: `block-${index}`, type: "info", content: trimmed, timestamp: ts }
	}
	if (
		trimmed === "" ||
		trimmed.startsWith("─") ||
		trimmed.startsWith("╔") ||
		trimmed.startsWith("╚") ||
		trimmed.startsWith("║")
	) {
		return { id: `block-${index}`, type: "divider", content: trimmed, timestamp: ts }
	}
	return { id: `block-${index}`, type: "output", content: trimmed, timestamp: ts }
}

function convertToBlocks(lines: string[]): OutputBlock[] {
	return lines.map(parseOutputLine)
}

// ── Common Commands ────────────────────────────────────────────────────────

const COMMON_COMMANDS = [
	{ text: "npm run dev", description: "Start dev server", type: "command" },
	{ text: "npm run build", description: "Build project", type: "command" },
	{ text: "npm test", description: "Run tests", type: "command" },
	{ text: "git status", description: "Check git status", type: "command" },
	{ text: "git pull", description: "Pull latest code", type: "command" },
	{ text: "git push", description: "Push commits", type: "command" },
	{ text: "pm2 status", description: "Check PM2 processes", type: "command" },
	{ text: "pm2 logs", description: "View PM2 logs", type: "command" },
	{ text: "docker ps", description: "List Docker containers", type: "command" },
	{ text: "df -h", description: "Check disk usage", type: "command" },
	{ text: "free -m", description: "Check memory usage", type: "command" },
	{ text: "curl -I", description: "Check HTTP headers", type: "command" },
	{ text: "npx vitest run", description: "Run vitest tests", type: "command" },
	{ text: "npx tsc --noEmit", description: "TypeScript type check", type: "command" },
	{ text: "pnpm install", description: "Install dependencies", type: "command" },
]

// ── Helper: addOutputBlocks ───────────────────────────────────────────────

function addOutputBlocks(
	blocks: OutputBlock[],
	setBlocks: React.Dispatch<React.SetStateAction<OutputBlock[]>>,
	newBlocks: OutputBlock[],
) {
	setBlocks((prev) => [...prev, ...newBlocks])
}

// ── Smart Suggestions ─────────────────────────────────────────────────────

function getSmartSuggestions(
	input: string,
	recentCommands: string[],
	agentCommands: Record<string, { agent: string; description: string; icon: string }>,
): AutocompleteSuggestion[] {
	if (!input || input.length < 2) return []
	const lower = input.toLowerCase()
	const results: AutocompleteSuggestion[] = []

	// Agent commands
	if (lower.startsWith("/")) {
		for (const [cmd, info] of Object.entries(agentCommands)) {
			if (cmd.startsWith(lower)) {
				results.push({ text: cmd, description: info.description, type: "command" })
			}
		}
	}

	// Agent mentions
	if (lower.startsWith("@")) {
		const mention = lower.slice(1)
		for (const [, info] of Object.entries(agentCommands)) {
			if (info.agent !== "system" && info.agent.includes(mention)) {
				results.push({ text: `@${info.agent}`, description: info.description, type: "agent" })
			}
		}
	}

	// Recent commands
	if (!lower.startsWith("/") && !lower.startsWith("@")) {
		for (const cmd of recentCommands) {
			if (cmd.toLowerCase().includes(lower) && !results.some((r) => r.text === cmd)) {
				results.push({ text: cmd, description: "Recent command", type: "recent" })
			}
		}
	}

	return results.slice(0, 6)
}

function createRecording(blocks: OutputBlock[], name: string): TerminalRecording {
	return {
		id: `rec-${Date.now()}`,
		name,
		blocks: [...blocks],
		commandCount: blocks.filter((b) => b.type === "command").length,
		duration: "0:00",
		createdAt: new Date().toISOString(),
	}
}

// ── Rich Content Rendering ──────────────────────────────────────────────

function renderMessageContent(content: string): React.ReactNode[] {
	if (!content) return [<span key="empty" />]

	const nodes: React.ReactNode[] = []
	let key = 0

	// Match code blocks first (```language\n...\n```)
	const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
	let lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = codeBlockRegex.exec(content)) !== null) {
		// Text before this code block
		if (match.index > lastIndex) {
			const textBefore = content.slice(lastIndex, match.index)
			nodes.push(...renderInlineContent(textBefore, key++))
		}

		const language = match[1] || "text"
		const code = match[2].trim()
		const isShellLanguage = ["bash", "sh", "shell", "terminal", "cmd", "powershell", "docker", "zsh"].includes(language.toLowerCase())
		nodes.push(
			<div key={key++} className="my-2 rounded border border-[#1e2535] overflow-hidden">
				<div className="flex items-center justify-between bg-[#1a2030] px-3 py-1 border-b border-[#1e2535]">
					<span className="text-[10px] text-gray-500 font-mono">{language}</span>
					<div className="flex items-center gap-1">
						{/* Function 2: Run-in-Terminal button for shell commands */}
						{isShellLanguage && (
							<button
								onClick={() => handleRunInTerminalFromBlock(code)}
								className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-green-400 hover:text-green-300 hover:bg-[#253045] rounded transition-colors"
								title="Run in terminal">
								<Play size={9} />
								Run
							</button>
						)}
						<button
							onClick={() => navigator.clipboard.writeText(code).catch(() => {})}
							className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-gray-500 hover:text-gray-300 hover:bg-[#253045] rounded transition-colors"
							title="Copy code">
							<Copy size={9} />
							Copy
						</button>
						<button
							onClick={() => handleApplyCodeFromBlock(code, language)}
							className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-violet-400 hover:text-violet-300 hover:bg-[#253045] rounded transition-colors"
							title="Apply code to file">
							<Code size={9} />
							Apply
						</button>
					</div>
				</div>
				<pre className="p-3 text-[11px] font-mono text-gray-300 overflow-x-auto leading-relaxed bg-[#0a0d14]">
					<code>{code}</code>
				</pre>
			</div>,
		)

		lastIndex = match.index + match[0].length
	}

	// Remaining text after last code block
	if (lastIndex < content.length) {
		const textAfter = content.slice(lastIndex)
		nodes.push(...renderInlineContent(textAfter, key++))
	}

	return nodes
}

function renderInlineContent(text: string, baseKey: number): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	let key = baseKey * 1000

	// Match inline images: ![alt](url)
	const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
	let imgMatch: RegExpExecArray | null
	let lastIdx = 0

	while ((imgMatch = imgRegex.exec(text)) !== null) {
		if (imgMatch.index > lastIdx) {
			nodes.push(...renderTextWithLinks(text.slice(lastIdx, imgMatch.index), key++))
		}
		const alt = imgMatch[1]
		const src = imgMatch[2]
		nodes.push(
			<img
				key={key++}
				src={src}
				alt={alt}
				className="max-w-full h-auto rounded my-1 border border-[#1e2535]"
				loading="lazy"
				onError={(e) => {
					;(e.target as HTMLImageElement).style.display = "none"
				}}
			/>,
		)
		lastIdx = imgMatch.index + imgMatch[0].length
	}

	if (lastIdx < text.length) {
		nodes.push(...renderTextWithLinks(text.slice(lastIdx), key++))
	}

	return nodes
}

function renderTextWithLinks(text: string, key: number): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	let localKey = key * 10000

	// Match file paths and URLs: /path/to/file.ext or https://...
	const linkRegex = /(\/[a-zA-Z0-9_\-./]+[a-zA-Z0-9_]|[a-zA-Z]+:\/\/[^\s]+)/g
	let linkMatch: RegExpExecArray | null
	let lastIdx = 0

	while ((linkMatch = linkRegex.exec(text)) !== null) {
		if (linkMatch.index > lastIdx) {
			nodes.push(<span key={localKey++}>{text.slice(lastIdx, linkMatch.index)}</span>)
		}
		const url = linkMatch[1]
		const isFilePath = url.startsWith("/") || url.startsWith("./") || url.startsWith("../")
		if (isFilePath) {
			nodes.push(
				<button
					key={localKey++}
					onClick={() => handleFileLinkClick(url)}
					className="inline-flex items-center gap-0.5 text-violet-400 hover:text-violet-300 underline underline-offset-2 decoration-violet-500/30 text-[11px] font-mono"
					title={`Open ${url}`}>
					<FileCode size={9} />
					{url}
				</button>,
			)
		} else {
			nodes.push(
				<a
					key={localKey++}
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30 text-[11px]">
					<ExternalLink size={9} />
					{url}
				</a>,
			)
		}
		lastIdx = linkMatch.index + linkMatch[0].length
	}

	if (lastIdx < text.length) {
		nodes.push(<span key={localKey++}>{text.slice(lastIdx)}</span>)
	}

	return nodes
}

// Module-level refs so renderMessageContent can use callbacks from the component
let _handleApplyCodeFromBlock: ((code: string, language: string) => void) | null = null
let _handleFileLinkClick: ((path: string) => void) | null = null
let _handleRunInTerminal: ((code: string) => void) | null = null

function handleApplyCodeFromBlock(code: string, language: string) {
	if (_handleApplyCodeFromBlock) _handleApplyCodeFromBlock(code, language)
}

function handleFileLinkClick(path: string) {
	if (_handleFileLinkClick) _handleFileLinkClick(path)
}

function handleRunInTerminalFromBlock(code: string) {
	if (_handleRunInTerminal) _handleRunInTerminal(code)
}

// ── Main Component ────────────────────────────────────────────────────────

export default function IdeTerminalView() {
	const [terminalInput, setTerminalInput] = useState("")
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
	const [loading, setLoading] = useState(true)
	const [repoName, setRepoName] = useState("superroo2")
	const [branch, setBranch] = useState("auto-improvement")
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
	// ── UNIFIED AI Panel (replaces old Chat + Brain) ─────────────────────
	const [aiInput, setAiInput] = useState("")
	const [aiMessages, setAiMessages] = useState<ChatMessage[]>([])
	const [aiSending, setAiSending] = useState(false)
	const [aiAttachments, setAiAttachments] = useState<ChatAttachment[]>([])
	const [aiTab, setAiTab] = useState<string>("chat")

	// ── AI Input change handler with slash command detection ──────────────
	const handleAiInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value
		setAiInput(val)
		// Function 3: Show slash commands dropdown when typing /
		if (val.startsWith("/")) {
			const cmd = val.split(" ")[0].toLowerCase()
			setSlashCommandFilter(cmd)
			const hasMatch = slashCommandsList.some((sc) => sc.command.startsWith(cmd))
			setShowSlashCommands(hasMatch)
		} else {
			setShowSlashCommands(false)
		}
	}, [])
	const [brainPlan, setBrainPlan] = useState<BrainPlanStep[]>([])
	const [brainFeedback, setBrainFeedback] = useState<BrainFeedback | null>(null)
	const [brainErrors, setBrainErrors] = useState<BrainError[]>([])
	const [brainFixes, setBrainFixes] = useState<BrainFix[]>([])
	const [brainMemory, setBrainMemory] = useState<BrainMemory | null>(null)
	const [brainDeployments, setBrainDeployments] = useState<BrainDeployment[]>([])
	const [brainApprovals, setBrainApprovals] = useState<BrainApproval[]>([])
	const [brainContext, setBrainContext] = useState<ProjectContext | null>(null)
	const [brainLoading, setBrainLoading] = useState(false)
	// ── Panel visibility toggles ─────────────────────────────────────────
	const [showFilePanel, setShowFilePanel] = useState(true)
	const [showAiPanel, setShowAiPanel] = useState(true)
	const [terminalHeight, setTerminalHeight] = useState(180)
	const [isTerminalMaximized, setIsTerminalMaximized] = useState(false)
	// ── Drag & drop ──────────────────────────────────────────────────────
	const [dragOver, setDragOver] = useState(false)
	const dragCounter = useRef(0)
	// ── Copy feedback ────────────────────────────────────────────────────
	const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
	// ── WebSocket Chat state ─────────────────────────────────────────────
	const wsRef = useRef<WebSocket | null>(null)
	const [wsConnected, setWsConnected] = useState(false)
	const [wsReconnecting, setWsReconnecting] = useState(false)
	const [proactiveSuggestions, setProactiveSuggestions] = useState<string[]>([])
	const [currentFilePath, setCurrentFilePath] = useState<string>("")
	const [currentFileContent, setCurrentFileContent] = useState<string>("")
	const [currentFileLanguage, setCurrentFileLanguage] = useState<string>("text")
	const [currentFileSelection, setCurrentFileSelection] = useState<string>("")
	// ── Recent Workspaces (persisted in localStorage) ────────────────────
	const [recentWorkspaces, setRecentWorkspaces] = useState<{ name: string; path: string; lastOpened: string }[]>(
		() => {
			if (typeof window === "undefined") return []
			try {
				const stored = localStorage.getItem("superroo-recent-workspaces")
				return stored ? JSON.parse(stored) : []
			} catch {
				return []
			}
		},
	)
	// ── Workspace Tasks (persisted in localStorage) ──────────────────────
	const [workspaceTasks, setWorkspaceTasks] = useState<
		{ id: string; title: string; status: "pending" | "done" | "failed"; createdAt: string }[]
	>(() => {
		if (typeof window === "undefined") return []
		try {
			const stored = localStorage.getItem("superroo-workspace-tasks")
			return stored ? JSON.parse(stored) : []
		} catch {
			return []
		}
	})
	// ── Import GitHub modal ──────────────────────────────────────────────
	const [showImportGithub, setShowImportGithub] = useState(false)
	const [importGithubUrl, setImportGithubUrl] = useState("")
	const [importGithubBranch, setImportGithubBranch] = useState("main")
	const [importGithubLoading, setImportGithubLoading] = useState(false)
	const [importGithubError, setImportGithubError] = useState("")
	// ── Open/New Workspace modal ─────────────────────────────────────────
	const [showOpenWorkspace, setShowOpenWorkspace] = useState(false)
	const [openWorkspacePath, setOpenWorkspacePath] = useState("")
	const [openWorkspaceLoading, setOpenWorkspaceLoading] = useState(false)
	const [openWorkspaceError, setOpenWorkspaceError] = useState("")
	// ── Block-Based Output state ─────────────────────────────────────────
	const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>(() => convertToBlocks(terminalOutput))
	const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set())
	// ── Smart Autocomplete state ─────────────────────────────────────────
	const [smartSuggestions, setSmartSuggestions] = useState<AutocompleteSuggestion[]>([])
	const [showSmartSuggestions, setShowSmartSuggestions] = useState(false)
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
	const [recentCommands, setRecentCommands] = useState<string[]>([])
	// ── Terminal Recording state ─────────────────────────────────────────
	const [recordings, setRecordings] = useState<TerminalRecording[]>([])
	const [isRecording, setIsRecording] = useState(false)
	const [showRecordings, setShowRecordings] = useState(false)
	const [recordingBlocks, setRecordingBlocks] = useState<OutputBlock[]>([])

	// ── Slash Commands state ──────────────────────────────────────────────
	const [showSlashCommands, setShowSlashCommands] = useState(false)
	const [slashCommandFilter, setSlashCommandFilter] = useState("")
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
	// ── Diff View state ──────────────────────────────────────────────────
	const [showDiffView, setShowDiffView] = useState(false)
	const [diffData, setDiffData] = useState<{ path: string; changes: Array<{ line: number; old: string; new: string }>; totalChanges: number } | null>(null)
	// ── Quick Action state ────────────────────────────────────────────────
	const [showQuickActions, setShowQuickActions] = useState<string | null>(null) // message id
	// ── Inline Selection state ────────────────────────────────────────────
	const [showInlineAiButton, setShowInlineAiButton] = useState(false)
	const [inlineSelectionPos, setInlineSelectionPos] = useState<{ top: number; left: number } | null>(null)
	const inlineEditorRef = useRef<HTMLTextAreaElement>(null)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const aiMessagesEndRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLDivElement>(null)
	const terminalInputRef = useRef<HTMLInputElement>(null)
	const terminalResizeRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

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

	// ── Detect if input is an agent command ──────────────────────────────
	const isAgentCommand = (cmd: string) => cmd.startsWith("/") || cmd.startsWith("@")
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
				if (data.chatMessages?.length) {
					setAiMessages(data.chatMessages)
				}
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

	// ── Auto-scroll AI messages ──────────────────────────────────────────
	useEffect(() => {
		aiMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [aiMessages])

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
				setIsTerminalMaximized((prev) => !prev)
			}
			if (e.ctrlKey && e.key === "p") {
				e.preventDefault()
				setShowFileSearch(true)
				setTimeout(() => fileSearchRef.current?.focus(), 50)
			}
			if (e.key === "Escape") {
				setShowFileSearch(false)
				setShowShortcuts(false)
				setShowAgentSuggestions(false)
				setShowSmartSuggestions(false)
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown)
		return () => window.removeEventListener("keydown", handleGlobalKeyDown)
	}, [])

	// ── WebSocket Connection for Real-Time Chat ────────────────────────────
	useEffect(() => {
		let ws: WebSocket | null = null
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null

		function connect() {
			try {
				const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
				const wsUrl = `${protocol}//${window.location.host}/api/ws/chat?session=default`
				ws = new WebSocket(wsUrl)
				wsRef.current = ws

				ws.onopen = () => {
					setWsConnected(true)
					setWsReconnecting(false)
					// Send ping every 30s to keep alive
					const pingInterval = setInterval(() => {
						if (wsRef.current?.readyState === WebSocket.OPEN) {
							wsRef.current.send(JSON.stringify({ type: "ping" }))
						}
					}, 30000)
					if (ws) ws.addEventListener("close", () => clearInterval(pingInterval))
				}

				ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data)
						switch (data.type) {
							case "connected":
								console.log("[ws-chat] Connected:", data.sessionId)
								break
							case "pong":
								break
							case "assistant-start":
								// Create placeholder message for streaming
								const assistantId = data.id
								const placeholder: ChatMessage = {
									id: assistantId,
									role: "agent",
									author: "AI",
									meta: "streaming...",
									time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
									content: "",
								}
								setAiMessages((prev) => [...prev, placeholder])
								break
							case "token":
								setAiMessages((prev) => {
									const last = prev[prev.length - 1]
									if (last && last.meta === "streaming...") {
										return prev.map((m) =>
											m.id === last.id ? { ...m, content: m.content + data.text } : m,
										)
									}
									return prev
								})
								break
							case "done":
								setAiMessages((prev) =>
									prev.map((m) =>
										m.id === data.id
											? {
													...m,
													content: data.reply || m.content,
													author: data.provider || "AI",
													meta: `${data.model || ""} · ws`,
												}
											: m,
									),
								)
								setAiSending(false)
								break
							case "suggestions":
								if (Array.isArray(data.suggestions)) {
									setProactiveSuggestions(data.suggestions)
								}
								break
							case "error":
								setAiMessages((prev) =>
									prev.map((m) =>
										m.meta === "streaming..."
											? {
													...m,
													content: `Error: ${data.message}`,
													author: "System",
													meta: "error",
												}
											: m,
									),
								)
								setAiSending(false)
								break
							case "cancelled":
								setAiMessages((prev) =>
									prev.map((m) => (m.meta === "streaming..." ? { ...m, meta: "cancelled" } : m)),
								)
								setAiSending(false)
								break
							case "typing":
								// Could show typing indicator
								break
						}
					} catch (err) {
						console.error("[ws-chat] Parse error:", err)
					}
				}

				ws.onclose = () => {
					setWsConnected(false)
					// Auto-reconnect after 3s
					reconnectTimer = setTimeout(() => {
						setWsReconnecting(true)
						connect()
					}, 3000)
				}

				ws.onerror = () => {
					// onclose will fire after onerror
				}
			} catch (err) {
				console.error("[ws-chat] Connection error:", err)
				setWsConnected(false)
			}
		}

		connect()

		return () => {
			if (reconnectTimer) clearTimeout(reconnectTimer)
			if (ws) {
				ws.onclose = null // prevent reconnect on unmount
				ws.close()
			}
			wsRef.current = null
		}
	}, [])

	// ── Persist recent workspaces to localStorage ─────────────────────────
	useEffect(() => {
		try {
			localStorage.setItem("superroo-recent-workspaces", JSON.stringify(recentWorkspaces))
		} catch {}
	}, [recentWorkspaces])

	// ── Persist workspace tasks to localStorage ───────────────────────────
	useEffect(() => {
		try {
			localStorage.setItem("superroo-workspace-tasks", JSON.stringify(workspaceTasks))
		} catch {}
	}, [workspaceTasks])

	// ── Persist chat messages to localStorage ──────────────────────────────
	// Function 4: Chat History Persistence
	useEffect(() => {
		try {
			if (aiMessages.length > 0) {
				localStorage.setItem("superroo-ai-messages", JSON.stringify(aiMessages.slice(-50)))
			}
		} catch {}
	}, [aiMessages])

	// Restore chat messages from localStorage on mount
	useEffect(() => {
		try {
			const stored = localStorage.getItem("superroo-ai-messages")
			if (stored) {
				const parsed = JSON.parse(stored)
				if (Array.isArray(parsed) && parsed.length > 0) {
					setAiMessages(parsed)
				}
			}
		} catch {}
	}, [])

	// ── OpenClaw data fetching ────────────────────────────────────────────
	// Fetch orchestrator status for the Plan tab
	const fetchOrchestratorStatus = useCallback(async () => {
		try {
			const data = await api<{
				ok: boolean
				running?: boolean
				mode?: string
				uptime?: number
				taskCount?: number
				tasks?: Array<{
					id: string
					type: string
					status: string
					createdAt: number
					instruction: string
				}>
				modules?: string[]
				hermesClaw?: boolean
			}>("/ide-workspace/orchestrator/status")
			if (data.ok && data.tasks) {
				setBrainPlan(
					data.tasks.map((t) => ({
						command: t.instruction?.substring(0, 100) || t.type,
						description: `${t.status} · ${t.type} · ${new Date(t.createdAt).toLocaleTimeString()}`,
					})),
				)
				setBrainFeedback({
					status: data.running ? "running" : "stopped",
					output: `Orchestrator: ${data.running ? "🟢 running" : "🔴 stopped"} · Mode: ${data.mode || "auto"} · ${data.taskCount || 0} tasks · ${data.modules?.length || 0} modules loaded`,
				})
			}
		} catch {
			// Silently fail — orchestrator may not be initialized
		}
	}, [])

	// Fetch HermesClaw stats for the Memory tab
	const fetchHermesStats = useCallback(async () => {
		try {
			const data = await api<{
				ok: boolean
				stats?: {
					totalOperations?: number
					totalMemoryEntries?: number
					successRate?: number
					operationsByType?: Record<string, number>
				}
			}>("/ide-workspace/hermes/stats")
			if (data.ok && data.stats) {
				setBrainMemory({
					stats: {
						totalSessions: data.stats.totalOperations || 0,
						totalCommands: data.stats.totalMemoryEntries || 0,
						totalErrors: 0,
						successRate: data.stats.successRate || 0,
					},
					commands: [],
				})
			}
		} catch {
			// Silently fail
		}
	}, [])

	// Fetch deployments for the Deploy tab
	const fetchDeployments = useCallback(async () => {
		try {
			const data = await api<{
				ok: boolean
				deployments?: Array<{
					version: string
					status: string
					timestamp: string
				}>
			}>("/deployments")
			if (data.ok && data.deployments) {
				setBrainDeployments(
					data.deployments.map((d) => ({
						version: d.version,
						status: d.status,
						timestamp: d.timestamp,
						time: d.timestamp,
					})),
				)
			}
		} catch {
			// Silently fail
		}
	}, [])

	// ── Fetch data when tab changes ───────────────────────────────────────
	useEffect(() => {
		if (aiTab === "plan") {
			setBrainLoading(true)
			fetchOrchestratorStatus().finally(() => setBrainLoading(false))
		} else if (aiTab === "memory") {
			setBrainLoading(true)
			fetchHermesStats().finally(() => setBrainLoading(false))
		} else if (aiTab === "deploy") {
			setBrainLoading(true)
			fetchDeployments().finally(() => setBrainLoading(false))
		}
	}, [aiTab, fetchOrchestratorStatus, fetchHermesStats, fetchDeployments])

	// ── Drag & drop handlers ──────────────────────────────────────────────
	useEffect(() => {
		function handleDragEnter(e: DragEvent) {
			e.preventDefault()
			dragCounter.current++
			if (e.dataTransfer?.types.includes("Files")) {
				setDragOver(true)
			}
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
			if (e.dataTransfer?.files) {
				for (const file of Array.from(e.dataTransfer.files)) {
					setAiAttachments((prev) => [
						...prev,
						{
							id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
							filename: file.name,
							type: file.type || "unknown",
							size: `${(file.size / 1024).toFixed(1)}KB`,
						},
					])
				}
			}
		}
		window.addEventListener("dragenter", handleDragEnter)
		window.addEventListener("dragleave", handleDragLeave)
		window.addEventListener("drop", handleDrop)
		return () => {
			window.removeEventListener("dragenter", handleDragEnter)
			window.removeEventListener("dragleave", handleDragLeave)
			window.removeEventListener("drop", handleDrop)
		}
	}, [])

	// ── Paste handler ─────────────────────────────────────────────────────
	// Handles both:
	//   1. Image paste → AI attachments (for the AI chat textarea)
	//   2. Text paste → terminal input (for the terminal command input)
	useEffect(() => {
		function handlePaste(e: ClipboardEvent) {
			const items = e.clipboardData?.items
			const textData = e.clipboardData?.getData("text")
			if (!items) return

			// Determine which element is focused
			const activeEl = document.activeElement

			// ── Case 1: Terminal input is focused → paste text into terminal ──
			if (activeEl && activeEl === terminalInputRef.current && textData) {
				e.preventDefault()
				setTerminalInput((prev) => prev + textData)
				return
			}

			// ── Case 2: AI textarea is focused → handle image attachments ──
			for (const item of Array.from(items)) {
				if (item.type.startsWith("image/")) {
					const file = item.getAsFile()
					if (file) {
						setAiAttachments((prev) => [
							...prev,
							{
								id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
								filename: `pasted-${Date.now()}.${item.type.split("/")[1] || "png"}`,
								type: item.type,
								size: `${(file.size / 1024).toFixed(1)}KB`,
							},
						])
					}
				}
			}
		}
		window.addEventListener("paste", handlePaste)
		return () => window.removeEventListener("paste", handlePaste)
	}, [])

	// ── Slash command handlers ────────────────────────────────────────────
	const slashCommandHandlers: Record<string, string> = {
		"/fix": `Fix any errors, bugs, or issues in the current file. Analyze the code carefully and provide the complete fixed version.`,
		"/explain": `Explain the selected code or the current file in simple terms. Break down what each part does.`,
		"/help": `Provide helpful guidance about using the Cloud IDE. List available features and how to use them.`,
		"/tests": `Generate comprehensive tests for the current file. Include unit tests, edge cases, and test descriptions.`,
		"/optimize": `Optimize the current file for better performance, readability, and maintainability.`,
		"/refactor": `Refactor the current file to improve code structure while preserving functionality.`,
		"/docs": `Generate documentation for the current file including function descriptions, parameters, and usage examples.`,
		"/review": `Review the current file for potential issues, security concerns, and best practices.`,
	}

	// ── UNIFIED AI Chat Send (WebSocket) ──────────────────────────────────
	const handleAiSend = useCallback(async () => {
		let text = aiInput.trim()
		if (!text && aiAttachments.length === 0) return

		// Function 3: Slash commands — expand /fix, /explain, etc. into full prompts
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
			content: slashCommandUsed ? `${slashCommandUsed} ${aiInput.trim().slice(slashCommandUsed.length).trim()}` : (text || "Sent files"),
			attachments: aiAttachments.length > 0 ? [...aiAttachments] : undefined,
		}

		setAiMessages((prev) => [...prev, userMsg])
		setAiInput("")
		setAiAttachments([])
		setAiSending(true)
		setProactiveSuggestions([])
		setShowSlashCommands(false)

		// If WebSocket is connected, use it for real-time streaming
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			// Get current file context from open files
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

			// Get recent terminal output for context
			const terminalContext = terminalOutput.slice(-20)

			// Send via WebSocket — the assistant-start/token/done events
			// are handled by the WebSocket onmessage handler above
			wsRef.current.send(
				JSON.stringify({
					type: "chat",
					text,
					currentFile,
					terminalOutput: terminalContext,
					provider: typeof window !== "undefined" ? localStorage.getItem("superroo-chat-provider") : null,
				}),
			)

			// Add a workspace task to memory
			if (text.length > 10) {
				const taskTitle = text.length > 60 ? text.substring(0, 60) + "..." : text
				setWorkspaceTasks((prev) => [
					{
						id: `task-${Date.now()}`,
						title: taskTitle,
						status: "pending",
						createdAt: new Date().toISOString(),
					},
					...prev.slice(0, 49),
				])
			}

			return
		}

		// Fallback: if WebSocket not connected, use HTTP POST
		try {
			const storedProvider = typeof window !== "undefined" ? localStorage.getItem("superroo-chat-provider") : null
			const body: Record<string, unknown> = { message: text }
			if (storedProvider && storedProvider !== "auto") {
				body.provider = storedProvider
			}
			const result = await api<{
				ok: boolean
				reply?: string
				provider?: string
				model?: string
				intent?: string
				agent?: string
				orchestratorTaskId?: string | null
				hermesContextUsed?: boolean
			}>("/ide-workspace/chat", {
				method: "POST",
				body: JSON.stringify(body),
			})

			const replyText = result.reply || "Message received."
			const agentName = result.agent || "chat"
			const metaParts = [agentName]
			if (result.model) metaParts.push(result.model)
			if (result.orchestratorTaskId) metaParts.push(`task:${result.orchestratorTaskId.substring(0, 8)}`)
			if (result.hermesContextUsed) metaParts.push("🧠")

			setAiMessages((prev) => {
				const last = prev[prev.length - 1]
				if (last && last.meta === "streaming...") {
					return prev.map((m) =>
						m.id === last.id
							? { ...m, content: replyText, author: result.provider || "AI", meta: metaParts.join(" · ") }
							: m,
					)
				}
				return [
					...prev,
					{
						id: `msg-${Date.now() + 1}`,
						role: "agent" as const,
						author: result.provider || "AI",
						meta: metaParts.join(" · "),
						time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
						content: replyText,
					},
				]
			})

			if (result.orchestratorTaskId) {
				fetchOrchestratorStatus()
			}
		} catch (err) {
			setAiMessages((prev) => {
				const last = prev[prev.length - 1]
				if (last && last.meta === "streaming...") {
					return prev.map((m) =>
						m.id === last.id
							? {
									...m,
									content: `Error: ${err instanceof Error ? err.message : "Failed"}`,
									author: "System",
								}
							: m,
					)
				}
				return prev
			})
		}
		setAiSending(false)
	}, [
		aiInput,
		aiAttachments,
		activeFilePath,
		openFiles,
		currentFileSelection,
		terminalOutput,
		fetchOrchestratorStatus,
	])

	const handleAiKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Function 3: Slash commands auto-complete
			if (e.key === "Tab" && showSlashCommands) {
				e.preventDefault()
				const filtered = slashCommandsList.filter((sc) => sc.command.startsWith(slashCommandFilter || "/"))
				if (filtered.length > 0) {
					setAiInput(filtered[0].command + " ")
					setShowSlashCommands(false)
				}
				return
			}
			if (e.key === "Escape") {
				setShowSlashCommands(false)
				return
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				setShowSlashCommands(false)
				handleAiSend()
			}
		},
		[handleAiSend, showSlashCommands, slashCommandFilter],
	)

	// ── Terminal command handlers ─────────────────────────────────────────
	const handleTerminalCommand = useCallback(async () => {
		const cmd = terminalInput.trim()
		if (!cmd) return

		setTerminalOutput((prev) => [...prev, `$ ${cmd}`])
		setTerminalInput("")
		setRecentCommands((prev) => {
			const next = [cmd, ...prev.filter((c) => c !== cmd)]
			return next.slice(0, 20)
		})

		if (isAgentCommand(cmd)) {
			setAgentRunning(true)
			const agentName = cmd.startsWith("@") ? cmd.slice(1).split(" ")[0] : cmd.split(" ")[0].slice(1)
			setActiveAgent(agentName)
			setTerminalMode("agent")

			try {
				const result = await api<{ ok: boolean; output?: string[]; error?: string }>(
					"/ide-workspace/terminal",
					{
						method: "POST",
						body: JSON.stringify({ command: cmd }),
					},
				)
				if (result.output) {
					setTerminalOutput((prev) => [...prev, ...result.output!])
				}
				if (result.error) {
					setTerminalOutput((prev) => [...prev, `✕ ${result.error}`])
				}
			} catch (err) {
				setTerminalOutput((prev) => [
					...prev,
					`✕ Command failed: ${err instanceof Error ? err.message : "Unknown error"}`,
				])
			} finally {
				setAgentRunning(false)
				setActiveAgent(null)
				setTerminalMode("shell")
			}
		} else {
			// Shell command — execute via API
			try {
				const result = await api<{ ok: boolean; output?: string[]; error?: string }>(
					"/ide-workspace/terminal",
					{
						method: "POST",
						body: JSON.stringify({ command: cmd }),
					},
				)
				if (result.output) {
					setTerminalOutput((prev) => [...prev, ...result.output!])
				}
				if (result.error) {
					setTerminalOutput((prev) => [...prev, `✕ ${result.error}`])
				}
			} catch (err) {
				setTerminalOutput((prev) => [
					...prev,
					`✕ Command failed: ${err instanceof Error ? err.message : "Unknown error"}`,
				])
			}
		}
	}, [terminalInput])

	const handleTerminalKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault()
				handleTerminalCommand()
			}
			if (e.key === "Tab" && showSmartSuggestions && smartSuggestions.length > 0) {
				e.preventDefault()
				const idx = selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0
				const suggestion = smartSuggestions[idx]
				if (suggestion) {
					setTerminalInput(suggestion.text + " ")
					setShowSmartSuggestions(false)
					setSelectedSuggestionIndex(-1)
				}
			}
			if (e.key === "ArrowUp" && showSmartSuggestions) {
				e.preventDefault()
				setSelectedSuggestionIndex((prev) => Math.max(0, prev - 1))
			}
			if (e.key === "ArrowDown" && showSmartSuggestions) {
				e.preventDefault()
				setSelectedSuggestionIndex((prev) => Math.min(smartSuggestions.length - 1, prev + 1))
			}
		},
		[handleTerminalCommand, showSmartSuggestions, smartSuggestions, selectedSuggestionIndex],
	)

	const handleTerminalInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const val = e.target.value
			setTerminalInput(val)

			if (val.startsWith("/") || val.startsWith("@")) {
				const suggestions = getAgentSuggestions(val)
				setAgentSuggestions(suggestions)
				setShowAgentSuggestions(suggestions.length > 0)
				setShowSmartSuggestions(false)
			} else if (val.length >= 2) {
				const smart = getSmartSuggestions(val, recentCommands, agentCommands)
				setSmartSuggestions(smart)
				setShowSmartSuggestions(smart.length > 0)
				setShowAgentSuggestions(false)
				setSelectedSuggestionIndex(-1)
			} else {
				setShowAgentSuggestions(false)
				setShowSmartSuggestions(false)
				setSelectedSuggestionIndex(-1)
			}
		},
		[recentCommands],
	)

	const handleFileClick = useCallback(
		(path: string, name: string) => {
			if (!openFiles.find((f) => f.path === path)) {
				setOpenFiles((prev) => [
					...prev,
					{ path, name, content: `// ${name}\n\n// Loading...`, language: "text", modified: false },
				])
			}
			setActiveFilePath(path)
		},
		[openFiles],
	)

	const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files) return
		for (const file of Array.from(files)) {
			setAiAttachments((prev) => [
				...prev,
				{
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: file.type || "unknown",
					size: `${(file.size / 1024).toFixed(1)}KB`,
				},
			])
		}
		e.target.value = ""
	}, [])

	const handleImagesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files) return
		for (const file of Array.from(files)) {
			setAiAttachments((prev) => [
				...prev,
				{
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: file.type || "image/png",
					size: `${(file.size / 1024).toFixed(1)}KB`,
				},
			])
		}
		e.target.value = ""
	}, [])

	const removeAttachment = useCallback((id: string) => {
		setAiAttachments((prev) => prev.filter((a) => a.id !== id))
	}, [])

	// ── Function 2: Run-in-Terminal handler ────────────────────────────────
	const handleRunInTerminal = useCallback((code: string) => {
		// Set the terminal input to the command and focus it
		setTerminalInput(code)
		// Focus the terminal input after a short delay to let React render
		setTimeout(() => {
			terminalInputRef.current?.focus()
		}, 50)
	}, [])

	// ── Set up module-level refs for rich content rendering callbacks ──────
	useEffect(() => {
		_handleApplyCodeFromBlock = handleApplyCode
		_handleFileLinkClick = handleFileLinkClickFromContent
		_handleRunInTerminal = handleRunInTerminal
	})

	// ── Detect file path from code comments (Function 1: Smart Apply-to-File) ──
	function detectFilePathFromCode(code: string, language: string): string | null {
		// Look for patterns like: // path/to/file.ts, # path/to/file.py, <!-- path/to/file.html -->
		const patterns = [
			// TypeScript/JavaScript/CSS: // path/to/file.ts or /* path/to/file.ts */
			{ regex: /\/\/\s*([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|scss|json|md|html|vue|svelte))/ },
			{ regex: /\/\*\s*([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|scss|json|md|html|vue|svelte))\s*\*\// },
			// Python/Ruby/Shell: # path/to/file.py
			{ regex: /#\s*([a-zA-Z0-9_\-./]+\.(py|rb|sh|bash|yml|yaml|env|txt|md|cfg|ini))/, flags: "" },
			// HTML/XML: <!-- path/to/file.html -->
			{ regex: /<!--\s*([a-zA-Z0-9_\-./]+\.(html|htm|xml|svg))\s*-->/ },
			// Generic file: path/to/filename.ext at start of comment
			{ regex: /\/[a-zA-Z0-9_\-./]+\/[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+/, flags: "" },
		]
		for (const { regex } of patterns) {
			const m = regex.exec(code)
			if (m && m[1]) return m[1]
		}
		// Also check first line for a file path comment
		const firstLine = code.split("\n")[0].trim()
		const fileMatch = firstLine.match(/\/\/\s*(.+)/) || firstLine.match(/#\s*(.+)/)
		if (fileMatch) {
			const path = fileMatch[1].trim()
			if (path.includes(".") && !path.includes(" ")) return path
		}
		return null
	}

	// ── Apply code from a code block (Function 1: Smart Apply-to-File, Function 6: File creation) ──
	const handleApplyCode = useCallback(
		async (code: string, language: string) => {
			// Try to detect file path from code comments
			const detectedPath = detectFilePathFromCode(code, language)

			if (detectedPath) {
				// Function 6: File creation from chat — if file doesn't exist, create it
				try {
					// Try reading the file first
					const existing = await api<{ ok: boolean; content?: string }>(
						`/ide-workspace/file/read?path=${encodeURIComponent(detectedPath)}`,
					)
					if (existing.ok) {
						// File exists — save old content for diff, then apply
						const oldContent = existing.content || ""
						// Save diff data for Function 7
						try {
							const diffResult = await api<{ ok: boolean; changes: Array<{ line: number; old: string; new: string }>; totalChanges: number }>(
								"/ide-workspace/file/diff",
								{
									method: "POST",
									body: JSON.stringify({ oldContent, newContent: code }),
								},
							)
							if (diffResult.ok && diffResult.totalChanges > 0) {
								setDiffData({ path: detectedPath, changes: diffResult.changes, totalChanges: diffResult.totalChanges })
							}
						} catch {}
					}
				} catch {
					// File doesn't exist — create it
					try {
						await api("/ide-workspace/file/create", {
							method: "POST",
							body: JSON.stringify({ path: detectedPath, content: code }),
						})
					} catch {}
				}

				// Save the file
				await api("/ide-workspace/file/save", {
					method: "POST",
					body: JSON.stringify({ path: detectedPath, content: code }),
				}).catch(() => {})

				// Open the file in the editor
				const name = detectedPath.split("/").pop() || detectedPath
				setOpenFiles((prev) => {
					const existing = prev.find((f) => f.path === detectedPath)
					if (existing) {
						return prev.map((f) =>
							f.path === detectedPath ? { ...f, content: code, modified: true } : f,
						)
					}
					return [...prev, { path: detectedPath, name, content: code, language, modified: true }]
				})
				setActiveFilePath(detectedPath)
				return
			}

			// Fallback: apply to active file or create untitled
			if (activeFilePath) {
				// Save old content for diff
				const oldFile = openFiles.find((f) => f.path === activeFilePath)
				if (oldFile) {
					try {
						const diffResult = await api<{ ok: boolean; changes: Array<{ line: number; old: string; new: string }>; totalChanges: number }>(
							"/ide-workspace/file/diff",
							{
								method: "POST",
								body: JSON.stringify({ oldContent: oldFile.content, newContent: code }),
							},
						)
						if (diffResult.ok && diffResult.totalChanges > 0) {
							setDiffData({ path: activeFilePath, changes: diffResult.changes, totalChanges: diffResult.totalChanges })
						}
					} catch {}
				}
				setOpenFiles((prev) =>
					prev.map((f) => (f.path === activeFilePath ? { ...f, content: code, modified: true } : f)),
				)
				api("/ide-workspace/file/save", {
					method: "POST",
					body: JSON.stringify({ path: activeFilePath, content: code }),
				}).catch(() => {})
			} else {
				const ext =
					language === "typescript"
						? "ts"
						: language === "javascript"
							? "js"
							: language === "python"
								? "py"
								: "txt"
				const filename = `untitled.${ext}`
				const path = `/tmp/${filename}`
				setOpenFiles((prev) => [...prev, { path, name: filename, content: code, language, modified: true }])
				setActiveFilePath(path)
			}
		},
		[activeFilePath, openFiles],
	)

	// ── Handle file link click from rich content ──────────────────────────
	const handleFileLinkClickFromContent = useCallback(
		(path: string) => {
			const name = path.split("/").pop() || path
			if (!openFiles.find((f) => f.path === path)) {
				setOpenFiles((prev) => [
					...prev,
					{ path, name, content: `// ${name}\n\n// Loading...`, language: "text", modified: false },
				])
			}
			setActiveFilePath(path)
		},
		[openFiles],
	)

	// ── Import GitHub repo ────────────────────────────────────────────────
	const handleImportGithub = useCallback(async () => {
		if (!importGithubUrl.trim()) {
			setImportGithubError("Please enter a GitHub repository URL")
			return
		}
		setImportGithubLoading(true)
		setImportGithubError("")
		try {
			const result = await api<{
				ok: boolean
				repoName?: string
				branch?: string
				files?: WorkspaceFile[]
				error?: string
			}>("/ide-workspace/workspace/import-github", {
				method: "POST",
				body: JSON.stringify({
					repoUrl: importGithubUrl.trim(),
					branch: importGithubBranch.trim() || "main",
				}),
			})
			if (result.ok) {
				if (result.repoName) setRepoName(result.repoName)
				if (result.branch) setBranch(result.branch)
				if (result.files) setFiles(result.files)
				setShowImportGithub(false)
				setImportGithubUrl("")
				setImportGithubBranch("main")
				setRecentWorkspaces((prev) => {
					const filtered = prev.filter((w) => w.path !== result.repoName)
					return [
						{
							name: result.repoName || "imported-repo",
							path: result.repoName || "imported-repo",
							lastOpened: new Date().toISOString(),
						},
						...filtered.slice(0, 9),
					]
				})
			} else {
				setImportGithubError(result.error || "Import failed")
			}
		} catch (err) {
			setImportGithubError(err instanceof Error ? err.message : "Import failed")
		} finally {
			setImportGithubLoading(false)
		}
	}, [importGithubUrl, importGithubBranch])

	// ── Open/switch workspace ─────────────────────────────────────────────
	const handleOpenWorkspace = useCallback(
		async (path?: string) => {
			const targetPath = path || openWorkspacePath.trim()
			if (!targetPath) {
				setOpenWorkspaceError("Please enter a workspace path")
				return
			}
			setOpenWorkspaceLoading(true)
			setOpenWorkspaceError("")
			try {
				const result = await api<{
					ok: boolean
					repoName?: string
					branch?: string
					files?: WorkspaceFile[]
					error?: string
				}>("/ide-workspace/workspace/open", {
					method: "POST",
					body: JSON.stringify({ path: targetPath }),
				})
				if (result.ok) {
					if (result.repoName) setRepoName(result.repoName)
					if (result.branch) setBranch(result.branch)
					if (result.files) setFiles(result.files)
					setShowOpenWorkspace(false)
					setOpenWorkspacePath("")
					const name = result.repoName || targetPath.split("/").pop() || targetPath
					setRecentWorkspaces((prev) => {
						const filtered = prev.filter((w) => w.path !== targetPath)
						return [
							{ name, path: targetPath, lastOpened: new Date().toISOString() },
							...filtered.slice(0, 9),
						]
					})
				} else {
					setOpenWorkspaceError(result.error || "Failed to open workspace")
				}
			} catch (err) {
				setOpenWorkspaceError(err instanceof Error ? err.message : "Failed to open workspace")
			} finally {
				setOpenWorkspaceLoading(false)
			}
		},
		[openWorkspacePath],
	)

	const handleTerminalResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			const startY = e.clientY
			const startHeight = terminalHeight
			function onMouseMove(ev: MouseEvent) {
				setTerminalHeight(Math.max(80, Math.min(600, startHeight + (ev.clientY - startY))))
			}
			function onMouseUp() {
				window.removeEventListener("mousemove", onMouseMove)
				window.removeEventListener("mouseup", onMouseUp)
			}
			window.addEventListener("mousemove", onMouseMove)
			window.addEventListener("mouseup", onMouseUp)
		},
		[terminalHeight],
	)

	const handleCopyTerminal = useCallback((index: number, content: string) => {
		navigator.clipboard.writeText(content).catch(() => {})
		setCopiedIndex(index)
		setTimeout(() => setCopiedIndex(null), 1500)
	}, [])

	const toggleBlockCollapse = useCallback((id: string) => {
		setCollapsedBlocks((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

	const handleStartRecording = useCallback(() => {
		setIsRecording(true)
		setRecordingBlocks([])
	}, [])
	const handleStopRecording = useCallback(() => {
		setIsRecording(false)
		if (recordingBlocks.length > 0) {
			setRecordings((prev) => [...prev, createRecording(recordingBlocks, `Recording ${prev.length + 1}`)])
		}
	}, [recordingBlocks])
	const handleReplayRecording = useCallback((recording: TerminalRecording) => {
		setOutputBlocks(recording.blocks)
	}, [])

	useEffect(() => {
		setOutputBlocks(convertToBlocks(terminalOutput))
	}, [terminalOutput])
	useEffect(() => {
		if (isRecording) setRecordingBlocks((prev) => [...prev, ...outputBlocks.slice(prev.length)])
	}, [outputBlocks, isRecording])

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center bg-[#0a0d14]">
				<div className="flex flex-col items-center gap-3">
					<Loader2 size={24} className="text-violet-400 animate-spin" />
					<span className="text-xs text-gray-500">Loading workspace...</span>
				</div>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col bg-[#0a0d14] text-[13px]">
			<header className="flex items-center justify-between border-b border-[#1e2535] bg-[#0f1117] px-3 py-1.5">
				<div className="flex items-center gap-3">
					<span className="text-xs font-semibold text-[#e2e8f0]">{repoName}</span>
					<span className="flex items-center gap-1 text-[10px] text-gray-500">
						<GitBranch size={10} />
						{branch}
					</span>
					<span className="flex items-center gap-1 text-[10px] text-gray-500">
						<Cpu size={10} />
						{status.cpu}
					</span>
					<span className="flex items-center gap-1 text-[10px] text-gray-500">
						<Database size={10} />
						{status.ram}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{/* Import GitHub */}
					<button
						onClick={() => setShowImportGithub(true)}
						className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
						title="Import GitHub repository">
						<Github size={11} />
						<span className="hidden sm:inline">Import</span>
					</button>
					{/* Open Workspace */}
					<button
						onClick={() => setShowOpenWorkspace(true)}
						className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
						title="Open or switch workspace">
						<FolderOpen size={11} />
						<span className="hidden sm:inline">Workspace</span>
					</button>
					{/* Recent Workspaces dropdown */}
					{recentWorkspaces.length > 0 && (
						<div className="relative group">
							<button
								className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
								title="Recent workspaces">
								<Clock3 size={11} />
								<span className="hidden sm:inline">Recent</span>
							</button>
							<div className="absolute right-0 top-full mt-1 w-56 bg-[#1a2030] border border-[#2a3344] rounded shadow-xl overflow-hidden hidden group-hover:block z-50">
								<div className="p-1.5 border-b border-[#1e2535]">
									<span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
										Recent Workspaces
									</span>
								</div>
								{recentWorkspaces.map((w) => (
									<button
										key={w.path}
										onClick={() => handleOpenWorkspace(w.path)}
										className="block w-full text-left px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-[#253045] transition-colors">
										<div className="flex items-center gap-1.5">
											<FolderGit2 size={10} className="text-blue-400 shrink-0" />
											<span className="truncate">{w.name}</span>
										</div>
										<div className="text-[9px] text-gray-600 mt-0.5 pl-5">
											{new Date(w.lastOpened).toLocaleDateString()}
										</div>
									</button>
								))}
							</div>
						</div>
					)}
					{/* Workspace Tasks dropdown */}
					{workspaceTasks.length > 0 && (
						<div className="relative group">
							<button
								className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
								title="Workspace tasks">
								<ListTodo size={11} />
								<span className="hidden sm:inline">
									Tasks ({workspaceTasks.filter((t) => t.status === "pending").length})
								</span>
							</button>
							<div className="absolute right-0 top-full mt-1 w-64 bg-[#1a2030] border border-[#2a3344] rounded shadow-xl overflow-hidden hidden group-hover:block z-50 max-h-60 overflow-y-auto">
								<div className="p-1.5 border-b border-[#1e2535] sticky top-0 bg-[#1a2030]">
									<span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
										Workspace Tasks
									</span>
								</div>
								{workspaceTasks.slice(0, 15).map((t) => (
									<div
										key={t.id}
										className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] border-b border-[#1e2535]/50 last:border-0">
										{t.status === "done" ? (
											<CheckSquare size={10} className="text-green-400 shrink-0" />
										) : t.status === "failed" ? (
											<XCircle size={10} className="text-red-400 shrink-0" />
										) : (
											<Square size={10} className="text-yellow-400 shrink-0" />
										)}
										<span className="truncate text-gray-300">{t.title}</span>
									</div>
								))}
							</div>
						</div>
					)}
					<div className="w-px h-4 bg-[#1e2535] mx-1" />
					<select
						value={activeMode}
						onChange={(e) => setActiveMode(e.target.value)}
						className="bg-[#1e2535] text-[10px] text-gray-300 border border-[#2a3344] rounded px-1.5 py-0.5 outline-none">
						<option>Auto</option>
						<option>Plan</option>
						<option>Act</option>
						<option>Review</option>
					</select>
					{/* WebSocket connection indicator */}
					<span
						className={`inline-block w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-500" : wsReconnecting ? "bg-yellow-500" : "bg-red-500"}`}
						title={
							wsConnected
								? "WebSocket Connected"
								: wsReconnecting
									? "Reconnecting..."
									: "WebSocket Disconnected"
						}
					/>
					<button
						onClick={() => setShowShortcuts(true)}
						className="text-gray-500 hover:text-gray-300 transition-colors"
						title="Keyboard shortcuts">
						<Keyboard size={12} />
					</button>
				</div>
			</header>

			<div className="flex flex-1 overflow-hidden">
				{showFilePanel && (
					<aside className="w-52 border-r border-[#1e2535] bg-[#0f1117] flex flex-col shrink-0">
						<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e2535]">
							<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
								Explorer
							</span>
							<div className="flex items-center gap-1">
								<button
									onClick={() => setShowFileSearch(true)}
									className="text-gray-500 hover:text-gray-300 transition-colors"
									title="Search files (Ctrl+P)">
									<FileSearch size={11} />
								</button>
								<button
									onClick={() => setShowFilePanel(false)}
									className="text-gray-500 hover:text-gray-300 transition-colors"
									title="Close panel">
									<PanelLeftClose size={11} />
								</button>
							</div>
						</div>
						{showFileSearch && (
							<div className="px-2 py-1.5 border-b border-[#1e2535]">
								<input
									ref={fileSearchRef}
									type="text"
									value={fileSearchQuery}
									onChange={(e) => setFileSearchQuery(e.target.value)}
									placeholder="Search files..."
									className="w-full bg-[#1e2535] text-[11px] text-gray-300 placeholder-gray-600 border border-[#2a3344] rounded px-2 py-1 outline-none"
								/>
							</div>
						)}
						<div className="flex-1 overflow-y-auto py-1">
							<FileTree items={files} onFileClick={handleFileClick} searchQuery={fileSearchQuery} />
						</div>
					</aside>
				)}

				<div className="flex flex-1 flex-col min-w-0">
					<div className="flex-1 overflow-hidden flex flex-col min-h-0">
						{openFiles.length > 0 && (
							<div className="flex items-center border-b border-[#1e2535] bg-[#0f1117] overflow-x-auto">
								{openFiles.map((f) => (
									<button
										key={f.path}
										onClick={() => setActiveFilePath(f.path)}
										className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-[#1e2535] transition-colors whitespace-nowrap ${activeFilePath === f.path ? "bg-[#1a2030] text-[#e2e8f0] border-t-2 border-t-violet-500" : "text-gray-500 hover:text-gray-300"}`}>
										<FileText size={11} />
										{f.name}
										{f.modified && <span className="text-orange-400 text-[9px]">●</span>}
									</button>
								))}
							</div>
						)}
						<div className="flex-1 overflow-y-auto bg-[#0a0d14] p-4">
							{activeFilePath ? (
								<pre
									className="text-[12px] font-mono text-gray-300 leading-relaxed whitespace-pre-wrap"
									onMouseUp={(e) => {
										// Function 5: Detect text selection for inline AI button
										const selection = window.getSelection()
										const selectedText = selection?.toString().trim()
										if (selectedText && selectedText.length > 5) {
											setCurrentFileSelection(selectedText.slice(0, 3000))
											const rect = e.currentTarget.getBoundingClientRect()
											setInlineSelectionPos({
												top: Math.min(e.clientY, rect.bottom - 40),
												left: Math.max(e.clientX - 40, rect.left + 10),
											})
											setShowInlineAiButton(true)
										} else {
											setShowInlineAiButton(false)
											setCurrentFileSelection("")
										}
									}}>
									{openFiles.find((f) => f.path === activeFilePath)?.content || "// No content"}
								</pre>
							) : (
								<div className="flex h-full items-center justify-center">
									<div className="text-center text-gray-600">
										<Code2 size={32} className="mx-auto mb-2 opacity-30" />
										<p className="text-xs">Select a file from the explorer to view its contents</p>
									</div>
								</div>
							)}
						</div>
					</div>

					{pipeline.length > 0 && (
						<div className="flex items-center gap-2 border-t border-b border-[#1e2535] bg-[#0f1117] px-3 py-1 overflow-x-auto">
							<span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider shrink-0">
								Pipeline
							</span>
							{pipeline.map((step) => (
								<div
									key={step.id}
									className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
									<PipelineIcon status={step.status} />
									<span>{step.label}</span>
									{step.duration && <span className="text-gray-600">({step.duration})</span>}
									{step.status === "running" && (
										<Loader2 size={8} className="text-blue-400 animate-spin" />
									)}
								</div>
							))}
						</div>
					)}

					<div
						className="border-t border-[#1e2535] bg-[#0a0d14] flex flex-col"
						style={{ height: isTerminalMaximized ? "100%" : terminalHeight }}>
						<div className="flex items-center justify-between px-3 py-1 bg-[#0f1117] border-b border-[#1e2535] shrink-0">
							<div className="flex items-center gap-2">
								<Terminal size={11} className="text-green-400" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									Terminal
								</span>
								{agentRunning && (
									<span className="flex items-center gap-1 text-[10px] text-violet-400">
										<Loader2 size={8} className="animate-spin" />
										Running {activeAgent}...
									</span>
								)}
								{isRecording && (
									<span className="flex items-center gap-1 text-[10px] text-red-400">
										<span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
										Recording
									</span>
								)}
							</div>
							<div className="flex items-center gap-1">
								<button
									onClick={isRecording ? handleStopRecording : handleStartRecording}
									className={`p-0.5 rounded transition-colors ${isRecording ? "text-red-400 hover:text-red-300" : "text-gray-500 hover:text-gray-300"}`}
									title={isRecording ? "Stop recording" : "Start recording"}>
									<Mic size={11} />
								</button>
								{recordings.length > 0 && (
									<button
										onClick={() => setShowRecordings(!showRecordings)}
										className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
										title="View recordings">
										<History size={11} />
									</button>
								)}
								<button
									onClick={() => setIsTerminalMaximized(!isTerminalMaximized)}
									className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
									title={isTerminalMaximized ? "Minimize" : "Maximize"}>
									{isTerminalMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
								</button>
							</div>
						</div>

						<div
							ref={terminalRef}
							className="flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed">
							{outputBlocks.map((block, idx) => (
								<div
									key={block.id}
									className={`group flex items-start gap-1.5 py-0.5 ${block.type === "command" ? "text-green-400" : block.type === "error" ? "text-red-400" : block.type === "success" ? "text-green-500" : block.type === "agent" ? "text-violet-400" : block.type === "info" ? "text-blue-400" : block.type === "divider" ? "text-gray-700" : "text-gray-300"}`}>
									<button
										onClick={() => toggleBlockCollapse(block.id)}
										className="text-gray-600 hover:text-gray-400 shrink-0 mt-0.5">
										<ChevronRight
											size={10}
											className={collapsedBlocks.has(block.id) ? "" : "rotate-90"}
										/>
									</button>
									<span className="flex-1 min-w-0">
										{block.type === "command" && <span className="text-gray-500 mr-1">$</span>}
										{block.content}
									</span>
									<button
										onClick={() => handleCopyTerminal(idx, block.content)}
										className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-400 transition-all shrink-0 mt-0.5"
										title="Copy line">
										{copiedIndex === idx ? (
											<Check size={10} className="text-green-400" />
										) : (
											<Copy size={10} />
										)}
									</button>
								</div>
							))}
						</div>

						<div className="relative border-t border-[#1e2535] px-3 py-1.5 bg-[#0f1117]">
							{showAgentSuggestions && agentSuggestions.length > 0 && (
								<div className="absolute bottom-full left-3 mb-1 bg-[#1a2030] border border-[#2a3344] rounded shadow-xl overflow-hidden">
									{agentSuggestions.map((s) => (
										<button
											key={s}
											onClick={() => {
												setTerminalInput(s + " ")
												setShowAgentSuggestions(false)
											}}
											className="block w-full text-left px-3 py-1 text-[11px] text-gray-300 hover:bg-[#253045] transition-colors">
											{s}
										</button>
									))}
								</div>
							)}
							{showSmartSuggestions && smartSuggestions.length > 0 && (
								<div className="absolute bottom-full left-3 mb-1 bg-[#1a2030] border border-[#2a3344] rounded shadow-xl overflow-hidden min-w-[200px]">
									{smartSuggestions.map((s, idx) => (
										<button
											key={s.text + idx}
											onClick={() => {
												setTerminalInput(s.text + " ")
												setShowSmartSuggestions(false)
												setSelectedSuggestionIndex(-1)
											}}
											className={`block w-full text-left px-3 py-1.5 text-[11px] transition-colors ${idx === selectedSuggestionIndex ? "bg-violet-500/20 text-violet-300" : "text-gray-300 hover:bg-[#253045]"}`}>
											<span className="font-medium">{s.text}</span>
											<span className="text-gray-500 ml-2">{s.description}</span>
										</button>
									))}
								</div>
							)}
							<div className="flex items-center gap-2">
								<span className="text-green-400 text-[11px] font-mono shrink-0">$</span>
								<input
									ref={terminalInputRef}
									type="text"
									value={terminalInput}
									onChange={handleTerminalInputChange}
									onKeyDown={handleTerminalKeyDown}
									placeholder="Type a command or / for agents..."
									className="flex-1 bg-transparent text-[12px] text-gray-300 placeholder-gray-600 outline-none font-mono"
									autoFocus
								/>
							</div>
						</div>
					</div>
				</div>

				{showAiPanel && (
					<aside className="w-80 border-l border-[#1e2535] bg-[#0f1117] flex flex-col shrink-0">
						<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e2535]">
							<div className="flex items-center gap-2">
								<Brain size={12} className="text-violet-400" />
								<span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
									AI Assistant
								</span>
							</div>
							<button
								onClick={() => setShowAiPanel(false)}
								className="text-gray-500 hover:text-gray-300 transition-colors"
								title="Close panel">
								<PanelRightClose size={11} />
							</button>
						</div>

						<div className="flex border-b border-[#1e2535] bg-[#0a0d14]">
							{["chat", "plan", "memory", "deploy"].map((tab) => (
								<button
									key={tab}
									onClick={() => setAiTab(tab)}
									className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${aiTab === tab ? "text-violet-400 border-b-2 border-violet-500 bg-[#1a2030]" : "text-gray-600 hover:text-gray-400"}`}>
									{tab === "chat" && <MessageSquare size={11} className="inline mr-1" />}
									{tab === "plan" && <GitBranch size={11} className="inline mr-1" />}
									{tab === "memory" && <Database size={11} className="inline mr-1" />}
									{tab === "deploy" && <Rocket size={11} className="inline mr-1" />}
									{tab}
								</button>
							))}
						</div>

						{aiTab === "chat" && (
							<>
								<div className="flex-1 overflow-y-auto p-3 space-y-3">
									{aiMessages.length === 0 && (
										<div className="text-center text-gray-600 mt-8">
											<Bot size={24} className="mx-auto mb-2 opacity-30" />
											<p className="text-[11px]">Ask me anything about your code</p>
											<p className="text-[10px] text-gray-700 mt-1">
												Use @agent to delegate tasks
											</p>
										</div>
									)}
									{aiMessages.map((msg) => (
										<div key={msg.id} className="space-y-1">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-1.5">
													{msg.role === "user" ? (
														<User size={10} className="text-blue-400" />
													) : (
														<Bot
															size={10}
															className={
																msg.role === "agent"
																	? "text-violet-400"
																	: "text-gray-500"
															}
														/>
													)}
													<span className="text-[10px] font-medium text-gray-400">
														{msg.author}
													</span>
													{msg.meta && (
														<span className="text-[9px] text-gray-600">({msg.meta})</span>
													)}
												</div>
												<span className="text-[9px] text-gray-700">{msg.time}</span>
											</div>
											<div className="text-[12px] text-gray-300 leading-relaxed">
												{renderMessageContent(msg.content)}
											</div>
											{/* Function 8: Quick Action Buttons after each AI response */}
											{msg.role !== "user" && msg.content && msg.content.length > 20 && (
												<div className="flex items-center gap-1 mt-1.5">
													<button
														onClick={() => {
															navigator.clipboard.writeText(msg.content).catch(() => {})
														}}
														className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
														title="Copy all text">
														<Copy size={9} />
														Copy All
													</button>
													{(() => {
														const codeBlocks = msg.content.match(/```\w*\n?[\s\S]*?```/g)
														if (codeBlocks && codeBlocks.length > 0) {
															return (
																<button
																	onClick={() => {
																		codeBlocks.forEach((block) => {
																			const langMatch = block.match(/```(\w*)\n?([\s\S]*?)```/)
																			if (langMatch) {
																				handleApplyCode(langMatch[2].trim(), langMatch[1] || "text")
																			}
																		})
																	}}
																	className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-violet-400 hover:text-violet-300 hover:bg-[#1e2535] rounded transition-colors"
																	title="Apply all code blocks">
																	<Code size={9} />
																	Apply All ({codeBlocks.length})
																</button>
															)
														}
														return null
													})()}
													{(() => {
														const shellBlocks = msg.content.match(/```(bash|sh|shell|terminal|cmd|powershell|docker|zsh)\n?[\s\S]*?```/g)
														if (shellBlocks && shellBlocks.length > 0) {
															return (
																<button
																	onClick={() => {
																		const firstMatch = shellBlocks[0].match(/```\w+\n?([\s\S]*?)```/)
																		if (firstMatch) {
																			handleRunInTerminal(firstMatch[1].trim())
																		}
																	}}
																	className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-green-400 hover:text-green-300 hover:bg-[#1e2535] rounded transition-colors"
																	title="Run shell commands in terminal">
																	<Play size={9} />
																	Run Commands ({shellBlocks.length})
																</button>
															)
														}
														return null
													})()}
												</div>
											)}
											{msg.attachments && msg.attachments.length > 0 && (
												<div className="flex flex-wrap gap-1 mt-1">
													{msg.attachments.map((att) => (
														<span
															key={att.id}
															className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-[#1e2535] text-gray-400 rounded">
															<Paperclip size={8} />
															{att.filename}
														</span>
													))}
												</div>
											)}
										</div>
									))}

									{/* Proactive Suggestions */}
									{proactiveSuggestions.length > 0 && (
										<div className="flex flex-wrap gap-1.5 px-1">
											{proactiveSuggestions.map((s, idx) => (
												<button
													key={idx}
													onClick={() => {
														setAiInput(s)
														setAiInput((prev) => prev + " ")
													}}
													className="text-[10px] px-2 py-1 bg-[#1e2535] text-gray-400 rounded-full border border-[#2a3344] hover:border-violet-500 hover:text-violet-300 transition-colors">
													{s}
												</button>
											))}
										</div>
									)}
									{aiSending && (
										<div className="flex items-center gap-2 text-gray-500">
											<Loader2 size={10} className="animate-spin" />
											<span className="text-[10px]">Thinking...</span>
										</div>
									)}
									<div ref={aiMessagesEndRef} />
								</div>

								{aiAttachments.length > 0 && (
									<div className="flex flex-wrap gap-1 px-3 py-1.5 border-t border-[#1e2535] bg-[#0a0d14]">
										{aiAttachments.map((att) => (
											<span
												key={att.id}
												className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-[#1e2535] text-gray-400 rounded">
												<Paperclip size={8} />
												{att.filename}
												<button
													onClick={() => removeAttachment(att.id)}
													className="text-gray-600 hover:text-gray-400 ml-0.5">
													<X size={8} />
												</button>
											</span>
										))}
									</div>
								)}

								<div className="border-t border-[#1e2535] px-3 py-2 bg-[#0a0d14]">
									<div className="flex items-end gap-2">
										<div className="flex-1 relative">
											{/* Function 3: Slash commands dropdown */}
											{showSlashCommands && (
												<div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0f1117] border border-[#1e2535] rounded shadow-xl max-h-48 overflow-y-auto z-10">
													{slashCommandsList
														.filter((sc) => sc.command.startsWith(slashCommandFilter || "/"))
														.map((sc) => (
															<button
																key={sc.command}
																onClick={() => {
																	setAiInput(sc.command + " ")
																	setShowSlashCommands(false)
																	textareaRef?.current?.focus()
																}}
																className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left hover:bg-[#1e2535] transition-colors">
																<Slash size={11} className="text-violet-400 shrink-0" />
																<span className="text-violet-300 font-medium">{sc.command}</span>
																<span className="text-gray-500 ml-1">{sc.description}</span>
															</button>
														))}
												</div>
											)}
											<textarea
												ref={textareaRef}
												value={aiInput}
												onChange={handleAiInputChange}
												onKeyDown={handleAiKeyDown}
												placeholder="Ask AI or @agent for help... (type / for commands)"
												rows={2}
												className="w-full bg-[#1e2535] text-[12px] text-gray-300 placeholder-gray-600 border border-[#2a3344] rounded px-2.5 py-1.5 outline-none resize-none"
											/>
										</div>
										<button
											onClick={handleAiSend}
											disabled={aiSending || (!aiInput.trim() && aiAttachments.length === 0)}
											className="p-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-[#1e2535] disabled:text-gray-600 text-white rounded transition-colors"
											title="Send">
											<Send size={12} />
										</button>
									</div>
									<div className="flex items-center gap-2 mt-1.5">
										<button
											onClick={() => fileInputRef.current?.click()}
											className="text-gray-600 hover:text-gray-400 transition-colors"
											title="Attach file">
											<Paperclip size={10} />
										</button>
										<button
											onClick={() => imageInputRef.current?.click()}
											className="text-gray-600 hover:text-gray-400 transition-colors"
											title="Attach image">
											<Image size={10} />
										</button>
										<input
											ref={fileInputRef}
											type="file"
											multiple
											onChange={handleFilesSelected}
											className="hidden"
										/>
										<input
											ref={imageInputRef}
											type="file"
											accept="image/*"
											multiple
											onChange={handleImagesSelected}
											className="hidden"
										/>
									</div>
								</div>
							</>
						)}

						{aiTab === "plan" && (
							<div className="flex-1 overflow-y-auto p-3 space-y-3">
								{brainLoading ? (
									<div className="flex items-center justify-center py-8">
										<Loader2 size={16} className="text-violet-400 animate-spin" />
									</div>
								) : brainPlan.length > 0 ? (
									<>
										<div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">
											Execution Plan
										</div>
										{brainPlan.map((step, idx) => (
											<div key={idx} className="flex items-start gap-2 text-[11px]">
												<span className="text-gray-600 font-mono shrink-0">{idx + 1}.</span>
												<div>
													<code className="text-green-400 text-[10px]">{step.command}</code>
													{step.description && (
														<p className="text-gray-500 mt-0.5">{step.description}</p>
													)}
												</div>
											</div>
										))}
									</>
								) : (
									<div className="text-center text-gray-600 mt-8">
										<GitBranch size={24} className="mx-auto mb-2 opacity-30" />
										<p className="text-[11px]">No active plan</p>
										<p className="text-[10px] text-gray-700 mt-1">Ask the AI to create a plan</p>
									</div>
								)}
								{brainFeedback && (
									<div className="border-t border-[#1e2535] pt-3 mt-3">
										<div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">
											Feedback
										</div>
										<p className="text-[11px] text-gray-400">{brainFeedback.output}</p>
									</div>
								)}
							</div>
						)}

						{aiTab === "memory" && (
							<div className="flex-1 overflow-y-auto p-3 space-y-3">
								{brainMemory ? (
									<>
										<div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">
											Session Stats
										</div>
										<div className="grid grid-cols-2 gap-2">
											<div className="bg-[#1a2030] rounded p-2">
												<div className="text-[18px] font-bold text-gray-300">
													{brainMemory.stats?.totalSessions ?? 0}
												</div>
												<div className="text-[9px] text-gray-600">Sessions</div>
											</div>
											<div className="bg-[#1a2030] rounded p-2">
												<div className="text-[18px] font-bold text-gray-300">
													{brainMemory.stats?.totalCommands ?? 0}
												</div>
												<div className="text-[9px] text-gray-600">Commands</div>
											</div>
											<div className="bg-[#1a2030] rounded p-2">
												<div className="text-[18px] font-bold text-gray-300">
													{brainMemory.stats?.totalErrors ?? 0}
												</div>
												<div className="text-[9px] text-gray-600">Errors</div>
											</div>
											<div className="bg-[#1a2030] rounded p-2">
												<div className="text-[18px] font-bold text-gray-300">
													{brainMemory.stats?.successRate
														? `${(brainMemory.stats.successRate * 100).toFixed(0)}%`
														: "0%"}
												</div>
												<div className="text-[9px] text-gray-600">Success Rate</div>
											</div>
										</div>
										{brainMemory.commands && brainMemory.commands.length > 0 && (
											<>
												<div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-3 mb-2">
													Recent Commands
												</div>
												<div className="space-y-1">
													{brainMemory.commands.slice(0, 10).map((cmd, idx) => (
														<div
															key={idx}
															className="flex items-center justify-between text-[10px]">
															<span className="text-gray-400 truncate font-mono">
																{cmd.command}
															</span>
															<span
																className={`shrink-0 ml-2 ${cmd.status === "success" ? "text-green-500" : "text-red-500"}`}>
																{cmd.status}
															</span>
														</div>
													))}
												</div>
											</>
										)}
									</>
								) : (
									<div className="text-center text-gray-600 mt-8">
										<Database size={24} className="mx-auto mb-2 opacity-30" />
										<p className="text-[11px]">No memory data available</p>
									</div>
								)}
							</div>
						)}

						{aiTab === "deploy" && (
							<div className="flex-1 overflow-y-auto p-3 space-y-3">
								{brainDeployments.length > 0 ? (
									<>
										<div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">
											Recent Deployments
										</div>
										{brainDeployments.map((dep, idx) => (
											<div
												key={idx}
												className="flex items-center justify-between text-[11px] py-1 border-b border-[#1e2535] last:border-0">
												<div className="flex items-center gap-2">
													{dep.status === "success" ? (
														<CheckCircle2 size={10} className="text-green-400" />
													) : dep.status === "failed" ? (
														<XCircle size={10} className="text-red-400" />
													) : (
														<Loader2 size={10} className="text-blue-400 animate-spin" />
													)}
													<span className="text-gray-300">{dep.version || "v1.0"}</span>
												</div>
												<span className="text-gray-600">{dep.timestamp || dep.time || ""}</span>
											</div>
										))}
									</>
								) : (
									<div className="text-center text-gray-600 mt-8">
										<Rocket size={24} className="mx-auto mb-2 opacity-30" />
										<p className="text-[11px]">No deployments yet</p>
									</div>
								)}
							</div>
						)}
					</aside>
				)}
			</div>

			{showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
			{showRecordings && recordings.length > 0 && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={() => setShowRecordings(false)}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<History size={14} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Terminal Recordings</span>
							</div>
							<button
								onClick={() => setShowRecordings(false)}
								className="text-gray-500 hover:text-gray-300">
								<X size={14} />
							</button>
						</div>
						<div className="space-y-2 max-h-60 overflow-y-auto">
							{recordings.map((rec) => (
								<div
									key={rec.id}
									className="flex items-center justify-between p-2 bg-[#1a2030] rounded">
									<div>
										<div className="text-[11px] text-gray-300 font-medium">{rec.name}</div>
										<div className="text-[9px] text-gray-600">
											{rec.commandCount} commands · {rec.duration}
										</div>
									</div>
									<button
										onClick={() => {
											handleReplayRecording(rec)
											setShowRecordings(false)
										}}
										className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
										Replay
									</button>
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* ── Import GitHub Modal ─────────────────────────────────────────────── */}
			{showImportGithub && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={() => setShowImportGithub(false)}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<Github size={16} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Import GitHub Repository</span>
							</div>
							<button
								onClick={() => setShowImportGithub(false)}
								className="text-gray-500 hover:text-gray-300">
								<X size={14} />
							</button>
						</div>
						<div className="space-y-3">
							<div>
								<label className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
									Repository URL
								</label>
								<input
									type="text"
									value={importGithubUrl}
									onChange={(e) => setImportGithubUrl(e.target.value)}
									placeholder="https://github.com/user/repo"
									className="w-full bg-[#1a2030] text-[12px] text-gray-300 placeholder-gray-600 border border-[#2a3344] rounded px-2.5 py-1.5 mt-1 outline-none focus:border-violet-500"
								/>
							</div>
							<div>
								<label className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
									Branch
								</label>
								<input
									type="text"
									value={importGithubBranch}
									onChange={(e) => setImportGithubBranch(e.target.value)}
									placeholder="main"
									className="w-full bg-[#1a2030] text-[12px] text-gray-300 placeholder-gray-600 border border-[#2a3344] rounded px-2.5 py-1.5 mt-1 outline-none focus:border-violet-500"
								/>
							</div>
							{importGithubError && (
								<div className="text-[10px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
									{importGithubError}
								</div>
							)}
							<button
								onClick={handleImportGithub}
								disabled={importGithubLoading || !importGithubUrl.trim()}
								className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-[#1e2535] disabled:text-gray-600 text-white text-[12px] rounded transition-colors flex items-center justify-center gap-2">
								{importGithubLoading ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<Github size={12} />
								)}
								{importGithubLoading ? "Importing..." : "Import Repository"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Open/New Workspace Modal ────────────────────────────────────────── */}
			{showOpenWorkspace && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={() => setShowOpenWorkspace(false)}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<FolderOpen size={16} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Open Workspace</span>
							</div>
							<button
								onClick={() => setShowOpenWorkspace(false)}
								className="text-gray-500 hover:text-gray-300">
								<X size={14} />
							</button>
						</div>
						<div className="space-y-3">
							<div>
								<label className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
									Workspace Path
								</label>
								<input
									type="text"
									value={openWorkspacePath}
									onChange={(e) => setOpenWorkspacePath(e.target.value)}
									placeholder="/home/user/projects/my-app"
									className="w-full bg-[#1a2030] text-[12px] text-gray-300 placeholder-gray-600 border border-[#2a3344] rounded px-2.5 py-1.5 mt-1 outline-none focus:border-violet-500"
								/>
							</div>
							{recentWorkspaces.length > 0 && (
								<>
									<div className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
										Recent Workspaces
									</div>
									<div className="space-y-1 max-h-32 overflow-y-auto">
										{recentWorkspaces.map((w, idx) => (
											<button
												key={idx}
												onClick={() => handleOpenWorkspace(w.path)}
												className="w-full flex items-center gap-2 px-2 py-1.5 bg-[#1a2030] hover:bg-[#1e2535] rounded text-left transition-colors">
												<FolderGit2 size={12} className="text-gray-500 shrink-0" />
												<div className="min-w-0">
													<div className="text-[11px] text-gray-300 truncate">{w.name}</div>
													<div className="text-[9px] text-gray-600 truncate">{w.path}</div>
												</div>
											</button>
										))}
									</div>
								</>
							)}
							{openWorkspaceError && (
								<div className="text-[10px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
									{openWorkspaceError}
								</div>
							)}
							<button
								onClick={() => handleOpenWorkspace()}
								disabled={openWorkspaceLoading || !openWorkspacePath.trim()}
								className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-[#1e2535] disabled:text-gray-600 text-white text-[12px] rounded transition-colors flex items-center justify-center gap-2">
								{openWorkspaceLoading ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<FolderOpen size={12} />
								)}
								{openWorkspaceLoading ? "Opening..." : "Open Workspace"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Function 7: Diff View Modal ──────────────────────────────────────────── */}
			{showDiffView && diffData && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={() => setShowDiffView(false)}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<Diff size={14} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">
									Changes: {diffData.path}
								</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-[10px] text-gray-500">
									{diffData.totalChanges} change{diffData.totalChanges !== 1 ? "s" : ""}
								</span>
								<button
									onClick={() => setShowDiffView(false)}
									className="text-gray-500 hover:text-gray-300">
									<X size={14} />
								</button>
							</div>
						</div>
						<div className="flex-1 overflow-y-auto space-y-1">
							{diffData.changes.map((change, idx) => (
								<div key={idx} className="text-[10px] font-mono">
									<div className="flex items-center gap-2 text-gray-600 bg-[#1a2030] px-2 py-0.5 rounded-t">
										<span>Line {change.line}</span>
									</div>
									{change.old !== "" && (
										<div className="bg-red-900/20 border-l-2 border-red-500 px-2 py-0.5 text-red-300">
											- {change.old}
										</div>
									)}
									{change.new !== "" && (
										<div className="bg-green-900/20 border-l-2 border-green-500 px-2 py-0.5 text-green-300 rounded-b">
											+ {change.new}
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* ── Function 5: Inline AI Selection Button ─────────────────────────────── */}
			{showInlineAiButton && inlineSelectionPos && (
				<div
					className="fixed z-50"
					style={{
						top: inlineSelectionPos.top - 30,
						left: inlineSelectionPos.left,
					}}>
					<button
						onClick={() => {
							if (currentFileSelection) {
								setAiInput(`Explain this code:\n\`\`\`\n${currentFileSelection.slice(0, 2000)}\n\`\`\``)
								setShowInlineAiButton(false)
								// Focus the AI input
								setTimeout(() => textareaRef.current?.focus(), 50)
							}
						}}
						className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white text-[10px] rounded shadow-lg transition-colors"
						title="Ask AI about selected code">
						<Sparkles size={10} />
						Ask AI
					</button>
				</div>
			)}
		</div>
	)
}
