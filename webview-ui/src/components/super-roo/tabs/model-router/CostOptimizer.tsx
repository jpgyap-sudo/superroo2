export function CostOptimizer() {
	const rows: [string, string, string][] = [
		["Planning", "Kimi k1.5", "$0.90"],
		["Coding", "DeepSeek V3", "$1.10"],
		["Debugging", "DeepSeek V3", "$1.10"],
		["Crawling", "Groq Mixtral", "$0.27"],
		["Research", "Kimi k1.5", "$0.90"],
	]

	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<h2 className="text-lg font-semibold text-vscode-foreground">Cost Optimizer</h2>
			<p className="text-sm text-vscode-descriptionForeground">
				Estimated monthly spend and optimization insights.
			</p>
			<div className="mt-4 grid gap-4 md:grid-cols-2">
				<div className="rounded-xl border border-vscode-panel-border bg-vscode-editor-background p-4">
					<div className="text-sm text-vscode-descriptionForeground">Estimated Monthly Spend</div>
					<div className="mt-3 text-3xl font-bold text-vscode-foreground">$142.80</div>
					<div className="mt-1 text-xs text-green-400">▼ 18% vs last month</div>
				</div>
				<div className="rounded-xl border border-vscode-panel-border bg-vscode-editor-background p-4">
					<div className="mb-3 text-sm font-semibold text-vscode-foreground">Cheapest Model by Task</div>
					<div className="space-y-2 text-sm">
						{rows.map(([task, model, cost]) => (
							<div key={task} className="flex justify-between">
								<span className="text-vscode-descriptionForeground">{task}</span>
								<span className="text-vscode-foreground">
									{model} <b className="ml-2">{cost}</b>
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-200">
				Some tasks are using expensive models. Review recommendations.
			</div>
		</section>
	)
}
