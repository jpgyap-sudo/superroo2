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
	Send,
	Lightbulb,
	Layers,
	GitBranch,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface HermesStats {
	totalQueries: number
	memoryEntries: number
	avgLatencyMs: number
	totalBugFixes: number
	totalLessons: number
	ollamaReady: boolean
	modelLoaded: string
	knowledgeStore: {
		totalBugFixes?: number
		totalLessons?: number
	}
}

interface ActionResult {
	success: boolean
	result?: any
	error?: string
}

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls =
	"flex-1 w-full rounded-lg border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 focus:border-purple-500 focus:outline-none"

const btnCls = (color: string) =>
	`inline-flex items-center gap-2 rounded-lg bg-${color}-600/20 px-3 py-2 text-sm font-medium text-${color}-400 hover:bg-${color}-600/30 disabled:opacity-50 transition-colors`

// ── Result display ────────────────────────────────────────────────────────────

function ResultBox({ result }: { result: ActionResult }) {
	return (
		<div className="mt-3 rounded-lg bg-[#070b14] border border-[#1e2535] p-3">
			{result.success ? (
				<pre className="max-h-48 overflow-auto text-xs text-green-400 font-mono whitespace-pre-wrap">
					{typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2)}
				</pre>
			) : (
				<p className="text-xs text-red-400">{result.error || "Request failed"}</p>
			)}
		</div>
	)
}

// ── Action panel wrapper ──────────────────────────────────────────────────────

