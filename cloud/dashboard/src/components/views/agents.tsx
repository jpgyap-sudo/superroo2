"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Pause, Play, Settings, FileText, FolderOpen, Cpu, Activity } from "lucide-react"

type AgentConfig = {
	id: string
	name: string
	category: string
	description: string
	version: string
	enabled: boolean
	modelPolicy?: { preferred: string; fallbacks: string[]; maxTokens: number }
	skills: string[]
	workflows: string[]
	resources: string[]
	memory?: Record<string, unknown>
	outputs: string
	safety: {
		requiresApproval: boolean
		canEditFiles: boolean
		canPublish: boolean
		canDeploy: boolean
		blockedCommands: string[]
		approvalTriggers: string[]
	}
	runtime: {
		sandbox: boolean
		timeoutSeconds: number
		maxRetries: number
	}
}

function statusColor(enabled: boolean) {
	return enabled ? "online" : "idle"
}

export function AgentsView() {
	const [agents, setAgents] = useState<AgentConfig[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [detail, setDetail] = useState<AgentConfig | null>(null)
	const [tab, setTab] = useState<string>("profile")

	useEffect(() => {
		fetch("/api/agents")
			.then((r) => r.json())
			.then((d) => {
				if (d.success && Array.isArray(d.agents)) {
					setAgents(d.agents)
				} else {
					setError("Unexpected response")
				}
				setLoading(false)
			})
			.catch((e) => {
				setError(e.message || "Failed to load agents")
				setLoading(false)
			})
	}, [])

	useEffect(() => {
		if (!selectedId) {
			setDetail(null)
			return
		}
		fetch(`/api/agents/${selectedId}`)
			.then((r) => r.json())
			.then((d) => {
				if (d.success && d.agent) {
					setDetail(d.agent)
					setTab("profile")
				}
			})
			.catch(() => setDetail(null))
	}, [selectedId])

	const toggle = async (id: string) => {
		setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)))
	}

	const runAgent = async (id: string) => {
		try {
			const r = await fetch(`/api/agents/${id}/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: `${id}-run` }),
			})
			const d = await r.json()
			if (d.success) {
				alert(`Job enqueued: ${d.jobId}`)
			} else {
				alert(`Run failed: ${d.error || ""}`)
			}
		} catch (e: any) {
			alert(`Run failed: ${e.message}`)
		}
	}

	const filtered = useMemo(() => agents, [agents])

	const tabs = useMemo(() => {
		if (!detail) return []
		return [
			{ id: "profile", label: "Profile" },
			{ id: "skills", label: `Skills (${detail.skills.length})` },
			{ id: "workflows", label: `Workflows (${detail.workflows.length})` },
			{ id: "resources", label: `Resources (${detail.resources.length})` },
			{ id: "memory", label: "Memory" },
			{ id: "runs", label: "Runs" },
			{ id: "outputs", label: "Outputs" },
			{ id: "settings", label: "Settings" },
		]
	}, [detail])

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-gray-500">
				<Activity className="mr-2 h-4 w-4 animate-spin" />
				Loading agents...
			</div>
		)
	}

	if (error) {
		return <div className="flex h-full items-center justify-center text-red-400">Error: {error}</div>
	}

	return (
		<div className="flex h-full gap-4">
			<div className="flex-1 overflow-y-auto">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-gray-300">Custom Agents</h2>
					<span className="text-[11px] text-gray-600">{agents.length} agents</span>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((a) => (
						<Card key={a.id}>
							<div className="mb-2 flex items-start justify-between">
								<div>
									<div className="text-sm font-semibold text-[#e2e8f0]">{a.name}</div>
									<div className="text-[10px] text-gray-600">{a.category}</div>
								</div>
								<Badge status={statusColor(a.enabled)} label={a.enabled ? "ON" : "OFF"} />
							</div>
							<div className="mb-1.5 text-[11px] text-gray-500">{a.description}</div>
							<div className="mb-3 text-[11px] text-gray-600">
								v{a.version} · {a.runtime.sandbox ? "Sandbox" : "Host"} · {a.runtime.timeoutSeconds}s
							</div>
							<div className="flex items-center gap-2">
								<button
									onClick={() => runAgent(a.id)}
									className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20">
									<Play className="h-3 w-3" />
									Run
								</button>
								<button
									onClick={() => setSelectedId(a.id)}
									className="flex items-center gap-1 rounded border border-gray-600/30 bg-gray-600/10 px-2.5 py-1 text-[11px] text-gray-400 hover:bg-gray-600/20">
									<Settings className="h-3 w-3" />
									Edit
								</button>
								<button
									onClick={() => toggle(a.id)}
									className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] ml-auto ${
										a.enabled
											? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
											: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
									}`}>
									{a.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
									{a.enabled ? "Pause" : "Resume"}
								</button>
							</div>
						</Card>
					))}
				</div>
			</div>

			{detail && (
				<div className="w-[380px] shrink-0 overflow-y-auto border-l border-[#1e2535] bg-[#0a0e1a] p-4">
					<div className="mb-3 flex items-center justify-between">
						<div>
							<div className="text-sm font-semibold text-[#e2e8f0]">{detail.name}</div>
							<div className="text-[10px] text-gray-600">{detail.id}</div>
						</div>
						<button
							onClick={() => setSelectedId(null)}
							className="text-[11px] text-gray-500 hover:text-gray-300">
							Close
						</button>
					</div>
					<div className="mb-3 flex gap-1 overflow-x-auto border-b border-[#1e2535] pb-1">
						{tabs.map((t) => (
							<button
								key={t.id}
								onClick={() => setTab(t.id)}
								className={`whitespace-nowrap rounded px-2 py-1 text-[11px] ${
									tab === t.id
										? "bg-violet-600/10 text-violet-300"
										: "text-gray-500 hover:text-gray-300"
								}`}>
								{t.label}
							</button>
						))}
					</div>
					<div className="space-y-3 text-[11px] text-gray-400">
						{tab === "profile" && (
							<>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Category</span>
									<span className="text-[#e2e8f0]">{detail.category}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Version</span>
									<span className="text-[#e2e8f0]">{detail.version}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Status</span>
									<Badge
										status={statusColor(detail.enabled)}
										label={detail.enabled ? "Enabled" : "Disabled"}
									/>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Sandbox</span>
									<span className="text-[#e2e8f0]">{detail.runtime.sandbox ? "Yes" : "No"}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Timeout</span>
									<span className="text-[#e2e8f0]">{detail.runtime.timeoutSeconds}s</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Max Retries</span>
									<span className="text-[#e2e8f0]">{detail.runtime.maxRetries}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Approval Required</span>
									<span className="text-[#e2e8f0]">
										{detail.safety.requiresApproval ? "Yes" : "No"}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-gray-500">Can Deploy</span>
									<span className="text-[#e2e8f0]">{detail.safety.canDeploy ? "Yes" : "No"}</span>
								</div>
								<div className="mt-2 text-gray-500">Description</div>
								<div className="rounded border border-[#1e2535] p-2 text-gray-300">
									{detail.description}
								</div>
							</>
						)}
						{tab === "skills" && (
							<div className="space-y-2">
								{detail.skills.map((s) => (
									<div
										key={s}
										className="flex items-center gap-2 rounded border border-[#1e2535] p-2">
										<Cpu className="h-3 w-3 text-violet-400" />
										<span className="text-gray-300">{s}</span>
									</div>
								))}
							</div>
						)}
						{tab === "workflows" && (
							<div className="space-y-2">
								{detail.workflows.map((w) => (
									<div
										key={w}
										className="flex items-center gap-2 rounded border border-[#1e2535] p-2">
										<FileText className="h-3 w-3 text-emerald-400" />
										<span className="text-gray-300">{w}</span>
									</div>
								))}
							</div>
						)}
						{tab === "resources" && (
							<div className="space-y-2">
								{detail.resources.map((r) => (
									<div
										key={r}
										className="flex items-center gap-2 rounded border border-[#1e2535] p-2">
										<FolderOpen className="h-3 w-3 text-amber-400" />
										<span className="text-gray-300">{r}</span>
									</div>
								))}
							</div>
						)}
						{tab === "memory" && (
							<pre className="rounded border border-[#1e2535] p-2 text-[10px] text-gray-300">
								{JSON.stringify(detail.memory || {}, null, 2)}
							</pre>
						)}
						{tab === "runs" && <div className="text-gray-600">No runs recorded yet.</div>}
						{tab === "outputs" && <div className="text-gray-600">Outputs folder: {detail.outputs}</div>}
						{tab === "settings" && (
							<>
								<div className="mt-1 text-gray-500">Model Policy</div>
								<pre className="rounded border border-[#1e2535] p-2 text-[10px] text-gray-300">
									{JSON.stringify(detail.modelPolicy || {}, null, 2)}
								</pre>
								<div className="mt-2 text-gray-500">Safety</div>
								<pre className="rounded border border-[#1e2535] p-2 text-[10px] text-gray-300">
									{JSON.stringify(detail.safety, null, 2)}
								</pre>
								<div className="mt-2 text-gray-500">Runtime</div>
								<pre className="rounded border border-[#1e2535] p-2 text-[10px] text-gray-300">
									{JSON.stringify(detail.runtime, null, 2)}
								</pre>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
