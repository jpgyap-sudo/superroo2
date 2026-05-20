"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Loader2,
	Play,
	RotateCcw,
	Terminal,
	FileText,
	AlertTriangle,
	X,
	RefreshCw,
	Container,
	Activity,
	Cpu,
	MemoryStick,
	Network,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

type ContainerStatus = "running" | "stopped" | "crashed"

interface Container {
	id: string
	name: string
	image: string
	status: ContainerStatus
	cpu: number
	ram: number
	ramMax: number
	ports: string[]
	uptime: string
	project: string
}

interface DockerStats {
	containers: number
	running: number
	stopped: number
	crashed: number
	cpuTotal: number
	ramTotal: number
	ramMax: number
	images: number
	sandboxReady: boolean
}

interface CrashAnalysis {
	container: string
	issue: string
	possibleCauses: string[]
	suggestedFixes: string[]
}

interface LogEntry {
	container: string
	message: string
	timestamp: string
	level: "info" | "warn" | "error"
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_CONTAINERS: Container[] = [
	{
		id: "c1",
		name: "superoo-api",
		image: "superoo/api:latest",
		status: "running",
		cpu: 12,
		ram: 480,
		ramMax: 1024,
		ports: ["3000:3000"],
		uptime: "3d 14h",
		project: "superoo",
	},
	{
		id: "c2",
		name: "superoo-worker",
		image: "superoo/worker:latest",
		status: "running",
		cpu: 8,
		ram: 320,
		ramMax: 2048,
		ports: [],
		uptime: "3d 14h",
		project: "superoo",
	},
	{
		id: "c3",
		name: "superoo-dashboard",
		image: "superoo/dashboard:latest",
		status: "running",
		cpu: 5,
		ram: 180,
		ramMax: 512,
		ports: ["8080:80"],
		uptime: "3d 14h",
		project: "superoo",
	},
	{
		id: "c4",
		name: "product-image-studio",
		image: "superoo/img-studio:latest",
		status: "crashed",
		cpu: 0,
		ram: 0,
		ramMax: 1024,
		ports: ["4000:4000"],
		uptime: "0m",
		project: "superoo",
	},
	{
		id: "c5",
		name: "redis",
		image: "redis:7-alpine",
		status: "running",
		cpu: 2,
		ram: 12,
		ramMax: 128,
		ports: ["6379:6379"],
		uptime: "7d 6h",
		project: "infra",
	},
	{
		id: "c6",
		name: "postgres",
		image: "postgres:16-alpine",
		status: "stopped",
		cpu: 0,
		ram: 0,
		ramMax: 512,
		ports: ["5432:5432"],
		uptime: "0m",
		project: "infra",
	},
]

const MOCK_CRASHES: CrashAnalysis[] = [
	{
		container: "product-image-studio",
		issue: "Out of memory (OOM) — process exited with code 137",
		possibleCauses: [
			"Memory limit too low for image processing workloads",
			"Memory leak in image processing pipeline",
			"Concurrent image uploads exceeding available RAM",
		],
		suggestedFixes: [
			"Increase memory limit from 512MB to 1GB in docker-compose.yml",
			"Add rate limiting to image upload endpoint",
			"Enable swap as temporary mitigation",
		],
	},
]

const MOCK_LOGS: LogEntry[] = [
	{ container: "superoo-api", message: "GET /api/v1/jobs 200 45ms", timestamp: "14:08:01", level: "info" },
	{ container: "superoo-api", message: "GET /api/v1/agents 200 12ms", timestamp: "14:07:58", level: "info" },
	{ container: "superoo-worker", message: "Job j-42 completed successfully", timestamp: "14:07:55", level: "info" },
	{
		container: "superoo-dashboard",
		message: "WebSocket connection established",
		timestamp: "14:07:52",
		level: "info",
	},
	{
		container: "product-image-studio",
		message: "FATAL: OutOfMemoryError: Java heap space",
		timestamp: "14:07:48",
		level: "error",
	},
	{ container: "redis", message: "Ready to accept connections", timestamp: "14:07:45", level: "info" },
	{ container: "superoo-api", message: "POST /api/v1/deploy 500 120ms", timestamp: "14:07:40", level: "error" },
	{
		container: "superoo-worker",
		message: "WARN: Queue backlog at 85% capacity",
		timestamp: "14:07:35",
		level: "warn",
	},
	{ container: "superoo-api", message: "Rate limit exceeded for IP 10.0.0.42", timestamp: "14:07:30", level: "warn" },
	{ container: "superoo-dashboard", message: "Static asset cache refreshed", timestamp: "14:07:25", level: "info" },
]

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: ContainerStatus }) {
	const colors: Record<ContainerStatus, string> = {
		running: "bg-emerald-500 shadow-[0_0_6px_#22c55e]",
		stopped: "bg-amber-500",
		crashed: "bg-red-500 shadow-[0_0_6px_#ef4444]",
	}
	return <span className={cn("inline-block h-2 w-2 rounded-full", colors[status])} />
}

function MiniProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
				<div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
			</div>
			<span className="text-[11px] tabular-nums text-slate-400">
				{value}
				{max > 0 && `/${max}`}
			</span>
		</div>
	)
}

function ActionButton({
	icon: Icon,
	label,
	onClick,
	variant = "default",
}: {
	icon: React.ElementType
	label: string
	onClick: (e: React.MouseEvent) => void
	variant?: "default" | "danger"
}) {
	return (
		<button
			onClick={onClick}
			title={label}
			className={cn(
				"flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
				variant === "danger"
					? "border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
					: "border border-slate-700/50 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-300",
			)}>
			<Icon className="h-3 w-3" />
			{label}
		</button>
	)
}

function LogStream() {
	const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS)
	const [filter, setFilter] = useState<string>("all")
	const scrollRef = useRef<HTMLDivElement>(null)
	const [autoScroll, setAutoScroll] = useState(true)

	useEffect(() => {
		const iv = setInterval(() => {
			const containers = ["superoo-api", "superoo-worker", "redis"]
			const levels: LogEntry["level"][] = ["info", "info", "info", "warn", "error"]
			const msgs = [
				"Heartbeat OK",
				"Health check passed",
				"Cache hit ratio: 94%",
				"Connection pool at 12/25",
				"Request queued (priority: normal)",
			]
			setLogs((prev) => [
				...prev,
				{
					container: containers[Math.floor(Math.random() * containers.length)],
					message: msgs[Math.floor(Math.random() * msgs.length)],
					timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
					level: levels[Math.floor(Math.random() * levels.length)],
				},
			])
		}, 4000)
		return () => clearInterval(iv)
	}, [])

	useEffect(() => {
		if (autoScroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [logs, autoScroll])

	const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter)

	const levelColor: Record<string, string> = {
		info: "text-slate-400",
		warn: "text-amber-400",
		error: "text-red-400",
	}

	return (
		<div>
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<FileText className="h-4 w-4 text-slate-500" />
					<h3 className="text-sm font-semibold text-slate-200">Live Log Stream</h3>
				</div>
				<div className="flex items-center gap-1.5">
					{(["all", "info", "warn", "error"] as const).map((l) => (
						<button
							key={l}
							onClick={() => setFilter(l)}
							className={cn(
								"rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
								filter === l ? "bg-blue-500/20 text-blue-400" : "text-slate-500 hover:text-slate-300",
							)}>
							{l}
						</button>
					))}
					<button
						onClick={() => setAutoScroll(!autoScroll)}
						className={cn(
							"rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
							autoScroll ? "bg-emerald-500/20 text-emerald-400" : "text-slate-500 hover:text-slate-300",
						)}>
						Auto-scroll {autoScroll ? "ON" : "OFF"}
					</button>
				</div>
			</div>
			<div
				ref={scrollRef}
				className="h-48 overflow-y-auto rounded-lg border border-[#1e2535] bg-[#060810] p-3 font-mono text-[11px] leading-relaxed">
				{filteredLogs.length === 0 ? (
					<div className="flex h-full items-center justify-center text-slate-600">
						No matching log entries
					</div>
				) : (
					filteredLogs.map((log, i) => (
						<div key={i} className="flex gap-3">
							<span className="shrink-0 text-slate-600">{log.timestamp}</span>
							<span className="shrink-0 text-cyan-500">{log.container}</span>
							<span className={cn("shrink-0", levelColor[log.level])}>[{log.level}]</span>
							<span className="text-slate-400">{log.message}</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}

function DockerDoctorPanel() {
	const [crashes] = useState<CrashAnalysis[]>(MOCK_CRASHES)
	const [expanded, setExpanded] = useState<string | null>(null)

	if (crashes.length === 0) {
		return (
			<Card className="border-emerald-500/20 bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
				<div className="flex items-center gap-2 text-emerald-400">
					<Activity className="h-4 w-4" />
					<span className="text-sm font-semibold">Docker Doctor</span>
					<span className="ml-auto text-[11px] text-emerald-500/60">All containers healthy</span>
				</div>
			</Card>
		)
	}

	return (
		<Card className="border-red-500/20 bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
			<div className="mb-3 flex items-center gap-2">
				<AlertTriangle className="h-4 w-4 text-red-400" />
				<span className="text-sm font-semibold text-slate-200">Docker Doctor</span>
				<Badge status="critical" label={`${crashes.length} crash${crashes.length > 1 ? "es" : ""}`} />
			</div>
			<div className="space-y-2">
				{crashes.map((crash) => (
					<div key={crash.container} className="rounded-lg border border-red-500/10 bg-red-500/5 p-3">
						<button
							onClick={() => setExpanded(expanded === crash.container ? null : crash.container)}
							className="flex w-full items-center justify-between text-left">
							<div>
								<span className="text-sm font-medium text-red-400">{crash.container}</span>
								<p className="mt-0.5 text-[11px] text-slate-400">{crash.issue}</p>
							</div>
							<X
								className={cn(
									"h-3 w-3 text-slate-500 transition-transform",
									expanded === crash.container && "rotate-45",
								)}
							/>
						</button>
						{expanded === crash.container && (
							<div className="mt-3 space-y-3 border-t border-red-500/10 pt-3">
								<div>
									<div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
										Possible Causes
									</div>
									<ul className="space-y-1">
										{crash.possibleCauses.map((cause, i) => (
											<li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
												<span className="mt-0.5 text-slate-600">•</span>
												{cause}
											</li>
										))}
									</ul>
								</div>
								<div>
									<div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
										Suggested Fixes
									</div>
									<ul className="space-y-1">
										{crash.suggestedFixes.map((fix, i) => (
											<li key={i} className="flex items-start gap-2 text-[11px] text-emerald-400">
												<span className="mt-0.5">→</span>
												{fix}
											</li>
										))}
									</ul>
								</div>
							</div>
						)}
					</div>
				))}
			</div>
		</Card>
	)
}

// ─── Main View ──────────────────────────────────────────────────────────────

export function DockerView() {
	const [containers, setContainers] = useState<Container[]>(MOCK_CONTAINERS)
	const [stats, setStats] = useState<DockerStats>({
		containers: MOCK_CONTAINERS.length,
		running: MOCK_CONTAINERS.filter((c) => c.status === "running").length,
		stopped: MOCK_CONTAINERS.filter((c) => c.status === "stopped").length,
		crashed: MOCK_CONTAINERS.filter((c) => c.status === "crashed").length,
		cpuTotal: MOCK_CONTAINERS.reduce((s, c) => s + c.cpu, 0),
		ramTotal: MOCK_CONTAINERS.reduce((s, c) => s + c.ram, 0),
		ramMax: MOCK_CONTAINERS.reduce((s, c) => s + c.ramMax, 0),
		images: 24,
		sandboxReady: true,
	})
	const [sandboxResult, setSandboxResult] = useState<string[] | null>(null)
	const [sandboxRunning, setSandboxRunning] = useState(false)
	const [selectedContainer, setSelectedContainer] = useState<string | null>(null)

	// Fetch real stats from API
	useEffect(() => {
		const fetchStats = async () => {
			try {
				const res = await fetch("/api/docker/status")
				if (res.ok) {
					const data = await res.json()
					setStats((prev) => ({
						...prev,
						containers: data.containers ?? prev.containers,
						running: data.running ?? prev.running,
						stopped: data.stopped ?? prev.stopped,
						crashed: data.crashed ?? prev.crashed,
						images: data.images ?? prev.images,
						sandboxReady: data.sandboxReady ?? prev.sandboxReady,
					}))
				}
			} catch (err) {
				console.error("Error fetching docker stats:", err)
			}
		}
		fetchStats()
		const iv = setInterval(fetchStats, 15000)
		return () => clearInterval(iv)
	}, [])

	const runSandboxTest = async () => {
		setSandboxRunning(true)
		try {
			const res = await fetch("/api/sandbox/execute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jobId: `dashboard-test-${Date.now()}`,
					task: "dashboard sandbox test",
					commands: ["node -v", "npm -v", "pnpm -v", "git --version"],
					network: "none",
					timeout: 30000,
				}),
			})
			const data = await res.json()
			if (data.success) {
				setSandboxResult([
					`Sandbox job completed successfully`,
					`Exit code: ${data.exitCode}`,
					...(data.stdout ? [`Output: ${data.stdout.substring(0, 500)}`] : []),
				])
			} else {
				setSandboxResult([`Sandbox job failed: ${data.error || "Unknown error"}`])
			}
		} catch (err) {
			setSandboxResult([
				`Error: Could not reach sandbox API — ${err instanceof Error ? err.message : "Unknown error"}`,
			])
		}
		setSandboxRunning(false)
	}

	const handleContainerAction = useCallback((containerId: string, action: string) => {
		setContainers((prev) =>
			prev.map((c) => {
				if (c.id !== containerId) return c
				if (action === "restart") {
					return { ...c, status: "running", cpu: 5, ram: 120, uptime: "0m" }
				}
				if (action === "stop") {
					return { ...c, status: "stopped", cpu: 0, ram: 0, uptime: "0m" }
				}
				return c
			}),
		)
		// Recalculate stats
		setContainers((prev) => {
			setStats({
				containers: prev.length,
				running: prev.filter((c) => c.status === "running").length,
				stopped: prev.filter((c) => c.status === "stopped").length,
				crashed: prev.filter((c) => c.status === "crashed").length,
				cpuTotal: prev.reduce((s, c) => s + c.cpu, 0),
				ramTotal: prev.reduce((s, c) => s + c.ram, 0),
				ramMax: prev.reduce((s, c) => s + c.ramMax, 0),
				images: 24,
				sandboxReady: true,
			})
			return prev
		})
	}, [])

	const statusBadgeMap: Record<ContainerStatus, string> = {
		running: "running",
		stopped: "idle",
		crashed: "failed",
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-bold text-slate-200">Docker Control Center</h1>
					<p className="text-[11px] text-slate-500">
						Manage containers, monitor resources, and diagnose issues
					</p>
				</div>
				<button
					onClick={() => {
						setContainers(MOCK_CONTAINERS)
						setStats({
							containers: MOCK_CONTAINERS.length,
							running: MOCK_CONTAINERS.filter((c) => c.status === "running").length,
							stopped: MOCK_CONTAINERS.filter((c) => c.status === "stopped").length,
							crashed: MOCK_CONTAINERS.filter((c) => c.status === "crashed").length,
							cpuTotal: MOCK_CONTAINERS.reduce((s, c) => s + c.cpu, 0),
							ramTotal: MOCK_CONTAINERS.reduce((s, c) => s + c.ram, 0),
							ramMax: MOCK_CONTAINERS.reduce((s, c) => s + c.ramMax, 0),
							images: 24,
							sandboxReady: true,
						})
					}}
					className="flex items-center gap-1.5 rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-300">
					<RefreshCw className="h-3 w-3" />
					Refresh
				</button>
			</div>

			{/* Stat Cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<StatCard
					label="Running Containers"
					value={
						<div className="flex items-center gap-2">
							<Container className="h-4 w-4 text-emerald-400" />
							<span>{stats.running}</span>
						</div>
					}
					color="text-emerald-400"
					sub={`${stats.containers} total`}
				/>
				<StatCard
					label="Stopped Containers"
					value={
						<div className="flex items-center gap-2">
							<X className="h-4 w-4 text-amber-400" />
							<span>{stats.stopped}</span>
						</div>
					}
					color="text-amber-400"
				/>
				<StatCard
					label="CPU Usage"
					value={
						<div className="flex items-center gap-2">
							<Cpu className="h-4 w-4 text-blue-400" />
							<span>{stats.cpuTotal}%</span>
						</div>
					}
					color="text-blue-400"
				/>
				<StatCard
					label="RAM Usage"
					value={
						<div className="flex items-center gap-2">
							<MemoryStick className="h-4 w-4 text-purple-400" />
							<span>{stats.ramTotal}MB</span>
						</div>
					}
					color="text-purple-400"
					sub={`of ${stats.ramMax}MB`}
				/>
				<StatCard
					label="Failed Containers"
					value={
						<div className="flex items-center gap-2">
							<AlertTriangle className="h-4 w-4 text-red-400" />
							<span>{stats.crashed}</span>
						</div>
					}
					color={stats.crashed > 0 ? "text-red-400" : "text-emerald-400"}
				/>
			</div>

			{/* Main Grid: Table + Sidebar */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
				{/* Containers Table */}
				<Card className="overflow-hidden border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-0">
					<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
						<div>
							<h2 className="text-sm font-semibold text-slate-200">Containers</h2>
							<p className="text-[11px] text-slate-500">Manage services and infrastructure</p>
						</div>
						<div className="flex items-center gap-2">
							<Badge status="running" label={`${stats.running} running`} />
							<Badge status="idle" label={`${stats.stopped} stopped`} />
							{stats.crashed > 0 && <Badge status="failed" label={`${stats.crashed} failed`} />}
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-slate-500">
									<th className="px-4 py-2.5 font-medium">Container</th>
									<th className="px-4 py-2.5 font-medium">Status</th>
									<th className="px-4 py-2.5 font-medium">CPU</th>
									<th className="px-4 py-2.5 font-medium">RAM</th>
									<th className="px-4 py-2.5 font-medium">Ports</th>
									<th className="px-4 py-2.5 font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{containers.map((container) => (
									<tr
										key={container.id}
										className={cn(
											"border-t border-[#1e2535] transition-colors hover:bg-white/[0.02]",
											selectedContainer === container.id && "bg-blue-500/5",
										)}
										onClick={() =>
											setSelectedContainer(
												selectedContainer === container.id ? null : container.id,
											)
										}>
										<td className="px-4 py-3">
											<div className="flex items-center gap-2.5">
												<StatusIndicator status={container.status} />
												<div>
													<div className="font-medium text-slate-200">{container.name}</div>
													<div className="text-[10px] text-slate-600">{container.image}</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-3">
											<Badge status={statusBadgeMap[container.status]} label={container.status} />
										</td>
										<td className="px-4 py-3">
											<MiniProgressBar value={container.cpu} max={100} color="bg-blue-500" />
										</td>
										<td className="px-4 py-3">
											<MiniProgressBar
												value={container.ram}
												max={container.ramMax}
												color="bg-purple-500"
											/>
										</td>
										<td className="px-4 py-3">
											{container.ports.length > 0 ? (
												<div className="flex flex-wrap gap-1">
													{container.ports.map((p) => (
														<span
															key={p}
															className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">
															{p}
														</span>
													))}
												</div>
											) : (
												<span className="text-slate-600">—</span>
											)}
										</td>
										<td className="px-4 py-3">
											<div className="flex items-center gap-1.5">
												<ActionButton
													icon={RotateCcw}
													label="Restart"
													onClick={(e) => {
														e.stopPropagation()
														handleContainerAction(container.id, "restart")
													}}
												/>
												<ActionButton
													icon={FileText}
													label="Logs"
													onClick={(e) => {
														e.stopPropagation()
														setSelectedContainer(
															selectedContainer === container.id ? null : container.id,
														)
													}}
												/>
												<ActionButton
													icon={Terminal}
													label="Shell"
													onClick={(e) => {
														e.stopPropagation()
														setSandboxResult([`Opening shell to ${container.name}...`])
													}}
												/>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>

				{/* Right Sidebar */}
				<div className="space-y-4">
					{/* Docker Doctor */}
					<DockerDoctorPanel />

					{/* Quick Actions */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="mb-3 flex items-center gap-2">
							<Activity className="h-4 w-4 text-slate-500" />
							<h3 className="text-sm font-semibold text-slate-200">Quick Actions</h3>
						</div>
						<div className="space-y-2">
							<div className="rounded-lg border border-[#1e2535] bg-[#060810] p-3">
								<div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
									Workspace Path
								</div>
								<div className="font-mono text-[11px] text-blue-400">
									/opt/superroo2/cloud/sandbox/jobs/
								</div>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#060810] p-3">
								<div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
									Logs Path
								</div>
								<div className="font-mono text-[11px] text-blue-400">
									/opt/superroo2/cloud/logs/jobs/
								</div>
							</div>
							<button
								onClick={runSandboxTest}
								disabled={sandboxRunning}
								className="flex w-full items-center justify-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20 disabled:opacity-50">
								{sandboxRunning ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Play className="h-4 w-4" />
								)}
								{sandboxRunning ? "Running sandbox test..." : "Run Sandbox Test"}
							</button>
							{sandboxResult && (
								<div className="rounded-md border border-[#1e2535] bg-[#060810] p-3 font-mono text-[11px] leading-relaxed">
									{sandboxResult.map((r, i) => (
										<div key={i} className="text-emerald-400">
											✓ {r}
										</div>
									))}
								</div>
							)}
						</div>
					</Card>
				</div>
			</div>

			{/* Log Stream */}
			<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
				<LogStream />
			</Card>
		</div>
	)
}
