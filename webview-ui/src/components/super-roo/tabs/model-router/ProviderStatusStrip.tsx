import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react"
import type { ProviderMetadata } from "../../lib/modelRouterApi"

export function ProviderStatusStrip({ providers }: { providers: ProviderMetadata[] }) {
	return (
		<section className="rounded-2xl border border-vscode-panel-border bg-vscode-sideBar-background p-5 shadow-xl">
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold text-vscode-foreground">Provider Status</h2>
					<p className="text-sm text-vscode-descriptionForeground">
						Synced from API Keys tab. Raw keys are never exposed here.
					</p>
				</div>
				<a
					href="/api-keys"
					className="text-sm text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
					View API Keys →
				</a>
			</div>
			<div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
				{providers.map((p) => {
					const tested = p.status === "tested"
					return (
						<div
							key={p.providerId}
							className="rounded-xl border border-vscode-panel-border bg-vscode-editor-background p-4">
							<div className="flex items-center gap-3">
								<div className="rounded-lg bg-vscode-sideBar-background p-2 text-vscode-foreground">
									<KeyRound size={18} />
								</div>
								<div>
									<div className="font-semibold text-vscode-foreground">{p.displayName}</div>
									<div
										className={`mt-1 flex items-center gap-1 text-xs ${tested ? "text-green-400" : "text-amber-400"}`}>
										{tested ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
										{p.status.replace("_", " ")}
									</div>
								</div>
							</div>
							<div className="mt-3 text-xs text-vscode-descriptionForeground">
								{p.models.length} models
							</div>
							{!tested && (
								<a className="mt-2 block text-xs text-vscode-textLink-foreground" href="/api-keys">
									Add/Test key
								</a>
							)}
						</div>
					)
				})}
			</div>
		</section>
	)
}
