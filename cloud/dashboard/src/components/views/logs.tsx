"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Search } from "lucide-react"

export function LogsView() {
	const [filter, setFilter] = useState("")
	const [logs, setLogs] = useState<string[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetchLogs = async () => {
			try {
				const res = await fetch("/api/logs?limit=100")
				if (res.ok) {
					const data = await res.json()
					setLogs(data.logs || [])
				}
			} catch (err) {
				console.error("Error fetching logs:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchLogs()
		const iv = setInterval(fetchLogs, 5000)
		return () => clearInterval(iv)
	}, [])

	const filtered = logs.filter((l) => !filter || l.toLowerCase().includes(filter.toLowerCase()))

	return (
		<div className="space-y-3">
			<div className="relative">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
				<input
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Filter by job ID, status..."
					className="w-full rounded-md border border-[#1e2535] bg-[#0f1117] py-2 pl-9 pr-3 text-sm text-[#e2e8f0] placeholder:text-gray-600 focus:border-violet-600 focus:outline-none"
				/>
			</div>
			<Card>
				<div className="max-h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed">
					{loading && <div className="py-8 text-center text-gray-500">Loading logs...</div>}
					{!loading && filtered.length === 0 && (
						<div className="py-8 text-center text-gray-500">No logs available</div>
					)}
					{!loading &&
						filtered.map((l, i) => (
							<div
								key={i}
								className={`border-b border-[#1e2535]/50 px-3 py-1.5 last:border-0 ${
									l.includes("FAILED") || l.includes("error") || l.includes("Error")
										? "text-red-400"
										: l.includes("completed") || l.includes("success")
											? "text-emerald-400"
											: l.includes("started") || l.includes("active")
												? "text-blue-400"
												: "text-gray-500"
								}`}>
								{l}
							</div>
						))}
				</div>
			</Card>
		</div>
	)
}
