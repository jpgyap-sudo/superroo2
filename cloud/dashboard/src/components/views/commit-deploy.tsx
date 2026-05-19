"use client"

import { useState, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	GitCommit,
	Rocket,
	RefreshCw,
	Clock,
	AlertTriangle,
	User,
	FileText,
	Hash,
	CheckCircle2,
	XCircle,
	Activity,
	Shield,
	Brain,
	Code2,
	BookOpen,
	Eye,
	Server,
	Filter,
	X,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkflowSteps {
	lessonsRead: boolean
	deepseekDelegated: boolean
	codexReviewed: boolean
	ollamaSummarized: boolean
	centralBrainStored: boolean
}

interface WorkflowCompliance {
	isCompliant: boolean
	steps: WorkflowSteps
	violations: string[]
	deepseekApiKeyUsed?: string
}

interface ModelUsage {
	phase: string
	provider: string
	model: string
	promptTokens?: number
	completionTokens?: number
	latencyMs?: number
	success: boolean
	fallbackUsed?: boolean
}

interface CommitEntry {
	sha: string
	agent: string
	type: string
	title: string
	filesChanged: number
	timestamp: number
	featuresAffected: string[]
	workflowCompliance?: WorkflowCompliance
	modelsUsed?: ModelUsage[]
	bugsFixed?: string[]
}

interface DeployEntry {
	version: string
	sha: string
	agent: string
	status: string
	timestamp: number
	startedAt: number | null
	completedAt: number | null
	durationMs: number | null
	environment: string | null
	healthCheckPassed: boolean | null
	healthCheckLatencyMs: number | null
	failureReason: string | null
	featuresDeployed?: string[]
	commitsIncluded?: string[]
}

interface DeploySummary {
	successRate: number | null
	avgDuration: string | null
	failuresByReason: { reason: string; count: number }[]
}

interface CommitDeployData {
	success: boolean
	commits: CommitEntry[]
	deploys: DeployEntry[]
	totalCommits: number
	totalDeploys: number
	deploySummary?: DeploySummary
	note?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_EMOJI: Record<string, string> = {
	feature: "✨",
	bugfix: "🐛",
	refactor: "♻️",
	docs: "📝",
	config: "⚙️",
	test: "🧪",
	deploy: "🚀",
	other: "🔧",
}

const STATUS_EMOJI: Record<string, string> = {
	healthy: "✅",
	unhealthy: "❌",
	rolled_back: "↩️",
	failed: "💥",
	completed: "✅",
	pending: "⏳",
	running: "🔄",
}

const AGENT_ICONS: Record<string, string> = {
	codex: "🧠",
	deepseek: "🌊",
	ollama: "🦙",
	superroo: "🤖",
	hermes: "🔮",
	openclaw: "🦀",
}

function getAgentIcon(agent: string): string {
	const lower = agent.toLowerCase()
	for (const [key, icon] of Object.entries(AGENT_ICONS)) {
		if (lower.includes(key)) return icon
	}
	return "👤"
}

function formatTime(ts: number) {
	if (!ts) return "—"
	return new Date(ts).toLocaleString()
}

function shortSha(sha: string) {
	return sha ? sha.slice(0, 7) : "???"
}

function formatDuration(ms: number | null) {
	if (ms === null) return "—"
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function WorkflowBadge({ steps }: { steps: WorkflowSteps }) {
	const items = [
		{ key: "lessonsRead", label: "Lessons", icon: BookOpen },
		{ key: "deepseekDelegated", label: "DeepSeek", icon: Brain },
		{ key: "codexReviewed", label: "Codex", icon: Code2 },
		{ key: "ollamaSummarized", label: "Ollama", icon: Eye },
		{ key: "centralBrainStored", label: "Brain", icon: Server },
	] as const

	return (
		<div className="flex flex-wrap gap-1.5">
			{items.map(({ key, label, icon: Icon }) => {
				const done = steps[key as keyof WorkflowSteps]
				return (
					<span
						key={key}
						className={cn(
							"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
							done ? "bg-emerald-500/10 text-emerald-300" : "bg-gray-800/40 text-gray-500",
						)}
						title={label}>
						<Icon className="h-2.5 w-2.5" />
						{label}
					</span>
				)
			})}
		</div>
	)
}

function ModelUsageBadge({ models }: { models: ModelUsage[] }) {
	if (!models || models.length === 0) return null
	return (
		<div className="flex flex-wrap gap-1">
			{models.map((m, i) => (
				<span
					key={i}
					className={cn(
						"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
						m.success ? "bg-blue-500/10 text-blue-300" : "bg-red-500/10 text-red-300",
					)}
					title={`${m.phase}: ${m.provider}/${m.model}${m.latencyMs ? ` (${m.latencyMs}ms)` : ""}`}>
					{m.provider}/{m.model}
					{m.latencyMs !== undefined && <span className="text-gray-500">({m.latencyMs}ms)</span>}
				</span>
			))}
		</div>
	)
}

function HealthBar({ latencyMs }: { latencyMs: number | null }) {
	if (latencyMs === null) return null
	const pct = Math.min((latencyMs / 5000) * 100, 100)
	const color = latencyMs < 1000 ? "bg-emerald-500" : latencyMs < 3000 ? "bg-yellow-500" : "bg-red-500"
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-800">
				<div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
			</div>
			<span className="text-[10px] text-gray-500">{latencyMs}ms</span>
		</div>
	)
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CommitDeployView() {
	const [data, setData] = useState<CommitDeployData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [limit, setLimit] = useState(10)
	const [agentFilter, setAgentFilter] = useState<string>("")
	const [typeFilter, setTypeFilter] = useState<string>("")
	const [statusFilter, setStatusFilter] = useState<string>("")
	const [showTimeline, setShowTimeline] = useState(false)
	const [showCompliance, setShowCompliance] = useState(false)

	const fetchData = async () => {
		setLoading(true)
		setError(null)
		try {
			const res = await fetch(`/api/orchestrator/commit-deploy-status?limit=${limit}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			setData(json)
		} catch (err: any) {
			setError(err.message || "Failed to fetch commit/deploy data")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [limit])

	// ── Derived data ──────────────────────────────────────────────────────

	const uniqueAgents = useMemo(() => {
		if (!data) return []
		const agents = new Set<string>()
		data.commits.forEach((c) => agents.add(c.agent))
		data.deploys.forEach((d) => agents.add(d.agent))
		return Array.from(agents).sort()
	}, [data])

	const filteredCommits = useMemo(() => {
		if (!data) return []
		return data.commits.filter((c) => {
			if (agentFilter && !c.agent.toLowerCase().includes(agentFilter.toLowerCase())) return false
			if (typeFilter && c.type !== typeFilter) return false
			return true
		})
	}, [data, agentFilter, typeFilter])

	const filteredDeploys = useMemo(() => {
		if (!data) return []
		return data.deploys.filter((d) => {
			if (agentFilter && !d.agent.toLowerCase().includes(agentFilter.toLowerCase())) return false
			if (statusFilter && d.status !== statusFilter) return false
			return true
		})
	}, [data, agentFilter, statusFilter])

	// ── Timeline: merge commits + deploys chronologically ────────────────

	const timeline = useMemo(() => {
		if (!data) return []
		const items: Array<{
			id: string
			type: "commit" | "deploy"
			timestamp: number
			agent: string
			title: string
			status: string
			subtitle: string
		}> = []

		data.commits.forEach((c) => {
			items.push({
				id: c.sha,
				type: "commit",
				timestamp: c.timestamp,
				agent: c.agent,
				title: c.title,
				status: c.type,
				subtitle: `${shortSha(c.sha)} — ${c.filesChanged} files`,
			})
		})

		data.deploys.forEach((d) => {
			items.push({
				id: d.version + d.sha,
				type: "deploy",
				timestamp: d.timestamp,
				agent: d.agent,
				title: `v${d.version}`,
				status: d.status,
				subtitle: `${shortSha(d.sha)} — ${d.environment || "unknown"}`,
			})
		})

		return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)
	}, [data])

	// ── Agent stats ──────────────────────────────────────────────────────

	const agentStats = useMemo(() => {
		if (!data) return []
		const stats = new Map<string, { commits: number; deploys: number; features: Set<string> }>()
		data.commits.forEach((c) => {
			const s = stats.get(c.agent) || { commits: 0, deploys: 0, features: new Set() }
			s.commits++
			c.featuresAffected?.forEach((f) => s.features.add(f))
			stats.set(c.agent, s)
		})
		data.deploys.forEach((d) => {
			const s = stats.get(d.agent) || { commits: 0, deploys: 0, features: new Set() }
			s.deploys++
			stats.set(d.agent, s)
		})
		return Array.from(stats.entries())
			.map(([agent, s]) => ({
				agent,
				commits: s.commits,
				deploys: s.deploys,
				features: s.features.size,
			}))
			.sort((a, b) => b.commits - a.commits)
	}, [data])

	// ── Compliance stats ─────────────────────────────────────────────────

	const complianceStats = useMemo(() => {
		if (!data) return null
		const withCompliance = data.commits.filter((c) => c.workflowCompliance)
		if (withCompliance.length === 0) return null

		const compliant = withCompliance.filter((c) => c.workflowCompliance!.isCompliant).length
		const stepsTotal = {
			lessonsRead: 0,
			deepseekDelegated: 0,
			codexReviewed: 0,
			ollamaSummarized: 0,
			centralBrainStored: 0,
		}

		withCompliance.forEach((c) => {
			const steps = c.workflowCompliance!.steps
			stepsTotal.lessonsRead += steps.lessonsRead ? 1 : 0
			stepsTotal.deepseekDelegated += steps.deepseekDelegated ? 1 : 0
			stepsTotal.codexReviewed += steps.codexReviewed ? 1 : 0
			stepsTotal.ollamaSummarized += steps.ollamaSummarized ? 1 : 0
			stepsTotal.centralBrainStored += steps.centralBrainStored ? 1 : 0
		})

		return {
			total: withCompliance.length,
			compliant,
			complianceRate: Math.round((compliant / withCompliance.length) * 100),
			stepsTotal,
		}
	}, [data])

	return (
		<div className="flex flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<GitCommit className="h-5 w-5 text-[#60a5fa]" />
					<h1 className="text-lg font-semibold text-[#e2e8f0]">Commit & Deploy Log</h1>
					{data && (
						<span className="rounded bg-[#1e2535] px-2 py-0.5 text-[10px] text-gray-500">
							{data.totalCommits} commits · {data.totalDeploys} deploys
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowTimeline(!showTimeline)}
						className={cn(
							"flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition-colors",
							showTimeline
								? "border-[#60a5fa]/40 bg-[#60a5fa]/10 text-[#60a5fa]"
								: "border-[#1e2535] bg-[#0f1117] text-gray-400 hover:text-[#e2e8f0]",
						)}>
						<Activity className="h-3.5 w-3.5" />
						Timeline
					</button>
					<select
						value={limit}
						onChange={(e) => setLimit(Number(e.target.value))}
						className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1.5 text-xs text-gray-400">
						<option value={5}>5</option>
						<option value={10}>10</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
					</select>
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1 rounded border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0] disabled:opacity-50">
						<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<Card className="border-red-800/40 bg-red-950/20">
					<div className="flex items-center gap-2 text-red-400">
						<AlertTriangle className="h-4 w-4" />
						<span className="text-sm">{error}</span>
					</div>
				</Card>
			)}

			{/* Loading */}
			{loading && !data && (
				<div className="flex items-center justify-center py-12">
					<RefreshCw className="h-6 w-6 animate-spin text-gray-500" />
				</div>
			)}

			{data && (
				<>
					{/* Stats */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
						<StatCard label="Total Commits" value={data.totalCommits} color="text-[#60a5fa]" />
						<StatCard label="Total Deploys" value={data.totalDeploys} color="text-[#34d399]" />
						<StatCard
							label="Recent Commits"
							value={data.commits.length}
							sub="in current view"
							color="text-[#a78bfa]"
						/>
						<StatCard
							label="Recent Deploys"
							value={data.deploys.length}
							sub="in current view"
							color="text-[#f472b6]"
						/>
						<StatCard
							label="Deploy Success"
							value={
								data.deploySummary?.successRate === null
									? "—"
									: `${data.deploySummary?.successRate ?? "—"}%`
							}
							sub="all recorded deploys"
							color="text-[#34d399]"
						/>
						<StatCard
							label="Avg Duration"
							value={data.deploySummary?.avgDuration || "—"}
							sub="completed deploys"
							color="text-[#f59e0b]"
						/>
					</div>

					{/* Agent Activity Summary */}
					{agentStats.length > 1 && (
						<Card>
							<div className="mb-3 flex items-center gap-2">
								<User className="h-4 w-4 text-[#a78bfa]" />
								<h2 className="text-sm font-semibold text-[#e2e8f0]">Agent Activity</h2>
							</div>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{agentStats.map((s) => (
									<div
										key={s.agent}
										className="flex items-center gap-3 rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
										<span className="text-lg">{getAgentIcon(s.agent)}</span>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium text-[#e2e8f0] truncate">{s.agent}</p>
											<p className="text-[11px] text-gray-500">
												{s.commits} commits · {s.deploys} deploys · {s.features} features
											</p>
										</div>
									</div>
								))}
							</div>
						</Card>
					)}

					{/* Compliance Stats */}
					{complianceStats && (
						<Card>
							<div className="mb-3 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Shield className="h-4 w-4 text-emerald-400" />
									<h2 className="text-sm font-semibold text-[#e2e8f0]">Workflow Compliance</h2>
								</div>
								<button
									onClick={() => setShowCompliance(!showCompliance)}
									className="text-[11px] text-gray-500 hover:text-[#e2e8f0]">
									{showCompliance ? "Hide details" : "Show details"}
								</button>
							</div>
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<span className="text-2xl font-bold text-emerald-400">
										{complianceStats.complianceRate}%
									</span>
									<span className="text-[11px] text-gray-500">compliant</span>
								</div>
								<div className="flex items-center gap-2 text-[11px] text-gray-500">
									<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
									{complianceStats.compliant}/{complianceStats.total} tracked commits
								</div>
							</div>
							{showCompliance && (
								<div className="mt-3 grid grid-cols-5 gap-2">
									{Object.entries(complianceStats.stepsTotal).map(([step, count]) => {
										const labels: Record<string, string> = {
											lessonsRead: "📖 Lessons Read",
											deepseekDelegated: "🌊 DeepSeek",
											codexReviewed: "🧠 Codex Review",
											ollamaSummarized: "🦙 Ollama Sum.",
											centralBrainStored: "🧠 Brain Store",
										}
										const pct = Math.round((count / complianceStats.total) * 100)
										return (
											<div
												key={step}
												className="rounded border border-[#1e2535] bg-[#0a0e1a] p-2 text-center">
												<p className="text-[18px] font-bold text-[#e2e8f0]">{pct}%</p>
												<p className="text-[10px] text-gray-500">{labels[step] || step}</p>
											</div>
										)
									})}
								</div>
							)}
						</Card>
					)}

					{data.note && (
						<Card className="border-yellow-800/40 bg-yellow-950/20">
							<div className="flex items-center gap-2 text-yellow-400">
								<AlertTriangle className="h-4 w-4" />
								<span className="text-sm">{data.note}</span>
							</div>
						</Card>
					)}

					{data.deploySummary?.failuresByReason && data.deploySummary.failuresByReason.length > 0 && (
						<Card>
							<div className="mb-3 flex items-center gap-2">
								<AlertTriangle className="h-4 w-4 text-red-400" />
								<h2 className="text-sm font-semibold text-[#e2e8f0]">Recorded Deploy Failures</h2>
							</div>
							<div className="flex flex-wrap gap-2">
								{data.deploySummary.failuresByReason.map((item) => (
									<span
										key={item.reason}
										className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-200">
										{item.reason} ({item.count})
									</span>
								))}
							</div>
						</Card>
					)}

					{/* Timeline View */}
					{showTimeline && timeline.length > 0 && (
						<Card>
							<div className="mb-3 flex items-center gap-2">
								<Activity className="h-4 w-4 text-[#f59e0b]" />
								<h2 className="text-sm font-semibold text-[#e2e8f0]">Activity Timeline</h2>
							</div>
							<div className="relative pl-6">
								{/* Vertical line */}
								<div className="absolute left-2.5 top-2 bottom-2 w-px bg-[#1e2535]" />
								{timeline.map((item, i) => (
									<div key={`${item.id}-${i}`} className="relative pb-4 last:pb-0">
										{/* Dot */}
										<div
											className={cn(
												"absolute -left-[18px] top-1 h-3 w-3 rounded-full border-2",
												item.type === "commit"
													? "border-[#60a5fa] bg-[#60a5fa]/20"
													: "border-[#34d399] bg-[#34d399]/20",
											)}
										/>
										<div className="flex items-center gap-2">
											<span className="text-[11px]">{item.type === "commit" ? "📝" : "🚀"}</span>
											<span className="text-sm text-[#e2e8f0] truncate flex-1">{item.title}</span>
											<Badge status={item.status} label={item.status} className="text-[10px]" />
										</div>
										<div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
											<span>
												{getAgentIcon(item.agent)} {item.agent}
											</span>
											<span>{item.subtitle}</span>
											<span className="ml-auto">{formatTime(item.timestamp)}</span>
										</div>
									</div>
								))}
							</div>
						</Card>
					)}

					{/* Filters */}
					<div className="flex flex-wrap items-center gap-2">
						<Filter className="h-3.5 w-3.5 text-gray-500" />
						{uniqueAgents.length > 0 && (
							<select
								value={agentFilter}
								onChange={(e) => setAgentFilter(e.target.value)}
								className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-gray-400">
								<option value="">All agents</option>
								{uniqueAgents.map((a) => (
									<option key={a} value={a}>
										{getAgentIcon(a)} {a}
									</option>
								))}
							</select>
						)}
						<select
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-gray-400">
							<option value="">All types</option>
							{Object.entries(TYPE_EMOJI).map(([type, emoji]) => (
								<option key={type} value={type}>
									{emoji} {type}
								</option>
							))}
						</select>
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
							className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-gray-400">
							<option value="">All deploy status</option>
							{Object.entries(STATUS_EMOJI).map(([status, emoji]) => (
								<option key={status} value={status}>
									{emoji} {status}
								</option>
							))}
						</select>
						{(agentFilter || typeFilter || statusFilter) && (
							<button
								onClick={() => {
									setAgentFilter("")
									setTypeFilter("")
									setStatusFilter("")
								}}
								className="flex items-center gap-1 rounded border border-red-800/30 bg-red-950/20 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950/40">
								<X className="h-3 w-3" />
								Clear filters
							</button>
						)}
					</div>

					{/* Commits */}
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<GitCommit className="h-4 w-4 text-[#60a5fa]" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent Commits</h2>
							{filteredCommits.length === 0 && <Badge status="idle" label="Empty" className="ml-auto" />}
							{filteredCommits.length > 0 && (
								<span className="ml-auto text-[11px] text-gray-500">
									{filteredCommits.length} commits
								</span>
							)}
						</div>
						{filteredCommits.length === 0 ? (
							<p className="py-4 text-center text-sm text-gray-500">
								{data.commits.length === 0
									? "No commits recorded yet."
									: "No commits match the current filters."}
							</p>
						) : (
							<div className="flex flex-col gap-2">
								{filteredCommits.map((c, i) => (
									<div
										key={c.sha || i}
										className="flex flex-col gap-1.5 rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
										<div className="flex items-center gap-2">
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-[#60a5fa] font-mono">
												{shortSha(c.sha)}
											</code>
											<span className="text-[11px]">{TYPE_EMOJI[c.type] || "🔧"}</span>
											<span className="flex-1 truncate text-sm text-[#e2e8f0]">{c.title}</span>
											<Badge status={c.type} label={c.type} className="text-[10px]" />
										</div>
										<div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
											<span className="flex items-center gap-1">
												<span className="text-[11px]">{getAgentIcon(c.agent)}</span>
												{c.agent}
											</span>
											<span className="flex items-center gap-1">
												<FileText className="h-3 w-3" />
												{c.filesChanged} files
											</span>
											{c.featuresAffected && c.featuresAffected.length > 0 && (
												<span className="flex items-center gap-1">
													<Hash className="h-3 w-3" />
													{c.featuresAffected.join(", ")}
												</span>
											)}
											{c.bugsFixed && c.bugsFixed.length > 0 && (
												<span className="flex items-center gap-1 text-red-300">
													🐛 {c.bugsFixed.join(", ")}
												</span>
											)}
											<span className="flex items-center gap-1 ml-auto">
												<Clock className="h-3 w-3" />
												{formatTime(c.timestamp)}
											</span>
										</div>
										{/* Workflow compliance */}
										{c.workflowCompliance && (
											<div className="flex items-center justify-between pt-1 border-t border-[#1e2535]/50">
												<WorkflowBadge steps={c.workflowCompliance.steps} />
												{c.workflowCompliance.violations.length > 0 && (
													<span
														className="text-[10px] text-yellow-400"
														title={c.workflowCompliance.violations.join("; ")}>
														⚠️ {c.workflowCompliance.violations.length} violation
														{c.workflowCompliance.violations.length > 1 ? "s" : ""}
													</span>
												)}
											</div>
										)}
										{/* Model usage */}
										{c.modelsUsed && c.modelsUsed.length > 0 && (
											<div className="pt-1 border-t border-[#1e2535]/50">
												<ModelUsageBadge models={c.modelsUsed} />
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</Card>

					{/* Deploys */}
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<Rocket className="h-4 w-4 text-[#34d399]" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent Deploys</h2>
							{filteredDeploys.length === 0 && <Badge status="idle" label="Empty" className="ml-auto" />}
							{filteredDeploys.length > 0 && (
								<span className="ml-auto text-[11px] text-gray-500">
									{filteredDeploys.length} deploys
								</span>
							)}
						</div>
						{filteredDeploys.length === 0 ? (
							<p className="py-4 text-center text-sm text-gray-500">
								{data.deploys.length === 0
									? "No deploys recorded yet."
									: "No deploys match the current filters."}
							</p>
						) : (
							<div className="flex flex-col gap-2">
								{filteredDeploys.map((d, i) => (
									<div
										key={d.version + d.sha || i}
										className="flex flex-col gap-1.5 rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
										<div className="flex items-center gap-2">
											<span className="text-[11px]">{STATUS_EMOJI[d.status] || "🔄"}</span>
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-[#34d399] font-mono">
												v{d.version}
											</code>
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-gray-400 font-mono">
												{shortSha(d.sha)}
											</code>
											<span className="ml-auto">
												<Badge status={d.status} label={d.status} className="text-[10px]" />
											</span>
										</div>
										<div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
											<span className="flex items-center gap-1">
												<span className="text-[11px]">{getAgentIcon(d.agent)}</span>
												{d.agent}
											</span>
											{d.environment && (
												<span className="flex items-center gap-1">
													<Server className="h-3 w-3" />
													{d.environment}
												</span>
											)}
											<span className="flex items-center gap-1">
												<Clock className="h-3 w-3" />
												{formatDuration(d.durationMs)}
											</span>
											{d.healthCheckPassed !== null && (
												<span className="flex items-center gap-1">
													{d.healthCheckPassed ? (
														<CheckCircle2 className="h-3 w-3 text-emerald-400" />
													) : (
														<XCircle className="h-3 w-3 text-red-400" />
													)}
													Health
												</span>
											)}
											{d.healthCheckLatencyMs !== null && (
												<HealthBar latencyMs={d.healthCheckLatencyMs} />
											)}
											<span className="flex items-center gap-1 ml-auto">
												<Clock className="h-3 w-3" />
												{formatTime(d.timestamp)}
											</span>
										</div>
										{d.featuresDeployed && d.featuresDeployed.length > 0 && (
											<div className="flex items-center gap-2 text-[11px] text-gray-500 pt-1 border-t border-[#1e2535]/50">
												<Hash className="h-3 w-3" />
												<span>Features: {d.featuresDeployed.join(", ")}</span>
											</div>
										)}
										{d.failureReason && (
											<p className="text-[11px] text-red-300 pt-1 border-t border-[#1e2535]/50">
												{d.failureReason}
											</p>
										)}
									</div>
								))}
							</div>
						)}
					</Card>
				</>
			)}
		</div>
	)
}
