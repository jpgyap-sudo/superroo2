"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Activity,
	AlertTriangle,
	AlertCircle,
	CheckCircle2,
	XCircle,
	RefreshCw,
	Server,
	Cpu,
	HardDrive,
	Bot,
	Search,
	Filter,
	Clock,
	TrendingUp,
	TrendingDown,
	Minus,
	BarChart3,
	LineChart,
} from "lucide-react"
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	Cell,
	LineChart as RechartsLineChart,
	Line,
	CartesianGrid,
	Legend,
} from "recharts"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error" | "success"
type LogSource = "extension" | "cloud-api" | "cloud-worker" | "dashboard" | "healing" | "ml" | "agent" | "system"
type HealthStatus = "healthy" | "warning" | "failed"

interface LogEntry {
	id: string
	timestamp: number
	source: LogSource
	level: LogLevel
	message: string
	metadata?: Record<string, unknown>
}

interface LogQueryResult {
	entries: LogEntry[]
	total: number
	filtered: number
	hasMore: boolean
}

interface SystemStats {
	system: {
		hostname: string
		platform: string
		uptime: number
		cpu: {
			count: number
			load: { "1min": number; "5min": number; "15min": number } | null
			model: string | null
		}
		memory: {
			total: number
			free: number
			used: number
			usagePercent: number
		}
	}
	agents: {
		activeAgents: number
		activeIncidents: number
	}
	logs: {
		recentErrors24h: number
	}
	services: Array<{
		name: string
		process: {
			status: string
			restarts: number
			uptimeMs: number | null
		} | null
		listening: boolean
		httpStatus: number | null
		latencyMs: number
		healthy: boolean
	}>
	timestamp: string
}

interface HealthEntry {
	timestamp: number
	status: HealthStatus
	message?: string
	version?: string
	commit?: string
	agent?: string
}

interface HealthTimelineResponse {
	entries: HealthEntry[]
	total: number
	filtered: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: "text-gray-500",
	info: "text-sky-300",
	warn: "text-amber-300",
	error: "text-red-300",
	success: "text-emerald-300",
}

const LEVEL_BG: Record<LogLevel, string> = {
	debug: "border-gray-500/30 bg-gray-500/10",
	info: "border-sky-500/30 bg-sky-500/10",
	warn: "border-amber-500/30 bg-amber-500/10",
	error: "border-red-500/30 bg-red-500/10",
	success: "border-emerald-500/30 bg-emerald-500/10",
}

const HEALTH_COLORS: Record<HealthStatus, string> = {
	healthy: "text-emerald-400",
	warning: "text-amber-400",
	failed: "text-red-400",
}

const HEALTH_BG: Record<HealthStatus, string> = {
	healthy: "bg-emerald-500/20 border-emerald-500/40",
	warning: "bg-amber-500/20 border-amber-500/40",
	failed: "bg-red-500/20 border-red-500/40",
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const units = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(1024))
	return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const mins = Math.floor((seconds % 3600) / 60)
	const parts = []
	if (days > 0) parts.push(`${days}d`)
	if (hours > 0) parts.push(`${hours}h`)
	parts.push(`${mins}m`)
	return parts.join(" ")
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString()
}

function formatDate(ts: number): string {
	return new Date(ts).toLocaleString()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: LogLevel }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border",
				LEVEL_BG[level],
				LEVEL_COLORS[level],
			)}>
			{level}
		</span>
	)
}

function HealthDot({ status }: { status: HealthStatus }) {
	return (
		<div
			className={cn(
				"h-2.5 w-2.5 rounded-full shrink-0",
				status === "healthy" && "bg-emerald-400 shadow-[0_0_6px_#22c55e]",
				status === "warning" && "bg-amber-400 shadow-[0_0_6px_#f59e0b]",
				status === "failed" && "bg-red-400 shadow-[0_0_6px_#ef4444]",
			)}
		/>
	)
}

// ── Log Viewer ─────────────────────────────────────────────────────────────────

