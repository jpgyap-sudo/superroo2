"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Layers,
	Bot,
	Shield,
	Database,
	Bug,
	Activity,
	Cpu,
	GitBranch,
	Zap,
	Network,
	Box,
	FileCode,
	Rocket,
	Search,
	Upload,
	Terminal,
	Workflow,
	Brain,
	HeartPulse,
	ChevronDown,
	ChevronRight,
	Info,
	GitCommit,
	CheckCircle,
	XCircle,
	RotateCcw,
	Clock,
	BarChart3,
	GitFork,
	Link2,
	Bookmark,
	Hash,
	ListTree,
	X,
	User,
} from "lucide-react"

// ── Working Tree Data Model ────────────────────────────────────────────────────
// This is the single source of truth for the SuperRoo product architecture.
// Every module, agent, feature, and their interactions are defined here.
// Agents should read this to understand the system structure.

export interface WorkingTreeNode {
	id: string
	label: string
	description: string
	icon: React.ReactNode
	status: "stable" | "active" | "experimental" | "deprecated"
	children?: WorkingTreeNode[]
	connections?: string[] // IDs of nodes this node interacts with
	features?: string[] // Key product features this module enables
	owner?: string // Owning agent
}

export const WORKING_TREE: WorkingTreeNode[] = [
	{
		id: "orchestrator",
		label: "Orchestrator",
		description:
			"Task dispatch, agent lifecycle, and workflow orchestration. Routes tasks to the right agent based on capability and priority.",
		icon: <Workflow className="h-4 w-4" />,
		status: "stable",
		owner: "SuperRooOrchestrator",
		connections: ["agents", "queue", "safety", "memory", "logging"],
		features: ["Task routing", "Agent lifecycle management", "Workflow orchestration"],
		children: [
			{
				id: "agent-registry",
				label: "Agent Registry",
				description:
					"Central registry of all available agents. Agents register with their capabilities and the orchestrator looks them up at dispatch time.",
				icon: <Bot className="h-4 w-4" />,
				status: "stable",
				connections: ["agents"],
			},
		],
	},
	{
		id: "agents",
		label: "Agent System",
		description:
			"Specialized AI agents that execute tasks. Each agent has a specific domain (coding, debugging, testing, product management, etc.).",
		icon: <Bot className="h-4 w-4" />,
		status: "stable",
		owner: "AgentRegistry",
		connections: ["orchestrator", "safety", "memory", "logging", "healing", "product-memory"],
		features: [
			"Automated coding",
			"Debugging & root cause analysis",
			"Test execution",
			"Product management",
			"Self-healing",
		],
		children: [
			{
				id: "coder-agent",
				label: "Coder Agent",
				description: "Implements features, fixes bugs, and writes code. The primary code-generation agent.",
				icon: <FileCode className="h-4 w-4" />,
				status: "stable",
				connections: ["safety", "memory"],
			},
			{
				id: "debugger-agent",
				label: "Debugger Agent",
				description:
					"Investigates bugs, analyzes stack traces, and identifies root causes. Works with the healing system.",
				icon: <Bug className="h-4 w-4" />,
				status: "stable",
				connections: ["healing", "bugs"],
			},
			{
				id: "pm-agent",
				label: "PM Agent",
				description:
					"Product manager agent that tracks features, prioritizes work, and manages the product roadmap.",
				icon: <Layers className="h-4 w-4" />,
				status: "stable",
				connections: ["product-memory", "features"],
			},
			{
				id: "tester-agent",
				label: "Tester Agent",
				description: "Runs test suites, validates features, and reports regressions. Ensures quality gates.",
				icon: <Shield className="h-4 w-4" />,
				status: "stable",
				connections: ["features", "bugs"],
			},
			{
				id: "supabase-agent",
				label: "Supabase Agent",
				description:
					"Manages Supabase database operations: schema migrations, data queries, and row-level security.",
				icon: <Database className="h-4 w-4" />,
				status: "stable",
				connections: ["memory"],
			},
			{
				id: "self-healing-agent",
				label: "Self-Healing Agent",
				description:
					"Autonomous incident response agent. Detects failures, classifies root causes, and applies fixes without human intervention.",
				icon: <HeartPulse className="h-4 w-4" />,
				status: "stable",
				connections: ["healing", "bugs"],
			},
		],
	},
	{
		id: "safety",
		label: "Safety System",
		description:
			"Mode-based access control and capability gating. Prevents unauthorized operations based on autonomy level (OFF → SAFE → AUTO → FULL_AUTONOMOUS).",
		icon: <Shield className="h-4 w-4" />,
		status: "stable",
		owner: "SafetyManager",
		connections: ["orchestrator", "agents", "deploy"],
		features: ["Autonomy level enforcement", "Capability gating", "Blocklist filtering", "Self-improve guard"],
	},
	{
		id: "memory",
		label: "Memory System",
		description:
			"SQLite-backed persistence for features, bugs, tasks, and events. The durable state layer of the entire system.",
		icon: <Database className="h-4 w-4" />,
		status: "stable",
		owner: "MemoryStore",
		connections: ["orchestrator", "features", "bugs", "logging", "queue"],
		features: ["SQLite persistence", "CRUD for all entities", "Event sourcing"],
	},
	{
		id: "queue",
		label: "Task Queue",
		description:
			"Priority-based task queue with BullMQ integration. Manages pending, active, and completed jobs with retry logic.",
		icon: <Layers className="h-4 w-4" />,
		status: "stable",
		owner: "TaskQueue",
		connections: ["orchestrator", "memory", "logging"],
		features: ["Priority queuing", "Job retry & backoff", "Concurrency control"],
	},
	{
		id: "logging",
		label: "Event Log",
		description:
			"Append-only event stream for observability. All system events (task lifecycle, safety decisions, feature changes) are recorded here.",
		icon: <Activity className="h-4 w-4" />,
		status: "stable",
		owner: "EventLog",
		connections: ["orchestrator", "memory", "healing"],
		features: ["Event streaming", "Observability", "Audit trail"],
	},
	{
		id: "features",
		label: "Feature Registry",
		description:
			"Product memory CRUD for features. Tracks feature status (planned → building → testing → working → deprecated) and health (unknown → healthy → degraded → failing).",
		icon: <Box className="h-4 w-4" />,
		status: "stable",
		owner: "FeatureRegistry",
		connections: ["memory", "bugs", "product-memory", "agents"],
		features: ["Feature lifecycle tracking", "Health monitoring", "Bug-to-feature mapping"],
	},
	{
		id: "bugs",
		label: "Bug Registry",
		description:
			"Bug tracking and fix management. Records bug severity, status, reproduction steps, and links to features.",
		icon: <Bug className="h-4 w-4" />,
		status: "stable",
		owner: "BugRegistry",
		connections: ["memory", "features", "healing"],
		features: ["Bug recording & tracking", "Severity classification", "Fix attempt history"],
	},
	{
		id: "healing",
		label: "Self-Healing System",
		description:
			"Autonomous incident detection, root cause classification, repair planning, and resolution. The system that keeps SuperRoo running without human intervention.",
		icon: <HeartPulse className="h-4 w-4" />,
		status: "stable",
		owner: "HealingBus / SelfHealingLoop",
		connections: ["bugs", "features", "agents", "logging", "ml", "parallel"],
		features: [
			"Incident detection",
			"Root cause classification",
			"Repair plan generation",
			"Auto-fix deployment",
			"Verification cycle",
		],
		children: [
			{
				id: "healing-bus",
				label: "Healing Bus",
				description:
					"Central coordination hub for incidents. Stores incidents, manages state transitions, and emits events for the healing pipeline.",
				icon: <Activity className="h-4 w-4" />,
				status: "stable",
				connections: ["root-cause-classifier", "repair-plan-builder"],
			},
			{
				id: "root-cause-classifier",
				label: "Root Cause Classifier",
				description:
					"ML-free pattern-based classification. Identifies root cause categories (env missing, DB schema mismatch, API auth failure, etc.) from incident symptoms.",
				icon: <Brain className="h-4 w-4" />,
				status: "stable",
				connections: ["healing-bus"],
			},
			{
				id: "repair-plan-builder",
				label: "Repair Plan Builder",
				description:
					"Generates structured repair plans with diagnostic steps, safe patches, and test verification. Determines if human approval is needed.",
				icon: <FileCode className="h-4 w-4" />,
				status: "stable",
				connections: ["healing-bus"],
			},
			{
				id: "self-healing-loop",
				label: "Self-Healing Loop",
				description:
					"State machine that drives the healing cycle: detect → classify → plan → fix → verify. Runs on a configurable interval.",
				icon: <GitBranch className="h-4 w-4" />,
				status: "stable",
				connections: ["healing-bus", "agents"],
			},
		],
	},
	{
		id: "ml",
		label: "Machine Learning Engine",
		description:
			"Zero-dependency pure TypeScript neural network engine with deep learning capabilities. Powers code learning, debug pattern recognition, and the infinite improvement loop.",
		icon: <Brain className="h-4 w-4" />,
		status: "experimental",
		owner: "NeuralNetwork / InfiniteImprovementLoop",
		connections: ["healing", "agents", "parallel"],
		features: [
			"Neural network training",
			"Code pattern learning",
			"Debug pattern learning",
			"Test pattern learning",
			"Infinite improvement loop",
		],
		children: [
			{
				id: "ml-engine",
				label: "ML Engine",
				description:
					"Core neural network: Tensor, Dense/ReLU/Sigmoid/Tanh/Softmax/Dropout/BatchNorm layers, Adam/SGD optimizers, CrossEntropy/MSE/BCE loss functions.",
				icon: <Cpu className="h-4 w-4" />,
				status: "experimental",
			},
			{
				id: "ml-learners",
				label: "Learners",
				description:
					"Specialized learning modules: CodeLearner (code patterns), DebugLearner (debug patterns), TestLearner (test patterns). Each trains on domain-specific data.",
				icon: <Brain className="h-4 w-4" />,
				status: "experimental",
				connections: ["ml-engine"],
			},
			{
				id: "improvement-loop",
				label: "Infinite Improvement Loop",
				description:
					"Continuous improvement cycle that learns from past tasks, bugs, and fixes to improve future performance. The system that makes SuperRoo smarter over time.",
				icon: <GitBranch className="h-4 w-4" />,
				status: "experimental",
				connections: ["ml-learners", "healing"],
			},
		],
	},
	{
		id: "product-memory",
		label: "Product Memory",
		description:
			"Product control center. Tracks features, updates, test history, bug-to-feature mappings, and agent notes as human-readable JSON files. The 'source of truth' for what the product is and how it behaves.",
		icon: <Database className="h-4 w-4" />,
		status: "stable",
		owner: "ProductMemoryService",
		connections: ["features", "bugs", "agents", "logging"],
		features: [
			"Product feature tracking",
			"Update timeline",
			"Feature test history",
			"Bug-to-feature mapping",
			"Agent notes",
		],
		children: [
			{
				id: "product-feature-agent",
				label: "Product Feature Agent",
				description:
					"Discovers and registers product features from the codebase. Maintains the feature catalog with status, confidence, and ownership.",
				icon: <Box className="h-4 w-4" />,
				status: "stable",
				connections: ["features"],
			},
			{
				id: "product-updates-agent",
				label: "Product Updates Agent",
				description:
					"Tracks changes to the product (feature additions, bug fixes, UI changes, API changes, deployments). Maintains a chronological update timeline.",
				icon: <Activity className="h-4 w-4" />,
				status: "stable",
			},
			{
				id: "feature-tester-agent",
				label: "Feature Tester Agent",
				description:
					"Tests individual product features against their checklists. Records pass/fail/warning results and updates feature confidence scores.",
				icon: <Shield className="h-4 w-4" />,
				status: "stable",
				connections: ["tester-agent"],
			},
			{
				id: "bug-feature-mapper",
				label: "Bug-Feature Mapper",
				description:
					"Links bugs to the features they affect. Provides traceability from incidents to product impact.",
				icon: <GitBranch className="h-4 w-4" />,
				status: "stable",
				connections: ["bugs", "features"],
			},
		],
	},
	{
		id: "parallel",
		label: "Parallel Execution Engine",
		description:
			"Multi-agent parallel execution with inter-agent communication (AgentBus), parallel healing pipelines, and parallel ML training. Enables concurrent operations.",
		icon: <Network className="h-4 w-4" />,
		status: "experimental",
		owner: "ParallelExecutor / AgentBus",
		connections: ["agents", "healing", "ml"],
		features: ["Parallel task execution", "Inter-agent messaging", "Parallel healing", "Parallel ML training"],
		children: [
			{
				id: "agent-bus",
				label: "Agent Bus",
				description:
					"Message bus for inter-agent communication. Agents can publish and subscribe to typed messages with priority levels.",
				icon: <Network className="h-4 w-4" />,
				status: "experimental",
			},
			{
				id: "parallel-healing",
				label: "Parallel Healing Pipeline",
				description:
					"Processes multiple healing incidents concurrently. Each worker slot handles one incident through the detect-classify-plan-fix pipeline.",
				icon: <HeartPulse className="h-4 w-4" />,
				status: "experimental",
				connections: ["healing"],
			},
			{
				id: "parallel-ml",
				label: "Parallel ML Trainer",
				description:
					"Trains multiple ML models in parallel across worker slots. Distributes learning tasks across available compute resources.",
				icon: <Brain className="h-4 w-4" />,
				status: "experimental",
				connections: ["ml"],
			},
		],
	},
	{
		id: "cpu-guard",
		label: "CPU Guard",
		description:
			"Resource-aware autonomous agent loop protection. Monitors CPU/RAM usage and throttles or pauses autonomous operations when system resources are constrained.",
		icon: <Cpu className="h-4 w-4" />,
		status: "stable",
		owner: "AgentLoopGuard / AutonomousController",
		connections: ["agents", "orchestrator"],
		features: ["CPU usage monitoring", "Autonomous task throttling", "Resource-aware scheduling"],
	},
	{
		id: "deploy",
		label: "Deploy System",
		description:
			"GitHub Actions workflow dispatch and VPS SSH deployment. Manages staging and production deployments with rollback support.",
		icon: <Rocket className="h-4 w-4" />,
		status: "stable",
		owner: "DeployOrchestrator",
		connections: ["safety", "logging"],
		features: ["GitHub Actions dispatch", "VPS SSH deployment", "Rollback management", "Health check verification"],
	},
	{
		id: "crawler",
		label: "Crawler Agent",
		description:
			"Data crawling and extraction from external sources (web pages, APIs, documents). Extracts entities and signals for downstream processing.",
		icon: <Search className="h-4 w-4" />,
		status: "experimental",
		owner: "CrawlerAgent",
		connections: ["logging"],
		features: ["Web crawling", "Entity extraction", "Signal detection"],
	},
	{
		id: "import",
		label: "File Importer",
		description:
			"Imports files from the filesystem into the workspace. Supports multiple file types with content extraction and validation.",
		icon: <Upload className="h-4 w-4" />,
		status: "stable",
		owner: "FileImporter",
		connections: ["memory"],
		features: ["File import", "Content extraction", "Type validation"],
	},
	{
		id: "remote",
		label: "Remote Shell",
		description:
			"SSH-based remote command execution on VPS or other remote servers. Enables remote operations from within the agent system.",
		icon: <Terminal className="h-4 w-4" />,
		status: "experimental",
		owner: "RemoteShell",
		connections: ["deploy", "safety"],
		features: ["SSH command execution", "Remote file operations"],
	},
]

