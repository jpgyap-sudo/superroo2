"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import {
	Search,
	AlertTriangle,
	CheckCircle2,
	Info,
	Brain,
	Activity,
	Terminal,
	Download,
	RefreshCw,
	Filter,
} from "lucide-react"
import { Card } from "@/components/ui/card"

/* ─── Types ─── */

type LogLevel = "info" | "warn" | "error" | "success" | "ai" | "security"
type HealthStatus = "healthy" | "warning" | "failed" | "offline"

interface LogEntry {
	id: string
	time: string
	timestamp: string
	level: LogLevel
	agent: string
	source: string
	message: string
	status: string
	model?: string
	cost?: string
	workspace?: string
	project?: string
	taskId?: string
	commit?: string
	retryCount?: number
	durationMs?: number
	tokenUsage?: number
}

interface ServiceHealth {
	label: string
	value: string
	sub: string
	status: HealthStatus
	icon: string
}

interface ApiMonitorRow {
	api: string
	status: "Healthy" | "Slow" | "Failed"
	latency: string
	fallback: string
}

interface TimelineStep {
	name: string
	status: "done" | "running" | "pending" | "failed"
}

/* ─── Helpers ─── */

const levelClass: Record<LogLevel, string> = {
	error: "border-red-500/40 bg-red-500/10 text-red-300",
	warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
	info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
	success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
	ai: "border-violet-500/40 bg-violet-500/10 text-violet-300",
	security: "border-orange-500/40 bg-orange-500/10 text-orange-300",
}

const statusDotClass: Record<HealthStatus, string> = {
	healthy: "bg-emerald-400",
	warning: "bg-amber-400",
	failed: "bg-red-400",
	offline: "bg-slate-500",
}

function filterLogs(logs: LogEntry[], query: string): LogEntry[] {
	const q = query.trim().toLowerCase()
	if (!q) return logs
	return logs.filter((log) =>
		[
			log.id,
			log.time,
			log.level,
			log.agent,
			log.source,
			log.message,
			log.status,
			log.model,
			log.workspace,
			log.project,
			log.taskId,
			log.commit,
		]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(q)),
	)
}

function formatCost(cost?: string): string {
	return cost || "—"
}

function apiStatusClass(status: string) {
	if (status === "Healthy") return "text-emerald-300"
	if (status === "Slow") return "text-amber-300"
	return "text-red-300"
}

/* ─── Sub-components ─── */

