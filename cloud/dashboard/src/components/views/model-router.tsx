"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type ProviderStatus = "missing_key" | "untested" | "tested" | "error"

type ProviderModel = {
	id: string
	label: string
	providerId: string
	capabilities: string[]
}

type ProviderMetadata = {
	providerId: string
	displayName: string
	status: ProviderStatus
	maskedKey?: string
	models: ProviderModel[]
	capabilities: string[]
	lastTestedAt?: string
	errorMessage?: string
}

type TaskRouteType =
	| "planning"
	| "coding"
	| "debugging"
	| "crawling"
	| "research"
	| "testing"
	| "deployment"
	| "architecture"
	| "fast_fix"

type ModelRoute = {
	id: string
	taskType: TaskRouteType
	primaryProvider: string
	primaryModel: string
	fallbackProvider1?: string
	fallbackModel1?: string
	fallbackProvider2?: string
	fallbackModel2?: string
	enabled: boolean
	requireApproval: boolean
	createdAt: string
	updatedAt: string
}

type UsageMetric = {
	id: string
	providerId: string
	modelId: string
	taskType: string
	latencyMs: number
	success: boolean
	errorCode?: string
	inputTokens: number
	outputTokens: number
	totalCostUsd: number
	totalCalls: number
	avgLatencyMs: number
	createdAt: string
}

function statusColor(status: ProviderStatus) {
	switch (status) {
		case "tested":
			return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
		case "untested":
			return "bg-sky-500/15 text-sky-300 border-sky-500/25"
		case "error":
			return "bg-red-500/15 text-red-300 border-red-500/25"
		case "missing_key":
			return "bg-amber-500/15 text-amber-300 border-amber-500/25"
	}
}

function statusLabel(status: ProviderStatus) {
	switch (status) {
		case "tested":
			return "Tested"
		case "untested":
			return "Untested"
		case "error":
			return "Error"
		case "missing_key":
			return "Missing Key"
	}
}

