"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
	Send,
	Bot,
	User,
	Sparkles,
	Loader2,
	AlertTriangle,
	Shield,
	ShieldCheck,
	ShieldHalf,
	Zap,
	Trash2,
	Copy,
	Check,
	BrainCircuit,
	MessageSquare,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { sendBrainMessage, fetchSessionSummary, type BrainAskResponse } from "@/lib/ai-chat-api"

// ─── Types ────────────────────────────────────────────────────────────────

interface ChatMessage {
	id: string
	role: "user" | "assistant" | "system"
	content: string
	timestamp: number
	meta?: string
}

type SafetyMode = "OFF" | "SAFE" | "AUTO" | "FULL_AUTONOMOUS"

const SAFETY_MODES: { value: SafetyMode; label: string; icon: typeof Shield; color: string }[] = [
	{ value: "OFF", label: "Off", icon: Shield, color: "text-gray-500" },
	{ value: "SAFE", label: "Safe", icon: ShieldCheck, color: "text-emerald-400" },
	{ value: "AUTO", label: "Auto", icon: ShieldHalf, color: "text-amber-400" },
	{ value: "FULL_AUTONOMOUS", label: "Full Auto", icon: Zap, color: "text-violet-400" },
]

const SUGGESTED_QUESTIONS = [
	"What's the current system status?",
	"Show me recent bugs",
	"What's in the task queue?",
	"Check deployment health",
	"Summarize recent changes",
]

// ─── Helpers ──────────────────────────────────────────────────────────────

