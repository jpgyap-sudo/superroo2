/**
 * Workflow Compliance Dashboard View
 *
 * Displays workflow compliance statistics, DeepSeek delegation metrics,
 * API usage tracking, and compliance reports.
 */

"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
	CheckCircle2,
	XCircle,
	AlertTriangle,
	Brain,
	Code2,
	Activity,
	Key,
	Clock,
	TrendingUp,
	TrendingDown,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowStats {
	totalCommits: number
	withModelUsage: number
	withDeepSeek: number
	withoutDeepSeek: number
	fullyCompliant: number
	deepseekUsage: {
		totalCalls: number
		totalTokens: number
		averageLatencyMs: number
	}
	complianceRate: string
	delegationRate: string
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

// ── Components ────────────────────────────────────────────────────────────────

export default function WorkflowComplianceView() {
	const [stats, setStats] = useState<WorkflowStats | null>(null)
	const [commits, setCommits] = useState<Commit[]>([])
	const [deepseekStats, setDeepseekStats] = useState<DeepSeekStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		fetchData()
	}, [])

	const fetchData = async () => {
		try {
			setLoading(true)

			// Fetch all data in parallel
			const [statsRes, commitsRes, deepseekRes] = await Promise.all([
				fetch("/api/workflow-compliance/stats"),
				fetch("/api/workflow-compliance/commits?limit=20"),
				fetch("/api/workflow-compliance/deepseek-stats"),
			])

			if (!statsRes.ok || !commitsRes.ok || !deepseekRes.ok) {
				throw new Error("Failed to fetch workflow compliance data")
			}

			const [statsData, commitsData, deepseekData] = await Promise.all([
				statsRes.json(),
				commitsRes.json(),
				deepseekRes.json(),
			])

			setStats(statsData.data)
			setCommits(commitsData.data)
			setDeepseekStats(deepseekData.data)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error")
		} finally {
			setLoading(false)
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-lg">Loading workflow compliance data...</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-lg text-red-500">Error: {error}</div>
			</div>
		)
	}

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-3xl font-bold">Workflow Compliance</h1>
				<Badge variant="outline" className="text-sm">
					DeepSeek Key: ****b52d
				</Badge>
			</div>

			{/* Overview Stats */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					title="Compliance Rate"
					value={`${stats?.complianceRate}%`}
					icon={<CheckCircle2 className="h-5 w-5" />}
					trend={parseFloat(stats?.complianceRate || "0") >= 80 ? "good" : "warning"}
				/>
				<StatCard
					title="DeepSeek Delegation"
					value={`${stats?.delegationRate}%`}
					icon={<Brain className="h-5 w-5" />}
					trend={parseFloat(stats?.delegationRate || "0") >= 90 ? "good" : "warning"}
				/>
				<StatCard
					title="Total API Calls"
					value={deepseekStats?.totalCalls.toString() || "0"}
					icon={<Activity className="h-5 w-5" />}
					trend="neutral"
				/>
				<StatCard
					title="Avg Latency"
					value={`${deepseekStats?.averageLatencyMs || 0}ms`}
					icon={<Clock className="h-5 w-5" />}
					trend={(deepseekStats?.averageLatencyMs || 0) < 1000 ? "good" : "warning"}
				/>
			</div>

			{/* Main Content Tabs */}
			<Tabs defaultValue="overview" className="space-y-4">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="commits">Recent Commits</TabsTrigger>
					<TabsTrigger value="deepseek">DeepSeek Stats</TabsTrigger>
					<TabsTrigger value="violations">Violations</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-4">
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<Card>
							<CardHeader>
								<CardTitle>Workflow Compliance</CardTitle>
								<CardDescription>Overall workflow adherence</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<div className="flex justify-between text-sm">
										<span>Compliant Tasks</span>
										<span className="font-medium">{stats?.fullyCompliant || 0}</span>
									</div>
									<Progress value={parseFloat(stats?.complianceRate || "0")} className="h-2" />
								</div>
								<div className="space-y-2">
									<div className="flex justify-between text-sm">
										<span>DeepSeek Delegated</span>
										<span className="font-medium">{stats?.withDeepSeek || 0}</span>
									</div>
									<Progress value={parseFloat(stats?.delegationRate || "0")} className="h-2" />
								</div>
								<div className="pt-4 grid grid-cols-2 gap-4 text-sm">
									<div>
										<div className="text-muted-foreground">With Model Tracking</div>
										<div className="text-2xl font-bold">{stats?.withModelUsage || 0}</div>
									</div>
									<div>
										<div className="text-muted-foreground">Skipped DeepSeek</div>
										<div className="text-2xl font-bold text-yellow-500">
											{stats?.withoutDeepSeek || 0}
										</div>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>DeepSeek Usage</CardTitle>
								<CardDescription>API consumption metrics</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-1">
										<div className="text-sm text-muted-foreground">Total Calls</div>
										<div className="text-2xl font-bold">{deepseekStats?.totalCalls || 0}</div>
									</div>
									<div className="space-y-1">
										<div className="text-sm text-muted-foreground">Total Tokens</div>
										<div className="text-2xl font-bold">
											{(deepseekStats?.totalTokens || 0).toLocaleString()}
										</div>
									</div>
									<div className="space-y-1">
										<div className="text-sm text-muted-foreground">Success Rate</div>
										<div className="text-2xl font-bold text-green-500">
											{deepseekStats?.successRate}%
										</div>
									</div>
									<div className="space-y-1">
										<div className="text-sm text-muted-foreground">Fallback Rate</div>
										<div className="text-2xl font-bold text-yellow-500">
											{deepseekStats?.fallbackRate}%
										</div>
									</div>
								</div>
								{deepseekStats?.apiKeysUsed && deepseekStats.apiKeysUsed.length > 0 && (
									<div className="pt-2">
										<div className="text-sm text-muted-foreground mb-2">API Keys Used</div>
										<div className="flex flex-wrap gap-2">
											{deepseekStats.apiKeysUsed.map((key) => (
												<Badge key={key} variant="secondary">
													<Key className="h-3 w-3 mr-1" />
													****{key}
												</Badge>
											))}
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				<TabsContent value="commits">
					<Card>
						<CardHeader>
							<CardTitle>Recent Commits</CardTitle>
							<CardDescription>Latest commits with workflow tracking</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								{commits.length === 0 ? (
									<div className="text-center py-8 text-muted-foreground">
										No commits with workflow tracking found
									</div>
								) : (
									commits.map((commit) => <CommitItem key={commit.id} commit={commit} />)
								)}
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="deepseek">
					<Card>
						<CardHeader>
							<CardTitle>DeepSeek Statistics</CardTitle>
							<CardDescription>Detailed DeepSeek API usage</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
								<MetricCard
									label="Delegation Rate"
									value={`${deepseekStats?.delegationRate}%`}
									description="Tasks using DeepSeek"
								/>
								<MetricCard
									label="Success Rate"
									value={`${deepseekStats?.successRate}%`}
									description="Successful API calls"
								/>
								<MetricCard
									label="Avg Latency"
									value={`${deepseekStats?.averageLatencyMs}ms`}
									description="Response time"
								/>
								<MetricCard
									label="Fallback Rate"
									value={`${deepseekStats?.fallbackRate}%`}
									description="Fallback to other providers"
								/>
							</div>

							{deepseekStats?.callsByModel && Object.keys(deepseekStats.callsByModel).length > 0 && (
								<div>
									<h4 className="text-sm font-medium mb-3">Calls by Model</h4>
									<div className="space-y-2">
										{Object.entries(deepseekStats.callsByModel).map(([model, count]) => (
											<div key={model} className="flex items-center gap-4">
												<div className="w-32 text-sm truncate">{model}</div>
												<Progress
													value={(count / (deepseekStats.totalCalls || 1)) * 100}
													className="flex-1 h-2"
												/>
												<div className="w-12 text-sm text-right">{count}</div>
											</div>
										))}
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="violations">
					<Card>
						<CardHeader>
							<CardTitle>Workflow Violations</CardTitle>
							<CardDescription>Commits that didn't follow the workflow</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								{commits.filter((c) => c.workflowCompliance && !c.workflowCompliance.isCompliant)
									.length === 0 ? (
									<div className="text-center py-8">
										<CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
										<div className="text-muted-foreground">No violations found!</div>
									</div>
								) : (
									commits
										.filter((c) => c.workflowCompliance && !c.workflowCompliance.isCompliant)
										.map((commit) => <ViolationItem key={commit.id} commit={commit} />)
								)}
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
	title,
	value,
	icon,
	trend,
}: {
	title: string
	value: string
	icon: React.ReactNode
	trend: "good" | "warning" | "bad" | "neutral"
}) {
	const trendColors = {
		good: "text-green-500",
		warning: "text-yellow-500",
		bad: "text-red-500",
		neutral: "text-muted-foreground",
	}

	const TrendIcon = trend === "good" ? TrendingUp : trend === "warning" || trend === "bad" ? TrendingDown : Activity

	return (
		<Card>
			<CardContent className="p-6">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-muted-foreground">
						{icon}
						<span className="text-sm">{title}</span>
					</div>
					<TrendIcon className={`h-4 w-4 ${trendColors[trend]}`} />
				</div>
				<div className="mt-2 text-3xl font-bold">{value}</div>
			</CardContent>
		</Card>
	)
}

function MetricCard({ label, value, description }: { label: string; value: string; description: string }) {
	return (
		<div className="p-4 rounded-lg border">
			<div className="text-sm text-muted-foreground">{label}</div>
			<div className="text-2xl font-bold mt-1">{value}</div>
			<div className="text-xs text-muted-foreground mt-1">{description}</div>
		</div>
	)
}

function CommitItem({ commit }: { commit: Commit }) {
	const isCompliant = commit.workflowCompliance?.isCompliant
	const hasDeepSeek = commit.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")

	return (
		<div className="flex items-start gap-4 p-4 rounded-lg border">
			<div className="mt-0.5">
				{isCompliant ? (
					<CheckCircle2 className="h-5 w-5 text-green-500" />
				) : (
					<XCircle className="h-5 w-5 text-red-500" />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{commit.title}</span>
					<Badge variant={hasDeepSeek ? "default" : "secondary"} className="text-xs">
						{hasDeepSeek ? "DeepSeek" : "Other"}
					</Badge>
				</div>
				<div className="text-sm text-muted-foreground mt-1">
					{commit.commitSha.substring(0, 8)} • {commit.agent} • {new Date(commit.timestamp).toLocaleString()}
				</div>
				{commit.modelsUsed && commit.modelsUsed.length > 0 && (
					<div className="flex flex-wrap gap-2 mt-2">
						{commit.modelsUsed.map((model, idx) => (
							<Badge key={idx} variant="outline" className="text-xs">
								{model.phase}: {model.provider}/{model.model}
								{model.apiKeyLast4 && ` (****${model.apiKeyLast4})`}
							</Badge>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function ViolationItem({ commit }: { commit: Commit }) {
	return (
		<div className="flex items-start gap-4 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
			<AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
			<div className="flex-1">
				<div className="font-medium">{commit.title}</div>
				<div className="text-sm text-muted-foreground">
					{commit.commitSha.substring(0, 8)} • {new Date(commit.timestamp).toLocaleString()}
				</div>
				{commit.workflowCompliance?.violations && (
					<ul className="mt-2 text-sm text-red-600 dark:text-red-400 list-disc list-inside">
						{commit.workflowCompliance.violations.map((violation, idx) => (
							<li key={idx}>{violation}</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
