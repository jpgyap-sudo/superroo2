"use client"

import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	Send,
	Bot,
	ShieldCheck,
	Terminal,
	Code,
	Bell,
	GitBranch,
	Webhook,
	Server,
	Activity,
	Check,
	X,
	Clock,
	Play,
	FileText,
	Smartphone,
	AlertTriangle,
	Rocket,
	Settings,
	Layers,
	Undo2,
	ExternalLink,
	Flag,
	GitCommit,
	GitPullRequest,
	GitMerge,
	RefreshCw,
	Bug,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

/** Full workflow state machine matching the kit's ARCHITECTURE.md */
type CodingTaskStatus =
	| "draft"
	| "planned"
	| "plan_approved"
	| "savepoint_created"
	| "coding"
	| "tests_running"
	| "review"
	| "review_approved"
	| "staging_deployed"
	| "production_pending_otp"
	| "production_deployed"
	| "verified"
	| "closed"
	| "queued"
	| "running"
	| "waiting_approval"
	| "approved"
	| "rejected"
	| "testing"
	| "failed"
	| "completed"

interface CodingTask {
	id: string
	instruction: string
	status: CodingTaskStatus
	branchName: string
	changedFiles: number
	linesAdded: number
	linesRemoved: number
	changedFileList: string[]
	agentType: string
	projectPath: string
	createdAt: string
	savepointHash?: string
	environment?: "staging" | "production"
}

interface CommandPermission {
	cmd: string
	desc: string
	mode: string
	enabled: boolean
}

interface AlertRule {
	label: string
	enabled: boolean
	icon: string
}

interface ActivityItem {
	icon: string
	title: string
	detail: string
	time: string
}

interface Savepoint {
	id: string
	taskId: string
	hash: string
	branch: string
	createdAt: string
	description: string
}

// ─── Workflow Pipeline Stages ────────────────────────────────────────────────

const WORKFLOW_STAGES = [
	{ key: "draft", label: "Draft", icon: FileText },
	{ key: "planned", label: "Planned", icon: GitBranch },
	{ key: "plan_approved", label: "Plan Approved", icon: Check },
	{ key: "savepoint_created", label: "Savepoint", icon: Flag },
	{ key: "coding", label: "Coding", icon: Code },
	{ key: "tests_running", label: "Testing", icon: Play },
	{ key: "review", label: "Review", icon: GitPullRequest },
	{ key: "review_approved", label: "Approved", icon: GitMerge },
	{ key: "staging_deployed", label: "Staging", icon: Layers },
	{ key: "production_deployed", label: "Production", icon: Rocket },
	{ key: "verified", label: "Verified", icon: Check },
	{ key: "closed", label: "Closed", icon: X },
]

