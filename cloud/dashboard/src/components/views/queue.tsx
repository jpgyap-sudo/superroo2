"use client"

import { useEffect, useState } from "react"
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

/* ─── Mock Data ─── */

const MOCK_JOBS: QueueJob[] = [
	{
		id: "#J-7821",
		title: "Fix Telegram Auth Bug",
		agent: "Debugger Agent",
		project: "superroo2",
		status: "Running",
		priority: "High",
		progress: 65,
		retries: "2/5",
		started: "11:30 AM",
		eta: "3m 12s",
	},
	{
		id: "#J-7820",
		title: "Deploy API to VPS",
		agent: "Deploy Agent",
		project: "superroo2",
		status: "Running",
		priority: "High",
		progress: 40,
		retries: "1/5",
		started: "11:31 AM",
		eta: "2m 45s",
	},
	{
		id: "#J-7819",
		title: "Run E2E Tests",
		agent: "Tester Agent",
		project: "superroo2",
		status: "Completed",
		priority: "Medium",
		progress: 100,
		retries: "0/5",
		started: "11:25 AM",
		eta: "—",
	},
	{
		id: "#J-7818",
		title: "Generate OpenAPI Spec",
		agent: "Coder Agent",
		project: "superroo2",
		status: "Completed",
		priority: "Low",
		progress: 100,
		retries: "0/3",
		started: "11:21 AM",
		eta: "—",
	},
	{
		id: "#J-7817",
		title: "Database Migration",
		agent: "Deploy Agent",
		project: "superroo2",
		status: "Failed",
		priority: "High",
		progress: 100,
		retries: "3/3",
		started: "11:10 AM",
		eta: "—",
	},
]

const MOCK_AGENTS: AgentUsage[] = [
	{ agent: "Planner Agent", model: "GPT-5", status: "Running", costToday: "$0.04", tokens: "5.1k", utilization: 68 },
	{
		agent: "Coder Agent",
		model: "Claude 3.5 Sonnet",
		status: "Active",
		costToday: "$0.32",
		tokens: "42.3k",
		utilization: 72,
	},
	{
		agent: "Debugger Agent",
		model: "DeepSeek R1",
		status: "Active",
		costToday: "$0.01",
		tokens: "8.9k",
		utilization: 54,
	},
	{
		agent: "Tester Agent",
		model: "Claude 3.5 Sonnet",
		status: "Active",
		costToday: "$0.07",
		tokens: "11.0k",
		utilization: 47,
	},
	{ agent: "Deploy Agent", model: "GPT-4o", status: "Idle", costToday: "$0.02", tokens: "2.1k", utilization: 12 },
]

const MOCK_ACTIVITY: ActivityItem[] = [
	{ time: "11:42:02", agent: "Debugger Agent", message: "Retrying deployment (attempt 2/5)", type: "debug" },
	{ time: "11:42:11", agent: "Crawler Agent", message: "Fetching GitHub issues #231", type: "crawl" },
	{ time: "11:42:19", agent: "Tester Agent", message: "Running Playwright suite", type: "test" },
	{ time: "11:42:22", agent: "Deploy Agent", message: "Validating VPS container", type: "deploy" },
	{ time: "11:42:25", agent: "Planner Agent", message: "Analyzing codebase changes", type: "plan" },
	{ time: "11:42:30", agent: "Coder Agent", message: "Generating API types", type: "code" },
]

const MOCK_PIPELINE: PipelineStage[] = [
	{ name: "Planning Agent", count: "12 active", avg: "avg 2.1s" },
	{ name: "Coder Agent", count: "8 active", avg: "avg 4.3s" },
	{ name: "Tester Agent", count: "6 active", avg: "avg 6.2s" },
	{ name: "Debugger Agent", count: "3 active", avg: "avg 8.7s" },
	{ name: "Deploy Agent", count: "2 active", avg: "avg 3.9s" },
	{ name: "Verification Agent", count: "1 active", avg: "avg 2.0s" },
]

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
	const [stats, setStats] = useState({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const token = localStorage.getItem("superroo_auth_token")
				const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
				const res = await fetch("/api/queue/stats", { headers })
				if (res.ok) {
					const data = await res.json()
					setStats({
						waiting: data.waiting ?? 0,
						active: data.active ?? 0,
						completed: data.completed ?? 0,
						failed: data.failed ?? 0,
						delayed: data.delayed ?? 0,
					})
				}
			} catch (err) {
				console.error("Error fetching queue stats:", err)
			}
		}
		fetchStats()
		const iv = setInterval(fetchStats, 3000)
		return () => clearInterval(iv)
	}, [])

	const statCards = [
		{
			label: "Waiting",
			value: stats.waiting || 8,
			delta: "↑ 3 from last hour",
			icon: Gauge,
			tone: "text-amber-400",
			bg: "bg-amber-500/10",
		},
		{
			label: "Active",
			value: stats.active || 12,
			delta: "↑ 5 from last hour",
			icon: Activity,
			tone: "text-blue-400",
			bg: "bg-blue-500/10",
		},
		{
			label: "Completed",
			value: stats.completed || 128,
			delta: "↑ 15 from last hour",
			icon: CheckCircle2,
			tone: "text-emerald-400",
			bg: "bg-emerald-500/10",
		},
		{
			label: "Failed",
			value: stats.failed || 5,
			delta: "↓ 2 from last hour",
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
					onClick={() => setPaused(!paused)}
					className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">
					<Play size={14} /> Resume Queue
				</button>
				<button
					onClick={() => setPaused(!paused)}
					className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20">
					<Pause size={14} /> Pause Queue
				</button>
				<button className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20">
					<Square size={14} /> Stop All
				</button>
				<button className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20">
					<RotateCcw size={14} /> Retry Failed
				</button>
				<button className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20">
					<Trash2 size={14} /> Clear Completed
				</button>
				<button className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-500/20">
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
							{MOCK_PIPELINE.map((step, index) => (
								<div key={step.name} className="flex items-center">
									<div className="flex items-center gap-2.5 rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2">
										<AgentIcon index={index} />
										<div>
											<p className="text-xs font-medium text-slate-200">{step.name}</p>
											<p className="text-[11px] text-slate-400">{step.count}</p>
											<p className="text-[10px] text-slate-500">{step.avg}</p>
										</div>
									</div>
									{index < MOCK_PIPELINE.length - 1 && (
										<div className="mx-1 h-px w-4 bg-slate-600/40" />
									)}
								</div>
							))}
						</div>
						<div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
							12 workflows in progress
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
									{MOCK_JOBS.map((job) => (
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
									))}
								</tbody>
							</table>
						</div>
						<p className="mt-3 text-[11px] text-slate-500">Showing 1 to 5 of 25 jobs</p>
					</Card>

					{/* Bottom Grid: AI Model Usage + Retry Intelligence + Autonomous Loop */}
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-100">
								AI Model Usage
							</h3>
							<div className="space-y-2">
								{MOCK_AGENTS.map((a) => (
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
								))}
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
							{MOCK_ACTIVITY.map((item) => (
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
							))}
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
