"use client"

import { useState, useEffect } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Activity,
	AlertTriangle,
	AlertCircle,
	AlertOctagon,
	CheckCircle2,
	XCircle,
	RefreshCw,
	FileWarning,
	Server,
	Code,
	TrendingUp,
	TrendingDown,
	Minus,
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"

// ── Types ──────────────────────────────────────────────────────────────────────

interface OverallMetrics {
	successRate: number
	successCount: number
	failureCount: number
	totalAttempts: number
}

interface CategoryMetric {
	category: string
	successRate: number
	successCount: number
	failureCount: number
	totalAttempts: number
}

interface Incident {
	id: string
	title: string
	category: string | null
	severity: string
	status: string
	affectedFiles: string[]
	sourceAgent: string
	fixAttempts: number
	createdAt: string | null
	updatedAt: string | null
}

interface EscalatedIncident extends Incident {
	suggestedAction: string | null
}

interface MetricsResponse {
	overall: OverallMetrics
	byCategory: CategoryMetric[]
	activeIncidents: number
	lastUpdated: string | null
	dataSource?: string
	dbPath?: string
}

interface IncidentsResponse {
	incidents: Incident[]
	total: number
	filtered: number
}

interface EscalatedResponse {
	escalated: EscalatedIncident[]
	total: number
}

interface RepairRun {
	id: string
	triggered_at: string
	incident_id: string | null
	failure_signature: string | null
	title: string | null
	severity: string | null
	attempts_count: number
	final_status: "fixed" | "escalated" | "failed" | "in_progress"
	fix_applied: string | null
	escalated_at: string | null
	cycle_count: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
	critical: "#ef4444",
	high: "#f97316",
	medium: "#eab308",
	low: "#22c55e",
}

const STATUS_COLORS: Record<string, string> = {
	new: "#3b82f6",
	investigating: "#8b5cf6",
	queued_for_fix: "#f59e0b",
	fixing: "#f97316",
	fix_ready: "#22c55e",
	deployed: "#06b6d4",
	verifying: "#14b8a6",
	verified: "#22c55e",
	reopened: "#ef4444",
	blocked: "#dc2626",
	needs_human_approval: "#ef4444",
}

const CATEGORY_COLORS = [
	"#3b82f6",
	"#8b5cf6",
	"#f59e0b",
	"#ef4444",
	"#22c55e",
	"#06b6d4",
	"#f97316",
	"#14b8a6",
	"#eab308",
	"#a855f7",
	"#ec4899",
	"#6366f1",
]

