"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	Pause,
	Play,
	Settings,
	FileText,
	FolderOpen,
	Cpu,
	Activity,
	RefreshCw,
	Search,
	X,
	Download,
	Save,
	Trash2,
} from "lucide-react"

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
	const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set())
	const [search, setSearch] = useState("")
	const [refreshing, setRefreshing] = useState(false)
	const [editing, setEditing] = useState(false)
	const [editForm, setEditForm] = useState({
		timeoutSeconds: 300,
		maxRetries: 3,
		sandbox: true,
		requiresApproval: true,
		canDeploy: false,
		canEditFiles: true,
		canPublish: false,
		preferredModel: "",
		fallbackModels: "",
		maxTokens: 4096,
	})
	const [saving, setSaving] = useState(false)

	const fetchAgents = useCallback(async () => {
		try {
			setError(null)
			const r = await fetch("/api/agents")
			const d = await r.json()
			if (d.success && Array.isArray(d.agents)) {
				setAgents(d.agents)
			} else {
				setError("Unexpected response")
			}
		} catch (e: any) {
			setError(e.message || "Failed to load agents")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchAgents()
		const iv = setInterval(fetchAgents, 30000)
		return () => clearInterval(iv)
	}, [fetchAgents])

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
		const agent = agents.find((a) => a.id === id)
		if (!agent || pendingAgentIds.has(id)) return

		const previousEnabled = agent.enabled
		const nextEnabled = !previousEnabled

		setPendingAgentIds((prev) => new Set(prev).add(id))
		setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: nextEnabled } : a)))
		setDetail((prev) => (prev?.id === id ? { ...prev, enabled: nextEnabled } : prev))

		try {
			const r = await fetch(`/api/agents/${id}/enabled`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled }),
			})
			const d = await r.json()
			if (d.success && typeof d.enabled === "boolean") {
				setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: d.enabled } : a)))
				setDetail((prev) => (prev?.id === id ? { ...prev, enabled: d.enabled } : prev))
			} else {
				setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: previousEnabled } : a)))
				setDetail((prev) => (prev?.id === id ? { ...prev, enabled: previousEnabled } : prev))
			}
		} catch {
			setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: previousEnabled } : a)))
			setDetail((prev) => (prev?.id === id ? { ...prev, enabled: previousEnabled } : prev))
		} finally {
			setPendingAgentIds((prev) => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
		}
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
				alert(
					d.error?.includes("Agent disabled")
						? "Run failed: resume this agent first."
						: `Run failed: ${d.error || ""}`,
				)
			}
		} catch (e: any) {
			alert(`Run failed: ${e.message}`)
		}
	}

	const handleSaveAgent = async () => {
		if (!detail) return
		setSaving(true)
		try {
			const body = {
				runtime: {
					sandbox: editForm.sandbox,
					timeoutSeconds: editForm.timeoutSeconds,
					maxRetries: editForm.maxRetries,
				},
				safety: {
					requiresApproval: editForm.requiresApproval,
					canEditFiles: editForm.canEditFiles,
					canPublish: editForm.canPublish,
					canDeploy: editForm.canDeploy,
					blockedCommands: detail.safety.blockedCommands,
					approvalTriggers: detail.safety.approvalTriggers,
				},
				modelPolicy: {
					preferred: editForm.preferredModel || detail.modelPolicy?.preferred || "",
					fallbacks: editForm.fallbackModels
						? editForm.fallbackModels
								.split(",")
								.map((s: string) => s.trim())
								.filter(Boolean)
						: detail.modelPolicy?.fallbacks || [],
					maxTokens: editForm.maxTokens,
				},
			}
			const r = await fetch(`/api/agents/${detail.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			const d = await r.json()
			if (d.success) {
				setDetail(
					d.agent || { ...detail, runtime: body.runtime, safety: body.safety, modelPolicy: body.modelPolicy },
				)
				setEditing(false)
				fetchAgents()
			} else {
				alert(`Save failed: ${d.error || "Unknown error"}`)
			}
		} catch (e: any) {
			alert(`Save failed: ${e.message}`)
		} finally {
			setSaving(false)
		}
	}

	const handleDeleteAgent = async (id: string) => {
		if (!confirm(`Delete agent "${id}"? This cannot be undone.`)) return
		try {
			const r = await fetch(`/api/agents/${id}`, { method: "DELETE" })
			const d = await r.json()
			if (d.success) {
				setSelectedId(null)
				setDetail(null)
				fetchAgents()
			} else {
				alert(`Delete failed: ${d.error || "Unknown error"}`)
			}
		} catch (e: any) {
			alert(`Delete failed: ${e.message}`)
		}
	}

	const filtered = useMemo(() => {
		if (!search) return agents
		const q = search.toLowerCase()
		return agents.filter(
			(a) =>
				a.name.toLowerCase().includes(q) ||
				a.id.toLowerCase().includes(q) ||
				a.category.toLowerCase().includes(q) ||
				a.description.toLowerCase().includes(q),
		)
	}, [agents, search])

	const handleExport = useCallback(() => {
		const csv = ["id,name,category,version,enabled,description"]
		csv.push(
			...filtered.map(
				(a) =>
					`${a.id},${a.name},${a.category},${a.version},${a.enabled},"${a.description.replace(/"/g, '""')}"`,
			),
		)
		const blob = new Blob([csv.join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `agents-${new Date().toISOString().slice(0, 10)}.csv`
		a.click()
		URL.revokeObjectURL(url)
	}, [filtered])

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
					<div className="flex items-center gap-2">
						<div className="relative">
							<Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="w-40 bg-[#0a0e1a] border border-[#1e2535] rounded pl-6 pr-6 py-1 text-[11px] text-white outline-none focus:border-blue-500/50"
								placeholder="Search agents..."
							/>
							{search && (
								<button
									onClick={() => setSearch("")}
									className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
									<X size={12} />
								</button>
							)}
						</div>
						<button
							onClick={handleExport}
							disabled={agents.length === 0}
							className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
							<Download size={11} />
							Export
						</button>
						<button
							onClick={async () => {
								setRefreshing(true)
								await fetchAgents()
								setRefreshing(false)
							}}
							disabled={loading || refreshing}
							className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
							<RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
							Refresh
						</button>
						<span className="text-[11px] text-gray-600">{agents.length} agents</span>
					</div>
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
									disabled={!a.enabled || pendingAgentIds.has(a.id)}
									title={!a.enabled ? "Resume this agent before running it" : undefined}
									className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-gray-700/40 disabled:bg-gray-700/10 disabled:text-gray-600">
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
									disabled={pendingAgentIds.has(a.id)}
									className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] ml-auto ${
										a.enabled
											? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
											: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
									} disabled:cursor-not-allowed disabled:opacity-60`}>
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
						<div className="flex items-center gap-1">
							{!editing ? (
								<button
									onClick={() => {
										setEditForm({
											timeoutSeconds: detail.runtime.timeoutSeconds,
											maxRetries: detail.runtime.maxRetries,
											sandbox: detail.runtime.sandbox,
											requiresApproval: detail.safety.requiresApproval,
											canDeploy: detail.safety.canDeploy,
											canEditFiles: detail.safety.canEditFiles,
											canPublish: detail.safety.canPublish,
											preferredModel: detail.modelPolicy?.preferred || "",
											fallbackModels: (detail.modelPolicy?.fallbacks || []).join(", "),
											maxTokens: detail.modelPolicy?.maxTokens || 4096,
										})
										setEditing(true)
									}}
									className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-400 hover:text-white border border-[#1e2535] hover:border-gray-600 transition-colors"
									title="Edit agent configuration">
									<Settings size={11} />
									Edit
								</button>
							) : (
								<button
									onClick={() => setEditing(false)}
									className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-400 hover:text-white border border-[#1e2535] hover:border-gray-600 transition-colors"
									title="Cancel editing">
									<X size={11} />
									Cancel
								</button>
							)}
							<button
								onClick={() => handleDeleteAgent(detail.id)}
								className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-red-400 hover:text-red-300 border border-red-800/30 hover:border-red-600/50 transition-colors"
								title="Delete agent">
								<Trash2 size={11} />
							</button>
							<button
								onClick={() => setSelectedId(null)}
								className="text-[11px] text-gray-500 hover:text-gray-300">
								Close
							</button>
						</div>
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
								{editing ? (
									<>
										<div className="flex items-center justify-between">
											<span className="text-gray-500">Sandbox</span>
											<label className="relative inline-flex cursor-pointer items-center">
												<input
													type="checkbox"
													checked={editForm.sandbox}
													onChange={(e) =>
														setEditForm((prev) => ({ ...prev, sandbox: e.target.checked }))
													}
													className="peer sr-only"
												/>
												<div className="h-4 w-7 rounded-full bg-[#1e2535] after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-gray-500 after:transition-all peer-checked:bg-violet-600/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-400" />
											</label>
										</div>
										<div>
											<span className="text-gray-500">Timeout (seconds)</span>
											<input
												type="number"
												value={editForm.timeoutSeconds}
												onChange={(e) =>
													setEditForm((prev) => ({
														...prev,
														timeoutSeconds: Number(e.target.value),
													}))
												}
												className="mt-1 w-full rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500/50"
												min={1}
												max={3600}
											/>
										</div>
										<div>
											<span className="text-gray-500">Max Retries</span>
											<input
												type="number"
												value={editForm.maxRetries}
												onChange={(e) =>
													setEditForm((prev) => ({
														...prev,
														maxRetries: Number(e.target.value),
													}))
												}
												className="mt-1 w-full rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500/50"
												min={0}
												max={20}
											/>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-gray-500">Requires Approval</span>
											<label className="relative inline-flex cursor-pointer items-center">
												<input
													type="checkbox"
													checked={editForm.requiresApproval}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															requiresApproval: e.target.checked,
														}))
													}
													className="peer sr-only"
												/>
												<div className="h-4 w-7 rounded-full bg-[#1e2535] after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-gray-500 after:transition-all peer-checked:bg-violet-600/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-400" />
											</label>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-gray-500">Can Deploy</span>
											<label className="relative inline-flex cursor-pointer items-center">
												<input
													type="checkbox"
													checked={editForm.canDeploy}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															canDeploy: e.target.checked,
														}))
													}
													className="peer sr-only"
												/>
												<div className="h-4 w-7 rounded-full bg-[#1e2535] after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-gray-500 after:transition-all peer-checked:bg-violet-600/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-400" />
											</label>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-gray-500">Can Edit Files</span>
											<label className="relative inline-flex cursor-pointer items-center">
												<input
													type="checkbox"
													checked={editForm.canEditFiles}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															canEditFiles: e.target.checked,
														}))
													}
													className="peer sr-only"
												/>
												<div className="h-4 w-7 rounded-full bg-[#1e2535] after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-gray-500 after:transition-all peer-checked:bg-violet-600/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-400" />
											</label>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-gray-500">Can Publish</span>
											<label className="relative inline-flex cursor-pointer items-center">
												<input
													type="checkbox"
													checked={editForm.canPublish}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															canPublish: e.target.checked,
														}))
													}
													className="peer sr-only"
												/>
												<div className="h-4 w-7 rounded-full bg-[#1e2535] after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-gray-500 after:transition-all peer-checked:bg-violet-600/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-400" />
											</label>
										</div>
										<button
											onClick={handleSaveAgent}
											disabled={saving}
											className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-violet-600/20 px-3 py-1.5 text-[11px] font-medium text-violet-300 hover:bg-violet-600/30 disabled:opacity-50 transition-colors">
											<Save size={12} className={saving ? "animate-spin" : ""} />
											{saving ? "Saving..." : "Save Changes"}
										</button>
									</>
								) : (
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
											<span className="text-[#e2e8f0]">
												{detail.runtime.sandbox ? "Yes" : "No"}
											</span>
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
											<span className="text-[#e2e8f0]">
												{detail.safety.canDeploy ? "Yes" : "No"}
											</span>
										</div>
										<div className="mt-2 text-gray-500">Description</div>
										<div className="rounded border border-[#1e2535] p-2 text-gray-300">
											{detail.description}
										</div>
									</>
								)}
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
								{editing ? (
									<>
										<div className="mt-1 text-gray-500">Model Policy</div>
										<div className="space-y-2 rounded border border-[#1e2535] p-2">
											<div>
												<span className="text-gray-500">Preferred Model</span>
												<input
													type="text"
													value={editForm.preferredModel}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															preferredModel: e.target.value,
														}))
													}
													className="mt-1 w-full rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500/50"
													placeholder="e.g. gpt-4, claude-3"
												/>
											</div>
											<div>
												<span className="text-gray-500">Fallback Models (comma-separated)</span>
												<input
													type="text"
													value={editForm.fallbackModels}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															fallbackModels: e.target.value,
														}))
													}
													className="mt-1 w-full rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500/50"
													placeholder="e.g. gpt-3.5, claude-haiku"
												/>
											</div>
											<div>
												<span className="text-gray-500">Max Tokens</span>
												<input
													type="number"
													value={editForm.maxTokens}
													onChange={(e) =>
														setEditForm((prev) => ({
															...prev,
															maxTokens: Number(e.target.value),
														}))
													}
													className="mt-1 w-full rounded border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500/50"
													min={256}
													max={128000}
												/>
											</div>
										</div>
										<button
											onClick={handleSaveAgent}
											disabled={saving}
											className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-violet-600/20 px-3 py-1.5 text-[11px] font-medium text-violet-300 hover:bg-violet-600/30 disabled:opacity-50 transition-colors">
											<Save size={12} className={saving ? "animate-spin" : ""} />
											{saving ? "Saving..." : "Save Changes"}
										</button>
									</>
								) : (
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
							</>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
