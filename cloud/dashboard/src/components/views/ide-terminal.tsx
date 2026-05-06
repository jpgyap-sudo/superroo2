"use client"

import { useState, useCallback } from "react"
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

// ─── Mock data ────────────────────────────────────────────────────────────

const files: WorkspaceFile[] = [
	{ path: "auto-improvement", name: "auto-improvement", kind: "folder" },
	{ path: ".github", name: ".github", kind: "folder" },
	{ path: "agents", name: "agents", kind: "folder" },
	{ path: "config", name: "config", kind: "folder" },
	{ path: "pipelines", name: "pipelines", kind: "folder" },
	{
		path: "src",
		name: "src",
		kind: "folder",
		children: [
			{
				path: "src/components",
				name: "components",
				kind: "folder",
				children: [
					{
						path: "src/components/AI/AIAssistantPanel.tsx",
						name: "AIAssistantPanel.tsx",
						kind: "file",
						modified: true,
					},
					{ path: "src/components/AI/types.ts", name: "types.ts", kind: "file" },
				],
			},
		],
	},
	{ path: "pipeline.yaml", name: "pipeline.yaml", kind: "file" },
	{ path: "README.md", name: "README.md", kind: "file" },
]

const pipeline: PipelineStep[] = [
	{ id: "plan", label: "plan", agent: "OpenAI", duration: "2s", status: "done" },
	{ id: "crawl", label: "crawl", agent: "DeepSeek", duration: "5s", status: "done" },
	{ id: "patch", label: "patch", agent: "Kimi", duration: "1s", status: "done" },
	{ id: "approval", label: "approval", duration: "4m", status: "approval" },
	{ id: "tests", label: "tests", status: "pending" },
	{ id: "deploy", label: "deploy", status: "pending" },
]

const messages: ChatMessage[] = [
	{
		id: "m1",
		role: "agent",
		author: "Kimi",
		meta: "coder · conf 92%",
		time: "10:24 AM",
		content:
			"File-lock patch is queued. You can attach related files (failing test logs, screenshots, spec PDFs, project zips) and I will factor them into the next decision.",
	},
	{
		id: "m2",
		role: "user",
		author: "You",
		time: "10:25 AM",
		content: "Here are the failing logs and screenshot.",
		attachments: [
			{ id: "a1", filename: "error.log", type: "LOG", size: "12 KB" },
			{ id: "a2", filename: "screenshot.png", type: "PNG", size: "420 KB" },
			{ id: "a3", filename: "test-output.txt", type: "TXT", size: "8 KB" },
		],
	},
	{
		id: "m3",
		role: "agent",
		author: "Kimi",
		meta: "coder · conf 94%",
		time: "10:26 AM",
		content:
			"Thanks. Analyzing the logs...\n\n• Redis connection timeout detected\n• Concurrent write detected at queue.ts:128\n• Lock not acquired in worker.ts:45\n\nRecommended: Add mutex lock with 5s timeout.",
	},
]

const code = `const AIAssistantPanel = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const onSend = async () => {
    setMessages(m => [...m, { role: 'user', content: input }]);
    const res = await sendMessage(input);
    setMessages(m => [...m, res]);
  };

  return (
    <div className="assistant-panel">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400" />
          <h2>AI Assistant</h2>
          <span className="badge badge-success">routed</span>
        </div>
      </header>
    </div>
  );
};`

// ─── Pipeline icon helper ─────────────────────────────────────────────────

function PipelineIcon({ status }: { status: string }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={14} className="text-green-400" />
		case "running":
			return <Loader2 size={14} className="text-blue-400 animate-spin" />
		case "approval":
			return <AlertTriangle size={14} className="text-yellow-400" />
		case "blocked":
			return <XCircle size={14} className="text-red-400" />
		case "failed":
			return <XCircle size={14} className="text-red-400" />
		default:
			return <Clock size={14} className="text-gray-500" />
	}
}

// ─── FileTree component ───────────────────────────────────────────────────

