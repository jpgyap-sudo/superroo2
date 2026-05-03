"use client"

import { useEffect, useState } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Loader2, Play } from "lucide-react"

type DockerStats = {
	containers: number
	running: number
	exited: number
	images: number
	sandboxReady: boolean
}

export function DockerView() {
	const [result, setResult] = useState<string[] | null>(null)
	const [running, setRunning] = useState(false)
	const [stats, setStats] = useState<DockerStats>({
		containers: 0,
		running: 0,
		exited: 0,
		images: 0,
		sandboxReady: false,
	})

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const res = await fetch("/api/docker/status")
				if (res.ok) {
					const data = await res.json()
					setStats({
						containers: data.containers || 0,
						running: data.running || 0,
						exited: data.exited || 0,
						images: data.images || 0,
						sandboxReady: data.sandboxReady || false,
					})
				}
			} catch (err) {
				console.error("Error fetching docker stats:", err)
			}
		}
		fetchStats()
		const iv = setInterval(fetchStats, 10000)
		return () => clearInterval(iv)
	}, [])

	const runTest = async () => {
		setRunning(true)
		try {
			const res = await fetch("/api/job", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					task: "dashboard sandbox test",
					commands: ["node -v", "npm -v", "pnpm -v", "git --version"],
					network: "host",
				}),
			})
			const data = await res.json()
			setResult([`Job ${data.jobId} queued successfully`, "Check Jobs tab for progress"])
		} catch {
			setResult(["Error: Could not reach VPS API"])
		}
		setRunning(false)
	}

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
				<StatCard
					label="Image Status"
					value={stats.sandboxReady ? "Ready" : "Not Ready"}
					color={stats.sandboxReady ? "text-emerald-400" : "text-amber-400"}
				/>
				<StatCard
					label="Containers"
					value={stats.containers}
					sub={`${stats.running} running · ${stats.exited} exited`}
				/>
				<StatCard label="Images" value={stats.images} color="text-blue-400" />
			</div>
			<Card>
				<div className="mb-2 text-[11px] uppercase tracking-widest text-gray-500">Workspace Path</div>
				<div className="mb-4 font-mono text-sm text-blue-400">/opt/superroo2/cloud/sandbox/jobs/</div>
				<div className="mb-2 text-[11px] uppercase tracking-widest text-gray-500">Logs Path</div>
				<div className="font-mono text-sm text-blue-400">/opt/superroo2/cloud/logs/jobs/</div>
			</Card>
			<button
				onClick={runTest}
				disabled={running}
				className="flex items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20 disabled:opacity-50">
				{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
				{running ? "Running sandbox test..." : "Run Sandbox Test"}
			</button>
			{result && (
				<div className="rounded-md border border-[#1e2535] bg-[#060810] p-4 font-mono text-sm leading-relaxed">
					{result.map((r, i) => (
						<div key={i} className="text-emerald-400">
							✓ {r}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
