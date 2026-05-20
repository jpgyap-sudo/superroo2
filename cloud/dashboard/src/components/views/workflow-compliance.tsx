/**
 * Workflow Compliance Dashboard View
 *
 * Displays workflow compliance statistics, DeepSeek delegation metrics,
 * API usage tracking, and compliance reports.
 */

"use client"

import { useState, useEffect } from "react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	CheckCircle2,
	XCircle,
	AlertTriangle,
	Brain,
	Key,
	GitCommit,
	BarChart3,
	ShieldCheck,
	AlertCircle,
	Link2Off,
	CalendarDays,
	Users,
	Database,
	GitBranch,
	Server,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowStats {
	totalCommits: number
	trackedCommits: number
	untrackedCommits: number
	withModelUsage: number
	withDeepSeek: number
	withoutDeepSeek: number
	fullyCompliant: number
	trackedNonCompliant: number
	deepseekUsage: {
		totalCalls: number
		totalTokens: number
		averageLatencyMs: number
	}
	complianceRate: string | null
	trackingCoverage: string
	delegationRate: string
	linkage: {
		linkedUsageRecords: number
		orphanedUsageRecords: number
	}
	trends: {
		byDay: Array<{
			date: string
			totalCommits: number
			trackedCommits: number
			compliantCommits: number
			deepseekCommits: number
		}>
		byAgent: Array<{
			agent: string
			totalCommits: number
			trackedCommits: number
			compliantCommits: number
			deepseekCommits: number
		}>
	}
	sourceHealth: {
		commitLogAvailable: boolean
		usageLogAvailable: boolean
		commitCount: number
		usageRecordCount: number
		lastTrackedCommitAt: string | null
		lastUsageRecordAt: string | null
	}
	dataQuality?: {
		malformedRecords: number
		missingSha: number
		missingWorkflowCompliance: number
		missingModelUsage: number
		invalidTimestamp: number
	}
}

interface Commit {
	id: string
	commitSha: string
	agent: string
	type: string
	title: string
	timestamp: string
	modelsUsed?: Array<{
		phase: string
		provider: string
		model: string
		apiKeyLast4?: string
		success: boolean
	}>
	workflowCompliance?: {
		isCompliant: boolean
		steps: {
			lessonsRead: boolean
			deepseekDelegated: boolean
			codexReviewed: boolean
			ollamaSummarized: boolean
		}
		violations: string[]
	}
	dataQualityIssues?: string[]
}

interface DeepSeekStats {
	totalCalls: number
	totalTokens: number
	averageLatencyMs: number
	successRate: string
	fallbackRate: string
	delegationRate: string
	apiKeysUsed: string[]
	callsByModel: Record<string, number>
}

interface LearningHealth {
	centralBrainOnline: boolean
	fallbackEnabled: boolean
	currentProject: string
	knownProjects: number
	localFiles: {
		jsonl: { path: string; available: boolean; malformedLines: number }
		markdown: { path: string; available: boolean }
		syncState: { path: string; available: boolean; malformed: boolean }
	}
	lessons: {
		total: number
		draft: number
		promotable: number
		standard: number
		todoRuleCount: number
		missingReusableRule: number
		missingTags: number
		missingProject: number
		lowQuality: number
		malformedLines: number
		learningScore: number
	}
	sync: {
		syncedCount: number
		unsyncedCount: number
		syncCoverage: number
		retryQueueLength: number
		retryQueueAvailable: boolean
	}
	hooks: {
		globalHookAvailable: boolean
		bridgeAvailable: boolean
		hookLogAvailable: boolean
		hookLogPath: string
		retryQueuePath: string
		coreHooksPath: string | null
		blocksGlobalHook: boolean
		lastVerificationStatus: string
	}
}

interface BridgeHealth {
	bridgeAvailable: boolean
	healthy?: boolean
	deepseek: {
		status: string
		configured?: boolean
		model?: string
		keyLast4?: string
		latencyMs?: number
		error?: string
	}
	ollama: {
		status: string
		url?: string
		latencyMs?: number
		models?: string[]
		modelCount?: number
		error?: string
	}
}

