"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Search,
	X,
	Globe,
	Plus,
	Trash2,
	RefreshCw,
	Activity,
	FileText,
	AlertCircle,
	Zap,
	Link2,
	Database,
	Play,
} from "lucide-react"

interface CrawlerSource {
	id: string
	url: string
	type: string
	label?: string
	interval?: number
	lastCrawled?: string
	enabled?: boolean
}

interface CrawlerSignal {
	id: string
	sourceId: string
	type: string
	label: string
	confidence: number
	timestamp: string
}

interface CrawlerStats {
	totalSources: number
	totalDocuments: number
	totalSignals: number
	lastCrawl?: string
	activeCrawls: number
}

interface SourcesResponse {
	success: boolean
	sources: CrawlerSource[]
}

interface SignalsResponse {
	success: boolean
	signals: CrawlerSignal[]
}

interface StatsResponse {
	success: boolean
	stats: CrawlerStats
}

interface CrawlResponse {
	success: boolean
	documents: unknown[]
	count: number
}

async function fetchSources(): Promise<SourcesResponse> {
	const res = await fetch("/api/orchestrator/crawler/sources")
	return res.json()
}

async function addSource(data: { url: string; type: string; label?: string }): Promise<{ success: boolean }> {
	const res = await fetch("/api/orchestrator/crawler/sources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	})
	return res.json()
}

async function removeSource(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/orchestrator/crawler/sources/${id}`, { method: "DELETE" })
	return res.json()
}

async function triggerCrawl(sourceId: string): Promise<CrawlResponse> {
	const res = await fetch(`/api/orchestrator/crawler/crawl/${sourceId}`, { method: "POST" })
	return res.json()
}

async function fetchSignals(): Promise<SignalsResponse> {
	const res = await fetch("/api/orchestrator/crawler/signals")
	return res.json()
}

async function fetchStats(): Promise<StatsResponse> {
	const res = await fetch("/api/orchestrator/crawler/stats")
	return res.json()
}

function SourceCard({
	source,
	onCrawl,
	onDelete,
	crawling,
}: {
	source: CrawlerSource
	onCrawl: (id: string) => void
	onDelete: (id: string) => void
	crawling: boolean
}) {
	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 p-3 hover:border-[#2a3040] transition-colors">
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<Globe size={14} className="text-blue-400 shrink-0" />
						<span className="text-sm font-medium text-white truncate">{source.label || source.url}</span>
					</div>
					<p className="text-xs text-gray-500 mt-1 truncate font-mono">{source.url}</p>
					<div className="flex items-center gap-3 mt-1.5">
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e2535] text-gray-400">{source.type}</span>
						{source.lastCrawled && (
							<span className="text-[10px] text-gray-600">
								Last: {new Date(source.lastCrawled).toLocaleString()}
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={() => onCrawl(source.id)}
						disabled={crawling}
						className="p-1.5 rounded hover:bg-[#1e2535] text-gray-500 hover:text-green-400 disabled:opacity-40 transition-colors"
						title="Crawl now"
					>
						<Play size={14} />
					</button>
					<button
						onClick={() => onDelete(source.id)}
						className="p-1.5 rounded hover:bg-[#1e2535] text-gray-500 hover:text-red-400 transition-colors"
						title="Remove source"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>
		</div>
	)
}

function AddSourceForm({
	onAdd,
	onCancel,
}: {
	onAdd: (data: { url: string; type: string; label?: string }) => Promise<void>
	onCancel: () => void
}) {
	const [url, setUrl] = useState("")
	const [type, setType] = useState("web")
	const [label, setLabel] = useState("")
	const [saving, setSaving] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!url.trim()) return
		setSaving(true)
		await onAdd({ url: url.trim(), type, label: label.trim() || undefined })
		setSaving(false)
	}

	return (
		<form onSubmit={handleSubmit} className="border border-[#1e2535] rounded-lg bg-[#0f1117]/80 p-4 mb-4">
			<h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
				<Plus size={14} className="text-green-400" />
				Add Crawl Source
			</h3>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2">
					<label className="text-xs text-gray-500 mb-1 block">URL *</label>
					<input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="https://example.com/docs"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Type *</label>
					<select
						value={type}
						onChange={(e) => setType(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					>
						<option value="web">Web</option>
						<option value="github">GitHub</option>
						<option value="docs">Documentation</option>
						<option value="api">API</option>
						<option value="rss">RSS Feed</option>
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Label</label>
					<input
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="Optional label"
					/>
				</div>
			</div>
			<div className="flex gap-2 mt-3">
				<button
					type="submit"
					disabled={saving || !url.trim()}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
				>
					<Plus size={12} />
					{saving ? "Adding..." : "Add Source"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white transition-colors"
				>
					Cancel
				</button>
			</div>
		</form>
	)
}

export function CrawlerView() {
	const [sources, setSources] = useState<CrawlerSource[]>([])
	const [signals, setSignals] = useState<CrawlerSignal[]>([])
	const [stats, setStats] = useState<CrawlerStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [showAdd, setShowAdd] = useState(false)
	const [crawlingId, setCrawlingId] = useState<string | null>(null)
	const [crawlResult, setCrawlResult] = useState<string | null>(null)

	const fetchData = useCallback(async () => {
		try {
			setError(null)
			const [sourcesRes, signalsRes, statsRes] = await Promise.all([
				fetchSources(),
				fetchSignals(),
				fetchStats(),
			])
			if (sourcesRes.success) setSources(sourcesRes.sources || [])
			if (signalsRes.success) setSignals(signalsRes.signals || [])
			if (statsRes.success) setStats(statsRes.stats)
		} catch (err) {
			setError("API server unreachable")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	const filteredSources = useMemo(() => {
		if (!search) return sources
		const q = search.toLowerCase()
		return sources.filter(
			(s) =>
				s.url.toLowerCase().includes(q) ||
				(s.label || "").toLowerCase().includes(q) ||
				s.type.toLowerCase().includes(q),
		)
	}, [sources, search])

	const handleAdd = async (data: { url: string; type: string; label?: string }) => {
		const result = await addSource(data)
		if (result.success) {
			setShowAdd(false)
			fetchData()
		}
	}

	const handleDelete = async (id: string) => {
		if (!confirm("Remove this crawl source?")) return
		const result = await removeSource(id)
		if (result.success) fetchData()
	}

	const handleCrawl = async (sourceId: string) => {
		setCrawlingId(sourceId)
		setCrawlResult(null)
		try {
			const result = await triggerCrawl(sourceId)
			if (result.success) {
				setCrawlResult(`Crawl complete: ${result.count} documents`)
				fetchData()
			} else {
				setCrawlResult("Crawl failed")
			}
		} catch {
			setCrawlResult("Crawl error")
		} finally {
			setCrawlingId(null)
		}
	}

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold text-white flex items-center gap-2">
						<Globe size={18} className="text-blue-400" />
						Crawler Agent
					</h1>
					<p className="text-xs text-gray-500 mt-0.5">
						Manage crawl sources, trigger crawls, and view extracted signals
					</p>
				</div>
				<button
					onClick={() => setShowAdd(!showAdd)}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
				>
					<Plus size={14} />
					Add Source
				</button>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Sources"
					value={<><Globe className="inline h-4 w-4 mr-1 text-blue-400" />{stats?.totalSources ?? sources.length}</>}
				/>
				<StatCard
					label="Documents"
					value={<><FileText className="inline h-4 w-4 mr-1 text-green-400" />{stats?.totalDocuments ?? 0}</>}
				/>
				<StatCard
					label="Signals"
					value={<><Zap className="inline h-4 w-4 mr-1 text-yellow-400" />{stats?.totalSignals ?? signals.length}</>}
				/>
				<StatCard
					label="Active Crawls"
					value={<><Activity className="inline h-4 w-4 mr-1 text-purple-400" />{stats?.activeCrawls ?? 0}</>}
				/>
			</div>

			{/* Crawl Result Toast */}
			{crawlResult && (
				<div className="flex items-center gap-2 px-3 py-2 rounded bg-green-900/20 border border-green-500/30 text-green-400 text-xs">
					<Zap size={14} />
					{crawlResult}
					<button onClick={() => setCrawlResult(null)} className="ml-auto text-gray-500 hover:text-white">
						<X size={14} />
					</button>
				</div>
			)}

			{/* Add Source Form */}
			{showAdd && <AddSourceForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} />}

			{/* Search */}
			<div className="relative max-w-xs">
				<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded pl-8 pr-8 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
					placeholder="Search sources..."
				/>
				{search && (
					<button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
						<X size={14} />
					</button>
				)}
			</div>

			{/* Sources Section */}
			<div>
				<h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
					<Link2 size={14} className="text-gray-400" />
					Crawl Sources
					<span className="text-xs text-gray-600 font-normal">({filteredSources.length})</span>
				</h2>
				{loading ? (
					<div className="flex items-center justify-center py-8 text-gray-500">
						<RefreshCw size={20} className="animate-spin mr-2" />
						<span className="text-sm">Loading sources...</span>
					</div>
				) : error ? (
					<div className="flex items-center justify-center py-8 text-red-400">
						<AlertCircle size={20} className="mr-2" />
						<span className="text-sm">{error}</span>
					</div>
				) : filteredSources.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-gray-500">
						<Globe size={28} className="mb-2 opacity-50" />
						<p className="text-sm">No sources found</p>
						<p className="text-xs mt-1">{search ? "Try a different search" : "Add a crawl source to get started"}</p>
					</div>
				) : (
					<div className="space-y-2">
						{filteredSources.map((source) => (
							<SourceCard
								key={source.id}
								source={source}
								onCrawl={handleCrawl}
								onDelete={handleDelete}
								crawling={crawlingId === source.id}
							/>
						))}
					</div>
				)}
			</div>

			{/* Signals Section */}
			<div>
				<h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
					<Database size={14} className="text-gray-400" />
					Extracted Signals
					<span className="text-xs text-gray-600 font-normal">({signals.length})</span>
				</h2>
				{signals.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-gray-500 border border-dashed border-[#1e2535] rounded-lg">
						<Zap size={24} className="mb-1 opacity-50" />
						<p className="text-xs">No signals extracted yet. Crawl a source to generate signals.</p>
					</div>
				) : (
					<div className="space-y-1.5">
						{signals.slice(0, 50).map((signal) => (
							<div
								key={signal.id}
								className="flex items-center gap-3 px-3 py-2 rounded border border-[#1e2535] bg-[#0f1117]/40"
							>
								<Zap size={12} className="text-yellow-400 shrink-0" />
								<div className="flex-1 min-w-0">
									<span className="text-xs text-white">{signal.label}</span>
									<span className="text-[10px] text-gray-600 ml-2">({signal.type})</span>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<div className="text-[10px] text-gray-500">
										{(signal.confidence * 100).toFixed(0)}%
									</div>
									<div className="w-16 h-1.5 rounded-full bg-[#1e2535] overflow-hidden">
										<div
											className="h-full rounded-full transition-all"
											style={{
												width: `${signal.confidence * 100}%`,
												backgroundColor:
													signal.confidence > 0.7
														? "#22c55e"
														: signal.confidence > 0.4
															? "#eab308"
															: "#ef4444",
											}}
										/>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
