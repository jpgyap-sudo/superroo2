"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type SystemStats = {
	cpu: number
	ram: number
	disk: number
}

type ApprovalRowConfig = {
	action: string
	risk: "Low" | "Medium" | "High" | "Critical"
	desc: string
	defaultChecked: boolean
}

type SettingsData = {
	autoApprove: boolean
	mcp: { enabled: boolean; servers: unknown[] }
	approval: {
		enabled: boolean
		rules: unknown[]
		maxApprovalCount: number
		maxCostUsd: number
		timeWindowMinutes: number
		rows: ApprovalRowConfig[]
	}
	guardrails: {
		maxConcurrentJobs: number
		cpuHighPercent: number
		ramHighPercent: number
		onHighCpu: string
		onHighRam: string
		cpuAction: string
	}
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
	checked,
	onToggle,
}: {
	action: string
	risk: "Low" | "Medium" | "High" | "Critical"
	desc: string
	checked: boolean
	onToggle: () => void
}) {
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
				<Toggle checked={checked} onChange={onToggle} />
				<button className="rounded-xl border border-[#1e2535] px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2535] md:mt-0">
					Edit Rules
				</button>
			</div>
		</div>
	)
}

function AccountSection() {
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [name, setName] = useState("")
	const [message, setMessage] = useState("")
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()
		setError("")
		setMessage("")
		if (!email || !password || !name) {
			setError("All fields are required.")
			return
		}
		if (password.length < 6) {
			setError("Password must be at least 6 characters.")
			return
		}
		setLoading(true)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const res = await fetch("/api/auth/register", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: name.trim() }),
			})
			const data = await res.json()
			if (!data.ok) {
				setError(data.error || "Registration failed.")
				return
			}
			setMessage(`Account created for ${data.email}.`)
			setEmail("")
			setPassword("")
			setName("")
		} catch {
			setError("Network error.")
		} finally {
			setLoading(false)
		}
	}

	return (
		<Card>
			<h2 className="text-lg font-bold">Create Account</h2>
			<p className="mt-1 text-sm text-gray-500">
				Create a new SuperRoo Cloud account. Users can sign in from the Web Dashboard, Telegram Mini App, or VS
				Code Extension.
			</p>
			<form onSubmit={handleCreate} className="mt-4 space-y-3">
				<div>
					<label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="John Doe"
						className="w-full rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
						required
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
					<input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="user@email.com"
						className="w-full rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
						required
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="At least 6 characters"
						className="w-full rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
						required
						minLength={6}
					/>
				</div>
				{error && (
					<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
						{error}
					</div>
				)}
				{message && (
					<div className="rounded-lg bg-emerald-900/20 border border-emerald-800/40 px-3 py-2 text-xs text-emerald-400">
						{message}
					</div>
				)}
				<button
					type="submit"
					disabled={loading}
					className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors">
					{loading ? "Creating..." : "Create Account"}
				</button>
			</form>
		</Card>
	)
}

export function SettingsView() {
	const [autoApprove, setAutoApprove] = useState(true)
	const [mcpEnabled, setMcpEnabled] = useState(true)
	const [stats, setStats] = useState<SystemStats | null>(null)
	const [cpuAction, setCpuAction] = useState("pause_crawler")
	const [approvalRows, setApprovalRows] = useState<ApprovalRowConfig[]>([])
	const [saveMessage, setSaveMessage] = useState("")
	const [saveError, setSaveError] = useState("")
	const [loading, setLoading] = useState(true)

	// Load settings from API on mount
	useEffect(() => {
		async function load() {
			try {
				const [settingsRes, statsRes] = await Promise.all([fetch("/api/settings"), fetch("/api/system")])
				if (settingsRes.ok) {
					const data = await settingsRes.json()
					const s: SettingsData = data.settings
					setAutoApprove(s.autoApprove ?? true)
					setMcpEnabled(s.mcp?.enabled ?? true)
					setCpuAction(s.guardrails?.cpuAction ?? "pause_crawler")
					setApprovalRows(s.approval?.rows ?? [])
				}
				if (statsRes.ok) {
					const statsData = await statsRes.json()
					setStats(statsData)
				}
			} catch {
				// Use defaults on error
			} finally {
				setLoading(false)
			}
		}
		load()

		const iv = setInterval(() => {
			fetch("/api/system")
				.then((r) => r.json())
				.then(setStats)
				.catch(() => {})
		}, 15000)
		return () => clearInterval(iv)
	}, [])

	const cpuHigh = stats && stats.cpu > 90

	const handleSave = async () => {
		setSaveMessage("")
		setSaveError("")
		try {
			const res = await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					settings: {
						autoApprove,
						mcp: { enabled: mcpEnabled, servers: [] },
						approval: {
							enabled: autoApprove,
							rules: [],
							maxApprovalCount: 10,
							maxCostUsd: 5,
							timeWindowMinutes: 60,
							rows: approvalRows,
						},
						guardrails: {
							maxConcurrentJobs: 3,
							cpuHighPercent: 80,
							ramHighPercent: 85,
							onHighCpu: "warn",
							onHighRam: "warn",
							cpuAction,
						},
					},
				}),
			})
			const data = await res.json()
			if (data.success) {
				setSaveMessage("Settings saved successfully.")
				setTimeout(() => setSaveMessage(""), 3000)
			} else {
				setSaveError(data.error || "Failed to save settings.")
			}
		} catch {
			setSaveError("Network error saving settings.")
		}
	}

	const toggleApprovalRow = (index: number) => {
		setApprovalRows((prev) => {
			const next = [...prev]
			next[index] = { ...next[index], defaultChecked: !next[index].defaultChecked }
			return next
		})
	}

	if (loading) {
		return <div className="flex items-center justify-center h-64 text-gray-500">Loading settings...</div>
	}

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
					<button
						onClick={handleSave}
						className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-400">
						Save
					</button>
				</div>
			</div>

			{saveMessage && (
				<div className="mb-4 rounded-lg bg-emerald-900/20 border border-emerald-800/40 px-4 py-2 text-sm text-emerald-400">
					{saveMessage}
				</div>
			)}
			{saveError && (
				<div className="mb-4 rounded-lg bg-red-900/20 border border-red-800/40 px-4 py-2 text-sm text-red-400">
					{saveError}
				</div>
			)}

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
							{approvalRows.map((row, i) => (
								<ApprovalRow
									key={row.action}
									action={row.action}
									risk={row.risk}
									desc={row.desc}
									checked={row.defaultChecked}
									onToggle={() => toggleApprovalRow(i)}
								/>
							))}
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
							<Toggle checked={mcpEnabled} onChange={() => setMcpEnabled(!mcpEnabled)} />
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

					<AccountSection />
				</div>
			</div>
		</div>
	)
}
