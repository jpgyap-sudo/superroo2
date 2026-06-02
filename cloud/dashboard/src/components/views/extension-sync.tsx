"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, StatCard } from "@/components/ui/card"
import {
	Activity,
	AlertTriangle,
	ArrowRight,
	BookOpenCheck,
	BrainCircuit,
	CheckCircle2,
	Cpu,
	Database,
	Download,
	FileText,
	GitBranch,
	Layers,
	Network,
	RefreshCw,
	Search,
	Server,
	ShieldCheck,
	Sparkles,
	Wand2,
	Zap,
} from "lucide-react"

type SyncStatus = "live" | "partial" | "planned"

interface SyncArea {
	name: string
	status: SyncStatus
	coverage: number
	source: string
	extensions: string[]
	capability: string
	next: string
}

interface Gap {
	title: string
	area: string
	impact: string
	next: string
}

const syncAreas: SyncArea[] = [
	{
		name: "Skills",
		status: "live",
		coverage: 92,
		source: "~/.superroo/skills, ~/.codex/skills, .roo/skills",
		extensions: ["Codex", "Claude", "Kilo Code", "Blackbox", "Roo Cline"],
		capability: "Canonical global skills with extension-local shims and reusable workflow files.",
		next: "Add drift detection for stale extension-local skill mirrors.",
	},
	{
		name: "Resources",
		status: "live",
		coverage: 90,
		source: "~/.superroo/resources, docs/resources",
		extensions: ["Codex", "Claude", "Kilo Code", "SuperRoo VS Code", "Roo Cline"],
		capability: "Shared policies, MCP resources, deployment rules, and product architecture references.",
		next: "Expose freshness and owner metadata beside each resource.",
	},
	{
		name: "RAG and Central Brain",
		status: "live",
		coverage: 88,
		source: "Central Brain pgvector, Codex Brain MCP, local JSONL fallback",
		extensions: ["Codex", "Claude", "Kilo Code", "Blackbox", "SuperRoo VS Code"],
		capability: "Hybrid retrieval across Central Brain, local lessons, and Markdown fallback.",
		next: "Show per-extension retrieval latency and fallback source used.",
	},
	{
		name: "Learning Lessons",
		status: "live",
		coverage: 86,
		source: "memory/lessons-learned.md, memory/lesson-index.jsonl, Central Brain",
		extensions: ["Codex", "Claude", "Kilo Code", "Blackbox", "Roo Cline"],
		capability: "Append-only lesson capture, cross-project query, retry queue, and sync scripts.",
		next: "Add obligation SLA cards for pending lesson intents per agent.",
	},
	{
		name: "Machine Learning",
		status: "partial",
		coverage: 73,
		source: "~/.superroo/models/code-learner.json, train-central-ml, sync-ml-to-vps",
		extensions: ["Codex", "Claude", "Kilo Code"],
		capability: "Shared model artifacts, code learner samples, risk routing, and VPS sync hooks.",
		next: "Connect model artifact versions to dashboard health and deploy history.",
	},
	{
		name: "Neural Network",
		status: "partial",
		coverage: 64,
		source: "src/super-roo/ml/engine, cloud/orchestrator/modules/NeuralNetwork.js",
		extensions: ["SuperRoo VS Code", "Cloud Dashboard"],
		capability: "Tensor engine, learners, infinite improvement loop, and parallel ML trainer.",
		next: "Bridge local extension outcomes directly into neural training samples.",
	},
	{
		name: "Tasks",
		status: "live",
		coverage: 84,
		source: "~/.superroo/tasks/global-tasks.json, server/src/memory/codextask.json",
		extensions: ["Codex", "Claude", "Kilo Code", "Blackbox", "Roo Cline"],
		capability: "Shared task registry, active work board, extension task sync, and task timeline.",
		next: "Add conflict heatmap by file, agent, and active task.",
	},
	{
		name: "Predictive Risk",
		status: "live",
		coverage: 80,
		source: "~/.superroo/memory/predictive-risk/assessments.jsonl",
		extensions: ["Codex", "Claude", "Kilo Code"],
		capability: "Shared risk assessments, reusable risk patterns, and route hints before coding.",
		next: "Surface unresolved high-risk patterns on the same tab.",
	},
	{
		name: "MCP Servers",
		status: "partial",
		coverage: 70,
		source: "~/.superroo/mcp/codex-brain.json, .mcp.json, client configs",
		extensions: ["Codex", "Claude", "Kilo Code", "Blackbox", "Roo Cline"],
		capability: "Shared SuperRoo MCP stack for memory, tools, coding helpers, and workflow rules.",
		next: "Add config parse checks and server reachability for every consumer.",
	},
]

