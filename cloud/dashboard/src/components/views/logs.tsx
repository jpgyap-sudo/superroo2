"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Search } from "lucide-react"

const mockLogs = [
	"[09:45:12] [superroo-api] GET /status 200 3ms",
	"[09:45:10] [superroo-worker] JOB-002 started by Deploy Checker Agent",
	"[09:44:58] [superroo-api] POST /jobs 201 12ms",
	"[09:44:30] [docker] Container superroo-sandbox-01 exited 0",
	"[09:44:01] [superroo-worker] JOB-001 completed in 83s",
	"[09:43:55] [superroo-api] GET /queue/status 200 2ms",
	"[09:43:20] [superroo-worker] JOB-004 FAILED: build script exited 1",
	"[09:43:00] [docker] Pulling image node:20-alpine",
	"[09:42:45] [superroo-worker] JOB-005 completed in 190s",
	"[09:42:30] [superroo-api] GET /health 200 1ms",
	"[09:42:15] [redis] Connected to redis://127.0.0.1:6379",
	"[09:42:00] [superroo-worker] Received job 6 — task: sandbox test with fake repo",
	"[09:41:50] [docker] Running: docker run --rm --network=host -v /opt/superroo2/cloud/sandbox/jobs/6:/workspace",
	"[09:41:45] [superroo-worker] [stdout] total 16",
	"[09:41:44] [superroo-worker] [stdout] On branch master",
	"[09:41:43] [superroo-worker] [stdout] v20.20.2",
	"[09:41:42] [superroo-worker] [stdout] 10.33.2",
	"[09:41:41] [superroo-worker] [stdout] git version 2.39.5",
	"[09:41:40] [superroo-worker] Job 6 completed | success=true",
]

export function LogsView() {
	const [filter, setFilter] = useState("")
	const [logs, setLogs] = useState<string[]>(mockLogs)

	useEffect(() => {
		const iv = setInterval(() => {
			setLogs((prev) => {
				const next = [
					`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] [superroo-worker] Heartbeat check`,
					...prev,
				]
				return next.slice(0, 50)
			})
		}, 5000)
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
					{filtered.length === 0 && <div className="py-8 text-center text-gray-500">No logs available</div>}
					{filtered.map((l, i) => (
						<div
							key={i}
							className={`border-b border-[#1e2535]/50 px-3 py-1.5 last:border-0 ${
								l.includes("FAILED") || l.includes("error")
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
