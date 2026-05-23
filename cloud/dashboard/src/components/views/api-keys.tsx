"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
	Key,
	CheckCircle,
	XCircle,
	AlertTriangle,
	RefreshCw,
	Save,
	Trash2,
	TestTube,
	Settings,
	Eye,
	EyeOff,
	Copy,
	Search,
	ChevronUp,
	ChevronDown,
	ArrowUpDown,
	Activity,
	DollarSign,
	BarChart3,
	ExternalLink,
	Loader2,
	Shield,
	Clock,
	AlertCircle,
	Info,
	Zap,
	Filter,
	Play,
	Trash,
	X,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

type ProviderStatus = "missing" | "connected" | "invalid" | "not_tested"

type Provider = {
	id: string
	name: string
	description: string
	status: ProviderStatus
	hasKey: boolean
	maskedKey?: string
	defaultModel: string
	models: string[]
	modelLabels: Record<string, string>
	capabilities: string[]
	lastTestedAt: number | null
	latencyMs: number | null
	apiBaseUrl: string
	website: string
	docsUrl: string
}

type SortField = "name" | "status" | "latencyMs" | "lastTestedAt"
type SortDir = "asc" | "desc"

// ── Helpers ────────────────────────────────────────────────────────────────

function statusClass(status: ProviderStatus) {
	switch (status) {
		case "connected":
			return "text-green-400 bg-green-900/30 border-green-700/50"
		case "invalid":
			return "text-red-400 bg-red-900/30 border-red-700/50"
		case "not_tested":
			return "text-yellow-400 bg-yellow-900/30 border-yellow-700/50"
		default:
			return "text-gray-400 bg-gray-800/30 border-gray-700/50"
	}
}

