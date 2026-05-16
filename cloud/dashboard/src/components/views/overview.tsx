"use client"

import { useEffect, useState, useCallback } from "react"
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

interface CommandStripItem {
	label: string
	value: string
	tone: "green" | "blue" | "greenBadge" | "white"
}

/* ------------------------------------------------------------------ */
/*  API helper                                                         */
/* ------------------------------------------------------------------ */

async function apiFetch<T>(path: string): Promise<T | null> {
	try {
		const res = await fetch(path)
		if (!res.ok) return null
		return (await res.json()) as T
	} catch {
		return null
	}
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
	const [commandStrip, setCommandStrip] = useState<CommandStripItem[]>([])
	const [activity, setActivity] = useState<ActivityItem[]>([])
	const [agents, setAgents] = useState<AgentRow[]>([])
	const [alerts, setAlerts] = useState<AlertItem[]>([])
	const [pipeline, setPipeline] = useState<PipelineStage[]>([])
	const [infraHistory, setInfraHistory] = useState<{ name: string; cpu: number; ram: number; disk: number }[]>([])
	const [tokenBreakdown, setTokenBreakdown] = useState<{ name: string; value: number }[]>([])
	const [deployVersion, setDeployVersion] = useState("—")
	const [deployHealthy, setDeployHealthy] = useState(true)
	const [successRate, setSuccessRate] = useState(100)
	const [deployCount, setDeployCount] = useState(0)
	const [rollbackVersion, setRollbackVersion] = useState("—")
	const [tokensTotal, setTokensTotal] = useState("0")
	const [costToday, setCostToday] = useState("$0.00")
	const [requestsTotal, setRequestsTotal] = useState("0")
	const [agentCounts, setAgentCounts] = useState({ total: 0, active: 0, idle: 0, queues: 0, tasksRunning: 0 })
	const [systemStatus, setSystemStatus] = useState("All Systems Operational")
	const [autonomousMode, setAutonomousMode] = useState("INACTIVE")

	const fetchAllData = useCallback(async () => {
		const [sysRes, queueRes, healthRes, jobsRes, logsRes, agentsRes, eventsRes, deploysRes] = await Promise.all([
			apiFetch<SystemMetrics>("/api/system"),
			apiFetch<{
				success: boolean
				waiting: number
				active: number
				completed: number
				failed: number
				delayed: number
			}>("/api/queue/stats"),
			apiFetch<Health>("/api/health"),
			apiFetch<{
				totalJobs: number
				running: number
				completed: number
				failed: number
				queued: number
				successRate: number
				aiCostToday: number
				systemHealth: string
			}>("/api/jobs/summary"),
			apiFetch<{ success: boolean; logs: { time: string; source: string; message: string }[] }>(
				"/api/logs?limit=10",
			),
			apiFetch<{ success: boolean; agents: { id: string; name: string; status: string; task: string }[] }>(
				"/api/orchestrator/agents",
			),
			apiFetch<{
				success: boolean
				events: { type: string; source: string; severity: string; message: string; timestamp: string }[]
			}>("/api/orchestrator/events?limit=10"),
			apiFetch<{ success: boolean; deploys: { version: string; status: string; timestamp: string }[] }>(
				"/api/orchestrator/deploys?limit=5",
			),
		])

		if (sysRes) setSystem(sysRes)

		if (queueRes) {
			setJobStats({
				waiting: queueRes.waiting || 0,
				active: queueRes.active || 0,
				completed: queueRes.completed || 0,
				failed: queueRes.failed || 0,
				total:
					(queueRes.waiting || 0) +
					(queueRes.active || 0) +
					(queueRes.completed || 0) +
					(queueRes.failed || 0) +
					(queueRes.delayed || 0),
			})
		}

		if (healthRes) setHealth(healthRes)

		if (jobsRes) {
			setSuccessRate(jobsRes.successRate)
			setCostToday(`$${jobsRes.aiCostToday.toFixed(2)}`)
			setSystemStatus(jobsRes.systemHealth || "Unknown")
			setAutonomousMode(jobsRes.running > 0 ? "ACTIVE" : "INACTIVE")

			// Build command strip from jobs summary
			const strip: CommandStripItem[] = [
				{
					label: "API",
					value: healthRes?.status === "online" ? "Online" : "Offline",
					tone: healthRes?.status === "online" ? "green" : "white",
				},
				{ label: "Workers", value: `${jobsRes.running} Active`, tone: "green" },
				{
					label: "Redis",
					value: healthRes?.redis ? "Healthy" : "Offline",
					tone: healthRes?.redis ? "green" : "white",
				},
				{
					label: "Queue",
					value: jobsRes.queued > 10 ? `${jobsRes.queued} Queued` : "Healthy",
					tone: jobsRes.queued > 10 ? "blue" : "green",
				},
				{ label: "Jobs Completed", value: `${jobsRes.completed}`, tone: "green" },
				{ label: "Jobs Failed", value: `${jobsRes.failed}`, tone: jobsRes.failed > 0 ? "white" : "green" },
				{
					label: "Success Rate",
					value: `${jobsRes.successRate}%`,
					tone: jobsRes.successRate >= 90 ? "green" : "white",
				},
				{
					label: "Autonomous Mode",
					value: jobsRes.running > 0 ? "ACTIVE" : "INACTIVE",
					tone: jobsRes.running > 0 ? "greenBadge" : "white",
				},
				{ label: "Cost Today", value: `$${jobsRes.aiCostToday.toFixed(2)}`, tone: "blue" },
			]
			setCommandStrip(strip)
		}

		// Build activity from logs
		if (logsRes?.logs) {
			const mapped: ActivityItem[] = logsRes.logs.slice(0, 5).map((log) => {
				const sourceLower = (log.source || "").toLowerCase()
				let icon: LucideIcon = Bot
				if (sourceLower.includes("architect") || sourceLower.includes("plan")) icon = Brain
				else if (sourceLower.includes("debug") || sourceLower.includes("bug")) icon = Bug
				else if (sourceLower.includes("research") || sourceLower.includes("crawl")) icon = Database
				else if (sourceLower.includes("deploy")) icon = Rocket
				else if (sourceLower.includes("code") || sourceLower.includes("coder")) icon = Code2
				return {
					time: log.time || new Date().toLocaleTimeString(),
					agent: log.source || "System",
					text: log.message || "",
					icon,
				}
			})
			setActivity(mapped)
		}

		// Build agents from orchestrator
		if (agentsRes?.agents) {
			const mapped: AgentRow[] = agentsRes.agents.map((a) => ({
				name: a.name || a.id,
				status: a.status || "Idle",
				task: a.task || "—",
				cpu: 0,
				tokens: "—",
				confidence: 0,
				last: "—",
			}))
			setAgents(mapped)
			setAgentCounts((prev) => ({
				...prev,
				total: mapped.length,
				active: mapped.filter((a) => a.status !== "Idle" && a.status !== "offline").length,
			}))
		}

		// Build alerts from events
		if (eventsRes?.events) {
			const mapped: AlertItem[] = eventsRes.events
				.filter((e) => e.severity === "critical" || e.severity === "warning" || e.severity === "error")
				.slice(0, 5)
				.map((e) => ({
					title: e.type || "Event",
					detail: e.message || "",
					level: (e.severity === "critical" || e.severity === "error" ? "critical" : "warning") as
						| "critical"
						| "warning",
					time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "—",
					action: "View",
					icon: e.severity === "critical" || e.severity === "error" ? ShieldAlert : Zap,
				}))
			setAlerts(mapped)
		}

		// Build pipeline from queue stats
		if (queueRes) {
			const stages: PipelineStage[] = [
				{ stage: "Waiting", count: queueRes.waiting || 0, delta: "—" },
				{ stage: "Active", count: queueRes.active || 0, delta: "—" },
				{ stage: "Completed", count: queueRes.completed || 0, delta: "—" },
				{
					stage: "Failed",
					count: queueRes.failed || 0,
					delta: "—",
					bottleneck: (queueRes.failed || 0) > (queueRes.completed || 0) * 0.5,
				},
				{ stage: "Delayed", count: queueRes.delayed || 0, delta: "—" },
			]
			setPipeline(stages)
		}

		// Build infra history from system stats over time
		if (sysRes) {
			setInfraHistory((prev) => {
				const next = [
					...prev,
					{ name: `${prev.length + 1}`, cpu: sysRes.cpu, ram: sysRes.ram, disk: sysRes.disk },
				]
				return next.slice(-12) // keep last 12 data points
			})
		}

		// Build deploys info
		if (deploysRes?.deploys && deploysRes.deploys.length > 0) {
			const latest = deploysRes.deploys[0]
			setDeployVersion(latest.version || "—")
			setDeployHealthy(latest.status === "healthy" || latest.status === "success")
			setDeployCount(deploysRes.deploys.length)
			// Find last rollback
			const rollback = deploysRes.deploys.find((d) => d.status === "rolled_back")
			if (rollback) setRollbackVersion(rollback.version || "—")
		}
	}, [])

	useEffect(() => {
		fetchAllData()
		const iv = setInterval(fetchAllData, 5000)
		return () => clearInterval(iv)
	}, [fetchAllData])

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
					{commandStrip.length === 0 ? (
						<div className="flex items-center gap-2 text-xs text-slate-500 px-3">
							<span className="inline-block h-2 w-2 rounded-full bg-slate-500 animate-pulse" />
							Loading system status...
						</div>
					) : (
						commandStrip.map((s, i) => (
							<div
								key={s.label}
								className="shrink-0 border-r border-slate-800 px-3 sm:px-5 last:border-r-0">
								<p className="text-xs text-slate-400">{s.label}</p>
								<p
									className={`text-sm font-medium ${
										s.tone === "green"
											? "text-emerald-400"
											: s.tone === "blue"
												? "text-blue-400"
												: s.tone === "greenBadge"
													? "inline rounded border border-emerald-500/40 bg-emerald-500/10 px-2 text-emerald-300"
													: "text-slate-100"
									}`}>
									{s.value}
								</p>
							</div>
						))
					)}
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
					{activity.length === 0 ? (
						<div className="py-6 text-center text-xs text-slate-500">No recent activity</div>
					) : (
						<div className="space-y-3">
							{activity.map((a, idx) => (
								<div key={idx} className="flex gap-3 border-b border-slate-800/70 pb-3 last:border-0">
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
					)}
					<button className="mt-3 text-xs text-blue-400">View full activity log →</button>
				</Panel>

				{/* Agent Swarm Status */}
				<Panel
					title="Agent Swarm Status"
					action={
						<span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
							{agentCounts.active} Active
						</span>
					}
					className="col-span-12 lg:col-span-5">
					{/* Desktop table */}
					{agents.length === 0 ? (
						<div className="py-6 text-center text-xs text-slate-500">No agents registered</div>
					) : (
						<>
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
										{agents.map((a) => (
											<tr key={a.name} className="border-t border-slate-800">
												<td className="py-3 font-medium">{a.name}</td>
												<td>
													<span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-violet-300">
														{a.status}
													</span>
												</td>
												<td className="text-slate-300">{a.task}</td>
												<td>{a.cpu}%</td>
												<td>{a.tokens}</td>
												<td>
													<span className="mr-2">{a.confidence}%</span>
													<span className="inline-block h-1.5 w-10 rounded bg-emerald-400" />
												</td>
												<td>{a.last}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{/* Mobile card layout */}
							<div className="space-y-2 sm:hidden">
								{agents.map((a) => (
									<div
										key={a.name}
										className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
										<div className="flex items-center justify-between mb-1">
											<span className="text-sm font-medium text-slate-100">{a.name}</span>
											<span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300">
												{a.status}
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
						</>
					)}
					<div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-slate-800 pt-3 text-center text-xs">
						<Stat label="Total Agents" value={agentCounts.total.toString()} />
						<Stat label="Active" value={agentCounts.active.toString()} />
						<Stat label="Idle" value={agentCounts.idle.toString()} />
						<Stat label="Queues" value={agentCounts.queues.toString()} />
						<Stat label="Tasks Running" value={agentCounts.tasksRunning.toString()} />
					</div>
				</Panel>

				{/* AI Attention Center */}
				<Panel
					title="AI Attention Center"
					action={
						<span className="rounded bg-amber-500/20 px-2 text-xs text-amber-300">{alerts.length}</span>
					}
					className="col-span-12 lg:col-span-4">
					{alerts.length === 0 ? (
						<div className="py-6 text-center text-xs text-slate-500">No active alerts</div>
					) : (
						<div className="space-y-2">
							{alerts.map((a, idx) => (
								<div
									key={idx}
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
					)}
					<button className="mt-3 text-xs text-blue-400">View all alerts →</button>
				</Panel>

				{/* Queue Pipeline Overview */}
				<Panel title="Queue Pipeline Overview" className="col-span-12 lg:col-span-8">
					{pipeline.length === 0 ? (
						<div className="py-6 text-center text-xs text-slate-500">No pipeline data</div>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap items-center gap-3">
							{pipeline.map((p, idx) => (
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
									{idx < pipeline.length - 1 && (
										<div className="hidden lg:block h-0.5 w-4 shrink-0 bg-violet-500" />
									)}
								</div>
							))}
						</div>
					)}
					<div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-3">
						<Stat label="Total Jobs" value={jobStats.total.toString()} />
						<Stat label="Active" value={jobStats.active.toString()} />
						<Stat label="Completed" value={jobStats.completed.toString()} />
						<Stat label="Failed" value={jobStats.failed.toString()} />
						<Stat label="Success Rate" value={`${successRate}%`} />
						<Stat label="Cost Today" value={costToday} />
					</div>
				</Panel>

				{/* Quick Actions */}
				<Panel title="Quick Actions" className="col-span-12 lg:col-span-4">
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{[
							{ label: "Run Autonomous", action: "autonomous" },
							{ label: "Deploy Latest", action: "deploy" },
							{ label: "Retry Failed Jobs", action: "retry" },
							{ label: "Restart Workers", action: "restart" },
							{ label: "Health Check", action: "health" },
							{ label: "Open Logs", action: "logs" },
							{ label: "Scan APIs", action: "scan" },
							{ label: "Generate Skill", action: "skill" },
							{ label: "Emergency Stop", action: "stop" },
						].map((x) => (
							<button
								key={x.label}
								onClick={async () => {
									try {
										const token = localStorage.getItem("superroo_auth_token")
										await fetch(`/api/actions/${x.action}`, {
											method: "POST",
											headers: token ? { Authorization: `Bearer ${token}` } : {},
										})
									} catch {
										// silent
									}
								}}
								className={`rounded-lg border border-slate-700 bg-slate-900/70 p-2 sm:p-3 text-[11px] sm:text-xs hover:border-violet-400 ${
									x.label === "Emergency Stop" ? "text-red-300" : "text-slate-200"
								}`}>
								{x.label}
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
						<Stat label="Workers" value={jobStats.active.toString()} />
					</div>
					{infraHistory.length > 0 && (
						<div className="mt-3 h-20">
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={infraHistory}>
									<Area dataKey="ram" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} />
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}
				</Panel>

				{/* Cost & Token Analytics */}
				<Panel title="Cost & Token Analytics" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Tokens" value={tokensTotal} />
						<Stat label="Cost" value={costToday} />
						<Stat label="Requests" value={requestsTotal} />
					</div>
					{tokenBreakdown.length > 0 && (
						<div className="mt-3 flex justify-center">
							<div className="h-28 w-28 sm:h-32 sm:w-32">
								<ResponsiveContainer width="100%" height="100%">
									<PieChart>
										<Pie data={tokenBreakdown} dataKey="value" innerRadius={32} outerRadius={50}>
											{tokenBreakdown.map((entry, idx) => {
												const colors = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b"]
												return <Cell key={entry.name} fill={colors[idx % colors.length]} />
											})}
										</Pie>
									</PieChart>
								</ResponsiveContainer>
							</div>
						</div>
					)}
				</Panel>

				{/* Deployment Health */}
				<Panel
					title="Deployment Health"
					action={
						<span className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">Production</span>
					}
					className="col-span-12 md:col-span-6 lg:col-span-3">
					<h2 className="text-2xl sm:text-3xl font-bold">{deployVersion}</h2>
					<p
						className={`mt-2 flex items-center gap-2 ${deployHealthy ? "text-emerald-400" : "text-red-400"}`}>
						<CheckCircle2 size={16} />
						{deployHealthy ? "Healthy" : "Degraded"}
					</p>
					<div className="mt-4 grid grid-cols-3 gap-2">
						<Stat label="Success Rate" value={`${successRate}%`} />
						<Stat label="Deployments" value={deployCount.toString()} />
						<Stat label="Rollback" value={rollbackVersion} />
					</div>
				</Panel>

				{/* Ask SuperRoo */}
				<Panel title="Ask SuperRoo" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="rounded-lg bg-slate-950/70 p-4 text-sm">How can I help you today?</div>
					<div className="mt-3 space-y-2">
						{[
							"Why did deployment fail?",
							"Show queue bottlenecks",
							"Optimize token usage",
							"Summarize today's activity",
						].map((q) => (
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
					System Status: <b className="text-emerald-400">{systemStatus}</b>
				</span>
				<span>
					Autonomous Mode: <b className="text-emerald-400">{autonomousMode}</b>
				</span>
				<span>License: SuperRoo Enterprise</span>
			</div>
		</div>
	)
}
