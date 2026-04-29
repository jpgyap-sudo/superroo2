import { useMemo, useState } from "react"
import { Filter, Layers } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { FeatureStatusPill, HealthPill, PriorityPill, formatRelative } from "../parts/Pills"
import type { FeatureHealth, FeatureStatus } from "../types"

type StatusFilter = FeatureStatus | "all"
type HealthFilter = FeatureHealth | "all"

const STATUS_OPTIONS: StatusFilter[] = [
	"all",
	"planned",
	"building",
	"testing",
	"working",
	"suspected_bug",
	"broken",
	"fixed",
	"deprecated",
]
const HEALTH_OPTIONS: HealthFilter[] = ["all", "unknown", "healthy", "degraded", "failing"]

export function FeaturesTab() {
	const { features } = useSr()
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
	const [healthFilter, setHealthFilter] = useState<HealthFilter>("all")
	const [search, setSearch] = useState("")

	const filtered = useMemo(() => {
		return features.filter((f) => {
			if (statusFilter !== "all" && f.status !== statusFilter) return false
			if (healthFilter !== "all" && f.health !== healthFilter) return false
			if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false
			return true
		})
	}, [features, statusFilter, healthFilter, search])

	return (
		<div className="p-4 flex flex-col gap-3">
			<header className="flex items-center gap-2">
				<Layers className="size-4" />
				<h2 className="text-sm font-semibold">Features</h2>
				<span className="text-xs text-vscode-descriptionForeground">
					{filtered.length} of {features.length}
				</span>
			</header>

			<div className="flex flex-wrap items-center gap-2 text-xs">
				<Filter className="size-3.5 text-vscode-descriptionForeground" />

				<select
					value={statusFilter}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as StatusFilter)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
					{STATUS_OPTIONS.map((o) => (
						<option key={o} value={o}>
							status: {o}
						</option>
					))}
				</select>

				<select
					value={healthFilter}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHealthFilter(e.target.value as HealthFilter)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
					{HEALTH_OPTIONS.map((o) => (
						<option key={o} value={o}>
							health: {o}
						</option>
					))}
				</select>

				<input
					type="text"
					placeholder="filter by name…"
					value={search}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 flex-1 min-w-[160px]"
				/>
			</div>

			{filtered.length === 0 ? (
				<div className="text-sm text-vscode-descriptionForeground p-4 text-center border border-vscode-panel-border rounded">
					No features match the current filters.
				</div>
			) : (
				<ul className="divide-y divide-vscode-panel-border border border-vscode-panel-border rounded">
					{filtered.map((f) => (
						<li key={f.id} className="px-3 py-3 flex flex-col gap-1.5">
							<div className="flex items-center gap-2 flex-wrap">
								<span className="font-medium">{f.name}</span>
								<FeatureStatusPill status={f.status} />
								<HealthPill health={f.health} />
								<PriorityPill priority={f.priority} />
								{f.fixAttempts > 0 && (
									<span className="text-xs text-vscode-descriptionForeground">
										{f.fixAttempts} fix attempt{f.fixAttempts === 1 ? "" : "s"}
									</span>
								)}
							</div>
							{f.description && (
								<div className="text-xs text-vscode-descriptionForeground">{f.description}</div>
							)}
							<div className="text-xs text-vscode-descriptionForeground flex flex-wrap gap-x-3 gap-y-0.5">
								<span>owner: {f.ownerAgent}</span>
								<span>updated {formatRelative(f.updatedAt)}</span>
								{f.lastCheckedAt && <span>checked {formatRelative(f.lastCheckedAt)}</span>}
								{f.bugIds.length > 0 && <span>{f.bugIds.length} linked bug(s)</span>}
							</div>
							{f.relatedFiles.length > 0 && (
								<div className="text-xs font-mono text-vscode-descriptionForeground">
									{f.relatedFiles.join(", ")}
								</div>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
