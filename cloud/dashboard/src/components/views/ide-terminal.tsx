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

// ── Types (local only) ────────────────────────────────────────────────────

interface AutocompleteSuggestion {
	text: string
	description: string
	type: "command" | "agent" | "recent" | "ai"
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
		const isShellLanguage = ["bash", "sh", "shell", "terminal", "cmd", "powershell", "docker", "zsh"].includes(
			language.toLowerCase(),
		)
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

/** Render inline markdown formatting: bold, italic, strikethrough, inline code, and links */
function renderFormattedText(text: string, key: number): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	let localKey = key * 100000

	// Combined regex for inline formatting tokens (ordered by priority)
	// Order: inline code > links > bold > italic > strikethrough
	const inlineRegex =
		/(`[^`]+`)|(\/[a-zA-Z0-9_\-./]+[a-zA-Z0-9_])|([a-zA-Z]+:\/\/[^\s]+)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)/g

	let match: RegExpExecArray | null
	let lastIdx = 0

	while ((match = inlineRegex.exec(text)) !== null) {
		// Plain text before this match
		if (match.index > lastIdx) {
			nodes.push(<span key={localKey++}>{text.slice(lastIdx, match.index)}</span>)
		}

		if (match[1] !== undefined) {
			// Inline code: `code`
			nodes.push(
				<code
					key={localKey++}
					className="px-1 py-0.5 text-[11px] font-mono bg-[#1a2030] text-green-300 rounded border border-[#1e2535]">
					{match[1].slice(1, -1)}
				</code>,
			)
		} else if (match[2] !== undefined) {
			// File path link
			const url = match[2]
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
		} else if (match[3] !== undefined) {
			// URL link
			const url = match[3]
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
		} else if (match[5] !== undefined) {
			// Bold: **text**
			nodes.push(
				<strong key={localKey++} className="font-semibold text-gray-100">
					{match[5]}
				</strong>,
			)
		} else if (match[7] !== undefined) {
			// Bold: __text__
			nodes.push(
				<strong key={localKey++} className="font-semibold text-gray-100">
					{match[7]}
				</strong>,
			)
		} else if (match[9] !== undefined) {
			// Italic: *text*
			nodes.push(
				<em key={localKey++} className="italic text-gray-300">
					{match[9]}
				</em>,
			)
		} else if (match[11] !== undefined) {
			// Italic: _text_
			nodes.push(
				<em key={localKey++} className="italic text-gray-300">
					{match[11]}
				</em>,
			)
		} else if (match[13] !== undefined) {
			// Strikethrough: ~~text~~
			nodes.push(
				<del key={localKey++} className="line-through text-gray-500">
					{match[13]}
				</del>,
			)
		}

		lastIdx = match.index + match[0].length
	}

	if (lastIdx < text.length) {
		nodes.push(<span key={localKey++}>{text.slice(lastIdx)}</span>)
	}

	return nodes
}

function renderTextWithLinks(text: string, key: number): React.ReactNode[] {
	// Split text into lines to handle block-level formatting (lists, blockquotes, headings)
	const lines = text.split("\n")
	const nodes: React.ReactNode[] = []
	let localKey = key * 10000

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.trim()

		// Empty line — spacing
		if (!trimmed) {
			nodes.push(<div key={localKey++} className="h-1" />)
			continue
		}

		// Heading: ### text
		const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
		if (headingMatch) {
			const level = headingMatch[1].length
			const headingText = headingMatch[2]
			const sizeClass =
				level === 1
					? "text-sm font-bold text-gray-100"
					: level === 2
						? "text-[13px] font-bold text-gray-100"
						: level === 3
							? "text-[12px] font-semibold text-gray-200"
							: "text-[11px] font-semibold text-gray-300"
			nodes.push(
				<div key={localKey++} className={`${sizeClass} mt-2 mb-1`}>
					{renderFormattedText(headingText, localKey)}
				</div>,
			)
			continue
		}

		// Blockquote: > text
		if (trimmed.startsWith("> ")) {
			const quoteText = trimmed.slice(2)
			nodes.push(
				<div
					key={localKey++}
					className="border-l-2 border-violet-500/40 pl-3 py-0.5 my-1 text-gray-400 italic text-[11px]">
					{renderFormattedText(quoteText, localKey)}
				</div>,
			)
			continue
		}

		// Unordered list: - item or * item
		const ulMatch = trimmed.match(/^[-*]\s+(.+)$/)
		if (ulMatch) {
			nodes.push(
				<div key={localKey++} className="flex items-start gap-2 my-0.5">
					<span className="text-gray-500 mt-0.5 shrink-0">•</span>
					<span className="text-gray-300 text-[12px]">{renderFormattedText(ulMatch[1], localKey)}</span>
				</div>,
			)
			continue
		}

		// Ordered list: 1. item
		const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
		if (olMatch) {
			nodes.push(
				<div key={localKey++} className="flex items-start gap-2 my-0.5">
					<span className="text-gray-500 text-[10px] font-mono mt-0.5 shrink-0 w-4 text-right">
						{olMatch[1]}.
					</span>
					<span className="text-gray-300 text-[12px]">{renderFormattedText(olMatch[2], localKey)}</span>
				</div>,
			)
			continue
		}

		// Regular paragraph line
		nodes.push(
			<div key={localKey++} className="text-gray-300 text-[12px] leading-relaxed">
				{renderFormattedText(line, localKey)}
			</div>,
		)
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
	// ── Global state from store (persisted across tab switches) ──────────
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

	// ── Local-only state (not persisted) ─────────────────────────────────
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
	const [smartSuggestions, setSmartSuggestions] = useState<AutocompleteSuggestion[]>([])
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
	const [diffData, setDiffData] = useState<{
		path: string
		changes: Array<{ line: number; old: string; new: string }>
		totalChanges: number
	} | null>(null)
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
				// Only set data if not already hydrated from localStorage
				if (!_hydrated) {
					if (data.repoName) dispatch({ type: "SET_REPO_NAME", payload: data.repoName })
					if (data.branch) dispatch({ type: "SET_BRANCH", payload: data.branch })
					if (data.files?.length) dispatch({ type: "SET_FILES", payload: data.files })
					if (data.pipeline?.length) dispatch({ type: "SET_PIPELINE", payload: data.pipeline })
					if (data.chatMessages?.length) {
						dispatch({ type: "SET_AI_MESSAGES", payload: data.chatMessages })
					}
					if (data.status) dispatch({ type: "SET_STATUS", payload: data.status })
					if (data.terminalSessions?.length) {
						dispatch({ type: "SET_TERMINAL_OUTPUT", payload: data.terminalSessions[0].output })
					}
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
				dispatch({ type: "SET_LOADING", payload: false })
			}
		}
		load()
	}, [_hydrated, dispatch])

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
				dispatch({ type: "SET_IS_TERMINAL_MAXIMIZED", payload: !isTerminalMaximized })
			}
			if (e.ctrlKey && e.key === "p") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_FILE_SEARCH", payload: true })
				setTimeout(() => fileSearchRef.current?.focus(), 50)
			}
			if (e.key === "Escape") {
				dispatch({ type: "SET_SHOW_FILE_SEARCH", payload: false })
				dispatch({ type: "SET_SHOW_SHORTCUTS", payload: false })
				dispatch({ type: "SET_SHOW_AGENT_SUGGESTIONS", payload: false })
				dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: false })
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown)
		return () => window.removeEventListener("keydown", handleGlobalKeyDown)
	}, [isTerminalMaximized, dispatch])

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
							case "assistant-start": {
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
								dispatch({ type: "ADD_AI_MESSAGE", payload: placeholder })
								break
							}
							case "token": {
								// Use functional update via reading current state
								const lastMsg = aiMessages[aiMessages.length - 1]
								if (lastMsg && lastMsg.meta === "streaming...") {
									dispatch({
										type: "UPDATE_LAST_AI_MESSAGE",
										payload: { content: lastMsg.content + data.text },
									})
								}
								break
							}
							case "done":
								dispatch({
									type: "UPDATE_LAST_AI_MESSAGE",
									payload: {
										content: data.reply || undefined,
										author: data.provider || "AI",
										meta: `${data.model || ""} · ws`,
									},
								})
								dispatch({ type: "SET_AI_SENDING", payload: false })
								break
							case "suggestions":
								if (Array.isArray(data.suggestions)) {
									dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: data.suggestions })
								}
								break
							case "error":
								dispatch({
									type: "UPDATE_LAST_AI_MESSAGE",
									payload: {
										content: `Error: ${data.message}`,
										author: "System",
										meta: "error",
									},
								})
								dispatch({ type: "SET_AI_SENDING", payload: false })
								break
							case "cancelled":
								dispatch({
									type: "UPDATE_LAST_AI_MESSAGE",
									payload: { meta: "cancelled" },
								})
								dispatch({ type: "SET_AI_SENDING", payload: false })
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
	}, [aiMessages, dispatch])

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
				const newAtts: ChatAttachment[] = []
				for (const file of Array.from(e.dataTransfer.files)) {
					newAtts.push({
						id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
						filename: file.name,
						type: file.type || "unknown",
						size: `${(file.size / 1024).toFixed(1)}KB`,
					})
				}
				dispatch({ type: "SET_AI_ATTACHMENTS", payload: [...aiAttachments, ...newAtts] })
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
	}, [aiAttachments, dispatch])

	// ── Paste handler ─────────────────────────────────────────────────────
	useEffect(() => {
		function handlePaste(e: ClipboardEvent) {
			const items = e.clipboardData?.items
			const textData = e.clipboardData?.getData("text")
			if (!items) return

			const activeEl = document.activeElement

			// ── Case 1: Terminal input is focused → paste text into terminal ──
			if (activeEl && activeEl === terminalInputRef.current && textData) {
				e.preventDefault()
				dispatch({ type: "SET_TERMINAL_INPUT", payload: terminalInput + textData })
				return
			}

			// ── Case 2: AI textarea is focused → handle image attachments ──
			const newAtts: ChatAttachment[] = []
			for (const item of Array.from(items)) {
				if (item.type.startsWith("image/")) {
					const file = item.getAsFile()
					if (file) {
						newAtts.push({
							id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
							filename: `pasted-${Date.now()}.${item.type.split("/")[1] || "png"}`,
							type: item.type,
							size: `${(file.size / 1024).toFixed(1)}KB`,
						})
					}
				}
			}
			if (newAtts.length > 0) {
				dispatch({ type: "SET_AI_ATTACHMENTS", payload: [...aiAttachments, ...newAtts] })
			}
		}
		window.addEventListener("paste", handlePaste)
		return () => window.removeEventListener("paste", handlePaste)
	}, [terminalInput, aiAttachments, dispatch])

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

		// ── Build rich context for the AI ──────────────────────────────
		// 1. Current (active) file with full content
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

		// 2. All open files (file names + paths, truncated content)
		const allOpenFiles = openFiles.map((f) => ({
			path: f.path,
			name: f.name,
			language: f.language,
			modified: f.modified,
			content: f.path === activeFilePath ? undefined : f.content.slice(0, 2000),
		}))

		// 3. Workspace file tree (file names only, for structure awareness)
		const workspaceFiles = files.map((f) => ({
			name: f.name,
			path: f.path,
			kind: f.kind,
		}))

		// 4. Recent terminal output for context (last 30 lines)
		const terminalContext = terminalOutput.slice(-30)

		// 5. Recent conversation history (last 6 messages for continuity)
		const recentHistory = aiMessages.slice(-6).map((m) => ({
			role: m.role,
			author: m.author,
			content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
		}))

		// 6. Pending workspace tasks
		const pendingTasks = workspaceTasks.filter((t) => t.status === "pending").map((t) => t.title)

		// ── Build a human-readable context summary for the user ─────────
		const contextParts: string[] = []
		if (repoName) contextParts.push(`**Workspace:** ${repoName}${branch ? ` (${branch})` : ""}`)
		if (currentFile) contextParts.push(`**Active file:** \`${currentFile.path}\``)
		if (allOpenFiles.length > 0) {
			const fileList = allOpenFiles.map((f) => `\`${f.path}\``).join(", ")
			contextParts.push(`**Open files (${allOpenFiles.length}):** ${fileList}`)
		}
		if (workspaceFiles.length > 0) {
			const folderCount = workspaceFiles.filter((f) => f.kind === "folder").length
			const fileCount = workspaceFiles.filter((f) => f.kind === "file").length
			contextParts.push(`**Workspace structure:** ${folderCount} folders, ${fileCount} files`)
		}
		if (terminalContext.length > 0) {
			contextParts.push(`**Terminal output:** ${terminalContext.length} recent lines available`)
		}
		if (recentHistory.length > 0) {
			contextParts.push(`**Conversation history:** ${recentHistory.length} previous messages`)
		}
		if (pendingTasks.length > 0) {
			contextParts.push(`**Pending tasks:** ${pendingTasks.join(", ")}`)
		}
		if (currentFileSelection) {
			contextParts.push(`**Selection:** ${currentFileSelection.length} chars selected in active file`)
		}
		if (aiAttachments.length > 0) {
			contextParts.push(`**Attachments:** ${aiAttachments.length} file(s)/image(s) attached`)
		}

		const contextSummary =
			contextParts.length > 0 ? `📋 **Context sent to AI**\n\n${contextParts.join("\n")}\n\n---` : null

		// Add context summary as a system message so the user sees what the AI knows
		if (contextSummary) {
			dispatch({
				type: "ADD_AI_MESSAGE",
				payload: {
					id: `ctx-${Date.now()}`,
					role: "system",
					author: "Context",
					time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
					content: contextSummary,
				},
			})
		}

		// ── System instruction for AI context awareness ────────────────
		const contextInstruction = `You are an AI coding assistant in a Cloud IDE. Before answering, analyze the context provided below and:

1. **Summarize** what you understand about the user's current workspace, open files, and task
2. **If anything is unclear** — ask a specific confirmatory question (e.g., "Which file should I modify?", "Do you want me to fix the bug in X or improve Y?")
3. **If context is sufficient** — proceed directly with your answer

Context summary:
- Workspace: ${repoName || "unknown"}${branch ? ` (branch: ${branch})` : ""}
- Active file: ${currentFile ? currentFile.path : "none"}
- Open files: ${allOpenFiles.length} file(s)
- Workspace structure: ${workspaceFiles.filter((f) => f.kind === "folder").length} folders, ${workspaceFiles.filter((f) => f.kind === "file").length} files
- Terminal output: ${terminalContext.length} recent lines
- Conversation history: ${recentHistory.length} previous messages
- Pending tasks: ${pendingTasks.length} task(s)
- Selection: ${currentFileSelection ? `${currentFileSelection.length} chars` : "none"}

User message: ${text}`

		// If WebSocket is connected, use it for real-time streaming
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			// Send via WebSocket — the assistant-start/token/done events
			// are handled by the WebSocket onmessage handler above
			wsRef.current.send(
				JSON.stringify({
					type: "chat",
					text: contextInstruction,
					currentFile,
					allOpenFiles,
					workspaceFiles,
					terminalOutput: terminalContext,
					conversationHistory: recentHistory,
					pendingTasks,
					repoName,
					branch,
					provider: typeof window !== "undefined" ? localStorage.getItem("superroo-chat-provider") : null,
				}),
			)

			// Add a workspace task to memory
			if (text.length > 10) {
				const taskTitle = text.length > 60 ? text.substring(0, 60) + "..." : text
				const newTask: WorkspaceTask = {
					id: `task-${Date.now()}`,
					title: taskTitle,
					status: "pending",
					createdAt: new Date().toISOString(),
				}
				dispatch({ type: "SET_WORKSPACE_TASKS", payload: [newTask, ...workspaceTasks.slice(0, 49)] })
			}

			return
		}

		// Fallback: if WebSocket not connected, use HTTP POST
		try {
			const storedProvider = typeof window !== "undefined" ? localStorage.getItem("superroo-chat-provider") : null

			// Build the same rich context as the WebSocket path
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
			const workspaceFiles = files.map((f) => ({ name: f.name, path: f.path, kind: f.kind }))
			const terminalContext = terminalOutput.slice(-30)
			const recentHistory = aiMessages.slice(-6).map((m) => ({
				role: m.role,
				author: m.author,
				content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
			}))
			const pendingTasks = workspaceTasks.filter((t) => t.status === "pending").map((t) => t.title)

			const body: Record<string, unknown> = {
				message: contextInstruction,
				currentFile,
				allOpenFiles,
				workspaceFiles,
				terminalOutput: terminalContext,
				conversationHistory: recentHistory,
				pendingTasks,
				repoName,
				branch,
			}
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

			// Update the last message (streaming placeholder) or add a new one
			const lastMsg = aiMessages[aiMessages.length - 1]
			if (lastMsg && lastMsg.meta === "streaming...") {
				dispatch({
					type: "UPDATE_LAST_AI_MESSAGE",
					payload: {
						content: replyText,
						author: result.provider || "AI",
						meta: metaParts.join(" · "),
					},
				})
			} else {
				dispatch({
					type: "ADD_AI_MESSAGE",
					payload: {
						id: `msg-${Date.now() + 1}`,
						role: "agent",
						author: result.provider || "AI",
						meta: metaParts.join(" · "),
						time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
						content: replyText,
					},
				})
			}

			if (result.orchestratorTaskId) {
				fetchOrchestratorStatus()
			}
		} catch (err) {
			const lastMsg = aiMessages[aiMessages.length - 1]
			if (lastMsg && lastMsg.meta === "streaming...") {
				dispatch({
					type: "UPDATE_LAST_AI_MESSAGE",
					payload: {
						content: `Error: ${err instanceof Error ? err.message : "Failed"}`,
						author: "System",
					},
				})
			}
		}
		dispatch({ type: "SET_AI_SENDING", payload: false })
	}, [
		aiInput,
		aiAttachments,
		activeFilePath,
		openFiles,
		files,
		currentFileSelection,
		terminalOutput,
		fetchOrchestratorStatus,
		aiMessages,
		workspaceTasks,
		repoName,
		branch,
		dispatch,
	])

	const handleAiKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Function 3: Slash commands auto-complete
			if (e.key === "Tab" && showSlashCommands) {
				e.preventDefault()
				const filtered = slashCommandsList.filter((sc) => sc.command.startsWith(slashCommandFilter || "/"))
				if (filtered.length > 0) {
					dispatch({ type: "SET_AI_INPUT", payload: filtered[0].command + " " })
					dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })
				}
				return
			}
			if (e.key === "Escape") {
				dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })
				return
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_SLASH_COMMANDS", payload: false })
				handleAiSend()
			}
		},
		[handleAiSend, showSlashCommands, slashCommandFilter, dispatch],
	)

	// ── Terminal command handlers ─────────────────────────────────────────
	const handleTerminalCommand = useCallback(async () => {
		const cmd = terminalInput.trim()
		if (!cmd) return

		dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`$ ${cmd}`] })
		dispatch({ type: "SET_TERMINAL_INPUT", payload: "" })
		dispatch({
			type: "SET_RECENT_COMMANDS",
			payload: [cmd, ...recentCommands.filter((c) => c !== cmd)].slice(0, 20),
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
					dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: result.output })
				}
				if (result.error) {
					dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`✕ ${result.error}`] })
				}
			} catch (err) {
				dispatch({
					type: "APPEND_TERMINAL_OUTPUT",
					payload: [`✕ Command failed: ${err instanceof Error ? err.message : "Unknown error"}`],
				})
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
					dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: result.output })
				}
				if (result.error) {
					dispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`✕ ${result.error}`] })
				}
			} catch (err) {
				dispatch({
					type: "APPEND_TERMINAL_OUTPUT",
					payload: [`✕ Command failed: ${err instanceof Error ? err.message : "Unknown error"}`],
				})
			}
		}
	}, [terminalInput, recentCommands, dispatch])

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
					dispatch({ type: "SET_TERMINAL_INPUT", payload: suggestion.text + " " })
					dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: false })
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
		[handleTerminalCommand, showSmartSuggestions, smartSuggestions, selectedSuggestionIndex, dispatch],
	)

	const handleTerminalInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const val = e.target.value
			dispatch({ type: "SET_TERMINAL_INPUT", payload: val })

			if (val.startsWith("/") || val.startsWith("@")) {
				const suggestions = getAgentSuggestions(val)
				setAgentSuggestions(suggestions)
				dispatch({ type: "SET_SHOW_AGENT_SUGGESTIONS", payload: suggestions.length > 0 })
				dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: false })
			} else if (val.length >= 2) {
				const smart = getSmartSuggestions(val, recentCommands, agentCommands)
				setSmartSuggestions(smart)
				dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: smart.length > 0 })
				dispatch({ type: "SET_SHOW_AGENT_SUGGESTIONS", payload: false })
				setSelectedSuggestionIndex(-1)
			} else {
				dispatch({ type: "SET_SHOW_AGENT_SUGGESTIONS", payload: false })
				dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: false })
				setSelectedSuggestionIndex(-1)
			}
		},
		[recentCommands, dispatch],
	)

	const handleFileClick = useCallback(
		(path: string, name: string) => {
			if (!openFiles.find((f) => f.path === path)) {
				dispatch({
					type: "SET_OPEN_FILES",
					payload: [
						...openFiles,
						{ path, name, content: `// ${name}\n\n// Loading...`, language: "text", modified: false },
					],
				})
			}
			dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: path })
		},
		[openFiles, dispatch],
	)

	const handleFilesSelected = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files
			if (!files) return
			const newAttachments: ChatAttachment[] = []
			for (const file of Array.from(files)) {
				newAttachments.push({
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: file.type || "unknown",
					size: `${(file.size / 1024).toFixed(1)}KB`,
				})
			}
			dispatch({ type: "SET_AI_ATTACHMENTS", payload: [...aiAttachments, ...newAttachments] })
			e.target.value = ""
		},
		[aiAttachments, dispatch],
	)

	const handleImagesSelected = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files
			if (!files) return
			const newAttachments: ChatAttachment[] = []
			for (const file of Array.from(files)) {
				newAttachments.push({
					id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					filename: file.name,
					type: file.type || "image/png",
					size: `${(file.size / 1024).toFixed(1)}KB`,
				})
			}
			dispatch({ type: "SET_AI_ATTACHMENTS", payload: [...aiAttachments, ...newAttachments] })
			e.target.value = ""
		},
		[aiAttachments, dispatch],
	)

	const removeAttachment = useCallback(
		(id: string) => {
			dispatch({ type: "SET_AI_ATTACHMENTS", payload: aiAttachments.filter((a) => a.id !== id) })
		},
		[aiAttachments, dispatch],
	)

	// ── Function 2: Run-in-Terminal handler ────────────────────────────────
	const handleRunInTerminal = useCallback(
		(code: string) => {
			// Set the terminal input to the command and focus it
			dispatch({ type: "SET_TERMINAL_INPUT", payload: code })
			// Focus the terminal input after a short delay to let React render
			setTimeout(() => {
				terminalInputRef.current?.focus()
			}, 50)
		},
		[dispatch],
	)

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
							const diffResult = await api<{
								ok: boolean
								changes: Array<{ line: number; old: string; new: string }>
								totalChanges: number
							}>("/ide-workspace/file/diff", {
								method: "POST",
								body: JSON.stringify({ oldContent, newContent: code }),
							})
							if (diffResult.ok && diffResult.totalChanges > 0) {
								setDiffData({
									path: detectedPath,
									changes: diffResult.changes,
									totalChanges: diffResult.totalChanges,
								})
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
				const existing = openFiles.find((f) => f.path === detectedPath)
				if (existing) {
					dispatch({
						type: "SET_OPEN_FILES",
						payload: openFiles.map((f) =>
							f.path === detectedPath ? { ...f, content: code, modified: true } : f,
						),
					})
				} else {
					dispatch({
						type: "SET_OPEN_FILES",
						payload: [...openFiles, { path: detectedPath, name, content: code, language, modified: true }],
					})
				}
				dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: detectedPath })
				return
			}

			// Fallback: apply to active file or create untitled
			if (activeFilePath) {
				// Save old content for diff
				const oldFile = openFiles.find((f) => f.path === activeFilePath)
				if (oldFile) {
					try {
						const diffResult = await api<{
							ok: boolean
							changes: Array<{ line: number; old: string; new: string }>
							totalChanges: number
						}>("/ide-workspace/file/diff", {
							method: "POST",
							body: JSON.stringify({ oldContent: oldFile.content, newContent: code }),
						})
						if (diffResult.ok && diffResult.totalChanges > 0) {
							setDiffData({
								path: activeFilePath,
								changes: diffResult.changes,
								totalChanges: diffResult.totalChanges,
							})
						}
					} catch {}
				}
				dispatch({
					type: "SET_OPEN_FILES",
					payload: openFiles.map((f) =>
						f.path === activeFilePath ? { ...f, content: code, modified: true } : f,
					),
				})
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
				dispatch({
					type: "SET_OPEN_FILES",
					payload: [...openFiles, { path, name: filename, content: code, language, modified: true }],
				})
				dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: path })
			}
		},
		[activeFilePath, openFiles, dispatch],
	)

	// ── Handle file link click from rich content ──────────────────────────
	const handleFileLinkClickFromContent = useCallback(
		(path: string) => {
			const name = path.split("/").pop() || path
			if (!openFiles.find((f) => f.path === path)) {
				dispatch({
					type: "SET_OPEN_FILES",
					payload: [
						...openFiles,
						{ path, name, content: `// ${name}\n\n// Loading...`, language: "text", modified: false },
					],
				})
			}
			dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: path })
		},
		[openFiles, dispatch],
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
				if (result.repoName) dispatch({ type: "SET_REPO_NAME", payload: result.repoName })
				if (result.branch) dispatch({ type: "SET_BRANCH", payload: result.branch })
				if (result.files) dispatch({ type: "SET_FILES", payload: result.files })
				dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })
				setImportGithubUrl("")
				setImportGithubBranch("main")
				const filtered = recentWorkspaces.filter((w) => w.path !== result.repoName)
				dispatch({
					type: "SET_RECENT_WORKSPACES",
					payload: [
						{
							name: result.repoName || "imported-repo",
							path: result.repoName || "imported-repo",
							lastOpened: new Date().toISOString(),
						},
						...filtered.slice(0, 9),
					],
				})
			} else {
				setImportGithubError(result.error || "Import failed")
			}
		} catch (err) {
			setImportGithubError(err instanceof Error ? err.message : "Import failed")
		} finally {
			setImportGithubLoading(false)
		}
	}, [importGithubUrl, importGithubBranch, recentWorkspaces, dispatch])

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
					if (result.repoName) dispatch({ type: "SET_REPO_NAME", payload: result.repoName })
					if (result.branch) dispatch({ type: "SET_BRANCH", payload: result.branch })
					if (result.files) dispatch({ type: "SET_FILES", payload: result.files })
					dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })
					setOpenWorkspacePath("")
					const name = result.repoName || targetPath.split("/").pop() || targetPath
					const filtered = recentWorkspaces.filter((w) => w.path !== targetPath)
					dispatch({
						type: "SET_RECENT_WORKSPACES",
						payload: [
							{ name, path: targetPath, lastOpened: new Date().toISOString() },
							...filtered.slice(0, 9),
						],
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
		[openWorkspacePath, recentWorkspaces, dispatch],
	)

	const handleTerminalResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			const startY = e.clientY
			const startHeight = terminalHeight
			function onMouseMove(ev: MouseEvent) {
				dispatch({
					type: "SET_TERMINAL_HEIGHT",
					payload: Math.max(80, Math.min(600, startHeight + (ev.clientY - startY))),
				})
			}
			function onMouseUp() {
				window.removeEventListener("mousemove", onMouseMove)
				window.removeEventListener("mouseup", onMouseUp)
			}
			window.addEventListener("mousemove", onMouseMove)
			window.addEventListener("mouseup", onMouseUp)
		},
		[terminalHeight, dispatch],
	)

	const handleCopyTerminal = useCallback((index: number, content: string) => {
		navigator.clipboard.writeText(content).catch(() => {})
		setCopiedIndex(index)
		setTimeout(() => setCopiedIndex(null), 1500)
	}, []) // copiedIndex is local-only state

	const toggleBlockCollapse = useCallback(
		(id: string) => {
			const next = new Set(collapsedBlocks)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			dispatch({ type: "SET_COLLAPSED_BLOCKS", payload: next })
		},
		[collapsedBlocks, dispatch],
	)

	const handleStartRecording = useCallback(() => {
		dispatch({ type: "SET_IS_RECORDING", payload: true })
		dispatch({ type: "SET_RECORDING_BLOCKS", payload: [] })
	}, [dispatch])
	const handleStopRecording = useCallback(() => {
		dispatch({ type: "SET_IS_RECORDING", payload: false })
		if (recordingBlocks.length > 0) {
			dispatch({
				type: "SET_RECORDINGS",
				payload: [...recordings, createRecording(recordingBlocks, `Recording ${recordings.length + 1}`)],
			})
		}
	}, [recordingBlocks, recordings, dispatch])
	const handleReplayRecording = useCallback(
		(recording: TerminalRecording) => {
			dispatch({ type: "SET_OUTPUT_BLOCKS", payload: recording.blocks })
		},
		[dispatch],
	)

	useEffect(() => {
		dispatch({ type: "SET_OUTPUT_BLOCKS", payload: convertToBlocks(terminalOutput) })
	}, [terminalOutput, dispatch])
	useEffect(() => {
		if (isRecording) {
			dispatch({
				type: "SET_RECORDING_BLOCKS",
				payload: [...recordingBlocks, ...outputBlocks.slice(recordingBlocks.length)],
			})
		}
	}, [outputBlocks, isRecording, recordingBlocks, dispatch])

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
						onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: true })}
						className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
						title="Import GitHub repository">
						<Github size={11} />
						<span className="hidden sm:inline">Import</span>
					</button>
					{/* Open Workspace */}
					<button
						onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: true })}
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
						onClick={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: true })}
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
									onClick={() => dispatch({ type: "SET_SHOW_FILE_SEARCH", payload: true })}
									className="text-gray-500 hover:text-gray-300 transition-colors"
									title="Search files (Ctrl+P)">
									<FileSearch size={11} />
								</button>
								<button
									onClick={() => dispatch({ type: "SET_SHOW_FILE_PANEL", payload: false })}
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
									onChange={(e) =>
										dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: e.target.value })
									}
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
										onClick={() => dispatch({ type: "SET_ACTIVE_FILE_PATH", payload: f.path })}
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
											dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: true })
										} else {
											dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: false })
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
										onClick={() =>
											dispatch({ type: "SET_SHOW_RECORDINGS", payload: !showRecordings })
										}
										className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
										title="View recordings">
										<History size={11} />
									</button>
								)}
								<button
									onClick={() =>
										dispatch({ type: "SET_IS_TERMINAL_MAXIMIZED", payload: !isTerminalMaximized })
									}
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
												dispatch({ type: "SET_TERMINAL_INPUT", payload: s + " " })
												dispatch({ type: "SET_SHOW_AGENT_SUGGESTIONS", payload: false })
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
												dispatch({ type: "SET_TERMINAL_INPUT", payload: s.text + " " })
												dispatch({ type: "SET_SHOW_SMART_SUGGESTIONS", payload: false })
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
								onClick={() => dispatch({ type: "SET_SHOW_AI_PANEL", payload: false })}
								className="text-gray-500 hover:text-gray-300 transition-colors"
								title="Close panel">
								<PanelRightClose size={11} />
							</button>
						</div>

						<div className="flex border-b border-[#1e2535] bg-[#0a0d14]">
							{["chat", "plan", "memory", "deploy"].map((tab) => (
								<button
									key={tab}
									onClick={() => dispatch({ type: "SET_AI_TAB", payload: tab })}
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
																			const langMatch =
																				block.match(/```(\w*)\n?([\s\S]*?)```/)
																			if (langMatch) {
																				handleApplyCode(
																					langMatch[2].trim(),
																					langMatch[1] || "text",
																				)
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
														const shellBlocks = msg.content.match(
															/```(bash|sh|shell|terminal|cmd|powershell|docker|zsh)\n?[\s\S]*?```/g,
														)
														if (shellBlocks && shellBlocks.length > 0) {
															return (
																<button
																	onClick={() => {
																		const firstMatch =
																			shellBlocks[0].match(
																				/```\w+\n?([\s\S]*?)```/,
																			)
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
														dispatch({ type: "SET_AI_INPUT", payload: s + " " })
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
											{/* Recent Tasks dropdown — click to load last task context */}
											{workspaceTasks.length > 0 && (
												<div className="absolute bottom-full left-0 mb-1 z-20">
													<div className="relative group">
														<button
															onClick={() => setShowRecentTasks(!showRecentTasks)}
															className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-[#1e2535] rounded transition-colors"
															title="Recent tasks">
															<ListTodo size={10} />
															<span>Recent Tasks</span>
														</button>
														{showRecentTasks && (
															<div className="absolute bottom-full left-0 mb-1 w-72 bg-[#1a2030] border border-[#2a3344] rounded shadow-xl overflow-hidden max-h-60 overflow-y-auto">
																<div className="p-1.5 border-b border-[#1e2535] sticky top-0 bg-[#1a2030]">
																	<span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
																		Recent Tasks ({workspaceTasks.length})
																	</span>
																</div>
																{workspaceTasks.slice(0, 20).map((t) => (
																	<button
																		key={t.id}
																		onClick={() => {
																			dispatch({
																				type: "SET_AI_INPUT",
																				payload: `Continue task: ${t.title}\n\nStatus: ${t.status}`,
																			})
																			setShowRecentTasks(false)
																			textareaRef?.current?.focus()
																		}}
																		className="block w-full text-left px-2.5 py-1.5 text-[11px] border-b border-[#1e2535]/50 last:border-0 hover:bg-[#253045] transition-colors">
																		<div className="flex items-center gap-2">
																			{t.status === "done" ? (
																				<CheckSquare
																					size={10}
																					className="text-green-400 shrink-0"
																				/>
																			) : t.status === "failed" ? (
																				<XCircle
																					size={10}
																					className="text-red-400 shrink-0"
																				/>
																			) : (
																				<Square
																					size={10}
																					className="text-yellow-400 shrink-0"
																				/>
																			)}
																			<span className="truncate text-gray-300">
																				{t.title}
																			</span>
																		</div>
																		{t.title && (
																			<div className="text-[9px] text-gray-600 mt-0.5 pl-5 truncate">
																				{t.title}
																			</div>
																		)}
																	</button>
																))}
															</div>
														)}
													</div>
												</div>
											)}
											{/* Function 3: Slash commands dropdown */}
											{showSlashCommands && (
												<div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0f1117] border border-[#1e2535] rounded shadow-xl max-h-48 overflow-y-auto z-10">
													{slashCommandsList
														.filter((sc) =>
															sc.command.startsWith(slashCommandFilter || "/"),
														)
														.map((sc) => (
															<button
																key={sc.command}
																onClick={() => {
																	dispatch({
																		type: "SET_AI_INPUT",
																		payload: sc.command + " ",
																	})
																	dispatch({
																		type: "SET_SHOW_SLASH_COMMANDS",
																		payload: false,
																	})
																	textareaRef?.current?.focus()
																}}
																className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left hover:bg-[#1e2535] transition-colors">
																<Slash size={11} className="text-violet-400 shrink-0" />
																<span className="text-violet-300 font-medium">
																	{sc.command}
																</span>
																<span className="text-gray-500 ml-1">
																	{sc.description}
																</span>
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

			{showShortcuts && (
				<KeyboardShortcutsModal onClose={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: false })} />
			)}
			{showRecordings && recordings.length > 0 && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={() => dispatch({ type: "SET_SHOW_RECORDINGS", payload: false })}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<History size={14} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Terminal Recordings</span>
							</div>
							<button
								onClick={() => dispatch({ type: "SET_SHOW_RECORDINGS", payload: false })}
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
											dispatch({ type: "SET_SHOW_RECORDINGS", payload: false })
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
					onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<Github size={16} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Import GitHub Repository</span>
							</div>
							<button
								onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}
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
					onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<FolderOpen size={16} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Open Workspace</span>
							</div>
							<button
								onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}
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
					onClick={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}>
					<div
						className="bg-[#0f1117] border border-[#1e2535] rounded-lg p-4 w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<Diff size={14} className="text-violet-400" />
								<span className="text-sm font-semibold text-[#e2e8f0]">Changes: {diffData.path}</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-[10px] text-gray-500">
									{diffData.totalChanges} change{diffData.totalChanges !== 1 ? "s" : ""}
								</span>
								<button
									onClick={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}
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
								dispatch({
									type: "SET_AI_INPUT",
									payload: `Explain this code:\n\`\`\`\n${currentFileSelection.slice(0, 2000)}\n\`\`\``,
								})
								dispatch({ type: "SET_SHOW_INLINE_AI_BUTTON", payload: false })
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
