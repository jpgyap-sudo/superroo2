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
	ClipboardCheck,
	FileText,
	Search,
	ShieldCheck,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhaseResult {
	phase: string
	status: "passed" | "failed" | "running" | "skipped"
	duration: number
	findings?: number
	results?: number
}

interface CommissioningStatus {
	running: boolean
	currentPhase: string | null
	phaseResults: PhaseResult[]
	reportUrl: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COMMISSIONING_PHASES = [
	"repo-inspection",
	"env-validation",
	"boot-verification",
	"ui-testing",
	"api-verification",
	"database-validation",
	"integration-verification",
	"queue-worker-testing",
	"file-upload-testing",
	"security-auth",
	"performance-stability",
	"autonomous-debugging",
	"reporting",
	"cleanup",
]

const PHASE_LABELS: Record<string, string> = {
	"repo-inspection": "Repo Inspection",
	"env-validation": "Env Validation",
	"boot-verification": "Boot Verification",
	"ui-testing": "UI Testing",
	"api-verification": "API Verification",
	"database-validation": "Database Validation",
	"integration-verification": "Integration Verification",
	"queue-worker-testing": "Queue/Worker Testing",
	"file-upload-testing": "File Upload Testing",
	"security-auth": "Security/Auth",
	"performance-stability": "Performance/Stability",
	"autonomous-debugging": "Autonomous Debugging",
	reporting: "Reporting",
	cleanup: "Cleanup",
}

const PHASE_ICONS: Record<string, any> = {
	"repo-inspection": Search,
	"env-validation": ShieldCheck,
	"boot-verification": Zap,
	"ui-testing": Activity,
	"api-verification": Activity,
	"database-validation": Activity,
	"integration-verification": Activity,
	"queue-worker-testing": Activity,
	"file-upload-testing": Activity,
	"security-auth": ShieldCheck,
	"performance-stability": Zap,
	"autonomous-debugging": Activity,
	reporting: FileText,
	cleanup: RefreshCw,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
	if (!ms || ms < 0) return "—"
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	if (m > 0) return `${m}m ${s % 60}s`
	return `${s}s`
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function CommissioningLoopView() {
	const [status, setStatus] = useState<CommissioningStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [actionLoading, setActionLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const authHeaders = (): Record<string, string> => {
		if (typeof window === "undefined") return {}
		const token = localStorage.getItem("superroo_auth_token")
		return token ? { Authorization: `Bearer ${token}` } : {}
	}

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/commissioning/status", { headers: authHeaders() })
			const data = await res.json()
			if (data.success) {
				// The API returns { success, status: { ... } } where status is the normalized object
				setStatus(data.status || data)
				setError(null)
			} else {
				// No commissioning has been started — return idle state
				setStatus({
					running: false,
					currentPhase: null,
					phaseResults: [],
					reportUrl: null,
				})
			}
		} catch {
			// Non-critical polling failure — set idle state to prevent crash
			setStatus({
				running: false,
				currentPhase: null,
				phaseResults: [],
				reportUrl: null,
			})
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchStatus()
		const iv = setInterval(fetchStatus, 5000)
		return () => clearInterval(iv)
	}, [fetchStatus])

	const handleStart = async () => {
		setActionLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/commissioning/start", { method: "POST", headers: authHeaders() })
			const data = await res.json()
			if (!data.success) {
				setError(data.error || "Failed to start commissioning loop")
			}
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
			const res = await fetch("/api/commissioning/stop", { method: "POST", headers: authHeaders() })
			const data = await res.json()
			if (!data.success) {
				setError(data.error || "Failed to stop commissioning loop")
			}
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
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load commissioning status: {error}</p>
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
	const completedPhases = s.phaseResults?.filter((r) => r.status === "passed").length ?? 0
	const failedPhases = s.phaseResults?.filter((r) => r.status === "failed").length ?? 0

	return (
		<div className="space-y-5">
			{/* Header / Controls */}
			<Card className="flex flex-col gap-4">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-400">
							<ClipboardCheck className="h-5 w-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Commissioning Loop</h2>
							<p className="text-[11px] text-gray-500">
								14-phase system validation: Repo Inspection → Security → Cleanup
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
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
								Start Commissioning
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
					label="Current Phase"
					value={
						s.currentPhase ? (
							<span className="capitalize">{PHASE_LABELS[s.currentPhase] || s.currentPhase}</span>
						) : (
							"—"
						)
					}
					color="text-[#e2e8f0]"
				/>
				<StatCard
					label="Phases Passed"
					value={completedPhases}
					sub={`of ${COMMISSIONING_PHASES.length}`}
					color="text-emerald-400"
				/>
				<StatCard
					label="Phases Failed"
					value={failedPhases}
					color={failedPhases > 0 ? "text-red-400" : "text-gray-400"}
				/>
			</div>

			{/* Phase Progress */}
			<Card>
				<div className="flex items-center gap-2 mb-4">
					<Activity className="h-4 w-4 text-emerald-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Phase Progress</span>
					<span className="ml-auto text-[11px] text-gray-500">
						{completedPhases + failedPhases} of {COMMISSIONING_PHASES.length} completed
					</span>
				</div>
				<div className="space-y-1">
					{COMMISSIONING_PHASES.map((phaseName) => {
						const result = s.phaseResults?.find((r) => r.phase === phaseName)
						const isCurrent = s.currentPhase === phaseName && isRunning
						const status = result?.status ?? (isCurrent ? "running" : "skipped")
						const PhaseIcon = PHASE_ICONS[phaseName] || Activity

						return (
							<div
								key={phaseName}
								className={cn(
									"flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
									isCurrent ? "bg-emerald-600/10 border border-emerald-600/20" : "hover:bg-white/5",
								)}>
								{/* Status icon */}
								<div
									className={cn(
										"flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
										status === "passed"
											? "bg-emerald-500/20 text-emerald-400"
											: status === "failed"
												? "bg-red-500/20 text-red-400"
												: isCurrent
													? "bg-blue-500/20 text-blue-400"
													: "bg-gray-500/10 text-gray-600",
									)}>
									{status === "passed" ? (
										<CheckCircle2 className="h-4 w-4" />
									) : status === "failed" ? (
										<XCircle className="h-4 w-4" />
									) : isCurrent ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<PhaseIcon className="h-3.5 w-3.5" />
									)}
								</div>

								{/* Phase info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"text-sm font-medium",
												isCurrent
													? "text-blue-300"
													: status === "passed"
														? "text-emerald-300"
														: status === "failed"
															? "text-red-300"
															: "text-gray-500",
											)}>
											{PHASE_LABELS[phaseName] || phaseName}
										</span>
										{isCurrent && <Badge status="running" label="Running" />}
										{status === "passed" && <Badge status="completed" label="Passed" />}
										{status === "failed" && <Badge status="failed" label="Failed" />}
									</div>
									{result && (
										<div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
											{result.findings != null && <span>{result.findings} findings</span>}
											{result.results != null && <span>{result.results} results</span>}
										</div>
									)}
								</div>

								{/* Duration */}
								{result?.duration != null && (
									<span className="text-[11px] text-gray-600 shrink-0">
										{formatDuration(result.duration)}
									</span>
								)}
							</div>
						)
					})}
				</div>
			</Card>

			{/* Report */}
			<Card>
				<div className="flex items-center gap-2 mb-3">
					<FileText className="h-4 w-4 text-amber-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Final Report</span>
				</div>
				{s.reportUrl ? (
					<a
						href={s.reportUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 rounded-lg bg-amber-600/20 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-600/30 transition-colors">
						<FileText className="h-4 w-4" />
						View Commissioning Report
					</a>
				) : (
					<p className="text-sm text-gray-500">
						{isRunning
							? "Report will be generated once commissioning completes."
							: "No report available. Run commissioning to generate one."}
					</p>
				)}
			</Card>

			{/* Summary Footer */}
			<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
						{completedPhases} phases passed
					</span>
					<span className="flex items-center gap-1.5">
						<XCircle className="h-3.5 w-3.5 text-red-400" />
						{failedPhases} phases failed
					</span>
					<span className="flex items-center gap-1.5">
						<Clock className="h-3.5 w-3.5 text-gray-400" />
						{s.reportUrl ? "Report available" : "No report yet"}
					</span>
				</div>
			</div>
		</div>
	)
}