// ── Components ────────────────────────────────────────────────────────────────

export default function WorkflowComplianceView() {
	const [activeTab, setActiveTab] = useState("overview")
	const [stats, setStats] = useState<WorkflowStats | null>(null)
	const [commits, setCommits] = useState<Commit[]>([])
	const [deepseekStats, setDeepseekStats] = useState<DeepSeekStats | null>(null)
	const [learningHealth, setLearningHealth] = useState<LearningHealth | null>(null)
	const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth | null>(null)
	const [apiOnline, setApiOnline] = useState<boolean | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [actionStatus, setActionStatus] = useState<string | null>(null)

	useEffect(() => {
		fetchData()
	}, [])

	const fetchData = async () => {
		try {
			setLoading(true)

			// Fetch all data in parallel
			const [statsRes, commitsRes, deepseekRes, learningRes, bridgeRes, healthRes] = await Promise.all([
				fetch("/api/workflow-compliance/stats"),
				fetch("/api/workflow-compliance/commits?limit=20"),
				fetch("/api/workflow-compliance/deepseek-stats"),
				fetch("/api/workflow-compliance/learning-health"),
				fetch("/api/workflow-compliance/bridge-health"),
				fetch("/api/health"),
			])

			if (!statsRes.ok || !commitsRes.ok || !deepseekRes.ok || !learningRes.ok || !bridgeRes.ok) {
				throw new Error("Failed to fetch workflow compliance data")
			}

			const [statsData, commitsData, deepseekData, learningData, bridgeData] = await Promise.all([
				statsRes.json(),
				commitsRes.json(),
				deepseekRes.json(),
				learningRes.json(),
				bridgeRes.json(),
			])

			setStats(statsData.data)
			setCommits(commitsData.data)
			setDeepseekStats(deepseekData.data)
			setLearningHealth(learningData.data)
			setBridgeHealth(bridgeData.data)
			setApiOnline(healthRes.ok)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error")
			setApiOnline(false)
		} finally {
			setLoading(false)
		}
	}

	const runComplianceAction = async (action: string) => {
		try {
			setActionStatus(`Running ${action}...`)
			const res = await fetch("/api/workflow-compliance/action", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			})
			const data = await res.json()
			if (!res.ok || !data.success) {
				throw new Error(data.error || `Action failed: ${action}`)
			}
			setActionStatus(`${action} complete`)
			await fetchData()
		} catch (err) {
			setActionStatus(err instanceof Error ? err.message : "Action failed")
		}
	}

	const tabs = [
		{ id: "overview", label: "Overview", icon: BarChart3 },
		{ id: "commits", label: "Commits", icon: GitCommit },
		{ id: "deepseek", label: "DeepSeek", icon: Brain },
		{ id: "learning", label: "Learning", icon: Database },
		{ id: "hooks", label: "Hooks & Sync", icon: GitBranch },
		{ id: "bridge", label: "Bridge", icon: Server },
		{ id: "violations", label: "Violations", icon: AlertCircle },
	]
	const hasTrackedCommits = (stats?.trackedCommits || 0) > 0
	const complianceLabel = hasTrackedCommits ? `${stats?.complianceRate}% Compliant` : "No tracking data"
	const bridgeHealthy = bridgeHealth?.healthy || false
	const hookHealthy = Boolean(learningHealth?.hooks.globalHookAvailable && !learningHealth?.hooks.blocksGlobalHook)

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-gray-400">Loading workflow compliance data...</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-red-400">Error: {error}</div>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<ShieldCheck className="h-7 w-7 text-emerald-400" />
					<div>
						<h2 className="text-lg font-semibold text-white">Workflow Compliance</h2>
						<p className="text-xs text-gray-500">Track DeepSeek delegation and workflow adherence</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<ActionButton label="Refresh" onClick={fetchData} />
					<ActionButton label="Retry Sync" onClick={() => runComplianceAction("retry-sync")} />
					<ActionButton label="Verify Hook" onClick={() => runComplianceAction("verify-hook")} />
					<ActionButton label="Repair Metadata" onClick={() => runComplianceAction("repair-commit-metadata")} />
					<Badge
						status={hasTrackedCommits && parseFloat(stats?.complianceRate || "0") >= 80 ? "healthy" : "warning"}
						label={complianceLabel}
					/>
				</div>
			</div>

			{actionStatus && (
				<div className="rounded border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100">
					{actionStatus}
				</div>
			)}

			{(stats?.untrackedCommits || 0) > 0 && (
				<div className="flex items-start gap-3 rounded border border-yellow-500/30 bg-yellow-500/10 p-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
					<div className="text-sm text-yellow-100">
						<div className="font-medium">Workflow tracking is incomplete</div>
						<div className="mt-1 text-xs text-yellow-200/80">
							{stats?.untrackedCommits} of {stats?.totalCommits} commits have no workflow metadata.
							Compliance is calculated only across tracked commits.
						</div>
					</div>
				</div>
			)}

			{(stats?.dataQuality?.malformedRecords || 0) > 0 && (
				<div className="flex items-start gap-3 rounded border border-orange-500/30 bg-orange-500/10 p-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
					<div className="text-sm text-orange-100">
						<div className="font-medium">Commit log has data-quality gaps</div>
						<div className="mt-1 text-xs text-orange-200/80">
							{stats?.dataQuality?.malformedRecords} records need metadata repair. Missing telemetry is
							reported separately from actual workflow violations.
						</div>
					</div>
				</div>
			)}

			{(stats?.linkage.orphanedUsageRecords || 0) > 0 && (stats?.withDeepSeek || 0) === 0 && (
				<div className="flex items-start gap-3 rounded border border-sky-500/30 bg-sky-500/10 p-3">
					<Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
					<div className="text-sm text-sky-100">
						<div className="font-medium">Usage records are not linked to commits</div>
						<div className="mt-1 text-xs text-sky-200/80">
							DeepSeek activity exists in the usage log, but no recent commits carry matching model
							metadata.
						</div>
					</div>
				</div>
			)}

			{/* Stats Grid */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard
					label="Compliance Rate"
					value={hasTrackedCommits ? `${stats?.complianceRate}%` : "N/A"}
					sub={`${stats?.fullyCompliant || 0} of ${stats?.trackedCommits || 0} tracked`}
					color={
						hasTrackedCommits && parseFloat(stats?.complianceRate || "0") >= 80
							? "text-emerald-400"
							: "text-yellow-400"
					}
				/>
				<StatCard
					label="Tracking Coverage"
					value={`${stats?.trackingCoverage || 0}%`}
					sub={`${stats?.trackedCommits || 0} of ${stats?.totalCommits || 0} commits`}
					color={(stats?.untrackedCommits || 0) > 0 ? "text-yellow-400" : "text-emerald-400"}
				/>
				<StatCard
					label="DeepSeek Usage"
					value={`${stats?.delegationRate || 0}%`}
					sub={`${stats?.withDeepSeek || 0} tasks`}
					color="text-purple-400"
				/>
				<StatCard
					label="API Calls"
					value={(deepseekStats?.totalCalls || 0).toString()}
					sub={`${(deepseekStats?.totalTokens || 0).toLocaleString()} tokens`}
					color="text-blue-400"
				/>
				<StatCard
					label="Learning Score"
					value={`${learningHealth?.lessons.learningScore ?? 0}%`}
					sub={`${learningHealth?.lessons.total || 0} lessons`}
					color={(learningHealth?.lessons.learningScore || 0) >= 80 ? "text-emerald-400" : "text-yellow-400"}
				/>
				<StatCard
					label="Sync Coverage"
					value={`${learningHealth?.sync.syncCoverage ?? 0}%`}
					sub={`${learningHealth?.sync.unsyncedCount || 0} unsynced`}
					color={(learningHealth?.sync.unsyncedCount || 0) === 0 ? "text-emerald-400" : "text-yellow-400"}
				/>
				<StatCard
					label="Hook Status"
					value={hookHealthy ? "Ready" : "Check"}
					sub={learningHealth?.hooks.blocksGlobalHook ? "hooksPath blocker" : "global hook"}
					color={hookHealthy ? "text-emerald-400" : "text-yellow-400"}
				/>
				<StatCard
					label="Bridge Health"
					value={bridgeHealthy ? "Healthy" : "Degraded"}
					sub={`DeepSeek: ${bridgeHealth?.deepseek.status || "unknown"}`}
					color={bridgeHealthy ? "text-emerald-400" : "text-yellow-400"}
				/>
			</div>

			{/* Tabs */}
			<div className="flex gap-1 overflow-x-auto border-b border-[#1e2535] pb-1">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm transition-colors",
							activeTab === tab.id
								? "border-b-2 border-emerald-500 bg-emerald-500/10 text-emerald-300"
								: "text-gray-500 hover:text-gray-300 hover:bg-white/5",
						)}>
						<tab.icon className="h-4 w-4" />
						{tab.label}
					</button>
				))}
			</div>

			{/* Overview Tab */}
			{activeTab === "overview" && (
				<div className="space-y-4">
					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Workflow Compliance</h3>
						<div className="space-y-4">
							<div>
								<div className="mb-1 flex justify-between text-xs">
									<span className="text-gray-400">Compliant Tasks</span>
									<span className="text-emerald-400">
										{stats?.fullyCompliant || 0} / {stats?.trackedCommits || 0}
									</span>
								</div>
								<div className="h-2 rounded-full bg-[#1e2535]">
									<div
										className="h-full rounded-full bg-emerald-500 transition-all"
										style={{ width: `${stats?.complianceRate || 0}%` }}
									/>
								</div>
							</div>
							<div>
								<div className="mb-1 flex justify-between text-xs">
									<span className="text-gray-400">DeepSeek Delegated</span>
									<span className="text-purple-400">
										{stats?.withDeepSeek || 0} / {stats?.withModelUsage || 0}
									</span>
								</div>
								<div className="h-2 rounded-full bg-[#1e2535]">
									<div
										className="h-full rounded-full bg-purple-500 transition-all"
										style={{ width: `${stats?.delegationRate || 0}%` }}
									/>
								</div>
							</div>
						</div>
						<div className="mt-4 grid grid-cols-2 gap-4 text-xs">
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-gray-500">Tracked Commits</div>
								<div className="text-lg font-bold text-gray-300">{stats?.trackedCommits || 0}</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-gray-500">Untracked Commits</div>
								<div className="text-lg font-bold text-yellow-400">{stats?.untrackedCommits || 0}</div>
							</div>
						</div>
					</Card>

					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Data Health</h3>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<DataHealthItem label="API" value={apiOnline ? "Online" : "Unavailable"} />
							<DataHealthItem
								label="Commit Log"
								value={stats?.sourceHealth.commitLogAvailable ? "Ready" : "Missing"}
							/>
							<DataHealthItem
								label="Usage Log"
								value={stats?.sourceHealth.usageLogAvailable ? "Ready" : "Missing"}
							/>
							<DataHealthItem
								label="Last Tracked Commit"
								value={formatTimestamp(stats?.sourceHealth.lastTrackedCommitAt)}
							/>
						</div>
						<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Last Usage Record</div>
								<div className="mt-1 text-sm font-medium text-gray-200">
									{formatTimestamp(stats?.sourceHealth.lastUsageRecordAt)}
								</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="flex items-center gap-2 text-xs text-gray-500">
									<Link2Off className="h-3.5 w-3.5" />
									Orphaned Usage Records
								</div>
								<div className="mt-1 text-lg font-bold text-yellow-400">
									{stats?.linkage.orphanedUsageRecords || 0}
								</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Linked Usage Records</div>
								<div className="mt-1 text-lg font-bold text-gray-200">
									{stats?.linkage.linkedUsageRecords || 0}
								</div>
							</div>
						</div>
						{stats?.dataQuality && (
							<div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
								<DataHealthItem label="Malformed Records" value={`${stats.dataQuality.malformedRecords}`} />
								<DataHealthItem label="Missing SHA" value={`${stats.dataQuality.missingSha}`} />
								<DataHealthItem
									label="Missing Compliance"
									value={`${stats.dataQuality.missingWorkflowCompliance}`}
								/>
								<DataHealthItem label="Missing Model Usage" value={`${stats.dataQuality.missingModelUsage}`} />
								<DataHealthItem label="Bad Timestamp" value={`${stats.dataQuality.invalidTimestamp}`} />
							</div>
						)}
					</Card>

					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Trends</h3>
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
							<TrendList icon={CalendarDays} title="By Day" items={stats?.trends.byDay || []} />
							<AgentTrendList items={stats?.trends.byAgent || []} />
						</div>
					</Card>

					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">DeepSeek Usage</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Total Calls</div>
								<div className="text-xl font-bold text-gray-200">{deepseekStats?.totalCalls || 0}</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Total Tokens</div>
								<div className="text-xl font-bold text-gray-200">
									{(deepseekStats?.totalTokens || 0).toLocaleString()}
								</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Success Rate</div>
								<div className="text-xl font-bold text-emerald-400">
									{deepseekStats?.successRate || 0}%
								</div>
							</div>
							<div className="rounded bg-[#0a0e1a] p-3">
								<div className="text-xs text-gray-500">Fallback Rate</div>
								<div className="text-xl font-bold text-yellow-400">
									{deepseekStats?.fallbackRate || 0}%
								</div>
							</div>
						</div>
						{deepseekStats?.apiKeysUsed && deepseekStats.apiKeysUsed.length > 0 && (
							<div className="mt-4">
								<div className="mb-2 text-xs text-gray-500">API Keys Used</div>
								<div className="flex flex-wrap gap-2">
									{deepseekStats.apiKeysUsed.map((key) => (
										<div
											key={key}
											className="flex items-center gap-1 rounded bg-[#1e2535] px-2 py-1 text-xs">
											<Key className="h-3 w-3" />
											****{key}
										</div>
									))}
								</div>
							</div>
						)}
					</Card>
				</div>
			)}

			{/* Learning Tab */}
			{activeTab === "learning" && (
				<div className="space-y-4">
					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Learning Layer Health</h3>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
							<StatCard
								label="Central Brain"
								value={learningHealth?.centralBrainOnline ? "Online" : "Unknown"}
								sub={learningHealth?.currentProject || "project unknown"}
								color={learningHealth?.centralBrainOnline ? "text-emerald-400" : "text-yellow-400"}
							/>
							<StatCard
								label="Known Projects"
								value={`${learningHealth?.knownProjects || 0}`}
								sub="cross-project memory"
								color="text-blue-400"
							/>
							<StatCard
								label="Local JSONL"
								value={learningHealth?.localFiles.jsonl.available ? "Ready" : "Missing"}
								sub={`${learningHealth?.localFiles.jsonl.malformedLines || 0} malformed lines`}
								color={learningHealth?.localFiles.jsonl.available ? "text-emerald-400" : "text-red-400"}
							/>
							<StatCard
								label="Markdown Fallback"
								value={learningHealth?.localFiles.markdown.available ? "Ready" : "Missing"}
								sub={learningHealth?.fallbackEnabled ? "fallback enabled" : "fallback disabled"}
								color={learningHealth?.localFiles.markdown.available ? "text-emerald-400" : "text-red-400"}
							/>
						</div>
					</Card>

					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Lesson Quality Compliance</h3>
						<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
							<DataHealthItem label="Total Lessons" value={`${learningHealth?.lessons.total || 0}`} />
							<DataHealthItem label="Promotable" value={`${learningHealth?.lessons.promotable || 0}`} />
							<DataHealthItem label="Standard" value={`${learningHealth?.lessons.standard || 0}`} />
							<DataHealthItem label="Draft" value={`${learningHealth?.lessons.draft || 0}`} />
							<DataHealthItem label="TODO Rules" value={`${learningHealth?.lessons.todoRuleCount || 0}`} />
							<DataHealthItem
								label="Missing Reusable Rule"
								value={`${learningHealth?.lessons.missingReusableRule || 0}`}
							/>
							<DataHealthItem label="Missing Tags" value={`${learningHealth?.lessons.missingTags || 0}`} />
							<DataHealthItem label="Missing Project" value={`${learningHealth?.lessons.missingProject || 0}`} />
						</div>
					</Card>
				</div>
			)}

			{/* Hooks & Sync Tab */}
			{activeTab === "hooks" && (
				<div className="space-y-4">
					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Sync Status</h3>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
							<StatCard
								label="Synced Lessons"
								value={`${learningHealth?.sync.syncedCount || 0}`}
								sub={`${learningHealth?.sync.syncCoverage || 0}% coverage`}
								color="text-emerald-400"
							/>
							<StatCard
								label="Unsynced Lessons"
								value={`${learningHealth?.sync.unsyncedCount || 0}`}
								sub="needs Central Brain sync"
								color={(learningHealth?.sync.unsyncedCount || 0) === 0 ? "text-emerald-400" : "text-yellow-400"}
							/>
							<StatCard
								label="Retry Queue"
								value={`${learningHealth?.sync.retryQueueLength || 0}`}
								sub={learningHealth?.hooks.retryQueuePath || ""}
								color={(learningHealth?.sync.retryQueueLength || 0) === 0 ? "text-emerald-400" : "text-yellow-400"}
							/>
							<StatCard
								label="Last Hook Result"
								value={learningHealth?.hooks.lastVerificationStatus || "unknown"}
								sub={learningHealth?.hooks.hookLogAvailable ? "hook log present" : "no hook log"}
								color="text-blue-400"
							/>
						</div>
					</Card>

					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Global Hook Verification</h3>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<DataHealthItem
								label="Global Hook"
								value={learningHealth?.hooks.globalHookAvailable ? "Available" : "Missing"}
							/>
							<DataHealthItem
								label="Bridge Command"
								value={learningHealth?.hooks.bridgeAvailable ? "Available" : "Missing"}
							/>
							<DataHealthItem
								label="core.hooksPath"
								value={learningHealth?.hooks.coreHooksPath || "Not set"}
							/>
							<DataHealthItem
								label="Global Hook Blocker"
								value={learningHealth?.hooks.blocksGlobalHook ? "Yes" : "No"}
							/>
						</div>
						<div className="mt-4 rounded bg-[#0a0e1a] p-3 text-xs text-gray-500">
							Check hook details in {learningHealth?.hooks.hookLogPath || "hook log"} and retry failures in{" "}
							{learningHealth?.hooks.retryQueuePath || "retry queue"}.
						</div>
					</Card>
				</div>
			)}

			{/* Bridge Tab */}
			{activeTab === "bridge" && (
				<div className="space-y-4">
					<Card>
						<h3 className="mb-4 text-sm font-semibold text-gray-300">Required Model Bridge</h3>
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
							<BridgeStatusCard
								title="DeepSeek Coding Route"
								status={bridgeHealth?.deepseek.status || "unknown"}
								details={[
									`Model: ${bridgeHealth?.deepseek.model || "unknown"}`,
									`Key: ${bridgeHealth?.deepseek.keyLast4 ? `****${bridgeHealth.deepseek.keyLast4}` : "not shown"}`,
									`Latency: ${bridgeHealth?.deepseek.latencyMs ?? "n/a"}ms`,
									bridgeHealth?.deepseek.error ? `Error: ${bridgeHealth.deepseek.error}` : "",
								]}
							/>
							<BridgeStatusCard
								title="Ollama Embeddings Route"
								status={bridgeHealth?.ollama.status || "unknown"}
								details={[
									`URL: ${bridgeHealth?.ollama.url || "unknown"}`,
									`Models: ${bridgeHealth?.ollama.modelCount ?? bridgeHealth?.ollama.models?.length ?? 0}`,
									`Latency: ${bridgeHealth?.ollama.latencyMs ?? "n/a"}ms`,
									bridgeHealth?.ollama.error ? `Error: ${bridgeHealth.ollama.error}` : "",
								]}
							/>
						</div>
					</Card>
				</div>
			)}

			{/* Commits Tab */}
			{activeTab === "commits" && (
				<Card>
					<h3 className="mb-4 text-sm font-semibold text-gray-300">Recent Commits</h3>
					<div className="space-y-3">
						{commits.length === 0 ? (
							<div className="py-8 text-center text-gray-500">
								No commits with workflow tracking found
							</div>
						) : (
							commits.map((commit) => <CommitItem key={commit.id} commit={commit} />)
						)}
					</div>
				</Card>
			)}

			{/* DeepSeek Tab */}
			{activeTab === "deepseek" && (
				<Card>
					<h3 className="mb-4 text-sm font-semibold text-gray-300">DeepSeek Statistics</h3>
					<div className="grid grid-cols-2 gap-4">
						<StatCard
							label="Delegation Rate"
							value={`${deepseekStats?.delegationRate || 0}%`}
							sub="Tasks using DeepSeek"
							color="text-purple-400"
						/>
						<StatCard
							label="Success Rate"
							value={`${deepseekStats?.successRate || 0}%`}
							sub="Successful API calls"
							color="text-emerald-400"
						/>
						<StatCard
							label="Avg Latency"
							value={`${deepseekStats?.averageLatencyMs || 0}ms`}
							sub="Response time"
							color="text-blue-400"
						/>
						<StatCard
							label="Fallback Rate"
							value={`${deepseekStats?.fallbackRate || 0}%`}
							sub="Fallback to other providers"
							color="text-yellow-400"
						/>
					</div>
					{deepseekStats?.callsByModel && Object.keys(deepseekStats.callsByModel).length > 0 && (
						<div className="mt-6">
							<h4 className="mb-3 text-xs font-medium text-gray-400">Calls by Model</h4>
							<div className="space-y-2">
								{Object.entries(deepseekStats.callsByModel).map(([model, count]) => (
									<div key={model} className="flex items-center gap-3">
										<div className="w-32 truncate text-xs text-gray-400">{model}</div>
										<div className="flex-1 rounded-full bg-[#1e2535]">
											<div
												className="h-2 rounded-full bg-purple-500"
												style={{
													width: `${(count / (deepseekStats.totalCalls || 1)) * 100}%`,
												}}
											/>
										</div>
										<div className="w-8 text-right text-xs text-gray-400">{count}</div>
									</div>
								))}
							</div>
						</div>
					)}
				</Card>
			)}

			{/* Violations Tab */}
			{activeTab === "violations" && (
				<Card>
					<h3 className="mb-4 text-sm font-semibold text-gray-300">Workflow Violations</h3>
					<div className="space-y-3">
						{commits.filter((c) => c.workflowCompliance && !c.workflowCompliance.isCompliant).length ===
						0 ? (
							<div className="py-8 text-center">
								<CheckCircle2 className="mx-auto mb-2 h-12 w-12 text-emerald-500" />
								<div className="text-gray-500">No violations found!</div>
							</div>
						) : (
							commits
								.filter((c) => c.workflowCompliance && !c.workflowCompliance.isCompliant)
								.map((commit) => <ViolationItem key={commit.id} commit={commit} />)
						)}
					</div>
				</Card>
			)}
		</div>
	)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CommitItem({ commit }: { commit: Commit }) {
	const isCompliant = commit.workflowCompliance?.isCompliant
	const hasDeepSeek = commit.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")

	return (
		<div className="flex items-start gap-3 rounded bg-[#0a0e1a] p-3">
			<div className="mt-0.5">
				{isCompliant ? (
					<CheckCircle2 className="h-4 w-4 text-emerald-500" />
				) : (
					<XCircle className="h-4 w-4 text-red-500" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium text-gray-200">{commit.title}</span>
					<div
						className={cn(
							"rounded px-1.5 py-0.5 text-[10px]",
							hasDeepSeek ? "bg-purple-500/20 text-purple-300" : "bg-gray-500/20 text-gray-400",
						)}>
						{hasDeepSeek ? "DeepSeek" : "Other"}
					</div>
				</div>
				<div className="mt-1 text-xs text-gray-500">
					{(commit.commitSha || "unknown").substring(0, 8)} • {commit.agent} •{" "}
					{formatTimestamp(commit.timestamp)}
				</div>
				{commit.dataQualityIssues && commit.dataQualityIssues.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1">
						{commit.dataQualityIssues.map((issue) => (
							<span key={issue} className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-300">
								{issue}
							</span>
						))}
					</div>
				)}
				{commit.modelsUsed && commit.modelsUsed.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1">
						{commit.modelsUsed.map((model, idx) => (
							<div
								key={idx}
								className="rounded border border-[#1e2535] px-1.5 py-0.5 text-[10px] text-gray-400">
								{model.phase}: {model.provider}/{model.model}
								{model.apiKeyLast4 && ` (****${model.apiKeyLast4})`}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function ViolationItem({ commit }: { commit: Commit }) {
	return (
		<div className="flex items-start gap-3 rounded border border-red-500/30 bg-red-500/10 p-3">
			<AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium text-gray-200">{commit.title}</div>
				<div className="mt-1 text-xs text-gray-500">
					{(commit.commitSha || "unknown").substring(0, 8)} • {formatTimestamp(commit.timestamp)}
				</div>
				{commit.workflowCompliance?.violations && (
					<ul className="mt-2 list-inside list-disc text-xs text-red-300">
						{commit.workflowCompliance.violations.map((violation, idx) => (
							<li key={idx}>{violation}</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}

function formatTimestamp(value?: string | null) {
	return value ? new Date(value).toLocaleString() : "Unavailable"
}

function DataHealthItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded bg-[#0a0e1a] p-3">
			<div className="text-xs text-gray-500">{label}</div>
			<div className="mt-1 text-sm font-medium text-gray-200">{value}</div>
		</div>
	)
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			className="rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300">
			{label}
		</button>
	)
}

function BridgeStatusCard({ title, status, details }: { title: string; status: string; details: string[] }) {
	const healthy = status === "healthy"
	return (
		<div className="rounded bg-[#0a0e1a] p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="text-sm font-medium text-gray-200">{title}</div>
				<Badge status={healthy ? "online" : "warning"} label={status} />
			</div>
			<div className="space-y-1 text-xs text-gray-500">
				{details.filter(Boolean).map((detail) => (
					<div key={detail}>{detail}</div>
				))}
			</div>
		</div>
	)
}

function TrendList({
	icon: Icon,
	title,
	items,
}: {
	icon: typeof CalendarDays
	title: string
	items: Array<{
		date: string
		totalCommits: number
		trackedCommits: number
		compliantCommits: number
		deepseekCommits: number
	}>
}) {
	return (
		<div className="rounded bg-[#0a0e1a] p-3">
			<div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-400">
				<Icon className="h-3.5 w-3.5" />
				{title}
			</div>
			<div className="space-y-2">
				{items.length === 0 ? (
					<div className="text-xs text-gray-600">No trend data yet</div>
				) : (
					items.map((item) => (
						<div key={item.date} className="flex items-center justify-between text-xs">
							<span className="text-gray-400">{item.date}</span>
							<span className="text-gray-500">
								{item.compliantCommits}/{item.trackedCommits} compliant, {item.deepseekCommits} DeepSeek
							</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}

function AgentTrendList({
	items,
}: {
	items: Array<{
		agent: string
		totalCommits: number
		trackedCommits: number
		compliantCommits: number
		deepseekCommits: number
	}>
}) {
	return (
		<div className="rounded bg-[#0a0e1a] p-3">
			<div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-400">
				<Users className="h-3.5 w-3.5" />
				By Agent
			</div>
			<div className="space-y-2">
				{items.length === 0 ? (
					<div className="text-xs text-gray-600">No agent data yet</div>
				) : (
					items.map((item) => (
						<div key={item.agent} className="flex items-center justify-between gap-3 text-xs">
							<span className="truncate text-gray-400">{item.agent}</span>
							<span className="shrink-0 text-gray-500">
								{item.compliantCommits}/{item.trackedCommits} compliant, {item.deepseekCommits} DeepSeek
							</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}
