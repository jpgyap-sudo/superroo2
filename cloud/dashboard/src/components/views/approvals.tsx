"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	ShieldCheck,
	AlertTriangle,
	FileText,
	Rocket,
	Clock3,
	SquareTerminal,
	Github,
	Cloud,
	Folder,
	Search,
	Filter,
	ChevronDown,
	Check,
	XCircle,
	Box,
	Lock,
	X,
	Bell,
	Settings,
	CheckCircle2,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

type RiskLevel = "low" | "medium" | "high" | "critical"
type ApprovalStatus = "pending" | "review" | "auto-approved" | "rejected" | "approved"

interface ApprovalRequest {
	id: string
	agent: string
	type: string
	action: string
	details: string
	risk: RiskLevel
	score: number
	status: ApprovalStatus
	age: string
	icon: string
}

interface PermissionRow {
	agent: string
	terminal: boolean
	github: boolean
	deploy: boolean
	database: "Read" | "Write" | "-"
	secrets: boolean
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
// (removed — approvals, permissions, and timeline now fetched from real API)

// ─── Helpers ─────────────────────────────────────────────────────────────────

const riskLabel: Record<RiskLevel, string> = {
	low: "LOW",
	medium: "MEDIUM",
	high: "HIGH",
	critical: "CRITICAL",
}

const riskBadgeStatus: Record<RiskLevel, string> = {
	low: "success",
	medium: "warning",
	high: "error",
	critical: "critical",
}

const iconMap: Record<string, React.ReactNode> = {
	rocket: <Rocket className="h-4 w-4" />,
	terminal: <SquareTerminal className="h-4 w-4" />,
	github: <Github className="h-4 w-4" />,
	cloud: <Cloud className="h-4 w-4" />,
	folder: <Folder className="h-4 w-4" />,
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ApprovalRow({ item, selected, onSelect }: { item: ApprovalRequest; selected: boolean; onSelect: () => void }) {
	const riskBorder: Record<RiskLevel, string> = {
		low: "border-emerald-500/20",
		medium: "border-amber-500/20",
		high: "border-red-500/30",
		critical: "border-red-500/50",
	}

	return (
		<button
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all hover:bg-white/[0.03]",
				riskBorder[item.risk],
				selected
					? "bg-blue-500/5 border-blue-500/40 shadow-[inset_0_0_20px_rgba(59,130,246,0.08)]"
					: "bg-[#0a0e1a]/60",
			)}>
			{/* Icon */}
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#1e2535] bg-violet-500/10">
				{iconMap[item.icon] || <FileText className="h-4 w-4 text-violet-400" />}
			</div>

			{/* Agent + Type */}
			<div className="min-w-0 flex-1 sm:w-40">
				<div className="flex items-center gap-1.5">
					<span className="truncate text-sm font-medium text-slate-200">{item.agent}</span>
					<span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
				</div>
				<p className="truncate text-[11px] text-slate-500">{item.type}</p>
			</div>

			{/* Action — hidden on small screens */}
			<div className="hidden min-w-0 flex-1 lg:block">
				<div className="truncate text-sm text-slate-300">{item.action}</div>
				<p className="truncate text-[11px] text-slate-600">{item.details}</p>
			</div>

			{/* Risk badge */}
			<Badge status={riskBadgeStatus[item.risk]} label={riskLabel[item.risk]} className="shrink-0" />

			{/* Score */}
			<div
				className={cn(
					"flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
					item.risk === "low" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
					item.risk === "medium" && "border-amber-500/30 bg-amber-500/10 text-amber-400",
					item.risk === "high" && "border-red-500/30 bg-red-500/10 text-red-400",
					item.risk === "critical" && "border-red-500/40 bg-red-500/15 text-red-400",
				)}>
				{item.score}
			</div>

			{/* Age */}
			<span className="hidden shrink-0 text-[11px] text-slate-600 sm:block">{item.age}</span>

			{/* Status action */}
			<div className="shrink-0">
				{item.status === "auto-approved" ? (
					<span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-400">
						<CheckCircle2 className="h-3 w-3" />
						Auto-approved
					</span>
				) : (
					<div className="flex items-center gap-1">
						<button
							onClick={(e) => {
								e.stopPropagation()
							}}
							className="rounded-md bg-violet-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500">
							Review
						</button>
						<button
							onClick={(e) => {
								e.stopPropagation()
							}}
							className="rounded-md border border-slate-700/50 bg-slate-800/50 px-2.5 py-1.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-300">
							Reject
						</button>
					</div>
				)}
			</div>
		</button>
	)
}

