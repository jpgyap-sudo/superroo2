import { useEffect, useState, useCallback } from "react"
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
} from "lucide-react"
import { TerminalPane } from "./ide-terminal/TerminalPane"
import { AssistantPane } from "./ide-terminal/AssistantPane"
import { FileTreePanel } from "./ide-terminal/FileTree"
import { PipelineBar } from "./ide-terminal/PipelineBar"
import { StatusBar } from "./ide-terminal/StatusBar"
import type { WorkspaceFile, ChatMessage, TerminalSession, PipelineStep } from "../lib/ideWorkspaceApi"

// ─── Mock data for initial render ───────────────────────────────────────

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
	{
		path: "package.json",
		name: "package.json",
		kind: "file",
	},
	{
		path: "tsconfig.json",
		name: "tsconfig.json",
		kind: "file",
	},
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
			"I've analyzed the codebase. The issue is in the routing logic \u2014 the fallback chain isn't being evaluated correctly when the primary provider returns a 429.",
		attachments: [
			{ id: "att-1", filename: "modelRouter.ts", type: "CODE", size: "2.4 KB" },
			{ id: "att-2", filename: "error.log", type: "LOG", size: "1.1 KB" },
		],
	},
	{
		id: "msg-2",
		role: "user",
		author: "You",
		time: "10:33 AM",
		content: "Can you show me the fix?",
	},
	{
		id: "msg-3",
		role: "agent",
		author: "Claude",
		meta: "code",
		time: "10:33 AM",
		content: "Here's the fix \u2014 we need to check `response.status === 429` before falling back:",
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

export function IdeTerminalView() {
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

		// Simulate AI response
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

	const handleExecuteCommand = useCallback((terminalId: string, command: string) => {
		console.log(`[IDE Terminal] Execute: ${command} on ${terminalId}`)
	}, [])

	const handleCreateTerminal = useCallback((_name?: string) => {
		console.log("[IDE Terminal] Create new terminal")
	}, [])

	const handleApprove = useCallback((stepId: string) => {
		setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "running" as const } : s)))
	}, [])

	const handleReject = useCallback((stepId: string) => {
		setPipeline((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "blocked" as const } : s)))
	}, [])

	return (
		<div className="flex flex-col h-full bg-vscode-editor-background text-vscode-foreground">
			{/* Main workspace area */}
			<div className="flex flex-1 min-h-0">
				{/* Activity bar */}
				<aside className="flex flex-col items-center gap-1 py-2 px-1 bg-vscode-sideBar-background border-r border-vscode-panel-border shrink-0">
					{ACTIVITY_ITEMS.map((item) => {
						const Icon = item.icon
						const isActive = activeActivity === item.id
						return (
							<button
								key={item.id}
								onClick={() => setActiveActivity(item.id)}
								className={`p-1.5 rounded-md transition-colors relative ${
									isActive
										? "text-vscode-foreground bg-vscode-list-activeSelectionBackground"
										: "text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-list-hoverBackground"
								}`}
								title={item.label}>
								<Icon size={18} />
								{isActive && (
									<div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-vscode-focusBorder rounded-full" />
								)}
							</button>
						)
					})}
				</aside>

				{/* Sidebar (file tree) */}
				{showSidebar && (
					<aside className="w-56 shrink-0 border-r border-vscode-panel-border">
						<FileTreePanel
							files={files}
							activeFile={activeFile}
							onOpenFile={handleOpenFile}
							branch="auto-improvement"
						/>
					</aside>
				)}

				{/* Center workspace */}
				<div className="flex flex-col flex-1 min-w-0">
					{/* Pipeline bar */}
					<PipelineBar steps={pipeline} onApprove={handleApprove} onReject={handleReject} />

					{/* Main content area */}
					<div className="flex flex-1 min-h-0">
						{/* Terminal + Editor area */}
						<div className="flex flex-col flex-1 min-w-0 p-2 gap-2">
							{/* Editor area (placeholder) */}
							<div className="flex-1 rounded-lg border border-vscode-panel-border bg-vscode-editor-background overflow-hidden">
								<div className="flex items-center gap-1 px-3 py-1.5 bg-vscode-sideBar-background border-b border-vscode-panel-border text-xs overflow-x-auto">
									{activeFile ? (
										<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-t bg-vscode-editor-background border-t border-x border-vscode-panel-border text-vscode-foreground">
											<Code2 size={12} />
											{activeFile.split("/").pop()}
										</span>
									) : (
										<span className="text-vscode-descriptionForeground">No file open</span>
									)}
								</div>
								<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground">
									{activeFile ? (
										<pre className="p-4 font-mono text-sm leading-relaxed text-left w-full overflow-auto">
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
							<aside className="w-80 shrink-0 border-l border-vscode-panel-border">
								<AssistantPane messages={messages} onSendMessage={handleSendMessage} />
							</aside>
						)}
					</div>
				</div>
			</div>

			{/* Status bar */}
			<StatusBar
				status={{
					connected: true,
					docker: true,
					redis: true,
					cpu: "2.4%",
					ram: "128MB",
				}}
				branch="auto-improvement"
			/>

			{/* View toggle buttons (floating) */}
			<div className="absolute bottom-8 right-4 flex items-center gap-1 bg-vscode-sideBar-background border border-vscode-panel-border rounded-lg shadow-lg px-2 py-1.5">
				<button
					onClick={() => setShowSidebar(!showSidebar)}
					className={`p-1 rounded text-xs transition-colors ${
						showSidebar
							? "text-vscode-foreground bg-vscode-list-activeSelectionBackground"
							: "text-vscode-descriptionForeground hover:text-vscode-foreground"
					}`}
					title="Toggle Sidebar">
					<PanelBottom size={14} />
				</button>
				<button
					onClick={() => setShowAssistant(!showAssistant)}
					className={`p-1 rounded text-xs transition-colors ${
						showAssistant
							? "text-vscode-foreground bg-vscode-list-activeSelectionBackground"
							: "text-vscode-descriptionForeground hover:text-vscode-foreground"
					}`}
					title="Toggle Assistant">
					<PanelRight size={14} />
				</button>
			</div>
		</div>
	)
}
