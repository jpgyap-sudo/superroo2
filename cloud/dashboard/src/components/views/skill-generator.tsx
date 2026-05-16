"use client"

import { useState, useMemo, useCallback } from "react"
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

const EXISTING_SKILLS: ExistingSkill[] = [
	{
		id: "autonomous",
		name: "Autonomous Mode",
		description: "Self-directed scanning, reporting & improvement loop",
		emoji: "🤖",
		category: "automation",
		status: "active",
		lines: 81,
	},
	{
		id: "deployer",
		name: "Deployer",
		description: "Automates project deployment preparation and execution",
		emoji: "🚀",
		category: "deployment",
		status: "active",
		lines: 107,
	},
	{
		id: "evals-context",
		name: "Evals Context",
		description: "Context about the Roo Code evals system structure in this monorepo",
		emoji: "📊",
		category: "quality",
		status: "active",
		lines: 189,
	},
	{
		id: "project-artifact-generator",
		name: "Project Artifact Generator",
		description: "Generates project agents, resources, rules, skills from repository signals",
		emoji: "📦",
		category: "automation",
		status: "active",
		lines: 129,
	},
	{
		id: "roo-conflict-resolution",
		name: "Conflict Resolution",
		description: "Resolves merge conflicts intelligently using git history and commit context",
		emoji: "🔀",
		category: "quality",
		status: "active",
		lines: 257,
	},
	{
		id: "roo-translation",
		name: "Translation",
		description: "Guidelines for translating and localizing Roo Code extension strings",
		emoji: "🌐",
		category: "integration",
		status: "active",
		lines: 152,
	},
	{
		id: "workspace-domain-guard",
		name: "Workspace Domain Guard",
		description: "Detects wrong-workspace requests before editing code",
		emoji: "🛡️",
		category: "quality",
		status: "active",
		lines: 39,
	},
	{
		id: "superroo-vps-deployer",
		name: "SuperRoo VPS Deployer",
		description: "Automated deployment to the SuperRoo cloud dashboard VPS",
		emoji: "🖥️",
		category: "deployment",
		status: "active",
		lines: 141,
	},
	{
		id: "google-cloud-api",
		name: "Google Cloud API",
		description: "Integrate Google Cloud services into SuperRoo apps",
		emoji: "☁️",
		category: "integration",
		status: "active",
		lines: 328,
	},
	{
		id: "supabase",
		name: "Supabase",
		description: "Integrate Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions) into SuperRoo apps",
		emoji: "🔥",
		category: "integration",
		status: "active",
		lines: 328,
	},
	{
		id: "vercel",
		name: "Vercel",
		description: "Deploy and integrate Vercel (Next.js, Edge Functions, Serverless, Analytics, ISR) into SuperRoo apps",
		emoji: "▲",
		category: "deployment",
		status: "active",
		lines: 328,
	},
	{
		id: "digitalocean-vps",
		name: "DigitalOcean VPS",
		description: "Deploy, manage, and maintain applications on DigitalOcean Droplets (VPS)",
		emoji: "🐳",
		category: "deployment",
		status: "active",
		lines: 328,
	},
]

