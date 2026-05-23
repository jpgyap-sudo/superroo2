"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import type { ReactNode } from "react"
import {
	Activity,
	BrainCircuit,
	Bug,
	CheckCircle,
	Code2,
	GitCommit,
	Monitor,
	Rocket,
	Send,
	ShieldCheck,
	Workflow,
	Search,
	Download,
	ZoomIn,
	ZoomOut,
	Maximize2,
	X,
	RefreshCw,
	AlertTriangle,
	BarChart3,
	ExternalLink,
	Share2,
	Play,
	Pause,
	HeartPulse,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type FlowId = "telegram" | "debug-team" | "cloud-ide" | "deploy" | "learning" | "self-healing"

interface FlowStep {
	title: string
	detail: string
	meta?: string[]
}

interface FeatureFlow {
	id: FlowId
	title: string
	subtitle: string
	icon: ReactNode
	color: string
	steps: FlowStep[]
	outcomes: string[]
}

const FLOWS: FeatureFlow[] = [
	{
		id: "telegram",
		title: "Telegram Workflow",
		subtitle: "Remote command, approval, natural language, and notification loop.",
		icon: <Send className="h-4 w-4" />,
		color: "text-sky-300 border-sky-500/40 bg-sky-500/10",
		steps: [
			{ title: "Telegram user", detail: "Sends a slash command, button callback, or natural language message." },
			{ title: "Telegram Bot API", detail: "Delivers the update to the SuperRoo webhook." },
			{
				title: "Cloud API webhook",
				detail: "telegramBot.js receives and normalizes message or callback updates.",
				meta: ["dedupe update_id", "persist session"],
			},
			{
				title: "Guard layer",
				detail: "Checks rate limits, auth sessions, group rules, and boss-only restrictions.",
				meta: ["rate", "auth", "boss guard"],
			},
			{
				title: "Command / NL routing",
				detail: "Routes slash commands directly or classifies natural language intent.",
				meta: ["/code", "/debug", "/deploy", "/brain"],
			},
			{
				title: "Execution backends",
				detail: "Uses orchestrator, queue, Central Brain, deploy system, or ops endpoints.",
				meta: ["queue", "brain", "deploy"],
			},
			{
				title: "Telegram notifier",
				detail: "Sends formatted status, buttons, diffs, approvals, and results back.",
			},
		],
		outcomes: ["Task created", "Debug action queued", "Approval captured", "Deploy started", "Answer returned"],
	},
	{
		id: "debug-team",
		title: "Debug Team Workflow",
		subtitle: "Autonomous multi-agent debugging with rollback-safe iteration.",
		icon: <Bug className="h-4 w-4" />,
		color: "text-rose-300 border-rose-500/40 bg-rose-500/10",
		steps: [
			{ title: "Issue or goal", detail: "A bug, failing feature, or complex request enters the Debug Team." },
			{
				title: "Phase breakdown",
				detail: "Large work is split into dependency-aware phases and a critical path.",
			},
			{ title: "Hypothesis loop", detail: "Root-cause hypotheses and assumptions are tracked with evidence." },
			{ title: "Snapshot", detail: "Git/savepoint state is captured before patching." },
			{ title: "Patch", detail: "Specialist agents implement the smallest safe fix." },
			{ title: "Sandbox tests", detail: "Docker/local sandbox verifies behavior under bounded resources." },
			{ title: "Critic review", detail: "Regression, safety, and architecture checks decide the next action." },
			{
				title: "Commit/deploy or retry",
				detail: "Passing work proceeds; failing work rolls back, refines the hypothesis, and retries.",
				meta: ["rollback", "retry", "deploy"],
			},
			{ title: "Lessons and skills", detail: "Reusable lessons or generated skills are stored for future runs." },
		],
		outcomes: ["Root cause found", "Patch verified", "Rollback protected", "Lesson captured"],
	},
	{
		id: "cloud-ide",
		title: "Cloud IDE Workflow",
		subtitle: "Browser IDE surface for editing, terminal, git, AI chat, and diffs.",
		icon: <Code2 className="h-4 w-4" />,
		color: "text-violet-300 border-violet-500/40 bg-violet-500/10",
		steps: [
			{ title: "Open IDE", detail: "User enters Mini IDE or dashboard IDE Terminal view." },
			{ title: "Auth and session", detail: "JWT/session state selects the current project workspace." },
			{ title: "Workspace tree", detail: "File tree, tabs, status bar, and persisted settings hydrate." },
			{
				title: "User action",
				detail: "Edits files, runs terminal commands, asks AI chat, searches, or uses git tools.",
				meta: ["edit", "terminal", "AI chat", "git"],
			},
			{ title: "WebSocket / API RPC", detail: "Frontend sends real-time or HTTP operations to the Cloud API." },
			{
				title: "Filesystem / orchestrator",
				detail: "Server performs file CRUD, shell, diff, git, or task orchestration.",
			},
			{
				title: "Live feedback",
				detail: "Autosave, diff viewer, terminal output, problems, and status updates return.",
			},
		],
		outcomes: ["Files changed", "Terminal output", "AI task created", "Diff reviewed"],
	},
	{
		id: "deploy",
		title: "Deploy Orchestrator Workflow",
		subtitle: "Queued build and deployment path with health checks and rollback.",
		icon: <Rocket className="h-4 w-4" />,
		color: "text-amber-300 border-amber-500/40 bg-amber-500/10",
		steps: [
			{
				title: "Approved change",
				detail: "A reviewed task, Telegram command, or dashboard action requests deployment.",
			},
			{
				title: "Commit deploy log",
				detail: "Commit metadata and affected features are recorded for traceability.",
			},
			{ title: "Build queue", detail: "Project-scoped build queue deduplicates and serializes builds." },
			{
				title: "Unified builder",
				detail: "Docker, Next.js, TypeScript, or static build runs through a single interface.",
			},
			{ title: "Tailscale VPS deploy", detail: "Deployment uses the private Tailscale route to the VPS." },
			{ title: "Health gate", detail: "Post-deploy checks verify API, workers, routes, and critical services." },
			{
				title: "Healthy or rollback",
				detail: "Healthy deploys are marked good; failed deploys roll back to last known good.",
			},
			{
				title: "Notify and audit",
				detail: "Deploy status is written to the log and surfaced in Telegram/dashboard.",
			},
		],
		outcomes: ["Build cached", "Deploy serialized", "Rollback ready", "Audit trail updated"],
	},
	{
		id: "learning",
		title: "Learning / Central Brain Workflow",
		subtitle: "Lessons are retrieved before work and captured after work.",
		icon: <BrainCircuit className="h-4 w-4" />,
		color: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
		steps: [
			{ title: "Task starts", detail: "Agent registers intent and identifies files/features involved." },
			{ title: "superroo-learn query", detail: "Relevant cross-project lessons are fetched from memory." },
			{
				title: "Context injection",
				detail: "Lessons, working-tree notes, bug memory, and model decisions enter the brief.",
			},
			{ title: "Work and test", detail: "Implementation is planned, delegated, reviewed, and verified." },
			{ title: "Commit hook or manual store", detail: "Lesson extraction captures what changed and why." },
			{
				title: "Central Brain / fallback",
				detail: "Lessons sync to Central Brain or local JSONL/markdown fallback.",
			},
			{ title: "Future retrieval", detail: "The next agent gets this lesson during similar tasks." },
		],
		outcomes: ["Repeated mistakes avoided", "Cross-project memory", "Fallback-safe capture"],
	},
	{
		id: "self-healing",
		title: "Self-Healing / Monitoring Workflow",
		subtitle: "Metrics and logs become incidents, plans, fixes, and verified registry updates.",
		icon: <Monitor className="h-4 w-4" />,
		color: "text-lime-300 border-lime-500/40 bg-lime-500/10",
		steps: [
			{ title: "Metrics and logs", detail: "Monitoring views, workers, API health, and logs stream signals." },
			{
				title: "Incident detection",
				detail: "Failures, anomalies, and repeated errors become tracked incidents.",
			},
			{ title: "Classify", detail: "Root cause classifier assigns area, severity, and probable failure mode." },
			{ title: "Repair plan", detail: "Repair Plan Builder proposes a minimal safe remediation path." },
			{ title: "Safety gate", detail: "Autonomy level and capability checks approve or block action." },
			{ title: "Fix and test", detail: "Agent/sandbox applies the fix and runs targeted verification." },
			{ title: "Verify", detail: "Health and regression checks confirm the incident is resolved." },
			{ title: "Registries", detail: "Event log, bug registry, feature registry, and lessons are updated." },
		],
		outcomes: ["Incident resolved", "Bug linked to feature", "Event trail preserved", "Lesson added"],
	},
]

const SURFACES = [
	{ label: "Telegram", icon: <Send className="h-4 w-4" />, detail: "Remote ops and approvals", tab: "telegram" },
	{ label: "Dashboard", icon: <Activity className="h-4 w-4" />, detail: "Monitoring and control", tab: "overview" },
	{ label: "Cloud IDE", icon: <Code2 className="h-4 w-4" />, detail: "Workspace editing", tab: "ide-terminal" },
	{ label: "Debug Team", icon: <Bug className="h-4 w-4" />, detail: "Autonomous repair", tab: "debug-team" },
]

const BACKENDS = [
	{ label: "Cloud API", icon: <Workflow className="h-4 w-4" />, tab: "api-keys" },
	{ label: "Orchestrator / Queue", icon: <CheckCircle className="h-4 w-4" />, tab: "queue" },
	{ label: "Central Brain", icon: <BrainCircuit className="h-4 w-4" />, tab: "brain" },
	{ label: "Sandbox / Deploy", icon: <ShieldCheck className="h-4 w-4" />, tab: "deploy" },
	{ label: "Commit & Lessons", icon: <GitCommit className="h-4 w-4" />, tab: "commit-deploy" },
]

/** Navigate to another dashboard tab */
function navigateTo(tab: string) {
	window.dispatchEvent(new CustomEvent("navigate", { detail: tab }))
}

// ─── Live status hook ───────────────────────────────────────────────
interface FlowStatus {
	online: boolean
	label: string
	detail: string
}

function useFlowStatuses(): Record<FlowId, FlowStatus> {
	const [health, setHealth] = useState<any>(null)

	useEffect(() => {
		const fetchHealth = () => {
			fetch("/api/health")
				.then((r) => r.json())
				.then(setHealth)
				.catch(() => setHealth({ status: "offline" }))
		}
		fetchHealth()
		const iv = setInterval(fetchHealth, 30000)
		return () => clearInterval(iv)
	}, [])

	return useMemo(() => {
		const online = health?.status === "online"
		return {
			telegram: {
				online: online && health?.telegram !== false,
				label: online && health?.telegram !== false ? "Online" : "Offline",
				detail: online && health?.telegram !== false ? "Webhook active" : "Webhook unreachable",
			},
			"debug-team": {
				online: online && health?.debugTeam !== false,
				label: online && health?.debugTeam !== false ? "Ready" : "Unavailable",
				detail: online && health?.debugTeam !== false ? "Debug agents online" : "Debug agents offline",
			},
			"cloud-ide": {
				online: online && health?.ide !== false,
				label: online && health?.ide !== false ? "Online" : "Offline",
				detail: online && health?.ide !== false ? "IDE sessions active" : "IDE unavailable",
			},
			deploy: {
				online: online && health?.deploy !== false,
				label: online && health?.deploy !== false ? "Ready" : "Unavailable",
				detail: online && health?.deploy !== false ? "Deploy pipeline healthy" : "Deploy pipeline down",
			},
			learning: {
				online: online && health?.brain !== false,
				label: online && health?.brain !== false ? "Online" : "Offline",
				detail: online && health?.brain !== false ? "Central Brain reachable" : "Central Brain unreachable",
			},
			"self-healing": {
				online: online && health?.selfHealing !== false,
				label: online && health?.selfHealing !== false ? "Active" : "Inactive",
				detail: online && health?.selfHealing !== false ? "Healing loop running" : "Healing loop stopped",
			},
		}
	}, [health])
}

// ─── Step metrics hook ──────────────────────────────────────────────
interface StepMetrics {
	totalJobs: number
	activeJobs: number
	failedJobs: number
	pendingApprovals: number
}

function useStepMetrics(): StepMetrics {
	const [metrics, setMetrics] = useState<StepMetrics>({
		totalJobs: 0,
		activeJobs: 0,
		failedJobs: 0,
		pendingApprovals: 0,
	})

	useEffect(() => {
		const fetchMetrics = () => {
			fetch("/api/health")
				.then((r) => r.json())
				.then((data) => {
					setMetrics({
						totalJobs: (data?.queue?.waiting || 0) + (data?.queue?.active || 0),
						activeJobs: data?.queue?.active || 0,
						failedJobs: data?.queue?.failed || 0,
						pendingApprovals: data?.approvals?.pending || 0,
					})
				})
				.catch(() => {})
		}
		fetchMetrics()
		const iv = setInterval(fetchMetrics, 30000)
		return () => clearInterval(iv)
	}, [])

	return metrics
}

// ─── Flow health score ──────────────────────────────────────────────
function useFlowHealthScore(statuses: Record<FlowId, FlowStatus>): { score: number; level: string; color: string } {
	return useMemo(() => {
		const entries = Object.values(statuses)
		const online = entries.filter((s) => s.online).length
		const total = entries.length
		const score = Math.round((online / total) * 100)
		if (score >= 80) return { score, level: "Healthy", color: "text-emerald-400" }
		if (score >= 50) return { score, level: "Degraded", color: "text-amber-400" }
		return { score, level: "Critical", color: "text-rose-400" }
	}, [statuses])
}

// ─── Components ─────────────────────────────────────────────────────

function StepCard({ step, index, accent }: { step: FlowStep; index: number; accent: string }) {
	return (
		<div className="relative flex min-w-[220px] flex-1 flex-col transition-all duration-300 hover:translate-y-[-2px]">
			<Card className="h-full border-slate-800/80 bg-slate-950/40 p-4 transition-all duration-300 hover:border-slate-700/60 hover:bg-slate-950/60 hover:shadow-lg hover:shadow-violet-500/5">
				<div className="mb-3 flex items-center gap-2">
					<span
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-transform duration-300",
							accent,
						)}>
						{index + 1}
					</span>
					<h4 className="text-sm font-semibold text-slate-100">{step.title}</h4>
				</div>
				<p className="text-xs leading-relaxed text-slate-500">{step.detail}</p>
				{step.meta && (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{step.meta.map((item) => (
							<span
								key={item}
								className="rounded border border-slate-800 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-400">
								{item}
							</span>
						))}
					</div>
				)}
			</Card>
		</div>
	)
}

