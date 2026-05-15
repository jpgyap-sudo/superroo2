"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { Card, StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	Lightbulb,
	FilePlus,
	CheckCircle,
	XCircle,
	TrendingUp,
	Search,
	Filter,
	BookOpen,
	Zap,
	Shield,
	Globe,
	GitBranch,
	Container,
	Database,
	Activity,
	TestTube,
	Code,
	MessageSquare,
	Bot,
	Rocket,
	Sparkles,
	ChevronRight,
	Clock,
	Target,
	Plus,
	Download,
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

/* ─── Mock Data ─────────────────────────────────────── */
// (removed — skills API not yet available; view shows graceful empty state)

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

/* ─── Main View ─────────────────────────────────────── */

export function SkillGeneratorView() {
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		// Simulate a brief check; in production this would probe the Skills API endpoint
		const timer = setTimeout(() => setLoading(false), 800)
		return () => clearTimeout(timer)
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="flex flex-col items-center gap-3">
					<RefreshCw className="h-6 w-6 animate-spin text-gray-500" />
					<p className="text-sm text-gray-500">Checking Skills API...</p>
				</div>
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
			</div>

			{/* ── Empty State ── */}
			<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
				<div className="flex flex-col items-center gap-4 py-16 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1e2535]">
						<BookOpen className="h-8 w-8 text-gray-500" />
					</div>
					<div className="max-w-md space-y-2">
						<h3 className="text-base font-semibold text-[#e2e8f0]">Skills API Not Yet Available</h3>
						<p className="text-[12px] leading-relaxed text-gray-500">
							The Skills Generator backend service is not deployed yet. This view will display the skill
							library, AI-powered recommendations, and draft management once the Skills API is available.
						</p>
					</div>
					<div className="flex flex-wrap items-center justify-center gap-3 pt-2">
						<div className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-[11px] text-gray-500">
							<BookOpen className="h-3.5 w-3.5 text-gray-600" />
							Skills Library
						</div>
						<div className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-[11px] text-gray-500">
							<Sparkles className="h-3.5 w-3.5 text-gray-600" />
							Recommendations
						</div>
						<div className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-[11px] text-gray-500">
							<FilePlus className="h-3.5 w-3.5 text-gray-600" />
							Draft Management
						</div>
					</div>
					<p className="text-[10px] text-gray-600">
						Expected features: skill CRUD, AI gap analysis, one-click draft generation, approval workflow
					</p>
				</div>
			</Card>
		</div>
	)
}
