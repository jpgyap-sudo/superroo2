"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type JobStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "retrying"
	| "cancelled"
	| "waiting"
	| "active"
	| "delayed"

interface Job {
	id: string
	name: string
	data: {
		task?: string
		agentId?: string
		model?: string
		priority?: string
		environment?: string
		commands?: string[]
		network?: string
		inputs?: Record<string, string>
		[key: string]: unknown
	}
	status: JobStatus
	progress?: number
	timestamp: number
	processedOn?: number
	finishedOn?: number
	failedReason?: string
	returnvalue?: unknown
}

interface JobLog {
	id: string
	jobId: string
	ts: number
	level: "debug" | "info" | "warn" | "error" | "success"
	source: string
	message: string
}

interface JobsSummary {
	totalJobs: number
	running: number
	completed: number
	failed: number
	queued: number
	successRate: number
	aiCostToday: number
	systemHealth: string
}

// ── Style maps ─────────────────────────────────────────────────────────────────

const statusClass: Record<string, string> = {
	completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
	failed: "border-red-500/30 bg-red-500/10 text-red-300",
	running: "border-blue-500/30 bg-blue-500/10 text-blue-300",
	active: "border-blue-500/30 bg-blue-500/10 text-blue-300",
	queued: "border-slate-500/30 bg-slate-500/10 text-slate-300",
	waiting: "border-slate-500/30 bg-slate-500/10 text-slate-300",
	delayed: "border-amber-500/30 bg-amber-500/10 text-amber-300",
	retrying: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(ms?: number) {
	if (!ms) return "—"
	const totalSec = Math.floor(ms / 1000)
	const m = Math.floor(totalSec / 60)
	const s = totalSec % 60
	return `${m}m ${s}s`
}

function formatTime(ts?: number) {
	if (!ts) return "—"
	const d = new Date(ts)
	const now = new Date()
	const diff = now.getTime() - d.getTime()
	if (diff < 60000) return "just now"
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function modelIcon(model?: string) {
	if (!model) return "AI"
	const m = model.toLowerCase()
	if (m.includes("claude") || m.includes("sonnet")) return "CL"
	if (m.includes("gpt") || m.includes("4o")) return "GPT"
	if (m.includes("deepseek")) return "DS"
	if (m.includes("kimi")) return "K"
	return "AI"
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
			<div className="text-[11px] text-gray-500 uppercase tracking-widest">{title}</div>
			<div className={cn("mt-1 text-2xl font-bold", danger ? "text-red-300" : "text-[#e2e8f0]")}>{value}</div>
			{delta && <div className="mt-0.5 text-[11px] text-gray-600">{delta}</div>}
		</div>
	)
}

function BadgePill({ label, className }: { label: string; className?: string }) {
	return (
		<span
			className={cn("inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold border", className)}>
			{label}
		</span>
	)
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function JobsView() {
	const [jobs, setJobs] = useState<Job[]>([])
	const [summary, setSummary] = useState<JobsSummary | null>(null)
	const [selected, setSelected] = useState("")
	const [logs, setLogs] = useState<JobLog[]>([])
	const [search, setSearch] = useState("")
	const [filter, setFilter] = useState("All")
	const [loading, setLoading] = useState(true)

	const selectedJob = useMemo(() => jobs.find((j) => j.id === selected), [jobs, selected])

	const filteredJobs = useMemo(() => {
		let list = jobs
		if (filter !== "All") {
			const f = filter.toLowerCase()
			if (f === "running") list = list.filter((j) => j.status === "running" || j.status === "active")
			else if (f === "completed") list = list.filter((j) => j.status === "completed")
			else if (f === "failed") list = list.filter((j) => j.status === "failed")
			else if (f === "autonomous") list = list.filter((j) => j.data?.agentId?.toLowerCase().includes("auto"))
			else if (f === "deployments") list = list.filter((j) => j.data?.task?.toLowerCase().includes("deploy"))
			else if (f === "critical") list = list.filter((j) => j.data?.priority === "critical")
		}
		if (search.trim()) {
			const q = search.toLowerCase()
			list = list.filter(
				(j) =>
					j.id.toLowerCase().includes(q) ||
					(j.name || "").toLowerCase().includes(q) ||
					(j.data?.task || "").toLowerCase().includes(q) ||
					(j.data?.agentId || "").toLowerCase().includes(q),
			)
		}
		return list
	}, [jobs, filter, search])

	// Fetch jobs
	useEffect(() => {
		const fetchJobs = async () => {
			try {
				const [jobsRes, summaryRes] = await Promise.all([
					fetch("/api/jobs?limit=100"),
					fetch("/api/jobs/summary"),
				])
				if (jobsRes.ok) {
					const data = await jobsRes.json()
					setJobs(data.jobs || [])
				}
				if (summaryRes.ok) {
					const data = await summaryRes.json()
					setSummary(data)
				}
			} catch (err) {
				console.error("Error fetching jobs:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchJobs()
		const iv = setInterval(fetchJobs, 5000)
		return () => clearInterval(iv)
	}, [])

	// Fetch logs when a job is selected
	useEffect(() => {
		if (!selected) {
			setLogs([])
			return
		}
		// For now, generate mock logs based on job data
		const job = jobs.find((j) => j.id === selected)
		if (!job) return
		const mockLogs: JobLog[] = [
			{
				id: `${job.id}-l1`,
				jobId: job.id,
				ts: job.timestamp,
				level: "info",
				source: "system",
				message: `Job ${job.name || job.data?.task || "untitled"} created`,
			},
			{
				id: `${job.id}-l2`,
				jobId: job.id,
				ts: job.processedOn || job.timestamp + 1000,
				level: "info",
				source: "system",
				message: "Job picked up by worker",
			},
		]
		if (job.processedOn) {
			mockLogs.push({
				id: `${job.id}-l3`,
				jobId: job.id,
				ts: job.processedOn,
				level: "info",
				source: "agent",
				message: `Agent ${job.data?.agentId || "unknown"} started processing`,
			})
		}
		if (job.status === "completed" && job.finishedOn) {
			mockLogs.push({
				id: `${job.id}-l4`,
				jobId: job.id,
				ts: job.finishedOn,
				level: "success",
				source: "system",
				message: "Job completed successfully",
			})
		}
		if (job.status === "failed" && job.failedReason) {
			mockLogs.push({
				id: `${job.id}-l4`,
				jobId: job.id,
				ts: job.finishedOn || Date.now(),
				level: "error",
				source: "system",
				message: job.failedReason,
			})
		}
		setLogs(mockLogs)
	}, [selected, jobs])

	const handleCancel = async (jobId: string) => {
		try {
			const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" })
			if (res.ok) {
				setJobs((prev) => prev.filter((j) => j.id !== jobId))
			}
		} catch (err) {
			console.error("Error cancelling job:", err)
		}
	}

	const handleRetry = async (jobId: string) => {
		try {
			const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" })
			if (res.ok) {
				const listRes = await fetch("/api/jobs?limit=100")
				if (listRes.ok) {
					const data = await listRes.json()
					setJobs(data.jobs || [])
				}
			}
		} catch (err) {
			console.error("Error retrying job:", err)
		}
	}

	// ── Loading state ──
	if (loading) {
		return (
			<Card className="overflow-hidden">
				<div className="py-12 text-center text-gray-500 text-sm">Loading jobs...</div>
			</Card>
		)
	}

	// ── Compute summary from real data ──
	const running = jobs.filter((j) => j.status === "running" || j.status === "active").length
	const completed = jobs.filter((j) => j.status === "completed").length
	const failed = jobs.filter((j) => j.status === "failed").length
	const queued = jobs.filter((j) => j.status === "queued" || j.status === "waiting" || j.status === "delayed").length
	const successRate = jobs.length > 0 ? Math.round((completed / (completed + failed || 1)) * 100) : 100

	return (
		<div className="space-y-4">
			{/* ── Metric Cards ── */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				<MetricCard title="Total Jobs" value={String(jobs.length)} />
				<MetricCard title="Running" value={String(running)} delta={`${queued} queued`} />
				<MetricCard title="Completed" value={String(completed)} delta={`${successRate}% success`} />
				<MetricCard title="Failed" value={String(failed)} danger={failed > 0} />
				<MetricCard title="AI Cost Today" value={summary ? `$${summary.aiCostToday.toFixed(2)}` : "$0.00"} />
				<MetricCard title="System Health" value={summary?.systemHealth || "Healthy"} />
			</div>

			{/* ── Main Content ── */}
			<div className="grid gap-4 xl:grid-cols-[1fr_280px]">
				{/* ── Jobs Table ── */}
				<section className="rounded-xl border border-[#1e2535] bg-[#0f1117] overflow-hidden">
					{/* Filters + Search */}
					<div className="flex flex-wrap items-center gap-2 border-b border-[#1e2535] px-4 py-3">
						<div className="flex flex-wrap gap-1">
							{["All", "Running", "Completed", "Failed", "Autonomous", "Deployments", "Critical"].map(
								(f) => (
									<button
										key={f}
										onClick={() => setFilter(f)}
										className={cn(
											"rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
											filter === f
												? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
												: "text-gray-500 hover:text-gray-300 border border-transparent",
										)}>
										{f}
									</button>
								),
							)}
						</div>
						<div className="ml-auto">
							<input
								type="text"
								placeholder="Search jobs..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="w-44 rounded border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-violet-500/40"
							/>
						</div>
					</div>

					{/* Table */}
					{filteredJobs.length === 0 ? (
						<div className="py-12 text-center text-gray-500 text-sm">No jobs found</div>
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
										<th className="px-3 py-2.5 font-medium">Environment</th>
										<th className="px-3 py-2.5 font-medium">CPU</th>
										<th className="px-3 py-2.5 font-medium">RAM</th>
										<th className="px-3 py-2.5 font-medium">Tokens</th>
										<th className="px-3 py-2.5 font-medium">Cost</th>
										<th className="px-3 py-2.5 font-medium">Created</th>
										<th className="px-3 py-2.5 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{filteredJobs.map((job) => (
										<>
											<tr
												key={job.id}
												onClick={() => setSelected(selected === job.id ? "" : job.id)}
												className={cn(
													"cursor-pointer border-b border-[#1e2535]/50 hover:bg-[#0a0e1a]/60 transition-colors",
													selected === job.id
														? "bg-[#0a0e1a]/70 outline outline-1 outline-violet-500/40"
														: "",
												)}>
												<td className="px-3 py-2.5 font-mono text-xs text-blue-400">
													{job.id.slice(0, 8)}
												</td>
												<td className="px-3 py-2.5 text-gray-300 max-w-[160px] truncate">
													{job.data?.task || job.name || "Untitled"}
												</td>
												<td className="px-3 py-2.5 text-violet-300">
													{job.data?.agentId || "—"}
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
														className={statusClass[job.status] || statusClass.queued}
													/>
												</td>
												<td className="px-3 py-2.5">
													<BadgePill
														label={job.data?.environment || "local"}
														className={
															envClass[job.data?.environment || ""] ||
															"border-slate-500/40 bg-slate-500/10 text-slate-300"
														}
													/>
												</td>
												<td className="px-3 py-2.5 text-gray-500 text-xs">
													{String(job.data?.cpuPercent ?? "—")}
												</td>
												<td className="px-3 py-2.5 text-gray-500 text-xs">
													{job.data?.ramMb ? `${String(job.data.ramMb)}MB` : "—"}
												</td>
												<td className="px-3 py-2.5 text-gray-500 text-xs">
													{String(job.data?.tokensUsed ?? "—")}
												</td>
												<td className="px-3 py-2.5 text-gray-500 text-xs">
													{job.data?.costUsd ? `$${String(job.data.costUsd)}` : "—"}
												</td>
												<td className="px-3 py-2.5 text-gray-500 text-xs">
													{formatTime(job.timestamp)}
												</td>
												<td className="px-3 py-2.5">
													<div className="flex gap-1">
														{job.status !== "completed" &&
															job.status !== "failed" &&
															job.status !== "cancelled" && (
																<button
																	onClick={(e) => {
																		e.stopPropagation()
																		handleCancel(job.id)
																	}}
																	className="rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[10px] text-red-400 hover:bg-[#1e2535]">
																	Cancel
																</button>
															)}
														{job.status === "failed" && (
															<button
																onClick={(e) => {
																	e.stopPropagation()
																	handleRetry(job.id)
																}}
																className="rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[10px] text-amber-400 hover:bg-[#1e2535]">
																Retry
															</button>
														)}
													</div>
												</td>
											</tr>
											{/* Expanded detail row */}
											{selected === job.id && (
												<tr key={`${job.id}-detail`}>
													<td
														colSpan={13}
														className="border-b border-violet-500/30 bg-[#0a0e1a] p-4">
														<div className="grid gap-4 lg:grid-cols-3">
															{/* Job Info Card */}
															<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] p-3 space-y-2">
																<h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
																	Job Info
																</h4>
																<div className="space-y-1.5 text-xs">
																	<div className="flex justify-between">
																		<span className="text-gray-500">ID</span>
																		<span className="text-blue-400 font-mono">
																			{job.id}
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Agent</span>
																		<span className="text-violet-300">
																			{job.data?.agentId || "—"}
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Model</span>
																		<span>{job.data?.model || "—"}</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">
																			Environment
																		</span>
																		<span>
																			<BadgePill
																				label={job.data?.environment || "local"}
																				className={
																					envClass[
																						job.data?.environment || ""
																					] ||
																					"border-slate-500/40 bg-slate-500/10 text-slate-300"
																				}
																			/>
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Priority</span>
																		<span>
																			<BadgePill
																				label={job.data?.priority || "normal"}
																				className={
																					priorityClass[
																						job.data?.priority || ""
																					] ||
																					"border-slate-500/40 bg-slate-500/10 text-slate-300"
																				}
																			/>
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Duration</span>
																		<span>
																			{job.processedOn && job.finishedOn
																				? formatDuration(
																						job.finishedOn -
																							job.processedOn,
																					)
																				: job.processedOn
																					? "running..."
																					: "—"}
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Tokens</span>
																		<span>
																			{String(job.data?.tokensUsed ?? "—")}
																		</span>
																	</div>
																	<div className="flex justify-between">
																		<span className="text-gray-500">Cost</span>
																		<span>
																			{job.data?.costUsd
																				? `$${String(job.data.costUsd)}`
																				: "—"}
																		</span>
																	</div>
																</div>
															</div>

															{/* Logs Panel */}
															<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] p-3 space-y-2">
																<h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
																	Logs
																</h4>
																<div className="max-h-48 overflow-y-auto space-y-1">
																	{logs.length === 0 ? (
																		<div className="text-xs text-gray-600 py-4 text-center">
																			No logs available
																		</div>
																	) : (
																		logs.map((l) => (
																			<div
																				key={l.id}
																				className="flex gap-2 text-[11px] font-mono">
																				<span
																					className={cn(
																						"shrink-0 w-12",
																						l.level === "error"
																							? "text-red-400"
																							: l.level === "warn"
																								? "text-amber-400"
																								: l.level === "success"
																									? "text-emerald-400"
																									: "text-gray-500",
																					)}>
																					{l.level}
																				</span>
																				<span className="text-gray-600 shrink-0">
																					{formatTime(l.ts)}
																				</span>
																				<span className="text-gray-400">
																					{l.message}
																				</span>
																			</div>
																		))
																	)}
																</div>
															</div>

															{/* AI Analysis */}
															<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] p-3 space-y-2">
																<h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
																	AI Analysis
																</h4>
																{job.status === "failed" ? (
																	<div className="space-y-2">
																		<div>
																			<div className="text-[11px] text-gray-500 mb-0.5">
																				Root Cause
																			</div>
																			<div className="text-xs text-red-300">
																				{job.failedReason?.slice(0, 120) ||
																					"Unknown error"}
																			</div>
																		</div>
																		<div>
																			<div className="text-[11px] text-gray-500 mb-0.5">
																				Suggested Fix
																			</div>
																			<div className="text-xs text-amber-300">
																				Review error logs and retry the job
																			</div>
																		</div>
																		<div className="flex gap-2 pt-1">
																			<button
																				onClick={() => handleRetry(job.id)}
																				className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors">
																				Retry Job
																			</button>
																			<button className="rounded border border-[#1e2535] px-3 py-1.5 text-xs text-gray-400 hover:bg-[#1e2535] transition-colors">
																				View Details
																			</button>
																		</div>
																	</div>
																) : job.status === "completed" ? (
																	<div className="text-xs text-emerald-400 py-4 text-center">
																		Job completed successfully
																	</div>
																) : (
																	<div className="text-xs text-gray-500 py-4 text-center">
																		Analysis available after completion
																	</div>
																)}
															</div>
														</div>
													</td>
												</tr>
											)}
										</>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				{/* ── Right Sidebar ── */}
				<aside className="space-y-4">
					{/* AI Insights Today */}
					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
							AI Insights Today
						</h3>
						<div className="space-y-2">
							<div className="flex justify-between text-xs">
								<span className="text-gray-500">Success Rate</span>
								<span
									className={cn(
										"font-medium",
										successRate >= 80
											? "text-emerald-400"
											: successRate >= 50
												? "text-amber-400"
												: "text-red-400",
									)}>
									{successRate}%
								</span>
							</div>
							<div className="flex justify-between text-xs">
								<span className="text-gray-500">Jobs Run</span>
								<span className="text-[#e2e8f0]">{jobs.length}</span>
							</div>
							<div className="flex justify-between text-xs">
								<span className="text-gray-500">Failures</span>
								<span className={failed > 0 ? "text-red-400" : "text-emerald-400"}>{failed}</span>
							</div>
						</div>
					</div>

					{/* Most Active Agents */}
					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
							Most Active Agents
						</h3>
						<div className="space-y-3">
							{(() => {
								const agentCounts: Record<string, number> = {}
								jobs.forEach((j) => {
									const a = j.data?.agentId || "unknown"
									agentCounts[a] = (agentCounts[a] || 0) + 1
								})
								const sorted = Object.entries(agentCounts)
									.sort((a, b) => b[1] - a[1])
									.slice(0, 5)
								const maxCount = sorted.length > 0 ? sorted[0][1] : 1
								return sorted.length === 0 ? (
									<div className="text-xs text-gray-600 text-center py-2">No agents active</div>
								) : (
									sorted.map(([agent, count]) => (
										<div key={agent} className="space-y-1">
											<div className="flex justify-between text-xs">
												<span className="text-gray-300 truncate">{agent}</span>
												<span className="text-gray-500">{count} jobs</span>
											</div>
											<div className="h-1.5 rounded-full bg-[#1e2535] overflow-hidden">
												<div
													className="h-full rounded-full bg-violet-600/60 transition-all"
													style={{ width: `${(count / maxCount) * 100}%` }}
												/>
											</div>
										</div>
									))
								)
							})()}
						</div>
					</div>

					{/* AI Model Performance */}
					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
							AI Model Performance
						</h3>
						<div className="space-y-3">
							{(() => {
								const modelCounts: Record<string, { total: number; failed: number }> = {}
								jobs.forEach((j) => {
									const m = j.data?.model || "default"
									if (!modelCounts[m]) modelCounts[m] = { total: 0, failed: 0 }
									modelCounts[m].total++
									if (j.status === "failed") modelCounts[m].failed++
								})
								const sorted = Object.entries(modelCounts)
									.sort((a, b) => b[1].total - a[1].total)
									.slice(0, 5)
								return sorted.length === 0 ? (
									<div className="text-xs text-gray-600 text-center py-2">No model data</div>
								) : (
									sorted.map(([model, stats]) => {
										const rate =
											stats.total > 0
												? Math.round(((stats.total - stats.failed) / stats.total) * 100)
												: 100
										return (
											<div key={model} className="space-y-1">
												<div className="flex justify-between text-xs">
													<span className="text-gray-300 truncate">{model}</span>
													<span
														className={
															rate >= 80
																? "text-emerald-400"
																: rate >= 50
																	? "text-amber-400"
																	: "text-red-400"
														}>
														{rate}%
													</span>
												</div>
												<div className="h-1.5 rounded-full bg-[#1e2535] overflow-hidden">
													<div
														className={cn(
															"h-full rounded-full transition-all",
															rate >= 80
																? "bg-emerald-600/60"
																: rate >= 50
																	? "bg-amber-600/60"
																	: "bg-red-600/60",
														)}
														style={{ width: `${rate}%` }}
													/>
												</div>
											</div>
										)
									})
								)
							})()}
						</div>
					</div>

					{/* Recent Notifications */}
					<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4">
						<h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
							Recent Notifications
						</h3>
						<div className="space-y-2">
							{failed > 0 ? (
								<div className="flex items-start gap-2 text-xs">
									<div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
									<div>
										<div className="text-red-300">
											{failed} job{failed > 1 ? "s" : ""} failed
										</div>
										<div className="text-gray-600">{formatTime(Date.now())}</div>
									</div>
								</div>
							) : null}
							{completed > 0 ? (
								<div className="flex items-start gap-2 text-xs">
									<div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
									<div>
										<div className="text-emerald-300">
											{completed} job{completed > 1 ? "s" : ""} completed
										</div>
										<div className="text-gray-600">{formatTime(Date.now())}</div>
									</div>
								</div>
							) : null}
							{running > 0 ? (
								<div className="flex items-start gap-2 text-xs">
									<div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
									<div>
										<div className="text-blue-300">
											{running} job{running > 1 ? "s" : ""} running
										</div>
										<div className="text-gray-600">{formatTime(Date.now())}</div>
									</div>
								</div>
							) : null}
							{failed === 0 && completed === 0 && running === 0 ? (
								<div className="text-xs text-gray-600 text-center py-2">No notifications</div>
							) : null}
						</div>
					</div>
				</aside>
			</div>
		</div>
	)
}
