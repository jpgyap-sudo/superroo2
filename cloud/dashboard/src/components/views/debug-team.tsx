"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Play,
	Square,
	Bug,
	RefreshCw,
	CheckCircle2,
	XCircle,
	Clock,
	Zap,
	GitCommit,
	Activity,
	ChevronRight,
	ChevronDown,
	Send,
	Settings2,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepResult {
	step: number
	name: string
	status: "completed" | "failed" | "skipped"
	details?: string
	duration?: number
	timestamp: number
}

interface DebugStatus {
	jobId: string | null
	status: string
	running: boolean
	target: string
	branch: string
	currentStep: number
	currentStepName: string
	totalSteps: number
	progress: number
	elapsedFormatted: string
	remainingFormatted: string
	stepResults: StepResult[]
	error: string | null
	startedAt: number | null
}

interface DebugJob {
	id: string
	goal: string
	status: string
	createdAt: number
	updatedAt: number
	currentStep?: number
	currentStepName?: string
	progress?: number
	events?: Array<{ type: string; message: string; timestamp: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
	if (!ts) return "—"
	return new Date(ts).toLocaleTimeString()
}

function formatDuration(ms: number) {
	if (!ms || ms < 0) return "—"
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}h ${m % 60}m`
	if (m > 0) return `${m}m ${s % 60}s`
	return `${s}s`
}

// ── Components ────────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
	const pct = Math.round((current / total) * 100)
	return (
		<div className="w-full">
			<div className="flex justify-between text-[11px] text-gray-500 mb-1">
				<span>
					Step {current} of {total}
				</span>
				<span>{pct}%</span>
			</div>
			<div className="h-2 w-full rounded-full bg-[#1e2535]">
				<div
					className="h-full rounded-full bg-violet-500 transition-all duration-500"
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	)
}

function StepTimeline({ steps }: { steps: StepResult[] }) {
	return (
		<div className="space-y-2">
			{steps.map((s) => (
				<div key={s.step} className="flex items-start gap-3">
					<div className="mt-0.5">
						{s.status === "completed" ? (
							<CheckCircle2 className="h-4 w-4 text-emerald-400" />
						) : s.status === "failed" ? (
							<XCircle className="h-4 w-4 text-red-400" />
						) : (
							<Clock className="h-4 w-4 text-amber-400" />
						)}
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-[#e2e8f0]">{s.name}</span>
							<Badge status={s.status} />
						</div>
						{s.details && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{s.details}</p>}
					</div>
					{s.duration && (
						<span className="text-[11px] text-gray-600 shrink-0">{formatDuration(s.duration)}</span>
					)}
				</div>
			))}
		</div>
	)
}

function JobRow({ job }: { job: DebugJob }) {
	const [expanded, setExpanded] = useState(false)
	const statusColor =
		job.status === "running"
			? "text-blue-400"
			: job.status === "success" || job.status === "completed"
				? "text-emerald-400"
				: job.status === "failed"
					? "text-red-400"
					: "text-gray-400"

	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]">
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#131725] transition-colors">
				{expanded ? (
					<ChevronDown className="h-4 w-4 text-gray-500 shrink-0" />
				) : (
					<ChevronRight className="h-4 w-4 text-gray-500 shrink-0" />
				)}
				<Bug className={cn("h-4 w-4 shrink-0", statusColor)} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-[#e2e8f0] truncate">{job.goal}</span>
						<Badge status={job.status} />
					</div>
					<div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
						<span>ID: {job.id.slice(0, 12)}</span>
						<span>•</span>
						<span>{formatTime(job.createdAt)}</span>
					</div>
				</div>
				{job.progress !== undefined && job.progress > 0 && (
					<div className="w-24 shrink-0">
						<div className="h-1.5 w-full rounded-full bg-[#1e2535]">
							<div className="h-full rounded-full bg-violet-500" style={{ width: `${job.progress}%` }} />
						</div>
					</div>
				)}
			</button>
			{expanded && (
				<div className="border-t border-[#1e2535] px-4 py-3">
					{job.currentStepName && (
						<p className="text-sm text-gray-400 mb-2">
							Current step: <span className="text-[#e2e8f0]">{job.currentStepName}</span>
						</p>
					)}
					{job.events && job.events.length > 0 && (
						<div className="space-y-1">
							{job.events.slice(0, 10).map((ev, i) => (
								<div key={i} className="text-[11px] text-gray-500">
									<span className="text-gray-600">{formatTime(ev.timestamp)}</span>{" "}
									<span className="text-gray-400">{ev.type}</span> {ev.message}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function DebugTeamView() {
	const [status, setStatus] = useState<DebugStatus | null>(null)
	const [jobs, setJobs] = useState<DebugJob[]>([])
	const [loading, setLoading] = useState(false)
	const [actionLoading, setActionLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [target, setTarget] = useState("superroo2")
	const [branch, setBranch] = useState("main")

	// Telegram notification config
	const [showTelegramConfig, setShowTelegramConfig] = useState(false)
	const [telegramBotToken, setTelegramBotToken] = useState("")
	const [telegramChatId, setTelegramChatId] = useState("")
	const [telegramSaving, setTelegramSaving] = useState(false)
	const [telegramMessage, setTelegramMessage] = useState("")
	const [telegramError, setTelegramError] = useState("")

	// Read auth token for API requests
	const getAuthHeaders = useCallback((): Record<string, string> => {
		const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
		return token ? { Authorization: `Bearer ${token}` } : {}
	}, [])

	// Helper to handle auth failures across all fetch calls
	const handleAuthError = useCallback((res: Response) => {
		if (res.status === 401) {
			localStorage.removeItem("superroo_auth_token")
			window.location.reload()
		}
	}, [])

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/debug-team/status", { headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await res.json()
			if (data.success) {
				setStatus(data)
				setError(null)
			}
		} catch {
			// non-critical polling failure
		}
	}, [handleAuthError, getAuthHeaders])

	const fetchJobs = useCallback(async () => {
		try {
			const res = await fetch("/api/debug-team/jobs?limit=20", { headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await res.json()
			if (data.success) {
				setJobs(data.jobs || [])
			}
		} catch {
			// non-critical polling failure
		}
	}, [handleAuthError, getAuthHeaders])

	// Load Telegram config from settings
	const fetchTelegramConfig = useCallback(async () => {
		try {
			const res = await fetch("/api/settings", { headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await res.json()
			if (data.success && data.settings?.debugTeam) {
				setTelegramBotToken(data.settings.debugTeam.aceTeamTelegramBotToken || "")
				setTelegramChatId(data.settings.debugTeam.aceTeamTelegramChatId || "")
			}
		} catch {
			// use defaults
		}
	}, [handleAuthError, getAuthHeaders])

	useEffect(() => {
		setLoading(true)
		Promise.all([fetchStatus(), fetchJobs(), fetchTelegramConfig()]).finally(() => setLoading(false))
	}, [fetchStatus, fetchJobs, fetchTelegramConfig])

	useEffect(() => {
		const iv = setInterval(() => {
			fetchStatus()
			fetchJobs()
		}, 5000)
		return () => clearInterval(iv)
	}, [fetchStatus, fetchJobs])

	const handleStart = async () => {
		setActionLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/debug-team/start", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({ target, branch }),
			})
			handleAuthError(res)
			const data = await res.json()
			if (!data.success) {
				setError(data.error || "Failed to start debug team")
			}
			await fetchStatus()
			await fetchJobs()
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
			const res = await fetch("/api/debug-team/stop", { method: "POST", headers: getAuthHeaders() })
			handleAuthError(res)
			const data = await res.json()
			if (!data.success) {
				setError(data.error || "Failed to stop debug team")
			}
			await fetchStatus()
			await fetchJobs()
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Network error")
		} finally {
			setActionLoading(false)
		}
	}

	const handleSaveTelegram = async () => {
		setTelegramSaving(true)
		setTelegramMessage("")
		setTelegramError("")
		try {
			// Load current settings first, then merge
			const getRes = await fetch("/api/settings", { headers: getAuthHeaders() })
			handleAuthError(getRes)
			const getData = await getRes.json()
			const currentSettings = getData.success ? getData.settings : {}

			const res = await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({
					settings: {
						...currentSettings,
						debugTeam: {
							...currentSettings.debugTeam,
							aceTeamTelegramBotToken: telegramBotToken,
							aceTeamTelegramChatId: telegramChatId,
						},
					},
				}),
			})
			handleAuthError(res)
			const data = await res.json()
			if (data.success) {
				setTelegramMessage("Telegram config saved.")
				setTimeout(() => setTelegramMessage(""), 3000)
			} else {
				setTelegramError(data.error || "Failed to save")
			}
		} catch {
			setTelegramError("Network error")
		} finally {
			setTelegramSaving(false)
		}
	}

	const handleTestTelegram = async () => {
		setTelegramSaving(true)
		setTelegramMessage("")
		setTelegramError("")
		try {
			const res = await fetch("/api/debug-team/test-telegram", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({
					botToken: telegramBotToken,
					chatId: telegramChatId,
				}),
			})
			handleAuthError(res)
			const data = await res.json()
			if (data.success) {
				setTelegramMessage("Telegram test notification sent!")
				setTimeout(() => setTelegramMessage(""), 5000)
			} else {
				setTelegramError(data.error || "Test failed")
			}
		} catch {
			setTelegramError("Network error sending test")
		} finally {
			setTelegramSaving(false)
		}
	}

	const isRunning = status?.running ?? false
	const completedSteps = status?.stepResults?.filter((s) => s.status === "completed").length ?? 0
	const failedSteps = status?.stepResults?.filter((s) => s.status === "failed").length ?? 0

	return (
		<div className="space-y-5">
			{/* Header / Controls */}
			<Card className="flex flex-col gap-4">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400">
							<Bug className="h-5 w-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Debug Team</h2>
							<p className="text-[11px] text-gray-500">
								Autonomous multi-agent debugging with sandbox testing & auto-rollback
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={() => setShowTelegramConfig(!showTelegramConfig)}
							className="inline-flex items-center gap-2 rounded-lg border border-[#1e2535] px-3 py-2 text-sm font-medium text-gray-400 hover:bg-[#1e2535] transition-colors"
							title="Telegram Notification Settings">
							<Send className="h-4 w-4" />
							<span className="hidden sm:inline">Telegram</span>
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

				{/* Config inputs */}
				<div className="flex flex-col sm:flex-row gap-3">
					<div className="flex-1">
						<label className="text-[11px] text-gray-500 mb-1 block">Target</label>
						<input
							type="text"
							value={target}
							onChange={(e) => setTarget(e.target.value)}
							className="w-full rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-violet-500 focus:outline-none"
							placeholder="Project name"
						/>
					</div>
					<div className="flex-1">
						<label className="text-[11px] text-gray-500 mb-1 block">Branch</label>
						<input
							type="text"
							value={branch}
							onChange={(e) => setBranch(e.target.value)}
							className="w-full rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-violet-500 focus:outline-none"
							placeholder="git branch"
						/>
					</div>
				</div>

				{error && (
					<div className="rounded-lg bg-red-600/10 border border-red-600/30 px-3 py-2 text-sm text-red-400">
						{error}
					</div>
				)}
			</Card>

			{/* Telegram Notification Config */}
			{showTelegramConfig && (
				<Card>
					<div className="flex items-center gap-2 mb-4">
						<Send className="h-4 w-4 text-sky-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Telegram Notification Settings</span>
					</div>
					<p className="text-[11px] text-gray-500 mb-4">
						Configure Telegram to receive debug team accomplishment reports and progress updates.
					</p>
					<div className="space-y-3">
						<div>
							<label className="text-[11px] text-gray-500 mb-1 block">Bot Token</label>
							<input
								type="password"
								value={telegramBotToken}
								onChange={(e) => setTelegramBotToken(e.target.value)}
								placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
								className="w-full rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-sky-500 focus:outline-none"
							/>
						</div>
						<div>
							<label className="text-[11px] text-gray-500 mb-1 block">Chat ID</label>
							<input
								type="text"
								value={telegramChatId}
								onChange={(e) => setTelegramChatId(e.target.value)}
								placeholder="-1001234567890"
								className="w-full rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-sky-500 focus:outline-none"
							/>
						</div>
						{telegramMessage && (
							<div className="rounded-lg bg-emerald-900/20 border border-emerald-800/40 px-3 py-2 text-xs text-emerald-400">
								{telegramMessage}
							</div>
						)}
						{telegramError && (
							<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
								{telegramError}
							</div>
						)}
						<div className="flex items-center gap-2">
							<button
								onClick={handleSaveTelegram}
								disabled={telegramSaving}
								className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors">
								{telegramSaving ? "Saving..." : "Save"}
							</button>
							<button
								onClick={handleTestTelegram}
								disabled={telegramSaving || !telegramBotToken || !telegramChatId}
								className="inline-flex items-center gap-2 rounded-lg border border-[#1e2535] px-4 py-2 text-sm font-medium text-gray-400 hover:bg-[#1e2535] disabled:opacity-50 transition-colors">
								<Send className="h-3.5 w-3.5" />
								Send Test
							</button>
						</div>
					</div>
				</Card>
			)}

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
							{status?.status ?? "idle"}
						</span>
					}
					color={isRunning ? "text-blue-400" : "text-gray-400"}
				/>
				<StatCard
					label="Completed Steps"
					value={completedSteps}
					sub={`of ${status?.totalSteps ?? 10}`}
					color="text-emerald-400"
				/>
				<StatCard
					label="Failed Steps"
					value={failedSteps}
					color={failedSteps > 0 ? "text-red-400" : "text-gray-400"}
				/>
				<StatCard
					label="Elapsed"
					value={status?.elapsedFormatted ?? "—"}
					sub={status?.remainingFormatted ? `${status.remainingFormatted} remaining` : undefined}
					color="text-[#e2e8f0]"
				/>
			</div>

			{/* Active Job Progress */}
			{isRunning && status && (
				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Activity className="h-4 w-4 text-violet-400" />
							<span className="text-sm font-semibold text-[#e2e8f0]">Active Job</span>
						</div>
						<Badge status="running" label={status.currentStepName || "—"} />
					</div>
					<div className="mb-4">
						<ProgressBar current={status.currentStep} total={status.totalSteps} />
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-gray-500">
						<div>
							<span className="text-gray-600">Job ID:</span>{" "}
							<span className="text-gray-400 font-mono">{status.jobId?.slice(0, 16)}</span>
						</div>
						<div>
							<span className="text-gray-600">Target:</span>{" "}
							<span className="text-gray-400">{status.target}</span>
						</div>
						<div>
							<span className="text-gray-600">Branch:</span>{" "}
							<span className="text-gray-400">{status.branch}</span>
						</div>
					</div>
				</Card>
			)}

			{/* Step Timeline */}
			{status && status.stepResults && status.stepResults.length > 0 && (
				<Card>
					<div className="flex items-center gap-2 mb-3">
						<Zap className="h-4 w-4 text-amber-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Step Results</span>
					</div>
					<StepTimeline steps={status.stepResults} />
				</Card>
			)}

			{/* Recent Jobs */}
			<Card>
				<div className="flex items-center gap-2 mb-3">
					<GitCommit className="h-4 w-4 text-violet-400" />
					<span className="text-sm font-semibold text-[#e2e8f0]">Recent Jobs</span>
					<span className="ml-auto text-[11px] text-gray-500">{jobs.length} total</span>
				</div>
				{loading && jobs.length === 0 ? (
					<div className="flex items-center justify-center py-8">
						<RefreshCw className="h-5 w-5 animate-spin text-gray-600" />
					</div>
				) : jobs.length === 0 ? (
					<div className="py-8 text-center text-sm text-gray-500">
						No debug jobs yet. Start the loop to create one.
					</div>
				) : (
					<div className="space-y-2">
						{jobs.map((job) => (
							<JobRow key={job.id} job={job} />
						))}
					</div>
				)}
			</Card>
		</div>
	)
}
