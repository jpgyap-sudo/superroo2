"use client"

import { useState } from "react"
import { StatCard, Card } from "@/components/ui/card"
import { Loader2, Play } from "lucide-react"

export function DockerView() {
	const [result, setResult] = useState<string[] | null>(null)
	const [running, setRunning] = useState(false)

	const runTest = async () => {
		setRunning(true)
		try {
			const res = await fetch("/api/jobs", {
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
				<StatCard label="Image Status" value="Ready" color="text-emerald-400" />
				<StatCard label="Containers" value="2" sub="0 running · 2 exited" />
				<StatCard label="Sandbox" value="Enabled" color="text-emerald-400" />
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
