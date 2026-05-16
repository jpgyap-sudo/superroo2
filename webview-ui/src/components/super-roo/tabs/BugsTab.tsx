import { useMemo, useState } from "react"
import {
	Activity,
	AlertTriangle,
	Bot,
	Bug,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Cpu,
	Filter,
	GitPullRequest,
	Search,
	Server,
	Shield,
	Terminal,
	Zap,
} from "lucide-react"
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts"

import { useSr } from "../hooks/SrContext"
import { BugStatusPill, SeverityPill, formatRelative } from "../parts/Pills"
import type { BugSeverity, BugStatus } from "../types"

// ── Types ──────────────────────────────────────────────────────────────────────

type SeverityFilter = BugSeverity | "all"
type StatusFilter = BugStatus | "all"

const SEVERITY_OPTIONS: SeverityFilter[] = ["all", "critical", "high", "medium", "low"]
const STATUS_OPTIONS: StatusFilter[] = ["all", "open", "investigating", "fixed", "blocked", "wontfix"]

const SEVERITY_COLOR: Record<BugSeverity, string> = {
	critical: "bg-red-500/20 text-red-300 border-red-500/40",
	high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
	medium: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	low: "bg-gray-500/20 text-gray-300 border-gray-500/40",
}

// ── Mock chart data (derived from bugs) ────────────────────────────────────────

function buildChartData(bugs: ReturnType<typeof useSr>["bugs"]) {
	const now = Date.now()
	const HOUR = 60 * 60 * 1000

	// Timeline: incidents over last 12 hours
	const timeline = Array.from({ length: 12 }, (_, i) => {
		const slotStart = now - (11 - i) * 2 * HOUR
		const slotEnd = slotStart + 2 * HOUR
		const inSlot = bugs.filter((b) => b.createdAt >= slotStart && b.createdAt < slotEnd)
		return {
			time: `${(i * 2).toString().padStart(2, "0")}:00`,
			total: inSlot.length + Math.round(Math.sin(i) * 2 + 3),
			active:
				inSlot.filter((b) => b.status === "open" || b.status === "investigating").length +
				Math.round(Math.sin(i + 1) * 1.5 + 1),
			resolved: inSlot.filter((b) => b.status === "fixed").length + Math.round(Math.cos(i) * 1 + 1),
		}
	})

	// Error types pie
	const severityCounts = {
		critical: bugs.filter((b) => b.severity === "critical").length || 2,
		high: bugs.filter((b) => b.severity === "high").length || 4,
		medium: bugs.filter((b) => b.severity === "medium").length || 3,
		low: bugs.filter((b) => b.severity === "low").length || 1,
	}
	const errorTypes = [
		{ name: "Critical", value: severityCounts.critical },
		{ name: "High", value: severityCounts.high },
		{ name: "Medium", value: severityCounts.medium },
		{ name: "Low", value: severityCounts.low },
	]

	// Affected "services" (files)
	const fileCounts = new Map<string, number>()
	for (const b of bugs) {
		for (const f of b.filesLikelyInvolved) {
			const short = f.split("/").pop() || f
			fileCounts.set(short, (fileCounts.get(short) || 0) + 1)
		}
	}
	if (fileCounts.size === 0) {
		fileCounts.set("auth/login.ts", 3)
		fileCounts.set("api/handler.ts", 2)
		fileCounts.set("worker/index.ts", 2)
		fileCounts.set("db/query.ts", 1)
	}
	const services = Array.from(fileCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => ({ name, count }))

	return { timeline, errorTypes, services }
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
	label,
	value,
	sub,
	tone = "text-blue-400",
}: {
	label: string
	value: string
	sub: string
	tone?: string
}) {
	return (
		<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4">
			<div className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
				{label}
			</div>
			<div className={`mt-1.5 text-2xl font-bold ${tone}`}>{value}</div>
			<div className="mt-0.5 text-xs text-vscode-descriptionForeground">{sub}</div>
		</div>
	)
}

// ── System Status ──────────────────────────────────────────────────────────────

function SystemStatusCard() {
	return (
		<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4">
			<div className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
				System Status
			</div>
			<div className="mt-2 flex items-center gap-2 text-lg font-bold text-green-400">
				<CheckCircle2 size={20} />
				All healthy
			</div>
			<button type="button" className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
				View health →
			</button>
		</div>
	)
}

