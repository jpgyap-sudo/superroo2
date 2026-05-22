"use client"

import { useEffect, useState } from "react"
import {
	ArrowRight,
	Bot,
	Bug,
	CheckCircle2,
	CircleAlert,
	GitBranch,
	GitCommit,
	HeartPulse,
	RefreshCw,
	ShieldAlert,
	Sparkles,
	Terminal,
	Zap,
} from "lucide-react"
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts"

type SystemMetrics = { cpu: number; ram: number; disk: number }
type JobStats = { waiting: number; active: number; completed: number; failed: number; total: number }
type EventBusStats = { activeTasks: number; totalEvents: number }
type Health = { status: string; redis: boolean; worker: boolean }
type Agent = {
	id?: string
	name?: string
	enabled?: boolean
	description?: string
	capabilities?: string[]
	status?: string
	lastSeen?: string
}
type BugEntry = {
	id?: string
	title?: string
	summary?: string
	severity?: string
	status?: string
	createdAt?: string
	timestamp?: string
	service?: string
}
type CommitEntry = { sha: string; title: string; type: string; timestamp: number; agent: string }
type DeployEntry = { version: string; sha: string; agent: string; status: string; timestamp: number }
type TimelinePoint = { time: string; cpu: number; ram: number }
type ActivityItem = { id: string; time: string; title: string; detail: string; tone: "info" | "success" | "warning" }
type AttentionItem = {
	id: string
	title: string
	detail: string
	level: "critical" | "warning"
	action: string
	target: string
}
type OverviewSummary = {
	system: SystemMetrics
	health: Health
	queue: JobStats
	agents: { items: Agent[]; total: number; active: number }
	bugs: { items: BugEntry[]; open: number; severe: number }
	commits: CommitEntry[]
	deploys: DeployEntry[]
	usage: {
		totalTokens: number
		totalCostUsd: number | null
		requests: number
		costAvailable: boolean
		providers: { name: string; value: number }[]
	}
	activity: ActivityItem[]
	attention: AttentionItem[]
	generatedAt: string
}

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
			className={`relative overflow-hidden rounded-lg border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] p-4 ${className}`}>
			{/* Subtle top accent line */}
			<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
			<div className="mb-4 flex items-center justify-between gap-3">
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
			{sub && <p className="text-xs text-slate-500">{sub}</p>}
		</div>
	)
}

function formatRelative(input?: string | number) {
	if (!input) return "unknown"
	const ts = typeof input === "number" ? input : new Date(input).getTime()
	if (!Number.isFinite(ts)) return "unknown"
	const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000))
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	return `${Math.floor(hours / 24)}d ago`
}

function navigate(target: string) {
	window.dispatchEvent(new CustomEvent("navigate", { detail: target }))
}

