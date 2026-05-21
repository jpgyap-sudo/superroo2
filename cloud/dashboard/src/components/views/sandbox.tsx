"use client"

import { useState, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Box,
	RefreshCw,
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Activity,
	Cpu,
	MemoryStick,
	Play,
	Trash2,
	HeartPulse,
	Container,
	Layers,
	FileCode,
	Clock,
	ChevronDown,
	ChevronRight,
	Terminal,
	BarChart2,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

interface SandboxHealth {
	healthy: boolean
	pool?: { idle: number; active: number; total: number }
	manager?: string
	error?: string
}

interface SandboxContainer {
	id: string
	jobId: string
	status: string
	language?: string
	created?: number
	exitCode?: number | null
}

interface SandboxPool {
	idle: number
	active: number
	total: number
	maxSize: number
	prewarmed: number
}

interface SandboxMetrics {
	totalRuns: number
	successRuns: number
	failedRuns: number
	avgDurationMs: number
	p95DurationMs: number
	activeContainers: number
	queueDepth: number
}

interface SandboxImage {
	id: string
	tags: string[]
	size: number
	created: number
}

interface AuditEntry {
	jobId: string
	language?: string
	status: string
	durationMs?: number
	exitCode?: number | null
	timestamp?: number
}

interface ResourcePressure {
	level: "low" | "medium" | "high" | "critical"
	cpu?: number
	memory?: number
	containers?: number
}

interface ComposeService {
	name: string
	status: string
	ports?: string[]
}

// ── API helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T | null> {
	try {
		const res = await fetch(path)
		if (!res.ok) return null
		return await res.json()
	} catch {
		return null
	}
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatTile({
	icon: Icon,
	label,
	value,
	sub,
	color = "text-slate-200",
}: {
	icon: React.ElementType
	label: string
	value: string | number
	sub?: string
	color?: string
}) {
	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-4 py-3">
			<div className="flex items-center gap-2 text-xs text-gray-500">
				<Icon className="h-3.5 w-3.5" />
				<span>{label}</span>
			</div>
			<div className={cn("mt-1 text-xl font-semibold", color)}>{value}</div>
			{sub && <div className="mt-0.5 text-[11px] text-gray-600">{sub}</div>}
		</div>
	)
}

function HealthBanner({ health }: { health: SandboxHealth | null }) {
	if (!health) return null
	if (health.healthy) {
		return (
			<div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400">
				<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
				<span>Sandbox Manager is healthy — containers ready to accept jobs</span>
			</div>
		)
	}
	return (
		<div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
			<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
			<span>{health.error ?? "Sandbox Manager unhealthy"}</span>
		</div>
	)
}

function PressureBadge({ level }: { level: ResourcePressure["level"] }) {
	const map: Record<ResourcePressure["level"], { color: string; bg: string; border: string }> = {
		low: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
		medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
		high: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
		critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
	}
	const s = map[level]
	return (
		<span
			className={cn(
				"rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
				s.color,
				s.bg,
				s.border,
			)}>
			{level}
		</span>
	)
}

function PoolBar({ pool }: { pool: SandboxPool | null }) {
	if (!pool) return null
	const activePct = pool.total > 0 ? (pool.active / pool.maxSize) * 100 : 0
	const idlePct = pool.total > 0 ? (pool.idle / pool.maxSize) * 100 : 0
	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-4 py-3">
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
					<Layers className="h-4 w-4 text-violet-400" />
					Container Pool
				</div>
				<span className="text-xs text-gray-500">
					{pool.total}/{pool.maxSize} slots used
				</span>
			</div>
			<div className="mb-2 flex h-3 overflow-hidden rounded-full bg-[#1e2535]">
				<div
					className="h-full bg-violet-500 transition-all"
					style={{ width: `${activePct}%` }}
					title={`${pool.active} active`}
				/>
				<div
					className="h-full bg-emerald-500/60 transition-all"
					style={{ width: `${idlePct}%` }}
					title={`${pool.idle} idle`}
				/>
			</div>
			<div className="flex items-center gap-4 text-[11px] text-gray-500">
				<span className="flex items-center gap-1">
					<span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> {pool.active} active
				</span>
				<span className="flex items-center gap-1">
					<span className="inline-block h-2 w-2 rounded-full bg-emerald-500/60" /> {pool.idle} idle
				</span>
				{pool.prewarmed > 0 && (
					<span className="flex items-center gap-1">
						<span className="inline-block h-2 w-2 rounded-full bg-blue-500/60" /> {pool.prewarmed} prewarmed
					</span>
				)}
			</div>
		</div>
	)
}

