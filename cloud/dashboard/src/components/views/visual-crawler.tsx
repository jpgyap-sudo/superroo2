"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
	Eye,
	Play,
	RefreshCw,
	CheckCircle,
	XCircle,
	AlertTriangle,
	Image,
	FileText,
	ChevronRight,
	Plus,
	Trash2,
	Search,
	Calendar,
	BarChart3,
	GitBranch,
	ShieldCheck,
	Wand2,
	Columns2,
	SlidersHorizontal,
	Clock,
	ChevronLeft,
	ChevronsLeft,
	ChevronsRight,
	Download,
	Upload,
	ToggleLeft,
	ToggleRight,
	Zap,
} from "lucide-react"

interface CrawlReportSummary {
	crawlId: string
	projectName?: string
	url: string
	timestamp: string
	viewportsTested: number
	issuesFound: number
}

interface CrawlResult {
	viewportName: string
	width: number
	height: number
	colorScheme: string
	baselinePath: string | null
	currentPath: string
	diffPath: string | null
	comparison: { match: boolean; diffPixels: number; diffPercent: number } | null
	analysis: { summary: string; severity: string; isBug: boolean; details: string; suggestedFix: string } | null
}

interface CrawlReportDetail {
	crawlId: string
	projectName?: string
	url: string
	timestamp: string
	viewportsTested: number
	issuesFound: number
	results: CrawlResult[]
}

interface ProjectEntry {
	name: string
	label: string
	baseUrl: string
	authToken?: string
	pages: { id: string; label: string }[]
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: "passed" | "failed" | "partial" }) {
	const map = {
		passed: { text: "Passed", className: "bg-[#3fb95011] text-[#3fb950]" },
		failed: { text: "Failed", className: "bg-[#f8514911] text-[#f85149]" },
		partial: { text: "Partial", className: "bg-[#d2992211] text-[#d29922]" },
	}
	const s = map[status]
	return <span className={`px-1.5 py-0.5 text-[9px] rounded ${s.className}`}>{s.text}</span>
}

function SeverityDot({ severity }: { severity: string }) {
	const color =
		severity === "critical"
			? "#f85149"
			: severity === "high"
				? "#ff7b72"
				: severity === "medium"
					? "#d29922"
					: severity === "low"
						? "#58a6ff"
						: "#3fb950"
	return <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
}