export function Overview() {
	const [system, setSystem] = useState<SystemMetrics>({ cpu: 0, ram: 0, disk: 0 })
	const [jobStats, setJobStats] = useState<JobStats>({ waiting: 0, active: 0, completed: 0, failed: 0, total: 0 })
	const [health, setHealth] = useState<Health>({ status: "offline", redis: false, worker: false })
	const [agents, setAgents] = useState<Agent[]>([])
	const [bugs, setBugs] = useState<BugEntry[]>([])
	const [commits, setCommits] = useState<CommitEntry[]>([])
	const [deploys, setDeploys] = useState<DeployEntry[]>([])
	const [usageSummary, setUsageSummary] = useState<OverviewSummary["usage"]>({
		totalTokens: 0,
		totalCostUsd: null,
		requests: 0,
		costAvailable: false,
		providers: [],
	})
	const [activity, setActivity] = useState<ActivityItem[]>([])
	const [attention, setAttention] = useState<AttentionItem[]>([])
	const [timeline, setTimeline] = useState<TimelinePoint[]>([])
	const [eventBusStats, setEventBusStats] = useState<EventBusStats>({ activeTasks: 0, totalEvents: 0 })
	const [loading, setLoading] = useState(true)
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

	useEffect(() => {
		const fetchData = async () => {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

			try {
				const [res, ebRes] = await Promise.all([
					fetch("/api/overview/summary", { headers }).catch(() => null),
					fetch("/api/orchestrator/event-bus/stats", { headers }).catch(() => null),
				])
				if (ebRes?.ok) {
					const ebData = (await ebRes.json()) as EventBusStats
					setEventBusStats(ebData)
				}
				if (res?.ok) {
					const data = (await res.json()) as OverviewSummary
					setSystem(data.system)
					setJobStats(data.queue)
					setHealth(data.health)
					setAgents(data.agents.items || [])
					setBugs(data.bugs.items || [])
					setCommits(data.commits || [])
					setDeploys(data.deploys || [])
					setUsageSummary(data.usage)
					setActivity(data.activity || [])
					setAttention(data.attention || [])
					setTimeline((prev) =>
						[
							...prev,
							{
								time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
								cpu: data.system.cpu,
								ram: data.system.ram,
							},
						].slice(-12),
					)
					setLastUpdated(new Date(data.generatedAt))
				}
			} finally {
				setLoading(false)
			}
		}

		fetchData()
		const interval = setInterval(fetchData, 5000)
		return () => clearInterval(interval)
	}, [])

	const activeAgents = agents.filter((agent) => agent.enabled)
	const openBugs = bugs.filter((bug) => !["resolved", "wont_fix"].includes(String(bug.status || "").toLowerCase()))
	const severeBugs = openBugs.filter((bug) => ["critical", "high"].includes(String(bug.severity || "").toLowerCase()))
	const latestDeploy = deploys[0]
	const latestCommit = commits[0]

	const topStatus = [
		{
			label: "API",
			value: health.status === "online" ? "Online" : "Offline",
			tone: health.status === "online" ? "good" : "bad",
			target: "monitoring",
		},
		{
			label: "Workers",
			value: health.worker ? "Active" : "Down",
			tone: health.worker ? "good" : "bad",
			target: "logs",
		},
		{
			label: "Redis",
			value: health.redis ? "Healthy" : "Unavailable",
			tone: health.redis ? "good" : "warn",
			target: "monitoring",
		},
		{
			label: "Failed",
			value: String(jobStats.failed),
			tone: jobStats.failed > 0 ? "bad" : "good",
			target: "queue",
		},
		{
			label: "Open Bugs",
			value: String(openBugs.length),
			tone: severeBugs.length > 0 ? "warn" : "good",
			target: "bugs",
		},
		{
			label: "Deploy",
			value: latestDeploy ? latestDeploy.status : "Unknown",
			tone:
				latestDeploy && ["healthy", "completed"].includes(String(latestDeploy.status).toLowerCase())
					? "good"
					: "warn",
			target: "deploy",
		},
	]

	const quickActions = [
		{ label: "Open Logs", icon: Terminal, target: "logs", disabled: false },
		{ label: "Review Queue", icon: Zap, target: "queue", disabled: false },
		{ label: "Inspect Bugs", icon: Bug, target: "bugs", disabled: openBugs.length === 0 },
		{ label: "Deploy History", icon: GitCommit, target: "deploy", disabled: deploys.length === 0 },
		{ label: "Monitor Health", icon: HeartPulse, target: "monitoring", disabled: false },
		{ label: "Review Agents", icon: Bot, target: "agents", disabled: agents.length === 0 },
		{ label: "Task Timeline", icon: GitBranch, target: "task-timeline", disabled: eventBusStats.activeTasks === 0 },
	]

	const successRate = jobStats.total > 0 ? Math.round((jobStats.completed / jobStats.total) * 1000) / 10 : 0

	return (
		<div className="space-y-3">
			{/* Product Hero Section */}
			<div className="relative overflow-hidden rounded-xl border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(135deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] p-5 sm:p-6">
				{/* Background glow */}
				<div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-violet-600/5 blur-3xl" />
				<div className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-blue-600/5 blur-3xl" />

				<div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-600/25 shrink-0">
							<Sparkles className="h-6 w-6" />
						</div>
						<div>
							<h2 className="text-lg font-bold text-slate-100">SuperRoo Cloud Console</h2>
							<p className="text-xs text-slate-500 mt-0.5">Autonomous AI agent orchestration platform</p>
						</div>
					</div>
					<div className="flex items-center gap-3 text-xs text-slate-500">
						<div className="flex items-center gap-1.5 rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-1.5">
							<div
								className={`h-2 w-2 rounded-full ${health.status === "online" ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-red-400"}`}
							/>
							<span className="text-slate-400">
								{health.status === "online" ? "All Systems Operational" : "System Issues Detected"}
							</span>
						</div>
						<div className="flex items-center gap-1.5 text-slate-600">
							<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
							<span>
								{lastUpdated ? `Updated ${formatRelative(lastUpdated.toISOString())}` : "Loading..."}
							</span>
						</div>
					</div>
				</div>

				{/* Quick status chips */}
				<div className="relative z-10 mt-4 flex flex-wrap gap-2">
					{topStatus.map((item) => (
						<button
							key={item.label}
							onClick={() => navigate(item.target)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs hover:border-slate-600 transition-colors">
							<div
								className={`h-1.5 w-1.5 rounded-full ${item.tone === "good" ? "bg-emerald-400" : item.tone === "bad" ? "bg-red-400" : "bg-amber-400"}`}
							/>
							<span className="text-slate-500">{item.label}:</span>
							<span
								className={`font-medium ${item.tone === "good" ? "text-emerald-300" : item.tone === "bad" ? "text-red-300" : "text-amber-300"}`}>
								{item.value}
							</span>
						</button>
					))}
				</div>
			</div>

			<div className="grid grid-cols-12 gap-3">
				<Panel
					title="Needs Attention"
					action={
						<span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
							{attention.length}
						</span>
					}
					className="col-span-12 lg:col-span-4">
					{attention.length === 0 ? (
						<div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
							<CheckCircle2 className="h-4 w-4" />
							No active incidents need attention.
						</div>
					) : (
						<div className="space-y-2">
							{attention.map((item) => (
								<button
									key={item.id}
									onClick={() => navigate(item.target)}
									className={`w-full rounded-lg border p-3 text-left ${
										item.level === "critical"
											? "border-red-500/30 bg-red-950/20"
											: "border-amber-500/30 bg-amber-950/20"
									}`}>
									<div className="flex items-start gap-3">
										{item.level === "critical" ? (
											<ShieldAlert className="mt-0.5 h-4 w-4 text-red-400" />
										) : (
											<CircleAlert className="mt-0.5 h-4 w-4 text-amber-400" />
										)}
										<div className="min-w-0 flex-1">
											<p className="text-sm font-semibold text-slate-100">{item.title}</p>
											<p className="mt-1 text-xs text-slate-300">{item.detail}</p>
										</div>
										<span className="text-xs text-blue-300">{item.action}</span>
									</div>
								</button>
							))}
						</div>
					)}
				</Panel>

				<Panel
					title="Work In Motion"
					action={
						<button
							onClick={() => navigate("task-timeline")}
							className="flex items-center gap-1.5 rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">
							<GitBranch className="h-3 w-3" />
							<span>{eventBusStats.activeTasks} tracked</span>
						</button>
					}
					className="col-span-12 lg:col-span-5">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat label="Waiting" value={String(jobStats.waiting)} />
						<Stat label="Active" value={String(jobStats.active)} />
						<Stat label="Completed" value={String(jobStats.completed)} />
						<Stat label="Success Rate" value={`${successRate}%`} />
					</div>
					<div className="mt-4 grid grid-cols-4 gap-2">
						{[
							{ label: "Waiting", value: jobStats.waiting, color: "bg-amber-500" },
							{ label: "Active", value: jobStats.active, color: "bg-blue-500" },
							{ label: "Completed", value: jobStats.completed, color: "bg-emerald-500" },
							{ label: "Failed", value: jobStats.failed, color: "bg-red-500" },
						].map((stage) => (
							<div key={stage.label} className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
								<p className="text-xs text-slate-400">{stage.label}</p>
								<p className="mt-1 text-2xl font-semibold text-slate-100">{stage.value}</p>
								<div className="mt-2 h-1.5 rounded-full bg-slate-800">
									<div
										className={`h-1.5 rounded-full ${stage.color}`}
										style={{
											width: `${jobStats.total > 0 ? Math.max(8, (stage.value / jobStats.total) * 100) : 0}%`,
										}}
									/>
								</div>
							</div>
						))}
					</div>
				</Panel>

				<Panel title="Quick Actions" className="col-span-12 lg:col-span-3">
					<div className="grid grid-cols-2 gap-2">
						{quickActions.map(({ label, icon: Icon, target, disabled }) => (
							<button
								key={label}
								disabled={disabled}
								onClick={() => navigate(target)}
								className="flex min-h-20 flex-col items-start justify-between rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-left text-xs text-slate-200 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40">
								<Icon className="h-4 w-4" />
								<span>{label}</span>
							</button>
						))}
					</div>
				</Panel>

				<Panel title="Recent Activity" className="col-span-12 lg:col-span-4">
					{activity.length === 0 ? (
						<p className="text-sm text-slate-500">No recent activity reported.</p>
					) : (
						<div className="space-y-3">
							{activity.map((item) => (
								<div
									key={item.id}
									className="flex gap-3 border-b border-slate-800/70 pb-3 last:border-0">
									<span className="w-14 shrink-0 text-xs text-slate-500">{item.time}</span>
									<div
										className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.tone === "success" ? "bg-emerald-400" : item.tone === "warning" ? "bg-amber-400" : "bg-blue-400"}`}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm text-slate-100">{item.title}</p>
										<p className="text-xs text-slate-400">{item.detail}</p>
									</div>
								</div>
							))}
						</div>
					)}
				</Panel>

				<Panel
					title="Agent Workforce"
					action={
						<span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
							{activeAgents.length} active
						</span>
					}
					className="col-span-12 lg:col-span-5">
					<div className="space-y-2">
						{agents.slice(0, 5).map((agent) => (
							<div
								key={agent.id || agent.name}
								className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
								<div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 ring-1 ring-slate-700">
									<Bot className="h-4 w-4" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-slate-100">
										{agent.name || agent.id}
									</p>
									<p className="truncate text-xs text-slate-400">
										{agent.description || "No description"}
									</p>
								</div>
								<div className="text-right">
									<p
										className={
											agent.enabled ? "text-xs text-emerald-400" : "text-xs text-slate-500"
										}>
										{agent.enabled ? "Active" : "Disabled"}
									</p>
									<p className="text-xs text-slate-500">
										{agent.capabilities?.length || 0} capabilities
									</p>
								</div>
							</div>
						))}
					</div>
					<button
						onClick={() => navigate("agents")}
						className="mt-3 inline-flex items-center gap-1 text-xs text-blue-400">
						View all agents <ArrowRight className="h-3 w-3" />
					</button>
				</Panel>

				<Panel title="Infrastructure Trend" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="CPU" value={`${system.cpu}%`} />
						<Stat label="RAM" value={`${system.ram}%`} />
						<Stat label="Disk" value={`${system.disk}%`} />
					</div>
					<div className="mt-4 h-28">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={timeline}>
								<Area dataKey="cpu" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.12} />
								<Area dataKey="ram" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.08} />
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</Panel>

				<Panel title="Usage Today" className="col-span-12 md:col-span-6 lg:col-span-3">
					<div className="grid grid-cols-2 gap-2">
						<Stat label="Tokens" value={usageSummary.totalTokens.toLocaleString()} />
						<Stat
							label="Cost"
							value={
								usageSummary.costAvailable ? `$${usageSummary.totalCostUsd?.toFixed(2)}` : "Not tracked"
							}
						/>
					</div>
					<div className="mt-4 flex items-center gap-3">
						<div className="h-24 w-24">
							<ResponsiveContainer width="100%" height="100%">
								<PieChart>
									<Pie
										data={usageSummary.providers}
										dataKey="value"
										innerRadius={24}
										outerRadius={40}>
										{usageSummary.providers.map((_, index) => (
											<Cell
												key={index}
												fill={["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b"][index % 4]}
											/>
										))}
									</Pie>
								</PieChart>
							</ResponsiveContainer>
						</div>
						<div className="min-w-0 flex-1 space-y-2">
							{usageSummary.providers.length === 0 ? (
								<p className="text-xs text-slate-500">No usage recorded today.</p>
							) : (
								usageSummary.providers.slice(0, 4).map((provider) => (
									<div key={provider.name} className="flex items-center justify-between text-xs">
										<span className="truncate text-slate-400">{provider.name}</span>
										<span className="text-slate-200">{provider.value}</span>
									</div>
								))
							)}
						</div>
					</div>
				</Panel>

				<Panel title="Deployment Health" className="col-span-12 md:col-span-6 lg:col-span-3">
					{latestDeploy ? (
						<>
							<div className="flex items-center justify-between">
								<div>
									<p className="text-2xl font-bold text-slate-100">v{latestDeploy.version}</p>
									<p className="text-xs text-slate-500">{formatRelative(latestDeploy.timestamp)}</p>
								</div>
								<span
									className={`rounded px-2 py-1 text-xs ${["healthy", "completed"].includes(String(latestDeploy.status).toLowerCase()) ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
									{latestDeploy.status}
								</span>
							</div>
							<div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
								<p>Agent: {latestDeploy.agent}</p>
								<p>Commit: {latestDeploy.sha?.slice(0, 7) || "unknown"}</p>
							</div>
						</>
					) : (
						<p className="text-sm text-slate-500">No deploy history available.</p>
					)}
				</Panel>

				<Panel title="Latest Change" className="col-span-12 md:col-span-6 lg:col-span-3">
					{latestCommit ? (
						<>
							<div className="flex items-start gap-3">
								<GitCommit className="mt-1 h-4 w-4 text-blue-400" />
								<div className="min-w-0">
									<p className="text-sm font-medium text-slate-100">{latestCommit.title}</p>
									<p className="mt-1 text-xs text-slate-400">
										{latestCommit.agent} · {latestCommit.type} ·{" "}
										{formatRelative(latestCommit.timestamp)}
									</p>
								</div>
							</div>
							<button onClick={() => navigate("commit-deploy")} className="mt-4 text-xs text-blue-400">
								Open commit log
							</button>
						</>
					) : (
						<p className="text-sm text-slate-500">No commit history available.</p>
					)}
				</Panel>
			</div>
		</div>
	)
}
