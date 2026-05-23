"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	AlertTriangle,
	ShieldAlert,
	Bug,
	Activity,
	RefreshCw,
	Search,
	Loader2,
	BarChart3,
	Network,
	FileWarning,
	CheckCircle2,
	XCircle,
	AlertCircle,
	FlaskConical,
	ScrollText,
	Radio,
	Database,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface RiskAssessment {
	id: string
	project_id: string
	task_id: string | null
	action_type: string
	risk_score: number
	risk_level: string
	reasons: string[]
	matched_patterns: any[]
	created_at: string
}

interface FailurePattern {
	id: string
	project_id: string
	pattern_type: string
	signature: string
	description: string
	severity: string
	suggested_fix: string | null
	source: string
	occurrences: number
	last_seen_at: string
	created_at: string
}

interface SwarmRun {
	id: string
	project_id: string
	task_id: string | null
	problem: string
	status: string
	agents: { name: string; focus: string }[]
	findings: { agent: string; finding: string; confidence: number; suggestedFix?: string }[]
	final_summary: string | null
	created_at: string
}

interface RiskStats {
	totalAssessments: number
	byLevel: Record<string, number>
	byActionType: Record<string, number>
	totalPatterns: number
	patternsBySeverity: Record<string, number>
	patternsByType: Record<string, number>
	avgRiskScore: number
	maxRiskScore: number
	totalOccurrences: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
	low: "bg-green-500/20 text-green-400 border-green-500/30",
	medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
	high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
	critical: "bg-red-500/20 text-red-400 border-red-500/30",
}

const RISK_BAR_COLORS: Record<string, string> = {
	low: "bg-green-500",
	medium: "bg-yellow-500",
	high: "bg-orange-500",
	critical: "bg-red-500",
}

const SEVERITY_COLORS: Record<string, string> = {
	low: "bg-green-500/20 text-green-400",
	medium: "bg-yellow-500/20 text-yellow-400",
	high: "bg-orange-500/20 text-orange-400",
	critical: "bg-red-500/20 text-red-400",
}

function formatTime(ts: string) {
	try {
		const d = new Date(ts)
		return d.toLocaleString()
	} catch {
		return ts
	}
}

function getRiskIcon(level: string) {
	switch (level) {
		case "critical":
			return <XCircle className="w-4 h-4" />
		case "high":
			return <AlertTriangle className="w-4 h-4" />
		case "medium":
			return <AlertCircle className="w-4 h-4" />
		default:
			return <CheckCircle2 className="w-4 h-4" />
	}
}

function getWsUrl() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	return `${protocol}//${window.location.host}/api/brain/ws`
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function RiskHeatmapBar({ score, level }: { score: number; level: string }) {
	const pct = Math.min(score * 100, 100)
	const barColor = RISK_BAR_COLORS[level] || "bg-gray-500"
	return (
		<div className="flex items-center gap-2">
			<div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
				<div
					className={cn("h-full rounded-full transition-all duration-500", barColor)}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="text-xs text-gray-400 w-10 text-right font-mono">{(score * 100).toFixed(0)}%</span>
		</div>
	)
}

function AssessmentCard({ assessment }: { assessment: RiskAssessment }) {
	return (
		<div className="border border-gray-700/50 rounded-lg p-3 space-y-2 bg-gray-800/30">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{getRiskIcon(assessment.risk_level)}
					<Badge status={assessment.risk_level} className="text-xs capitalize" />
					<span className="text-xs text-gray-400 font-mono">{assessment.action_type}</span>
				</div>
				<span className="text-xs text-gray-500">{formatTime(assessment.created_at)}</span>
			</div>
			<RiskHeatmapBar score={assessment.risk_score} level={assessment.risk_level} />
			{assessment.reasons && assessment.reasons.length > 0 && (
				<ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
					{assessment.reasons.slice(0, 3).map((r, i) => (
						<li key={i}>{r}</li>
					))}
				</ul>
			)}
		</div>
	)
}

