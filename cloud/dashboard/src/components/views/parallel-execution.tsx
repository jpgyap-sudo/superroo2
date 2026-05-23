"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Layers,
	Activity,
	CheckCircle2,
	XCircle,
	Zap,
	RefreshCw,
	Loader2,
	AlertTriangle,
	Cpu,
	Coins,
	Play,
	Square,
	Settings2,
	Clock,
	Radio,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Slot {
	taskId: string
	agentId: string
	startTime: number
	runningFor: number
	estimatedTokens?: number
}

interface ParallelStats {
	maxConcurrency: number
	maxTokenBudget: number
	activeTasks: number
	totalSubmitted: number
	totalCompleted: number
	totalFailed: number
	totalCancelled: number
	currentTokenUsage: number
	tokenBudgetRemaining: number
	agentCosts: Record<string, number>
	isRunning: boolean
	slots: Slot[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatToken(n: number) {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return n.toString()
}

function formatDuration(ms: number) {
	const s = Math.floor(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	const rem = s % 60
	return `${m}m ${rem}s`
}

function getWsUrl() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	return `${protocol}//${window.location.host}/api/brain/ws`
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function ParallelExecutionView() {
	const [stats, setStats] = useState<ParallelStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isStandby, setIsStandby] = useState(false)
	const [actionLoading, setActionLoading] = useState<string | null>(null)
	const [wsConnected, setWsConnected] = useState(false)
	const [draftConfig, setDraftConfig] = useState({ maxConcurrency: 2, maxTokens: 100000 })
	const wsRef = useRef<WebSocket | null>(null)
	const retryCountRef = useRef(0)
	const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// ── Fetch Stats ───────────────────────────────────────────────────────────

	const fetchStats = useCallback(async () => {
		try {
			const res = await fetch("/api/orchestrator/parallel/stats")
			const data = await res.json()
			if (data.success && data.stats) {
				const s = data.stats
				setStats({
					maxConcurrency: s.maxConcurrency ?? 5,
					maxTokenBudget: s.maxTokens ?? 100000,
					activeTasks: s.running ?? 0,
					totalSubmitted: s.totalSubmitted ?? 0,
					totalCompleted: s.totalCompleted ?? 0,
					totalFailed: s.totalFailed ?? 0,
					totalCancelled: s.totalCancelled ?? 0,
					currentTokenUsage: s.currentTokenUsage ?? 0,
					tokenBudgetRemaining: (s.maxTokens ?? 100000) - (s.currentTokenUsage ?? 0),
					agentCosts: s.agentTokenUsage ?? {},
					isRunning: s.isRunning ?? false,
					slots: s.slots ?? [],
				})
				setError(null)
				setIsStandby(false)
				retryCountRef.current = 0
			} else {
				setError(data.error || "Unknown error")
				if (!stats) setIsStandby(true)
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to fetch parallel execution stats"
			setError(msg)
			if (!stats) setIsStandby(true)
		} finally {
			setLoading(false)
		}
	}, [stats])

	// Sync draft config with fetched stats
	useEffect(() => {
		if (stats) {
			setDraftConfig({ maxConcurrency: stats.maxConcurrency, maxTokens: stats.maxTokenBudget })
		}
	}, [stats])

	// ── Polling ───────────────────────────────────────────────────────────────

	useEffect(() => {
		fetchStats()
		const iv = setInterval(fetchStats, 5000)
		return () => clearInterval(iv)
	}, [fetchStats])

	// ── WebSocket (Brain Events) ──────────────────────────────────────────────

	useEffect(() => {
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null

		function connect() {
			try {
				const ws = new WebSocket(getWsUrl())
				wsRef.current = ws

				ws.onopen = () => {
					setWsConnected(true)
					// Subscribe to parallel execution events
					ws.send(JSON.stringify({ action: "subscribe", params: { event: "parallel.*" } }))
					// Heartbeat
					heartbeatTimer = setInterval(() => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ type: "ping" }))
						}
					}, 30000)
				}

				ws.onmessage = (event) => {
					try {
						const msg = JSON.parse(event.data)
						if (msg.type === "event" && msg.event?.startsWith("parallel.")) {
							// Trigger immediate stats refresh on any parallel event
							fetchStats()
						}
					} catch {
						// Ignore malformed messages
					}
				}

				ws.onclose = () => {
					setWsConnected(false)
					if (heartbeatTimer) clearInterval(heartbeatTimer)
					// Reconnect after 5s
					reconnectTimer = setTimeout(connect, 5000)
				}

				ws.onerror = () => {
					setWsConnected(false)
				}
			} catch {
				setWsConnected(false)
				reconnectTimer = setTimeout(connect, 5000)
			}
		}