function LogViewer() {
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [sourceFilter, setSourceFilter] = useState<string>("")
	const [levelFilter, setLevelFilter] = useState<string>("")
	const [searchText, setSearchText] = useState("")
	const [autoRefresh, setAutoRefresh] = useState(true)

	const fetchLogs = async () => {
		try {
			const params = new URLSearchParams()
			params.set("limit", "200")
			if (sourceFilter) params.set("source", sourceFilter)
			if (levelFilter) params.set("level", levelFilter)
			if (searchText) params.set("search", searchText)

			const res = await fetch(`/api/monitoring/logs?${params.toString()}`)
			const data: LogQueryResult = await res.json()
			setLogs(data.entries || [])
		} catch (err) {
			console.error("Failed to fetch logs:", err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchLogs()
	}, [sourceFilter, levelFilter])

	// Auto-refresh every 10 seconds
	useEffect(() => {
		if (!autoRefresh) return
		const iv = setInterval(fetchLogs, 10000)
		return () => clearInterval(iv)
	}, [autoRefresh, sourceFilter, levelFilter])

	const filteredLogs = useMemo(() => {
		if (!searchText) return logs
		const q = searchText.toLowerCase()
		return logs.filter(
			(e) =>
				e.message.toLowerCase().includes(q) ||
				e.source.toLowerCase().includes(q) ||
				e.level.toLowerCase().includes(q),
		)
	}, [logs, searchText])

	return (
		<div className="space-y-3">
			{/* Filters */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-[200px]">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
					<input
						type="text"
						placeholder="Search logs..."
						value={searchText}
						onChange={(e) => setSearchText(e.target.value)}
						className="w-full rounded border border-[#1e2535] bg-[#0f1117] py-1.5 pl-8 pr-3 text-xs text-[#e2e8f0] placeholder-gray-600 focus:border-violet-600 focus:outline-none"
					/>
				</div>

				<select
					value={sourceFilter}
					onChange={(e) => setSourceFilter(e.target.value)}
					className="rounded border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-xs text-[#e2e8f0] focus:border-violet-600 focus:outline-none">
					<option value="">All Sources</option>
					<option value="extension">Extension</option>
					<option value="cloud-api">Cloud API</option>
					<option value="cloud-worker">Cloud Worker</option>
					<option value="dashboard">Dashboard</option>
					<option value="healing">Healing</option>
					<option value="ml">ML</option>
					<option value="agent">Agent</option>
					<option value="system">System</option>
				</select>

				<select
					value={levelFilter}
					onChange={(e) => setLevelFilter(e.target.value)}
					className="rounded border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-xs text-[#e2e8f0] focus:border-violet-600 focus:outline-none">
					<option value="">All Levels</option>
					<option value="debug">Debug</option>
					<option value="info">Info</option>
					<option value="warn">Warning</option>
					<option value="error">Error</option>
					<option value="success">Success</option>
				</select>

				<button
					onClick={() => setAutoRefresh(!autoRefresh)}
					className={cn(
						"flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition-colors",
						autoRefresh
							? "border-violet-600/50 bg-violet-600/10 text-violet-300"
							: "border-[#1e2535] text-gray-500 hover:text-[#e2e8f0]",
					)}>
					<RefreshCw className={cn("h-3 w-3", autoRefresh && "animate-spin")} />
					Auto
				</button>

				<button
					onClick={fetchLogs}
					className="flex items-center gap-1.5 rounded border border-[#1e2535] px-2.5 py-1.5 text-xs text-gray-500 hover:text-[#e2e8f0] transition-colors">
					<RefreshCw className="h-3 w-3" />
					Refresh
				</button>
			</div>

			{/* Log entries */}
			{loading ? (
				<div className="flex items-center justify-center py-12">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
				</div>
			) : filteredLogs.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-gray-600">
					<Activity className="h-8 w-8 mb-2" />
					<p className="text-sm">No logs found</p>
				</div>
			) : (
				<div className="space-y-1 max-h-[500px] overflow-y-auto">
					{filteredLogs.map((entry) => (
						<div
							key={entry.id}
							className={cn(
								"flex items-start gap-2 rounded border px-3 py-2 text-xs",
								LEVEL_BG[entry.level],
							)}>
							<span className="text-gray-600 shrink-0 w-16 font-mono">{formatTime(entry.timestamp)}</span>
							<LevelBadge level={entry.level} />
							<span className="text-gray-500 shrink-0 w-20 font-mono">{entry.source}</span>
							<span className={cn("flex-1", LEVEL_COLORS[entry.level])}>{entry.message}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// ── Error Rate Chart ───────────────────────────────────────────────────────────

function ErrorRateChart() {
	const [data, setData] = useState<{ hour: string; errors: number; total: number }[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetchData = async () => {
			try {
				const now = Date.now()
				const hours: { hour: string; errors: number; total: number }[] = []

				// Fetch logs for each of the last 24 hours
				for (let i = 23; i >= 0; i--) {
					const from = now - (i + 1) * 3600000
					const to = now - i * 3600000
					const label = new Date(from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

					const res = await fetch(`/api/monitoring/logs?from=${from}&to=${to}&limit=500`)
					const result: LogQueryResult = await res.json()

					const errors = result.entries?.filter((e) => e.level === "error").length || 0
					hours.push({ hour: label, errors, total: result.total })
				}

				setData(hours)
			} catch (err) {
				console.error("Failed to fetch error rate data:", err)
			} finally {
				setLoading(false)
			}
		}

		fetchData()
		const iv = setInterval(fetchData, 60000)
		return () => clearInterval(iv)
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
			</div>
		)
	}

	return (
		<div className="h-64">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data}>
					<XAxis
						dataKey="hour"
						tick={{ fill: "#6b7280", fontSize: 10 }}
						axisLine={{ stroke: "#1e2535" }}
						tickLine={false}
						interval={3}
					/>
					<YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={{ stroke: "#1e2535" }} tickLine={false} />
					<Tooltip
						contentStyle={{
							background: "#0f1117",
							border: "1px solid #1e2535",
							borderRadius: "8px",
							fontSize: "12px",
						}}
						labelStyle={{ color: "#e2e8f0" }}
					/>
					<Bar dataKey="errors" name="Errors" fill="#ef4444" radius={[4, 4, 0, 0]} />
					<Bar dataKey="total" name="Total Logs" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.3} />
				</BarChart>
			</ResponsiveContainer>
		</div>
	)
}

// ── Health Timeline ────────────────────────────────────────────────────────────

function HealthTimeline() {
	const [entries, setEntries] = useState<HealthEntry[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetchTimeline = async () => {
			try {
				const res = await fetch("/api/monitoring/health-timeline?limit=30")
				const data: HealthTimelineResponse = await res.json()
				setEntries(data.entries || [])
			} catch (err) {
				console.error("Failed to fetch health timeline:", err)
			} finally {
				setLoading(false)
			}
		}

		fetchTimeline()
		const iv = setInterval(fetchTimeline, 30000)
		return () => clearInterval(iv)
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
			</div>
		)
	}

	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-gray-600">
				<Activity className="h-8 w-8 mb-2" />
				<p className="text-sm">No health data yet</p>
			</div>
		)
	}

	return (
		<div className="space-y-2 max-h-[400px] overflow-y-auto">
			{entries.map((entry, i) => (
				<div
					key={i}
					className={cn("flex items-center gap-3 rounded border px-3 py-2", HEALTH_BG[entry.status])}>
					<HealthDot status={entry.status} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className={cn("text-xs font-medium", HEALTH_COLORS[entry.status])}>
								{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
							</span>
							{entry.version && (
								<span className="text-[10px] text-gray-600 font-mono">v{entry.version}</span>
							)}
						</div>
						{entry.message && <p className="text-[11px] text-gray-500 truncate">{entry.message}</p>}
					</div>
					<span className="text-[10px] text-gray-700 shrink-0">{formatDate(entry.timestamp)}</span>
				</div>
			))}
		</div>
	)
}

// ── Main Monitoring View ───────────────────────────────────────────────────────

export function MonitoringView() {
	const [stats, setStats] = useState<SystemStats | null>(null)
	const [statsLoading, setStatsLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<"logs" | "stats" | "health">("stats")

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const res = await fetch("/api/monitoring/stats")
				const data: SystemStats = await res.json()
				setStats(data)
			} catch (err) {
				console.error("Failed to fetch stats:", err)
			} finally {
				setStatsLoading(false)
			}
		}

		fetchStats()
		const iv = setInterval(fetchStats, 15000)
		return () => clearInterval(iv)
	}, [])

	const cpuLoad = stats?.system?.cpu?.load
	const mem = stats?.system?.memory

	return (
		<div className="space-y-6">
			{/* Tab navigation */}
			<div className="flex gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-1 w-fit">
				{[
					{ id: "stats" as const, label: "System Stats", icon: Server },
					{ id: "logs" as const, label: "Log Viewer", icon: BarChart3 },
					{ id: "health" as const, label: "Health Timeline", icon: Activity },
				].map((tab) => {
					const Icon = tab.icon
					const active = activeTab === tab.id
					return (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
								active ? "bg-violet-600/20 text-violet-300" : "text-gray-500 hover:text-[#e2e8f0]",
							)}>
							<Icon className="h-3.5 w-3.5" />
							{tab.label}
						</button>
					)
				})}
			</div>

			{/* Stats tab */}
			{activeTab === "stats" && (
				<div className="space-y-6">
					{/* System Stats Cards */}
					{statsLoading ? (
						<div className="flex items-center justify-center py-12">
							<div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
						</div>
					) : stats ? (
						<>
							<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
								<StatCard
									label="CPU Cores"
									value={
										<div className="flex items-center gap-2">
											<Cpu className="h-4 w-4 text-violet-400" />
											<span>{stats.system.cpu.count}</span>
										</div>
									}
									sub={stats.system.cpu.model?.split(" ").slice(0, 2).join(" ") || "Unknown"}
								/>
								<StatCard
									label="Memory"
									value={
										<div className="flex items-center gap-2">
											<HardDrive className="h-4 w-4 text-sky-400" />
											<span>{mem?.usagePercent || 0}%</span>
										</div>
									}
									sub={mem ? `${formatBytes(mem.used)} / ${formatBytes(mem.total)}` : "N/A"}
									color={mem && mem.usagePercent > 80 ? "text-red-400" : "text-[#e2e8f0]"}
								/>
								<StatCard
									label="CPU Load (1m)"
									value={
										cpuLoad ? (
											<div className="flex items-center gap-1">
												{cpuLoad["1min"] > 1 ? (
													<TrendingUp className="h-4 w-4 text-amber-400" />
												) : (
													<TrendingDown className="h-4 w-4 text-emerald-400" />
												)}
												<span>{cpuLoad["1min"].toFixed(2)}</span>
											</div>
										) : (
											"—"
										)
									}
									sub={
										cpuLoad
											? `5m: ${cpuLoad["5min"].toFixed(2)} · 15m: ${cpuLoad["15min"].toFixed(2)}`
											: "N/A"
									}
								/>
								<StatCard
									label="Uptime"
									value={
										<div className="flex items-center gap-2">
											<Clock className="h-4 w-4 text-emerald-400" />
											<span>{formatUptime(stats.system.uptime)}</span>
										</div>
									}
									sub={stats.system.hostname}
								/>
								<StatCard
									label="Errors (24h)"
									value={
										<div className="flex items-center gap-2">
											<AlertTriangle
												className={cn(
													"h-4 w-4",
													stats.logs.recentErrors24h > 10 ? "text-red-400" : "text-amber-400",
												)}
											/>
											<span>{stats.logs.recentErrors24h}</span>
										</div>
									}
									sub={`${stats.agents.activeIncidents} active incidents`}
									color={stats.logs.recentErrors24h > 10 ? "text-red-400" : "text-[#e2e8f0]"}
								/>
							</div>

							{/* Error Rate Chart */}
							<Card>
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
										Service Health
									</h3>
									<Server className="h-4 w-4 text-gray-600" />
								</div>
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									{(stats.services || []).map((service) => (
										<div
											key={service.name}
											className="rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
											<div className="flex items-center justify-between gap-3">
												<div>
													<div className="text-sm font-medium text-gray-200">
														{service.name}
													</div>
													<div className="mt-1 text-xs text-gray-500">
														PM2: {service.process?.status || "missing"} · Port:{" "}
														{service.listening ? "listening" : "closed"}
													</div>
												</div>
												<div
													className={cn(
														"rounded px-2 py-1 text-xs",
														service.healthy
															? "bg-emerald-500/10 text-emerald-300"
															: "bg-red-500/10 text-red-300",
													)}>
													{service.healthy ? "Healthy" : "Down"}
												</div>
											</div>
											<div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
												<span>HTTP {service.httpStatus ?? "N/A"}</span>
												<span>{service.latencyMs}ms</span>
												<span>{service.process?.restarts || 0} restarts</span>
											</div>
										</div>
									))}
								</div>
							</Card>

							{/* Error Rate Chart */}
							<Card>
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
										Error Rate (Last 24 Hours)
									</h3>
									<BarChart3 className="h-4 w-4 text-gray-600" />
								</div>
								<ErrorRateChart />
							</Card>
						</>
					) : (
						<div className="flex flex-col items-center justify-center py-12 text-gray-600">
							<Server className="h-8 w-8 mb-2" />
							<p className="text-sm">Unable to fetch system stats</p>
						</div>
					)}
				</div>
			)}

			{/* Logs tab */}
			{activeTab === "logs" && (
				<Card>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Log Viewer</h3>
						<Filter className="h-4 w-4 text-gray-600" />
					</div>
					<LogViewer />
				</Card>
			)}

			{/* Health tab */}
			{activeTab === "health" && (
				<Card>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
							Health Timeline
						</h3>
						<Activity className="h-4 w-4 text-gray-600" />
					</div>
					<HealthTimeline />
				</Card>
			)}
		</div>
	)
}
