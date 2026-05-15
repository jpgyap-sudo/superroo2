"use client"

import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	Webhook,
	MessageSquare,
	Send,
	FileEdit,
	Type,
	CheckSquare,
	SplitSquareHorizontal,
	Shield,
	ShieldAlert,
	Bell,
	LayoutDashboard,
	Menu,
	BrainCircuit,
	Network,
	Cpu,
	Server,
	Database,
	Key,
	RefreshCw,
	AlertTriangle,
	CheckCircle,
	XCircle,
	HelpCircle,
	ArrowDown,
	ArrowRight,
	Activity,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface MappingComponent {
	label: string
	online: boolean
	detail: string
	pendingUpdates?: number
	lastError?: { date: number; message: string } | null
}

interface MappingData {
	[key: string]: MappingComponent
}

interface MappingResponse {
	success: boolean
	mapping: MappingData
	summary: {
		total: number
		online: number
		offline: number
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
	try {
		const res = await fetch(path, {
			headers: { "Content-Type": "application/json" },
			...init,
		})
		if (!res.ok) return null
		return (await res.json()) as T
	} catch {
		return null
	}
}

function StatusDot({ online, pulse }: { online: boolean; pulse?: boolean }) {
	return (
		<div
			className={cn(
				"h-3 w-3 rounded-full shrink-0",
				online ? "bg-green-500" : "bg-red-500",
				pulse && online && "animate-pulse",
			)}
			style={{
				boxShadow: online ? "0 0 8px rgba(34,197,94,0.5)" : "0 0 8px rgba(239,68,68,0.3)",
			}}
		/>
	)
}

// ─── Layer Group ─────────────────────────────────────────────────────────────

const LAYERS: {
	id: string
	label: string
	color: string
	icon: React.ComponentType<{ className?: string }>
	components: string[]
	description: string
}[] = [
	{
		id: "ingress",
		label: "Ingress & Routing",
		color: "from-blue-600/20 to-blue-900/10",
		icon: Webhook,
		description: "How Telegram messages enter the system",
		components: ["webhook", "botToken", "messageRouter"],
	},
	{
		id: "messaging",
		label: "Telegram API Methods",
		color: "from-emerald-600/20 to-emerald-900/10",
		icon: Send,
		description: "Core Telegram Bot API interactions",
		components: ["sendMessage", "editMessage", "chatAction", "callbackQuery", "splitMessage"],
	},
	{
		id: "control",
		label: "Rate Limiting & Safety",
		color: "from-amber-600/20 to-amber-900/10",
		icon: Shield,
		description: "Guardrails preventing abuse and overload",
		components: ["rateLimiter", "webhookRateLimiter"],
	},
	{
		id: "features",
		label: "Feature Modules",
		color: "from-violet-600/20 to-violet-900/10",
		icon: LayoutDashboard,
		description: "Bot feature modules providing user-facing functionality",
		components: ["notifier", "taskBoard", "menu", "learner", "tgEndpoints"],
	},
	{
		id: "infra",
		label: "Infrastructure & Backend",
		color: "from-cyan-600/20 to-cyan-900/10",
		icon: Server,
		description: "Backend services powering the bot",
		components: ["orchestratorBridge", "taskQueue", "aiProviders", "redis"],
	},
]

// ─── Component Icon Map ──────────────────────────────────────────────────────

const COMPONENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	webhook: Webhook,
	botToken: Key,
	messageRouter: MessageSquare,
	sendMessage: Send,
	editMessage: FileEdit,
	chatAction: Type,
	callbackQuery: CheckSquare,
	splitMessage: SplitSquareHorizontal,
	rateLimiter: Shield,
	webhookRateLimiter: ShieldAlert,
	notifier: Bell,
	taskBoard: LayoutDashboard,
	menu: Menu,
	learner: BrainCircuit,
	tgEndpoints: Network,
	orchestratorBridge: Cpu,
	taskQueue: Server,
	aiProviders: Database,
	redis: Database,
}

// ─── Component Card ──────────────────────────────────────────────────────────