		connect()
		return () => {
			if (reconnectTimer) clearTimeout(reconnectTimer)
			if (heartbeatTimer) clearInterval(heartbeatTimer)
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
			}
		}
	}, [fetchStats])

	// ── Actions ───────────────────────────────────────────────────────────────

	async function startEngine() {
		setActionLoading("start")
		try {
			const res = await fetch("/api/orchestrator/parallel/start", { method: "POST" })
			const data = await res.json()
			if (data.success) await fetchStats()
			else setError(data.error || "Failed to start engine")
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to start engine")
		} finally {
			setActionLoading(null)
		}
	}

	async function stopEngine() {
		setActionLoading("stop")
		try {
			const res = await fetch("/api/orchestrator/parallel/stop", { method: "POST" })
			const data = await res.json()
			if (data.success) await fetchStats()
			else setError(data.error || "Failed to stop engine")
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to stop engine")
		} finally {
			setActionLoading(null)
		}
	}

	function updateConfig(updates: { maxConcurrency?: number; maxTokens?: number }) {
		if (configDebounceRef.current) clearTimeout(configDebounceRef.current)
		configDebounceRef.current = setTimeout(async () => {
			setActionLoading("config")
			try {
				const res = await fetch("/api/orchestrator/parallel/config", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(updates),
				})
				const data = await res.json()
				if (data.success) await fetchStats()
				else setError(data.error || "Failed to update config")
			} catch (err: unknown) {
				setError(err instanceof Error ? err.message : "Failed to update config")
			} finally {
				setActionLoading(null)
			}
		}, 400)
	}

	// ── Render ────────────────────────────────────────────────────────────────

	if (loading && !stats) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-violet-400" />
			</div>
		)
	}

	// Ghost Mode — engine not initialized yet
	if (isStandby || !stats) {
		return (
			<div className="space-y-5">
				{/* Standby Banner */}
				<Card className="border-amber-800/40 bg-amber-950/20 p-6">
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600/20 text-amber-400">
								<Zap className="h-5 w-5" />
							</div>
							<div>
								<p className="text-amber-300 font-medium">Parallel Execution Engine — Standby</p>
								<p className="text-amber-400/70 text-sm">
									{error || "Engine is sleeping. Click Start Engine to wake it up."}
								</p>
							</div>
						</div>
						<button
							onClick={startEngine}
							disabled={actionLoading === "start"}
							className="rounded-lg bg-amber-700/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-700/60 flex items-center gap-2 disabled:opacity-50">
							{actionLoading === "start" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Play className="h-4 w-4" />
							)}
							Start Engine
						</button>
					</div>
				</Card>

				{/* Skeleton Stats */}
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					{[1, 2, 3, 4].map((i) => (
						<Card key={i} className="h-24 animate-pulse bg-[#1e2535]/50">
							{null}
						</Card>
					))}
				</div>

				{/* Skeleton Token Budget */}
				<Card className="h-32 animate-pulse bg-[#1e2535]/50">{null}</Card>

				{/* Skeleton Agent Costs */}
				<Card className="h-40 animate-pulse bg-[#1e2535]/50">{null}</Card>
			</div>
		)
	}

	const s = stats
	const tokenPct = s.maxTokenBudget > 0 ? Math.round((s.currentTokenUsage / s.maxTokenBudget) * 100) : 0
	const agentCostEntries = Object.entries(s.agentCosts || {})
	const maxAgentCost = agentCostEntries.length > 0 ? Math.max(...agentCostEntries.map(([, v]) => v)) : 1

	return (
		<div className="space-y-5">
			{/* Header */}
			<Card className="flex flex-col gap-4">
				<div className="flex items-center justify-between flex-wrap gap-3">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/20 text-cyan-400">
							<Layers className="h-5 w-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Parallel Execution Engine</h2>
							<p className="text-[11px] text-gray-500">
								Concurrent task execution with token budget management
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{wsConnected && (
							<span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border bg-emerald-900/30 text-emerald-400 border-emerald-800/40">
								<Radio className="h-3 w-3 mr-1" />
								Live
							</span>
						)}
						{s.isRunning ? (
							<span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border bg-emerald-900/30 text-emerald-400 border-emerald-800/40">
								Running
							</span>
						) : (
							<span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border bg-amber-900/30 text-amber-400 border-amber-800/40">
								Stopped
							</span>
						)}
						<button
							onClick={fetchStats}
							className="rounded-lg bg-[#1e2535] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0] flex items-center gap-1.5">
							<RefreshCw className="h-3 w-3" />
							Refresh
						</button>
					</div>
				</div>
			</Card>

			{/* Engine Controls */}
			<Card>
				<div className="flex items-center gap-2 mb-4">
					<Settings2 className="h-4 w-4 text-violet-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Engine Controls</span>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					{s.isRunning ? (
						<button
							onClick={stopEngine}
							disabled={actionLoading === "stop"}
							className="rounded-lg bg-red-900/30 px-4 py-2 text-sm text-red-300 hover:bg-red-900/50 flex items-center gap-2 disabled:opacity-50">
							{actionLoading === "stop" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Square className="h-4 w-4" />
							)}
							Stop Engine
						</button>
					) : (
						<button
							onClick={startEngine}
							disabled={actionLoading === "start"}
							className="rounded-lg bg-emerald-900/30 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-900/50 flex items-center gap-2 disabled:opacity-50">
							{actionLoading === "start" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Play className="h-4 w-4" />
							)}
							Start Engine
						</button>
					)}

					<div className="flex items-center gap-2">
						<span className="text-xs text-gray-500">Concurrency</span>
						<input
							type="range"
							min={1}
							max={20}
							value={draftConfig.maxConcurrency}
							onChange={(e) => {
								const val = Number(e.target.value)
								setDraftConfig((prev) => ({ ...prev, maxConcurrency: val }))
								updateConfig({ maxConcurrency: val })
							}}
							className="w-24 accent-cyan-500"
						/>
						<span className="text-xs text-cyan-400 font-mono w-6">{s.maxConcurrency}</span>
					</div>

					<div className="flex items-center gap-2">
						<span className="text-xs text-gray-500">Token Budget</span>
						<input
							type="number"
							min={1000}
							step={1000}
							value={draftConfig.maxTokens}
							onChange={(e) => {
								const val = Number(e.target.value)
								setDraftConfig((prev) => ({ ...prev, maxTokens: val }))
								updateConfig({ maxTokens: val })
							}}
							className="w-24 rounded bg-[#1e2535] border border-[#2a3142] px-2 py-1 text-xs text-[#e2e8f0]"
						/>
					</div>
				</div>
			</Card>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard
					label="Active Tasks"
					value={
						<span className="flex items-center gap-2">
							<span
								className={cn(
									"h-2 w-2 rounded-full",
									s.activeTasks > 0 ? "bg-blue-500 animate-pulse" : "bg-gray-600",
								)}
							/>
							{s.activeTasks}
						</span>
					}
					color={s.activeTasks > 0 ? "text-blue-400" : "text-gray-400"}
				/>
				<StatCard label="Total Submitted" value={s.totalSubmitted} color="text-[#e2e8f0]" />
				<StatCard
					label="Completed"
					value={s.totalCompleted}
					sub={`${s.totalSubmitted > 0 ? Math.round((s.totalCompleted / s.totalSubmitted) * 100) : 0}% success rate`}
					color="text-emerald-400"
				/>
				<StatCard
					label="Failed"
					value={s.totalFailed}
					sub={s.totalCancelled > 0 ? `${s.totalCancelled} cancelled` : undefined}
					color={s.totalFailed > 0 ? "text-red-400" : "text-gray-400"}
				/>
			</div>

			{/* Token Budget Bar */}
			<Card>
				<div className="flex items-center gap-2 mb-3">
					<Zap className="h-4 w-4 text-amber-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Token Budget</span>
				</div>
				<div className="space-y-2">
					<div className="flex justify-between text-[11px] text-gray-500">
						<span>
							Using {formatToken(s.currentTokenUsage)} / {formatToken(s.maxTokenBudget)} tokens
						</span>
						<span>{tokenPct}%</span>
					</div>
					<div className="h-3 w-full rounded-full bg-[#1e2535] overflow-hidden">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-500",
								tokenPct > 90 ? "bg-red-500" : tokenPct > 70 ? "bg-amber-500" : "bg-cyan-500",
							)}
							style={{ width: `${Math.min(tokenPct, 100)}%` }}
						/>
					</div>
					<div className="flex justify-between text-[11px] text-gray-600">
						<span>Max concurrency: {s.maxConcurrency}</span>
						<span>{formatToken(s.tokenBudgetRemaining)} remaining</span>
					</div>
				</div>
			</Card>

			{/* Running Slots Table */}
			<Card>
				<div className="flex items-center gap-2 mb-3">
					<Cpu className="h-4 w-4 text-blue-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Running Slots</span>
					{s.slots.length > 0 && (
						<span className="ml-auto inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide border bg-blue-900/30 text-blue-400 border-blue-800/40">
							{s.slots.length} active
						</span>
					)}
				</div>
				{s.slots.length === 0 ? (
					<div className="py-6 text-center text-sm text-gray-500">No active tasks</div>
				) : (
					<div className="space-y-2">
						{s.slots.map((slot) => (
							<div
								key={slot.taskId}
								className="flex items-center gap-3 rounded-lg bg-[#1e2535]/40 px-3 py-2">
								<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-400 shrink-0">
									<Clock className="h-4 w-4" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium text-[#e2e8f0] truncate">
											{slot.taskId}
										</span>
										<span className="text-xs text-gray-500 shrink-0">
											{formatDuration(slot.runningFor)}
										</span>
									</div>
									<div className="flex items-center gap-2 text-[11px] text-gray-500">
										<span className="text-cyan-400">{slot.agentId}</span>
										{slot.estimatedTokens !== undefined && (
											<span>· {formatToken(slot.estimatedTokens)} tokens</span>
										)}
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</Card>

			{/* Agent Token Costs Table */}
			<Card>
				<div className="flex items-center gap-2 mb-3">
					<Coins className="h-4 w-4 text-emerald-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Agent Token Costs</span>
				</div>
				{agentCostEntries.length === 0 ? (
					<div className="py-6 text-center text-sm text-gray-500">No agent cost data available</div>
				) : (
					<div className="space-y-2">
						{agentCostEntries.map(([agent, cost]) => {
							const pct = Math.round((cost / maxAgentCost) * 100)
							return (
								<div key={agent} className="flex items-center gap-3">
									<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-400 shrink-0">
										<Cpu className="h-4 w-4" />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center justify-between mb-1">
											<span className="text-sm font-medium text-[#e2e8f0] capitalize">
												{agent}
											</span>
											<span className="text-sm text-gray-400">{formatToken(cost)} tokens</span>
										</div>
										<div className="h-1.5 w-full rounded-full bg-[#1e2535]">
											<div
												className="h-full rounded-full bg-cyan-500 transition-all duration-500"
												style={{ width: `${pct}%` }}
											/>
										</div>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</Card>

			{/* Summary Footer */}
			<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<Activity className="h-3.5 w-3.5 text-cyan-400" />
						{s.activeTasks} active · {s.totalSubmitted} total submitted
					</span>
					<span className="flex items-center gap-1.5">
						<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
						{s.totalCompleted} completed
					</span>
					<span className="flex items-center gap-1.5">
						<XCircle className="h-3.5 w-3.5 text-red-400" />
						{s.totalFailed} failed
					</span>
					<span className="flex items-center gap-1.5">
						<Zap className="h-3.5 w-3.5 text-amber-400" />
						{formatToken(s.currentTokenUsage)} / {formatToken(s.maxTokenBudget)} tokens
					</span>
				</div>
			</div>
		</div>
	)
}
