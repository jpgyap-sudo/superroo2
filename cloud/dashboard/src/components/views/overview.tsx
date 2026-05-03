"use client"

import { useEffect, useState } from "react"
import { StatCard, Card } from "@/components/ui/card"

export function Overview() {
	const [system, setSystem] = useState({ cpu: 0, ram: 0, disk: 0 })

	useEffect(() => {
		const fetchData = async () => {
			try {
				const res = await fetch("/api/system")
				const data = await res.json()
				setSystem(data)
			} catch {}
		}
		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [])

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="API" value="Online" color="text-emerald-400" />
				<StatCard label="Worker" value="Online" color="text-emerald-400" />
				<StatCard label="Redis" value="Online" color="text-emerald-400" />
				<StatCard label="Docker" value="Active" color="text-blue-400" />
			</div>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Jobs Today" value="47" sub="↑ 12 vs yesterday" />
				<StatCard label="Active Jobs" value="2" color="text-blue-400" />
				<StatCard label="Failed Jobs" value="1" color="text-red-400" />
				<StatCard label="Last Completed" value="JOB-006" sub="exit 0 · 14:37" />
			</div>
			<Card>
				<div className="mb-3 text-[11px] uppercase tracking-widest text-gray-500">VPS Resources</div>
				<div className="space-y-3">
					{[
						{ label: "CPU", val: system.cpu },
						{ label: "RAM", val: system.ram },
						{ label: "Disk", val: system.disk },
					].map((r) => (
						<div key={r.label}>
							<div className="mb-1 flex justify-between text-xs text-gray-500">
								<span>{r.label}</span>
								<span>{r.val}%</span>
							</div>
							<div className="h-1.5 rounded bg-[#1e2535]">
								<div
									className="h-1.5 rounded transition-all duration-500"
									style={{
										width: `${r.val}%`,
										background: r.val > 80 ? "#ef4444" : r.val > 60 ? "#eab308" : "#3b82f6",
									}}
								/>
							</div>
						</div>
					))}
				</div>
			</Card>
		</div>
	)
}