function DetailPanel({ request }: { request: ApprovalRequest | null }) {
	if (!request) {
		return (
			<Card className="flex h-full items-center justify-center border-dashed border-slate-700/30 bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
				<div className="text-center">
					<ShieldCheck className="mx-auto h-10 w-10 text-slate-700" />
					<p className="mt-3 text-sm text-slate-600">Select an approval request to view details</p>
				</div>
			</Card>
		)
	}

	return (
		<Card className="relative border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
			{/* Header */}
			<div className="flex items-start justify-between border-b border-[#1e2535] pb-3">
				<div>
					<h3 className="text-sm font-semibold text-slate-200">{request.action}</h3>
					<p className="text-[11px] text-slate-500">Request ID: {request.id}</p>
				</div>
				<X className="h-4 w-4 cursor-pointer text-slate-600 hover:text-slate-400" />
			</div>

			{/* Floating risk badge */}
			{(request.risk === "high" || request.risk === "critical") && (
				<div className="absolute right-4 top-12">
					<Badge status="critical" label={`${riskLabel[request.risk]} RISK`} />
				</div>
			)}

			{/* Risk Analysis */}
			<div className="mt-4 rounded-lg border border-[#1e2535] bg-[#060810] p-3">
				<h4 className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">RISK ANALYSIS</h4>
				<div className="flex items-center gap-4">
					{/* Donut chart */}
					<div
						className={cn(
							"relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full",
							request.risk === "low" && "bg-[conic-gradient(#22c55e_0%_18%,rgba(255,255,255,0.08)_18%)]",
							request.risk === "medium" &&
								"bg-[conic-gradient(#f59e0b_0%_48%,rgba(255,255,255,0.08)_48%)]",
							request.risk === "high" && "bg-[conic-gradient(#ef4444_0%_82%,rgba(255,255,255,0.08)_82%)]",
							request.risk === "critical" &&
								"bg-[conic-gradient(#ef4444_0%_95%,rgba(255,255,255,0.08)_95%)]",
						)}>
						<div className="absolute inset-3 rounded-full bg-[#0a0e1a]" />
						<div className="relative z-10 text-center">
							<span className="text-xl font-bold text-slate-200">{request.score}</span>
							<span className="block text-[10px] text-slate-500">/100</span>
						</div>
					</div>

					{/* Metrics */}
					<div className="flex-1 space-y-1.5">
						<div className="flex justify-between border-b border-[#1e2535] pb-1 text-[11px]">
							<span className="text-slate-500">Confidence</span>
							<span className="text-slate-300">91%</span>
						</div>
						<div className="flex justify-between border-b border-[#1e2535] pb-1 text-[11px]">
							<span className="text-slate-500">Rollback Ready</span>
							<span className="text-emerald-400">Yes</span>
						</div>
						<div className="flex justify-between border-b border-[#1e2535] pb-1 text-[11px]">
							<span className="text-slate-500">Files Affected</span>
							<span className="text-slate-300">18</span>
						</div>
						<div className="flex justify-between border-b border-[#1e2535] pb-1 text-[11px]">
							<span className="text-slate-500">Production Impact</span>
							<span className="text-amber-400">Medium</span>
						</div>
						<div className="flex justify-between text-[11px]">
							<span className="text-slate-500">Est. Downtime</span>
							<span className="text-slate-300">{"<"} 15 sec</span>
						</div>
					</div>
				</div>
			</div>

			{/* AI Explanation */}
			<div className="mt-3 rounded-lg border border-[#1e2535] bg-[#060810] p-3">
				<h4 className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">AI EXPLANATION</h4>
				<div className="space-y-2 text-[11px]">
					<div>
						<span className="font-medium text-slate-400">Why is this needed?</span>
						<p className="mt-0.5 text-slate-500">
							This deployment fixes a memory leak in the websocket service that is causing high RAM usage.
						</p>
					</div>
					<div>
						<span className="font-medium text-slate-400">Expected Outcome</span>
						<p className="mt-0.5 text-slate-500">
							Reduce RAM usage by ~32% and improve connection stability.
						</p>
					</div>
					<div>
						<span className="font-medium text-red-400">Potential Risks</span>
						<p className="mt-0.5 text-slate-500">Temporary websocket disconnects during service restart.</p>
					</div>
					<div>
						<span className="font-medium text-emerald-400">Rollback Plan</span>
						<p className="mt-0.5 text-slate-500">
							Automatic rollback available via previous deployment snapshot.
						</p>
					</div>
				</div>
			</div>

			{/* Sandbox Preview */}
			<div className="mt-3 rounded-lg border border-[#1e2535] bg-[#060810] p-3">
				<h4 className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">SANDBOX PREVIEW</h4>
				<div className="rounded-lg border border-[#1e2535] bg-[#020617] p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
					Tests passed 142/142
					<br />
					Memory usage -32.4%
					<br />
					Build time 1m 42s
				</div>
			</div>

			{/* Actions */}
			<div className="mt-4 grid grid-cols-3 gap-2">
				<button className="flex items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 py-2.5 text-[11px] font-medium text-white hover:bg-violet-500">
					<Check className="h-3.5 w-3.5" />
					Approve
				</button>
				<button className="flex items-center justify-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-[11px] text-blue-400 hover:bg-blue-500/20">
					<Box className="h-3.5 w-3.5" />
					Sandbox Test First
				</button>
				<button className="flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400 hover:bg-red-500/20">
					<XCircle className="h-3.5 w-3.5" />
					Reject
				</button>
			</div>

			{/* Approval Chain */}
			<div className="mt-3 flex items-center gap-2 rounded-lg border border-[#1e2535] bg-[#060810] px-3 py-2 text-[11px] text-violet-400">
				<Lock className="h-3.5 w-3.5 shrink-0" />
				<span>Tester Agent Approved → Human Approval Pending → Production Guard Pending</span>
			</div>
		</Card>
	)
}

