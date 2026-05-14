"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Terminal, Copy, Trash2, Play, Square, Mic, MonitorUp, ChevronRight, ChevronDown } from "lucide-react"
import type { OutputBlock, TerminalRecording } from "@/lib/ide-store"

interface TerminalPanelProps {
	outputBlocks: OutputBlock[]
	terminalMode: string
	terminalInput: string
	onTerminalInputChange: (value: string) => void
	onTerminalCommand: () => void
	onTerminalKeyDown: (e: React.KeyboardEvent) => void
	onCopyTerminal: (index: number, content: string) => void
	onToggleBlockCollapse: (id: string) => void
	onClearTerminal: () => void
	isRecording: boolean
	recordings: TerminalRecording[]
	onStartRecording: () => void
	onStopRecording: () => void
	onShowRecordings: () => void
	agentSuggestions: string[]
	smartSuggestions: { label: string; command: string }[]
	onSuggestionClick: (command: string) => void
	terminalRef: React.RefObject<HTMLDivElement | null>
	terminalInputRef: React.RefObject<HTMLInputElement | null>
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

function parseOutputLine(line: string, index: number): OutputBlock {
	const trimmed = line.trim()
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
			return "text-[#f85149]"
		case "warning":
			return "text-[#d29922]"
		case "success":
			return "text-[#3fb950]"
		default:
			return "text-[#8b949e]"
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
	isRecording,
	recordings,
	onStartRecording,
	onStopRecording,
	onShowRecordings,
	agentSuggestions,
	smartSuggestions,
	onSuggestionClick,
	terminalRef,
	terminalInputRef,
}: TerminalPanelProps) {
	const [showSuggestions, setShowSuggestions] = useState(false)
	const [filteredCommands, setFilteredCommands] = useState<string[]>([])

	useEffect(() => {
		if (terminalInput.trim()) {
			const filtered = COMMON_COMMANDS.filter((c) => c.toLowerCase().includes(terminalInput.toLowerCase()))
			setFilteredCommands(filtered)
			setShowSuggestions(filtered.length > 0)
		} else {
			setShowSuggestions(false)
		}
	}, [terminalInput])

	return (
		<div
			ref={terminalRef as React.RefObject<HTMLDivElement>}
			className="flex flex-col bg-[#0d1117] rounded border border-[#1e2535] overflow-hidden">
			{/* Terminal header */}
			<div className="flex items-center justify-between px-2 py-1 bg-[#161b22] border-b border-[#1e2535] shrink-0">
				<div className="flex items-center gap-1.5">
					<Terminal className="w-3.5 h-3.5 text-[#8b949e]" />
					<span className="text-[11px] text-[#8b949e] font-medium">
						{terminalMode === "agent" ? "Agent Terminal" : "Terminal"}
					</span>
					{isRecording && (
						<span className="flex items-center gap-1 text-[10px] text-[#f85149]">
							<span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
							REC
						</span>
					)}
				</div>
				<div className="flex items-center gap-0.5">
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

			{/* Terminal output */}
			<div className="flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed min-h-[100px] max-h-[300px]">
				{outputBlocks.length === 0 ? (
					<div className="text-[#484f58] text-center py-8">
						<Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
						<p className="text-[11px]">Type a command to start</p>
					</div>
				) : (
					outputBlocks.map((block, idx) => (
						<div key={block.id || idx} className="group">
							<div className="flex items-start gap-1">
								<button
									className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
									onClick={() => onToggleBlockCollapse(block.id)}>
									{block.collapsed ? (
										<ChevronRight className="w-3 h-3 text-[#484f58]" />
									) : (
										<ChevronDown className="w-3 h-3 text-[#484f58]" />
									)}
								</button>
								<div
									className={`flex-1 ${block.collapsed ? "line-clamp-1" : ""} ${getStatusColor(block.type)}`}>
									{block.content}
								</div>
								<button
									className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
									onClick={() => onCopyTerminal(idx, block.content)}
									title="Copy">
									<Copy className="w-3 h-3 text-[#484f58] hover:text-[#8b949e]" />
								</button>
							</div>
						</div>
					))
				)}
			</div>

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
