import { useState } from "react"
import {
	Key,
	RefreshCw,
	Trash2,
	CheckCircle,
	XCircle,
	AlertCircle,
	HelpCircle,
	Shield,
	Globe,
	Cpu,
	Zap,
	Brain,
	Network,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSr } from "../../hooks/SrContext"
import type { SrProviderEntry } from "../../hooks/SrContext"

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	openai: Brain,
	anthropic: Shield,
	deepseek: Cpu,
	kimi: Globe,
	openrouter: Network,
	groq: Zap,
}

function statusIcon(status: string) {
	switch (status) {
		case "connected":
			return <CheckCircle className="size-3.5 text-green-400" />
		case "invalid":
			return <XCircle className="size-3.5 text-red-400" />
		case "missing":
			return <HelpCircle className="size-3.5 text-slate-500" />
		case "not_tested":
			return <AlertCircle className="size-3.5 text-amber-400" />
		default:
			return <HelpCircle className="size-3.5 text-slate-500" />
	}
}

function statusLabel(status: string): string {
	switch (status) {
		case "connected":
			return "Connected"
		case "invalid":
			return "Invalid Key"
		case "missing":
			return "No Key"
		case "not_tested":
			return "Not Tested"
		default:
			return status
	}
}

function statusColor(status: string): string {
	switch (status) {
		case "connected":
			return "bg-green-500/10 text-green-400 border-green-500/20"
		case "invalid":
			return "bg-red-500/10 text-red-400 border-red-500/20"
		case "missing":
			return "bg-slate-500/10 text-slate-400 border-slate-500/20"
		case "not_tested":
			return "bg-amber-500/10 text-amber-400 border-amber-500/20"
		default:
			return "bg-slate-500/10 text-slate-400 border-slate-500/20"
	}
}

// ── Component ────────────────────────────────────────────────────────────────

export function ApiKeysProvidersTab() {
	const { providers, send } = useSr()
	const [editingKey, setEditingKey] = useState<string | null>(null)
	const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
	const [testingId, setTestingId] = useState<string | null>(null)
	const [savingId, setSavingId] = useState<string | null>(null)

	async function handleSaveKey(providerId: string) {
		const apiKey = keyInputs[providerId]
		if (!apiKey) return

		setSavingId(providerId)
		send({ type: "superRoo:saveProviderKey", providerId, apiKey, test: true })
		setKeyInputs((prev) => ({ ...prev, [providerId]: "" }))
		setEditingKey(null)
		setSavingId(null)
	}

	async function handleTestKey(providerId: string) {
		setTestingId(providerId)
		send({ type: "superRoo:testProviderKey", providerId })
		setTestingId(null)
	}

	async function handleRemoveKey(providerId: string) {
		send({ type: "superRoo:removeProviderKey", providerId })
	}

	if (providers.length === 0) {
		return <div className="p-6 text-sm text-vscode-descriptionForeground">No providers loaded.</div>
	}

	return (
		<div className="p-6 space-y-6">
			<header>
				<h2 className="text-lg font-semibold text-vscode-foreground">API Keys & Providers</h2>
				<p className="text-sm text-vscode-descriptionForeground mt-1">
					Manage your AI provider API keys. Keys are encrypted at rest and never exposed after saving.
				</p>
			</header>

			<div className="grid gap-4">
				{providers.map((provider: SrProviderEntry) => {
					const Icon = PROVIDER_ICONS[provider.id] || Shield
					const isEditing = editingKey === provider.id
					const isTesting = testingId === provider.id
					const isSaving = savingId === provider.id

					return (
						<div
							key={provider.id}
							className="rounded-lg border border-vscode-panel-border bg-vscode-sideBar-background overflow-hidden">
							<div className="p-4">
								<div className="flex items-start justify-between">
									<div className="flex items-start gap-3">
										<div className="mt-0.5">
											<Icon className="size-5 text-vscode-foreground" />
										</div>
										<div>
											<div className="flex items-center gap-2">
												<h3 className="font-medium text-vscode-foreground">{provider.name}</h3>
												<span
													className={cn(
														"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
														statusColor(provider.status),
													)}>
													{statusIcon(provider.status)}
													{statusLabel(provider.status)}
												</span>
												{provider.latencyMs !== null && (
													<span className="text-[10px] text-vscode-descriptionForeground">
														{provider.latencyMs}ms
													</span>
												)}
											</div>
											<p className="text-xs text-vscode-descriptionForeground mt-0.5">
												{provider.description}
											</p>
										</div>
									</div>
								</div>

								{/* Models */}
								<div className="mt-3 flex flex-wrap gap-1.5">
									{provider.models.map((model) => (
										<span
											key={model}
											className="px-2 py-0.5 rounded text-[10px] font-mono bg-vscode-editor-background text-vscode-descriptionForeground border border-vscode-panel-border">
											{model}
										</span>
									))}
								</div>

								{/* Capabilities */}
								<div className="mt-2 flex flex-wrap gap-1.5">
									{provider.capabilities.map((cap) => (
										<span
											key={cap}
											className="px-1.5 py-0.5 rounded text-[10px] bg-vscode-input-background text-vscode-descriptionForeground">
											{cap}
										</span>
									))}
								</div>

								{/* Key input / actions */}
								<div className="mt-4 flex items-center gap-2">
									{isEditing ? (
										<div className="flex items-center gap-2 flex-1">
											<input
												type="password"
												placeholder="sk-..."
												value={keyInputs[provider.id] ?? ""}
												onChange={(e) =>
													setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))
												}
												className="flex-1 px-3 py-1.5 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground placeholder:text-vscode-input-placeholder focus:outline-none focus:border-vscode-focusBorder"
											/>
											<button
												type="button"
												disabled={isSaving || !keyInputs[provider.id]}
												onClick={() => handleSaveKey(provider.id)}
												className="px-3 py-1.5 rounded text-xs font-medium bg-vscode-button-background text-vscode-button-foreground hover:opacity-90 disabled:opacity-50">
												{isSaving ? "Saving..." : "Save & Test"}
											</button>
											<button
												type="button"
												onClick={() => {
													setEditingKey(null)
													setKeyInputs((prev) => ({ ...prev, [provider.id]: "" }))
												}}
												className="px-3 py-1.5 rounded text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
												Cancel
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2">
											{provider.hasKey ? (
												<>
													<button
														type="button"
														disabled={isTesting}
														onClick={() => handleTestKey(provider.id)}
														className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-vscode-button-background text-vscode-button-foreground hover:opacity-90 disabled:opacity-50">
														<RefreshCw
															className={cn("size-3", isTesting && "animate-spin")}
														/>
														{isTesting ? "Testing..." : "Test"}
													</button>
													<button
														type="button"
														onClick={() => handleRemoveKey(provider.id)}
														className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-vscode-descriptionForeground hover:text-red-400 border border-vscode-panel-border hover:border-red-400/30">
														<Trash2 className="size-3" />
														Remove
													</button>
												</>
											) : (
												<button
													type="button"
													onClick={() => setEditingKey(provider.id)}
													className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-vscode-button-background text-vscode-button-foreground hover:opacity-90">
													<Key className="size-3" />
													Add Key
												</button>
											)}
										</div>
									)}
								</div>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
