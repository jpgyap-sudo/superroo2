"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
	Terminal,
	Copy,
	Trash2,
	Play,
	Square,
	Mic,
	MonitorUp,
	ChevronRight,
	ChevronDown,
	ChevronUp,
	Search,
	X,
	Bookmark,
	Share2,
	Cpu,
	HardDrive,
	Upload,
	BookmarkPlus,
	List,
	SplitSquareHorizontal,
	SplitSquareVertical,
	Users,
	Bell,
	BellOff,
	ExternalLink,
	Check,
	Plus,
} from "lucide-react"
import type {
	OutputBlock,
	TerminalRecording,
	CommandSnippet,
	SharedTerminalSession,
	TerminalResourceUsage,
	SplitTerminalTab,
} from "@/lib/ide-store"

interface TerminalPanelProps {
	// Core
	outputBlocks: OutputBlock[]
	terminalMode: string
	terminalInput: string
	onTerminalInputChange: (value: string) => void
	onTerminalCommand: () => void
	onTerminalKeyDown: (e: React.KeyboardEvent) => void
	onCopyTerminal: (index: number, content: string) => void
	onToggleBlockCollapse: (id: string) => void
	onClearTerminal: () => void
	terminalRef: React.RefObject<HTMLDivElement | null>
	terminalInputRef: React.RefObject<HTMLInputElement | null>

	// Recording
	isRecording: boolean
	recordings: TerminalRecording[]
	onStartRecording: () => void
	onStopRecording: () => void
	onShowRecordings: () => void

	// Suggestions
	agentSuggestions: string[]
	smartSuggestions: { label: string; command: string }[]
	onSuggestionClick: (command: string) => void

	// PTY / Connection
	ptyConnected?: boolean
	ptySessionId?: string | null
	ptyShell?: string | null
	ptyCwd?: string | null

	// #6: Search
	terminalSearchQuery?: string
	terminalSearchResults?: number[]
	terminalSearchActiveIndex?: number
	onTerminalSearch?: (query: string) => void
	onTerminalSearchNext?: () => void
	onTerminalSearchPrev?: () => void

	// #4: Split Terminal
	splitTerminals?: SplitTerminalTab[]
	activeSplitTerminal?: string | null
	onAddSplitTerminal?: (orientation: "horizontal" | "vertical") => void
	onRemoveSplitTerminal?: (id: string) => void
	onSetActiveSplitTerminal?: (id: string) => void

	// #10: Snippets
	snippets?: CommandSnippet[]
	showSnippetsPanel?: boolean
	onAddSnippet?: (name: string, command: string) => void
	onRemoveSnippet?: (id: string) => void
	onToggleSnippetsPanel?: () => void

	// #11: Sharing
	showShareDialog?: boolean
	onToggleShareDialog?: () => void
	onShareSession?: (targetSessionId: string) => void

	// #12: Resource Usage
	resourceUsage?: TerminalResourceUsage | null

	// #9: Notifications
	notifications?: { id: string; message: string; type: string }[]
	onDismissNotification?: (id: string) => void

	// Theme
	terminalTheme?: "dark" | "light" | "high-contrast"
	terminalFontSize?: number

	// Inline Error Fixes
	fixableErrors?: Map<
		string,
		{ lineIndex: number; lineText: string; errorType: string; fixSuggestion: string | null }[]
	>
	onTriggerInlineFix?: (blockId: string, errorText: string) => void
}

const COMMON_COMMANDS = [
	"npm run dev",
	"npm run build",
	"npm test",
	"git status",
	"git log --oneline -10",
	"ls -la",
	"pwd",
	"node --version",
	"npm --version",
	"docker ps",
	"pm2 status",
	"curl -s http://localhost:3001/api/health",
]

// Gap #15: ANSI escape code regex — matches color codes, cursor movements, clear sequences
const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

// Gap #15: ANSI color name map for CSS class generation
const ANSI_COLOR_NAMES: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "bright-black",
	91: "bright-red",
	92: "bright-green",
	93: "bright-yellow",
	94: "bright-blue",
	95: "bright-magenta",
	96: "bright-cyan",
	97: "bright-white",
}