function ComponentCard({
	id,
	component,
}: {
	id: string
	component: MappingComponent
}) {
	const Icon = COMPONENT_ICONS[id] || HelpCircle
	const hasError = component.lastError && component.lastError.message

	return (
		<div
			className={cn(
				"group relative flex items-start gap-3 rounded-xl border p-3 transition-all",
				component.online
					? "border-green-500/30 bg-green-500/5 hover:border-green-500/50 hover:bg-green-500/10"
					: "border-red-500/30 bg-red-500/5 hover:border-red-500/50 hover:bg-red-500/10",
			)}>
			{/* Status indicator */}
			<div className="mt-0.5">
				<StatusDot online={component.online} pulse={id === "webhook"} />
			</div>

			{/* Icon */}
			<div
				className={cn(
					"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
					component.online ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400",
				)}>
				<Icon className="h-4 w-4" />
			</div>

			{/* Content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-[#e2e8f0]">{component.label}</span>
					{component.online ? (
						<CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
					) : (
						<XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
					)}
				</div>
				<p className="mt-0.5 text-[11px] text-gray-500 truncate">{component.detail}</p>

				{/* Extra details */}
				{component.pendingUpdates !== undefined && component.pendingUpdates > 0 && (
					<div className="mt-1 flex items-center gap-1.5">
						<Badge status="warning" label={`${component.pendingUpdates} pending`} />
					</div>
				)}
				{hasError && component.lastError && (
					<div className="mt-1 flex items-center gap-1.5">
						<AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
						<span className="text-[10px] text-red-400 truncate">{component.lastError.message}</span>
					</div>
				)}
			</div>
		</div>
	)
}

// ─── Layer Section ───────────────────────────────────────────────────────────

