{
	/* NOTE: Guardrails are local-only until backend save is wired */
}
{
	;(() => {
		const [guardrails, setGuardrails] = useState({
			maxConcurrentJobs: 3,
			cpuHighPercent: 80,
			ramHighPercent: 85,
			onHighCpu: "throttle",
			onHighRam: "throttle",
		})
		return (
			<div className="grid grid-cols-2 gap-4">
				<label className="block">
					<span className="text-xs text-vscode-descriptionForeground">Max Concurrent Jobs</span>
					<input
						type="number"
						value={guardrails.maxConcurrentJobs}
						onChange={(e) => setGuardrails((g) => ({ ...g, maxConcurrentJobs: Number(e.target.value) }))}
						className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
					/>
				</label>
				<label className="block">
					<span className="text-xs text-vscode-descriptionForeground">CPU High %</span>
					<input
						type="number"
						value={guardrails.cpuHighPercent}
						onChange={(e) => setGuardrails((g) => ({ ...g, cpuHighPercent: Number(e.target.value) }))}
						className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
					/>
				</label>
				<label className="block">
					<span className="text-xs text-vscode-descriptionForeground">RAM High %</span>
					<input
						type="number"
						value={guardrails.ramHighPercent}
						onChange={(e) => setGuardrails((g) => ({ ...g, ramHighPercent: Number(e.target.value) }))}
						className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
					/>
				</label>
				<label className="block">
					<span className="text-xs text-vscode-descriptionForeground">On High CPU</span>
					<select
						value={guardrails.onHighCpu}
						onChange={(e) => setGuardrails((g) => ({ ...g, onHighCpu: e.target.value }))}
						className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder">
						<option value="warn">Warn</option>
						<option value="throttle">Throttle</option>
						<option value="block">Block</option>
					</select>
				</label>
				<label className="block">
					<span className="text-xs text-vscode-descriptionForeground">On High RAM</span>
					<select
						value={guardrails.onHighRam}
						onChange={(e) => setGuardrails((g) => ({ ...g, onHighRam: e.target.value }))}
						className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder">
						<option value="warn">Warn</option>
						<option value="throttle">Throttle</option>
						<option value="block">Block</option>
					</select>
				</label>
			</div>
		)
	})()
}
import { useState, useEffect } from "react"
import {
	Shield,
	Server,
	Route,
	Gauge,
	Activity,
	AlertTriangle,
	CheckCircle,
	XCircle,
	Brain,
	Cpu,
	Zap,
	Globe,
	Network,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSr } from "../../hooks/SrContext"
import type { SrAgentRoute } from "../../hooks/SrContext"

// ── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "Low" | "Medium" | "High" | "Critical"
type ApprovalDecision = "allow" | "require_approval" | "block"

interface ApprovalRule {
	action: string
	desc: string
	risk: RiskLevel
	enabled: boolean
	decision: ApprovalDecision
	maxUses?: number
}

interface MCPServer {
	name: string
	use: string
	status: "connected" | "disconnected" | "error"
	agent: string
	risk: RiskLevel
}

interface AgentRouteDisplay {
	agent: string
	label: string
	primary: string
	primaryModel: string
	fallback: string
	fallbackModel: string
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Pill({
	children,
	tone = "blue",
}: {
	children: React.ReactNode
	tone?: "blue" | "green" | "red" | "amber" | "slate" | "violet"
}) {
	const colors: Record<string, string> = {
		blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
		green: "bg-green-500/10 text-green-400 border-green-500/20",
		red: "bg-red-500/10 text-red-400 border-red-500/20",
		amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
		slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
		violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
	}
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
				colors[tone],
			)}>
			{children}
		</span>
	)
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={onChange}
			className={cn(
				"relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
				checked ? "bg-green-500" : "bg-slate-700",
			)}>
			<span
				className={cn(
					"pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
					checked ? "translate-x-4" : "translate-x-0",
				)}
			/>
		</button>
	)
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("rounded-lg border border-vscode-panel-border bg-vscode-sideBar-background", className)}>
			{children}
		</div>
	)
}

