"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { StatCard, Card } from "@/components/ui/card"
import {
	Package,
	Bug,
	CheckCircle2,
	AlertTriangle,
	Loader2,
	GitCommit,
	Sparkles,
	TrendingUp,
	RefreshCw,
	Search,
	Download,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Feature {
	id: string
	name: string
	status: string
	health: string
	description?: string
}

interface BugItem {
	id: string
	title: string
	status: string
	severity: string
}

interface HermesStats {
	operationCount: number
	memoryEntries: number
	averageDurationMs: number
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function ProductMemoryView() {
	const [features, setFeatures] = useState<Feature[]>([])
	const [bugs, setBugs] = useState<BugItem[]>([])
	const [hermes, setHermes] = useState<HermesStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [featureSearch, setFeatureSearch] = useState("")
	const [bugSearch, setBugSearch] = useState("")

	const fetchAll = useCallback(async () => {
		try {
			const [featuresRes, bugsRes, hermesRes] = await Promise.all([
				fetch("/api/orchestrator/features").then((r) => r.json()),
				fetch("/api/orchestrator/bugs?limit=20").then((r) => r.json()),
				fetch("/api/orchestrator/hermes/stats", { method: "POST" }).then((r) => r.json()),
			])
			setFeatures(Array.isArray(featuresRes) ? featuresRes : featuresRes.features || [])
			setBugs(Array.isArray(bugsRes) ? bugsRes : bugsRes.bugs || [])
			setHermes(hermesRes.success ? hermesRes.stats : hermesRes)
			setError(null)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to fetch product memory")
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [])

	useEffect(() => {
		fetchAll()
		const iv = setInterval(fetchAll, 30000)
		return () => clearInterval(iv)
	}, [fetchAll])

	const handleRefresh = useCallback(() => {
		setRefreshing(true)
		fetchAll()
	}, [fetchAll])

	const filteredFeatures = useMemo(() => {
		if (!featureSearch) return features
		const q = featureSearch.toLowerCase()
		return features.filter(
			(f) => f.name.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q)),
		)
	}, [features, featureSearch])

	const filteredBugs = useMemo(() => {
		if (!bugSearch) return bugs
		const q = bugSearch.toLowerCase()
		return bugs.filter((b) => b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
	}, [bugs, bugSearch])

	const handleExportFeatures = () => {
		const csv = ["name,status,health,description"]
		csv.push(
			...features.map(
				(f) => `"${f.name}","${f.status}","${f.health}","${(f.description || "").replace(/"/g, '""')}"`,
			),
		)
		const blob = new Blob([csv.join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = "product-memory-features.csv"
		a.click()
		URL.revokeObjectURL(url)
	}

	const handleExportBugs = () => {
		const csv = ["id,title,status,severity"]
		csv.push(...bugs.map((b) => `"${b.id}","${b.title.replace(/"/g, '""')}","${b.status}","${b.severity}"`))
		const blob = new Blob([csv.join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = "product-memory-bugs.csv"
		a.click()
		URL.revokeObjectURL(url)
	}

	if (loading && features.length === 0) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-violet-400" />
			</div>
		)
	}

	if (error && features.length === 0) {
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load Product Memory: {error}</p>
				</div>
				<button
					onClick={handleRefresh}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const healthyFeatures = features.filter((f) => f.health === "healthy").length
	const openBugs = bugs.filter((b) => b.status === "open").length
	const criticalBugs = bugs.filter((b) => b.status === "open" && b.severity === "critical").length

	const statusColor = (status: string) => {
		if (status === "healthy" || status === "working")
			return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
		if (status === "degraded") return "bg-amber-500/20 text-amber-300 border-amber-500/30"
		if (status === "failing") return "bg-rose-500/20 text-rose-300 border-rose-500/30"
		return "bg-slate-500/20 text-slate-300 border-slate-500/30"
	}

	const severityColor = (severity: string) => {
		if (severity === "critical") return "bg-rose-500/20 text-rose-300 border-rose-500/30"
		if (severity === "high") return "bg-orange-500/20 text-orange-300 border-orange-500/30"
		if (severity === "medium") return "bg-amber-500/20 text-amber-300 border-amber-500/30"
		return "bg-slate-500/20 text-slate-300 border-slate-500/30"
	}

	return (
		<div className="space-y-6 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold text-slate-100">Product Memory</h2>
					<p className="text-sm text-slate-400">Feature registry, bug tracking, and agent knowledge</p>
				</div>
				<button
					onClick={handleRefresh}
					disabled={refreshing}
					className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800/40 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800/40 disabled:opacity-50 transition-colors">
					<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Features" value={features.length} sub="Registered" />
				<StatCard label="Healthy" value={healthyFeatures} sub="Working well" />
				<StatCard label="Open Bugs" value={openBugs} sub="Needs attention" />
				<StatCard label="Critical" value={criticalBugs} sub="Urgent fixes" />
			</div>

			{hermes && (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<Card className="border-slate-800/40 bg-slate-900/40 p-4">
						<div className="flex items-center gap-2">
							<Sparkles className="h-4 w-4 text-violet-400" />
							<span className="text-sm text-slate-300">Memory Entries</span>
						</div>
						<p className="mt-1 text-2xl font-semibold text-slate-100">{hermes.memoryEntries || 0}</p>
					</Card>
					<Card className="border-slate-800/40 bg-slate-900/40 p-4">
						<div className="flex items-center gap-2">
							<TrendingUp className="h-4 w-4 text-sky-400" />
							<span className="text-sm text-slate-300">Operations</span>
						</div>
						<p className="mt-1 text-2xl font-semibold text-slate-100">{hermes.operationCount || 0}</p>
					</Card>
					<Card className="border-slate-800/40 bg-slate-900/40 p-4">
						<div className="flex items-center gap-2">
							<GitCommit className="h-4 w-4 text-emerald-400" />
							<span className="text-sm text-slate-300">Avg Duration</span>
						</div>
						<p className="mt-1 text-2xl font-semibold text-slate-100">
							{hermes.averageDurationMs > 0 ? `${hermes.averageDurationMs}ms` : "—"}
						</p>
					</Card>
				</div>
			)}

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Card className="border-slate-800/40 bg-slate-900/40 p-5">
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Features</h3>
						<div className="flex items-center gap-2">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
								<input
									type="text"
									value={featureSearch}
									onChange={(e) => setFeatureSearch(e.target.value)}
									placeholder="Search features..."
									className="w-36 rounded border border-slate-800/50 bg-slate-950/50 pl-6 pr-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/50"
								/>
							</div>
							<button
								onClick={handleExportFeatures}
								title="Export CSV"
								className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 transition-colors">
								<Download className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					<div className="max-h-80 space-y-2 overflow-y-auto">
						{filteredFeatures.length === 0 && (
							<p className="text-sm text-slate-500">
								{featureSearch ? "No features match your search." : "No features registered yet."}
							</p>
						)}
						{filteredFeatures.slice(0, 20).map((f) => (
							<div
								key={f.id}
								className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-3 py-2">
								<div className="min-w-0">
									<p className="truncate text-sm text-slate-200">{f.name}</p>
									{f.description && (
										<p className="truncate text-xs text-slate-500">{f.description}</p>
									)}
								</div>
								<span
									className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border ${statusColor(f.health)}`}>
									{f.status}
								</span>
							</div>
						))}
					</div>
				</Card>

				<Card className="border-slate-800/40 bg-slate-900/40 p-5">
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Recent Bugs</h3>
						<div className="flex items-center gap-2">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
								<input
									type="text"
									value={bugSearch}
									onChange={(e) => setBugSearch(e.target.value)}
									placeholder="Search bugs..."
									className="w-36 rounded border border-slate-800/50 bg-slate-950/50 pl-6 pr-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/50"
								/>
							</div>
							<button
								onClick={handleExportBugs}
								title="Export CSV"
								className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 transition-colors">
								<Download className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					<div className="max-h-80 space-y-2 overflow-y-auto">
						{filteredBugs.length === 0 && (
							<p className="text-sm text-slate-500">
								{bugSearch ? "No bugs match your search." : "No bugs reported."}
							</p>
						)}
						{filteredBugs.slice(0, 20).map((b) => (
							<div
								key={b.id}
								className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-3 py-2">
								<p className="min-w-0 truncate text-sm text-slate-200">{b.title}</p>
								<span
									className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border ${severityColor(b.severity)}`}>
									{b.severity}
								</span>
							</div>
						))}
					</div>
				</Card>
			</div>
		</div>
	)
}
