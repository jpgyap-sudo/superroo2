"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	BrainCircuit,
	Bot,
	Database,
	Network,
	Activity,
	Search,
	BookOpen,
	GitCommit,
	Rocket,
	Wifi,
	Server,
	Cpu,
	RefreshCw,
	Zap,
	Layers,
	Terminal,
	MessageSquare,
	FileText,
	AlertTriangle,
	CheckCircle,
	XCircle,
	Loader2,
	Play,
	Code,
	Bug,
	ArrowRight,
	Globe,
	Webhook,
	Radio,
	Wand2,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrainManifest {
	success: boolean
	brain: {
		name: string
		version: string
		description: string
		status: string
		timestamp: number
		agents: Record<string, any>
		capabilities: Record<string, any>
		mcp: Record<string, any>
		integrationGuide: Record<string, any>
	}
}

interface McpActionResult {
	success: boolean
	result?: any
	error?: string
}

interface SseEvent {
	type: string
	event?: string
	data?: any
	timestamp: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, any> = {
	hermesClaw: Bot,
	openClaw: Search,
	ollama: Cpu,
	cloudCoder: Code,
}

const CAPABILITY_ICONS: Record<string, any> = {
	memoryAndContext: Database,
	knowledgeBase: BookOpen,
	commitDeployTracking: GitCommit,
	telegramBot: MessageSquare,
	learningLoop: RefreshCw,
	realTimeEvents: Radio,
	skillGeneration: Wand2,
	agentOrchestration: Layers,
}

const MCP_ACTIONS = [
	{ id: "health", label: "Health", icon: Activity, category: "system" },
	{ id: "list_projects", label: "Projects", icon: Layers, category: "system" },
	{ id: "get_active_task", label: "Active Task", icon: Zap, category: "system" },
	{ id: "get_recent_bugs", label: "Recent Bugs", icon: Bug, category: "system" },
	{ id: "commit_deploy_status", label: "Commits/Deploys", icon: GitCommit, category: "system" },
	{ id: "hermes_recall", label: "Hermes Recall", icon: Search, category: "hermes" },
	{ id: "hermes_learn", label: "Hermes Learn", icon: BookOpen, category: "hermes" },
	{ id: "hermes_list_skills", label: "List Skills", icon: Wand2, category: "hermes" },
	{ id: "hermes_list_resources", label: "List Resources", icon: FileText, category: "hermes" },
	{ id: "hermes_stats", label: "Hermes Stats", icon: Activity, category: "hermes" },
	{ id: "qdrant_search", label: "Qdrant Search", icon: Search, category: "qdrant" },
	{ id: "qdrant_collections", label: "Qdrant Collections", icon: Database, category: "qdrant" },
	{ id: "run_task", label: "Run Task", icon: Play, category: "orchestration" },
	{ id: "run_debug", label: "Run Debug", icon: Bug, category: "orchestration" },
	{ id: "run_deploy", label: "Run Deploy", icon: Rocket, category: "orchestration" },
	{ id: "get_pipeline", label: "Pipeline Status", icon: Layers, category: "orchestration" },
	{ id: "list_resources", label: "Brain Resources", icon: FileText, category: "resources" },
]

// ─── Component ───────────────────────────────────────────────────────────────

export function BrainView() {
	const [manifest, setManifest] = useState<BrainManifest | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<string>("overview")
	const [mcpResult, setMcpResult] = useState<string | null>(null)
	const [mcpLoading, setMcpLoading] = useState<string | null>(null)
	const [sseConnected, setSseConnected] = useState(false)
	const [sseEvents, setSseEvents] = useState<SseEvent[]>([])
	const [wsConnected, setWsConnected] = useState(false)
	const [wsInfo, setWsInfo] = useState<any>(null)
	const sseRef = useRef<EventSource | null>(null)
	const wsRef = useRef<WebSocket | null>(null)

	// Fetch brain manifest
	const fetchManifest = async () => {
		try {
			const res = await fetch("/api/brain")
			const data = await res.json()
			setManifest(data)
			setError(null)
		} catch (err: any) {
			setError(err.message || "Failed to fetch brain manifest")
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchManifest()
		const iv = setInterval(fetchManifest, 30000)
		return () => clearInterval(iv)
	}, [])

	// Connect to SSE
	useEffect(() => {
		const es = new EventSource("/api/brain/events")
		es.onopen = () => setSseConnected(true)
		es.onerror = () => setSseConnected(false)
		es.addEventListener("connected", (e: any) => {
			setSseConnected(true)
			setSseEvents((prev) =>
				[{ type: "connected", data: JSON.parse(e.data), timestamp: Date.now() }, ...prev].slice(0, 50),
			)
		})
		es.addEventListener("heartbeat", () => {
			// Heartbeat — connection alive
		})
		es.addEventListener("skill_generated", (e: any) => {
			const data = JSON.parse(e.data)
			setSseEvents((prev) => [{ type: "skill_generated", data, timestamp: Date.now() }, ...prev].slice(0, 50))
		})
		es.onmessage = (e: any) => {
			try {
				const data = JSON.parse(e.data)
				setSseEvents((prev) => [{ type: "message", data, timestamp: Date.now() }, ...prev].slice(0, 50))
			} catch {
				/* ignore */
			}
		}
		sseRef.current = es
		return () => {
			es.close()
			setSseConnected(false)
		}
	}, [])

	// Fetch WebSocket info
	useEffect(() => {
		fetch("/api/brain/ws/info")
			.then((r) => r.json())
			.then((data) => {
				setWsInfo(data)
				setWsConnected(data.connectedClients > 0)
			})
			.catch(() => {})
	}, [])

	// Execute MCP action
	const executeMcp = async (action: string) => {
		setMcpLoading(action)
		setMcpResult(null)
		try {
			const res = await fetch("/api/brain/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, params: { limit: 5 } }),
			})
			const data = await res.json()
			setMcpResult(JSON.stringify(data, null, 2))
		} catch (err: any) {
			setMcpResult(`Error: ${err.message}`)
		} finally {
			setMcpLoading(null)
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-blue-400" />
			</div>
		)
	}