function SectionHead({
	icon: Icon,
	title,
	desc,
	right,
}: {
	icon: React.ComponentType<{ className?: string }>
	title: string
	desc: string
	right?: React.ReactNode
}) {
	return (
		<div className="flex items-start justify-between p-4 border-b border-vscode-panel-border">
			<div className="flex items-start gap-3">
				<Icon className="size-5 text-vscode-foreground mt-0.5" />
				<div>
					<h3 className="text-sm font-medium text-vscode-foreground">{title}</h3>
					<p className="text-xs text-vscode-descriptionForeground mt-0.5">{desc}</p>
				</div>
			</div>
			{right && <div className="shrink-0">{right}</div>}
		</div>
	)
}

function ApprovalRow({ action, desc, risk, enabled }: ApprovalRule) {
	const riskColors: Record<RiskLevel, string> = {
		Low: "bg-green-500/10 text-green-400",
		Medium: "bg-amber-500/10 text-amber-400",
		High: "bg-orange-500/10 text-orange-400",
		Critical: "bg-red-500/10 text-red-400",
	}

	return (
		<div className="flex items-center justify-between py-2 px-4">
			<div className="flex-1">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-vscode-foreground">{action}</span>
					<span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", riskColors[risk])}>
						{risk}
					</span>
				</div>
				<p className="text-[11px] text-vscode-descriptionForeground mt-0.5">{desc}</p>
			</div>
			<Toggle checked={enabled} onChange={() => {}} />
		</div>
	)
}

function MCPRow({ name, use, status, agent, risk }: MCPServer) {
	const statusIcon: Record<string, React.ReactNode> = {
		connected: <CheckCircle className="size-3 text-green-400" />,
		disconnected: <XCircle className="size-3 text-slate-500" />,
		error: <AlertTriangle className="size-3 text-red-400" />,
	}

	const riskColors: Record<RiskLevel, string> = {
		Low: "bg-green-500/10 text-green-400",
		Medium: "bg-amber-500/10 text-amber-400",
		High: "bg-orange-500/10 text-orange-400",
		Critical: "bg-red-500/10 text-red-400",
	}

	return (
		<div className="flex items-center justify-between py-2 px-4">
			<div className="flex-1">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-vscode-foreground">{name}</span>
					<span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", riskColors[risk])}>
						{risk}
					</span>
				</div>
				<p className="text-[11px] text-vscode-descriptionForeground mt-0.5">{use}</p>
			</div>
			<div className="flex items-center gap-3">
				<span className="text-[10px] text-vscode-descriptionForeground">{agent}</span>
				{statusIcon[status]}
			</div>
		</div>
	)
}

// ── Main Component ───────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
	planner: "Planner",
	coder: "Coder",
	debugger: "Debugger",
	crawler: "Crawler",
	tester: "Tester",
	deployChecker: "Deploy Checker",
}

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	planner: Brain,
	coder: Cpu,
	debugger: Zap,
	crawler: Globe,
	tester: Network,
	deployChecker: Shield,
}

