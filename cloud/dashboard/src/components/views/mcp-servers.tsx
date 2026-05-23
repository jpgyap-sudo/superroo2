"use client"

import { useState, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Server,
	Wifi,
	WifiOff,
	Activity,
	RefreshCw,
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Terminal,
	Globe,
	Wrench,
	BookOpen,
	Play,
	Square,
	RotateCcw,
	ChevronDown,
	ChevronRight,
	Search,
	Plus,
	Save,
	Ban,
	Trash2,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

interface MCPServerEntry {
	name: string
	description: string
	status: string
	transport: string
	command: string | null
	url: string | null
	tools: number
	uptime: number | null
	error: string | null
}

interface MCPSummary {
	total: number
	running: number
	stopped: number
	error: number
	servers: Array<{
		name: string
		status: string
		tools: number
		description: string
	}>
}

interface MCPStatusResponse {
	success: boolean
	available: boolean
	servers: MCPSummary | null
}

interface MCPServersResponse {
	success: boolean
	available: boolean
	servers: MCPServerEntry[]
}

// ── API Helpers ────────────────────────────────────────────────────────────

const API_BASE = ""

async function fetchMCPStatus(): Promise<MCPStatusResponse> {
	try {
		const res = await fetch(`${API_BASE}/mcp/status`)
		if (!res.ok) return { success: false, available: false, servers: null }
		return await res.json()
	} catch {
		return { success: false, available: false, servers: null }
	}
}

async function fetchMCPServers(): Promise<MCPServersResponse> {
	try {
		const res = await fetch(`${API_BASE}/mcp/servers`)
		if (!res.ok) return { success: false, available: false, servers: [] }
		return await res.json()
	} catch {
		return { success: false, available: false, servers: [] }
	}
}

// ── Sub-Components ─────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
	switch (status) {
		case "running":
			return <CheckCircle2 className="h-4 w-4 text-green-400" />
		case "stopped":
			return <Square className="h-4 w-4 text-yellow-400" />
		case "error":
			return <XCircle className="h-4 w-4 text-red-400" />
		default:
			return <AlertTriangle className="h-4 w-4 text-gray-400" />
	}
}

function TransportIcon({ transport }: { transport: string }) {
	switch (transport) {
		case "stdio":
			return <Terminal className="h-3.5 w-3.5" />
		case "http":
		case "sse":
			return <Globe className="h-3.5 w-3.5" />
		default:
			return <Wifi className="h-3.5 w-3.5" />
	}
}

