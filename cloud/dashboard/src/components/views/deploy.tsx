"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
	GitCommit,
	User,
	FileText,
	Hash,
	RotateCcw,
	BarChart3,
	Bell,
	Settings2,
	GitBranch,
	Activity,
	Shield,
} from "lucide-react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeployAttempt {
	attempt: number
	status: "success" | "failed"
	error?: string
	duration: string
	time: string
}

interface DeployStatus {
	state: "idle" | "running" | "success" | "failed" | "cooldown"
	attempts: DeployAttempt[]
	startTime: string | null
	endTime: string | null
	lastError: string | null
	triggeredBy: string | null
	isRunning: boolean
	currentAttempt: number
	cooldownUntil: string | null
	inCooldown: boolean
	cooldownRemaining: number
	config: {
		cooldownMs: number
		maxDurationMs: number
		maxRetries: number
		retryDelay: number
	}
}

interface CommitEntry {
	sha: string
	agent: string
	type: string
	title: string
	filesChanged: number
	timestamp: number
	featuresAffected: string[]
}

interface DeployEntry {
	version: string
	sha: string
	agent: string
	status: string
	timestamp: number
}

interface CommitDeployData {
	success: boolean
	commits: CommitEntry[]
	deploys: DeployEntry[]
	totalCommits: number
	totalDeploys: number
	note?: string
}

interface PipelineStage {
	name: string
	status: "pending" | "running" | "success" | "failed" | "skipped"
	icon: string
	duration?: string
}

interface DeployHealthMetrics {
	successRate: number | null
	totalDeploys: number
	avgDuration: string | null
	failuresByReason: { reason: string; count: number }[]
	deploysByDay: { date: string; count: number }[]
	lastHealthCheck: { ok: boolean; latencyMs: number; timestamp: string } | null
}

interface DeployNotification {
	id: string
	type: "start" | "success" | "failure" | "rollback" | "info"
	message: string
	timestamp: number
	read: boolean
}

