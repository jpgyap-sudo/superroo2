"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { Badge } from "@/components/ui/badge"
import { Overview } from "@/components/views/overview"
import { JobsView } from "@/components/views/jobs"
import { QueueView } from "@/components/views/queue"
import { AgentsView } from "@/components/views/agents"
import { AiAssistantView } from "@/components/views/ai-assistant"
import { SkillGeneratorView } from "@/components/views/skill-generator"
import { BugsView } from "@/components/views/bugs"
import { HealingView } from "@/components/views/healing"
import { MonitoringView } from "@/components/views/monitoring"
import { LogsView } from "@/components/views/logs"
import { DockerView } from "@/components/views/docker"
import { WorkingTreeView } from "@/components/views/working-tree"
import { ApprovalsView } from "@/components/views/approvals"
import { ApiKeysView } from "@/components/views/api-keys"
import { SettingsView } from "@/components/views/settings"
import { GitHubView } from "@/components/views/github"
import ModelRouterView from "@/components/views/model-router"
import IdeTerminalView from "@/components/views/ide-terminal"
import { ProjectsView } from "@/components/views/projects"
import { TelegramView } from "@/components/views/telegram"
import { DeployView } from "@/components/views/deploy"
import { AutoDeployView } from "@/components/views/auto-deploy"
import { CommitDeployView } from "@/components/views/commit-deploy"
import { DebugTeamView } from "@/components/views/debug-team"
import { BrainView } from "@/components/views/brain"
import { IntelligenceLayerView } from "@/components/views/intelligence-layer"
import WorkflowComplianceView from "@/components/views/workflow-compliance"
import OllamaGrowthView from "@/components/views/ollama-growth"
import { MemoryExplorerView } from "@/components/views/memory-explorer"
import { VisualCrawlerView } from "@/components/views/visual-crawler"
import { ParallelExecutionView } from "@/components/views/parallel-execution"
import { AutonomousLoopView } from "@/components/views/autonomous-loop"
import { CommissioningLoopView } from "@/components/views/commissioning-loop"
import { HermesClawView } from "@/components/views/hermes-claw"
import { DeployOrchestratorView } from "@/components/views/deploy-orchestrator"
import { MLEngineView } from "@/components/views/ml-engine"
import { ProductMemoryView } from "@/components/views/product-memory"
import { LoginPage } from "@/components/auth/login"

const PAGES: Record<string, React.FC> = {
	overview: Overview,
	"working-tree": WorkingTreeView,
	jobs: JobsView,
	queue: QueueView,
	agents: AgentsView,
	bugs: BugsView,
	healing: HealingView,
	monitoring: MonitoringView,
	"workflow-compliance": WorkflowComplianceView,
	"skill-generator": SkillGeneratorView,
	logs: LogsView,
	docker: DockerView,
	approvals: ApprovalsView,
	"api-keys": ApiKeysView,
	settings: SettingsView,
	ai: AiAssistantView,
	"model-router": ModelRouterView,
	github: GitHubView,
	"ide-terminal": IdeTerminalView,
	projects: ProjectsView,
	telegram: TelegramView,
	deploy: DeployView,
	"auto-deploy": AutoDeployView,
	"commit-deploy": CommitDeployView,
	"debug-team": DebugTeamView,
	"intelligence-layer": IntelligenceLayerView,
	brain: BrainView,
	"ollama-growth": OllamaGrowthView,
	"memory-explorer": MemoryExplorerView,
	"visual-crawler": VisualCrawlerView,
	"parallel-execution": ParallelExecutionView,
	"autonomous-loop": AutonomousLoopView,
	"commissioning-loop": CommissioningLoopView,
	"hermes-claw": HermesClawView,
	"deploy-orchestrator": DeployOrchestratorView,
	"ml-engine": MLEngineView,
	"product-memory": ProductMemoryView,
}

function StatusDot({ online }: { online: boolean }) {
	return (
		<div
			className="h-[7px] w-[7px] rounded-full shrink-0"
			style={{
				background: online ? "#22c55e" : "#ef4444",
				boxShadow: online ? "0 0 6px #22c55e" : "none",
			}}
		/>
	)
}

