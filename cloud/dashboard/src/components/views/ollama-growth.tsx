"use client"

import { useEffect, useState } from "react"
import {
	BrainCircuit,
	TrendingUp,
	Activity,
	CheckCircle,
	AlertTriangle,
	Sparkles,
	Clock,
	BarChart3,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type GrowthEvent = {
	id: string
	created_at: string
	event_type: string
	task: string
	quality_score: number
}

type ReadinessCheck = {
	id: string
	created_at: string
	architecture_understanding: number
	memory_retrieval: number
	lesson_summarization: number
	compliance_checking: number
	patch_suggestion: number
	test_awareness: number
	safety: number
	total_score: number
	level: string
}

type OllamaGrowthData = {
	readiness: {
		total_score: number
		level: string
		recommendation: string
		avg_score: number
		check_count: number
		latest_check: ReadinessCheck | null
	}
	growth: {
		event_count: number
		event_types: Record<string, number>
		events: GrowthEvent[]
	}
	timeline: { date: string; score: number; level: string }[]
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Panel({
	title,
	children,
	icon: Icon,
	className = "",
}: {
	title: string
	children: React.ReactNode
	icon?: React.ComponentType<{ className?: string }>
	className?: string
}) {
	return (
		<section
			className={`rounded-xl border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_30px_rgba(40,110,255,0.08)] ${className}`}>
			<div className="mb-4 flex items-center gap-2">
				{Icon && <Icon className="h-4 w-4 text-violet-400" />}
				<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">{title}</h3>
			</div>
			{children}
		</section>
	)
}

function ScoreGauge({ score, level }: { score: number; level: string }) {
	const pct = Math.min(100, Math.max(0, score))
	let color = "text-rose-400"
	let barColor = "#f43f5e"
	if (score > 40) {
		color = "text-amber-400"
		barColor = "#f59e0b"
	}
	if (score > 60) {
		color = "text-sky-400"
		barColor = "#38bdf8"
	}
	if (score > 75) {
		color = "text-violet-400"
		barColor = "#a78bfa"
	}
	if (score > 85) {
		color = "text-emerald-400"
		barColor = "#34d399"
	}

	return (
		<div className="flex flex-col items-center gap-3 py-2">
			<div className="relative h-32 w-32">
				<svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
					<circle cx="60" cy="60" r="50" fill="none" stroke="#1e293b" strokeWidth="10" />
					<circle
						cx="60"
						cy="60"
						r="50"
						fill="none"
						stroke={barColor}
						strokeWidth="10"
						strokeLinecap="round"
						strokeDasharray={`${pct * 3.14} 314`}
						className="transition-all duration-1000"
					/>
				</svg>
				<div className="absolute inset-0 flex flex-col items-center justify-center">
					<span className={`text-3xl font-bold ${color}`}>{score}</span>
					<span className="text-[10px] text-slate-500">/ 100</span>
				</div>
			</div>
			<div className="rounded-full bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-300">{level}</div>
		</div>
	)
}

function LevelBadge({ level }: { level: string }) {
	const colors: Record<string, string> = {
		"Summarizer only": "bg-rose-500/15 text-rose-300 border-rose-500/25",
		"Memory assistant": "bg-amber-500/15 text-amber-300 border-amber-500/25",
		"Patch suggester": "bg-sky-500/15 text-sky-300 border-sky-500/25",
		"Junior coder": "bg-violet-500/15 text-violet-300 border-violet-500/25",
		"Main coder candidate": "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
	}
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[level] || "bg-slate-500/15 text-slate-300 border-slate-500/25"}`}>
			{level}
		</span>
	)
}

function EventRow({ event }: { event: GrowthEvent }) {
	const typeColors: Record<string, string> = {
		compliance: "text-emerald-400",
		summary: "text-sky-400",
		coding: "text-violet-400",
		patch: "text-amber-400",
		review: "text-pink-400",
	}
	return (
		<div className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-950/30 px-3 py-2">
			<div className="flex items-center gap-3 min-w-0">
				<div
					className={`text-xs font-medium uppercase tracking-wide ${typeColors[event.event_type] || "text-slate-400"}`}>
					{event.event_type}
				</div>
				<div className="truncate text-sm text-slate-200">{event.task}</div>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				<div className="flex items-center gap-1">
					<Sparkles className="h-3 w-3 text-amber-400" />
					<span className="text-xs text-slate-400">{event.quality_score}/5</span>
				</div>
				<span className="text-[10px] text-slate-600">{new Date(event.created_at).toLocaleDateString()}</span>
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function OllamaGrowthView() {
	const [data, setData] = useState<OllamaGrowthData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState("")

	useEffect(() => {
		fetch("/api/ollama-growth")
			.then((r) => r.json())
			.then((json) => {
				if (json.success) {
					setData(json)
				} else {
					setError(json.error || "Failed to load data")
				}
				setLoading(false)
			})
			.catch((e) => {
				setError(e.message)
				setLoading(false)
			})
	}, [])

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
			</div>
		)
	}

	if (error || !data) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
				<AlertTriangle className="h-8 w-8 text-amber-400" />
				<p>{error || "No data available"}</p>
			</div>
		)
	}

	const { readiness, growth, timeline } = data
	const latest = readiness.latest_check

	const breakdown = latest
		? [
				{ name: "Architecture", value: latest.architecture_understanding, fill: "#f43f5e" },
				{ name: "Memory", value: latest.memory_retrieval, fill: "#f59e0b" },
				{ name: "Summaries", value: latest.lesson_summarization, fill: "#38bdf8" },
				{ name: "Compliance", value: latest.compliance_checking, fill: "#a78bfa" },
				{ name: "Patches", value: latest.patch_suggestion, fill: "#34d399" },
				{ name: "Tests", value: latest.test_awareness, fill: "#fb7185" },
				{ name: "Safety", value: latest.safety, fill: "#818cf8" },
			]
		: []

	const chartData = timeline.map((t) => ({
		...t,
		shortDate: new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
	}))

	return (
		<div className="space-y-4">
			{/* Top row: Score + Recommendation + Stats */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Panel title="Readiness Score" icon={BrainCircuit} className="sm:col-span-1">
					<ScoreGauge score={readiness.total_score} level={readiness.level} />
				</Panel>

				<Panel title="Recommendation" icon={Sparkles} className="sm:col-span-1 lg:col-span-2">
					<div className="flex h-full flex-col justify-center gap-3">
						<p className="text-sm leading-relaxed text-slate-300">
							{readiness.recommendation || "No recommendation available."}
						</p>
						<div className="flex flex-wrap gap-2">
							<LevelBadge level={readiness.level} />
							<span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 px-2.5 py-0.5 text-xs text-slate-400">
								<CheckCircle className="h-3 w-3 text-emerald-400" />
								{readiness.check_count} checks
							</span>
							<span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 px-2.5 py-0.5 text-xs text-slate-400">
								<TrendingUp className="h-3 w-3 text-sky-400" />
								Avg {readiness.avg_score}
							</span>
						</div>
					</div>
				</Panel>

				<Panel title="Growth Stats" icon={Activity}>
					<div className="space-y-3">
						<div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
							<p className="text-xs text-slate-400">Total Events</p>
							<p className="mt-1 text-2xl font-semibold text-slate-100">{growth.event_count}</p>
						</div>
						<div className="flex flex-wrap gap-1">
							{Object.entries(growth.event_types).map(([type, count]) => (
								<span
									key={type}
									className="rounded-md bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
									{type}: {count}
								</span>
							))}
						</div>
					</div>
				</Panel>
			</div>

			{/* Middle row: Timeline + Breakdown */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Panel title="Score Timeline" icon={TrendingUp}>
					<div className="h-64 w-full">
						{chartData.length > 0 ? (
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
									<defs>
										<linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
											<stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
									<XAxis
										dataKey="shortDate"
										tick={{ fill: "#64748b", fontSize: 10 }}
										axisLine={{ stroke: "#334155" }}
									/>
									<YAxis
										domain={[0, 100]}
										tick={{ fill: "#64748b", fontSize: 10 }}
										axisLine={{ stroke: "#334155" }}
									/>
									<Tooltip
										contentStyle={{
											background: "#0f172a",
											border: "1px solid #334155",
											borderRadius: "8px",
											fontSize: "12px",
										}}
										labelStyle={{ color: "#94a3b8" }}
									/>
									<Area
										type="monotone"
										dataKey="score"
										stroke="#8b5cf6"
										strokeWidth={2}
										fill="url(#scoreGradient)"
									/>
								</AreaChart>
							</ResponsiveContainer>
						) : (
							<div className="flex h-full items-center justify-center text-xs text-slate-500">
								No timeline data yet
							</div>
						)}
					</div>
				</Panel>

				<Panel title="Score Breakdown" icon={BarChart3}>
					<div className="h-64 w-full">
						{breakdown.length > 0 ? (
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={breakdown}
									layout="vertical"
									margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
									<XAxis
										type="number"
										domain={[0, 20]}
										tick={{ fill: "#64748b", fontSize: 10 }}
										axisLine={{ stroke: "#334155" }}
									/>
									<YAxis
										dataKey="name"
										type="category"
										tick={{ fill: "#94a3b8", fontSize: 10 }}
										axisLine={{ stroke: "#334155" }}
										width={80}
									/>
									<Tooltip
										contentStyle={{
											background: "#0f172a",
											border: "1px solid #334155",
											borderRadius: "8px",
											fontSize: "12px",
										}}
										labelStyle={{ color: "#94a3b8" }}
									/>
									<Bar dataKey="value" radius={[0, 4, 4, 0]} />
								</BarChart>
							</ResponsiveContainer>
						) : (
							<div className="flex h-full items-center justify-center text-xs text-slate-500">
								No breakdown data available
							</div>
						)}
					</div>
				</Panel>
			</div>

			{/* Bottom row: Recent Events */}
			<Panel title="Recent Growth Events" icon={Clock}>
				<div className="space-y-2">
					{growth.events.length > 0 ? (
						growth.events.map((ev) => <EventRow key={ev.id} event={ev} />)
					) : (
						<div className="py-8 text-center text-xs text-slate-500">
							No growth events recorded yet. Run a compliance check to seed data.
						</div>
					)}
				</div>
			</Panel>
		</div>
	)
}