/** Map old statuses to new workflow statuses for backward compatibility */
const LEGACY_STATUS_MAP: Record<string, CodingTaskStatus> = {
	queued: "draft",
	running: "coding",
	waiting_approval: "review",
	approved: "review_approved",
	testing: "tests_running",
	completed: "closed",
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_TASKS: CodingTask[] = [
	{
		id: "TG-221",
		instruction: "Fix Telegram auth session timeout bug",
		status: "review",
		branchName: "tg/tg-221",
		changedFiles: 3,
		linesAdded: 148,
		linesRemoved: 12,
		changedFileList: ["src/api/telegramBot.js", "src/api/auth.js", "src/api/session.js"],
		agentType: "debugger",
		projectPath: "/home/user/superroo2",
		createdAt: "2m ago",
	},
	{
		id: "TG-220",
		instruction: "Add /logs command with pagination",
		status: "tests_running",
		branchName: "tg/tg-220",
		changedFiles: 2,
		linesAdded: 89,
		linesRemoved: 0,
		changedFileList: ["src/api/telegramBot.js", "src/api/telegramNotifier.js"],
		agentType: "coder",
		projectPath: "/home/user/superroo2",
		createdAt: "15m ago",
	},
	{
		id: "TG-219",
		instruction: "Update deploy gate to require fresh OTP",
		status: "review_approved",
		branchName: "tg/tg-219",
		changedFiles: 1,
		linesAdded: 24,
		linesRemoved: 3,
		changedFileList: ["src/api/deployGate.js"],
		agentType: "coder",
		projectPath: "/home/user/superroo2",
		createdAt: "1h ago",
		savepointHash: "a1b2c3d4e5f6",
	},
	{
		id: "TG-218",
		instruction: "Add webhook health check endpoint",
		status: "production_deployed",
		branchName: "tg/tg-218",
		changedFiles: 4,
		linesAdded: 212,
		linesRemoved: 15,
		changedFileList: ["src/api/webhook.js", "src/api/health.js", "src/api/routes.js", "tests/webhook.test.js"],
		agentType: "coder",
		projectPath: "/home/user/superroo2",
		createdAt: "3h ago",
		savepointHash: "b2c3d4e5f6a7",
		environment: "production",
	},
	{
		id: "TG-217",
		instruction: "Implement QR provisioning for Google Authenticator",
		status: "coding",
		branchName: "tg/tg-217",
		changedFiles: 5,
		linesAdded: 367,
		linesRemoved: 0,
		changedFileList: ["src/api/otp.js", "src/api/qr.js", "src/api/auth.js", "tests/otp.test.js", "docs/otp.md"],
		agentType: "coder",
		projectPath: "/home/user/superroo2",
		createdAt: "5h ago",
		savepointHash: "c3d4e5f6a7b8",
	},
	{
		id: "TG-216",
		instruction: "Add rate limiting to API endpoints",
		status: "rejected",
		branchName: "tg/tg-216",
		changedFiles: 3,
		linesAdded: 67,
		linesRemoved: 0,
		changedFileList: ["src/api/rateLimit.js", "src/api/middleware.js", "tests/rateLimit.test.js"],
		agentType: "coder",
		projectPath: "/home/user/superroo2",
		createdAt: "6h ago",
	},
]

const COMMANDS: CommandPermission[] = [
	{ cmd: "/code", desc: "Create coding task from Telegram", mode: "OTP session", enabled: true },
	{ cmd: "/diff", desc: "Show changed files and patch summary", mode: "safe", enabled: true },
	{ cmd: "/test", desc: "Run test suite in sandbox", mode: "safe", enabled: true },
	{ cmd: "/approve", desc: "Approve pending code changes", mode: "OTP for risky", enabled: true },
	{ cmd: "/deploy", desc: "Deploy approved build", mode: "re-auth", enabled: false },
	{ cmd: "/logs", desc: "View recent agent logs", mode: "safe", enabled: true },
	{ cmd: "/session", desc: "Check active session status", mode: "safe", enabled: true },
	{ cmd: "/status", desc: "Get system status summary", mode: "safe", enabled: true },
	{ cmd: "/rollback", desc: "Rollback to savepoint", mode: "re-auth", enabled: true },
	{ cmd: "/miniide", desc: "Open Mini IDE in Telegram", mode: "safe", enabled: true },
]

const ACTIVITY: ActivityItem[] = [
	{ icon: "code", title: "TG-221 created", detail: "/code fix Telegram auth session timeout bug", time: "2m ago" },
	{ icon: "diff", title: "Diff ready", detail: "3 files changed · 148 lines added", time: "1m ago" },
	{ icon: "play", title: "Tests running", detail: "pnpm test -- telegram integration", time: "now" },
	{
		icon: "check",
		title: "TG-219 approved",
		detail: "Deploy gate OTP update approved via Telegram",
		time: "10m ago",
	},
	{ icon: "x", title: "TG-216 rejected", detail: "Branch contained debug console.log statements", time: "25m ago" },
	{ icon: "flag", title: "Savepoint created", detail: "TG-217 savepoint tagged for rollback", time: "30m ago" },
	{
		icon: "layers",
		title: "TG-218 deployed to staging",
		detail: "Health check passed · ready for production",
		time: "1h ago",
	},
	{
		icon: "rocket",
		title: "TG-218 deployed to production",
		detail: "OTP verified · deploy successful",
		time: "30m ago",
	},
]

const ALERT_RULES: AlertRule[] = [
	{ label: "Bug detected", enabled: true, icon: "alert" },
	{ label: "Deploy finished", enabled: true, icon: "rocket" },
	{ label: "Agent loop failed", enabled: true, icon: "x" },
	{ label: "Task completed", enabled: true, icon: "check" },
	{ label: "Idle session expired", enabled: true, icon: "clock" },
	{ label: "New approval request", enabled: true, icon: "shield" },
	{ label: "Savepoint created", enabled: true, icon: "flag" },
	{ label: "Rollback executed", enabled: true, icon: "undo" },
]

const MOCK_SAVEPOINTS: Savepoint[] = [
	{
		id: "sp-1",
		taskId: "TG-217",
		hash: "c3d4e5f6a7b8",
		branch: "tg/tg-217",
		createdAt: "5h ago",
		description: "Before QR provisioning implementation",
	},
	{
		id: "sp-2",
		taskId: "TG-219",
		hash: "a1b2c3d4e5f6",
		branch: "tg/tg-219",
		createdAt: "1h ago",
		description: "Before deploy gate OTP update",
	},
]

// ─── Sub-Components ──────────────────────────────────────────────────────────

function Pill({
	children,
	type = "neutral",
}: {
	children: React.ReactNode
	type?: "connected" | "warning" | "danger" | "neutral"
}) {
	const styles = {
		connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
		warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
		danger: "border-red-500/30 bg-red-500/10 text-red-300",
		neutral: "border-slate-500/30 bg-slate-500/10 text-slate-300",
	}
	return <span className={cn("rounded-full border px-2.5 py-1 text-xs", styles[type])}>{children}</span>
}

function Toggle({ enabled }: { enabled: boolean }) {
	return (
		<div
			className={cn(
				"flex h-6 w-11 items-center rounded-full p-1 transition-colors",
				enabled ? "bg-cyan-500" : "bg-slate-700",
			)}>
			<div
				className={cn(
					"h-4 w-4 rounded-full bg-white transition-transform",
					enabled ? "translate-x-5" : "translate-x-0",
				)}
			/>
		</div>
	)
}

function CardHeader({
	icon: Icon,
	title,
	subtitle,
	right,
}: {
	icon: React.ElementType
	title: string
	subtitle: string
	right?: React.ReactNode
}) {
	return (
		<div className="flex items-start justify-between gap-4 border-b border-[#1e2535] px-5 py-4">
			<div className="flex items-start gap-3">
				<div className="rounded-xl border border-[#1e2535] bg-[#0f1117] p-2 text-cyan-300">
					<Icon size={18} />
				</div>
				<div>
					<h3 className="text-sm font-semibold text-slate-100">{title}</h3>
					<p className="mt-1 text-xs text-slate-400">{subtitle}</p>
				</div>
			</div>
			{right}
		</div>
	)
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
	return (
		<div className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/70 p-4">
			<p className="text-xs text-slate-500">{label}</p>
			<p className={cn("mt-1 text-lg font-semibold", color)}>{value}</p>
		</div>
	)
}

function TaskStatusBadge({ status }: { status: CodingTaskStatus }) {
	const styles: Record<string, string> = {
		draft: "bg-slate-500/10 text-slate-300 border-slate-500/30",
		planned: "bg-blue-500/10 text-blue-300 border-blue-500/30",
		plan_approved: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
		savepoint_created: "bg-violet-500/10 text-violet-300 border-violet-500/30",
		coding: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
		tests_running: "bg-amber-500/10 text-amber-300 border-amber-500/30",
		review: "bg-orange-500/10 text-orange-300 border-orange-500/30",
		review_approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
		staging_deployed: "bg-teal-500/10 text-teal-300 border-teal-500/30",
		production_pending_otp: "bg-rose-500/10 text-rose-300 border-rose-500/30",
		production_deployed: "bg-green-500/10 text-green-300 border-green-500/30",
		verified: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
		closed: "bg-slate-500/10 text-slate-300 border-slate-500/30",
		queued: "bg-slate-500/10 text-slate-300 border-slate-500/30",
		running: "bg-blue-500/10 text-blue-300 border-blue-500/30",
		waiting_approval: "bg-amber-500/10 text-amber-300 border-amber-500/30",
		approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
		rejected: "bg-red-500/10 text-red-300 border-red-500/30",
		testing: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
		failed: "bg-red-500/10 text-red-300 border-red-500/30",
		completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
	}
	const labels: Record<string, string> = {
		draft: "Draft",
		planned: "Planned",
		plan_approved: "Plan Approved",
		savepoint_created: "Savepoint",
		coding: "Coding",
		tests_running: "Testing",
		review: "Review",
		review_approved: "Approved",
		staging_deployed: "Staging",
		production_pending_otp: "OTP Needed",
		production_deployed: "Production",
		verified: "Verified",
		closed: "Closed",
		queued: "Queued",
		running: "Running",
		waiting_approval: "Waiting Approval",
		approved: "Approved",
		rejected: "Rejected",
		testing: "Testing",
		failed: "Failed",
		completed: "Completed",
	}
	return (
		<span
			className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-medium", styles[status] || styles.draft)}>
			{labels[status] || status}
		</span>
	)
}

// ─── Workflow Pipeline ────────────────────────────────────────────────────────

function WorkflowPipeline({ status }: { status: CodingTaskStatus }) {
	const currentIdx = WORKFLOW_STAGES.findIndex((s) => s.key === status)
	return (
		<div className="overflow-x-auto">
			<div className="flex items-center gap-1 min-w-max">
				{WORKFLOW_STAGES.map((stage, idx) => {
					const Icon = stage.icon
					const isCompleted = idx < currentIdx
					const isCurrent = idx === currentIdx
					const isPending = idx > currentIdx
					return (
						<div key={stage.key} className="flex items-center gap-1">
							<div
								className={cn(
									"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors",
									isCompleted && "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
									isCurrent &&
										"bg-cyan-500/15 text-cyan-200 border border-cyan-500/40 ring-1 ring-cyan-500/30",
									isPending && "bg-slate-800/50 text-slate-500 border border-slate-700/50",
								)}>
								<Icon size={12} />
								<span>{stage.label}</span>
							</div>
							{idx < WORKFLOW_STAGES.length - 1 && (
								<div
									className={cn(
										"h-px w-3",
										idx < currentIdx ? "bg-emerald-500/40" : "bg-slate-700/50",
									)}
								/>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

const API = "/api"

async function tgFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init?.headers as Record<string, string>),
		},
	})
	const json = await res.json()
	return json
}

function mapApiTask(t: any): CodingTask {
	const status = (LEGACY_STATUS_MAP[t.status] ?? t.status ?? "draft") as CodingTaskStatus
	return {
		id: t.id,
		instruction: t.instruction || t.title || "",
		status,
		branchName: t.branchName || `tg/${t.id?.toLowerCase()}`,
		changedFiles: t.changedFiles || 0,
		linesAdded: t.linesAdded || 0,
		linesRemoved: t.linesRemoved || 0,
		changedFileList: t.changedFileList || [],
		agentType: t.agent || t.agentId || "coder",
		projectPath: t.projectPath || "/opt/superroo2",
		createdAt: t.createdAgo || t.createdAt || "recently",
		savepointHash: t.savepointHash,
		environment: t.environment,
	}
}

function mapApiSavepoint(s: any): Savepoint {
	return {
		id: s.id,
		taskId: s.taskId || s.id,
		hash: s.hash || s.id,
		branch: s.branch || "",
		createdAt: s.time || s.createdAt || "recently",
		description: s.description || "",
	}
}

function mapApiLog(l: any, idx: number): ActivityItem {
	const msg: string = l.message || l.title || ""
	const iconMap: Record<string, string> = {
		deploy: "rocket",
		test: "play",
		approve: "check",
		reject: "x",
		rollback: "undo",
		save: "flag",
		error: "x",
		info: "code",
	}
	const icon = Object.entries(iconMap).find(([k]) => msg.toLowerCase().includes(k))?.[1] || "code"
	return {
		icon,
		title: l.title || msg.slice(0, 50),
		detail: l.message || l.detail || "",
		time: l.timestamp || l.time || "",
	}
}

export function TelegramView() {
	const [message, setMessage] = useState("/code fix the Telegram auth session timeout bug")
	const [selectedTask, setSelectedTask] = useState<CodingTask | null>(null)
	const [time, setTime] = useState("")
	const [tasks, setTasks] = useState<CodingTask[]>(MOCK_TASKS)
	const [savepoints, setSavepoints] = useState<Savepoint[]>(MOCK_SAVEPOINTS)
	const [activity, setActivity] = useState<ActivityItem[]>(ACTIVITY)
	const [alertRules, setAlertRules] = useState<AlertRule[]>(ALERT_RULES)
	const [webhookStatus, setWebhookStatus] = useState<"checking" | "active" | "inactive">("checking")
	const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

	const fetchData = useCallback(async () => {
		try {
			const [tasksRes, savepointsRes, logsRes, webhookRes, rulesRes] = await Promise.allSettled([
				tgFetch<{ success: boolean; tasks: any[] }>("/telegram/tasks"),
				tgFetch<{ success: boolean; savepoints: any[] }>("/telegram/savepoints"),
				tgFetch<{ success: boolean; logs: any[] }>("/telegram/logs"),
				tgFetch<{ success: boolean; info?: { url?: string } }>("/telegram/webhook-info"),
				tgFetch<{ success: boolean; rules: AlertRule[] }>("/telegram/alert-rules"),
			])

			if (tasksRes.status === "fulfilled" && tasksRes.value.success && tasksRes.value.tasks?.length) {
				setTasks(tasksRes.value.tasks.map(mapApiTask))
			}
			if (
				savepointsRes.status === "fulfilled" &&
				savepointsRes.value.success &&
				savepointsRes.value.savepoints?.length
			) {
				setSavepoints(savepointsRes.value.savepoints.map(mapApiSavepoint))
			}
			if (logsRes.status === "fulfilled" && logsRes.value.success && logsRes.value.logs?.length) {
				setActivity(logsRes.value.logs.map(mapApiLog))
			}
			if (webhookRes.status === "fulfilled" && webhookRes.value.success) {
				setWebhookStatus(webhookRes.value.info?.url ? "active" : "inactive")
			} else {
				setWebhookStatus("inactive")
			}
			if (rulesRes.status === "fulfilled" && rulesRes.value.success && rulesRes.value.rules?.length) {
				setAlertRules(rulesRes.value.rules)
			}
		} catch {
			// keep current state on network error
		}
	}, [])

	useEffect(() => {
		void fetchData()
		const iv = setInterval(fetchData, 15_000)
		return () => clearInterval(iv)
	}, [fetchData])

	const handleApprove = async (taskId: string) => {
		setActionLoading((p) => ({ ...p, [`approve-${taskId}`]: true }))
		try {
			await tgFetch(`/telegram/tasks/${taskId}/approve`, { method: "POST" })
			setTasks((prev) =>
				prev.map((t) => (t.id === taskId ? { ...t, status: "review_approved" as CodingTaskStatus } : t)),
			)
		} finally {
			setActionLoading((p) => ({ ...p, [`approve-${taskId}`]: false }))
		}
	}

	const handleReject = async (taskId: string) => {
		setActionLoading((p) => ({ ...p, [`reject-${taskId}`]: true }))
		try {
			await tgFetch(`/telegram/tasks/${taskId}/reject`, { method: "POST" })
			setTasks((prev) =>
				prev.map((t) => (t.id === taskId ? { ...t, status: "rejected" as CodingTaskStatus } : t)),
			)
		} finally {
			setActionLoading((p) => ({ ...p, [`reject-${taskId}`]: false }))
		}
	}

	const handleRollback = async (savepointId: string) => {
		setActionLoading((p) => ({ ...p, [`rollback-${savepointId}`]: true }))
		try {
			await tgFetch("/telegram/rollback", { method: "POST", body: JSON.stringify({ savepointId }) })
		} finally {
			setActionLoading((p) => ({ ...p, [`rollback-${savepointId}`]: false }))
			void fetchData()
		}
	}

	const handleRunTests = async () => {
		await tgFetch("/telegram/tasks/run-tests", { method: "POST" })
	}

	const handleSendTest = async () => {
		await tgFetch("/telegram/test", { method: "POST", body: JSON.stringify({ message }) })
	}

	const handleAlertToggle = async (label: string, enabled: boolean) => {
		setAlertRules((prev) => prev.map((r) => (r.label === label ? { ...r, enabled } : r)))
		await tgFetch("/telegram/alert-rules", { method: "POST", body: JSON.stringify({ label, enabled }) })
	}

	useEffect(() => {
		const tick = () => setTime(new Date().toLocaleTimeString())
		tick()
		const iv = setInterval(tick, 1000)
		return () => clearInterval(iv)
	}, [])

	return (
		<div className="space-y-6">
			{/* Hero Header */}
			<div className="overflow-hidden rounded-3xl border border-[#1e2535] bg-gradient-to-br from-[#0f1117] via-[#0f1117] to-cyan-950/30 p-6 shadow-2xl shadow-black/30">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
							<Bot size={14} /> Telegram Mobile Coding Console
						</div>
						<h1 className="text-3xl font-bold tracking-tight text-white">Telegram Integration</h1>
						<p className="mt-2 max-w-2xl text-sm text-slate-400">
							Control SuperRoo from Telegram: create coding tasks, review diffs, approve changes, run
							tests, and receive production alerts with OTP-protected sessions.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<StatusCard
							label="Bot"
							value={
								webhookStatus === "active" ? "Online" : webhookStatus === "inactive" ? "Offline" : "…"
							}
							color={webhookStatus === "active" ? "text-emerald-300" : "text-amber-300"}
						/>
						<StatusCard label="Session" value="30 min" color="text-cyan-300" />
						<StatusCard label="Queue" value={`${tasks.length} tasks`} color="text-white" />
						<StatusCard
							label="Approvals"
							value={`${tasks.filter((t) => t.status === "waiting_approval" || t.status === "review").length} pending`}
							color="text-amber-300"
						/>
					</div>
				</div>
			</div>

			{/* Product Features Description */}
			<div className="overflow-hidden rounded-3xl border border-[#1e2535] bg-gradient-to-br from-[#0f1117] via-[#0f1117] to-indigo-950/30 p-6 shadow-2xl shadow-black/30">
				<div className="mb-6 flex items-center justify-between">
					<div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
						<Layers size={14} /> Product Features
					</div>
					<span className="text-xs text-slate-500">8 features</span>
				</div>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-cyan-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-cyan-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10">
								<Bot size={14} />
							</div>
							AI Assistant
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Natural language chat with OpenClaw AI. Ask questions, get advice, analyze code, or research
							architecture. No need for slash commands — just type naturally.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-emerald-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-emerald-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
								<Code size={14} />
							</div>
							Coding Tasks
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Create coding tasks with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/code</code>. Review diffs with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/diff</code>, approve with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/approve</code>, and deploy with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/deploy</code> — all from your
							phone.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-amber-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-amber-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
								<ShieldCheck size={14} />
							</div>
							Auth & Security
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Login via email OTP with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/login</code>. Set up Google
							Authenticator with <code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/otp</code>.
							OTP-protected deploy gate for production. Session auto-expiry after 30 min.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-purple-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-purple-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10">
								<Send size={14} />
							</div>
							Group Chat Integration
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Bind a workspace to any group with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/specify</code>. List projects
							with <code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/projects</code>. Every
							message is auto-processed — no need to tag the bot.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-rose-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-rose-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10">
								<Bug size={14} />
							</div>
							Debug & Diagnostics
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Create structured debug plans with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/debug</code>. Read PM2 and
							Docker logs with <code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/logs</code>.
							Run tests with <code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/tests</code> and
							restart workers with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/restart</code>.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-sky-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-sky-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10">
								<Smartphone size={14} />
							</div>
							Mini IDE
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Open a full code editor inside Telegram with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/miniide</code>. Browse files,
							edit code, upload attachments, and use the AI assistant — all from your mobile.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-orange-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-orange-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10">
								<Bell size={14} />
							</div>
							Alerts & Notifications
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							Receive real-time production alerts, deploy status updates, test results, and task
							notifications pushed directly to your Telegram group.
						</p>
					</div>
					<div className="group rounded-2xl border border-[#1e2535] bg-[#0f1117]/40 p-4 transition-all duration-200 hover:border-teal-500/30 hover:bg-[#0f1117]/80 hover:shadow-lg hover:shadow-teal-500/5">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-200">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10">
								<GitBranch size={14} />
							</div>
							Full CI/CD Pipeline
						</div>
						<p className="text-xs leading-relaxed text-slate-400">
							End-to-end workflow: plan → code → test → approve → deploy staging → OTP-verify → deploy
							production. Rollback to savepoints with{" "}
							<code className="rounded bg-cyan-500/10 px-1 text-cyan-300">/rollback</code>.
						</p>
					</div>
				</div>
			</div>

			{/* Main Grid */}
			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				{/* Left + Center Columns */}
				<div className="space-y-6 xl:col-span-2">
					{/* Coding Console */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Send}
							title="Telegram Coding Console"
							subtitle="Send a coding command exactly like you would from your phone."
							right={<Pill type="connected">OTP session active</Pill>}
						/>
						<div className="space-y-4 p-5">
							<div className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/70 p-4">
								<div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
									<Smartphone size={14} /> Preview message to SuperRoo Bot
								</div>
								<div className="flex gap-3">
									<input
										value={message}
										onChange={(e) => setMessage(e.target.value)}
										className="flex-1 rounded-xl border border-[#1e2535] bg-[#070b14] px-4 py-3 text-sm text-slate-100 outline-none ring-cyan-500/20 placeholder:text-slate-600 focus:ring-4"
									/>
									<button
										onClick={handleSendTest}
										className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
										Send
									</button>
								</div>
							</div>
							<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
								{[
									{
										icon: FileText,
										title: "View Diff",
										desc: "Show changed files before approval.",
										onClick: () => {
											const t = tasks.find(
												(t) => t.status === "review" || t.status === "review_approved",
											)
											if (t) setSelectedTask(t)
										},
									},
									{
										icon: Play,
										title: "Run Tests",
										desc: "Run sandbox test suite safely.",
										onClick: handleRunTests,
									},
									{
										icon: Rocket,
										title: "Deploy Gate",
										desc: "Requires fresh OTP confirmation.",
										onClick: () => {},
									},
								].map(({ icon: Icon, title, desc, onClick }) => (
									<button
										key={title}
										onClick={onClick}
										className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/60 p-4 text-left hover:border-cyan-500/40">
										<Icon className="mb-3 text-cyan-300" size={20} />
										<p className="font-medium text-slate-100">{title}</p>
										<p className="mt-1 text-xs text-slate-500">{desc}</p>
									</button>
								))}
							</div>
						</div>
					</Card>

					{/* Workflow Pipeline */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={GitBranch}
							title="Workflow Pipeline"
							subtitle="Task lifecycle: from draft to production deployment."
							right={<Pill type="connected">{WORKFLOW_STAGES.length} stages</Pill>}
						/>
						<div className="p-5">
							<WorkflowPipeline status={selectedTask?.status || "draft"} />
							{selectedTask && (
								<div className="mt-4 grid grid-cols-2 gap-3 text-xs">
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
										<span className="text-slate-500">Agent</span>
										<p className="font-semibold text-slate-100 capitalize">
											{selectedTask.agentType}
										</p>
									</div>
									<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
										<span className="text-slate-500">Project</span>
										<p className="font-semibold text-slate-100 truncate">
											{selectedTask.projectPath}
										</p>
									</div>
									{selectedTask.savepointHash && (
										<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
											<span className="text-slate-500">Savepoint</span>
											<p className="font-mono font-semibold text-violet-300">
												{selectedTask.savepointHash.slice(0, 8)}
											</p>
										</div>
									)}
									{selectedTask.environment && (
										<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
											<span className="text-slate-500">Environment</span>
											<p className="font-semibold text-teal-300 capitalize">
												{selectedTask.environment}
											</p>
										</div>
									)}
								</div>
							)}
						</div>
					</Card>

					{/* Command Permissions */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Terminal}
							title="Command Permissions"
							subtitle="Choose which Telegram commands are allowed and which require re-authentication."
							right={
								<button className="rounded-lg border border-[#1e2535] px-3 py-1.5 text-xs text-slate-300">
									Edit rules
								</button>
							}
						/>
						<div className="p-5">
							<div className="overflow-hidden rounded-2xl border border-[#1e2535]">
								<table className="w-full text-left text-sm">
									<thead className="bg-[#0f1117]/80 text-[10px] uppercase tracking-wider text-slate-500">
										<tr>
											<th className="px-4 py-3">Command</th>
											<th className="px-4 py-3">Purpose</th>
											<th className="px-4 py-3">Security</th>
											<th className="px-4 py-3">Enabled</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-[#1e2535] bg-[#0a0e1a]/40">
										{COMMANDS.map((item) => (
											<tr key={item.cmd}>
												<td className="px-4 py-3 font-mono text-cyan-300">{item.cmd}</td>
												<td className="px-4 py-3 text-slate-300">{item.desc}</td>
												<td className="px-4 py-3">
													<Pill
														type={
															item.mode.includes("re-auth") || item.mode.includes("risky")
																? "warning"
																: "connected"
														}>
														{item.mode}
													</Pill>
												</td>
												<td className="px-4 py-3">
													<Toggle enabled={item.enabled} />
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</Card>

					{/* Coding Tasks Queue */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Code}
							title="Coding Tasks Queue"
							subtitle="Telegram-generated coding tasks with sandbox branches."
							right={
								<Pill type="neutral">
									{
										tasks.filter(
											(t) =>
												t.status !== "completed" &&
												t.status !== "rejected" &&
												t.status !== "closed",
										).length
									}{" "}
									active
								</Pill>
							}
						/>
						<div className="p-5">
							<div className="space-y-3">
								{tasks.map((task) => (
									<button
										key={task.id}
										onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
										className={cn(
											"w-full rounded-2xl border bg-[#0f1117]/50 p-4 text-left transition-colors",
											selectedTask?.id === task.id
												? "border-cyan-500/40"
												: "border-[#1e2535] hover:border-slate-600/50",
										)}>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-3">
												<GitBranch size={16} className="text-cyan-300" />
												<div>
													<p className="text-sm font-medium text-slate-100">
														{task.id} · {task.instruction.slice(0, 50)}
														{task.instruction.length > 50 ? "..." : ""}
													</p>
													<p className="mt-0.5 font-mono text-[10px] text-cyan-300/70">
														branch: {task.branchName}
													</p>
												</div>
											</div>
											<div className="flex items-center gap-3">
												<TaskStatusBadge status={task.status} />
												<span className="text-[10px] text-slate-600">{task.createdAt}</span>
											</div>
										</div>
										{selectedTask?.id === task.id && (
											<div className="mt-3 border-t border-[#1e2535] pt-3">
												<div className="grid grid-cols-3 gap-3 text-xs">
													<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
														<span className="text-slate-500">Files changed</span>
														<p className="font-semibold text-slate-100">
															{task.changedFiles}
														</p>
													</div>
													<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
														<span className="text-slate-500">Lines added</span>
														<p className="font-semibold text-emerald-300">
															+{task.linesAdded}
														</p>
													</div>
													<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-2">
														<span className="text-slate-500">Created</span>
														<p className="font-semibold text-slate-100">{task.createdAt}</p>
													</div>
												</div>
												{task.changedFileList && task.changedFileList.length > 0 && (
													<div className="mt-3">
														<p className="mb-1.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
															Changed Files
														</p>
														<div className="flex flex-wrap gap-1.5">
															{task.changedFileList.map((f) => (
																<span
																	key={f}
																	className="rounded-md bg-[#0a0e1a] border border-[#1e2535] px-2 py-0.5 font-mono text-[10px] text-cyan-300/70">
																	{f.split("/").pop()}
																</span>
															))}
														</div>
													</div>
												)}
												{(task.status === "waiting_approval" || task.status === "review") && (
													<div className="mt-3 grid grid-cols-2 gap-3">
														<button
															onClick={(e) => {
																e.stopPropagation()
																void handleApprove(task.id)
															}}
															disabled={actionLoading[`approve-${task.id}`]}
															className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
															{actionLoading[`approve-${task.id}`] ? "…" : "Approve"}
														</button>
														<button
															onClick={(e) => {
																e.stopPropagation()
																void handleReject(task.id)
															}}
															disabled={actionLoading[`reject-${task.id}`]}
															className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50">
															{actionLoading[`reject-${task.id}`] ? "…" : "Reject"}
														</button>
													</div>
												)}
												{task.status === "review_approved" && (
													<div className="mt-3 grid grid-cols-2 gap-3">
														<button className="rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400">
															Deploy to Staging
														</button>
														<button className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/20">
															Deploy Production
														</button>
													</div>
												)}
												{task.savepointHash && (
													<div className="mt-3">
														<button
															onClick={(e) => {
																e.stopPropagation()
																void handleRollback(task.savepointHash!)
															}}
															disabled={actionLoading[`rollback-${task.savepointHash}`]}
															className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-50">
															<Undo2 size={14} className="mr-1 inline" />
															Rollback to Savepoint
														</button>
													</div>
												)}
											</div>
										)}
									</button>
								))}
							</div>
						</div>
					</Card>

					{/* Live Activity */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Activity}
							title="Live Telegram Activity"
							subtitle="Recent commands, agent actions, approvals, and test activity."
							right={<Pill type="neutral">Live</Pill>}
						/>
						<div className="space-y-3 p-5">
							{activity.map((item) => {
								const iconMap: Record<string, React.ElementType> = {
									code: Code,
									diff: FileText,
									play: Play,
									check: Check,
									x: X,
									flag: Flag,
									layers: Layers,
									rocket: Rocket,
								}
								const Icon = iconMap[item.icon] || Activity
								return (
									<div
										key={item.title}
										className="flex items-center justify-between rounded-2xl border border-[#1e2535] bg-[#0f1117]/50 p-4">
										<div className="flex items-center gap-3">
											<div className="rounded-xl bg-[#0a0e1a] p-2 text-cyan-300">
												<Icon size={18} />
											</div>
											<div>
												<p className="text-sm font-medium text-slate-100">{item.title}</p>
												<p className="text-xs text-slate-500">{item.detail}</p>
											</div>
										</div>
										<span className="text-xs text-slate-500">{item.time}</span>
									</div>
								)
							})}
						</div>
					</Card>
				</div>

				{/* Right Column */}
				<div className="space-y-6">
					{/* Savepoints */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Flag}
							title="Savepoints"
							subtitle="Git-based rollback points created before autonomous coding."
							right={<Pill type="connected">{savepoints.length} saved</Pill>}
						/>
						<div className="space-y-3 p-5">
							{savepoints.map((sp) => (
								<div key={sp.id} className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/60 p-4">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-sm font-medium text-slate-100">{sp.taskId}</p>
											<p className="mt-0.5 text-xs text-slate-500">{sp.description}</p>
										</div>
										<button
											onClick={() => void handleRollback(sp.id)}
											disabled={actionLoading[`rollback-${sp.id}`]}
											className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50">
											<Undo2 size={12} className="inline mr-1" />
											Rollback
										</button>
									</div>
									<div className="mt-2 flex items-center gap-3 text-[10px] text-slate-600">
										<span className="font-mono">{sp.hash.slice(0, 8)}</span>
										<span>{sp.branch}</span>
										<span>{sp.createdAt}</span>
									</div>
								</div>
							))}
						</div>
					</Card>

					{/* OTP Security */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={ShieldCheck}
							title="OTP Security"
							subtitle="Google Authenticator session control."
							right={<Pill type="connected">Protected</Pill>}
						/>
						<div className="space-y-4 p-5">
							<div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
								<div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
									<Check size={18} /> Google Authenticator linked
								</div>
								<p className="mt-2 text-xs text-emerald-100/70">
									OTP required on first command. Session refreshes with every valid action.
								</p>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<p className="text-xs text-slate-500">Idle timeout</p>
									<p className="mt-1 font-semibold text-white">30 minutes</p>
								</div>
								<div className="rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<p className="text-xs text-slate-500">Deploy auth</p>
									<p className="mt-1 font-semibold text-amber-300">Always</p>
								</div>
							</div>
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-sm text-slate-300">Auto-delete OTP messages</span>
									<Toggle enabled />
								</div>
								<div className="flex items-center justify-between">
									<span className="text-sm text-slate-300">Whitelist admin user only</span>
									<Toggle enabled />
								</div>
								<div className="flex items-center justify-between">
									<span className="text-sm text-slate-300">Require approval before commit</span>
									<Toggle enabled />
								</div>
							</div>
						</div>
					</Card>

					{/* Bot Connection */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={Webhook}
							title="Bot Connection"
							subtitle="Webhook and group routing status."
						/>
						<div className="space-y-3 p-5">
							{[
								{ icon: Bot, label: "Bot token", status: "Configured", type: "connected" as const },
								{
									icon: Webhook,
									label: "Webhook",
									status:
										webhookStatus === "active"
											? "Active"
											: webhookStatus === "inactive"
												? "Inactive"
												: "Checking…",
									type: (webhookStatus === "active" ? "connected" : "warning") as
										| "connected"
										| "warning",
								},
								{ icon: Server, label: "VPS worker", status: "Online", type: "connected" as const },
							].map(({ icon: Icon, label, status, type }) => (
								<div
									key={label}
									className="flex items-center justify-between rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="flex items-center gap-2 text-sm text-slate-300">
										<Icon size={16} /> {label}
									</div>
									<Pill type={type}>{status}</Pill>
								</div>
							))}
							<button
								onClick={() => void handleSendTest()}
								className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20">
								Send Test Message
							</button>
						</div>
					</Card>

					{/* Alert Rules */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader icon={Bell} title="Alert Rules" subtitle="Events pushed to your Telegram group." />
						<div className="space-y-3 p-5">
							{alertRules.map((rule) => {
								const iconMap: Record<string, React.ElementType> = {
									alert: AlertTriangle,
									rocket: Rocket,
									x: X,
									check: Check,
									clock: Clock,
									shield: ShieldCheck,
									flag: Flag,
									undo: Undo2,
								}
								const Icon = iconMap[rule.icon] || Bell
								return (
									<button
										key={rule.label}
										onClick={() => void handleAlertToggle(rule.label, !rule.enabled)}
										className="flex w-full items-center justify-between rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3 text-left">
										<div className="flex items-center gap-2 text-sm text-slate-300">
											<Icon size={16} /> {rule.label}
										</div>
										<Pill type={rule.enabled ? "connected" : "neutral"}>
											{rule.enabled ? "On" : "Off"}
										</Pill>
									</button>
								)
							})}
						</div>
					</Card>

					{/* Current Coding Task */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader
							icon={GitBranch}
							title="Current Coding Task"
							subtitle="Sandbox branch generated by Telegram."
						/>
						<div className="space-y-4 p-5">
							<div className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/60 p-4">
								<p className="text-xs text-slate-500">Task</p>
								<p className="mt-1 font-semibold text-slate-100">TG-221 · Telegram Auth Timeout</p>
								<p className="mt-2 font-mono text-xs text-cyan-300">branch: tg/tg-221</p>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<button className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
									Approve
								</button>
								<button className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/20">
									Reject
								</button>
							</div>
						</div>
					</Card>
				</div>
			</div>
		</div>
	)
}
