"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	FilePlus,
	CheckCircle,
	XCircle,
	TrendingUp,
	Search,
	BookOpen,
	Zap,
	Code,
	Sparkles,
	Clock,
	Target,
	Plus,
	RefreshCw,
	AlertTriangle,
	Info,
} from "lucide-react"

/* ─── Types ─────────────────────────────────────────── */

type DraftItem = {
	id: string
	type: "skill" | "workflow" | "resource"
	title: string
	targetAgent: string
	beforeScore: number
	afterScore: number
	status: "pending" | "approved" | "rejected"
	createdAt: string
}

type ExistingSkill = {
	id: string
	name: string
	description: string
	emoji: string
	category: "automation" | "integration" | "quality" | "deployment" | "ai"
	status: "active" | "beta" | "draft"
	lines: number
}

type RecommendedSkill = {
	id: string
	title: string
	description: string
	reason: string
	priority: "high" | "medium" | "low"
	category: string
	icon: React.ReactNode
}

/* ─── API helpers ───────────────────────────────────── */

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
	try {
		const res = await fetch(path, {
			headers: { "Content-Type": "application/json" },
			...init,
		})
		if (!res.ok) {
			console.warn(`[skills-api] ${res.status} ${res.statusText} for ${path}`)
			return null
		}
		return (await res.json()) as T
	} catch (err) {
		console.error(`[skills-api] fetch error for ${path}:`, err)
		return null
	}
}

/* ─── Helpers ───────────────────────────────────────── */

function typeLabel(t: string) {
	return t.charAt(0).toUpperCase() + t.slice(1)
}

const categoryColors: Record<string, string> = {
	automation: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	integration: "bg-blue-500/10 text-blue-400 border-blue-500/30",
	quality: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
	deployment: "bg-violet-500/10 text-violet-400 border-violet-500/30",
	ai: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
}

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
	high: <Zap className="h-4 w-4 text-amber-400" />,
	medium: <TrendingUp className="h-4 w-4 text-blue-400" />,
	low: <Info className="h-4 w-4 text-gray-500" />,
}

/* ─── Sub-components ────────────────────────────────── */

