"use client"

import { useState, useCallback } from "react"
import {
	Terminal,
	Bot,
	Code2,
	Search,
	GitBranch,
	Play,
	Boxes,
	User,
	Settings,
	PanelBottom,
	PanelRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
	AlertTriangle,
	Send,
	Plus,
	File,
	Folder,
	FolderOpen,
	ChevronRight,
	ChevronDown,
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
	status: "pending" | "running" | "done" | "blocked" | "failed"
	agent?: string
	duration?: string
}

interface TerminalSession {
	id: string
	name: string
	cwd: string
	createdAt: string
	output: string[]
}

interface ChatMessage {
	id: string
	role: "user" | "assistant" | "agent"
	author: string
	meta?: string
	time: string
	content: string
	attachments?: { id: string; filename: string; type: string; size: string }[]
}

// ─── Mock data ────────────────────────────────────────────────────────────

const MOCK_FILES: WorkspaceFile[] = [
	{
		path: "src",
		name: "src",
		kind: "folder",
		children: [
			{ path: "src/index.ts", name: "index.ts", kind: "file" },
			{ path: "src/App.tsx", name: "App.tsx", kind: "file", modified: true },
			{
				path: "src/components",
				name: "components",
				kind: "folder",
				children: [
					{ path: "src/components/Header.tsx", name: "Header.tsx", kind: "file" },
					{ path: "src/components/Sidebar.tsx", name: "Sidebar.tsx", kind: "file" },
				],
			},
		],
	},
	{ path: "package.json", name: "package.json", kind: "file" },
	{ path: "tsconfig.json", name: "tsconfig.json", kind: "file" },
]

const MOCK_PIPELINE: PipelineStep[] = [
	{ id: "plan", label: "Plan", status: "done", agent: "Kimi", duration: "2s" },
	{ id: "crawl", label: "Crawl", status: "done", agent: "Groq", duration: "1s" },
	{ id: "patch", label: "Patch", status: "running", agent: "Claude", duration: "12s" },
	{ id: "approval", label: "Approval", status: "pending" },
	{ id: "tests", label: "Tests", status: "pending" },
	{ id: "deploy", label: "Deploy", status: "pending" },
]

const MOCK_TERMINALS: TerminalSession[] = [
	{
		id: "term-1",
		name: "bash",
		cwd: "/workspace",
		createdAt: new Date().toISOString(),
		output: [
			"Welcome to SuperRoo IDE Terminal",
			"$ npx vitest run",
			" RUN  v2.1.8",
			" ✓  tests/modelRouter.test.ts (42 tests) 1.2s",
			" ✓  tests/ideWorkspace.test.ts (12 tests) 0.3s",
			"",
			" Test Files  2 passed (2)",
			"      Tests  54 passed (54)",
			"",
		],
	},
]

const MOCK_CHAT: ChatMessage[] = [
	{
		id: "msg-1",
		role: "assistant",
		author: "Kimi",
		meta: "plan",
		time: "10:32 AM",
		content:
			"I've analyzed the codebase. The issue is in the routing logic — the fallback chain isn't being evaluated correctly when the primary provider returns a 429.",
		attachments: [
			{ id: "att-1", filename: "modelRouter.ts", type: "CODE", size: "2.4 KB" },
			{ id: "att-2", filename: "error.log", type: "LOG", size: "1.1 KB" },
		],
	},
	{ id: "msg-2", role: "user", author: "You", time: "10:33 AM", content: "Can you show me the fix?" },
	{
		id: "msg-3",
		role: "agent",
		author: "Claude",
		meta: "code",
		time: "10:33 AM",
		content: "Here's the fix — we need to check `response.status === 429` before falling back:",
	},
]

const ACTIVITY_ITEMS = [
	{ id: "bot", icon: Bot, label: "Assistant" },
	{ id: "code", icon: Code2, label: "Code" },
	{ id: "search", icon: Search, label: "Search" },
	{ id: "git", icon: GitBranch, label: "Git" },
	{ id: "play", icon: Play, label: "Run" },
	{ id: "boxes", icon: Boxes, label: "Packages" },
	{ id: "user", icon: User, label: "Account" },
	{ id: "settings", icon: Settings, label: "Settings" },
] as const

// ─── Pipeline step icon helper ────────────────────────────────────────────

function PipelineIcon({ status }: { status: string }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={14} className="text-green-400" />
		case "running":
			return <Loader2 size={14} className="text-blue-400 animate-spin" />
		case "blocked":
			return <AlertTriangle size={14} className="text-yellow-400" />
		case "failed":
			return <XCircle size={14} className="text-red-400" />
		default:
			return <Clock size={14} className="text-gray-500" />
	}
}

// ─── FileTree component ───────────────────────────────────────────────────

