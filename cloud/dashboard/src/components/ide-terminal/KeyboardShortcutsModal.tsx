"use client"

import {
	X,
	Search,
	Terminal,
	Save,
	GitBranch,
	Code,
	FileText,
	Zap,
	SplitSquareHorizontal,
	Bookmark,
	Share2,
	Bell,
	Cpu,
	Upload,
	Slash,
} from "lucide-react"

interface KeyboardShortcutsModalProps {
	onClose: () => void
}

const SHORTCUTS = [
	{ key: "Ctrl+S", desc: "Save current file", icon: Save },
	{ key: "Ctrl+F", desc: "Search in workspace", icon: Search },
	{ key: "Ctrl+`", desc: "Toggle terminal", icon: Terminal },
	{ key: "Ctrl+B", desc: "Toggle file panel", icon: FileText },
	{ key: "Ctrl+Shift+P", desc: "Toggle AI panel", icon: Code },
	{ key: "Ctrl+G", desc: "Toggle Git panel", icon: GitBranch },
	{ key: "Ctrl+Enter", desc: "Send AI message", icon: Zap },
	{ key: "Escape", desc: "Close modals / panels", icon: X },
	{ key: "Ctrl+Shift+F", desc: "Format code", icon: Code },
	{ key: "Ctrl+Shift+E", desc: "Focus file explorer", icon: FileText },
	// Terminal improvements
	{ key: "Ctrl+Shift+5", desc: "Split terminal horizontally", icon: SplitSquareHorizontal },
	{ key: "Ctrl+Shift+6", desc: "Split terminal vertically", icon: SplitSquareHorizontal },
	{ key: "Ctrl+Shift+B", desc: "Toggle command snippets panel", icon: Bookmark },
	{ key: "Ctrl+Shift+S", desc: "Share terminal session", icon: Share2 },
	{ key: "Ctrl+Shift+N", desc: "Dismiss terminal notification", icon: Bell },
	{ key: "Ctrl+Shift+M", desc: "Toggle resource monitor", icon: Cpu },
	{ key: "Ctrl+Shift+U", desc: "Upload file to terminal", icon: Upload },
	{ key: "Ctrl+Shift+/", desc: "Toggle slash commands menu", icon: Slash },
]

export default function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}>
			<div className="bg-[#0f1117] border border-[#1e2535] rounded-lg shadow-2xl w-[420px] max-h-[80vh] overflow-y-auto">
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2535]">
					<h2 className="text-[13px] font-medium text-[#e6edf3]">Keyboard Shortcuts</h2>
					<button
						className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
						onClick={onClose}>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="p-3 space-y-1">
					{SHORTCUTS.map((s, i) => {
						const Icon = s.icon
						return (
							<div
								key={i}
								className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#1e2535] transition-colors">
								<div className="flex items-center gap-2">
									<Icon className="w-3.5 h-3.5 text-[#8b949e]" />
									<span className="text-[12px] text-[#e6edf3]">{s.desc}</span>
								</div>
								<kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[#8b949e] bg-[#161b22] border border-[#1e2535] rounded">
									{s.key}
								</kbd>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
