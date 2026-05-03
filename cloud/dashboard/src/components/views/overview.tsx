"use client"

import { useEffect, useState } from "react"
import { StatCard, Card } from "@/components/ui/card"

type JobStats = {
	waiting: number
	active: number
	completed: number
	failed: number
	total: number
}

export function Overview() {
	const [system, setSystem] = useState({ cpu: 0, ram: 0, disk: 0 })
	const [jobStats, setJobStats] = useState<JobStats>({ waiting: 0, active: 0, completed: 0, failed: 0, total: 0 })
	const [health, setHealth] = useState({ status: "offline", redis: false, worker: false })

	useEffect(() => {
		const fetchData = async () => {
			try {
				const [sysRes, queueRes, healthRes] = await Promise.all([
					fetch("/api/system").catch(() => null),
					fetch("/api/queue/stats").catch(() => null),
					fetch("/api/health").catch(() => null),
				])

				if (sysRes?.ok) {
					const data = await sysRes.json()
					setSystem(data)
				}

				if (queueRes?.ok) {
					const data = await queueRes.json()
					setJobStats({
						waiting: data.waiting || 0,
						active: data.active || 0,
						completed: data.completed || 0,
						failed: data.failed || 0,
						total: data.total || 0,
					})
				}

				if (healthRes?.ok) {
					const data = await healthRes.json()
					setHealth(data)
				}
			} catch (err) {
				console.error("Error fetching overview data:", err)
			}
		}
		fetchData()
		const iv = setInterval(fetchData, 5000)
		return () => clearInterval(iv)
	}, [])

	const apiStatus = health.status === "online" ? "Online" : "Offline"
	const workerStatus = health.worker ? "Online" : "Offline"
	const redisStatus = health.redis ? "Online" : "Offline"

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					label="API"
					value={apiStatus}
					color={health.status === "online" ? "text-emerald-400" : "text-red-400"}
				/>
				<StatCard
					label="Worker"
					value={workerStatus}
					color={health.worker ? "text-emerald-400" : "text-red-400"}
				/>
				<StatCard
					label="Redis"
					value={redisStatus}
					color={health.redis ? "text-emerald-400" : "text-red-400"}
				/>
				<StatCard label="Docker" value="Active" color="text-blue-400" />
			</div>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Total Jobs" value={jobStats.total.toString()} />
				<StatCard label="Active Jobs" value={jobStats.active.toString()} color="text-blue-400" />
				<StatCard label="Failed Jobs" value={jobStats.failed.toString()} color="text-red-400" />
				<StatCard
					label="Completed"
					value={jobStats.completed.toString()}
					sub={`${jobStats.waiting} waiting`}
					color="text-emerald-400"
				/>
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
