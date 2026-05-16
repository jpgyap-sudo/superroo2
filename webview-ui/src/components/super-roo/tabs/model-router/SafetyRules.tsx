import { useState, useEffect } from "react"
import { modelRouterApi, type SafetyRules as SafetyRulesType } from "../../lib/modelRouterApi"

export function SafetyRules() {
	const [rules, setRules] = useState<SafetyRulesType | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		modelRouterApi
			.safetyRules()
			.then((res) => setRules(res.safetyRules))
			.catch(() => {
				// Fall back to defaults if API unavailable
				setRules({
					requireDeploymentApproval: true,
					requireExpensiveModelApproval: true,
					expensiveModelUsdPerMTok: 5,
					requireLongRunningTaskApproval: true,
					longRunningTaskMinutes: 30,
					blockUntestedProviders: true,
				})
			})
			.finally(() => setLoading(false))
	}, [])

	async function toggle(key: keyof SafetyRulesType) {
		if (!rules) return
		const val = rules[key]
		if (typeof val !== "boolean") return
		const updated = { [key]: !val }
		try {
			const res = await modelRouterApi.updateSafetyRules(updated)
			setRules(res.safetyRules)
		} catch {
			setRules({ ...rules, ...updated })
		}
	}

	const cards: Array<{ key: keyof SafetyRulesType; title: string; desc: string }> = [
		{
			key: "requireDeploymentApproval",
			title: "Deployment Approval",
			desc: "Require approval for deployment tasks.",
		},
		{
			key: "requireExpensiveModelApproval",
			title: "Expensive Model Approval",
			desc: `Require approval for models above $${rules?.expensiveModelUsdPerMTok?.toFixed(2) ?? "5.00"} per 1M tokens.`,
		},
		{
			key: "requireLongRunningTaskApproval",
			title: "Long Running Tasks",
			desc: `Require approval for tasks longer than ${rules?.longRunningTaskMinutes ?? 30} minutes.`,
		},
		{
			key: "blockUntestedProviders",
			title: "Block Untested Providers",
			desc: "Prevent usage of providers without tested API keys.",
		},
	]

	if (loading) {
		return (
			<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
				<h2 className="text-lg font-semibold text-vscode-foreground">Safety & Approval Rules</h2>
				<p className="text-sm text-vscode-descriptionForeground">Loading...</p>
			</section>
		)
	}

	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<h2 className="text-lg font-semibold text-vscode-foreground">Safety & Approval Rules</h2>
			<p className="text-sm text-vscode-descriptionForeground">
				Control safety and approval requirements for model usage.
			</p>
			<div className="mt-4 grid gap-4 md:grid-cols-4">
				{cards.map(({ key, title, desc }) => {
					const enabled = rules ? Boolean(rules[key]) : false
					return (
						<div
							key={key}
							className="rounded-xl border border-vscode-panel-border bg-vscode-editor-background p-4">
							<div className="font-semibold text-vscode-foreground">{title}</div>
							<p className="mt-2 min-h-12 text-sm text-vscode-descriptionForeground">{desc}</p>
							<button
								onClick={() => toggle(key)}
								className={`mt-4 inline-flex h-6 w-11 items-center rounded-full p-1 transition-colors ${
									enabled ? "bg-green-500" : "bg-vscode-panel-border"
								}`}>
								<span
									className={`h-4 w-4 rounded-full bg-white transition-transform ${
										enabled ? "translate-x-5" : "translate-x-0"
									}`}
								/>
							</button>
						</div>
					)
				})}
			</div>
		</section>
	)
}
