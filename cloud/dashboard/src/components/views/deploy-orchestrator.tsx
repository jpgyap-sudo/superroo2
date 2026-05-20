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
	GitCommit,
	User,
	Hash,
	RotateCcw,
	BarChart3,
	Layers,
	SkipForward,
	Activity,
	Shield,
} from "lucide-react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Deployment {
	id: string
	projectName: string
	version: string | null
	commitSha: string | null
	status: string
	agent: string | null
	initiatedBy: string | null
	error: string | null
	rollbackVersion: string | null
	healthBefore: { healthy: boolean; statusCode?: number; error?: string } | null
	healthAfter: { healthy: boolean; statusCode?: number; error?: string } | null
	createdAt: number
	updatedAt: number
	startedAt: number | null
	completedAt: number | null
}

interface QueueItem {
	id: string
	projectName: string
	type: string
	priority: number
	status: string
	input: any
	agent: string | null
	createdAt: number
}

interface BuildItem {
	id: string
	projectName: string
	buildType: string
	imageTag: string | null
	commitSha: string | null
	status: string
	agent: string | null
	output: string | null
	error: string | null
	createdAt: number
	startedAt: number | null
	completedAt: number | null
}

interface DeployStats {
	totalDeployments: number
	byStatus: Record<string, number>
	byAgent: Record<string, number>
	queueLength: number
	activeBuilds: number
	latestDeployment: Deployment | null
	maxConcurrentDeploys: number
	maxConcurrentBuilds: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number | null | undefined): string {
	if (!ts) return "—"
	return new Date(ts).toLocaleString()
}

