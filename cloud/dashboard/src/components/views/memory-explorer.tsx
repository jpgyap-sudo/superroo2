"use client"

import { useState, useEffect } from "react"
import {
	Database,
	RefreshCw,
	Search,
	Tag,
	AlertTriangle,
	BookOpen,
	X,
	Globe,
	Brain,
	CheckCircle,
	Archive,
	Clock,
	BarChart3,
	Activity,
	Shield,
	Star,
	TrendingUp,
	Users,
} from "lucide-react"

interface Lesson {
	id: string
	task: string
	task_type: string
	risk: string
	tags: string[]
	files: string[]
	models: string[]
	root_cause: string
	fix: string
	reusable_rule: string
	date?: string
	project?: string
	source?: string
}

interface MemoryData {
	lessons: Lesson[]
	total: number
	filtered: number
	tagCounts: Record<string, number>
	projects?: string[]
}

interface BrainMemory {
	id: string
	title: string
	content: string
	summary: string
	memory_type: string
	confidence: number
	importance: number
	agent: string
	model: string
	tags: string[]
	files: string[]
	created_at: string
	status: string
	similarity?: number
	project_id: string
}

interface AgentScore {
	agent: string
	model: string
	task_type: string
	score: number
	total_tasks: number
	successful_tasks: number
	last_task_at: string
}

interface BrainEvent {
	id: string
	event_type: string
	actor: string
	payload: Record<string, unknown>
	created_at: string
}

interface BrainApproval {
	id: string
	memory_id: string
	memory_title: string
	memory_type: string
	confidence: number
	reason: string
	created_at: string
}

interface BrainStats {
	totalMemories: number
	eventSummary: { total: number; types: Record<string, number> } | null
	topScores: AgentScore[]
}

const RISK_STYLE: Record<string, string> = {
	high: "bg-red-900/40 text-red-300 border-red-700/40",
	medium: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
	low: "bg-green-900/40 text-green-300 border-green-700/40",
}

const TYPE_STYLE: Record<string, string> = {
	backend: "bg-blue-900/40 text-blue-300",
	frontend: "bg-purple-900/40 text-purple-300",
	devops: "bg-orange-900/40 text-orange-300",
	ml: "bg-cyan-900/40 text-cyan-300",
	lesson: "bg-slate-800 text-slate-300",
	bugfix: "bg-rose-900/40 text-rose-300",
	decision: "bg-emerald-900/40 text-emerald-300",
}

const MEMORY_TYPE_STYLE: Record<string, string> = {
	lesson: "bg-slate-800 text-slate-300",
	bug: "bg-rose-900/40 text-rose-300",
	decision: "bg-emerald-900/40 text-emerald-300",
	pattern: "bg-purple-900/40 text-purple-300",
	reference: "bg-blue-900/40 text-blue-300",
	insight: "bg-cyan-900/40 text-cyan-300",
}

const EVENT_TYPE_STYLE: Record<string, string> = {
	"memory.created": "bg-green-900/40 text-green-300",
	"memory.recall": "bg-blue-900/40 text-blue-300",
	"memory.merged": "bg-purple-900/40 text-purple-300",
	"memory.approval_required": "bg-yellow-900/40 text-yellow-300",
	"memory.approved": "bg-emerald-900/40 text-emerald-300",
	"memory.agent_completed": "bg-cyan-900/40 text-cyan-300",
	"memory.agent_failed": "bg-red-900/40 text-red-300",
	"memory.decay_applied": "bg-orange-900/40 text-orange-300",
}

type Tab = "lessons" | "pgvector" | "scores" | "events" | "approvals"