function ContainersTable({ containers }: { containers: SandboxContainer[] }) {
	if (containers.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-10 text-gray-600">
				<Container className="mb-2 h-8 w-8 opacity-30" />
				<p className="text-sm">No active sandbox containers</p>
			</div>
		)
	}
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-gray-500">
						<th className="px-4 py-2.5 font-medium">Job ID</th>
						<th className="px-4 py-2.5 font-medium">Language</th>
						<th className="px-4 py-2.5 font-medium">Status</th>
						<th className="px-4 py-2.5 font-medium">Exit</th>
					</tr>
				</thead>
				<tbody>
					{containers.map((c) => (
						<tr key={c.id} className="border-t border-[#1e2535] hover:bg-white/[0.02]">
							<td className="px-4 py-2.5 font-mono text-[11px] text-slate-300 max-w-[180px] truncate">
								{c.jobId}
							</td>
							<td className="px-4 py-2.5 text-blue-400">{c.language ?? "—"}</td>
							<td className="px-4 py-2.5">
								<span
									className={cn(
										"rounded-full px-2 py-0.5 text-[10px] font-medium",
										c.status === "running"
											? "bg-emerald-500/15 text-emerald-400"
											: c.status === "error"
												? "bg-red-500/15 text-red-400"
												: "bg-gray-500/15 text-gray-400",
									)}>
									{c.status}
								</span>
							</td>
							<td className="px-4 py-2.5 text-gray-500">{c.exitCode ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-gray-600">
				<FileCode className="mb-2 h-7 w-7 opacity-30" />
				<p className="text-sm">No audit entries</p>
			</div>
		)
	}
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-gray-500">
						<th className="px-4 py-2.5 font-medium">Job ID</th>
						<th className="px-4 py-2.5 font-medium">Language</th>
						<th className="px-4 py-2.5 font-medium">Status</th>
						<th className="px-4 py-2.5 font-medium">Duration</th>
					</tr>
				</thead>
				<tbody>
					{entries.slice(0, 20).map((e, i) => (
						<tr key={i} className="border-t border-[#1e2535] hover:bg-white/[0.02]">
							<td className="px-4 py-2.5 font-mono text-[11px] text-slate-300 max-w-[180px] truncate">
								{e.jobId}
							</td>
							<td className="px-4 py-2.5 text-blue-400">{e.language ?? "—"}</td>
							<td className="px-4 py-2.5">
								<span
									className={cn(
										"rounded-full px-2 py-0.5 text-[10px] font-medium",
										e.status === "success"
											? "bg-emerald-500/15 text-emerald-400"
											: e.status === "error" || e.status === "failed"
												? "bg-red-500/15 text-red-400"
												: "bg-gray-500/15 text-gray-400",
									)}>
									{e.status}
								</span>
							</td>
							<td className="px-4 py-2.5 text-gray-500">
								{e.durationMs != null ? `${e.durationMs}ms` : "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function ComposePanel({ services }: { services: ComposeService[] }) {
	if (services.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-gray-600">
				<Box className="mb-2 h-7 w-7 opacity-30" />
				<p className="text-sm">No compose services running</p>
			</div>
		)
	}
	return (
		<div className="space-y-2">
			{services.map((svc) => (
				<div
					key={svc.name}
					className="flex items-center justify-between rounded-md border border-[#1e2535] px-3 py-2 text-xs">
					<div className="flex items-center gap-2">
						<span
							className={cn(
								"h-2 w-2 rounded-full",
								svc.status === "running" ? "bg-emerald-500" : "bg-gray-500",
							)}
						/>
						<span className="font-mono text-slate-300">{svc.name}</span>
					</div>
					<div className="flex items-center gap-3 text-gray-500">
						{svc.ports && svc.ports.length > 0 && <span className="font-mono">{svc.ports.join(", ")}</span>}
						<span className={cn(svc.status === "running" ? "text-emerald-400" : "text-gray-500")}>
							{svc.status}
						</span>
					</div>
				</div>
			))}
		</div>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────

export function SandboxView() {
	const [health, setHealth] = useState<SandboxHealth | null>(null)
	const [containers, setContainers] = useState<SandboxContainer[]>([])
	const [pool, setPool] = useState<SandboxPool | null>(null)
	const [metrics, setMetrics] = useState<SandboxMetrics | null>(null)
	const [images, setImages] = useState<SandboxImage[]>([])
	const [audit, setAudit] = useState<AuditEntry[]>([])
	const [pressure, setPressure] = useState<ResourcePressure | null>(null)
	const [composeServices, setComposeServices] = useState<ComposeService[]>([])
	const [loading, setLoading] = useState(true)
	const [healing, setHealing] = useState(false)
	const [healResult, setHealResult] = useState<string | null>(null)
	const [expandedSection, setExpandedSection] = useState<string | null>("containers")

	const fetchAll = useCallback(async () => {
		setLoading(true)
		const [h, c, p, m, img, a, pr, ps] = await Promise.all([
			apiFetch<any>("/api/sandbox/health"),
			apiFetch<any>("/api/sandbox/containers"),
			apiFetch<any>("/api/sandbox/pool"),
			apiFetch<any>("/api/sandbox/metrics"),
			apiFetch<any>("/api/sandbox/images"),
			apiFetch<any>("/api/sandbox/audit"),
			apiFetch<any>("/api/sandbox/resource-pressure"),
			apiFetch<any>("/api/sandbox/compose/ps"),
		])

		if (h) setHealth(h.health ?? h)
		if (c) setContainers(c.containers ?? [])
		if (p) setPool(p.pool ?? p)
		if (m) setMetrics(m.metrics ?? m)
		if (img) setImages(img.images ?? [])
		if (a) setAudit(a.entries ?? a.audit ?? [])
		if (pr) setPressure(pr.pressure ?? pr)
		if (ps) setComposeServices(ps.services ?? [])
		setLoading(false)
	}, [])

	useEffect(() => {
		fetchAll()
		const iv = setInterval(fetchAll, 15000)
		return () => clearInterval(iv)
	}, [fetchAll])

	const healAll = async () => {
		setHealing(true)
		setHealResult(null)
		try {
			const res = await fetch("/api/sandbox/heal-all", { method: "POST" })
			const data = await res.json()
			setHealResult(data.message ?? (data.success ? "Heal completed" : "Heal failed"))
			await fetchAll()
		} catch {
			setHealResult("Error reaching sandbox API")
		}
		setHealing(false)
	}

	const successRate =
		metrics && metrics.totalRuns > 0 ? Math.round((metrics.successRuns / metrics.totalRuns) * 100) : null

	function Section({
		id,
		title,
		icon: Icon,
		count,
		children,
	}: {
		id: string
		title: string
		icon: React.ElementType
		count?: number
		children: React.ReactNode
	}) {
		const open = expandedSection === id
		return (
			<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]">
				<button
					className="flex w-full items-center justify-between px-4 py-3 text-left"
					onClick={() => setExpandedSection(open ? null : id)}>
					<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
						<Icon className="h-4 w-4 text-violet-400" />
						{title}
						{count != null && (
							<span className="rounded-full bg-[#1e2535] px-2 py-0.5 text-[11px] text-gray-400">
								{count}
							</span>
						)}
					</div>
					{open ? (
						<ChevronDown className="h-4 w-4 text-gray-500" />
					) : (
						<ChevronRight className="h-4 w-4 text-gray-500" />
					)}
				</button>
				{open && <div className="border-t border-[#1e2535]">{children}</div>}
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Box className="h-5 w-5 text-violet-400" />
					<div>
						<h1 className="text-base font-semibold text-slate-200">Sandbox Manager</h1>
						<p className="text-[11px] text-gray-500">Isolated Docker sandboxes for safe job execution</p>
					</div>
					{health != null && (
						<span
							className={cn(
								"rounded-full px-2.5 py-0.5 text-[11px] font-medium",
								health.healthy ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
							)}>
							{health.healthy ? "Healthy" : "Unhealthy"}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={healAll}
						disabled={healing}
						className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-500/20 disabled:opacity-50">
						<HeartPulse className={cn("h-3.5 w-3.5", healing && "animate-pulse")} />
						{healing ? "Healing..." : "Heal All"}
					</button>
					<button
						onClick={fetchAll}
						disabled={loading}
						className="flex items-center gap-1.5 rounded-md border border-[#1e2535] bg-[#0a0e1a] px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-slate-200 disabled:opacity-50">
						<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Health banner */}
			<HealthBanner health={health} />

			{/* Heal result */}
			{healResult && (
				<div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-400">
					<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
					{healResult}
				</div>
			)}

			{/* Stat tiles */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<StatTile
					icon={Container}
					label="Active Containers"
					value={metrics?.activeContainers ?? containers.length}
					color="text-violet-400"
				/>
				<StatTile icon={Activity} label="Total Runs" value={metrics?.totalRuns ?? "—"} color="text-slate-200" />
				<StatTile
					icon={CheckCircle2}
					label="Success Rate"
					value={successRate != null ? `${successRate}%` : "—"}
					color={
						successRate == null
							? "text-gray-500"
							: successRate >= 90
								? "text-emerald-400"
								: "text-yellow-400"
					}
					sub={metrics ? `${metrics.successRuns} ok / ${metrics.failedRuns} fail` : undefined}
				/>
				<StatTile
					icon={Clock}
					label="Avg Duration"
					value={metrics?.avgDurationMs != null ? `${metrics.avgDurationMs}ms` : "—"}
					color="text-blue-400"
					sub={metrics?.p95DurationMs != null ? `p95: ${metrics.p95DurationMs}ms` : undefined}
				/>
				<StatTile icon={Layers} label="Images" value={images.length} color="text-slate-200" />
			</div>

			{/* Resource pressure + pool side by side */}
			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<PoolBar pool={pool} />
				{pressure && (
					<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-4 py-3">
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
								<BarChart2 className="h-4 w-4 text-orange-400" />
								Resource Pressure
							</div>
							<PressureBadge level={pressure.level} />
						</div>
						<div className="grid grid-cols-2 gap-3 text-xs">
							{pressure.cpu != null && (
								<div>
									<div className="mb-1 text-gray-500">CPU</div>
									<div className="flex items-center gap-2">
										<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e2535]">
											<div
												className={cn(
													"h-full rounded-full",
													pressure.cpu >= 90
														? "bg-red-500"
														: pressure.cpu >= 70
															? "bg-yellow-500"
															: "bg-emerald-500",
												)}
												style={{ width: `${pressure.cpu}%` }}
											/>
										</div>
										<span className="text-slate-300 tabular-nums">{pressure.cpu}%</span>
									</div>
								</div>
							)}
							{pressure.memory != null && (
								<div>
									<div className="mb-1 text-gray-500">Memory</div>
									<div className="flex items-center gap-2">
										<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e2535]">
											<div
												className={cn(
													"h-full rounded-full",
													pressure.memory >= 90
														? "bg-red-500"
														: pressure.memory >= 70
															? "bg-yellow-500"
															: "bg-emerald-500",
												)}
												style={{ width: `${pressure.memory}%` }}
											/>
										</div>
										<span className="text-slate-300 tabular-nums">{pressure.memory}%</span>
									</div>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Collapsible sections */}
			<div className="space-y-3">
				<Section id="containers" title="Active Containers" icon={Container} count={containers.length}>
					<ContainersTable containers={containers} />
				</Section>

				<Section id="audit" title="Execution Audit" icon={FileCode} count={audit.length}>
					<AuditTable entries={audit} />
				</Section>

				<Section id="compose" title="Compose Services" icon={Terminal} count={composeServices.length}>
					<div className="p-4">
						<ComposePanel services={composeServices} />
					</div>
				</Section>

				<Section id="images" title="Sandbox Images" icon={Layers} count={images.length}>
					<div className="space-y-1 p-4">
						{images.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-6 text-gray-600">
								<Layers className="mb-2 h-7 w-7 opacity-30" />
								<p className="text-sm">No sandbox images found</p>
							</div>
						) : (
							images.map((img) => (
								<div
									key={img.id}
									className="flex items-center justify-between rounded-md border border-[#1e2535] px-3 py-2 text-xs">
									<span className="font-mono text-slate-300 truncate max-w-[260px]">
										{img.tags[0] ?? img.id.slice(0, 12)}
									</span>
									<span className="text-gray-500 shrink-0">
										{img.size > 0 ? `${(img.size / 1e6).toFixed(0)} MB` : "—"}
									</span>
								</div>
							))
						)}
					</div>
				</Section>
			</div>
		</div>
	)
}