function statusIcon(status: ProviderStatus) {
	switch (status) {
		case "connected":
			return <CheckCircle size={14} />
		case "invalid":
			return <XCircle size={14} />
		case "not_tested":
			return <AlertTriangle size={14} />
		default:
			return <AlertCircle size={14} />
	}
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${className}`}>
			{children}
		</span>
	)
}

function getAuthHeaders(): Record<string, string> {
	const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
	return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatRelativeTime(ts: number | null): string {
	if (!ts) return "Never"
	const diff = Date.now() - ts
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return "Just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

function formatLatency(ms: number | null): string {
	if (ms === null || ms === undefined) return "—"
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

// ── Model Comparison Modal ─────────────────────────────────────────────────

function ModelComparisonModal({ providers, onClose }: { providers: Provider[]; onClose: () => void }) {
	const allModels = useMemo(() => {
		const map = new Map<string, { provider: string; modelId: string; capabilities: string[] }>()
		for (const p of providers) {
			for (const m of p.models) {
				const label = p.modelLabels[m] || m
				map.set(`${p.id}:${m}`, { provider: p.name, modelId: label, capabilities: p.capabilities })
			}
		}
		return Array.from(map.values())
	}, [providers])

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="bg-[#0a0e1a] border border-[#1e2535] rounded-xl p-6 w-[800px] max-h-[80vh] overflow-y-auto shadow-2xl"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
						<BarChart3 size={16} className="text-blue-400" />
						Model Comparison
					</h3>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-300">
						<X size={16} />
					</button>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="border-b border-[#1e2535]">
								<th className="text-left py-2 px-3 text-gray-400 font-medium">Provider</th>
								<th className="text-left py-2 px-3 text-gray-400 font-medium">Model</th>
								<th className="text-left py-2 px-3 text-gray-400 font-medium">Capabilities</th>
							</tr>
						</thead>
						<tbody>
							{allModels.map((m, i) => (
								<tr key={i} className="border-b border-[#1e2535]/50 hover:bg-[#0f1525]">
									<td className="py-2 px-3 text-gray-300">{m.provider}</td>
									<td className="py-2 px-3 text-gray-200 font-mono">{m.modelId}</td>
									<td className="py-2 px-3">
										<div className="flex flex-wrap gap-1">
											{m.capabilities.map((c) => (
												<Pill
													key={c}
													className="bg-blue-900/20 text-blue-300 border-blue-700/30">
													{c}
												</Pill>
											))}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{allModels.length === 0 && (
					<p className="text-xs text-gray-500 text-center py-4">No models available</p>
				)}
			</div>
		</div>
	)
}

// ── Usage Stats Modal ──────────────────────────────────────────────────────

function UsageStatsModal({ providers, onClose }: { providers: Provider[]; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="bg-[#0a0e1a] border border-[#1e2535] rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
						<DollarSign size={16} className="text-green-400" />
						Usage & Cost Overview
					</h3>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-300">
						<X size={16} />
					</button>
				</div>
				<div className="space-y-3">
					{providers.map((p) => (
						<div
							key={p.id}
							className="flex items-center justify-between p-3 bg-[#0f1525] rounded-lg border border-[#1e2535]">
							<div>
								<p className="text-sm text-gray-200 font-medium">{p.name}</p>
								<p className="text-xs text-gray-500 mt-0.5">
									Status: {p.status} · Latency: {formatLatency(p.latencyMs)} · Last tested:{" "}
									{formatRelativeTime(p.lastTestedAt)}
								</p>
							</div>
							<div className="text-right">
								<p className="text-xs text-gray-400">{p.models.length} models</p>
								<p className="text-xs text-gray-500 mt-0.5">{p.capabilities.length} capabilities</p>
							</div>
						</div>
					))}
				</div>
				{providers.length === 0 && (
					<p className="text-xs text-gray-500 text-center py-4">No providers configured</p>
				)}
			</div>
		</div>
	)
}

// ── Provider Card ──────────────────────────────────────────────────────────

function ProviderCard({ provider, onSaved }: { provider: Provider; onSaved: () => void }) {
	const [showKeyInput, setShowKeyInput] = useState(false)
	const [keyValue, setKeyValue] = useState("")
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [showKey, setShowKey] = useState(false)
	const [copied, setCopied] = useState(false)
	const [showConfig, setShowConfig] = useState(false)
	const [configBaseUrl, setConfigBaseUrl] = useState(provider.apiBaseUrl || "")
	const [configModel, setConfigModel] = useState(provider.defaultModel || "")
	const [configSaving, setConfigSaving] = useState(false)
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

	useEffect(() => {
		setConfigBaseUrl(provider.apiBaseUrl || "")
		setConfigModel(provider.defaultModel || "")
	}, [provider.apiBaseUrl, provider.defaultModel])

	async function saveKey() {
		if (!keyValue.trim()) return
		setSaving(true)
		try {
			const res = await fetch(`/api/settings/providers/${provider.id}/key`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({ apiKey: keyValue.trim() }),
			})
			if (!res.ok) throw new Error("Failed to save key")
			setKeyValue("")
			setShowKeyInput(false)
			onSaved()
		} catch (err) {
			console.error("Save key error:", err)
		} finally {
			setSaving(false)
		}
	}

	async function testKey() {
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch(`/api/settings/providers/${provider.id}/test`, {
				method: "POST",
				headers: getAuthHeaders(),
			})
			const data = await res.json()
			setTestResult({ ok: res.ok, message: data.message || (res.ok ? "Connected!" : "Test failed") })
			onSaved()
		} catch (err) {
			setTestResult({ ok: false, message: "Network error" })
		} finally {
			setTesting(false)
		}
	}

	async function deleteKey() {
		setDeleting(true)
		try {
			await fetch(`/api/settings/providers/${provider.id}/key`, {
				method: "DELETE",
				headers: getAuthHeaders(),
			})
			setShowDeleteConfirm(false)
			onSaved()
		} catch (err) {
			console.error("Delete key error:", err)
		} finally {
			setDeleting(false)
		}
	}

	async function saveConfig() {
		setConfigSaving(true)
		try {
			await fetch(`/api/settings/providers/${provider.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({
					apiBaseUrl: configBaseUrl || undefined,
					defaultModel: configModel || undefined,
				}),
			})
			onSaved()
		} catch (err) {
			console.error("Save config error:", err)
		} finally {
			setConfigSaving(false)
		}
	}

	async function handleCopyKey() {
		if (provider.maskedKey) {
			try {
				await navigator.clipboard.writeText(provider.maskedKey)
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			} catch {}
		}
	}

	return (
		<div className="rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-5 space-y-4 transition-all duration-200 hover:border-[#2a3555]">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold text-gray-200">{provider.name}</h3>
						<Pill className={statusClass(provider.status)}>
							{statusIcon(provider.status)}
							{provider.status === "not_tested"
								? "Not Tested"
								: provider.status.charAt(0).toUpperCase() + provider.status.slice(1)}
						</Pill>
					</div>
					<p className="text-xs text-gray-500 mt-1">{provider.description}</p>
				</div>
				{provider.website && (
					<a
						href={provider.website}
						target="_blank"
						rel="noopener noreferrer"
						className="text-gray-500 hover:text-gray-300 ml-2 shrink-0"
						title="Visit website">
						<ExternalLink size={14} />
					</a>
				)}
			</div>

			{/* Capabilities */}
			<div className="flex flex-wrap gap-1.5">
				{provider.capabilities.map((cap) => (
					<Pill key={cap} className="bg-blue-900/20 text-blue-300 border-blue-700/30">
						{cap}
					</Pill>
				))}
			</div>

			{/* Key info & latency */}
			<div className="flex items-center gap-3 text-xs text-gray-500">
				{provider.hasKey && provider.maskedKey && (
					<div className="flex items-center gap-1.5">
						<Key size={12} />
						<span className="font-mono text-gray-400">
							{showKey
								? provider.maskedKey
								: `${provider.maskedKey.slice(0, 8)}...${provider.maskedKey.slice(-4)}`}
						</span>
						<button
							onClick={() => setShowKey(!showKey)}
							className="text-gray-600 hover:text-gray-300"
							title={showKey ? "Hide key" : "Show key"}>
							{showKey ? <EyeOff size={12} /> : <Eye size={12} />}
						</button>
						<button onClick={handleCopyKey} className="text-gray-600 hover:text-gray-300" title="Copy key">
							{copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
						</button>
					</div>
				)}
				{provider.latencyMs !== null && (
					<span className="flex items-center gap-1">
						<Zap size={12} />
						{formatLatency(provider.latencyMs)}
					</span>
				)}
				{provider.lastTestedAt && (
					<span className="flex items-center gap-1">
						<Clock size={12} />
						{formatRelativeTime(provider.lastTestedAt)}
					</span>
				)}
			</div>

			{/* Test result feedback */}
			{testResult && (
				<div
					className={`text-xs px-3 py-2 rounded ${
						testResult.ok
							? "bg-green-900/20 text-green-300 border border-green-700/30"
							: "bg-red-900/20 text-red-300 border border-red-700/30"
					}`}>
					{testResult.message}
				</div>
			)}

			{/* Actions */}
			<div className="flex flex-wrap items-center gap-2">
				{!provider.hasKey ? (
					<button
						onClick={() => setShowKeyInput(!showKeyInput)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
						<Key size={12} />
						Add Key
					</button>
				) : (
					<>
						<button
							onClick={testKey}
							disabled={testing}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-700 text-green-200 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50">
							{testing ? <Loader2 size={12} className="animate-spin" /> : <TestTube size={12} />}
							{testing ? "Testing..." : "Test"}
						</button>
						<button
							onClick={() => setShowDeleteConfirm(true)}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-900/30 text-red-300 rounded-lg hover:bg-red-800/40 transition-colors">
							<Trash2 size={12} />
							Remove
						</button>
					</>
				)}
				<button
					onClick={() => setShowConfig(!showConfig)}
					className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
						showConfig
							? "bg-blue-900/30 text-blue-300"
							: "text-gray-400 hover:text-gray-300 hover:bg-[#1e2535]"
					}`}>
					<Settings size={12} />
					Config
				</button>
			</div>

			{/* Key Input */}
			{showKeyInput && (
				<div className="space-y-2">
					<label className="block text-xs text-gray-400">API Key</label>
					<div className="flex gap-2">
						<input
							type="password"
							value={keyValue}
							onChange={(e) => setKeyValue(e.target.value)}
							placeholder="sk-..."
							className="flex-1 px-3 py-1.5 text-xs bg-[#0d1225] border border-[#1e2535] rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
						/>
						<button
							onClick={saveKey}
							disabled={saving || !keyValue.trim()}
							className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
							{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
							Save
						</button>
					</div>
				</div>
			)}

			{/* Delete Confirmation */}
			{showDeleteConfirm && (
				<div className="border border-red-800/40 bg-red-900/10 rounded-lg p-3 space-y-2">
					<p className="text-xs text-red-300 flex items-center gap-1.5">
						<AlertTriangle size={12} />
						Are you sure you want to remove the API key for {provider.name}?
					</p>
					<div className="flex gap-2">
						<button
							onClick={deleteKey}
							disabled={deleting}
							className="flex items-center gap-1 px-3 py-1 text-xs bg-red-700 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
							{deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
							Confirm Remove
						</button>
						<button
							onClick={() => setShowDeleteConfirm(false)}
							className="px-3 py-1 text-xs text-gray-400 hover:text-gray-300">
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Config Panel */}
			{showConfig && (
				<div className="rounded-xl border border-[#1e2535] bg-[#0d1225] p-4 space-y-3">
					<label className="block">
						<span className="text-xs text-gray-400">API Base URL</span>
						<input
							type="text"
							value={configBaseUrl}
							onChange={(e) => setConfigBaseUrl(e.target.value)}
							placeholder="https://api.openai.com/v1"
							className="mt-1 w-full px-3 py-1.5 text-xs bg-[#0a0e1a] border border-[#1e2535] rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
						/>
					</label>
					<label className="block">
						<span className="text-xs text-gray-400">Default Model</span>
						<select
							value={configModel}
							onChange={(e) => setConfigModel(e.target.value)}
							className="mt-1 w-full px-3 py-1.5 text-xs bg-[#0a0e1a] border border-[#1e2535] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500">
							{provider.models.map((m) => (
								<option key={m} value={m}>
									{provider.modelLabels[m] || m}
								</option>
							))}
						</select>
					</label>
					<button
						onClick={saveConfig}
						disabled={configSaving}
						className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
						{configSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
						Save Config
					</button>
				</div>
			)}
		</div>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────

export function ApiKeysView() {
	const [providers, setProviders] = useState<Provider[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [statusFilter, setStatusFilter] = useState<ProviderStatus | "all">("all")
	const [capabilityFilter, setCapabilityFilter] = useState<string>("all")
	const [sortField, setSortField] = useState<SortField>("name")
	const [sortDir, setSortDir] = useState<SortDir>("asc")
	const [testingAll, setTestingAll] = useState(false)
	const [showModelComparison, setShowModelComparison] = useState(false)
	const [showUsageStats, setShowUsageStats] = useState(false)
	const [autoRefresh, setAutoRefresh] = useState(false)

	async function loadProviders() {
		try {
			const res = await fetch("/api/settings/providers", { headers: getAuthHeaders() })
			if (!res.ok) throw new Error("Failed to load providers")
			const data = await res.json()
			setProviders(data.providers ?? [])
			setError(null)
		} catch (err: any) {
			setError(err.message || "Failed to load providers")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadProviders()
	}, [])

	// Auto-refresh polling
	useEffect(() => {
		if (!autoRefresh) return
		const iv = setInterval(loadProviders, 30000)
		return () => clearInterval(iv)
	}, [autoRefresh])

	async function handleTestAll() {
		setTestingAll(true)
		const untested = providers.filter((p) => p.hasKey)
		for (const p of untested) {
			try {
				await fetch(`/api/settings/providers/${p.id}/test`, {
					method: "POST",
					headers: getAuthHeaders(),
				})
			} catch {}
		}
		await loadProviders()
		setTestingAll(false)
	}

	async function handleRemoveAllDisconnected() {
		const disconnected = providers.filter((p) => p.status === "missing" || p.status === "invalid")
		for (const p of disconnected) {
			try {
				await fetch(`/api/settings/providers/${p.id}/key`, {
					method: "DELETE",
					headers: getAuthHeaders(),
				})
			} catch {}
		}
		await loadProviders()
	}

	// Derive all unique capabilities across providers
	const allCapabilities = useMemo(() => {
		const caps = new Set<string>()
		for (const p of providers) {
			for (const c of p.capabilities) caps.add(c)
		}
		return Array.from(caps).sort()
	}, [providers])

	// Filtered + sorted providers
	const filteredProviders = useMemo(() => {
		let filtered = [...providers]

		// Search filter
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase()
			filtered = filtered.filter(
				(p) =>
					p.name.toLowerCase().includes(q) ||
					p.description.toLowerCase().includes(q) ||
					p.id.toLowerCase().includes(q),
			)
		}

		// Status filter
		if (statusFilter !== "all") {
			filtered = filtered.filter((p) => p.status === statusFilter)
		}

		// Capability filter
		if (capabilityFilter !== "all") {
			filtered = filtered.filter((p) => p.capabilities.includes(capabilityFilter))
		}

		// Sort
		filtered.sort((a, b) => {
			let cmp = 0
			switch (sortField) {
				case "name":
					cmp = a.name.localeCompare(b.name)
					break
				case "status":
					cmp = a.status.localeCompare(b.status)
					break
				case "latencyMs":
					cmp = (a.latencyMs ?? 999999) - (b.latencyMs ?? 999999)
					break
				case "lastTestedAt":
					cmp = (a.lastTestedAt ?? 0) - (b.lastTestedAt ?? 0)
					break
			}
			return sortDir === "asc" ? cmp : -cmp
		})

		return filtered
	}, [providers, searchQuery, statusFilter, capabilityFilter, sortField, sortDir])

	function toggleSort(field: SortField) {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		} else {
			setSortField(field)
			setSortDir("asc")
		}
	}

	const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
		<button
			onClick={() => toggleSort(field)}
			className={`flex items-center gap-1 text-xs font-medium transition-colors ${
				sortField === field ? "text-blue-400" : "text-gray-500 hover:text-gray-300"
			}`}>
			{label}
			{sortField === field ? (
				sortDir === "asc" ? (
					<ChevronUp size={10} />
				) : (
					<ChevronDown size={10} />
				)
			) : (
				<ArrowUpDown size={10} />
			)}
		</button>
	)

	const connectedCount = providers.filter((p) => p.status === "connected").length
	const totalWithKeys = providers.filter((p) => p.hasKey).length

	return (
		<div className="p-6 space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
						<Key size={18} className="text-blue-400" />
						API Keys
					</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						{connectedCount}/{totalWithKeys} providers connected · {providers.length} total
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={handleTestAll}
						disabled={testingAll}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-800 text-green-200 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
						title="Test all configured providers">
						{testingAll ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
						Test All
					</button>
					<button
						onClick={handleRemoveAllDisconnected}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-900/30 text-red-300 rounded-lg hover:bg-red-800/40 transition-colors"
						title="Remove all disconnected/invalid keys">
						<Trash size={12} />
						Clean Up
					</button>
					<button
						onClick={() => setShowModelComparison(true)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-[#1e2535] rounded-lg transition-colors"
						title="Compare models across providers">
						<BarChart3 size={12} />
						Compare
					</button>
					<button
						onClick={() => setShowUsageStats(true)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-[#1e2535] rounded-lg transition-colors"
						title="View usage statistics">
						<DollarSign size={12} />
						Usage
					</button>
					<button
						onClick={() => setAutoRefresh(!autoRefresh)}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
							autoRefresh
								? "bg-blue-900/30 text-blue-300"
								: "text-gray-400 hover:text-gray-300 hover:bg-[#1e2535]"
						}`}
						title="Auto-refresh every 30s">
						<RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
						Auto
					</button>
					<button
						onClick={loadProviders}
						disabled={loading}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-[#1e2535] rounded-lg transition-colors">
						<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
			</div>

			{/* Security rule banner */}
			<div className="flex items-start gap-2 p-3 bg-yellow-900/10 border border-yellow-700/30 rounded-lg">
				<Shield size={14} className="text-yellow-400 mt-0.5 shrink-0" />
				<p className="text-xs text-yellow-300/80">
					API keys are encrypted at rest and never exposed to the client. Keys are stored in a secure vault
					and only used for server-side API calls.
				</p>
			</div>

			{/* Search & Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative flex-1 min-w-[200px] max-w-xs">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search providers..."
						className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#0d1225] border border-[#1e2535] rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
					/>
				</div>
				<select
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value as ProviderStatus | "all")}
					className="px-3 py-1.5 text-xs bg-[#0d1225] border border-[#1e2535] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500">
					<option value="all">All Status</option>
					<option value="connected">Connected</option>
					<option value="missing">Missing</option>
					<option value="invalid">Invalid</option>
					<option value="not_tested">Not Tested</option>
				</select>
				<select
					value={capabilityFilter}
					onChange={(e) => setCapabilityFilter(e.target.value)}
					className="px-3 py-1.5 text-xs bg-[#0d1225] border border-[#1e2535] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500">
					<option value="all">All Capabilities</option>
					{allCapabilities.map((cap) => (
						<option key={cap} value={cap}>
							{cap}
						</option>
					))}
				</select>
				<div className="flex items-center gap-2 text-xs text-gray-500">
					<SortHeader field="name" label="Name" />
					<SortHeader field="status" label="Status" />
					<SortHeader field="latencyMs" label="Latency" />
					<SortHeader field="lastTestedAt" label="Tested" />
				</div>
			</div>

			{/* Error state */}
			{error && (
				<div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-700/30 rounded-lg">
					<AlertCircle size={14} className="text-red-400 shrink-0" />
					<p className="text-xs text-red-300">{error}</p>
				</div>
			)}

			{/* Loading state */}
			{loading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 size={24} className="animate-spin text-blue-400" />
				</div>
			) : filteredProviders.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-gray-500">
					<Key size={32} className="opacity-30 mb-3" />
					<p className="text-sm">No providers found</p>
					<p className="text-xs mt-1">
						{searchQuery || statusFilter !== "all" || capabilityFilter !== "all"
							? "Try adjusting your search or filters"
							: "No API providers are configured"}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{filteredProviders.map((provider) => (
						<ProviderCard key={provider.id} provider={provider} onSaved={loadProviders} />
					))}
				</div>
			)}

			{/* Modals */}
			{showModelComparison && (
				<ModelComparisonModal providers={providers} onClose={() => setShowModelComparison(false)} />
			)}
			{showUsageStats && <UsageStatsModal providers={providers} onClose={() => setShowUsageStats(false)} />}
		</div>
	)
}
