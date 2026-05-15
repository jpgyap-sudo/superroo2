"use client"

import { useState, useEffect, useMemo } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Bug,
	AlertTriangle,
	AlertCircle,
	AlertOctagon,
	Search,
	X,
	ChevronDown,
	ChevronRight,
	Activity,
	Server,
	Code,
	FileWarning,
} from "lucide-react"
import {
	AreaChart,
	Area,
	PieChart,
	Pie,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	Cell,
} from "recharts"

// ── Types ──────────────────────────────────────────────────────────────────────

interface BugEntry {
	id: string
	title: string
	severity: "critical" | "high" | "medium" | "low"
	status: "open" | "in_progress" | "resolved" | "wont_fix"
	service: string
	timestamp: string
	description: string
	stackTrace?: string
	resolution?: string
	assignedTo?: string
}

const SEVERITY_CONFIG = {
	critical: {
		label: "Critical",
		color: "text-red-400",
		bg: "bg-red-500/10",
		border: "border-red-500/30",
		icon: AlertOctagon,
	},
	high: {
		label: "High",
		color: "text-orange-400",
		bg: "bg-orange-500/10",
		border: "border-orange-500/30",
		icon: AlertTriangle,
	},
	medium: {
		label: "Medium",
		color: "text-amber-400",
		bg: "bg-amber-500/10",
		border: "border-amber-500/30",
		icon: AlertCircle,
	},
	low: { label: "Low", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", icon: Info },
} as const

const STATUS_CONFIG = {
	open: { label: "Open", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
	in_progress: { label: "In Progress", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
	resolved: {
		label: "Resolved",
		color: "text-emerald-400",
		bg: "bg-emerald-500/10",
		border: "border-emerald-500/30",
	},
	wont_fix: { label: "Won't Fix", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
} as const

const SERVICES = ["agent-engine", "api-gateway", "dashboard", "sandbox", "queue", "deploy"]

const SEVERITY_OPTIONS = ["all", "critical", "high", "medium", "low"] as const
const STATUS_OPTIONS = ["all", "open", "in_progress", "resolved", "wont_fix"] as const

function Info(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			{...props}
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round">
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4" />
			<path d="M12 8h.01" />
		</svg>
	)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	const days = Math.floor(hrs / 24)
	return `${days}d ago`
}

function buildChartData(bugs: BugEntry[]) {
	// Timeline: last 12 hours
	const timeline = Array.from({ length: 12 }, (_, i) => {
		const hour = new Date(Date.now() - (11 - i) * 3600000)
		const label = `${hour.getHours().toString().padStart(2, "0")}:00`
		const count = bugs.filter((b) => {
			const bh = new Date(b.timestamp).getTime()
			return bh >= hour.getTime() && bh < hour.getTime() + 3600000
		}).length
		return { hour: label, count }
	})

	// Error types (by severity)
	const errorTypes = (["critical", "high", "medium", "low"] as const).map((s) => ({
		name: s.charAt(0).toUpperCase() + s.slice(1),
		value: bugs.filter((b) => b.severity === s).length,
	}))

	// By service
	const services = SERVICES.map((s) => ({
		service: s,
		count: bugs.filter((b) => b.service === s).length,
	}))

	return { timeline, errorTypes, services }
}

const CHART_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#3b82f6", "#8b5cf6", "#22c55e"]

// ── Sub-components ─────────────────────────────────────────────────────────────

function SeverityIcon({ severity, className }: { severity: BugEntry["severity"]; className?: string }) {
	const config = SEVERITY_CONFIG[severity]
	const Icon = config.icon
	return <Icon className={cn("h-3.5 w-3.5", config.color, className)} />
}

function SeverityBadge({ severity }: { severity: BugEntry["severity"] }) {
	const config = SEVERITY_CONFIG[severity]
	const Icon = config.icon
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border",
				config.color,
				config.bg,
				config.border,
			)}>
			<Icon className="h-3 w-3" />
			{config.label}
		</span>
	)
}

