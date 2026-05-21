"use client"

import { useState, useEffect, useCallback } from "react"
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

export function VisualCrawlerView() {
	const [reports, setReports] = useState<CrawlReportSummary[]>([])
	const [loading, setLoading] = useState(false)
	const [running, setRunning] = useState(false)
	const [selectedReport, setSelectedReport] = useState<CrawlReportDetail | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [url, setUrl] = useState("http://localhost:3001")
	const [error, setError] = useState<string | null>(null)

	// Multi-project state
	const [projects, setProjects] = useState<ProjectEntry[]>([])
	const [selectedProject, setSelectedProject] = useState<string>("")
	const [showAddProject, setShowAddProject] = useState(false)
	const [newProject, setNewProject] = useState({ name: "", label: "", baseUrl: "", authToken: "" })

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
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
		try {
			const res = await fetch("/visual-crawl/run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					url,
					thresholdPercent: 1.0,
					projectName: selectedProject || undefined,
				}),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			await fetchReports()
		} catch (e: any) {
			setError(e.message)
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
						setUrl("http://localhost:3001")
					}
				}
			}
		} catch (e: any) {
			setError(e.message)
		}
	}

	const statusFromIssues = (issues: number, viewports: number): "passed" | "failed" | "partial" => {
		if (issues === 0) return "passed"
		if (issues >= viewports) return "failed"
		return "partial"
	}

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
				<button
					onClick={fetchReports}
					disabled={loading}
					className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#1e2535] text-[#8b949e] rounded hover:bg-[#30363d] hover:text-[#e6edf3] transition-colors disabled:opacity-50">
					<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
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
				<button
					onClick={runCrawl}
					disabled={running || !url}
					className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
					{running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
					{running ? "Running..." : "Run Crawl"}
				</button>
			</div>

			{/* Error */}
			{error && (
				<div className="p-2.5 bg-[#f8514911] border border-[#f8514933] rounded text-[11px] text-[#f85149]">
					<AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
					{error}
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
						<div className="flex-1 overflow-y-auto space-y-2">
							{selectedReport.results.filter((r) => r.analysis).length === 0 ? (
								<div className="flex flex-col items-center justify-center h-32 text-[#484f58]">
									<CheckCircle className="w-8 h-8 mb-2" />
									<p className="text-[11px]">No issues found</p>
								</div>
							) : (
								selectedReport.results
									.filter((r) => r.analysis)
									.map((r, i) => (
										<div key={i} className="p-2.5 bg-[#0f1117] border border-[#1e2535] rounded">
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
											<p className="text-[11px] text-[#8b949e] mt-1">{r.analysis!.summary}</p>
											{r.analysis!.suggestedFix && (
												<p className="text-[10px] text-[#58a6ff] mt-1">
													Fix: {r.analysis!.suggestedFix}
												</p>
											)}
										</div>
									))
							)}
						</div>
					)}
				</div>
			) : (
				<div className="flex-1 overflow-y-auto">
					{reports.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-64 text-[#484f58]">
							<Image className="w-10 h-10 mb-3" />
							<p className="text-[12px]">No crawl reports yet</p>
							<p className="text-[11px] mt-1">
								{selectedProject
									? `Select a project and run a crawl to capture baseline screenshots`
									: `Add a project first, then run a crawl`}
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{reports.map((r) => (
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
											<span className="text-[10px] text-[#d29922]">{r.issuesFound} issues</span>
										)}
									</div>
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

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
