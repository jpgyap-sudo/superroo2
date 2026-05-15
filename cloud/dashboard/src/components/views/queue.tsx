"use client"

import { useEffect, useState, useCallback } from "react"
import {
	Activity,
	AlertTriangle,
	Bot,
	Brain,
	CheckCircle2,
	ChevronDown,
	Code2,
	FlaskConical,
	Gauge,
	ListFilter,
	Pause,
	Play,
	Rocket,
	RotateCcw,
	Square,
	Terminal,
	Trash2,
	Zap,
	Bug,
	ShieldCheck,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/* ─── Types ─── */

type Priority = "Low" | "Medium" | "High" | "Critical"

interface QueueJob {
	id: string
	title: string
	agent: string
	project: string
	status: "Running" | "Completed" | "Failed" | "Waiting"
	priority: Priority
	progress: number
	retries: string
	started: string
	eta: string
}

interface AgentUsage {
	agent: string
	model: string
	status: string
	costToday: string
	tokens: string
	utilization: number
}

interface ActivityItem {
	time: string
	agent: string
	message: string
	type: "debug" | "crawl" | "test" | "deploy" | "plan" | "code"
}

interface PipelineStage {
	name: string
	count: string
	avg: string
}

/* ─── Sub-components ─── */

function StatusPill({
	children,
	tone = "green",
}: {
	children: React.ReactNode
	tone?: "green" | "blue" | "red" | "yellow" | "purple" | "gray"
}) {
	const map: Record<string, string> = {
		green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
		blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
		red: "border-red-500/30 bg-red-500/10 text-red-300",
		yellow: "border-amber-500/30 bg-amber-500/10 text-amber-300",
		purple: "border-purple-500/30 bg-purple-500/10 text-purple-300",
		gray: "border-slate-500/30 bg-slate-500/10 text-slate-300",
	}
	return (
		<span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium leading-tight ${map[tone]}`}>
			{children}
		</span>
	)
}

function Progress({ value }: { value: number }) {
	return (
		<div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-700/50">
			<span
				className="block h-full rounded-full bg-blue-400 transition-all duration-500"
				style={{ width: `${value}%` }}
			/>
		</div>
	)
}

function AgentIcon({ index }: { index: number }) {
	const icons = [Brain, Code2, FlaskConical, Bug, Rocket, ShieldCheck]
	const Icon = icons[index] || Bot
	return <Icon size={18} className="text-slate-300" />
}

/* ─── Main Component ─── */

export function QueueView() {
	const [paused, setPaused] = useState(false)
	const [loading, setLoading] = useState(true)
	const [stats, setStats] = useState({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })
	const [jobs, setJobs] = useState<QueueJob[]>([])
	const [agents, setAgents] = useState<AgentUsage[]>([])
	const [activity, setActivity] = useState<ActivityItem[]>([])
	const [pipeline, setPipeline] = useState<PipelineStage[]>([])

	const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
		console.log(`[Toast] ${type}: ${message}`)
	}, [])

	useEffect(() => {
		const fetchAll = async () => {
			try {
				const [statsRes, jobsRes, agentsRes, activityRes, pipelineRes] = await Promise.all([
					fetch("/api/queue/stats"),
					fetch("/api/jobs?limit=20"),
					fetch("/api/agents"),
					fetch("/api/activity?limit=10"),
					fetch("/api/queue/pipeline"),
				])

				if (statsRes.ok) {
					const data = await statsRes.json()
					setStats({
						waiting: data.waiting ?? 0,
						active: data.active ?? 0,
						completed: data.completed ?? 0,
						failed: data.failed ?? 0,
						delayed: data.delayed ?? 0,
					})
				}
				if (jobsRes.ok) {
					const data = await jobsRes.json()
					setJobs(Array.isArray(data) ? data : data.jobs ?? [])
				}
				if (agentsRes.ok) {
					const data = await agentsRes.json()
					setAgents(Array.isArray(data) ? data : data.agents ?? [])
				}
				if (activityRes.ok) {
					const data = await activityRes.json()
					setActivity(Array.isArray(data) ? data : data.activity ?? [])
				}
				if (pipelineRes.ok) {
					const data = await pipelineRes.json()
					setPipeline(Array.isArray(data) ? data : data.stages ?? [])
				}
			} catch (err) {
				console.error("Error fetching queue data:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchAll()
		const iv = setInterval(fetchAll, 5000)
		return () => clearInterval(iv)
	}, [])

	const statCards = [
		{
			label: "Waiting",
			value: stats.waiting,
			delta: "from queue",
			icon: Gauge,
			tone: "text-amber-400",
			bg: "bg-amber-500/10",
		},
		{
			label: "Active",
			value: stats.active,
			delta: "currently running",
			icon: Activity,
			tone: "text-blue-400",
			bg: "bg-blue-500/10",
		},
		{
			label: "Completed",
			value: stats.completed,
			delta: "total completed",
			icon: CheckCircle2,
			tone: "text-emerald-400",
			bg: "bg-emerald-500/10",
		},
		{
			label: "Failed",
			value: stats.failed,
			delta: "total failed",
			icon: AlertTriangle,
			tone: "text-red-400",
			bg: "bg-red-500/10",
		},
	]

	const failureReasons = [
		["Docker container timeout", 42],
		["Playwright test failures", 28],
		["API rate limit", 16],
		["Invalid SSH key", 8],
		["Other", 6],
	]

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-xs text-slate-400">Loading queue data...</div>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* ── Header ── */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-slate-100">Queue</h1>
					<p className="text-xs text-slate-400">
						Monitor and manage all background jobs and AI agent workflows
					</p>
				</div>
				<Badge status={paused ? "warning" : "online"} label={paused ? "PAUSED" : "RUNNING"} />
			</div>

			{/* ── Action Buttons ── */}
			<div className="flex flex-wrap items-center gap-2">
				<button
					onClick={() => { setPaused(!paused); showToast(paused ? "Queue resumed" : "Queue paused", "info") }}
					className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">
					<Play size={14} /> Resume Queue
				</button>
				<button
					onClick={() => { setPaused(!paused); showToast(paused ? "Queue resumed" : "Queue paused", "info") }}
					className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20">
					<Pause size={14} /> Pause Queue
				</button>
				<button onClick={() => showToast("Stop All: not yet implemented", "info")} className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20">
					<Square size={14} /> Stop All
				</button>
				<button onClick={() => showToast("Retry Failed: not yet implemented", "info")} className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20">
					<RotateCcw size={14} /> Retry Failed
				</button>
				<button onClick={() => showToast("Clear Completed: not yet implemented", "info")} className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20">
					<Trash2 size={14} /> Clear Completed
				</button>
				<button onClick={() => showToast("Priority Boost: not yet implemented", "info")} className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-500/20">
					<Zap size={14} /> Priority Boost
				</button>
				<button className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/50">
					More <ChevronDown size={14} />
				</button>
			</div>

			{/* ── Main Grid ── */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
				{/* ── Left Column (3/4) ── */}
				<div className="space-y-4 lg:col-span-3">
					{/* Stats Cards */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{statCards.map((s) => (
							<Card
								key={s.label}
								className="flex items-center justify-between border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
								<div>
									<p className="text-[11px] uppercase tracking-widest text-gray-500">{s.label}</p>
									<p className={`mt-1 text-2xl font-bold ${s.tone}`}>{s.value}</p>
									<p className="mt-0.5 text-[11px] text-gray-600">{s.delta}</p>
								</div>
								<div className={`rounded-lg p-2.5 ${s.bg}`}>
									<s.icon size={22} className={s.tone} />
								</div>
							</Card>
						))}
					</div>

					{/* AI Workflow Pipeline */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-4 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
									AI Workflow Pipeline
								</h3>
								<StatusPill tone="green">Live</StatusPill>
							</div>
							<button className="text-[11px] text-slate-400 hover:text-slate-200">View as DAG</button>
						</div>
						<div className="flex flex-wrap items-center gap-0">
							{pipeline.map((step, index) => (
								<div key={step.name} className="flex items-center">
									<div className="flex items-center gap-2.5 rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2">
										<AgentIcon index={index} />
										<div>
											<p className="text-xs font-medium text-slate-200">{step.name}</p>
											<p className="text-[11px] text-slate-400">{step.count}</p>
											<p className="text-[10px] text-slate-500">{step.avg}</p>
										</div>
									</div>
									{index < pipeline.length - 1 && (
										<div className="mx-1 h-px w-4 bg-slate-600/40" />
									)}
								</div>
							))}
						</div>
						<div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
							{pipeline.length > 0 ? `${pipeline.length} stages active` : "No pipeline data"}
						</div>
					</Card>

					{/* Job Queue Table */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">Job Queue</h3>
							<div className="flex flex-wrap items-center gap-1.5">
								<button className="rounded border border-slate-600/40 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
									All Status <ChevronDown size={12} className="inline" />
								</button>
								<button className="rounded border border-slate-600/40 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
									All Agents <ChevronDown size={12} className="inline" />
								</button>
								<button className="rounded border border-slate-600/40 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
									All Projects <ChevronDown size={12} className="inline" />
								</button>
								<button className="rounded border border-slate-600/40 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
									All Priority <ChevronDown size={12} className="inline" />
								</button>
								<button className="rounded border border-slate-600/40 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
									<ListFilter size={12} className="inline" /> Columns
								</button>
							</div>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="text-slate-500">
										<th className="pb-2 pr-3 font-medium">Job</th>
										<th className="pb-2 pr-3 font-medium">Agent</th>
										<th className="pb-2 pr-3 font-medium">Project</th>
										<th className="pb-2 pr-3 font-medium">Status</th>
										<th className="pb-2 pr-3 font-medium">Priority</th>
										<th className="pb-2 pr-3 font-medium">Retries</th>
										<th className="pb-2 pr-3 font-medium">Started</th>
										<th className="pb-2 pr-3 font-medium">ETA</th>
										<th className="pb-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{jobs.length === 0 ? (
										<tr>
											<td colSpan={9} className="py-8 text-center text-xs text-slate-500">
												No jobs in queue
											</td>
										</tr>
									) : (
										jobs.map((job) => (
											<tr key={job.id} className="border-t border-[#1e2535]">
												<td className="py-2.5 pr-3">
													<p className="font-medium text-slate-200">{job.title}</p>
													<p className="text-[11px] text-slate-500">{job.id}</p>
												</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.agent}</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.project}</td>
												<td className="py-2.5 pr-3">
													<StatusPill
														tone={
															job.status === "Failed"
																? "red"
																: job.status === "Completed"
																	? "green"
																	: "blue"
														}>
														{job.status}
													</StatusPill>
													{job.status === "Running" && <Progress value={job.progress} />}
												</td>
												<td className="py-2.5 pr-3">
													<StatusPill
														tone={
															job.priority === "High"
																? "red"
																: job.priority === "Medium"
																	? "yellow"
																	: "blue"
														}>
														{job.priority}
													</StatusPill>
												</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.retries}</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.started}</td>
												<td className="py-2.5 pr-3 text-slate-300">{job.eta}</td>
												<td className="py-2.5">
													<div className="flex items-center gap-1">
														<button className="rounded p-1 text-slate-500 hover:bg-slate-700/50 hover:text-slate-200">
															<Terminal size={13} />
														</button>
														<button className="rounded p-1 text-slate-500 hover:bg-slate-700/50 hover:text-slate-200">
															<RotateCcw size={13} />
														</button>
													</div>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
						<p className="mt-3 text-[11px] text-slate-500">Showing {jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
					</Card>

					{/* Bottom Grid: AI Model Usage + Retry Intelligence + Autonomous Loop */}
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
								AI Model Usage
							</h3>
							<div className="space-y-2">
								{agents.length === 0 ? (
									<p className="text-xs text-slate-500">No agent data available</p>
								) : (
									agents.map((a) => (
										<div
											key={a.agent}
											className="flex items-center gap-2 rounded border border-slate-700/30 bg-slate-800/20 px-2.5 py-1.5">
											<div className="min-w-0 flex-1">
												<p className="text-xs font-medium text-slate-200">{a.agent}</p>
												<p className="text-[10px] text-slate-500">{a.model}</p>
											</div>
											<StatusPill tone={a.status === "Idle" ? "gray" : "green"}>
												{a.status}
											</StatusPill>
											<span className="text-[11px] text-slate-400">{a.costToday}</span>
											<span className="text-[11px] text-slate-400">{a.tokens}</span>
											<div className="w-16">
												<div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/50">
													<span
														className="block h-full rounded-full bg-emerald-400 transition-all"
														style={{ width: `${a.utilization}%` }}
													/>
												</div>
											</div>
										</div>
									))
								)}
							</div>
						</Card>

						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
								Retry Intelligence
							</h3>
							<div className="space-y-2">
								{[
									"Exponential backoff",
									"Switch AI model after 3 failures",
									"Switch VPS region after 2 failures",
									"Fallback to safe mode",
									"Notify on Telegram",
								].map((x) => (
									<p key={x} className="flex items-center gap-2 text-xs text-slate-300">
										<CheckCircle2 size={14} className="text-emerald-400" /> {x}
									</p>
								))}
							</div>
						</Card>

						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
								Autonomous Loop Controls
							</h3>
							<div className="space-y-2">
								{[
									"Max Retries 5",
									"Auto-Redeploy",
									"Auto-Test After Deploy",
									"Rollback On Failure",
									"Human Approval on Prod",
								].map((x, i) => (
									<p key={x} className="flex items-center justify-between text-xs text-slate-300">
										<span>{x}</span>
										<span
											className={`inline-block h-4 w-7 rounded-full transition-colors ${i < 4 ? "bg-emerald-500" : "bg-slate-600"}`}>
											<span
												className={`block h-4 w-4 rounded-full bg-white transition-transform ${i < 4 ? "translate-x-3" : "translate-x-0.5"}`}
											/>
										</span>
									</p>
								))}
							</div>
							<button className="mt-3 w-full rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20">
								Save Changes
							</button>
						</Card>
					</div>

					{/* Terminal / Logs */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Terminal / Logs
							</h3>
							<span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
								<span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
							</span>
						</div>
						<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
							<pre className="overflow-x-auto rounded bg-slate-950/60 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
								{`11:41:56 ▶ Pulling latest code...
11:41:58 ▶ Running pnpm install
11:42:01 ▶ Running pnpm build
11:42:08 ✖ Build failed: Type error in auth.ts:42`}
							</pre>
							<pre className="overflow-x-auto rounded bg-slate-950/60 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
								{`11:42:12 ▶ Analyzing error...
11:42:16 ▶ Applying fix...
11:42:20 ▶ Rebuilding...
11:42:24 ▶ Build successful
11:42:25 ▶ Retrying deployment...`}
							</pre>
						</div>
					</Card>
				</div>

				{/* ── Right Column (1/4) ── */}
				<div className="space-y-4">
					{/* Live Activity Feed */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Live Activity Feed
							</h3>
							<button className="text-[11px] text-blue-400 hover:text-blue-300">See all</button>
						</div>
						<div className="space-y-2">
							{activity.length === 0 ? (
								<p className="text-xs text-slate-500">No recent activity</p>
							) : (
								activity.map((item) => (
									<div
										key={item.time}
										className="flex items-start gap-2 rounded border border-slate-700/20 bg-slate-800/10 px-2.5 py-2">
										<span className="mt-0.5 shrink-0 text-[10px] text-slate-500">{item.time}</span>
										<Bot size={14} className="mt-0.5 shrink-0 text-slate-400" />
										<div className="min-w-0">
											<p className="text-xs font-medium text-slate-200">{item.agent}</p>
											<p className="text-[11px] text-slate-400">{item.message}</p>
										</div>
									</div>
								))
							)}
						</div>
					</Card>

					{/* Queue Insights */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Queue Insights
							</h3>
							<button className="text-[11px] text-slate-400 hover:text-slate-200">Last 24h</button>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Avg. Completion Time</p>
								<p className="text-sm font-semibold text-slate-100">4m32s</p>
								<p className="text-[10px] text-emerald-400">↓ 12%</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Throughput</p>
								<p className="text-sm font-semibold text-slate-100">18.7</p>
								<p className="text-[10px] text-emerald-400">jobs/min ↑ 8%</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">AI Cost Today</p>
								<p className="text-sm font-semibold text-red-400">$2.48</p>
								<p className="text-[10px] text-red-400">↑ 15%</p>
							</div>
							<div className="rounded border border-slate-700/30 bg-slate-800/20 p-2.5">
								<p className="text-[10px] text-slate-500">Token Usage Today</p>
								<p className="text-sm font-semibold text-purple-400">1.24M</p>
								<p className="text-[10px] text-purple-400">↑ 23%</p>
							</div>
						</div>
					</Card>

					{/* Top Failure Reasons */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								Top Failure Reasons
							</h3>
							<button className="text-[11px] text-blue-400 hover:text-blue-300">View all</button>
						</div>
						<div className="space-y-2">
							{failureReasons.map(([name, value]) => (
								<div key={String(name)} className="flex items-center gap-2">
									<span className="w-32 shrink-0 text-xs text-slate-300">{String(name)}</span>
									<div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700/50">
										<span
											className="block h-full rounded-full bg-red-500/70"
											style={{ width: `${value}%` }}
										/>
									</div>
									<span className="w-8 text-right text-[11px] text-slate-400">{value}%</span>
								</div>
							))}
						</div>
					</Card>

					{/* AI Recommendation */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Brain size={18} className="text-purple-400" />
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">
								AI Recommendation
							</h3>
						</div>
						<p className="mb-3 text-xs leading-relaxed text-slate-300">
							Most failures are due to container timeouts. Increase container memory to 2GB.
						</p>
						<button className="w-full rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20">
							Apply Recommendation
						</button>
					</Card>
				</div>
			</div>
		</div>
	)
}