function FlowDiagram({ flow, status }: { flow: FeatureFlow; status: FlowStatus }) {
	return (
		<Card className="group overflow-hidden border-slate-800 bg-[#0b1020] p-0 transition-all duration-300 hover:border-slate-700/60">
			<div className="border-b border-slate-800 bg-slate-950/50 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<div className={cn("rounded-lg border p-2 transition-all duration-300", flow.color)}>
							{flow.icon}
						</div>
						<div>
							<div className="flex items-center gap-2">
								<h3 className="text-base font-semibold text-slate-100">{flow.title}</h3>
								{/* Live status indicator */}
								<div className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950/80 px-2 py-0.5">
									<div
										className={cn(
											"h-2 w-2 rounded-full",
											status.online
												? "bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
												: "bg-rose-500",
										)}
									/>
									<span
										className={cn(
											"text-[10px] font-medium",
											status.online ? "text-emerald-400" : "text-rose-400",
										)}>
										{status.label}
									</span>
								</div>
							</div>
							<p className="mt-1 text-xs text-slate-500">{flow.subtitle}</p>
							<p className="mt-0.5 text-[10px] text-slate-600">{status.detail}</p>
						</div>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{flow.outcomes.map((outcome) => (
							<span
								key={outcome}
								className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400">
								{outcome}
							</span>
						))}
					</div>
				</div>
			</div>
			<div className="overflow-x-auto p-4">
				<div className="flex min-w-max items-stretch gap-3">
					{flow.steps.map((step, index) => (
						<div key={`${flow.id}-${step.title}`} className="flex items-stretch gap-3">
							<StepCard step={step} index={index} accent={flow.color} />
							{index < flow.steps.length - 1 && (
								<div className="flex items-center text-slate-700 transition-colors duration-300 group-hover:text-slate-500">
									<span className="hidden text-xl md:inline">→</span>
									<span className="text-xl md:hidden">↓</span>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</Card>
	)
}

function OverviewMap({ zoom }: { zoom: number }) {
	return (
		<div
			className="rounded-lg border border-slate-800 bg-gradient-to-br from-[#0f172a] to-[#0a0e1a] p-4 transition-all duration-300"
			style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
			<div className="mb-4 flex items-center gap-2">
				<Workflow className="h-4 w-4 text-violet-300" />
				<h2 className="text-sm font-semibold text-slate-100">SuperRoo App Map</h2>
				<span className="text-[11px] text-slate-600">
					surfaces share the same orchestration, memory, and deploy backends
				</span>
			</div>
			<div className="grid gap-4 lg:grid-cols-[1fr_auto_1.2fr] lg:items-center">
				<div className="grid gap-2 sm:grid-cols-2">
					{SURFACES.map((surface) => (
						<button
							key={surface.label}
							type="button"
							onClick={() => navigateTo(surface.tab)}
							className="group rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-left transition-all duration-200 hover:border-violet-500/40 hover:bg-violet-500/10 hover:shadow-lg hover:shadow-violet-500/5">
							<div className="flex items-center gap-2 text-sm font-medium text-slate-200 transition-colors group-hover:text-violet-200">
								<span className="text-violet-300 transition-transform duration-200 group-hover:scale-110">
									{surface.icon}
								</span>
								{surface.label}
								<ExternalLink className="ml-auto h-3 w-3 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
							</div>
							<p className="mt-1 text-[11px] text-slate-600">{surface.detail}</p>
						</button>
					))}
				</div>
				<div className="flex justify-center text-2xl text-slate-700 lg:px-2">→</div>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{BACKENDS.map((backend) => (
						<button
							key={backend.label}
							type="button"
							onClick={() => navigateTo(backend.tab)}
							className="group rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-left transition-all duration-200 hover:border-violet-500/40 hover:bg-violet-500/15">
							<div className="flex items-center gap-2 text-xs font-medium text-violet-200 transition-colors group-hover:text-violet-100">
								{backend.icon}
								{backend.label}
								<ExternalLink className="ml-auto h-3 w-3 text-violet-600 opacity-0 transition-opacity group-hover:opacity-100" />
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	)
}

// ─── Flow health score card ─────────────────────────────────────────
function HealthScoreCard({ score, level, color }: { score: number; level: string; color: string }) {
	const circumference = 2 * Math.PI * 28
	const offset = circumference - (score / 100) * circumference
	return (
		<Card className="flex items-center gap-4 border-slate-800 bg-[#0f1117] p-4">
			<div className="relative flex h-16 w-16 items-center justify-center">
				<svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
					<circle cx="32" cy="32" r="28" fill="none" stroke="#1e2535" strokeWidth="4" />
					<circle
						cx="32"
						cy="32"
						r="28"
						fill="none"
						stroke="currentColor"
						strokeWidth="4"
						strokeDasharray={circumference}
						strokeDashoffset={offset}
						strokeLinecap="round"
						className={color}
					/>
				</svg>
				<HeartPulse className={cn("absolute h-5 w-5", color)} />
			</div>
			<div>
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold text-slate-100">Flow Health</span>
					<span className={cn("text-xs font-medium", color)}>{score}%</span>
				</div>
				<p className={cn("text-[11px]", color)}>{level}</p>
				<p className="mt-0.5 text-[10px] text-slate-600">Based on live API health checks</p>
			</div>
		</Card>
	)
}

// ─── Step metrics card ──────────────────────────────────────────────
function StepMetricsCard({ metrics }: { metrics: StepMetrics }) {
	return (
		<Card className="border-slate-800 bg-[#0f1117] p-4">
			<div className="mb-3 flex items-center gap-2">
				<BarChart3 className="h-4 w-4 text-violet-300" />
				<h3 className="text-xs font-semibold text-slate-100">Live Step Metrics</h3>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
					<p className="text-[18px] font-bold text-emerald-400">{metrics.activeJobs}</p>
					<p className="text-[10px] text-slate-500">Active Jobs</p>
				</div>
				<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
					<p className="text-[18px] font-bold text-amber-400">{metrics.totalJobs}</p>
					<p className="text-[10px] text-slate-500">Total Jobs</p>
				</div>
				<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
					<p className="text-[18px] font-bold text-rose-400">{metrics.failedJobs}</p>
					<p className="text-[10px] text-slate-500">Failed Jobs</p>
				</div>
				<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
					<p className="text-[18px] font-bold text-sky-400">{metrics.pendingApprovals}</p>
					<p className="text-[10px] text-slate-500">Pending Approvals</p>
				</div>
			</div>
		</Card>
	)
}

// ─── Main view ──────────────────────────────────────────────────────
export function FlowchartsView() {
	const [activeFlowId, setActiveFlowId] = useState<FlowId | "all">("all")
	const [searchQuery, setSearchQuery] = useState("")
	const [zoom, setZoom] = useState(1)
	const [autoRefresh, setAutoRefresh] = useState(true)
	const [showExportMenu, setShowExportMenu] = useState(false)
	const exportRef = useRef<HTMLDivElement>(null)

	const statuses = useFlowStatuses()
	const metrics = useStepMetrics()
	const healthScore = useFlowHealthScore(statuses)

	// Close export menu on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
				setShowExportMenu(false)
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [])

	const visibleFlows = useMemo(() => {
		let filtered = activeFlowId === "all" ? FLOWS : FLOWS.filter((flow) => flow.id === activeFlowId)
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase()
			filtered = filtered.filter(
				(flow) =>
					flow.title.toLowerCase().includes(q) ||
					flow.subtitle.toLowerCase().includes(q) ||
					flow.steps.some((s) => s.title.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q)) ||
					flow.outcomes.some((o) => o.toLowerCase().includes(q)),
			)
		}
		return filtered
	}, [activeFlowId, searchQuery])

	const handleExport = (format: "json" | "markdown") => {
		setShowExportMenu(false)
		if (format === "json") {
			const blob = new Blob([JSON.stringify(FLOWS, null, 2)], { type: "application/json" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = "superroo-flows.json"
			a.click()
			URL.revokeObjectURL(url)
		} else if (format === "markdown") {
			let md = "# SuperRoo Feature Flows\n\n"
			for (const flow of FLOWS) {
				md += `## ${flow.title}\n\n${flow.subtitle}\n\n`
				md += "### Steps\n\n"
				flow.steps.forEach((s, i) => {
					md += `${i + 1}. **${s.title}** — ${s.detail}\n`
				})
				md += "\n### Outcomes\n\n"
				flow.outcomes.forEach((o) => {
					md += `- ${o}\n`
				})
				md += "\n---\n\n"
			}
			const blob = new Blob([md], { type: "text/markdown" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = "superroo-flows.md"
			a.click()
			URL.revokeObjectURL(url)
		}
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-[11px] uppercase tracking-[0.25em] text-violet-400">Architecture visual guide</p>
					<h2 className="mt-1 text-2xl font-semibold text-slate-100">Feature Flowcharts</h2>
					<p className="mt-2 max-w-3xl text-sm text-slate-500">
						Jump between the most important app workflows: Telegram, Debug Team, Cloud IDE, deployment,
						learning memory, and self-healing operations.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* Auto-refresh toggle */}
					<button
						type="button"
						onClick={() => setAutoRefresh(!autoRefresh)}
						className={cn(
							"flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
							autoRefresh
								? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
								: "border-slate-800 bg-slate-950/40 text-slate-500",
						)}
						title={autoRefresh ? "Auto-refresh on (30s)" : "Auto-refresh off"}>
						{autoRefresh ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
						Auto
					</button>
					{/* Export button */}
					<div className="relative" ref={exportRef}>
						<button
							type="button"
							onClick={() => setShowExportMenu(!showExportMenu)}
							className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500 transition-colors hover:text-slate-200">
							<Share2 className="h-3 w-3" />
							Export
						</button>
						{showExportMenu && (
							<div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-slate-800 bg-[#0f1117] py-1 shadow-xl">
								<button
									type="button"
									onClick={() => handleExport("json")}
									className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800/50 hover:text-slate-200">
									<Download className="h-3 w-3" />
									Export JSON
								</button>
								<button
									type="button"
									onClick={() => handleExport("markdown")}
									className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800/50 hover:text-slate-200">
									<Download className="h-3 w-3" />
									Export Markdown
								</button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Health score + Step metrics row */}
			<div className="grid gap-4 sm:grid-cols-2">
				<HealthScoreCard score={healthScore.score} level={healthScore.level} color={healthScore.color} />
				<StepMetricsCard metrics={metrics} />
			</div>

			{/* Overview Map with zoom controls */}
			<div className="relative">
				<div className="absolute right-2 top-2 z-10 flex items-center gap-1">
					<button
						type="button"
						onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}
						className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors">
						<ZoomIn className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}
						className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors">
						<ZoomOut className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={() => setZoom(1)}
						className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors">
						<Maximize2 className="h-3 w-3" />
					</button>
				</div>
				<div className="overflow-x-auto">
					<OverviewMap zoom={zoom} />
				</div>
			</div>

			{/* Search bar */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Search flows, steps, outcomes..."
					className="w-full rounded-lg border border-slate-800 bg-[#0f1117] py-2.5 pl-9 pr-3 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-violet-500/40"
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => setSearchQuery("")}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
						<X className="h-3 w-3" />
					</button>
				)}
			</div>

			{/* Flow filter bar */}
			<Card className="border-slate-800 bg-[#0f1117] p-3">
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => setActiveFlowId("all")}
						className={cn(
							"rounded-lg border px-3 py-2 text-xs transition-colors",
							activeFlowId === "all"
								? "border-violet-500/50 bg-violet-500/15 text-violet-200"
								: "border-slate-800 bg-slate-950/40 text-slate-500 hover:text-slate-200",
						)}>
						All flowcharts
					</button>
					{FLOWS.map((flow) => (
						<button
							key={flow.id}
							type="button"
							onClick={() => setActiveFlowId(flow.id)}
							className={cn(
								"flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
								activeFlowId === flow.id
									? "border-violet-500/50 bg-violet-500/15 text-violet-200"
									: "border-slate-800 bg-slate-950/40 text-slate-500 hover:text-slate-200",
							)}>
							{flow.icon}
							{flow.title.replace(" Workflow", "")}
						</button>
					))}
				</div>
			</Card>

			{/* Flow diagrams */}
			<div className="space-y-5">
				{visibleFlows.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-slate-600">
						<Search className="mb-3 h-8 w-8" />
						<p className="text-sm">No flows match your search</p>
						<p className="mt-1 text-xs">Try a different search term or clear the filter</p>
					</div>
				) : (
					visibleFlows.map((flow) => <FlowDiagram key={flow.id} flow={flow} status={statuses[flow.id]} />)
				)}
			</div>
		</div>
	)
}
