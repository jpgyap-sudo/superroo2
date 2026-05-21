"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Server,
	Wifi,
	WifiOff,
	Activity,
	DollarSign,
	Zap,
	Clock,
	CheckCircle2,
	XCircle,
	AlertTriangle,
	RefreshCw,
	BarChart3,
	Network,
	BrainCircuit,
	Eye,
	MessageSquare,
	FileCode,
	Layers,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

interface ProviderUsage {
	costPerRequest: number
	latencyMs: number
	totalTokens: number
	requestCount: number
	lastUsed: number
}

interface ProviderEntry {
	id: string
	name: string
	description: string
	status: string
	hasKey: boolean
	lastTestedAt: number | null
	latencyMs: number | null
	models: string[]
	modelLabels: Record<string, string>
	capabilities: string[]
	defaultModel: string
	apiBaseUrl: string
	local: boolean
	usage: ProviderUsage | null
}

interface BridgeStatus {
	synced: boolean
	registryProviderCount: number
	legacyProviderCount: number
	usageStats: Record<string, ProviderUsage>
	connectionMeta: Record<
		string,
		{
			status: string
			lastTestedAt: number | null
			latencyMs: number | null
			hasKey: boolean
			keyHash: string | null
		}
	>
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(ts: number | null | undefined): string {
	if (!ts) return "never"
	const diff = Date.now() - ts
	if (diff < 60_000) return "just now"
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
	return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatCost(cost: number): string {
	if (cost === 0) return "—"
	if (cost < 0.001) return "<$0.001"
	return `$${cost.toFixed(4)}`
}

function formatTokens(tokens: number): string {
	if (tokens === 0) return "—"
	if (tokens < 1000) return `${tokens}`
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
	return `${(tokens / 1_000_000).toFixed(1)}M`
}

function statusColor(status: string): string {
	switch (status) {
		case "connected":
			return "text-green-400"
		case "invalid":
			return "text-red-400"
		case "not_tested":
			return "text-yellow-400"
		case "missing":
			return "text-gray-500"
		default:
			return "text-gray-400"
	}
}

function statusIcon(status: string) {
	switch (status) {
		case "connected":
			return <CheckCircle2 className="h-4 w-4 text-green-400" />
		case "invalid":
			return <XCircle className="h-4 w-4 text-red-400" />
		case "not_tested":
			return <AlertTriangle className="h-4 w-4 text-yellow-400" />
		case "missing":
			return <WifiOff className="h-4 w-4 text-gray-500" />
		default:
			return <WifiOff className="h-4 w-4 text-gray-500" />
	}
}

// ── Capability Matrix ──────────────────────────────────────────────────────

const ALL_CAPABILITIES = [
	"chat",
	"vision",
	"reasoning",
	"embedding",
	"functionCalling",
	"fast-inference",
	"multi-provider",
	"structured-output",
	"extended-thinking",
]

const CAPABILITY_LABELS: Record<string, string> = {
	chat: "Chat",
	vision: "Vision",
	reasoning: "Reasoning",
	embedding: "Embedding",
	functionCalling: "Function Calling",
	"fast-inference": "Fast Inference",
	"multi-provider": "Multi-Provider",
	"structured-output": "Structured Output",
	"extended-thinking": "Extended Thinking",
}

const CAPABILITY_ICONS: Record<string, React.FC<{ className?: string }>> = {
	chat: MessageSquare,
	vision: Eye,
	reasoning: BrainCircuit,
	embedding: Layers,
	functionCalling: FileCode,
}

// ── Panel Component ────────────────────────────────────────────────────────

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
	return (
		<section className={cn("rounded-lg border border-[#1e2535] bg-[#0a0e1a] overflow-hidden", className)}>
			<div className="border-b border-[#1e2535] px-4 py-2.5">
				<h3 className="text-sm font-semibold text-[#e2e8f0]">{title}</h3>
			</div>
			<div className="p-4">{children}</div>
		</section>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────

export function ProviderDashboardView() {
	const [providers, setProviders] = useState<ProviderEntry[]>([])
	const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"name" | "status" | "cost" | "latency">("name")

	async function fetchData() {
		try {
			const [providersRes, bridgeRes] = await Promise.all([
				fetch("/api/providers"),
				fetch("/api/providers/bridge/status"),
			])
			const providersData = await providersRes.json()
			const bridgeData = await bridgeRes.json()

			if (providersData.success) {
				setProviders(providersData.providers || [])
			}
			if (bridgeData.success && bridgeData.available) {
				setBridgeStatus(bridgeData.status)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch provider data")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [])

	async function handleRefresh() {
		setRefreshing(true)
		await fetchData()
		setRefreshing(false)
	}

	// Sort providers
	const sortedProviders = [...providers].sort((a, b) => {
		switch (sortBy) {
			case "name":
				return a.name.localeCompare(b.name)
			case "status": {
				const order = { connected: 0, not_tested: 1, invalid: 2, missing: 3 }
				return (order[a.status as keyof typeof order] ?? 99) - (order[b.status as keyof typeof order] ?? 99)
			}
			case "cost": {
				const aCost = a.usage?.costPerRequest ?? Infinity
				const bCost = b.usage?.costPerRequest ?? Infinity
				return aCost - bCost
			}
			case "latency": {
				const aLat = a.usage?.latencyMs ?? Infinity
				const bLat = b.usage?.latencyMs ?? Infinity
				return aLat - bLat
			}
			default:
				return 0
		}
	})

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64 text-gray-400">
				<RefreshCw className="h-5 w-5 animate-spin mr-2" />
				Loading provider data...
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-64 text-red-400">
				<AlertTriangle className="h-5 w-5 mr-2" />
				{error}
			</div>
		)
	}

	const selectedProviderData = selectedProvider ? providers.find((p) => p.id === selectedProvider) : null

	return (
		<div className="space-y-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-bold text-[#e2e8f0]">Provider Dashboard</h1>
					<p className="text-xs text-gray-500 mt-0.5">
						{bridgeStatus
							? `${bridgeStatus.registryProviderCount} providers registered · ${bridgeStatus.synced ? "Bridge synced" : "Bridge not synced"}`
							: "Bridge not available"}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<select
						value={sortBy}
						onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
						className="bg-[#0f1117] border border-[#1e2535] rounded px-2 py-1 text-xs text-gray-300">
						<option value="name">Sort by Name</option>
						<option value="status">Sort by Status</option>
						<option value="cost">Sort by Cost</option>
						<option value="latency">Sort by Latency</option>
					</select>
					<button
						onClick={handleRefresh}
						disabled={refreshing}
						className="flex items-center gap-1.5 rounded bg-violet-600/20 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-600/30 transition-colors disabled:opacity-50">
						<RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Summary Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
					<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
						<Server className="h-3.5 w-3.5" />
						Total Providers
					</div>
					<div className="text-xl font-bold text-[#e2e8f0]">{providers.length}</div>
				</div>
				<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
					<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
						<Wifi className="h-3.5 w-3.5 text-green-400" />
						Connected
					</div>
					<div className="text-xl font-bold text-green-400">
						{providers.filter((p) => p.status === "connected").length}
					</div>
				</div>
				<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
					<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
						<DollarSign className="h-3.5 w-3.5 text-yellow-400" />
						Total Requests
					</div>
					<div className="text-xl font-bold text-[#e2e8f0]">
						{Object.values(bridgeStatus?.usageStats || {}).reduce((sum, s) => sum + s.requestCount, 0)}
					</div>
				</div>
				<div className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] p-3">
					<div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
						<Zap className="h-3.5 w-3.5 text-violet-400" />
						Total Tokens
					</div>
					<div className="text-xl font-bold text-[#e2e8f0]">
						{formatTokens(
							Object.values(bridgeStatus?.usageStats || {}).reduce((sum, s) => sum + s.totalTokens, 0),
						)}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
				{/* Provider List */}
				<div className="xl:col-span-2">
					<Panel title="Providers">
						<div className="space-y-2">
							{sortedProviders.length === 0 ? (
								<div className="text-center text-gray-500 py-8 text-sm">No providers found</div>
							) : (
								sortedProviders.map((provider) => (
									<button
										key={provider.id}
										onClick={() =>
											setSelectedProvider(selectedProvider === provider.id ? null : provider.id)
										}
										className={cn(
											"w-full text-left rounded-lg border p-3 transition-colors",
											selectedProvider === provider.id
												? "border-violet-600 bg-violet-600/10"
												: "border-[#1e2535] bg-[#0f1117] hover:border-[#2a3345]",
										)}>
										<div className="flex items-center justify-between mb-2">
											<div className="flex items-center gap-2">
												{statusIcon(provider.status)}
												<span className="text-sm font-medium text-[#e2e8f0]">
													{provider.name}
												</span>
												{provider.local && (
													<span className="text-[10px] bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded">
														LOCAL
													</span>
												)}
											</div>
											<div className="flex items-center gap-2">
												<span
													className={cn("text-xs font-medium", statusColor(provider.status))}>
													{provider.status}
												</span>
												{provider.latencyMs !== null && (
													<span className="text-xs text-gray-500">
														{provider.latencyMs.toFixed(0)}ms
													</span>
												)}
											</div>
										</div>
										<div className="flex items-center gap-3 text-xs text-gray-500">
											<span>{provider.models.length} models</span>
											<span>{provider.capabilities.length} capabilities</span>
											{provider.usage && (
												<>
													<span>{provider.usage.requestCount} requests</span>
													<span>{formatCost(provider.usage.costPerRequest)}/req</span>
												</>
											)}
										</div>
									</button>
								))
							)}
						</div>
					</Panel>
				</div>

				{/* Selected Provider Details */}
				<div>
					{selectedProviderData ? (
						<Panel title={selectedProviderData.name}>
							<div className="space-y-3">
								{/* Connection Status */}
								<div>
									<div className="text-xs text-gray-500 mb-1">Connection</div>
									<div className="flex items-center gap-2">
										{statusIcon(selectedProviderData.status)}
										<span
											className={cn(
												"text-sm font-medium",
												statusColor(selectedProviderData.status),
											)}>
											{selectedProviderData.status}
										</span>
									</div>
									{selectedProviderData.lastTestedAt && (
										<div className="text-xs text-gray-500 mt-1">
											Last tested: {formatRelative(selectedProviderData.lastTestedAt)}
										</div>
									)}
								</div>

								{/* API Endpoint */}
								<div>
									<div className="text-xs text-gray-500 mb-1">API Endpoint</div>
									<div className="text-xs text-[#e2e8f0] font-mono truncate">
										{selectedProviderData.apiBaseUrl}
									</div>
								</div>

								{/* Default Model */}
								<div>
									<div className="text-xs text-gray-500 mb-1">Default Model</div>
									<div className="text-xs text-[#e2e8f0]">{selectedProviderData.defaultModel}</div>
								</div>

								{/* Usage Stats */}
								{selectedProviderData.usage && (
									<div>
										<div className="text-xs text-gray-500 mb-1">Usage Statistics</div>
										<div className="grid grid-cols-2 gap-2">
											<div className="rounded bg-[#0f1117] p-2">
												<div className="text-[10px] text-gray-500">Requests</div>
												<div className="text-sm font-medium text-[#e2e8f0]">
													{selectedProviderData.usage.requestCount}
												</div>
											</div>
											<div className="rounded bg-[#0f1117] p-2">
												<div className="text-[10px] text-gray-500">Avg Cost</div>
												<div className="text-sm font-medium text-[#e2e8f0]">
													{formatCost(selectedProviderData.usage.costPerRequest)}
												</div>
											</div>
											<div className="rounded bg-[#0f1117] p-2">
												<div className="text-[10px] text-gray-500">Avg Latency</div>
												<div className="text-sm font-medium text-[#e2e8f0]">
													{selectedProviderData.usage.latencyMs.toFixed(0)}ms
												</div>
											</div>
											<div className="rounded bg-[#0f1117] p-2">
												<div className="text-[10px] text-gray-500">Total Tokens</div>
												<div className="text-sm font-medium text-[#e2e8f0]">
													{formatTokens(selectedProviderData.usage.totalTokens)}
												</div>
											</div>
										</div>
									</div>
								)}

								{/* Models */}
								<div>
									<div className="text-xs text-gray-500 mb-1">
										Models ({selectedProviderData.models.length})
									</div>
									<div className="space-y-1">
										{selectedProviderData.models.map((modelId) => (
											<div
												key={modelId}
												className="flex items-center justify-between rounded bg-[#0f1117] px-2 py-1">
												<span className="text-xs text-[#e2e8f0]">
													{selectedProviderData.modelLabels[modelId] || modelId}
												</span>
												<span className="text-[10px] text-gray-500 font-mono">{modelId}</span>
											</div>
										))}
									</div>
								</div>
							</div>
						</Panel>
					) : (
						<Panel title="Provider Details">
							<div className="text-center text-gray-500 py-8 text-sm">
								Select a provider to view details
							</div>
						</Panel>
					)}
				</div>
			</div>

			{/* Capability Matrix */}
			<Panel title="Capability Matrix">
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="border-b border-[#1e2535]">
								<th className="text-left py-2 px-2 text-gray-500 font-medium">Provider</th>
								{ALL_CAPABILITIES.map((cap) => (
									<th
										key={cap}
										className="text-center py-2 px-2 text-gray-500 font-medium"
										title={CAPABILITY_LABELS[cap] || cap}>
										{CAPABILITY_ICONS[cap] ? (
											<div className="flex justify-center">
												{(() => {
													const Icon = CAPABILITY_ICONS[cap]
													return <Icon className="h-3.5 w-3.5" />
												})()}
											</div>
										) : (
											cap.slice(0, 3)
										)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sortedProviders.map((provider) => (
								<tr key={provider.id} className="border-b border-[#1e2535]/50 hover:bg-[#0f1117]">
									<td className="py-2 px-2 text-[#e2e8f0]">{provider.name}</td>
									{ALL_CAPABILITIES.map((cap) => (
										<td key={cap} className="text-center py-2 px-2">
											{provider.capabilities.includes(cap) ? (
												<CheckCircle2 className="h-3.5 w-3.5 text-green-400 mx-auto" />
											) : (
												<span className="text-gray-700">—</span>
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>

			{/* Cost Comparison */}
			<Panel title="Cost & Latency Comparison">
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="border-b border-[#1e2535]">
								<th className="text-left py-2 px-2 text-gray-500 font-medium">Provider</th>
								<th className="text-right py-2 px-2 text-gray-500 font-medium">Requests</th>
								<th className="text-right py-2 px-2 text-gray-500 font-medium">Avg Cost/Req</th>
								<th className="text-right py-2 px-2 text-gray-500 font-medium">Avg Latency</th>
								<th className="text-right py-2 px-2 text-gray-500 font-medium">Total Tokens</th>
								<th className="text-right py-2 px-2 text-gray-500 font-medium">Last Used</th>
							</tr>
						</thead>
						<tbody>
							{sortedProviders.map((provider) => {
								const usage = provider.usage || bridgeStatus?.usageStats?.[provider.id]
								return (
									<tr key={provider.id} className="border-b border-[#1e2535]/50 hover:bg-[#0f1117]">
										<td className="py-2 px-2 text-[#e2e8f0]">{provider.name}</td>
										<td className="text-right py-2 px-2 text-gray-400">
											{usage?.requestCount ?? 0}
										</td>
										<td className="text-right py-2 px-2 text-yellow-400">
											{usage ? formatCost(usage.costPerRequest) : "—"}
										</td>
										<td className="text-right py-2 px-2 text-violet-400">
											{usage?.latencyMs ? `${usage.latencyMs.toFixed(0)}ms` : "—"}
										</td>
										<td className="text-right py-2 px-2 text-gray-400">
											{usage ? formatTokens(usage.totalTokens) : "—"}
										</td>
										<td className="text-right py-2 px-2 text-gray-500">
											{usage?.lastUsed ? formatRelative(usage.lastUsed) : "—"}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			</Panel>
		</div>
	)
}
