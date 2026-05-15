"use client"

import { useState, useEffect, useCallback } from "react"
import {
	BrainCircuit,
	Activity,
	BarChart3,
	Database,
	Upload,
	Download,
	RefreshCw,
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Loader2,
	TrendingUp,
	Layers,
	Play,
	StopCircle,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ── Types ────────────────────────────────────────────────────────────────────

interface ImprovementLoopStats {
	iteration: number
	totalSamples: number
	lastTrainLoss: number
	predictionsMade: number
	actionsTaken: number
	actionHelpRate: number
	lastMetrics: Record<string, any>
	running: boolean
}

interface SyncStatus {
	lastUploadAt: number | null
	lastDownloadAt: number | null
	lastObservationSyncAt: number | null
	totalUploads: number
	totalDownloads: number
	totalObservationsSynced: number
	pendingObservations: number
	isOnline: boolean
	lastError: string | null
}

interface ObservationStats {
	total: number
	byType: { task_type: string; count: number }[]
}

interface ModelInfo {
	id: string
	modelType: string
	source: string
	trainingSamples: number
	featureDimensions: number
	isMerged: boolean
	createdAt: number
}

interface ModelStats {
	total: number
	merged: number
	latest: ModelInfo | null
}

interface SyncStats {
	total: number
	failed: number
}

interface MlStatus {
	improvementLoop: ImprovementLoopStats | null
	syncStatus: SyncStatus | null
	observations: ObservationStats | null
	models: ModelStats | null
	orchestratorReady: boolean
	syncStats: SyncStats | null
	dbError?: string
}

interface Observation {
	id: string
	taskType: string
	inputSummary: string
	outputSummary: string
	success: boolean
	durationMs: number
	source: string
	sessionId: string | null
	createdAt: number
}

interface SyncLogEntry {
	id: string
	direction: string
	status: string
	modelId: string
	modelType: string
	featureDimensions: number
	trainingSamples: number
	source: string
	target: string
	payloadSizeBytes: number
	createdAt: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number | null | undefined): string {
	if (!ts) return "—"
	const d = new Date(ts)
	return d.toLocaleString()
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
	return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatCompact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
	label,
	value,
	icon: Icon,
	color,
}: {
	label: string
	value: string
	icon: React.ComponentType<{ className?: string }>
	color: string
}) {
	return (
		<Card className="flex items-center gap-3 border-[#1e2535] bg-[#0f1117] p-3">
			<div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
				<Icon className="h-4 w-4" />
			</div>
			<div className="min-w-0">
				<div className="truncate text-[11px] text-gray-500">{label}</div>
				<div className="text-sm font-semibold text-[#e2e8f0]">{value}</div>
			</div>
		</Card>
	)
}

function StatusDot({ active }: { active: boolean }) {
	return (
		<span
			className={`inline-block h-2 w-2 rounded-full ${
				active ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-gray-600"
			}`}
		/>
	)
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
	return (
		<div className="mb-3 flex items-center gap-2">
			<Icon className="h-4 w-4 text-cyan-400" />
			<h2 className="text-sm font-semibold text-[#e2e8f0]">{title}</h2>
		</div>
	)
}

// ── Main View ────────────────────────────────────────────────────────────────