function LayerSection({
	layer,
	components,
	mapping,
}: {
	layer: (typeof LAYERS)[0]
	components: MappingComponent[]
	mapping: MappingData
}) {
	const Icon = layer.icon
	const onlineCount = components.filter((c) => c.online).length
	const totalCount = components.length
	const allOnline = onlineCount === totalCount

	return (
		<Card
			className={cn(
				"border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] overflow-hidden",
			)}>
			{/* Layer header */}
			<div
				className={cn(
					"flex items-center gap-3 border-b border-[#1e2535] bg-gradient-to-r px-4 py-3",
					layer.color,
				)}>
				<div
					className={cn(
						"flex h-8 w-8 items-center justify-center rounded-lg",
						allOnline ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400",
					)}>
					<Icon className="h-4 w-4" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold text-[#e2e8f0]">{layer.label}</h3>
						<Badge
							status={allOnline ? "success" : "warning"}
							label={`${onlineCount}/${totalCount}`}
						/>
					</div>
					<p className="text-[11px] text-gray-500 mt-0.5">{layer.description}</p>
				</div>
				{allOnline ? (
					<CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
				) : (
					<XCircle className="h-5 w-5 text-red-500 shrink-0" />
				)}
			</div>

			{/* Component grid */}
			<div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
				{components.map((comp) => {
					const compId = Object.keys(mapping).find((k) => mapping[k] === comp)
					return <ComponentCard key={compId || comp.label} id={compId || ""} component={comp} />
				})}
			</div>
		</Card>
	)
}

// ─── Flow Diagram ────────────────────────────────────────────────────────────

function FlowDiagram({ mapping }: { mapping: MappingData }) {
	const steps = [
		{ key: "webhook", label: "Webhook", icon: Webhook },
		{ key: "messageRouter", label: "Router", icon: MessageSquare },
		{ key: "rateLimiter", label: "Rate Limit", icon: Shield },
		{ key: "sendMessage", label: "Reply", icon: Send },
	]

	return (
		<Card className="border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a]">
			<div className="border-b border-[#1e2535] px-4 py-3">
				<div className="flex items-center gap-2">
					<Activity className="h-4 w-4 text-cyan-400" />
					<h3 className="text-sm font-semibold text-[#e2e8f0]">Message Flow</h3>
				</div>
				<p className="text-[11px] text-gray-500 mt-0.5">
					How a Telegram message travels through the system
				</p>
			</div>

			<div className="flex flex-wrap items-center justify-center gap-2 p-4">
				{steps.map((step, idx) => {
					const comp = mapping[step.key]
					const Icon = step.icon
					const online = comp?.online ?? false

					return (
						<div key={step.key} className="flex items-center gap-2">
							<div
								className={cn(
									"flex items-center gap-2 rounded-lg border px-3 py-2",
									online
										? "border-green-500/30 bg-green-500/5"
										: "border-red-500/30 bg-red-500/5",
								)}>
								<StatusDot online={online} />
								<Icon
									className={cn(
										"h-4 w-4",
										online ? "text-green-400" : "text-red-400",
									)}
								/>
								<span
									className={cn(
										"text-xs font-medium",
										online ? "text-green-300" : "text-red-300",
									)}>
									{step.label}
								</span>
							</div>
							{idx < steps.length - 1 && (
								<ArrowRight className="h-4 w-4 text-gray-600 shrink-0" />
							)}
						</div>
					)
				})}
			</div>
		</Card>
	)
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function TelegramMappingView() {
	const [mapping, setMapping] = useState<MappingData | null>(null)
	const [summary, setSummary] = useState<{ total: number; online: number; offline: number } | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [lastRefresh, setLastRefresh] = useState<string>("")

	const fetchMapping = useCallback(async () => {
		try {
			const data = await apiFetch<MappingResponse>("/api/telegram/mapping")
			if (data?.success && data.mapping) {
				setMapping(data.mapping)
				setSummary(data.summary)
				setError(null)
			} else {
				setError("Failed to load mapping data")
			}
		} catch (err) {
			setError("Failed to fetch mapping: " + (err instanceof Error ? err.message : "unknown error"))
		} finally {
			setLoading(false)
			setLastRefresh(new Date().toLocaleTimeString())
		}
	}, [])

	useEffect(() => {
		fetchMapping()
		const iv = setInterval(fetchMapping, 10000) // Refresh every 10s
		return () => clearInterval(iv)
	}, [fetchMapping])

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
			</div>
		)
	}

	if (error && !mapping) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-3">
				<AlertTriangle className="h-8 w-8 text-red-400" />
				<p className="text-sm text-red-400">{error}</p>
				<button
					onClick={fetchMapping}
					className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] px-3 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:border-gray-600 transition-colors">
					<RefreshCw className="h-3.5 w-3.5" />
					Retry
				</button>
			</div>
		)
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-[#e2e8f0]">Telegram Bot Architecture</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						Live component status · Green = online · Red = offline · Auto-refreshes every 10s
					</p>
				</div>
				<div className="flex items-center gap-3">
					{summary && (
						<div className="flex items-center gap-2">
							<div className="flex items-center gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full bg-green-500" />
								<span className="text-xs text-green-400">{summary.online} online</span>
							</div>
							<div className="flex items-center gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full bg-red-500" />
								<span className="text-xs text-red-400">{summary.offline} offline</span>
							</div>
						</div>
					)}
					<button
						onClick={fetchMapping}
						className="flex items-center gap-1.5 rounded-lg border border-[#1e2535] px-2.5 py-1.5 text-xs text-gray-400 hover:text-[#e2e8f0] hover:border-gray-600 transition-colors">
						<RefreshCw className="h-3.5 w-3.5" />
						Refresh
					</button>
				</div>
			</div>

			{/* Summary bar */}
			{summary && (
				<div className="flex items-center gap-4 rounded-xl border border-[#1e2535] bg-[#0f1117]/50 px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="text-xs text-gray-500">Total Components:</span>
						<span className="text-sm font-semibold text-[#e2e8f0]">{summary.total}</span>
					</div>
					<div className="h-4 w-px bg-[#1e2535]" />
					<div className="flex items-center gap-2">
						<div className="h-2.5 w-2.5 rounded-full bg-green-500" />
						<span className="text-xs text-green-400">{summary.online} Online</span>
					</div>
					<div className="h-4 w-px bg-[#1e2535]" />
					<div className="flex items-center gap-2">
						<div className="h-2.5 w-2.5 rounded-full bg-red-500" />
						<span className="text-xs text-red-400">{summary.offline} Offline</span>
					</div>
					<div className="ml-auto text-[10px] text-gray-600">
						Last refresh: {lastRefresh}
					</div>
				</div>
			)}

			{/* Message Flow Diagram */}
			{mapping && <FlowDiagram mapping={mapping} />}

			{/* Layer Sections */}
			{mapping &&
				LAYERS.map((layer) => {
					const layerComponents = layer.components
						.map((id) => mapping[id])
						.filter(Boolean) as MappingComponent[]
					if (layerComponents.length === 0) return null
					return (
						<LayerSection
							key={layer.id}
							layer={layer}
							components={layerComponents}
							mapping={mapping}
						/>
					)
				})}

			{/* Error state when data exists but some components are offline */}
			{error && (
				<div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
					<AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
					<span className="text-xs text-amber-400">{error}</span>
				</div>
			)}
		</div>
	)
}
