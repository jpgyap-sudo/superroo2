"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard } from "@/components/ui/card"
import {
	Upload,
	RefreshCw,
	AlertCircle,
	FileText,
	FolderOpen,
	CheckCircle2,
	XCircle,
	Clock,
	BarChart3,
} from "lucide-react"

interface FileImporterStats {
	totalImports: number
	totalFiles: number
	totalErrors: number
	lastImport?: string
	importedPaths?: string[]
	recentImports?: Array<{
		timestamp: string
		paths: string[]
		successCount: number
		errorCount: number
	}>
}

interface StatsResponse {
	success: boolean
	stats: FileImporterStats
}

interface ImportResult {
	successCount: number
	errorCount: number
	errors?: string[]
	imported: string[]
}

interface ImportResponse {
	success: boolean
	result: ImportResult
}

async function fetchStats(): Promise<StatsResponse> {
	const res = await fetch("/api/orchestrator/file-importer/stats")
	return res.json()
}

async function importPaths(paths: string[]): Promise<ImportResponse> {
	const res = await fetch("/api/orchestrator/file-importer/import", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ paths }),
	})
	return res.json()
}

export function FileImporterView() {
	const [stats, setStats] = useState<FileImporterStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [pathsInput, setPathsInput] = useState("")
	const [importing, setImporting] = useState(false)
	const [importResult, setImportResult] = useState<ImportResult | null>(null)
	const [importError, setImportError] = useState<string | null>(null)

	const fetchData = useCallback(async () => {
		try {
			setError(null)
			const res = await fetchStats()
			if (res.success) {
				setStats(res.stats)
			} else {
				setError("Failed to fetch stats")
			}
		} catch {
			setError("API server unreachable")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	const handleImport = async () => {
		const paths = pathsInput
			.split("\n")
			.map((p) => p.trim())
			.filter(Boolean)
		if (paths.length === 0) return

		setImporting(true)
		setImportResult(null)
		setImportError(null)

		try {
			const res = await importPaths(paths)
			if (res.success) {
				setImportResult(res.result)
				setPathsInput("")
				fetchData()
			} else {
				setImportError("Import failed")
			}
		} catch {
			setImportError("Import request failed")
		} finally {
			setImporting(false)
		}
	}

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div>
				<h1 className="text-lg font-semibold text-white flex items-center gap-2">
					<Upload size={18} className="text-blue-400" />
					File Importer
				</h1>
				<p className="text-xs text-gray-500 mt-0.5">
					Import file paths into the orchestrator for analysis and indexing
				</p>
			</div>

			{/* Stats Cards */}
			{loading ? (
				<div className="flex items-center justify-center py-8 text-gray-500">
					<RefreshCw size={20} className="animate-spin mr-2" />
					<span className="text-sm">Loading stats...</span>
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-8 text-red-400">
					<AlertCircle size={20} className="mr-2" />
					<span className="text-sm">{error}</span>
				</div>
			) : (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
					<StatCard
						label="Total Imports"
						value={<><Upload className="inline h-4 w-4 mr-1 text-blue-400" />{stats?.totalImports ?? 0}</>}
					/>
					<StatCard
						label="Files Imported"
						value={<><FileText className="inline h-4 w-4 mr-1 text-green-400" />{stats?.totalFiles ?? 0}</>}
					/>
					<StatCard
						label="Errors"
						value={<><XCircle className="inline h-4 w-4 mr-1 text-red-400" />{stats?.totalErrors ?? 0}</>}
					/>
					<StatCard
						label="Last Import"
						value={
							<>
								<Clock className="inline h-4 w-4 mr-1 text-gray-400" />
								{stats?.lastImport ? new Date(stats.lastImport).toLocaleDateString() : "Never"}
							</>
						}
					/>
				</div>
			)}

			{/* Import Form */}
			<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 p-4">
				<h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
					<FolderOpen size={14} className="text-gray-400" />
					Import File Paths
				</h2>
				<textarea
					value={pathsInput}
					onChange={(e) => setPathsInput(e.target.value)}
					className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 resize-none font-mono"
					rows={6}
					placeholder={`Enter file paths, one per line:\nsrc/index.ts\nsrc/utils/helper.ts\ndocs/README.md`}
				/>
				<div className="flex items-center justify-between mt-2">
					<span className="text-xs text-gray-600">
						{pathsInput
							.split("\n")
							.map((p) => p.trim())
							.filter(Boolean).length}{" "}
						paths entered
					</span>
					<button
						onClick={handleImport}
						disabled={importing || !pathsInput.trim()}
						className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
					>
						{importing ? (
							<><RefreshCw size={12} className="animate-spin" /> Importing...</>
						) : (
							<><Upload size={12} /> Import</>
						)}
					</button>
				</div>
			</div>

			{/* Import Result */}
			{importResult && (
				<div className="border border-green-500/30 rounded-lg bg-green-900/10 p-4">
					<h3 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
						<CheckCircle2 size={14} />
						Import Complete
					</h3>
					<div className="grid grid-cols-2 gap-3 text-xs">
						<div>
							<span className="text-gray-500">Success:</span>
							<span className="text-green-400 ml-1">{importResult.successCount}</span>
						</div>
						<div>
							<span className="text-gray-500">Errors:</span>
							<span className="text-red-400 ml-1">{importResult.errorCount}</span>
						</div>
					</div>
					{importResult.imported.length > 0 && (
						<div className="mt-2">
							<span className="text-xs text-gray-500">Imported files:</span>
							<div className="mt-1 space-y-0.5">
								{importResult.imported.slice(0, 10).map((path) => (
									<div key={path} className="text-xs text-gray-400 font-mono flex items-center gap-1">
										<FileText size={10} className="text-green-400" />
										{path}
									</div>
								))}
								{importResult.imported.length > 10 && (
									<p className="text-xs text-gray-600 mt-1">
										...and {importResult.imported.length - 10} more
									</p>
								)}
							</div>
						</div>
					)}
					{importResult.errors && importResult.errors.length > 0 && (
						<div className="mt-2">
							<span className="text-xs text-gray-500">Errors:</span>
							<div className="mt-1 space-y-0.5">
								{importResult.errors.slice(0, 5).map((err, i) => (
									<div key={i} className="text-xs text-red-400 flex items-center gap-1">
										<XCircle size={10} />
										{err}
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{importError && (
				<div className="flex items-center gap-2 px-3 py-2 rounded bg-red-900/20 border border-red-500/30 text-red-400 text-xs">
					<AlertCircle size={14} />
					{importError}
				</div>
			)}

			{/* Recent Imports */}
			{stats?.recentImports && stats.recentImports.length > 0 && (
				<div>
					<h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
						<BarChart3 size={14} className="text-gray-400" />
						Recent Imports
					</h2>
					<div className="space-y-1.5">
						{stats.recentImports.slice(0, 10).map((imp, i) => (
							<div
								key={i}
								className="flex items-center gap-3 px-3 py-2 rounded border border-[#1e2535] bg-[#0f1117]/40"
							>
								<Upload size={12} className="text-blue-400 shrink-0" />
								<div className="flex-1 min-w-0">
									<div className="text-xs text-white">
										{imp.paths.length} path{imp.paths.length !== 1 ? "s" : ""}
									</div>
									<div className="text-[10px] text-gray-600">
										{imp.successCount} ok, {imp.errorCount} err
									</div>
								</div>
								<div className="text-[10px] text-gray-500 shrink-0">
									{new Date(imp.timestamp).toLocaleString()}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
