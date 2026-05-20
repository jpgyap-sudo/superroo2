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
	Bell,
	Settings,
	Shield,
	XCircle,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type RamState = "normal" | "warning" | "critical" | "danger"

interface RamSnapshot {
	ramPercent: number
	freeMb: number
	totalMb: number
	usedMb: number
	timestamp: number
	swap?: SwapUsage | null
}

interface SwapUsage {
	totalMb: number
	usedMb: number
	freeMb: number
	percent: number
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
		swapWarning: number
		swapCritical: number
	}
	swapEnabled: boolean
	clusterMode: boolean
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

interface RamOrchestratorConfig {
	warningPercent: number
	criticalPercent: number
	dangerPercent: number
	recoveryPercent: number
	pollIntervalMs: number
	gracePeriodMs: number
	cooldownMs: number
	enableAlerts: boolean
	enableHistoryPersistence: boolean
	enableAutoScale: boolean
	clusterMode: boolean
}

interface RamOrchestratorStatus {
	status: string
	service: string
	config: RamOrchestratorConfig
	ramMonitor: RamMonitorStats | null
	scheduler: SchedulerStats | null
	workerPauseManager: PauseStats | null
	swapUsage: SwapUsage | null
	history: {
		sampleCount: number
		recentSamples: RamSnapshot[]
	}
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

interface AlertItem {
	type: string
	oldState: string
	newState: string
	timestamp: number
	snapshot?: RamSnapshot
	swapUsage?: SwapUsage
}

interface AlertsResponse {
	count: number
	alerts: AlertItem[]
}

interface HistoryResponse {
	count: number
	samples: RamSnapshot[]
}

interface ApiError {
	message: string
	endpoint: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = "/ram-orchestrator"

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function formatDateTime(ts: number): string {
	return new Date(ts).toLocaleString()
}

function getStateForSample(sample: RamSnapshot, thresholds: RamMonitorStats["thresholds"]): RamState {
	if (sample.ramPercent >= thresholds.danger) return "danger"
	if (sample.ramPercent >= thresholds.critical) return "critical"
	if (sample.ramPercent >= thresholds.warning) return "warning"
	return "normal"
}

function MiniProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
	const pct = Math.min((value / max) * 100, 100)
	return (
		<div className="h-1.5 w-full rounded-full bg-[#1e2535] overflow-hidden">
			<div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
		</div>
	)
}

function StateBadge({ state }: { state: string }) {
	const colorMap: Record<string, string> = {
		normal: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
		warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
		critical: "bg-orange-500/10 text-orange-400 border-orange-500/20",
		danger: "bg-red-500/10 text-red-400 border-red-500/20",
	}
	return (
		<span
			className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide border ${colorMap[state] || colorMap.normal}`}>
			{state}
		</span>
	)
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RamOrchestratorView() {
	const [status, setStatus] = useState<RamOrchestratorStatus | null>(null)
	const [deferred, setDeferred] = useState<DeferredTasksResponse | null>(null)
	const [history, setHistory] = useState<HistoryResponse | null>(null)
	const [alerts, setAlerts] = useState<AlertsResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<ApiError | null>(null)
	const [autoRefresh, setAutoRefresh] = useState(true)
	const [actionError, setActionError] = useState<string | null>(null)
	const [actionSuccess, setActionSuccess] = useState<string | null>(null)

	const clearActionFeedback = useCallback(() => {
		setActionError(null)
		setActionSuccess(null)
	}, [])

	const fetchData = useCallback(async () => {
		try {
			const [statusRes, deferredRes, historyRes, alertsRes] = await Promise.all([
				fetch(`${API_BASE}/status`),
				fetch(`${API_BASE}/deferred`),
				fetch(`${API_BASE}/history?count=60`),
				fetch(`${API_BASE}/alerts?limit=20`),
			])

			if (statusRes.ok) {
				const data = await statusRes.json()
				setStatus(data)
			} else {
				setError({ message: `Status HTTP ${statusRes.status}`, endpoint: "/status" })
			}

			if (deferredRes.ok) {
				const data = await deferredRes.json()
				setDeferred(data)
			}

			if (historyRes.ok) {
				const data = await historyRes.json()
				setHistory(data)
			}

			if (alertsRes.ok) {
				const data = await alertsRes.json()
				setAlerts(data)
			}

			if (statusRes.ok) setError(null)
		} catch (err) {
			setError({ message: err instanceof Error ? err.message : "Network error", endpoint: "all" })
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
		clearActionFeedback()
		try {
			const res = await fetch(`${API_BASE}/pause`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workerId, reason: "manual from dashboard" }),
			})
			const data = await res.json()
			if (res.ok && data.paused) {
				setActionSuccess(`Paused worker: ${workerId}`)
				fetchData()
			} else {
				setActionError(data.error || `Failed to pause ${workerId}`)
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Pause request failed")
		}
	}

	const handleResumeWorker = async (workerId: string) => {
		clearActionFeedback()
		try {
			const res = await fetch(`${API_BASE}/resume`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workerId }),
			})
			const data = await res.json()
			if (res.ok && data.resumed) {
				setActionSuccess(`Resumed worker: ${workerId}`)
				fetchData()
			} else {
				setActionError(data.error || `Failed to resume ${workerId}`)
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Resume request failed")
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
							<p className="mt-1 text-xs text-red-400">{error.message}</p>
							<p className="mt-1 text-xs text-gray-500">
								Ensure the RAM Orchestrator is running on the VPS (PM2 process:
								superroo-ram-orchestrator)
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
	const cfg = status?.config
	const hist = history
	const alertList = alerts
	const swap = status?.swapUsage

	// Build event log from history samples
	const eventLog: Array<{ time: number; event: string; state: RamState; ramPercent: number }> = []
	if (hist && hist.samples.length > 0 && ram) {
		let prevState = getStateForSample(hist.samples[0], ram.thresholds)
		for (let i = 1; i < hist.samples.length; i++) {
			const s = hist.samples[i]
			const st = getStateForSample(s, ram.thresholds)
			if (st !== prevState) {
				eventLog.push({
					time: s.timestamp,
					event: `RAM state changed: ${prevState} → ${st}`,
					state: st,
					ramPercent: s.ramPercent,
				})
				prevState = st
			}
		}
	}

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
						className="inline-flex items-center gap-2 rounded-lg border border-[#1e2535] px-3 py-2 text-sm text-gray-400 hover:bg-[#1e2535] transition-colors">
						<RefreshCw className="h-4 w-4" />
						Refresh
					</button>
				</div>
			</div>

			{/* Action feedback */}
			{actionError && (
				<div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300 flex items-center gap-2">
					<XCircle className="h-4 w-4" />
					{actionError}
				</div>
			)}
			{actionSuccess && (
				<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 flex items-center gap-2">
					<CheckCircle2 className="h-4 w-4" />
					{actionSuccess}
				</div>
			)}

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

			{/* RAM + Swap row */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Configuration */}
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Settings className="h-4 w-4 text-cyan-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Configuration</span>
					</div>
					<div className="space-y-3 p-5">
						{cfg && (
							<>
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Warning</p>
										<p className="mt-1 text-lg font-semibold text-amber-400">
											{cfg.warningPercent}%
										</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Critical</p>
										<p className="mt-1 text-lg font-semibold text-orange-400">
											{cfg.criticalPercent}%
										</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Danger</p>
										<p className="mt-1 text-lg font-semibold text-red-400">{cfg.dangerPercent}%</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3">
										<p className="text-[10px] text-gray-500 uppercase tracking-wider">Recovery</p>
										<p className="mt-1 text-lg font-semibold text-emerald-400">
											{cfg.recoveryPercent}%
										</p>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Poll: {cfg.pollIntervalMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Grace: {cfg.gracePeriodMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<Clock className="h-3 w-3" />
										<span>Cooldown: {cfg.cooldownMs}ms</span>
									</div>
									<div className="flex items-center gap-2">
										<BarChart3 className="h-3 w-3" />
										<span>Samples: {hist?.count ?? 0}</span>
									</div>
								</div>
								<div className="mt-2 flex flex-wrap gap-2">
									{cfg.enableAlerts && (
										<span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
											<Bell className="h-3 w-3" /> Alerts
										</span>
									)}
									{cfg.enableHistoryPersistence && (
										<span className="inline-flex items-center gap-1 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
											<BarChart3 className="h-3 w-3" /> History
										</span>
									)}
									{cfg.enableAutoScale && (
										<span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
											<TrendingUp className="h-3 w-3" /> Auto-scale
										</span>
									)}
									{cfg.clusterMode && (
										<span className="inline-flex items-center gap-1 rounded border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400">
											<Server className="h-3 w-3" /> Cluster
										</span>
									)}
								</div>
							</>
						)}
					</div>
				</Card>

				{/* Swap Usage */}
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Shield className="h-4 w-4 text-sky-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Swap Usage</span>
						{ram?.swapEnabled === false && (
							<span className="ml-auto text-[10px] text-gray-500">Monitoring disabled</span>
						)}
					</div>
					<div className="p-5">
						{swap ? (
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-sm text-gray-400">Swap Used</span>
									<span
										className={`text-lg font-semibold ${swap.percent >= 75 ? "text-red-400" : swap.percent >= 50 ? "text-amber-400" : "text-emerald-400"}`}>
										{swap.percent}%
									</span>
								</div>
								<MiniProgressBar
									value={swap.percent}
									max={100}
									color={
										swap.percent >= 75
											? "bg-red-500"
											: swap.percent >= 50
												? "bg-amber-500"
												: "bg-emerald-500"
									}
								/>
								<div className="grid grid-cols-3 gap-3 text-xs text-gray-500">
									<div className="rounded-lg bg-[#0a0e1a] p-3 text-center">
										<p className="text-[10px] uppercase tracking-wider">Total</p>
										<p className="mt-1 font-semibold text-[#e2e8f0]">{swap.totalMb} MB</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3 text-center">
										<p className="text-[10px] uppercase tracking-wider">Used</p>
										<p className="mt-1 font-semibold text-[#e2e8f0]">{swap.usedMb} MB</p>
									</div>
									<div className="rounded-lg bg-[#0a0e1a] p-3 text-center">
										<p className="text-[10px] uppercase tracking-wider">Free</p>
										<p className="mt-1 font-semibold text-[#e2e8f0]">{swap.freeMb} MB</p>
									</div>
								</div>
							</div>
						) : (
							<p className="py-4 text-center text-xs text-gray-500">
								{ram?.swapEnabled ? "No swap data available" : "Swap monitoring is disabled"}
							</p>
						)}
					</div>
				</Card>
			</div>

			{/* Worker Status */}
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
									className="flex items-center justify-between rounded-lg bg-[#0a0e1a] p-3">
									<div>
										<p className="text-sm font-medium text-[#e2e8f0]">{w.workerId}</p>
										<p className="text-xs text-gray-500">
											{w.criticality} · paused {formatTime(w.pausedAt)}
										</p>
									</div>
									<button
										onClick={() => handleResumeWorker(w.workerId)}
										className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors">
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
									className="flex items-center justify-between rounded-lg bg-[#0a0e1a] p-3">
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

			{/* RAM History — real data */}
			{hist && hist.samples.length > 0 && (
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<TrendingUp className="h-4 w-4 text-cyan-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">RAM History</span>
						<span className="ml-auto text-xs text-gray-500">{hist.samples.length} real samples</span>
					</div>
					<div className="p-5">
						<div className="flex items-end gap-0.5 h-24">
							{hist.samples.map((s, i) => {
								const barState = ram ? getStateForSample(s, ram.thresholds) : "normal"
								const barColor =
									barState === "danger"
										? "bg-red-500"
										: barState === "critical"
											? "bg-orange-500"
											: barState === "warning"
												? "bg-amber-500"
												: "bg-emerald-500"
								return (
									<div
										key={i}
										className={`flex-1 rounded-t ${barColor} opacity-70 hover:opacity-100 transition-opacity`}
										style={{ height: `${Math.max(5, Math.min(100, s.ramPercent))}%` }}
										title={`${formatTime(s.timestamp)} — ${s.ramPercent}% (${s.usedMb}MB used)`}
									/>
								)
							})}
						</div>
						<div className="mt-2 flex justify-between text-[10px] text-gray-600">
							<span>{formatTime(hist.samples[0].timestamp)}</span>
							<span>{formatTime(hist.samples[hist.samples.length - 1].timestamp)}</span>
						</div>
					</div>
				</Card>
			)}

			{/* Event Log */}
			{eventLog.length > 0 && (
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Activity className="h-4 w-4 text-violet-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Event Log</span>
						<span className="ml-auto text-xs text-gray-500">{eventLog.length} events</span>
					</div>
					<div className="p-5">
						<div className="space-y-2 max-h-60 overflow-y-auto">
							{eventLog.map((e, i) => (
								<div key={i} className="flex items-center gap-3 rounded-lg bg-[#0a0e1a] p-3">
									<StateBadge state={e.state} />
									<div className="flex-1 min-w-0">
										<p className="text-sm text-[#e2e8f0] truncate">{e.event}</p>
										<p className="text-xs text-gray-500">{formatDateTime(e.time)}</p>
									</div>
									<span className="text-xs text-gray-500">{e.ramPercent}%</span>
								</div>
							))}
						</div>
					</div>
				</Card>
			)}

			{/* Alerts */}
			{alertList && alertList.alerts.length > 0 && (
				<Card>
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-5 py-3">
						<Bell className="h-4 w-4 text-rose-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Recent Alerts</span>
						<span className="ml-auto text-xs text-gray-500">{alertList.count} alerts</span>
					</div>
					<div className="p-5">
						<div className="space-y-2 max-h-60 overflow-y-auto">
							{alertList.alerts.map((a, i) => (
								<div key={i} className="flex items-center gap-3 rounded-lg bg-[#0a0e1a] p-3">
									<StateBadge state={a.newState} />
									<div className="flex-1 min-w-0">
										<p className="text-sm text-[#e2e8f0]">
											{a.oldState} → {a.newState}
										</p>
										<p className="text-xs text-gray-500">
											{formatDateTime(a.timestamp)}
											{a.snapshot ? ` · RAM ${a.snapshot.ramPercent}%` : ""}
										</p>
									</div>
								</div>
							))}
						</div>
					</div>
				</Card>
			)}
		</div>
	)
}
