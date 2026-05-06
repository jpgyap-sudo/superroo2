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
} from "lucide-react"

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

export function GitHubView() {
	const [data, setData] = useState<GitHubDashboardData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
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
				console.error("[GitHubView] Error fetching data:", err.message)
				setError(err.message)
			} finally {
				setLoading(false)
			}
		}
		fetchData()
		const iv = setInterval(fetchData, 15000)
		return () => clearInterval(iv)
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-sm text-gray-500 animate-pulse">Loading GitHub dashboard...</div>
			</div>
		)
	}

	if (error || !data) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-sm text-red-400">Failed to load GitHub data: {error}</div>
			</div>
		)
	}

	const { repoStatus, activityEvents, healthMetrics, pipelineStages, aiCommits } = data

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-bold text-[#e2e8f0]">Repository Operations Center</h1>
					<p className="text-xs text-gray-500 mt-0.5">
						{repoStatus.repoName} / {repoStatus.branch}
					</p>
				</div>
				<Badge status={repoStatus.syncStatus} label={repoStatus.syncStatus} />
			</div>

			{/* Repo Status Cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					label="Branch"
					value={repoStatus.branch}
					sub={`${repoStatus.changedFiles} changed files`}
					color="text-blue-400"
				/>
				<StatCard
					label="Last Commit"
					value={
						repoStatus.lastCommit.message.length > 20
							? repoStatus.lastCommit.message.slice(0, 20) + "…"
							: repoStatus.lastCommit.message
					}
					sub={`${repoStatus.lastCommit.author} · ${repoStatus.lastCommit.time}`}
					color="text-emerald-400"
				/>
				<StatCard
					label="Deployment"
					value={repoStatus.deployment.status}
					sub={repoStatus.deployment.time}
					color={statusColor(repoStatus.deployment.status)}
				/>
				<StatCard
					label="Test Pass Rate"
					value={`${repoStatus.testPassRate}%`}
					sub={`${repoStatus.testsPassed} passed · ${repoStatus.testsFailed} failed`}
					color={
						repoStatus.testPassRate >= 80
							? "text-emerald-400"
							: repoStatus.testPassRate >= 50
								? "text-amber-400"
								: "text-red-400"
					}
				/>
			</div>

			{/* Two-column layout */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				{/* Left column: Activity + Pipeline */}
				<div className="space-y-4 lg:col-span-2">
					{/* Activity Timeline */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Activity className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Activity Timeline</h2>
						</div>
						{activityEvents.length === 0 ? (
							<p className="text-xs text-gray-600 py-2">No recent activity</p>
						) : (
							<div className="space-y-2 max-h-64 overflow-y-auto">
								{activityEvents.map((event) => (
									<div
										key={event.id}
										className="flex items-start gap-3 py-1.5 border-b border-[#1e2535] last:border-0">
										<div
											className={`mt-0.5 h-2 w-2 rounded-full ${event.severity === "high" || event.severity === "critical" ? "bg-red-500" : event.severity === "medium" ? "bg-amber-500" : "bg-emerald-500"}`}
										/>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-xs font-medium text-[#e2e8f0] truncate">
													{event.title}
												</span>
												<Badge status={severityBadge(event.severity)} label={event.role} />
											</div>
											<p className="text-[11px] text-gray-500 mt-0.5">{event.detail}</p>
										</div>
										<span className="text-[10px] text-gray-600 whitespace-nowrap">
											{event.time}
										</span>
									</div>
								))}
							</div>
						)}
					</Card>

					{/* Pipeline Stages */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Layers className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Pipeline</h2>
						</div>
						<div className="flex items-center gap-2">
							{pipelineStages.map((stage, i) => (
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
					</Card>

					{/* Recent Commits */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<GitCommit className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent AI Commits</h2>
						</div>
						{aiCommits.length === 0 ? (
							<p className="text-xs text-gray-600 py-2">No commits recorded yet</p>
						) : (
							<div className="overflow-x-auto">
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
										{aiCommits.map((commit) => (
											<tr
												key={commit.sha}
												className="border-b border-[#1e2535] last:border-0 hover:bg-[#0a0e1a]/50">
												<td className="py-2 pr-2 font-mono text-[10px] text-blue-400">
													{commit.sha}
												</td>
												<td className="py-2 pr-2 text-[#e2e8f0] max-w-48 truncate">
													{commit.message}
												</td>
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
												<td className="py-2 text-right text-gray-500">{commit.time}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</Card>
				</div>

				{/* Right column: Health + Status */}
				<div className="space-y-4">
					{/* Health Metrics */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<AlertTriangle className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Repository Health</h2>
						</div>
						<div className="space-y-3">
							{healthMetrics.map((metric) => (
								<div key={metric.label}>
									<div className="flex items-center justify-between mb-1">
										<span className="text-[11px] text-gray-400">{metric.label}</span>
										<span className={`text-xs font-medium ${statusColor(metric.status)}`}>
											{typeof metric.value === "number"
												? metric.value.toLocaleString()
												: metric.value}
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
								className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded transition-colors">
								<GitBranch className="h-3.5 w-3.5" />
								<span>Open Repository</span>
								<ArrowUpRight className="h-3 w-3 ml-auto" />
							</button>
							<button
								onClick={() => window.open("https://github.com/pulls", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded transition-colors">
								<GitPullRequest className="h-3.5 w-3.5" />
								<span>View Pull Requests</span>
								<ArrowUpRight className="h-3 w-3 ml-auto" />
							</button>
							<button
								onClick={() => window.open("https://github.com/actions", "_blank")}
								className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-[#e2e8f0] hover:bg-[#1e2535] rounded transition-colors">
								<Activity className="h-3.5 w-3.5" />
								<span>View Actions</span>
								<ArrowUpRight className="h-3 w-3 ml-auto" />
							</button>
						</div>
					</Card>

					{/* System Info */}
					<Card>
						<div className="flex items-center gap-2 mb-3">
							<Shield className="h-4 w-4 text-violet-400" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">System</h2>
						</div>
						<div className="space-y-2 text-xs">
							<div className="flex justify-between">
								<span className="text-gray-500">Autonomous Mode</span>
								<Badge
									status={data.autonomousTask?.title === "No active task" ? "idle" : "active"}
									label={data.autonomousTask?.title === "No active task" ? "Idle" : "Active"}
								/>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-500">Safety Mode</span>
								<span className="text-[#e2e8f0]">{data.autonomousTask?.safetyMode || "Sandbox"}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-500">Open PRs</span>
								<span className="text-[#e2e8f0]">{repoStatus.openPRs}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-500">Pending Reviews</span>
								<span className="text-[#e2e8f0]">{repoStatus.pendingReviews}</span>
							</div>
						</div>
					</Card>
				</div>
			</div>
		</div>
	)
}