// ─── Screenshot viewer with diff overlay ────────────────────────────
function ScreenshotViewer({
	result,
	onAcceptBaseline,
	onRejectBaseline,
}: {
	result: CrawlResult
	onAcceptBaseline?: () => void
	onRejectBaseline?: () => void
}) {
	const [viewMode, setViewMode] = useState<"current" | "baseline" | "diff" | "side-by-side">("current")
	const [sliderPos, setSliderPos] = useState(50)
	const sliderRef = useRef<HTMLDivElement>(null)

	const hasBaseline = !!result.baselinePath
	const hasDiff = !!result.diffPath

	const handleSliderMouseDown = (e: React.MouseEvent) => {
		e.preventDefault()
		const startX = e.clientX
		const startPos = sliderPos

		const onMove = (ev: MouseEvent) => {
			if (!sliderRef.current) return
			const rect = sliderRef.current.getBoundingClientRect()
			const pct = ((ev.clientX - rect.left) / rect.width) * 100
			setSliderPos(Math.max(0, Math.min(100, pct)))
		}

		const onUp = () => {
			document.removeEventListener("mousemove", onMove)
			document.removeEventListener("mouseup", onUp)
		}

		document.addEventListener("mousemove", onMove)
		document.addEventListener("mouseup", onUp)
	}

	return (
		<div className="space-y-2">
			{/* View mode selector */}
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={() => setViewMode("current")}
					className={`px-2 py-1 text-[10px] rounded transition-colors ${
						viewMode === "current"
							? "bg-[#1f6feb] text-white"
							: "bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
					}`}>
					Current
				</button>
				{hasBaseline && (
					<button
						type="button"
						onClick={() => setViewMode("baseline")}
						className={`px-2 py-1 text-[10px] rounded transition-colors ${
							viewMode === "baseline"
								? "bg-[#1f6feb] text-white"
								: "bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
						}`}>
						Baseline
					</button>
				)}
				{hasDiff && (
					<button
						type="button"
						onClick={() => setViewMode("diff")}
						className={`px-2 py-1 text-[10px] rounded transition-colors ${
							viewMode === "diff"
								? "bg-[#1f6feb] text-white"
								: "bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
						}`}>
						Diff
					</button>
				)}
				{hasBaseline && (
					<button
						type="button"
						onClick={() => setViewMode("side-by-side")}
						className={`px-2 py-1 text-[10px] rounded transition-colors ${
							viewMode === "side-by-side"
								? "bg-[#1f6feb] text-white"
								: "bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3]"
						}`}>
						<Columns2 className="w-3 h-3 inline mr-1" />
						Side by Side
					</button>
				)}
			</div>

			{/* Screenshot display */}
			<div className="relative bg-[#0a0e1a] rounded border border-[#1e2535] overflow-hidden" ref={sliderRef}>
				{viewMode === "current" && result.currentPath && (
					<img
						src={result.currentPath}
						alt={`Current: ${result.viewportName}`}
						className="w-full h-auto max-h-[400px] object-contain"
						onError={(e) => {
							;(e.target as HTMLImageElement).style.display = "none"
						}}
					/>
				)}
				{viewMode === "baseline" && result.baselinePath && (
					<img
						src={result.baselinePath}
						alt={`Baseline: ${result.viewportName}`}
						className="w-full h-auto max-h-[400px] object-contain"
						onError={(e) => {
							;(e.target as HTMLImageElement).style.display = "none"
						}}
					/>
				)}
				{viewMode === "diff" && result.diffPath && (
					<img
						src={result.diffPath}
						alt={`Diff: ${result.viewportName}`}
						className="w-full h-auto max-h-[400px] object-contain"
						onError={(e) => {
							;(e.target as HTMLImageElement).style.display = "none"
						}}
					/>
				)}
				{viewMode === "side-by-side" && result.baselinePath && result.currentPath && (
					<div className="relative w-full" style={{ height: 300 }}>
						{/* Baseline (full width) */}
						<img
							src={result.baselinePath}
							alt="Baseline"
							className="absolute inset-0 w-full h-full object-contain"
							onError={(e) => {
								;(e.target as HTMLImageElement).style.display = "none"
							}}
						/>
						{/* Current (clipped by slider) */}
						<div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
							<img
								src={result.currentPath}
								alt="Current"
								className="absolute inset-0 w-full h-full object-contain"
								style={{ objectPosition: "left center" }}
								onError={(e) => {
									;(e.target as HTMLImageElement).style.display = "none"
								}}
							/>
						</div>
						{/* Slider handle */}
						<div
							className="absolute top-0 bottom-0 w-1 bg-[#1f6feb] cursor-col-resize z-10"
							style={{ left: `${sliderPos}%` }}
							onMouseDown={handleSliderMouseDown}>
							<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-8 bg-[#1f6feb] rounded flex items-center justify-center">
								<ChevronLeft className="w-3 h-3 text-white" />
								<ChevronRight className="w-3 h-3 text-white" />
							</div>
						</div>
					</div>
				)}
				{/* No image available */}
				{!result.currentPath && !result.baselinePath && !result.diffPath && (
					<div className="flex items-center justify-center h-32 text-[#484f58]">
						<Image className="w-8 h-8" />
					</div>
				)}
			</div>

			{/* Baseline management buttons */}
			{onAcceptBaseline && onRejectBaseline && (
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onAcceptBaseline}
						className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#3fb95011] text-[#3fb950] rounded hover:bg-[#3fb95022] transition-colors">
						<CheckCircle className="w-3 h-3" />
						Accept as Baseline
					</button>
					<button
						type="button"
						onClick={onRejectBaseline}
						className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#f8514911] text-[#f85149] rounded hover:bg-[#f8514933] transition-colors">
						<XCircle className="w-3 h-3" />
						Reject
					</button>
				</div>
			)}

			{/* Comparison data */}
			{result.comparison && (
				<div className="flex items-center gap-3 text-[10px] text-[#8b949e]">
					<span>Match: {result.comparison.match ? "Yes" : "No"}</span>
					<span>Diff pixels: {result.comparison.diffPixels.toLocaleString()}</span>
					<span>Diff: {result.comparison.diffPercent.toFixed(2)}%</span>
				</div>
			)}
		</div>
	)
}

