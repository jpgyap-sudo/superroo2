"use client"

import { useEffect, useMemo, useState } from "react"
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	Code2,
	GitPullRequest,
	Play,
	Send,
	ShieldCheck,
	Sparkles,
	TestTube2,
	Wand2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, StatCard } from "@/components/ui/card"

type AgentConfig = {
	id: string
	name: string
	category: string
	description: string
	enabled: boolean
	runtime: {
		sandbox: boolean
		timeoutSeconds: number
		maxRetries: number
	}
	safety: {
		requiresApproval: boolean
		canEditFiles: boolean
		canPublish: boolean
		canDeploy: boolean
	}
}

type Job = {
	id: string
	name: string
	status: string
	data?: {
		agentId?: string
		task?: string
	}
	failedReason?: string
	timestamp?: number
}

type QueueStats = {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
	total: number
}

type Workflow = {
	id: string
	title: string
	agentId: string
	icon: LucideIcon
	task: string
	outcome: string
}

const WORKFLOWS: Workflow[] = [
	{
		id: "debug",
		title: "Debug and propose fix",
		agentId: "superroo-debugger-agent",
		icon: Code2,
		task: "Investigate the latest failed job, identify the root cause, and propose the smallest safe fix.",
		outcome: "Sandbox diagnosis plus patch plan",
	},
	{
		id: "test",
		title: "Run release test gate",
		agentId: "superroo-tester-agent",
		icon: TestTube2,
		task: "Run focused tests, type checks, build checks, and report regressions with file-level evidence.",
		outcome: "Pass/fail gate with regressions",
	},
	{
		id: "pr",
		title: "Prepare GitHub PR",
		agentId: "github-pr-agent",
		icon: GitPullRequest,
		task: "Create a sandbox-approved branch, prepare the commit, and draft the pull request summary.",
		outcome: "Review-ready PR package",
	},
	{
		id: "skill",
		title: "Generate a new skill",
		agentId: "skill-generator-agent",
		icon: Wand2,
		task: "Analyze recent failures and user corrections, then generate a reusable SuperRoo skill upgrade.",
		outcome: "Reusable agent capability",
	},
	{
		id: "homeu-render",
		title: "Create HomeU render prompt",
		agentId: "homeu-render-agent",
		icon: Sparkles,
		task: "Create a luxury HomeU render prompt using exact product references and brand rules.",
		outcome: "Image-generation ready prompt",
	},
	{
		id: "homeu-sales",
		title: "Build HomeU pitchboard",
		agentId: "homeu-pitchboard-agent",
		icon: Send,
		task: "Create a Canva-style sales pitchboard from Shopify product data and HomeU URLs.",
		outcome: "Sales-ready pitchboard brief",
	},
]

function statusForJob(status: string) {
	if (status === "completed") return "completed"
	if (status === "failed") return "failed"
	if (status === "active") return "active"
	if (status === "waiting" || status === "delayed") return "queued"
	return "idle"
}