const gaps: Gap[] = [
	{
		title: "No single live endpoint for extension sync posture",
		area: "Observability",
		impact: "The dashboard can explain the map, but health is split across scripts, memory files, and MCP tools.",
		next: "Create /api/extension-sync/status that reads global skills, resources, tasks, lessons, ML, risk, and MCP configs.",
	},
	{
		title: "Skill and resource mirrors lack drift scoring",
		area: "Skills",
		impact: "Extension-local shims can silently fall behind canonical ~/.superroo roots.",
		next: "Hash canonical files, compare client mirrors, and show stale or missing files by extension.",
	},
	{
		title: "RAG freshness is not visible per agent",
		area: "RAG",
		impact: "Agents can retrieve context, but operators cannot see when each extension last queried or indexed memory.",
		next: "Log retrieval source, latency, result count, and fallback layer into Central Brain metrics.",
	},
	{
		title: "Lesson obligations are tracked but not dashboard-native",
		area: "Learning",
		impact: "Pending lesson intents are easy to miss unless the agent checks Central Brain MCP status.",
		next: "Render pending obligations, overdue agents, and recent fulfilled lessons in the dashboard.",
	},
	{
		title: "ML artifacts are synced, but not versioned against outcomes",
		area: "Machine Learning",
		impact: "Model quality changes are hard to trace back to the samples, tasks, and agents that trained them.",
		next: "Attach model version, sample count, quality score, and source mix to every train and sync event.",
	},
	{
		title: "Task conflict data is mostly textual",
		area: "Tasks",
		impact: "ACTIVE_WORK.md protects agents, but there is no dashboard-level conflict graph.",
		next: "Join global tasks with touched files and show same-file contention before agents start work.",
	},
	{
		title: "MCP config verification is not centralized",
		area: "MCP",
		impact: "Codex, Claude, Kilo, Blackbox, VS Code, and Roo configs can parse differently without one red flag.",
		next: "Run JSON/TOML validation and tool list checks from a scheduled health worker.",
	},
	{
		title: "Deployment sync is separate from learning sync",
		area: "Deploy",
		impact: "Commit/deploy history does not yet prove that lessons, ML, and resources synced after a release.",
		next: "Add post-deploy checks for lessons sync, ML sync, task registry sync, and Central Brain status.",
	},
]

const integrations = [
	"Wire the Global Skills Agent into Skill Generator so newly promoted skills update canonical roots first.",
	"Connect Memory Explorer to lesson obligation status, retry queue depth, and cross-project lesson projects.",
	"Feed Predictive Risk assessments into the ML Engine as labeled route-quality samples.",
	"Publish Central Brain workflow rule health into Workflow Compliance and this sync tab.",
	"Add dashboard actions for sync-local-extension-lessons, sync-all-brains, ml-train, and ml-sync-full.",
	"Use Task Timeline plus Commit Deploy Log to prove every completed task has a lesson and model outcome.",
	"Expose extension MCP consumers as nodes in Working Tree with links to their configs and last health check.",
]

const statusMeta: Record<SyncStatus, { label: string; badge: string; text: string }> = {
	live: { label: "Live", badge: "success", text: "text-emerald-400" },
	partial: { label: "Partial", badge: "warning", text: "text-amber-400" },
	planned: { label: "Planned", badge: "idle", text: "text-slate-400" },
}

function ProgressBar({ value, status }: { value: number; status: SyncStatus }) {
	const color = status === "live" ? "bg-emerald-500" : status === "partial" ? "bg-amber-500" : "bg-slate-500"
	return (
		<div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
			<div className={`${color} h-full rounded`} style={{ width: `${value}%` }} />
		</div>
	)
}