// ── Helper: Flatten tree for search ───────────────────────────────────────────

function flattenTree(nodes: WorkingTreeNode[]): WorkingTreeNode[] {
	const flat: WorkingTreeNode[] = []
	for (const n of nodes) {
		flat.push(n)
		if (n.children) flat.push(...flattenTree(n.children))
	}
	return flat
}

const ALL_NODES = flattenTree(WORKING_TREE)

// ── Status Colors ─────────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
	stable: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
	active: "text-blue-400 bg-blue-500/10 border-blue-500/30",
	experimental: "text-amber-400 bg-amber-500/10 border-amber-500/30",
	deprecated: "text-gray-500 bg-gray-500/10 border-gray-500/30",
}

const statusDot: Record<string, string> = {
	stable: "bg-emerald-400",
	active: "bg-blue-400",
	experimental: "bg-amber-400",
	deprecated: "bg-gray-500",
}

// ── Tree Node Component ───────────────────────────────────────────────────────

function TreeNode({
	node,
	depth = 0,
	selected,
	onSelect,
}: {
	node: WorkingTreeNode
	depth?: number
	selected: string | null
	onSelect: (id: string) => void
}) {
	const [expanded, setExpanded] = useState(true)
	const hasChildren = node.children && node.children.length > 0
	const isSelected = selected === node.id

	return (
		<div>
			<button
				onClick={() => {
					onSelect(node.id)
					if (hasChildren) setExpanded(!expanded)
				}}
				className={cn(
					"group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-all",
					isSelected
						? "bg-violet-600/15 text-violet-300 ring-1 ring-violet-600/25 shadow-sm shadow-violet-600/5"
						: "text-gray-400 hover:bg-[#1a2035] hover:text-gray-200",
				)}
				style={{ paddingLeft: `${14 + depth * 18}px` }}>
				{/* Expand/collapse indicator */}
				{hasChildren ? (
					expanded ? (
						<ChevronDown className="h-3 w-3 shrink-0 text-gray-600 transition-transform" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0 text-gray-600 transition-transform" />
					)
				) : (
					<span className="w-3 shrink-0" />
				)}

				{/* Icon */}
				<span
					className={cn(
						"shrink-0 transition-colors",
						isSelected ? "text-violet-400" : "text-gray-500 group-hover:text-gray-300",
					)}>
					{node.icon}
				</span>

				{/* Label */}
				<span className="flex-1 truncate font-medium">{node.label}</span>

				{/* Status dot */}
				<span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[node.status])} />
			</button>

			{/* Children */}
			{hasChildren && expanded && (
				<div className="ml-2 border-l border-[#1e2535]/60 pl-1">
					{node.children!.map((child) => (
						<TreeNode
							key={child.id}
							node={child}
							depth={depth + 1}
							selected={selected}
							onSelect={onSelect}
						/>
					))}
				</div>
			)}
		</div>
	)
}

