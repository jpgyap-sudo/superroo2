"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Activity,
	RefreshCw,
	AlertCircle,
	Search,
	X,
	ChevronDown,
	ChevronRight,
	Info,
	AlertTriangle,
	AlertOctagon,
	CheckCircle2,
	Clock,
	Filter,
} from "lucide-react"

interface EventEntry {
	id: string
	type: string
	source: string
	severity: "info" | "warn" | "error" | "debug"
	message: string
	timestamp: string
	payload?: Record<string, unknown>
}

interface EventsResponse {
	success: boolean
	events: EventEntry[]
	count: number
}

const SEVERITY_OPTIONS = ["all", "info", "debug", "warn", "error"] as const
const LIMIT_OPTIONS = [20, 50, 100, 200]

const SEVERITY_COLORS: Record<string, string> = {
	info: "text-blue-400 bg-blue-400/10 border-blue-400/30",
	debug: "text-gray-400 bg-gray-400/10 border-gray-400/30",
	warn: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
	error: "text-red-400 bg-red-400/10 border-red-400/30",
}

const SEVERITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	info: Info,
	debug: Info,
	warn: AlertTriangle,
	error: AlertOctagon,
}

async function fetchEvents(params: {
	type?: string
	source?: string
	severity?: string
	limit?: number
}): Promise<EventsResponse> {
	const qs = new URLSearchParams()
	if (params.type) qs.set("type", params.type)
	if (params.source) qs.set("source", params.source)
	if (params.severity && params.severity !== "all") qs.set("severity", params.severity)
	if (params.limit) qs.set("limit", String(params.limit))
	const q = qs.toString()
	const res = await fetch(`/api/orchestrator/events${q ? `?${q}` : ""}`)
	return res.json()
}

function EventRow({ event }: { event: EventEntry }) {
	const [expanded, setExpanded] = useState(false)
	const SeverityIcon = SEVERITY_ICONS[event.severity] || Info

	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/40 overflow-hidden">
			<div
				className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#1a1f2e]/30 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				<SeverityIcon
					className={cn(
						"w-3.5 h-3.5 shrink-0",
						event.severity === "error"
							? "text-red-400"
							: event.severity === "warn"
								? "text-yellow-400"
								: event.severity === "info"
									? "text-blue-400"
									: "text-gray-500",
					)}
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span
							className={cn(
								"text-[10px] px-1.5 py-0.5 rounded font-medium border",
								SEVERITY_COLORS[event.severity],
							)}
						>
							{event.severity}
						</span>
						<span className="text-xs text-white truncate">{event.message}</span>
					</div>
					<div className="flex items-center gap-2 mt-0.5">
						<span className="text-[10px] text-gray-600 font-mono">{event.type}</span>
						<span className="text-[10px] text-gray-600">·</span>
						<span className="text-[10px] text-gray-600">{event.source}</span>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-[10px] text-gray-600">
						{new Date(event.timestamp).toLocaleTimeString()}
					</span>
					<div className="text-gray-500">
						{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</div>
				</div>
			</div>
			{expanded && event.payload && (
				<div className="px-4 pb-2 pt-1 border-t border-[#1e2535]">
					<pre className="text-[10px] text-gray-500 font-mono whitespace-pre-wrap overflow-x-auto max-h-32">
						{JSON.stringify(event.payload, null, 2)}
					</pre>
				</div>
			)}
		</div>
	)
}

