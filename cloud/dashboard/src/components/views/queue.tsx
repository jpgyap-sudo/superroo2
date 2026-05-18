"use client"

import { useEffect, useMemo, useState } from "react"
import { Activity, AlertTriangle, Bot, Brain, CheckCircle2, Gauge, RotateCcw } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type QueueStatus = "waiting" | "active" | "completed" | "failed" | "delayed"

interface QueueJob {
	id: string
	title: string
	agent: string
	project: string
	status: QueueStatus
	priority: string
	progress: number
	attemptsMade: number
	maxAttempts: number
	timestamp: number
	processedOn: number | null
	finishedOn: number | null
	failedReason: string
	model: string
}

interface QueuePipelineItem {
	id: string
	name: string
	enabled: boolean
	activeJobs: number
	maxConcurrency: number
}

interface QueueActivityItem {
	id: string
	time: number
	agent: string
	message: string
	type: string
}

interface FailureReason {
	name: string
	count: number
	percent: number
}

interface QueueSummary {
	counts: {
		waiting: number
		active: number
		completed: number
		failed: number
		delayed: number
		total: number
	}
	jobs: QueueJob[]
	pipeline: QueuePipelineItem[]
	activity: QueueActivityItem[]
	failureReasons: FailureReason[]
	insights: {
		windowHours: number
		avgCompletionMs: number | null
		throughputPerHour: number
		completedLast24h: number
		totalTokensToday: number
		totalCostUsdToday: number | null
		costAvailable: boolean
	}
	usage: {
		totalTokens: number
		totalCostUsd: number | null
		requests: number
		costAvailable: boolean
		providers: Array<{ name: string; value: number }>
	}
}