function FileTreeItem({ item, depth = 0, activeFile, onOpenFile }: {
	item: WorkspaceFile
	depth: number
	activeFile: string | null
	onOpenFile: (path: string) => void
}) {
	const [expanded, setExpanded] = useState(true)
	const isFolder = item.kind === "folder"
	const isActive = activeFile === item.path

	if (isFolder) {
		return (
			<div>
				<button
					onClick={() => setExpanded(!expanded)}
					className={`flex w-full items-center gap-1 px-2 py-1 text-xs rounded transition-colors hover:bg-[#1e2535] ${isActive ? "text-violet-300" : "text-gray-400"}`}
					style={{ paddingLeft: `${8 + depth * 12}px` }}>
					{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
					{expanded ? <FolderOpen size={12} className="text-yellow-500" /> : <Folder size={12} className="text-yellow-500" />}
					<span>{item.name}</span>
				</button>
				{expanded && item.children?.map((child) => (
					<FileTreeItem key={child.path} item={child} depth={depth + 1} activeFile={activeFile} onOpenFile={onOpenFile} />
				))}
			</div>
		)
	}

	return (
		<button
			onClick={() => onOpenFile(item.path)}
			className={`flex w-full items-center gap-1 px-2 py-1 text-xs rounded transition-colors hover:bg-[#1e2535] ${isActive ? "text-violet-300 bg-violet-600/10" : "text-gray-400"}`}
			style={{ paddingLeft: `${8 + depth * 12}px` }}>
			<File size={12} className={item.modified ? "text-orange-400" : "text-blue-400"} />
			<span>{item.name}</span>
			{item.modified && <span className="ml-auto text-[10px] text-orange-400">M</span>}
		</button>
	)
}

// ─── Terminal pane component ──────────────────────────────────────────────

function TerminalPane({ sessions, activeTerminal, onSetActive, onCreateSession, onExecuteCommand }: {
	sessions: TerminalSession[]
	activeTerminal: string
	onSetActive: (id: string) => void
	onCreateSession: () => void
	onExecuteCommand: (id: string, cmd: string) => void
}) {
	const [cmdInput, setCmdInput] = useState("")

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && cmdInput.trim()) {
			onExecuteCommand(activeTerminal, cmdInput.trim())
			setCmdInput("")
		}
	}

	const active = sessions.find((s) => s.id === activeTerminal)

	return (
		<div className="flex flex-col h-full rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden">
			<div className="flex items-center gap-1 px-2 py-1 bg-[#0f1117] border-b border-[#1e2535] text-xs">
				<Terminal size={12} className="text-gray-500" />
				{sessions.map((s) => (
					<button
						key={s.id}
						onClick={() => onSetActive(s.id)}
						className={`px-2 py-0.5 rounded text-xs transition-colors ${s.id === activeTerminal ? "bg-[#1e2535] text-[#e2e8f0]" : "text-gray-500 hover:text-gray-300"}`}>
						{s.name}
					</button>
				))}
				<button onClick={onCreateSession} className="ml-auto p-0.5 text-gray-500 hover:text-gray-300" title="New Terminal">
					<Plus size={12} />
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed text-green-400">
				{active?.output.map((line, i) => (
					<div key={i}>{line}</div>
				))}
			</div>
			<div className="flex items-center gap-1 px-2 py-1 border-t border-[#1e2535] bg-[#0f1117]">
				<span className="text-xs text-green-400">$</span>
				<input
					value={cmdInput}
					onChange={(e) => setCmdInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type a command..."
					className="flex-1 bg-transparent border-none outline-none text-xs text-[#e2e8f0] placeholder-gray-600"
				/>
			</div>
		</div>
	)
}

// ─── Assistant pane component ─────────────────────────────────────────────