export function MemoryExplorerView() {
	const [data, setData] = useState<MemoryData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [query, setQuery] = useState("")
	const [activeTag, setActiveTag] = useState<string | null>(null)
	const [activeProject, setActiveProject] = useState<string>("")
	const [expanded, setExpanded] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<Tab>("lessons")

	// pgvector state
	const [brainMemories, setBrainMemories] = useState<BrainMemory[]>([])
	const [brainLoading, setBrainLoading] = useState(false)
	const [brainQuery, setBrainQuery] = useState("")
	const [brainError, setBrainError] = useState<string | null>(null)
	const [brainStats, setBrainStats] = useState<BrainStats | null>(null)

	// Agent scores
	const [agentScores, setAgentScores] = useState<AgentScore[]>([])
	const [scoresLoading, setScoresLoading] = useState(false)

	// Brain events
	const [brainEvents, setBrainEvents] = useState<BrainEvent[]>([])
	const [eventsLoading, setEventsLoading] = useState(false)

	// Approvals
	const [approvals, setApprovals] = useState<BrainApproval[]>([])
	const [approvalsLoading, setApprovalsLoading] = useState(false)

	const buildQueryString = (q: string, tag: string | null, project: string) => {
		const params = new URLSearchParams()
		if (q) params.set("q", q)
		if (tag) params.set("q", `${q} ${tag}`.trim())
		if (project) params.set("project", project)
		return params.toString()
	}

	const fetchData = async (q = "", tag: string | null = null, project = "") => {
		setLoading(true)
		setError(null)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const qs = buildQueryString(q, tag, project)
			const res = await fetch(`/api/memory-explorer?${qs}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			setData(await res.json())
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchBrainMemories = async (q = "") => {
		setBrainLoading(true)
		setBrainError(null)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			headers["Content-Type"] = "application/json"

			let memories: BrainMemory[] = []

			if (q.trim()) {
				// Semantic search
				const res = await fetch(`/api/brain/v2/memory/search`, {
					method: "POST",
					headers,
					body: JSON.stringify({ query: q, projectId: activeProject || "default", limit: 20 }),
				})
				if (res.ok) {
					const result = await res.json()
					memories = result?.data?.memories || []
				} else {
					throw new Error(`HTTP ${res.status}`)
				}
			} else {
				// List all
				const params = new URLSearchParams({ limit: "50", offset: "0" })
				if (activeProject) params.set("project", activeProject)
				const res = await fetch(`/api/brain/v2/memory?${params}`, { headers })
				if (res.ok) {
					const result = await res.json()
					memories = result?.data?.memories || []
				} else {
					throw new Error(`HTTP ${res.status}`)
				}
			}

			setBrainMemories(memories)
		} catch (err: any) {
			setBrainError(err.message)
		} finally {
			setBrainLoading(false)
		}
	}

	const fetchBrainStats = async () => {
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			const params = new URLSearchParams({ project: activeProject || "default" })
			const res = await fetch(`/api/brain/v2/stats?${params}`, { headers })
			if (res.ok) {
				const result = await res.json()
				setBrainStats(result?.data || null)
			}
		} catch {
			// silently fail
		}
	}

	const fetchAgentScores = async () => {
		setScoresLoading(true)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			const params = new URLSearchParams({ project: activeProject || "default", limit: "20" })
			const res = await fetch(`/api/brain/v2/scores?${params}`, { headers })
			if (res.ok) {
				const result = await res.json()
				setAgentScores(result?.data?.scores || [])
			}
		} catch {
			// silently fail
		} finally {
			setScoresLoading(false)
		}
	}

	const fetchBrainEvents = async () => {
		setEventsLoading(true)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			const params = new URLSearchParams({ project: activeProject || "default", limit: "30" })
			const res = await fetch(`/api/brain/v2/events?${params}`, { headers })
			if (res.ok) {
				const result = await res.json()
				setBrainEvents(result?.data?.events || [])
			}
		} catch {
			// silently fail
		} finally {
			setEventsLoading(false)
		}
	}

	const fetchApprovals = async () => {
		setApprovalsLoading(true)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			const params = new URLSearchParams({ project: activeProject || "default", limit: "20" })
			const res = await fetch(`/api/brain/v2/approvals?${params}`, { headers })
			if (res.ok) {
				const result = await res.json()
				setApprovals(result?.data?.approvals || [])
			}
		} catch {
			// silently fail
		} finally {
			setApprovalsLoading(false)
		}
	}

	const handleApprove = async (approvalId: string) => {
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			headers["Content-Type"] = "application/json"
			const res = await fetch(`/api/brain/v2/approve`, {
				method: "POST",
				headers,
				body: JSON.stringify({ approvalId, reviewedBy: "dashboard" }),
			})
			if (res.ok) {
				setApprovals((prev) => prev.filter((a) => a.id !== approvalId))
			}
		} catch {
			// silently fail
		}
	}

	const handleReject = async (approvalId: string) => {
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
			headers["Content-Type"] = "application/json"
			const res = await fetch(`/api/brain/v2/reject`, {
				method: "POST",
				headers,
				body: JSON.stringify({ approvalId, reviewedBy: "dashboard" }),
			})
			if (res.ok) {
				setApprovals((prev) => prev.filter((a) => a.id !== approvalId))
			}
		} catch {
			// silently fail
		}
	}

	useEffect(() => {
		fetchData()
	}, [])

	useEffect(() => {
		if (activeTab === "pgvector") {
			fetchBrainMemories()
			fetchBrainStats()
		} else if (activeTab === "scores") {
			fetchAgentScores()
		} else if (activeTab === "events") {
			fetchBrainEvents()
		} else if (activeTab === "approvals") {
			fetchApprovals()
		}
	}, [activeTab])

	const handleSearch = () => {
		fetchData(query, activeTag, activeProject)
	}

	const handleTag = (tag: string) => {
		const next = activeTag === tag ? null : tag
		setActiveTag(next)
		fetchData(query, next, activeProject)
	}

	const handleProjectChange = (project: string) => {
		setActiveProject(project)
		fetchData(query, activeTag, project)
	}

	const handleBrainSearch = () => {
		fetchBrainMemories(brainQuery)
	}

	const topTags = data
		? Object.entries(data.tagCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12)
		: []

	const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
		{ id: "lessons", label: "Lessons", icon: <BookOpen className="h-4 w-4" /> },
		{ id: "pgvector", label: "pgvector", icon: <Brain className="h-4 w-4" /> },
		{ id: "scores", label: "Scores", icon: <BarChart3 className="h-4 w-4" /> },
		{ id: "events", label: "Events", icon: <Activity className="h-4 w-4" /> },
		{ id: "approvals", label: "Approvals", icon: <Shield className="h-4 w-4" /> },
	]

	return (
		<div className="flex flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Database className="h-5 w-5 text-[#60a5fa]" />
					<h1 className="text-lg font-semibold text-[#e2e8f0]">Memory Explorer</h1>
					{brainStats && (
						<span className="rounded-full bg-[#1e2535] px-2 py-0.5 text-xs text-gray-400">
							{brainStats.totalMemories} pgvector
						</span>
					)}
					{data && (
						<span className="rounded-full bg-[#1e2535] px-2 py-0.5 text-xs text-gray-400">
							{data.total} lessons
						</span>
					)}
				</div>
				<button
					onClick={() => {
						if (activeTab === "lessons") fetchData(query, activeTag, activeProject)
						else if (activeTab === "pgvector") fetchBrainMemories(brainQuery)
						else if (activeTab === "scores") fetchAgentScores()
						else if (activeTab === "events") fetchBrainEvents()
						else if (activeTab === "approvals") fetchApprovals()
					}}
					className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
					<RefreshCw className={`h-3.5 w-3.5 ${loading || brainLoading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>

			{/* Tabs */}
			<div className="flex gap-1 border-b border-[#1e2535] pb-1">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${
							activeTab === tab.id
								? "border-b-2 border-[#60a5fa] bg-[#1e2535]/50 text-[#60a5fa]"
								: "text-gray-500 hover:text-gray-300 hover:bg-[#1e2535]/30"
						}`}>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{/* ===== LESSONS TAB ===== */}
			{activeTab === "lessons" && (
				<>
					{/* Search + Project Filter */}
					<div className="flex gap-2">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
							<input
								className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] py-2 pl-9 pr-3 text-sm text-[#e2e8f0] placeholder-gray-500 focus:border-[#60a5fa] focus:outline-none"
								placeholder="Search lessons, rules, files..."
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleSearch()}
							/>
						</div>
						{data?.projects && data.projects.length > 1 && (
							<select
								value={activeProject}
								onChange={(e) => handleProjectChange(e.target.value)}
								className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-sm text-[#e2e8f0] focus:border-[#60a5fa] focus:outline-none">
								<option value="">All Projects</option>
								{data.projects.map((p) => (
									<option key={p} value={p}>
										{p}
									</option>
								))}
							</select>
						)}
						<button
							onClick={handleSearch}
							className="rounded-lg border border-[#1e2535] bg-[#1e293b] px-4 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
							Search
						</button>
						{(query || activeTag || activeProject) && (
							<button
								onClick={() => {
									setQuery("")
									setActiveTag(null)
									setActiveProject("")
									fetchData("", null, "")
								}}
								className="rounded-lg border border-[#1e2535] px-3 py-2 text-gray-500 hover:text-gray-200 transition-colors">
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Tag Cloud */}
					{topTags.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{topTags.map(([tag, count]) => (
								<button
									key={tag}
									onClick={() => handleTag(tag)}
									className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
										activeTag === tag
											? "border-[#60a5fa] bg-[#60a5fa]/20 text-[#60a5fa]"
											: "border-[#1e2535] bg-[#0f1117] text-gray-400 hover:border-[#60a5fa]/50 hover:text-gray-200"
									}`}>
									<Tag className="h-2.5 w-2.5" />
									{tag}
									<span className="opacity-60">{count}</span>
								</button>
							))}
						</div>
					)}

					{/* Stats */}
					{data && data.filtered !== data.total && (
						<p className="text-xs text-gray-500">
							Showing {data.filtered} of {data.total} lessons
						</p>
					)}

					{/* Error */}
					{error && (
						<div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
							<AlertTriangle className="h-4 w-4 shrink-0" />
							{error}
						</div>
					)}

					{/* Lessons */}
					{loading && !data && (
						<div className="py-12 text-center text-sm text-gray-500">Loading lessons...</div>
					)}

					<div className="flex flex-col gap-3">
						{(data?.lessons || []).map((lesson) => (
							<div
								key={lesson.id}
								className="rounded-xl border border-[#1e2535] bg-[#0f1117] transition-colors hover:border-[#1e2d45]">
								{/* Card header */}
								<button
									className="flex w-full items-start justify-between gap-3 p-4 text-left"
									onClick={() => setExpanded(expanded === lesson.id ? null : lesson.id)}>
									<div className="flex min-w-0 flex-col gap-1.5">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={`rounded-full border px-2 py-0.5 text-xs ${RISK_STYLE[lesson.risk] || RISK_STYLE.medium}`}>
												{lesson.risk} risk
											</span>
											{lesson.task_type && (
												<span
													className={`rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[lesson.task_type] || "bg-gray-800 text-gray-400"}`}>
													{lesson.task_type}
												</span>
											)}
											{lesson.project && lesson.project !== "superroo2" && (
												<span className="flex items-center gap-1 rounded-full border border-emerald-700/40 bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-300">
													<Globe className="h-3 w-3" />
													{lesson.project}
												</span>
											)}
											{lesson.source && (
												<span className="flex items-center gap-1 rounded-full border border-blue-700/40 bg-blue-900/30 px-2 py-0.5 text-xs text-blue-300">
													<Database className="h-3 w-3" />
													{lesson.source}
												</span>
											)}
											{lesson.date && (
												<span className="text-xs text-gray-600">{lesson.date}</span>
											)}
										</div>
										<span className="font-medium text-[#e2e8f0]">{lesson.task}</span>
										<span className="text-sm text-gray-500 line-clamp-2">{lesson.root_cause}</span>
									</div>
									<span className="mt-1 shrink-0 text-gray-600 text-xs">
										{expanded === lesson.id ? "▲" : "▼"}
									</span>
								</button>

								{/* Expanded details */}
								{expanded === lesson.id && (
									<div className="border-t border-[#1e2535] px-4 pb-4 pt-3 space-y-3">
										<div className="rounded-lg border border-[#1e2535] bg-[#0a0d14] p-3">
											<div className="flex items-center gap-1.5 mb-1.5">
												<BookOpen className="h-3.5 w-3.5 text-[#60a5fa]" />
												<span className="text-xs font-semibold text-[#60a5fa]">
													Reusable Rule
												</span>
											</div>
											<p className="text-sm text-[#e2e8f0]">{lesson.reusable_rule}</p>
										</div>

										<div>
											<p className="mb-1 text-xs text-gray-500 font-medium">Fix Applied</p>
											<p className="text-sm text-gray-300">{lesson.fix}</p>
										</div>

										{lesson.files && lesson.files.length > 0 && (
											<div>
												<p className="mb-1.5 text-xs text-gray-500 font-medium">
													Files Changed
												</p>
												<div className="flex flex-wrap gap-1.5">
													{lesson.files.map((f) => (
														<span
															key={f}
															className="rounded bg-[#1e2535] px-2 py-0.5 font-mono text-xs text-gray-400">
															{f}
														</span>
													))}
												</div>
											</div>
										)}

										{lesson.models && lesson.models.length > 0 && (
											<div className="flex flex-wrap gap-1.5">
												{lesson.models.map((m) => (
													<span
														key={m}
														className="rounded border border-[#1e2535] px-2 py-0.5 text-xs text-gray-500">
														🤖 {m}
													</span>
												))}
											</div>
										)}

										{lesson.tags && lesson.tags.length > 0 && (
											<div className="flex flex-wrap gap-1.5">
												{lesson.tags.map((t) => (
													<button
														key={t}
														onClick={() => handleTag(t)}
														className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
															activeTag === t
																? "bg-[#60a5fa]/20 text-[#60a5fa]"
																: "bg-[#1e2535] text-gray-500 hover:text-gray-300"
														}`}>
														<Tag className="h-2.5 w-2.5" />
														{t}
													</button>
												))}
											</div>
										)}
									</div>
								)}
							</div>
						))}
					</div>

					{data && data.lessons.length === 0 && !loading && (
						<div className="py-12 text-center text-sm text-gray-500">
							No lessons found{query || activeTag ? " for this search" : ""}.
						</div>
					)}
				</>
			)}

			{/* ===== PGVECTOR TAB ===== */}
			{activeTab === "pgvector" && (
				<>
					{/* Brain Stats Summary */}
					{brainStats && (
						<div className="grid grid-cols-3 gap-3">
							<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-3">
								<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
									<Brain className="h-3.5 w-3.5 text-[#60a5fa]" />
									Total Memories
								</div>
								<p className="text-lg font-semibold text-[#e2e8f0]">{brainStats.totalMemories}</p>
							</div>
							<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-3">
								<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
									<Star className="h-3.5 w-3.5 text-yellow-400" />
									Top Agent Score
								</div>
								<p className="text-lg font-semibold text-[#e2e8f0]">
									{brainStats.topScores?.[0]?.score?.toFixed(1) || "—"}
								</p>
							</div>
							<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-3">
								<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
									<Activity className="h-3.5 w-3.5 text-green-400" />
									Event Types
								</div>
								<p className="text-lg font-semibold text-[#e2e8f0]">
									{brainStats.eventSummary
										? Object.keys(brainStats.eventSummary.types || {}).length
										: "—"}
								</p>
							</div>
						</div>
					)}

					{/* Semantic Search */}
					<div className="flex gap-2">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
							<input
								className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] py-2 pl-9 pr-3 text-sm text-[#e2e8f0] placeholder-gray-500 focus:border-[#60a5fa] focus:outline-none"
								placeholder="Semantic search over pgvector memories..."
								value={brainQuery}
								onChange={(e) => setBrainQuery(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleBrainSearch()}
							/>
						</div>
						<button
							onClick={handleBrainSearch}
							className="rounded-lg border border-[#1e2535] bg-[#1e293b] px-4 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
							Search
						</button>
						{brainQuery && (
							<button
								onClick={() => {
									setBrainQuery("")
									fetchBrainMemories("")
								}}
								className="rounded-lg border border-[#1e2535] px-3 py-2 text-gray-500 hover:text-gray-200 transition-colors">
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Brain Error */}
					{brainError && (
						<div className="flex items-center gap-2 rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
							<AlertTriangle className="h-4 w-4 shrink-0" />
							{brainError} — pgvector may not be connected
						</div>
					)}

					{/* Brain Memories */}
					{brainLoading && !brainMemories.length && (
						<div className="py-12 text-center text-sm text-gray-500">Loading pgvector memories...</div>
					)}

					<div className="flex flex-col gap-3">
						{brainMemories.map((mem) => (
							<div
								key={mem.id}
								className="rounded-xl border border-[#1e2535] bg-[#0f1117] transition-colors hover:border-[#1e2d45] p-4">
								<div className="flex items-start justify-between gap-3 mb-2">
									<div className="flex flex-wrap items-center gap-2">
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${MEMORY_TYPE_STYLE[mem.memory_type] || "bg-gray-800 text-gray-400"}`}>
											{mem.memory_type}
										</span>
										<span
											className={`rounded-full border px-2 py-0.5 text-xs ${
												mem.status === "approved"
													? "border-green-700/40 bg-green-900/30 text-green-300"
													: mem.status === "candidate"
														? "border-yellow-700/40 bg-yellow-900/30 text-yellow-300"
														: "border-gray-700/40 bg-gray-800 text-gray-400"
											}`}>
											{mem.status}
										</span>
										{mem.similarity !== undefined && (
											<span className="rounded-full border border-blue-700/40 bg-blue-900/30 px-2 py-0.5 text-xs text-blue-300">
												{(mem.similarity * 100).toFixed(0)}% match
											</span>
										)}
										<span className="text-xs text-gray-600">
											{new Date(mem.created_at).toLocaleDateString()}
										</span>
									</div>
									<div className="flex items-center gap-1 text-xs text-gray-500">
										<Brain className="h-3 w-3" />
										{mem.agent}
									</div>
								</div>

								<h3 className="font-medium text-[#e2e8f0] mb-1">{mem.title}</h3>
								<p className="text-sm text-gray-400 line-clamp-2 mb-2">{mem.summary || mem.content}</p>

								<div className="flex items-center gap-3 text-xs text-gray-500">
									<span className="flex items-center gap-1">
										<Star className="h-3 w-3 text-yellow-500" />
										{(mem.confidence * 100).toFixed(0)}% confidence
									</span>
									<span className="flex items-center gap-1">
										<TrendingUp className="h-3 w-3 text-blue-400" />
										Importance: {mem.importance.toFixed(1)}
									</span>
								</div>

								{mem.tags && mem.tags.length > 0 && (
									<div className="flex flex-wrap gap-1.5 mt-2">
										{mem.tags.map((t) => (
											<span
												key={t}
												className="flex items-center gap-1 rounded-full bg-[#1e2535] px-2 py-0.5 text-xs text-gray-500">
												<Tag className="h-2.5 w-2.5" />
												{t}
											</span>
										))}
									</div>
								)}
							</div>
						))}
					</div>

					{brainMemories.length === 0 && !brainLoading && !brainError && (
						<div className="py-12 text-center text-sm text-gray-500">
							{brainQuery
								? "No matching memories found in pgvector."
								: "No memories in pgvector yet. Run the migration script to import existing lessons."}
						</div>
					)}
				</>
			)}

			{/* ===== SCORES TAB ===== */}
			{activeTab === "scores" && (
				<>
					{scoresLoading && (
						<div className="py-12 text-center text-sm text-gray-500">Loading agent scores...</div>
					)}

					{!scoresLoading && agentScores.length === 0 && (
						<div className="py-12 text-center text-sm text-gray-500">
							No agent scores yet. Run some tasks to generate scores.
						</div>
					)}

					<div className="flex flex-col gap-2">
						{agentScores.map((score, i) => (
							<div
								key={`${score.agent}-${score.model}-${i}`}
								className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-4 transition-colors hover:border-[#1e2d45]">
								<div className="flex items-start justify-between gap-3">
									<div className="flex items-center gap-2">
										<Users className="h-4 w-4 text-[#60a5fa]" />
										<span className="font-medium text-[#e2e8f0]">{score.agent}</span>
										{score.model && (
											<span className="rounded border border-[#1e2535] px-2 py-0.5 text-xs text-gray-500">
												{score.model}
											</span>
										)}
										<span className="rounded-full bg-[#1e2535] px-2 py-0.5 text-xs text-gray-400">
											{score.task_type}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-lg font-bold text-[#e2e8f0]">
											{score.score.toFixed(1)}
										</span>
										<span className="text-xs text-gray-500">/ 100</span>
									</div>
								</div>
								<div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
									<span className="flex items-center gap-1">
										<CheckCircle className="h-3 w-3 text-green-400" />
										{score.successful_tasks}/{score.total_tasks} successful
									</span>
									{score.last_task_at && (
										<span className="flex items-center gap-1">
											<Clock className="h-3 w-3" />
											Last: {new Date(score.last_task_at).toLocaleDateString()}
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{/* ===== EVENTS TAB ===== */}
			{activeTab === "events" && (
				<>
					{eventsLoading && (
						<div className="py-12 text-center text-sm text-gray-500">Loading brain events...</div>
					)}

					{!eventsLoading && brainEvents.length === 0 && (
						<div className="py-12 text-center text-sm text-gray-500">
							No brain events yet. Events appear when agents create or recall memories.
						</div>
					)}

					<div className="flex flex-col gap-2">
						{brainEvents.map((event) => (
							<div
								key={event.id}
								className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-3 transition-colors hover:border-[#1e2d45]">
								<div className="flex items-start justify-between gap-3">
									<div className="flex items-center gap-2">
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${EVENT_TYPE_STYLE[event.event_type] || "bg-gray-800 text-gray-400"}`}>
											{event.event_type}
										</span>
										<span className="text-xs text-gray-500">by {event.actor}</span>
									</div>
									<span className="text-xs text-gray-600">
										{new Date(event.created_at).toLocaleString()}
									</span>
								</div>
								{event.payload && Object.keys(event.payload).length > 0 && (
									<div className="mt-1.5 text-xs text-gray-500 font-mono truncate">
										{JSON.stringify(event.payload).slice(0, 200)}
									</div>
								)}
							</div>
						))}
					</div>
				</>
			)}

			{/* ===== APPROVALS TAB ===== */}
			{activeTab === "approvals" && (
				<>
					{approvalsLoading && (
						<div className="py-12 text-center text-sm text-gray-500">Loading pending approvals...</div>
					)}

					{!approvalsLoading && approvals.length === 0 && (
						<div className="py-12 text-center text-sm text-gray-500">
							No pending approvals. All memories have been reviewed.
						</div>
					)}

					<div className="flex flex-col gap-2">
						{approvals.map((approval) => (
							<div
								key={approval.id}
								className="rounded-xl border border-yellow-700/40 bg-[#0f1117] p-4 transition-colors hover:border-yellow-600/60">
								<div className="flex items-start justify-between gap-3 mb-2">
									<div className="flex items-center gap-2">
										<Shield className="h-4 w-4 text-yellow-400" />
										<span className="font-medium text-[#e2e8f0]">
											{approval.memory_title || "Untitled"}
										</span>
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${MEMORY_TYPE_STYLE[approval.memory_type] || "bg-gray-800 text-gray-400"}`}>
											{approval.memory_type}
										</span>
									</div>
									<span className="text-xs text-gray-600">
										{new Date(approval.created_at).toLocaleDateString()}
									</span>
								</div>

								{approval.reason && <p className="text-sm text-gray-400 mb-2">{approval.reason}</p>}

								<div className="flex items-center justify-between">
									<span className="text-xs text-gray-500">
										Confidence: {(approval.confidence * 100).toFixed(0)}%
									</span>
									<div className="flex gap-2">
										<button
											onClick={() => handleApprove(approval.id)}
											className="flex items-center gap-1 rounded-lg border border-green-700/40 bg-green-900/30 px-3 py-1.5 text-xs text-green-300 hover:bg-green-900/50 transition-colors">
											<CheckCircle className="h-3.5 w-3.5" />
											Approve
										</button>
										<button
											onClick={() => handleReject(approval.id)}
											className="flex items-center gap-1 rounded-lg border border-red-700/40 bg-red-900/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/50 transition-colors">
											<Archive className="h-3.5 w-3.5" />
											Reject
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	)
}
