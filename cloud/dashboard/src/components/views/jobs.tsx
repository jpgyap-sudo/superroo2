"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type JobStatus = "completed" | "failed" | "waiting" | "active" | "delayed" | "cancelled"

interface Job {
	id: string
	name: string
	data: {
		task?: string
		agentId?: string
		model?: string
		priority?: string
		environment?: string
		cpuPercent?: number
		ramMb?: number
		tokensUsed?: number
		costUsd?: number
		[key: string]: unknown
	}
	status: JobStatus
	progress?: number
	timestamp: number
	processedOn?: number | null
	finishedOn?: number | null
	failedReason?: string
	returnvalue?: unknown
	attemptsMade?: number
	maxAttempts?: number
}

interface JobLog {
	id: string
	jobId: string
	ts: number | null
	level: "info" | "warn" | "error" | "success"
	source: string
	message: string
}

interface JobsSummary {
	totalJobs: number
	running: number
	completed: number
	failed: number
	queued: number
	successRate: number | null
	avgDurationMs: number | null
	aiCostToday: number | null
	costAvailable: boolean
	totalTokensToday: number
	systemHealth: string
	activeAgents: Array<{ name: string; count: number }>
	modelPerformance: Array<{ name: string; total: number; failed: number; successRate: number | null }>
}

const statusClass: Record<string, string> = {
	completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
	failed: "border-red-500/30 bg-red-500/10 text-red-300",
	active: "border-blue-500/30 bg-blue-500/10 text-blue-300",
	waiting: "border-slate-500/30 bg-slate-500/10 text-slate-300",
	delayed: "border-amber-500/30 bg-amber-500/10 text-amber-300",
	cancelled: "border-slate-500/30 bg-slate-500/10 text-slate-300",
}

const priorityClass: Record<string, string> = {
	critical: "border-red-500/40 bg-red-500/10 text-red-300",
	high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
	medium: "border-blue-500/40 bg-blue-500/10 text-blue-300",
	low: "border-slate-500/40 bg-slate-500/10 text-slate-300",
}

const envClass: Record<string, string> = {
	production: "border-purple-500/40 bg-purple-500/10 text-purple-300",
	staging: "border-amber-500/40 bg-amber-500/10 text-amber-300",
	sandbox: "border-blue-500/40 bg-blue-500/10 text-blue-300",
	local: "border-slate-500/40 bg-slate-500/10 text-slate-300",
}

function getHeaders() {
	const token = localStorage.getItem("superroo_auth_token")
	return token ? { Authorization: `Bearer ${token}` } : undefined
}

function formatDuration(ms?: number | null) {
	if (!ms) return "-"
	const totalSec = Math.floor(ms / 1000)
	return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
}