function LogBadge({ children, type = "info" }: { children: React.ReactNode; type?: LogLevel }) {
	return (
		<span
			className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${levelClass[type]}`}>
			{children}
		</span>
	)
}

function MiniChart() {
	const bars = [32, 54, 42, 72, 60, 88, 48, 76, 66, 92]
	return (
		<div className="flex h-28 items-end gap-2 rounded-xl border border-slate-700/40 bg-[#080b13] p-3">
			{bars.map((height, index) => (
				<div key={index} className="flex-1 rounded-t-lg bg-violet-500/40" style={{ height: `${height}%` }} />
			))}
		</div>
	)
}

function TimelineIcon({ status }: { status: TimelineStep["status"] }) {
	if (status === "done") return <CheckCircle2 size={16} className="text-emerald-300" />
	if (status === "running") return <Activity size={16} className="text-violet-300" />
	return <span className="text-slate-500">◷</span>
}

/* ─── API Helpers ─── */

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
	try {
		const res = await fetch(url)
		if (res.ok) {
			const data = await res.json()
			return data
		}
	} catch {
		// silent
	}
	return fallback
}

/* ─── Main Component ─── */

export function LogsView() {
	const [selected, setSelected] = useState<LogEntry | null>(null)
	const [query, setQuery] = useState("")
	const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])
	const [health, setHealth] = useState<ServiceHealth[]>([])
	const [apiRows, setApiRows] = useState<ApiMonitorRow[]>([])
	const [timeline, setTimeline] = useState<TimelineStep[]>([])
	const [loading, setLoading] = useState(true)
	const [levelFilter, setLevelFilter] = useState<string>("all")

	const fetchAll = useCallback(async () => {
		const [logsData, healthData, apiData, timelineData] = await Promise.all([
			fetchJson<{ logs?: string[] }>("/api/logs?limit=100", { logs: [] }),
			fetchJson<{ health?: ServiceHealth[] }>("/api/orchestrator/health", { health: [] }),
			fetchJson<{ apis?: ApiMonitorRow[] }>("/api/orchestrator/api-monitor", { apis: [] }),
			fetchJson<{ timeline?: TimelineStep[] }>("/api/orchestrator/timeline", { timeline: [] }),
		])

		if (logsData.logs?.length) {
			setLiveLogs(
				logsData.logs.map((l: string, i: number) => ({
					id: `log_${i}`,
					time: l.slice(0, 8),
					timestamp: new Date().toISOString(),
					level:
						l.includes("error") || l.includes("FAILED")
							? ("error" as const)
							: l.includes("warn")
								? ("warn" as const)
								: ("info" as const),
					agent: "System",
					source: "API",
					message: l,
					status: l.includes("error") ? "Error" : "OK",
				})),
			)
		}
		if (healthData.health?.length) setHealth(healthData.health)
		if (apiData.apis?.length) setApiRows(apiData.apis)
		if (timelineData.timeline?.length) setTimeline(timelineData.timeline)
		setLoading(false)
	}, [])

	useEffect(() => {
		fetchAll()
		const iv = setInterval(fetchAll, 5000)
		return () => clearInterval(iv)
	}, [fetchAll])

	const visibleLogs = useMemo(() => {
		let filtered = filterLogs(liveLogs, query)
		if (levelFilter !== "all") {
			filtered = filtered.filter((l) => l.level === levelFilter)
		}
		return filtered
	}, [liveLogs, query, levelFilter])

	const handleExport = () => {
		const csv = [
			"Time,Level,Agent,Source,Message,Status,Model,Cost",
			...visibleLogs.map(
				(l) =>
					`${l.time},${l.level},${l.agent},${l.source},"${l.message.replace(/"/g, '""')}",${l.status},${l.model || ""},${l.cost || ""}`,
			),
		].join("\n")
		const blob = new Blob([csv], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `logs-${new Date().toISOString().slice(0, 10)}.csv`
		a.click()
		URL.revokeObjectURL(url)
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Terminal className="h-6 w-6 animate-pulse text-violet-500" />
				<span className="ml-3 text-sm text-gray-600">Loading logs...</span>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* ── Header ── */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-slate-100">Logs Mission Control</h1>
					<p className="text-xs text-slate-400">
						Realtime agent, API, deployment, model, and autonomous loop observability.
					</p>
				</div>
				<div className="flex gap-2">
					<button
						onClick={fetchAll}
						className="flex items-center gap-1.5 rounded-md border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/50">
						<RefreshCw size={12} />
						Refresh
					</button>
					<button
						onClick={handleExport}
						className="flex items-center gap-1.5 rounded-md border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/50">
						<Download size={12} />
						Export CSV
					</button>
					<button className="rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20">
						Generate Incident Report
					</button>
				</div>
			</div>

			{/* ── Service Health Cards ── */}
			{health.length > 0 && (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
					{health.map((item) => (
						<Card
							key={item.label}
							className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex items-center justify-between">
								<div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-800/60 text-slate-300 text-sm">
									{item.icon}
								</div>
								<span className={`h-2.5 w-2.5 rounded-full ${statusDotClass[item.status]}`} />
							</div>
							<div className="mt-3 text-[11px] uppercase tracking-widest text-gray-500">{item.label}</div>
							<div className="text-sm font-semibold text-slate-100">{item.value}</div>
							<div className="text-[11px] text-gray-500">{item.sub}</div>
						</Card>
					))}
				</div>
			)}

			{/* ── Main Grid: Log Stream (left) + Sidebar (right) ── */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
				{/* ── Left Column ── */}
				<div className="space-y-4">
					{/* Search & Filters */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex flex-wrap items-center gap-2">
							<div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-lg border border-slate-700/40 bg-[#080b13] px-3 py-2 text-slate-400">
								<Search size={14} />
								<input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									className="w-full bg-transparent text-xs outline-none placeholder:text-slate-500"
									placeholder="Search job ID, error, endpoint, agent, commit..."
								/>
							</div>
							<div className="flex items-center gap-1">
								<Filter size={12} className="text-slate-500" />
								{(["all", "error", "warn", "info", "success", "ai", "security"] as const).map(
									(level) => (
										<button
											key={level}
											onClick={() => setLevelFilter(level)}
											className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
												levelFilter === level
													? "border-violet-500/50 bg-violet-500/10 text-violet-300"
													: "border-slate-700/40 bg-[#080b13] text-slate-400 hover:bg-slate-800/50"
											}`}>
											{level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
										</button>
									),
								)}
							</div>
						</div>
					</Card>

					{/* Realtime Log Stream */}
					<Card className="overflow-hidden border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
							<div className="flex items-center gap-2">
								<Terminal size={14} className="text-slate-400" />
								<span className="text-xs font-semibold uppercase tracking-wide text-slate-100">
									Realtime Log Stream
								</span>
								<span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
									{visibleLogs.length}
								</span>
							</div>
							<span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
								<span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> auto-refresh
								5s
							</span>
						</div>
						<div className="divide-y divide-slate-800/50">
							{visibleLogs.length === 0 && (
								<div className="px-4 py-8 text-center text-xs text-slate-500">
									No logs match your filter
								</div>
							)}
							{visibleLogs.map((log) => (
								<button
									key={log.id}
									onClick={() => setSelected(log)}
									className={`grid w-full grid-cols-[80px_80px_80px_1fr_100px_70px] items-center gap-2 px-4 py-2.5 text-left text-xs hover:bg-slate-800/30 ${selected?.id === log.id ? "bg-violet-500/10" : ""}`}>
									<span className="font-mono text-[11px] text-slate-500">{log.time}</span>
									<LogBadge type={log.level}>{log.level.toUpperCase()}</LogBadge>
									<span className="text-slate-300">{log.agent}</span>
									<span className="truncate text-slate-300">{log.message}</span>
									<span className="text-[11px] text-slate-500">{log.status}</span>
									<span className="text-[11px] text-slate-500">{formatCost(log.cost)}</span>
								</button>
							))}
						</div>
					</Card>

					{/* Bottom Grid: Timeline + Ask AI */}
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="mb-3 flex items-center justify-between">
								<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
									Autonomous Loop Timeline
								</h3>
								{timeline.length > 0 && <LogBadge type="ai">Session #SR-2041</LogBadge>}
							</div>
							{timeline.length > 0 ? (
								<div className="flex items-center gap-2">
									{timeline.map((step, index) => (
										<div key={step.name} className="flex items-center">
											<div className="flex flex-col items-center gap-1.5">
												<div
													className={`grid h-9 w-9 place-items-center rounded-full border ${
														step.status === "done"
															? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
															: step.status === "running"
																? "border-violet-400/40 bg-violet-500/10 text-violet-300"
																: "border-slate-700 bg-slate-800/50 text-slate-500"
													}`}>
													<TimelineIcon status={step.status} />
												</div>
												<span className="text-[10px] text-slate-400">{step.name}</span>
											</div>
											{index < timeline.length - 1 && (
												<div className="mb-6 h-px w-4 flex-1 bg-slate-700/40" />
											)}
										</div>
									))}
								</div>
							) : (
								<div className="py-4 text-center text-xs text-slate-500">No active timeline</div>
							)}
						</Card>

						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
								Ask Logs AI
							</h3>
							<div className="rounded-lg border border-slate-700/40 bg-[#080b13] p-3 text-xs text-slate-400 leading-relaxed">
								Why did deployment fail? Show all API errors today. Which agent used the most tokens?
							</div>
							<button className="mt-3 w-full rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-slate-200">
								Analyze Current Logs
							</button>
						</Card>
					</div>
				</div>

				{/* ── Right Sidebar ── */}
				<div className="space-y-4">
					{/* AI Root Cause Analysis */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Brain size={16} className="text-violet-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-violet-200">
								AI Root Cause Analysis
							</h3>
						</div>
						<p className="text-xs leading-relaxed text-slate-300">
							{liveLogs.some((l) => l.level === "error")
								? "Errors detected in recent logs. Analyzing patterns for root cause identification."
								: "No errors detected in recent logs. System appears healthy."}
						</p>
						{liveLogs.filter((l) => l.level === "error").length > 0 && (
							<div className="mt-3 space-y-1.5 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3 text-xs">
								<div className="font-semibold text-violet-200">Detected Issues</div>
								<div className="text-[11px] text-slate-400">
									{liveLogs.filter((l) => l.level === "error").length} error(s) in current view
								</div>
							</div>
						)}
						<div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
							<span>Confidence</span>
							<span className="font-semibold text-emerald-300">87%</span>
						</div>
					</Card>

					{/* API Failure Monitor */}
					{apiRows.length > 0 && (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="mb-3 flex items-center gap-2">
								<AlertTriangle size={14} className="text-amber-400" />
								<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
									API Failure Monitor
								</h3>
							</div>
							<div className="space-y-2">
								{apiRows.map((row) => (
									<div
										key={row.api}
										className="grid grid-cols-[1fr_60px_50px] items-center gap-2 rounded-lg bg-slate-800/30 p-2 text-xs">
										<div>
											<div className="font-medium text-slate-200">{row.api}</div>
											<div className="text-[11px] text-slate-500">Fallback: {row.fallback}</div>
										</div>
										<span className={apiStatusClass(row.status)}>{row.status}</span>
										<span className="text-slate-500">{row.latency}</span>
									</div>
								))}
							</div>
						</Card>
					)}

					{/* Live Volume */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Activity size={14} className="text-slate-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Live Volume
							</h3>
						</div>
						<MiniChart />
					</Card>

					{/* Selected Log Detail */}
					{selected && (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="mb-3 flex items-center gap-2">
								<Info size={14} className="text-slate-400" />
								<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
									Selected Log Detail
								</h3>
							</div>
							<div className="space-y-2 text-xs text-slate-400">
								<div className="flex justify-between border-b border-slate-800/50 pb-1.5">
									<span>Agent</span>
									<span className="text-slate-200">{selected.agent}</span>
								</div>
								<div className="flex justify-between border-b border-slate-800/50 pb-1.5">
									<span>Source</span>
									<span className="text-slate-200">{selected.source}</span>
								</div>
								<div className="flex justify-between border-b border-slate-800/50 pb-1.5">
									<span>Model</span>
									<span className="text-slate-200">{selected.model || "—"}</span>
								</div>
								<div className="flex justify-between border-b border-slate-800/50 pb-1.5">
									<span>Cost</span>
									<span className="text-slate-200">{formatCost(selected.cost)}</span>
								</div>
								<div className="flex justify-between pb-1.5">
									<span>Commit</span>
									<span className="text-slate-200">{selected.commit || "—"}</span>
								</div>
							</div>
							<button className="mt-3 w-full rounded-md border border-slate-600/50 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/50">
								Open full trace
							</button>
						</Card>
					)}
				</div>
			</div>
		</div>
	)
}
