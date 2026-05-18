"use client"

import { useEffect, useState, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	GitBranch,
	GitCommit,
	GitPullRequest,
	Activity,
	AlertTriangle,
	CheckCircle,
	XCircle,
	Clock,
	Rocket,
	Layers,
	Bot,
	Shield,
	FileCode,
	ArrowUpRight,
	FolderGit2,
	Code2,
	Users,
	ExternalLink,
	Search,
	RefreshCw,
	Globe,
	Terminal,
	BookOpen,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectInfo {
	id: string
	name: string
	repoName: string
	branch: string
	status: string
	language: string | null
	localPath: string | null
	repoUrl: string | null
	lastActivityAt: string | null
	isActive: boolean
	activeFile: string | null
	currentTask: string | null
	activeAgent: string | null
	lastSyncAt: string | null
	totalCommits: number
	totalDeploys: number
	healthyDeploys: number
	failedDeploys: number
	lastCommit: { message: string; author: string; time: string; sha: string } | null
	lastDeploy: { status: string; environment: string; time: string; version: string } | null
	deploySuccessRate: number
}

interface ActivityEvent {
	id: string
	time: string
	agent: string
	role: string
	title: string
	detail: string
	severity: string
}

interface ProjectsApiResponse {
	success: boolean
	data: {
		projects: ProjectInfo[]
		activityEvents: ActivityEvent[]
		currentWorkspace: { repoName: string | null; branch: string | null; workspaceDir: string | null }
		totalProjects: number
		activeProjects: number
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
	switch (status) {
		case "success":
		case "healthy":
		case "synced":
		case "active":
		case "low":
			return "text-emerald-400"
		case "warning":
		case "medium":
		case "degraded":
		case "diverged":
			return "text-amber-400"
		case "failed":
		case "high":
		case "critical":
		case "conflict":
			return "text-red-400"
		default:
			return "text-gray-400"
	}
}

function severityBadge(severity: string): string {
	switch (severity) {
		case "low":
			return "success"
		case "medium":
			return "warning"
		case "high":
		case "critical":
			return "failed"
		default:
			return "idle"
	}
}

function formatTimeAgo(dateStr: string): string {
	if (!dateStr || dateStr === "N/A") return dateStr
	try {
		const date = new Date(dateStr)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffMins = Math.floor(diffMs / 60000)
		if (diffMins < 1) return "just now"
		if (diffMins < 60) return `${diffMins}m ago`
		const diffHours = Math.floor(diffMins / 60)
		if (diffHours < 24) return `${diffHours}h ago`
		const diffDays = Math.floor(diffHours / 24)
		if (diffDays < 30) return `${diffDays}d ago`
		return date.toLocaleDateString()
	} catch {
		return dateStr
	}
}

function getLanguageColor(lang: string | null): string {
	switch ((lang || "").toLowerCase()) {
		case "typescript":
		case "ts":
			return "bg-blue-500/20 text-blue-400"
		case "javascript":
		case "js":
			return "bg-yellow-500/20 text-yellow-400"
		case "python":
		case "py":
			return "bg-green-500/20 text-green-400"
		case "go":
			return "bg-cyan-500/20 text-cyan-400"
		case "rust":
		case "rs":
			return "bg-orange-500/20 text-orange-400"
		case "java":
			return "bg-red-500/20 text-red-400"
		default:
			return "bg-gray-500/20 text-gray-400"
	}
}

// ── Project Card ───────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectInfo }) {
	const deployHealthy = project.lastDeploy?.status === "healthy"
	const deployFailed = project.lastDeploy?.status === "failed"
	const successRate = project.deploySuccessRate

	return (
		<div
			className={`rounded-xl border bg-gradient-to-br from-[#0f1117] to-[#0a0e1a] p-5 shadow-lg transition-all hover:border-[#2a3345] ${
				project.isActive ? "border-violet-500/40 ring-1 ring-violet-500/20" : "border-[#1e2535]"
			}`}>
			{/* Header */}
			<div className="flex items-start justify-between mb-4">
				<div className="flex items-center gap-3 min-w-0">
					<div
						className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
							project.isActive ? "bg-violet-600/20 text-violet-400" : "bg-gray-700/30 text-gray-500"
						}`}>
						<FolderGit2 className="h-5 w-5" />
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="text-sm font-semibold text-[#e2e8f0] truncate">{project.name}</h3>
							{project.isActive && (
								<span className="flex h-2 w-2 shrink-0">
									<span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-violet-400 opacity-75" />
									<span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
								</span>
							)}
						</div>
						<div className="flex items-center gap-2 mt-0.5 min-w-0">
							<GitBranch className="h-3 w-3 shrink-0 text-gray-500" />
							<span className="text-[11px] text-gray-500 truncate">{project.branch}</span>
							{project.language && (
								<>
									<span className="text-[10px] text-gray-700">·</span>
									<span
										className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getLanguageColor(project.language)}`}>
										{project.language}
									</span>
								</>
							)}
						</div>
					</div>
				</div>
				<Badge status={project.isActive ? "active" : "idle"} label={project.isActive ? "Active" : "Inactive"} />
			</div>

			{/* Stats row */}
			<div className="grid grid-cols-4 gap-2 mb-4">
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Commits</div>
					<div className="text-sm font-semibold text-blue-400">{project.totalCommits}</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Deploys</div>
					<div className="text-sm font-semibold text-violet-400">{project.totalDeploys}</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Success</div>
					<div
						className={`text-sm font-semibold ${
							successRate >= 80
								? "text-emerald-400"
								: successRate >= 50
									? "text-amber-400"
									: "text-red-400"
						}`}>
						{successRate}%
					</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Deploy</div>
					<div
						className={`text-sm font-semibold ${deployHealthy ? "text-emerald-400" : deployFailed ? "text-red-400" : "text-amber-400"}`}>
						{deployHealthy ? "Live" : deployFailed ? "Down" : "—"}
					</div>
				</div>
			</div>

			{/* Last commit + deploy info */}
			<div className="space-y-2 text-xs">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5 text-gray-500">
						<GitCommit className="h-3 w-3 shrink-0" />
						<span>Last commit</span>
					</div>
					<div className="flex items-center gap-2 min-w-0">
						{project.lastCommit ? (
							<>
								<span className="text-[#e2e8f0] truncate max-w-[120px]">
									{project.lastCommit.message.length > 25
										? project.lastCommit.message.slice(0, 25) + "…"
										: project.lastCommit.message}
								</span>
								<span className="text-gray-600 shrink-0">{formatTimeAgo(project.lastCommit.time)}</span>
							</>
						) : (
							<span className="text-gray-600">No commits yet</span>
						)}
					</div>
				</div>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5 text-gray-500">
						<Rocket className="h-3 w-3 shrink-0" />
						<span>Deployment</span>
					</div>
					<div className="flex items-center gap-2 min-w-0">
						{project.lastDeploy ? (
							<>
								<Badge
									status={deployHealthy ? "success" : deployFailed ? "failed" : "warning"}
									label={project.lastDeploy.status}
								/>
								<span className="text-gray-600 shrink-0">{formatTimeAgo(project.lastDeploy.time)}</span>
							</>
						) : (
							<span className="text-gray-600">No deploys yet</span>
						)}
					</div>
				</div>
			</div>

			{/* Active task / agent info */}
			{project.currentTask && (
				<div className="mt-3 rounded-lg bg-[#070b14] p-2.5">
					<div className="flex items-center gap-2">
						<Bot className="h-3 w-3 text-violet-400 shrink-0" />
						<span className="text-[11px] text-gray-400 truncate">{project.currentTask}</span>
						{project.activeAgent && <Badge status="active" label={project.activeAgent} />}
					</div>
				</div>
			)}
		</div>
	)
}

