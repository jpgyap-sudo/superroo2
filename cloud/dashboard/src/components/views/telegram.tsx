"use client"

import { useState, useEffect } from "react"
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
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

type CodingTaskStatus =
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
	createdAt: string
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

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_TASKS: CodingTask[] = [
	{
		id: "TG-221",
		instruction: "Fix Telegram auth session timeout bug",
		status: "waiting_approval",
		branchName: "tg/tg-221",
		changedFiles: 3,
		linesAdded: 148,
		createdAt: "2m ago",
	},
	{
		id: "TG-220",
		instruction: "Add /logs command with pagination",
		status: "testing",
		branchName: "tg/tg-220",
		changedFiles: 2,
		linesAdded: 89,
		createdAt: "15m ago",
	},
	{
		id: "TG-219",
		instruction: "Update deploy gate to require fresh OTP",
		status: "approved",
		branchName: "tg/tg-219",
		changedFiles: 1,
		linesAdded: 24,
		createdAt: "1h ago",
	},
	{
		id: "TG-218",
		instruction: "Add webhook health check endpoint",
		status: "completed",
		branchName: "tg/tg-218",
		changedFiles: 4,
		linesAdded: 212,
		createdAt: "3h ago",
	},
	{
		id: "TG-217",
		instruction: "Implement QR provisioning for Google Authenticator",
		status: "running",
		branchName: "tg/tg-217",
		changedFiles: 5,
		linesAdded: 367,
		createdAt: "5h ago",
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
]

const ALERT_RULES: AlertRule[] = [
	{ label: "Bug detected", enabled: true, icon: "alert" },
	{ label: "Deploy finished", enabled: true, icon: "rocket" },
	{ label: "Agent loop failed", enabled: true, icon: "x" },
	{ label: "Task completed", enabled: true, icon: "check" },
	{ label: "Idle session expired", enabled: true, icon: "clock" },
	{ label: "New approval request", enabled: true, icon: "shield" },
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
	const styles: Record<CodingTaskStatus, string> = {
		queued: "bg-slate-500/10 text-slate-300 border-slate-500/30",
		running: "bg-blue-500/10 text-blue-300 border-blue-500/30",
		waiting_approval: "bg-amber-500/10 text-amber-300 border-amber-500/30",
		approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
		rejected: "bg-red-500/10 text-red-300 border-red-500/30",
		testing: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
		failed: "bg-red-500/10 text-red-300 border-red-500/30",
		completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
	}
	const labels: Record<CodingTaskStatus, string> = {
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
		<span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-medium", styles[status])}>
			{labels[status]}
		</span>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function TelegramView() {
	const [message, setMessage] = useState("/code fix the Telegram auth session timeout bug")
	const [selectedTask, setSelectedTask] = useState<CodingTask | null>(null)
	const [time, setTime] = useState("")

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
						<StatusCard label="Bot" value="Online" color="text-emerald-300" />
						<StatusCard label="Session" value="30 min" color="text-cyan-300" />
						<StatusCard label="Queue" value={`${MOCK_TASKS.length} tasks`} color="text-white" />
						<StatusCard
							label="Approvals"
							value={`${MOCK_TASKS.filter((t) => t.status === "waiting_approval").length} pending`}
							color="text-amber-300"
						/>
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
									<button className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
										Send
									</button>
								</div>
							</div>
							<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
								{[
									{ icon: FileText, title: "View Diff", desc: "Show changed files before approval." },
									{ icon: Play, title: "Run Tests", desc: "Run sandbox test suite safely." },
									{ icon: Rocket, title: "Deploy Gate", desc: "Requires fresh OTP confirmation." },
								].map(({ icon: Icon, title, desc }) => (
									<button
										key={title}
										className="rounded-2xl border border-[#1e2535] bg-[#0f1117]/60 p-4 text-left hover:border-cyan-500/40">
										<Icon className="mb-3 text-cyan-300" size={20} />
										<p className="font-medium text-slate-100">{title}</p>
										<p className="mt-1 text-xs text-slate-500">{desc}</p>
									</button>
								))}
							</div>
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
										MOCK_TASKS.filter((t) => t.status !== "completed" && t.status !== "rejected")
											.length
									}{" "}
									active
								</Pill>
							}
						/>
						<div className="p-5">
							<div className="space-y-3">
								{MOCK_TASKS.map((task) => (
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
												{task.status === "waiting_approval" && (
													<div className="mt-3 grid grid-cols-2 gap-3">
														<button className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
															Approve
														</button>
														<button className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/20">
															Reject
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
							{ACTIVITY.map((item) => {
								const iconMap: Record<string, React.ElementType> = {
									code: Code,
									diff: FileText,
									play: Play,
									check: Check,
									x: X,
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
								{ icon: Bot, label: "Bot token", status: "Configured" },
								{ icon: Webhook, label: "Webhook", status: "Active" },
								{ icon: Server, label: "VPS worker", status: "Online" },
							].map(({ icon: Icon, label, status }) => (
								<div
									key={label}
									className="flex items-center justify-between rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3">
									<div className="flex items-center gap-2 text-sm text-slate-300">
										<Icon size={16} /> {label}
									</div>
									<Pill type="connected">{status}</Pill>
								</div>
							))}
							<button className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20">
								Send Test Message
							</button>
						</div>
					</Card>

					{/* Alert Rules */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<CardHeader icon={Bell} title="Alert Rules" subtitle="Events pushed to your Telegram group." />
						<div className="space-y-3 p-5">
							{ALERT_RULES.map((rule) => {
								const iconMap: Record<string, React.ElementType> = {
									alert: AlertTriangle,
									rocket: Rocket,
									x: X,
									check: Check,
									clock: Clock,
									shield: ShieldCheck,
								}
								const Icon = iconMap[rule.icon] || Bell
								return (
									<div
										key={rule.label}
										className="flex items-center justify-between rounded-xl border border-[#1e2535] bg-[#0f1117]/60 p-3">
										<div className="flex items-center gap-2 text-sm text-slate-300">
											<Icon size={16} /> {rule.label}
										</div>
										<Toggle enabled={rule.enabled} />
									</div>
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
