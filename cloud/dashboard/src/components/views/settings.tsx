"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type SystemStats = {
	cpu: number
	ram: number
	disk: number
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
	return (
		<button
			onClick={onChange}
			className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-sky-500" : "bg-[#1e2535]"}`}>
			<span
				className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`}
			/>
		</button>
	)
}

function Card({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-[#1e2535] bg-[#0e1322] p-5 shadow-xl shadow-black/20">{children}</div>
	)
}

function Pill({
	children,
	tone = "blue",
}: {
	children: React.ReactNode
	tone?: "blue" | "green" | "amber" | "red" | "violet"
}) {
	const cls = {
		blue: "border-sky-500/25 bg-sky-500/15 text-sky-300",
		green: "border-emerald-500/25 bg-emerald-500/15 text-emerald-300",
		amber: "border-amber-500/25 bg-amber-500/15 text-amber-300",
		red: "border-red-500/25 bg-red-500/15 text-red-300",
		violet: "border-violet-500/25 bg-violet-500/15 text-violet-300",
	}[tone]
	return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>{children}</span>
}

function ApprovalRow({
	action,
	risk,
	desc,
	defaultChecked = true,
}: {
	action: string
	risk: "Low" | "Medium" | "High" | "Critical"
	desc: string
	defaultChecked?: boolean
}) {
	const [checked, setChecked] = useState(defaultChecked)
	const tone = risk === "Low" ? "green" : risk === "Medium" ? "blue" : risk === "High" ? "amber" : "red"

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-4 md:grid md:grid-cols-[1fr_110px_130px] md:items-center">
			<div>
				<div className="flex items-center gap-2">
					<p className="font-semibold text-[#e2e8f0]">{action}</p>
					<Pill tone={tone}>{risk}</Pill>
				</div>
				<p className="mt-1 text-xs text-gray-500">{desc}</p>
			</div>
			<div className="flex items-center gap-3 md:block">
				<Toggle checked={checked} onChange={() => setChecked(!checked)} />
				<button className="rounded-xl border border-[#1e2535] px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535] md:mt-0">
					Edit Rules
				</button>
			</div>
		</div>
	)
}

export function SettingsView() {
	const [autoApprove, setAutoApprove] = useState(true)
	const [mcp, setMcp] = useState(true)
	const [stats, setStats] = useState<SystemStats | null>(null)
	const [cpuAction, setCpuAction] = useState("pause_crawler")

	useEffect(() => {
		fetch("/api/system")
			.then((r) => r.json())
			.then(setStats)
			.catch(() => {})
		const iv = setInterval(() => {
			fetch("/api/system")
				.then((r) => r.json())
				.then(setStats)
				.catch(() => {})
		}, 15000)
		return () => clearInterval(iv)
	}, [])

	const cpuHigh = stats && stats.cpu > 90

	return (
		<div className="text-[#e2e8f0]">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<div className="text-xs uppercase tracking-[0.25em] text-gray-500">Settings</div>
					<h1 className="mt-1 text-2xl font-bold">Advanced VPS Control Center</h1>
					<p className="mt-1 text-sm text-gray-500">
						Control auto-approve, MCP tools, safety rules, and VPS guardrails.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Pill tone="green">API Online</Pill>
					{stats && <Pill tone={cpuHigh ? "red" : "amber"}>CPU {stats.cpu}%</Pill>}
					<button className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-400">
						Save
					</button>
				</div>
			</div>

			<div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
				<div className="space-y-6">
					<Card>
						<div className="mb-5 flex items-center justify-between">
							<div>
								<h2 className="text-lg font-bold">Auto-Approve Permission Engine</h2>
								<p className="mt-1 text-sm text-gray-500">
									Granular approvals for read, write, execute, MCP, deploy, and cost limits.
								</p>
							</div>
							<Toggle checked={autoApprove} onChange={() => setAutoApprove(!autoApprove)} />
						</div>

						<div className="space-y-3">
							<ApprovalRow
								action="Read Files"
								risk="Low"
								desc="Allow agents to inspect project files and logs."
							/>
							<ApprovalRow
								action="Write Files"
								risk="Medium"
								desc="Allow coding agents to edit repo files inside approved workspace."
							/>
							<ApprovalRow
								action="Execute Commands"
								risk="High"
								desc="Run tests, builds, docker logs, and diagnostics."
							/>
							<ApprovalRow
								action="MCP Tool Calls"
								risk="Medium"
								desc="Use Playwright, GitHub, database, or docs fetcher MCP tools."
							/>
							<ApprovalRow
								action="Deploy / Restart VPS"
								risk="Critical"
								desc="Restart services, rebuild Docker, pull updates, or deploy production."
								defaultChecked={false}
							/>
						</div>
					</Card>

					<Card>
						<div className="mb-5 flex items-center justify-between">
							<div>
								<h2 className="text-lg font-bold">MCP Servers & Tool Ecosystem</h2>
								<p className="mt-1 text-sm text-gray-500">
									Assign tools to agents and monitor risk, status, and usage.
								</p>
							</div>
							<Toggle checked={mcp} onChange={() => setMcp(!mcp)} />
						</div>

						<div className="space-y-3">
							{[
								["Playwright Browser MCP", "Crawler Agent", "Online", "Medium"],
								["GitHub MCP", "Deploy Agent", "Online", "High"],
								["VPS Shell MCP", "Ops Agent", "Warning", "Critical"],
								["Docs Fetcher MCP", "Coder Agent", "Online", "Low"],
							].map(([name, agent, status, risk]) => (
								<div
									key={name}
									className="flex flex-col gap-2 rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-4 md:grid md:grid-cols-[1fr_130px_100px_100px] md:items-center">
									<div>
										<p className="font-semibold text-[#e2e8f0]">{name}</p>
										<p className="text-xs text-gray-500">Assigned to {agent}</p>
									</div>
									<div className="flex items-center gap-3 md:block">
										<p className="text-sm text-gray-400 md:hidden">{agent}</p>
										<Pill tone={status === "Online" ? "green" : "amber"}>{status}</Pill>
										<button className="rounded-xl border border-[#1e2535] px-3 py-2 text-sm text-[#e2e8f0]">
											Manage
										</button>
									</div>
								</div>
							))}
						</div>
					</Card>
				</div>

				<div className="space-y-6">
					<Card>
						<h2 className="text-lg font-bold">VPS Guardrails</h2>
						<p className="mt-1 text-sm text-gray-500">
							Prevent autonomous jobs from overloading the server.
						</p>
						<div className="mt-4 space-y-3">
							{cpuHigh && (
								<div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
									CPU is {stats?.cpu}%. Recommended: pause crawler and limit execute actions.
								</div>
							)}
							<select
								value={cpuAction}
								onChange={(e) => setCpuAction(e.target.value)}
								className="w-full rounded-xl border border-[#1e2535] bg-[#0a0e1a] px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-sky-500">
								<option value="pause_crawler">If CPU above 90%: Pause crawler</option>
								<option value="pause_all">If CPU above 90%: Pause all jobs</option>
								<option value="notify">If CPU above 90%: Notify only</option>
							</select>
							{stats && (
								<div className="space-y-2 text-xs text-gray-500">
									<div className="flex justify-between">
										<span>RAM</span>
										<span>{stats.ram}%</span>
									</div>
									<div className="flex justify-between">
										<span>Disk</span>
										<span>{stats.disk}%</span>
									</div>
								</div>
							)}
						</div>
					</Card>

					<Card>
						<h2 className="text-lg font-bold">Live Decision Monitor</h2>
						<div className="mt-4 space-y-3 text-sm">
							<div className="rounded-xl bg-[#0a0e1a] p-3">
								<span className="text-emerald-300">Allowed</span> Read files in workspace
							</div>
							<div className="rounded-xl bg-[#0a0e1a] p-3">
								<span className="text-amber-300">Needs approval</span> Execute docker restart
							</div>
							<div className="rounded-xl bg-[#0a0e1a] p-3">
								<span className="text-red-300">Blocked</span> Dangerous command pattern
							</div>
							<div className="rounded-xl bg-[#0a0e1a] p-3">
								<span className="text-sky-300">Fallback</span> API failed, crawler selected
							</div>
						</div>
					</Card>

					<Card>
						<h2 className="text-lg font-bold">Quick Links</h2>
						<div className="mt-4 space-y-2">
							<a
								href="#"
								onClick={(e) => {
									e.preventDefault()
									// Navigate to API Keys tab
									window.dispatchEvent(new CustomEvent("navigate", { detail: "api-keys" }))
								}}
								className="block rounded-xl border border-[#1e2535] bg-[#0a0e1a] px-4 py-3 text-sm text-sky-300 hover:bg-[#1e2535]">
								→ Manage API Keys & Providers
							</a>
						</div>
					</Card>
				</div>
			</div>
		</div>
	)
}
