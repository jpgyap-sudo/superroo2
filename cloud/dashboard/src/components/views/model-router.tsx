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

function RouteTable({ routes, providers }: { routes: ModelRoute[]; providers: ProviderMetadata[] }) {
	const allModels = providers.flatMap((p) => p.models)

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
							<th className="px-5 py-3">Status</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-800">
						{routes.map((r) => (
							<tr key={r.id} className="text-slate-200">
								<td className="px-5 py-3 font-medium capitalize">{r.taskType}</td>
								<td className="px-5 py-3">
									<span className="text-emerald-400">{r.primaryProvider}</span>
									<span className="text-slate-500"> / </span>
									<span className="text-slate-300">{r.primaryModel}</span>
								</td>
								<td className="px-5 py-3">
									{r.fallbackProvider1 ? (
										<>
											<span className="text-amber-400">{r.fallbackProvider1}</span>
											<span className="text-slate-500"> / </span>
											<span className="text-slate-300">{r.fallbackModel1}</span>
										</>
									) : (
										<span className="text-slate-600">—</span>
									)}
								</td>
								<td className="px-5 py-3">
									{r.fallbackProvider2 ? (
										<>
											<span className="text-amber-400">{r.fallbackProvider2}</span>
											<span className="text-slate-500"> / </span>
											<span className="text-slate-300">{r.fallbackModel2}</span>
										</>
									) : (
										<span className="text-slate-600">—</span>
									)}
								</td>
								<td className="px-5 py-3">
									<span
										className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
											r.enabled
												? "bg-emerald-500/15 text-emerald-300"
												: "bg-slate-500/15 text-slate-400"
										}`}>
										{r.enabled ? "Active" : "Disabled"}
									</span>
								</td>
							</tr>
						))}
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
					<p className="text-xs text-slate-500">Intelligently route tasks to the best model for each job</p>
				</div>
				<div className="flex gap-2">
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
			<RouteTable routes={routes} providers={providers} />

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