interface DeployTarget {
	host: string
	user: string
	path: string
	healthUrl: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PIPELINE_STAGES: PipelineStage[] = [
	{ name: "SSH Connection", status: "pending", icon: "🔌" },
	{ name: "Git Pull", status: "pending", icon: "📥" },
	{ name: "Install Dependencies", status: "pending", icon: "📦" },
	{ name: "Build", status: "pending", icon: "🔨" },
	{ name: "PM2 Restart", status: "pending", icon: "🔄" },
	{ name: "Health Check", status: "pending", icon: "✅" },
]

const TYPE_EMOJI: Record<string, string> = {
	feature: "✨",
	bugfix: "🐛",
	refactor: "♻️",
	docs: "📝",
	config: "⚙️",
	test: "🧪",
	deploy: "🚀",
}

const STATUS_EMOJI: Record<string, string> = {
	healthy: "✅",
	unhealthy: "❌",
	rolled_back: "↩️",
	failed: "💥",
	completed: "✅",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string | null | number) {
	if (iso === null || iso === undefined) return "—"
	const d = typeof iso === "number" ? new Date(iso) : new Date(iso)
	if (isNaN(d.getTime())) return "—"
	return d.toLocaleTimeString()
}

function formatDateTime(ts: number) {
	if (!ts) return "—"
	return new Date(ts).toLocaleString()
}

function formatDuration(start: string | null, end: string | null) {
	if (!start) return "—"
	const s = new Date(start).getTime()
	const e = end ? new Date(end).getTime() : Date.now()
	const secs = Math.round((e - s) / 1000)
	if (secs < 60) return `${secs}s`
	return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function shortSha(sha: string) {
	return sha ? sha.slice(0, 7) : "???"
}

function formatRelative(ts: number) {
	if (!ts) return "unknown"
	const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000))
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	return `${Math.floor(hours / 24)}d ago`
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: string }) {
	const colors: Record<string, string> = {
		idle: "bg-gray-500/10 text-gray-400 border-gray-500/30",
		running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
		success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
		failed: "bg-red-500/10 text-red-400 border-red-500/30",
		cooldown: "bg-amber-500/10 text-amber-400 border-amber-500/30",
		healthy: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
		unhealthy: "bg-red-500/10 text-red-400 border-red-500/30",
		rolled_back: "bg-orange-500/10 text-orange-400 border-orange-500/30",
		pending: "bg-gray-500/10 text-gray-400 border-gray-500/30",
	}
	const icons: Record<string, React.ReactNode> = {
		idle: <Clock className="h-3 w-3" />,
		running: <Loader2 className="h-3 w-3 animate-spin" />,
		success: <CheckCircle2 className="h-3 w-3" />,
		failed: <XCircle className="h-3 w-3" />,
		cooldown: <Clock className="h-3 w-3" />,
		healthy: <CheckCircle2 className="h-3 w-3" />,
		unhealthy: <XCircle className="h-3 w-3" />,
		rolled_back: <RotateCcw className="h-3 w-3" />,
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

function PipelineStageRow({ stage }: { stage: PipelineStage }) {
	return (
		<div className="flex items-center gap-3">
			<div
				className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f1117] ring-1 ring-[#1e2535] ${
					stage.status === "running"
						? "text-blue-400"
						: stage.status === "success"
							? "text-emerald-400"
							: stage.status === "failed"
								? "text-red-400"
								: "text-gray-600"
				}`}>
				{stage.status === "running" ? (
					<Loader2 className="h-3 w-3 animate-spin" />
				) : stage.status === "success" ? (
					<CheckCircle2 className="h-3 w-3" />
				) : stage.status === "failed" ? (
					<XCircle className="h-3 w-3" />
				) : (
					<span className="text-[10px]">{stage.icon}</span>
				)}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-[11px] text-[#e2e8f0]">{stage.name}</span>
					{stage.status === "running" && (
						<span className="text-[9px] text-blue-400 animate-pulse">In progress...</span>
					)}
					{stage.duration && <span className="text-[9px] text-gray-500 ml-auto">{stage.duration}</span>}
				</div>
				{stage.status === "running" && (
					<div className="mt-1 h-1 w-full rounded-full bg-[#1e2535] overflow-hidden">
						<div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
					</div>
				)}
			</div>
		</div>
	)
}

function NotificationToast({
	notification,
	onDismiss,
}: {
	notification: DeployNotification
	onDismiss: (id: string) => void
}) {
	const colors: Record<string, string> = {
		start: "border-blue-500/30 bg-blue-950/20",
		success: "border-emerald-500/30 bg-emerald-950/20",
		failure: "border-red-500/30 bg-red-950/20",
		rollback: "border-orange-500/30 bg-orange-950/20",
		info: "border-gray-500/30 bg-gray-950/20",
	}
	const icons: Record<string, React.ReactNode> = {
		start: <Rocket className="h-4 w-4 text-blue-400" />,
		success: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
		failure: <XCircle className="h-4 w-4 text-red-400" />,
		rollback: <RotateCcw className="h-4 w-4 text-orange-400" />,
		info: <Bell className="h-4 w-4 text-gray-400" />,
	}
	return (
		<div className={`flex items-start gap-2 rounded-lg border p-2.5 ${colors[notification.type]}`}>
			{icons[notification.type]}
			<div className="flex-1 min-w-0">
				<p className="text-[11px] text-[#e2e8f0]">{notification.message}</p>
				<p className="text-[9px] text-gray-500 mt-0.5">{formatRelative(notification.timestamp)}</p>
			</div>
			<button
				onClick={() => onDismiss(notification.id)}
				className="text-gray-500 hover:text-[#e2e8f0] text-[10px]">
				✕
			</button>
		</div>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function DeployView() {
	// Tab state
	const [activeTab, setActiveTab] = useState<"pipeline" | "history" | "health" | "config">("pipeline")

	// Auto-deployer state
	const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [triggering, setTriggering] = useState(false)

	// Commit/deploy log state
	const [cdData, setCdData] = useState<CommitDeployData | null>(null)
	const [cdLoading, setCdLoading] = useState(true)
	const [cdError, setCdError] = useState<string | null>(null)
	const [cdLimit, setCdLimit] = useState(10)

	// Pipeline stages
	const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>(PIPELINE_STAGES)

	// Health metrics
	const [healthMetrics, setHealthMetrics] = useState<DeployHealthMetrics>({
		successRate: null,
		totalDeploys: 0,
		avgDuration: null,
		failuresByReason: [],
		deploysByDay: [],
		lastHealthCheck: null,
	})
	const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null)

	// Notifications
	const [notifications, setNotifications] = useState<DeployNotification[]>([])
	const [showNotifications, setShowNotifications] = useState(false)
	const notificationIdRef = useRef(0)

	// Environment toggle
	const [environment, setEnvironment] = useState<"staging" | "production">("production")

	// Copy state
	const [copiedSha, setCopiedSha] = useState<string | null>(null)

	// ── Add notification helper ────────────────────────────────────────────

	const addNotification = useCallback((type: DeployNotification["type"], message: string) => {
		notificationIdRef.current++
		const notif: DeployNotification = {
			id: `notif-${notificationIdRef.current}`,
			type,
			message,
			timestamp: Date.now(),
			read: false,
		}
		setNotifications((prev) => [notif, ...prev].slice(0, 20))
		setTimeout(() => {
			setNotifications((prev) => prev.filter((n) => n.id !== notif.id))
		}, 8000)
	}, [])

	const dismissNotification = useCallback((id: string) => {
		setNotifications((prev) => prev.filter((n) => n.id !== id))
	}, [])

	// ── Fetch auto-deploy status ───────────────────────────────────────────

	const fetchDeployStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/auto-deploy/status")
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			setDeployStatus(data.data)
			setError(null)

			// Update pipeline stages based on deploy state
			if (data.data.state === "running") {
				setPipelineStages((prev) =>
					prev.map((s, i) => ({
						...s,
						status: i === 0 ? ("running" as const) : ("pending" as const),
					})),
				)
				addNotification("start", `Deploy started (attempt ${data.data.currentAttempt})`)
			} else if (data.data.state === "success") {
				setPipelineStages((prev) => prev.map((s) => ({ ...s, status: "success" as const })))
				addNotification("success", "Deploy completed successfully")
			} else if (data.data.state === "failed") {
				setPipelineStages((prev) => prev.map((s) => ({ ...s, status: "failed" as const })))
				addNotification("failure", `Deploy failed: ${data.data.lastError || "Unknown error"}`)
			} else {
				setPipelineStages((prev) => prev.map((s) => ({ ...s, status: "pending" as const })))
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch status")
		} finally {
			setLoading(false)
		}
	}, [addNotification])

	// ── Fetch commit/deploy log ────────────────────────────────────────────

	const fetchCdData = useCallback(async () => {
		setCdLoading(true)
		setCdError(null)
		try {
			const res = await fetch(`/api/orchestrator/commit-deploy-status?limit=${cdLimit}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			setCdData(json)
		} catch (err: any) {
			setCdError(err.message || "Failed to fetch commit/deploy data")
		} finally {
			setCdLoading(false)
		}
	}, [cdLimit])

	// ── Fetch health metrics ───────────────────────────────────────────────

	const fetchHealthMetrics = useCallback(async () => {
		try {
			const res = await fetch("/api/health")
			if (res.ok) {
				const data = await res.json()
				setHealthMetrics((prev) => ({
					...prev,
					lastHealthCheck: {
						ok: data.status === "online",
						latencyMs: data.latencyMs || 0,
						timestamp: new Date().toISOString(),
					},
				}))
			}
		} catch {
			// ignore
		}

		try {
			const res = await fetch("/api/deploy/summary")
			if (res.ok) {
				const data = await res.json()
				setDeployTarget(data.target || null)
				setHealthMetrics((prev) => ({
					...prev,
					successRate: data.summary?.successRate ?? null,
					totalDeploys: data.summary?.totalDeploys ?? 0,
					avgDuration: data.summary?.avgDuration ?? null,
					failuresByReason: data.summary?.failuresByReason ?? [],
					deploysByDay: data.summary?.deploysByDay ?? [],
				}))
			}
		} catch {
			// ignore
		}
	}, [])

	// ── Effects ────────────────────────────────────────────────────────────

	useEffect(() => {
		fetchDeployStatus()
		const iv = setInterval(fetchDeployStatus, 5000)
		return () => clearInterval(iv)
	}, [fetchDeployStatus])

	useEffect(() => {
		fetchCdData()
	}, [fetchCdData])

	useEffect(() => {
		fetchHealthMetrics()
		const iv = setInterval(fetchHealthMetrics, 30000)
		return () => clearInterval(iv)
	}, [fetchHealthMetrics])

	// ── Trigger deploy ─────────────────────────────────────────────────────

	const handleTrigger = async () => {
		setTriggering(true)
		try {
			const res = await fetch("/api/auto-deploy/trigger", { method: "POST" })
			const data = await res.json()
			if (data.success) {
				await fetchDeployStatus()
			} else {
				setError(data.error || "Trigger failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Trigger failed")
		} finally {
			setTriggering(false)
		}
	}

	// ── Rollback ───────────────────────────────────────────────────────────

	const handleRollback = async (version: string, sha: string) => {
		if (!confirm(`Rollback to version v${version} (${shortSha(sha)})? This will redeploy the previous version.`))
			return
		try {
			const res = await fetch("/api/auto-deploy/trigger", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ rollback: true, version, sha }),
			})
			const data = await res.json()
			if (data.success) {
				addNotification("rollback", `Rolling back to v${version}...`)
				await fetchDeployStatus()
			} else {
				setError(data.error || "Rollback failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Rollback failed")
		}
	}

	// ── Copy SHA to clipboard ──────────────────────────────────────────────

	const handleCopySha = (sha: string) => {
		navigator.clipboard.writeText(sha).then(() => {
			setCopiedSha(sha)
			setTimeout(() => setCopiedSha(null), 2000)
		})
	}

	// ── Save config ────────────────────────────────────────────────────────

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<div className="space-y-4">
			{/* Notification toasts */}
			{notifications.length > 0 && (
				<div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
					{notifications.map((n) => (
						<NotificationToast key={n.id} notification={n} onDismiss={dismissNotification} />
					))}
				</div>
			)}

			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-2">
					<Rocket className="h-5 w-5 text-violet-400" />
					<h2 className="text-sm font-semibold text-[#e2e8f0]">Deploy</h2>
					{deployStatus && <StatusBadge state={deployStatus.state} />}
					{deployStatus?.inCooldown && (
						<span className="text-[10px] text-amber-400">Cooldown: {deployStatus.cooldownRemaining}s</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{/* Environment toggle */}
					<div className="flex items-center rounded-lg border border-[#1e2535] bg-[#0f1117] p-0.5">
						<button
							onClick={() => setEnvironment("staging")}
							className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] ${
								environment === "staging"
									? "bg-violet-600/20 text-violet-300"
									: "text-gray-500 hover:text-[#e2e8f0]"
							}`}>
							<GitBranch className="h-3 w-3" />
							Staging
						</button>
						<button
							onClick={() => setEnvironment("production")}
							className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] ${
								environment === "production"
									? "bg-violet-600/20 text-violet-300"
									: "text-gray-500 hover:text-[#e2e8f0]"
							}`}>
							<Shield className="h-3 w-3" />
							Production
						</button>
					</div>

					{/* Notification bell */}
					<div className="relative">
						<button
							onClick={() => setShowNotifications(!showNotifications)}
							className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-[#e2e8f0]">
							<Bell className="h-3 w-3" />
							{notifications.length > 0 && (
								<span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
									{notifications.length}
								</span>
							)}
						</button>
						{showNotifications && (
							<div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-[#1e2535] bg-[#0a0e1a] shadow-xl z-50">
								<div className="border-b border-[#1e2535] px-3 py-2">
									<span className="text-[11px] font-semibold text-[#e2e8f0]">Notifications</span>
								</div>
								<div className="max-h-60 overflow-y-auto">
									{notifications.length === 0 ? (
										<p className="p-3 text-[11px] text-gray-500 text-center">No notifications</p>
									) : (
										notifications.map((n) => (
											<div
												key={n.id}
												className="flex items-start gap-2 border-b border-[#1e2535]/50 px-3 py-2">
												<span className="text-[10px]">
													{n.type === "start"
														? "🚀"
														: n.type === "success"
															? "✅"
															: n.type === "failure"
																? "❌"
																: n.type === "rollback"
																	? "↩️"
																	: "ℹ️"}
												</span>
												<div className="flex-1 min-w-0">
													<p className="text-[10px] text-[#e2e8f0]">{n.message}</p>
													<p className="text-[8px] text-gray-500">
														{formatRelative(n.timestamp)}
													</p>
												</div>
											</div>
										))
									)}
								</div>
							</div>
						)}
					</div>

					<button
						onClick={() => setActiveTab("config")}
						className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-[#e2e8f0]">
						<Settings2 className="h-3 w-3" />
						Config
					</button>

					<button
						onClick={() => {
							fetchDeployStatus()
							fetchCdData()
							fetchHealthMetrics()
						}}
						className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-[#e2e8f0]"
						disabled={loading}>
						<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</button>
					<button
						onClick={handleTrigger}
						disabled={triggering || deployStatus?.isRunning}
						className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50 active:scale-95">
						{triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
						{deployStatus?.isRunning ? "Running..." : "Trigger Deploy"}
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

			{/* Tab navigation */}
			<div className="flex items-center gap-1 border-b border-[#1e2535]">
				{[
					{ id: "pipeline" as const, label: "Pipeline", icon: Activity },
					{ id: "history" as const, label: "History", icon: GitCommit },
					{ id: "health" as const, label: "Health", icon: BarChart3 },
					{ id: "config" as const, label: "Settings", icon: Settings2 },
				].map((tab) => {
					const Icon = tab.icon
					return (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${
								activeTab === tab.id
									? "border-violet-500 text-violet-300"
									: "border-transparent text-gray-500 hover:text-[#e2e8f0]"
							}`}>
							<Icon className="h-3.5 w-3.5" />
							{tab.label}
						</button>
					)
				})}
			</div>

			{/* ── PIPELINE TAB ─────────────────────────────────────────────── */}
			{activeTab === "pipeline" && (
				<>
					{loading && !deployStatus && (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-6 w-6 animate-spin text-gray-500" />
						</div>
					)}

					{deployStatus && (
						<>
							{/* Stats cards */}
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="text-[10px] uppercase tracking-wider text-gray-500">State</div>
									<div className="mt-1 flex items-center gap-1.5">
										<StatusBadge state={deployStatus.state} />
									</div>
								</div>
								<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="text-[10px] uppercase tracking-wider text-gray-500">Attempts</div>
									<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
										{deployStatus.attempts.length}
										<span className="text-[10px] font-normal text-gray-500">
											{" "}
											/ {deployStatus.config.maxRetries} max
										</span>
									</div>
								</div>
								<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="text-[10px] uppercase tracking-wider text-gray-500">Duration</div>
									<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
										{formatDuration(deployStatus.startTime, deployStatus.endTime)}
									</div>
								</div>
								<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="text-[10px] uppercase tracking-wider text-gray-500">Triggered</div>
									<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
										{deployStatus.triggeredBy || "—"}
									</div>
								</div>
							</div>

							{/* Pipeline stages visualization */}
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
								<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
									Deploy Pipeline
								</h3>
								<div className="space-y-3">
									{pipelineStages.map((stage, i) => (
										<PipelineStageRow key={i} stage={stage} />
									))}
								</div>
							</div>

							{/* Deploy attempts timeline */}
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
								<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
									Deploy Attempts
								</h3>
								{deployStatus.attempts.length === 0 ? (
									<p className="text-[11px] text-gray-500 text-center py-4">No deploy attempts yet</p>
								) : (
									<div className="space-y-2">
										{deployStatus.attempts.map((a, i) => (
											<div
												key={i}
												className="flex items-start gap-3 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
												<div
													className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
														a.status === "success"
															? "bg-emerald-500/10 text-emerald-400"
															: "bg-red-500/10 text-red-400"
													}`}>
													{a.status === "success" ? (
														<CheckCircle2 className="h-3 w-3" />
													) : (
														<XCircle className="h-3 w-3" />
													)}
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<span className="text-[11px] font-medium text-[#e2e8f0]">
															Attempt #{a.attempt}
														</span>
														<StatusBadge state={a.status} />
														<span className="text-[9px] text-gray-500 ml-auto">
															{a.duration}
														</span>
													</div>
													<p className="text-[9px] text-gray-500 mt-0.5">{a.time}</p>
													{a.error && (
														<p className="text-[10px] text-red-400 mt-1">{a.error}</p>
													)}
												</div>
											</div>
										))}
									</div>
								)}
							</div>

							{/* Info panel */}
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
								<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
									About Auto-Deployer
								</h3>
								<p className="text-[10px] text-gray-400 leading-relaxed">
									The auto-deployer is a self-retrying SSH deploy agent running on the VPS (Tailscale
									IP: <code className="text-violet-300">100.64.175.88</code>). It handles the full
									deploy pipeline: SSH connection → git pull → install dependencies → build → PM2
									restart → health check. Retries with exponential backoff (10s → 160s, max 5
									retries). Cooldown period: 10 minutes between deploys. Max duration: 30 minutes.
								</p>
							</div>
						</>
					)}
				</>
			)}

			{/* ── HISTORY TAB ──────────────────────────────────────────────── */}
			{activeTab === "history" && (
				<>
					{/* Limit selector + refresh */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<label className="text-[10px] uppercase tracking-wider text-gray-500">Show</label>
							<select
								value={cdLimit}
								onChange={(e) => setCdLimit(Number(e.target.value))}
								className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-[11px] text-gray-300">
								{[5, 10, 25, 50].map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</select>
						</div>
						<button
							onClick={fetchCdData}
							className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-[#e2e8f0]"
							disabled={cdLoading}>
							<RefreshCw className={`h-3 w-3 ${cdLoading ? "animate-spin" : ""}`} />
							Refresh
						</button>
					</div>

					{/* Stats cards */}
					{cdData && (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
								<div className="text-[10px] uppercase tracking-wider text-gray-500">Total Commits</div>
								<div className="mt-1 text-sm font-bold text-[#e2e8f0]">{cdData.totalCommits}</div>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
								<div className="text-[10px] uppercase tracking-wider text-gray-500">Total Deploys</div>
								<div className="mt-1 text-sm font-bold text-[#e2e8f0]">{cdData.totalDeploys}</div>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
								<div className="text-[10px] uppercase tracking-wider text-gray-500">Recent Commits</div>
								<div className="mt-1 text-sm font-bold text-[#e2e8f0]">{cdData.commits.length}</div>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
								<div className="text-[10px] uppercase tracking-wider text-gray-500">Recent Deploys</div>
								<div className="mt-1 text-sm font-bold text-[#e2e8f0]">{cdData.deploys.length}</div>
							</div>
						</div>
					)}

					{/* Note banner */}
					{cdData?.note && (
						<div className="flex items-center gap-2 rounded-lg border border-yellow-800/40 bg-yellow-950/20 px-3 py-2">
							<AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
							<span className="text-[11px] text-yellow-300">{cdData.note}</span>
						</div>
					)}

					{/* Error */}
					{cdError && (
						<div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
							<AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
							<span className="text-[11px] text-red-300">{cdError}</span>
						</div>
					)}

					{/* Loading */}
					{cdLoading && !cdData && (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-6 w-6 animate-spin text-gray-500" />
						</div>
					)}

					{/* Commits section */}
					{cdData && (
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
							<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
								Recent Commits
							</h3>
							{cdData.commits.length === 0 ? (
								<p className="text-[11px] text-gray-500 text-center py-4">No commits recorded</p>
							) : (
								<div className="space-y-2">
									{cdData.commits.map((c, i) => (
										<div
											key={i}
											className="flex items-start gap-3 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
											<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f1117] ring-1 ring-[#1e2535]">
												<span className="text-[10px]">{TYPE_EMOJI[c.type] || "📄"}</span>
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<button
														onClick={() => handleCopySha(c.sha)}
														className="group flex items-center gap-1 font-mono text-[10px] text-violet-400 hover:text-violet-300"
														title="Copy SHA">
														<Hash className="h-3 w-3" />
														{shortSha(c.sha)}
														{copiedSha === c.sha && (
															<span className="text-[8px] text-emerald-400">Copied!</span>
														)}
													</button>
													<span className="text-[11px] text-[#e2e8f0]">{c.title}</span>
												</div>
												<div className="flex items-center gap-2 mt-1">
													<span className="flex items-center gap-1 text-[9px] text-gray-500">
														<User className="h-2.5 w-2.5" />
														{c.agent}
													</span>
													<span className="text-[9px] text-gray-600">•</span>
													<span className="flex items-center gap-1 text-[9px] text-gray-500">
														<FileText className="h-2.5 w-2.5" />
														{c.filesChanged} files
													</span>
													<span className="text-[9px] text-gray-600">•</span>
													<span className="text-[9px] text-gray-500">
														{formatRelative(c.timestamp)}
													</span>
												</div>
												{c.featuresAffected?.length > 0 && (
													<div className="flex items-center gap-1 mt-1.5 flex-wrap">
														{c.featuresAffected.map((f, fi) => (
															<span
																key={fi}
																className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[8px] text-violet-300">
																{f}
															</span>
														))}
													</div>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Deploys section */}
					{cdData && (
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
							<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
								Deploy History
							</h3>
							{cdData.deploys.length === 0 ? (
								<p className="text-[11px] text-gray-500 text-center py-4">No deploys recorded</p>
							) : (
								<div className="space-y-2">
									{cdData.deploys.map((d, i) => (
										<div
											key={i}
											className="flex items-start gap-3 rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
											<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f1117] ring-1 ring-[#1e2535]">
												<span className="text-[10px]">{STATUS_EMOJI[d.status] || "🚀"}</span>
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-[11px] font-medium text-[#e2e8f0]">
														v{d.version}
													</span>
													<StatusBadge state={d.status} />
													<button
														onClick={() => handleCopySha(d.sha)}
														className="group flex items-center gap-1 font-mono text-[9px] text-violet-400 hover:text-violet-300 ml-auto"
														title="Copy SHA">
														<Hash className="h-2.5 w-2.5" />
														{shortSha(d.sha)}
														{copiedSha === d.sha && (
															<span className="text-[8px] text-emerald-400">Copied!</span>
														)}
													</button>
												</div>
												<div className="flex items-center gap-2 mt-1">
													<span className="flex items-center gap-1 text-[9px] text-gray-500">
														<User className="h-2.5 w-2.5" />
														{d.agent}
													</span>
													<span className="text-[9px] text-gray-600">•</span>
													<span className="text-[9px] text-gray-500">
														{formatDateTime(d.timestamp)}
													</span>
												</div>
												{/* Rollback button for failed/unhealthy deploys */}
												{(d.status === "failed" || d.status === "unhealthy") && (
													<button
														onClick={() => handleRollback(d.version, d.sha)}
														className="mt-2 flex items-center gap-1 rounded bg-orange-500/10 px-2 py-1 text-[9px] text-orange-400 hover:bg-orange-500/20">
														<RotateCcw className="h-2.5 w-2.5" />
														Rollback to v{d.version}
													</button>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</>
			)}

			{/* ── HEALTH TAB ───────────────────────────────────────────────── */}
			{activeTab === "health" && (
				<>
					{/* Health stats */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Success Rate</div>
							<div className="mt-1 flex items-center gap-2">
								<span className="text-sm font-bold text-[#e2e8f0]">
									{healthMetrics.successRate === null ? "—" : `${healthMetrics.successRate}%`}
								</span>
								{healthMetrics.successRate !== null && healthMetrics.successRate >= 80 ? (
									<CheckCircle2 className="h-3 w-3 text-emerald-400" />
								) : healthMetrics.successRate !== null && healthMetrics.successRate >= 50 ? (
									<AlertTriangle className="h-3 w-3 text-amber-400" />
								) : healthMetrics.successRate !== null ? (
									<XCircle className="h-3 w-3 text-red-400" />
								) : null}
							</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Total Deploys</div>
							<div className="mt-1 text-sm font-bold text-[#e2e8f0]">{healthMetrics.totalDeploys}</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Avg Duration</div>
							<div className="mt-1 text-sm font-bold text-[#e2e8f0]">
								{healthMetrics.avgDuration || "—"}
							</div>
						</div>
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-3">
							<div className="text-[10px] uppercase tracking-wider text-gray-500">Last Health Check</div>
							<div className="mt-1 flex items-center gap-1.5">
								{healthMetrics.lastHealthCheck ? (
									<>
										{healthMetrics.lastHealthCheck.ok ? (
											<CheckCircle2 className="h-3 w-3 text-emerald-400" />
										) : (
											<XCircle className="h-3 w-3 text-red-400" />
										)}
										<span className="text-[11px] text-[#e2e8f0]">
											{healthMetrics.lastHealthCheck.latencyMs}ms
										</span>
									</>
								) : (
									<span className="text-[11px] text-gray-500">No data</span>
								)}
							</div>
						</div>
					</div>

					{/* Deploy trend chart */}
					{healthMetrics.deploysByDay.length > 0 && (
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
							<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
								Deploy Frequency (Last 14 Days)
							</h3>
							<div className="flex items-end gap-1 h-24">
								{healthMetrics.deploysByDay.map((day, i) => {
									const maxCount = Math.max(...healthMetrics.deploysByDay.map((d) => d.count), 1)
									const height = (day.count / maxCount) * 100
									return (
										<div key={i} className="flex-1 flex flex-col items-center gap-1">
											<span className="text-[8px] text-gray-500">{day.count}</span>
											<div
												className="w-full rounded-t bg-violet-500/40 hover:bg-violet-500/60 transition-colors"
												style={{ height: `${Math.max(height, 4)}%` }}
											/>
											<span className="text-[7px] text-gray-600 truncate w-full text-center">
												{day.date.slice(0, 5)}
											</span>
										</div>
									)
								})}
							</div>
						</div>
					)}

					{/* Failure breakdown */}
					{healthMetrics.failuresByReason.length > 0 && (
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
							<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
								Failure Breakdown
							</h3>
							<div className="space-y-2">
								{healthMetrics.failuresByReason.map((f, i) => (
									<div key={i} className="flex items-center gap-3">
										<span className="text-[10px] text-gray-400 w-32">{f.reason}</span>
										<div className="flex-1 h-4 rounded bg-[#1e2535] overflow-hidden">
											<div
												className="h-full rounded bg-red-500/40"
												style={{
													width: `${Math.min(
														(f.count /
															Math.max(
																...healthMetrics.failuresByReason.map((x) => x.count),
															),
														1) * 100,
													)}%`,
												}}
											/>
										</div>
										<span className="text-[10px] text-gray-400 w-6 text-right">{f.count}</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* No data state */}
					{healthMetrics.totalDeploys === 0 && (
						<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
							<p className="text-[11px] text-gray-500 text-center py-4">
								No deploy data available yet. Deployments will appear here after the first deploy.
							</p>
						</div>
					)}
				</>
			)}

			{/* ── CONFIG TAB ────────────────────────────────────────────────── */}
			{activeTab === "config" && (
				<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]/60 p-4">
					<h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
						Deploy Target
					</h3>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{[
							["Host", deployTarget?.host || "—"],
							["User", deployTarget?.user || "—"],
							["Path", deployTarget?.path || "—"],
							["Health URL", deployTarget?.healthUrl || "Not configured"],
						].map(([label, value]) => (
							<div key={label} className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
								<div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
								<div className="mt-1 break-all text-[11px] text-[#e2e8f0]">{value}</div>
							</div>
						))}
					</div>
					<p className="mt-3 text-[10px] leading-relaxed text-gray-500">
						This panel reflects the active deploy target exposed by the backend. Secret-bearing deploy
						configuration is intentionally not editable from the dashboard.
					</p>
				</div>
			)}
		</div>
	)
}