function formatRelativeTime(ts: number): string {
	const diff = Date.now() - ts
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

// ─── Deploy Orchestrator View ────────────────────────────────────────────────

export function DeployOrchestratorView() {
	const [activeTab, setActiveTab] = useState<"deployments" | "queue" | "builds" | "stats">("deployments")
	const [deployments, setDeployments] = useState<Deployment[]>([])
	const [queue, setQueue] = useState<QueueItem[]>([])
	const [builds, setBuilds] = useState<BuildItem[]>([])
	const [stats, setStats] = useState<DeployStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [deploying, setDeploying] = useState(false)
	const [version, setVersion] = useState("")
	const [commitSha, setCommitSha] = useState("")
	const [agent, setAgent] = useState("dashboard")
	const [deployResult, setDeployResult] = useState<string | null>(null)

	const fetchData = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [deployRes, queueRes, buildsRes, statsRes] = await Promise.all([
				fetch("/api/deploy/active"),
				fetch("/api/deploy/queue"),
				fetch("/api/deploy/builds"),
				fetch("/orchestrator/deploy-orchestrator/stats"),
			])

			if (deployRes.ok) {
				const data = await deployRes.json()
				setDeployments(data.active || [])
			}
			if (queueRes.ok) {
				const data = await queueRes.json()
				setQueue(data.queue || [])
			}
			if (buildsRes.ok) {
				const data = await buildsRes.json()
				setBuilds(data.builds || [])
			}
			if (statsRes.ok) {
				const data = await statsRes.json()
				setStats(data.stats || null)
			}
		} catch (err: any) {
			setError(err.message || "Failed to fetch data")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
		const interval = setInterval(fetchData, 10000)
		return () => clearInterval(interval)
	}, [fetchData])

	const handleDeploy = async () => {
		if (!version || !commitSha) return
		setDeploying(true)
		setDeployResult(null)
		try {
			const res = await fetch("/api/deploy", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ version, commitSha, agent }),
			})
			const data = await res.json()
			setDeployResult(data.deploy?.status || "unknown")
			if (data.success) {
				setVersion("")
				setCommitSha("")
				fetchData()
			}
		} catch (err: any) {
			setDeployResult(`Error: ${err.message}`)
		} finally {
			setDeploying(false)
		}
	}

	const handleForceDeploy = async () => {
		if (!version || !commitSha) return
		setDeploying(true)
		setDeployResult(null)
		try {
			const res = await fetch("/api/deploy/force", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ version, commitSha, agent }),
			})
			const data = await res.json()
			setDeployResult(data.deploy?.status || "unknown")
			if (data.success) {
				setVersion("")
				setCommitSha("")
				fetchData()
			}
		} catch (err: any) {
			setDeployResult(`Error: ${err.message}`)
		} finally {
			setDeploying(false)
		}
	}

	const handleCancel = async (deploymentId: string) => {
		try {
			await fetch("/api/deploy/cancel", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deploymentId }),
			})
			fetchData()
		} catch {}
	}

	// ── Render ───────────────────────────────────────────────────────────

	return (
		<div className="p-6 space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-vscode-foreground">Deploy Orchestrator</h1>
					<p className="text-sm text-vscode-descriptionForeground mt-1">
						Unified deployment system — queue, build, deploy, and rollback
					</p>
				</div>
				<button
					onClick={fetchData}
					className="flex items-center gap-2 px-3 py-1.5 rounded text-sm bg-vscode-buttonBackground hover:bg-vscode-buttonHoverBackground text-vscode-buttonForeground transition-colors"
					disabled={loading}
				>
					<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>

			{/* Stats Cards */}
			{stats && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<StatCard label="Total Deployments" value={stats.totalDeployments.toString()} />
					<StatCard label="Queue Length" value={stats.queueLength.toString()} />
					<StatCard label="Active Builds" value={stats.activeBuilds.toString()} />
					<StatCard label="Max Concurrent" value={`${stats.maxConcurrentDeploys}D / ${stats.maxConcurrentBuilds}B`} />
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
					{error}
				</div>
			)}

			{/* Deploy Form */}
			<Card className="p-4">
				<h2 className="text-lg font-semibold text-vscode-foreground mb-4">New Deployment</h2>
				<div className="flex flex-wrap gap-3 items-end">
					<div className="flex-1 min-w-[150px]">
						<label className="block text-xs text-vscode-descriptionForeground mb-1">Version</label>
						<input
							type="text"
							value={version}
							onChange={(e) => setVersion(e.target.value)}
							placeholder="e.g. v1.2.3"
							className="w-full px-3 py-1.5 rounded bg-vscode-inputBackground border border-vscode-inputBorder text-vscode-inputForeground text-sm focus:outline-none focus:border-vscode-focusBorder"
						/>
					</div>
					<div className="flex-1 min-w-[150px]">
						<label className="block text-xs text-vscode-descriptionForeground mb-1">Commit SHA</label>
						<input
							type="text"
							value={commitSha}
							onChange={(e) => setCommitSha(e.target.value)}
							placeholder="e.g. a1b2c3d4"
							className="w-full px-3 py-1.5 rounded bg-vscode-inputBackground border border-vscode-inputBorder text-vscode-inputForeground text-sm focus:outline-none focus:border-vscode-focusBorder"
						/>
					</div>
					<div className="flex-1 min-w-[120px]">
						<label className="block text-xs text-vscode-descriptionForeground mb-1">Agent</label>
						<input
							type="text"
							value={agent}
							onChange={(e) => setAgent(e.target.value)}
							placeholder="agent name"
							className="w-full px-3 py-1.5 rounded bg-vscode-inputBackground border border-vscode-inputBorder text-vscode-inputForeground text-sm focus:outline-none focus:border-vscode-focusBorder"
						/>
					</div>
					<div className="flex gap-2">
						<button
							onClick={handleDeploy}
							disabled={deploying || !version || !commitSha}
							className="flex items-center gap-2 px-4 py-1.5 rounded text-sm bg-vscode-buttonBackground hover:bg-vscode-buttonHoverBackground text-vscode-buttonForeground transition-colors disabled:opacity-50"
						>
							{deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
							Deploy
						</button>
						<button
							onClick={handleForceDeploy}
							disabled={deploying || !version || !commitSha}
							className="flex items-center gap-2 px-4 py-1.5 rounded text-sm bg-orange-600 hover:bg-orange-700 text-white transition-colors disabled:opacity-50"
						>
							{deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
							Force
						</button>
					</div>
				</div>
				{deployResult && (
					<div className="mt-3 text-sm text-vscode-descriptionForeground">
						Result: <span className="font-mono">{deployResult}</span>
					</div>
				)}
			</Card>

			{/* Tabs */}
			<div className="flex gap-1 border-b border-vscode-panelBorder">
				{(["deployments", "queue", "builds", "stats"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
							activeTab === tab
								? "text-vscode-foreground border-vscode-focusBorder"
								: "text-vscode-descriptionForeground border-transparent hover:text-vscode-foreground"
						}`}
					>
						{tab}
					</button>
				))}
			</div>

			{/* Tab Content */}
			{activeTab === "deployments" && (
				<div className="space-y-3">
					{loading && deployments.length === 0 ? (
						<div className="flex items-center justify-center py-12 text-vscode-descriptionForeground">
							<Loader2 className="w-6 h-6 animate-spin mr-2" />
							Loading deployments...
						</div>
					) : deployments.length === 0 ? (
						<div className="text-center py-12 text-vscode-descriptionForeground">
							No active deployments
						</div>
					) : (
						deployments.map((d) => (
							<Card key={d.id} className="p-4">
								<div className="flex items-start justify-between">
									<div className="space-y-2 flex-1">
										<div className="flex items-center gap-3">
											<span className="font-mono text-sm font-medium text-vscode-foreground">
												{d.version || "—"}
											</span>
											<Badge status={d.status} label={d.status.replace(/_/g, " ")} />
										</div>
										<div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-vscode-descriptionForeground">
											<span className="flex items-center gap-1">
												<Hash className="w-3 h-3" />
												{d.commitSha?.substring(0, 8) || "—"}
											</span>
											<span className="flex items-center gap-1">
												<User className="w-3 h-3" />
												{d.agent || "unknown"}
											</span>
											<span className="flex items-center gap-1">
												<Clock className="w-3 h-3" />
												{formatRelativeTime(d.createdAt)}
											</span>
										</div>
										{d.error && (
											<div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
												{d.error}
											</div>
										)}
										{d.healthBefore && (
											<div className="flex gap-4 text-xs">
												<span className={d.healthBefore.healthy ? "text-green-400" : "text-red-400"}>
													Pre-deploy: {d.healthBefore.healthy ? "Healthy" : "Unhealthy"}
												</span>
												{d.healthAfter && (
													<span className={d.healthAfter.healthy ? "text-green-400" : "text-red-400"}>
														Post-deploy: {d.healthAfter.healthy ? "Healthy" : "Unhealthy"}
													</span>
												)}
											</div>
										)}
									</div>
									{(d.status === "queued" || d.status === "running") && (
										<button
											onClick={() => handleCancel(d.id)}
											className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
										>
											Cancel
										</button>
									)}
								</div>
							</Card>
						))
					)}
				</div>
			)}

			{activeTab === "queue" && (
				<div className="space-y-3">
					{loading && queue.length === 0 ? (
						<div className="flex items-center justify-center py-12 text-vscode-descriptionForeground">
							<Loader2 className="w-6 h-6 animate-spin mr-2" />
							Loading queue...
						</div>
					) : queue.length === 0 ? (
						<div className="text-center py-12 text-vscode-descriptionForeground">
							Queue is empty
						</div>
					) : (
						queue.map((q) => (
							<Card key={q.id} className="p-4">
								<div className="flex items-start justify-between">
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm text-vscode-foreground">{q.type}</span>
											<Badge status={q.status} label={q.status} />
											{q.priority > 0 && (
												<Badge status="warning" label={`Priority ${q.priority}`} />
											)}
										</div>
										<div className="text-xs text-vscode-descriptionForeground">
											Agent: {q.agent || "unknown"} &middot; Queued: {formatRelativeTime(q.createdAt)}
										</div>
									</div>
								</div>
							</Card>
						))
					)}
				</div>
			)}

			{activeTab === "builds" && (
				<div className="space-y-3">
					{loading && builds.length === 0 ? (
						<div className="flex items-center justify-center py-12 text-vscode-descriptionForeground">
							<Loader2 className="w-6 h-6 animate-spin mr-2" />
							Loading builds...
						</div>
					) : builds.length === 0 ? (
						<div className="text-center py-12 text-vscode-descriptionForeground">
							No builds recorded
						</div>
					) : (
						builds.map((b) => (
							<Card key={b.id} className="p-4">
								<div className="flex items-start justify-between">
									<div className="space-y-2 flex-1">
										<div className="flex items-center gap-3">
											<span className="font-mono text-sm font-medium text-vscode-foreground">
												{b.buildType}
											</span>
											<Badge status={b.status} label={b.status} />
										</div>
										<div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-vscode-descriptionForeground">
											{b.imageTag && (
												<span className="font-mono">{b.imageTag}</span>
											)}
											{b.commitSha && (
												<span className="flex items-center gap-1">
													<Hash className="w-3 h-3" />
													{b.commitSha.substring(0, 8)}
												</span>
											)}
											<span className="flex items-center gap-1">
												<User className="w-3 h-3" />
												{b.agent || "unknown"}
											</span>
											<span className="flex items-center gap-1">
												<Clock className="w-3 h-3" />
												{formatRelativeTime(b.createdAt)}
											</span>
										</div>
										{b.error && (
											<div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
												{b.error}
											</div>
										)}
									</div>
								</div>
							</Card>
						))
					)}
				</div>
			)}

			{activeTab === "stats" && stats && (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Card className="p-4">
						<h3 className="text-sm font-semibold text-vscode-foreground mb-3">Deployments by Status</h3>
						<div className="space-y-2">
							{Object.entries(stats.byStatus).length === 0 ? (
								<p className="text-xs text-vscode-descriptionForeground">No data</p>
							) : (
								Object.entries(stats.byStatus).map(([status, count]) => (
									<div key={status} className="flex items-center justify-between text-sm">
										<div className="flex items-center gap-2">
											<span className="capitalize text-vscode-foreground">{status.replace(/_/g, " ")}</span>
										</div>
										<span className="font-mono text-vscode-foreground">{count}</span>
									</div>
								))
							)}
						</div>
					</Card>

					<Card className="p-4">
						<h3 className="text-sm font-semibold text-vscode-foreground mb-3">Deployments by Agent</h3>
						<div className="space-y-2">
							{Object.entries(stats.byAgent).length === 0 ? (
								<p className="text-xs text-vscode-descriptionForeground">No data</p>
							) : (
								Object.entries(stats.byAgent).map(([agent, count]) => (
									<div key={agent} className="flex items-center justify-between text-sm">
										<div className="flex items-center gap-2">
											<User className="w-4 h-4 text-vscode-descriptionForeground" />
											<span className="text-vscode-foreground">{agent}</span>
										</div>
										<span className="font-mono text-vscode-foreground">{count}</span>
									</div>
								))
							)}
						</div>
					</Card>

					{stats.latestDeployment && (
						<Card className="p-4 md:col-span-2">
							<h3 className="text-sm font-semibold text-vscode-foreground mb-3">Latest Deployment</h3>
							<div className="space-y-1 text-sm text-vscode-descriptionForeground">
								<div className="flex items-center gap-2">
									<span className="font-mono text-vscode-foreground">{stats.latestDeployment.version || "—"}</span>
									<Badge status={stats.latestDeployment.status} label={stats.latestDeployment.status.replace(/_/g, " ")} />
								</div>
								<p>Commit: {stats.latestDeployment.commitSha?.substring(0, 8) || "—"}</p>
								<p>Agent: {stats.latestDeployment.agent || "unknown"}</p>
								<p>Time: {formatTime(stats.latestDeployment.createdAt)}</p>
								{stats.latestDeployment.error && (
									<p className="text-red-400">Error: {stats.latestDeployment.error}</p>
								)}
							</div>
						</Card>
					)}
				</div>
			)}
		</div>
	)
}
