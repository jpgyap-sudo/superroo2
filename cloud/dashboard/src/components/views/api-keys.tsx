"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type ProviderStatus = "missing" | "connected" | "invalid" | "not_tested"

type ProviderModel = {
	id: string
	label: string
	contextWindow: number
	supportsImages: boolean
	supportsTools: boolean
	bestFor: string[]
}

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

function statusClass(status: ProviderStatus) {
	if (status === "connected") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
	if (status === "invalid") return "bg-red-500/15 text-red-300 border-red-500/25"
	if (status === "not_tested") return "bg-sky-500/15 text-sky-300 border-sky-500/25"
	return "bg-amber-500/15 text-amber-300 border-amber-500/25"
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return (
		<span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>
			{children}
		</span>
	)
}

function getAuthHeaders(): Record<string, string> {
	const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
	return token ? { Authorization: `Bearer ${token}` } : {}
}

function ProviderCard({ provider, onSaved }: { provider: Provider; onSaved: () => void }) {
	const [apiKey, setApiKey] = useState("")
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showConfig, setShowConfig] = useState(false)
	const [configModel, setConfigModel] = useState(provider.defaultModel || "")
	const [configBaseUrl, setConfigBaseUrl] = useState(provider.apiBaseUrl || "")
	const [configSaving, setConfigSaving] = useState(false)

	async function saveKey() {
		if (!apiKey.trim()) return
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(`/api/settings/providers/${provider.id}/key`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify({ apiKey, test: true }),
			})
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || `HTTP ${res.status}`)
			}
			setApiKey("")
			onSaved()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save key")
		} finally {
			setSaving(false)
		}
	}

	async function testKey() {
		setTesting(true)
		setError(null)
		try {
			const res = await fetch(`/api/settings/providers/${provider.id}/test`, {
				method: "POST",
				headers: getAuthHeaders(),
			})
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || `HTTP ${res.status}`)
			}
			onSaved()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Test failed")
		} finally {
			setTesting(false)
		}
	}

	async function deleteKey() {
		setDeleting(true)
		setError(null)
		try {
			const res = await fetch(`/api/settings/providers/${provider.id}/key`, {
				method: "DELETE",
				headers: getAuthHeaders(),
			})
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || `HTTP ${res.status}`)
			}
			onSaved()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete key")
		} finally {
			setDeleting(false)
		}
	}

	async function saveConfig() {
		setConfigSaving(true)
		setError(null)
		try {
			const body: Record<string, string> = {}
			if (configModel !== provider.defaultModel) body.defaultModel = configModel
			if (configBaseUrl !== provider.apiBaseUrl) body.apiBaseUrl = configBaseUrl
			if (Object.keys(body).length === 0) {
				setShowConfig(false)
				return
			}
			const res = await fetch(`/api/settings/providers/${provider.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...getAuthHeaders() },
				body: JSON.stringify(body),
			})
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || `HTTP ${res.status}`)
			}
			setShowConfig(false)
			onSaved()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save configuration")
		} finally {
			setConfigSaving(false)
		}
	}

	return (
		<div className="rounded-2xl border border-[#1e2535] bg-[#0e1322] p-5 shadow-xl shadow-black/20">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<h3 className="text-base font-bold text-[#e2e8f0]">{provider.name}</h3>
						<Pill className={statusClass(provider.status)}>{provider.status}</Pill>
					</div>
					<p className="mt-1 text-xs text-gray-500">{provider.description}</p>
				</div>
			</div>

			<div className="space-y-4">
				<label className="block">
					<span className="mb-1.5 block text-xs font-semibold text-gray-400">API Key</span>
					<input
						type="password"
						placeholder={provider.hasKey ? "••••••••••••••••" : "Paste API key here"}
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						className="w-full rounded-xl border border-[#1e2535] bg-[#0a0e1a] px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-sky-500"
					/>
				</label>

				{/* Current config summary */}
				<div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
					<span className="rounded-md border border-[#1e2535] bg-[#0a0e1a] px-2 py-1">
						Model: <span className="text-sky-300">{provider.defaultModel}</span>
					</span>
					<span className="rounded-md border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 max-w-[300px] truncate">
						API: <span className="text-sky-300">{provider.apiBaseUrl}</span>
					</span>
				</div>

				{provider.capabilities.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{provider.capabilities.map((cap) => (
							<Pill key={cap} className="border-slate-600/40 bg-slate-700/40 text-slate-300">
								{cap}
							</Pill>
						))}
					</div>
				)}

				{provider.lastTestedAt && (
					<div className="text-xs text-gray-500">
						Last tested: {new Date(provider.lastTestedAt).toLocaleString()}
						{provider.latencyMs !== null && ` · ${provider.latencyMs}ms`}
					</div>
				)}

				{error && (
					<div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
						{error}
					</div>
				)}

				{/* Configure panel (collapsible) */}
				{showConfig && (
					<div className="rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-4 space-y-3">
						<p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Configuration</p>

						<label className="block">
							<span className="mb-1 block text-xs text-gray-500">API Base URL</span>
							<input
								type="url"
								value={configBaseUrl}
								onChange={(e) => setConfigBaseUrl(e.target.value)}
								placeholder="https://api.openai.com/v1"
								className="w-full rounded-lg border border-[#1e2535] bg-[#0e1322] px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-sky-500 font-mono"
							/>
						</label>

						<label className="block">
							<span className="mb-1 block text-xs text-gray-500">Default Model</span>
							<select
								value={configModel}
								onChange={(e) => setConfigModel(e.target.value)}
								className="w-full rounded-lg border border-[#1e2535] bg-[#0e1322] px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-sky-500 appearance-none">
								{provider.models.map((m) => (
									<option key={m} value={m}>
										{provider.modelLabels?.[m] || m}
									</option>
								))}
							</select>
						</label>

						<div className="flex gap-2 pt-1">
							<button
								onClick={saveConfig}
								disabled={configSaving}
								className="flex-1 rounded-lg bg-sky-500 px-3 py-2 text-xs font-bold text-white hover:bg-sky-400 disabled:opacity-40">
								{configSaving ? "Saving..." : "Save Config"}
							</button>
							<button
								onClick={() => setShowConfig(false)}
								className="rounded-lg border border-[#1e2535] px-3 py-2 text-xs text-[#e2e8f0] hover:bg-[#1e2535]">
								Cancel
							</button>
						</div>
					</div>
				)}

				<div className="grid grid-cols-4 gap-2 pt-1">
					<button
						onClick={saveKey}
						disabled={saving || !apiKey}
						className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white hover:bg-sky-400 disabled:opacity-40">
						{saving ? "Saving..." : "Save"}
					</button>
					<button
						onClick={testKey}
						disabled={testing || !provider.hasKey}
						className="rounded-xl border border-[#1e2535] px-3 py-2 text-xs text-[#e2e8f0] hover:bg-[#1e2535] disabled:opacity-40">
						{testing ? "Testing..." : "Test"}
					</button>
					<button
						onClick={deleteKey}
						disabled={deleting || !provider.hasKey}
						className="rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40">
						{deleting ? "Removing..." : "Remove"}
					</button>
					<button
						onClick={() => {
							setConfigModel(provider.defaultModel || "")
							setConfigBaseUrl(provider.apiBaseUrl || "")
							setShowConfig(!showConfig)
						}}
						className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
							showConfig
								? "border-sky-500/40 bg-sky-500/10 text-sky-300"
								: "border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
						}`}>
						{showConfig ? "Close" : "Config"}
					</button>
				</div>
			</div>
		</div>
	)
}