let messageCounter = 0
function generateId(): string {
	messageCounter++
	return `msg-${Date.now()}-${messageCounter}`
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ─── Component ────────────────────────────────────────────────────────────

export function AiChatView() {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [input, setInput] = useState("")
	const [sending, setSending] = useState(false)
	const [safetyMode, setSafetyMode] = useState<SafetyMode>("SAFE")
	const [showSafetyDropdown, setShowSafetyDropdown] = useState(false)
	const [copiedId, setCopiedId] = useState<string | null>(null)
	const [sessionSummary, setSessionSummary] = useState("")
	const [showSuggestions, setShowSuggestions] = useState(true)

	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const safetyRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to bottom
	const scrollToBottom = useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [])

	useEffect(() => {
		scrollToBottom()
	}, [messages, scrollToBottom])

	// Load session summary on mount
	useEffect(() => {
		fetchSessionSummary().then((summary) => {
			if (summary) {
				setSessionSummary(summary)
				setMessages([
					{
						id: generateId(),
						role: "system",
						content: `Session loaded. ${summary}`,
						timestamp: Date.now(),
					},
				])
			}
		})
	}, [])

	// Close safety dropdown on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (safetyRef.current && !safetyRef.current.contains(e.target as Node)) {
				setShowSafetyDropdown(false)
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [])

	// Auto-resize textarea
	const adjustTextarea = () => {
		const el = inputRef.current
		if (el) {
			el.style.height = "auto"
			el.style.height = Math.min(el.scrollHeight, 200) + "px"
		}
	}

	const handleSend = async () => {
		const text = input.trim()
		if (!text || sending) return

		setInput("")
		setShowSuggestions(false)
		if (inputRef.current) {
			inputRef.current.style.height = "auto"
		}

		const userMsg: ChatMessage = {
			id: generateId(),
			role: "user",
			content: text,
			timestamp: Date.now(),
		}
		setMessages((prev) => [...prev, userMsg])
		setSending(true)

		// Add placeholder assistant message
		const assistantId = generateId()
		const assistantMsg: ChatMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
			timestamp: Date.now(),
			meta: "Thinking...",
		}
		setMessages((prev) => [...prev, assistantMsg])

		try {
			// Build conversation history for context
			const history = messages
				.filter((m) => m.role === "user" || m.role === "assistant")
				.map((m) => ({ role: m.role, content: m.content }))

			const response = await sendBrainMessage({
				question: text,
				projectId: "superroo2",
				history,
			})

			// Handle slash commands that change safety mode
			const trimmed = text.trim().toLowerCase()
			if (trimmed === "/fullauto" || trimmed === "/full_autonomous") {
				setSafetyMode("FULL_AUTONOMOUS")
			} else if (trimmed === "/safe" || trimmed === "/safe_mode") {
				setSafetyMode("SAFE")
			}

			// Update the assistant message with the response
			setMessages((prev) =>
				prev.map((m) =>
					m.id === assistantId
						? {
								...m,
								content: response.answer || "No response from brain.",
								meta: response.contextCounts
									? `${response.contextCounts.features} features · ${response.contextCounts.bugs} bugs · ${response.contextCounts.tasks} tasks`
									: undefined,
						  }
						: m,
				),
			)
		} catch (error: any) {
			setMessages((prev) =>
				prev.map((m) =>
					m.id === assistantId
						? {
								...m,
								content: `Error: ${error.message || "Failed to reach the brain."}`,
								meta: "Error",
						  }
						: m,
				),
			)
		} finally {
			setSending(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	const handleCopy = async (content: string, id: string) => {
		try {
			await navigator.clipboard.writeText(content)
			setCopiedId(id)
			setTimeout(() => setCopiedId(null), 2000)
		} catch {
			// Fallback
		}
	}

	const clearChat = () => {
		setMessages([])
		setShowSuggestions(true)
	}

	const askQuestion = (q: string) => {
		setInput(q)
		setShowSuggestions(false)
		inputRef.current?.focus()
	}

	const SafetyIcon = SAFETY_MODES.find((m) => m.value === safetyMode)?.icon || Shield

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<BrainCircuit className="h-5 w-5 text-violet-400" />
					<h2 className="text-base font-semibold text-[#e2e8f0]">AI Chat</h2>
					{sending && (
						<div className="flex items-center gap-1.5 text-xs text-violet-400">
							<Loader2 className="h-3 w-3 animate-spin" />
							Thinking...
						</div>
					)}
				</div>
				<div className="flex items-center gap-2">
					{/* Safety Mode Selector */}
					<div className="relative" ref={safetyRef}>
						<button
							onClick={() => setShowSafetyDropdown(!showSafetyDropdown)}
							className={`flex items-center gap-1.5 rounded-md border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 text-xs transition-colors hover:border-[#334155] ${
								SAFETY_MODES.find((m) => m.value === safetyMode)?.color || "text-gray-400"
							}`}
							title={`Safety Mode: ${safetyMode}`}>
							<SafetyIcon className="h-3.5 w-3.5" />
							<span className="hidden sm:inline">{SAFETY_MODES.find((m) => m.value === safetyMode)?.label}</span>
						</button>

						{showSafetyDropdown && (
							<div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-[#1e2535] bg-[#0f1117] shadow-lg">
								{SAFETY_MODES.map((mode) => {
									const Icon = mode.icon
									const active = safetyMode === mode.value
									return (
										<button
											key={mode.value}
											onClick={() => {
												setSafetyMode(mode.value)
												setShowSafetyDropdown(false)
											}}
											className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#1e2535] ${
												active ? mode.color : "text-gray-400"
											} ${active ? "bg-[#1e2535]/50" : ""}`}>
											<Icon className="h-3.5 w-3.5" />
											<span>{mode.label}</span>
										</button>
									)
								})}
							</div>
						)}
					</div>

					{/* Clear Chat */}
					{messages.length > 0 && (
						<button
							onClick={clearChat}
							className="flex items-center gap-1.5 rounded-md border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-red-500/30 hover:text-red-400"
							title="Clear chat">
							<Trash2 className="h-3.5 w-3.5" />
							<span className="hidden sm:inline">Clear</span>
						</button>
					)}
				</div>
			</div>

			{/* Messages Area */}
			<div className="flex-1 overflow-y-auto space-y-3 mb-3">
				{messages.length === 0 && !sending && (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/10">
							<BrainCircuit className="h-7 w-7 text-violet-400" />
						</div>
						<h3 className="mb-1 text-sm font-semibold text-[#e2e8f0]">SuperRoo AI Chat</h3>
						<p className="mb-6 max-w-xs text-xs text-gray-500">
							Connected to the Central Brain. Ask about the system, code, bugs, or anything else.
						</p>

						{showSuggestions && (
							<div className="grid max-w-md gap-2">
								{SUGGESTED_QUESTIONS.map((q) => (
									<button
										key={q}
										onClick={() => askQuestion(q)}
										className="flex items-center gap-2 rounded-md border border-[#1e2535] bg-[#0a0e1a] px-4 py-2.5 text-left text-xs text-gray-400 transition-colors hover:border-violet-500/30 hover:text-[#e2e8f0]">
										<MessageSquare className="h-3.5 w-3.5 shrink-0 text-violet-400/60" />
										{q}
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{messages.map((msg) => (
					<div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
						{msg.role !== "user" && (
							<div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
								{msg.role === "system" ? (
									<BrainCircuit className="h-3.5 w-3.5 text-amber-400" />
								) : (
									<Bot className="h-3.5 w-3.5 text-violet-400" />
								)}
							</div>
						)}

						<div
							className={`group max-w-[80%] rounded-lg px-3.5 py-2.5 ${
								msg.role === "user"
									? "bg-violet-500/15 text-[#e2e8f0]"
									: msg.role === "system"
									? "bg-amber-500/5 border border-amber-500/10 text-gray-400"
									: "bg-[#0a0e1a] border border-[#1e2535] text-[#e2e8f0]"
							}`}>
							{/* Role label */}
							<div className="mb-1 flex items-center gap-2">
								<span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
									{msg.role === "user" ? "You" : msg.role === "system" ? "System" : "SuperRoo"}
								</span>
								<span className="text-[10px] text-gray-700">{formatTime(msg.timestamp)}</span>
							</div>

							{/* Content */}
							<div className="whitespace-pre-wrap text-sm leading-6">
								{msg.content || (
									<span className="flex items-center gap-2 text-gray-500">
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
										Thinking...
									</span>
								)}
							</div>

							{/* Meta / Route info */}
							{msg.meta && (
								<div className="mt-1.5 flex items-center gap-1.5">
									{msg.meta === "Error" ? (
										<Badge status="failed" label="Error" />
									) : (
										<span className="text-[10px] text-gray-600">{msg.meta}</span>
									)}
								</div>
							)}

							{/* Copy button */}
							{msg.content && (
								<div className="mt-1.5 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
									<button
										onClick={() => handleCopy(msg.content, msg.id)}
										className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-600 hover:text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
										{copiedId === msg.id ? (
											<>
												<Check className="h-3 w-3 text-emerald-400" />
												<span className="text-emerald-400">Copied</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy</span>
											</>
										)}
									</button>
								</div>
							)}
						</div>

						{msg.role === "user" && (
							<div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
								<User className="h-3.5 w-3.5 text-blue-400" />
							</div>
						)}
					</div>
				))}
				<div ref={messagesEndRef} />
			</div>

			{/* Input Area */}
			<div className="shrink-0 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => {
							setInput(e.target.value)
							adjustTextarea()
						}}
						onKeyDown={handleKeyDown}
						placeholder="Ask SuperRoo anything..."
						rows={1}
						className="min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[#e2e8f0] outline-none placeholder:text-gray-700"
						disabled={sending}
					/>
					<button
						onClick={handleSend}
						disabled={!input.trim() || sending}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/20 text-violet-400 transition-colors hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-30">
						{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
					</button>
				</div>
				<div className="mt-1.5 flex items-center justify-between px-1">
					<div className="flex items-center gap-2 text-[10px] text-gray-700">
						<BrainCircuit className="h-3 w-3" />
						<span>Connected to Central Brain</span>
					</div>
					<span className="text-[10px] text-gray-700">Enter to send · Shift+Enter for new line</span>
				</div>
			</div>
		</div>
	)
}
