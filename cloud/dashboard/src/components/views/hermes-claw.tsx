"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Bot,
	Search,
	BookOpen,
	Wand2,
	FileText,
	Activity,
	RefreshCw,
	Loader2,
	AlertTriangle,
	Database,
	Cpu,
	MessageSquare,
	Send,
	CheckCircle2,
	XCircle,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeStoreStats {
	bugCount?: number
	lessonCount?: number
	testsPassed?: number
	testsFailed?: number
	errorTypes?: number
	agentTypes?: number
	untested?: number
}

interface HermesStats {
	operationCount: number
	totalDurationMs: number
	averageDurationMs: number
	memoryEntries: number
	knowledgeStore?: KnowledgeStoreStats
}

interface QueryResult {
	success: boolean
	result?: any
	error?: string
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function HermesClawView() {
	const [stats, setStats] = useState<HermesStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	// Memory search
	const [query, setQuery] = useState("")
	const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
	const [queryLoading, setQueryLoading] = useState(false)

	// Context recall
	const [recallQuery, setRecallQuery] = useState("")
	const [recallResult, setRecallResult] = useState<QueryResult | null>(null)
	const [recallLoading, setRecallLoading] = useState(false)

	// Skills list
	const [skills, setSkills] = useState<any[]>([])
	const [skillsLoading, setSkillsLoading] = useState(false)

	// Resources list
	const [resources, setResources] = useState<any[]>([])
	const [resourcesLoading, setResourcesLoading] = useState(false)

	const fetchStats = useCallback(async () => {
		try {
			const res = await fetch("/api/orchestrator/hermes/stats")
			const data = await res.json()
			if (data.success) {
				setStats(data.stats)
				setError(null)
			}
		} catch {
			// non-critical polling failure
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchStats()
		fetchSkills()
		fetchResources()
		const iv = setInterval(fetchStats, 30000)
		return () => clearInterval(iv)
	}, [fetchStats])

	const handleQuery = async () => {
		if (!query.trim()) return
		setQueryLoading(true)
		setQueryResult(null)
		try {
			const res = await fetch("/api/orchestrator/hermes/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: query.trim() }),
			})
			const data = await res.json()
			setQueryResult(data)
		} catch (err: unknown) {
			setQueryResult({ success: false, error: err instanceof Error ? err.message : "Network error" })
		} finally {
			setQueryLoading(false)
		}
	}

	const handleRecall = async () => {
		if (!recallQuery.trim()) return
		setRecallLoading(true)
		setRecallResult(null)
		try {
			const res = await fetch("/api/orchestrator/hermes/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ context: recallQuery.trim() }),
			})
			const data = await res.json()
			setRecallResult(data)
		} catch (err: unknown) {
			setRecallResult({ success: false, error: err instanceof Error ? err.message : "Network error" })
		} finally {
			setRecallLoading(false)
		}
	}

	const fetchSkills = async () => {
		setSkillsLoading(true)
		try {
			const res = await fetch("/api/orchestrator/hermes/list-skills", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
			const data = await res.json()
			if (data.success) {
				setSkills(data.skills || data.result || [])
			}
		} catch {
			// non-critical
		} finally {
			setSkillsLoading(false)
		}
	}

	const fetchResources = async () => {
		setResourcesLoading(true)
		try {
			const res = await fetch("/api/orchestrator/hermes/list-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
			const data = await res.json()
			if (data.success) {
				setResources(data.resources || data.result || [])
			}
		} catch {
			// non-critical
		} finally {
			setResourcesLoading(false)
		}
	}

	if (loading && !stats) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-purple-400" />
			</div>
		)
	}

