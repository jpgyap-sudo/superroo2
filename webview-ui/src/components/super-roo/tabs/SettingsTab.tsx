import { Settings as SettingsIcon, Shield, RefreshCw, AlertTriangle } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { ModePill } from "../parts/Pills"
import type { SafetyMode } from "../types"

const MODES: { value: SafetyMode; label: string; description: string }[] = [
	{ value: "OFF", label: "Off", description: "No autonomous work. Tasks won't dispatch." },
	{ value: "SAFE", label: "Safe", description: "Read-only. Roo can analyze but won't edit files." },
	{ value: "AUTO", label: "Auto", description: "Edit, test, commit. Stage deploys allowed. Production deploy blocked." },
	{
		value: "FULL_AUTONOMOUS",
		label: "Full Autonomous",
		description: "Everything in Auto + production deploys. Use with care.",
	},
]

export function SettingsTab() {
	const { snapshot, mockMode, send, requestRefresh } = useSr()
	const mode: SafetyMode = snapshot?.mode ?? "SAFE"
	const selfImprove = snapshot?.selfImprove ?? false

	return (
		<div className="p-4 flex flex-col gap-4 max-w-2xl">
			<header className="flex items-center gap-2">
				<SettingsIcon className="size-4" />
				<h2 className="text-sm font-semibold">Super Roo settings</h2>
			</header>

			<section className="rounded border border-vscode-panel-border">
				<header className="px-3 py-2 border-b border-vscode-panel-border flex items-center gap-2">
					<Shield className="size-4" />
					<h3 className="text-sm font-medium">Safety mode</h3>
					<div className="ml-auto"><ModePill mode={mode} /></div>
				</header>
				<div className="divide-y divide-vscode-panel-border">
					{MODES.map((m) => (
						<label
							key={m.value}
							className="px-3 py-2 flex items-start gap-3 cursor-pointer hover:bg-vscode-list-hoverBackground">
							<input
								type="radio"
								name="sr-mode"
								checked={mode === m.value}
								onChange={() => send({ type: "superRoo:setMode", mode: m.value })}
								className="mt-1"
							/>
							<div className="flex-1">
								<div className="text-sm font-medium">{m.label}</div>
								<div className="text-xs text-vscode-descriptionForeground">{m.description}</div>
							</div>
						</label>
					))}
				</div>
			</section>

			<section className="rounded border border-vscode-panel-border">
				<header className="px-3 py-2 border-b border-vscode-panel-border flex items-center gap-2">
					<AlertTriangle className="size-4 text-orange-300" />
					<h3 className="text-sm font-medium">Self-improve mode</h3>
				</header>
				<div className="px-3 py-2 flex items-start gap-3">
					<input
						type="checkbox"
						checked={selfImprove}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => send({ type: "superRoo:setSelfImprove", enabled: e.target.checked })}
						className="mt-1"
					/>
					<div className="flex-1">
						<div className="text-sm font-medium">
							Allow Super Roo to modify its own codebase
						</div>
						<div className="text-xs text-vscode-descriptionForeground">
							When OFF (default), the SafetyManager blocks any edits to <span className="font-mono">src/super-roo/</span>.
							Enable only when explicitly running <span className="font-mono">/super_roo_self_improve</span>.
						</div>
					</div>
				</div>
			</section>

			<section className="rounded border border-vscode-panel-border">
				<header className="px-3 py-2 border-b border-vscode-panel-border">
					<h3 className="text-sm font-medium">Maintenance</h3>
				</header>
				<div className="px-3 py-2 flex items-center gap-2">
					<button
						type="button"
						onClick={requestRefresh}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-vscode-panel-border hover:bg-vscode-list-hoverBackground text-xs">
						<RefreshCw className="size-3.5" />
						Refresh dashboard
					</button>
					{mockMode && (
						<span className="text-xs text-yellow-300">
							(Currently showing mock data — extension host not connected.)
						</span>
					)}
				</div>
			</section>

			<section className="text-xs text-vscode-descriptionForeground">
				<p>
					Super Roo schema version 1. Memory: SQLite. Phase 3 dashboard.{" "}
					<span className="font-mono">{snapshot?.running ? "running" : "stopped"}</span>
				</p>
			</section>
		</div>
	)
}
