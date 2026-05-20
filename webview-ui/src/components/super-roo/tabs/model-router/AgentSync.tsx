export function AgentSync() {
	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<h2 className="text-lg font-semibold text-vscode-foreground">Agent Sync</h2>
			<p className="text-sm text-vscode-descriptionForeground">Map agents to task types and primary models.</p>
			<div className="mt-4 rounded-xl border border-vscode-panel-border bg-vscode-editor-background p-6 text-center text-sm text-vscode-descriptionForeground">
				No agent mappings configured yet.
			</div>
		</section>
	)
}