export function MlView() {
	const [status, setStatus] = useState<MlStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [observations, setObservations] = useState<Observation[]>([])
	const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([])
	const [activeTab, setActiveTab] = useState<"overview" | "observations" | "sync-log">("overview")
	const [triggering, setTriggering] = useState(false)

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/ml/status")
			const data = await res.json()
			if (data.success) {
				setStatus(data.status)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch ML status")
		} finally {
			setLoading(false)
		}
	}, [])

	const fetchObservations = useCallback(async () => {
		try {
			const res = await fetch("/api/ml/observations?limit=20")
			const data = await res.json()
			if (data.success) {
				setObservations(data.observations)
			}
		} catch {
			// Non-critical
		}
	}, [])

	const fetchSyncLogs = useCallback(async () => {
		try {
			const res = await fetch("/api/ml/sync-log?limit=20")
			const data = await res.json()
			if (data.success) {
				setSyncLogs(data.logs)
			}
		} catch {
			// Non-critical
		}
	}, [])

	useEffect(() => {
		fetchStatus()
		fetchObservations()
		fetchSyncLogs()
		const iv = setInterval(() => {
			fetchStatus()
		}, 15000)
		return () => clearInterval(iv)
	}, [fetchStatus, fetchObservations, fetchSyncLogs])

	const handleTriggerTrain = async () => {
		setTriggering(true)
		try {
			await fetch("/api/ml/trigger-train", { method: "POST" })
			await fetchStatus()
		} catch {
			// Non-critical
		} finally {
			setTriggering(false)
		}
	}

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
				<span className="ml-3 text-sm text-gray-500">Loading ML Engine status...</span>
			</div>
		)
	}

	if (error && !status) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-3">
				<AlertTriangle className="h-8 w-8 text-amber-400" />
				<p className="text-sm text-gray-500">{error}</p>
				<button
					onClick={fetchStatus}
					className="flex items-center gap-1.5 rounded border border-[#1e2535] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0]">
					<RefreshCw className="h-3 w-3" />
					Retry
				</button>
			</div>
		)
	}

	const loop = status?.improvementLoop
	const sync = status?.syncStatus
	const obs = status?.observations
	const models = status?.models

	return (
		<div className="space-y-6">
			{/* ── Status Bar ──────────────────────────────────────────────────── */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<StatusDot active={!!status?.orchestratorReady} />
					<span className="text-xs text-gray-500">Orchestrator</span>
				</div>
				<div className="flex items-center gap-2">
					<StatusDot active={!!loop?.running} />
					<span className="text-xs text-gray-500">Improvement Loop</span>
				</div>
				<div className="flex items-center gap-2">
					<StatusDot active={!!sync?.isOnline} />
					<span className="text-xs text-gray-500">ML Sync</span>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<button
						onClick={handleTriggerTrain}
						disabled={triggering || !loop?.running}
						className="flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 transition-all hover:bg-cyan-500/20 disabled:opacity-40">
						{triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
						Trigger Training
					</button>
				</div>
			</div>

			{/* ── Stats Grid ──────────────────────────────────────────────────── */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<StatCard
					label="Loop Iterations"
					value={formatCompact(loop?.iteration ?? 0)}
					icon={Activity}
					color="bg-cyan-500/10 text-cyan-400"
				/>
				<StatCard
					label="Total Samples"
					value={formatCompact(loop?.totalSamples ?? 0)}
					icon={Database}
					color="bg-violet-500/10 text-violet-400"
				/>
				<StatCard
					label="Predictions Made"
					value={formatCompact(loop?.predictionsMade ?? 0)}
					icon={TrendingUp}
					color="bg-emerald-500/10 text-emerald-400"
				/>
				<StatCard
					label="Actions Taken"
					value={formatCompact(loop?.actionsTaken ?? 0)}
					icon={Layers}
					color="bg-amber-500/10 text-amber-400"
				/>
				<StatCard
					label="Observations"
					value={formatCompact(obs?.total ?? 0)}
					icon={BarChart3}
					color="bg-rose-500/10 text-rose-400"
				/>
			</div>

			{/* ── Tabs ────────────────────────────────────────────────────────── */}
			<div className="flex gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-1">
				{(["overview", "observations", "sync-log"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-all ${
							activeTab === tab ? "bg-[#1e2535] text-[#e2e8f0]" : "text-gray-500 hover:text-[#e2e8f0]"
						}`}>
						{tab === "overview" ? "Overview" : tab === "observations" ? "Observations" : "Sync Log"}
					</button>
				))}
			</div>

			{/* ── Tab: Overview ────────────────────────────────────────────────── */}
			{activeTab === "overview" && (
				<div className="grid gap-6 lg:grid-cols-2">
					{/* Improvement Loop */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<SectionHeader title="Improvement Loop" icon={BrainCircuit} />
						{loop ? (
							<div className="space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">Status</div>
										<div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
											<StatusDot active={loop.running} />
											<span className={loop.running ? "text-emerald-400" : "text-gray-400"}>
												{loop.running ? "Running" : "Stopped"}
											</span>
										</div>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">
											Last Train Loss
										</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">
											{loop.lastTrainLoss ? loop.lastTrainLoss.toFixed(4) : "—"}
										</div>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">
											Action Help Rate
										</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">
											{(loop.actionHelpRate * 100).toFixed(1)}%
										</div>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">
											Confidence Threshold
										</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">75%</div>
									</div>
								</div>

								{/* Last Metrics */}
								{Object.keys(loop.lastMetrics).length > 0 && (
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">
											Last Metrics
										</div>
										<div className="space-y-1">
											{Object.entries(loop.lastMetrics).map(([key, val]) => (
												<div key={key} className="flex items-center justify-between text-xs">
													<span className="text-gray-400">{key}</span>
													<span className="text-[#e2e8f0]">
														{typeof val === "object" && val !== null
															? JSON.stringify(val).slice(0, 60)
															: String(val ?? "—")}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						) : (
							<div className="flex items-center justify-center py-8 text-sm text-gray-600">
								Improvement loop not initialized
							</div>
						)}
					</Card>

					{/* ML Sync Status */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<SectionHeader title="ML Sync" icon={Upload} />
						{sync ? (
							<div className="space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">Status</div>
										<div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
											<StatusDot active={sync.isOnline} />
											<span className={sync.isOnline ? "text-emerald-400" : "text-amber-400"}>
												{sync.isOnline ? "Online" : "Offline"}
											</span>
										</div>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">
											Pending Observations
										</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">
											{sync.pendingObservations}
										</div>
									</div>
								</div>

								<div className="space-y-2">
									<div className="flex items-center justify-between rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 px-3 py-2">
										<div className="flex items-center gap-2 text-xs text-gray-400">
											<Upload className="h-3 w-3" />
											<span>Total Uploads</span>
										</div>
										<span className="text-xs font-medium text-[#e2e8f0]">{sync.totalUploads}</span>
									</div>
									<div className="flex items-center justify-between rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 px-3 py-2">
										<div className="flex items-center gap-2 text-xs text-gray-400">
											<Download className="h-3 w-3" />
											<span>Total Downloads</span>
										</div>
										<span className="text-xs font-medium text-[#e2e8f0]">
											{sync.totalDownloads}
										</span>
									</div>
									<div className="flex items-center justify-between rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 px-3 py-2">
										<div className="flex items-center gap-2 text-xs text-gray-400">
											<Database className="h-3 w-3" />
											<span>Observations Synced</span>
										</div>
										<span className="text-xs font-medium text-[#e2e8f0]">
											{sync.totalObservationsSynced}
										</span>
									</div>
								</div>

								{sync.lastError && (
									<div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2">
										<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
										<span className="text-xs text-red-300">{sync.lastError}</span>
									</div>
								)}

								<div className="grid grid-cols-2 gap-2 text-[10px] text-gray-600">
									<div>
										Last Upload:{" "}
										<span className="text-gray-400">{formatTime(sync.lastUploadAt)}</span>
									</div>
									<div>
										Last Download:{" "}
										<span className="text-gray-400">{formatTime(sync.lastDownloadAt)}</span>
									</div>
								</div>
							</div>
						) : (
							<div className="flex items-center justify-center py-8 text-sm text-gray-600">
								ML Sync not configured
							</div>
						)}
					</Card>

					{/* Models */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<SectionHeader title="Models" icon={Layers} />
						{models ? (
							<div className="space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">
											Total Models
										</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">{models.total}</div>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="text-[10px] uppercase tracking-wider text-gray-500">Merged</div>
										<div className="mt-1 text-sm font-medium text-[#e2e8f0]">{models.merged}</div>
									</div>
								</div>

								{models.latest && (
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a]/60 p-3">
										<div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">
											Latest Model
										</div>
										<div className="space-y-1 text-xs">
											<div className="flex justify-between">
												<span className="text-gray-400">Type</span>
												<span className="text-[#e2e8f0]">{models.latest.modelType}</span>
											</div>
											<div className="flex justify-between">
												<span className="text-gray-400">Source</span>
												<span className="text-[#e2e8f0]">{models.latest.source}</span>
											</div>
											<div className="flex justify-between">
												<span className="text-gray-400">Samples</span>
												<span className="text-[#e2e8f0]">{models.latest.trainingSamples}</span>
											</div>
											<div className="flex justify-between">
												<span className="text-gray-400">Dimensions</span>
												<span className="text-[#e2e8f0]">
													{models.latest.featureDimensions}
												</span>
											</div>
											<div className="flex justify-between">
												<span className="text-gray-400">Merged</span>
												<span className="text-[#e2e8f0]">
													{models.latest.isMerged ? (
														<CheckCircle2 className="inline h-3 w-3 text-emerald-400" />
													) : (
														<XCircle className="inline h-3 w-3 text-gray-500" />
													)}
												</span>
											</div>
										</div>
									</div>
								)}
							</div>
						) : (
							<div className="flex items-center justify-center py-8 text-sm text-gray-600">
								No models uploaded yet
							</div>
						)}
					</Card>

					{/* Observations by Type */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<SectionHeader title="Observations by Type" icon={BarChart3} />
						{obs && obs.byType.length > 0 ? (
							<div className="space-y-2">
								{obs.byType.map((item) => {
									const maxCount = Math.max(...obs.byType.map((o) => o.count))
									const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0
									return (
										<div key={item.task_type} className="space-y-1">
											<div className="flex items-center justify-between text-xs">
												<span className="text-gray-400">{item.task_type}</span>
												<span className="font-medium text-[#e2e8f0]">{item.count}</span>
											</div>
											<div className="h-1.5 overflow-hidden rounded-full bg-[#1e2535]">
												<div
													className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all"
													style={{ width: `${pct}%` }}
												/>
											</div>
										</div>
									)
								})}
							</div>
						) : (
							<div className="flex items-center justify-center py-8 text-sm text-gray-600">
								No observations recorded yet
							</div>
						)}
					</Card>
				</div>
			)}

			{/* ── Tab: Observations ────────────────────────────────────────────── */}
			{activeTab === "observations" && (
				<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
					<SectionHeader title="Recent Observations" icon={Database} />
					{observations.length === 0 ? (
						<div className="flex items-center justify-center py-8 text-sm text-gray-600">
							No observations recorded yet
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-gray-500">
										<th className="px-3 py-2">Type</th>
										<th className="px-3 py-2">Input</th>
										<th className="px-3 py-2">Output</th>
										<th className="px-3 py-2">Status</th>
										<th className="px-3 py-2">Duration</th>
										<th className="px-3 py-2">Source</th>
										<th className="px-3 py-2">Time</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[#1e2535]">
									{observations.map((obs) => (
										<tr key={obs.id} className="hover:bg-[#0a0e1a]/40">
											<td className="px-3 py-2">
												<Badge status="info" label={obs.taskType} />
											</td>
											<td className="max-w-[200px] truncate px-3 py-2 text-gray-400">
												{obs.inputSummary || "—"}
											</td>
											<td className="max-w-[200px] truncate px-3 py-2 text-gray-400">
												{obs.outputSummary || "—"}
											</td>
											<td className="px-3 py-2">
												{obs.success ? (
													<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
												) : (
													<XCircle className="h-3.5 w-3.5 text-red-400" />
												)}
											</td>
											<td className="px-3 py-2 text-gray-400">
												{formatDuration(obs.durationMs)}
											</td>
											<td className="px-3 py-2 text-gray-400">{obs.source}</td>
											<td className="px-3 py-2 text-gray-500">{formatTime(obs.createdAt)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			)}

			{/* ── Tab: Sync Log ────────────────────────────────────────────────── */}
			{activeTab === "sync-log" && (
				<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
					<SectionHeader title="Sync History" icon={RefreshCw} />
					{syncLogs.length === 0 ? (
						<div className="flex items-center justify-center py-8 text-sm text-gray-600">
							No sync activity yet
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-gray-500">
										<th className="px-3 py-2">Direction</th>
										<th className="px-3 py-2">Status</th>
										<th className="px-3 py-2">Model Type</th>
										<th className="px-3 py-2">Samples</th>
										<th className="px-3 py-2">Source</th>
										<th className="px-3 py-2">Target</th>
										<th className="px-3 py-2">Size</th>
										<th className="px-3 py-2">Time</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[#1e2535]">
									{syncLogs.map((log) => (
										<tr key={log.id} className="hover:bg-[#0a0e1a]/40">
											<td className="px-3 py-2">
												<div className="flex items-center gap-1.5">
													{log.direction === "upload" ? (
														<Upload className="h-3 w-3 text-cyan-400" />
													) : (
														<Download className="h-3 w-3 text-violet-400" />
													)}
													<span className="text-gray-300">{log.direction}</span>
												</div>
											</td>
											<td className="px-3 py-2">
												{log.status === "completed" ? (
													<span className="text-emerald-400">✓ Completed</span>
												) : log.status === "failed" ? (
													<span className="text-red-400">✗ Failed</span>
												) : (
													<span className="text-amber-400">⟳ {log.status}</span>
												)}
											</td>
											<td className="px-3 py-2 text-gray-400">{log.modelType || "—"}</td>
											<td className="px-3 py-2 text-gray-400">{log.trainingSamples}</td>
											<td className="px-3 py-2 text-gray-400">{log.source}</td>
											<td className="px-3 py-2 text-gray-400">{log.target}</td>
											<td className="px-3 py-2 text-gray-400">
												{log.payloadSizeBytes ? formatCompact(log.payloadSizeBytes) + "B" : "—"}
											</td>
											<td className="px-3 py-2 text-gray-500">{formatTime(log.createdAt)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			)}
		</div>
	)
}