function formatDate(iso: string | null): string {
	if (!iso) return "—"
	const d = new Date(iso)
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

function timeAgo(iso: string | null): string {
	if (!iso) return "—"
	const ms = Date.now() - new Date(iso).getTime()
	const mins = Math.floor(ms / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

function statusLabel(status: string): string {
	return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function categoryLabel(category: string): string {
	return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Panel({
	title,
	children,
	action,
	className = "",
}: {
	title: string
	children: React.ReactNode
	action?: React.ReactNode
	className?: string
}) {
	return (
		<section
			className={`rounded-xl border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_30px_rgba(40,110,255,0.08)] ${className}`}>
			<div className="mb-4 flex items-center justify-between">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	)
}

function SeverityBadge({ severity }: { severity: string }) {
	const color = SEVERITY_COLORS[severity] || "#6b7280"
	return (
		<span
			className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
			style={{
				backgroundColor: `${color}18`,
				color,
				border: `1px solid ${color}30`,
			}}>
			{severity === "critical" ? (
				<AlertOctagon className="h-2.5 w-2.5" />
			) : severity === "high" ? (
				<AlertTriangle className="h-2.5 w-2.5" />
			) : (
				<AlertCircle className="h-2.5 w-2.5" />
			)}
			{severity}
		</span>
	)
}

function StatusBadge({ status }: { status: string }) {
	const color = STATUS_COLORS[status] || "#6b7280"
	return (
		<span
			className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
			style={{
				backgroundColor: `${color}18`,
				color,
				border: `1px solid ${color}30`,
			}}>
			{statusLabel(status)}
		</span>
	)
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function HealingView() {
	const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
	const [incidents, setIncidents] = useState<IncidentsResponse | null>(null)
	const [escalated, setEscalated] = useState<EscalatedResponse | null>(null)
	const [repairRuns, setRepairRuns] = useState<RepairRun[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [incidentFilter, setIncidentFilter] = useState<string>("all")

	async function fetchAll() {
		try {
			const [metricsRes, incidentsRes, escalatedRes, repairRunsRes] = await Promise.all([
				fetch("/api/healing/metrics"),
				fetch(`/api/healing/incidents?limit=50${incidentFilter !== "all" ? `&status=${incidentFilter}` : ""}`),
				fetch("/api/healing/escalated"),
				fetch("/api/healing/repair-runs?limit=20"),
			])

			if (!metricsRes.ok) throw new Error(`Metrics API error: ${metricsRes.status}`)
			if (!incidentsRes.ok) throw new Error(`Incidents API error: ${incidentsRes.status}`)
			if (!escalatedRes.ok) throw new Error(`Escalated API error: ${escalatedRes.status}`)

			setMetrics(await metricsRes.json())
			setIncidents(await incidentsRes.json())
			setEscalated(await escalatedRes.json())
			if (repairRunsRes.ok) {
				const rr = await repairRunsRes.json()
				setRepairRuns(rr.runs ?? [])
			}
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch healing data")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchAll()
		const iv = setInterval(fetchAll, 15000) // Poll every 15s
		return () => clearInterval(iv)
	}, [incidentFilter])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-20">
				<AlertCircle className="h-8 w-8 text-red-400" />
				<p className="text-sm text-red-400">{error}</p>
				<button
					onClick={fetchAll}
					className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0]">
					<RefreshCw className="h-3.5 w-3.5" />
					Retry
				</button>
			</div>
		)
	}

	const overall = metrics?.overall || { successRate: 0, successCount: 0, failureCount: 0, totalAttempts: 0 }
	const byCategory = metrics?.byCategory || []
	const activeIncidents = metrics?.activeIncidents || 0
	const escalatedList = escalated?.escalated || []
	const incidentList = incidents?.incidents || []
	const dataSource = metrics?.dataSource || "unknown"

	const dataSourceColor =
		dataSource === "orchestrator"
			? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
			: dataSource === "sqlite"
				? "bg-blue-900/40 text-blue-300 border-blue-700"
				: "bg-amber-900/40 text-amber-300 border-amber-700"

	const dataSourceLabel =
		dataSource === "orchestrator"
			? "Live (Orchestrator Bus)"
			: dataSource === "sqlite"
				? "SQLite"
				: "Fallback (JSON)"

	return (
		<div className="space-y-6">
			{/* ── Data Source Banner ─────────────────────────────────────────── */}
			{dataSource !== "orchestrator" && (
				<div
					className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${dataSourceColor}`}
					title={metrics?.dbPath ? `DB: ${metrics.dbPath}` : undefined}>
					<Server className="h-3.5 w-3.5 shrink-0" />
					<span>
						<strong>Data source:</strong> {dataSourceLabel}
						{dataSource === "json" && (
							<span className="ml-1 text-amber-400">
								— Metrics may be stale. Connect orchestrator bus for live data.
							</span>
						)}
					</span>
				</div>
			)}

			{/* ── Summary Stats ──────────────────────────────────────────────── */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Success Rate"
					value={
						<span className="flex items-center gap-2">
							{overall.successRate}%
							{overall.totalAttempts > 0 &&
								(overall.successRate >= 70 ? (
									<TrendingUp className="h-4 w-4 text-emerald-400" />
								) : overall.successRate >= 40 ? (
									<Minus className="h-4 w-4 text-yellow-400" />
								) : (
									<TrendingDown className="h-4 w-4 text-red-400" />
								))}
						</span>
					}
					sub={`${overall.successCount} success · ${overall.failureCount} failure`}
					color={
						overall.successRate >= 70
							? "text-emerald-400"
							: overall.successRate >= 40
								? "text-yellow-400"
								: "text-red-400"
					}
				/>
				<StatCard label="Total Attempts" value={overall.totalAttempts} sub="Across all categories" />
				<StatCard
					label="Active Incidents"
					value={activeIncidents}
					sub={activeIncidents > 0 ? "Requiring attention" : "All clear"}
					color={activeIncidents > 0 ? "text-yellow-400" : "text-emerald-400"}
				/>
				<StatCard
					label="Escalated Issues"
					value={escalatedList.length}
					sub={escalatedList.length > 0 ? "Need human intervention" : "No escalations"}
					color={escalatedList.length > 0 ? "text-red-400" : "text-emerald-400"}
				/>
			</div>

			{/* ── Per-Category Success Rates ─────────────────────────────────── */}
			<Panel
				title="Success Rate by Category"
				action={
					<button
						onClick={fetchAll}
						className="flex items-center gap-1 rounded-md border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-[10px] text-gray-500 hover:text-[#e2e8f0]">
						<RefreshCw className="h-3 w-3" />
						Refresh
					</button>
				}>
				{byCategory.length === 0 ? (
					<p className="py-6 text-center text-xs text-gray-600">No healing data recorded yet.</p>
				) : (
					<div className="h-64">
						<ResponsiveContainer width="100%" height="100%">
							<BarChart
								data={byCategory}
								layout="vertical"
								margin={{ left: 100, right: 20, top: 5, bottom: 5 }}>
								<XAxis
									type="number"
									domain={[0, 100]}
									tick={{ fill: "#64748b", fontSize: 11 }}
									tickFormatter={(v) => `${v}%`}
									axisLine={{ stroke: "#1e2535" }}
									tickLine={false}
								/>
								<YAxis
									type="category"
									dataKey="category"
									tick={{ fill: "#94a3b8", fontSize: 10 }}
									tickFormatter={(v) => categoryLabel(v)}
									axisLine={false}
									tickLine={false}
									width={90}
								/>
								<Tooltip
									contentStyle={{
										background: "#0f1117",
										border: "1px solid #1e2535",
										borderRadius: "8px",
										fontSize: "12px",
									}}
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									formatter={(value: any, _name: any, props: any) => [
										`${value}% (${props.payload.successCount}/${props.payload.totalAttempts})`,
										"Success Rate",
									]}
								/>
								<Bar dataKey="successRate" radius={[0, 4, 4, 0]} barSize={16}>
									{byCategory.map((_entry, index) => (
										<Cell
											key={index}
											fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
											fillOpacity={0.8}
										/>
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>
				)}
			</Panel>

			{/* ── Escalated Issues ───────────────────────────────────────────── */}
			<Panel
				title={`Escalated Issues (${escalatedList.length})`}
				action={
					escalatedList.length > 0 && (
						<span className="flex items-center gap-1 text-[10px] text-red-400">
							<AlertOctagon className="h-3 w-3" />
							Needs attention
						</span>
					)
				}>
				{escalatedList.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-6">
						<CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
						<p className="text-xs text-gray-600">No escalated issues. All systems nominal.</p>
					</div>
				) : (
					<div className="space-y-2">
						{escalatedList.map((inc) => (
							<div key={inc.id} className="rounded-lg border border-red-900/30 bg-red-950/20 p-3">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<AlertOctagon className="h-3.5 w-3.5 shrink-0 text-red-400" />
											<span className="text-sm font-medium text-slate-100 truncate">
												{inc.title}
											</span>
										</div>
										<div className="mt-1.5 flex flex-wrap items-center gap-2">
											{inc.category && (
												<span className="text-[10px] text-gray-500">
													<Code className="mr-1 inline h-3 w-3" />
													{categoryLabel(inc.category)}
												</span>
											)}
											<SeverityBadge severity={inc.severity} />
											<StatusBadge status={inc.status} />
											{inc.fixAttempts > 0 && (
												<span className="text-[10px] text-red-400">
													{inc.fixAttempts} retr{inc.fixAttempts === 1 ? "y" : "ies"}
												</span>
											)}
										</div>
										{inc.affectedFiles.length > 0 && (
											<div className="mt-1.5 flex flex-wrap gap-1">
												{inc.affectedFiles.slice(0, 3).map((file, i) => (
													<span
														key={i}
														className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[9px] text-gray-500 font-mono">
														{file.split("/").pop()}
													</span>
												))}
												{inc.affectedFiles.length > 3 && (
													<span className="text-[9px] text-gray-600">
														+{inc.affectedFiles.length - 3} more
													</span>
												)}
											</div>
										)}
										{inc.suggestedAction && (
											<p className="mt-1.5 text-[10px] text-gray-500 italic">
												Suggested: {inc.suggestedAction}
											</p>
										)}
									</div>
									<span className="shrink-0 text-[9px] text-gray-600">{timeAgo(inc.updatedAt)}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</Panel>

			{/* ── Recent Incidents ───────────────────────────────────────────── */}
			<Panel
				title={`Recent Incidents (${incidentList.length})`}
				action={
					<div className="flex items-center gap-2">
						<select
							value={incidentFilter}
							onChange={(e) => setIncidentFilter(e.target.value)}
							className="rounded-md border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-[10px] text-gray-400 outline-none focus:border-[#3b82f6]">
							<option value="all">All</option>
							<option value="needs_human_approval">Needs Approval</option>
							<option value="fixing">Fixing</option>
							<option value="verified">Verified</option>
							<option value="blocked">Blocked</option>
							<option value="reopened">Reopened</option>
							<option value="queued_for_fix">Queued</option>
						</select>
						<button
							onClick={fetchAll}
							className="flex items-center gap-1 rounded-md border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-[10px] text-gray-500 hover:text-[#e2e8f0]">
							<RefreshCw className="h-3 w-3" />
						</button>
					</div>
				}>
				{incidentList.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-6">
						<Activity className="h-8 w-8 text-gray-700" />
						<p className="text-xs text-gray-600">No incidents recorded.</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-gray-500">
									<th className="pb-2 pr-3 font-medium">Title</th>
									<th className="pb-2 pr-3 font-medium">Category</th>
									<th className="pb-2 pr-3 font-medium">Severity</th>
									<th className="pb-2 pr-3 font-medium">Status</th>
									<th className="pb-2 pr-3 font-medium">Agent</th>
									<th className="pb-2 pr-3 font-medium">Attempts</th>
									<th className="pb-2 font-medium">Updated</th>
								</tr>
							</thead>
							<tbody>
								{incidentList.map((inc) => (
									<tr key={inc.id} className="border-b border-[#1e2535]/50 hover:bg-[#0f1117]/50">
										<td className="py-2.5 pr-3">
											<span
												className="text-slate-200 truncate block max-w-[200px]"
												title={inc.title}>
												{inc.title}
											</span>
										</td>
										<td className="py-2.5 pr-3 text-gray-500">
											{inc.category ? categoryLabel(inc.category) : "—"}
										</td>
										<td className="py-2.5 pr-3">
											<SeverityBadge severity={inc.severity} />
										</td>
										<td className="py-2.5 pr-3">
											<StatusBadge status={inc.status} />
										</td>
										<td className="py-2.5 pr-3 text-gray-500">{inc.sourceAgent}</td>
										<td className="py-2.5 pr-3 text-gray-500">{inc.fixAttempts}</td>
										<td className="py-2.5 text-gray-600 whitespace-nowrap">
											{timeAgo(inc.updatedAt)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>

			{/* Repair Runs — fingerprint trajectory log */}
			<Panel title={`Repair Runs (${repairRuns.length})`}>
				{repairRuns.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-6 text-gray-600">
						<CheckCircle2 className="h-6 w-6" />
						<p className="text-xs">No repair runs recorded yet.</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead>
								<tr className="text-left text-gray-500 border-b border-[#1e2535]">
									<th className="pb-2 pr-4">Status</th>
									<th className="pb-2 pr-4">Title</th>
									<th className="pb-2 pr-4">Fingerprint</th>
									<th className="pb-2 pr-4">Attempts</th>
									<th className="pb-2 pr-4">Cycles</th>
									<th className="pb-2">Triggered</th>
								</tr>
							</thead>
							<tbody>
								{repairRuns.map((run) => (
									<tr key={run.id} className="border-b border-[#0f1420] hover:bg-[#0f1420]">
										<td className="py-2 pr-4">
											<span
												className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
													run.final_status === "fixed"
														? "bg-green-900 text-green-300"
														: run.final_status === "escalated"
															? "bg-red-900 text-red-300"
															: run.final_status === "failed"
																? "bg-orange-900 text-orange-300"
																: "bg-blue-900 text-blue-300"
												}`}>
												{run.final_status}
											</span>
										</td>
										<td className="py-2 pr-4 max-w-[200px] truncate text-gray-300">
											{run.title ?? "—"}
										</td>
										<td className="py-2 pr-4 font-mono text-gray-500">
											{run.failure_signature ? run.failure_signature.slice(0, 8) : "—"}
										</td>
										<td className="py-2 pr-4 text-gray-400">{run.attempts_count}</td>
										<td className="py-2 pr-4">
											<span
												className={`font-mono ${run.cycle_count >= 10 ? "text-red-400" : run.cycle_count >= 5 ? "text-yellow-400" : "text-gray-400"}`}
												title={
													run.cycle_count >= 10 ? "Agent thrashing — consider escalation" : ""
												}>
												{run.cycle_count}
											</span>
										</td>
										<td className="py-2 text-gray-500">
											{run.triggered_at ? timeAgo(run.triggered_at) : "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>
		</div>
	)
}
