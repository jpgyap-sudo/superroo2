import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, AlertCircle, BarChart3, CheckCircle2, Filter, RefreshCw, Search, Server } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { formatRelative } from "../parts/Pills"

const LEVEL_COLORS: Record<string, string> = {
	info: "text-blue-400",
	warn: "text-yellow-400",
	error: "text-red-400",
	debug: "text-gray-400",
}

const LEVEL_BG: Record<string, string> = {
	info: "bg-blue-500/10 border-blue-500/30",
	warn: "bg-yellow-500/10 border-yellow-500/30",
	error: "bg-red-500/10 border-red-500/30",
	debug: "bg-gray-500/10 border-gray-500/30",
}

const REQUEST_TIMEOUT_MS = 10000

export function VpsHealthTab() {
	const { send, vpsStats, vpsLogs, vpsTotal } = useSr()
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [levelFilter, setLevelFilter] = useState("")
	const [sourceFilter, setSourceFilter] = useState("")
	const [search, setSearch] = useState("")
	const [limit, setLimit] = useState(50)
	const [offset, setOffset] = useState(0)
	const [view, setView] = useState<"overview" | "logs">("overview")
	const expectingRef = useRef(false)

	const fetchData = useCallback(() => {
		setLoading(true)
		setError(null)
		expectingRef.current = true

		// Fetch stats
		send({ type: "superRoo:getVpsAggregatedStats" })

		// Fetch logs
		send({
			type: "superRoo:getVpsAggregatedLogs",
			limit,
			offset,
			level: levelFilter || undefined,
			source: sourceFilter || undefined,
			search: search || undefined,
		})
	}, [send, limit, offset, levelFilter, sourceFilter, search])

	// Initial fetch
	useEffect(() => {
		fetchData()
	}, [fetchData])

	// Clear loading when data arrives from context
	useEffect(() => {
		if (!expectingRef.current) return
		expectingRef.current = false
		setLoading(false)
	}, [vpsLogs, vpsStats])

	// Timeout: if the extension host never replies, clear loading and show error
	useEffect(() => {
		if (!loading) return
		const id = setTimeout(() => {
			expectingRef.current = false
			setLoading(false)
			setError("Request timed out. The extension host did not respond.")
		}, REQUEST_TIMEOUT_MS)
		return () => clearTimeout(id)
	}, [loading])

	const totalPages = Math.ceil(vpsTotal / limit)
	const currentPage = Math.floor(offset / limit) + 1

	return (
		<div className="p-4 flex flex-col gap-4 h-full">
			{/* Header */}
			<header className="flex items-center gap-2">
				<Server className="size-4" />
				<h2 className="text-sm font-semibold">VPS Health</h2>
				<button
					type="button"
					onClick={fetchData}
					disabled={loading}
					className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-vscode-panel-border hover:bg-vscode-list-hoverBackground disabled:opacity-50">
					<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</header>

			{/* View toggle */}
			<div className="flex gap-1 text-xs">
				<button
					type="button"
					onClick={() => setView("overview")}
					className={`px-3 py-1.5 rounded border ${
						view === "overview"
							? "bg-vscode-list-activeBackground border-vscode-focusBorder text-vscode-foreground"
							: "border-vscode-panel-border text-vscode-descriptionForeground hover:text-vscode-foreground"
					}`}>
					<BarChart3 className="size-3.5 inline mr-1" />
					Overview
				</button>
				<button
					type="button"
					onClick={() => setView("logs")}
					className={`px-3 py-1.5 rounded border ${
						view === "logs"
							? "bg-vscode-list-activeBackground border-vscode-focusBorder text-vscode-foreground"
							: "border-vscode-panel-border text-vscode-descriptionForeground hover:text-vscode-foreground"
					}`}>
					<Activity className="size-3.5 inline mr-1" />
					Logs
				</button>
			</div>

			{error && (
				<div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
					<AlertCircle className="size-3.5 inline mr-1" />
					{error}
				</div>
			)}

			{view === "overview" && (
				<>
					{loading && !vpsStats ? (
						<div className="p-4 text-sm text-vscode-descriptionForeground text-center">
							<RefreshCw className="size-4 inline animate-spin mr-2" />
							Loading VPS health overview…
						</div>
					) : !vpsStats ? (
						<div className="p-4 text-sm text-vscode-descriptionForeground text-center">
							No VPS health data available.
						</div>
					) : (
						<>
							{/* Stat cards */}
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<StatCard
									icon={<Activity className="size-4 text-blue-400" />}
									label="Total Entries"
									value={vpsStats.total.toLocaleString()}
								/>
								<StatCard
									icon={<CheckCircle2 className="size-4 text-green-400" />}
									label="Last 24h"
									value={vpsStats.last24h.toLocaleString()}
								/>
								<StatCard
									icon={<AlertCircle className="size-4 text-red-400" />}
									label="Errors (24h)"
									value={vpsStats.errors24h.toLocaleString()}
								/>
								<StatCard
									icon={<BarChart3 className="size-4 text-purple-400" />}
									label="Sources"
									value={vpsStats.sourceDistribution.length}
								/>
							</div>

							{/* Level distribution */}
							<section className="rounded border border-vscode-panel-border">
								<header className="px-3 py-2 border-b border-vscode-panel-border flex items-center gap-2">
									<Filter className="size-4" />
									<h3 className="text-sm font-medium">Level Distribution</h3>
								</header>
								<div className="p-3 space-y-2">
									{vpsStats.levelDistribution.map((d) => {
										const pct =
											vpsStats.total > 0 ? ((d.count / vpsStats.total) * 100).toFixed(1) : "0"
										return (
											<div key={d.level} className="flex items-center gap-2 text-xs">
												<span className={`w-12 font-medium ${LEVEL_COLORS[d.level] || ""}`}>
													{d.level.toUpperCase()}
												</span>
												<div className="flex-1 h-4 rounded bg-vscode-input-background overflow-hidden">
													<div
														className={`h-full rounded transition-all ${
															d.level === "error"
																? "bg-red-500/60"
																: d.level === "warn"
																	? "bg-yellow-500/60"
																	: d.level === "debug"
																		? "bg-gray-500/40"
																		: "bg-blue-500/40"
														}`}
														style={{ width: `${pct}%` }}
													/>
												</div>
												<span className="w-24 text-right text-vscode-descriptionForeground">
													{d.count.toLocaleString()} ({pct}%)
												</span>
											</div>
										)
									})}
								</div>
							</section>

							{/* Source distribution */}
							<section className="rounded border border-vscode-panel-border">
								<header className="px-3 py-2 border-b border-vscode-panel-border flex items-center gap-2">
									<Server className="size-4" />
									<h3 className="text-sm font-medium">Source Distribution</h3>
								</header>
								<div className="p-3 space-y-2">
									{vpsStats.sourceDistribution.slice(0, 10).map((d) => {
										const pct =
											vpsStats.total > 0 ? ((d.count / vpsStats.total) * 100).toFixed(1) : "0"
										return (
											<div key={d.source} className="flex items-center gap-2 text-xs">
												<span className="w-28 truncate font-medium">{d.source}</span>
												<div className="flex-1 h-4 rounded bg-vscode-input-background overflow-hidden">
													<div
														className="h-full rounded bg-cyan-500/40 transition-all"
														style={{ width: `${pct}%` }}
													/>
												</div>
												<span className="w-24 text-right text-vscode-descriptionForeground">
													{d.count.toLocaleString()} ({pct}%)
												</span>
											</div>
										)
									})}
								</div>
							</section>
						</>
					)}
				</>
			)}

			{view === "logs" && (
				<>
					{/* Filters */}
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<Filter className="size-3.5 text-vscode-descriptionForeground" />
						<select
							value={levelFilter}
							onChange={(e) => {
								setLevelFilter(e.target.value)
								setOffset(0)
							}}
							className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
							<option value="">All levels</option>
							<option value="debug">debug</option>
							<option value="info">info</option>
							<option value="warn">warn</option>
							<option value="error">error</option>
						</select>
						<select
							value={sourceFilter}
							onChange={(e) => {
								setSourceFilter(e.target.value)
								setOffset(0)
							}}
							className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
							<option value="">All sources</option>
							{vpsStats?.sourceDistribution.map((d) => (
								<option key={d.source} value={d.source}>
									{d.source}
								</option>
							))}
						</select>
						<div className="relative flex-1 min-w-[160px]">
							<Search className="absolute left-2 top-1.5 size-3.5 text-vscode-descriptionForeground" />
							<input
								type="text"
								placeholder="Search messages…"
								value={search}
								onChange={(e) => {
									setSearch(e.target.value)
									setOffset(0)
								}}
								className="w-full pl-7 pr-2 py-1 text-xs rounded border border-vscode-panel-border bg-vscode-input-background text-vscode-input-foreground placeholder:text-vscode-input-placeholder focus:outline-none focus:border-vscode-focusBorder"
							/>
						</div>
						<select
							value={limit}
							onChange={(e) => {
								setLimit(Number(e.target.value))
								setOffset(0)
							}}
							className="bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1">
							<option value={25}>25</option>
							<option value={50}>50</option>
							<option value={100}>100</option>
						</select>
					</div>

					{/* Pagination */}
					{vpsTotal > 0 && (
						<div className="flex items-center justify-between text-xs text-vscode-descriptionForeground">
							<span>
								{vpsTotal.toLocaleString()} total — Page {currentPage} of {totalPages || 1}
							</span>
							<div className="flex gap-1">
								<button
									type="button"
									disabled={offset <= 0}
									onClick={() => setOffset(Math.max(0, offset - limit))}
									className="px-2 py-1 rounded border border-vscode-panel-border hover:bg-vscode-list-hoverBackground disabled:opacity-40">
									Prev
								</button>
								<button
									type="button"
									disabled={offset + limit >= vpsTotal}
									onClick={() => setOffset(offset + limit)}
									className="px-2 py-1 rounded border border-vscode-panel-border hover:bg-vscode-list-hoverBackground disabled:opacity-40">
									Next
								</button>
							</div>
						</div>
					)}

					{/* Log table */}
					<div className="flex-1 min-h-0 overflow-auto border border-vscode-panel-border rounded font-mono text-xs">
						{loading && vpsLogs.length === 0 ? (
							<div className="p-4 text-sm text-vscode-descriptionForeground text-center">
								<RefreshCw className="size-4 inline animate-spin mr-2" />
								Loading VPS logs…
							</div>
						) : vpsLogs.length === 0 ? (
							<div className="p-4 text-sm text-vscode-descriptionForeground text-center">
								No logs match the current filters.
							</div>
						) : (
							<table className="w-full">
								<tbody>
									{vpsLogs.map((e) => (
										<tr key={e.id} className="border-b border-vscode-panel-border last:border-b-0">
											<td className="px-2 py-1 text-vscode-descriptionForeground whitespace-nowrap align-top">
												{e.timestamp ? formatRelative(new Date(e.timestamp).getTime()) : "—"}
											</td>
											<td className="px-2 py-1 align-top">
												<span
													className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${
														LEVEL_BG[e.level || ""] || "bg-gray-500/10 border-gray-500/30"
													} ${LEVEL_COLORS[e.level || ""] || ""}`}>
													{(e.level || "?").toUpperCase()}
												</span>
											</td>
											<td className="px-2 py-1 align-top text-vscode-descriptionForeground">
												{e.source || "—"}
											</td>
											<td className="px-2 py-1 align-top break-words max-w-md">
												<span className="text-vscode-foreground">{e.message || "—"}</span>
												{e.service && (
													<span className="ml-2 text-vscode-descriptionForeground">
														[{e.service}]
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</>
			)}
		</div>
	)
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
	return (
		<div className="rounded border border-vscode-panel-border p-3 flex flex-col gap-1">
			<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
				{icon}
				<span>{label}</span>
			</div>
			<span className="text-lg font-semibold">{value}</span>
		</div>
	)
}