function PatternCard({ pattern }: { pattern: FailurePattern }) {
	return (
		<div className="border border-gray-700/50 rounded-lg p-3 space-y-2 bg-gray-800/30">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Badge status={pattern.severity} className="text-xs" />
					<span className="text-xs text-gray-400 font-mono">{pattern.pattern_type}</span>
					<span className="text-[10px] text-gray-500 bg-gray-700/50 rounded px-1.5 py-0.5">
						{pattern.source}
					</span>
				</div>
				<span className="text-xs text-gray-500">x{pattern.occurrences}</span>
			</div>
			<p className="text-xs text-gray-300 line-clamp-2">{pattern.description}</p>
			<div className="flex items-center justify-between text-[10px] text-gray-500">
				<span className="font-mono truncate max-w-[200px]">{pattern.signature}</span>
				<span>{formatTime(pattern.last_seen_at)}</span>
			</div>
			{pattern.suggested_fix && (
				<div className="text-[10px] text-green-400/70 bg-green-500/10 rounded px-2 py-1">
					Fix: {pattern.suggested_fix}
				</div>
			)}
		</div>
	)
}

function SwarmRunCard({ run }: { run: SwarmRun }) {
	const statusColor =
		run.status === "completed"
			? "text-green-400"
			: run.status === "running"
				? "text-blue-400"
				: run.status === "failed"
					? "text-red-400"
					: "text-gray-400"
	return (
		<div className="border border-gray-700/50 rounded-lg p-3 space-y-2 bg-gray-800/30">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Network className="w-4 h-4 text-purple-400" />
					<span className={cn("text-xs font-medium capitalize", statusColor)}>{run.status}</span>
				</div>
				<span className="text-xs text-gray-500">{formatTime(run.created_at)}</span>
			</div>
			<p className="text-xs text-gray-300 line-clamp-2">{run.problem}</p>
			{run.agents && run.agents.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{run.agents.map((a, i) => (
						<span key={i} className="text-[10px] text-gray-400 bg-gray-700/50 rounded px-1.5 py-0.5">
							{a.name}
						</span>
					))}
				</div>
			)}
			{run.findings && run.findings.length > 0 && (
				<div className="space-y-1">
					{run.findings.slice(0, 3).map((f, i) => (
						<div key={i} className="text-[10px] text-gray-400 flex items-start gap-1">
							<span className="text-purple-400 font-medium shrink-0">{f.agent}:</span>
							<span className="line-clamp-1">{f.finding}</span>
							<span className="text-gray-600 shrink-0">({(f.confidence * 100).toFixed(0)}%)</span>
						</div>
					))}
				</div>
			)}
			{run.final_summary && (
				<div className="text-[10px] text-gray-500 italic line-clamp-2">{run.final_summary}</div>
			)}
		</div>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function PredictiveRiskView() {
	const [activeTab, setActiveTab] = useState<"assessments" | "patterns" | "swarm" | "assess">("assessments")
	const [assessments, setAssessments] = useState<RiskAssessment[]>([])
	const [patterns, setPatterns] = useState<FailurePattern[]>([])
	const [swarmRuns, setSwarmRuns] = useState<SwarmRun[]>([])
	const [stats, setStats] = useState<RiskStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [brainUnavailable, setBrainUnavailable] = useState(false)
	const [wsConnected, setWsConnected] = useState(false)

	// Assess form state
	const [actionType, setActionType] = useState("deploy")
	const [filesChanged, setFilesChanged] = useState("")
	const [assessResult, setAssessResult] = useState<any>(null)
	const [assessing, setAssessing] = useState(false)

	// Swarm debug form state
	const [problem, setProblem] = useState("")
	const [swarmResult, setSwarmResult] = useState<any>(null)
	const [swarming, setSwarming] = useState(false)

	const wsRef = useRef<WebSocket | null>(null)

	const fetchData = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [assessRes, patternsRes, statsRes, swarmRes] = await Promise.all([
				fetch("/api/brain/risk/assessments"),
				fetch("/api/brain/risk/patterns"),
				fetch("/api/brain/risk/stats"),
				fetch("/api/brain/swarm/runs"),
			])

			const errors: string[] = []
			let all503 = true

			if (assessRes.ok) {
				all503 = false
				const data = await assessRes.json()
				setAssessments(Array.isArray(data.data) ? data.data : [])
			} else {
				if (assessRes.status !== 503) all503 = false
				errors.push(`Assessments: ${assessRes.status}`)
			}

			if (patternsRes.ok) {
				all503 = false
				const data = await patternsRes.json()
				setPatterns(Array.isArray(data.data) ? data.data : [])
			} else {
				if (patternsRes.status !== 503) all503 = false
				errors.push(`Patterns: ${patternsRes.status}`)
			}

			if (statsRes.ok) {
				all503 = false
				const data = await statsRes.json()
				setStats(data.data || null)
			} else {
				if (statsRes.status !== 503) all503 = false
				errors.push(`Stats: ${statsRes.status}`)
			}

			if (swarmRes.ok) {
				all503 = false
				const data = await swarmRes.json()
				setSwarmRuns(Array.isArray(data.data) ? data.data : [])
			} else {
				if (swarmRes.status !== 503) all503 = false
				errors.push(`Swarm: ${swarmRes.status}`)
			}

			setBrainUnavailable(all503)
			if (errors.length > 0 && !all503) {
				setError(errors.join("; "))
			}
		} catch (err: any) {
			setError(err.message || "Failed to load risk data")
			setBrainUnavailable(false)
		} finally {
			setLoading(false)
		}
	}, [])

	// ── Polling ───────────────────────────────────────────────────────────────

	useEffect(() => {
		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [fetchData])

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
					// Subscribe to risk and swarm events
					ws.send(JSON.stringify({ action: "subscribe", params: { event: "risk.*" } }))
					ws.send(JSON.stringify({ action: "subscribe", params: { event: "swarm.*" } }))
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
						if (
							msg.type === "event" &&
							(msg.event?.startsWith("risk.") || msg.event?.startsWith("swarm."))
						) {
							// Trigger immediate data refresh on any risk or swarm event
							fetchData()
						}
					} catch {
						// Ignore malformed messages
					}
				}

				ws.onclose = () => {
					setWsConnected(false)
					if (heartbeatTimer) clearInterval(heartbeatTimer)
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
	}, [fetchData])

	const handleAssess = async () => {
		setAssessing(true)
		setAssessResult(null)
		try {
			const files = filesChanged
				.split(",")
				.map((f) => f.trim())
				.filter(Boolean)
			const res = await fetch("/api/brain/risk/assess", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					actionType,
					filesChanged: files,
				}),
			})
			const data = await res.json()
			if (data.success) {
				setAssessResult(data.data)
				// Refresh data to show new assessment
				fetchData()
			} else {
				setAssessResult({ error: data.error || "Assessment failed" })
			}
		} catch (err: any) {
			setAssessResult({ error: err.message })
		} finally {
			setAssessing(false)
		}
	}

	const handleSwarmDebug = async () => {
		if (!problem.trim()) return
		setSwarming(true)
		setSwarmResult(null)
		try {
			const res = await fetch("/api/brain/swarm/debug", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					problem: problem.trim(),
				}),
			})
			const data = await res.json()
			if (data.success) {
				setSwarmResult(data.data)
				// Refresh data to show new swarm run
				fetchData()
			} else {
				setSwarmResult({ error: data.error || "Swarm debug failed" })
			}
		} catch (err: any) {
			setSwarmResult({ error: err.message })
		} finally {
			setSwarming(false)
		}
	}

	// ── Render ──────────────────────────────────────────────────────────────

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-white flex items-center gap-2">
						<ShieldAlert className="w-6 h-6 text-orange-400" />
						Predictive Risk Engine
					</h1>
					<p className="text-sm text-gray-400 mt-1">
						Predict failures before they happen and run swarm debugging when risk is high
					</p>
				</div>
				<div className="flex items-center gap-2">
					{wsConnected ? (
						<span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 rounded px-2 py-1">
							<Radio className="w-3 h-3" /> Live
						</span>
					) : (
						<span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-700/50 rounded px-2 py-1">
							<Radio className="w-3 h-3" /> Offline
						</span>
					)}
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50">
						<RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Stats Cards */}
			{stats && !brainUnavailable && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<StatCard
						label="Total Assessments"
						value={
							<>
								<BarChart3 className="inline h-4 w-4 mr-1" />
								{stats.totalAssessments}
							</>
						}
					/>
					<StatCard
						label="High/Critical"
						value={(stats.byLevel?.high || 0) + (stats.byLevel?.critical || 0)}
						color="text-red-400"
					/>
					<StatCard
						label="Failure Patterns"
						value={
							<>
								<FileWarning className="inline h-4 w-4 mr-1" />
								{stats.totalPatterns}
							</>
						}
					/>
					<StatCard
						label="Swarm Runs"
						value={
							<>
								<Bug className="inline h-4 w-4 mr-1" />
								{swarmRuns.length}
							</>
						}
					/>
				</div>
			)}

			{/* Tabs */}
			<div className="flex gap-1 border-b border-gray-700/50 pb-2">
				{[
					{ id: "assessments" as const, label: "Risk Assessments", icon: BarChart3 },
					{ id: "patterns" as const, label: "Failure Patterns", icon: FileWarning },
					{ id: "swarm" as const, label: "Swarm Debug", icon: Network },
					{ id: "assess" as const, label: "Assess Risk", icon: FlaskConical },
				].map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t transition-colors",
							activeTab === tab.id
								? "text-orange-400 border-b-2 border-orange-400"
								: "text-gray-400 hover:text-gray-200",
						)}>
						<tab.icon className="w-3.5 h-3.5" />
						{tab.label}
					</button>
				))}
			</div>

			{/* Brain Offline State */}
			{brainUnavailable && !loading && (
				<div className="text-center py-16 space-y-4">
					<Database className="w-12 h-12 text-gray-600 mx-auto" />
					<h3 className="text-lg font-medium text-gray-300">Central Brain Offline</h3>
					<p className="text-sm text-gray-500 max-w-md mx-auto">
						Predictive Risk requires PostgreSQL to store assessments, failure patterns, and swarm runs.
						Start the brain or check your database configuration.
					</p>
					<button
						onClick={fetchData}
						className="flex items-center gap-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors mx-auto">
						<RefreshCw className="w-4 h-4" />
						Retry Connection
					</button>
				</div>
			)}

			{/* Error */}
			{error && !brainUnavailable && (
				<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
					{error}
				</div>
			)}

			{/* Loading */}
			{loading && !brainUnavailable && (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="w-6 h-6 animate-spin text-gray-400" />
				</div>
			)}

			{/* Tab Content */}
			{!loading && !brainUnavailable && (
				<>
					{/* Risk Assessments */}
					{activeTab === "assessments" && (
						<div className="space-y-3">
							{assessments.length === 0 ? (
								<div className="text-center py-12 text-gray-500">
									<BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
									<p className="text-sm">No risk assessments yet</p>
									<p className="text-xs mt-1">Run a risk assessment to see results here</p>
								</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
									{assessments.map((a) => (
										<AssessmentCard key={a.id} assessment={a} />
									))}
								</div>
							)}
						</div>
					)}

					{/* Failure Patterns */}
					{activeTab === "patterns" && (
						<div className="space-y-3">
							{patterns.length === 0 ? (
								<div className="text-center py-12 text-gray-500">
									<FileWarning className="w-8 h-8 mx-auto mb-2 opacity-50" />
									<p className="text-sm">No failure patterns recorded</p>
									<p className="text-xs mt-1">
										Patterns are auto-recorded from self-healing incidents and swarm debug findings
									</p>
								</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
									{patterns.map((p) => (
										<PatternCard key={p.id} pattern={p} />
									))}
								</div>
							)}
						</div>
					)}

					{/* Swarm Debug */}
					{activeTab === "swarm" && (
						<div className="space-y-4">
							{/* Run Swarm Debug Form */}
							<Card className="p-4">
								<h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
									<Network className="w-4 h-4 text-purple-400" />
									Run Swarm Debug
								</h3>
								<div className="flex gap-2">
									<input
										type="text"
										value={problem}
										onChange={(e) => setProblem(e.target.value)}
										placeholder="Describe the problem to debug..."
										className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
										onKeyDown={(e) => e.key === "Enter" && handleSwarmDebug()}
									/>
									<button
										onClick={handleSwarmDebug}
										disabled={swarming || !problem.trim()}
										className="flex items-center gap-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors">
										{swarming ? (
											<Loader2 className="w-4 h-4 animate-spin" />
										) : (
											<Search className="w-4 h-4" />
										)}
										Debug
									</button>
								</div>
							</Card>

							{/* Swarm Result */}
							{swarmResult && (
								<Card className="p-4 space-y-3">
									<h3 className="text-sm font-medium text-white flex items-center gap-2">
										<ScrollText className="w-4 h-4 text-purple-400" />
										Debug Results
									</h3>
									{swarmResult.error ? (
										<div className="text-sm text-red-400">{swarmResult.error}</div>
									) : (
										<>
											<div className="flex items-center gap-2">
												<Badge status={swarmResult.status || "running"} className="text-xs" />
												<span className="text-xs text-gray-500">
													ID: {swarmResult.id || swarmResult.runId}
												</span>
											</div>
											{swarmResult.findings && (
												<div className="space-y-2">
													{swarmResult.findings.map((f: any, i: number) => (
														<div
															key={i}
															className="border border-gray-700/50 rounded p-2 bg-gray-800/20">
															<div className="flex items-center justify-between mb-1">
																<span className="text-xs font-medium text-purple-400">
																	{f.agent}
																</span>
																<span className="text-[10px] text-gray-500">
																	Confidence: {(f.confidence * 100).toFixed(0)}%
																</span>
															</div>
															<p className="text-xs text-gray-300">{f.finding}</p>
															{f.suggestedFix && (
																<div className="mt-1 text-[10px] text-green-400/70 bg-green-500/10 rounded px-2 py-1">
																	Fix: {f.suggestedFix}
																</div>
															)}
														</div>
													))}
												</div>
											)}
											{swarmResult.finalSummary && (
												<div className="text-xs text-gray-400 italic border-t border-gray-700/50 pt-2">
													{swarmResult.finalSummary}
												</div>
											)}
										</>
									)}
								</Card>
							)}

							{/* Swarm Run History */}
							{swarmRuns.length > 0 && (
								<div className="space-y-2">
									<h3 className="text-sm font-medium text-gray-300">Recent Swarm Runs</h3>
									<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
										{swarmRuns.slice(0, 9).map((r) => (
											<SwarmRunCard key={r.id} run={r} />
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{/* Assess Risk Form */}
					{activeTab === "assess" && (
						<div className="max-w-xl space-y-4">
							<Card className="p-4 space-y-4">
								<h3 className="text-sm font-medium text-white flex items-center gap-2">
									<FlaskConical className="w-4 h-4 text-orange-400" />
									Run Risk Assessment
								</h3>

								<div className="space-y-2">
									<label className="text-xs text-gray-400">Action Type</label>
									<select
										value={actionType}
										onChange={(e) => setActionType(e.target.value)}
										className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
										<option value="deploy">Deploy</option>
										<option value="docker_build">Docker Build</option>
										<option value="db_migration">Database Migration</option>
										<option value="delete">Delete</option>
										<option value="large_refactor">Large Refactor</option>
										<option value="config_change">Config Change</option>
										<option value="restart">Restart</option>
										<option value="send_message">Send Message</option>
									</select>
								</div>

								<div className="space-y-2">
									<label className="text-xs text-gray-400">
										Files Changed <span className="text-gray-600">(comma-separated)</span>
									</label>
									<input
										type="text"
										value={filesChanged}
										onChange={(e) => setFilesChanged(e.target.value)}
										placeholder="src/api/route.ts, docker-compose.yml, .env"
										className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
									/>
								</div>

								<button
									onClick={handleAssess}
									disabled={assessing}
									className="flex items-center gap-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors">
									{assessing ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<FlaskConical className="w-4 h-4" />
									)}
									Assess Risk
								</button>
							</Card>

							{/* Assessment Result */}
							{assessResult && (
								<Card className="p-4 space-y-3">
									<h3 className="text-sm font-medium text-white">Assessment Result</h3>
									{assessResult.error ? (
										<div className="text-sm text-red-400">{assessResult.error}</div>
									) : (
										<>
											<div className="flex items-center gap-2">
												{getRiskIcon(assessResult.riskLevel)}
												<Badge status={assessResult.riskLevel} className="text-xs capitalize" />
												<span className="text-xs text-gray-400">
													Score: {(assessResult.riskScore * 100).toFixed(1)}%
												</span>
											</div>
											<RiskHeatmapBar
												score={assessResult.riskScore}
												level={assessResult.riskLevel}
											/>
											{assessResult.reasons && assessResult.reasons.length > 0 && (
												<div className="space-y-1">
													<span className="text-xs text-gray-400 font-medium">Reasons:</span>
													<ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
														{assessResult.reasons.map((r: string, i: number) => (
															<li key={i}>{r}</li>
														))}
													</ul>
												</div>
											)}
											{assessResult.matchedPatterns &&
												assessResult.matchedPatterns.length > 0 && (
													<div className="space-y-1">
														<span className="text-xs text-gray-400 font-medium">
															Matched Historical Patterns:
														</span>
														{assessResult.matchedPatterns.map((mp: any, i: number) => (
															<div
																key={i}
																className="text-[10px] text-gray-500 bg-gray-800/30 rounded px-2 py-1">
																{mp.description || mp.signature}
															</div>
														))}
													</div>
												)}
											{assessResult.swarmRunId && (
												<div className="text-[10px] text-purple-400 bg-purple-500/10 rounded px-2 py-1">
													Auto-triggered swarm debug: {assessResult.swarmRunId}
												</div>
											)}
										</>
									)}
								</Card>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}