function AssistantPane({ messages, onSendMessage }: {
	messages: ChatMessage[]
	onSendMessage: (content: string) => void
}) {
	const [input, setInput] = useState("")

	const handleSend = () => {
		if (input.trim()) {
			onSendMessage(input.trim())
			setInput("")
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e2535] bg-[#0f1117]">
				<Bot size={14} className="text-violet-400" />
				<span className="text-xs font-semibold text-[#e2e8f0]">AI Assistant</span>
			</div>
			<div className="flex-1 overflow-y-auto p-2 space-y-2">
				{messages.map((msg) => (
					<div
						key={msg.id}
						className={`p-2 rounded-lg text-xs ${
							msg.role === "user"
								? "bg-violet-600/10 border border-violet-600/20 ml-4"
								: "bg-[#0f1117] border border-[#1e2535] mr-4"
						}`}>
						<div className="flex items-center gap-1.5 mb-1">
							<span className={`font-semibold ${msg.role === "user" ? "text-violet-300" : msg.role === "agent" ? "text-orange-300" : "text-blue-300"}`}>
								{msg.author}
							</span>
							{msg.meta && (
								<span className="text-[10px] px-1 rounded bg-[#1e2535] text-gray-500">{msg.meta}</span>
							)}
							<span className="ml-auto text-[10px] text-gray-600">{msg.time}</span>
						</div>
						<p className="text-gray-400 leading-relaxed">{msg.content}</p>
						{msg.attachments?.map((att) => (
							<div key={att.id} className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
								<File size={10} />
								<span>{att.filename}</span>
								<span className="ml-auto">{att.size}</span>
							</div>
						))}
					</div>
				))}
			</div>
			<div className="flex items-center gap-1 p-2 border-t border-[#1e2535] bg-[#0f1117]">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask the AI assistant..."
					className="flex-1 bg-transparent border-none outline-none text-xs text-[#e2e8f0] placeholder-gray-600"
				/>
				<button
					onClick={handleSend}
					disabled={!input.trim()}
					className="p-1 text-violet-400 hover:text-violet-300 disabled:text-gray-600 disabled:cursor-not-allowed">
					<Send size={14} />
				</button>
			</div>
		</div>
	)
}

// ─── Main component ───────────────────────────────────────────────────────

export default function IdeTerminalView() {
	const [activeActivity, setActiveActivity] = useState("bot")
	const [files] = useState<WorkspaceFile[]>(MOCK_FILES)
	const [activeFile, setActiveFile] = useState<string | null>("src/App.tsx")
	const [pipeline, setPipeline] = useState<PipelineStep[]>(MOCK_PIPELINE)
	const [terminals] = useState<TerminalSession[]>(MOCK_TERMINALS)
	const [activeTerminal, setActiveTerminal] = useState<string>("term-1")
	const [messages, setMessages] = useState<ChatMessage[]>(MOCK_CHAT)
	const [showAssistant, setShowAssistant] = useState(true)
	const [showSidebar, setShowSidebar] = useState(true)

	const handleOpenFile = useCallback((path: string) => {
		setActiveFile(path)
	}, [])

	const handleSendMessage = useCallback((content: string) => {
		const newMsg: ChatMessage = {
			id: `msg-${Date.now()}`,
			role: "user",
			author: "You",
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			content,
		}
		setMessages((prev) => [...prev, newMsg])
		setTimeout(() => {
			const reply: ChatMessage = {
				id: `msg-${Date.now()}`,
				role: "assistant",
				author: "Kimi",
				meta: "auto",
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: `I'll help you with "${content}". Let me analyze the workspace and provide a solution.`,
			}
			setMessages((prev) => [...prev, reply])
		}, 1000)
	}, [])

	const handleExecuteCommand = useCallback((_terminalId: string, _command: string) => {
		// Simulated
	}, [])

	const handleCreateTerminal = useCallback(() => {
		// Simulated
	}, [])

	const handleApprove = useCallback((stepId: string) => {
		setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "running" as const } : s)))
	}, [])

	const handleReject = useCallback((stepId: string) => {
		setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "blocked" as const } : s)))
	}, [])

	return (
		<div className="flex flex-col h-full bg-[#070b14] text-[#e2e8f0]">
			{/* Pipeline bar */}
			<div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0e1a] border-b border-[#1e2535] overflow-x-auto">
				{pipeline.map((step, i) => (
					<div key={step.id} className="flex items-center gap-1.5">
						<div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
							step.status === "running" ? "bg-blue-600/20 text-blue-300" :
							step.status === "done" ? "bg-green-600/20 text-green-300" :
							step.status === "blocked" ? "bg-yellow-600/20 text-yellow-300" :
							"text-gray-500"
						}`}>
							<PipelineIcon status={step.status} />
							<span>{step.label}</span>
							{step.agent && <span className="text-[10px] opacity-60">({step.agent})</span>}
							{step.duration && <span className="text-[10px] opacity-40">{step.duration}</span>}
						</div>
						{step.id === "approval" && step.status === "pending" && (
							<div className="flex items-center gap-0.5">
								<button
									onClick={() => handleApprove(step.id)}
									className="p-0.5 text-green-500 hover:text-green-400"
									title="Approve">
									<CheckCircle2 size={12} />
								</button>
								<button
									onClick={() => handleReject(step.id)}
									className="p-0.5 text-red-500 hover:text-red-400"
									title="Reject">
									<XCircle size={12} />
								</button>
							</div>
						)}
						{i < pipeline.length - 1 && <ChevronRight size={10} className="text-gray-600" />}
					</div>
				))}
			</div>

			{/* Main workspace area */}
			<div className="flex flex-1 min-h-0">
				{/* Activity bar */}
				<aside className="flex flex-col items-center gap-1 py-2 px-1 bg-[#0a0e1a] border-r border-[#1e2535] shrink-0">
					{ACTIVITY_ITEMS.map((item) => {
						const Icon = item.icon
						const isActive = activeActivity === item.id
						return (
							<button
								key={item.id}
								onClick={() => setActiveActivity(item.id)}
								className={`p-1.5 rounded-md transition-colors relative ${
									isActive
										? "text-[#e2e8f0] bg-[#1e2535]"
										: "text-gray-500 hover:text-[#e2e8f0] hover:bg-[#1e2535]/50"
								}`}
								title={item.label}>
								<Icon size={18} />
								{isActive && (
									<div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-violet-500 rounded-full" />
								)}
							</button>
						)
					})}
				</aside>

				{/* Sidebar (file tree) */}
				{showSidebar && (
					<aside className="w-56 shrink-0 border-r border-[#1e2535] bg-[#0a0e1a] overflow-y-auto">
						<div className="flex items-center gap-1 px-3 py-2 border-b border-[#1e2535]">
							<FolderOpen size={12} className="text-yellow-500" />
							<span className="text-xs font-semibold text-gray-400">Explorer</span>
							<span className="ml-auto text-[10px] text-gray-600">auto-improvement</span>
						</div>
						{files.map((file) => (
							<FileTreeItem key={file.path} item={file} depth={0} activeFile={activeFile} onOpenFile={handleOpenFile} />
						))}
					</aside>
				)}

				{/* Center workspace */}
				<div className="flex flex-col flex-1 min-w-0">
					{/* Main content area */}
					<div className="flex flex-1 min-h-0">
						{/* Terminal + Editor area */}
						<div className="flex flex-col flex-1 min-w-0 p-2 gap-2">
							{/* Editor area (placeholder) */}
							<div className="flex-1 rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden">
								<div className="flex items-center gap-1 px-3 py-1.5 bg-[#0f1117] border-b border-[#1e2535] text-xs overflow-x-auto">
									{activeFile ? (
										<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-t bg-[#0a0e1a] border-t border-x border-[#1e2535] text-[#e2e8f0]">
											<Code2 size={12} />
											{activeFile.split("/").pop()}
										</span>
									) : (
										<span className="text-gray-500">No file open</span>
									)}
								</div>
								<div className="flex items-center justify-center h-full text-xs text-gray-500">
									{activeFile ? (
										<pre className="p-4 font-mono text-sm leading-relaxed text-left w-full overflow-auto text-green-400">
{`import { useState } from "react"

export function App() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <h1>Hello World</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  )
}`}
										</pre>
									) : (
										"Select a file from the sidebar to view its contents"
									)}
								</div>
							</div>

							{/* Terminal pane */}
							<div className="h-48 shrink-0">
								<TerminalPane
									sessions={terminals}
									activeTerminal={activeTerminal}
									onSetActive={setActiveTerminal}
									onCreateSession={handleCreateTerminal}
									onExecuteCommand={handleExecuteCommand}
								/>
							</div>
						</div>

						{/* Assistant pane (right sidebar) */}
						{showAssistant && (
							<aside className="w-80 shrink-0 border-l border-[#1e2535] bg-[#0a0e1a]">
								<AssistantPane messages={messages} onSendMessage={handleSendMessage} />
							</aside>
						)}
					</div>
				</div>
			</div>

			{/* Status bar */}
			<div className="flex items-center gap-3 px-3 py-1 bg-[#0f1117] border-t border-[#1e2535] text-[10px] text-gray-500 shrink-0">
				<div className="flex items-center gap-1">
					<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
					<span>Connected</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
					<span>Docker</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
					<span>Redis</span>
				</div>
				<span className="ml-auto">CPU: 2.4%</span>
				<span>RAM: 128MB</span>
				<span className="border-l border-[#1e2535] pl-3">auto-improvement</span>
			</div>

			{/* View toggle buttons (floating) */}
			<div className="absolute bottom-8 right-4 flex items-center gap-1 bg-[#0a0e1a] border border-[#1e2535] rounded-lg shadow-lg px-2 py-1.5">
				<button
					onClick={() => setShowSidebar(!showSidebar)}
					className={`p-1 rounded text-xs transition-colors ${
						showSidebar
							? "text-[#e2e8f0] bg-[#1e2535]"
							: "text-gray-500 hover:text-[#e2e8f0]"
					}`}
					title="Toggle Sidebar">
					<PanelBottom size={14} />
				</button>
				<button
					onClick={() => setShowAssistant(!showAssistant)}
					className={`p-1 rounded text-xs transition-colors ${
						showAssistant
							? "text-[#e2e8f0] bg-[#1e2535]"
							: "text-gray-500 hover:text-[#e2e8f0]"
					}`}
					title="Toggle Assistant">
					<PanelRight size={14} />
				</button>
			</div>
		</div>
	)
}
