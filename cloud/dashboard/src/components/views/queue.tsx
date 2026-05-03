"use client"

import { useEffect, useState } from "react"
import { StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type QueueStats = {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
}

export function QueueView() {
	const [paused, setPaused] = useState(false)
	const [stats, setStats] = useState<QueueStats>({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const res = await fetch("/api/queue/stats")
				if (res.ok) {
					const data = await res.json()
					setStats({
						waiting: data.waiting || 0,
						active: data.active || 0,
						completed: data.completed || 0,
						failed: data.failed || 0,
						delayed: data.delayed || 0,
					})
				}
			} catch (err) {
				console.error("Error fetching queue stats:", err)
			}
		}
		fetchStats()
		const iv = setInterval(fetchStats, 3000)
		return () => clearInterval(iv)
	}, [])

	const lanes = [
		{ label: "Waiting", count: stats.waiting, status: "queued" as const },
		{ label: "Active", count: stats.active, status: "active" as const },
		{ label: "Completed", count: stats.completed, status: "completed" as const },
		{ label: "Failed", count: stats.failed, status: "failed" as const },
		{ label: "Delayed", count: stats.delayed, status: "idle" as const },
	]

	const colorMap: Record<string, string> = {
		queued: "text-amber-400",
		active: "text-blue-400",
		completed: "text-emerald-400",
		failed: "text-red-400",
		idle: "text-gray-500",
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<button
					onClick={() => setPaused(!paused)}
					className={`rounded-md border px-4 py-2 text-sm font-medium ${
						paused
							? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
							: "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
					}`}>
					{paused ? "Resume Queue" : "Pause Queue"}
				</button>
				<Badge status={paused ? "warning" : "online"} label={paused ? "PAUSED" : "RUNNING"} />
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{lanes.map((l) => (
					<StatCard key={l.label} label={l.label} value={l.count} color={colorMap[l.status]} />
				))}
			</div>
		</div>
	)
}
