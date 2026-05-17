"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { GitCommit, Rocket, RefreshCw, Clock, AlertTriangle, User, FileText, Hash } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommitEntry {
	sha: string
	agent: string
	type: string
	title: string
	filesChanged: number
	timestamp: number
	featuresAffected: string[]
}

interface DeployEntry {
	version: string
	sha: string
	agent: string
	status: string
	timestamp: number
}

interface CommitDeployData {
	success: boolean
	commits: CommitEntry[]
	deploys: DeployEntry[]
	totalCommits: number
	totalDeploys: number
	note?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_EMOJI: Record<string, string> = {
	feature: "✨",
	bugfix: "🐛",
	refactor: "♻️",
	docs: "📝",
	config: "⚙️",
	test: "🧪",
	deploy: "🚀",
}

const STATUS_EMOJI: Record<string, string> = {
	healthy: "✅",
	unhealthy: "❌",
	rolled_back: "↩️",
	failed: "💥",
	completed: "✅",
}

function formatTime(ts: number) {
	if (!ts) return "—"
	return new Date(ts).toLocaleString()
}

function shortSha(sha: string) {
	return sha ? sha.slice(0, 7) : "???"
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommitDeployView() {
	const [data, setData] = useState<CommitDeployData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [limit, setLimit] = useState(10)

	const fetchData = async () => {
		setLoading(true)
		setError(null)
		try {
			const res = await fetch(`/api/orchestrator/commit-deploy-status?limit=${limit}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			setData(json)
		} catch (err: any) {
			setError(err.message || "Failed to fetch commit/deploy data")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [limit])

	return (
		<div className="flex flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<GitCommit className="h-5 w-5 text-[#60a5fa]" />
					<h1 className="text-lg font-semibold text-[#e2e8f0]">Commit & Deploy Log</h1>
				</div>
				<div className="flex items-center gap-2">
					<select
						value={limit}
						onChange={(e) => setLimit(Number(e.target.value))}
						className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-gray-400">
						<option value={5}>5</option>
						<option value={10}>10</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
					</select>
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1 rounded border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0] disabled:opacity-50">
						<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<Card className="border-red-800/40 bg-red-950/20">
					<div className="flex items-center gap-2 text-red-400">
						<AlertTriangle className="h-4 w-4" />
						<span className="text-sm">{error}</span>
					</div>
				</Card>
			)}

			{/* Loading */}
			{loading && !data && (
				<div className="flex items-center justify-center py-12">
					<RefreshCw className="h-6 w-6 animate-spin text-gray-500" />
				</div>
			)}

			{data && (
				<>
					{/* Stats */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<StatCard label="Total Commits" value={data.totalCommits} color="text-[#60a5fa]" />
						<StatCard label="Total Deploys" value={data.totalDeploys} color="text-[#34d399]" />
						<StatCard
							label="Recent Commits"
							value={data.commits.length}
							sub="in current view"
							color="text-[#a78bfa]"
						/>
						<StatCard
							label="Recent Deploys"
							value={data.deploys.length}
							sub="in current view"
							color="text-[#f472b6]"
						/>
					</div>

					{data.note && (
						<Card className="border-yellow-800/40 bg-yellow-950/20">
							<div className="flex items-center gap-2 text-yellow-400">
								<AlertTriangle className="h-4 w-4" />
								<span className="text-sm">{data.note}</span>
							</div>
						</Card>
					)}

					{/* Commits */}
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<GitCommit className="h-4 w-4 text-[#60a5fa]" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent Commits</h2>
							{data.commits.length === 0 && <Badge status="idle" label="Empty" className="ml-auto" />}
						</div>
						{data.commits.length === 0 ? (
							<p className="py-4 text-center text-sm text-gray-500">No commits recorded yet.</p>
						) : (
							<div className="flex flex-col gap-2">
								{data.commits.map((c, i) => (
									<div
										key={c.sha || i}
										className="flex flex-col gap-1 rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
										<div className="flex items-center gap-2">
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-[#60a5fa]">
												{shortSha(c.sha)}
											</code>
											<span className="text-[11px]">{TYPE_EMOJI[c.type] || "🔧"}</span>
											<span className="flex-1 truncate text-sm text-[#e2e8f0]">{c.title}</span>
											<Badge status={c.type} label={c.type} className="text-[10px]" />
										</div>
										<div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
											<span className="flex items-center gap-1">
												<User className="h-3 w-3" />
												{c.agent}
											</span>
											<span className="flex items-center gap-1">
												<FileText className="h-3 w-3" />
												{c.filesChanged} files
											</span>
											{c.featuresAffected && c.featuresAffected.length > 0 && (
												<span className="flex items-center gap-1">
													<Hash className="h-3 w-3" />
													{c.featuresAffected.join(", ")}
												</span>
											)}
											<span className="flex items-center gap-1 ml-auto">
												<Clock className="h-3 w-3" />
												{formatTime(c.timestamp)}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</Card>

					{/* Deploys */}
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<Rocket className="h-4 w-4 text-[#34d399]" />
							<h2 className="text-sm font-semibold text-[#e2e8f0]">Recent Deploys</h2>
							{data.deploys.length === 0 && <Badge status="idle" label="Empty" className="ml-auto" />}
						</div>
						{data.deploys.length === 0 ? (
							<p className="py-4 text-center text-sm text-gray-500">No deploys recorded yet.</p>
						) : (
							<div className="flex flex-col gap-2">
								{data.deploys.map((d, i) => (
									<div
										key={d.version + d.sha || i}
										className="flex flex-col gap-1 rounded border border-[#1e2535] bg-[#0a0e1a] p-3">
										<div className="flex items-center gap-2">
											<span className="text-[11px]">{STATUS_EMOJI[d.status] || "🔄"}</span>
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-[#34d399]">
												v{d.version}
											</code>
											<code className="rounded bg-[#1e2535] px-1.5 py-0.5 text-[11px] text-gray-400">
												{shortSha(d.sha)}
											</code>
											<span className="ml-auto">
												<Badge status={d.status} label={d.status} className="text-[10px]" />
											</span>
										</div>
										<div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
											<span className="flex items-center gap-1">
												<User className="h-3 w-3" />
												{d.agent}
											</span>
											<span className="flex items-center gap-1 ml-auto">
												<Clock className="h-3 w-3" />
												{formatTime(d.timestamp)}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</Card>
				</>
			)}
		</div>
	)
}
