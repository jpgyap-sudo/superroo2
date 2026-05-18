"use client"

import { useState, useCallback, useMemo } from "react"
import { X, AlertTriangle, AlertCircle, Info, ChevronRight, ChevronDown, FileText } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────
interface Problem {
	message: string
	severity: "error" | "warning" | "info"
	line: number
	column: number
	file: string
	code?: string
}

interface ProblemsPanelProps {
	problems: Problem[]
	onProblemClick?: (file: string, line: number, column: number) => void
	onClose?: () => void
}

// ── Severity helpers ───────────────────────────────────────────
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

function getSeverityIcon(severity: string) {
	switch (severity) {
		case "error":
			return <AlertCircle size={14} className="text-red-500 shrink-0" />
		case "warning":
			return <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
		case "info":
			return <Info size={14} className="text-blue-500 shrink-0" />
		default:
			return <Info size={14} className="text-gray-500 shrink-0" />
	}
}

function getSeverityColor(severity: string) {
	switch (severity) {
		case "error":
			return "text-red-500"
		case "warning":
			return "text-yellow-500"
		case "info":
			return "text-blue-500"
		default:
			return "text-gray-500"
	}
}

// ── Problems Panel ─────────────────────────────────────────────
export default function ProblemsPanel({ problems, onProblemClick, onClose }: ProblemsPanelProps) {
	const [groupByFile, setGroupByFile] = useState(true)
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
	const [filterSeverity, setFilterSeverity] = useState<string>("all")

	// ── Filter problems ────────────────────────────────────────
	const filteredProblems = useMemo(() => {
		if (filterSeverity === "all") return problems
		return problems.filter((p) => p.severity === filterSeverity)
	}, [problems, filterSeverity])

	// ── Group by file ──────────────────────────────────────────
	const groupedProblems = useMemo(() => {
		if (!groupByFile) return null
		const groups: Record<string, Problem[]> = {}
		for (const p of filteredProblems) {
			if (!groups[p.file]) groups[p.file] = []
			groups[p.file].push(p)
		}
		// Sort groups by file path
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
	}, [filteredProblems, groupByFile])

	// ── Toggle file expansion ──────────────────────────────────
	const toggleFile = useCallback((file: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev)
			if (next.has(file)) next.delete(file)
			else next.add(file)
			return next
		})
	}, [])

	// ── Counts ─────────────────────────────────────────────────
	const counts = useMemo(() => {
		const c = { error: 0, warning: 0, info: 0 }
		for (const p of problems) {
			if (p.severity in c) c[p.severity as keyof typeof c]++
		}
		return c
	}, [problems])

	// ── Render ─────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full bg-[#252526] border-t border-[#3c3c3c]">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#3c3c3c] bg-[#2d2d2d] shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-[#cccccc]">PROBLEMS</span>
					<span className="text-[11px] text-[#8b949e]">{problems.length} issues</span>
				</div>
				<div className="flex items-center gap-1">
					{/* Severity filter */}
					<select
						className="bg-[#3c3c3c] text-[11px] text-[#cccccc] border border-[#4a4a4a] rounded px-1 py-0.5 outline-none"
						value={filterSeverity}
						onChange={(e) => setFilterSeverity(e.target.value)}>
						<option value="all">All</option>
						<option value="error">Errors ({counts.error})</option>
						<option value="warning">Warnings ({counts.warning})</option>
						<option value="info">Info ({counts.info})</option>
					</select>

					{/* Group toggle */}
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${groupByFile ? "bg-[#094771] text-white" : "text-[#8b949e] hover:text-[#cccccc]"}`}
						onClick={() => setGroupByFile((v) => !v)}
						title="Group by file">
						<FileText size={12} />
					</button>

					{/* Close */}
					{onClose && (
						<button
							className="p-0.5 text-[#8b949e] hover:text-[#cccccc] rounded"
							onClick={onClose}
							title="Close problems panel">
							<X size={12} />
						</button>
					)}
				</div>
			</div>

			{/* Problems list */}
			<div className="flex-1 overflow-y-auto">
				{filteredProblems.length === 0 ? (
					<div className="flex items-center justify-center h-full text-[11px] text-[#8b949e]">
						No problems detected
					</div>
				) : groupByFile ? (
					// Grouped by file
					groupedProblems!.map(([file, fileProblems]) => {
						const isExpanded = expandedFiles.has(file)
						const fileCounts = { error: 0, warning: 0, info: 0 }
						for (const p of fileProblems) {
							if (p.severity in fileCounts) fileCounts[p.severity as keyof typeof fileCounts]++
						}
						return (
							<div key={file}>
								{/* File header */}
								<button
									className="flex items-center gap-1 w-full px-2 py-1 text-[11px] text-[#8b949e] hover:bg-[#2a2d2e] text-left"
									onClick={() => toggleFile(file)}>
									{isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
									<span className="truncate flex-1">{file}</span>
									{fileCounts.error > 0 && (
										<span className="text-red-500 font-medium">{fileCounts.error}</span>
									)}
									{fileCounts.warning > 0 && (
										<span className="text-yellow-500 font-medium">{fileCounts.warning}</span>
									)}
								</button>

								{/* Problems in file */}
								{isExpanded &&
									fileProblems.map((p, i) => (
										<button
											key={`${p.line}-${p.column}-${i}`}
											className="flex items-start gap-2 w-full px-6 py-1 text-[11px] hover:bg-[#2a2d2e] text-left"
											onClick={() => onProblemClick?.(p.file, p.line, p.column)}>
											{getSeverityIcon(p.severity)}
											<span className="flex-1 text-[#cccccc] truncate">{p.message}</span>
											<span className="text-[#8b949e] shrink-0">
												Ln {p.line}, Col {p.column}
											</span>
										</button>
									))}
							</div>
						)
					})
				) : (
					// Flat list
					filteredProblems
						.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
						.map((p, i) => (
							<button
								key={`${p.file}-${p.line}-${p.column}-${i}`}
								className="flex items-start gap-2 w-full px-3 py-1 text-[11px] hover:bg-[#2a2d2e] text-left"
								onClick={() => onProblemClick?.(p.file, p.line, p.column)}>
								{getSeverityIcon(p.severity)}
								<span className="text-[#8b949e] shrink-0">{p.file}</span>
								<span className="flex-1 text-[#cccccc] truncate">{p.message}</span>
								<span className="text-[#8b949e] shrink-0">
									Ln {p.line}, Col {p.column}
								</span>
							</button>
						))
				)}
			</div>

			{/* Status bar */}
			<div className="flex items-center gap-3 px-3 py-1 border-t border-[#3c3c3c] bg-[#2d2d2d] shrink-0">
				<span className="flex items-center gap-1 text-[11px] text-red-500">
					<AlertCircle size={10} />
					{counts.error}
				</span>
				<span className="flex items-center gap-1 text-[11px] text-yellow-500">
					<AlertTriangle size={10} />
					{counts.warning}
				</span>
				<span className="flex items-center gap-1 text-[11px] text-blue-500">
					<Info size={10} />
					{counts.info}
				</span>
			</div>
		</div>
	)
}