export function ApiKeysView() {
	const [providers, setProviders] = useState<Provider[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	async function loadProviders() {
		setLoading(true)
		setError(null)
		try {
			const res = await fetch("/api/settings/providers", { headers: getAuthHeaders() })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			setProviders(data.providers ?? [])
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load providers")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadProviders()
	}, [])

	return (
		<div className="text-[#e2e8f0]">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<div className="text-xs uppercase tracking-[0.25em] text-gray-500">API Configuration</div>
					<h1 className="mt-1 text-2xl font-bold">Providers & Secret Vault</h1>
					<p className="mt-1 text-sm text-gray-500">
						Store provider keys securely, test connections, and sync models into agent routing.
					</p>
				</div>
				<div className="flex gap-2">
					<button
						onClick={loadProviders}
						className="rounded-xl border border-[#1e2535] px-4 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535]">
						Refresh
					</button>
				</div>
			</div>

			<div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
				<p className="font-bold text-amber-200">Security rule</p>
				<p className="mt-1 text-sm text-amber-100/70">
					Raw keys are sent once to the backend. After saving, the UI only receives masked metadata. Keys are
					encrypted at rest using AES-256-GCM.
				</p>
			</div>

			{error && (
				<div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
					{error}
				</div>
			)}

			{loading ? (
				<div className="rounded-2xl border border-[#1e2535] bg-[#0e1322] p-6 text-gray-400">
					Loading providers...
				</div>
			) : providers.length === 0 ? (
				<div className="rounded-2xl border border-[#1e2535] bg-[#0e1322] p-6 text-gray-400">
					No providers configured.
				</div>
			) : (
				<div className="grid gap-4 xl:grid-cols-2">
					{providers.map((provider) => (
						<ProviderCard key={provider.id} provider={provider} onSaved={loadProviders} />
					))}
				</div>
			)}
		</div>
	)
}