function StatusPill({ status }: { status: QueueStatus }) {
	const className =
		status === "failed"
			? "border-red-500/30 bg-red-500/10 text-red-300"
			: status === "completed"
				? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
				: status === "delayed"
					? "border-amber-500/30 bg-amber-500/10 text-amber-300"
					: status === "active"
						? "border-blue-500/30 bg-blue-500/10 text-blue-300"
						: "border-slate-500/30 bg-slate-500/10 text-slate-300"
	return <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${className}`}>{status}</span>
}

function formatTime(value?: number | null) {
	if (!value) return "-"
	return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDuration(value?: number | null) {
	if (!value) return "-"
	const seconds = Math.round(value / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatCount(value: number) {
	return Intl.NumberFormat().format(value)
}

function getHeaders() {
	const token = localStorage.getItem("superroo_auth_token")
	return token ? { Authorization: `Bearer ${token}` } : undefined
}

export function QueueView() {
	const [summary, setSummary] = useState<QueueSummary | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState("")

	useEffect(() => {
		let mounted = true
		const fetchSummary = async () => {
			try {
				const response = await fetch("/api/queue/summary", { headers: getHeaders() })
				if (!response.ok) throw new Error(`Queue summary failed (${response.status})`)
				const data = await response.json()
				if (mounted) {
					setSummary(data)
					setError("")
				}
			} catch (err) {
				if (mounted) setError(err instanceof Error ? err.message : "Unable to load queue summary")
			} finally {
				if (mounted) setLoading(false)
			}
		}
		fetchSummary()
		const interval = setInterval(fetchSummary, 5000)
		return () => {
			mounted = false
			clearInterval(interval)
		}
	}, [])

	const statCards = useMemo(() => {
		const counts = summary?.counts
		return [
			{
				label: "Waiting",
				value: counts?.waiting ?? 0,
				icon: Gauge,
				tone: "text-amber-400",
				bg: "bg-amber-500/10",
			},
			{
				label: "Active",
				value: counts?.active ?? 0,
				icon: Activity,
				tone: "text-blue-400",
				bg: "bg-blue-500/10",
			},
			{
				label: "Completed",
				value: counts?.completed ?? 0,
				icon: CheckCircle2,
				tone: "text-emerald-400",
				bg: "bg-emerald-500/10",
			},
			{
				label: "Failed",
				value: counts?.failed ?? 0,
				icon: AlertTriangle,
				tone: "text-red-400",
				bg: "bg-red-500/10",
			},
		]
	}, [summary])

	const latestFailure = summary?.failureReasons[0]

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-slate-100">Queue</h1>
					<p className="text-xs text-slate-400">Live background jobs, agent load, and queue health</p>
				</div>
				<Badge
					status={summary?.counts.active ? "online" : summary?.counts.failed ? "warning" : "offline"}
					label={summary?.counts.active ? "RUNNING" : summary?.counts.failed ? "ATTENTION" : "IDLE"}
				/>
			</div>

			{error ? <Card className="border-red-500/20 bg-red-500/10 text-sm text-red-200">{error}</Card> : null}

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{statCards.map((item) => (
					<Card key={item.label} className="flex items-center justify-between border-[#1e2535] bg-[#0f1117]">
						<div>
							<p className="text-[11px] uppercase tracking-wide text-slate-500">{item.label}</p>
							<p className={`mt-1 text-2xl font-bold ${item.tone}`}>
								{loading ? "-" : formatCount(item.value)}
							</p>
						</div>
						<div className={`rounded p-2.5 ${item.bg}`}>
							<item.icon size={20} className={item.tone} />
						</div>
					</Card>
				))}
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="space-y-4">
					<Card className="border-[#1e2535] bg-[#0f1117]">
						<div className="mb-4 flex items-center justify-between gap-2">
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Agent Pipeline
							</h2>
							<span className="text-[11px] text-slate-500">
								{summary?.pipeline.reduce((sum, item) => sum + item.activeJobs, 0) ?? 0} active jobs
							</span>
						</div>
						{summary?.pipeline.length ? (
							<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
								{summary.pipeline.map((agent) => (
									<div
										key={agent.id}
										className="rounded border border-slate-700/40 bg-slate-800/20 p-3">
										<div className="flex items-center justify-between gap-2">
											<p className="truncate text-xs font-medium text-slate-200">{agent.name}</p>
											<span
												className={`text-[11px] ${agent.enabled ? "text-emerald-300" : "text-slate-500"}`}>
												{agent.enabled ? "enabled" : "disabled"}
											</span>
										</div>
										<p className="mt-2 text-lg font-semibold text-slate-100">{agent.activeJobs}</p>
										<p className="text-[11px] text-slate-500">
											active of {agent.maxConcurrency || "-"} capacity
										</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-slate-500">No agent registry data available.</p>
						)}
					</Card>

					<Card className="border-[#1e2535] bg-[#0f1117]">
						<div className="mb-4 flex items-center justify-between gap-2">
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Recent Jobs
							</h2>
							<span className="text-[11px] text-slate-500">
								{summary?.counts.total ?? 0} total in queue history
							</span>
						</div>
						{summary?.jobs.length ? (
							<div className="overflow-x-auto">
								<table className="w-full min-w-[760px] text-left text-xs">
									<thead className="text-slate-500">
										<tr>
											<th className="pb-2 pr-3 font-medium">Job</th>
											<th className="pb-2 pr-3 font-medium">Agent</th>
											<th className="pb-2 pr-3 font-medium">Status</th>
											<th className="pb-2 pr-3 font-medium">Retries</th>
											<th className="pb-2 pr-3 font-medium">Started</th>
											<th className="pb-2 font-medium">Duration</th>
										</tr>
									</thead>
									<tbody>
										{summary.jobs.map((job) => (
											<tr key={job.id} className="border-t border-[#1e2535]">
												<td className="py-2.5 pr-3">
													<p className="font-medium text-slate-200">{job.title}</p>
													<p className="text-[11px] text-slate-500">{job.id}</p>
												</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.agent}</td>
												<td className="py-2.5 pr-3">
													<StatusPill status={job.status} />
												</td>
												<td className="py-2.5 pr-3 text-slate-300">
													{job.attemptsMade}/{job.maxAttempts || "-"}
												</td>
												<td className="py-2.5 pr-3 text-slate-300">
													{formatTime(job.processedOn || job.timestamp)}
												</td>
												<td className="py-2.5 text-slate-300">
													{formatDuration(
														job.processedOn && job.finishedOn
															? job.finishedOn - job.processedOn
															: null,
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p className="text-sm text-slate-500">No jobs have been recorded yet.</p>
						)}
					</Card>
				</div>

				<div className="space-y-4">
					<Card className="border-[#1e2535] bg-[#0f1117]">
						<h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
							Queue Insights
						</h2>
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Avg completion</p>
								<p className="text-sm font-semibold text-slate-100">
									{formatDuration(summary?.insights.avgCompletionMs)}
								</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Throughput</p>
								<p className="text-sm font-semibold text-slate-100">
									{summary?.insights.throughputPerHour ?? 0}/hr
								</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Tokens today</p>
								<p className="text-sm font-semibold text-purple-300">
									{formatCount(summary?.insights.totalTokensToday ?? 0)}
								</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Cost today</p>
								<p className="text-sm font-semibold text-slate-100">
									{summary?.insights.costAvailable
										? `$${(summary.insights.totalCostUsdToday ?? 0).toFixed(2)}`
										: "Unavailable"}
								</p>
							</div>
						</div>
					</Card>

					<Card className="border-[#1e2535] bg-[#0f1117]">
						<h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
							Live Activity
						</h2>
						{summary?.activity.length ? (
							<div className="space-y-2">
								{summary.activity.map((item) => (
									<div
										key={item.id}
										className="flex gap-2 rounded border border-slate-700/20 bg-slate-800/10 p-2">
										<Bot size={14} className="mt-0.5 shrink-0 text-slate-400" />
										<div className="min-w-0">
											<p className="truncate text-xs font-medium text-slate-200">{item.agent}</p>
											<p className="text-[11px] text-slate-400">{item.message}</p>
											<p className="text-[10px] text-slate-500">{formatTime(item.time)}</p>
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-slate-500">No recent queue activity.</p>
						)}
					</Card>

					<Card className="border-[#1e2535] bg-[#0f1117]">
						<div className="mb-3 flex items-center gap-2">
							<AlertTriangle size={16} className="text-red-300" />
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Failure Reasons
							</h2>
						</div>
						{summary?.failureReasons.length ? (
							<div className="space-y-2">
								{summary.failureReasons.map((reason) => (
									<div key={reason.name}>
										<div className="mb-1 flex justify-between gap-2 text-xs">
											<span className="truncate text-slate-300">{reason.name}</span>
											<span className="text-slate-500">{reason.count}</span>
										</div>
										<div className="h-1.5 overflow-hidden rounded bg-slate-700/50">
											<div
												className="h-full rounded bg-red-500/70"
												style={{ width: `${reason.percent}%` }}
											/>
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-slate-500">No failed jobs in the current sample.</p>
						)}
					</Card>

					<Card className="border-[#1e2535] bg-[#0f1117]">
						<div className="mb-3 flex items-center gap-2">
							<Brain size={16} className="text-purple-300" />
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Recommendation
							</h2>
						</div>
						<p className="text-xs leading-relaxed text-slate-300">
							{latestFailure
								? `Investigate "${latestFailure.name}" first; it accounts for ${latestFailure.percent}% of sampled failures.`
								: "No failure pattern is strong enough to recommend an action yet."}
						</p>
						{latestFailure ? (
							<button className="mt-3 inline-flex items-center gap-1.5 rounded border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300">
								<RotateCcw size={13} />
								Review failed jobs
							</button>
						) : null}
					</Card>
				</div>
			</div>
		</div>
	)
}
