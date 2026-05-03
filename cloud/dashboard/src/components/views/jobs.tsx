"use client"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

const mockJobs = [
	{
		id: "JOB-001",
		project: "SuperRoo",
		task: "Lint & test",
		agent: "Tester",
		status: "completed",
		created: "09:12",
		duration: "1m 23s",
	},
	{
		id: "JOB-002",
		project: "Trading Bot",
		task: "Deploy check",
		agent: "Deploy Checker",
		status: "active",
		created: "09:45",
		duration: "0m 42s",
	},
	{
		id: "JOB-003",
		project: "NeurologistAI",
		task: "Debug error",
		agent: "Debugger",
		status: "queued",
		created: "10:01",
		duration: "—",
	},
	{
		id: "JOB-004",
		project: "Mock Trader",
		task: "Build",
		agent: "Tester",
		status: "failed",
		created: "08:30",
		duration: "0m 18s",
	},
	{
		id: "JOB-005",
		project: "Signal Agent",
		task: "Crawl signals",
		agent: "Crawler",
		status: "completed",
		created: "07:55",
		duration: "3m 10s",
	},
]

export function JobsView() {
	return (
		<Card className="overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-[#1e2535] text-left text-gray-500">
							{["Job ID", "Project", "Task", "Agent", "Status", "Created", "Duration", "Actions"].map(
								(h) => (
									<th key={h} className="px-3 py-2 font-medium">
										{h}
									</th>
								),
							)}
						</tr>
					</thead>
					<tbody>
						{mockJobs.map((j) => (
							<tr key={j.id} className="border-b border-[#1e2535]/50 text-gray-300 last:border-0">
								<td className="px-3 py-2.5 font-mono text-blue-400">{j.id}</td>
								<td className="px-3 py-2.5">{j.project}</td>
								<td className="px-3 py-2.5">{j.task}</td>
								<td className="px-3 py-2.5 text-violet-300">{j.agent}</td>
								<td className="px-3 py-2.5">
									<Badge status={j.status} />
								</td>
								<td className="px-3 py-2.5 text-gray-500">{j.created}</td>
								<td className="px-3 py-2.5 text-gray-500">{j.duration}</td>
								<td className="px-3 py-2.5">
									<div className="flex gap-1.5">
										<button className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-blue-400 hover:bg-[#1e2535]">
											Logs
										</button>
										{j.status !== "completed" && (
											<button className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-red-400 hover:bg-[#1e2535]">
												Cancel
											</button>
										)}
										{j.status === "failed" && (
											<button className="rounded border border-[#1e2535] bg-[#0f1117] px-2 py-1 text-xs text-amber-400 hover:bg-[#1e2535]">
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