export function ExtensionSyncView() {
	const [query, setQuery] = useState("")
	const [lastRefreshed, setLastRefreshed] = useState(() => new Date())

	const filteredSyncAreas = useMemo(() => {
		const normalized = query.trim().toLowerCase()
		if (!normalized) return syncAreas
		return syncAreas.filter((area) => {
			const haystack = [area.name, area.source, area.capability, area.next, ...area.extensions].join(" ").toLowerCase()
			return haystack.includes(normalized)
		})
	}, [query])

	const liveCount = syncAreas.filter((area) => area.status === "live").length
	const partialCount = syncAreas.filter((area) => area.status === "partial").length
	const averageCoverage = Math.round(syncAreas.reduce((sum, area) => sum + area.coverage, 0) / syncAreas.length)

	const handleExport = () => {
		const header = ["area", "status", "coverage", "source", "extensions", "next"]
		const rows = syncAreas.map((area) =>
			[
				area.name,
				area.status,
				String(area.coverage),
				area.source,
				area.extensions.join("; "),
				area.next,
			]
				.map((value) => `"${value.replace(/"/g, '""')}"`)
				.join(","),
		)
		const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const link = document.createElement("a")
		link.href = url
		link.download = "superroo-extension-sync.csv"
		link.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className="space-y-6 p-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<Network className="h-5 w-5 text-cyan-400" />
						<h2 className="text-xl font-semibold text-slate-100">Local Extension Sync</h2>
					</div>
					<p className="mt-1 max-w-3xl text-sm text-slate-400">
						Cross-extension sync coverage for SuperRoo skills, RAG, learning lessons, resources, ML,
						neural training, tasks, MCP, and other shared local systems.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Badge status="success" label={`${liveCount} live`} />
					<Badge status="warning" label={`${partialCount} partial`} />
					<Badge status="active" label="Codex Brain aligned" />
				</div>
			</div>

			<div className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-950/30 p-3 lg:flex-row lg:items-center">
				<label className="flex min-w-0 flex-1 items-center gap-2 rounded border border-slate-800 bg-slate-950/60 px-3 py-2">
					<Search className="h-4 w-4 shrink-0 text-slate-500" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search sync areas, extensions, paths, or gaps"
						className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
					/>
				</label>
				<div className="flex flex-wrap items-center gap-2">
					<button
						onClick={() => setLastRefreshed(new Date())}
						className="inline-flex items-center gap-2 rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800/70">
						<RefreshCw className="h-3.5 w-3.5" />
						Refresh
					</button>
					<button
						onClick={handleExport}
						className="inline-flex items-center gap-2 rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800/70">
						<Download className="h-3.5 w-3.5" />
						Export CSV
					</button>
					<span className="text-xs text-slate-600">Updated {lastRefreshed.toLocaleTimeString()}</span>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard
					label="Sync Coverage"
					value={
						<span className="inline-flex items-center gap-2">
							<RefreshCw className="h-5 w-5 text-cyan-400" />
							{averageCoverage}%
						</span>
					}
					sub="average across shared local systems"
					color="text-cyan-300"
				/>
				<StatCard
					label="Extensions"
					value={
						<span className="inline-flex items-center gap-2">
							<Layers className="h-5 w-5 text-blue-400" />6
						</span>
					}
					sub="Codex, Claude, Kilo, Blackbox, VS Code, Roo"
					color="text-blue-300"
				/>
				<StatCard
					label="Canonical Roots"
					value={
						<span className="inline-flex items-center gap-2">
							<Database className="h-5 w-5 text-emerald-400" />3
						</span>
					}
					sub="skills, resources, memory"
					color="text-emerald-300"
				/>
				<StatCard
					label="Open Gaps"
					value={
						<span className="inline-flex items-center gap-2">
							<AlertTriangle className="h-5 w-5 text-amber-400" />
							{gaps.length}
						</span>
					}
					sub="integration opportunities"
					color="text-amber-300"
				/>
			</div>

			<div className="grid gap-4 xl:grid-cols-3">
				<div className="space-y-4 xl:col-span-2">
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-emerald-400" />
						<h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Sync Map</h3>
					</div>
					<div className="grid gap-3 lg:grid-cols-2">
						{filteredSyncAreas.map((area) => {
							const meta = statusMeta[area.status]
							return (
								<Card key={area.name} className="space-y-4">
									<div className="flex items-start justify-between gap-3">
										<div>
											<h4 className="text-sm font-semibold text-slate-100">{area.name}</h4>
											<p className="mt-1 text-xs text-slate-500">{area.source}</p>
										</div>
										<Badge status={meta.badge} label={meta.label} />
									</div>
									<div className="space-y-2">
										<div className="flex items-center justify-between text-xs">
											<span className="text-slate-500">Coverage</span>
											<span className={meta.text}>{area.coverage}%</span>
										</div>
										<ProgressBar value={area.coverage} status={area.status} />
									</div>
									<p className="text-sm text-slate-300">{area.capability}</p>
									<div className="flex flex-wrap gap-1.5">
										{area.extensions.map((extension) => (
											<span
												key={extension}
												className="rounded border border-slate-800 bg-slate-950/40 px-2 py-0.5 text-[11px] text-slate-400">
												{extension}
											</span>
										))}
									</div>
									<div className="flex gap-2 border-t border-slate-800/70 pt-3 text-xs text-slate-500">
										<ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
										<span>{area.next}</span>
									</div>
								</Card>
							)
						})}
						{filteredSyncAreas.length === 0 && (
							<Card className="lg:col-span-2">
								<p className="text-sm text-slate-400">No sync areas match the current search.</p>
							</Card>
						)}
					</div>
				</div>

				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<Sparkles className="h-4 w-4 text-violet-400" />
						<h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Existing Signals</h3>
					</div>
					<div className="space-y-3">
						{[
							{ icon: Wand2, label: "Global Skills Agent", text: "Promotes reusable skills and resources into canonical SuperRoo roots." },
							{ icon: BookOpenCheck, label: "Learning Layer", text: "Captures lessons through Markdown, JSONL, summaries, hooks, and Central Brain." },
							{ icon: BrainCircuit, label: "Codex Brain MCP", text: "Provides retrieval, risk, task registry, coding helpers, and lesson storage." },
							{ icon: Cpu, label: "ML Engine", text: "Learns from code, debug, test, risk, and task outcomes." },
							{ icon: GitBranch, label: "Working Tree", text: "Maps system modules, owners, connections, features, and health." },
							{ icon: Server, label: "Unified Deploy", text: "Can become the post-deploy proof point for sync completion." },
						].map((item) => {
							const Icon = item.icon
							return (
								<Card key={item.label} className="flex gap-3">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-800/60 text-cyan-300">
										<Icon className="h-4 w-4" />
									</div>
									<div>
										<h4 className="text-sm font-medium text-slate-100">{item.label}</h4>
										<p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
									</div>
								</Card>
							)
						})}
					</div>
				</div>
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 text-amber-400" />
						<h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Potential Gaps</h3>
					</div>
					<div className="space-y-3">
						{gaps.map((gap) => (
							<Card key={gap.title} className="space-y-3">
								<div className="flex flex-wrap items-center gap-2">
									<Badge status="warning" label={gap.area} />
									<h4 className="text-sm font-semibold text-slate-100">{gap.title}</h4>
								</div>
								<p className="text-sm text-slate-400">{gap.impact}</p>
								<p className="text-xs text-cyan-300">{gap.next}</p>
							</Card>
						))}
					</div>
				</div>

				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<Zap className="h-4 w-4 text-cyan-400" />
						<h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Next Integrations</h3>
					</div>
					<Card className="space-y-3">
						{integrations.map((item) => (
							<div key={item} className="flex gap-3 border-b border-slate-800/60 pb-3 last:border-0 last:pb-0">
								<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
								<p className="text-sm leading-6 text-slate-300">{item}</p>
							</div>
						))}
					</Card>

					<Card className="space-y-3 border-cyan-500/20 bg-cyan-950/10">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-cyan-300" />
							<h4 className="text-sm font-semibold text-slate-100">Recommended Live Endpoint</h4>
						</div>
						<p className="text-sm leading-6 text-slate-400">
							Add a read-only endpoint that composes global sync status from skills, resources, lessons,
							RAG, ML artifacts, neural samples, tasks, predictive risk, MCP configs, and deploy logs.
						</p>
						<div className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-400">
							GET /api/extension-sync/status
						</div>
					</Card>

					<Card className="space-y-3 border-emerald-500/20 bg-emerald-950/10">
						<div className="flex items-center gap-2">
							<Activity className="h-4 w-4 text-emerald-300" />
							<h4 className="text-sm font-semibold text-slate-100">Best Current Source of Truth</h4>
						</div>
						<p className="text-sm leading-6 text-slate-400">
							The strongest current backbone is the combination of Central Brain MCP, append-only lesson
							files, global SuperRoo roots, the task registry, predictive-risk memory, and the Working Tree.
						</p>
					</Card>
				</div>
			</div>
		</div>
	)
}
