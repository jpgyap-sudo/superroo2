import { useCallback, useEffect, useState } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

import type {
	GitHubDashboardData,
	RepoStatus,
	ActivityEvent,
	HealthMetric,
	AiSuggestion,
	WorkingTreeFile,
	PipelineStage,
	AutonomousTask,
	AiCommit,
	PullRequest,
} from "@superroo/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import {
	GitBranch,
	GitCommit,
	GitPullRequest,
	GitMerge,
	Activity,
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Clock,
	ArrowUp,
	ArrowDown,
	Loader2,
	Play,
	Pause,
	Square,
	Lightbulb,
	FileCode,
	TestTube,
	Rocket,
	Shield,
	BarChart3,
	RefreshCw,
	ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Tab, TabContent } from "../common/Tab"

// ── Helpers ─────────────────────────────────────────────────────────────────

function severityColor(severity: string): string {
	switch (severity) {
		case "critical":
			return "text-red-400"
		case "high":
			return "text-orange-400"
		case "medium":
			return "text-yellow-400"
		case "low":
			return "text-green-400"
		default:
			return "text-vscode-descriptionForeground"
	}
}

function statusIcon(status: string) {
	switch (status) {
		case "success":
			return <CheckCircle2 className="w-4 h-4 text-green-400" />
		case "running":
			return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
		case "warning":
			return <AlertTriangle className="w-4 h-4 text-yellow-400" />
		case "failed":
			return <XCircle className="w-4 h-4 text-red-400" />
		case "pending":
			return <Clock className="w-4 h-4 text-vscode-descriptionForeground" />
		default:
			return <Clock className="w-4 h-4 text-vscode-descriptionForeground" />
	}
}

function deployHealthColor(status: string): string {
	switch (status) {
		case "healthy":
			return "text-green-400 bg-green-400/10"
		case "degraded":
			return "text-yellow-400 bg-yellow-400/10"
		case "failed":
			return "text-red-400 bg-red-400/10"
		default:
			return "text-vscode-descriptionForeground bg-vscode-descriptionForeground/10"
	}
}