// ── Connection Lines ──────────────────────────────────────────────────────────

function ConnectionLines({ node, allNodes }: { node: WorkingTreeNode; allNodes: WorkingTreeNode[] }) {
	if (!node.connections || node.connections.length === 0) return null

	const connected = node.connections
		.map((id) => allNodes.find((n) => n.id === id))
		.filter(Boolean) as WorkingTreeNode[]

	if (connected.length === 0) return null

	return (
		<div>
			<div className="mb-2 flex items-center gap-1.5">
				<Link2 className="h-3 w-3 text-gray-600" />
				<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Connections</span>
				<span className="text-[10px] text-gray-700">({connected.length})</span>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{connected.map((c) => (
					<span
						key={c.id}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium ring-1 transition-colors hover:brightness-125",
							statusColor[c.status],
						)}>
						{c.icon}
						{c.label}
					</span>
				))}
			</div>
		</div>
	)
}

// ── Commit & Deploy Log Types ──────────────────────────────────────────────────

interface CommitLogEntry {
	id: string
	commitSha: string
	agent: string
	type: string
	title: string
	timestamp: string
	filesChanged: string[]
	featuresAffected: string[]
}

interface DeployLogEntry {
	id: string
	version: string
	status: string
	agent: string
	environment: string
	healthCheckPassed: boolean | null
	startedAt: string
	completedAt: string | null
	error?: string
}

