"use client"

import { useEffect, useState } from "react"
import { Card, StatCard } from "@/components/ui/card"
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
	Star,
	GitFork,
	Code2,
	Users,
	Calendar,
	ExternalLink,
	Search,
	Plus,
	MoreHorizontal,
	RefreshCw,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

interface RepoStatus {
	repoName: string
	branch: string
	syncStatus: string
	lastPush: string
	lastCommit: { message: string; author: string; time: string }
	deployment: { status: string; environment: string; time: string }
	openPRs: number
	pendingReviews: number
	changedFiles: number
	modifiedFiles: number
	stagedFiles: number
	testPassRate: number
	testsPassed: number
	testsFailed: number
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

interface HealthMetric {
	label: string
	value: number | string
	status: string
	percent?: number
}

interface PipelineStage {
	name: string
	status: string
	duration: string
}

interface AiCommit {
	sha: string
	message: string
	author: string
	model: string
	risk: string
	status: string
	time: string
}

interface GitHubDashboardData {
	repoStatus: RepoStatus
	activityEvents: ActivityEvent[]
	healthMetrics: HealthMetric[]
	aiSuggestions: any[]
	workingTreeFiles: any[]
	pipelineStages: PipelineStage[]
	autonomousTask: any
	aiCommits: AiCommit[]
	pullRequests: any[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
	switch (status) {
		case "success":
		case "healthy":
		case "synced":
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

// ── Project Card ───────────────────────────────────────────────────────────────

function ProjectCard({ repo, onRefresh }: { repo: RepoStatus; onRefresh: () => void }) {
	const deployHealthy = repo.deployment.status === "healthy"
	const deployFailed = repo.deployment.status === "failed"

	return (
		<div className="rounded-xl border border-[#1e2535] bg-gradient-to-br from-[#0f1117] to-[#0a0e1a] p-5 shadow-lg hover:border-[#2a3345] transition-colors">
			{/* Header */}
			<div className="flex items-start justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/15 text-violet-400">
						<FolderGit2 className="h-5 w-5" />
					</div>
					<div>
						<h3 className="text-sm font-semibold text-[#e2e8f0]">{repo.repoName}</h3>
						<div className="flex items-center gap-2 mt-0.5">
							<GitBranch className="h-3 w-3 text-gray-500" />
							<span className="text-[11px] text-gray-500">{repo.branch}</span>
							<span className="text-[10px] text-gray-700">·</span>
							<Badge status={repo.syncStatus} label={repo.syncStatus} />
						</div>
					</div>
				</div>
				<button
					onClick={onRefresh}
					className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:text-[#e2e8f0] hover:bg-[#1e2535] transition-colors"
					title="Refresh">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			</div>

			{/* Stats row */}
			<div className="grid grid-cols-4 gap-2 mb-4">
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Files</div>
					<div className="text-sm font-semibold text-[#e2e8f0]">{repo.changedFiles}</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">PRs</div>
					<div className="text-sm font-semibold text-[#e2e8f0]">{repo.openPRs}</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Tests</div>
					<div
						className={`text-sm font-semibold ${
							repo.testPassRate >= 80
								? "text-emerald-400"
								: repo.testPassRate >= 50
									? "text-amber-400"
									: "text-red-400"
						}`}>
						{repo.testPassRate}%
					</div>
				</div>
				<div className="rounded-lg bg-[#070b14] p-2.5 text-center">
					<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Deploy</div>
					<div
						className={`text-sm font-semibold ${deployHealthy ? "text-emerald-400" : deployFailed ? "text-red-400" : "text-amber-400"}`}>
						{deployHealthy ? "Live" : deployFailed ? "Down" : "Pending"}
					</div>
				</div>
			</div>

			{/* Last commit + deploy info */}
			<div className="space-y-2 text-xs">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5 text-gray-500">
						<GitCommit className="h-3 w-3" />
						<span>Last commit</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[#e2e8f0] truncate max-w-[120px]">
							{repo.lastCommit.message.length > 25
								? repo.lastCommit.message.slice(0, 25) + "…"
								: repo.lastCommit.message}
						</span>
						<span className="text-gray-600">{formatTimeAgo(repo.lastCommit.time)}</span>
					</div>
				</div>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5 text-gray-500">
						<Rocket className="h-3 w-3" />
						<span>Deployment</span>
					</div>
					<div className="flex items-center gap-2">
						<Badge
							status={deployHealthy ? "success" : deployFailed ? "failed" : "warning"}
							label={repo.deployment.status}
						/>
						<span className="text-gray-600">{formatTimeAgo(repo.deployment.time)}</span>
					</div>
				</div>
			</div>
		</div>
	)
}

// ── Pipeline Bar ───────────────────────────────────────────────────────────────

function PipelineBar({ stages }: { stages: PipelineStage[] }) {
	return (
		<div className="flex items-center gap-2">
			{stages.map((stage, i) => (
				<div key={stage.name} className="flex-1">
					<div className="flex items-center gap-1 mb-1">
						{stage.status === "success" ? (
							<CheckCircle className="h-3 w-3 text-emerald-400" />
						) : stage.status === "failed" ? (
							<XCircle className="h-3 w-3 text-red-400" />
						) : stage.status === "running" || stage.status === "active" ? (
							<Clock className="h-3 w-3 text-blue-400 animate-pulse" />
						) : (
							<Clock className="h-3 w-3 text-gray-600" />
						)}
						<span className="text-[10px] font-medium text-gray-400">{stage.name}</span>
					</div>
					<div
						className={`h-1.5 rounded-full ${
							stage.status === "success"
								? "bg-emerald-500/50"
								: stage.status === "failed"
									? "bg-red-500/50"
									: stage.status === "running" || stage.status === "active"
										? "bg-blue-500/50 animate-pulse"
										: "bg-gray-700/50"
						}`}
					/>
					{stage.duration !== "—" && (
						<span className="text-[10px] text-gray-600 mt-0.5 block">{stage.duration}</span>
					)}
				</div>
			))}
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

// ── Commits Table ──────────────────────────────────────────────────────────────

function CommitsTable({ commits }: { commits: AiCommit[] }) {
	return (
		<div className="overflow-x-auto">
			{commits.length === 0 ? (
				<p className="text-xs text-gray-600 py-3 text-center">No commits recorded yet</p>
			) : (
				<table className="w-full text-xs">
					<thead>
						<tr className="text-gray-500 border-b border-[#1e2535]">
							<th className="text-left py-2 pr-2 font-medium">SHA</th>
							<th className="text-left py-2 pr-2 font-medium">Message</th>
							<th className="text-left py-2 pr-2 font-medium">Author</th>
							<th className="text-left py-2 pr-2 font-medium">Risk</th>
							<th className="text-left py-2 pr-2 font-medium">Status</th>
							<th className="text-right py-2 font-medium">Time</th>
						</tr>
					</thead>
					<tbody>
						{commits.map((commit) => (
							<tr
								key={commit.sha}
								className="border-b border-[#1e2535] last:border-0 hover:bg-[#0a0e1a]/50 transition-colors">
								<td className="py-2 pr-2 font-mono text-[10px] text-blue-400">{commit.sha}</td>
								<td className="py-2 pr-2 text-[#e2e8f0] max-w-48 truncate">{commit.message}</td>
								<td className="py-2 pr-2 text-gray-400">{commit.author}</td>
								<td className="py-2 pr-2">
									<Badge status={severityBadge(commit.risk)} label={commit.risk} />
								</td>
								<td className="py-2 pr-2">
									<Badge
										status={commit.status === "Deployed" ? "success" : "idle"}
										label={commit.status}
									/>
								</td>
								<td className="py-2 text-right text-gray-500">{formatTimeAgo(commit.time)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	)
}

// ── Health Metrics ─────────────────────────────────────────────────────────────

function HealthMetricsList({ metrics }: { metrics: HealthMetric[] }) {
	return (
		<div className="space-y-3">
			{metrics.map((metric) => (
				<div key={metric.label}>
					<div className="flex items-center justify-between mb-1">
						<span className="text-[11px] text-gray-400">{metric.label}</span>
						<span className={`text-xs font-medium ${statusColor(metric.status)}`}>
							{typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}
						</span>
					</div>
					{metric.percent !== undefined && (
						<div className="h-1.5 rounded-full bg-gray-700/50 overflow-hidden">
							<div
								className={`h-full rounded-full transition-all ${
									metric.status === "success"
										? "bg-emerald-500/50"
										: metric.status === "failed"
											? "bg-red-500/50"
											: "bg-amber-500/50"
								}`}
								style={{ width: `${Math.min(metric.percent, 100)}%` }}
							/>
						</div>
					)}
				</div>
			))}
		</div>
	)
}

// ── Main Projects View ─────────────────────────────────────────────────────────

export function ProjectsView() {
	const [data, setData] = useState<GitHubDashboardData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchData = async () => {
		try {
			const res = await fetch("/api/github/dashboard")
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
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
	}

	useEffect(() => {
		fetchData()
		const iv = setInterval(fetchData, 15000)
		return () => clearInterval(iv)
	}, [])

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

	if (error || !data) {
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

	const { repoStatus, activityEvents, healthMetrics, pipelineStages, aiCommits } = data

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-[#e2e8f0]">Projects</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						Monitor repositories, deployments, and pipeline status
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={fetchData}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 bg-[#0f1117] border border-[#1e2535] rounded-lg hover:text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
						<RefreshCw className="h-3 w-3" />
						Refresh
					</button>
				</div>
			</div>

			{/* Project Cards Grid */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				<ProjectCard repo={repoStatus} onRefresh={fetchData} />

				{/* Quick Stats Card */}
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-br from-[#0f1117] to-[#0a0e1a] p-5 shadow-lg hover:border-[#2a3345] transition-colors">
					<div className="flex items-center gap-3 mb-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-400">
							<Activity className="h-5 w-5" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-[#e2e8f0]">Activity Overview</h3>
							<p className="text-[11px] text-gray-500">Recent project activity</p>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-lg bg-[#070b14] p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Commits</div>
							<div className="text-lg font-bold text-blue-400">
								{healthMetrics.find((m) => m.label === "Total Commits")?.value ?? 0}
							</div>
						</div>
						<div className="rounded-lg bg-[#070b14] p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Deploys</div>
							<div className="text-lg font-bold text-violet-400">
								{healthMetrics.find((m) => m.label === "Total Deploys")?.value ?? 0}
							</div>
						</div>
						<div className="rounded-lg bg-[#070b14] p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Successful</div>
							<div className="text-lg font-bold text-emerald-400">
								{healthMetrics.find((m) => m.label === "Successful Deploys")?.value ?? 0}
							</div>
						</div>
						<div className="rounded-lg bg-[#070b14] p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Failed</div>
							<div className="text-lg font-bold text-red-400">
								{healthMetrics.find((m) => m.label === "Failed Deploys")?.value ?? 0}
							</div>
						</div>
					</div>
				</div>

				{/* System Status Card */}
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-br from-[#0f1117] to-[#0a0e1a] p-5 shadow-lg hover:border-[#2a3345] transition-colors">
					<div className="flex items-center gap-3 mb-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600/15 text-amber-400">
							<Shield className="h-5 w-5" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-[#e2e8f0]">System Status</h3>
							<p className="text-[11px] text-gray-500">Autonomous mode & safety</p>
						</div>
					</div>
					<div className="space-y-3">
						<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
							<div className="flex items-center gap-2">
								<Bot className="h-3.5 w-3.5 text-gray-500" />
								<span className="text-xs text-gray-400">Autonomous</span>
							</div>
							<Badge
								status={data.autonomousTask?.title === "No active task" ? "idle" : "active"}
								label={data.autonomousTask?.title === "No active task" ? "Idle" : "Active"}
							/>
						</div>
						<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
							<div className="flex items-center gap-2">
								<Shield className="h-3.5 w-3.5 text-gray-500" />
								<span className="text-xs text-gray-400">Safety Mode</span>
							</div>
							<span className="text-xs font-medium text-[#e2e8f0]">
								{data.autonomousTask?.safetyMode || "Sandbox"}
							</span>
						</div>
						<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
							<div className="flex items-center gap-2">
								<GitPullRequest className="h-3.5 w-3.5 text-gray-500" />
								<span className="text-xs text-gray-400">Open PRs</span>
							</div>
							<span className="text-xs font-medium text-[#e2e8f0]">{repoStatus.openPRs}</span>
						</div>
						<div className="flex items-center justify-between rounded-lg bg-[#070b14] p-2.5">
							<div className="flex items-center gap-2">
								<Users className="h-3.5 w-3.5 text-gray-500" />
								<span className="text-xs text-gray-400">Pending Reviews</span>
							</div>
							<span className="text-xs font-medium text-[#e2e8f0]">{repoStatus.pendingReviews}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Two-column layout */}
			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				{/* Left column: Pipeline + Activity + Commits */}
				<div className="space-y-5 lg:col-span-2">
					{/* Pipeline */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Layers className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Pipeline</h2>
						</div>
						<PipelineBar stages={pipelineStages} />
					</Card>

					{/* Activity Timeline */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Activity className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Activity Timeline</h2>
						</div>
						<ActivityTimeline events={activityEvents} />
					</Card>

					{/* Recent Commits */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<GitCommit className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent AI Commits</h2>
						</div>
						<CommitsTable commits={aiCommits} />
					</Card>
				</div>

				{/* Right column: Health + Quick Actions */}
				<div className="space-y-5">
					{/* Health Metrics */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<AlertTriangle className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Repository Health</h2>
						</div>
						<HealthMetricsList metrics={healthMetrics} />
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
								<span>Open Repository</span>
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
								onClick={() => window.open("https://github.com/superroo2", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded-lg transition-colors">
								<Code2 className="h-3.5 w-3.5" />
								<span>Browse Source</span>
								<ExternalLink className="h-3 w-3 ml-auto" />
							</button>
						</div>
					</Card>

					{/* Working Tree Info */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<FileCode className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Working Tree</h2>
						</div>
						<p className="text-xs text-gray-500 mb-3">
							The Working Tree is the single source of truth for the SuperRoo product architecture.
						</p>
						<button
							onClick={() => {
								window.dispatchEvent(new CustomEvent("navigate", { detail: "working-tree" }))
							}}
							className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-violet-400 hover:text-violet-300 hover:bg-[#1e2535] rounded-lg transition-colors">
							<FileCode className="h-3.5 w-3.5" />
							<span>View Working Tree</span>
							<ArrowUpRight className="h-3 w-3 ml-auto" />
						</button>
					</Card>
				</div>
			</div>
		</div>
	)
}