const RECOMMENDED_SKILLS: RecommendedSkill[] = [
	{
		id: "rec-cicd",
		title: "GitHub Actions CI/CD",
		description: "Automate testing, building, and deploying SuperRoo across branches and environments",
		reason: "No CI/CD automation skill exists yet — critical for release engineering",
		priority: "high",
		category: "DevOps",
		icon: <GitBranch className="h-4 w-4" />,
	},
	{
		id: "rec-docker",
		title: "Docker & Container Management",
		description: "Build, run, and orchestrate Docker containers for SuperRoo services",
		reason: "Docker is used in deployment but no skill documents container workflows",
		priority: "high",
		category: "DevOps",
		icon: <Container className="h-4 w-4" />,
	},
	{
		id: "rec-database",
		title: "Database Operations (SQL/NoSQL)",
		description: "Schema migrations, query optimization, and data management for SuperRoo backends",
		reason: "No database skill exists — backend services need data layer guidance",
		priority: "high",
		category: "Backend",
		icon: <Database className="h-4 w-4" />,
	},
	{
		id: "rec-monitoring",
		title: "Monitoring & Observability",
		description: "Set up logging, metrics, alerts, and dashboards for production services",
		reason: "PM2 and server health exist but no structured monitoring skill",
		priority: "medium",
		category: "DevOps",
		icon: <Activity className="h-4 w-4" />,
	},
	{
		id: "rec-security",
		title: "Security Scanning & Hardening",
		description: "Vulnerability scanning, dependency audits, and security best practices",
		reason: "No security-focused skill exists in the current library",
		priority: "medium",
		category: "Quality",
		icon: <Shield className="h-4 w-4" />,
	},
	{
		id: "rec-testing",
		title: "Testing Framework Guide",
		description: "Vitest, E2E, integration testing patterns and best practices for SuperRoo",
		reason: "Testing rules exist in rules.md but no dedicated testing skill",
		priority: "medium",
		category: "Quality",
		icon: <TestTube className="h-4 w-4" />,
	},
	{
		id: "rec-api-design",
		title: "API Design & Documentation",
		description: "REST/GraphQL API design patterns, versioning, and OpenAPI specs",
		reason: "Multiple API services exist but no API design skill",
		priority: "medium",
		category: "Backend",
		icon: <Code className="h-4 w-4" />,
	},
	{
		id: "rec-ai-ml",
		title: "AI/ML Integration Patterns",
		description: "Patterns for integrating LLMs, embeddings, and ML pipelines into SuperRoo",
		reason: "SuperRoo is AI-native but lacks a dedicated AI/ML integration skill",
		priority: "low",
		category: "AI",
		icon: <Bot className="h-4 w-4" />,
	},
]