	if (error && !manifest) {
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load Central Brain: {error}</p>
				</div>
				<button
					onClick={fetchManifest}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const brain = manifest?.brain
	const agents = brain?.agents || {}
	const capabilities = brain?.capabilities || {}
	const mcp = brain?.mcp || {}

	// ─── Tabs ───────────────────────────────────────────────────────────────

	const tabs = [
		{ id: "overview", label: "Overview", icon: BrainCircuit },
		{ id: "agents", label: "Agents", icon: Bot },
		{ id: "capabilities", label: "Capabilities", icon: Layers },
		{ id: "mcp", label: "MCP Console", icon: Terminal },
		{ id: "realtime", label: "Real-Time", icon: Radio },
		{ id: "integration", label: "Integration", icon: Globe },
	]

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<BrainCircuit className="h-7 w-7 text-purple-400" />
					<div>
						<h2 className="text-lg font-semibold text-white">{brain?.name || "Central Brain"}</h2>
						<p className="text-xs text-gray-500">
							v{brain?.version || "?"} — {brain?.description || ""}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5">
						<div className={cn("h-2 w-2 rounded-full", sseConnected ? "bg-green-500" : "bg-red-500")} />
						<span className="text-[11px] text-gray-500">SSE</span>
					</div>
					<div className="flex items-center gap-1.5">
						<div className={cn("h-2 w-2 rounded-full", wsConnected ? "bg-green-500" : "bg-gray-600")} />
						<span className="text-[11px] text-gray-500">WS</span>
					</div>
					<Badge
						status={brain?.status === "online" ? "healthy" : "warning"}
						label={brain?.status || "unknown"}
					/>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex gap-1 overflow-x-auto border-b border-[#1e2535] pb-1">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm transition-colors",
							activeTab === tab.id
								? "border-b-2 border-purple-500 bg-purple-500/10 text-purple-300"
								: "text-gray-500 hover:text-gray-300 hover:bg-white/5",
						)}>
						<tab.icon className="h-4 w-4" />
						{tab.label}
					</button>
				))}
			</div>

			{/* ─── Overview Tab ─────────────────────────────────────────────── */}
			{activeTab === "overview" && (
				<div className="space-y-6">
					{/* Status Cards */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<StatCard
							label="Status"
							value={brain?.status || "unknown"}
							color={brain?.status === "online" ? "text-green-400" : "text-red-400"}
						/>
						<StatCard
							label="Agents"
							value={Object.keys(agents).length.toString()}
							color="text-purple-400"
						/>
						<StatCard
							label="Capabilities"
							value={Object.keys(capabilities).length.toString()}
							color="text-blue-400"
						/>
						<StatCard label="MCP Actions" value={MCP_ACTIONS.length.toString()} color="text-amber-400" />
					</div>

					{/* MCP Server Info */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
							<Server className="h-4 w-4 text-purple-400" />
							MCP Server Configuration
						</h3>
						<div className="space-y-2 text-xs text-gray-400">
							<div className="flex justify-between">
								<span>Dedicated Server</span>
								<span className="text-gray-300">
									{mcp.dedicatedServer?.host || "127.0.0.1"}:{mcp.dedicatedServer?.port || "3419"}
								</span>
							</div>
							<div className="flex justify-between">
								<span>REST Fallback</span>
								<span className="text-gray-300">{mcp.restFallback?.endpoint || "/api/brain/mcp"}</span>
							</div>
							<div className="flex justify-between">
								<span>Telegram Bridge</span>
								<span className="text-gray-300">
									{mcp.telegramBridge?.endpoint || "/api/brain/mcp/telegram"}
								</span>
							</div>
							<div className="flex justify-between">
								<span>WebSocket</span>
								<span className="text-gray-300">/api/brain/ws</span>
							</div>
							<div className="flex justify-between">
								<span>SSE Events</span>
								<span className="text-gray-300">/api/brain/events</span>
							</div>
						</div>
					</Card>

					{/* Fallback Chain */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
							<Network className="h-4 w-4 text-green-400" />
							Fallback Chain
						</h3>
						<div className="space-y-2">
							{(mcp.fallbackChain || []).map((link: any, i: number) => (
								<div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
									<span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-xs font-bold text-purple-400">
										{i + 1}
									</span>
									<div className="flex-1">
										<p className="text-sm text-gray-300">{link.name}</p>
										<p className="text-xs text-gray-500">{link.description}</p>
									</div>
									<ArrowRight className="h-4 w-4 text-gray-600" />
								</div>
							))}
						</div>
					</Card>
				</div>
			)}

			{/* ─── Agents Tab ───────────────────────────────────────────────── */}
			{activeTab === "agents" && (
				<div className="space-y-4">
					{Object.entries(agents).map(([key, agent]: [string, any]) => {
						const Icon = AGENT_ICONS[key as keyof typeof AGENT_ICONS] || Bot
						return (
							<Card
								key={key}
								className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
								<div className="flex items-start gap-3">
									<div className="rounded-lg bg-purple-500/10 p-2">
										<Icon className="h-5 w-5 text-purple-400" />
									</div>
									<div className="flex-1">
										<h3 className="text-sm font-semibold text-white">{agent.name || key}</h3>
										<p className="mt-1 text-xs text-gray-400">{agent.description || ""}</p>
										{agent.endpoints && (
											<div className="mt-2 space-y-1">
												{Object.entries(agent.endpoints).map(([ep, url]: [string, any]) => (
													<div key={ep} className="flex items-center gap-2 text-xs">
														<span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400">
															{ep}
														</span>
														<span className="text-gray-500">
															{typeof url === "string" ? url : JSON.stringify(url)}
														</span>
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							</Card>
						)
					})}
				</div>
			)}

			{/* ─── Capabilities Tab ─────────────────────────────────────────── */}
			{activeTab === "capabilities" && (
				<div className="grid gap-4 sm:grid-cols-2">
					{Object.entries(capabilities).map(([key, cap]: [string, any]) => {
						const Icon = CAPABILITY_ICONS[key as keyof typeof CAPABILITY_ICONS] || Activity
						return (
							<Card
								key={key}
								className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
								<div className="flex items-start gap-3">
									<div className="rounded-lg bg-blue-500/10 p-2">
										<Icon className="h-5 w-5 text-blue-400" />
									</div>
									<div className="flex-1">
										<h3 className="text-sm font-semibold text-white">{cap.name || key}</h3>
										<p className="mt-1 text-xs text-gray-400">{cap.description || ""}</p>
										{cap.endpoints && (
											<div className="mt-2 space-y-1">
												{Object.entries(cap.endpoints).map(([ep, url]: [string, any]) => (
													<div key={ep} className="flex items-center gap-2 text-xs">
														<span className="rounded bg-green-500/10 px-1.5 py-0.5 font-mono text-green-400">
															{ep}
														</span>
														<span className="text-gray-500">
															{typeof url === "string" ? url : JSON.stringify(url)}
														</span>
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							</Card>
						)
					})}
				</div>
			)}

			{/* ─── MCP Console Tab ──────────────────────────────────────────── */}
			{activeTab === "mcp" && (
				<div className="grid gap-6 lg:grid-cols-3">
					{/* Action Buttons */}
					<div className="lg:col-span-1 space-y-4">
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
							<h3 className="mb-3 text-sm font-semibold text-gray-300">MCP Actions</h3>
							<div className="space-y-1">
								{MCP_ACTIONS.map((action) => (
									<button
										key={action.id}
										onClick={() => executeMcp(action.id)}
										disabled={mcpLoading === action.id}
										className={cn(
											"flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
											mcpLoading === action.id
												? "bg-purple-500/20 text-purple-300"
												: "text-gray-400 hover:bg-white/5 hover:text-gray-200",
										)}>
										{action.icon && <action.icon className="h-3.5 w-3.5 shrink-0" />}
										<span className="flex-1">{action.label}</span>
										{mcpLoading === action.id && <Loader2 className="h-3 w-3 animate-spin" />}
									</button>
								))}
							</div>
						</Card>
					</div>

					{/* Result */}
					<div className="lg:col-span-2">
						<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
							<h3 className="mb-3 text-sm font-semibold text-gray-300">Result</h3>
							{mcpResult ? (
								<pre className="max-h-[500px] overflow-auto rounded-lg bg-black/40 p-4 text-xs text-green-400 font-mono">
									{mcpResult}
								</pre>
							) : (
								<div className="flex items-center justify-center py-12 text-gray-600">
									<p className="text-sm">Click an action to execute</p>
								</div>
							)}
						</Card>
					</div>
				</div>
			)}

			{/* ─── Real-Time Tab ────────────────────────────────────────────── */}
			{activeTab === "realtime" && (
				<div className="grid gap-6 lg:grid-cols-2">
					{/* SSE Events */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300">
								<Radio className="h-4 w-4 text-green-400" />
								SSE Events
							</h3>
							<div className="flex items-center gap-2">
								<div
									className={cn("h-2 w-2 rounded-full", sseConnected ? "bg-green-500" : "bg-red-500")}
								/>
								<span className="text-xs text-gray-500">
									{sseConnected ? "Connected" : "Disconnected"}
								</span>
							</div>
						</div>
						<div className="max-h-[400px] overflow-auto space-y-1">
							{sseEvents.length === 0 ? (
								<p className="py-8 text-center text-sm text-gray-600">No events yet</p>
							) : (
								sseEvents.map((evt, i) => (
									<div key={i} className="rounded-lg bg-white/5 px-3 py-2 text-xs">
										<div className="flex items-center gap-2">
											<span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400">
												{evt.type}
											</span>
											<span className="text-gray-600">
												{new Date(evt.timestamp).toLocaleTimeString()}
											</span>
										</div>
										{evt.data && (
											<pre className="mt-1 text-gray-400 truncate">
												{JSON.stringify(evt.data).slice(0, 200)}
											</pre>
										)}
									</div>
								))
							)}
						</div>
					</Card>

					{/* WebSocket Info */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300">
								<Wifi className="h-4 w-4 text-blue-400" />
								WebSocket
							</h3>
							<Badge
								status={wsConnected ? "healthy" : "warning"}
								label={wsConnected ? `${wsInfo?.connectedClients || 0} connected` : "No clients"}
							/>
						</div>
						<div className="space-y-3 text-xs text-gray-400">
							<div className="flex justify-between">
								<span>WebSocket URL</span>
								<span className="text-gray-300 font-mono">{wsInfo?.wsUrl || "ws://..."}</span>
							</div>
							<div className="flex justify-between">
								<span>Connected Clients</span>
								<span className="text-gray-300">{wsInfo?.connectedClients || 0}</span>
							</div>
							<div className="flex justify-between">
								<span>SSE Clients</span>
								<span className="text-gray-300">{wsInfo?.sseClients || 0}</span>
							</div>
							<div>
								<p className="mb-1 text-gray-500">Supported Actions:</p>
								<div className="flex flex-wrap gap-1">
									{(wsInfo?.supportedActions || []).map((action: string) => (
										<span
											key={action}
											className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">
											{action}
										</span>
									))}
								</div>
							</div>
						</div>
					</Card>
				</div>
			)}

			{/* ─── Integration Tab ──────────────────────────────────────────── */}
			{activeTab === "integration" && (
				<div className="space-y-4">
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
							<Globe className="h-4 w-4 text-blue-400" />
							For AI Bots
						</h3>
						<div className="space-y-2">
							{(brain?.integrationGuide?.forAIBots || []).map((guide: string, i: number) => (
								<div key={i} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-400">
									{guide}
								</div>
							))}
						</div>
					</Card>

					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
							<Code className="h-4 w-4 text-green-400" />
							Quick Start — cURL Examples
						</h3>
						<div className="space-y-2">
							<div>
								<p className="mb-1 text-xs text-gray-500">Get Brain Manifest:</p>
								<pre className="rounded-lg bg-black/40 p-3 text-xs text-green-400 font-mono">
									{`curl https://dev.abcx124.xyz/api/brain`}
								</pre>
							</div>
							<div>
								<p className="mb-1 text-xs text-gray-500">Execute MCP Action:</p>
								<pre className="rounded-lg bg-black/40 p-3 text-xs text-green-400 font-mono">
									{`curl -X POST https://dev.abcx124.xyz/api/brain/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"action":"health"}'`}
								</pre>
							</div>
							<div>
								<p className="mb-1 text-xs text-gray-500">Telegram MCP Bridge:</p>
								<pre className="rounded-lg bg-black/40 p-3 text-xs text-green-400 font-mono">
									{`curl -X POST https://dev.abcx124.xyz/api/brain/mcp/telegram \\
  -H "Content-Type: application/json" \\
  -d '{"action":"hermes_stats","chatId":123}'`}
								</pre>
							</div>
							<div>
								<p className="mb-1 text-xs text-gray-500">Generate Skill:</p>
								<pre className="rounded-lg bg-black/40 p-3 text-xs text-green-400 font-mono">
									{`curl -X POST https://dev.abcx124.xyz/api/brain/skill-generate \\
  -H "Content-Type: application/json" \\
  -d '{"failureType":"build","goal":"Always run tests before deploy","solution":"Add pre-deploy test hook"}'`}
								</pre>
							</div>
						</div>
					</Card>

					{/* MCP Server Config */}
					<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
							<Server className="h-4 w-4 text-purple-400" />
							MCP Server Config (for AI Clients)
						</h3>
						<pre className="rounded-lg bg-black/40 p-3 text-xs text-green-400 font-mono">
							{JSON.stringify(
								mcp.dedicatedServer?.config || {
									mcpServers: {
										"superroo-brain": {
											command: "npx",
											args: ["tsx", "server/src/memory/McpMemoryServer.ts"],
											env: {
												CENTRAL_BRAIN_URL: "http://127.0.0.1:3417",
												REST_API_FALLBACK_URL: "http://127.0.0.1:8787",
												MCP_SERVER_PORT: "3419",
											},
											description: "SuperRoo Central Brain MCP Server",
										},
									},
								},
								null,
								2,
							)}
						</pre>
					</Card>
				</div>
			)}
		</div>
	)
}
