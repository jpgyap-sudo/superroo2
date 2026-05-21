"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParallelStats {
	maxConcurrency: number
	maxTokenBudget: number
	activeTasks: number
	totalSubmitted: number
	totalCompleted: number
	totalFailed: number
	currentTokenUsage: number
	tokenBudgetRemaining: number
	agentCosts: Record<string, number>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatToken(n: number) {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return n.toString()
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function ParallelExecutionView() {
	const [stats, setStats] = useState<ParallelStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchStats = useCallback(async () => {
		try {
			const res = await fetch("/api/orchestrator/parallel/stats")
			const data = await res.json()
			if (data.success && data.stats) {
				// Map backend stats shape to frontend interface
				const s = data.stats
				setStats({
					maxConcurrency: s.maxConcurrency ?? 5,
					maxTokenBudget: s.maxTokens ?? 100000,
					activeTasks: s.running ?? 0,
					totalSubmitted: s.totalSubmitted ?? 0,
					totalCompleted: s.totalCompleted ?? 0,
					totalFailed: s.totalFailed ?? 0,
					currentTokenUsage: s.currentTokenUsage ?? 0,
					tokenBudgetRemaining: (s.maxTokens ?? 100000) - (s.currentTokenUsage ?? 0),
					agentCosts: s.agentTokenUsage ?? {},
				})
				setError(null)
			} else {
				setError(data.error || "Unknown error")
			}
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to fetch parallel execution stats")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchStats()
		const iv = setInterval(fetchStats, 10000)
		return () => clearInterval(iv)
	}, [fetchStats])

	if (loading && !stats) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-violet-400" />
			</div>
		)
	}

	if (error && !stats) {
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load parallel execution stats: {error}</p>
				</div>
				<button
					onClick={fetchStats}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const s = stats!
	const tokenPct = s.maxTokenBudget > 0 ? Math.round((s.currentTokenUsage / s.maxTokenBudget) * 100) : 0
	const agentCostEntries = Object.entries(s.agentCosts || {})
	const maxAgentCost = agentCostEntries.length > 0 ? Math.max(...agentCostEntries.map(([, v]) => v)) : 1

	return (
		<div className="space-y-5">
			{/* Header */}
			<Card className="flex flex-col gap-4">
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
							style={{ width: `${tokenPct}%` }}
						/>
					</div>
					<div className="flex justify-between text-[11px] text-gray-600">
						<span>Max concurrency: {s.maxConcurrency}</span>
						<span>{formatToken(s.tokenBudgetRemaining)} remaining</span>
					</div>
				</div>
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