function LiveActivityTimeline() {
	const [timeline, setTimeline] = useState<{ time: string; event: string }[]>([])
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const fetchTimeline = async () => {
			try {
				const res = await fetch("/api/activity/timeline?limit=20")
				if (res.ok) {
					const data = await res.json()
					setTimeline(Array.isArray(data) ? data : data.events ?? [])
				}
			} catch (err) {
				console.error("Error fetching timeline:", err)
			}
		}
		fetchTimeline()
		const iv = setInterval(fetchTimeline, 10000)
		return () => clearInterval(iv)
	}, [])

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [timeline])

	return (
		<div ref={scrollRef} className="max-h-48 space-y-1 overflow-y-auto">
			{timeline.length === 0 ? (
				<p className="text-[11px] text-slate-500">No timeline events yet</p>
			) : (
				timeline.map((t, i) => (
					<div key={i} className="flex gap-2 border-l border-violet-500/30 pl-3 text-[11px]">
						<span className="shrink-0 text-slate-500">{t.time}</span>
						<span className="text-slate-400">{t.event}</span>
					</div>
				))
			)}
		</div>
	)
}

function PermissionMatrix() {
	const [permissions, setPermissions] = useState<PermissionRow[]>([])

	useEffect(() => {
		const fetchPermissions = async () => {
			try {
				const res = await fetch("/api/permissions")
				if (res.ok) {
					const data = await res.json()
					setPermissions(Array.isArray(data) ? data : data.permissions ?? [])
				}
			} catch (err) {
				console.error("Error fetching permissions:", err)
			}
		}
		fetchPermissions()
	}, [])

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-[11px]">
				<thead>
					<tr className="border-b border-[#1e2535] text-[10px] uppercase tracking-wider text-slate-500">
						<th className="py-1.5 pr-2 font-medium">Agent</th>
						<th className="px-2 py-1.5 font-medium">Terminal</th>
						<th className="px-2 py-1.5 font-medium">GitHub</th>
						<th className="px-2 py-1.5 font-medium">Deploy</th>
						<th className="px-2 py-1.5 font-medium">DB</th>
						<th className="pl-2 py-1.5 font-medium">Secrets</th>
					</tr>
				</thead>
				<tbody>
					{permissions.length === 0 ? (
						<tr>
							<td colSpan={6} className="py-4 text-center text-[11px] text-slate-500">
								No permissions data
							</td>
						</tr>
					) : (
						permissions.map((p) => (
							<tr key={p.agent} className="border-b border-[#1e2535]/50">
								<td className="py-1.5 pr-2 text-slate-300">{p.agent}</td>
								<td className="px-2 py-1.5 text-center text-slate-500">
									{p.terminal ? <span className="text-emerald-400">✓</span> : "—"}
								</td>
								<td className="px-2 py-1.5 text-center text-slate-500">
									{p.github ? <span className="text-emerald-400">✓</span> : "—"}
								</td>
								<td className="px-2 py-1.5 text-center text-slate-500">
									{p.deploy ? <span className="text-emerald-400">✓</span> : "—"}
								</td>
								<td className="px-2 py-1.5 text-center text-slate-500">{p.database}</td>
								<td className="pl-2 py-1.5 text-center text-slate-500">
									{p.secrets ? <span className="text-emerald-400">✓</span> : "—"}
								</td>
							</tr>
						))
					)}
				</tbody>
			</table>
			<button className="mt-2 w-full text-center text-[11px] text-violet-400 hover:text-violet-300">
				Manage Permissions
			</button>
		</div>
	)
}

