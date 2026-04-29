import { useMemo, useState } from "react"
import { Bug, ChevronDown, ChevronRight, Filter } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { BugStatusPill, SeverityPill, formatRelative } from "../parts/Pills"
import type { BugSeverity, BugStatus } from "../types"

type SeverityFilter = BugSeverity | "all"
type StatusFilter = BugStatus | "all"

const SEVERITY_OPTIONS: SeverityFilter[] = ["all", "critical", "high", "medium", "low"]
const STATUS_OPTIONS: StatusFilter[] = ["all", "open", "investigating", "fixed", "blocked", "wontfix"]

export function BugsTab() {
	const { bugs } = useSr()
	const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	const filtered = useMemo(() => {
		return bugs.filter((b) => {
			if (severityFilter !== "all" && b.severity !== severityFilter) return false
			if (statusFilter !== "all" && b.status !== statusFilter) return false
			return true
		})
	}, [bugs, severityFilter, statusFilter])

	const toggle = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	return (
		<div className="p-4 flex flex-col gap-3">
			<header className="flex items-center gap-2">
				<Bug className="size-4" />
				<h2 className="text-sm font-semibold">Bugs</h2>
				<span className="text-xs text-vscode-descriptionForeground">
					{filtered.length} of {bugs.length}
				</span>
			</header>

			<div className="flex flex-wrap items-center gap-2 text-xs">
				<Filter className="size-3.5 text-vscode-descriptionForeground" />
				<select
					value={severityFilter}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSeverityFilter(e.target.value as SeverityFilter)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
					{SEVERITY_OPTIONS.map((o) => (
						<option key={o} value={o}>
							severity: {o}
						</option>
					))}
				</select>
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
			</div>

			{filtered.length === 0 ? (
				<div className="text-sm text-vscode-descriptionForeground p-4 text-center border border-vscode-panel-border rounded">
					No bugs match the current filters.
				</div>
			) : (
				<ul className="divide-y divide-vscode-panel-border border border-vscode-panel-border rounded">
					{filtered.map((b) => {
						const isOpen = expanded.has(b.id)
						return (
							<li key={b.id}>
								<button
									type="button"
									onClick={() => toggle(b.id)}
									className="w-full text-left px-3 py-3 hover:bg-vscode-list-hoverBackground flex items-start gap-2">
									{isOpen ? <ChevronDown className="size-4 mt-0.5" /> : <ChevronRight className="size-4 mt-0.5" />}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 flex-wrap">
											<span className="text-sm font-medium truncate">{b.title}</span>
											<SeverityPill severity={b.severity} />
											<BugStatusPill status={b.status} />
											{b.fixAttempts > 0 && (
												<span className="text-xs text-vscode-descriptionForeground">
													{b.fixAttempts} fix attempt{b.fixAttempts === 1 ? "" : "s"}
												</span>
											)}
										</div>
										<div className="text-xs text-vscode-descriptionForeground mt-0.5">
											created {formatRelative(b.createdAt)} · updated {formatRelative(b.updatedAt)}
											{b.deploymentRisk !== "low" && (
												<span className="ml-2 text-orange-300">
													deploy risk: {b.deploymentRisk}
												</span>
											)}
										</div>
									</div>
								</button>
								{isOpen && (
									<div className="px-9 py-3 text-xs flex flex-col gap-2 bg-vscode-editor-background/40 border-t border-vscode-panel-border">
										{b.suspectedRootCause && (
											<DetailRow label="Suspected root cause">{b.suspectedRootCause}</DetailRow>
										)}
										{b.symptoms.length > 0 && (
											<DetailRow label="Symptoms">
												<ul className="list-disc list-inside">
													{b.symptoms.map((s, i) => (
														<li key={i} className="font-mono">{s}</li>
													))}
												</ul>
											</DetailRow>
										)}
										{b.filesLikelyInvolved.length > 0 && (
											<DetailRow label="Files">
												<span className="font-mono">{b.filesLikelyInvolved.join(", ")}</span>
											</DetailRow>
										)}
										{b.reproductionSteps.length > 0 && (
											<DetailRow label="Repro">
												<ol className="list-decimal list-inside">
													{b.reproductionSteps.map((s, i) => (
														<li key={i}>{s}</li>
													))}
												</ol>
											</DetailRow>
										)}
										{b.recommendedFix && (
											<DetailRow label="Recommended fix">{b.recommendedFix}</DetailRow>
										)}
									</div>
								)}
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-vscode-descriptionForeground uppercase tracking-wide text-[10px] font-medium">{label}</div>
			<div className="mt-0.5">{children}</div>
		</div>
	)
}
