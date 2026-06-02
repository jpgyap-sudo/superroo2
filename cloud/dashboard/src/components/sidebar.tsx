"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
	LayoutDashboard,
	Zap,
	Layers,
	FolderGit2,
	Bot,
	Bug,
	ScrollText,
	Container,
	Github,
	ShieldCheck,
	Send,
	Settings,
	Sparkles,
	ChevronLeft,
	ChevronRight,
	Wand2,
	Workflow,
	KeyRound,
	SlidersHorizontal,
	BrainCircuit,
	Terminal,
	Menu,
	X,
	Rocket,
	HeartPulse,
	Activity,
	GitCommit,
	CheckCircle,
	Database,
	Eye,
	RotateCcw,
	ClipboardCheck,
	Cpu,
	Package,
	MemoryStick,
	GitBranch,
	Users,
	Radio,
	Server,
	Box,
	BookMarked,
	Search as SearchIcon,
	Upload,
	History,
	ShieldAlert,
	Network,
} from "lucide-react"

const NAV = [
	{ id: "overview", icon: LayoutDashboard, label: "Overview" },
	{ id: "provider-dashboard", icon: Radio, label: "Providers" },
	{ id: "working-tree", icon: Workflow, label: "Working Tree" },
	{ id: "flowcharts", icon: GitBranch, label: "Flowcharts" },
	{ id: "extension-sync", icon: Network, label: "Extension Sync" },
	{ id: "jobs", icon: Zap, label: "Jobs" },
	{ id: "queue", icon: Layers, label: "Queue" },
	{ id: "projects", icon: FolderGit2, label: "Projects" },
	{ id: "agents", icon: Bot, label: "Agents" },
	{ id: "skill-generator", icon: Wand2, label: "Skill Generator" },
	{ id: "bugs", icon: Bug, label: "Bugs" },
	{ id: "healing", icon: HeartPulse, label: "Healing" },
	{ id: "monitoring", icon: Activity, label: "Monitoring" },
	{ id: "workflow-compliance", icon: CheckCircle, label: "Compliance" },
	{ id: "logs", icon: ScrollText, label: "Logs" },
	{ id: "docker", icon: Container, label: "Docker" },
	{ id: "github", icon: Github, label: "GitHub" },
	{ id: "approvals", icon: ShieldCheck, label: "Approvals" },
	{ id: "telegram", icon: Send, label: "Telegram" },
	{ id: "model-router", icon: BrainCircuit, label: "Model Router" },
	{ id: "api-keys", icon: KeyRound, label: "API Keys" },
	{ id: "settings", icon: SlidersHorizontal, label: "Settings" },
	{ id: "ai", icon: Sparkles, label: "AI Assistant" },
	{ id: "ide-terminal", icon: Terminal, label: "IDE Terminal" },
	{ id: "deploy", icon: Rocket, label: "Deploy" },
	{ id: "auto-deploy", icon: Rocket, label: "Auto Deploy" },
	{ id: "commit-deploy", icon: GitCommit, label: "Commits" },
	{ id: "debug-team", icon: Bug, label: "Debug Team" },
	{ id: "intelligence-layer", icon: BrainCircuit, label: "Intelligence Layer" },
	{ id: "brain", icon: BrainCircuit, label: "Central Brain" },
	{ id: "ollama-growth", icon: BrainCircuit, label: "Ollama Growth" },
	{ id: "memory-explorer", icon: Database, label: "Memory Explorer" },
	{ id: "visual-crawler", icon: Eye, label: "Visual Crawler" },
	{ id: "parallel-execution", icon: Layers, label: "Parallel Execution" },
	{ id: "autonomous-loop", icon: RotateCcw, label: "Autonomous Loop" },
	{ id: "commissioning-loop", icon: ClipboardCheck, label: "Commissioning" },
	{ id: "hermes-claw", icon: Bot, label: "Hermes Claw" },
	{ id: "deploy-orchestrator", icon: Rocket, label: "Deploy Orchestrator" },
	{ id: "ml-engine", icon: Cpu, label: "ML Engine" },
	{ id: "ram-orchestrator", icon: MemoryStick, label: "RAM Orchestrator" },
	{ id: "product-memory", icon: Package, label: "Product Memory" },
	{ id: "task-timeline", icon: GitBranch, label: "Task Timeline" },
	{ id: "collaboration", icon: Users, label: "Collaboration" },
	{ id: "mcp-servers", icon: Server, label: "MCP Servers" },
	{ id: "sandbox", icon: Box, label: "Sandbox" },
	{ id: "features", icon: BookMarked, label: "Features" },
	{ id: "crawler", icon: SearchIcon, label: "Crawler" },
	{ id: "file-importer", icon: Upload, label: "File Importer" },
	{ id: "savepoints", icon: History, label: "Savepoints" },
	{ id: "events", icon: Activity, label: "Events" },
	{ id: "build-queue", icon: Layers, label: "Build Queue" },
	{ id: "predictive-risk", icon: ShieldAlert, label: "Predictive Risk" },
]

