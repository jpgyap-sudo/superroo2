"use client"

import React, { useState, useRef, useCallback, useEffect } from "react"
import {
	Send,
	Bot,
	User,
	Loader2,
	Square,
	Paperclip,
	Image,
	CheckSquare,
	XCircle,
	Square as SquareIcon,
	ChevronRight,
	ChevronDown,
	Code,
	Play,
	FileText,
	ExternalLink,
	Sparkles,
	Zap,
	GitBranch,
	GitCommit,
	GitPullRequest,
	RefreshCw,
	Search,
	X,
} from "lucide-react"
import type { ChatMessage, ChatAttachment, WorkspaceTask } from "@/lib/ide-store"
import type { BrainTab } from "./types"

interface AiChatPanelProps {
	aiMessages: ChatMessage[]
	aiInput: string
	onAiInputChange: (value: string) => void
	onAiSend: () => void
	onAiKeyDown: (e: React.KeyboardEvent) => void
	isAiLoading: boolean
	canCancel: boolean
	onCancelAi: () => void
	aiAttachments: ChatAttachment[]
	onRemoveAttachment: (index: number) => void
	onFilesClick: () => void
	onImagesClick: () => void
	activeBrainTab: BrainTab
	onBrainTabChange: (tab: BrainTab) => void
	brainPlan: any[]
	brainFeedback: any[]
	brainErrors: any[]
	brainFixes: any[]
	brainMemory: any
	brainDeployments: any[]
	brainApprovals: any[]
	brainLoading: boolean
	workspaceTasks: WorkspaceTask[]
	proactiveSuggestions: string[]
	onSuggestionClick: (suggestion: string) => void
	onApplyCode: (code: string, language: string) => void
	onRunInTerminal: (code: string) => void
	onFileLinkClick: (path: string) => void
	aiMessagesEndRef: React.RefObject<HTMLDivElement | null>
	textareaRef: React.RefObject<HTMLTextAreaElement | null>
	slashCommandFilter: string
	onClearChat?: () => void
}

function renderMessageContent(content: string): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
	let lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = codeBlockRegex.exec(content)) !== null) {
		if (match.index > lastIndex) {
			nodes.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>)
		}
		const language = match[1] || "text"
		const code = match[2]
		nodes.push(
			<div key={`code-${match.index}`} className="my-2 rounded border border-[#1e2535] overflow-hidden">
				<div className="flex items-center justify-between px-2 py-1 bg-[#161b22] text-[10px] text-[#8b949e]">
					<span>{language}</span>
					<button
						className="flex items-center gap-1 hover:text-[#e6edf3] transition-colors"
						onClick={() => navigator.clipboard.writeText(code)}>
						<Code className="w-3 h-3" />
						Copy
					</button>
				</div>
				<pre className="p-2 text-[12px] font-mono text-[#e6edf3] bg-[#0d1117] overflow-x-auto whitespace-pre-wrap">
					{code}
				</pre>
			</div>,
		)
		lastIndex = match.index + match[0].length
	}

	if (lastIndex < content.length) {
		nodes.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex)}</span>)
	}

	return nodes
}

function renderTextWithLinks(text: string, key: number): React.ReactNode {
	const urlRegex = /(https?:\/\/[^\s<]+)/g
	const parts = text.split(urlRegex)
	return (
		<span key={key}>
			{parts.map((part, i) =>
				urlRegex.test(part) ? (
					<a
						key={i}
						href={part}
						target="_blank"
						rel="noopener noreferrer"
						className="text-[#58a6ff] hover:underline">
						{part}
					</a>
				) : (
					part
				),
			)}
		</span>
	)
}

const BRAIN_TABS: { id: BrainTab; label: string; icon: React.ReactNode }[] = [
	{ id: "plan", label: "Plan", icon: <GitBranch className="w-3.5 h-3.5" /> },
	{ id: "memory", label: "Memory", icon: <GitCommit className="w-3.5 h-3.5" /> },
	{ id: "deploy", label: "Deploy", icon: <GitPullRequest className="w-3.5 h-3.5" /> },
	{ id: "errors", label: "Errors", icon: <XCircle className="w-3.5 h-3.5" /> },
	{ id: "fixes", label: "Fixes", icon: <Zap className="w-3.5 h-3.5" /> },
	{ id: "approvals", label: "Approvals", icon: <CheckSquare className="w-3.5 h-3.5" /> },
]

