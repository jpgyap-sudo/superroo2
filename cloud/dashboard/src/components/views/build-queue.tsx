"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import {
	Package,
	RefreshCw,
	Play,
	CheckCircle2,
	XCircle,
	Clock,
	AlertTriangle,
	Loader2,
	Hash,
	RotateCcw,
	BarChart3,
	Layers,
} from "lucide-react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ─── Types ───────────────────────────────────────────────────────────────────

interface BuildTask {
	id: string
	projectName: string
	buildType: string
	imageTag: string | null
	commitSha: string | null
	status: string
	agent: string | null
	agentSource: string | null
	taskDescription: string | null
	output: string | null
	error: string | null
	metadata: any
	createdAt: number
	updatedAt: number
	startedAt: number | null
	completedAt: number | null
}

interface BuildStats {
	totalBuilds: number
	byStatus: Record<string, number>
	bySource: Record<string, number>
	byProject: Record<string, number>
	activeCount: number
	queuedCount: number
	successRate: number
	averageDurationMs: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number | null) {
	if (!ts) return "—"
	const d = new Date(ts)
	return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatDate(ts: number | null) {
	if (!ts) return "—"
	const d = new Date(ts)
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function formatDuration(start: number | null, end: number | null) {
	if (!start || !end) return "—"
	const ms = end - start
	if (ms < 1000) return `${ms}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
	return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatRelative(ts: number) {
	const diff = Date.now() - ts
	if (diff < 60000) return "just now"
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
	return `${Math.floor(diff / 86400000)}d ago`
}

function StatusBadge({ status }: { status: string }) {
	return <Badge status={status} />
}

function SourceBadge({ source }: { source: string | null }) {
	const labelMap: Record<string, string> = {
		claude: "Claude",
		codex: "Codex",
		superroo: "SuperRoo",
		api: "API",
		webhook: "Webhook",
	}
	const statusMap: Record<string, string> = {
		claude: "warning",
		codex: "active",
		superroo: "online",
		api: "open",
		webhook: "review",
	}
	const s = source || "unknown"
	return <Badge status={statusMap[s] || "idle"} label={labelMap[s] || s} />
}

function BuildTypeBadge({ type }: { type: string }) {
	const labelMap: Record<string, string> = {
		docker: "Docker",
		nextjs: "Next.js",
		typescript: "TypeScript",
		static: "Static",
	}
	const statusMap: Record<string, string> = {
		docker: "active",
		nextjs: "online",
		typescript: "warning",
		static: "open",
	}
	return <Badge status={statusMap[type] || "idle"} label={labelMap[type] || type} />
}

// ─── Build Row ───────────────────────────────────────────────────────────────

function BuildRow({
	build,
	onCancel,
	onRetry,
}: {
	build: BuildTask
	onCancel: (id: string) => void
	onRetry: (id: string) => void
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="border border-white/10 rounded-lg overflow-hidden">
			<button
				className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
				onClick={() => setExpanded(!expanded)}>
				<div
					className="w-2 h-2 rounded-full shrink-0"
					style={{
						background:
							build.status === "success"
								? "#22c55e"
								: build.status === "failed"
									? "#ef4444"
									: build.status === "running"
										? "#3b82f6"
										: build.status === "queued"
											? "#eab308"
											: build.status === "cancelled"
												? "#6b7280"
												: "#6b7280",
						boxShadow: build.status === "running" ? "0 0 6px #3b82f6" : "none",
					}}
				/>
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<span className="text-sm font-medium text-white truncate">{build.projectName}</span>
					{build.imageTag && (
						<span className="text-xs text-vscode-descriptionForeground truncate">
							:{build.imageTag.split(":").pop()}
						</span>
					)}
					<BuildTypeBadge type={build.buildType} />
					<StatusBadge status={build.status} />
					<SourceBadge source={build.agentSource} />
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-xs text-vscode-descriptionForeground">{formatRelative(build.createdAt)}</span>
					{build.status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
				</div>
			</button>

			{expanded && (
				<div className="border-t border-white/10 p-3 space-y-2 bg-white/[0.02]">
					<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
						<div>
							<span className="text-vscode-descriptionForeground">Build ID</span>
							<p className="text-white font-mono">{build.id.slice(0, 12)}...</p>
						</div>
						<div>
							<span className="text-vscode-descriptionForeground">Agent</span>
							<p className="text-white">{build.agent || "—"}</p>
						</div>
						<div>
							<span className="text-vscode-descriptionForeground">Commit</span>
							<p className="text-white font-mono">
								{build.commitSha ? build.commitSha.slice(0, 8) : "—"}
							</p>
						</div>
						<div>
							<span className="text-vscode-descriptionForeground">Duration</span>
							<p className="text-white">{formatDuration(build.startedAt, build.completedAt)}</p>
						</div>
					</div>

					{build.taskDescription && (
						<div className="text-xs">
							<span className="text-vscode-descriptionForeground">Description</span>
							<p className="text-white mt-0.5">{build.taskDescription}</p>
						</div>
					)}

					{build.output && (
						<div className="text-xs">
							<span className="text-vscode-descriptionForeground">Output</span>
							<pre className="text-green-400 mt-0.5 bg-black/30 p-2 rounded overflow-x-auto max-h-24 overflow-y-auto font-mono text-[11px]">
								{build.output}
							</pre>
						</div>
					)}

					{build.error && (
						<div className="text-xs">
							<span className="text-red-400">Error</span>
							<pre className="text-red-300 mt-0.5 bg-red-900/20 p-2 rounded overflow-x-auto max-h-24 overflow-y-auto font-mono text-[11px]">
								{build.error}
							</pre>
						</div>
					)}

					<div className="flex items-center gap-2 pt-1">
						{build.status === "running" && (
							<button
								className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
								onClick={() => onCancel(build.id)}>
								<XCircle className="w-3 h-3" /> Cancel
							</button>
						)}
						{build.status === "failed" && (
							<button
								className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
								onClick={() => onRetry(build.id)}>
								<RotateCcw className="w-3 h-3" /> Retry
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function BuildQueueView() {
	const [builds, setBuilds] = useState<BuildTask[]>([])
	const [activeBuilds, setActiveBuilds] = useState<BuildTask[]>([])
	const [queuedBuilds, setQueuedBuilds] = useState<BuildTask[]>([])
	const [stats, setStats] = useState<BuildStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [filterProject, setFilterProject] = useState("")
	const [filterStatus, setFilterStatus] = useState("")
	const [filterSource, setFilterSource] = useState("")
	const [availableProjects, setAvailableProjects] = useState<string[]>([])
	const [tab, setTab] = useState<"all" | "active" | "queued">("all")
	const [actionLoading, setActionLoading] = useState<string | null>(null)

	const fetchBuilds = useCallback(async () => {
		try {
			const params = new URLSearchParams()
			if (filterProject) params.set("project", filterProject)
			if (filterStatus) params.set("status", filterStatus)
			if (filterSource) params.set("source", filterSource)
			params.set("limit", "100")

			const [statusRes, activeRes, queuedRes, statsRes] = await Promise.all([
				fetch(`/api/build/status?${params}`),
				fetch("/api/build/active"),
				fetch("/api/build/queued"),
				fetch("/api/build/stats"),
			])

			if (statusRes.ok) {
				const data = await statusRes.json()
				setBuilds(data.builds || data.data || [])
			}
			if (activeRes.ok) {
				const data = await activeRes.json()
				setActiveBuilds(data.builds || data.data || [])
			}
			if (queuedRes.ok) {
				const data = await queuedRes.json()
				setQueuedBuilds(data.builds || data.data || [])
			}
			if (statsRes.ok) {
				const data = await statsRes.json()
				setStats(data.stats || data.data || null)
			}
			setError(null)
		} catch (err: any) {
			setError(err.message || "Failed to fetch build data")
		} finally {
			setLoading(false)
		}
	}, [filterProject, filterStatus, filterSource])

	const fetchProjects = useCallback(async () => {
		try {
			const res = await fetch("/api/projects")
			if (res.ok) {
				const data = await res.json()
				const projects = data.data?.projects || data.projects || []
				setAvailableProjects(projects.map((p: any) => p.repoName || p.name).filter(Boolean))
			}
		} catch {
			// non-critical
		}
	}, [])

	useEffect(() => {
		fetchProjects()
	}, [fetchProjects])

	useEffect(() => {
		setLoading(true)
		fetchBuilds()
	}, [fetchBuilds])

	// Auto-refresh every 10s when there are active/queued builds
	useEffect(() => {
		if (activeBuilds.length === 0 && queuedBuilds.length === 0) return
		const interval = setInterval(fetchBuilds, 10000)
		return () => clearInterval(interval)
	}, [activeBuilds.length, queuedBuilds.length, fetchBuilds])

	const handleCancel = async (buildId: string) => {
		setActionLoading(buildId)
		try {
			const res = await fetch("/api/build/cancel", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ buildId }),
			})
			if (res.ok) fetchBuilds()
		} catch {
			// ignore
		} finally {
			setActionLoading(null)
		}
	}

	const handleRetry = async (buildId: string) => {
		setActionLoading(buildId)
		try {
			const res = await fetch("/api/build/retry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ buildId }),
			})
			if (res.ok) fetchBuilds()
		} catch {
			// ignore
		} finally {
			setActionLoading(null)
		}
	}

	const displayBuilds = tab === "active" ? activeBuilds : tab === "queued" ? queuedBuilds : builds

	return (
		<div className="p-4 md:p-6 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Package className="w-5 h-5 text-vscode-foreground" />
					<h1 className="text-lg font-semibold text-vscode-foreground">Global Build Queue</h1>
					{loading && <Loader2 className="w-4 h-4 animate-spin text-vscode-descriptionForeground" />}
				</div>
				<button
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-white/5 text-vscode-foreground hover:bg-white/10 transition-colors border border-white/10"
					onClick={fetchBuilds}>
					<RefreshCw className="w-3.5 h-3.5" /> Refresh
				</button>
			</div>

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
					<AlertTriangle className="w-4 h-4 shrink-0" />
					{error}
				</div>
			)}

			{/* Stats */}
			{stats && (
				<div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
					<StatCard label="Total Builds" value={stats.totalBuilds} />
					<StatCard label="Active" value={stats.activeCount} />
					<StatCard label="Queued" value={stats.queuedCount} />
					<StatCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(0)}%`} />
					<StatCard
						label="Avg Duration"
						value={stats.averageDurationMs > 0 ? `${(stats.averageDurationMs / 1000).toFixed(1)}s` : "—"}
					/>
					<StatCard label="By Source" value={Object.keys(stats.bySource).length} />
					<StatCard label="By Project" value={Object.keys(stats.byProject).length} />
				</div>
			)}

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				{/* Project filter */}
				<div className="flex items-center gap-1.5">
					<span className="text-xs text-vscode-descriptionForeground">Project:</span>
					<select
						className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-vscode-foreground"
						value={filterProject}
						onChange={(e) => setFilterProject(e.target.value)}>
						<option value="">All</option>
						{availableProjects.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
				</div>

				{/* Status filter */}
				<div className="flex items-center gap-1.5">
					<span className="text-xs text-vscode-descriptionForeground">Status:</span>
					<select
						className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-vscode-foreground"
						value={filterStatus}
						onChange={(e) => setFilterStatus(e.target.value)}>
						<option value="">All</option>
						<option value="queued">Queued</option>
						<option value="running">Running</option>
						<option value="success">Success</option>
						<option value="failed">Failed</option>
						<option value="cancelled">Cancelled</option>
					</select>
				</div>

				{/* Source filter */}
				<div className="flex items-center gap-1.5">
					<span className="text-xs text-vscode-descriptionForeground">Source:</span>
					<select
						className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-vscode-foreground"
						value={filterSource}
						onChange={(e) => setFilterSource(e.target.value)}>
						<option value="">All</option>
						<option value="claude">Claude</option>
						<option value="codex">Codex</option>
						<option value="superroo">SuperRoo</option>
						<option value="api">API</option>
						<option value="webhook">Webhook</option>
					</select>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-1 border-b border-white/10">
				{(["all", "active", "queued"] as const).map((t) => (
					<button
						key={t}
						className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${
							tab === t
								? "text-vscode-foreground border-vscode-foreground"
								: "text-vscode-descriptionForeground border-transparent hover:text-vscode-foreground"
						}`}
						onClick={() => setTab(t)}>
						{t === "all" && "All Builds"}
						{t === "active" && `Active (${activeBuilds.length})`}
						{t === "queued" && `Queued (${queuedBuilds.length})`}
					</button>
				))}
			</div>

			{/* Build list */}
			{displayBuilds.length === 0 && !loading ? (
				<div className="flex flex-col items-center justify-center py-12 text-vscode-descriptionForeground">
					<Package className="w-8 h-8 mb-2 opacity-50" />
					<p className="text-sm">No builds found</p>
					<p className="text-xs mt-1">Submit a build from any agent using the CLI or API</p>
				</div>
			) : (
				<div className="space-y-2">
					{displayBuilds.map((build) => (
						<BuildRow key={build.id} build={build} onCancel={handleCancel} onRetry={handleRetry} />
					))}
				</div>
			)}

			{/* Agent source legend */}
			<div className="border border-white/10 rounded-lg p-3">
				<h3 className="text-xs font-medium text-vscode-descriptionForeground mb-2">Agent Sources</h3>
				<div className="flex flex-wrap gap-3 text-xs">
					<div className="flex items-center gap-1.5">
						<SourceBadge source="claude" />
						<span className="text-vscode-descriptionForeground">Claude Code</span>
					</div>
					<div className="flex items-center gap-1.5">
						<SourceBadge source="codex" />
						<span className="text-vscode-descriptionForeground">Codex</span>
					</div>
					<div className="flex items-center gap-1.5">
						<SourceBadge source="superroo" />
						<span className="text-vscode-descriptionForeground">SuperRoo</span>
					</div>
					<div className="flex items-center gap-1.5">
						<SourceBadge source="api" />
						<span className="text-vscode-descriptionForeground">API / Webhook</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-3 mt-2 text-xs">
					<span className="text-vscode-descriptionForeground">
						Use{" "}
						<code className="text-vscode-textLink">
							node scripts/global-builder.mjs submit &#123;project&#125; --source claude --description
							"..."
						</code>{" "}
						from any agent
					</span>
				</div>
			</div>
		</div>
	)
}