function StatusBadge({ status }: { status: BugEntry["status"] }) {
	const config = STATUS_CONFIG[status]
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border",
				config.color,
				config.bg,
				config.border,
			)}>
			{config.label}
		</span>
	)
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ bug, onClose }: { bug: BugEntry | null; onClose: () => void }) {
	if (!bug) return null

	return (
		<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
			<div className="mb-3 flex items-start justify-between">
				<div>
					<div className="flex items-center gap-2">
						<SeverityIcon severity={bug.severity} />
						<span className="font-mono text-[10px] text-gray-600">{bug.id}</span>
					</div>
					<h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">{bug.title}</h3>
				</div>
				<button
					onClick={onClose}
					className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-[#1e2535] hover:text-[#e2e8f0]">
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="mb-3 flex flex-wrap gap-2">
				<SeverityBadge severity={bug.severity} />
				<StatusBadge status={bug.status} />
				<span className="inline-flex items-center gap-1 rounded border border-[#1e2535] bg-[#0a0e1a] px-1.5 py-0.5 text-[10px] text-gray-400">
					<Server className="h-3 w-3" />
					{bug.service}
				</span>
				{bug.assignedTo && (
					<span className="inline-flex items-center gap-1 rounded border border-[#1e2535] bg-[#0a0e1a] px-1.5 py-0.5 text-[10px] text-gray-400">
						<Code className="h-3 w-3" />
						{bug.assignedTo}
					</span>
				)}
			</div>

			<div className="space-y-2">
				<div className="rounded-lg border border-[#1e2535] bg-black/20 p-3">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						Description
					</span>
					<p className="mt-1 text-[12px] leading-relaxed text-gray-300">{bug.description}</p>
				</div>

				{bug.stackTrace && (
					<div className="rounded-lg border border-[#1e2535] bg-black/20 p-3">
						<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
							Stack Trace
						</span>
						<pre className="mt-1 overflow-x-auto text-[10px] leading-relaxed text-red-300">
							{bug.stackTrace}
						</pre>
					</div>
				)}

				{bug.resolution && (
					<div className="rounded-lg border border-[#1e2535] bg-black/20 p-3">
						<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
							Resolution
						</span>
						<p className="mt-1 text-[12px] leading-relaxed text-emerald-300">{bug.resolution}</p>
					</div>
				)}
			</div>
		</div>
	)
}

// ── Charts Section ─────────────────────────────────────────────────────────────

function ChartsSection({ timeline, errorTypes, services }: ReturnType<typeof buildChartData>) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
			{/* Timeline Chart */}
			<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
				<div className="mb-2 flex items-center gap-2">
					<Activity className="h-3.5 w-3.5 text-violet-400" />
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						Timeline (12h)
					</span>
				</div>
				<ResponsiveContainer width="100%" height={120}>
					<AreaChart data={timeline}>
						<defs>
							<linearGradient id="bugGradient" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
								<stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
							</linearGradient>
						</defs>
						<XAxis
							dataKey="hour"
							tick={{ fontSize: 9, fill: "#4b5563" }}
							axisLine={false}
							tickLine={false}
						/>
						<YAxis
							allowDecimals={false}
							tick={{ fontSize: 9, fill: "#4b5563" }}
							axisLine={false}
							tickLine={false}
							width={20}
						/>
						<Tooltip
							contentStyle={{
								background: "#0f1117",
								border: "1px solid #1e2535",
								borderRadius: "8px",
								fontSize: "11px",
								color: "#e2e8f0",
							}}
						/>
						<Area
							type="monotone"
							dataKey="count"
							stroke="#8b5cf6"
							strokeWidth={1.5}
							fill="url(#bugGradient)"
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>

			{/* Severity Pie */}
			<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
				<div className="mb-2 flex items-center gap-2">
					<FileWarning className="h-3.5 w-3.5 text-violet-400" />
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						By Severity
					</span>
				</div>
				<ResponsiveContainer width="100%" height={120}>
					<PieChart>
						<Pie data={errorTypes} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={52}>
							{errorTypes.map((_, i) => (
								<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
							))}
						</Pie>
						<Tooltip
							contentStyle={{
								background: "#0f1117",
								border: "1px solid #1e2535",
								borderRadius: "8px",
								fontSize: "11px",
								color: "#e2e8f0",
							}}
						/>
					</PieChart>
				</ResponsiveContainer>
			</div>

			{/* Services Bar */}
			<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
				<div className="mb-2 flex items-center gap-2">
					<Server className="h-3.5 w-3.5 text-violet-400" />
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						By Service
					</span>
				</div>
				<ResponsiveContainer width="100%" height={120}>
					<BarChart data={services} layout="vertical">
						<XAxis
							type="number"
							tick={{ fontSize: 9, fill: "#4b5563" }}
							axisLine={false}
							tickLine={false}
						/>
						<YAxis
							dataKey="service"
							type="category"
							tick={{ fontSize: 9, fill: "#4b5563" }}
							axisLine={false}
							tickLine={false}
							width={60}
						/>
						<Tooltip
							contentStyle={{
								background: "#0f1117",
								border: "1px solid #1e2535",
								borderRadius: "8px",
								fontSize: "11px",
								color: "#e2e8f0",
							}}
						/>
						<Bar dataKey="count" radius={[0, 4, 4, 0]}>
							{services.map((_, i) => (
								<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>
		</div>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────────

export function BugsView() {
	const [bugs, setBugs] = useState<BugEntry[]>([])
	const [selectedBug, setSelectedBug] = useState<BugEntry | null>(null)
	const [search, setSearch] = useState("")
	const [severityFilter, setSeverityFilter] = useState<string>("all")
	const [statusFilter, setStatusFilter] = useState<string>("all")
	const [loading, setLoading] = useState(true)

	// Fetch bugs from the orchestrator API
	useEffect(() => {
		const fetchBugs = async () => {
			try {
				const res = await fetch("/orchestrator/bugs")
				if (res.ok) {
					const data = await res.json()
					if (Array.isArray(data)) {
						setBugs(data)
					} else if (data.bugs && Array.isArray(data.bugs)) {
						setBugs(data.bugs)
					}
				}
			} catch (err) {
				console.error("Error fetching bugs:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchBugs()
	}, [])

	const filtered = useMemo(() => {
		return bugs.filter((b) => {
			if (severityFilter !== "all" && b.severity !== severityFilter) return false
			if (statusFilter !== "all" && b.status !== statusFilter) return false
			if (search) {
				const q = search.toLowerCase()
				return (
					b.title.toLowerCase().includes(q) ||
					b.id.toLowerCase().includes(q) ||
					b.service.toLowerCase().includes(q) ||
					b.description.toLowerCase().includes(q)
				)
			}
			return true
		})
	}, [bugs, severityFilter, statusFilter, search])

	const stats = useMemo(() => {
		return {
			critical: bugs.filter((b) => b.severity === "critical").length,
			high: bugs.filter((b) => b.severity === "high").length,
			medium: bugs.filter((b) => b.severity === "medium").length,
			low: bugs.filter((b) => b.severity === "low").length,
			open: bugs.filter((b) => b.status === "open").length,
			inProgress: bugs.filter((b) => b.status === "in_progress").length,
			resolved: bugs.filter((b) => b.status === "resolved").length,
		}
	}, [bugs])

	const chartData = useMemo(() => buildChartData(filtered), [filtered])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Bug className="h-6 w-6 animate-pulse text-violet-500" />
				<span className="ml-3 text-sm text-gray-600">Loading bug reports...</span>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* Stats Cards */}
			<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
				<StatCard label="Critical" value={stats.critical} color="text-red-400" />
				<StatCard label="High" value={stats.high} color="text-orange-400" />
				<StatCard label="Medium" value={stats.medium} color="text-amber-400" />
				<StatCard label="Low" value={stats.low} color="text-blue-400" />
				<StatCard label="Open" value={stats.open} color="text-red-400" />
				<StatCard label="In Progress" value={stats.inProgress} color="text-blue-400" />
				<StatCard label="Resolved" value={stats.resolved} color="text-emerald-400" />
			</div>

			{/* Charts */}
			<ChartsSection {...chartData} />

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-[200px] max-w-xs">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
					<input
						type="text"
						placeholder="Search bugs..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full rounded-lg border border-[#1e2535] bg-[#0a0e1a] py-1.5 pl-8 pr-3 text-[12px] text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-violet-500/50 transition-colors"
					/>
				</div>

				<div className="flex items-center gap-1">
					{SEVERITY_OPTIONS.map((s) => (
						<button
							key={s}
							onClick={() => setSeverityFilter(s)}
							className={cn(
								"rounded-lg px-2.5 py-1 text-[10px] font-medium border transition-colors",
								severityFilter === s
									? "border-violet-500/50 bg-violet-500/10 text-violet-300"
									: "border-[#1e2535] text-gray-500 hover:bg-[#0f1117] hover:text-[#e2e8f0]",
							)}>
							{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
						</button>
					))}
				</div>

				<div className="flex items-center gap-1">
					{STATUS_OPTIONS.map((s) => (
						<button
							key={s}
							onClick={() => setStatusFilter(s)}
							className={cn(
								"rounded-lg px-2.5 py-1 text-[10px] font-medium border transition-colors",
								statusFilter === s
									? "border-violet-500/50 bg-violet-500/10 text-violet-300"
									: "border-[#1e2535] text-gray-500 hover:bg-[#0f1117] hover:text-[#e2e8f0]",
							)}>
							{s === "all"
								? "All"
								: s === "in_progress"
									? "In Progress"
									: s === "wont_fix"
										? "Won't Fix"
										: s.charAt(0).toUpperCase() + s.slice(1)}
						</button>
					))}
				</div>
			</div>

			{/* Main Content: List + Detail */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				{/* Bug List */}
				<div className="lg:col-span-2 space-y-1">
					{filtered.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-gray-600">
							<Bug className="h-8 w-8 mb-2" />
							<p className="text-[12px]">No bugs match your filters</p>
						</div>
					) : (
						filtered.map((bug) => (
							<button
								key={bug.id}
								onClick={() => setSelectedBug(selectedBug?.id === bug.id ? null : bug)}
								className={cn(
									"w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
									selectedBug?.id === bug.id
										? "border-violet-500/50 bg-violet-500/5"
										: "border-[#1e2535] bg-[#0a0e1a] hover:bg-[#0f1117]",
								)}>
								<div className="flex items-start gap-2">
									<SeverityIcon severity={bug.severity} className="mt-0.5 shrink-0" />
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="text-[12px] font-medium text-[#e2e8f0] truncate">
												{bug.title}
											</span>
											{selectedBug?.id === bug.id ? (
												<ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
											) : (
												<ChevronRight className="h-3 w-3 shrink-0 text-gray-500" />
											)}
										</div>
										<div className="mt-1 flex items-center gap-2 flex-wrap">
											<SeverityBadge severity={bug.severity} />
											<StatusBadge status={bug.status} />
											<span className="text-[10px] text-gray-600">{bug.service}</span>
											<span className="text-[10px] text-gray-600">
												{formatRelative(bug.timestamp)}
											</span>
										</div>
									</div>
								</div>
							</button>
						))
					)}
				</div>

				{/* Detail Panel */}
				<div className="lg:col-span-1">
					<DetailPanel bug={selectedBug} onClose={() => setSelectedBug(null)} />
				</div>
			</div>
		</div>
	)
}
