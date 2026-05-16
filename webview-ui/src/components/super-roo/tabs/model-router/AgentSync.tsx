export function AgentSync() {
	const rows: [string, string, string][] = [
		["PM Agent", "Planning", "GPT-4o"],
		["Coder Agent", "Coding", "Claude Sonnet 4"],
		["Debugger Agent", "Debugging", "DeepSeek V3"],
		["Crawler Agent", "Crawling", "Llama 3.3 70B"],
		["Research Agent", "Research", "Kimi Latest"],
		["Deploy Agent", "Deployment", "Claude Sonnet 4"],
	]

	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<h2 className="text-lg font-semibold text-vscode-foreground">Agent Sync</h2>
			<p className="text-sm text-vscode-descriptionForeground">Map agents to task types and primary models.</p>
			<div className="mt-4 space-y-3">
				{rows.map(([agent, task, model]) => (
					<div key={agent} className="grid grid-cols-3 gap-3 text-sm">
						<div className="text-vscode-foreground">{agent}</div>
						<select className="rounded-lg border border-vscode-panel-border bg-vscode-editor-background px-3 py-2 text-vscode-foreground">
							<option>{task}</option>
						</select>
						<select className="rounded-lg border border-vscode-panel-border bg-vscode-editor-background px-3 py-2 text-vscode-foreground">
							<option>{model}</option>
						</select>
					</div>
				))}
			</div>
		</section>
	)
}