interface CommitDeployStats {
	totalCommits: number
	totalDeploys: number
	successfulDeploys: number
	failedDeploys: number
	rolledBackDeploys: number
	commitsByAgent: Record<string, number>
	commitsByType: Record<string, number>
	lastCommit: CommitLogEntry | null
	lastDeploy: DeployLogEntry | null
}

// ── Commit & Deploy Log Panel ──────────────────────────────────────────────────

const deployStatusColor: Record<string, string> = {
	pending: "text-amber-400 bg-amber-500/10 border-amber-500/30",
	building: "text-blue-400 bg-blue-500/10 border-blue-500/30",
	deploying: "text-violet-400 bg-violet-500/10 border-violet-500/30",
	healthy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
	unhealthy: "text-red-400 bg-red-500/10 border-red-500/30",
	rolled_back: "text-orange-400 bg-orange-500/10 border-orange-500/30",
	failed: "text-red-400 bg-red-500/10 border-red-500/30",
}

const deployStatusIcon: Record<string, React.ReactNode> = {
	pending: <Clock className="h-3 w-3" />,
	building: <Cpu className="h-3 w-3" />,
	deploying: <Rocket className="h-3 w-3" />,
	healthy: <CheckCircle className="h-3 w-3" />,
	unhealthy: <XCircle className="h-3 w-3" />,
	rolled_back: <RotateCcw className="h-3 w-3" />,
	failed: <XCircle className="h-3 w-3" />,
}