function FileTree({ items, depth = 0 }: { items: WorkspaceFile[]; depth?: number }) {
	return (
		<>
			{items.map((item) => (
				<div key={item.path}>
					<div
						className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors hover:bg-[#1e2535] ${item.modified ? "text-violet-300" : "text-gray-400"}`}
						style={{ paddingLeft: `${10 + depth * 14}px` }}>
						{item.kind === "folder" ? (
							<Folder size={14} className="text-yellow-500" />
						) : (
							<FileText size={14} className="text-blue-400" />
						)}
						<span>{item.name}</span>
						{item.modified && <span className="ml-auto text-[10px] font-bold text-orange-400">M</span>}
					</div>
					{item.children && <FileTree items={item.children} depth={depth + 1} />}
				</div>
			))}
		</>
	)
}

// ─── Main component ───────────────────────────────────────────────────────

export default function IdeTerminalView() {
	const [input, setInput] = useState("")
	const [pasteAttachments] = useState<ChatAttachment[]>([])

	const handleSend = useCallback(() => {
		if (input.trim()) {
			setInput("")
		}
	}, [input])

	return (
		<div
			className="superroo-shell flex h-full bg-[#070b14] text-[#e2e8f0]"
			style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
			{/* Activity Bar */}
			<aside className="flex flex-col items-center gap-2 py-3 px-1.5 bg-[#0a0e1a] border-r border-[#1e2535] shrink-0 w-12">
				<Bot size={20} className="text-violet-400" />
				<div className="w-4 h-px bg-[#1e2535]" />
				<Code2 size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Search size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<GitBranch size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Play size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Boxes size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<div className="flex-1" />
				<User size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
				<Settings size={18} className="text-gray-500 hover:text-[#e2e8f0] cursor-pointer" />
			</aside>

			{/* Sidebar */}
			<aside className="w-56 shrink-0 border-r border-[#1e2535] bg-[#0a0e1a] overflow-y-auto flex flex-col">
				<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
					<span className="text-[10px] font-semibold text-gray-500 tracking-wider">WORKSPACE</span>
					<button className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300">
						<Plus size={12} /> Import
					</button>
				</div>
				<div className="px-3 py-1.5 text-xs text-gray-400 border-b border-[#1e2535]">superroo2</div>
				<div className="flex-1 py-1">
					<FileTree items={files} />
				</div>
				<div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 tracking-wider border-t border-[#1e2535]">
					OPEN EDITORS
				</div>
				<div className="flex items-center gap-1.5 px-3 py-1 text-xs text-violet-300 bg-violet-600/10">
					<FileText size={14} className="text-blue-400" />
					<span>AIAssistantPanel.tsx</span>
					<span className="ml-auto text-[10px] font-bold text-orange-400">M</span>
				</div>
				<div className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-400">
					<FileText size={14} className="text-blue-400" />
					<span>pipeline.yaml</span>
				</div>

				{/* Context Card */}
				<div className="mx-3 my-2 p-2 rounded-lg bg-[#0f1117] border border-[#1e2535] text-[10px] space-y-1">
					<div className="text-gray-500">
						Branch <span className="text-[#e2e8f0] font-semibold">auto-improvement</span>
					</div>
					<div className="text-gray-500">
						Last agent <span className="text-violet-400 font-semibold">Kimi</span>
					</div>
					<div className="text-gray-500">
						Last edited <span className="text-[#e2e8f0]">AIAssistantPanel.tsx</span>
					</div>
					<div className="text-gray-500">
						Last failure <span className="text-red-400">parallel-write test</span>
					</div>
					<div className="text-gray-500">
						Learned fix <span className="text-green-400">file-lock added</span>
					</div>
				</div>
			</aside>

			{/* Main workspace */}
			<main className="flex flex-col flex-1 min-w-0">
				{/* Top bar */}
				<header className="flex items-center justify-between px-4 py-2 border-b border-[#1e2535] bg-[#0a0e1a] shrink-0">
					<div>
						<h1 className="text-sm font-bold text-[#e2e8f0]">SuperRoo</h1>
						<p className="text-[10px] text-gray-500">superroo2 · auto-improvement</p>
					</div>
					<div className="flex items-center gap-3 text-[10px] text-gray-500">
						<span className="flex items-center gap-1">
							<span className="w-1.5 h-1.5 rounded-full bg-green-500" /> healthy
						</span>
						<span className="text-gray-600">|</span>
						<span>
							loop <b className="text-[#e2e8f0]">#841</b>
						</span>
						<span className="text-gray-600">|</span>
						<span>
							phase <b className="text-yellow-400">approval</b>
						</span>
						<span className="text-gray-600">|</span>
						<span>
							agent <b className="text-violet-400">Kimi</b>
						</span>
						<span className="text-gray-600">|</span>
						<span className="px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400 font-semibold">3</span>
						<span>pending</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[10px] text-gray-500">AUTONOMY</span>
						<button className="px-2 py-0.5 text-[10px] rounded bg-[#1e2535] text-gray-300 hover:bg-[#2a3347]">
							balanced
						</button>
						<button className="p-1 rounded bg-[#1e2535] text-gray-300 hover:bg-[#2a3347]">
							<Play size={12} />
						</button>
						<button className="px-2 py-0.5 text-[10px] rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
							Ask (⌘K)
						</button>
						<Bell size={14} className="text-gray-500 cursor-pointer" />
						<div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-[10px] font-bold text-white">
							K
						</div>
					</div>
				</header>

				{/* Work grid */}
				<section className="flex flex-1 min-h-0">
					{/* Center pane */}
					<section className="flex flex-col flex-1 min-w-0">
						{/* Pipeline bar */}
						<div className="flex items-center gap-2 px-3 py-1.5 bg-[#0f1117] border-b border-[#1e2535] overflow-x-auto shrink-0">
							<div className="flex items-center gap-2 text-[10px] text-gray-500 mr-2">
								Active pipeline <small className="text-gray-600">task #841 · 8s</small>
							</div>
							{pipeline.map((s, i) => (
								<div key={s.id} className="flex items-center gap-1.5">
									<div
										className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
											s.status === "done"
												? "bg-green-600/20 text-green-300"
												: s.status === "running"
													? "bg-blue-600/20 text-blue-300"
													: s.status === "approval"
														? "bg-yellow-600/20 text-yellow-300"
														: "text-gray-500"
										}`}>
										<PipelineIcon status={s.status} />
										<strong>
											{s.status === "done" ? "✓ " : s.status === "approval" ? "Ⅱ " : ""}
											{s.label}
										</strong>
										<small className="text-gray-500 ml-1">
											{s.duration || "—"} · {s.agent || ""}
										</small>
									</div>
									{i < pipeline.length - 1 && <ChevronRight size={10} className="text-gray-600" />}
								</div>
							))}
						</div>

						{/* Editor card */}
						<div className="flex flex-col flex-1 m-2 rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden">
							<div className="flex items-center gap-0.5 px-2 py-1 bg-[#0f1117] border-b border-[#1e2535] overflow-x-auto shrink-0">
								<span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-t bg-[#0a0e1a] border-t border-x border-[#1e2535] text-[#e2e8f0]">
									<Code2 size={12} /> AIAssistantPanel.tsx{" "}
									<span className="text-orange-400 font-bold ml-1">M</span>
								</span>
								<span className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-500">
									pipeline.yaml
								</span>
								<span className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-500">
									worker.ts
								</span>
								<button className="ml-auto p-0.5 text-gray-500 hover:text-gray-300">
									<Plus size={12} />
								</button>
							</div>
							<div className="flex-1 overflow-auto">
								<pre className="p-4 font-mono text-xs leading-relaxed text-green-400 overflow-auto h-full">
									{code}
								</pre>
							</div>
						</div>

						{/* Bottom split: Terminal + Debugger */}
						<div className="flex gap-2 m-2 mt-0 shrink-0" style={{ height: 160 }}>
							{/* Terminal */}
							<div className="flex-1 rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden flex flex-col">
								<div className="flex items-center gap-0.5 px-2 py-1 bg-[#0f1117] border-b border-[#1e2535] shrink-0">
									<span className="px-2 py-0.5 text-[10px] rounded-t bg-[#0a0e1a] border-t border-x border-[#1e2535] text-[#e2e8f0]">
										TERMINAL
									</span>
									<span className="px-2 py-0.5 text-[10px] text-gray-500">
										PROBLEMS <b className="text-red-400">2</b>
									</span>
									<span className="px-2 py-0.5 text-[10px] text-gray-500">TESTS</span>
								</div>
								<pre className="flex-1 p-2 font-mono text-[10px] leading-relaxed text-green-400 overflow-y-auto">{`superroo@ide ~/superroo2 (auto-improvement)
$ pnpm test

PASS tests/file-lock.test.ts
PASS tests/parallel-write.test.ts

Tests: 2 passed (2)
Time: 1.24s

$ ▌`}</pre>
							</div>

							{/* Debug card */}
							<div className="w-56 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2 flex flex-col shrink-0">
								<div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1">
									<Cpu size={12} /> AI Debugger <small className="text-gray-600">beta</small>
								</div>
								<h4 className="text-[10px] font-semibold text-[#e2e8f0] mb-0.5">Failure analysis</h4>
								<p className="text-[10px] text-gray-400 mb-0.5">
									<b className="text-red-400">parallel-write test</b> failed intermittently.
								</p>
								<p className="text-[10px] text-gray-400 mb-0.5">
									Likely cause: race condition on file lock.
								</p>
								<p className="text-[10px] text-gray-400 mb-1">Confidence: 87%</p>
								<div className="flex gap-1 mt-auto">
									<button className="px-2 py-0.5 text-[10px] rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
										Apply Fix
									</button>
									<button className="px-2 py-0.5 text-[10px] rounded text-gray-500 hover:text-gray-300">
										View details
									</button>
								</div>
							</div>
						</div>
					</section>

					{/* Assistant pane (right sidebar) */}
					<aside className="w-72 shrink-0 border-l border-[#1e2535] bg-[#0a0e1a] flex flex-col">
						{/* Assistant header */}
						<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
							<div>
								<h2 className="text-xs font-semibold text-[#e2e8f0]">AI Assistant</h2>
								<p className="text-[10px] text-gray-500">
									current: <b className="text-violet-400">Kimi</b> · phase{" "}
									<b className="text-yellow-400">approval</b>
								</p>
							</div>
							<span className="text-[10px] text-green-400 flex items-center gap-1">
								<span className="w-1.5 h-1.5 rounded-full bg-green-500" /> routed
							</span>
						</div>

						{/* Mode buttons */}
						<div className="flex gap-0.5 px-2 py-1.5 border-b border-[#1e2535] overflow-x-auto">
							{["Auto", "Plan", "Code", "Debug", "Review", "Crawl"].map((mode) => (
								<button
									key={mode}
									className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
										mode === "Auto"
											? "bg-violet-600/20 text-violet-400"
											: "text-gray-500 hover:text-gray-300 hover:bg-[#1e2535]"
									}`}>
									{mode}
								</button>
							))}
						</div>

						{/* Conversation */}
						<div className="flex-1 overflow-y-auto p-2 space-y-2">
							{messages.map((m) => (
								<div key={m.id} className="p-2 rounded-lg bg-[#0f1117] border border-[#1e2535]">
									<div className="flex items-center gap-1.5 mb-1">
										<span
											className={`text-[10px] font-semibold ${
												m.role === "user"
													? "text-violet-300"
													: m.role === "agent"
														? "text-orange-300"
														: "text-blue-300"
											}`}>
											{m.author}
										</span>
										{m.meta && <span className="text-[9px] text-gray-500">· {m.meta}</span>}
										<span className="ml-auto text-[9px] text-gray-600">{m.time}</span>
									</div>
									<p className="text-[10px] text-gray-400 leading-relaxed whitespace-pre-wrap">
										{m.content}
									</p>
									{m.attachments && (
										<div className="mt-1 space-y-0.5">
											{m.attachments.map((a) => (
												<div
													key={a.id}
													className="flex items-center gap-1 text-[9px] text-gray-500">
													<FileText size={10} />
													<span>{a.filename}</span>
													<span className="ml-auto">
														{a.type} · {a.size}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>

						{/* Context pills */}
						<div className="flex items-center gap-1 px-2 py-1 border-t border-[#1e2535] overflow-x-auto">
							<span className="text-[9px] text-gray-600 mr-1">Context</span>
							{["3 files", "logs", "tests", "diff", "memory"].map((pill) => (
								<button
									key={pill}
									className="px-1.5 py-0.5 text-[9px] rounded bg-[#1e2535] text-gray-400 hover:bg-[#2a3347]">
									{pill}
								</button>
							))}
						</div>

						{/* Paste capture */}
						{pasteAttachments.length > 0 && (
							<div className="flex items-center gap-1 px-2 py-1 bg-yellow-600/10 border-t border-yellow-600/20 text-[9px] text-yellow-400">
								<UploadCloud size={12} /> Smart paste captured {pasteAttachments.length} item(s)
							</div>
						)}

						{/* Chat input */}
						<div className="border-t border-[#1e2535] bg-[#0f1117]">
							<textarea
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="Ask SuperRoo...&#10;Paste logs, images, files or @ to mention"
								className="w-full bg-transparent border-none outline-none resize-none text-[10px] text-[#e2e8f0] placeholder-gray-600 p-2"
								rows={3}
							/>
							<div className="flex items-center justify-between px-2 pb-2">
								<div className="flex items-center gap-1">
									<Paperclip size={12} className="text-gray-500 cursor-pointer hover:text-gray-300" />
									<Image size={12} className="text-gray-500 cursor-pointer hover:text-gray-300" />
									<Code2 size={12} className="text-gray-500 cursor-pointer hover:text-gray-300" />
									<Terminal size={12} className="text-gray-500 cursor-pointer hover:text-gray-300" />
									<Mic size={12} className="text-gray-500 cursor-pointer hover:text-gray-300" />
								</div>
								<button
									onClick={handleSend}
									className="p-1 rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/30">
									<Send size={14} />
								</button>
							</div>
						</div>
					</aside>
				</section>

				{/* Bottom dock */}
				<footer className="flex items-center gap-4 px-3 py-1.5 bg-[#0f1117] border-t border-[#1e2535] text-[10px] text-gray-500 shrink-0 overflow-x-auto">
					<div className="flex items-center gap-1 shrink-0">
						<Bot size={12} /> PIPELINE <b className="text-[#e2e8f0]">task #841 · approval</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Cpu size={12} /> AGENTS <b className="text-[#e2e8f0]">4 running</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Database size={12} /> MEMORY <b className="text-[#e2e8f0]">32 items</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<Boxes size={12} /> OBSERVABILITY <b className="text-[#e2e8f0]">92.4% success</b>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<UploadCloud size={12} /> DEPLOYMENTS <b className="text-[#e2e8f0]">27 ↑</b>
					</div>
					<button className="shrink-0 text-gray-600 hover:text-gray-400">+ Add panel</button>
				</footer>

				{/* Status bar */}
				<div className="flex items-center gap-3 px-3 py-1 bg-[#0a0e1a] border-t border-[#1e2535] text-[10px] text-gray-500 shrink-0">
					<span className="text-green-400">auto-improvement*</span>
					<span className="text-gray-600">·</span>
					<span className="flex items-center gap-1">
						<span className="w-1 h-1 rounded-full bg-green-500" /> Connected
					</span>
					<span className="text-gray-600">·</span>
					<span>Docker: running</span>
					<span className="text-gray-600">·</span>
					<span>Redis: ok</span>
					<span className="text-gray-600">·</span>
					<span>CPU 12%</span>
					<span className="text-gray-600">·</span>
					<span>RAM 48%</span>
					<span className="ml-auto">Ln 134, Col 21</span>
					<span className="text-gray-600">·</span>
					<span>TypeScript JSX</span>
					<span className="text-gray-600">·</span>
					<span>Prettier</span>
				</div>
			</main>
		</div>
	)
}
