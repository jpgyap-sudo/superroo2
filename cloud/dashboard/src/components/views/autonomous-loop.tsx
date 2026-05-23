"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Play,
	Square,
	RefreshCw,
	CheckCircle2,
	XCircle,
	Clock,
	Zap,
	Activity,
	Loader2,
	AlertTriangle,
	RotateCcw,
	Timer,
	Download,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepResult {
	step: string
	status: "passed" | "failed" | "running" | "skipped"
	duration: number
	details: string
}

interface AutonomousStatus {
	running: boolean
	currentStep: string
	stepResults: StepResult[]
	cycleCount: number
	lastRunAt: string | null
	elapsedMs: number
	remainingMs: number
	progress: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTONOMOUS_STEPS = [
	"audit",
	"fix",
	"test",
	"simulate",
	"improve",
	"learn",
	"dashboard",
	"commit",
	"deploy",
	"health-check",
]

const STEP_LABELS: Record<string, string> = {
	audit: "Audit",
	fix: "Fix",
	test: "Test",
	simulate: "Simulate",
	improve: "Improve",
	learn: "Learn",
	dashboard: "Dashboard",
	commit: "Commit",
	deploy: "Deploy",
	"health-check": "Health Check",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
	if (!ms || ms < 0) return "—"
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	if (m > 0) return `${m}m ${s % 60}s`
	return `${s}s`
}

function formatTime(ts: string | null) {
	if (!ts) return "—"
	return new Date(ts).toLocaleString()
}

// ── Main View ─────────────────────────────────────────────────────────────────

async function readJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
	const contentType = res.headers.get("content-type") || ""
	if (!contentType.toLowerCase().includes("application/json")) {
		const body = await res.text().catch(() => "")
		const preview = body.replace(/\s+/g, " ").trim().slice(0, 160)
		const detail = preview ? ` Body preview: ${preview}` : ""
		throw new Error(`${fallbackMessage} (HTTP ${res.status}, ${contentType || "unknown content type"}).${detail}`)
	}
	return (await res.json()) as T
}