function CommitDeployPanel() {
	const [stats, setStats] = useState<CommitDeployStats | null>(null)
	const [recentCommits, setRecentCommits] = useState<CommitLogEntry[]>([])
	const [recentDeploys, setRecentDeploys] = useState<DeployLogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		async function fetchData() {
			try {
				const baseUrl = "http://localhost:3001"
				const [statsRes, commitsRes, deploysRes] = await Promise.all([
					fetch(`${baseUrl}/api/commit-deploy-log/stats`).catch(() => null),
					fetch(`${baseUrl}/api/commit-deploy-log/commits?limit=5`).catch(() => null),
					fetch(`${baseUrl}/api/commit-deploy-log/deploys?limit=5`).catch(() => null),
				])

				if (statsRes?.ok) {
					const s = await statsRes.json()
					setStats(s)
				}
				if (commitsRes?.ok) {
					const c = await commitsRes.json()
					setRecentCommits(c)
				}
				if (deploysRes?.ok) {
					const d = await deploysRes.json()
					setRecentDeploys(d)
				}
			} catch {
				setError("Could not load commit/deploy data")
			} finally {
				setLoading(false)
			}
		}
		fetchData()
		const iv = setInterval(fetchData, 30_000)
		return () => clearInterval(iv)
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-6">
				<Clock className="h-4 w-4 animate-pulse text-gray-600" />
				<span className="ml-2 text-xs text-gray-600">Loading commit & deploy log...</span>
			</div>
		)
	}

	return (
		<div className="space-y-3">
			{/* Stats Row */}
			{stats && (
				<div className="grid grid-cols-4 gap-2">
					<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2.5 text-center">
						<GitCommit className="mx-auto h-3.5 w-3.5 text-violet-400" />
						<div className="mt-0.5 text-base font-bold text-[#e2e8f0]">{stats.totalCommits}</div>
						<div className="text-[9px] text-gray-500">Commits</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2.5 text-center">
						<Rocket className="mx-auto h-3.5 w-3.5 text-blue-400" />
						<div className="mt-0.5 text-base font-bold text-[#e2e8f0]">{stats.totalDeploys}</div>
						<div className="text-[9px] text-gray-500">Deploys</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2.5 text-center">
						<CheckCircle className="mx-auto h-3.5 w-3.5 text-emerald-400" />
						<div className="mt-0.5 text-base font-bold text-emerald-400">{stats.successfulDeploys}</div>
						<div className="text-[9px] text-gray-500">Healthy</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2.5 text-center">
						<XCircle className="mx-auto h-3.5 w-3.5 text-red-400" />
						<div className="mt-0.5 text-base font-bold text-red-400">
							{stats.failedDeploys + stats.rolledBackDeploys}
						</div>
						<div className="text-[9px] text-gray-500">Failed/Rolled</div>
					</div>
				</div>
			)}

			{/* Recent Commits */}
			<div>
				<div className="mb-1.5 flex items-center gap-1.5">
					<GitCommit className="h-3 w-3 text-violet-400" />
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						Recent Commits
					</span>
				</div>
				{recentCommits.length === 0 ? (
					<p className="py-2 text-center text-[11px] text-gray-600">No commits recorded yet</p>
				) : (
					<div className="space-y-1">
						{recentCommits.map((c) => (
							<div
								key={c.id}
								className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 hover:bg-[#0f1117] transition-colors">
								<span className="shrink-0 font-mono text-[10px] text-gray-600">
									{c.commitSha.slice(0, 7)}
								</span>
								<span className="flex-1 truncate text-[11px] text-gray-300">{c.title}</span>
								<span className="shrink-0 text-[10px] text-gray-500">{c.agent}</span>
								<span
									className={cn(
										"shrink-0 rounded-lg px-1.5 py-0.5 text-[9px] font-medium ring-1",
										c.type === "feature"
											? "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20"
											: c.type === "bugfix"
												? "text-red-400 bg-red-500/10 ring-red-500/20"
												: "text-gray-400 bg-gray-500/10 ring-gray-500/20",
									)}>
									{c.type}
								</span>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Recent Deploys */}
			<div>
				<div className="mb-1.5 flex items-center gap-1.5">
					<Rocket className="h-3 w-3 text-violet-400" />
					<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
						Recent Deploys
					</span>
				</div>
				{recentDeploys.length === 0 ? (
					<p className="py-2 text-center text-[11px] text-gray-600">No deploys recorded yet</p>
				) : (
					<div className="space-y-1">
						{recentDeploys.map((d) => (
							<div
								key={d.id}
								className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-2.5 py-1.5 hover:bg-[#0f1117] transition-colors">
								<span className="shrink-0 font-mono text-[10px] text-gray-600">{d.version}</span>
								<span className="flex-1 truncate text-[11px] text-gray-300">{d.agent}</span>
								<span
									className={cn(
										"inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[9px] font-medium ring-1",
										deployStatusColor[d.status] || "text-gray-400 bg-gray-500/10 ring-gray-500/20",
									)}>
									{deployStatusIcon[d.status] || null}
									{d.status}
								</span>
							</div>
						))}
					</div>
				)}
			</div>

			{error && <p className="text-[10px] text-red-400">{error}</p>}
		</div>
	)
}

// ── Detail Panel Tabs ─────────────────────────────────────────────────────────

type DetailTab = "overview" | "features" | "connections" | "submodules"

// ── Main View ─────────────────────────────────────────────────────────────────

export function WorkingTreeView() {
	const [selected, setSelected] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [filterStatus, setFilterStatus] = useState<string | null>(null)
	const [showCommitLog, setShowCommitLog] = useState(false)
	const [detailTab, setDetailTab] = useState<DetailTab>("overview")

	const selectedNode = selected ? ALL_NODES.find((n) => n.id === selected) : null

	// Filter tree based on search
	const filteredTree = search
		? (WORKING_TREE.map((root) => filterNode(root, search)).filter(Boolean) as WorkingTreeNode[])
		: filterStatus
			? (WORKING_TREE.map((root) => filterNodeByStatus(root, filterStatus)).filter(Boolean) as WorkingTreeNode[])
			: WORKING_TREE

	function filterNode(node: WorkingTreeNode, query: string): WorkingTreeNode | null {
		const lower = query.toLowerCase()
		const match =
			node.label.toLowerCase().includes(lower) ||
			node.description.toLowerCase().includes(lower) ||
			(node.features && node.features.some((f) => f.toLowerCase().includes(lower)))

		const filteredChildren = node.children
			? (node.children.map((c) => filterNode(c, query)).filter(Boolean) as WorkingTreeNode[])
			: []

		if (match || filteredChildren.length > 0) {
			return { ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children }
		}
		return null
	}

	function filterNodeByStatus(node: WorkingTreeNode, status: string): WorkingTreeNode | null {
		const match = node.status === status
		const filteredChildren = node.children
			? (node.children.map((c) => filterNodeByStatus(c, status)).filter(Boolean) as WorkingTreeNode[])
			: []

		if (match || filteredChildren.length > 0) {
			return { ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children }
		}
		return null
	}

	return (
		<div className="flex h-full gap-5">
			{/* ── Left Panel: Tree ── */}
			<div className="w-80 shrink-0 space-y-3 overflow-y-auto">
				{/* Module Overview Stats */}
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
					<div className="mb-2.5 flex items-center gap-2">
						<BarChart3 className="h-3.5 w-3.5 text-violet-400" />
						<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
							Architecture Overview
						</span>
					</div>
					<div className="grid grid-cols-2 gap-1.5">
						<div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/5 px-2 py-1">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							<span className="text-[10px] text-emerald-300 font-medium">
								{ALL_NODES.filter((n) => n.status === "stable").length} stable
							</span>
						</div>
						<div className="flex items-center gap-1.5 rounded-lg bg-blue-500/5 px-2 py-1">
							<span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
							<span className="text-[10px] text-blue-300 font-medium">
								{ALL_NODES.filter((n) => n.status === "active").length} active
							</span>
						</div>
						<div className="flex items-center gap-1.5 rounded-lg bg-amber-500/5 px-2 py-1">
							<span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
							<span className="text-[10px] text-amber-300 font-medium">
								{ALL_NODES.filter((n) => n.status === "experimental").length} experimental
							</span>
						</div>
						<div className="flex items-center gap-1.5 rounded-lg bg-gray-500/5 px-2 py-1">
							<span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
							<span className="text-[10px] text-gray-400 font-medium">
								{ALL_NODES.filter((n) => n.status === "deprecated").length} deprecated
							</span>
						</div>
					</div>
				</div>

				{/* Search & Filter Row */}
				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
						<input
							type="text"
							placeholder="Search modules..."
							value={search}
							onChange={(e) => {
								setSearch(e.target.value)
								setFilterStatus(null)
							}}
							className="w-full rounded-xl border border-[#1e2535] bg-[#0f1117] py-2 pl-8 pr-3 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-violet-600/50 transition-colors"
						/>
					</div>
					{filterStatus && (
						<button
							onClick={() => setFilterStatus(null)}
							className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1e2535] text-gray-500 hover:text-gray-300 transition-colors"
							title="Clear filter">
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>

				{/* Status Filter Chips */}
				<div className="flex gap-1.5 flex-wrap">
					{(["stable", "active", "experimental", "deprecated"] as const).map((s) => (
						<button
							key={s}
							onClick={() => {
								setFilterStatus(filterStatus === s ? null : s)
								setSearch("")
							}}
							className={cn(
								"rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors",
								filterStatus === s
									? statusColor[s]
									: "border border-[#1e2535] text-gray-500 hover:border-gray-600 hover:text-gray-400",
							)}>
							{s}
						</button>
					))}
				</div>

				{/* Tree */}
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-1.5">
					{filteredTree.length === 0 ? (
						<div className="py-8 text-center">
							<Search className="mx-auto h-6 w-6 text-gray-700" />
							<p className="mt-2 text-xs text-gray-600">No modules match your search</p>
						</div>
					) : (
						filteredTree.map((root) => (
							<TreeNode key={root.id} node={root} selected={selected} onSelect={setSelected} />
						))
					)}
				</div>

				{/* Commit & Deploy Log Toggle */}
				<button
					onClick={() => setShowCommitLog(!showCommitLog)}
					className={cn(
						"flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors border border-[#1e2535]",
						showCommitLog
							? "bg-violet-600/15 text-violet-300 border-violet-600/30"
							: "bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] text-gray-400 hover:border-gray-600 hover:text-gray-200",
					)}>
					{showCommitLog ? (
						<ChevronDown className="h-3 w-3 shrink-0 text-gray-600" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0 text-gray-600" />
					)}
					<GitCommit className="h-3.5 w-3.5 shrink-0" />
					<span className="flex-1 truncate font-medium">Commit & Deploy Log</span>
				</button>

				{showCommitLog && <CommitDeployPanel />}
			</div>

			{/* ── Right Panel: Detail ── */}
			<div className="flex-1 overflow-y-auto">
				{selectedNode ? (
					<div className="space-y-4">
						{/* Header Card */}
						<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
							<div className="flex items-start justify-between gap-4">
								<div className="flex items-center gap-3">
									<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/15 text-violet-400 ring-1 ring-violet-600/20 shadow-sm shadow-violet-600/5">
										{selectedNode.icon}
									</div>
									<div>
										<h2 className="text-base font-semibold text-[#e2e8f0]">{selectedNode.label}</h2>
										<div className="mt-0.5 flex items-center gap-2">
											{selectedNode.owner && (
												<p className="text-[11px] text-gray-500">
													<span className="text-gray-600">Owner:</span>{" "}
													<span className="font-mono text-gray-400">
														{selectedNode.owner}
													</span>
												</p>
											)}
											<span className="text-gray-700">·</span>
											<Badge status={selectedNode.status} label={selectedNode.status} />
										</div>
									</div>
								</div>
							</div>
							<p className="mt-3 text-xs leading-relaxed text-gray-400">{selectedNode.description}</p>
						</div>

						{/* Tab Navigation */}
						<div className="flex gap-1 rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-1">
							{[
								{ id: "overview" as DetailTab, label: "Overview", icon: Info },
								{
									id: "features" as DetailTab,
									label: "Features",
									icon: Zap,
									count: selectedNode.features?.length,
								},
								{
									id: "connections" as DetailTab,
									label: "Connections",
									icon: Link2,
									count: selectedNode.connections?.length,
								},
								{
									id: "submodules" as DetailTab,
									label: "Sub-modules",
									icon: GitFork,
									count: selectedNode.children?.length,
								},
							].map((tab) => (
								<button
									key={tab.id}
									onClick={() => setDetailTab(tab.id)}
									className={cn(
										"flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium transition-all",
										detailTab === tab.id
											? "bg-violet-600/15 text-violet-300 shadow-sm"
											: "text-gray-500 hover:text-gray-300 hover:bg-[#0f1117]",
									)}>
									<tab.icon className="h-3 w-3" />
									<span>{tab.label}</span>
									{tab.count !== undefined && tab.count > 0 && (
										<span className="ml-0.5 rounded-full bg-gray-700/50 px-1.5 text-[9px] text-gray-400">
											{tab.count}
										</span>
									)}
								</button>
							))}
						</div>

						{/* Tab Content */}
						{detailTab === "overview" && (
							<div className="space-y-3">
								{/* Description */}
								<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
									<div className="mb-2 flex items-center gap-1.5">
										<Bookmark className="h-3 w-3 text-violet-400" />
										<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
											Description
										</span>
									</div>
									<p className="text-xs leading-relaxed text-gray-400">{selectedNode.description}</p>
								</div>

								{/* Owner & Status */}
								<div className="grid grid-cols-2 gap-3">
									<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
										<div className="mb-1.5 flex items-center gap-1.5">
											<User className="h-3 w-3 text-violet-400" />
											<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
												Owner
											</span>
										</div>
										<p className="text-xs font-mono text-gray-300">
											{selectedNode.owner || "Unassigned"}
										</p>
									</div>
									<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
										<div className="mb-1.5 flex items-center gap-1.5">
											<Hash className="h-3 w-3 text-violet-400" />
											<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
												Status
											</span>
										</div>
										<Badge status={selectedNode.status} label={selectedNode.status} />
									</div>
								</div>
							</div>
						)}

						{detailTab === "features" && selectedNode.features && selectedNode.features.length > 0 && (
							<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
								<div className="mb-3 flex items-center gap-1.5">
									<Zap className="h-3 w-3 text-violet-400" />
									<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
										Product Features
									</span>
									<span className="text-[10px] text-gray-700">({selectedNode.features.length})</span>
								</div>
								<div className="grid grid-cols-2 gap-2">
									{selectedNode.features.map((f) => (
										<div
											key={f}
											className="flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-3 py-2">
											<Zap className="h-3 w-3 shrink-0 text-violet-400" />
											<span className="text-[11px] text-gray-300">{f}</span>
										</div>
									))}
								</div>
							</div>
						)}

						{detailTab === "features" && (!selectedNode.features || selectedNode.features.length === 0) && (
							<div className="flex items-center justify-center rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-8">
								<p className="text-xs text-gray-600">No features defined for this module</p>
							</div>
						)}

						{detailTab === "connections" && (
							<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
								<ConnectionLines node={selectedNode} allNodes={ALL_NODES} />
							</div>
						)}

						{detailTab === "connections" &&
							(!selectedNode.connections || selectedNode.connections.length === 0) && (
								<div className="flex items-center justify-center rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-8">
									<p className="text-xs text-gray-600">No connections defined for this module</p>
								</div>
							)}

						{detailTab === "submodules" && selectedNode.children && selectedNode.children.length > 0 && (
							<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
								<div className="mb-3 flex items-center gap-1.5">
									<GitFork className="h-3 w-3 text-violet-400" />
									<span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
										Sub-modules
									</span>
									<span className="text-[10px] text-gray-700">({selectedNode.children.length})</span>
								</div>
								<div className="grid grid-cols-2 gap-2">
									{selectedNode.children.map((child) => (
										<button
											key={child.id}
											onClick={() => {
												setSelected(child.id)
												setDetailTab("overview")
											}}
											className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0a0e1a] to-[#080c14] p-3 text-left transition-all hover:border-violet-600/30 hover:bg-violet-600/5 hover:shadow-lg hover:shadow-violet-600/5 group">
											<div className="flex items-center gap-2">
												<span className="text-violet-400 group-hover:text-violet-300 transition-colors">
													{child.icon}
												</span>
												<span className="text-xs font-medium text-gray-300 group-hover:text-gray-200 transition-colors">
													{child.label}
												</span>
												<span
													className={cn(
														"ml-auto h-1.5 w-1.5 rounded-full",
														statusDot[child.status],
													)}
												/>
											</div>
											<p className="mt-1.5 text-[10px] leading-relaxed text-gray-500 group-hover:text-gray-400 transition-colors">
												{child.description}
											</p>
										</button>
									))}
								</div>
							</div>
						)}

						{detailTab === "submodules" &&
							(!selectedNode.children || selectedNode.children.length === 0) && (
								<div className="flex items-center justify-center rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-8">
									<p className="text-xs text-gray-600">No sub-modules for this module</p>
								</div>
							)}
					</div>
				) : (
					<div className="flex h-full items-center justify-center">
						<div className="text-center rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-12 max-w-md">
							<ListTree className="mx-auto h-12 w-12 text-gray-700" />
							<p className="mt-3 text-sm text-gray-600">Select a module from the tree</p>
							<p className="mt-1 text-[11px] text-gray-700">
								Click any node to explore its details, features, connections, and sub-modules
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
