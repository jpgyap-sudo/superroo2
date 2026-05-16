import { Pencil, Plus, Shuffle } from "lucide-react"
import type { ModelRoute, ProviderMetadata } from "../../lib/modelRouterApi"

const taskLabel: Record<string, string> = {
	planning: "Planning",
	coding: "Coding",
	debugging: "Debugging",
	crawling: "Crawling",
	research: "Research",
	testing: "Testing",
	deployment: "Deployment",
	architecture: "Architecture",
	fast_fix: "Fast Fixes",
}

function ModelSelect({ value, providers }: { value: string; providers: ProviderMetadata[] }) {
	return (
		<select className="w-full rounded-lg border border-vscode-panel-border bg-vscode-editor-background px-3 py-2 text-sm text-vscode-foreground">
			{providers.flatMap((p) =>
				p.models.map((m) => (
					<option
						key={`${p.providerId}:${m.id}`}
						value={`${p.providerId}:${m.id}`}
						disabled={p.status !== "tested"}>
						{m.label} ({p.displayName}){p.status !== "tested" ? " — unavailable" : ""}
					</option>
				)),
			)}
		</select>
	)
}

export function RouteTable({ routes, providers }: { routes: ModelRoute[]; providers: ProviderMetadata[] }) {
	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background shadow-xl">
			<div className="flex items-center justify-between border-b border-vscode-panel-border p-5">
				<div>
					<h2 className="text-lg font-semibold text-vscode-foreground">Routing Matrix</h2>
					<p className="text-sm text-vscode-descriptionForeground">
						Define which model handles each task type.
					</p>
				</div>
				<button className="inline-flex items-center gap-2 rounded-lg bg-vscode-button-background px-4 py-2 text-sm font-medium text-vscode-button-foreground hover:opacity-90">
					<Plus size={16} /> Add Route
				</button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead className="bg-vscode-editor-background text-xs uppercase text-vscode-descriptionForeground">
						<tr>
							<th className="px-4 py-3">Task Type</th>
							<th className="px-4 py-3">Primary Model</th>
							<th className="px-4 py-3">Fallback 1</th>
							<th className="px-4 py-3">Fallback 2</th>
							<th className="px-4 py-3">Enabled</th>
							<th className="px-4 py-3">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-vscode-panel-border">
						{routes.map((r) => (
							<tr key={r.id} className="text-vscode-foreground">
								<td className="px-4 py-3 font-medium text-vscode-foreground">
									{taskLabel[r.taskType] ?? r.taskType}
								</td>
								<td className="px-4 py-3">
									<ModelSelect
										value={`${r.primaryProvider}:${r.primaryModel}`}
										providers={providers}
									/>
								</td>
								<td className="px-4 py-3">
									<ModelSelect
										value={`${r.fallbackProvider1}:${r.fallbackModel1}`}
										providers={providers}
									/>
								</td>
								<td className="px-4 py-3">
									<ModelSelect
										value={`${r.fallbackProvider2}:${r.fallbackModel2}`}
										providers={providers}
									/>
								</td>
								<td className="px-4 py-3">
									<span className="inline-flex h-6 w-11 items-center rounded-full bg-green-500 p-1">
										<span className="h-4 w-4 translate-x-5 rounded-full bg-white" />
									</span>
								</td>
								<td className="px-4 py-3">
									<div className="flex gap-3 text-vscode-descriptionForeground">
										<Pencil size={16} className="cursor-pointer hover:text-vscode-foreground" />
										<Shuffle size={16} className="cursor-pointer hover:text-vscode-foreground" />
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}