const MOCK_DRAFTS: DraftItem[] = [
	{
		id: "draft-1",
		type: "skill",
		title: "seo-meta-tag-optimization.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 72,
		afterScore: 91,
		status: "pending",
		createdAt: "2026-05-02T14:30:00Z",
	},
	{
		id: "draft-2",
		type: "workflow",
		title: "batch-image-alt-generation.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 65,
		afterScore: 88,
		status: "pending",
		createdAt: "2026-05-02T16:00:00Z",
	},
	{
		id: "draft-3",
		type: "resource",
		title: "homeu-furniture-keywords.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 80,
		afterScore: 85,
		status: "approved",
		createdAt: "2026-05-01T10:00:00Z",
	},
]

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
	const [drafts, setDrafts] = useState<DraftItem[]>(MOCK_DRAFTS)
	const [activeTab, setActiveTab] = useState<"library" | "recommendations" | "drafts">("library")
	const [searchQuery, setSearchQuery] = useState("")
	const [categoryFilter, setCategoryFilter] = useState<string>("all")
	const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)

	const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
		setToast({ message, type })
		setTimeout(() => setToast(null), 3000)
	}, [])

	const setStatus = (id: string, status: DraftItem["status"]) => {
		setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)))
		if (status === "approved") showToast("Draft approved and merged to skill library", "success")
		if (status === "rejected") showToast("Draft rejected", "error")
		if (status === "pending") showToast("Draft moved back to pending review", "info")
	}

	const handleGenerate = useCallback(
		(id: string) => {
			const rec = RECOMMENDED_SKILLS.find((r) => r.id === id)
			if (!rec) return
			const newDraft: DraftItem = {
				id: `draft-${Date.now()}`,
				type: "skill",
				title: rec.title.toLowerCase().replace(/\s+/g, "-") + ".md",
				targetAgent: "superroo-agent",
				beforeScore: 60 + Math.floor(Math.random() * 20),
				afterScore: 80 + Math.floor(Math.random() * 15),
				status: "pending",
				createdAt: new Date().toISOString(),
			}
			setDrafts((prev) => [...prev, newDraft])
			showToast(`Generated draft: ${rec.title}`, "success")
		},
		[showToast],
	)

	const handleGenerateAll = useCallback(() => {
		RECOMMENDED_SKILLS.forEach((rec) => {
			const newDraft: DraftItem = {
				id: `draft-${Date.now()}-${rec.id}`,
				type: "skill",
				title: rec.title.toLowerCase().replace(/\s+/g, "-") + ".md",
				targetAgent: "superroo-agent",
				beforeScore: 60 + Math.floor(Math.random() * 20),
				afterScore: 80 + Math.floor(Math.random() * 15),
				status: "pending",
				createdAt: new Date().toISOString(),
			}
			setDrafts((prev) => [...prev, newDraft])
		})
		showToast(`Generated ${RECOMMENDED_SKILLS.length} draft skills`, "success")
	}, [showToast])

	const filteredSkills = useMemo(() => {
		return EXISTING_SKILLS.filter((s) => {
			const matchesSearch =
				searchQuery === "" ||
				s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				s.description.toLowerCase().includes(searchQuery.toLowerCase())
			const matchesCategory = categoryFilter === "all" || s.category === categoryFilter
			return matchesSearch && matchesCategory
		})
	}, [searchQuery, categoryFilter])

	const categories = useMemo(() => {
		const cats = new Set(EXISTING_SKILLS.map((s) => s.category))
		return ["all", ...Array.from(cats)]
	}, [])

	const pendingDrafts = drafts.filter((d) => d.status === "pending")
	const approvedDrafts = drafts.filter((d) => d.status === "approved")

	const totalSkillLines = EXISTING_SKILLS.reduce((acc, s) => acc + s.lines, 0)

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
				<div className="flex items-center gap-2">
					<Badge status="success" label={`${EXISTING_SKILLS.length} skills`} />
					<Badge status="warning" label={`${pendingDrafts.length} pending`} />
				</div>
			</div>

			{/* ── Stats Row ── */}
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Existing Skills"
					value={
						<span className="flex items-center gap-2">
							{EXISTING_SKILLS.length}
							<span className="text-[11px] font-normal text-gray-500">skills</span>
						</span>
					}
					sub={`${totalSkillLines} total lines of instruction`}
					color="text-[#e2e8f0]"
				/>
				<StatCard
					label="Recommendations"
					value={
						<span className="flex items-center gap-2">
							{RECOMMENDED_SKILLS.length}
							<span className="text-[11px] font-normal text-gray-500">gaps identified</span>
						</span>
					}
					sub={`${RECOMMENDED_SKILLS.filter((r) => r.priority === "high").length} high priority`}
					color="text-amber-400"
				/>
				<StatCard
					label="Pending Drafts"
					value={
						<span className="flex items-center gap-2">
							{pendingDrafts.length}
							<span className="text-[11px] font-normal text-gray-500">awaiting review</span>
						</span>
					}
					sub={`${approvedDrafts.length} already approved`}
					color="text-emerald-400"
				/>
				<StatCard
					label="Avg Score Impact"
					value={
						<span className="flex items-center gap-1">
							<TrendingUp className="h-4 w-4 text-emerald-400" />+
							{Math.round(
								drafts.reduce((acc, d) => acc + (d.afterScore - d.beforeScore), 0) /
									(drafts.length || 1),
							)}
							pts
						</span>
					}
					sub="Before → After improvement"
					color="text-emerald-400"
				/>
			</div>

			{/* ── Tab Navigation ── */}
			<div className="flex items-center gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-1">
				{[
					{ id: "library" as const, label: "Skills Library", icon: BookOpen },
					{ id: "recommendations" as const, label: "Recommendations", icon: Sparkles },
					{ id: "drafts" as const, label: "Drafts", icon: FilePlus },
				].map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-medium transition-all ${
							activeTab === tab.id
								? "bg-[#1e2535] text-[#e2e8f0] shadow-sm"
								: "text-gray-500 hover:text-gray-300"
						}`}>
						<tab.icon className="h-3.5 w-3.5" />
						{tab.label}
						{tab.id === "drafts" && pendingDrafts.length > 0 && (
							<span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-400">
								{pendingDrafts.length}
							</span>
						)}
						{tab.id === "recommendations" && (
							<span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cyan-500/20 px-1 text-[10px] font-bold text-cyan-400">
								{RECOMMENDED_SKILLS.length}
							</span>
						)}
					</button>
				))}
			</div>

			{/* ── Tab: Skills Library ── */}
			{activeTab === "library" && (
				<div className="space-y-4">
					{/* Search & Filter */}
					<div className="flex items-center gap-3">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
							<input
								type="text"
								placeholder="Search skills by name or description..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] py-2 pl-9 pr-3 text-[12px] text-[#e2e8f0] placeholder-gray-600 outline-none transition-all focus:border-[#2a3550] focus:ring-1 focus:ring-[#2a3550]"
							/>
						</div>
						<div className="flex items-center gap-1.5">
							<Filter className="h-3.5 w-3.5 text-gray-500" />
							{categories.map((cat) => (
								<button
									key={cat}
									onClick={() => setCategoryFilter(cat)}
									className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
										categoryFilter === cat
											? "bg-[#1e2535] text-[#e2e8f0]"
											: "text-gray-500 hover:text-gray-300"
									}`}>
									{cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
								</button>
							))}
						</div>
					</div>

					{/* Skills Grid */}
					{filteredSkills.length === 0 ? (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex flex-col items-center gap-2 py-8 text-center">
								<Search className="h-8 w-8 text-gray-600" />
								<p className="text-sm text-gray-500">No skills match your search</p>
								<button
									onClick={() => {
										setSearchQuery("")
										setCategoryFilter("all")
									}}
									className="text-[11px] text-blue-400 hover:underline">
									Clear filters
								</button>
							</div>
						</Card>
					) : (
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
							{filteredSkills.map((skill) => (
								<SkillCard key={skill.id} skill={skill} />
							))}
						</div>
					)}

					{/* Summary */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex items-center justify-between text-[11px] text-gray-500">
							<span>
								Showing {filteredSkills.length} of {EXISTING_SKILLS.length} skills
							</span>
							<span className="flex items-center gap-1">
								<Code className="h-3 w-3" />
								{totalSkillLines} total instruction lines across all skills
							</span>
						</div>
					</Card>
				</div>
			)}

			{/* ── Tab: Recommendations ── */}
			{activeTab === "recommendations" && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<Card className="flex-1 border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex items-start gap-3">
								<Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
								<div>
									<h3 className="text-sm font-semibold text-[#e2e8f0]">AI-Powered Recommendations</h3>
									<p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
										Based on analysis of the current skill library, project structure, and common
										development patterns, these skills would fill critical gaps in SuperRoo's
										capabilities. Click <strong>Generate</strong> to create a draft skill file.
									</p>
								</div>
							</div>
						</Card>
						<button
							onClick={handleGenerateAll}
							className="ml-3 flex shrink-0 items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95">
							<Zap className="h-3.5 w-3.5" />
							Generate All
						</button>
					</div>

					<div className="space-y-2">
						{RECOMMENDED_SKILLS.map((rec) => (
							<RecommendationCard key={rec.id} rec={rec} onGenerate={handleGenerate} />
						))}
					</div>

					{/* Priority Legend */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<div className="flex items-center gap-4 text-[11px] text-gray-500">
							<span className="font-medium text-gray-400">Priority Legend:</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-2 w-2 rounded-full bg-red-400" /> High — Critical gap
							</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Medium — Important
							</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> Low — Nice to have
							</span>
						</div>
					</Card>
				</div>
			)}

			{/* ── Tab: Drafts ── */}
			{activeTab === "drafts" && (
				<div className="space-y-4">
					{/* Drafts Header */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<h3 className="text-sm font-semibold text-[#e2e8f0]">Generated Drafts</h3>
							<Badge status="warning" label="Drafts only — never auto-merge" />
						</div>
						<div className="flex items-center gap-2">
							<button
								onClick={() => showToast("Drafts refreshed", "info")}
								className="flex items-center gap-1 rounded border border-[#1e2535] bg-[#0f1117] px-2.5 py-1.5 text-[11px] text-gray-400 transition-all hover:text-gray-300 active:scale-95">
								<RefreshCw className="h-3 w-3" />
								Refresh
							</button>
							<button
								onClick={() => showToast("Exported all drafts as JSON", "success")}
								className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95">
								<Download className="h-3 w-3" />
								Export All
							</button>
						</div>
					</div>

					{/* Draft Summary Bar */}
					{drafts.length > 0 && (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex items-center gap-4 text-[11px] text-gray-500">
								<span className="font-medium text-gray-400">Summary:</span>
								<span className="inline-flex items-center gap-1">
									<span className="inline-block h-2 w-2 rounded-full bg-amber-400" />{" "}
									{pendingDrafts.length} pending
								</span>
								<span className="inline-flex items-center gap-1">
									<span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />{" "}
									{approvedDrafts.length} approved
								</span>
								<span className="inline-flex items-center gap-1">
									<span className="inline-block h-2 w-2 rounded-full bg-red-400" />{" "}
									{drafts.filter((d) => d.status === "rejected").length} rejected
								</span>
								<span className="ml-auto text-gray-600">
									{drafts.filter((d) => d.type === "skill").length} skills ·{" "}
									{drafts.filter((d) => d.type === "workflow").length} workflows ·{" "}
									{drafts.filter((d) => d.type === "resource").length} resources
								</span>
							</div>
						</Card>
					)}

					{drafts.length === 0 ? (
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<div className="flex flex-col items-center gap-2 py-8 text-center">
								<FilePlus className="h-8 w-8 text-gray-600" />
								<p className="text-sm text-gray-500">No drafts yet</p>
								<p className="text-[11px] text-gray-600">
									Generate skills from the Recommendations tab to see drafts here
								</p>
							</div>
						</Card>
					) : (
						<div className="space-y-3">
							{drafts.map((d) => (
								<Card
									key={d.id}
									className={`border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] transition-all ${
										d.status === "pending"
											? "border-l-2 border-l-amber-500/50"
											: d.status === "approved"
												? "border-l-2 border-l-emerald-500/50"
												: "border-l-2 border-l-red-500/50"
									}`}>
									<div className="flex items-start justify-between">
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="text-sm font-semibold text-[#e2e8f0]">{d.title}</span>
												<Badge
													status={
														d.status === "approved"
															? "success"
															: d.status === "rejected"
																? "failed"
																: "warning"
													}
													label={d.status.toUpperCase()}
												/>
											</div>
											<div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
												<span className="inline-flex items-center gap-1">
													<Target className="h-3 w-3" />
													{d.targetAgent}
												</span>
												<span>·</span>
												<span>Type: {typeLabel(d.type)}</span>
												<span>·</span>
												<span className="inline-flex items-center gap-1">
													<Clock className="h-3 w-3" />
													{new Date(d.createdAt).toLocaleDateString()}
												</span>
											</div>
										</div>
										<div className="ml-4 shrink-0 text-right">
											<div className="text-[10px] text-gray-500">Score</div>
											<div className="flex items-center gap-1.5">
												<span className="text-[11px] text-gray-500 line-through">
													{d.beforeScore}
												</span>
												<ChevronRight className="h-3 w-3 text-emerald-400" />
												<span className="text-sm font-bold text-emerald-400">
													{d.afterScore}
												</span>
											</div>
											<div className="mt-0.5 text-[10px] text-emerald-500/70">
												+{d.afterScore - d.beforeScore} pts
											</div>
										</div>
									</div>

									{d.status === "pending" && (
										<div className="mt-3 flex items-center gap-2 border-t border-[#1e2535] pt-3">
											<button
												onClick={() => setStatus(d.id, "approved")}
												className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/20">
												<CheckCircle className="h-3.5 w-3.5" />
												Approve & Merge
											</button>
											<button
												onClick={() => setStatus(d.id, "rejected")}
												className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:bg-red-500/20">
												<XCircle className="h-3.5 w-3.5" />
												Reject
											</button>
											<span className="ml-auto text-[10px] text-gray-600">
												<AlertTriangle className="mr-0.5 inline h-3 w-3" />
												Review before approving — changes are irreversible
											</span>
										</div>
									)}

									{d.status === "approved" && (
										<div className="mt-3 flex items-center gap-2 border-t border-[#1e2535] pt-3">
											<Badge status="success" label="Merged to skill library" />
											<span className="text-[10px] text-gray-600">
												This skill is now available for all agents
											</span>
										</div>
									)}

									{d.status === "rejected" && (
										<div className="mt-3 flex items-center gap-2 border-t border-[#1e2535] pt-3">
											<Badge status="failed" label="Discarded" />
											<button
												onClick={() => setStatus(d.id, "pending")}
												className="text-[10px] text-blue-400 hover:underline">
												Undo — move back to pending
											</button>
										</div>
									)}
								</Card>
							))}
						</div>
					)}
				</div>
			)}

			{/* ── Toast Notification ── */}
			{toast && (
				<div
					className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-[12px] font-medium shadow-lg transition-all ${
						toast.type === "success"
							? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
							: toast.type === "error"
								? "border-red-500/30 bg-red-500/10 text-red-400"
								: "border-blue-500/30 bg-blue-500/10 text-blue-400"
					}`}>
					{toast.type === "success" ? (
						<CheckCircle className="h-4 w-4" />
					) : toast.type === "error" ? (
						<XCircle className="h-4 w-4" />
					) : (
						<Info className="h-4 w-4" />
					)}
					{toast.message}
				</div>
			)}
		</div>
	)
}