function formatNumber(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

// ── Sub-Components ──────────────────────────────────────────────────────────

function StatusCard({
	title,
	value,
	detail,
	icon,
	tone = "default",
}: {
	title: string
	value: React.ReactNode
	detail: string
	icon?: React.ReactNode
	tone?: "default" | "green" | "blue" | "purple" | "yellow" | "red"
}) {
	const borderColors: Record<string, string> = {
		default: "border-vscode-textBlockQuote-border",
		green: "border-green-500/30",
		blue: "border-blue-500/30",
		purple: "border-purple-500/30",
		yellow: "border-yellow-500/30",
		red: "border-red-500/30",
	}

	return (
		<div
			className={cn(
				"bg-vscode-sideBar-background rounded-lg border p-4 flex flex-col gap-1",
				borderColors[tone],
			)}>
			<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
				{icon && <span className="shrink-0">{icon}</span>}
				<span>{title}</span>
			</div>
			<div className="text-lg font-semibold text-vscode-foreground">{value}</div>
			<div className="text-xs text-vscode-descriptionForeground">{detail}</div>
		</div>
	)
}

function SectionHeader({ title, icon, action }: { title: string; icon?: React.ReactNode; action?: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between mb-3">
			<div className="flex items-center gap-2 text-sm font-medium text-vscode-foreground">
				{icon && <span className="shrink-0 text-vscode-descriptionForeground">{icon}</span>}
				<span>{title}</span>
			</div>
			{action && <div className="flex items-center gap-2">{action}</div>}
		</div>
	)
}

function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
	if (events.length === 0) {
		return <div className="text-sm text-vscode-descriptionForeground py-4 text-center">No recent activity</div>
	}

	return (
		<div className="space-y-0">
			{events.map((event) => (
				<div key={event.id} className="flex gap-3 py-2 border-b border-vscode-sideBar-border last:border-b-0">
					<div className="flex flex-col items-center gap-1">
						<div
							className={cn(
								"w-2 h-2 rounded-full mt-1.5",
								severityColor(event.severity).replace("text-", "bg-"),
							)}
						/>
						<div className="w-px flex-1 bg-vscode-sideBar-border" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-xs font-medium text-vscode-foreground">{event.agent}</span>
							<span className="text-[10px] text-vscode-descriptionForeground">{event.role}</span>
							<span className="text-[10px] text-vscode-descriptionForeground ml-auto shrink-0">
								{event.time}
							</span>
						</div>
						<div className="text-sm text-vscode-foreground mt-0.5">{event.title}</div>
						{event.detail && (
							<div className="text-xs text-vscode-descriptionForeground mt-0.5 line-clamp-2">
								{event.detail}
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

function HealthMetricsGrid({ metrics }: { metrics: HealthMetric[] }) {
	if (metrics.length === 0) {
		return (
			<div className="text-sm text-vscode-descriptionForeground py-4 text-center">No health data available</div>
		)
	}

	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
			{metrics.map((metric) => (
				<div
					key={metric.label}
					className="bg-vscode-sideBar-background rounded-lg border border-vscode-textBlockQuote-border p-3 flex flex-col gap-1">
					<div className="flex items-center justify-between">
						<span className="text-xs text-vscode-descriptionForeground">{metric.label}</span>
						{statusIcon(metric.status)}
					</div>
					<span className="text-sm font-semibold text-vscode-foreground">{metric.value}</span>
					{metric.percent !== undefined && metric.percent > 0 && (
						<div className="w-full h-1 bg-vscode-sideBar-border rounded-full overflow-hidden mt-1">
							<div
								className={cn(
									"h-full rounded-full transition-all",
									metric.status === "success"
										? "bg-green-400"
										: metric.status === "warning"
											? "bg-yellow-400"
											: metric.status === "failed"
												? "bg-red-400"
												: "bg-vscode-descriptionForeground",
								)}
								style={{ width: `${Math.min(metric.percent, 100)}%` }}
							/>
						</div>
					)}
				</div>
			))}
		</div>
	)
}

function AiSuggestionsPanel({ suggestions }: { suggestions: AiSuggestion[] }) {
	if (suggestions.length === 0) {
		return (
			<div className="text-sm text-vscode-descriptionForeground py-4 text-center">
				No suggestions — everything looks good
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{suggestions.map((suggestion) => (
				<div
					key={suggestion.id}
					className="bg-vscode-sideBar-background rounded-lg border border-vscode-textBlockQuote-border p-3 flex items-start gap-3">
					<Lightbulb className={cn("w-4 h-4 mt-0.5 shrink-0", severityColor(suggestion.severity))} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-vscode-foreground">{suggestion.title}</span>
							<span
								className={cn(
									"text-[10px] uppercase font-semibold",
									severityColor(suggestion.severity),
								)}>
								{suggestion.severity}
							</span>
						</div>
						<p className="text-xs text-vscode-descriptionForeground mt-1">{suggestion.description}</p>
						{suggestion.suggestedAction && (
							<button
								type="button"
								className="mt-2 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline underline-offset-2"
								onClick={() => {
									vscode.postMessage({
										type: "runSuggestedFix" as any,
										text: suggestion.id,
									})
								}}>
								{suggestion.suggestedAction} →
							</button>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

function WorkingTreePanel({ files }: { files: WorkingTreeFile[] }) {
	if (files.length === 0) {
		return <div className="text-sm text-vscode-descriptionForeground py-4 text-center">Working tree is clean</div>
	}

	return (
		<div className="space-y-1">
			{files.map((file) => (
				<div key={file.path} className="flex items-center gap-2 text-sm py-1">
					<span
						className={cn(
							"text-[10px] uppercase font-mono font-bold w-14 shrink-0",
							file.status === "modified" && "text-yellow-400",
							file.status === "new" && "text-green-400",
							file.status === "deleted" && "text-red-400",
							file.status === "staged" && "text-blue-400",
						)}>
						{file.status}
					</span>
					<span className="text-vscode-foreground truncate flex-1">{file.path}</span>
					{file.additions > 0 && <span className="text-green-400 text-xs">+{file.additions}</span>}
					{file.deletions > 0 && <span className="text-red-400 text-xs">-{file.deletions}</span>}
				</div>
			))}
		</div>
	)
}

function PipelineStages({ stages }: { stages: PipelineStage[] }) {
	return (
		<div className="flex items-center gap-1">
			{stages.map((stage, index) => (
				<div key={stage.name} className="flex items-center gap-1 flex-1">
					<div
						className={cn(
							"flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium flex-1",
							stage.status === "success" && "bg-green-400/10 text-green-400",
							stage.status === "running" && "bg-blue-400/10 text-blue-400",
							stage.status === "warning" && "bg-yellow-400/10 text-yellow-400",
							stage.status === "failed" && "bg-red-400/10 text-red-400",
							stage.status === "pending" &&
								"bg-vscode-sideBar-background text-vscode-descriptionForeground",
						)}>
						{statusIcon(stage.status)}
						<span>{stage.name}</span>
						{stage.duration !== "—" && stage.duration !== "running" && (
							<span className="text-[10px] opacity-70 ml-auto">{stage.duration}</span>
						)}
					</div>
					{index < stages.length - 1 && <div className="w-2 h-px bg-vscode-sideBar-border shrink-0" />}
				</div>
			))}
		</div>
	)
}

function CurrentTaskPanel({ task }: { task: AutonomousTask }) {
	const isActive = task.title !== "No active task"

	return (
		<div className="bg-vscode-sideBar-background rounded-lg border border-vscode-textBlockQuote-border p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						{isActive ? (
							<Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
						) : (
							<Clock className="w-4 h-4 text-vscode-descriptionForeground shrink-0" />
						)}
						<span className="text-sm font-medium text-vscode-foreground truncate">{task.title}</span>
					</div>
					<div className="flex items-center gap-4 mt-2 text-xs text-vscode-descriptionForeground">
						<span>Agent: {task.assignedAgent}</span>
						<span>Model: {task.model}</span>
						<span>Queue: {task.queuePosition}</span>
						<span>Files: {task.estimatedFiles}</span>
					</div>
					{isActive && (
						<div className="mt-3">
							<div className="w-full h-1.5 bg-vscode-sideBar-border rounded-full overflow-hidden">
								<div
									className="h-full bg-blue-400 rounded-full transition-all"
									style={{ width: `${task.progress}%` }}
								/>
							</div>
							<div className="flex items-center justify-between mt-1">
								<span className="text-[10px] text-vscode-descriptionForeground">
									{task.progress}% complete
								</span>
								<div className="flex items-center gap-2">
									<button
										type="button"
										className="p-1 rounded hover:bg-vscode-sideBar-border text-vscode-descriptionForeground hover:text-vscode-foreground"
										title="Pause">
										<Pause className="w-3 h-3" />
									</button>
									<button
										type="button"
										className="p-1 rounded hover:bg-vscode-sideBar-border text-vscode-descriptionForeground hover:text-vscode-foreground"
										title="Stop">
										<Square className="w-3 h-3" />
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
				<div className="flex items-center gap-1 text-[10px] text-vscode-descriptionForeground shrink-0">
					<Shield className="w-3 h-3" />
					<span>{task.safetyMode}</span>
				</div>
			</div>
		</div>
	)
}

function RecentCommitsTable({ commits }: { commits: AiCommit[] }) {
	if (commits.length === 0) {
		return <div className="text-sm text-vscode-descriptionForeground py-4 text-center">No commits yet</div>
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="text-xs text-vscode-descriptionForeground border-b border-vscode-sideBar-border">
						<th className="text-left py-2 pr-3 font-medium">SHA</th>
						<th className="text-left py-2 pr-3 font-medium">Message</th>
						<th className="text-left py-2 pr-3 font-medium">Author</th>
						<th className="text-left py-2 pr-3 font-medium">Risk</th>
						<th className="text-left py-2 pr-3 font-medium">Status</th>
						<th className="text-right py-2 font-medium">Time</th>
					</tr>
				</thead>
				<tbody>
					{commits.map((commit) => (
						<tr key={commit.sha} className="border-b border-vscode-sideBar-border last:border-b-0">
							<td className="py-2 pr-3">
								<code className="text-[11px] font-mono text-vscode-textLink-foreground">
									{commit.sha}
								</code>
							</td>
							<td className="py-2 pr-3 text-vscode-foreground truncate max-w-[200px]">
								{commit.message}
							</td>
							<td className="py-2 pr-3 text-vscode-descriptionForeground">{commit.author}</td>
							<td className="py-2 pr-3">
								<span className={cn("text-[10px] uppercase font-semibold", severityColor(commit.risk))}>
									{commit.risk}
								</span>
							</td>
							<td className="py-2 pr-3">
								<span
									className={cn(
										"text-[10px] px-1.5 py-0.5 rounded font-medium",
										commit.status === "Deployed" && "bg-green-400/10 text-green-400",
										commit.status === "Committed" && "bg-blue-400/10 text-blue-400",
									)}>
									{commit.status}
								</span>
							</td>
							<td className="py-2 text-right text-vscode-descriptionForeground text-xs">{commit.time}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function PullRequestsPanel({ pullRequests }: { pullRequests: PullRequest[] }) {
	if (pullRequests.length === 0) {
		return <div className="text-sm text-vscode-descriptionForeground py-4 text-center">No open pull requests</div>
	}

	return (
		<div className="space-y-2">
			{pullRequests.map((pr) => (
				<div
					key={pr.number}
					className="bg-vscode-sideBar-background rounded-lg border border-vscode-textBlockQuote-border p-3 flex items-start gap-3">
					<GitPullRequest className="w-4 h-4 mt-0.5 text-green-400 shrink-0" />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-vscode-foreground">#{pr.number}</span>
							<span className="text-sm text-vscode-foreground truncate">{pr.title}</span>
						</div>
						<div className="flex items-center gap-3 mt-1 text-xs text-vscode-descriptionForeground">
							<span>by {pr.author}</span>
							<span>{pr.time}</span>
							<span
								className={cn(
									"px-1 py-0.5 rounded text-[10px] font-medium",
									pr.status === "open"
										? "bg-green-400/10 text-green-400"
										: "bg-purple-400/10 text-purple-400",
								)}>
								{pr.status}
							</span>
							<span>{pr.reviewStatus}</span>
						</div>
						<div className="flex items-center gap-2 mt-1 text-xs">
							<span className="text-green-400">+{formatNumber(pr.additions)}</span>
							<span className="text-red-400">-{formatNumber(pr.deletions)}</span>
						</div>
					</div>
				</div>
			))}
		</div>
	)
}

// ── Main Component ──────────────────────────────────────────────────────────

export function GitHubView() {
	const [data, setData] = useState<GitHubDashboardData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)

	const fetchData = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true)
		else setLoading(true)
		setError(null)

		try {
			// Post message to extension to get dashboard data
			vscode.postMessage({ type: "getGitHubDashboardData" as any })
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load dashboard data")
			setLoading(false)
			setRefreshing(false)
		}
	}, [])

	useEffect(() => {
		fetchData()

		// Listen for response from extension
		const handler = (e: MessageEvent) => {
			const message = e.data
			if (message.type === "githubDashboardData") {
				setData(message.payload as GitHubDashboardData)
				setLoading(false)
				setRefreshing(false)
			} else if (message.type === "githubDashboardError") {
				setError(message.error || "Unknown error")
				setLoading(false)
				setRefreshing(false)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [fetchData])

	if (loading) {
		return (
			<Tab>
				<TabContent className="flex items-center justify-center h-full">
					<div className="flex flex-col items-center gap-3">
						<VSCodeProgressRing />
						<span className="text-sm text-vscode-descriptionForeground">Loading repository data...</span>
					</div>
				</TabContent>
			</Tab>
		)
	}

	if (error) {
		return (
			<Tab>
				<TabContent className="flex items-center justify-center h-full">
					<div className="flex flex-col items-center gap-3 max-w-md text-center">
						<AlertTriangle className="w-8 h-8 text-yellow-400" />
						<span className="text-sm text-vscode-foreground font-medium">Failed to load dashboard</span>
						<span className="text-xs text-vscode-descriptionForeground">{error}</span>
						<button
							type="button"
							className="text-sm text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline underline-offset-2"
							onClick={() => fetchData()}>
							Try again
						</button>
					</div>
				</TabContent>
			</Tab>
		)
	}

	if (!data) {
		return null
	}

	const {
		repoStatus,
		activityEvents,
		healthMetrics,
		aiSuggestions,
		workingTreeFiles,
		pipelineStages,
		autonomousTask,
		aiCommits,
		pullRequests,
	} = data

	return (
		<Tab>
			<TabContent className="pt-10">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-lg font-semibold text-vscode-foreground flex items-center gap-2">
							<GitBranch className="w-5 h-5" />
							{repoStatus.repoName}
							<span className="text-sm font-normal text-vscode-descriptionForeground">
								{repoStatus.branch}
							</span>
						</h1>
						<p className="text-xs text-vscode-descriptionForeground mt-1">
							Last push: {repoStatus.lastPush}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-vscode-sideBar-background border border-vscode-textBlockQuote-border text-vscode-foreground hover:bg-vscode-sideBar-border transition-colors disabled:opacity-50"
							onClick={() => fetchData(true)}
							disabled={refreshing}>
							<RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
							{refreshing ? "Refreshing..." : "Refresh"}
						</button>
					</div>
				</div>

				{/* Status Cards Row */}
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
					<StatusCard
						title="Sync Status"
						value={
							<span
								className={cn(
									repoStatus.syncStatus === "synced" ? "text-green-400" : "text-yellow-400",
								)}>
								{repoStatus.syncStatus}
							</span>
						}
						detail={`${repoStatus.changedFiles} changed files`}
						icon={<GitMerge className="w-3.5 h-3.5" />}
						tone={repoStatus.syncStatus === "synced" ? "green" : "yellow"}
					/>
					<StatusCard
						title="Deployment"
						value={
							<span className={deployHealthColor(repoStatus.deployment.status).split(" ")[0]}>
								{repoStatus.deployment.status}
							</span>
						}
						detail={repoStatus.deployment.environment}
						icon={<Rocket className="w-3.5 h-3.5" />}
						tone={
							repoStatus.deployment.status === "healthy"
								? "green"
								: repoStatus.deployment.status === "failed"
									? "red"
									: "yellow"
						}
					/>
					<StatusCard
						title="Open PRs"
						value={repoStatus.openPRs}
						detail={`${repoStatus.pendingReviews} pending reviews`}
						icon={<GitPullRequest className="w-3.5 h-3.5" />}
						tone="purple"
					/>
					<StatusCard
						title="Tests"
						value={`${repoStatus.testPassRate}%`}
						detail={`${repoStatus.testsPassed} passed, ${repoStatus.testsFailed} failed`}
						icon={<TestTube className="w-3.5 h-3.5" />}
						tone={
							repoStatus.testPassRate >= 80 ? "green" : repoStatus.testPassRate >= 50 ? "yellow" : "red"
						}
					/>
					<StatusCard
						title="Last Commit"
						value={
							repoStatus.lastCommit?.message
								? repoStatus.lastCommit.message.length > 20
									? `${repoStatus.lastCommit.message.slice(0, 20)}...`
									: repoStatus.lastCommit.message
								: "—"
						}
						detail={
							repoStatus.lastCommit
								? `by ${repoStatus.lastCommit.author} • ${repoStatus.lastCommit.time}`
								: "No commits yet"
						}
						icon={<GitCommit className="w-3.5 h-3.5" />}
						tone="blue"
					/>
				</div>

				{/* Two-column layout for main content */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
					{/* Left column — Activity Timeline */}
					<div className="lg:col-span-2 bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4">
						<SectionHeader title="AI Activity Timeline" icon={<Activity className="w-4 h-4" />} />
						<ActivityTimeline events={activityEvents} />
					</div>

					{/* Right column — AI Suggestions */}
					<div className="bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4">
						<SectionHeader title="AI Suggestions" icon={<Lightbulb className="w-4 h-4" />} />
						<AiSuggestionsPanel suggestions={aiSuggestions} />
					</div>
				</div>

				{/* Repository Health */}
				<div className="bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4 mb-6">
					<SectionHeader title="Repository Health" icon={<BarChart3 className="w-4 h-4" />} />
					<HealthMetricsGrid metrics={healthMetrics} />
				</div>

				{/* Working Tree */}
				<div className="bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4 mb-6">
					<SectionHeader title="Working Tree" icon={<FileCode className="w-4 h-4" />} />
					<WorkingTreePanel files={workingTreeFiles} />
				</div>

				{/* Pipeline */}
				<div className="bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4 mb-6">
					<SectionHeader title="Autonomous Pipeline" icon={<BarChart3 className="w-4 h-4" />} />
					<PipelineStages stages={pipelineStages} />
				</div>

				{/* Current Task */}
				<div className="mb-6">
					<SectionHeader title="Current Autonomous Task" icon={<Play className="w-4 h-4" />} />
					{autonomousTask ? (
						<CurrentTaskPanel task={autonomousTask} />
					) : (
						<p className="text-sm text-vscode-descriptionForeground">No active autonomous task</p>
					)}
				</div>

				{/* Recent Commits & PRs — two-column */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
					<div className="lg:col-span-2 bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4">
						<SectionHeader title="Recent AI Commits" icon={<GitCommit className="w-4 h-4" />} />
						<RecentCommitsTable commits={aiCommits} />
					</div>
					<div className="bg-vscode-editor-background rounded-lg border border-vscode-textBlockQuote-border p-4">
						<SectionHeader title="Open Pull Requests" icon={<GitPullRequest className="w-4 h-4" />} />
						<PullRequestsPanel pullRequests={pullRequests} />
					</div>
				</div>
			</TabContent>
		</Tab>
	)
}
