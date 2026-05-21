"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
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
	Server,
	Search,
	X,
	ChevronDown,
	ChevronRight,
	Rocket,
	Activity,
} from "lucide-react"

interface SavepointEntry {
	id: string
	description: string
	taskTitle: string
	status: string
	expires: string
}

interface DeploymentEntry {
	name: string
	project: string
	environment: string
	version: string
	ago: string
	status: string
	success: boolean
	timestamp: string
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
				onClick={() => setExpanded(!expanded)}
			>
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
							)}
						>
							{savepoint.status}
						</span>
					</div>
					<p className="text-xs text-gray-500 mt-0.5 truncate">{savepoint.description}</p>
				</div>
				<div className="flex items-center gap-2 shrink-0 text-[10px] text-gray-600">
					<Clock size={10} />
					{savepoint.expires}
				</div>
				<div className="text-gray-500">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
				</div>
			</div>
			{expanded && (
				<div className="px-4 pb-3 pt-1 border-t border-[#1e2535]">
					<div className="grid grid-cols-2 gap-3 text-xs mt-2">
						<div>
							<span className="text-gray-500">Task:</span>
							<span className="text-gray-300 ml-1">{savepoint.taskTitle}</span>
						</div>
						<div>
							<span className="text-gray-500">Expires:</span>
							<span className="text-gray-300 ml-1">{savepoint.expires}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

function DeploymentCard({ deployment }: { deployment: DeploymentEntry }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 overflow-hidden">
			<div
				className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1f2e]/50 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
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
							)}
						>
							{deployment.environment}
						</span>
					</div>
					<p className="text-xs text-gray-500 mt-0.5">
						{deployment.project} · {deployment.version}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span
						className={cn(
							"text-[10px] font-medium",
							STATUS_COLORS[deployment.status] || "text-gray-400",
						)}
					>
						{deployment.status}
					</span>
					<span className="text-[10px] text-gray-600">{deployment.ago}</span>
				</div>
				<div className="text-gray-500">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
				</div>
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
							<span className="text-gray-300 ml-1">{new Date(deployment.timestamp).toLocaleString()}</span>
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
					</div>
				</div>
			)}
		</div>
	)
}

export function SavepointsView() {
	const [savepoints, setSavepoints] = useState<SavepointEntry[]>([])
	const [deployments, setDeployments] = useState<DeploymentEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [tab, setTab] = useState<"savepoints" | "deployments">("savepoints")

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
	}, [fetchData])

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
		return { totalSavepoints: savepoints.length, safeCount, totalDeployments: deployments.length, healthyCount, failedCount }
	}, [savepoints, deployments])

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div>
				<h1 className="text-lg font-semibold text-white flex items-center gap-2">
					<History size={18} className="text-blue-400" />
					Savepoints & Deployments
				</h1>
				<p className="text-xs text-gray-500 mt-0.5">
					Rollback savepoints and deployment history
				</p>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Savepoints"
					value={<><Save className="inline h-4 w-4 mr-1 text-blue-400" />{stats.totalSavepoints}</>}
				/>
				<StatCard
					label="Safe"
					value={<><CheckCircle className="inline h-4 w-4 mr-1 text-green-400" />{stats.safeCount}</>}
				/>
				<StatCard
					label="Deployments"
					value={<><Rocket className="inline h-4 w-4 mr-1 text-purple-400" />{stats.totalDeployments}</>}
				/>
				<StatCard
					label="Healthy"
					value={<><Activity className="inline h-4 w-4 mr-1 text-green-400" />{stats.healthyCount}</>}
				/>
			</div>

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
					<button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
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
						)}
					>
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
				</div>
			) : (
				<div className="space-y-2">
					{filteredDeployments.map((dep, i) => (
						<DeploymentCard key={`${dep.name}-${i}`} deployment={dep} />
					))}
				</div>
			)}
		</div>
	)
}
