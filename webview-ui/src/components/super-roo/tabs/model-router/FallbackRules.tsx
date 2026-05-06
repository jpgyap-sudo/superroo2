import { useState, useEffect } from "react"
import { modelRouterApi, type FallbackRules as FallbackRulesType } from "../../lib/modelRouterApi"

export function FallbackRules() {
	const [rules, setRules] = useState<FallbackRulesType | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		modelRouterApi
			.fallbackRules()
			.then((res) => setRules(res.fallbackRules))
			.catch(() => {
				// Fall back to defaults if API unavailable
				setRules({
					retryPrimaryOnce: true,
					switchToFallback1AfterRetry: true,
					switchToFallback2AfterFallback1: true,
					switchIfLatencyAboveMs: 10000,
					switchIfQuotaExceeded: true,
					switchIfApiKeyUnavailable: true,
				})
			})
			.finally(() => setLoading(false))
	}, [])

	async function toggle(key: keyof FallbackRulesType) {
		if (!rules) return
		const updated = { [key]: !rules[key] }
		try {
			const res = await modelRouterApi.updateFallbackRules(updated)
			setRules(res.fallbackRules)
		} catch {
			setRules({ ...rules, ...updated })
		}
	}

	const ruleEntries: Array<{ key: keyof FallbackRulesType; label: string }> = [
		{ key: "retryPrimaryOnce", label: "Retry same model once on failure" },
		{ key: "switchToFallback1AfterRetry", label: "Switch to fallback 1 after retry fails" },
		{ key: "switchToFallback2AfterFallback1", label: "Switch to fallback 2 if fallback 1 fails" },
		{ key: "switchIfLatencyAboveMs", label: `Switch if latency > ${rules?.switchIfLatencyAboveMs ?? 10}s` },
		{ key: "switchIfQuotaExceeded", label: "Switch if provider quota exceeded" },
		{ key: "switchIfApiKeyUnavailable", label: "Switch if API key unavailable" },
	]

	if (loading) {
		return (
			<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
				<h2 className="text-lg font-semibold text-vscode-foreground">Fallback Rules</h2>
				<p className="text-sm text-vscode-descriptionForeground">Loading...</p>
			</section>
		)
	}

	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<h2 className="text-lg font-semibold text-vscode-foreground">Fallback Rules</h2>
			<p className="text-sm text-vscode-descriptionForeground">Rules for automatic failover and retries.</p>
			<div className="mt-4 divide-y divide-vscode-panel-border">
				{ruleEntries.map(({ key, label }) => {
					const isBool = typeof rules?.[key] === "boolean"
					const enabled = isBool ? Boolean(rules?.[key]) : true
					return (
						<div
							key={key}
							className="flex items-center justify-between py-3 text-sm text-vscode-foreground">
							<span>{label}</span>
							{isBool && (
								<button
									onClick={() => toggle(key)}
									className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition-colors ${
										enabled ? "bg-green-500" : "bg-vscode-panel-border"
									}`}>
									<span
										className={`h-4 w-4 rounded-full bg-white transition-transform ${
											enabled ? "translate-x-5" : "translate-x-0"
										}`}
									/>
								</button>
							)}
						</div>
					)
				})}
			</div>
		</section>
	)
}