// ── Incident List ──────────────────────────────────────────────────────────────

function IncidentList({
	incidents,
	selectedId,
	onSelect,
}: {
	incidents: ReturnType<typeof useSr>["bugs"]
	selectedId: string | null
	onSelect: (id: string) => void
}) {
	const [search, setSearch] = useState("")

	const filtered = search
		? incidents.filter(
				(i) =>
					i.title.toLowerCase().includes(search.toLowerCase()) ||
					i.id.toLowerCase().includes(search.toLowerCase()),
			)
		: incidents

	return (
		<div className="flex flex-col rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] h-full">
			<div className="p-3 border-b border-vscode-panel-border">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold">Incidents</span>
					<span className="text-[10px] text-vscode-descriptionForeground">{incidents.length} total</span>
				</div>
				<div className="flex gap-1.5 mb-2 flex-wrap">
					<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/30 text-purple-300 border border-purple-500/40">
						All {incidents.length}
					</span>
					<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 text-vscode-descriptionForeground border border-vscode-panel-border">
						Active {incidents.filter((i) => i.status === "open" || i.status === "investigating").length}
					</span>
					<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 text-vscode-descriptionForeground border border-vscode-panel-border">
						Fixed {incidents.filter((i) => i.status === "fixed").length}
					</span>
				</div>
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-vscode-descriptionForeground" />
					<input
						type="text"
						placeholder="Search incidents..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full bg-vscode-input-background border border-vscode-input-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-vscode-input-foreground placeholder-vscode-descriptionForeground outline-none focus:border-vscode-focusBorder"
					/>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto p-2 space-y-1.5">
				{filtered.length === 0 ? (
					<div className="text-xs text-vscode-descriptionForeground text-center py-8">
						No incidents match your search.
					</div>
				) : (
					filtered.map((incident) => {
						const isSelected = selectedId === incident.id
						return (
							<button
								key={incident.id}
								type="button"
								onClick={() => onSelect(incident.id)}
								className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${
									isSelected
										? "border-purple-500/50 bg-purple-500/10"
										: "border-vscode-panel-border bg-white/[0.02] hover:bg-vscode-list-hoverBackground"
								}`}>
								<div className="flex items-start gap-2">
									<span
										className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
											SEVERITY_COLOR[incident.severity]
										}`}>
										{incident.severity === "critical"
											? "P1"
											: incident.severity === "high"
												? "P2"
												: incident.severity === "medium"
													? "P3"
													: "P4"}
									</span>
									<div className="flex-1 min-w-0">
										<div className="text-xs font-medium truncate">{incident.title}</div>
										<div className="text-[10px] text-vscode-descriptionForeground mt-0.5">
											{formatRelative(incident.createdAt)}
										</div>
									</div>
									<BugStatusPill status={incident.status} />
								</div>
							</button>
						)
					})
				)}
			</div>
		</div>
	)
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ incident }: { incident: ReturnType<typeof useSr>["bugs"][number] | null }) {
	if (!incident) {
		return (
			<div className="flex items-center justify-center h-full rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-8">
				<div className="text-center">
					<Bug className="mx-auto size-10 text-vscode-descriptionForeground/40" />
					<p className="mt-3 text-sm text-vscode-descriptionForeground">Select an incident to inspect</p>
					<p className="mt-1 text-xs text-vscode-descriptionForeground/60">
						Click any bug from the list to see its details
					</p>
				</div>
			</div>
		)
	}

	const severityLabel =
		incident.severity === "critical"
			? "P1"
			: incident.severity === "high"
				? "P2"
				: incident.severity === "medium"
					? "P3"
					: "P4"

	return (
		<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4 h-full flex flex-col">
			{/* Header */}
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-3">
					<span
						className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
							SEVERITY_COLOR[incident.severity]
						}`}>
						{severityLabel}
					</span>
					<div>
						<h3 className="text-sm font-bold">{incident.title}</h3>
						<p className="text-[10px] text-vscode-descriptionForeground mt-0.5">
							ID: {incident.id} · created {formatRelative(incident.createdAt)} · updated{" "}
							{formatRelative(incident.updatedAt)}
							{incident.fixAttempts > 0 &&
								` · ${incident.fixAttempts} fix attempt${incident.fixAttempts === 1 ? "" : "s"}`}
						</p>
					</div>
				</div>
				<div className="flex gap-1.5 shrink-0">
					<button
						type="button"
						className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors">
						Re-run
					</button>
					<button
						type="button"
						className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-panel-border text-vscode-foreground hover:bg-vscode-list-hoverBackground transition-colors">
						More
					</button>
				</div>
			</div>

			{/* Tabs */}
			<div className="mt-4 border-b border-vscode-panel-border flex gap-6 text-xs">
				<span className="pb-2.5 border-b-2 border-blue-400 font-medium">Overview</span>
				<span className="pb-2.5 text-vscode-descriptionForeground cursor-default">AI Analysis</span>
				<span className="pb-2.5 text-vscode-descriptionForeground cursor-default">Logs</span>
				<span className="pb-2.5 text-vscode-descriptionForeground cursor-default">Timeline</span>
			</div>

			{/* Content */}
			<div className="mt-3 flex-1 overflow-y-auto space-y-3">
				{/* Error Summary + AI Root Cause */}
				<div className="grid grid-cols-2 gap-3">
					{/* Error Summary */}
					<div className="rounded-lg border border-vscode-panel-border bg-black/20 p-3">
						<span className="text-xs font-semibold">Error Summary</span>
						{incident.symptoms.length > 0 && (
							<pre className="mt-2 bg-black/40 rounded-lg p-2.5 text-[10px] text-red-300 font-mono overflow-x-auto leading-relaxed">
								{incident.symptoms.join("\n")}
							</pre>
						)}
						{incident.filesLikelyInvolved.length > 0 && (
							<div className="mt-2 text-[10px] text-vscode-descriptionForeground">
								Files:{" "}
								<span className="font-mono text-blue-300">
									{incident.filesLikelyInvolved.join(", ")}
								</span>
							</div>
						)}
					</div>

					{/* AI Root Cause */}
					<div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-semibold">AI Root Cause Analysis</span>
							{incident.suspectedRootCause && (
								<span className="text-[10px] text-green-300 bg-green-500/15 px-1.5 py-0.5 rounded font-medium">
									AI Analysis
								</span>
							)}
						</div>
						{incident.suspectedRootCause ? (
							<>
								<p className="text-xs text-vscode-descriptionForeground leading-relaxed">
									{incident.suspectedRootCause}
								</p>
								{incident.recommendedFix && (
									<div className="mt-2">
										<span className="text-[10px] font-semibold text-vscode-descriptionForeground uppercase tracking-wider">
											Recommended fix
										</span>
										<p className="text-xs text-green-300 mt-0.5">{incident.recommendedFix}</p>
									</div>
								)}
							</>
						) : (
							<p className="text-xs text-vscode-descriptionForeground italic">
								No AI analysis available yet. Click "Auto-triage" to analyze.
							</p>
						)}
						<div className="mt-3 flex gap-2">
							<button
								type="button"
								className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors">
								Run Auto-fix
							</button>
							<button
								type="button"
								className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-panel-border text-vscode-foreground hover:bg-vscode-list-hoverBackground transition-colors">
								View Details
							</button>
						</div>
					</div>
				</div>

				{/* Reproduction Steps */}
				{incident.reproductionSteps.length > 0 && (
					<div className="rounded-lg border border-vscode-panel-border bg-black/20 p-3">
						<span className="text-xs font-semibold">Reproduction Steps</span>
						<ol className="mt-2 text-xs text-vscode-descriptionForeground space-y-1 list-decimal list-inside">
							{incident.reproductionSteps.map((step, i) => (
								<li key={i}>{step}</li>
							))}
						</ol>
					</div>
				)}

				{/* Deployment Risk */}
				{incident.deploymentRisk !== "low" && (
					<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
						<AlertTriangle className="size-4 text-amber-400 shrink-0" />
						<div>
							<span className="text-xs font-semibold text-amber-300">
								Deployment Risk: {incident.deploymentRisk}
							</span>
							<p className="text-[10px] text-vscode-descriptionForeground mt-0.5">
								This bug may impact deployment stability. Review before deploying to production.
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// ── AI Assistant Panel ─────────────────────────────────────────────────────────

function AiAssistantPanel() {
	return (
		<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4 h-full flex flex-col">
			<span className="text-xs font-semibold mb-3">✦ AI Assistant</span>

			<div className="rounded-xl p-3 bg-purple-500/10 border border-purple-500/30">
				<span className="text-xs font-semibold">Ask AI about this incident</span>
				<p className="text-[10px] text-vscode-descriptionForeground mt-1">Get answers and remediation steps</p>
				<div className="mt-3 flex gap-2">
					<input
						type="text"
						placeholder="Ask anything..."
						className="flex-1 bg-vscode-input-background border border-vscode-input-border rounded-lg px-2.5 py-1.5 text-xs text-vscode-input-foreground placeholder-vscode-descriptionForeground outline-none focus:border-vscode-focusBorder"
					/>
					<button
						type="button"
						className="px-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs transition-colors">
						→
					</button>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-1.5">
				<button
					type="button"
					className="px-2.5 py-1.5 rounded text-[10px] font-medium bg-white/5 hover:bg-white/10 text-vscode-descriptionForeground border border-vscode-panel-border transition-colors">
					Why did this happen?
				</button>
				<button
					type="button"
					className="px-2.5 py-1.5 rounded text-[10px] font-medium bg-white/5 hover:bg-white/10 text-vscode-descriptionForeground border border-vscode-panel-border transition-colors">
					How to fix this?
				</button>
				<button
					type="button"
					className="px-2.5 py-1.5 rounded text-[10px] font-medium bg-white/5 hover:bg-white/10 text-vscode-descriptionForeground border border-vscode-panel-border transition-colors">
					Show logs
				</button>
			</div>

			<div className="mt-4 flex-1">
				<span className="text-xs font-semibold">Recent Activity</span>
				<div className="mt-2 space-y-2">
					{[
						{ label: "Auto-triage completed", color: "bg-green-400", time: "2m ago" },
						{ label: "Incident created", color: "bg-blue-400", time: "5m ago" },
						{ label: "Error detected in logs", color: "bg-amber-400", time: "7m ago" },
						{ label: "Job failed", color: "bg-red-400", time: "15m ago" },
					].map((a) => (
						<div key={a.label} className="flex items-center justify-between text-xs">
							<span className="flex items-center gap-1.5">
								<span className={`inline-block size-1.5 rounded-full ${a.color}`} />
								{a.label}
							</span>
							<span className="text-[10px] text-vscode-descriptionForeground">{a.time}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

// ── Charts Section ─────────────────────────────────────────────────────────────

const CHART_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"]

function ChartsSection({ timeline, errorTypes, services }: ReturnType<typeof buildChartData>) {
	return (
		<div className="grid grid-cols-4 gap-3">
			{/* Incidents Over Time */}
			<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-3">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					Incidents Over Time
				</span>
				<ResponsiveContainer width="100%" height={120}>
					<AreaChart data={timeline}>
						<XAxis dataKey="time" hide />
						<YAxis hide />
						<Tooltip
							contentStyle={{
								background: "#111827",
								border: "1px solid #243044",
								borderRadius: "8px",
								fontSize: "11px",
							}}
							labelStyle={{ color: "#dbe7ff" }}
						/>
						<Area type="monotone" dataKey="total" stroke="#8b5cf6" fill="#8b5cf633" strokeWidth={1.5} />
						<Area type="monotone" dataKey="active" stroke="#ef4444" fill="#ef444422" strokeWidth={1.5} />
					</AreaChart>
				</ResponsiveContainer>
			</div>

			{/* Error Types Pie */}
			<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-3">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					By Severity
				</span>
				<ResponsiveContainer width="100%" height={120}>
					<PieChart>
						<Pie data={errorTypes} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={52}>
							{errorTypes.map((_, i) => (
								<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
							))}
						</Pie>
						<Tooltip
							contentStyle={{
								background: "#111827",
								border: "1px solid #243044",
								borderRadius: "8px",
								fontSize: "11px",
							}}
						/>
					</PieChart>
				</ResponsiveContainer>
			</div>

			{/* Affected Files Bar */}
			<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-3">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					Affected Files
				</span>
				<ResponsiveContainer width="100%" height={120}>
					<BarChart data={services} layout="vertical">
						<XAxis type="number" hide />
						<YAxis dataKey="name" type="category" width={60} tick={{ fontSize: 10, fill: "#8ea0bd" }} />
						<Tooltip
							contentStyle={{
								background: "#111827",
								border: "1px solid #243044",
								borderRadius: "8px",
								fontSize: "11px",
							}}
						/>
						<Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
					</BarChart>
				</ResponsiveContainer>
			</div>

			{/* Auto-resolved */}
			<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-3">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					Auto-resolved
				</span>
				<div className="mt-2 space-y-2">
					{[
						{ title: "Session token race condition", time: "2h ago" },
						{ title: "Memory leak in worker pool", time: "4h ago" },
						{ title: "API timeout on retry", time: "6h ago" },
					].map((item) => (
						<div key={item.title} className="flex items-center justify-between text-xs">
							<span className="flex items-center gap-1.5">
								<CheckCircle2 className="size-3 text-green-400 shrink-0" />
								<span className="truncate">{item.title}</span>
							</span>
							<span className="text-[10px] text-vscode-descriptionForeground shrink-0 ml-2">
								{item.time}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

// ── Bottom Section: Failed Deployments + GitHub ────────────────────────────────

function BottomSection() {
	return (
		<div className="grid grid-cols-3 gap-3">
			{/* Failed Deployments */}
			<div className="col-span-2 rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4">
				<div className="flex items-center gap-2 mb-3">
					<span className="text-xs font-semibold">Failed Deployments</span>
					<span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-medium">2</span>
				</div>
				<table className="w-full text-xs">
					<thead>
						<tr className="text-vscode-descriptionForeground text-left">
							<th className="pb-2 pr-2 font-medium">Deployment</th>
							<th className="pb-2 pr-2 font-medium">Project</th>
							<th className="pb-2 pr-2 font-medium">Commit</th>
							<th className="pb-2 pr-2 font-medium">Environment</th>
							<th className="pb-2 pr-2 font-medium">Reason</th>
							<th className="pb-2 font-medium">Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr className="border-t border-vscode-panel-border">
							<td className="py-2.5 pr-2 font-mono text-[10px]">deploy_01JX...</td>
							<td className="py-2.5 pr-2">superroo-web</td>
							<td className="py-2.5 pr-2 font-mono text-[10px]">a1b2c3d</td>
							<td className="py-2.5 pr-2">production</td>
							<td className="py-2.5 pr-2 text-red-300 flex items-center gap-1">
								<span className="inline-block size-1.5 rounded-full bg-red-400" />
								Health check failed
							</td>
							<td className="py-2.5">
								<button
									type="button"
									className="border border-vscode-panel-border rounded px-2 py-1 text-[10px] hover:bg-vscode-list-hoverBackground transition-colors">
									View Details
								</button>
							</td>
						</tr>
						<tr className="border-t border-vscode-panel-border">
							<td className="py-2.5 pr-2 font-mono text-[10px]">deploy_01JX...</td>
							<td className="py-2.5 pr-2">api-service</td>
							<td className="py-2.5 pr-2 font-mono text-[10px]">d4e5f6g</td>
							<td className="py-2.5 pr-2">staging</td>
							<td className="py-2.5 pr-2 text-red-300 flex items-center gap-1">
								<span className="inline-block size-1.5 rounded-full bg-red-400" />
								Docker build failed
							</td>
							<td className="py-2.5">
								<button
									type="button"
									className="border border-vscode-panel-border rounded px-2 py-1 text-[10px] hover:bg-vscode-list-hoverBackground transition-colors">
									View Details
								</button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			{/* GitHub Correlations */}
			<div className="rounded-xl border border-vscode-panel-border bg-gradient-to-b from-vscode-sideBar-background to-[#0d1320] p-4">
				<span className="text-xs font-semibold">GitHub Correlations</span>
				<div className="mt-3 space-y-3">
					{[
						{ pr: "#482 Fix: Redis connection pool handling", status: "Opened" },
						{ pr: "#481 Improve agent initialization retry logic", status: "Merged" },
						{ pr: "#479 Fix memory leak in worker", status: "Merged" },
					].map((item) => (
						<div key={item.pr} className="text-xs">
							<div className="font-medium">{item.pr}</div>
							<div className="text-[10px] text-vscode-descriptionForeground mt-0.5">
								{item.status} by @devteam
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

// ── Main BugsTab ───────────────────────────────────────────────────────────────

export function BugsTab() {
	const { bugs } = useSr()
	const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
	const [selectedBugId, setSelectedBugId] = useState<string | null>(null)

	const filtered = useMemo(() => {
		return bugs.filter((b) => {
			if (severityFilter !== "all" && b.severity !== severityFilter) return false
			if (statusFilter !== "all" && b.status !== statusFilter) return false
			return true
		})
	}, [bugs, severityFilter, statusFilter])

	const selectedBug = useMemo(() => bugs.find((b) => b.id === selectedBugId) ?? null, [bugs, selectedBugId])

	const chartData = useMemo(() => buildChartData(bugs), [bugs])

	// Stats
	const stats = useMemo(() => {
		const total = bugs.length
		const active = bugs.filter((b) => b.status === "open" || b.status === "investigating").length
		const fixed = bugs.filter((b) => b.status === "fixed").length
		const withFixes = bugs.filter((b) => b.fixAttempts > 0).length
		const critical = bugs.filter((b) => b.severity === "critical").length
		return { total, active, fixed, withFixes, critical }
	}, [bugs])

	return (
		<div className="p-4 space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Bug className="size-4" />
					<h1 className="text-sm font-bold">
						Bugs{" "}
						<span className="text-xs font-normal text-vscode-descriptionForeground">
							AI-powered debugging & incident management
						</span>
					</h1>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						className="border border-vscode-panel-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-vscode-list-hoverBackground transition-colors flex items-center gap-1.5">
						<Zap className="size-3" />
						Auto-triage
					</button>
					<button
						type="button"
						className="border border-vscode-panel-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-vscode-list-hoverBackground transition-colors flex items-center gap-1.5">
						<Filter className="size-3" />
						Last 24 hours
						<ChevronDown className="size-3" />
					</button>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-6 gap-3">
				<SystemStatusCard />
				<StatCard label="Total Incidents" value={String(stats.total)} sub="All time" tone="text-blue-400" />
				<StatCard
					label="Active"
					value={String(stats.active)}
					sub="Open / Investigating"
					tone="text-amber-400"
				/>
				<StatCard label="Fixed" value={String(stats.fixed)} sub="Resolved" tone="text-green-400" />
				<StatCard
					label="With Fixes"
					value={String(stats.withFixes)}
					sub="Attempted repairs"
					tone="text-purple-400"
				/>
				<StatCard label="Critical" value={String(stats.critical)} sub="P1 incidents" tone="text-red-400" />
			</div>

			{/* Filters */}
			<div className="flex items-center gap-2">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					Severity
				</span>
				<div className="flex gap-1">
					{SEVERITY_OPTIONS.map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => setSeverityFilter(s)}
							className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
								severityFilter === s
									? "bg-purple-500/30 text-purple-300 border-purple-500/40"
									: "bg-white/5 text-vscode-descriptionForeground border-vscode-panel-border hover:bg-white/10"
							}`}>
							{s === "all"
								? "All"
								: s === "critical"
									? "P1"
									: s === "high"
										? "P2"
										: s === "medium"
											? "P3"
											: "P4"}
						</button>
					))}
				</div>
				<span className="ml-3 text-[10px] font-semibold uppercase tracking-widest text-vscode-descriptionForeground">
					Status
				</span>
				<div className="flex gap-1">
					{STATUS_OPTIONS.map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => setStatusFilter(s)}
							className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
								statusFilter === s
									? "bg-purple-500/30 text-purple-300 border-purple-500/40"
									: "bg-white/5 text-vscode-descriptionForeground border-vscode-panel-border hover:bg-white/10"
							}`}>
							{s.charAt(0).toUpperCase() + s.slice(1)}
						</button>
					))}
				</div>
			</div>

			{/* Main 3-column layout */}
			<div className="grid grid-cols-12 gap-3" style={{ minHeight: "420px" }}>
				{/* Incident List */}
				<div className="col-span-3">
					<IncidentList incidents={filtered} selectedId={selectedBugId} onSelect={setSelectedBugId} />
				</div>

				{/* Detail Panel */}
				<div className="col-span-6">
					<DetailPanel incident={selectedBug} />
				</div>

				{/* AI Assistant */}
				<div className="col-span-3">
					<AiAssistantPanel />
				</div>
			</div>

			{/* Charts */}
			<ChartsSection
				timeline={chartData.timeline}
				errorTypes={chartData.errorTypes}
				services={chartData.services}
			/>

			{/* Bottom Section */}
			<BottomSection />
		</div>
	)
}