export default function Dashboard() {
	const [page, setPage] = useState("overview")
	const [pageInitialized, setPageInitialized] = useState(false)
	const [health, setHealth] = useState<any>(null)
	const [time, setTime] = useState("")
	const [authenticated, setAuthenticated] = useState<boolean | null>(null)

	useEffect(() => {
		const tick = () => setTime(new Date().toLocaleTimeString())
		tick()
		const iv = setInterval(tick, 1000)
		return () => clearInterval(iv)
	}, [])

	// Check authentication on mount
	useEffect(() => {
		const token = localStorage.getItem("superroo_auth_token")
		if (token) {
			setAuthenticated(true)
		} else {
			setAuthenticated(false)
		}
	}, [])

	// Sync page state with URL query param for direct linking and E2E tests
	useEffect(() => {
		if (typeof window === "undefined") return
		const params = new URLSearchParams(window.location.search)
		const pageParam = params.get("page")
		if (pageParam && PAGES[pageParam]) {
			setPage(pageParam)
		}
		setPageInitialized(true)
	}, [])

	useEffect(() => {
		if (typeof window === "undefined" || !pageInitialized) return
		const params = new URLSearchParams(window.location.search)
		if (params.get("page") !== page) {
			params.set("page", page)
			window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`)
		}
	}, [page, pageInitialized])

	// Register service worker for PWA
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch(() => {
				// Service worker registration failed — non-critical
			})
		}
	}, [])

	// Listen for custom navigation events (e.g., from Settings → API Keys link)
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent).detail
			if (detail && typeof detail === "string") {
				setPage(detail)
			}
		}
		window.addEventListener("navigate", handler)
		return () => window.removeEventListener("navigate", handler)
	}, [])

	useEffect(() => {
		fetch("/api/health")
			.then((r) => r.json())
			.then(setHealth)
			.catch(() => setHealth({ status: "offline" }))
		const iv = setInterval(() => {
			fetch("/api/health")
				.then((r) => r.json())
				.then(setHealth)
				.catch(() => setHealth({ status: "offline" }))
		}, 10000)
		return () => clearInterval(iv)
	}, [])

	const PageComponent = PAGES[page] || Overview
	const pageLabel =
		{
			overview: "Overview",
			"working-tree": "Working Tree",
			jobs: "Jobs",
			queue: "Queue",
			agents: "Agents",
			bugs: "Bugs",
			healing: "Healing",
			monitoring: "Monitoring",
			"skill-generator": "Skill Generator",
			logs: "Logs",
			docker: "Docker Sandbox",
			approvals: "Approvals",
			"api-keys": "API Keys",
			settings: "Settings",
			ai: "AI Assistant",
			github: "GitHub",
			"ide-terminal": "IDE Terminal",
			projects: "Projects",
			telegram: "Telegram",
			deploy: "Deploy",
			"auto-deploy": "Auto Deploy",
			"commit-deploy": "Commits",
			"debug-team": "Debug Team",
			brain: "Central Brain",
			"intelligence-layer": "Intelligence Layer",
			"workflow-compliance": "Compliance",
			"ollama-growth": "Ollama Growth",
			"memory-explorer": "Memory Explorer",
			"parallel-execution": "Parallel Execution",
			"autonomous-loop": "Autonomous Loop",
			"commissioning-loop": "Commissioning Loop",
			"deploy-orchestrator": "Deploy Orchestrator",
			"hermes-claw": "Hermes Claw",
			"ml-engine": "ML Engine",
			"product-memory": "Product Memory",
		}[page] || page

	// Show login page while checking auth or if not authenticated
	if (authenticated === null) {
		return (
			<div className="flex h-screen items-center justify-center bg-[#070b14]">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
			</div>
		)
	}

	if (!authenticated) {
		return <LoginPage onLogin={() => setAuthenticated(true)} />
	}

	return (
		<div className="flex h-screen overflow-hidden bg-[#070b14] text-[#e2e8f0]">
			<Sidebar page={page} setPage={setPage} />

			<div className="flex flex-1 flex-col overflow-hidden min-w-0">
				{/* Header — responsive: hide status dots on very small screens */}
				<div className="flex h-12 shrink-0 items-center gap-2 sm:gap-4 border-b border-[#1e2535] bg-[#0a0e1a] px-3 sm:px-5 pl-14 md:pl-5">
					<div className="flex items-center gap-3 max-sm:hidden">
						<div className="flex items-center gap-1.5">
							<StatusDot online={health?.status === "online"} />
							<span className="text-[11px] text-gray-500">API</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot online={health?.worker !== false} />
							<span className="text-[11px] text-gray-500">Worker</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot online={health?.redis !== false} />
							<span className="text-[11px] text-gray-500">Redis</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot online={true} />
							<span className="text-[11px] text-gray-500">Docker</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot online={health?.ollama?.ok === true} />
							<span className="text-[11px] text-gray-500">Ollama</span>
						</div>
					</div>
					<div className="ml-auto flex items-center gap-2 sm:gap-3">
						<div className="max-sm:hidden">
							<Badge status="warning" label="1 pending approval" />
						</div>
						<span className="text-[11px] text-gray-700">{time}</span>
					</div>
				</div>

				{/* Content — responsive padding */}
				<div className="flex-1 overflow-y-auto p-3 sm:p-5">
					<div className="mb-4 flex items-center justify-between">
						<h1 className="text-base sm:text-lg font-semibold">{pageLabel}</h1>
					</div>
					<PageComponent />
				</div>
			</div>
		</div>
	)
}
