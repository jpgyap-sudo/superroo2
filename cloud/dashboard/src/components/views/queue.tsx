"use client"

import { useState } from "react"
import { StatCard } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function QueueView() {
	const [paused, setPaused] = useState(false)

	const lanes = [
		{ label: "Waiting", count: 3, status: "queued" as const },
		{ label: "Active", count: 2, status: "active" as const },
		{ label: "Completed", count: 42, status: "completed" as const },
		{ label: "Failed", count: 1, status: "failed" as const },
		{ label: "Delayed", count: 0, status: "idle" as const },
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
