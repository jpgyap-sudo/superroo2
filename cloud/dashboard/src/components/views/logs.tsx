"use client"

import { useEffect, useMemo, useState } from "react"
import {
	Search,
	AlertTriangle,
	CheckCircle2,
	Info,
	Brain,
	Activity,
	Terminal,
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
		[log.id, log.time, log.level, log.agent, log.source, log.message, log.status, log.model, log.workspace, log.project, log.taskId, log.commit]
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
	return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${levelClass[type]}`}>{children}</span>
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

/* ─── Mock Data ─── */

const MOCK_HEALTH: ServiceHealth[] = [
	{ label: "API", value: "Healthy", sub: "42ms", status: "healthy", icon: "◉" },
	{ label: "Worker", value: "8 active", sub: "62% CPU", status: "healthy", icon: "⚙" },
	{ label: "Redis", value: "Online", sub: "1.8ms", status: "healthy", icon: "◆" },
	{ label: "Docker", value: "12 containers", sub: "11 up", status: "healthy", icon: "▣" },
	{ label: "Queue", value: "41 pending", sub: "6 urgent", status: "warning", icon: "☰" },
]

const MOCK_LOGS: LogEntry[] = [
	{ id: "log_001", time: "12:31:02", timestamp: new Date().toISOString(), level: "error", agent: "Debugger", source: "API", message: "Coinglass funding endpoint returned 429 rate limit", status: "Fallback triggered", model: "Claude", cost: "$0.04", workspace: "xsjprd55", project: "Trading Bot", taskId: "task_9041", commit: "a81fd12", retryCount: 3, durationMs: 8920, tokenUsage: 3921 },
	{ id: "log_002", time: "12:31:08", timestamp: new Date().toISOString(), level: "success", agent: "Coder", source: "Deploy", message: "Patch committed to services/coinglass/parser.ts", status: "Passed", model: "GPT-5", cost: "$0.07", commit: "b14ac91" },
	{ id: "log_003", time: "12:31:11", timestamp: new Date().toISOString(), level: "warn", agent: "Crawler", source: "SSR", message: "Playwright fallback slower than expected on liquidation heatmap", status: "Retry 2/3", model: "DeepSeek", cost: "$0.01", retryCount: 2 },
	{ id: "log_004", time: "12:32:25", timestamp: new Date().toISOString(), level: "info", agent: "Planner", source: "Task", message: "Created autonomous repair plan for Trading Bot API failures", status: "Running", model: "GPT-5", cost: "$0.03" },
	{ id: "log_005", time: "12:33:04", timestamp: new Date().toISOString(), level: "ai", agent: "Research", source: "News", message: "Detected Binance maintenance notice and linked it to API errors", status: "Analyzed", model: "Kimi", cost: "$0.02" },
	{ id: "log_006", time: "12:34:40", timestamp: new Date().toISOString(), level: "security", agent: "Approvals", source: "Policy", message: "Blocked shell command requiring manual approval", status: "Needs review", model: "Policy", cost: "—" },
]

const MOCK_API_ROWS: ApiMonitorRow[] = [
	{ api: "Binance", status: "Healthy", latency: "120ms", fallback: "—" },
	{ api: "Coinglass", status: "Failed", latency: "timeout", fallback: "SSR crawler" },
	{ api: "Birdeye", status: "Slow", latency: "4.2s", fallback: "retry" },
	{ api: "DeFiLlama", status: "Healthy", latency: "210ms", fallback: "—" },
]

const MOCK_TIMELINE: TimelineStep[] = [
	{ name: "Planner", status: "done" },
	{ name: "Coder", status: "done" },
	{ name: "Tester", status: "running" },
	{ name: "Debugger", status: "pending" },
	{ name: "Deploy Checker", status: "pending" },
]

/* ─── Main Component ─── */

export function LogsView() {
	const [selected, setSelected] = useState<LogEntry>(MOCK_LOGS[0])
	const [query, setQuery] = useState("")
	const [liveLogs, setLiveLogs] = useState<LogEntry[]>(MOCK_LOGS)
	const [health, setHealth] = useState<ServiceHealth[]>(MOCK_HEALTH)

	useEffect(() => {
		const fetchLogs = async () => {
			try {
				const res = await fetch("/api/logs?limit=100")
				if (res.ok) {
					const data = await res.json()
					if (data.logs?.length) {
						setLiveLogs(data.logs.map((l: string, i: number) => ({
							id: `log_${i}`,
							time: l.slice(0, 8),
							timestamp: new Date().toISOString(),
							level: l.includes("error") || l.includes("FAILED") ? "error" as const : l.includes("warn") ? "warn" as const : "info" as const,
							agent: "System",
							source: "API",
							message: l,
							status: l.includes("error") ? "Error" : "OK",
						})))
					}
				}
			} catch (err) {
				console.error("Error fetching logs:", err)
			}
		}
		fetchLogs()
		const iv = setInterval(fetchLogs, 5000)
		return () => clearInterval(iv)
	}, [])

	const visibleLogs = useMemo(() => filterLogs(liveLogs, query), [liveLogs, query])

	return (
		<div className="space-y-4">
			{/* ── Header ── */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-slate-100">Logs Mission Control</h1>
					<p className="text-xs text-slate-400">Realtime agent, API, deployment, model, and autonomous loop observability.</p>
				</div>
				<div className="flex gap-2">
					<button className="rounded-md border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/50">Export</button>
					<button className="rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20">Generate Incident Report</button>
				</div>
			</div>

			{/* ── Service Health Cards ── */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{health.map((item) => (
					<Card key={item.label} className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex items-center justify-between">
							<div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-800/60 text-slate-300 text-sm">{item.icon}</div>
							<span className={`h-2.5 w-2.5 rounded-full ${statusDotClass[item.status]}`} />
						</div>
						<div className="mt-3 text-[11px] uppercase tracking-widest text-gray-500">{item.label}</div>
						<div className="text-sm font-semibold text-slate-100">{item.value}</div>
						<div className="text-[11px] text-gray-500">{item.sub}</div>
					</Card>
				))}
			</div>

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
							{["All Agents", "Errors", "Last 24h", "All Models"].map((filter) => (
								<button key={filter} className="rounded-lg border border-slate-700/40 bg-[#080b13] px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/50">
									{filter} ▾
								</button>
							))}
						</div>
					</Card>

					{/* Realtime Log Stream */}
					<Card className="overflow-hidden border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
							<div className="flex items-center gap-2">
								<Terminal size={14} className="text-slate-400" />
								<span className="text-xs font-semibold uppercase tracking-wide text-slate-100">Realtime Log Stream</span>
							</div>
							<span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
								<span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> auto-refresh 1s
							</span>
						</div>
						<div className="divide-y divide-slate-800/50">
							{visibleLogs.length === 0 && (
								<div className="px-4 py-8 text-center text-xs text-slate-500">No logs match your filter</div>
							)}
							{visibleLogs.map((log) => (
								<button
									key={log.id}
									onClick={() => setSelected(log)}
									className={`grid w-full grid-cols-[80px_80px_80px_1fr_100px_70px] items-center gap-2 px-4 py-2.5 text-left text-xs hover:bg-slate-800/30 ${selected.id === log.id ? "bg-violet-500/10" : ""}`}
								>
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
								<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">Autonomous Loop Timeline</h3>
								<LogBadge type="ai">Session #SR-2041</LogBadge>
							</div>
							<div className="flex items-center gap-2">
								{MOCK_TIMELINE.map((step, index) => (
									<div key={step.name} className="flex items-center">
										<div className="flex flex-col items-center gap-1.5">
											<div
												className={`grid h-9 w-9 place-items-center rounded-full border ${
													step.status === "done"
														? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
														: step.status === "running"
															? "border-violet-400/40 bg-violet-500/10 text-violet-300"
															: "border-slate-700 bg-slate-800/50 text-slate-500"
												}`}
											>
												<TimelineIcon status={step.status} />
											</div>
											<span className="text-[10px] text-slate-400">{step.name}</span>
										</div>
										{index < MOCK_TIMELINE.length - 1 && <div className="mb-6 h-px w-4 flex-1 bg-slate-700/40" />}
									</div>
								))}
							</div>
						</Card>

						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">Ask Logs AI</h3>
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
							<h3 className="text-xs font-semibold uppercase tracking-wide text-violet-200">AI Root Cause Analysis</h3>
						</div>
						<p className="text-xs leading-relaxed text-slate-300">
							Coinglass appears rate-limited. The parser is also receiving unstable response shapes. SSR fallback activated but is slower than the worker threshold.
						</p>
						<div className="mt-3 space-y-1.5 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3 text-xs">
							<div className="font-semibold text-violet-200">Suggested fix</div>
							<div className="font-mono text-[11px] text-violet-100">services/coinglass/parser.ts</div>
							<div className="text-[11px] text-slate-400">Add schema guard + exponential backoff.</div>
						</div>
						<div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
							<span>Confidence</span>
							<span className="font-semibold text-emerald-300">87%</span>
						</div>
					</Card>

					{/* API Failure Monitor */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<AlertTriangle size={14} className="text-amber-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">API Failure Monitor</h3>
						</div>
						<div className="space-y-2">
							{MOCK_API_ROWS.map((row) => (
								<div key={row.api} className="grid grid-cols-[1fr_60px_50px] items-center gap-2 rounded-lg bg-slate-800/30 p-2 text-xs">
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

					{/* Live Volume */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Activity size={14} className="text-slate-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">Live Volume</h3>
						</div>
						<MiniChart />
					</Card>

					{/* Selected Log Detail */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Info size={14} className="text-slate-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">Selected Log Detail</h3>
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
								<span className="text-slate-200">{selected.commit || "a81fd12"}</span>
							</div>
						</div>
						<button className="mt-3 w-full rounded-md border border-slate-600/50 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/50">
							Open full trace
						</button>
					</Card>
				</div>
			</div>
		</div>
	)
}