// Gap #15: Strip ANSI codes from a string, returning plain text
function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "")
}

// Gap #15: Parse ANSI codes into React nodes with inline styling
function renderAnsiText(text: string, key: number): React.ReactNode {
	interface AnsiSegment {
		text: string
		fg?: string
		bg?: string
		bold?: boolean
		dim?: boolean
		italic?: boolean
		underline?: boolean
	}
	const segments: AnsiSegment[] = []
	let current: AnsiSegment = { text: "" }
	let i = 0

	while (i < text.length) {
		ANSI_PATTERN.lastIndex = i
		const match = ANSI_PATTERN.exec(text)
		if (!match) {
			current.text += text.slice(i)
			break
		}
		if (match.index > i) {
			current.text += text.slice(i, match.index)
		}
		// Flush current segment before processing code
		if (current.text) {
			segments.push({ ...current })
			current = { text: "" }
		}
		const code = match[0]
		i = match.index + code.length

		// Parse CSI sequences like \x1b[31m, \x1b[1;31m, \x1b[0m
		const csiMatch = code.match(/^[\u001b\u009b]\[([0-9;]*)m$/)
		if (csiMatch) {
			const params = csiMatch[1] ? csiMatch[1].split(";") : ["0"]
			for (const param of params) {
				const n = parseInt(param, 10)
				if (n === 0) {
					current = { text: "" } // reset
				} else if (n === 1) {
					current.bold = true
				} else if (n === 2) {
					current.dim = true
				} else if (n === 3) {
					current.italic = true
				} else if (n === 4) {
					current.underline = true
				} else if (n >= 30 && n <= 37) {
					current.fg = ANSI_COLOR_NAMES[n]
				} else if (n >= 90 && n <= 97) {
					current.fg = ANSI_COLOR_NAMES[n]
				} else if (n >= 40 && n <= 47) {
					current.bg = ANSI_COLOR_NAMES[n - 10]
				} else if (n >= 100 && n <= 107) {
					current.bg = ANSI_COLOR_NAMES[n - 10]
				}
			}
		}
		// Non-SGR sequences (cursor movement, clear screen) are simply stripped
	}
	if (current.text) {
		segments.push({ ...current })
	}

	if (segments.length === 0) return <span key={key}>{text}</span>
	if (
		segments.length === 1 &&
		!segments[0].fg &&
		!segments[0].bg &&
		!segments[0].bold &&
		!segments[0].italic &&
		!segments[0].underline
	) {
		return <span key={key}>{segments[0].text}</span>
	}

	return (
		<span key={key}>
			{segments.map((seg, si) => {
				const style: React.CSSProperties = {}
				if (seg.fg) style.color = `var(--ansi-${seg.fg})`
				if (seg.bg) style.backgroundColor = `var(--ansi-${seg.bg})`
				if (seg.bold) style.fontWeight = "bold"
				if (seg.dim) style.opacity = 0.7
				if (seg.italic) style.fontStyle = "italic"
				if (seg.underline) style.textDecoration = "underline"
				return (
					<span key={si} style={style}>
						{seg.text}
					</span>
				)
			})}
		</span>
	)
}

function parseOutputLine(line: string, index: number): OutputBlock {
	const trimmed = stripAnsi(line).trim()
	const ts = new Date().toISOString()
	if (/error|failed|exception|traceback|errno/i.test(trimmed)) {
		return { id: `block-${index}`, type: "error", content: line, timestamp: ts, collapsed: false }
	}
	if (/warning|warn/i.test(trimmed)) {
		return { id: `block-${index}`, type: "warning", content: line, timestamp: ts, collapsed: false }
	}
	if (/^(\[[0-9:.]+\]|✓|✔|success|done|compiled)/i.test(trimmed)) {
		return { id: `block-${index}`, type: "success", content: line, timestamp: ts, collapsed: false }
	}
	return { id: `block-${index}`, type: "info", content: line, timestamp: ts, collapsed: false }
}

function getStatusColor(type: string): string {
	switch (type) {
		case "error":
			return "text-[var(--terminal-error)]"
		case "warning":
			return "text-[var(--terminal-warning)]"
		case "success":
			return "text-[var(--terminal-success)]"
		default:
			return "text-[var(--terminal-text-secondary)]"
	}
}

export default function TerminalPanel({
	outputBlocks,
	terminalMode,
	terminalInput,
	onTerminalInputChange,
	onTerminalCommand,
	onTerminalKeyDown,
	onCopyTerminal,
	onToggleBlockCollapse,
	onClearTerminal,
	terminalRef,
	terminalInputRef,
	isRecording,
	recordings,
	onStartRecording,
	onStopRecording,
	onShowRecordings,
	agentSuggestions,
	smartSuggestions,
	onSuggestionClick,
	ptyConnected,
	ptySessionId,
	ptyShell,
	ptyCwd,
	terminalSearchQuery = "",
	terminalSearchResults,
	terminalSearchActiveIndex,
	onTerminalSearch,
	onTerminalSearchNext,
	onTerminalSearchPrev,
	splitTerminals,
	activeSplitTerminal,
	onAddSplitTerminal,
	onRemoveSplitTerminal,
	onSetActiveSplitTerminal,
	snippets,
	showSnippetsPanel,
	onAddSnippet,
	onRemoveSnippet,
	onToggleSnippetsPanel,
	showShareDialog,
	onToggleShareDialog,
	onShareSession,
	resourceUsage,
	notifications,
	onDismissNotification,
	terminalTheme = "dark",
	terminalFontSize = 12,
	fixableErrors,
	onTriggerInlineFix,
}: TerminalPanelProps) {
	const [showSuggestions, setShowSuggestions] = useState(false)
	const [filteredCommands, setFilteredCommands] = useState<string[]>([])
	const [showSearch, setShowSearch] = useState(false)
	const [searchLocalQuery, setSearchLocalQuery] = useState("")
	const [dragOver, setDragOver] = useState(false)
	const [showSnippetInput, setShowSnippetInput] = useState(false)
	const [snippetName, setSnippetName] = useState("")
	const [snippetCommand, setSnippetCommand] = useState("")
	const [shareSessionIdInput, setShareSessionIdInput] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	// Gap #12: Virtualization — track visible range
	const VIRTUAL_OVERSCAN = 10
	const ITEM_HEIGHT = 22 // approximate px per output block row
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const [scrollTop, setScrollTop] = useState(0)
	const [containerHeight, setContainerHeight] = useState(300)
	const visibleBlockCount = useMemo(() => {
		return Math.ceil(containerHeight / ITEM_HEIGHT) + VIRTUAL_OVERSCAN * 2
	}, [containerHeight])
	const totalHeight = useMemo(() => outputBlocks.length * ITEM_HEIGHT, [outputBlocks.length])
	const startIndex = useMemo(() => {
		return Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VIRTUAL_OVERSCAN)
	}, [scrollTop])
	const endIndex = useMemo(() => {
		return Math.min(outputBlocks.length, startIndex + visibleBlockCount)
	}, [startIndex, visibleBlockCount, outputBlocks.length])
	const visibleBlocks = useMemo(() => outputBlocks.slice(startIndex, endIndex), [outputBlocks, startIndex, endIndex])

	const handleVirtualScroll = useCallback(
		(e: React.UIEvent<HTMLDivElement>) => {
			const el = e.currentTarget
			setScrollTop(el.scrollTop)
			if (containerHeight !== el.clientHeight) {
				setContainerHeight(el.clientHeight)
			}
		},
		[containerHeight],
	)

	// Observe container resize for virtualization
	useEffect(() => {
		const el = scrollContainerRef.current
		if (!el) return
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setContainerHeight(entry.contentRect.height)
			}
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	// Filter common commands
	useEffect(() => {
		if (terminalInput.trim()) {
			const filtered = COMMON_COMMANDS.filter((c) => c.toLowerCase().includes(terminalInput.toLowerCase()))
			setFilteredCommands(filtered)
			setShowSuggestions(filtered.length > 0)
		} else {
			setShowSuggestions(false)
		}
	}, [terminalInput])

	// Focus search input when opened
	useEffect(() => {
		if (showSearch && searchInputRef.current) {
			searchInputRef.current.focus()
		}
	}, [showSearch])

	// Drag-and-drop handlers
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setDragOver(true)
	}, [])

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setDragOver(false)
	}, [])

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setDragOver(false)
			const files = Array.from(e.dataTransfer.files)
			if (files.length > 0) {
				const filePaths = files.map((f) => f.name).join(" ")
				onTerminalInputChange(filePaths)
			}
		},
		[onTerminalInputChange],
	)

	// Search handler
	const handleSearchChange = useCallback(
		(val: string) => {
			setSearchLocalQuery(val)
			onTerminalSearch?.(val)
		},
		[onTerminalSearch],
	)

	// Snippet save
	const handleSaveSnippet = useCallback(() => {
		if (snippetName.trim() && snippetCommand.trim()) {
			onAddSnippet?.(snippetName.trim(), snippetCommand.trim())
			setSnippetName("")
			setSnippetCommand("")
			setShowSnippetInput(false)
		}
	}, [snippetName, snippetCommand, onAddSnippet])

	// Share
	const handleShare = useCallback(() => {
		if (shareSessionIdInput.trim()) {
			onShareSession?.(shareSessionIdInput.trim())
			setShareSessionIdInput("")
		}
	}, [shareSessionIdInput, onShareSession])

	// Resource usage bar color
	const getResourceBarColor = (pct: number): string => {
		if (pct > 80) return "bg-[#f85149]"
		if (pct > 50) return "bg-[#d29922]"
		return "bg-[#3fb950]"
	}

	return (
		<div
			ref={terminalRef as React.RefObject<HTMLDivElement>}
			className={`theme-${terminalTheme} flex flex-col bg-[var(--terminal-bg)] rounded border border-[var(--terminal-border)] overflow-hidden transition-all ${
				dragOver ? "border-[var(--terminal-accent)] border-2" : ""
			}`}
			style={{ fontSize: terminalFontSize }}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}>
			{/* Drag overlay */}
			{dragOver && (
				<div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0d1117]/80 pointer-events-none">
					<div className="flex flex-col items-center gap-2 text-[#58a6ff]">
						<Upload className="w-8 h-8" />
						<span className="text-xs font-medium">Drop files to upload to terminal</span>
					</div>
				</div>
			)}

			{/* Terminal header */}
			<div className="flex items-center justify-between px-2 py-1 bg-[#161b22] border-b border-[#1e2535] shrink-0">
				<div className="flex items-center gap-1.5">
					<Terminal className="w-3.5 h-3.5 text-[#8b949e]" />
					<span className="text-[11px] text-[#8b949e] font-medium">
						{terminalMode === "agent" ? "Agent Terminal" : "Terminal"}
					</span>
					{/* PTY connection indicator */}
					{ptyConnected && (
						<span className="flex items-center gap-1 text-[10px] text-[#3fb950]">
							<span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
							PTY
						</span>
					)}
					{ptyShell && <span className="text-[10px] text-[#8b949e]">{ptyShell}</span>}
					{ptyCwd && (
						<span className="max-w-[220px] truncate text-[10px] text-[#6e7681]" title={ptyCwd}>
							{ptyCwd}
						</span>
					)}
					{isRecording && (
						<span className="flex items-center gap-1 text-[10px] text-[#f85149]">
							<span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
							REC
						</span>
					)}
				</div>
				<div className="flex items-center gap-0.5">
					{/* #6: Search toggle */}
					<button
						className={`p-1 rounded hover:bg-[#1e2535] transition-colors ${
							showSearch ? "text-[#58a6ff] bg-[#1e2535]" : "text-[#8b949e] hover:text-[#e6edf3]"
						}`}
						onClick={() => setShowSearch(!showSearch)}
						title="Search terminal output">
						<Search className="w-3 h-3" />
					</button>

					{/* #10: Snippets toggle */}
					<button
						className={`p-1 rounded hover:bg-[#1e2535] transition-colors ${
							showSnippetsPanel ? "text-[#58a6ff] bg-[#1e2535]" : "text-[#8b949e] hover:text-[#e6edf3]"
						}`}
						onClick={onToggleSnippetsPanel}
						title="Command snippets">
						<Bookmark className="w-3 h-3" />
					</button>

					{/* #11: Share toggle */}
					<button
						className={`p-1 rounded hover:bg-[#1e2535] transition-colors ${
							showShareDialog ? "text-[#58a6ff] bg-[#1e2535]" : "text-[#8b949e] hover:text-[#e6edf3]"
						}`}
						onClick={onToggleShareDialog}
						title="Share terminal session">
						<Share2 className="w-3 h-3" />
					</button>

					{/* #4: Split terminal */}
					{onAddSplitTerminal && (
						<>
							<button
								className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
								onClick={() => onAddSplitTerminal("horizontal")}
								title="Split terminal horizontally">
								<SplitSquareHorizontal className="w-3 h-3" />
							</button>
							<button
								className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
								onClick={() => onAddSplitTerminal("vertical")}
								title="Split terminal vertically">
								<SplitSquareVertical className="w-3 h-3" />
							</button>
						</>
					)}

					<button
						className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
						onClick={isRecording ? onStopRecording : onStartRecording}
						title={isRecording ? "Stop recording" : "Start recording"}>
						<Mic className="w-3 h-3" />
					</button>
					<button
						className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
						onClick={onShowRecordings}
						title="Show recordings">
						<MonitorUp className="w-3 h-3" />
					</button>
					<button
						className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
						onClick={onClearTerminal}
						title="Clear terminal">
						<Trash2 className="w-3 h-3" />
					</button>
				</div>
			</div>

			{/* #6: Search bar */}
			{showSearch && (
				<div className="flex items-center gap-1 px-2 py-1 bg-[#161b22] border-b border-[#1e2535]">
					<Search className="w-3 h-3 text-[#8b949e] shrink-0" />
					<input
						ref={searchInputRef}
						type="text"
						className="flex-1 bg-transparent text-[11px] text-[#e6edf3] outline-none placeholder:text-[#484f58]"
						placeholder="Search output..."
						value={searchLocalQuery}
						onChange={(e) => handleSearchChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.shiftKey ? onTerminalSearchPrev?.() : onTerminalSearchNext?.()
							}
							if (e.key === "Escape") {
								setShowSearch(false)
								setSearchLocalQuery("")
								onTerminalSearch?.("")
							}
						}}
					/>
					{terminalSearchResults && terminalSearchResults.length > 0 && (
						<span className="text-[10px] text-[#8b949e] shrink-0">
							{(terminalSearchActiveIndex ?? 0) + 1}/{terminalSearchResults.length}
						</span>
					)}
					{searchLocalQuery && (
						<>
							<button
								className="p-0.5 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
								onClick={onTerminalSearchPrev}
								title="Previous match">
								<ChevronUp className="w-3 h-3" />
							</button>
							<button
								className="p-0.5 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
								onClick={onTerminalSearchNext}
								title="Next match">
								<ChevronDown className="w-3 h-3" />
							</button>
						</>
					)}
					<button
						className="p-0.5 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
						onClick={() => {
							setShowSearch(false)
							setSearchLocalQuery("")
							onTerminalSearch?.("")
						}}>
						<X className="w-3 h-3" />
					</button>
				</div>
			)}

			{/* #12: Resource usage bar */}
			{resourceUsage && (
				<div className="flex items-center gap-2 px-2 py-0.5 bg-[#161b22] border-b border-[#1e2535]">
					<div className="flex items-center gap-1">
						<Cpu className="w-2.5 h-2.5 text-[#8b949e]" />
						<div className="w-16 h-1.5 bg-[#1e2535] rounded-full overflow-hidden">
							<div
								className={`h-full ${getResourceBarColor(resourceUsage.cpu)} transition-all duration-1000`}
								style={{ width: `${Math.min(resourceUsage.cpu, 100)}%` }}
							/>
						</div>
						<span className="text-[9px] text-[#8b949e]">{resourceUsage.cpu.toFixed(0)}%</span>
					</div>
					<div className="flex items-center gap-1">
						<HardDrive className="w-2.5 h-2.5 text-[#8b949e]" />
						<div className="w-16 h-1.5 bg-[#1e2535] rounded-full overflow-hidden">
							<div
								className={`h-full ${getResourceBarColor(resourceUsage.memory)} transition-all duration-1000`}
								style={{ width: `${Math.min(resourceUsage.memory, 100)}%` }}
							/>
						</div>
						<span className="text-[9px] text-[#8b949e]">{resourceUsage.memory.toFixed(0)}%</span>
					</div>
					<span className="text-[9px] text-[#484f58] ml-auto">Uptime: {resourceUsage.uptime || "N/A"}</span>
				</div>
			)}

			{/* #9: Notifications */}
			{notifications && notifications.length > 0 && (
				<div className="px-2 py-1 bg-[#161b22] border-b border-[#1e2535] space-y-0.5">
					{notifications.map((n) => (
						<div
							key={n.id}
							className={`flex items-center justify-between px-1.5 py-0.5 rounded text-[10px] ${
								n.type === "error"
									? "bg-[#f8514911] text-[#f85149]"
									: n.type === "warning"
										? "bg-[#d2992211] text-[#d29922]"
										: "bg-[#3fb95011] text-[#3fb950]"
							}`}>
							<span>{n.message}</span>
							<button
								className="p-0.5 hover:bg-[#1e2535] rounded"
								onClick={() => onDismissNotification?.(n.id)}>
								<X className="w-2.5 h-2.5" />
							</button>
						</div>
					))}
				</div>
			)}

			{/* #4: Split terminal tabs */}
			{splitTerminals && splitTerminals.length > 0 && (
				<div className="flex items-center gap-0.5 px-1 py-0.5 bg-[#161b22] border-b border-[#1e2535] overflow-x-auto">
					{splitTerminals.map((tab) => (
						<div
							key={tab.sessionId}
							className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
								activeSplitTerminal === tab.sessionId
									? "bg-[#1e2535] text-[#e6edf3]"
									: "text-[#8b949e] hover:bg-[#1e2535]"
							}`}
							onClick={() => onSetActiveSplitTerminal?.(tab.sessionId)}>
							<Terminal className="w-2.5 h-2.5" />
							<span className="truncate max-w-[80px]">{tab.name}</span>
							<button
								className="p-0.5 hover:bg-[#30363d] rounded"
								onClick={(e) => {
									e.stopPropagation()
									onRemoveSplitTerminal?.(tab.sessionId)
								}}>
								<X className="w-2 h-2" />
							</button>
						</div>
					))}
				</div>
			)}

			{/* Terminal output — Gap #12: Virtualized rendering, Gap #15: ANSI color support */}
			<div
				ref={scrollContainerRef}
				className="flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed min-h-[100px] max-h-[300px]"
				onScroll={handleVirtualScroll}>
				{outputBlocks.length === 0 ? (
					<div className="text-[#484f58] text-center py-8">
						<Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
						<p className="text-[11px]">Type a command to start</p>
					</div>
				) : (
					<div style={{ height: totalHeight, position: "relative" }}>
						{visibleBlocks.map((block, vi) => {
							const realIdx = startIndex + vi
							const isSearchMatch = terminalSearchQuery
								? block.content.toLowerCase().includes(terminalSearchQuery.toLowerCase())
								: false
							const isSearchActive =
								terminalSearchActiveIndex !== undefined &&
								terminalSearchResults?.[terminalSearchActiveIndex] === realIdx

							return (
								<div
									key={block.id || realIdx}
									style={{
										position: "absolute",
										top: realIdx * ITEM_HEIGHT,
										left: 0,
										right: 0,
										height: ITEM_HEIGHT,
									}}
									className={`group ${
										isSearchMatch ? "ring-1 ring-[#58a6ff]/30 rounded" : ""
									} ${isSearchActive ? "bg-[#58a6ff]/10" : ""}`}>
									<div className="flex items-start gap-1">
										<button
											className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
											onClick={() => onToggleBlockCollapse(block.id)}>
											{block.collapsed ? (
												<ChevronRight className="w-3 h-3 text-[#484f58]" />
											) : (
												<ChevronDown className="w-3 h-3 text-[#484f58]" />
											)}
										</button>
										<div
											className={`flex-1 truncate ${block.collapsed ? "line-clamp-1" : ""} ${getStatusColor(block.type)}`}>
											{/* Gap #15: Render ANSI-colored text */}
											{renderAnsiText(block.content, 0)}
											{fixableErrors?.has(block.id) && !block.collapsed && (
												<div className="flex flex-wrap gap-1 mt-1">
													{fixableErrors.get(block.id)?.map((err, errIdx) => (
														<button
															key={errIdx}
															className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)]/30 transition-colors"
															title={err.fixSuggestion || "Fix this error"}
															onClick={() =>
																onTriggerInlineFix?.(block.id, err.lineText)
															}>
															🔧 Fix {err.errorType}
														</button>
													))}
												</div>
											)}
										</div>
										<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
											{/* #10: Quick snippet */}
											<button
												className="p-0.5 hover:bg-[#1e2535] rounded"
												onClick={() => {
													setSnippetCommand(block.content)
													setShowSnippetInput(true)
												}}
												title="Save as snippet">
												<BookmarkPlus className="w-2.5 h-2.5 text-[#484f58] hover:text-[#8b949e]" />
											</button>
											<button
												className="p-0.5 hover:bg-[#1e2535] rounded"
												onClick={() => onCopyTerminal(realIdx, block.content)}
												title="Copy">
												<Copy className="w-2.5 h-2.5 text-[#484f58] hover:text-[#8b949e]" />
											</button>
										</div>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>

			{/* #10: Snippets panel */}
			{showSnippetsPanel && snippets && (
				<div className="border-t border-[#1e2535] bg-[#161b22]">
					<div className="flex items-center justify-between px-2 py-1">
						<span className="text-[10px] text-[#8b949e] font-medium">Command Snippets</span>
						<button
							className="p-0.5 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
							onClick={() => setShowSnippetInput(!showSnippetInput)}>
							<Plus className="w-2.5 h-2.5" />
						</button>
					</div>
					{showSnippetInput && (
						<div className="px-2 pb-1 space-y-1">
							<input
								type="text"
								className="w-full bg-[#0d1117] text-[10px] text-[#e6edf3] border border-[#1e2535] rounded px-1.5 py-0.5 outline-none placeholder:text-[#484f58]"
								placeholder="Snippet name..."
								value={snippetName}
								onChange={(e) => setSnippetName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSaveSnippet()
								}}
							/>
							<input
								type="text"
								className="w-full bg-[#0d1117] text-[10px] text-[#e6edf3] border border-[#1e2535] rounded px-1.5 py-0.5 outline-none placeholder:text-[#484f58]"
								placeholder="Command..."
								value={snippetCommand}
								onChange={(e) => setSnippetCommand(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSaveSnippet()
								}}
							/>
							<button
								className="px-2 py-0.5 text-[10px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors"
								onClick={handleSaveSnippet}>
								Save
							</button>
						</div>
					)}
					{snippets.length === 0 ? (
						<div className="px-2 pb-1 text-[10px] text-[#484f58]">No snippets saved</div>
					) : (
						<div className="px-2 pb-1 space-y-0.5 max-h-[100px] overflow-y-auto">
							{snippets.map((s) => (
								<div
									key={s.id}
									className="flex items-center justify-between px-1.5 py-0.5 rounded hover:bg-[#1e2535] group/snippet">
									<div className="flex items-center gap-1 min-w-0">
										<Bookmark className="w-2.5 h-2.5 text-[#58a6ff] shrink-0" />
										<span className="text-[10px] text-[#8b949e] truncate">{s.name}</span>
									</div>
									<div className="flex items-center gap-0.5 opacity-0 group-hover/snippet:opacity-100">
										<button
											className="p-0.5 hover:bg-[#30363d] rounded"
											onClick={() => {
												onTerminalInputChange(s.command)
											}}
											title="Use snippet">
											<Play className="w-2 h-2 text-[#3fb950]" />
										</button>
										<button
											className="p-0.5 hover:bg-[#30363d] rounded"
											onClick={() => onRemoveSnippet?.(s.id)}
											title="Remove snippet">
											<X className="w-2 h-2 text-[#f85149]" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* #11: Share dialog */}
			{showShareDialog && (
				<div className="border-t border-[#1e2535] bg-[#161b22] px-2 py-1.5">
					<div className="flex items-center gap-1 mb-1">
						<Users className="w-3 h-3 text-[#58a6ff]" />
						<span className="text-[10px] text-[#8b949e] font-medium">Share Terminal Session</span>
					</div>
					<div className="flex items-center gap-1">
						<input
							type="text"
							className="flex-1 bg-[#0d1117] text-[10px] text-[#e6edf3] border border-[#1e2535] rounded px-1.5 py-0.5 outline-none placeholder:text-[#484f58]"
							placeholder="Target session ID..."
							value={shareSessionIdInput}
							onChange={(e) => setShareSessionIdInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleShare()
							}}
						/>
						<button
							className="px-2 py-0.5 text-[10px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors"
							onClick={handleShare}>
							<ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />
							Share
						</button>
					</div>
				</div>
			)}

			{/* Agent suggestions */}
			{agentSuggestions.length > 0 && (
				<div className="px-2 py-1 border-t border-[#1e2535] bg-[#161b22]">
					<div className="flex flex-wrap gap-1">
						{agentSuggestions.map((s, i) => (
							<button
								key={i}
								className="px-1.5 py-0.5 text-[10px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] hover:text-[#e6edf3] transition-colors"
								onClick={() => onSuggestionClick(s)}>
								{s}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Smart suggestions */}
			{smartSuggestions.length > 0 && (
				<div className="px-2 py-1 border-t border-[#1e2535] bg-[#161b22]">
					<div className="flex flex-wrap gap-1">
						{smartSuggestions.map((s, i) => (
							<button
								key={i}
								className="px-1.5 py-0.5 text-[10px] bg-[#1f6feb22] text-[#58a6ff] rounded hover:bg-[#1f6feb44] transition-colors"
								onClick={() => onSuggestionClick(s.command)}>
								{s.label}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Command input */}
			<div className="flex items-center gap-1 px-2 py-1.5 border-t border-[#1e2535] bg-[#0d1117]">
				<span className="text-[#3fb950] text-[12px] font-mono shrink-0">$</span>
				<div className="relative flex-1">
					<input
						ref={terminalInputRef as React.RefObject<HTMLInputElement>}
						type="text"
						value={terminalInput}
						onChange={(e) => onTerminalInputChange(e.target.value)}
						onKeyDown={onTerminalKeyDown}
						placeholder="Type a command..."
						className="w-full bg-transparent border-none outline-none text-[12px] font-mono text-[#e6edf3] placeholder-[#484f58]"
					/>
					{showSuggestions && (
						<div className="absolute bottom-full left-0 mb-1 bg-[#161b22] border border-[#1e2535] rounded shadow-lg max-h-[120px] overflow-y-auto z-10 min-w-[180px]">
							{filteredCommands.map((cmd, i) => (
								<button
									key={i}
									className="w-full text-left px-2 py-1 text-[11px] font-mono text-[#8b949e] hover:bg-[#1e2535] hover:text-[#e6edf3] transition-colors"
									onClick={() => {
										onTerminalInputChange(cmd)
										setShowSuggestions(false)
									}}>
									{cmd}
								</button>
							))}
						</div>
					)}
				</div>
				<button
					className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#3fb950] transition-colors"
					onClick={onTerminalCommand}
					title="Run command">
					<Play className="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	)
}
