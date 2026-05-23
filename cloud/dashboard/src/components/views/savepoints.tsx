"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Save,
	RotateCcw,
	RefreshCw,
	AlertCircle,
	CheckCircle,
	XCircle,
	Clock,
	History,
	Search,
	X,
	ChevronDown,
	ChevronRight,
	Rocket,
	Activity,
	Download,
	Plus,
	Ban,
	Radio,
	Play,
} from "lucide-react"

interface SavepointEntry {
	id: string
	description: string
	taskTitle: string
	status: string
	expires: string
	createdAt?: string
}

interface DeploymentEntry {
	id: string
	name: string
	project: string
	environment: string
	version: string
	ago: string
	status: string
	success: boolean
	timestamp: string
	commitSha?: string | null
	agent?: string | null
	error?: string | null
	rollbackVersion?: string | null
	rollbackStatus?: string | null
}

interface SavepointsResponse {
	success: boolean
	savepoints: SavepointEntry[]
}

interface DeploymentsResponse {
	success: boolean
	deployments: DeploymentEntry[]
}

const ENV_COLORS: Record<string, string> = {
	production: "text-red-400 bg-red-400/10 border-red-400/30",
	staging: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
	development: "text-blue-400 bg-blue-400/10 border-blue-400/30",
}

const STATUS_COLORS: Record<string, string> = {
	healthy: "text-green-400",
	warnings: "text-yellow-400",
	unhealthy: "text-red-400",
	rolled_back: "text-orange-400",
	failed: "text-red-400",
	Safe: "text-green-400",
	Expired: "text-gray-500",
}

function getWsUrl() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	return `${protocol}//${window.location.host}/api/brain/ws`
}

async function fetchSavepoints(): Promise<SavepointsResponse> {
	const res = await fetch("/api/telegram/savepoints")
	return res.json()
}

async function fetchDeployments(): Promise<DeploymentsResponse> {
	const res = await fetch("/api/telegram/deployments")
	return res.json()
}

