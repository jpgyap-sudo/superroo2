"use client"

import { useState, useEffect } from "react"
import { Database, RefreshCw, Search, Tag, AlertTriangle, BookOpen, X } from "lucide-react"

interface Lesson {
	id: string
	task: string
	task_type: string
	risk: string
	tags: string[]
	files: string[]
	models: string[]
	root_cause: string
	fix: string
	reusable_rule: string
	date?: string
}

interface MemoryData {
	lessons: Lesson[]
	total: number
	filtered: number
	tagCounts: Record<string, number>
}

const RISK_STYLE: Record<string, string> = {
	high: "bg-red-900/40 text-red-300 border-red-700/40",
	medium: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
	low: "bg-green-900/40 text-green-300 border-green-700/40",
}

const TYPE_STYLE: Record<string, string> = {
	backend: "bg-blue-900/40 text-blue-300",
	frontend: "bg-purple-900/40 text-purple-300",
	devops: "bg-orange-900/40 text-orange-300",
	ml: "bg-cyan-900/40 text-cyan-300",
	lesson: "bg-slate-800 text-slate-300",
	bugfix: "bg-rose-900/40 text-rose-300",
	decision: "bg-emerald-900/40 text-emerald-300",
}

export function MemoryExplorerView() {
	const [data, setData] = useState<MemoryData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [query, setQuery] = useState("")
	const [activeTag, setActiveTag] = useState<string | null>(null)
	const [expanded, setExpanded] = useState<string | null>(null)

	const fetchData = async (q = "") => {
		setLoading(true)
		setError(null)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const res = await fetch(`/api/memory-explorer?q=${encodeURIComponent(q)}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			setData(await res.json())
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [])

	const handleSearch = () => {
		const q = activeTag ? `${query} ${activeTag}`.trim() : query
		fetchData(q)
	}

	const handleTag = (tag: string) => {
		const next = activeTag === tag ? null : tag
		setActiveTag(next)
		fetchData(next ? `${query} ${next}`.trim() : query)
	}

	const topTags = data
		? Object.entries(data.tagCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12)
		: []

	return (
		<div className="flex flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Database className="h-5 w-5 text-[#60a5fa]" />
					<h1 className="text-lg font-semibold text-[#e2e8f0]">Memory Explorer</h1>
					{data && (
						<span className="rounded-full bg-[#1e2535] px-2 py-0.5 text-xs text-gray-400">
							{data.total} lessons
						</span>
					)}
				</div>
				<button
					onClick={() => fetchData(activeTag ? `${query} ${activeTag}`.trim() : query)}
					className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
					<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>

			{/* Search */}
			<div className="flex gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
					<input
						className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] py-2 pl-9 pr-3 text-sm text-[#e2e8f0] placeholder-gray-500 focus:border-[#60a5fa] focus:outline-none"
						placeholder="Search lessons, rules, files..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					/>
				</div>
				<button
					onClick={handleSearch}
					className="rounded-lg border border-[#1e2535] bg-[#1e293b] px-4 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535] transition-colors">
					Search
				</button>
				{(query || activeTag) && (
					<button
						onClick={() => {
							setQuery("")
							setActiveTag(null)
							fetchData("")
						}}
						className="rounded-lg border border-[#1e2535] px-3 py-2 text-gray-500 hover:text-gray-200 transition-colors">
						<X className="h-4 w-4" />
					</button>
				)}
			</div>

			{/* Tag Cloud */}
			{topTags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{topTags.map(([tag, count]) => (
						<button
							key={tag}
							onClick={() => handleTag(tag)}
							className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
								activeTag === tag
									? "border-[#60a5fa] bg-[#60a5fa]/20 text-[#60a5fa]"
									: "border-[#1e2535] bg-[#0f1117] text-gray-400 hover:border-[#60a5fa]/50 hover:text-gray-200"
							}`}>
							<Tag className="h-2.5 w-2.5" />
							{tag}
							<span className="opacity-60">{count}</span>
						</button>
					))}
				</div>
			)}

			{/* Stats */}
			{data && data.filtered !== data.total && (
				<p className="text-xs text-gray-500">
					Showing {data.filtered} of {data.total} lessons
				</p>
			)}

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					{error}
				</div>
			)}

			{/* Lessons */}
			{loading && !data && <div className="py-12 text-center text-sm text-gray-500">Loading lessons...</div>}

			<div className="flex flex-col gap-3">
				{(data?.lessons || []).map((lesson) => (
					<div
						key={lesson.id}
						className="rounded-xl border border-[#1e2535] bg-[#0f1117] transition-colors hover:border-[#1e2d45]">
						{/* Card header */}
						<button
							className="flex w-full items-start justify-between gap-3 p-4 text-left"
							onClick={() => setExpanded(expanded === lesson.id ? null : lesson.id)}>
							<div className="flex min-w-0 flex-col gap-1.5">
								<div className="flex flex-wrap items-center gap-2">
									<span
										className={`rounded-full border px-2 py-0.5 text-xs ${RISK_STYLE[lesson.risk] || RISK_STYLE.medium}`}>
										{lesson.risk} risk
									</span>
									{lesson.task_type && (
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[lesson.task_type] || "bg-gray-800 text-gray-400"}`}>
											{lesson.task_type}
										</span>
									)}
									{lesson.date && <span className="text-xs text-gray-600">{lesson.date}</span>}
								</div>
								<span className="font-medium text-[#e2e8f0]">{lesson.task}</span>
								<span className="text-sm text-gray-500 line-clamp-2">{lesson.root_cause}</span>
							</div>
							<span className="mt-1 shrink-0 text-gray-600 text-xs">
								{expanded === lesson.id ? "▲" : "▼"}
							</span>
						</button>

						{/* Expanded details */}
						{expanded === lesson.id && (
							<div className="border-t border-[#1e2535] px-4 pb-4 pt-3 space-y-3">
								<div className="rounded-lg border border-[#1e2535] bg-[#0a0d14] p-3">
									<div className="flex items-center gap-1.5 mb-1.5">
										<BookOpen className="h-3.5 w-3.5 text-[#60a5fa]" />
										<span className="text-xs font-semibold text-[#60a5fa]">Reusable Rule</span>
									</div>
									<p className="text-sm text-[#e2e8f0]">{lesson.reusable_rule}</p>
								</div>

								<div>
									<p className="mb-1 text-xs text-gray-500 font-medium">Fix Applied</p>
									<p className="text-sm text-gray-300">{lesson.fix}</p>
								</div>

								{lesson.files && lesson.files.length > 0 && (
									<div>
										<p className="mb-1.5 text-xs text-gray-500 font-medium">Files Changed</p>
										<div className="flex flex-wrap gap-1.5">
											{lesson.files.map((f) => (
												<span
													key={f}
													className="rounded bg-[#1e2535] px-2 py-0.5 font-mono text-xs text-gray-400">
													{f}
												</span>
											))}
										</div>
									</div>
								)}

								{lesson.models && lesson.models.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{lesson.models.map((m) => (
											<span
												key={m}
												className="rounded border border-[#1e2535] px-2 py-0.5 text-xs text-gray-500">
												🤖 {m}
											</span>
										))}
									</div>
								)}

								{lesson.tags && lesson.tags.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{lesson.tags.map((t) => (
											<button
												key={t}
												onClick={() => handleTag(t)}
												className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
													activeTag === t
														? "bg-[#60a5fa]/20 text-[#60a5fa]"
														: "bg-[#1e2535] text-gray-500 hover:text-gray-300"
												}`}>
												<Tag className="h-2.5 w-2.5" />
												{t}
											</button>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				))}
			</div>

			{data && data.lessons.length === 0 && !loading && (
				<div className="py-12 text-center text-sm text-gray-500">
					No lessons found{query || activeTag ? " for this search" : ""}.
				</div>
			)}
		</div>
	)
}