export function EventsView() {
	const [events, setEvents] = useState<EventEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [severityFilter, setSeverityFilter] = useState<string>("all")
	const [typeFilter, setTypeFilter] = useState("")
	const [limit, setLimit] = useState(50)
	const [autoRefresh, setAutoRefresh] = useState(false)

	const fetchData = useCallback(async () => {
		try {
			setError(null)
			const data = await fetchEvents({
				severity: severityFilter,
				type: typeFilter || undefined,
				limit,
			})
			if (data.success) {
				setEvents(data.events || [])
			} else {
				setError("Failed to fetch events")
			}
		} catch {
			setError("API server unreachable")
		} finally {
			setLoading(false)
		}
	}, [severityFilter, typeFilter, limit])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	// Auto-refresh every 10 seconds
	useEffect(() => {
		if (!autoRefresh) return
		const iv = setInterval(fetchData, 10000)
		return () => clearInterval(iv)
	}, [autoRefresh, fetchData])

	const filtered = useMemo(() => {
		if (!search) return events
		const q = search.toLowerCase()
		return events.filter(
			(e) =>
				e.message.toLowerCase().includes(q) ||
				e.type.toLowerCase().includes(q) ||
				e.source.toLowerCase().includes(q) ||
				e.id.toLowerCase().includes(q),
		)
	}, [events, search])

	const stats = useMemo(() => {
		const total = events.length
		const errors = events.filter((e) => e.severity === "error").length
		const warnings = events.filter((e) => e.severity === "warn").length
		const info = events.filter((e) => e.severity === "info").length
		const uniqueTypes = new Set(events.map((e) => e.type)).size
		return { total, errors, warnings, info, uniqueTypes }
	}, [events])

	const uniqueEventTypes = useMemo(() => {
		return [...new Set(events.map((e) => e.type))].sort()
	}, [events])

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold text-white flex items-center gap-2">
						<Activity size={18} className="text-blue-400" />
						Event Log
					</h1>
					<p className="text-xs text-gray-500 mt-0.5">
						System-wide event log with filtering and severity breakdown
					</p>
				</div>
				<div className="flex items-center gap-2">
					<label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="accent-blue-500"
						/>
						Auto-refresh (10s)
					</label>
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
					>
						<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Total Events"
					value={<><Activity className="inline h-4 w-4 mr-1 text-blue-400" />{stats.total}</>}
				/>
				<StatCard
					label="Errors"
					value={<><AlertOctagon className="inline h-4 w-4 mr-1 text-red-400" />{stats.errors}</>}
				/>
				<StatCard
					label="Warnings"
					value={<><AlertTriangle className="inline h-4 w-4 mr-1 text-yellow-400" />{stats.warnings}</>}
				/>
				<StatCard
					label="Event Types"
					value={<><Filter className="inline h-4 w-4 mr-1 text-purple-400" />{stats.uniqueTypes}</>}
				/>
			</div>

			{/* Filters */}
			<div className="flex items-center gap-3 flex-wrap">
				<div className="relative flex-1 min-w-[200px] max-w-xs">
					<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded pl-8 pr-8 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
						placeholder="Search events..."
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
							<X size={14} />
						</button>
					)}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-gray-500 uppercase tracking-wider">Severity:</span>
					{SEVERITY_OPTIONS.map((s) => (
						<button
							key={s}
							onClick={() => setSeverityFilter(s)}
							className={cn(
								"px-2 py-1 rounded text-[11px] font-medium transition-colors",
								severityFilter === s
									? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
									: "text-gray-500 hover:text-gray-300 border border-transparent",
							)}
						>
							{s}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-gray-500 uppercase tracking-wider">Type:</span>
					<select
						value={typeFilter}
						onChange={(e) => setTypeFilter(e.target.value)}
						className="bg-[#0a0e1a] border border-[#1e2535] rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/50"
					>
						<option value="">All</option>
						{uniqueEventTypes.map((t) => (
							<option key={t} value={t}>{t}</option>
						))}
					</select>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-gray-500 uppercase tracking-wider">Limit:</span>
					<select
						value={limit}
						onChange={(e) => setLimit(Number(e.target.value))}
						className="bg-[#0a0e1a] border border-[#1e2535] rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/50"
					>
						{LIMIT_OPTIONS.map((l) => (
							<option key={l} value={l}>{l}</option>
						))}
					</select>
				</div>
			</div>

			{/* Event List */}
			{loading ? (
				<div className="flex items-center justify-center py-12 text-gray-500">
					<RefreshCw size={20} className="animate-spin mr-2" />
					<span className="text-sm">Loading events...</span>
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-12 text-red-400">
					<AlertCircle size={20} className="mr-2" />
					<span className="text-sm">{error}</span>
				</div>
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-gray-500">
					<Activity size={32} className="mb-2 opacity-50" />
					<p className="text-sm">No events found</p>
					<p className="text-xs mt-1">{search ? "Try a different search or clear filters" : "No events have been recorded yet"}</p>
				</div>
			) : (
				<div className="space-y-1.5">
					<div className="text-xs text-gray-500 mb-1">
						Showing {filtered.length} of {events.length} events
					</div>
					{filtered.map((event) => (
						<EventRow key={event.id} event={event} />
					))}
				</div>
			)}
		</div>
	)
}
