import { useState, useMemo, useEffect, useCallback } from "react"
import { Search, CheckCircle2, AlertTriangle, Bug, FlaskConical, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSr } from "../hooks/SrContext"

interface ProductFeature {
	id: string
	name: string
	category: string
	description: string
	status: "working" | "needs_test" | "broken" | "planned" | "deprecated"
	confidence: number
	ownerAgent: string
	relatedFiles: string[]
	lastTestedAt: string | null
	knownBugs: string[]
	testChecklist: string[]
}

const STATUS_FILTERS = [
	{ value: "all", label: "All" },
	{ value: "working", label: "Working" },
	{ value: "needs_test", label: "Needs Test" },
	{ value: "broken", label: "Broken" },
	{ value: "planned", label: "Planned" },
	{ value: "deprecated", label: "Deprecated" },
] as const

const STATUS_COLORS: Record<string, string> = {
	working: "text-green-400 bg-green-500/10 border-green-500/30",
	needs_test: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
	broken: "text-red-400 bg-red-500/10 border-red-500/30",
	planned: "text-blue-400 bg-blue-500/10 border-blue-500/30",
	deprecated: "text-gray-400 bg-gray-500/10 border-gray-500/30",
}

export function ProductFeaturesTab() {
	const { send } = useSr()
	const [features, setFeatures] = useState<ProductFeature[]>([])
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState("all")
	const [loading, setLoading] = useState(true)

	const loadFeatures = useCallback(async () => {
		setLoading(true)
		try {
			// In a real implementation, the extension host would push product memory
			// data via superRoo:productMemory messages. For now, use empty state.
			setFeatures([])
		} catch {
			setFeatures([])
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadFeatures()
	}, [loadFeatures])

	const visible = useMemo(() => {
		return features.filter((f) => {
			if (statusFilter !== "all" && f.status !== statusFilter) return false
			if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false
			return true
		})
	}, [features, search, statusFilter])

	if (loading) {
		return (
			<div className="p-6 text-vscode-descriptionForeground">
				<div className="flex items-center gap-2">
					<RefreshCw className="size-4 animate-spin" />
					<span>Loading product features…</span>
				</div>
			</div>
		)
	}

	return (
		<div className="p-4 flex flex-col gap-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Product Features</h2>
				<span className="text-xs text-vscode-descriptionForeground">
					{features.length} feature{features.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Search + Filters */}
			<div className="flex flex-col gap-2">
				<div className="relative">
					<Search className="absolute left-2.5 top-2.5 size-4 text-vscode-descriptionForeground" />
					<input
						type="text"
						placeholder="Search features…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full pl-8 pr-3 py-2 text-sm rounded border border-vscode-panel-border bg-vscode-input-background text-vscode-input-foreground placeholder:text-vscode-input-placeholder focus:outline-none focus:border-vscode-focusBorder"
					/>
				</div>
				<div className="flex gap-1.5 flex-wrap">
					{STATUS_FILTERS.map(({ value, label }) => (
						<button
							key={value}
							type="button"
							onClick={() => setStatusFilter(value)}
							className={cn(
								"px-2.5 py-1 text-xs rounded-full border transition-colors",
								statusFilter === value
									? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background"
									: "border-vscode-panel-border text-vscode-descriptionForeground hover:text-vscode-foreground",
							)}>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Feature cards */}
			{visible.length === 0 && (
				<div className="text-sm text-vscode-descriptionForeground text-center py-8">
					{features.length === 0
						? "No features registered yet. Use the Product Feature Agent to add features."
						: "No features match the current filters."}
				</div>
			)}
			<div className="flex flex-col gap-3">
				{visible.map((feature) => (
					<div
						key={feature.id}
						className="rounded border border-vscode-panel-border bg-vscode-sideBar-background overflow-hidden">
						{/* Header */}
						<div className="px-3 py-2 flex items-start justify-between gap-2 border-b border-vscode-panel-border">
							<div className="min-w-0">
								<div className="text-sm font-medium truncate">{feature.name}</div>
								<div className="text-xs text-vscode-descriptionForeground mt-0.5">
									{feature.category}
								</div>
							</div>
							<span
								className={cn(
									"shrink-0 px-2 py-0.5 text-xs rounded-full border",
									STATUS_COLORS[feature.status] || STATUS_COLORS.planned,
								)}>
								{feature.status.replace("_", " ")}
							</span>
						</div>

						{/* Body */}
						<div className="px-3 py-2 space-y-2">
							<p className="text-xs text-vscode-descriptionForeground">{feature.description}</p>

							{/* Meta row */}
							<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-vscode-descriptionForeground">
								<span>Confidence: {feature.confidence}%</span>
								<span>Owner: {feature.ownerAgent}</span>
								{feature.lastTestedAt && (
									<span>Last tested: {new Date(feature.lastTestedAt).toLocaleDateString()}</span>
								)}
							</div>

							{/* Test checklist */}
							{feature.testChecklist.length > 0 && (
								<div>
									<div className="text-xs font-medium text-vscode-descriptionForeground mb-1">
										Test Checklist ({feature.testChecklist.length})
									</div>
									<ul className="space-y-0.5">
										{feature.testChecklist.map((item, i) => (
											<li
												key={i}
												className="text-xs text-vscode-descriptionForeground flex items-start gap-1.5">
												<span className="mt-0.5">•</span>
												<span>{item}</span>
											</li>
										))}
									</ul>
								</div>
							)}

							{/* Known bugs */}
							{feature.knownBugs.length > 0 && (
								<div className="flex items-center gap-1.5 text-xs text-red-400">
									<Bug className="size-3" />
									<span>
										{feature.knownBugs.length} known bug{feature.knownBugs.length !== 1 ? "s" : ""}
									</span>
								</div>
							)}

							{/* Action buttons */}
							<div className="flex gap-2 pt-1">
								<button
									type="button"
									onClick={() => {
										send({
											type: "superRoo:productMemory",
											action: "testFeature",
											featureId: feature.id,
											result: "pass",
										})
									}}
									className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">
									<CheckCircle2 className="size-3" />
									Mark Pass
								</button>
								<button
									type="button"
									onClick={() => {
										send({
											type: "superRoo:productMemory",
											action: "testFeature",
											featureId: feature.id,
											result: "warning",
										})
									}}
									className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
									<FlaskConical className="size-3" />
									Needs Test
								</button>
								<button
									type="button"
									onClick={() => {
										send({
											type: "superRoo:productMemory",
											action: "testFeature",
											featureId: feature.id,
											result: "fail",
										})
									}}
									className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
									<AlertTriangle className="size-3" />
									Send to Debugger
								</button>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