// ── Activity Timeline ──────────────────────────────────────────────────────────

function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
	return (
		<div className="space-y-1">
			{events.length === 0 ? (
				<p className="text-xs text-gray-600 py-3 text-center">No recent activity</p>
			) : (
				<div className="space-y-1 max-h-72 overflow-y-auto">
					{events.map((event) => (
						<div
							key={event.id}
							className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-[#0a0e1a]/50 transition-colors">
							<div
								className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
									event.severity === "high" || event.severity === "critical"
										? "bg-red-500"
										: event.severity === "medium"
											? "bg-amber-500"
											: "bg-emerald-500"
								}`}
							/>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-xs font-medium text-[#e2e8f0] truncate">{event.title}</span>
									<Badge status={severityBadge(event.severity)} label={event.role} />
								</div>
								<p className="text-[11px] text-gray-500 mt-0.5">{event.detail}</p>
							</div>
							<span className="text-[10px] text-gray-600 whitespace-nowrap shrink-0">
								{formatTimeAgo(event.time)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// ── Main Projects View ─────────────────────────────────────────────────────────

export function ProjectsView() {
	const [data, setData] = useState<ProjectsApiResponse["data"] | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [filterActive, setFilterActive] = useState(false)

	const fetchData = useCallback(async () => {
		try {
			const res = await fetch("/api/projects")
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json: ProjectsApiResponse = await res.json()
			if (json.success && json.data) {
				setData(json.data)
			} else {
				throw new Error("Invalid response")
			}
		} catch (err: any) {
			console.error("[ProjectsView] Error fetching data:", err.message)
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
		const iv = setInterval(fetchData, 15000)
		return () => clearInterval(iv)
	}, [fetchData])

	// Filter projects
	const filteredProjects = (data?.projects || []).filter((p) => {
		if (filterActive && !p.isActive) return false
		if (searchQuery) {
			const q = searchQuery.toLowerCase()
			return (
				p.name.toLowerCase().includes(q) ||
				p.repoName.toLowerCase().includes(q) ||
				(p.language || "").toLowerCase().includes(q) ||
				(p.currentTask || "").toLowerCase().includes(q)
			)
		}
		return true
	})

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-3">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
					<span className="text-sm text-gray-500 animate-pulse">Loading projects...</span>
				</div>
			</div>
		)
	}

	if (error && !data) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-3">
					<AlertTriangle className="h-8 w-8 text-red-400" />
					<div className="text-sm text-red-400">Failed to load project data: {error}</div>
					<button
						onClick={fetchData}
						className="px-4 py-2 text-xs font-medium text-[#e2e8f0] bg-[#1e2535] rounded-lg hover:bg-[#2a3345] transition-colors">
						Retry
					</button>
				</div>
			</div>
		)
	}

	const projects = data?.projects || []
	const activityEvents = data?.activityEvents || []
	const currentWorkspace = data?.currentWorkspace

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="text-base font-semibold text-[#e2e8f0]">Projects</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						{data?.totalProjects || 0} project{(data?.totalProjects || 0) !== 1 ? "s" : ""} tracked
						{data?.activeProjects ? (
							<>
								<span className="text-gray-700 mx-1">·</span>
								<span className="text-violet-400">{data.activeProjects} active</span>
							</>
						) : null}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* Search */}
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
						<input
							type="text"
							placeholder="Search projects..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-40 pl-8 pr-3 py-1.5 text-xs bg-[#0f1117] border border-[#1e2535] rounded-lg text-gray-400 placeholder-gray-600 focus:outline-none focus:border-violet-500/50 transition-colors"
						/>
					</div>
					{/* Active filter toggle */}
					<button
						onClick={() => setFilterActive(!filterActive)}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
							filterActive
								? "text-violet-400 border-violet-500/40 bg-violet-500/10"
								: "text-gray-400 border-[#1e2535] bg-[#0f1117] hover:text-[#e2e8f0] hover:bg-[#1e2535]"
						}`}>
						<Activity className="h-3 w-3" />
						Active
					</button>
					<button
						onClick={fetchData}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 bg-[#0f1117] border border-[#1e2535] rounded-lg hover:text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
						<RefreshCw className="h-3 w-3" />
						Refresh
					</button>
				</div>
			</div>

			{/* Project Cards Grid */}
			{filteredProjects.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<FolderGit2 className="h-12 w-12 text-gray-700 mb-3" />
					<h3 className="text-sm font-medium text-gray-500 mb-1">
						{searchQuery ? "No projects match your search" : "No projects tracked yet"}
					</h3>
					<p className="text-xs text-gray-600 max-w-md">
						{searchQuery
							? "Try a different search term or clear the filter."
							: "Projects appear here when the SuperRoo extension starts working on a repository."}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{filteredProjects.map((project) => (
						<ProjectCard key={project.id} project={project} />
					))}
				</div>
			)}

			{/* Two-column layout: Activity + Quick Actions */}
			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				{/* Left column: Activity Timeline */}
				<div className="space-y-5 lg:col-span-2">
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Activity className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Activity Timeline</h2>
						</div>
						<ActivityTimeline events={activityEvents} />
					</Card>
				</div>

				{/* Right column: Summary + Quick Actions */}
				<div className="space-y-5">
					{/* Summary Card */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Shield className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Summary</h2>
						</div>
						<div className="space-y-3">
							<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
								<div className="flex items-center gap-2">
									<FolderGit2 className="h-3.5 w-3.5 text-gray-500" />
									<span className="text-xs text-gray-400">Total Projects</span>
								</div>
								<span className="text-xs font-medium text-[#e2e8f0]">{data?.totalProjects || 0}</span>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
								<div className="flex items-center gap-2">
									<Activity className="h-3.5 w-3.5 text-gray-500" />
									<span className="text-xs text-gray-400">Active Now</span>
								</div>
								<span className="text-xs font-medium text-violet-400">{data?.activeProjects || 0}</span>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
								<div className="flex items-center gap-2">
									<GitCommit className="h-3.5 w-3.5 text-gray-500" />
									<span className="text-xs text-gray-400">Total Commits</span>
								</div>
								<span className="text-xs font-medium text-blue-400">
									{projects.reduce((sum, p) => sum + p.totalCommits, 0)}
								</span>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
								<div className="flex items-center gap-2">
									<Rocket className="h-3.5 w-3.5 text-gray-500" />
									<span className="text-xs text-gray-400">Total Deploys</span>
								</div>
								<span className="text-xs font-medium text-violet-400">
									{projects.reduce((sum, p) => sum + p.totalDeploys, 0)}
								</span>
							</div>
							{currentWorkspace?.repoName && (
								<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
									<div className="flex items-center gap-2">
										<Terminal className="h-3.5 w-3.5 text-gray-500" />
										<span className="text-xs text-gray-400">Current WS</span>
									</div>
									<span className="text-xs font-medium text-[#e2e8f0] truncate max-w-[120px]">
										{currentWorkspace.repoName}
									</span>
								</div>
							)}
						</div>
					</Card>

					{/* Quick Actions */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Rocket className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Quick Actions</h2>
						</div>
						<div className="space-y-2">
							<button
								onClick={() => window.open("https://github.com", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded-lg transition-colors">
								<GitBranch className="h-3.5 w-3.5" />
								<span>Open GitHub</span>
								<ExternalLink className="h-3 w-3 ml-auto" />
							</button>
							<button
								onClick={() => window.open("https://github.com/pulls", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded-lg transition-colors">
								<GitPullRequest className="h-3.5 w-3.5" />
								<span>View Pull Requests</span>
								<ExternalLink className="h-3 w-3 ml-auto" />
							</button>
							<button
								onClick={() => window.open("https://github.com/actions", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded-lg transition-colors">
								<Activity className="h-3.5 w-3.5" />
								<span>View Actions</span>
								<ExternalLink className="h-3 w-3 ml-auto" />
							</button>
							<button
								onClick={() => {
									window.dispatchEvent(new CustomEvent("navigate", { detail: "working-tree" }))
								}}
								className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-violet-400 hover:text-violet-300 hover:bg-[#1e2535] rounded-lg transition-colors">
								<FileCode className="h-3.5 w-3.5" />
								<span>View Working Tree</span>
								<ArrowUpRight className="h-3 w-3 ml-auto" />
							</button>
						</div>
					</Card>
				</div>
			</div>
		</div>
	)
}
