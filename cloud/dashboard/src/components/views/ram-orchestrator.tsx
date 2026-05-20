"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, StatCard } from "@/components/ui/card"
import {
	Activity,
	AlertTriangle,
	AlertCircle,
	CheckCircle2,
	PauseCircle,
	PlayCircle,
	RefreshCw,
	MemoryStick,
	TrendingUp,
	TrendingDown,
	Minus,
	Clock,
	Server,
	Bot,
	BarChart3,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type RamState = "normal" | "warning" | "critical" | "danger"

interface RamSnapshot {
	ramPercent: number
	freeMb: number
	totalMb: number
	usedMb: number
	timestamp: number
}

interface RamTrend {
	trend: "rising" | "falling" | "stable"
	ratePerMinute: number
	samples: number
}

interface RamMonitorStats {
	state: RamState
	running: boolean
	snapshot: RamSnapshot
	trend: RamTrend
	thresholds: {
		warning: number
		critical: number
		danger: number
		recovery: number
	}
	historySamples: number
}

interface SchedulerStats {
	deferredTasks: number
	totalDeferred: number
	totalResubmitted: number
	priorityBoosts: number
}

interface PauseStats {
	pausedWorkers: Array<{ workerId: string; criticality: string; pausedAt: number }>
	totalPauseCycles: number
	runningTasks: number
}

interface RamOrchestratorStatus {
	status: string
	service: string
	config: {
		warningPercent: number
		criticalPercent: number
		dangerPercent: number
		recoveryPercent: number
		pollIntervalMs: number
		gracePeriodMs: number
		cooldownMs: number
	}
	ramMonitor: RamMonitorStats | null
	scheduler: SchedulerStats | null
	workerPauseManager: PauseStats | null
	uptime: number
	timestamp: number
}

interface DeferredTask {
	taskId: string
	type: string
	priority: number
	deferredAt: number
	reason: string
}

interface DeferredTasksResponse {
	count: number
	tasks: DeferredTask[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const RAM_ORCHESTRATOR_URL = "http://127.0.0.1:3456"

const STATE_COLORS: Record<RamState, string> = {
	normal: "text-emerald-400",
	warning: "text-amber-400",
	critical: "text-orange-400",
	danger: "text-red-400",
}

const STATE_BG: Record<RamState, string> = {
	normal: "bg-emerald-500/10 border-emerald-500/25",
	warning: "bg-amber-500/10 border-amber-500/25",
	critical: "bg-orange-500/10 border-orange-500/25",
	danger: "bg-red-500/10 border-red-500/25",
}

const STATE_ICONS: Record<RamState, React.ReactNode> = {
	normal: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
	warning: <AlertTriangle className="h-5 w-5 text-amber-400" />,
	critical: <AlertCircle className="h-5 w-5 text-orange-400" />,
	danger: <AlertCircle className="h-5 w-5 text-red-400" />,
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400)
	const h = Math.floor((seconds % 86400) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)
	const parts: string[] = []
	if (d > 0) parts.push(`${d}d`)
	if (h > 0) parts.push(`${h}h`)
	if (m > 0) parts.push(`${m}m`)
	parts.push(`${s}s`)
	return parts.join(" ")
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString()
}

function MiniProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
	const pct = Math.min((value / max) * 100, 100)
	return (
		<div className="h-1.5 w-full rounded-full bg-[#1e2535] overflow-hidden">
			<div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
		</div>
	)
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RamOrchestratorView() {
	const [status, setStatus] = useState<RamOrchestratorStatus | null>(null)
	const [deferred, setDeferred] = useState<DeferredTasksResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [autoRefresh, setAutoRefresh] = useState(true)

	const fetchData = useCallback(async () => {
		try {
			const [statusRes, deferredRes] = await Promise.all([
				fetch(`${RAM_ORCHESTRATOR_URL}/status`),
				fetch(`${RAM_ORCHESTRATOR_URL}/deferred`),
			])
			if (statusRes.ok) {
				const data = await statusRes.json()
				setStatus(data)
			}
			if (deferredRes.ok) {
				const data = await deferredRes.json()
				setDeferred(data)
			}
			setError(null)
		} catch (err) {
			setError(`Cannot connect to RAM Orchestrator at ${RAM_ORCHESTRATOR_URL}`)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
		if (!autoRefresh) return
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [fetchData, autoRefresh])

	const handlePauseWorker = async (workerId: string) => {
		try {
			await fetch(`${RAM_ORCHESTRATOR_URL}/pause`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workerId, reason: "manual from dashboard" }),
			})
			fetchData()
		} catch {
			// ignore
		}
	}

	const handleResumeWorker = async (workerId: string) => {
		try {
			await fetch(`${RAM_ORCHESTRATOR_URL}/resume`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workerId }),
			})
			fetchData()
		} catch {
			// ignore
		}
	}

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
			</div>
		)
	}

	if (error && !status) {
		return (
			<div className="space-y-6 p-6">
				<div className="flex items-center gap-3">
					<MemoryStick className="h-6 w-6 text-purple-400" />
					<h1 className="text-xl font-semibold text-[#e2e8f0]">VPS RAM Orchestrator</h1>
				</div>
				<Card className="border-red-800/40 bg-red-900/10">
					<div className="flex items-center gap-3 p-4">
						<AlertCircle className="h-5 w-5 text-red-400" />
						<div>
							<p className="text-sm font-medium text-red-300">Orchestrator Unreachable</p>
							<p className="mt-1 text-xs text-red-400">{error}</p>
							<p className="mt-1 text-xs text-gray-500">
								Ensure the RAM Orchestrator is running on the VPS (PM2 process: superroo-ram-orchestrator)
							</p>
						</div>
					</div>
				</Card>
			</div>
		)
	}

	const ram = status?.ramMonitor
	const snap = ram?.snapshot
	const trend = ram?.trend
	const state = ram?.state || "normal"
	const scheduler = status?.scheduler
	const pauseMgr = status?.workerPauseManager

	return (
		<div className="space-y-6 p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<MemoryStick className="h-6 w-6 text-purple-400" />
					<div>
						<h1 className="text-xl font-semibold text-[#e2e8f0]">VPS RAM Orchestrator</h1>
						<p className="text-xs text-gray-500">
							{status?.service} · Uptime: {status?.uptime ? formatUptime(status.uptime) : "N/A"}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-2 text-xs text-gray-500">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="rounded border-[#1e2535] bg-[#070b14] text-[#3b82f6]"
						/>
						Auto-refresh (5s)
					</label>
					<button
						onClick={fetchData}
						className="inline-flex items-center gap-2 rounded-lg border border-[#1e2535] px-3 py-2 text-sm text-gray-400 hover:bg-[#1e2535] transition-colors"
					>
						<RefreshCw className="h-4 w-4" />
						Refresh
					</button>
				</div>
			</div>

			{/* RAM State Banner */}
			<div className={`rounded-xl border p-4 ${STATE_BG[state]}`}>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						{STATE_ICONS[state]}
						<div>
							<p className={`text-lg font-semibold ${STATE_COLORS[state]}`}>
								RAM State: {state.toUpperCase()}
							</p>
							<p className="text-xs text-gray-500">
								{snap ? `${snap.ramPercent}% used (${snap.usedMb}MB / ${snap.totalMb}MB)` : "No data"}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-4 text-xs text-gray-500">
						{trend && (
							<div className="flex items-center gap-1">
								{trend.trend === "rising" ? (
									<TrendingUp className="h-3.5 w-3.5 text-red-400" />
								) : trend.trend === "falling" ? (
									<TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
								) : (
									<Minus className="h-3.5 w-3.5 text-gray-500" />
								)}
								<span>
									{trend.trend} ({trend.ratePerMinute}%/min)
								</span>
							</div>
						)}
						{snap && (
							<div className="flex items-center gap-1">
								<Clock className="h-3.5 w-3.5" />
								<span>{formatTime(snap.timestamp)}</span>
							</div>
						)}
					</div>
				</div>
				{snap && (
					<div className="mt-3">
						<MiniProgressBar
							value={snap.ramPercent}
							max={100}
							color={
								state === "danger"
									? "bg-red-500"
									: state === "critical"
										? "bg-orange-500"
										: state === "warning"
											? "bg-amber-500"
											: "bg-emerald-500"
							}
						/>
					</div>
				)}
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					label="RAM Usage"
					value={
						<div className="flex items-center gap-2">
							<MemoryStick className="h-4 w-4 text-purple-400" />
							<span className={STATE_COLORS[state]}>{snap?.ramPercent || 0}%</span>
						</div>
					}
					color="text-purple-400"
					sub={`${snap?.freeMb || 0}MB free of ${snap?.totalMb || 0}MB`}
				/>
				<StatCard
					label="Free Memory"
					value={`${snap?.freeMb || 0} MB`}
					color="text-emerald-400"
					sub={`${Math.round(((snap?.freeMb || 0) / (snap?.totalMb || 1)) * 100)}% free`}
				/>
				<StatCard
					label="Deferred Tasks"
					value={scheduler?.deferredTasks ?? 0}
					color="text-amber-400"
					sub={`${scheduler?.totalDeferred ?? 0} total deferred`}
				/>
				<StatCard
					label="Paused Workers"
					value={pauseMgr?.pausedWorkers?.length ?? 0}
					color="text-orange-400"
					sub={`${pauseMgr?.totalPauseCycles ?? 0} total cycles`}
				/>
			</div>

			{/* Two-column layout */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Thresholds & Config */}
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Server className="h-4 w-4 text-cyan-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Configuration</span>
					</div>
					<div className="space-y-3 p-5">
						{status?.config && (
							<>
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Warning</p>
										<p className="mt-1 text-lg font-semibold text-amber-400">
											{status.config.warningPercent}%
										</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Critical</p>
										<p className="mt-1 text-lg font-semibold text-orange-400">
											{status.config.criticalPercent}%
										</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Danger</p>
										<p className="mt-1 text-lg font-semibold text-red-400">
											{status.config.dangerPercent}%
										</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Recovery</p>
										<p className="mt-1 text-lg font-semibold text-emerald-400">
											{status.config.recoveryPercent}%
										</p>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Poll: {status.config.pollIntervalMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Grace: {status.config.gracePeriodMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Cooldown: {status.config.cooldownMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<BarChart3 className="h-3 w-3" />
										<span>Samples: {ram?.historySamples ?? 0}</span>
									</div>
								</div>
							</>
						)}
					</div>
				</Card>

				{/* Paused Workers */}
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Bot className="h-4 w-4 text-purple-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Worker Status</span>
						<span className="ml-auto text-xs text-gray-500">
							{pauseMgr?.runningTasks ?? 0} running · {pauseMgr?.pausedWorkers?.length ?? 0} paused
						</span>
					</div>
					<div className="p-5">
						{pauseMgr?.pausedWorkers && pauseMgr.pausedWorkers.length > 0 ? (
							<div className="space-y-2">
								{pauseMgr.pausedWorkers.map((w) => (
									<div
										key={w.workerId}
										className="flex items-center justify-between rounded-lg bg-[#0a0e1a] p-3"
									>
										<div>
											<p className="text-sm font-medium text-[#e2e8f0]">{w.workerId}</p>
											<p className="text-xs text-gray-500">
												{w.criticality} · paused {formatTime(w.pausedAt)}
											</p>
										</div>
										<button
											onClick={() => handleResumeWorker(w.workerId)}
											className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors"
										>
											<PlayCircle className="h-3 w-3" />
											Resume
										</button>
									</div>
								))}
							</div>
						) : (
							<p className="py-4 text-center text-xs text-gray-500">No workers currently paused</p>
						)}
					</div>
				</Card>
			</div>

			{/* Deferred Tasks */}
			<Card>
				<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
					<Activity className="h-4 w-4 text-amber-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Deferred Tasks</span>
					<span className="ml-auto text-xs text-gray-500">{deferred?.count ?? 0} deferred</span>
				</div>
				<div className="p-5">
					{deferred && deferred.tasks.length > 0 ? (
						<div className="space-y-2">
							{deferred.tasks.map((t) => (
								<div
									key={t.taskId}
									className="flex items-center justify-between rounded-lg bg-[#0a0e1a] p-3"
								>
									<div className="flex items-center gap-3">
										<div>
											<p className="text-sm font-medium text-[#e2e8f0]">{t.taskId}</p>
											<p className="text-xs text-gray-500">
												{t.type} · priority {t.priority} · {t.reason}
											</p>
										</div>
									</div>
									<p className="text-xs text-gray-500">{formatTime(t.deferredAt)}</p>
								</div>
							))}
						</div>
					) : (
						<p className="py-4 text-center text-xs text-gray-500">No deferred tasks</p>
					)}
				</div>
			</Card>

			{/* History Timeline (last 20 samples) */}
			{ram?.historySamples && ram.historySamples > 0 && (
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<TrendingUp className="h-4 w-4 text-cyan-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">RAM History</span>
						<span className="ml-auto text-xs text-gray-500">{ram.historySamples} samples</span>
					</div>
					<div className="p-5">
						<div className="flex items-end gap-0.5 h-24">
							{/* Mini bar chart showing recent RAM history */}
							{Array.from({ length: Math.min(ram.historySamples, 60) }).map((_, i) => {
								// Approximate from current snapshot and trend
								const basePct = snap?.ramPercent || 50
								const trendOffset = trend?.ratePerMinute || 0
								const idx = Math.min(i, ram.historySamples - 1)
								const estimatedPct = Math.max(
									5,
									Math.min(100, basePct - trendOffset * ((ram.historySamples - idx) / 60)),
								)
								const barColor =
									estimatedPct >= (status?.config.dangerPercent ?? 90)
										? "bg-red-500"
										: estimatedPct >= (status?.config.criticalPercent ?? 80)
											? "bg-orange-500"
											: estimatedPct >= (status?.config.warningPercent ?? 70)
												? "bg-amber-500"
												: "bg-emerald-500"
								return (
									<div
										key={i}
										className={`flex-1 rounded-t ${barColor} opacity-70 hover:opacity-100 transition-opacity`}
										style={{ height: `${estimatedPct}%` }}
										title={`~${Math.round(estimatedPct)}%`}
									/>
								)
							})}
						</div>
						<div className="mt-2 flex justify-between text-[10px] text-gray-600">
							<span>Oldest</span>
							<span>Now</span>
						</div>
					</div>
				</Card>
			)}
		</div>
	)
}
