"use client"

import { useState, useCallback } from "react"
import { Search, X, File, Loader2, ArrowRight } from "lucide-react"
import { searchWorkspaceFiles } from "./api"

interface SearchResult {
	file: string
	line: number
	content: string
	match: string
}

interface SearchPanelProps {
	onFileClick: (path: string, name: string) => void
	onClose: () => void
}

export default function SearchPanel({ onFileClick, onClose }: SearchPanelProps) {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [isSearching, setIsSearching] = useState(false)
	const [searched, setSearched] = useState(false)

	const handleSearch = useCallback(async () => {
		if (!query.trim()) return
		setIsSearching(true)
		setSearched(true)
		try {
			const data = await searchWorkspaceFiles(query)
			setResults(data.results || [])
		} catch {
			setResults([])
		} finally {
			setIsSearching(false)
		}
	}, [query])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				handleSearch()
			}
			if (e.key === "Escape") {
				onClose()
			}
		},
		[handleSearch, onClose],
	)

	return (
		<div className="flex flex-col h-full bg-[#0f1117] border-l border-[#1e2535]">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
				<div className="flex items-center gap-2">
					<Search className="w-3.5 h-3.5 text-[#8b949e]" />
					<span className="text-[12px] font-medium text-[#e6edf3]">Search</span>
				</div>
				<button
					className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
					onClick={onClose}>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Search input */}
			<div className="p-2">
				<div className="flex gap-1">
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search across workspace files..."
						className="flex-1 bg-[#0d1117] border border-[#1e2535] rounded px-2 py-1.5 text-[12px] text-[#e6edf3] placeholder-[#484f58] outline-none focus:border-[#1f6feb] transition-colors"
						autoFocus
					/>
					<button
						className="px-2 py-1.5 bg-[#1f6feb] text-white text-[12px] rounded hover:bg-[#388bfd] transition-colors disabled:opacity-50"
						onClick={handleSearch}
						disabled={!query.trim() || isSearching}>
						{isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
					</button>
				</div>
			</div>

			{/* Results */}
			<div className="flex-1 overflow-y-auto">
				{searched && results.length === 0 && !isSearching && (
					<div className="text-center py-8">
						<Search className="w-6 h-6 mx-auto mb-2 text-[#30363d]" />
						<p className="text-[11px] text-[#484f58]">No results found</p>
					</div>
				)}

				{results.map((result, i) => (
					<button
						key={i}
						className="w-full text-left px-3 py-1.5 hover:bg-[#1e2535] transition-colors border-b border-[#1e2535] last:border-0"
						onClick={() => {
							const name = result.file.split("/").pop() || result.file
							onFileClick(result.file, name)
						}}>
						<div className="flex items-center gap-1 text-[11px] text-[#58a6ff] mb-0.5">
							<File className="w-3 h-3" />
							<span className="truncate">{result.file}</span>
							<span className="text-[#484f58]">:{result.line}</span>
							<ArrowRight className="w-2.5 h-2.5 text-[#484f58] ml-auto" />
						</div>
						<div className="text-[11px] text-[#8b949e] font-mono truncate">{result.content}</div>
					</button>
				))}
			</div>
		</div>
	)
}