// ─── Issue history chart (simple bar) ───────────────────────────────
function IssueHistoryChart({ reports }: { reports: CrawlReportSummary[] }) {
	const chartData = useMemo(() => {
		return reports
			.slice()
			.reverse()
			.slice(-20)
			.map((r) => ({
				date: new Date(r.timestamp).toLocaleDateString(),
				issues: r.issuesFound,
				viewports: r.viewportsTested,
			}))
	}, [reports])

	if (chartData.length === 0) return null

	const maxIssues = Math.max(...chartData.map((d) => d.issues), 1)

	return (
		<div className="p-3 bg-[#0f1117] border border-[#1e2535] rounded">
			<div className="flex items-center gap-2 mb-3">
				<BarChart3 className="w-3.5 h-3.5 text-[#58a6ff]" />
				<span className="text-[11px] font-medium text-[#e6edf3]">
					Issue History (last {chartData.length} crawls)
				</span>
			</div>
			<div className="flex items-end gap-1 h-20">
				{chartData.map((d, i) => (
					<div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
						<div
							className="w-full rounded-t"
							style={{
								height: `${Math.max((d.issues / maxIssues) * 100, 2)}%`,
								background: d.issues === 0 ? "#3fb950" : d.issues < 3 ? "#d29922" : "#f85149",
							}}
						/>
						<div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#1e2535] text-[#e6edf3] text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity z-10">
							{d.date}: {d.issues} issues
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

// ─── Trend summary ──────────────────────────────────────────────────
function TrendSummary({ reports }: { reports: CrawlReportSummary[] }) {
	const trend = useMemo(() => {
		if (reports.length < 2) return { direction: "neutral", text: "Not enough data", color: "#8b949e" }
		const sorted = [...reports].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
		const recent = sorted.slice(-5)
		const avgIssues = recent.reduce((sum, r) => sum + r.issuesFound, 0) / recent.length
		const prevAvg =
			sorted.length > 5 ? sorted.slice(-10, -5).reduce((sum, r) => sum + r.issuesFound, 0) / 5 : avgIssues

		if (avgIssues < prevAvg * 0.8) return { direction: "improving", text: "Improving", color: "#3fb950" }
		if (avgIssues > prevAvg * 1.2) return { direction: "degrading", text: "Degrading", color: "#f85149" }
		return { direction: "stable", text: "Stable", color: "#d29922" }
	}, [reports])

	return (
		<div className="flex items-center gap-2 text-[10px]">
			<span className="text-[#8b949e]">Trend:</span>
			<span style={{ color: trend.color }} className="font-medium">
				{trend.text}
			</span>
		</div>
	)
}

// ─── Main view ──────────────────────────────────────────────────────
export function VisualCrawlerView() {
	const [reports, setReports] = useState<CrawlReportSummary[]>([])
	const [loading, setLoading] = useState(false)
	const [running, setRunning] = useState(false)
	const [selectedReport, setSelectedReport] = useState<CrawlReportDetail | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [url, setUrl] = useState(typeof window !== "undefined" ? window.location.origin : "http://localhost:3001")
	const [error, setError] = useState<string | null>(null)

	// Multi-project state
	const [projects, setProjects] = useState<ProjectEntry[]>([])
	const [selectedProject, setSelectedProject] = useState<string>("")
	const [showAddProject, setShowAddProject] = useState(false)
	const [newProject, setNewProject] = useState({ name: "", label: "", baseUrl: "", authToken: "" })

	// Pagination
	const [currentPage, setCurrentPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)

	// Search
	const [searchQuery, setSearchQuery] = useState("")

	// Viewport config
	const [showViewportConfig, setShowViewportConfig] = useState(false)
	const [viewportWidth, setViewportWidth] = useState(1280)
	const [viewportHeight, setViewportHeight] = useState(720)

	// Scheduled crawl
	const [showSchedule, setShowSchedule] = useState(false)
	const [scheduleInterval, setScheduleInterval] = useState(0)
	const [scheduleTimerId, setScheduleTimerId] = useState<ReturnType<typeof setInterval> | null>(null)

	// Crawl progress
	const [crawlProgress, setCrawlProgress] = useState<string | null>(null)

	// Deploy gate
	const [deployGateEnabled, setDeployGateEnabled] = useState(false)

	const fetchProjects = useCallback(async () => {
		try {
			const res = await fetch("/visual-crawl/projects")
			if (!res.ok) return
			const data = await res.json()
			if (data.projects) {
				setProjects(data.projects)
				if (!selectedProject && data.projects.length > 0) {
					setSelectedProject(data.projects[0].name)
					setUrl(data.projects[0].baseUrl)
				}
			}
		} catch {}
	}, [selectedProject])

	const fetchReports = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const query = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : ""
			const res = await fetch(`/visual-crawl/reports${query}`)
			if (!res.ok) {
				if (res.status === 404) {
					setReports([])
					return
				}
				throw new Error(`HTTP ${res.status}`)
			}
			const data = await res.json()
			setReports(data.reports || [])
		} catch (e: any) {
			setError(e.message)
		} finally {
			setLoading(false)
		}
	}, [selectedProject])

	useEffect(() => {
		fetchProjects()
	}, [])

	useEffect(() => {
		fetchReports()
	}, [fetchReports])

	const loadReportDetail = async (crawlId: string) => {
		setDetailLoading(true)
		try {
			const res = await fetch(`/visual-crawl/reports/${crawlId}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			setSelectedReport(data)
		} catch (e: any) {
			setError(e.message)
		} finally {
			setDetailLoading(false)
		}
	}

	const runCrawl = async () => {
		setRunning(true)
		setError(null)
		setCrawlProgress("Starting crawl...")
		try {
			const res = await fetch("/visual-crawl/run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					url,
					thresholdPercent: 1.0,
					projectName: selectedProject || undefined,
					viewportWidth: viewportWidth,
					viewportHeight: viewportHeight,
				}),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			setCrawlProgress("Crawl complete, fetching results...")
			await fetchReports()
			setCrawlProgress(null)
		} catch (e: any) {
			setError(e.message)
			setCrawlProgress(null)
		} finally {
			setRunning(false)
		}
	}

	const handleProjectChange = (projectName: string) => {
		setSelectedProject(projectName)
		const project = projects.find((p) => p.name === projectName)
		if (project) {
			setUrl(project.baseUrl)
		}
		setSelectedReport(null)
	}

	const handleAddProject = async () => {
		if (!newProject.name || !newProject.baseUrl) return
		try {
			const res = await fetch("/visual-crawl/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(newProject),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			if (data.projects) {
				setProjects(data.projects)
				setSelectedProject(newProject.name)
				setUrl(newProject.baseUrl)
			}
			setShowAddProject(false)
			setNewProject({ name: "", label: "", baseUrl: "", authToken: "" })
		} catch (e: any) {
			setError(e.message)
		}
	}

	const handleDeleteProject = async (name: string) => {
		try {
			const res = await fetch(`/visual-crawl/projects/${name}`, { method: "DELETE" })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			if (data.projects) {
				setProjects(data.projects)
				if (selectedProject === name) {
					const next = data.projects[0]
					if (next) {
						setSelectedProject(next.name)
						setUrl(next.baseUrl)
					} else {
						setSelectedProject("")
						setUrl(typeof window !== "undefined" ? window.location.origin : "http://localhost:3001")
					}
				}
			}
		} catch (e: any) {
			setError(e.message)
		}
	}

	const handleAcceptBaseline = async (result: CrawlResult) => {
		try {
			const res = await fetch("/visual-crawl/baseline", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					crawlId: selectedReport?.crawlId,
					viewportName: result.viewportName,
					currentPath: result.currentPath,
				}),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			// Refresh detail to show updated baseline
			if (selectedReport) {
				loadReportDetail(selectedReport.crawlId)
			}
		} catch (e: any) {
			setError(e.message)
		}
	}

	const handleRejectBaseline = async (result: CrawlResult) => {
		try {
			const res = await fetch("/visual-crawl/baseline", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					crawlId: selectedReport?.crawlId,
					viewportName: result.viewportName,
				}),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			if (selectedReport) {
				loadReportDetail(selectedReport.crawlId)
			}
		} catch (e: any) {
			setError(e.message)
		}
	}

	const handleAutoFix = async (result: CrawlResult) => {
		if (!result.analysis?.suggestedFix) return
		try {
			const res = await fetch("/visual-crawl/auto-fix", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					viewportName: result.viewportName,
					issue: result.analysis.summary,
					suggestedFix: result.analysis.suggestedFix,
					projectName: selectedReport?.projectName,
				}),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			setError(null)
		} catch (e: any) {
			setError(e.message)
		}
	}

	const statusFromIssues = (issues: number, viewports: number): "passed" | "failed" | "partial" => {
		if (issues === 0) return "passed"
		if (issues >= viewports) return "failed"
		return "partial"
	}

	// Scheduled crawl
	const toggleSchedule = () => {
		if (scheduleTimerId) {
			clearInterval(scheduleTimerId)
			setScheduleTimerId(null)
			setScheduleInterval(0)
		} else {
			const interval = 300000 // 5 minutes
			setScheduleInterval(interval)
			const id = setInterval(() => {
				runCrawl()
			}, interval)
			setScheduleTimerId(id)
		}
	}

	// Cleanup schedule on unmount
	useEffect(() => {
		return () => {
			if (scheduleTimerId) clearInterval(scheduleTimerId)
		}
	}, [scheduleTimerId])

	// Filtered + paginated reports
	const filteredReports = useMemo(() => {
		if (!searchQuery.trim()) return reports
		const q = searchQuery.toLowerCase()
		return reports.filter(
			(r) =>
				r.url.toLowerCase().includes(q) ||
				r.crawlId.toLowerCase().includes(q) ||
				(r.projectName || "").toLowerCase().includes(q),
		)
	}, [reports, searchQuery])

	const totalPages = Math.max(1, Math.ceil(filteredReports.length / pageSize))
	const paginatedReports = filteredReports.slice((currentPage - 1) * pageSize, currentPage * pageSize)

	// Reset page when filters change
	useEffect(() => {
		setCurrentPage(1)
	}, [searchQuery, selectedProject])

	return (
		<div className="flex flex-col h-full p-4 gap-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold text-[#e6edf3] flex items-center gap-2">
						<Eye className="w-5 h-5 text-[#1f6feb]" />
						Visual Crawler
					</h1>
					<p className="text-[11px] text-[#8b949e] mt-0.5">
						Multi-project E2E visual regression detection across viewport matrix
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* Schedule toggle */}
					<button
						onClick={toggleSchedule}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded transition-colors ${
							scheduleTimerId
								? "bg-[#3fb95011] text-[#3fb950] border border-[#3fb95033]"
								: "bg-[#1e2535] text-[#8b949e] hover:bg-[#30363d] hover:text-[#e6edf3]"
						}`}>
						{scheduleTimerId ? (
							<ToggleRight className="w-3.5 h-3.5" />
						) : (
							<ToggleLeft className="w-3.5 h-3.5" />
						)}
						{scheduleTimerId ? "Auto On" : "Auto Off"}
					</button>
					{/* Deploy gate toggle */}
					<button
						onClick={() => setDeployGateEnabled(!deployGateEnabled)}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded transition-colors ${
							deployGateEnabled
								? "bg-[#58a6ff11] text-[#58a6ff] border border-[#58a6ff33]"
								: "bg-[#1e2535] text-[#8b949e] hover:bg-[#30363d] hover:text-[#e6edf3]"
						}`}>
						<ShieldCheck className="w-3.5 h-3.5" />
						{deployGateEnabled ? "Gate On" : "Gate Off"}
					</button>
					<button
						onClick={fetchReports}
						disabled={loading}
						className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] hover:text-[#e6edf3] transition-colors disabled:opacity-50">
						<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</button>
				</div>
			</div>

			{/* Project selector */}
			<div className="flex items-center gap-2 p-3 bg-[#0f1117] border border-[#1e2535] rounded">
				<label className="text-[11px] text-[#8b949e] whitespace-nowrap">Project:</label>
				<select
					value={selectedProject}
					onChange={(e) => handleProjectChange(e.target.value)}
					className="flex-1 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]">
					{projects.length === 0 && <option value="">No projects</option>}
					{projects.map((p) => (
						<option key={p.name} value={p.name}>
							{p.label} ({p.name})
						</option>
					))}
				</select>
				<button
					onClick={() => setShowAddProject(!showAddProject)}
					className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] hover:text-[#e6edf3] transition-colors">
					<Plus className="w-3 h-3" />
					Add
				</button>
				{selectedProject && (
					<button
						onClick={() => handleDeleteProject(selectedProject)}
						className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-[#f8514911] text-[#f85149] rounded hover:bg-[#f8514933] transition-colors">
						<Trash2 className="w-3 h-3" />
					</button>
				)}
			</div>

			{/* Add project form */}
			{showAddProject && (
				<div className="p-3 bg-[#0f1117] border border-[#1e2535] rounded space-y-2">
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={newProject.name}
							onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
							placeholder="Project name (e.g., my-app)"
							className="flex-1 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]"
						/>
						<input
							type="text"
							value={newProject.label}
							onChange={(e) => setNewProject({ ...newProject, label: e.target.value })}
							placeholder="Display label"
							className="flex-1 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]"
						/>
					</div>
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={newProject.baseUrl}
							onChange={(e) => setNewProject({ ...newProject, baseUrl: e.target.value })}
							placeholder="Base URL (e.g., http://myapp.com)"
							className="flex-1 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]"
						/>
						<input
							type="text"
							value={newProject.authToken}
							onChange={(e) => setNewProject({ ...newProject, authToken: e.target.value })}
							placeholder="Auth token (optional)"
							className="flex-1 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]"
						/>
					</div>
					<div className="flex justify-end gap-2">
						<button
							onClick={() => setShowAddProject(false)}
							className="px-3 py-1.5 text-[11px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] transition-colors">
							Cancel
						</button>
						<button
							onClick={handleAddProject}
							disabled={!newProject.name || !newProject.baseUrl}
							className="px-3 py-1.5 text-[11px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors disabled:opacity-50">
							Add Project
						</button>
					</div>
				</div>
			)}

			{/* Run crawl bar */}
			<div className="flex items-center gap-2 p-3 bg-[#0f1117] border border-[#1e2535] rounded">
				<input
					type="text"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="URL to crawl..."
					className="flex-1 min-w-0 bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1.5 outline-none focus:border-[#1f6feb]"
				/>
				{/* Viewport config */}
				<div className="relative">
					<button
						onClick={() => setShowViewportConfig(!showViewportConfig)}
						className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] transition-colors"
						title="Viewport settings">
						<SlidersHorizontal className="w-3 h-3" />
					</button>
					{showViewportConfig && (
						<div className="absolute right-0 top-full z-50 mt-1 p-3 bg-[#0f1117] border border-[#1e2535] rounded space-y-2 w-48">
							<label className="text-[10px] text-[#8b949e] block">Viewport Width</label>
							<input
								type="number"
								value={viewportWidth}
								onChange={(e) => setViewportWidth(Number(e.target.value))}
								className="w-full bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1 outline-none focus:border-[#1f6feb]"
							/>
							<label className="text-[10px] text-[#8b949e] block">Viewport Height</label>
							<input
								type="number"
								value={viewportHeight}
								onChange={(e) => setViewportHeight(Number(e.target.value))}
								className="w-full bg-[#161b22] text-[12px] text-[#e6edf3] border border-[#30363d] rounded px-2 py-1 outline-none focus:border-[#1f6feb]"
							/>
						</div>
					)}
				</div>
				<button
					onClick={runCrawl}
					disabled={running || !url}
					className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
					{running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
					{running ? "Running..." : "Run Crawl"}
				</button>
			</div>

			{/* Crawl progress */}
			{crawlProgress && (
				<div className="flex items-center gap-2 p-2 bg-[#1f6feb11] border border-[#1f6feb33] rounded text-[11px] text-[#58a6ff]">
					<RefreshCw className="w-3 h-3 animate-spin" />
					{crawlProgress}
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="p-2.5 bg-[#f8514911] border border-[#f8514933] rounded text-[11px] text-[#f85149]">
					<AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
					{error}
				</div>
			)}

			{/* Search bar */}
			{!selectedReport && (
				<div className="relative">
					<Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#484f58]" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search reports by URL, project, or ID..."
						className="w-full bg-[#0f1117] text-[12px] text-[#e6edf3] border border-[#1e2535] rounded py-2 pl-9 pr-3 outline-none focus:border-[#1f6feb] placeholder-[#484f58]"
					/>
				</div>
			)}

			{/* Trend + Issue history (shown when reports exist and no detail is selected) */}
			{!selectedReport && reports.length > 1 && (
				<div className="space-y-2">
					<TrendSummary reports={reports} />
					<IssueHistoryChart reports={reports} />
				</div>
			)}

			{/* Detail view */}
			{selectedReport ? (
				<div className="flex-1 flex flex-col gap-3 overflow-hidden">
					<button
						onClick={() => setSelectedReport(null)}
						className="flex items-center gap-1 text-[11px] text-[#8b949e] hover:text-[#e6edf3] transition-colors w-fit">
						<ChevronRight className="w-3 h-3 rotate-180" />
						Back to reports
					</button>
					<div className="p-3 bg-[#0f1117] border border-[#1e2535] rounded">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-[13px] font-medium text-[#e6edf3]">{selectedReport.url}</h2>
								{selectedReport.projectName && (
									<span className="text-[10px] text-[#58a6ff] mt-0.5 block">
										Project: {selectedReport.projectName}
									</span>
								)}
							</div>
							<StatusBadge
								status={statusFromIssues(selectedReport.issuesFound, selectedReport.viewportsTested)}
							/>
						</div>
						<p className="text-[10px] text-[#8b949e] mt-1">
							{new Date(selectedReport.timestamp).toLocaleString()} · {selectedReport.viewportsTested}{" "}
							viewports · {selectedReport.issuesFound} issues
						</p>
					</div>
					{detailLoading ? (
						<div className="flex-1 flex items-center justify-center text-[#8b949e]">
							<RefreshCw className="w-5 h-5 animate-spin" />
						</div>
					) : (
						<div className="flex-1 overflow-y-auto space-y-3">
							{selectedReport.results.filter((r) => r.analysis).length === 0 ? (
								<div className="flex flex-col items-center justify-center h-32 text-[#484f58]">
									<CheckCircle className="w-8 h-8 mb-2" />
									<p className="text-[11px]">No issues found</p>
								</div>
							) : (
								selectedReport.results
									.filter((r) => r.analysis)
									.map((r, i) => (
										<div
											key={i}
											className="p-3 bg-[#0f1117] border border-[#1e2535] rounded space-y-2">
											{/* Header */}
											<div className="flex items-center gap-2">
												<SeverityDot severity={r.analysis!.severity as any} />
												<span className="text-[11px] font-medium text-[#e6edf3]">
													{r.viewportName} ({r.width}x{r.height}, {r.colorScheme})
												</span>
												{r.analysis!.isBug && (
													<span className="px-1 py-0.5 text-[9px] bg-[#f8514911] text-[#f85149] rounded">
														BUG
													</span>
												)}
											</div>
											<p className="text-[11px] text-[#8b949e]">{r.analysis!.summary}</p>
											{r.analysis!.suggestedFix && (
												<p className="text-[10px] text-[#58a6ff]">
													Fix: {r.analysis!.suggestedFix}
												</p>
											)}

											{/* Screenshot viewer */}
											<ScreenshotViewer
												result={r}
												onAcceptBaseline={() => handleAcceptBaseline(r)}
												onRejectBaseline={() => handleRejectBaseline(r)}
											/>

											{/* AI auto-fix button */}
											{r.analysis!.suggestedFix && (
												<button
													type="button"
													onClick={() => handleAutoFix(r)}
													className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#58a6ff11] text-[#58a6ff] rounded hover:bg-[#58a6ff22] transition-colors">
													<Wand2 className="w-3 h-3" />
													Auto-Fix
												</button>
											)}
										</div>
									))
							)}
						</div>
					)}
				</div>
			) : (
				<div className="flex-1 overflow-y-auto">
					{loading ? (
						<div className="flex items-center justify-center h-64 text-[#8b949e]">
							<RefreshCw className="w-5 h-5 animate-spin" />
						</div>
					) : paginatedReports.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-64 text-[#484f58]">
							<Image className="w-10 h-10 mb-3" />
							<p className="text-[12px]">
								{searchQuery ? "No reports match your search" : "No crawl reports yet"}
							</p>
							<p className="text-[11px] mt-1">
								{searchQuery
									? "Try a different search term"
									: selectedProject
										? `Select a project and run a crawl to capture baseline screenshots`
										: `Add a project first, then run a crawl`}
							</p>
						</div>
					) : (
						<>
							<div className="space-y-2">
								{paginatedReports.map((r) => (
									<button
										key={r.crawlId}
										onClick={() => loadReportDetail(r.crawlId)}
										className="w-full text-left p-3 bg-[#0f1117] border border-[#1e2535] rounded hover:border-[#30363d] transition-colors">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 min-w-0">
												<FileText className="w-4 h-4 text-[#8b949e] shrink-0" />
												<span className="text-[12px] text-[#e6edf3] truncate">{r.url}</span>
											</div>
											<StatusBadge status={statusFromIssues(r.issuesFound, r.viewportsTested)} />
										</div>
										<div className="flex items-center gap-3 mt-1.5">
											{r.projectName && (
												<span className="text-[10px] text-[#58a6ff]">{r.projectName}</span>
											)}
											<span className="text-[10px] text-[#8b949e]">
												{new Date(r.timestamp).toLocaleString()}
											</span>
											<span className="text-[10px] text-[#8b949e]">
												{r.viewportsTested} viewports
											</span>
											{r.issuesFound > 0 && (
												<span className="text-[10px] text-[#d29922]">
													{r.issuesFound} issues
												</span>
											)}
										</div>
									</button>
								))}
							</div>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between mt-3">
									<div className="flex items-center gap-2">
										<span className="text-[10px] text-[#8b949e]">
											Page {currentPage} of {totalPages}
										</span>
										<select
											value={pageSize}
											onChange={(e) => {
												setPageSize(Number(e.target.value))
												setCurrentPage(1)
											}}
											className="bg-[#161b22] text-[10px] text-[#e6edf3] border border-[#30363d] rounded px-1 py-0.5 outline-none">
											<option value={5}>5/page</option>
											<option value={10}>10/page</option>
											<option value={20}>20/page</option>
											<option value={50}>50/page</option>
										</select>
									</div>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() => setCurrentPage(1)}
											disabled={currentPage === 1}
											className="p-1 text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 transition-colors">
											<ChevronsLeft className="w-3.5 h-3.5" />
										</button>
										<button
											type="button"
											onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
											disabled={currentPage === 1}
											className="p-1 text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 transition-colors">
											<ChevronLeft className="w-3.5 h-3.5" />
										</button>
										<span className="text-[10px] text-[#8b949e] px-2">
											{currentPage} / {totalPages}
										</span>
										<button
											type="button"
											onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
											disabled={currentPage === totalPages}
											className="p-1 text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 transition-colors">
											<ChevronRight className="w-3.5 h-3.5" />
										</button>
										<button
											type="button"
											onClick={() => setCurrentPage(totalPages)}
											disabled={currentPage === totalPages}
											className="p-1 text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 transition-colors">
											<ChevronsRight className="w-3.5 h-3.5" />
										</button>
									</div>
								</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
	)
}
