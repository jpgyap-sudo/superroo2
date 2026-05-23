"use client"

import { useMemo, useState } from "react"
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
	{ label: "Telegram", icon: <Send className="h-4 w-4" />, detail: "Remote ops and approvals" },
	{ label: "Dashboard", icon: <Activity className="h-4 w-4" />, detail: "Monitoring and control" },
	{ label: "Cloud IDE", icon: <Code2 className="h-4 w-4" />, detail: "Workspace editing" },
	{ label: "Debug Team", icon: <Bug className="h-4 w-4" />, detail: "Autonomous repair" },
]

const BACKENDS = [
	{ label: "Cloud API", icon: <Workflow className="h-4 w-4" /> },
	{ label: "Orchestrator / Queue", icon: <CheckCircle className="h-4 w-4" /> },
	{ label: "Central Brain", icon: <BrainCircuit className="h-4 w-4" /> },
	{ label: "Sandbox / Deploy", icon: <ShieldCheck className="h-4 w-4" /> },
	{ label: "Commit & Lessons", icon: <GitCommit className="h-4 w-4" /> },
]

function StepCard({ step, index, accent }: { step: FlowStep; index: number; accent: string }) {
	return (
		<div className="relative flex min-w-[220px] flex-1 flex-col">
			<Card className="h-full border-slate-800/80 bg-slate-950/40 p-4">
				<div className="mb-3 flex items-center gap-2">
					<span
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-full border text-[11px]",
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

function FlowDiagram({ flow }: { flow: FeatureFlow }) {
	return (
		<Card className="overflow-hidden border-slate-800 bg-[#0b1020] p-0">
			<div className="border-b border-slate-800 bg-slate-950/50 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<div className={cn("rounded-lg border p-2", flow.color)}>{flow.icon}</div>
						<div>
							<h3 className="text-base font-semibold text-slate-100">{flow.title}</h3>
							<p className="mt-1 text-xs text-slate-500">{flow.subtitle}</p>
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
								<div className="flex items-center text-slate-700">
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

function OverviewMap() {
	return (
		<Card className="border-slate-800 bg-gradient-to-br from-[#0f172a] to-[#0a0e1a]">
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
						<div key={surface.label} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
							<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
								<span className="text-violet-300">{surface.icon}</span>
								{surface.label}
							</div>
							<p className="mt-1 text-[11px] text-slate-600">{surface.detail}</p>
						</div>
					))}
				</div>
				<div className="flex justify-center text-2xl text-slate-700 lg:px-2">→</div>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{BACKENDS.map((backend) => (
						<div key={backend.label} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
							<div className="flex items-center gap-2 text-xs font-medium text-violet-200">
								{backend.icon}
								{backend.label}
							</div>
						</div>
					))}
				</div>
			</div>
		</Card>
	)
}

export function FlowchartsView() {
	const [activeFlowId, setActiveFlowId] = useState<FlowId | "all">("all")
	const visibleFlows = useMemo(
		() => (activeFlowId === "all" ? FLOWS : FLOWS.filter((flow) => flow.id === activeFlowId)),
		[activeFlowId],
	)

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-[11px] uppercase tracking-[0.25em] text-violet-400">Architecture visual guide</p>
					<h2 className="mt-1 text-2xl font-semibold text-slate-100">Feature Flowcharts</h2>
					<p className="mt-2 max-w-3xl text-sm text-slate-500">
						Jump between the most important app workflows: Telegram, Debug Team, Cloud IDE, deployment,
						learning memory, and self-healing operations.
					</p>
				</div>
			</div>

			<OverviewMap />

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

			<div className="space-y-5">
				{visibleFlows.map((flow) => (
					<FlowDiagram key={flow.id} flow={flow} />
				))}
			</div>
		</div>
	)
}