function SkillCard({ skill }: { skill: ExistingSkill }) {
	return (
		<Card className="group border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] transition-all hover:border-[#2a3550] hover:shadow-lg">
			<div className="flex items-start gap-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1e2535] text-base">
					{skill.emoji}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h4 className="truncate text-sm font-semibold text-[#e2e8f0]">{skill.name}</h4>
						<Badge
							status={
								skill.status === "active" ? "success" : skill.status === "beta" ? "warning" : "idle"
							}
							label={skill.status.toUpperCase()}
						/>
					</div>
					<p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{skill.description}</p>
					<div className="mt-2 flex items-center gap-3 text-[10px] text-gray-600">
						<span className="inline-flex items-center gap-1">
							<Code className="h-3 w-3" />
							{skill.lines} lines
						</span>
						<span
							className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
								categoryColors[skill.category] || ""
							}`}>
							{skill.category}
						</span>
					</div>
				</div>
			</div>
		</Card>
	)
}

function RecommendationCard({ rec, onGenerate }: { rec: RecommendedSkill; onGenerate: (id: string) => void }) {
	return (
		<Card className="group border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] transition-all hover:border-[#2a3550]">
			<div className="flex items-start gap-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1e2535] text-gray-400">
					{rec.icon}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h4 className="text-sm font-semibold text-[#e2e8f0]">{rec.title}</h4>
						<Badge
							status={
								rec.priority === "high" ? "error" : rec.priority === "medium" ? "warning" : "active"
							}
							label={rec.priority.toUpperCase()}
						/>
					</div>
					<p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{rec.description}</p>
					<div className="mt-2 flex items-center gap-2">
						<span className="inline-flex items-center gap-1 rounded border border-cyan-500/20 bg-cyan-500/5 px-1.5 py-0.5 text-[10px] text-cyan-400">
							{rec.category}
						</span>
						<span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
							<Info className="h-3 w-3" />
							{rec.reason}
						</span>
					</div>
				</div>
				<button
					onClick={() => onGenerate(rec.id)}
					className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95">
					<Plus className="mr-1 inline h-3 w-3" />
					Generate
				</button>
			</div>
		</Card>
	)
}

function DraftCard({
	draft,
	onApprove,
	onReject,
}: {
	draft: DraftItem
	onApprove: (id: string) => void
	onReject: (id: string) => void
}) {
	return (
		<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h4 className="text-sm font-semibold text-[#e2e8f0]">{draft.title}</h4>
						<Badge
							status={
								draft.status === "pending"
									? "warning"
									: draft.status === "approved"
										? "success"
										: "idle"
							}
							label={draft.status.toUpperCase()}
						/>
					</div>
					<p className="mt-0.5 text-[11px] text-gray-500">
						Target: <span className="text-gray-400">{draft.targetAgent}</span>
					</p>
					<div className="mt-1 flex items-center gap-3 text-[10px] text-gray-600">
						<span className="inline-flex items-center gap-1">
							<Clock className="h-3 w-3" />
							{new Date(draft.createdAt).toLocaleDateString()}
						</span>
						<span className="inline-flex items-center gap-1">
							<Target className="h-3 w-3" />
							{draft.beforeScore} → {draft.afterScore}
						</span>
					</div>
				</div>
				{draft.status === "pending" && (
					<div className="flex shrink-0 gap-1.5">
						<button
							onClick={() => onApprove(draft.id)}
							className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95">
							<CheckCircle className="mr-1 inline h-3 w-3" />
							Approve
						</button>
						<button
							onClick={() => onReject(draft.id)}
							className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-400 transition-all hover:bg-red-500/20 active:scale-95">
							<XCircle className="mr-1 inline h-3 w-3" />
							Reject
						</button>
					</div>
				)}
			</div>
		</Card>
	)
}

/* ─── Main View ─────────────────────────────────────── */

export function SkillGeneratorView() {
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [skills, setSkills] = useState<ExistingSkill[]>([])
	const [recommendations, setRecommendations] = useState<RecommendedSkill[]>([])
	const [drafts, setDrafts] = useState<DraftItem[]>([])
	const [generating, setGenerating] = useState<string | null>(null)
	const [approving, setApproving] = useState<string | null>(null)
	const [rejecting, setRejecting] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [activeTab, setActiveTab] = useState<"library" | "recommendations" | "drafts">("library")

	const fetchAll = useCallback(async () => {
		setLoading(true)
		setError(null)

		const [skillsRes, recsRes, draftsRes] = await Promise.all([
			apiFetch<{ skills: ExistingSkill[] }>("/skills"),
			apiFetch<{ recommendations: RecommendedSkill[] }>("/skills/recommendations"),
			apiFetch<{ drafts: DraftItem[] }>("/skills/drafts"),
		])

		if (skillsRes) setSkills(skillsRes.skills || [])
		if (recsRes) setRecommendations(recsRes.recommendations || [])
		if (draftsRes) setDrafts(draftsRes.drafts || [])

		if (!skillsRes && !recsRes && !draftsRes) {
			setError("Skills API is not responding. The backend may not be deployed yet.")
		}

		setLoading(false)
	}, [])

	useEffect(() => {
		fetchAll()
	}, [fetchAll])

	const handleGenerate = useCallback(async (recId: string) => {
		setGenerating(recId)
		const res = await apiFetch<{ draft: DraftItem }>("/skills/generate", {
			method: "POST",
			body: JSON.stringify({ recommendationId: recId }),
		})
		if (res && res.draft) {
			setDrafts((prev) => [res.draft, ...prev])
			setRecommendations((prev) => prev.filter((r) => r.id !== recId))
			setActiveTab("drafts")
		}
		setGenerating(null)
	}, [])

	const handleApprove = useCallback(async (draftId: string) => {
		setApproving(draftId)
		const res = await apiFetch<{ skill: ExistingSkill }>(`/skills/${draftId}/approve`, {
			method: "POST",
		})
		if (res && res.skill) {
			setSkills((prev) => [...prev, res.skill])
			setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, status: "approved" as const } : d)))
		}
		setApproving(null)
	}, [])

	const handleReject = useCallback(async (draftId: string) => {
		setRejecting(draftId)
		const res = await apiFetch<{ ok: boolean }>(`/skills/${draftId}/reject`, {
			method: "POST",
		})
		if (res && res.ok) {
			setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, status: "rejected" as const } : d)))
		}
		setRejecting(null)
	}, [])

	const filteredSkills = useMemo(() => {
		if (!searchQuery) return skills
		const q = searchQuery.toLowerCase()
		return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
	}, [skills, searchQuery])

	const pendingDrafts = useMemo(() => drafts.filter((d) => d.status === "pending"), [drafts])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="flex flex-col items-center gap-3">
					<RefreshCw className="h-6 w-6 animate-spin text-gray-500" />
					<p className="text-sm text-gray-500">Loading Skills API...</p>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="space-y-5">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-sm font-semibold text-[#e2e8f0]">Skills Generator</h2>
						<p className="mt-0.5 text-[11px] text-gray-500">
							Manage, discover, and generate skills for SuperRoo agents
						</p>
					</div>
				</div>
				<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
					<div className="flex flex-col items-center gap-4 py-16 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1e2535]">
							<AlertTriangle className="h-8 w-8 text-amber-400" />
						</div>
						<div className="max-w-md space-y-2">
							<h3 className="text-base font-semibold text-[#e2e8f0]">Skills API Not Available</h3>
							<p className="text-[12px] leading-relaxed text-gray-500">{error}</p>
						</div>
						<button
							onClick={fetchAll}
							className="rounded border border-[#1e2535] bg-[#0f1117] px-4 py-2 text-[11px] text-gray-400 transition-all hover:border-[#2a3550] hover:text-gray-300 active:scale-95">
							<RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
							Retry
						</button>
					</div>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-5">
			{/* ── Header ── */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-sm font-semibold text-[#e2e8f0]">Skills Generator</h2>
					<p className="mt-0.5 text-[11px] text-gray-500">
						Manage, discover, and generate skills for SuperRoo agents
					</p>
				</div>
				<button
					onClick={fetchAll}
					className="rounded border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-[11px] text-gray-400 transition-all hover:border-[#2a3550] hover:text-gray-300 active:scale-95">
					<RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
					Refresh
				</button>
			</div>

			{/* ── Stats Row ── */}
			<div className="grid grid-cols-4 gap-3">
				<StatCard label="Skills" value={skills.length} color="text-blue-400" />
				<StatCard label="Recommendations" value={recommendations.length} color="text-amber-400" />
				<StatCard label="Pending Drafts" value={pendingDrafts.length} color="text-emerald-400" />
				<StatCard
					label="Approved"
					value={drafts.filter((d) => d.status === "approved").length}
					color="text-violet-400"
				/>
			</div>

			{/* ── Tabs ── */}
			<div className="flex items-center gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-0.5">
				{(["library", "recommendations", "drafts"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all ${
							activeTab === tab
								? "bg-[#1e2535] text-[#e2e8f0] shadow-sm"
								: "text-gray-500 hover:text-gray-400"
						}`}>
						{tab === "library" && "📚 Skills Library"}
						{tab === "recommendations" && "✨ Recommendations"}
						{tab === "drafts" && `📝 Drafts (${pendingDrafts.length})`}
					</button>
				))}
			</div>

			{/* ── Tab: Skills Library ── */}
			{activeTab === "library" && (
				<div className="space-y-3">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search skills..."
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] py-1.5 pl-8 pr-3 text-[12px] text-gray-300 placeholder-gray-600 outline-none transition-all focus:border-[#2a3550]"
						/>
					</div>
					{filteredSkills.length === 0 ? (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex flex-col items-center gap-3 py-12 text-center">
								<BookOpen className="h-8 w-8 text-gray-600" />
								<p className="text-sm text-gray-500">
									{searchQuery ? "No skills match your search." : "No skills found."}
								</p>
								{!searchQuery && (
									<p className="text-[11px] text-gray-600">
										Generate a skill from the Recommendations tab to get started.
									</p>
								)}
							</div>
						</Card>
					) : (
						<div className="grid grid-cols-2 gap-3">
							{filteredSkills.map((skill) => (
								<SkillCard key={skill.id} skill={skill} />
							))}
						</div>
					)}
				</div>
			)}

			{/* ── Tab: Recommendations ── */}
			{activeTab === "recommendations" && (
				<div className="space-y-3">
					{recommendations.length === 0 ? (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex flex-col items-center gap-3 py-12 text-center">
								<Sparkles className="h-8 w-8 text-gray-600" />
								<p className="text-sm text-gray-500">No recommendations available right now.</p>
								<p className="text-[11px] text-gray-600">
									AI-powered gap analysis will suggest skills based on your project's needs.
								</p>
							</div>
						</Card>
					) : (
						recommendations.map((rec) => (
							<RecommendationCard key={rec.id} rec={rec} onGenerate={handleGenerate} />
						))
					)}
				</div>
			)}

			{/* ── Tab: Drafts ── */}
			{activeTab === "drafts" && (
				<div className="space-y-3">
					{drafts.length === 0 ? (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex flex-col items-center gap-3 py-12 text-center">
								<FilePlus className="h-8 w-8 text-gray-600" />
								<p className="text-sm text-gray-500">No drafts yet.</p>
								<p className="text-[11px] text-gray-600">
									Generate a skill from the Recommendations tab to create a draft.
								</p>
							</div>
						</Card>
					) : (
						drafts.map((draft) => (
							<DraftCard key={draft.id} draft={draft} onApprove={handleApprove} onReject={handleReject} />
						))
					)}
				</div>
			)}
		</div>
	)
}
