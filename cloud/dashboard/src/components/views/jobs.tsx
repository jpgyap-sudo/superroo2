"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

type Job = {
	id: string
	name: string
	data: any
	status: string
	timestamp: number
	processedOn?: number
	finishedOn?: number
	failedReason?: string
}

export function JobsView() {
	const [jobs, setJobs] = useState<Job[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetchJobs = async () => {
			try {
				const res = await fetch("/api/jobs?limit=50")
				if (res.ok) {
					const data = await res.json()
					setJobs(data.jobs || [])
				}
			} catch (err) {
				console.error("Error fetching jobs:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchJobs()
		const iv = setInterval(fetchJobs, 5000)
		return () => clearInterval(iv)
	}, [])

	const handleCancel = async (jobId: string) => {
		try {
			const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" })
			if (res.ok) {
				setJobs((prev) => prev.filter((j) => j.id !== jobId))
			}
		} catch (err) {
			console.error("Error cancelling job:", err)
		}
	}

	const handleRetry = async (jobId: string) => {
		try {
			const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" })
			if (res.ok) {
				// Refresh jobs list
				const listRes = await fetch("/api/jobs?limit=50")
				if (listRes.ok) {
					const data = await listRes.json()
					setJobs(data.jobs || [])
				}
			}
		} catch (err) {
			console.error("Error retrying job:", err)
		}
	}

	const formatTime = (timestamp?: number) => {
		if (!timestamp) return "—"
		const date = new Date(timestamp)
		return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
	}

	const formatDuration = (job: Job) => {
		if (!job.processedOn) return "—"
		const end = job.finishedOn || Date.now()
		const duration = Math.floor((end - job.processedOn) / 1000)
		const mins = Math.floor(duration / 60)
		const secs = duration % 60
		return `${mins}m ${secs}s`
	}

	if (loading) {
		return (
			<Card className="overflow-hidden">
				<div className="py-8 text-center text-gray-500">Loading jobs...</div>
			</Card>
		)
	}

	if (jobs.length === 0) {
		return (
			<Card className="overflow-hidden">
				<div className="py-8 text-center text-gray-500">No jobs found</div>
			</Card>
		)
	}

	return (
		<Card className="overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-[#1e2535] text-left text-gray-500">
							{["Job ID", "Task", "Agent", "Status", "Created", "Duration", "Actions"].map((h) => (
								<th key={h} className="px-3 py-2 font-medium">
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{jobs.map((j) => (
							<tr key={j.id} className="border-b border-[#1e2535]/50 text-gray-300 last:border-0">
								<td className="px-3 py-2.5 font-mono text-blue-400">{j.id}</td>
								<td className="px-3 py-2.5">{j.name || j.data?.task || "Untitled"}</td>
								<td className="px-3 py-2.5 text-violet-300">{j.data?.agentId || "—"}</td>
								<td className="px-3 py-2.5">
									<Badge status={j.status as any} />
								</td>
								<td className="px-3 py-2.5 text-gray-500">{formatTime(j.timestamp)}</td>
								<td className="px-3 py-2.5 text-gray-500">{formatDuration(j)}</td>
								<td className="px-3 py-2.5">
									<div className="flex gap-1.5">
										{j.status !== "completed" && j.status !== "failed" && (
											<button
												onClick={() => handleCancel(j.id)}
												className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-red-400 hover:bg-[#1e2535]">
												Cancel
											</button>
										)}
										{j.status === "failed" && (
											<button
												onClick={() => handleRetry(j.id)}
												className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-amber-400 hover:bg-[#1e2535]">
												Retry
											</button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Card>
	)
}
