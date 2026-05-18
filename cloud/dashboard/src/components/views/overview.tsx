"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Bot, CheckCircle2, Rocket, Zap, Brain, Bug, Code2, Database, ShieldAlert } from "lucide-react"
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SystemMetrics = { cpu: number; ram: number; disk: number }
type JobStats = {
	waiting: number
	active: number
	completed: number
	failed: number
	total: number
}
type Health = { status: string; redis: boolean; worker: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LucideIcon = React.ComponentType<any>

interface ActivityItem {
	time: string
	agent: string
	text: string
	icon: LucideIcon
}

interface AgentRow {
	name: string
	status: string
	task: string
	cpu: number
	tokens: string
	confidence: number
	last: string
}

interface AlertItem {
	title: string
	detail: string
	level: "critical" | "warning"
	time: string
	action: string
	icon: LucideIcon
}

interface PipelineStage {
	stage: string
	count: number
	delta: string
	bottleneck?: boolean
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
	return (
		<div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
			<p className="text-xs text-slate-400">{label}</p>
			<p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
			{sub && <p className="text-xs text-emerald-400">{sub}</p>}
		</div>
	)
}

/* ------------------------------------------------------------------ */
/*  Mock data (will be replaced with API calls in Phase 2)             */
/* ------------------------------------------------------------------ */

const MOCK_COMMAND_STRIP = [
	{ label: "API", value: "Online", tone: "green" },
	{ label: "Workers", value: "4 Active", tone: "green" },
	{ label: "Redis", value: "Healthy", tone: "green" },
	{ label: "Docker", value: "8 Containers", tone: "blue" },
	{ label: "Models", value: "GPT • Claude • DeepSeek", tone: "white" },
	{ label: "Queue", value: "Healthy", tone: "green" },
	{ label: "Autonomous Mode", value: "ENABLED", tone: "greenBadge" },
	{ label: "Last Deploy", value: "12m ago", tone: "white" },
	{ label: "Cost Today", value: "$18.22", tone: "blue" },
	{ label: "Tokens Today", value: "2.4M", tone: "blue" },
]

const MOCK_ACTIVITY: ActivityItem[] = [
	{ time: "12:01:24", agent: "Architect Agent", text: "Analyzing queue optimization...", icon: Brain },
	{ time: "12:01:18", agent: "Debugger Agent", text: "Retrying failed deployment #294...", icon: Bug },
	{ time: "12:01:10", agent: "Research Agent", text: "Scanning market APIs and data sources...", icon: Database },
	{ time: "12:01:04", agent: "Deploy Agent", text: "Deployment successful to DO Singapore.", icon: Rocket },
	{ time: "12:00:58", agent: "Coder Agent", text: "Modified queue-worker.ts", icon: Code2 },
]

const MOCK_AGENTS: AgentRow[] = [
	{
		name: "Architect",
		status: "Thinking",
		task: "Planning queue system",
		cpu: 4,
		tokens: "12.4K",
		confidence: 92,
		last: "5s ago",
	},
	{
		name: "Coder",
		status: "Coding",
		task: "Editing telegram.ts",
		cpu: 15,
		tokens: "42.1K",
		confidence: 96,
		last: "8s ago",
	},
	{
		name: "Debugger",
		status: "Investigating",
		task: "Redis timeout issue",
		cpu: 8,
		tokens: "18.7K",
		confidence: 88,
		last: "7s ago",
	},
	{
		name: "Research",
		status: "Crawling",
		task: "Funding APIs & docs",
		cpu: 22,
		tokens: "31.3K",
		confidence: 90,
		last: "4s ago",
	},
]

const MOCK_ALERTS: AlertItem[] = [
	{
		title: "Deployment Failed",
		detail: "Redis connection timeout on sgp1 server.",
		level: "critical",
		time: "2m ago",
		action: "View Details",
		icon: ShieldAlert,
	},
	{
		title: "Queue Congestion",
		detail: "High latency in Planning stage. (> 120s)",
		level: "warning",
		time: "6m ago",
		action: "Investigate",
		icon: Zap,
	},
	{
		title: "Token Spike Detected",
		detail: "Claude usage increased 38% in the last 30m.",
		level: "warning",
		time: "15m ago",
		action: "Optimize",
		icon: Bot,
	},
]

const MOCK_PIPELINE: PipelineStage[] = [
	{ stage: "Pending", count: 12, delta: "-2" },
	{ stage: "Planning", count: 8, delta: "+1", bottleneck: true },
	{ stage: "Coding", count: 6, delta: "—" },
	{ stage: "Testing", count: 3, delta: "-2" },
	{ stage: "Deploy", count: 1, delta: "+1" },
	{ stage: "Monitoring", count: 4, delta: "—" },
]

const MOCK_INFRA_SERIES = [
	{ name: "1", cpu: 3, ram: 16, disk: 18, net: 7 },
	{ name: "2", cpu: 4, ram: 18, disk: 18, net: 9 },
	{ name: "3", cpu: 5, ram: 19, disk: 19, net: 13 },
	{ name: "4", cpu: 11, ram: 22, disk: 20, net: 8 },
	{ name: "5", cpu: 6, ram: 27, disk: 20, net: 16 },
	{ name: "6", cpu: 18, ram: 31, disk: 21, net: 12 },
]

const QUICK_ACTIONS = [
	"Run Autonomous",
	"Deploy Latest",
	"Retry Failed Jobs",
	"Restart Workers",
	"Health Check",
	"Open Logs",
	"Scan APIs",
	"Generate Skill",
	"Emergency Stop",
]

const SUGGESTED_QUESTIONS = [
	"Why did deployment fail?",
	"Show queue bottlenecks",
	"Optimize token usage",
	"Summarize today's activity",
]

/* ------------------------------------------------------------------ */
/*  Main Overview Component                                            */
/* ------------------------------------------------------------------ */

export function Overview() {
	const [system, setSystem] = useState<SystemMetrics>({ cpu: 0, ram: 0, disk: 0 })
	const [jobStats, setJobStats] = useState<JobStats>({
		waiting: 0,
		active: 0,
		completed: 0,
		failed: 0,
		total: 0,
	})
	const [health, setHealth] = useState<Health>({
		status: "offline",
		redis: false,
		worker: false,
	})
	const [agents, setAgents] = useState<any[]>([])

	useEffect(() => {
		const fetchData = async () => {
			try {
				const token = localStorage.getItem("superroo_auth_token")
				const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
				const [sysRes, queueRes, healthRes] = await Promise.all([
					fetch("/api/system/resources", { headers }).catch(() => null),
					fetch("/api/queue/stats", { headers }).catch(() => null),
					fetch("/api/health", { headers }).catch(() => null),
				])

				if (sysRes?.ok) {
					const data = await sysRes.json()
					setSystem({
						cpu: data.cpu || 0,
						ram: data.memory || 0,
						disk: data.processes || 0,
					})
				}

				if (queueRes?.ok) {
					const data = await queueRes.json()
					setJobStats({
						waiting: data.waiting || 0,
						active: data.active || 0,
						completed: data.completed || 0,
						failed: data.failed || 0,
						total: data.total || 0,
					})
				}

				if (healthRes?.ok) {
					const data = await healthRes.json()
					setHealth({
						status: data.status || "offline",
						redis: data.redis || false,
						worker: data.worker || false,
					})
				}

				// Fetch real agents
				const agentsRes = await fetch("/api/orchestrator/agents", { headers }).catch(() => null)
				if (agentsRes?.ok) {
					const data = await agentsRes.json()
					setAgents(data.agents || [])
				}
			} catch (err) {
				console.error("Error fetching overview data:", err)
			}
		}

		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [])

	const now = new Date()
	const timeStr = now.toLocaleTimeString()
	const dateStr = now.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	})

	return (
		<div className="space-y-3">
			{/* ── Command Strip ── */}
			<div className="overflow-x-auto rounded-xl border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_30px_rgba(40,110,255,0.08)]">
				<div className="flex items-center px-5 py-3 min-w-max">
					{[
						{
							label: "API",
							value: health.status === "online" ? "Online" : "Offline",
							tone: health.status === "online" ? "green" : "red",
						},
						{
							label: "Workers",
							value: health.worker ? "Active" : "Down",
							tone: health.worker ? "green" : "red",
						},
						{
							label: "Redis",
							value: health.redis ? "Healthy" : "Unavailable",
							tone: health.redis ? "green" : "yellow",
						},
						{ label: "CPU", value: `${system.cpu}%`, tone: system.cpu > 80 ? "red" : "blue" },
						{ label: "RAM", value: `${system.ram}%`, tone: system.ram > 80 ? "red" : "blue" },
						{
							label: "Queue",
							value: `${jobStats.waiting} waiting`,
							tone: jobStats.waiting > 10 ? "yellow" : "green",
						},
						{ label: "Agents", value: `${agents.length} registered`, tone: "blue" },
						{ label: "Failed", value: `${jobStats.failed}`, tone: jobStats.failed > 0 ? "red" : "green" },
					].map((s) => (
						<div key={s.label} className="shrink-0 border-r border-slate-800 px-3 sm:px-5 last:border-r-0">
							<p className="text-xs text-slate-400">{s.label}</p>
							<p
								className={`text-sm font-medium ${
									s.tone === "green"
										? "text-emerald-400"
										: s.tone === "blue"
											? "text-blue-400"
											: s.tone === "red"
												? "text-red-400"
												: s.tone === "yellow"
													? "text-yellow-400"
													: "text-slate-100"
								}`}>
								{s.value}
							</p>
						</div>
					))}
					<div className="ml-auto shrink-0 text-right text-xs text-slate-400">
						<p>{timeStr}</p>
						<p>{dateStr}</p>
					</div>
				</div>
			</div>

			{/* ── Grid Layout ── */}
			<div className="grid grid-cols-12 gap-3">
				{/* Autonomous Activity Feed */}
				<Panel
					title="Autonomous Activity Feed"
					action={
						<span className="flex items-center gap-2 text-xs text-emerald-400">
							<span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#22c55e]" />
							LIVE
						</span>
					}
					className="col-span-12 lg:col-span-3">
					<div className="space-y-3">
						{MOCK_ACTIVITY.map((a) => (
							<div key={a.time} className="flex gap-3 border-b border-slate-800/70 pb-3 last:border-0">
								<div className="text-xs text-slate-500">{a.time}</div>
								<div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 ring-1 ring-slate-700">
									<a.icon size={15} />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-violet-300">{a.agent}</p>
									<p className="truncate text-xs text-slate-400">{a.text}</p>
								</div>
								<ArrowRight size={15} className="mt-1 shrink-0 text-slate-500" />
							</div>
						))}
					</div>
					<button className="mt-3 text-xs text-blue-400">View full activity log →</button>
				</Panel>

				{/* Agent Swarm Status */}
				<Panel
					title="Agent Swarm Status"
					action={
						<span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
							{agents.filter((a) => a.enabled).length} Active
						</span>
					}
					className="col-span-12 lg:col-span-5">
					{/* Desktop table */}
					<div className="hidden sm:block overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="text-slate-400">
								<tr>
									<th className="py-2">Agent</th>
									<th>Status</th>
									<th>Current Task</th>
									<th>CPU</th>
									<th>Tokens</th>
									<th>Confidence</th>
									<th>Last Action</th>
								</tr>
							</thead>
							<tbody>
								{(agents.length > 0 ? agents : MOCK_AGENTS).map((a: any) => (
									<tr key={a.id || a.name} className="border-t border-slate-800">
										<td className="py-3 font-medium">{a.name || a.id}</td>
										<td>
											<span
												className={`rounded border px-2 py-1 ${a.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-500/30 bg-slate-500/10 text-slate-400"}`}>
												{a.enabled ? "Active" : "Disabled"}
											</span>
										</td>
										<td className="text-slate-300 truncate max-w-[120px]">
											{a.description || a.task || "—"}
										</td>
										<td>{a.cpu ?? "—"}</td>
										<td>{a.tokens ?? "—"}</td>
										<td>
											<span className="mr-2">
												{a.confidence ?? (a.capabilities?.length || 0)}
											</span>
											{a.confidence && (
												<span className="inline-block h-1.5 w-10 rounded bg-emerald-400" />
											)}
										</td>
										<td>{a.last ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{/* Mobile card layout */}
					<div className="space-y-2 sm:hidden">
						{(agents.length > 0 ? agents : MOCK_AGENTS).map((a: any) => (
							<div
								key={a.id || a.name}
								className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
								<div className="flex items-center justify-between mb-1">
									<span className="text-sm font-medium text-slate-100">{a.name || a.id}</span>
									<span
										className={`rounded border px-2 py-0.5 text-[11px] ${a.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-500/30 bg-slate-500/10 text-slate-400"}`}>
										{a.enabled ? "Active" : "Disabled"}
									</span>
								</div>
								<p className="text-xs text-slate-400 mb-2">{a.task}</p>
								<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
									<span>CPU: {a.cpu}%</span>
									<span>Tokens: {a.tokens}</span>
									<span>Confidence: {a.confidence}%</span>
									<span>{a.last}</span>
								</div>
							</div>
						))}
					</div>
					<div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-slate-800 pt-3 text-center text-xs">
						<Stat label="Total Agents" value="7" />
						<Stat label="Active" value="4" />
						<Stat label="Idle" value="2" />
						<Stat label="Queues" value="3" />
						<Stat label="Tasks Running" value="8" />
					</div>
				</Panel>

				{/* AI Attention Center */}
				<Panel
					title="AI Attention Center"
					action={<span className="rounded bg-amber-500/20 px-2 text-xs text-amber-300">3</span>}
					className="col-span-12 lg:col-span-4">
					<div className="space-y-2">
						{MOCK_ALERTS.map((a) => (
							<div
								key={a.title}
								className={`rounded-lg border p-3 ${
									a.level === "critical"
										? "border-red-500/30 bg-red-950/25"
										: "border-amber-500/30 bg-amber-950/20"
								}`}>
								<div className="flex items-start gap-3">
									<a.icon
										className={a.level === "critical" ? "text-red-400" : "text-amber-400"}
										size={18}
									/>
									<div className="flex-1">
										<div className="flex justify-between">
											<p className="text-sm font-semibold text-amber-200">{a.title}</p>
											<span className="text-xs text-slate-400">{a.time}</span>
										</div>
										<p className="mt-1 text-xs text-slate-300">{a.detail}</p>
									</div>
									<button className="rounded bg-slate-900 px-3 py-1 text-xs text-amber-300">
										{a.action}
									</button>
								</div>
							</div>
						))}
					</div>
					<button className="mt-3 text-xs text-blue-400">View all alerts →</button>
				</Panel>

				{/* Queue Pipeline Overview */}
				<Panel title="Queue Pipeline Overview" className="col-span-12 lg:col-span-8">
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap items-center gap-3">
						{MOCK_PIPELINE.map((p, idx) => (
							<div key={p.stage} className="flex items-center gap-2 lg:flex-1">
								<div
									className={`w-full rounded-lg border p-3 sm:p-4 ${
										p.bottleneck
											? "border-amber-500/50 bg-amber-950/20"
											: "border-blue-500/40 bg-blue-950/20"
									}`}>
									<p className="text-xs sm:text-sm text-cyan-300">{p.stage}</p>
									<div className="mt-2 flex items-end justify-between">
										<b className="text-xl sm:text-2xl">{p.count}</b>
										<span className="text-xs text-emerald-400">{p.delta}</span>
									</div>
								</div>
								{idx < MOCK_PIPELINE.length - 1 && (
									<div className="hidden lg:block h-0.5 w-4 shrink-0 bg-violet-500" />
								)}
							</div>
						))}
					</div>
					<div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-3">
						<Stat label="Total Jobs" value={jobStats.total.toString()} />
						<Stat label="Active" value={jobStats.active.toString()} />
						<Stat label="Completed" value={jobStats.completed.toString()} />
						<Stat label="Failed" value={jobStats.failed.toString()} />
						<Stat label="Success Rate" value="95.7%" />
						<Stat label="Avg. Duration" value="2m 47s" />
					</div>
				</Panel>

				{/* Quick Actions */}
				<Panel title="Quick Actions" className="col-span-12 lg:col-span-4">
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{QUICK_ACTIONS.map((x) => (
							<button
								key={x}
								className={`rounded-lg border border-slate-700 bg-slate-900/70 p-2 sm:p-3 text-[11px] sm:text-xs hover:border-violet-400 ${
									x === "Emergency Stop" ? "text-red-300" : "text-slate-200"
								}`}>
								{x}
							</button>
						))}
					</div>
				</Panel>

				{/* VPS Infrastructure */}
				<Panel title="VPS Infrastructure" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="grid grid-cols-2 gap-2">
						<Stat label="CPU" value={`${system.cpu}%`} />
						<Stat label="RAM" value={`${system.ram}%`} />
						<Stat label="Disk" value={`${system.disk}%`} />
						<Stat label="Network" value="↑ 12.4 Mbps" />
					</div>
					<div className="mt-3 h-20">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={MOCK_INFRA_SERIES}>
								<Area dataKey="ram" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} />
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</Panel>

				{/* Cost & Token Analytics */}
				<Panel title="Cost & Token Analytics" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Tokens" value="2.4M" sub="↑ 18%" />
						<Stat label="Cost" value="$18.22" sub="↑ 14%" />
						<Stat label="Requests" value="12.8K" sub="↑ 9%" />
					</div>
					<div className="mt-3 flex justify-center">
						<div className="h-28 w-28 sm:h-32 sm:w-32">
							<ResponsiveContainer width="100%" height="100%">
								<PieChart>
									<Pie
										data={[
											{ name: "Claude", value: 41 },
											{ name: "DeepSeek", value: 34 },
											{ name: "GPT", value: 15 },
											{ name: "Other", value: 10 },
										]}
										dataKey="value"
										innerRadius={32}
										outerRadius={50}>
										<Cell fill="#8b5cf6" />
										<Cell fill="#3b82f6" />
										<Cell fill="#10b981" />
										<Cell fill="#f59e0b" />
									</Pie>
								</PieChart>
							</ResponsiveContainer>
						</div>
					</div>
				</Panel>

				{/* Deployment Health */}
				<Panel
					title="Deployment Health"
					action={
						<span className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">Production</span>
					}
					className="col-span-12 md:col-span-6 lg:col-span-3">
					<h2 className="text-2xl sm:text-3xl font-bold">v2.8.1</h2>
					<p className="mt-2 flex items-center gap-2 text-emerald-400">
						<CheckCircle2 size={16} />
						Healthy
					</p>
					<div className="mt-4 grid grid-cols-3 gap-2">
						<Stat label="Success Rate" value="98.6%" />
						<Stat label="Deployments" value="24" />
						<Stat label="Rollback" value="v2.8.0" />
					</div>
				</Panel>

				{/* Ask SuperRoo */}
				<Panel title="Ask SuperRoo" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="rounded-lg bg-slate-950/70 p-4 text-sm">How can I help you today?</div>
					<div className="mt-3 space-y-2">
						{SUGGESTED_QUESTIONS.map((q) => (
							<button
								key={q}
								className="block w-full rounded-lg bg-violet-950/50 px-3 py-2 text-left text-sm text-violet-200">
								{q}
							</button>
						))}
					</div>
					<div className="mt-4 flex rounded-lg border border-slate-700 bg-slate-950">
						<input
							className="flex-1 bg-transparent px-3 py-3 text-sm outline-none"
							placeholder="Ask anything..."
						/>
						<button className="m-1 rounded bg-violet-600 px-3 text-sm">▶</button>
					</div>
				</Panel>
			</div>

			{/* ── System Status Footer ── */}
			<div className="flex flex-col sm:flex-row flex-wrap justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-4 sm:px-5 py-3 text-xs text-slate-400">
				<span>
					<span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#22c55e]" />
					System Status: <b className="text-emerald-400">All Systems Operational</b>
				</span>
				<span>
					Autonomous Mode: <b className="text-emerald-400">ACTIVE</b>
				</span>
				<span>License: SuperRoo Enterprise</span>
			</div>
		</div>
	)
}