// ─── Main View ──────────────────────────────────────────────────────────────

export function ApprovalsView() {
	const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [filterTab, setFilterTab] = useState<string>("all")
	const [searchQuery, setSearchQuery] = useState("")

	useEffect(() => {
		const fetchApprovals = async () => {
			try {
				const res = await fetch("/api/approvals")
				if (res.ok) {
					const data = await res.json()
					setApprovals(Array.isArray(data) ? data : data.approvals ?? [])
				}
			} catch (err) {
				console.error("Error fetching approvals:", err)
			} finally {
				setLoading(false)
			}
		}
		fetchApprovals()
		const iv = setInterval(fetchApprovals, 10000)
		return () => clearInterval(iv)
	}, [])

	const selectedRequest = approvals.find((a) => a.id === selectedId) || null

	const pendingCount = approvals.filter((a) => a.status === "pending").length
	const highRiskCount = approvals.filter((a) => a.risk === "high" || a.risk === "critical").length
	const autoApprovedCount = approvals.filter((a) => a.status === "auto-approved").length
	const mediumRiskCount = approvals.filter((a) => a.risk === "medium").length
	const lowRiskCount = approvals.filter((a) => a.risk === "low").length

	const filteredApprovals = approvals
		.filter((a) => {
			if (filterTab === "high") return a.risk === "high" || a.risk === "critical"
			if (filterTab === "medium") return a.risk === "medium"
			if (filterTab === "low") return a.risk === "low"
			return true
		})
		.filter((a) => {
			if (!searchQuery) return true
			const q = searchQuery.toLowerCase()
			return (
				a.id.toLowerCase().includes(q) ||
				a.agent.toLowerCase().includes(q) ||
				a.action.toLowerCase().includes(q) ||
				a.type.toLowerCase().includes(q)
			)
		})

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-bold text-slate-200">Approvals</h1>
					<p className="text-[11px] text-slate-500">Mission Control for Autonomous Agents</p>
				</div>
				<div className="flex items-center gap-2">
					<button className="flex items-center gap-1.5 rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-300">
						<Settings className="h-3 w-3" />
						Auto-Approval Rules
					</button>
					<button className="relative flex items-center justify-center rounded-md border border-slate-700/50 bg-slate-800/50 p-1.5 text-slate-400 hover:border-slate-600 hover:text-slate-300">
						<Bell className="h-4 w-4" />
						<span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
							12
						</span>
					</button>
					<span className="rounded-md border border-[#1e2535] bg-[#0a0e1a] px-3 py-1.5 text-[11px] text-slate-500">
						{new Date().toLocaleTimeString("en-US", {
							hour: "2-digit",
							minute: "2-digit",
							second: "2-digit",
							hour12: false,
						})}{" "}
						UTC
					</span>
				</div>
			</div>

			{/* Stat Cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<StatCard
					label="Pending Approvals"
					value={
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-violet-400" />
							<span>{pendingCount}</span>
						</div>
					}
					color="text-violet-400"
					sub="+2 from last hour"
				/>
				<StatCard
					label="High Risk"
					value={
						<div className="flex items-center gap-2">
							<AlertTriangle className="h-4 w-4 text-red-400" />
							<span>{highRiskCount}</span>
						</div>
					}
					color="text-red-400"
					sub="Requires attention"
				/>
				<StatCard
					label="Auto-Approved"
					value={
						<div className="flex items-center gap-2">
							<ShieldCheck className="h-4 w-4 text-emerald-400" />
							<span>{autoApprovedCount}</span>
						</div>
					}
					color="text-emerald-400"
					sub="Last 24 hours"
				/>
				<StatCard
					label="Deployments Today"
					value={
						<div className="flex items-center gap-2">
							<Rocket className="h-4 w-4 text-blue-400" />
							<span>5</span>
						</div>
					}
					color="text-blue-400"
					sub="3 successful"
				/>
				<StatCard
					label="Rollbacks"
					value={
						<div className="flex items-center gap-2">
							<Clock3 className="h-4 w-4 text-amber-400" />
							<span>1</span>
						</div>
					}
					color="text-amber-400"
					sub="Last 7 days"
				/>
			</div>

			{/* Main Content Grid */}
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
				{/* Left Column */}
				<div className="space-y-4">
					{/* Toolbar */}
					<div className="flex flex-wrap items-center gap-2">
						<button
							onClick={() => setFilterTab("all")}
							className={cn(
								"rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
								filterTab === "all"
									? "bg-violet-600 text-white"
									: "border border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300",
							)}>
							All ({approvals.length})
						</button>
						<button
							onClick={() => setFilterTab("high")}
							className={cn(
								"rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
								filterTab === "high"
									? "bg-red-600 text-white"
									: "border border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300",
							)}>
							High Risk ({highRiskCount})
						</button>
						<button
							onClick={() => setFilterTab("medium")}
							className={cn(
								"rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
								filterTab === "medium"
									? "bg-amber-600 text-white"
									: "border border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300",
							)}>
							Medium ({mediumRiskCount})
						</button>
						<button
							onClick={() => setFilterTab("low")}
							className={cn(
								"rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
								filterTab === "low"
									? "bg-emerald-600 text-white"
									: "border border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300",
							)}>
							Low ({lowRiskCount})
						</button>

						<div className="flex items-center gap-1.5 rounded-md border border-slate-700/50 bg-[#0a0e1a] px-2.5 py-1.5">
							<Filter className="h-3 w-3 text-slate-500" />
							<span className="text-[11px] text-slate-500">Filter</span>
						</div>

						<div className="flex flex-1 items-center gap-2 rounded-md border border-slate-700/50 bg-[#0a0e1a] px-2.5 py-1.5 min-w-[180px]">
							<Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
							<input
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search approvals..."
								className="w-full bg-transparent text-[11px] text-slate-300 outline-none placeholder:text-slate-600"
							/>
						</div>

						<button className="flex items-center gap-1 rounded-md border border-slate-700/50 bg-slate-800/50 px-2.5 py-1.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-300">
							Sort: Newest
							<ChevronDown className="h-3 w-3" />
						</button>
					</div>

					{/* Approval Queue */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<h2 className="mb-3 text-sm font-semibold text-slate-200">Approval Queue</h2>
						<div className="space-y-2">
							{filteredApprovals.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-8 text-slate-600">
									<ShieldCheck className="mb-2 h-8 w-8" />
									<p className="text-sm">No matching approvals</p>
								</div>
							) : (
								filteredApprovals.map((item) => (
									<ApprovalRow
										key={item.id}
										item={item}
										selected={selectedId === item.id}
										onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)}
									/>
								))
							)}
						</div>
						<p className="mt-3 text-[11px] text-slate-600">
							Showing {filteredApprovals.length} of {approvals.length} approvals
						</p>
					</Card>

					{/* Lower Grid: Timeline + Permissions + Analytics */}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						{/* Live Activity Timeline */}
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">
								LIVE ACTIVITY TIMELINE
							</h3>
							<LiveActivityTimeline />
						</Card>

						{/* Permission Matrix */}
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">
								PERMISSION MATRIX
							</h3>
							<PermissionMatrix />
						</Card>

						{/* Approval Analytics */}
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
							<h3 className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">
								APPROVAL ANALYTICS
							</h3>
							<div className="space-y-2">
								<div className="flex items-center justify-between border-b border-[#1e2535] pb-1.5">
									<span className="text-[11px] text-slate-500">Avg approval time</span>
									<span className="text-sm font-bold text-violet-400">2m 14s</span>
								</div>
								<div className="flex items-center justify-between border-b border-[#1e2535] pb-1.5">
									<span className="text-[11px] text-slate-500">Approval rate</span>
									<span className="text-sm font-bold text-emerald-400">94.2%</span>
								</div>
								<div className="flex items-center justify-between border-b border-[#1e2535] pb-1.5">
									<span className="text-[11px] text-slate-500">Rejection rate</span>
									<span className="text-sm font-bold text-red-400">5.8%</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-[11px] text-slate-500">Auto-approval rate</span>
									<span className="text-sm font-bold text-violet-400">68.3%</span>
								</div>
							</div>
						</Card>
					</div>

					{/* Auto-Approval Rules */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
						<h3 className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">
							AUTO-APPROVAL RULES <span className="text-emerald-400">(3 ACTIVE)</span>
						</h3>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
							<div className="rounded-lg border border-[#1e2535] bg-[#060810] p-2.5">
								<p className="text-[11px] text-slate-400">
									Low risk file operations
									<span className="float-right text-emerald-400">Active</span>
								</p>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#060810] p-2.5">
								<p className="text-[11px] text-slate-400">
									Tests and linting
									<span className="float-right text-emerald-400">Active</span>
								</p>
							</div>
							<div className="rounded-lg border border-[#1e2535] bg-[#060810] p-2.5">
								<p className="text-[11px] text-slate-400">
									Documentation changes
									<span className="float-right text-emerald-400">Active</span>
								</p>
							</div>
						</div>
					</Card>
				</div>

				{/* Right Column — Detail Panel */}
				<DetailPanel request={selectedRequest} />
			</div>
		</div>
	)
}
