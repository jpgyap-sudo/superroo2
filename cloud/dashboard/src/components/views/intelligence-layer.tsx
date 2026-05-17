"use client"

import { useEffect, useState } from "react"
import {
	BrainCircuit,
	BookOpen,
	Bug,
	HeartPulse,
	GitCommit,
	Rocket,
	Tags,
	Activity,
	TrendingUp,
	BarChart3,
	PieChart,
	Zap,
	CheckCircle,
	XCircle,
	AlertTriangle,
	Layers,
	Database,
	Server,
	Cpu,
	Loader2,
	RefreshCw,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IntelligenceData {
	lessons: {
		total: number
		today: number
		topTags: { tag: string; count: number }[]
		topModels: { model: string; count: number }[]
	}
	bugs: { total: number }
	healing: {
		totalIncidents: number
		criticalIncidents: number
		totalAttempts: number
		totalSuccesses: number
		totalFailures: number
		successRate: number
		topBugCategories: { category: string; count: number }[]
		topFixPatterns: { category: string; successCount: number; totalAttempts: number }[]
	}
	modelDecisions: {
		total: number
		models: Record<string, number>
	}
	commits: {
		total: number
		today: number
		byType: Record<string, number>
	}
	deploys: {
		total: number
		today: number
		byStatus: Record<string, number>
	}
	features: { total: number }
	commitActivity: { date: string; commits: number }[]
	lessonsByDay: { date: string; count: number }[]
	brainSync: { total: number; successful: number; failed: number }
	skills: { total: number }
	hermes: { memoryEntries: number }
	featureIndex: { chunks: number; files: number }
	learning: {
		recentEvents: { created_at: string; event_type: string; payload?: Record<string, unknown> }[]
		searches: number
		stores: number
		scores: number
	}
	rag: {
		totalBugFixes: number
		totalLessons: number
		testsPassed: number
		testsFailed: number
		errorTypes: number
		agentTypes: number
		untested: number
	}
	ollama: {
		readiness: {
			total_score: number
			level: string
			recommendation: string
			avg_score: number
			check_count: number
		}
		growth: {
			event_count: number
			event_types: Record<string, number>
		}
		timeline: { date: string; score: number; level: string }[]
	} | null
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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

function StatCard({
	icon: Icon,
	label,
	value,
	sub,
	color = "text-blue-400",
}: {
	icon: React.ComponentType<{ className?: string }>
	label: string
	value: string | number
	sub?: string
	color?: string
}) {
	return (
		<div className="flex items-center gap-3 rounded-lg border border-[rgba(82,120,190,0.15)] bg-[rgba(13,20,34,0.6)] px-4 py-3">
			<div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(40,110,255,0.1)] ${color}`}>
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-lg font-bold text-white tabular-nums">{value}</div>
				<div className="truncate text-xs text-slate-400">{label}</div>
				{sub && <div className="text-[10px] text-slate-500">{sub}</div>}
			</div>
		</div>
	)
}

function TagBadge({ tag, count }: { tag: string; count: number }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(82,120,190,0.2)] bg-[rgba(40,110,255,0.08)] px-2.5 py-1 text-xs text-slate-300">
			{tag}
			<span className="text-[10px] text-blue-400">{count}</span>
		</span>
	)
}

function ProgressBar({
	value,
	max,
	label,
	color = "bg-blue-500",
}: {
	value: number
	max: number
	label: string
	color?: string
}) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0
	return (
		<div className="flex items-center gap-2">
			<span className="w-24 truncate text-xs text-slate-400">{label}</span>
			<div className="flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)] h-1.5">
				<div
					className={`h-full rounded-full transition-all duration-500 ${color}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="w-10 text-right text-xs tabular-nums text-slate-300">{value}</span>
		</div>
	)
}

/* ------------------------------------------------------------------ */
/*  Main View                                                          */
/* ------------------------------------------------------------------ */

export function IntelligenceLayerView() {
	const [data, setData] = useState<IntelligenceData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	async function fetchData() {
		setLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/intelligence-layer")
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			if (json.success) {
				setData(json.data)
			} else {
				throw new Error(json.error || "Unknown error")
			}
		} catch (err: any) {
			setError(err.message || "Failed to load intelligence data")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
		const iv = setInterval(fetchData, 30000)
		return () => clearInterval(iv)
	}, [])

	if (loading && !data) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-blue-400" />
				<span className="ml-3 text-sm text-slate-400">Loading intelligence layer...</span>
			</div>
		)
	}

	if (error && !data) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4">
				<AlertTriangle className="h-10 w-10 text-red-400" />
				<p className="text-sm text-red-400">{error}</p>
				<button
					onClick={fetchData}
					className="flex items-center gap-2 rounded-lg border border-[rgba(82,120,190,0.3)] px-4 py-2 text-xs text-slate-300 hover:bg-[rgba(40,110,255,0.1)]">
					<RefreshCw className="h-3.5 w-3.5" />
					Retry
				</button>
			</div>
		)
	}

	if (!data) return null

	const totalCommitsByType = Object.values(data.commits.byType).reduce((a, b) => a + b, 0) || 1

	return (
		<div className="space-y-6 p-6">
			{/* ── Header ── */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-xl font-bold text-white">
						<BrainCircuit className="h-6 w-6 text-purple-400" />
						Intelligence Layer
					</h1>
					<p className="mt-1 text-xs text-slate-500">
						Aggregated knowledge, patterns, and metrics from the learning system
					</p>
				</div>
				<button
					onClick={fetchData}
					className="flex items-center gap-2 rounded-lg border border-[rgba(82,120,190,0.3)] px-3 py-1.5 text-xs text-slate-300 hover:bg-[rgba(40,110,255,0.1)]">
					<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>

			{/* ── Key Metrics Row ── */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
				<StatCard
					icon={BookOpen}
					label="Total Lessons"
					value={data.lessons.total}
					sub={`+${data.lessons.today} today`}
					color="text-blue-400"
				/>
				<StatCard icon={Bug} label="Bug Fixes" value={data.bugs.total} color="text-red-400" />
				<StatCard
					icon={HeartPulse}
					label="Healing Incidents"
					value={data.healing.totalIncidents}
					sub={`${data.healing.criticalIncidents} critical`}
					color="text-orange-400"
				/>
				<StatCard
					icon={GitCommit}
					label="Total Commits"
					value={data.commits.total}
					sub={`+${data.commits.today} today`}
					color="text-green-400"
				/>
				<StatCard
					icon={Rocket}
					label="Total Deploys"
					value={data.deploys.total}
					sub={`+${data.deploys.today} today`}
					color="text-cyan-400"
				/>
				<StatCard
					icon={Database}
					label="Features Tracked"
					value={data.features.total}
					color="text-purple-400"
				/>
				<StatCard icon={Zap} label="Skills Generated" value={data.skills.total} color="text-yellow-400" />
				<StatCard
					icon={BrainCircuit}
					label="Brain Synced"
					value={data.brainSync.successful}
					sub={`${data.brainSync.failed} failed`}
					color="text-violet-400"
				/>
			</div>

			{/* ── Row 2: Lessons + Tags + Models ── */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Top Tags */}
				<Panel title="Top Tags">
					<div className="flex flex-wrap gap-2">
						{data.lessons.topTags.length === 0 && <p className="text-xs text-slate-500">No tags yet</p>}
						{data.lessons.topTags.slice(0, 20).map((t) => (
							<TagBadge key={t.tag} tag={t.tag} count={t.count} />
						))}
					</div>
				</Panel>

				{/* Top Models */}
				<Panel title="Top Models">
					<div className="space-y-2">
						{data.lessons.topModels.length === 0 && (
							<p className="text-xs text-slate-500">No model data yet</p>
						)}
						{data.lessons.topModels.map((m) => (
							<ProgressBar
								key={m.model}
								label={m.model}
								value={m.count}
								max={data.lessons.topModels[0]?.count || 1}
								color="bg-purple-500"
							/>
						))}
					</div>
				</Panel>

				{/* Model Decisions */}
				<Panel title="Model Decisions">
					<div className="space-y-2">
						<div className="mb-3 text-2xl font-bold text-white tabular-nums">
							{data.modelDecisions.total}
						</div>
						{Object.entries(data.modelDecisions.models).length === 0 && (
							<p className="text-xs text-slate-500">No decisions recorded</p>
						)}
						{Object.entries(data.modelDecisions.models)
							.slice(0, 8)
							.map(([model, count]) => (
								<ProgressBar
									key={model}
									label={model}
									value={count}
									max={Math.max(...Object.values(data.modelDecisions.models), 1)}
									color="bg-cyan-500"
								/>
							))}
					</div>
				</Panel>
			</div>

			{/* ── Row 3: Healing + Bugs + Fix Patterns ── */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Healing Metrics */}
				<Panel title="Healing System">
					<div className="space-y-3">
						<div className="grid grid-cols-3 gap-2">
							<div className="rounded-lg bg-[rgba(34,197,94,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-green-400 tabular-nums">
									{data.healing.totalSuccesses}
								</div>
								<div className="text-[10px] text-slate-500">Fixed</div>
							</div>
							<div className="rounded-lg bg-[rgba(239,68,68,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-red-400 tabular-nums">
									{data.healing.totalFailures}
								</div>
								<div className="text-[10px] text-slate-500">Failed</div>
							</div>
							<div className="rounded-lg bg-[rgba(59,130,246,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-blue-400 tabular-nums">
									{data.healing.successRate}%
								</div>
								<div className="text-[10px] text-slate-500">Rate</div>
							</div>
						</div>
						<div className="flex items-center gap-2 text-xs text-slate-400">
							<Activity className="h-3.5 w-3.5" />
							{data.healing.totalAttempts} total attempts across {data.healing.topBugCategories.length}{" "}
							categories
						</div>
					</div>
				</Panel>

				{/* Most Common Bug Categories */}
				<Panel title="Bug Categories">
					<div className="space-y-2">
						{data.healing.topBugCategories.length === 0 && (
							<p className="text-xs text-slate-500">No bug data yet</p>
						)}
						{data.healing.topBugCategories.slice(0, 8).map((bc) => (
							<ProgressBar
								key={bc.category}
								label={bc.category.replace(/_/g, " ")}
								value={bc.count}
								max={data.healing.topBugCategories[0]?.count || 1}
								color="bg-red-500"
							/>
						))}
					</div>
				</Panel>

				{/* Most Reused Fix Patterns */}
				<Panel title="Most Reused Fixes">
					<div className="space-y-2">
						{data.healing.topFixPatterns.length === 0 && (
							<p className="text-xs text-slate-500">No fix pattern data yet</p>
						)}
						{data.healing.topFixPatterns.slice(0, 8).map((fp) => (
							<div
								key={fp.category}
								className="flex items-center justify-between rounded-lg bg-[rgba(13,20,34,0.6)] px-3 py-2">
								<div className="flex items-center gap-2">
									<CheckCircle className="h-3.5 w-3.5 text-green-400" />
									<span className="text-xs text-slate-300">{fp.category.replace(/_/g, " ")}</span>
								</div>
								<div className="flex items-center gap-3">
									<span className="text-xs text-green-400 tabular-nums">{fp.successCount} fixes</span>
									<span className="text-[10px] text-slate-500">({fp.totalAttempts} attempts)</span>
								</div>
							</div>
						))}
					</div>
				</Panel>
			</div>

			{/* ── Row 4: Commits + Deploys + Commit Activity ── */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Commits by Type */}
				<Panel title="Commits by Type">
					<div className="space-y-2">
						{Object.entries(data.commits.byType).length === 0 && (
							<p className="text-xs text-slate-500">No commit data yet</p>
						)}
						{Object.entries(data.commits.byType).map(([type, count]) => (
							<ProgressBar
								key={type}
								label={type}
								value={count}
								max={totalCommitsByType}
								color={
									type === "feature"
										? "bg-green-500"
										: type === "bugfix"
											? "bg-red-500"
											: type === "refactor"
												? "bg-blue-500"
												: type === "docs"
													? "bg-yellow-500"
													: "bg-slate-500"
								}
							/>
						))}
					</div>
				</Panel>

				{/* Deploy Status */}
				<Panel title="Deploy Status">
					<div className="space-y-2">
						{Object.entries(data.deploys.byStatus).length === 0 && (
							<p className="text-xs text-slate-500">No deploy data yet</p>
						)}
						{Object.entries(data.deploys.byStatus).map(([status, count]) => (
							<div
								key={status}
								className="flex items-center justify-between rounded-lg bg-[rgba(13,20,34,0.6)] px-3 py-2">
								<div className="flex items-center gap-2">
									{status === "healthy" ? (
										<CheckCircle className="h-3.5 w-3.5 text-green-400" />
									) : status === "failed" || status === "rolled_back" ? (
										<XCircle className="h-3.5 w-3.5 text-red-400" />
									) : (
										<AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
									)}
									<span className="text-xs capitalize text-slate-300">
										{status.replace(/_/g, " ")}
									</span>
								</div>
								<span className="text-xs font-bold text-white tabular-nums">{count}</span>
							</div>
						))}
					</div>
				</Panel>

				{/* Commit Activity (14d) */}
				<Panel title="Commit Activity (14d)">
					<div className="space-y-1">
						{data.commitActivity.length === 0 && (
							<p className="text-xs text-slate-500">No commit data yet</p>
						)}
						{data.commitActivity.map((d) => (
							<ProgressBar
								key={d.date}
								label={d.date.slice(5)}
								value={d.commits}
								max={Math.max(...data.commitActivity.map((g) => g.commits), 1)}
								color="bg-purple-500"
							/>
						))}
					</div>
				</Panel>
			</div>

			{/* ── Row 4b: Lessons/Day + Brain Sync & Skills + Knowledge Index ── */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Lessons per Day (14d) */}
				<Panel title="Lessons / Day (14d)">
					<div className="space-y-1">
						{data.lessonsByDay.length === 0 && <p className="text-xs text-slate-500">No lesson data yet</p>}
						{data.lessonsByDay.map((d) => (
							<ProgressBar
								key={d.date}
								label={d.date.slice(5)}
								value={d.count}
								max={Math.max(...data.lessonsByDay.map((g) => g.count), 1)}
								color="bg-blue-500"
							/>
						))}
					</div>
				</Panel>

				{/* Brain Sync & Skills */}
				<Panel title="Brain Sync & Skills">
					<div className="space-y-3">
						<div className="grid grid-cols-3 gap-2">
							<div className="rounded-lg bg-[rgba(59,130,246,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-blue-400 tabular-nums">
									{data.brainSync.total}
								</div>
								<div className="text-[10px] text-slate-500">Synced</div>
							</div>
							<div className="rounded-lg bg-[rgba(34,197,94,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-green-400 tabular-nums">
									{data.brainSync.successful}
								</div>
								<div className="text-[10px] text-slate-500">OK</div>
							</div>
							<div className="rounded-lg bg-[rgba(239,68,68,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-red-400 tabular-nums">
									{data.brainSync.failed}
								</div>
								<div className="text-[10px] text-slate-500">Failed</div>
							</div>
						</div>
						<div className="flex items-center justify-between rounded-lg bg-[rgba(13,20,34,0.6)] px-3 py-2">
							<div className="flex items-center gap-2">
								<Zap className="h-3.5 w-3.5 text-yellow-400" />
								<span className="text-xs text-slate-300">Skills Generated</span>
							</div>
							<span className="text-sm font-bold text-yellow-400 tabular-nums">{data.skills.total}</span>
						</div>
					</div>
				</Panel>

				{/* Knowledge Index */}
				<Panel title="Knowledge Index">
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-lg bg-[rgba(139,92,246,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-purple-400 tabular-nums">
									{data.hermes.memoryEntries}
								</div>
								<div className="text-[10px] text-slate-500">Hermes Entries</div>
							</div>
							<div className="rounded-lg bg-[rgba(6,182,212,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-cyan-400 tabular-nums">
									{data.featureIndex.chunks}
								</div>
								<div className="text-[10px] text-slate-500">Doc Chunks</div>
							</div>
						</div>
						<div className="flex items-center gap-2 text-xs text-slate-400">
							<Layers className="h-3.5 w-3.5 text-cyan-400" />
							{data.featureIndex.files} docs indexed · {data.hermes.memoryEntries} memory entries
						</div>
					</div>
				</Panel>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<Panel title="Learning Activity" className="lg:col-span-2">
					<div className="space-y-2">
						{data.learning.recentEvents.length === 0 && (
							<p className="text-xs text-slate-500">No learning events yet</p>
						)}
						{data.learning.recentEvents.map((event, index) => (
							<div
								key={`${event.created_at}-${index}`}
								className="flex items-center justify-between rounded-lg bg-[rgba(13,20,34,0.6)] px-3 py-2">
								<div className="min-w-0">
									<div className="text-xs text-slate-200">{event.event_type.replace(/_/g, " ")}</div>
									<div className="truncate text-[10px] text-slate-500">
										{typeof event.payload?.query === "string"
											? event.payload.query
											: typeof event.payload?.problem === "string"
												? event.payload.problem
												: "learning event"}
									</div>
								</div>
								<span className="ml-3 text-[10px] text-slate-500">
									{event.created_at.slice(11, 19)}
								</span>
							</div>
						))}
					</div>
				</Panel>

				<Panel title="Gateway Throughput">
					<div className="space-y-3">
						<ProgressBar
							label="Searches"
							value={data.learning.searches}
							max={Math.max(data.learning.searches, data.learning.stores, data.learning.scores, 1)}
							color="bg-blue-500"
						/>
						<ProgressBar
							label="Stores"
							value={data.learning.stores}
							max={Math.max(data.learning.searches, data.learning.stores, data.learning.scores, 1)}
							color="bg-green-500"
						/>
						<ProgressBar
							label="Scores"
							value={data.learning.scores}
							max={Math.max(data.learning.searches, data.learning.stores, data.learning.scores, 1)}
							color="bg-purple-500"
						/>
					</div>
				</Panel>
			</div>

			{/* ── Row 5: RAG Knowledge Base + Ollama Readiness ── */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* RAG Knowledge Base */}
				<Panel title="RAG Knowledge Base">
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-lg bg-[rgba(59,130,246,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-blue-400 tabular-nums">
									{data.rag.totalBugFixes}
								</div>
								<div className="text-[10px] text-slate-500">Bug Fixes</div>
							</div>
							<div className="rounded-lg bg-[rgba(139,92,246,0.08)] p-2 text-center">
								<div className="text-lg font-bold text-purple-400 tabular-nums">
									{data.rag.totalLessons}
								</div>
								<div className="text-[10px] text-slate-500">Lessons</div>
							</div>
						</div>
						<div className="flex items-center gap-2 text-xs text-slate-400">
							<Database className="h-3.5 w-3.5 text-blue-400" />
							{data.rag.errorTypes} error types · {data.rag.agentTypes} agent types
						</div>
						<div className="flex items-center gap-3 text-xs">
							<span className="flex items-center gap-1 text-green-400">
								<CheckCircle className="h-3 w-3" />
								{data.rag.testsPassed} passed
							</span>
							<span className="flex items-center gap-1 text-red-400">
								<XCircle className="h-3 w-3" />
								{data.rag.testsFailed} failed
							</span>
							<span className="flex items-center gap-1 text-slate-500">
								<AlertTriangle className="h-3 w-3" />
								{data.rag.untested} untested
							</span>
						</div>
					</div>
				</Panel>

				{/* Ollama Readiness */}
				<Panel title="Ollama Readiness">
					{data.ollama ? (
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<span className="text-xs text-slate-400">Score</span>
								<span className="text-lg font-bold text-white tabular-nums">
									{data.ollama.readiness.total_score}
								</span>
							</div>
							<ProgressBar
								label="Readiness"
								value={data.ollama.readiness.total_score}
								max={100}
								color={
									data.ollama.readiness.total_score >= 80
										? "bg-green-500"
										: data.ollama.readiness.total_score >= 50
											? "bg-yellow-500"
											: "bg-red-500"
								}
							/>
							<div className="flex items-center gap-2 text-xs">
								<span className="rounded-full border border-[rgba(82,120,190,0.2)] bg-[rgba(40,110,255,0.08)] px-2 py-0.5 text-slate-300">
									{data.ollama.readiness.level}
								</span>
								<span className="text-slate-500">{data.ollama.readiness.check_count} checks</span>
							</div>
							<p className="text-[10px] text-slate-500 italic">{data.ollama.readiness.recommendation}</p>
						</div>
					) : (
						<p className="text-xs text-slate-500">Ollama not configured or no data yet</p>
					)}
				</Panel>

				{/* Ollama Growth Events */}
				<Panel title="Ollama Growth">
					{data.ollama ? (
						<div className="space-y-3">
							<div className="text-2xl font-bold text-white tabular-nums">
								{data.ollama.growth.event_count}
							</div>
							<div className="text-[10px] text-slate-500">total growth events</div>
							<div className="flex flex-wrap gap-1.5">
								{Object.entries(data.ollama.growth.event_types).length === 0 && (
									<p className="text-xs text-slate-500">No events recorded</p>
								)}
								{Object.entries(data.ollama.growth.event_types)
									.slice(0, 8)
									.map(([type, count]) => (
										<TagBadge key={type} tag={type.replace(/_/g, " ")} count={count} />
									))}
							</div>
							{data.ollama.timeline.length > 0 && (
								<div className="space-y-1">
									<div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
										Score Timeline
									</div>
									{data.ollama.timeline.slice(-5).map((t, i) => (
										<ProgressBar
											key={i}
											label={t.date ? t.date.slice(5, 10) : "N/A"}
											value={t.score}
											max={100}
											color="bg-cyan-500"
										/>
									))}
								</div>
							)}
						</div>
					) : (
						<p className="text-xs text-slate-500">No growth data yet</p>
					)}
				</Panel>
			</div>

			{/* ── Summary Footer ── */}
			<div className="rounded-xl border border-[rgba(82,120,190,0.15)] bg-[rgba(13,20,34,0.4)] px-5 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
					<span className="flex items-center gap-1.5">
						<Database className="h-3.5 w-3.5 text-blue-400" />
						{data.lessons.total} lessons · {data.bugs.total} bug fixes · {data.healing.totalIncidents}{" "}
						incidents
					</span>
					<span className="flex items-center gap-1.5">
						<GitCommit className="h-3.5 w-3.5 text-green-400" />
						{data.commits.total} commits · {data.deploys.total} deploys
					</span>
					<span className="flex items-center gap-1.5">
						<BrainCircuit className="h-3.5 w-3.5 text-purple-400" />
						{data.modelDecisions.total} model decisions · {data.hermes.memoryEntries} hermes entries
					</span>
					<span className="flex items-center gap-1.5">
						<Zap className="h-3.5 w-3.5 text-yellow-400" />
						{data.skills.total} skills · {data.featureIndex.chunks} doc chunks indexed
					</span>
					<span className="flex items-center gap-1.5">
						<Server className="h-3.5 w-3.5 text-cyan-400" />
						{data.features.total} features tracked
					</span>
				</div>
			</div>
		</div>
	)
}
