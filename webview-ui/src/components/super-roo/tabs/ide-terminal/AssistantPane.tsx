import { useState, useRef, useEffect } from "react"
import { Send, Paperclip, Bot, User, Cpu, Code2, FileText, AlertTriangle } from "lucide-react"
import type { ChatMessage } from "../../lib/ideWorkspaceApi"

interface AssistantPaneProps {
	messages: ChatMessage[]
	onSendMessage: (content: string) => void
}

const MODE_BUTTONS = [
	{ id: "auto", label: "Auto", color: "text-vscode-terminal-ansiCyan" },
	{ id: "plan", label: "Plan", color: "text-vscode-terminal-ansiBlue" },
	{ id: "code", label: "Code", color: "text-vscode-terminal-ansiGreen" },
	{ id: "debug", label: "Debug", color: "text-vscode-terminal-ansiYellow" },
	{ id: "review", label: "Review", color: "text-vscode-terminal-ansiMagenta" },
	{ id: "crawl", label: "Crawl", color: "text-vscode-terminal-ansiRed" },
] as const

const CONTEXT_PILLS = [
	{ id: "files", label: "Files", icon: FileText },
	{ id: "logs", label: "Logs", icon: AlertTriangle },
	{ id: "tests", label: "Tests", icon: Code2 },
	{ id: "diff", label: "Diff", icon: Code2 },
	{ id: "memory", label: "Memory", icon: Cpu },
] as const

function MessageIcon({ role, author }: { role: string; author: string }) {
	if (role === "user") return <User size={14} className="text-vscode-terminal-ansiBlue" />
	if (role === "agent") return <Bot size={14} className="text-vscode-terminal-ansiGreen" />
	return <Bot size={14} className="text-vscode-terminal-ansiCyan" />
}

function AttachmentBadge({ filename, type }: { filename: string; type: string }) {
	return (
		<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-vscode-sideBar-background text-[10px] text-vscode-descriptionForeground border border-vscode-panel-border">
			<Paperclip size={10} />
			{filename}
		</span>
	)
}

export function AssistantPane({ messages, onSendMessage }: AssistantPaneProps) {
	const [input, setInput] = useState("")
	const [activeMode, setActiveMode] = useState("auto")
	const [activeContextPills, setActiveContextPills] = useState<Set<string>>(new Set(["files", "logs"]))
	const messagesEndRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages])

	function toggleContextPill(id: string) {
		setActiveContextPills((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	function handleSend() {
		if (!input.trim()) return
		onSendMessage(input.trim())
		setInput("")
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	return (
		<div className="flex flex-col h-full bg-vscode-sideBar-background rounded-lg border border-vscode-panel-border overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-vscode-panel-border shrink-0">
				<div className="flex items-center gap-2">
					<Bot size={16} className="text-vscode-terminal-ansiCyan" />
					<span className="text-xs font-semibold text-vscode-foreground">AI Assistant</span>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-vscode-descriptionForeground">
					<span className="text-vscode-terminal-ansiCyan">Kimi</span>
					<span>·</span>
					<span className="text-vscode-terminal-ansiYellow">approval</span>
					<span>·</span>
					<span className="text-vscode-terminal-ansiGreen">routed</span>
				</div>
			</div>

			{/* Mode buttons */}
			<div className="flex gap-1 px-3 py-1.5 border-b border-vscode-panel-border shrink-0 overflow-x-auto">
				{MODE_BUTTONS.map((m) => (
					<button
						key={m.id}
						onClick={() => setActiveMode(m.id)}
						className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
							activeMode === m.id
								? `${m.color} bg-vscode-sideBar-background border border-vscode-panel-border`
								: "text-vscode-descriptionForeground hover:text-vscode-foreground"
						}`}>
						{m.label}
					</button>
				))}
			</div>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto">
				{messages.length === 0 ? (
					<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground p-4 text-center">
						Ask the AI assistant anything about your workspace.
					</div>
				) : (
					<div className="space-y-2 p-3">
						{messages.map((msg) => (
							<div
								key={msg.id}
								className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
								<div
									className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
										msg.role === "user"
											? "bg-vscode-button-background text-vscode-button-foreground"
											: "bg-vscode-editor-background text-vscode-foreground border border-vscode-panel-border"
									}`}>
									<div className="flex items-center gap-1.5 mb-1">
										<MessageIcon role={msg.role} author={msg.author} />
										<span className="font-medium text-[10px]">{msg.author}</span>
										{msg.meta && (
											<span className="text-[9px] text-vscode-descriptionForeground">
												{msg.meta}
											</span>
										)}
										<span className="ml-auto text-[9px] text-vscode-descriptionForeground">
											{msg.time}
										</span>
									</div>
									<p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
									{msg.attachments && msg.attachments.length > 0 && (
										<div className="flex flex-wrap gap-1 mt-1.5">
											{msg.attachments.map((a) => (
												<AttachmentBadge key={a.id} filename={a.filename} type={a.type} />
											))}
										</div>
									)}
								</div>
							</div>
						))}
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* Context pills */}
			<div className="flex gap-1 px-3 py-1 border-t border-vscode-panel-border shrink-0 overflow-x-auto">
				{CONTEXT_PILLS.map((p) => {
					const Icon = p.icon
					const isActive = activeContextPills.has(p.id)
					return (
						<button
							key={p.id}
							onClick={() => toggleContextPill(p.id)}
							className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
								isActive
									? "bg-vscode-button-background text-vscode-button-foreground"
									: "text-vscode-descriptionForeground hover:text-vscode-foreground border border-vscode-panel-border"
							}`}>
							<Icon size={10} />
							{p.label}
						</button>
					)
				})}
			</div>

			{/* Chat input */}
			<div className="flex items-end gap-2 px-3 py-2 border-t border-vscode-panel-border bg-vscode-editor-background shrink-0">
				<button className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground">
					<Paperclip size={14} />
				</button>
				<div className="flex-1 relative">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask the AI assistant..."
						rows={2}
						className="w-full bg-vscode-input-background border border-vscode-panel-border rounded-lg px-3 py-1.5 text-xs text-vscode-input-foreground placeholder-vscode-input-placeholder resize-none outline-none"
					/>
				</div>
				<button
					onClick={handleSend}
					disabled={!input.trim()}
					className="p-1.5 rounded-lg bg-vscode-button-background text-vscode-button-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
					<Send size={14} />
				</button>
			</div>
		</div>
	)
}