function formatRelativeTime(ts?: number | null) {
	if (!ts) return "-"
	const diff = Date.now() - ts
	if (diff < 60000) return "just now"
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
	return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function modelIcon(model?: string) {
	if (!model) return "AI"
	const value = model.toLowerCase()
	if (value.includes("claude") || value.includes("sonnet")) return "CL"
	if (value.includes("gpt") || value.includes("4o")) return "GPT"
	if (value.includes("deepseek")) return "DS"
	if (value.includes("kimi")) return "K"
	return "AI"
}

function MetricCard({
	title,
	value,
	delta,
	danger,
}: {
	title: string
	value: string
	delta?: string
	danger?: boolean
}) {
	return (
		<div className={cn("rounded-xl border bg-[#0f1117] p-4", danger ? "border-red-500/30" : "border-[#1e2535]")}>
			<div className="text-[11px] uppercase tracking-widest text-gray-500">{title}</div>
			<div className={cn("mt-1 text-2xl font-bold", danger ? "text-red-300" : "text-[#e2e8f0]")}>{value}</div>
			{delta ? <div className="mt-0.5 text-[11px] text-gray-600">{delta}</div> : null}
		</div>
	)
}

function BadgePill({ label, className }: { label: string; className?: string }) {
	return (
		<span
			className={cn("inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold", className)}>
			{label}
		</span>
	)
}

export function JobsView() {
	const [jobs, setJobs] = useState<Job[]>([])
	const [summary, setSummary] = useState<JobsSummary | null>(null)
	const [selected, setSelected] = useState("")
	const [logs, setLogs] = useState<JobLog[]>([])
	const [logsLoading, setLogsLoading] = useState(false)
	const [search, setSearch] = useState("")
	const [filter, setFilter] = useState("All")
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState("")

	const selectedJob = useMemo(() => jobs.find((job) => job.id === selected), [jobs, selected])

	const filteredJobs = useMemo(() => {
		let list = jobs
		if (filter !== "All") {
			const value = filter.toLowerCase()
			if (value === "running") list = list.filter((job) => job.status === "active")
			else if (value === "completed") list = list.filter((job) => job.status === "completed")
			else if (value === "failed") list = list.filter((job) => job.status === "failed")
			else if (value === "queued") list = list.filter((job) => ["waiting", "delayed"].includes(job.status))
			else if (value === "deployments")
				list = list.filter((job) => job.data?.task?.toLowerCase().includes("deploy"))
			else if (value === "critical") list = list.filter((job) => job.data?.priority === "critical")
		}
		if (search.trim()) {
			const query = search.toLowerCase()
			list = list.filter(
				(job) =>
					job.id.toLowerCase().includes(query) ||
					(job.name || "").toLowerCase().includes(query) ||
					(job.data?.task || "").toLowerCase().includes(query) ||
					(job.data?.agentId || "").toLowerCase().includes(query),
			)
		}
		return list
	}, [jobs, filter, search])

	const refresh = async () => {
		try {
			const headers = getHeaders()
			const [jobsRes, summaryRes] = await Promise.all([
				fetch("/api/jobs?limit=100", { headers }),
				fetch("/api/jobs/summary", { headers }),
			])
			if (!jobsRes.ok || !summaryRes.ok) throw new Error("Unable to load jobs data")
			const [jobsData, summaryData] = await Promise.all([jobsRes.json(), summaryRes.json()])
			setJobs(jobsData.jobs || [])
			setSummary(summaryData)
			setError("")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to load jobs")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		refresh()
		const interval = setInterval(refresh, 5000)
		return () => clearInterval(interval)
	}, [])

	useEffect(() => {
		if (!selected) {
			setLogs([])
			return
		}
		let mounted = true
		const fetchLogs = async () => {
			setLogsLoading(true)
			try {
				const response = await fetch(`/api/jobs/${selected}/logs`, { headers: getHeaders() })
				if (!response.ok) throw new Error("Unable to load job logs")
				const data = await response.json()
				if (mounted) setLogs(data.logs || [])
			} catch {
				if (mounted) setLogs([])
			} finally {
				if (mounted) setLogsLoading(false)
			}
		}
		fetchLogs()
		return () => {
			mounted = false
		}
	}, [selected])

	const handleCancel = async (jobId: string) => {
		await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST", headers: getHeaders() })
		await refresh()
	}

	const handleRetry = async (jobId: string) => {
		await fetch(`/api/jobs/${jobId}/retry`, { method: "POST", headers: getHeaders() })
		await refresh()
	}

	if (loading) {
		return (
			<Card className="overflow-hidden">
				<div className="py-12 text-center text-sm text-gray-500">Loading jobs...</div>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
			{error ? <Card className="border-red-500/20 bg-red-500/10 text-sm text-red-200">{error}</Card> : null}

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				<MetricCard title="Total Jobs" value={String(summary?.totalJobs ?? jobs.length)} />
				<MetricCard
					title="Running"
					value={String(summary?.running ?? 0)}
					delta={`${summary?.queued ?? 0} queued`}
				/>
				<MetricCard
					title="Completed"
					value={String(summary?.completed ?? 0)}
					delta={summary?.successRate === null ? "No finished jobs" : `${summary?.successRate ?? 0}% success`}
				/>
				<MetricCard title="Failed" value={String(summary?.failed ?? 0)} danger={(summary?.failed ?? 0) > 0} />
				<MetricCard
					title="AI Cost Today"
					value={summary?.costAvailable ? `$${(summary.aiCostToday ?? 0).toFixed(2)}` : "Unavailable"}
					delta={`${summary?.totalTokensToday ?? 0} tokens`}
				/>
				<MetricCard
					title="Avg Duration"
					value={formatDuration(summary?.avgDurationMs)}
					delta={summary?.systemHealth}
				/>
			</div>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
				<section className="overflow-hidden rounded-xl border border-[#1e2535] bg-[#0f1117]">
					<div className="flex flex-wrap items-center gap-2 border-b border-[#1e2535] px-4 py-3">
						<div className="flex flex-wrap gap-1">
							{["All", "Running", "Queued", "Completed", "Failed", "Deployments", "Critical"].map(
								(value) => (
									<button
										key={value}
										onClick={() => setFilter(value)}
										className={cn(
											"rounded border px-2.5 py-1 text-[11px] font-medium transition-colors",
											filter === value
												? "border-violet-500/30 bg-violet-600/20 text-violet-300"
												: "border-transparent text-gray-500 hover:text-gray-300",
										)}>
										{value}
									</button>
								),
							)}
						</div>
						<input
							type="text"
							placeholder="Search jobs..."
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							className="ml-auto w-44 rounded border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-violet-500/40"
						/>
					</div>

					{filteredJobs.length === 0 ? (
						<div className="py-12 text-center text-sm text-gray-500">No jobs found</div>
					) : (
						<div className="overflow-x-auto jobs-scrollbar">
							<table className="w-full min-w-[1050px] text-left text-sm">
								<thead className="border-b border-[#1e2535] text-xs text-gray-500">
									<tr>
										<th className="px-3 py-2.5 font-medium">Job</th>
										<th className="px-3 py-2.5 font-medium">Task</th>
										<th className="px-3 py-2.5 font-medium">Agent</th>
										<th className="px-3 py-2.5 font-medium">Model</th>
										<th className="px-3 py-2.5 font-medium">Priority</th>
										<th className="px-3 py-2.5 font-medium">Status</th>
										<th className="px-3 py-2.5 font-medium">Retries</th>
										<th className="px-3 py-2.5 font-medium">Created</th>
										<th className="px-3 py-2.5 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{filteredJobs.map((job) => (
										<Fragment key={job.id}>
											<tr
												onClick={() => setSelected(selected === job.id ? "" : job.id)}
												className={cn(
													"cursor-pointer border-b border-[#1e2535]/50 transition-colors hover:bg-[#0a0e1a]/60",
													selected === job.id
														? "bg-[#0a0e1a]/70 outline outline-1 outline-violet-500/40"
														: "",
												)}>
												<td className="px-3 py-2.5 font-mono text-xs text-blue-400">
													{job.id.slice(0, 8)}
												</td>
												<td className="max-w-[180px] truncate px-3 py-2.5 text-gray-300">
													{job.data?.task || job.name || "Untitled"}
												</td>
												<td className="px-3 py-2.5 text-violet-300">
													{job.data?.agentId || "-"}
												</td>
												<td className="px-3 py-2.5">
													<span className="inline-flex h-6 w-6 items-center justify-center rounded bg-violet-600/20 text-[10px] font-bold text-violet-400">
														{modelIcon(job.data?.model)}
													</span>
												</td>
												<td className="px-3 py-2.5">
													<BadgePill
														label={job.data?.priority || "normal"}
														className={
															priorityClass[job.data?.priority || ""] ||
															"border-slate-500/40 bg-slate-500/10 text-slate-300"
														}
													/>
												</td>
												<td className="px-3 py-2.5">
													<BadgePill
														label={job.status}
														className={statusClass[job.status] || statusClass.waiting}
													/>
												</td>
												<td className="px-3 py-2.5 text-gray-400">
													{job.attemptsMade ?? 0}/{job.maxAttempts || "-"}
												</td>
												<td className="px-3 py-2.5 text-xs text-gray-500">
													{formatRelativeTime(job.timestamp)}
												</td>
												<td className="px-3 py-2.5">
													<div className="flex gap-1">
														{!["completed", "failed", "cancelled"].includes(job.status) ? (
															<button
																onClick={(event) => {
																	event.stopPropagation()
																	handleCancel(job.id)
																}}
																className="rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[10px] text-red-400 hover:bg-[#1e2535]">
																Cancel
															</button>
														) : null}
														{job.status === "failed" ? (
															<button
																onClick={(event) => {
																	event.stopPropagation()
																	handleRetry(job.id)
																}}
																className="rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[10px] text-amber-400 hover:bg-[#1e2535]">
																Retry
															</button>
														) : null}
													</div>
												</td>
											</tr>
											{selected === job.id ? (
												<tr>
													<td
														colSpan={9}
														className="border-b border-violet-500/30 bg-[#0a0e1a] p-4">
														<div className="grid gap-4 lg:grid-cols-3">
															<div className="space-y-2 rounded-lg border border-[#1e2535] bg-[#0f1117] p-3">
																<h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
																	Job Info
																</h4>
																<div className="space-y-1.5 text-xs">
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">ID</span>
																		<span className="font-mono text-blue-400">
																			{job.id}
																		</span>
																	</div>
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">Agent</span>
																		<span className="text-violet-300">
																			{job.data?.agentId || "-"}
																		</span>
																	</div>
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">
																			Environment
																		</span>
																		<BadgePill
																			label={job.data?.environment || "local"}
																			className={
																				envClass[job.data?.environment || ""] ||
																				envClass.local
																			}
																		/>
																	</div>
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">Duration</span>
																		<span>
																			{job.processedOn && job.finishedOn
																				? formatDuration(
																						job.finishedOn -
																							job.processedOn,
																					)
																				: job.processedOn
																					? "running..."
																					: "-"}
																		</span>
																	</div>
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">Tokens</span>
																		<span>
																			{String(job.data?.tokensUsed ?? "-")}
																		</span>
																	</div>
																	<div className="flex justify-between gap-3">
																		<span className="text-gray-500">Cost</span>
																		<span>
																			{job.data?.costUsd
																				? `$${job.data.costUsd}`
																				: "-"}
																		</span>
																	</div>
																</div>
															</div>

															<div className="space-y-2 rounded-lg border border-[#1e2535] bg-[#0f1117] p-3">
																<h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
																	Logs
																</h4>
																<div className="max-h-48 space-y-1 overflow-y-auto">
																	{logsLoading ? (
																		<div className="py-4 text-center text-xs text-gray-600">
																			Loading logs...
																		</div>
																	) : logs.length === 0 ? (
																		<div className="py-4 text-center text-xs text-gray-600">
																			No persisted logs available
																		</div>
																	) : (
																		logs.map((log) => (
																			<div
																				key={log.id}
																				className="flex gap-2 font-mono text-[11px]">
																				<span
																					className={cn(
																						"w-12 shrink-0",
																						log.level === "error"
																							? "text-red-400"
																							: log.level === "warn"
																								? "text-amber-400"
																								: log.level ===
																									  "success"
																									? "text-emerald-400"
																									: "text-gray-500",
																					)}>
																					{log.level}
																				</span>
																				<span className="shrink-0 text-gray-600">
																					{formatRelativeTime(log.ts)}
																				</span>
																				<span className="text-gray-400">
																					{log.message}
																				</span>
																			</div>
																		))
																	)}
																</div>
															</div>

															<div className="space-y-2 rounded-lg border border-[#1e2535] bg-[#0f1117] p-3">
																<h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
																	Outcome
																</h4>
																{job.status === "failed" ? (
																	<div className="space-y-2 text-xs">
																		<p className="text-red-300">
																			{job.failedReason ||
																				"No failure reason recorded."}
																		</p>
																		<button
																			onClick={() => handleRetry(job.id)}
																			className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-300">
																			Retry Job
																		</button>
																	</div>
																) : job.status === "completed" ? (
																	<p className="py-4 text-center text-xs text-emerald-400">
																		Job completed successfully
																	</p>
																) : (
																	<p className="py-4 text-center text-xs text-gray-500">
																		Outcome available after completion
																	</p>
																)}
															</div>
														</div>
													</td>
												</tr>
											) : null}
										</Fragment>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				<aside className="space-y-4">
					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Snapshot</h3>
						<div className="space-y-2 text-xs">
							<div className="flex justify-between">
								<span className="text-gray-500">Success rate</span>
								<span className="text-[#e2e8f0]">
									{summary?.successRate === null ? "-" : `${summary?.successRate ?? 0}%`}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-500">Jobs run</span>
								<span className="text-[#e2e8f0]">{summary?.totalJobs ?? 0}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-500">Failures</span>
								<span className={(summary?.failed ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}>
									{summary?.failed ?? 0}
								</span>
							</div>
						</div>
					</div>

					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
							Most Active Agents
						</h3>
						<div className="space-y-3">
							{summary?.activeAgents.length ? (
								summary.activeAgents.map((agent) => (
									<div key={agent.name} className="space-y-1">
										<div className="flex justify-between text-xs">
											<span className="truncate text-gray-300">{agent.name}</span>
											<span className="text-gray-500">{agent.count} jobs</span>
										</div>
										<div className="h-1.5 overflow-hidden rounded-full bg-[#1e2535]">
											<div
												className="h-full rounded-full bg-violet-600/60"
												style={{
													width: `${(agent.count / summary.activeAgents[0].count) * 100}%`,
												}}
											/>
										</div>
									</div>
								))
							) : (
								<div className="py-2 text-center text-xs text-gray-600">No agent data</div>
							)}
						</div>
					</div>

					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
							Model Performance
						</h3>
						<div className="space-y-3">
							{summary?.modelPerformance.length ? (
								summary.modelPerformance.map((model) => (
									<div key={model.name} className="space-y-1">
										<div className="flex justify-between text-xs">
											<span className="truncate text-gray-300">{model.name}</span>
											<span
												className={
													model.successRate === null
														? "text-gray-500"
														: model.successRate >= 80
															? "text-emerald-400"
															: model.successRate >= 50
																? "text-amber-400"
																: "text-red-400"
												}>
												{model.successRate === null ? "-" : `${model.successRate}%`}
											</span>
										</div>
										<div className="h-1.5 overflow-hidden rounded-full bg-[#1e2535]">
											<div
												className={cn(
													"h-full rounded-full",
													model.successRate === null
														? "bg-slate-600/60"
														: model.successRate >= 80
															? "bg-emerald-600/60"
															: model.successRate >= 50
																? "bg-amber-600/60"
																: "bg-red-600/60",
												)}
												style={{ width: `${model.successRate ?? 0}%` }}
											/>
										</div>
									</div>
								))
							) : (
								<div className="py-2 text-center text-xs text-gray-600">No model data</div>
							)}
						</div>
					</div>

					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
							Selected Job
						</h3>
						{selectedJob ? (
							<div className="space-y-2 text-xs">
								<div className="flex justify-between gap-3">
									<span className="text-gray-500">Task</span>
									<span className="truncate text-gray-300">
										{selectedJob.data?.task || selectedJob.name}
									</span>
								</div>
								<div className="flex justify-between gap-3">
									<span className="text-gray-500">Status</span>
									<Badge status={selectedJob.status} />
								</div>
								<div className="flex justify-between gap-3">
									<span className="text-gray-500">Created</span>
									<span className="text-gray-300">{formatRelativeTime(selectedJob.timestamp)}</span>
								</div>
							</div>
						) : (
							<div className="py-2 text-center text-xs text-gray-600">Select a job to inspect it</div>
						)}
					</div>
				</aside>
			</div>
		</div>
	)
}