function SavepointCard({ savepoint }: { savepoint: SavepointEntry }) {
	const [expanded, setExpanded] = useState(false)
	const isSafe = savepoint.status === "Safe"

	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 overflow-hidden">
			<div
				className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1f2e]/50 transition-colors"
				onClick={() => setExpanded(!expanded)}>
				<div className={cn("p-1.5 rounded", isSafe ? "bg-green-400/10" : "bg-gray-400/10")}>
					<Save size={14} className={isSafe ? "text-green-400" : "text-gray-500"} />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-white truncate">{savepoint.id}</span>
						<span
							className={cn(
								"text-[10px] px-1.5 py-0.5 rounded font-medium",
								isSafe ? "text-green-400 bg-green-400/10" : "text-gray-500 bg-gray-400/10",
							)}>
							{savepoint.status}
						</span>
					</div>
					<p className="text-xs text-gray-500 mt-0.5 truncate">{savepoint.description}</p>
				</div>
				<div className="flex items-center gap-2 shrink-0 text-[10px] text-gray-600">
					<Clock size={10} />
					{savepoint.expires}
				</div>
				<div className="text-gray-500">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
			</div>
			{expanded && (
				<div className="px-4 pb-3 pt-1 border-t border-[#1e2535]">
					<div className="grid grid-cols-2 gap-3 text-xs mt-2">
						<div>
							<span className="text-gray-500">Task:</span>
							<span className="text-gray-300 ml-1">{savepoint.taskTitle || "—"}</span>
						</div>
						<div>
							<span className="text-gray-500">Expires:</span>
							<span className="text-gray-300 ml-1">{savepoint.expires}</span>
						</div>
						{savepoint.createdAt && (
							<div>
								<span className="text-gray-500">Created:</span>
								<span className="text-gray-300 ml-1">
									{new Date(savepoint.createdAt).toLocaleString()}
								</span>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

function DeploymentCard({
	deployment,
	onRollback,
}: {
	deployment: DeploymentEntry
	onRollback?: (id: string) => void
}) {
	const [expanded, setExpanded] = useState(false)
	const [rollingBack, setRollingBack] = useState(false)

	const handleRollback = async () => {
		if (!onRollback) return
		setRollingBack(true)
		try {
			await onRollback(deployment.id)
		} finally {
			setRollingBack(false)
		}
	}

	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 overflow-hidden">
			<div
				className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1f2e]/50 transition-colors"
				onClick={() => setExpanded(!expanded)}>
				<div className={cn("p-1.5 rounded", deployment.success ? "bg-green-400/10" : "bg-red-400/10")}>
					<Rocket size={14} className={deployment.success ? "text-green-400" : "text-red-400"} />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-white truncate">{deployment.name}</span>
						<span
							className={cn(
								"px-1.5 py-0.5 rounded text-[10px] font-medium border",
								ENV_COLORS[deployment.environment] || "text-gray-400 bg-gray-400/10 border-gray-400/30",
							)}>
							{deployment.environment}
						</span>
					</div>
					<p className="text-xs text-gray-500 mt-0.5">
						{deployment.project} · {deployment.version}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span
						className={cn("text-[10px] font-medium", STATUS_COLORS[deployment.status] || "text-gray-400")}>
						{deployment.status}
					</span>
					<span className="text-[10px] text-gray-600">{deployment.ago}</span>
				</div>
				<div className="text-gray-500">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
			</div>
			{expanded && (
				<div className="px-4 pb-3 pt-1 border-t border-[#1e2535]">
					<div className="grid grid-cols-2 gap-3 text-xs mt-2">
						<div>
							<span className="text-gray-500">Version:</span>
							<span className="text-gray-300 ml-1 font-mono">{deployment.version}</span>
						</div>
						<div>
							<span className="text-gray-500">Timestamp:</span>
							<span className="text-gray-300 ml-1">
								{new Date(deployment.timestamp).toLocaleString()}
							</span>
						</div>
						<div>
							<span className="text-gray-500">Project:</span>
							<span className="text-gray-300 ml-1">{deployment.project}</span>
						</div>
						<div>
							<span className="text-gray-500">Status:</span>
							<span className={cn("ml-1", STATUS_COLORS[deployment.status] || "text-gray-300")}>
								{deployment.status}
							</span>
						</div>
						{deployment.agent && (
							<div>
								<span className="text-gray-500">Agent:</span>
								<span className="text-gray-300 ml-1">{deployment.agent}</span>
							</div>
						)}
						{deployment.commitSha && (
							<div>
								<span className="text-gray-500">Commit:</span>
								<span className="text-gray-300 ml-1 font-mono">{deployment.commitSha.slice(0, 8)}</span>
							</div>
						)}
						{deployment.error && (
							<div className="col-span-2">
								<span className="text-gray-500">Error:</span>
								<span className="text-red-400 ml-1">{deployment.error}</span>
							</div>
						)}
						{deployment.rollbackVersion && (
							<div>
								<span className="text-gray-500">Rollback:</span>
								<span className="text-orange-400 ml-1">{deployment.rollbackVersion}</span>
							</div>
						)}
					</div>
					{onRollback && deployment.status !== "rolled_back" && (
						<div className="mt-3">
							<button
								onClick={(e) => {
									e.stopPropagation()
									handleRollback()
								}}
								disabled={rollingBack}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 disabled:opacity-50 transition-colors">
								{rollingBack ? (
									<RefreshCw size={12} className="animate-spin" />
								) : (
									<RotateCcw size={12} />
								)}
								{rollingBack ? "Rolling back..." : "Rollback"}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function handleExportSavepoints(savepoints: SavepointEntry[]) {
	const csv = ["id,description,taskTitle,status,expires,createdAt"]
	csv.push(
		...savepoints.map(
			(s) =>
				`${s.id},"${(s.description || "").replace(/"/g, '""')}","${(s.taskTitle || "").replace(/"/g, '""')}",${s.status},${s.expires},${s.createdAt || ""}`,
		),
	)
	const blob = new Blob([csv.join("\n")], { type: "text/csv" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `savepoints-${new Date().toISOString().slice(0, 10)}.csv`
	a.click()
	URL.revokeObjectURL(url)
}

function handleExportDeployments(deployments: DeploymentEntry[]) {
	const csv = ["name,project,environment,version,status,success,timestamp,agent,commitSha"]
	csv.push(
		...deployments.map(
			(d) =>
				`${d.name},${d.project},${d.environment},${d.version},${d.status},${d.success},${d.timestamp},${d.agent || ""},${d.commitSha || ""}`,
		),
	)
	const blob = new Blob([csv.join("\n")], { type: "text/csv" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `deployments-${new Date().toISOString().slice(0, 10)}.csv`
	a.click()
	URL.revokeObjectURL(url)
}

export function SavepointsView() {
	const [savepoints, setSavepoints] = useState<SavepointEntry[]>([])
	const [deployments, setDeployments] = useState<DeploymentEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [tab, setTab] = useState<"savepoints" | "deployments">("savepoints")
	const [refreshing, setRefreshing] = useState(false)
	const [showCreate, setShowCreate] = useState(false)
	const [createDesc, setCreateDesc] = useState("")
	const [createTask, setCreateTask] = useState("")
	const [creating, setCreating] = useState(false)
	const [wsConnected, setWsConnected] = useState(false)

	const wsRef = useRef<WebSocket | null>(null)

	const fetchData = useCallback(async () => {
		try {
			setError(null)
			const [spRes, depRes] = await Promise.all([fetchSavepoints(), fetchDeployments()])
			if (spRes.success) setSavepoints(spRes.savepoints || [])
			if (depRes.success) setDeployments(depRes.deployments || [])
		} catch {
			setError("API server unreachable")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [fetchData])

	// WebSocket for real-time updates
	useEffect(() => {
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null

		function connect() {
			try {
				const ws = new WebSocket(getWsUrl())
				wsRef.current = ws

				ws.onopen = () => {
					setWsConnected(true)
					ws.send(JSON.stringify({ action: "subscribe", params: { event: "deploy.*" } }))
					ws.send(JSON.stringify({ action: "subscribe", params: { event: "savepoint.*" } }))
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
							(msg.event?.startsWith("deploy.") || msg.event?.startsWith("savepoint."))
						) {
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

	const handleRollback = useCallback(
		async (deploymentId: string) => {
			try {
				const res = await fetch("/api/deploy/cancel", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ deploymentId }),
				})
				const data = await res.json()
				if (data.success) {
					fetchData()
				} else {
					setError(data.error || "Rollback failed")
				}
			} catch {
				setError("Rollback request failed")
			}
		},
		[fetchData],
	)

	const filteredSavepoints = useMemo(() => {
		if (!search) return savepoints
		const q = search.toLowerCase()
		return savepoints.filter(
			(s) =>
				s.id.toLowerCase().includes(q) ||
				s.description.toLowerCase().includes(q) ||
				s.taskTitle.toLowerCase().includes(q),
		)
	}, [savepoints, search])

	const filteredDeployments = useMemo(() => {
		if (!search) return deployments
		const q = search.toLowerCase()
		return deployments.filter(
			(d) =>
				d.name.toLowerCase().includes(q) ||
				d.project.toLowerCase().includes(q) ||
				d.environment.toLowerCase().includes(q) ||
				d.version.toLowerCase().includes(q),
		)
	}, [deployments, search])

	const stats = useMemo(() => {
		const safeCount = savepoints.filter((s) => s.status === "Safe").length
		const healthyCount = deployments.filter((d) => d.status === "healthy").length
		const failedCount = deployments.filter((d) => d.status === "failed" || d.status === "unhealthy").length
		const warningCount = deployments.filter((d) => d.status === "warnings").length
		const rolledBackCount = deployments.filter((d) => d.status === "rolled_back").length
		return {
			totalSavepoints: savepoints.length,
			safeCount,
			totalDeployments: deployments.length,
			healthyCount,
			failedCount,
			warningCount,
			rolledBackCount,
		}
	}, [savepoints, deployments])

	const handleCreateSavepoint = async () => {
		if (!createDesc.trim()) return
		setCreating(true)
		try {
			const res = await fetch("/api/savepoints", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					description: createDesc.trim(),
					taskTitle: createTask.trim() || undefined,
				}),
			})
			const data = await res.json()
			if (data.success) {
				setShowCreate(false)
				setCreateDesc("")
				setCreateTask("")
				fetchData()
			} else {
				setError(data.error || "Failed to create savepoint")
			}
		} catch {
			setError("Savepoint creation failed")
		} finally {
			setCreating(false)
		}
	}

	const handleRefresh = useCallback(async () => {
		setRefreshing(true)
		await fetchData()
		setRefreshing(false)
	}, [fetchData])

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold text-white flex items-center gap-2">
						<History size={18} className="text-blue-400" />
						Savepoints & Deployments
					</h1>
					<p className="text-xs text-gray-500 mt-0.5">Rollback savepoints and deployment history</p>
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
						onClick={() => setShowCreate(!showCreate)}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600/20 text-violet-400 hover:bg-violet-600/30 transition-colors">
						<Plus size={12} />
						Create Savepoint
					</button>
					<button
						onClick={() =>
							tab === "savepoints"
								? handleExportSavepoints(filteredSavepoints)
								: handleExportDeployments(filteredDeployments)
						}
						disabled={
							(tab === "savepoints" && savepoints.length === 0) ||
							(tab === "deployments" && deployments.length === 0)
						}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
						<Download size={12} />
						Export CSV
					</button>
					<button
						onClick={handleRefresh}
						disabled={loading || refreshing}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
						<RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Savepoints"
					value={
						<>
							<Save className="inline h-4 w-4 mr-1 text-blue-400" />
							{stats.totalSavepoints}
						</>
					}
				/>
				<StatCard
					label="Safe"
					value={
						<>
							<CheckCircle className="inline h-4 w-4 mr-1 text-green-400" />
							{stats.safeCount}
						</>
					}
				/>
				<StatCard
					label="Deployments"
					value={
						<>
							<Rocket className="inline h-4 w-4 mr-1 text-purple-400" />
							{stats.totalDeployments}
						</>
					}
				/>
				<StatCard
					label="Healthy"
					value={
						<>
							<Activity className="inline h-4 w-4 mr-1 text-green-400" />
							{stats.healthyCount}
						</>
					}
				/>
			</div>

			{/* Create Savepoint Form */}
			{showCreate && (
				<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/80 p-4">
					<h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
						<Save size={14} className="text-green-400" />
						Create Savepoint
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label className="text-xs text-gray-500 mb-1 block">Description *</label>
							<input
								value={createDesc}
								onChange={(e) => setCreateDesc(e.target.value)}
								className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-violet-500/50"
								placeholder="What does this savepoint capture?"
							/>
						</div>
						<div>
							<label className="text-xs text-gray-500 mb-1 block">Task Title</label>
							<input
								value={createTask}
								onChange={(e) => setCreateTask(e.target.value)}
								className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-violet-500/50"
								placeholder="Optional task title"
							/>
						</div>
					</div>
					<div className="flex gap-2 mt-3">
						<button
							onClick={handleCreateSavepoint}
							disabled={creating || !createDesc.trim()}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors">
							<Save size={12} />
							{creating ? "Creating..." : "Create"}
						</button>
						<button
							onClick={() => {
								setShowCreate(false)
								setCreateDesc("")
								setCreateTask("")
							}}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white transition-colors">
							<Ban size={12} />
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Search */}
			<div className="relative max-w-xs">
				<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded pl-8 pr-8 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
					placeholder="Search..."
				/>
				{search && (
					<button
						onClick={() => setSearch("")}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
						<X size={14} />
					</button>
				)}
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-1 border-b border-[#1e2535] pb-2">
				{(["savepoints", "deployments"] as const).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={cn(
							"px-3 py-1.5 rounded text-xs font-medium transition-colors",
							tab === t
								? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
								: "text-gray-500 hover:text-gray-300",
						)}>
						{t === "savepoints" ? "Savepoints" : "Deployments"}
					</button>
				))}
			</div>

			{/* Content */}
			{loading ? (
				<div className="flex items-center justify-center py-12 text-gray-500">
					<RefreshCw size={20} className="animate-spin mr-2" />
					<span className="text-sm">Loading...</span>
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-12 text-red-400">
					<AlertCircle size={20} className="mr-2" />
					<span className="text-sm">{error}</span>
				</div>
			) : tab === "savepoints" ? (
				filteredSavepoints.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-12 text-gray-500">
						<Save size={32} className="mb-2 opacity-50" />
						<p className="text-sm">No savepoints found</p>
						<p className="text-xs mt-1">Create a savepoint to capture the current state</p>
					</div>
				) : (
					<div className="space-y-2">
						{filteredSavepoints.map((sp) => (
							<SavepointCard key={sp.id} savepoint={sp} />
						))}
					</div>
				)
			) : filteredDeployments.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-gray-500">
					<Rocket size={32} className="mb-2 opacity-50" />
					<p className="text-sm">No deployments found</p>
					<p className="text-xs mt-1">Deployments will appear here when recorded by DeployOrchestrator</p>
				</div>
			) : (
				<div className="space-y-2">
					{filteredDeployments.map((dep) => (
						<DeploymentCard key={dep.id} deployment={dep} onRollback={handleRollback} />
					))}
				</div>
			)}
		</div>
	)
}