function ProviderStatusStrip({ providers }: { providers: ProviderMetadata[] }) {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Provider Status</h2>
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
				{providers.map((p) => (
					<div
						key={p.providerId}
						className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center">
						<div className="mb-2 text-lg font-bold text-slate-100">{p.displayName}</div>
						<Badge
							status={
								p.status === "tested"
									? "success"
									: p.status === "error"
										? "error"
										: p.status === "untested"
											? "active"
											: "warning"
							}
							label={statusLabel(p.status)}
						/>
						{p.maskedKey && <div className="mt-2 text-[10px] text-slate-600 font-mono">{p.maskedKey}</div>}
						{p.errorMessage && <div className="mt-2 text-[10px] text-red-400">{p.errorMessage}</div>}
						<div className="mt-2 flex flex-wrap justify-center gap-1">
							{p.capabilities.map((cap) => (
								<span
									key={cap}
									className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
									{cap}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	)
}

function RouteTable({
	routes,
	providers,
	editingRouteId,
	editForm,
	onStartEdit,
	onCancelEdit,
	onEditField,
	onSave,
}: {
	routes: ModelRoute[]
	providers: ProviderMetadata[]
	editingRouteId: string | null
	editForm: {
		primaryProvider: string
		primaryModel: string
		fallbackProvider1: string
		fallbackModel1: string
		fallbackProvider2: string
		fallbackModel2: string
	} | null
	onStartEdit: (route: ModelRoute) => void
	onCancelEdit: () => void
	onEditField: (field: string, value: string) => void
	onSave: (routeId: string) => void
}) {
	const allModels = providers.flatMap((p) => p.models)

	// Get models for a given provider
	function modelsForProvider(providerId: string) {
		const p = providers.find((p) => p.providerId === providerId)
		return p?.models || []
	}

	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 shadow-xl">
			<div className="border-b border-slate-800 px-5 py-4">
				<h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Task-to-Model Routing</h2>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead className="bg-slate-900/80 text-xs uppercase text-slate-400">
						<tr>
							<th className="px-5 py-3">Task Type</th>
							<th className="px-5 py-3">Primary</th>
							<th className="px-5 py-3">Fallback 1</th>
							<th className="px-5 py-3">Fallback 2</th>
							<th className="px-5 py-3">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-800">
						{routes.map((r) => {
							const isEditing = editingRouteId === r.id
							return (
								<tr key={r.id} className="text-slate-200">
									<td className="px-5 py-3 font-medium capitalize">{r.taskType}</td>

									{/* Primary Provider + Model */}
									<td className="px-5 py-3">
										{isEditing && editForm ? (
											<div className="flex flex-col gap-1.5">
												<select
													value={editForm.primaryProvider}
													onChange={(e) => onEditField("primaryProvider", e.target.value)}
													className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
													<option value="" className="bg-slate-900 text-slate-500">— None —</option>
													{providers.filter((p) => p.status === "tested").map((p) => (
														<option key={p.providerId} value={p.providerId} className="bg-slate-900 text-slate-200">
															{p.displayName}
														</option>
													))}
												</select>
												{editForm.primaryProvider && (
													<select
														value={editForm.primaryModel}
														onChange={(e) => onEditField("primaryModel", e.target.value)}
														className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
														{modelsForProvider(editForm.primaryProvider).map((m) => (
															<option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
																{m.label}
															</option>
														))}
													</select>
												)}
											</div>
										) : (
											<>
												<span className="text-emerald-400">{r.primaryProvider}</span>
												<span className="text-slate-500"> / </span>
												<span className="text-slate-300">{r.primaryModel}</span>
											</>
										)}
									</td>

									{/* Fallback 1 */}
									<td className="px-5 py-3">
										{isEditing && editForm ? (
											<div className="flex flex-col gap-1.5">
												<select
													value={editForm.fallbackProvider1}
													onChange={(e) => onEditField("fallbackProvider1", e.target.value)}
													className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
													<option value="" className="bg-slate-900 text-slate-500">— None —</option>
													{providers.filter((p) => p.status === "tested").map((p) => (
														<option key={p.providerId} value={p.providerId} className="bg-slate-900 text-slate-200">
															{p.displayName}
														</option>
													))}
												</select>
												{editForm.fallbackProvider1 && (
													<select
														value={editForm.fallbackModel1}
														onChange={(e) => onEditField("fallbackModel1", e.target.value)}
														className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
														{modelsForProvider(editForm.fallbackProvider1).map((m) => (
															<option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
																{m.label}
															</option>
														))}
													</select>
												)}
											</div>
										) : (
											r.fallbackProvider1 ? (
												<>
													<span className="text-amber-400">{r.fallbackProvider1}</span>
													<span className="text-slate-500"> / </span>
													<span className="text-slate-300">{r.fallbackModel1}</span>
												</>
											) : (
												<span className="text-slate-600">—</span>
											)
										)}
									</td>

									{/* Fallback 2 */}
									<td className="px-5 py-3">
										{isEditing && editForm ? (
											<div className="flex flex-col gap-1.5">
												<select
													value={editForm.fallbackProvider2}
													onChange={(e) => onEditField("fallbackProvider2", e.target.value)}
													className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
													<option value="" className="bg-slate-900 text-slate-500">— None —</option>
													{providers.filter((p) => p.status === "tested").map((p) => (
														<option key={p.providerId} value={p.providerId} className="bg-slate-900 text-slate-200">
															{p.displayName}
														</option>
													))}
												</select>
												{editForm.fallbackProvider2 && (
													<select
														value={editForm.fallbackModel2}
														onChange={(e) => onEditField("fallbackModel2", e.target.value)}
														className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
														{modelsForProvider(editForm.fallbackProvider2).map((m) => (
															<option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
																{m.label}
															</option>
														))}
													</select>
												)}
											</div>
										) : (
											r.fallbackProvider2 ? (
												<>
													<span className="text-amber-400">{r.fallbackProvider2}</span>
													<span className="text-slate-500"> / </span>
													<span className="text-slate-300">{r.fallbackModel2}</span>
												</>
											) : (
												<span className="text-slate-600">—</span>
											)
										)}
									</td>

									{/* Actions */}
									<td className="px-5 py-3">
										{isEditing ? (
											<div className="flex gap-1.5">
												<button
													onClick={() => onSave(r.id)}
													className="rounded bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500 transition-colors">
													Save
												</button>
												<button
													onClick={onCancelEdit}
													className="rounded bg-slate-700 px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-600 transition-colors">
													Cancel
												</button>
											</div>
										) : (
											<button
												onClick={() => onStartEdit(r)}
												className="rounded bg-violet-700/50 px-2.5 py-1 text-[10px] font-semibold text-violet-200 hover:bg-violet-600/50 transition-colors">
												Edit
											</button>
										)}
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</section>
	)
}

function CostOptimizer() {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Cost Optimizer</h2>
			<div className="space-y-3">
				<div className="flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
					<div>
						<div className="text-sm text-slate-200">Estimated Monthly Cost</div>
						<div className="text-xs text-slate-500">Based on current routing config</div>
					</div>
					<div className="text-2xl font-bold text-emerald-400">$0.00</div>
				</div>
				<div className="flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
					<div>
						<div className="text-sm text-slate-200">Cost Savings</div>
						<div className="text-xs text-slate-500">Using fallback models</div>
					</div>
					<div className="text-2xl font-bold text-emerald-400">$0.00</div>
				</div>
				<div className="rounded-lg bg-slate-900/60 p-3">
					<div className="mb-2 text-sm text-slate-200">Recommendations</div>
					<ul className="space-y-1 text-xs text-slate-400">
						<li className="flex items-center gap-2">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							Use gpt-4o-mini for crawling tasks to reduce costs
						</li>
						<li className="flex items-center gap-2">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							Route research tasks to DeepSeek for better value
						</li>
					</ul>
				</div>
			</div>
		</section>
	)
}

function PerformanceMonitor({ usage = [] }: { usage: UsageMetric[] }) {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Performance Monitor</h2>
			<table className="w-full text-left text-sm">
				<thead className="text-xs uppercase text-slate-500">
					<tr>
						<th className="pb-2 pr-4">Provider</th>
						<th className="pb-2 pr-4">Model</th>
						<th className="pb-2 pr-4">Avg Latency</th>
						<th className="pb-2 pr-4">Success Rate</th>
						<th className="pb-2 pr-4">Calls</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-800">
					{usage.length === 0 ? (
						<tr>
							<td colSpan={5} className="py-8 text-center text-xs text-slate-600">
								No usage data yet. Test a route to see performance metrics.
							</td>
						</tr>
					) : (
						usage.map((m) => (
							<tr key={m.id} className="text-slate-300">
								<td className="py-2 pr-4">{m.providerId}</td>
								<td className="py-2 pr-4 font-mono text-xs">{m.modelId}</td>
								<td className="py-2 pr-4">{m.avgLatencyMs}ms</td>
								<td className="py-2 pr-4">
									<span className={m.success ? "text-emerald-400" : "text-red-400"}>
										{m.success ? "100%" : "0%"}
									</span>
								</td>
								<td className="py-2 pr-4">{m.totalCalls}</td>
							</tr>
						))
					)}
				</tbody>
			</table>
		</section>
	)
}

function FallbackRules() {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Fallback Rules</h2>
			<div className="space-y-3">
				{[
					{ label: "Retry primary once before fallback", enabled: true },
					{ label: "Switch to fallback 1 after retry", enabled: true },
					{ label: "Switch to fallback 2 after fallback 1", enabled: true },
					{ label: "Switch if latency above 5000ms", enabled: true },
					{ label: "Switch if quota exceeded", enabled: true },
					{ label: "Switch if API key unavailable", enabled: true },
				].map((rule) => (
					<div key={rule.label} className="flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
						<span className="text-sm text-slate-200">{rule.label}</span>
						<span
							className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
								rule.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"
							}`}>
							{rule.enabled ? "On" : "Off"}
						</span>
					</div>
				))}
			</div>
		</section>
	)
}

function SafetyRules() {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Safety Rules</h2>
			<div className="space-y-3">
				{[
					{ label: "Require approval for deployments", enabled: true },
					{ label: "Require approval for expensive models", enabled: true },
					{ label: "Require approval for long-running tasks", enabled: true },
					{ label: "Block untested providers", enabled: false },
				].map((rule) => (
					<div key={rule.label} className="flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
						<span className="text-sm text-slate-200">{rule.label}</span>
						<span
							className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
								rule.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"
							}`}>
							{rule.enabled ? "On" : "Off"}
						</span>
					</div>
				))}
			</div>
		</section>
	)
}

function AgentSync() {
	return (
		<section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Agent Sync Status</h2>
			<div className="space-y-2">
				{["planner", "coder", "debugger", "crawler", "tester", "deployChecker"].map((agent) => (
					<div key={agent} className="flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
						<div className="flex items-center gap-3">
							<div className="h-2 w-2 rounded-full bg-emerald-400" />
							<span className="text-sm capitalize text-slate-200">{agent}</span>
						</div>
						<span className="text-xs text-slate-500">Synced</span>
					</div>
				))}
			</div>
		</section>
	)
}

export default function ModelRouterView() {
	const [providers, setProviders] = useState<ProviderMetadata[]>([])
	const [routes, setRoutes] = useState<ModelRoute[]>([])
	const [usage, setUsage] = useState<UsageMetric[]>([])
	const [loading, setLoading] = useState(true)
	const [syncing, setSyncing] = useState(false)
	const [testing, setTesting] = useState(false)
	const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
	const [editForm, setEditForm] = useState<{
		primaryProvider: string
		primaryModel: string
		fallbackProvider1: string
		fallbackModel1: string
		fallbackProvider2: string
		fallbackModel2: string
	} | null>(null)
	const [saving, setSaving] = useState(false)

	async function load() {
		setLoading(true)
		try {
			const [provRes, routesRes, usageRes] = await Promise.all([
				fetch("/api/model-router/providers"),
				fetch("/api/model-router/routes"),
				fetch("/api/model-router/usage"),
			])
			const provData = await provRes.json()
			const routesData = await routesRes.json()
			const usageData = await usageRes.json()
			if (provData.success) setProviders(provData.providers)
			if (routesData.success) setRoutes(routesData.routes)
			if (usageData.success) setUsage(usageData.usage)
		} catch (err) {
			console.error("[model-router] Failed to load data:", err)
		} finally {
			setLoading(false)
		}
	}

	async function syncApiKeys() {
		setSyncing(true)
		try {
			const res = await fetch("/api/model-router/sync-api-keys", { method: "POST" })
			const data = await res.json()
			if (data.success) await load()
		} catch (err) {
			console.error("[model-router] Sync failed:", err)
		} finally {
			setSyncing(false)
		}
	}

	async function testAllRoutes() {
		setTesting(true)
		try {
			for (const route of routes) {
				await fetch("/api/model-router/test-route", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ taskType: route.taskType }),
				})
			}
			await load()
		} catch (err) {
			console.error("[model-router] Test all routes failed:", err)
		} finally {
			setTesting(false)
		}
	}

	// ── Route editing ────────────────────────────────────────────────────
	function handleStartEdit(route: ModelRoute) {
		setEditingRouteId(route.id)
		setEditForm({
			primaryProvider: route.primaryProvider,
			primaryModel: route.primaryModel,
			fallbackProvider1: route.fallbackProvider1 || "",
			fallbackModel1: route.fallbackModel1 || "",
			fallbackProvider2: route.fallbackProvider2 || "",
			fallbackModel2: route.fallbackModel2 || "",
		})
	}

	function handleCancelEdit() {
		setEditingRouteId(null)
		setEditForm(null)
	}

	function handleEditField(field: string, value: string) {
		setEditForm((prev) => {
			if (!prev) return prev
			const updated = { ...prev, [field]: value }
			// When provider changes, auto-select the first model for that provider
			if (field === "primaryProvider" || field === "fallbackProvider1" || field === "fallbackProvider2") {
				const modelField = field.replace("Provider", "Model")
				const p = providers.find((pr) => pr.providerId === value)
				if (p && p.models.length > 0) {
					(updated as Record<string, string>)[modelField] = p.models[0].id
				} else {
					(updated as Record<string, string>)[modelField] = ""
				}
			}
			return updated
		})
	}

	async function handleSaveRoute(routeId: string) {
		if (!editForm) return
		setSaving(true)
		try {
			const res = await fetch(`/api/model-router/routes/${routeId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					primaryProvider: editForm.primaryProvider,
					primaryModel: editForm.primaryModel,
					fallbackProvider1: editForm.fallbackProvider1 || null,
					fallbackModel1: editForm.fallbackModel1 || null,
					fallbackProvider2: editForm.fallbackProvider2 || null,
					fallbackModel2: editForm.fallbackModel2 || null,
				}),
			})
			const data = await res.json()
			if (data.success) {
				setRoutes((prev) =>
					prev.map((r) =>
						r.id === routeId
							? {
									...r,
									primaryProvider: editForm.primaryProvider,
									primaryModel: editForm.primaryModel,
									fallbackProvider1: editForm.fallbackProvider1 || undefined,
									fallbackModel1: editForm.fallbackModel1 || undefined,
									fallbackProvider2: editForm.fallbackProvider2 || undefined,
									fallbackModel2: editForm.fallbackModel2 || undefined,
								}
							: r,
					),
				)
				setEditingRouteId(null)
				setEditForm(null)
			}
		} catch (err) {
			console.error("[model-router] Failed to save route:", err)
		} finally {
			setSaving(false)
		}
	}

	useEffect(() => {
		load()
	}, [])

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="text-sm text-slate-400">Loading model router...</div>
			</div>
		)
	}

	return (
		<div className="space-y-5">
			<div className="flex items-start justify-between">
				<div>
					<h2 className="text-lg font-semibold text-slate-100">AI Model Router</h2>
					<p className="text-xs text-slate-500">Configure which AI provider and model handles each task type</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={syncApiKeys}
						disabled={syncing}
						className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50">
						{syncing ? "Syncing..." : "Sync API Keys"}
					</button>
					<button
						onClick={testAllRoutes}
						disabled={testing}
						className="rounded-lg border border-violet-700 bg-violet-800/50 px-4 py-2 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-700/50 disabled:opacity-50">
						{testing ? "Testing..." : "Test All Routes"}
					</button>
				</div>
			</div>

			<ProviderStatusStrip providers={providers} />
			<RouteTable
				routes={routes}
				providers={providers}
				editingRouteId={editingRouteId}
				editForm={editForm}
				onStartEdit={handleStartEdit}
				onCancelEdit={handleCancelEdit}
				onEditField={handleEditField}
				onSave={handleSaveRoute}
			/>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<CostOptimizer />
				<PerformanceMonitor usage={usage} />
				<FallbackRules />
			</div>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<SafetyRules />
				<AgentSync />
			</div>
		</div>
	)
}