export default function AiChatPanel({
	aiMessages,
	aiInput,
	onAiInputChange,
	onAiSend,
	onAiKeyDown,
	isAiLoading,
	canCancel,
	onCancelAi,
	aiAttachments,
	onRemoveAttachment,
	onFilesClick,
	onImagesClick,
	activeBrainTab,
	onBrainTabChange,
	brainPlan,
	brainFeedback,
	brainErrors,
	brainFixes,
	brainMemory,
	brainDeployments,
	brainApprovals,
	brainLoading,
	workspaceTasks,
	proactiveSuggestions,
	onSuggestionClick,
	onApplyCode,
	onRunInTerminal,
	onFileLinkClick,
	aiMessagesEndRef,
	textareaRef,
	slashCommandFilter,
	onClearChat,
}: AiChatPanelProps) {
	const [showTaskPicker, setShowTaskPicker] = useState(false)
	const [showSearch, setShowSearch] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				onAiSend()
			} else {
				onAiKeyDown(e)
			}
		},
		[onAiSend, onAiKeyDown],
	)

	const renderBrainTab = () => {
		if (brainLoading) {
			return (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="w-5 h-5 animate-spin text-[#8b949e]" />
				</div>
			)
		}

		switch (activeBrainTab) {
			case "plan":
				return (
					<div className="p-2 space-y-1">
						{brainPlan.length === 0 ? (
							<p className="text-[11px] text-[#484f58] text-center py-4">No active plan</p>
						) : (
							brainPlan.map((step: any, i: number) => (
								<div key={i} className="flex items-center gap-2 text-[11px]">
									<span
										className={`w-1.5 h-1.5 rounded-full ${
											step.status === "done"
												? "bg-[#3fb950]"
												: step.status === "running"
													? "bg-[#d29922] animate-pulse"
													: step.status === "failed"
														? "bg-[#f85149]"
														: "bg-[#30363d]"
										}`}
									/>
									<span className="text-[#8b949e]">{step.action}</span>
								</div>
							))
						)}
					</div>
				)

			case "memory":
				return (
					<div className="p-2 space-y-2">
						{brainMemory ? (
							<>
								<p className="text-[11px] text-[#8b949e]">{brainMemory.summary}</p>
								{brainMemory.commands && brainMemory.commands.length > 0 && (
									<div>
										<p className="text-[10px] text-[#484f58] mb-1">Recent commands:</p>
										{brainMemory.commands.slice(0, 10).map((cmd: string, i: number) => (
											<div key={i} className="text-[11px] font-mono text-[#58a6ff]">
												$ {cmd}
											</div>
										))}
									</div>
								)}
							</>
						) : (
							<p className="text-[11px] text-[#484f58] text-center py-4">No memory data</p>
						)}
					</div>
				)

			case "deploy":
				return (
					<div className="p-2 space-y-1">
						{brainDeployments.length === 0 ? (
							<p className="text-[11px] text-[#484f58] text-center py-4">No deployments</p>
						) : (
							brainDeployments.map((dep: any, i: number) => (
								<div
									key={i}
									className="flex items-center justify-between text-[11px] py-1 border-b border-[#1e2535] last:border-0">
									<div>
										<span className="text-[#e6edf3]">{dep.branch}</span>
										<span className="text-[#484f58] ml-2">{dep.timestamp}</span>
									</div>
									<span
										className={`px-1.5 py-0.5 rounded text-[10px] ${
											dep.status === "healthy"
												? "bg-[#3fb95022] text-[#3fb950]"
												: dep.status === "failed"
													? "bg-[#f8514922] text-[#f85149]"
													: "bg-[#d2992222] text-[#d29922]"
										}`}>
										{dep.status}
									</span>
								</div>
							))
						)}
					</div>
				)

			case "errors":
				return (
					<div className="p-2 space-y-1">
						{brainErrors.length === 0 ? (
							<p className="text-[11px] text-[#484f58] text-center py-4">No errors</p>
						) : (
							brainErrors.map((err: any, i: number) => (
								<div
									key={i}
									className="text-[11px] p-1.5 rounded bg-[#f8514911] border border-[#f8514933]">
									<span className="text-[#f85149]">
										{err.file}:{err.line}
									</span>
									<p className="text-[#8b949e]">{err.message}</p>
								</div>
							))
						)}
					</div>
				)

			case "fixes":
				return (
					<div className="p-2 space-y-1">
						{brainFixes.length === 0 ? (
							<p className="text-[11px] text-[#484f58] text-center py-4">No fixes suggested</p>
						) : (
							brainFixes.map((fix: any, i: number) => (
								<div
									key={i}
									className="text-[11px] p-1.5 rounded bg-[#3fb95011] border border-[#3fb95033]">
									<span className="text-[#3fb950]">{fix.file}</span>
									<p className="text-[#8b949e]">{fix.description}</p>
								</div>
							))
						)}
					</div>
				)

			case "approvals":
				return (
					<div className="p-2 space-y-1">
						{brainApprovals.length === 0 ? (
							<p className="text-[11px] text-[#484f58] text-center py-4">No pending approvals</p>
						) : (
							brainApprovals.map((app: any, i: number) => (
								<div
									key={i}
									className="flex items-center justify-between text-[11px] p-1.5 rounded bg-[#d2992211] border border-[#d2992233]">
									<span className="text-[#d29922]">{app.description}</span>
									<div className="flex gap-1">
										<button className="px-1.5 py-0.5 text-[10px] bg-[#3fb950] text-white rounded hover:bg-[#2ea043]">
											Approve
										</button>
										<button className="px-1.5 py-0.5 text-[10px] bg-[#f85149] text-white rounded hover:bg-[#da3633]">
											Reject
										</button>
									</div>
								</div>
							))
						)}
					</div>
				)

			default:
				return null
		}
	}

	return (
		<div className="flex flex-col h-full">
			{/* Brain tabs */}
			<div className="flex border-b border-[#1e2535] bg-[#0f1117] shrink-0">
				{BRAIN_TABS.map((tab) => (
					<button
						key={tab.id}
						className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] border-b-2 transition-colors ${
							activeBrainTab === tab.id
								? "border-[#1f6feb] text-[#e6edf3] bg-[#1f6feb11]"
								: "border-transparent text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#1e2535]"
						}`}
						onClick={() => onBrainTabChange(tab.id)}>
						{tab.icon}
						{tab.label}
					</button>
				))}
				<div className="flex-1" />
				<button
					className={
						"flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition-colors " +
						(showSearch
							? "text-[#1f6feb] bg-[#1f6feb11]"
							: "text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#1e2535]")
					}
					onClick={() => {
						setShowSearch((v) => !v)
						setSearchQuery("")
					}}
					title="Search messages">
					<Search className="w-3.5 h-3.5" />
					Search
				</button>
				{onClearChat && (
					<button
						className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-[#8b949e] hover:text-[#f85149] hover:bg-[#f8514911] transition-colors"
						onClick={onClearChat}
						title="Clear chat history">
						<X className="w-3.5 h-3.5" />
						Clear
					</button>
				)}
			</div>

			{/* Brain tab content */}
			<div className="flex-1 overflow-y-auto border-b border-[#1e2535]">{renderBrainTab()}</div>

			{/* Chat messages */}
			<div className="flex-1 overflow-y-auto">
				{aiMessages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center px-4">
						<Bot className="w-8 h-8 text-[#30363d] mb-2" />
						<p className="text-[11px] text-[#484f58]">Ask the AI assistant anything about your code</p>
						<div className="flex flex-wrap gap-1 mt-3">
							{proactiveSuggestions.map((s, i) => (
								<button
									key={i}
									className="px-2 py-1 text-[10px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] hover:text-[#e6edf3] transition-colors"
									onClick={() => onSuggestionClick(s)}>
									<Sparkles className="w-3 h-3 inline mr-1" />
									{s}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="p-2 space-y-2">
						{aiMessages.map((msg, idx) => (
							<div
								key={msg.id || idx}
								className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
								<div
									className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
										msg.role === "user" ? "bg-[#1f6feb]" : "bg-[#30363d]"
									}`}>
									{msg.role === "user" ? (
										<User className="w-3.5 h-3.5 text-white" />
									) : (
										<Bot className="w-3.5 h-3.5 text-[#8b949e]" />
									)}
								</div>
								<div
									className={`flex-1 min-w-0 ${
										msg.role === "user" ? "bg-[#1f6feb22] rounded-lg px-2.5 py-1.5" : ""
									}`}>
									<div className="text-[12px] leading-relaxed text-[#e6edf3] whitespace-pre-wrap">
										{renderMessageContent(msg.content)}
									</div>

									{/* Code blocks with action buttons */}
									{msg.role === "assistant" &&
										(() => {
											const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
											const blocks: { language: string; code: string }[] = []
											let m
											while ((m = codeBlockRegex.exec(msg.content)) !== null) {
												blocks.push({ language: m[1] || "text", code: m[2] })
											}
											if (blocks.length > 0) {
												return (
													<div className="flex flex-wrap gap-1 mt-1">
														{blocks.map((block, bi) => (
															<React.Fragment key={bi}>
																<button
																	className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-[#1e2535] text-[#58a6ff] rounded hover:bg-[#30363d] transition-colors"
																	onClick={() =>
																		onApplyCode(block.code, block.language)
																	}>
																	<Code className="w-3 h-3" />
																	Apply
																</button>
																<button
																	className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-[#1e2535] text-[#3fb950] rounded hover:bg-[#30363d] transition-colors"
																	onClick={() => onRunInTerminal(block.code)}>
																	<Play className="w-3 h-3" />
																	Run
																</button>
															</React.Fragment>
														))}
													</div>
												)
											}
											return null
										})()}

									{/* Attachments */}
									{msg.attachments && msg.attachments.length > 0 && (
										<div className="flex flex-wrap gap-1 mt-1">
											{msg.attachments.map((att, ai) => (
												<span
													key={ai}
													className="text-[10px] px-1.5 py-0.5 bg-[#1e2535] text-[#8b949e] rounded">
													{att.type === "image" ? "🖼" : "📎"} {att.filename}
												</span>
											))}
										</div>
									)}
								</div>
							</div>
						))}
						<div ref={aiMessagesEndRef as React.RefObject<HTMLDivElement>} />
					</div>
				)}
			</div>

			{/* Proactive suggestions */}
			{proactiveSuggestions.length > 0 && aiMessages.length > 0 && (
				<div className="px-2 py-1 border-t border-[#1e2535] bg-[#161b22]">
					<div className="flex flex-wrap gap-1">
						{proactiveSuggestions.map((s, i) => (
							<button
								key={i}
								className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-[#1f6feb22] text-[#58a6ff] rounded hover:bg-[#1f6feb44] transition-colors"
								onClick={() => onSuggestionClick(s)}>
								<Sparkles className="w-3 h-3" />
								{s}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Attachments preview */}
			{aiAttachments.length > 0 && (
				<div className="flex flex-wrap gap-1 px-2 py-1 border-t border-[#1e2535] bg-[#161b22]">
					{aiAttachments.map((att, i) => (
						<span
							key={i}
							className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-[#1e2535] text-[#8b949e] rounded">
							{att.type === "image" ? "🖼" : "📎"} {att.filename}
							<button className="hover:text-[#f85149]" onClick={() => onRemoveAttachment(i)}>
								<X className="w-2.5 h-2.5" />
							</button>
						</span>
					))}
				</div>
			)}

			{/* Input area */}
			<div className="border-t border-[#1e2535] bg-[#0f1117] p-2">
				<div className="flex items-end gap-1">
					<div className="flex flex-col gap-1">
						<button
							className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
							onClick={onFilesClick}
							title="Attach file">
							<Paperclip className="w-3.5 h-3.5" />
						</button>
						<button
							className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
							onClick={onImagesClick}
							title="Attach image">
							<Image className="w-3.5 h-3.5" />
						</button>
					</div>
					<div className="flex-1 relative">
						<textarea
							ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
							value={aiInput}
							onChange={(e) => onAiInputChange(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask AI or type / for commands..."
							rows={2}
							className="w-full bg-[#0d1117] border border-[#1e2535] rounded px-2 py-1.5 text-[12px] text-[#e6edf3] placeholder-[#484f58] outline-none resize-none focus:border-[#1f6feb] transition-colors"
						/>
						{/* Slash command filter */}
						{slashCommandFilter && (
							<div className="absolute bottom-full left-0 mb-1 bg-[#161b22] border border-[#1e2535] rounded shadow-lg max-h-[150px] overflow-y-auto z-10 min-w-[180px]">
								{["/plan", "/debug", "/fix", "/deploy", "/test", "/explain", "/refactor", "/search"]
									.filter((c) => c.includes(slashCommandFilter))
									.map((cmd) => (
										<button
											key={cmd}
											className="w-full text-left px-2 py-1 text-[11px] font-mono text-[#8b949e] hover:bg-[#1e2535] hover:text-[#e6edf3] transition-colors"
											onClick={() => {
												onAiInputChange(cmd + " ")
											}}>
											{cmd}
										</button>
									))}
							</div>
						)}
					</div>
					{isAiLoading ? (
						<button
							className="p-1.5 rounded bg-[#f85149] text-white hover:bg-[#da3633] transition-colors"
							onClick={onCancelAi}
							title="Cancel">
							<Square className="w-3.5 h-3.5" />
						</button>
					) : (
						<button
							className="p-1.5 rounded bg-[#1f6feb] text-white hover:bg-[#388bfd] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={onAiSend}
							disabled={!aiInput.trim()}
							title="Send">
							<Send className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
