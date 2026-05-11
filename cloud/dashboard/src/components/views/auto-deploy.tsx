"use client"

import { useState, useEffect, useCallback } from "react"
import {
	Rocket,
	RefreshCw,
	Play,
	CheckCircle2,
	XCircle,
	Clock,
	AlertTriangle,
	Loader2,
	ExternalLink,
} from "lucide-react"

interface DeployAttempt {
	attempt: number
	status: "success" | "failed"
	error?: string
	duration: string
	time: string
}

interface DeployStatus {
	state: "idle" | "running" | "success" | "failed"
	attempts: DeployAttempt[]
	startTime: string | null
	endTime: string | null
	lastError: string | null
	triggeredBy: string | null
	isRunning: boolean
	currentAttempt: number
}

function formatTime(iso: string | null) {
	if (!iso) return "—"
	const d = new Date(iso)
	return d.toLocaleTimeString()
}

function formatDuration(start: string | null, end: string | null) {
	if (!start) return "—"
	const s = new Date(start).getTime()
	const e = end ? new Date(end).getTime() : Date.now()
	const secs = Math.round((e - s) / 1000)
	if (secs < 60) return `${secs}s`
	return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function StatusBadge({ state }: { state: string }) {
	const colors: Record<string, string> = {
		idle: "bg-gray-500/10 text-gray-400 border-gray-500/30",
		running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
		success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
		failed: "bg-red-500/10 text-red-400 border-red-500/30",
	}
	const icons: Record<string, React.ReactNode> = {
		idle: <Clock className="h-3 w-3" />,
		running: <Loader2 className="h-3 w-3 animate-spin" />,
		success: <CheckCircle2 className="h-3 w-3" />,
		failed: <XCircle className="h-3 w-3" />,
	}
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium ring-1 ${
				colors[state] || colors.idle
			}`}>
			{icons[state] || null}
			{state.charAt(0).toUpperCase() + state.slice(1)}
		</span>
	)
}

export function AutoDeployView() {
	const [status, setStatus] = useState<DeployStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [triggering, setTriggering] = useState(false)

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/auto-deploy/status")
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			setStatus(data.data)
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch status")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchStatus()
		const iv = setInterval(fetchStatus, 5000) // Poll every 5s
		return () => clearInterval(iv)
	}, [fetchStatus])

	const handleTrigger = async () => {
		setTriggering(true)
		try {
			const res = await fetch("/api/auto-deploy/trigger", { method: "POST" })
			const data = await res.json()
			if (data.success) {
				await fetchStatus()
			} else {
				setError(data.error || "Trigger failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Trigger failed")
		} finally {
			setTriggering(false)
		}
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Rocket className="h-5 w-5 text-violet-400" />
					<h2 className="text-sm font-semibold text-[#e2e8f0]">Auto-Deployer Bot</h2>
					{status && <StatusBadge state={status.state} />}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={fetchStatus}
						className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-[#e2e8f0] active:scale-95"
						disabled={loading}>
						<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</button>
					<button
						onClick={handleTrigger}
						disabled={triggering || status?.isRunning}
						className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50 active:scale-95">
						{triggering ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<Play className="h-3 w-3" />
						)}
						{status?.isRunning ? "Running..." : "Trigger Deploy"}
					</button>
				</div>
			</div>

			{/* Error banner */}
			{error && (
				<div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
					<AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
					<span className="text-[11px] text-red-300">{error}</span>
				</div>
			)}

			{/* Loading state */}
			{loading && !status && (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-gray-500" />
				</div>
			)}

			{/* Main content */}
			{status && (
				<>
					{/* Stats cards */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">State</div>
							<div className="mt-1 flex items-center gap-1.5">
								<StatusBadge state={status.state} />
							</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Attempts</div>
							<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
								{status.attempts.length}
								<span className="text-[10px] font-normal text-gray-500"> / 5 max</span>
							</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Duration</div>
							<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
								{formatDuration(status.startTime, status.endTime)}
							</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Triggered</div>
							<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
								{status.triggeredBy || "—"}
							</div>
						</div>
					</div>

					{/* Timeline */}
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60">
						<div className="border-b border-[#1e2535] px-3 py-2">
							<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
								Deploy Attempts
							</h3>
						</div>
						<div className="divide-y divide-[#1e2535]">
							{status.attempts.length === 0 ? (
								<div className="flex flex-col items-center gap-2 py-8 text-center">
									<Clock className="h-8 w-8 text-gray-600" />
									<p className="text-[11px] text-gray-600">No deploy attempts yet</p>
									<p className="text-[10px] text-gray-700">
										Click "Trigger Deploy" to start, or wait for auto-trigger
									</p>
								</div>
							) : (
								status.attempts.map((a, i) => (
									<div key={i} className="flex items-start gap-3 px-3 py-2.5">
										<div className="mt-0.5">
											{a.status === "success" ? (
												<CheckCircle2 className="h-4 w-4 text-emerald-400" />
											) : (
												<XCircle className="h-4 w-4 text-red-400" />
											)}
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-[12px] font-medium text-[#e2e8f0]">
													Attempt {a.attempt}
												</span>
												<span
													className={`text-[10px] ${
														a.status === "success"
															? "text-emerald-400"
															: "text-red-400"
													}`}>
													{a.status === "success" ? "Success" : "Failed"}
												</span>
											</div>
											<div className="mt-0.5 flex items-center gap-3 text-[10px] text-gray-500">
												<span>{a.duration}</span>
												<span>{formatTime(a.time)}</span>
											</div>
											{a.error && (
												<p className="mt-0.5 text-[10px] text-red-400/80 truncate">
													{a.error}
												</p>
											)}
										</div>
									</div>
								))
							)}
						</div>
					</div>

					{/* Info */}
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
						<div className="flex items-start gap-2">
							<ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
							<div className="text-[10px] leading-relaxed text-gray-500">
								<p>
									The Auto-Deployer runs as a PM2 service (<code className="text-violet-400">superroo-auto-deployer</code>)
									on the VPS. It retries failed deploys with exponential backoff (10s → 20s → 40s → 80s → 160s).
									Status updates every 5 seconds.
								</p>
								<p className="mt-1">
									<strong>Target:</strong> root@104.248.225.250 · <strong>Project:</strong> /opt/superroo2
								</p>
							</div>
						</div>
					</div>
				</>
			)}
		</div>
	)
}