function ServerCard({ server, onDelete }: { server: MCPServerEntry; onDelete?: (name: string) => void }) {
	const [expanded, setExpanded] = useState(false)

	const uptimeStr = server.uptime
		? server.uptime >= 3600000
			? `${(server.uptime / 3600000).toFixed(1)}h`
			: server.uptime >= 60000
				? `${Math.floor(server.uptime / 60000)}m`
				: `${Math.floor(server.uptime / 1000)}s`
		: "N/A"

	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]">
			<div className="flex items-center justify-between px-4 py-3">
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<StatusIcon status={server.status} />
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-gray-200 truncate">{server.name}</span>
							<Badge
								status={
									server.status === "running"
										? "active"
										: server.status === "error"
											? "warning"
											: "idle"
								}
								label={server.status}
								className="text-xs shrink-0"
							/>
						</div>
						{server.description && (
							<div className="mt-0.5 text-xs text-gray-500 truncate max-w-md">{server.description}</div>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
						<div className="flex items-center gap-1">
							<Wrench className="h-3 w-3" />
							<span>{server.tools} tools</span>
						</div>
						<div className="flex items-center gap-1">
							<TransportIcon transport={server.transport} />
							<span>{server.transport}</span>
						</div>
						{server.uptime != null && server.status === "running" && (
							<div className="flex items-center gap-1">
								<Activity className="h-3 w-3" />
								<span>{uptimeStr}</span>
							</div>
						)}
					</div>
					{onDelete && (
						<button
							onClick={(e) => {
								e.stopPropagation()
								onDelete(server.name)
							}}
							className="flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
							title="Remove server">
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					)}
					<button
						onClick={() => setExpanded(!expanded)}
						className="rounded p-1 text-gray-500 hover:bg-[#1a1f2e]">
						{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
					</button>
				</div>
			</div>

			{/* Expanded details */}
			{expanded && (
				<div className="border-t border-[#1e2535] px-4 py-3 space-y-2">
					<div className="grid grid-cols-2 gap-3 text-xs">
						<div>
							<span className="text-gray-500">Transport</span>
							<div className="mt-0.5 font-mono text-gray-200">{server.transport}</div>
						</div>
						{server.command && (
							<div>
								<span className="text-gray-500">Command</span>
								<div className="mt-0.5 font-mono text-gray-200 truncate">{server.command}</div>
							</div>
						)}
						{server.url && (
							<div>
								<span className="text-gray-500">URL</span>
								<div className="mt-0.5 font-mono text-gray-200 truncate">{server.url}</div>
							</div>
						)}
						{server.uptime != null && (
							<div>
								<span className="text-gray-500">Uptime</span>
								<div className="mt-0.5 text-gray-200">{uptimeStr}</div>
							</div>
						)}
						<div>
							<span className="text-gray-500">Tools Count</span>
							<div className="mt-0.5 text-gray-200">{server.tools}</div>
						</div>
					</div>

					{server.error && (
						<div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
							<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
							<span>{server.error}</span>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────

export function MCPServersView() {
	const [servers, setServers] = useState<MCPServerEntry[]>([])
	const [summary, setSummary] = useState<MCPSummary | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [available, setAvailable] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [statusFilter, setStatusFilter] = useState<string>("all")
	const [showAdd, setShowAdd] = useState(false)
	const [addName, setAddName] = useState("")
	const [addCommand, setAddCommand] = useState("")
	const [addTransport, setAddTransport] = useState<"stdio" | "sse">("stdio")
	const [adding, setAdding] = useState(false)

	const fetchData = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const [statusRes, serversRes] = await Promise.all([fetchMCPStatus(), fetchMCPServers()])

			setAvailable(statusRes.available && serversRes.available)

			if (statusRes.servers) {
				setSummary(statusRes.servers)
			}

			if (serversRes.servers) {
				setServers(serversRes.servers)
			}
		} catch (err: any) {
			setError(err.message || "Failed to fetch MCP server data")
		} finally {
			setLoading(false)
		}
	}, [])

	const handleAddServer = async () => {
		if (!addName.trim() || !addCommand.trim()) return
		setAdding(true)
		try {
			const res = await fetch("/api/mcp/servers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: addName.trim(),
					command: addCommand.trim(),
					transport: addTransport,
				}),
			})
			if (res.ok) {
				setShowAdd(false)
				setAddName("")
				setAddCommand("")
				setAddTransport("stdio")
				fetchData()
			}
		} catch {
			// silently fail
		} finally {
			setAdding(false)
		}
	}

	const handleDeleteServer = async (name: string) => {
		if (!confirm(`Remove MCP server "${name}"?`)) return
		try {
			const res = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" })
			if (res.ok) {
				fetchData()
			}
		} catch {
			// silently fail
		}
	}

	useEffect(() => {
		fetchData()
	}, [fetchData])

	const filteredServers = servers.filter((s) => {
		const matchesSearch =
			s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			s.description.toLowerCase().includes(searchQuery.toLowerCase())
		const matchesStatus = statusFilter === "all" || s.status === statusFilter
		return matchesSearch && matchesStatus
	})

	const statusCounts = {
		all: servers.length,
		running: servers.filter((s) => s.status === "running").length,
		stopped: servers.filter((s) => s.status === "stopped").length,
		error: servers.filter((s) => s.status === "error").length,
	}

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Server className="h-5 w-5 text-gray-200" />
					<h1 className="text-lg font-semibold text-gray-200">MCP Servers</h1>
					<Badge
						status={available ? "active" : "idle"}
						label={available ? "Connected" : "Offline"}
						className="text-xs"
					/>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowAdd(!showAdd)}
						className="flex items-center gap-1.5 rounded-md bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-600/30 transition-colors">
						<Plus className="h-3 w-3" />
						Add Server
					</button>
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1.5 rounded-md bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-[#1a1f2e] disabled:opacity-50">
						<RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Summary cards */}
			{summary && (
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<Server className="h-3.5 w-3.5" />
							<span>Total</span>
						</div>
						<div className="mt-1 text-xl font-semibold text-gray-200">{summary.total}</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
							<span>Running</span>
						</div>
						<div className="mt-1 text-xl font-semibold text-green-400">{summary.running}</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<Square className="h-3.5 w-3.5 text-yellow-400" />
							<span>Stopped</span>
						</div>
						<div className="mt-1 text-xl font-semibold text-yellow-400">{summary.stopped}</div>
					</div>
					<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] px-4 py-3">
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<XCircle className="h-3.5 w-3.5 text-red-400" />
							<span>Error</span>
						</div>
						<div className="mt-1 text-xl font-semibold text-red-400">{summary.error}</div>
					</div>
				</div>
			)}

			{/* Error banner */}
			{error && (
				<div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{/* Backend unavailable notice */}
			{!loading && !available && !error && (
				<div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-400">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					<span>
						MCP Server Manager is not available. Start the API server to enable MCP server management.
					</span>
				</div>
			)}

			{/* Add Server Form */}
			{showAdd && (
				<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/80 p-4">
					<h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
						<Plus size={14} className="text-green-400" />
						Add MCP Server
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
						<div>
							<label className="text-xs text-gray-500 mb-1 block">Name *</label>
							<input
								value={addName}
								onChange={(e) => setAddName(e.target.value)}
								className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-violet-500/50"
								placeholder="e.g. my-server"
							/>
						</div>
						<div>
							<label className="text-xs text-gray-500 mb-1 block">Command / URL *</label>
							<input
								value={addCommand}
								onChange={(e) => setAddCommand(e.target.value)}
								className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-violet-500/50"
								placeholder={
									addTransport === "stdio"
										? "npx -y @modelcontextprotocol/server-filesystem"
										: "http://localhost:3001/mcp"
								}
							/>
						</div>
						<div>
							<label className="text-xs text-gray-500 mb-1 block">Transport</label>
							<select
								value={addTransport}
								onChange={(e) => setAddTransport(e.target.value as "stdio" | "sse")}
								className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-violet-500/50">
								<option value="stdio">stdio</option>
								<option value="sse">SSE</option>
							</select>
						</div>
					</div>
					<div className="flex gap-2 mt-3">
						<button
							onClick={handleAddServer}
							disabled={adding || !addName.trim() || !addCommand.trim()}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors">
							<Save size={12} />
							{adding ? "Adding..." : "Add Server"}
						</button>
						<button
							onClick={() => {
								setShowAdd(false)
								setAddName("")
								setAddCommand("")
								setAddTransport("stdio")
							}}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white transition-colors">
							<Ban size={12} />
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Search and filters */}
			<div className="flex flex-col sm:flex-row gap-3">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
					<input
						type="text"
						placeholder="Search servers by name or description..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full rounded-md border border-[#1e2535] bg-[#0a0e1a] py-2 pl-10 pr-4 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div className="flex gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-0.5">
					{(["all", "running", "stopped", "error"] as const).map((status) => (
						<button
							key={status}
							onClick={() => setStatusFilter(status)}
							className={cn(
								"rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
								statusFilter === status
									? "bg-[#1a1f2e] text-gray-200"
									: "text-gray-500 hover:text-gray-200",
							)}>
							{status.charAt(0).toUpperCase() + status.slice(1)}
							<span className="ml-1 opacity-60">({statusCounts[status]})</span>
						</button>
					))}
				</div>
			</div>

			{/* Server list */}
			<div className="flex-1 space-y-2 overflow-y-auto">
				{loading ? (
					<div className="flex flex-col items-center justify-center py-12 text-gray-500">
						<RefreshCw className="mb-3 h-8 w-8 animate-spin opacity-30" />
						<p className="text-sm">Loading MCP servers...</p>
					</div>
				) : filteredServers.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-12 text-gray-500">
						<Server className="mb-3 h-12 w-12 opacity-20" />
						<p className="text-sm">No MCP servers found</p>
						<p className="mt-1 text-xs">
							{searchQuery || statusFilter !== "all"
								? "Try adjusting your search or filters"
								: "Configure MCP servers in .mcp.json to get started"}
						</p>
					</div>
				) : (
					filteredServers.map((server) => (
						<ServerCard key={server.name} server={server} onDelete={handleDeleteServer} />
					))
				)}
			</div>

			{/* Status bar */}
			{!loading && servers.length > 0 && (
				<div className="flex items-center justify-between border-t border-[#1e2535] pt-2 text-xs text-gray-500">
					<div className="flex items-center gap-4">
						<span>
							<Server className="mr-1 inline-block h-3 w-3" />
							{servers.length} server{servers.length !== 1 ? "s" : ""}
						</span>
						<span>
							<Wrench className="mr-1 inline-block h-3 w-3" />
							{servers.reduce((acc, s) => acc + s.tools, 0)} total tools
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="flex items-center gap-1">
							<span
								className={cn("h-2 w-2 rounded-full", available ? "bg-green-500" : "bg-yellow-500")}
							/>
							{available ? "MCP Manager Online" : "MCP Manager Offline"}
						</span>
					</div>
				</div>
			)}
		</div>
	)
}