export function AdvancedVpsSettingsTab() {
	const { routes, fullSettings, approvalResult, send } = useSr()

	const [autoApproveEnabled, setAutoApproveEnabled] = useState(false)
	const [maxApprovals, setMaxApprovals] = useState("10")
	const [maxCost, setMaxCost] = useState("5.00")
	const [timeWindow, setTimeWindow] = useState("60")

	// Load settings from context when they arrive
	useEffect(() => {
		if (fullSettings && Object.keys(fullSettings).length > 0) {
			const s = fullSettings as Record<string, any>
			if (typeof s.autoApproveEnabled === "boolean") setAutoApproveEnabled(s.autoApproveEnabled)
			if (typeof s.maxApprovals === "string") setMaxApprovals(s.maxApprovals)
			if (typeof s.maxCost === "string") setMaxCost(s.maxCost)
			if (typeof s.timeWindow === "string") setTimeWindow(s.timeWindow)
		}
	}, [fullSettings])

	// Build agent routes display from context
	const agentRoutes: AgentRouteDisplay[] = routes.map((r: SrAgentRoute) => {
		const [primaryProvider, primaryModel = ""] = r.primary.split(":")
		const fallbackStr = r.fallbacks?.[0] || ""
		const [fallbackProvider, fallbackModel = ""] = fallbackStr.split(":")
		return {
			agent: r.agent,
			label: AGENT_LABELS[r.agent] || r.agent,
			primary: primaryProvider,
			primaryModel,
			fallback: fallbackProvider,
			fallbackModel,
		}
	})

	// Static approval rules (could be extended from fullSettings)
	const approvalRules: ApprovalRule[] = [
		{ action: "Read files", desc: "Read access to workspace files", risk: "Low", enabled: true, decision: "allow" },
		{
			action: "Write files",
			desc: "Create or modify files",
			risk: "Medium",
			enabled: true,
			decision: "require_approval",
			maxUses: 50,
		},
		{
			action: "Execute commands",
			desc: "Run shell commands",
			risk: "High",
			enabled: true,
			decision: "require_approval",
			maxUses: 20,
		},
		{
			action: "Git commit/push",
			desc: "Commit and push changes",
			risk: "High",
			enabled: true,
			decision: "require_approval",
		},
		{
			action: "Deploy to VPS",
			desc: "Deploy code to production server",
			risk: "Critical",
			enabled: true,
			decision: "require_approval",
		},
		{ action: "Network crawl", desc: "Crawl external websites", risk: "Medium", enabled: false, decision: "block" },
	]

	const mcpServers: MCPServer[] = [
		{ name: "filesystem", use: "Read/write workspace files", status: "connected", agent: "Coder", risk: "Medium" },
		{ name: "github", use: "PR management & code review", status: "connected", agent: "Coder", risk: "Low" },
		{ name: "supabase", use: "Database queries & schema", status: "connected", agent: "Debugger", risk: "Medium" },
		{
			name: "sequential-thinking",
			use: "Multi-step reasoning",
			status: "connected",
			agent: "Planner",
			risk: "Low",
		},
		{
			name: "playwright",
			use: "Browser automation & testing",
			status: "disconnected",
			agent: "Tester",
			risk: "Medium",
		},
	]

	return (
		<div className="p-6 space-y-6">
			<header>
				<h2 className="text-lg font-semibold text-vscode-foreground">Advanced VPS Settings</h2>
				<p className="text-sm text-vscode-descriptionForeground mt-1">
					Control center for autonomous mode, auto-approve permissions, MCP servers, agent routing, and VPS
					guardrails.
				</p>
			</header>

			{/* Auto-Approve Permission Engine */}
			<Card>
				<SectionHead
					icon={Shield}
					title="Auto-Approve Permission Engine"
					desc="Configure which actions can run without manual approval"
					right={
						<div className="flex items-center gap-2">
							<span className="text-xs text-vscode-descriptionForeground">Auto-Approve</span>
							<Toggle
								checked={autoApproveEnabled}
								onChange={() => setAutoApproveEnabled(!autoApproveEnabled)}
							/>
						</div>
					}
				/>
				<div className="p-4 space-y-3 border-b border-vscode-panel-border">
					<div className="grid grid-cols-3 gap-4">
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">Max Approvals</span>
							<input
								type="number"
								value={maxApprovals}
								onChange={(e) => setMaxApprovals(e.target.value)}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">Max Cost (USD)</span>
							<input
								type="number"
								step="0.01"
								value={maxCost}
								onChange={(e) => setMaxCost(e.target.value)}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">Time Window (min)</span>
							<input
								type="number"
								value={timeWindow}
								onChange={(e) => setTimeWindow(e.target.value)}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
					</div>
				</div>
				<div className="divide-y divide-vscode-panel-border">
					{approvalRules.map((rule) => (
						<ApprovalRow key={rule.action} {...rule} />
					))}
				</div>
			</Card>

			{/* MCP Servers */}
			<Card>
				<SectionHead
					icon={Server}
					title="MCP Servers"
					desc="Model Context Protocol servers available to agents"
				/>
				<div className="divide-y divide-vscode-panel-border">
					{mcpServers.map((server) => (
						<MCPRow key={server.name} {...server} />
					))}
				</div>
			</Card>

			{/* Agent Routing */}
			<Card>
				<SectionHead
					icon={Route}
					title="Agent Routing"
					desc="Map agents to provider/model pairs with fallback support"
				/>
				<div className="divide-y divide-vscode-panel-border">
					{agentRoutes.length === 0 ? (
						<div className="p-4 text-center text-xs text-vscode-descriptionForeground">
							No routes configured. Routes will appear here once loaded from the backend.
						</div>
					) : (
						agentRoutes.map((route) => {
							const Icon = AGENT_ICONS[route.agent] || Brain
							return (
								<div key={route.agent} className="flex items-center justify-between py-2.5 px-4">
									<div className="flex items-center gap-3">
										<Icon className="size-4 text-vscode-foreground" />
										<div>
											<span className="text-xs font-medium text-vscode-foreground">
												{route.label}
											</span>
											<p className="text-[10px] text-vscode-descriptionForeground">
												{route.agent}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-4 text-xs">
										<div className="text-right">
											<div className="text-vscode-foreground">{route.primary}</div>
											<div className="text-[10px] text-vscode-descriptionForeground font-mono">
												{route.primaryModel}
											</div>
										</div>
										<span className="text-vscode-descriptionForeground">→</span>
										<div className="text-right">
											<div className="text-vscode-descriptionForeground">{route.fallback}</div>
											<div className="text-[10px] text-vscode-descriptionForeground font-mono">
												{route.fallbackModel}
											</div>
										</div>
									</div>
								</div>
							)
						})
					)}
				</div>
			</Card>

			{/* VPS Guardrails */}
			<Card>
				<SectionHead
					icon={Gauge}
					title="VPS Guardrails"
					desc="Resource thresholds that trigger warnings or blocks"
				/>
				<div className="p-4 space-y-4">
					<div className="grid grid-cols-2 gap-4">
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">Max Concurrent Jobs</span>
							<input
								type="number"
								defaultValue={3}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">CPU High %</span>
							<input
								type="number"
								defaultValue={80}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">RAM High %</span>
							<input
								type="number"
								defaultValue={85}
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder"
							/>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">On High CPU</span>
							<select
								defaultValue="throttle"
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder">
								<option value="warn">Warn</option>
								<option value="throttle">Throttle</option>
								<option value="block">Block</option>
							</select>
						</label>
						<label className="block">
							<span className="text-xs text-vscode-descriptionForeground">On High RAM</span>
							<select
								defaultValue="throttle"
								className="mt-1 w-full px-2 py-1 rounded text-xs bg-vscode-input-background border border-vscode-panel-border text-vscode-input-foreground focus:outline-none focus:border-vscode-focusBorder">
								<option value="warn">Warn</option>
								<option value="throttle">Throttle</option>
								<option value="block">Block</option>
							</select>
						</label>
					</div>
				</div>
			</Card>

			{/* Live Decision Monitor */}
			<Card>
				<SectionHead
					icon={Activity}
					title="Live Decision Monitor"
					desc="Recent AI decisions and approval requests"
				/>
				{approvalResult ? (
					<div className="p-4 space-y-2">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"px-2 py-0.5 rounded text-xs font-medium",
									approvalResult.decision === "allow"
										? "bg-green-500/10 text-green-400"
										: approvalResult.decision === "block"
											? "bg-red-500/10 text-red-400"
											: "bg-amber-500/10 text-amber-400",
								)}>
								{approvalResult.decision}
							</span>
							<span className="text-xs text-vscode-descriptionForeground">{approvalResult.reason}</span>
						</div>
					</div>
				) : (
					<div className="p-6 text-center text-xs text-vscode-descriptionForeground">
						<Activity className="size-8 mx-auto mb-2 opacity-50" />
						<p>No recent decisions</p>
						<p className="mt-1">Decisions and approval requests will appear here as agents work.</p>
					</div>
				)}
			</Card>
		</div>
	)
}