function handleExportAutonomous(status: AutonomousStatus) {
	const csv = ["step,status,duration_ms,details"]
	;(status.stepResults || []).forEach((r) => {
		csv.push(`${r.step},${r.status},${r.duration},"${r.details.replace(/"/g, '""')}"`)
	})
	const blob = new Blob([csv.join("\n")], { type: "text/csv" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `autonomous-loop-${new Date().toISOString().slice(0, 10)}.csv`
	a.click()
	URL.revokeObjectURL(url)
}

export function AutonomousLoopView() {
	const [status, setStatus] = useState<AutonomousStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [actionLoading, setActionLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)

	const getAuthHeaders = useCallback((): Record<string, string> => {
		const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
		return token ? { Authorization: `Bearer ${token}` } : {}
	}, [])

	const handleAuthError = useCallback((res: Response) => {
		if (res.status === 401) {
			localStorage.removeItem("superroo_auth_token")
			window.location.reload()
		}
	}, [])

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/autonomous/status", { headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await readJsonResponse<AutonomousStatus & { success?: boolean; error?: string }>(
				res,
				"Autonomous loop status returned a non-JSON response",
			)
			if (data.success) {
				setStatus(data)
				setError(null)
			} else {
				setError(data.error || `Autonomous loop status failed with HTTP ${res.status}`)
			}
		} catch (err: unknown) {
			// Swallow polling errors when we already have data; only show on first load.
			const message = err instanceof Error ? err.message : "Failed to connect to the autonomous loop API."
			setStatus((prev) => {
				if (!prev) setError(message)
				return prev
			})
		} finally {
			setLoading(false)
		}
	}, [getAuthHeaders, handleAuthError])

	useEffect(() => {
		fetchStatus()
		const iv = setInterval(fetchStatus, 5000)
		return () => clearInterval(iv)
	}, [fetchStatus])

	const handleStart = async () => {
		setActionLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/autonomous/start", { method: "POST", headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await readJsonResponse<{ success?: boolean; error?: string }>(
				res,
				"Autonomous loop start returned a non-JSON response",
			)
			if (!data.success) setError(data.error || "Failed to start autonomous loop")
			await fetchStatus()
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Network error")
		} finally {
			setActionLoading(false)
		}
	}

	const handleStop = async () => {
		setActionLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/autonomous/stop", { method: "POST", headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await readJsonResponse<{ success?: boolean; error?: string }>(
				res,
				"Autonomous loop stop returned a non-JSON response",
			)
			if (!data.success) setError(data.error || "Failed to stop autonomous loop")
			await fetchStatus()
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Network error")
		} finally {
			setActionLoading(false)
		}
	}

	if (loading && !status) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-violet-400" />
			</div>
		)
	}

	if (error && !status) {
		const isApiDown =
			error.includes("not responding") || error.includes("connect") || error.includes("unexpected response")
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<div>
						<p className="text-red-300">
							{isApiDown
								? "Cannot reach the API server. Check that superroo-api is running on the VPS."
								: `Failed to load autonomous loop status: ${error}`}
						</p>
						<p className="text-[11px] text-red-400/70 mt-1">
							{isApiDown
								? "ssh root@100.64.175.88 then: pm2 status"
								: "Try refreshing — if this persists, the session may have expired."}
						</p>
					</div>
				</div>
				<button
					onClick={fetchStatus}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const s = status!
	const isRunning = s.running
	const completedSteps = s.stepResults?.filter((r) => r.status === "passed").length ?? 0
	const failedSteps = s.stepResults?.filter((r) => r.status === "failed").length ?? 0

	return (
		<div className="space-y-5">
			{/* Header / Controls */}
			<Card className="flex flex-col gap-4">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400">
							<RotateCcw className="h-5 w-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Autonomous Loop</h2>
							<p className="text-[11px] text-gray-500">
								10-step self-improvement cycle: Audit → Fix → Test → Deploy → Health Check
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={() => handleExportAutonomous(s)}
							disabled={!s.stepResults || s.stepResults.length === 0}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
							<Download size={12} />
							Export CSV
						</button>
						<button
							onClick={async () => {
								setRefreshing(true)
								await fetchStatus()
								setRefreshing(false)
							}}
							disabled={loading || refreshing}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
							<RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
							Refresh
						</button>
						{isRunning ? (
							<button
								onClick={handleStop}
								disabled={actionLoading}
								className="inline-flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors">
								{actionLoading ? (
									<RefreshCw className="h-4 w-4 animate-spin" />
								) : (
									<Square className="h-4 w-4" />
								)}
								Stop
							</button>
						) : (
							<button
								onClick={handleStart}
								disabled={actionLoading}
								className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/20 px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors">
								{actionLoading ? (
									<RefreshCw className="h-4 w-4 animate-spin" />
								) : (
									<Play className="h-4 w-4" />
								)}
								Start Loop
							</button>
						)}
					</div>
				</div>

				{error && (
					<div className="rounded-lg bg-red-600/10 border border-red-600/30 px-3 py-2 text-sm text-red-400">
						{error}
					</div>
				)}
			</Card>

			{/* Stats */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard
					label="Status"
					value={
						<span className="flex items-center gap-2">
							<span
								className={cn(
									"h-2 w-2 rounded-full",
									isRunning ? "bg-blue-500 animate-pulse" : "bg-gray-600",
								)}
							/>
							{isRunning ? "Running" : "Idle"}
						</span>
					}
					color={isRunning ? "text-blue-400" : "text-gray-400"}
				/>
				<StatCard
					label="Current Step"
					value={
						s.currentStep ? (
							<span className="capitalize">{STEP_LABELS[s.currentStep] || s.currentStep}</span>
						) : (
							"—"
						)
					}
					color="text-[#e2e8f0]"
				/>
				<StatCard label="Cycle Count" value={s.cycleCount} color="text-violet-400" />
				<StatCard
					label="Last Run"
					value={s.lastRunAt ? new Date(s.lastRunAt).toLocaleDateString() : "—"}
					sub={s.lastRunAt ? new Date(s.lastRunAt).toLocaleTimeString() : undefined}
					color="text-gray-400"
				/>
			</div>

			{/* Progress bar — only visible while running */}
			{isRunning && (
				<div className="rounded-lg border border-violet-800/30 bg-violet-950/20 px-4 py-3 space-y-2">
					<div className="flex items-center justify-between text-xs">
						<span className="flex items-center gap-1.5 text-violet-300">
							<Zap className="h-3.5 w-3.5" />
							Step {s.progress}% complete
						</span>
						<span className="text-gray-500">
							{s.elapsedMs > 0 && (
								<>
									<span className="text-gray-400">{formatDuration(s.elapsedMs)}</span>
									{s.remainingMs > 0 && (
										<span className="ml-2 text-gray-600">
											· {formatDuration(s.remainingMs)} left
										</span>
									)}
								</>
							)}
						</span>
					</div>
					<div className="h-1.5 w-full rounded-full bg-violet-900/40 overflow-hidden">
						<div
							className="h-full rounded-full bg-violet-500 transition-all duration-500"
							style={{ width: `${s.progress}%` }}
						/>
					</div>
				</div>
			)}

			{/* Step Timeline */}
			<Card>
				<div className="flex items-center gap-2 mb-4">
					<Activity className="h-4 w-4 text-violet-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Step Timeline</span>
					<span className="ml-auto text-[11px] text-gray-500">
						{completedSteps} passed · {failedSteps} failed
					</span>
				</div>
				<div className="space-y-1">
					{AUTONOMOUS_STEPS.map((stepName, idx) => {
						const result = s.stepResults?.find((r) => r.step === stepName)
						const isCurrent = s.currentStep === stepName && isRunning
						const status = result?.status ?? (isCurrent ? "running" : "skipped")

						return (
							<div
								key={stepName}
								className={cn(
									"flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
									isCurrent ? "bg-violet-600/10 border border-violet-600/20" : "hover:bg-white/5",
								)}>
								{/* Step number */}
								<div
									className={cn(
										"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
										status === "passed"
											? "bg-emerald-500/20 text-emerald-400"
											: status === "failed"
												? "bg-red-500/20 text-red-400"
												: isCurrent
													? "bg-violet-500/20 text-violet-400"
													: "bg-gray-500/10 text-gray-600",
									)}>
									{status === "passed" ? (
										<CheckCircle2 className="h-4 w-4" />
									) : status === "failed" ? (
										<XCircle className="h-4 w-4" />
									) : isCurrent ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										idx + 1
									)}
								</div>

								{/* Step info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"text-sm font-medium",
												isCurrent
													? "text-violet-300"
													: status === "passed"
														? "text-emerald-300"
														: status === "failed"
															? "text-red-300"
															: "text-gray-500",
											)}>
											{STEP_LABELS[stepName] || stepName}
										</span>
										{isCurrent && <Badge status="running" label="Running" />}
										{status === "passed" && <Badge status="completed" label="Passed" />}
										{status === "failed" && <Badge status="failed" label="Failed" />}
									</div>
									{result?.details && (
										<p className="text-[11px] text-gray-500 mt-0.5 truncate">{result.details}</p>
									)}
								</div>

								{/* Duration */}
								{result?.duration != null && (
									<span className="flex items-center gap-1 text-[11px] text-gray-600 shrink-0">
										<Timer className="h-3 w-3" />
										{formatDuration(result.duration)}
									</span>
								)}
							</div>
						)
					})}
				</div>
			</Card>

			{/* Summary Footer */}
			<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<RotateCcw className="h-3.5 w-3.5 text-violet-400" />
						{s.cycleCount} cycles completed
					</span>
					<span className="flex items-center gap-1.5">
						<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
						{completedSteps} steps passed
					</span>
					<span className="flex items-center gap-1.5">
						<XCircle className="h-3.5 w-3.5 text-red-400" />
						{failedSteps} steps failed
					</span>
					<span className="flex items-center gap-1.5">
						<Clock className="h-3.5 w-3.5 text-gray-400" />
						Last run: {formatTime(s.lastRunAt)}
					</span>
				</div>
			</div>
		</div>
	)
}
