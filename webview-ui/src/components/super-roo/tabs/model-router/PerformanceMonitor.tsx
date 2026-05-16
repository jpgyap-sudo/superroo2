import type { UsageSummaryEntry } from "../../lib/modelRouterApi"

export function PerformanceMonitor({ usage = [] }: { usage: UsageSummaryEntry[] }) {
	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold text-vscode-foreground">Performance Monitor</h2>
					<p className="text-sm text-vscode-descriptionForeground">
						Real-time model performance from the last 7 days.
					</p>
				</div>
				<a className="text-sm text-vscode-textLink-foreground" href="/logs">
					View All Metrics →
				</a>
			</div>
			<table className="w-full text-left text-sm">
				<thead className="text-xs uppercase text-vscode-descriptionForeground">
					<tr>
						<th className="py-2">Model</th>
						<th>Latency</th>
						<th>Success</th>
						<th>Error</th>
						<th>Tokens</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-vscode-panel-border text-vscode-foreground">
					{usage.slice(0, 6).map((u) => (
						<tr key={`${u.providerId}:${u.modelId}`}>
							<td className="py-2 text-vscode-foreground">{u.modelLabel}</td>
							<td>{(u.latencyAvgMs / 1000).toFixed(2)}s</td>
							<td className="text-green-400">{u.successRate}%</td>
							<td className="text-red-400">{u.errorRate}%</td>
							<td>{u.tokensAvg}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}