	if (error && !stats) {
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load Hermes Claw stats: {error}</p>
				</div>
				<button
					onClick={fetchStats}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const s = stats!

	return (
		<div className="space-y-5">
			{/* Header */}
			<Card className="flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20 text-purple-400">
						<Bot className="h-5 w-5" />
					</div>
					<div>
						<h2 className="text-sm font-semibold text-[#e2e8f0]">Hermes Claw</h2>
						<p className="text-[11px] text-gray-500">
							Memory and context agent — skill generation, lesson storage, and context recall
						</p>
					</div>
				</div>
			</Card>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				<StatCard label="Operations" value={s.operationCount} color="text-purple-400" />
				<StatCard label="Memory Entries" value={s.memoryEntries} color="text-amber-400" />
				<StatCard
					label="Avg Duration"
					value={s.averageDurationMs > 0 ? `${s.averageDurationMs}ms` : "—"}
					color="text-blue-400"
				/>
				<StatCard
					label="Total Duration"
					value={s.totalDurationMs > 0 ? `${(s.totalDurationMs / 1000).toFixed(1)}s` : "—"}
					color="text-cyan-400"
				/>
				<StatCard label="Bug Fixes (RAG)" value={s.knowledgeStore?.bugCount ?? "—"} color="text-red-400" />
				<StatCard label="Lessons (RAG)" value={s.knowledgeStore?.lessonCount ?? "—"} color="text-green-400" />
			</div>

			{/* Memory Search + Context Recall */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				{/* Memory Search */}
				<Card>
					<div className="flex items-center gap-2 mb-3">
						<Search className="h-4 w-4 text-purple-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Memory Search</span>
					</div>
					<p className="text-[11px] text-gray-500 mb-3">
						Search Hermes memory for relevant context and past learnings.
					</p>
					<div className="flex gap-2">
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleQuery()}
							placeholder="Search memory..."
							className="flex-1 rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-purple-500 focus:outline-none"
						/>
						<button
							onClick={handleQuery}
							disabled={queryLoading || !query.trim()}
							className="inline-flex items-center gap-2 rounded-lg bg-purple-600/20 px-3 py-2 text-sm font-medium text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 transition-colors">
							{queryLoading ? (
								<RefreshCw className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
							Search
						</button>
					</div>
					{queryResult && (
						<div className="mt-3 rounded-lg bg-[#070b14] border border-[#1e2535] p-3">
							{queryResult.success ? (
								<pre className="max-h-48 overflow-auto text-xs text-green-400 font-mono whitespace-pre-wrap">
									{typeof queryResult.result === "string"
										? queryResult.result
										: JSON.stringify(queryResult.result, null, 2)}
								</pre>
							) : (
								<p className="text-xs text-red-400">{queryResult.error || "Query failed"}</p>
							)}
						</div>
					)}
				</Card>

				{/* Context Recall */}
				<Card>
					<div className="flex items-center gap-2 mb-3">
						<BookOpen className="h-4 w-4 text-blue-400" />
						<span className="text-sm font-semibold text-[#e2e8f0]">Context Recall</span>
					</div>
					<p className="text-[11px] text-gray-500 mb-3">
						Recall relevant context from Hermes memory for a given topic.
					</p>
					<div className="flex gap-2">
						<input
							type="text"
							value={recallQuery}
							onChange={(e) => setRecallQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleRecall()}
							placeholder="Recall context about..."
							className="flex-1 rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-blue-500 focus:outline-none"
						/>
						<button
							onClick={handleRecall}
							disabled={recallLoading || !recallQuery.trim()}
							className="inline-flex items-center gap-2 rounded-lg bg-blue-600/20 px-3 py-2 text-sm font-medium text-blue-400 hover:bg-blue-600/30 disabled:opacity-50 transition-colors">
							{recallLoading ? (
								<RefreshCw className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
							Recall
						</button>
					</div>
					{recallResult && (
						<div className="mt-3 rounded-lg bg-[#070b14] border border-[#1e2535] p-3">
							{recallResult.success ? (
								<pre className="max-h-48 overflow-auto text-xs text-green-400 font-mono whitespace-pre-wrap">
									{typeof recallResult.result === "string"
										? recallResult.result
										: JSON.stringify(recallResult.result, null, 2)}
								</pre>
							) : (
								<p className="text-xs text-red-400">{recallResult.error || "Recall failed"}</p>
							)}
						</div>
					)}
				</Card>
			</div>

			{/* Skills + Resources */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				{/* Skills List */}
				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Wand2 className="h-4 w-4 text-amber-400" />
							<span className="text-sm font-semibold text-[#e2e8f0]">Skills</span>
						</div>
						<button
							onClick={fetchSkills}
							disabled={skillsLoading}
							className="inline-flex items-center gap-1 rounded-lg border border-[#1e2535] px-2 py-1 text-[11px] text-gray-400 hover:bg-[#1e2535] disabled:opacity-50 transition-colors">
							<RefreshCw className={cn("h-3 w-3", skillsLoading && "animate-spin")} />
							Refresh
						</button>
					</div>
					{skillsLoading ? (
						<div className="flex items-center justify-center py-6">
							<Loader2 className="h-5 w-5 animate-spin text-gray-500" />
						</div>
					) : skills.length === 0 ? (
						<p className="py-6 text-center text-sm text-gray-500">
							No skills loaded. Click refresh to fetch.
						</p>
					) : (
						<div className="space-y-2 max-h-64 overflow-y-auto">
							{skills.map((skill: any, i: number) => (
								<div
									key={skill.name || i}
									className="rounded-lg bg-[#070b14] border border-[#1e2535] px-3 py-2">
									<div className="flex items-center gap-2">
										<Wand2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
										<span className="text-sm font-medium text-[#e2e8f0]">
											{skill.name || `Skill ${i + 1}`}
										</span>
									</div>
									{skill.description && (
										<p className="text-[11px] text-gray-500 mt-0.5">{skill.description}</p>
									)}
								</div>
							))}
						</div>
					)}
				</Card>

				{/* Resources List */}
				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-cyan-400" />
							<span className="text-sm font-semibold text-[#e2e8f0]">Resources</span>
						</div>
						<button
							onClick={fetchResources}
							disabled={resourcesLoading}
							className="inline-flex items-center gap-1 rounded-lg border border-[#1e2535] px-2 py-1 text-[11px] text-gray-400 hover:bg-[#1e2535] disabled:opacity-50 transition-colors">
							<RefreshCw className={cn("h-3 w-3", resourcesLoading && "animate-spin")} />
							Refresh
						</button>
					</div>
					{resourcesLoading ? (
						<div className="flex items-center justify-center py-6">
							<Loader2 className="h-5 w-5 animate-spin text-gray-500" />
						</div>
					) : resources.length === 0 ? (
						<p className="py-6 text-center text-sm text-gray-500">
							No resources loaded. Click refresh to fetch.
						</p>
					) : (
						<div className="space-y-2 max-h-64 overflow-y-auto">
							{resources.map((resource: any, i: number) => (
								<div
									key={resource.name || i}
									className="rounded-lg bg-[#070b14] border border-[#1e2535] px-3 py-2">
									<div className="flex items-center gap-2">
										<FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
										<span className="text-sm font-medium text-[#e2e8f0]">
											{resource.name || `Resource ${i + 1}`}
										</span>
									</div>
									{resource.description && (
										<p className="text-[11px] text-gray-500 mt-0.5">{resource.description}</p>
									)}
								</div>
							))}
						</div>
					)}
				</Card>
			</div>

			{/* Summary Footer */}
			<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<Activity className="h-3.5 w-3.5 text-purple-400" />
						{s.operationCount} operations
					</span>
					<span className="flex items-center gap-1.5">
						<Database className="h-3.5 w-3.5 text-amber-400" />
						{s.memoryEntries} memory entries
					</span>
					<span className="flex items-center gap-1.5">
						<Cpu className="h-3.5 w-3.5 text-blue-400" />
						{s.averageDurationMs > 0 ? `${s.averageDurationMs}ms avg` : "no duration data"}
					</span>
					{s.knowledgeStore && (
						<>
							<span className="flex items-center gap-1.5">
								<Database className="h-3.5 w-3.5 text-green-400" />
								{s.knowledgeStore.bugCount ?? 0} bug fixes (RAG)
							</span>
							<span className="flex items-center gap-1.5">
								<BookOpen className="h-3.5 w-3.5 text-cyan-400" />
								{s.knowledgeStore.lessonCount ?? 0} lessons (RAG)
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	)
}
