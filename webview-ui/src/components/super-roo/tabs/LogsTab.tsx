import { useEffect, useMemo, useRef, useState } from "react"
import { ScrollText, Filter, Pause, Play } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { LevelText, formatRelative } from "../parts/Pills"
import type { EventLevel } from "../types"

type LevelFilter = EventLevel | "all"
const LEVEL_OPTIONS: LevelFilter[] = ["all", "debug", "info", "warn", "error"]

export function LogsTab() {
	const { events } = useSr()
	const [levelFilter, setLevelFilter] = useState<LevelFilter>("all")
	const [search, setSearch] = useState("")
	const [autoScroll, setAutoScroll] = useState(true)
	const containerRef = useRef<HTMLDivElement | null>(null)

	const filtered = useMemo(() => {
		return events.filter((e) => {
			if (levelFilter !== "all" && e.level !== levelFilter) return false
			if (search) {
				const haystack = `${e.type} ${e.message}`.toLowerCase()
				if (!haystack.includes(search.toLowerCase())) return false
			}
			return true
		})
	}, [events, levelFilter, search])

	useEffect(() => {
		if (!autoScroll) return
		containerRef.current?.scrollTo({ top: 0 })
	}, [filtered, autoScroll])

	return (
		<div className="p-4 flex flex-col gap-3 h-full">
			<header className="flex items-center gap-2">
				<ScrollText className="size-4" />
				<h2 className="text-sm font-semibold">Logs</h2>
				<span className="text-xs text-vscode-descriptionForeground">
					{filtered.length} of {events.length}
				</span>
			</header>

			<div className="flex flex-wrap items-center gap-2 text-xs">
				<Filter className="size-3.5 text-vscode-descriptionForeground" />
				<select
					value={levelFilter}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLevelFilter(e.target.value as LevelFilter)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
					{LEVEL_OPTIONS.map((o) => (
						<option key={o} value={o}>
							level: {o}
						</option>
					))}
				</select>
				<input
					type="text"
					placeholder="filter by type or message…"
					value={search}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
					className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 flex-1 min-w-[160px]"
				/>
				<button
					type="button"
					onClick={() => setAutoScroll((v) => !v)}
					className="inline-flex items-center gap-1 px-2 py-1 rounded border border-vscode-panel-border hover:bg-vscode-list-hoverBackground">
					{autoScroll ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
					{autoScroll ? "Pause" : "Resume"}
				</button>
			</div>

			<div
				ref={containerRef}
				className="flex-1 min-h-0 overflow-auto border border-vscode-panel-border rounded font-mono text-xs">
				{filtered.length === 0 ? (
					<div className="p-4 text-sm text-vscode-descriptionForeground text-center">
						No events match the current filters.
					</div>
				) : (
					<table className="w-full">
						<tbody>
							{filtered.map((e) => (
								<tr key={e.id} className="border-b border-vscode-panel-border last:border-b-0">
									<td className="px-2 py-1 text-vscode-descriptionForeground whitespace-nowrap align-top">
										{formatRelative(e.at)}
									</td>
									<td className="px-2 py-1 align-top">
										<LevelText level={e.level}>{e.level.toUpperCase()}</LevelText>
									</td>
									<td className="px-2 py-1 align-top text-vscode-descriptionForeground">
										{e.type}
									</td>
									<td className="px-2 py-1 align-top break-words">
										<span className="text-vscode-foreground">{e.message}</span>
										{e.agent && (
											<span className="ml-2 text-vscode-descriptionForeground">[{e.agent}]</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}