function ActionPanel({
	icon,
	title,
	description,
	color,
	children,
}: {
	icon: React.ReactNode
	title: string
	description: string
	color: string
	children: React.ReactNode
}) {
	return (
		<Card>
			<div className={`flex items-center gap-2 mb-2`}>
				<span className={`text-${color}-400`}>{icon}</span>
				<span className="text-sm font-semibold text-[#e2e8f0]">{title}</span>
			</div>
			<p className="text-[11px] text-gray-500 mb-3">{description}</p>
			{children}
		</Card>
	)
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function HermesClawView() {
	const [stats, setStats] = useState<HermesStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	// Memory search
	const [query, setQuery] = useState("")
	const [queryResult, setQueryResult] = useState<ActionResult | null>(null)
	const [queryLoading, setQueryLoading] = useState(false)

	// Context recall
	const [recallQuery, setRecallQuery] = useState("")
	const [recallResult, setRecallResult] = useState<ActionResult | null>(null)
	const [recallLoading, setRecallLoading] = useState(false)

	// Learn
	const [learnText, setLearnText] = useState("")
	const [learnResult, setLearnResult] = useState<ActionResult | null>(null)
	const [learnLoading, setLearnLoading] = useState(false)

	// Create skill
	const [skillName, setSkillName] = useState("")
	const [skillDesc, setSkillDesc] = useState("")
	const [createSkillResult, setCreateSkillResult] = useState<ActionResult | null>(null)
	const [createSkillLoading, setCreateSkillLoading] = useState(false)

	// Analyze patterns
	const [analyzeContext, setAnalyzeContext] = useState("")
	const [analyzeResult, setAnalyzeResult] = useState<ActionResult | null>(null)
	const [analyzeLoading, setAnalyzeLoading] = useState(false)

	// Extract lessons
	const [extractTaskId, setExtractTaskId] = useState("")
	const [extractGoal, setExtractGoal] = useState("")
	const [extractResult, setExtractResult] = useState<ActionResult | null>(null)
	const [extractLoading, setExtractLoading] = useState(false)

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
				setStats({
					totalQueries: data.totalQueries ?? 0,
					memoryEntries: data.memoryEntries ?? 0,
					avgLatencyMs: data.avgLatencyMs ?? 0,
					totalBugFixes: data.totalBugFixes ?? 0,
					totalLessons: data.totalLessons ?? 0,
					ollamaReady: data.ollamaReady ?? false,
					modelLoaded: data.modelLoaded ?? "—",
					knowledgeStore: data.knowledgeStore ?? {},
				})
				setError(null)
			}
		} catch (e: any) {
			setError(e.message)
		} finally {
			setLoading(false)
		}
	}, [])

	const fetchSkills = useCallback(async () => {
		setSkillsLoading(true)
		try {
			const res = await fetch("/api/orchestrator/hermes/list-skills", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
			const data = await res.json()
			if (data.success) setSkills(data.skills || data.result || [])
		} catch {
			// non-critical
		} finally {
			setSkillsLoading(false)
		}
	}, [])

	const fetchResources = useCallback(async () => {
		setResourcesLoading(true)
		try {
			const res = await fetch("/api/orchestrator/hermes/list-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
			const data = await res.json()
			if (data.success) setResources(data.resources || data.result || [])
		} catch {
			// non-critical
		} finally {
			setResourcesLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchStats()
		fetchSkills()
		fetchResources()
		const iv = setInterval(fetchStats, 30000)
		return () => clearInterval(iv)
	}, [fetchStats, fetchSkills, fetchResources])

	const post = async (path: string, body: object): Promise<ActionResult> => {
		const res = await fetch(`/api/orchestrator/hermes/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		return res.json()
	}

	const handleQuery = async () => {
		if (!query.trim()) return
		setQueryLoading(true)
		setQueryResult(null)
		try {
			setQueryResult(await post("query", { query: query.trim() }))
		} catch (e: any) {
			setQueryResult({ success: false, error: e.message })
		} finally {
			setQueryLoading(false)
		}
	}

	const handleRecall = async () => {
		if (!recallQuery.trim()) return
		setRecallLoading(true)
		setRecallResult(null)
		try {
			setRecallResult(await post("recall", { context: recallQuery.trim() }))
		} catch (e: any) {
			setRecallResult({ success: false, error: e.message })
		} finally {
			setRecallLoading(false)
		}
	}

	const handleLearn = async () => {
		if (!learnText.trim()) return
		setLearnLoading(true)
		setLearnResult(null)
		try {
			setLearnResult(await post("learn", { content: learnText.trim() }))
		} catch (e: any) {
			setLearnResult({ success: false, error: e.message })
		} finally {
			setLearnLoading(false)
		}
	}

	const handleCreateSkill = async () => {
		if (!skillName.trim()) return
		setCreateSkillLoading(true)
		setCreateSkillResult(null)
		try {
			setCreateSkillResult(await post("create-skill", { name: skillName.trim(), description: skillDesc.trim() }))
		} catch (e: any) {
			setCreateSkillResult({ success: false, error: e.message })
		} finally {
			setCreateSkillLoading(false)
		}
	}

	const handleAnalyze = async () => {
		setAnalyzeLoading(true)
		setAnalyzeResult(null)
		try {
			setAnalyzeResult(await post("analyze-patterns", { context: analyzeContext.trim() || undefined }))
		} catch (e: any) {
			setAnalyzeResult({ success: false, error: e.message })
		} finally {
			setAnalyzeLoading(false)
		}
	}

	const handleExtractLessons = async () => {
		if (!extractGoal.trim()) return
		setExtractLoading(true)
		setExtractResult(null)
		try {
			setExtractResult(
				await post("extract-lessons", {
					taskId: extractTaskId.trim() || `manual-${Date.now()}`,
					goal: extractGoal.trim(),
					phases: [{ number: 1, phase: "manual", result: "completed" }],
				}),
			)
		} catch (e: any) {
			setExtractResult({ success: false, error: e.message })
		} finally {
			setExtractLoading(false)
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
					<p className="text-red-300">Failed to load Hermes Claw: {error}</p>
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
			<Card className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20 text-purple-400">
							<Bot className="h-5 w-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Hermes Claw</h2>
							<p className="text-[11px] text-gray-500">
								Memory · context recall · skill generation · lesson extraction
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Badge
							status={s.ollamaReady ? "active" : "offline"}
							label={s.ollamaReady ? "Ollama ready" : "Ollama offline"}
						/>
						<Badge status="review" label={s.modelLoaded} />
						<button
							onClick={fetchStats}
							className="rounded-lg border border-[#1e2535] px-2 py-1.5 text-[11px] text-gray-400 hover:bg-[#1e2535] transition-colors">
							<RefreshCw className="h-3 w-3" />
						</button>
					</div>
				</div>
			</Card>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				<StatCard label="Operations" value={s.totalQueries} color="text-purple-400" />
				<StatCard label="Memory Entries" value={s.memoryEntries} color="text-amber-400" />
				<StatCard
					label="Avg Latency"
					value={s.avgLatencyMs > 0 ? `${s.avgLatencyMs}ms` : "—"}
					color="text-blue-400"
				/>
				<StatCard label="Bug Fixes (pgvector)" value={s.totalBugFixes} color="text-red-400" />
				<StatCard label="Lessons (pgvector)" value={s.totalLessons} color="text-green-400" />
				<StatCard label="Model" value={s.modelLoaded.split(":")[0]} color="text-cyan-400" />
			</div>

			{/* Row 1: Memory Search + Context Recall */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				<ActionPanel
					icon={<Search className="h-4 w-4" />}
					title="Memory Search"
					description="Query Hermes memory for relevant past learnings and context."
					color="purple">
					<div className="flex gap-2">
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleQuery()}
							placeholder="Search memory..."
							className={inputCls}
						/>
						<button
							onClick={handleQuery}
							disabled={queryLoading || !query.trim()}
							className={btnCls("purple")}>
							{queryLoading ? (
								<RefreshCw className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
							Go
						</button>
					</div>
					{queryResult && <ResultBox result={queryResult} />}
				</ActionPanel>

				<ActionPanel
					icon={<BookOpen className="h-4 w-4" />}
					title="Context Recall"
					description="Retrieve structured context from pgvector RAG store for a topic."
					color="blue">
					<div className="flex gap-2">
						<input
							type="text"
							value={recallQuery}
							onChange={(e) => setRecallQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleRecall()}
							placeholder="Recall context about..."
							className={inputCls}
						/>
						<button
							onClick={handleRecall}
							disabled={recallLoading || !recallQuery.trim()}
							className={btnCls("blue")}>
							{recallLoading ? (
								<RefreshCw className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
							Go
						</button>
					</div>
					{recallResult && <ResultBox result={recallResult} />}
				</ActionPanel>
			</div>

			{/* Row 2: Learn + Create Skill */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				<ActionPanel
					icon={<Lightbulb className="h-4 w-4" />}
					title="Teach Hermes"
					description="Store new knowledge directly into Hermes memory."
					color="yellow">
					<textarea
						value={learnText}
						onChange={(e) => setLearnText(e.target.value)}
						placeholder="Paste a lesson, rule, or piece of knowledge..."
						rows={3}
						className={cn(inputCls, "resize-none")}
					/>
					<button
						onClick={handleLearn}
						disabled={learnLoading || !learnText.trim()}
						className={cn(btnCls("yellow"), "mt-2 w-full justify-center")}>
						{learnLoading ? (
							<RefreshCw className="h-4 w-4 animate-spin" />
						) : (
							<Lightbulb className="h-4 w-4" />
						)}
						Store Knowledge
					</button>
					{learnResult && <ResultBox result={learnResult} />}
				</ActionPanel>

				<ActionPanel
					icon={<Wand2 className="h-4 w-4" />}
					title="Create Skill"
					description="Generate and store a new reusable skill in Hermes."
					color="amber">
					<div className="space-y-2">
						<input
							type="text"
							value={skillName}
							onChange={(e) => setSkillName(e.target.value)}
							placeholder="Skill name (e.g. fix_typescript_imports)"
							className={inputCls}
						/>
						<input
							type="text"
							value={skillDesc}
							onChange={(e) => setSkillDesc(e.target.value)}
							placeholder="Description (optional)"
							className={inputCls}
						/>
					</div>
					<button
						onClick={handleCreateSkill}
						disabled={createSkillLoading || !skillName.trim()}
						className={cn(btnCls("amber"), "mt-2 w-full justify-center")}>
						{createSkillLoading ? (
							<RefreshCw className="h-4 w-4 animate-spin" />
						) : (
							<Wand2 className="h-4 w-4" />
						)}
						Create Skill
					</button>
					{createSkillResult && <ResultBox result={createSkillResult} />}
				</ActionPanel>
			</div>

			{/* Row 3: Analyze Patterns + Extract Lessons */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				<ActionPanel
					icon={<GitBranch className="h-4 w-4" />}
					title="Analyze Patterns"
					description="Let Hermes analyze recurring patterns in its memory and knowledge store."
					color="green">
					<input
						type="text"
						value={analyzeContext}
						onChange={(e) => setAnalyzeContext(e.target.value)}
						placeholder="Context filter (optional, e.g. 'TypeScript errors')"
						className={inputCls}
					/>
					<button
						onClick={handleAnalyze}
						disabled={analyzeLoading}
						className={cn(btnCls("green"), "mt-2 w-full justify-center")}>
						{analyzeLoading ? (
							<RefreshCw className="h-4 w-4 animate-spin" />
						) : (
							<GitBranch className="h-4 w-4" />
						)}
						Analyze
					</button>
					{analyzeResult && <ResultBox result={analyzeResult} />}
				</ActionPanel>

				<ActionPanel
					icon={<Layers className="h-4 w-4" />}
					title="Extract Lessons"
					description="Trigger lesson extraction from a completed task."
					color="cyan">
					<div className="space-y-2">
						<input
							type="text"
							value={extractGoal}
							onChange={(e) => setExtractGoal(e.target.value)}
							placeholder="Task goal / summary *"
							className={inputCls}
						/>
						<input
							type="text"
							value={extractTaskId}
							onChange={(e) => setExtractTaskId(e.target.value)}
							placeholder="Task ID (optional)"
							className={inputCls}
						/>
					</div>
					<button
						onClick={handleExtractLessons}
						disabled={extractLoading || !extractGoal.trim()}
						className={cn(btnCls("cyan"), "mt-2 w-full justify-center")}>
						{extractLoading ? (
							<RefreshCw className="h-4 w-4 animate-spin" />
						) : (
							<Layers className="h-4 w-4" />
						)}
						Extract
					</button>
					{extractResult && <ResultBox result={extractResult} />}
				</ActionPanel>
			</div>

			{/* Row 4: Skills + Resources */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Wand2 className="h-4 w-4 text-amber-400" />
							<span className="text-sm font-semibold text-[#e2e8f0]">
								Skills
								{skills.length > 0 && <span className="ml-1.5 text-gray-500">({skills.length})</span>}
							</span>
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
						<p className="py-6 text-center text-sm text-gray-500">No skills found.</p>
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

				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-cyan-400" />
							<span className="text-sm font-semibold text-[#e2e8f0]">
								Resources
								{resources.length > 0 && (
									<span className="ml-1.5 text-gray-500">({resources.length})</span>
								)}
							</span>
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
						<p className="py-6 text-center text-sm text-gray-500">No resources found.</p>
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

			{/* Footer Summary */}
			<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<Activity className="h-3.5 w-3.5 text-purple-400" />
						{s.totalQueries} operations
					</span>
					<span className="flex items-center gap-1.5">
						<Database className="h-3.5 w-3.5 text-amber-400" />
						{s.memoryEntries} memory entries
					</span>
					<span className="flex items-center gap-1.5">
						<Cpu className="h-3.5 w-3.5 text-blue-400" />
						{s.avgLatencyMs > 0 ? `${s.avgLatencyMs}ms avg` : "no latency data"}
					</span>
					<span className="flex items-center gap-1.5">
						<Database className="h-3.5 w-3.5 text-red-400" />
						{s.totalBugFixes} bug fixes (pgvector)
					</span>
					<span className="flex items-center gap-1.5">
						<BookOpen className="h-3.5 w-3.5 text-green-400" />
						{s.totalLessons} lessons (pgvector)
					</span>
				</div>
			</div>
		</div>
	)
}