export function Sidebar({ page, setPage }: { page: string; setPage: (p: string) => void }) {
	const [collapsed, setCollapsed] = useState(false)
	const [mobileOpen, setMobileOpen] = useState(false)

	// Close mobile sidebar when a nav item is clicked
	const handleNav = (id: string) => {
		setPage(id)
		setMobileOpen(false)
	}

	// Close mobile sidebar on Escape
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMobileOpen(false)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	return (
		<>
			{/* Mobile hamburger button — visible only on small screens */}
			<button
				onClick={() => setMobileOpen(true)}
				className="fixed left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-[#0a0e1a] border border-[#1e2535] text-gray-400 hover:text-[#e2e8f0] active:scale-95 md:hidden"
				aria-label="Open menu">
				<Menu className="h-5 w-5" />
			</button>

			{/* Mobile overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			{/* Mobile drawer */}
			<aside
				className={cn(
					"fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[#1e2535] bg-[#0a0e1a] transition-transform duration-300 md:static md:z-auto md:transition-all",
					mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
					collapsed ? "md:w-14" : "md:w-56",
				)}>
				{/* Header — product branding */}
				<div
					className="flex items-center gap-2 border-b border-[#1e2535] px-3 py-3 cursor-pointer select-none"
					onClick={() => {
						if (window.innerWidth < 768) {
							setMobileOpen(false)
						} else {
							setCollapsed(!collapsed)
						}
					}}>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-600/20 shrink-0">
						<Sparkles className="h-4 w-4" />
					</div>
					{!collapsed && (
						<div className="min-w-0 flex-1">
							<span className="text-sm font-bold text-[#e2e8f0]">SuperRoo</span>
							<p className="text-[10px] text-gray-600 leading-tight">AI Agent Cloud</p>
						</div>
					)}
					{/* Close button on mobile — larger touch target */}
					<button
						onClick={(e) => {
							e.stopPropagation()
							setMobileOpen(false)
						}}
						className="ml-auto flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:text-[#e2e8f0] active:scale-95 md:hidden"
						aria-label="Close menu">
						<X className="h-5 w-5" />
					</button>
					{/* Collapse toggle on desktop */}
					<div className="ml-auto hidden md:block">
						{collapsed ? (
							<ChevronRight className="h-4 w-4 text-gray-500" />
						) : (
							<ChevronLeft className="h-4 w-4 text-gray-500" />
						)}
					</div>
				</div>

				{/* Navigation — larger touch targets on mobile */}
				<nav className="flex-1 overflow-y-auto py-2">
					{NAV.map((n) => {
						const Icon = n.icon
						const active = page === n.id
						return (
							<button
								key={n.id}
								onClick={() => handleNav(n.id)}
								className={cn(
									"flex w-full items-center gap-3 px-3 py-3 md:py-2.5 text-sm transition-colors active:scale-[0.98]",
									active
										? "border-l-2 border-violet-600 bg-violet-600/10 text-violet-300"
										: "border-l-2 border-transparent text-gray-500 hover:bg-[#0f1117] hover:text-[#e2e8f0]",
								)}>
								<Icon className="h-4 w-4 shrink-0" />
								{!collapsed && <span>{n.label}</span>}
							</button>
						)
					})}
				</nav>

				{/* Version footer */}
				{!collapsed && (
					<div className="border-t border-[#1e2535] px-3 py-2">
						<div className="flex items-center gap-2 text-[10px] text-gray-700">
							<span className="rounded bg-violet-600/10 px-1.5 py-0.5 text-[9px] text-violet-400 font-medium">
								v2.0.0
							</span>
							<span>Cloud Console</span>
						</div>
					</div>
				)}
			</aside>
		</>
	)
}