function formatTime(timestamp?: number) {
	if (!timestamp) return "No timestamp"
	return new Date(timestamp).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function AiAssistantView() {
	const [agents, setAgents] = useState<AgentConfig[]>([])
	const [jobs, setJobs] = useState<Job[]>([])
	const [queue, setQueue] = useState<QueueStats>({
		waiting: 0,
		active: 0,
		completed: 0,
		failed: 0,
		delayed: 0,
		total: 0,
	})
	const [selectedWorkflowId, setSelectedWorkflowId] = useState(WORKFLOWS[0].id)
	const [task, setTask] = useState(WORKFLOWS[0].task)
	const [submitting, setSubmitting] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)

	useEffect(() => {
		const fetchData = async () => {
			try {
				const [agentsRes, jobsRes, queueRes] = await Promise.all([
					fetch("/api/agents").catch(() => null),
					fetch("/api/jobs?limit=8").catch(() => null),
					fetch("/api/queue/stats").catch(() => null),
				])

				if (agentsRes?.ok) {
					const data = await agentsRes.json()
					setAgents(Array.isArray(data.agents) ? data.agents : [])
				}

				if (jobsRes?.ok) {
					const data = await jobsRes.json()
					setJobs(Array.isArray(data.jobs) ? data.jobs : [])
				}

				if (queueRes?.ok) {
					const data = await queueRes.json()
					setQueue({
						waiting: data.waiting || 0,
						active: data.active || 0,
						completed: data.completed || 0,
						failed: data.failed || 0,
						delayed: data.delayed || 0,
						total: data.total || 0,
					})
				}
			} catch (error) {
				console.error("Error fetching AI assistant data:", error)
			}
		}

		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [])

	const selectedWorkflow = useMemo(
		() => WORKFLOWS.find((workflow) => workflow.id === selectedWorkflowId) || WORKFLOWS[0],
		[selectedWorkflowId],
	)

	const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
	const enabledAgents = agents.filter((agent) => agent.enabled)
	const approvalAgents = agents.filter((agent) => agent.safety.requiresApproval)
	const sandboxAgents = agents.filter((agent) => agent.runtime.sandbox)
	const selectedAgent = agentById.get(selectedWorkflow.agentId)
	const canRun = Boolean(selectedAgent?.enabled && task.trim() && !submitting)
	const recentFailures = jobs.filter((job) => job.status === "failed").length

	const chooseWorkflow = (workflow: Workflow) => {
		setSelectedWorkflowId(workflow.id)
		setTask(workflow.task)
		setNotice(null)
	}

	const resumeAgent = async (agentId: string) => {
		setNotice(null)
		const res = await fetch(`/api/agents/${agentId}/enabled`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: true }),
		})
		const data = await res.json()
		if (data.success) {
			setAgents((prev) => prev.map((agent) => (agent.id === agentId ? { ...agent, enabled: true } : agent)))
			setNotice("Agent resumed.")
		} else {
			setNotice(data.error || "Could not resume agent.")
		}
	}

	const runWorkflow = async () => {
		if (!selectedAgent) {
			setNotice("This workflow needs an agent that is not installed.")
			return
		}

		if (!selectedAgent.enabled) {
			setNotice("Resume the selected agent before running this workflow.")
			return
		}

		setSubmitting(true)
		setNotice(null)
		try {
			const res = await fetch(`/api/agents/${selectedAgent.id}/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: task.trim(), network: "none" }),
			})
			const data = await res.json()
			setNotice(data.success ? `Job enqueued: ${data.jobId}` : data.error || "Run failed.")
		} catch (error: any) {
			setNotice(error.message || "Run failed.")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
				<StatCard
					label="Ready Agents"
					value={`${enabledAgents.length}/${agents.length}`}
					color="text-emerald-400"
				/>
				<StatCard label="Sandboxed" value={sandboxAgents.length} color="text-blue-400" />
				<StatCard
					label="Queue Load"
					value={queue.active + queue.waiting}
					sub={`${queue.delayed} delayed`}
					color="text-amber-400"
				/>
				<StatCard
					label="Recent Failures"
					value={recentFailures}
					color={recentFailures ? "text-red-400" : "text-emerald-400"}
				/>
			</div>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
				<Card className="space-y-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<div className="flex items-center gap-2 text-sm font-semibold text-[#e2e8f0]">
								<Sparkles className="h-4 w-4 text-violet-300" />
								AI command center
							</div>
							<div className="mt-1 text-xs text-gray-500">
								Select a workflow, adjust the brief, and send it through the right sandboxed agent.
							</div>
						</div>
						<Badge
							status={selectedAgent?.enabled ? "online" : "warning"}
							label={selectedAgent?.enabled ? "READY" : "NEEDS RESUME"}
						/>
					</div>

					<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
						{WORKFLOWS.map((workflow) => {
							const Icon = workflow.icon
							const active = selectedWorkflowId === workflow.id
							const agent = agentById.get(workflow.agentId)
							return (
								<button
									key={workflow.id}
									onClick={() => chooseWorkflow(workflow)}
									className={`min-h-24 rounded-md border p-3 text-left transition-colors ${
										active
											? "border-violet-500/50 bg-violet-500/10"
											: "border-[#1e2535] bg-[#0a0e1a] hover:border-[#334155]"
									}`}>
									<div className="mb-2 flex items-center justify-between gap-2">
										<Icon
											className={active ? "h-4 w-4 text-violet-300" : "h-4 w-4 text-gray-500"}
										/>
										<Badge
											status={agent?.enabled ? "online" : "idle"}
											label={agent?.enabled ? "ON" : "OFF"}
										/>
									</div>
									<div className="text-xs font-semibold text-[#e2e8f0]">{workflow.title}</div>
									<div className="mt-1 text-[11px] leading-5 text-gray-500">{workflow.outcome}</div>
								</button>
							)
						})}
					</div>

					<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
						<div>
							<label className="mb-1.5 block text-[11px] uppercase tracking-widest text-gray-500">
								Task brief
							</label>
							<textarea
								value={task}
								onChange={(event) => setTask(event.target.value)}
								className="min-h-28 w-full resize-y rounded-md border border-[#1e2535] bg-[#070b14] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors placeholder:text-gray-700 focus:border-violet-500/60"
								placeholder="Describe the outcome you want..."
							/>
						</div>
						<div className="space-y-2">
							<div className="text-[11px] uppercase tracking-widest text-gray-500">Selected agent</div>
							<div className="rounded-md border border-[#1e2535] bg-[#0a0e1a] p-3">
								<div className="text-sm font-semibold text-[#e2e8f0]">
									{selectedAgent?.name || selectedWorkflow.agentId}
								</div>
								<div className="mt-1 text-[11px] text-gray-500">
									{selectedAgent?.description || "Agent profile unavailable."}
								</div>
								<div className="mt-3 flex flex-wrap gap-1.5">
									<Badge
										status={selectedAgent?.runtime.sandbox ? "active" : "idle"}
										label={selectedAgent?.runtime.sandbox ? "SANDBOX" : "HOST"}
									/>
									<Badge
										status={selectedAgent?.safety.requiresApproval ? "warning" : "success"}
										label={selectedAgent?.safety.requiresApproval ? "APPROVALS" : "DIRECT"}
									/>
								</div>
							</div>
							<button
								onClick={runWorkflow}
								disabled={!canRun}
								className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-gray-700/40 disabled:bg-gray-700/10 disabled:text-gray-600">
								<Play className="h-4 w-4" />
								Run workflow
							</button>
							{selectedAgent && !selectedAgent.enabled && (
								<button
									onClick={() => resumeAgent(selectedAgent.id)}
									className="flex w-full items-center justify-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20">
									<Bot className="h-4 w-4" />
									Resume agent
								</button>
							)}
							{notice && (
								<div className="rounded-md border border-[#1e2535] bg-[#070b14] px-3 py-2 text-xs text-gray-400">
									{notice}
								</div>
							)}
						</div>
					</div>
				</Card>

				<div className="space-y-4">
					<Card>
						<div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#e2e8f0]">
							<ShieldCheck className="h-4 w-4 text-emerald-300" />
							Readiness
						</div>
						<div className="space-y-3">
							{[
								{
									label: "Sandbox isolation",
									ok: sandboxAgents.length === agents.length && agents.length > 0,
									detail: `${sandboxAgents.length}/${agents.length} agents sandboxed`,
								},
								{
									label: "Approval gates",
									ok: approvalAgents.length > 0,
									detail: `${approvalAgents.length} workflows require approval`,
								},
								{
									label: "Automation queue",
									ok: queue.failed === 0,
									detail: queue.failed
										? `${queue.failed} failed jobs need review`
										: "No failed jobs in queue stats",
								},
							].map((item) => (
								<div key={item.label} className="flex items-start gap-2">
									{item.ok ? (
										<CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
									) : (
										<AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
									)}
									<div>
										<div className="text-xs font-medium text-[#e2e8f0]">{item.label}</div>
										<div className="text-[11px] text-gray-500">{item.detail}</div>
									</div>
								</div>
							))}
						</div>
					</Card>

					<Card>
						<div className="mb-3 text-sm font-semibold text-[#e2e8f0]">Recent automation</div>
						<div className="space-y-2">
							{jobs.length === 0 && <div className="text-xs text-gray-600">No recent jobs yet.</div>}
							{jobs.slice(0, 6).map((job) => (
								<div key={job.id} className="border-b border-[#1e2535]/60 pb-2 last:border-0 last:pb-0">
									<div className="flex items-center justify-between gap-2">
										<div className="truncate text-xs font-medium text-[#e2e8f0]">
											{job.name || job.data?.task || "Untitled"}
										</div>
										<Badge status={statusForJob(job.status)} label={job.status.toUpperCase()} />
									</div>
									<div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
										<span className="truncate">{job.data?.agentId || "manual job"}</span>
										<span className="shrink-0">{formatTime(job.timestamp)}</span>
									</div>
									{job.failedReason && (
										<div className="mt-1 text-[11px] text-red-300">{job.failedReason}</div>
									)}
								</div>
							))}
						</div>
					</Card>
				</div>
			</div>
		</div>
	)
}
