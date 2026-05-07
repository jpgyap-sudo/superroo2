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
import { LogsView } from "@/components/views/logs"
import { DockerView } from "@/components/views/docker"
import { WorkingTreeView } from "@/components/views/working-tree"
import { ApiKeysView } from "@/components/views/api-keys"
import { SettingsView } from "@/components/views/settings"
import { GitHubView } from "@/components/views/github"
import ModelRouterView from "@/components/views/model-router"
import IdeTerminalView from "@/components/views/ide-terminal"
import { ProjectsView } from "@/components/views/projects"
import { LoginPage } from "@/components/auth/login"

const PAGES: Record<string, React.FC> = {
	overview: Overview,
	"working-tree": WorkingTreeView,
	jobs: JobsView,
	queue: QueueView,
	agents: AgentsView,
	"skill-generator": SkillGeneratorView,
	logs: LogsView,
	docker: DockerView,
	"api-keys": ApiKeysView,
	settings: SettingsView,
	ai: AiAssistantView,
	"model-router": ModelRouterView,
	github: GitHubView,
	"ide-terminal": IdeTerminalView,
	projects: ProjectsView,
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
			"skill-generator": "Skill Generator",
			logs: "Logs",
			docker: "Docker Sandbox",
			"api-keys": "API Keys",
			settings: "Settings",
			ai: "AI Assistant",
			github: "GitHub",
			"ide-terminal": "IDE Terminal",
			projects: "Projects",
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
				<div className="flex h-12 shrink-0 items-center gap-4 border-b border-[#1e2535] bg-[#0a0e1a] px-5 md:px-5 pl-14 md:pl-5">
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
					</div>
					<div className="ml-auto flex items-center gap-3">
						<Badge status="warning" label="1 pending approval" />
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
