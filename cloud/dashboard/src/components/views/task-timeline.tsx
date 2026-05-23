"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import {
	Activity,
	CheckCircle2,
	XCircle,
	AlertTriangle,
	Loader2,
	RefreshCw,
	Radio,
	Clock,
	Download,
	Filter,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type TaskStatus =
	| "queued"
	| "preparing"
	| "loading_context"
	| "planning"
	| "running"
	| "testing"
	| "reviewing"
	| "repairing"
	| "completed"
	| "failed"
	| "needs_user_approval"

type EventType =
	| "user_message"
	| "brain_context"
	| "agent_plan"
	| "runtime_action"
	| "runtime_observation"
	| "test_result"
	| "repair_result"
	| "final_report"
	| "task_transition"

interface SuperRooEvent {
	id: string
	taskId: string
	type: EventType
	timestamp: string
	payload: Record<string, unknown>
}

interface OrchestratorTask {
	id: string
	type: string
	status: string
	input?: { instruction?: string; goal?: string }
	metadata?: { taskId?: string; source?: string; chatId?: string }
	createdAt: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
	queued: "bg-gray-500",
	preparing: "bg-blue-400",
	loading_context: "bg-indigo-400",
	planning: "bg-violet-400",
	running: "bg-yellow-400",
	testing: "bg-orange-400",
	reviewing: "bg-cyan-400",
	repairing: "bg-red-400",
	completed: "bg-green-500",
	failed: "bg-red-600",
	needs_user_approval: "bg-amber-500",
	// orchestrator statuses
	pending: "bg-gray-500",
}

const EVENT_ICON: Record<EventType, string> = {
	user_message: "💬",
	brain_context: "🧠",
	agent_plan: "📋",
	runtime_action: "⚙️",
	runtime_observation: "👁️",
	test_result: "🧪",
	repair_result: "🔧",
	final_report: "✅",
	task_transition: "🔄",
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ""

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: string | number) {
	const ms = typeof ts === "string" ? new Date(ts).getTime() : ts
	const diff = Date.now() - ms
	if (diff < 60000) return `${Math.round(diff / 1000)}s ago`
	if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
	return `${Math.round(diff / 3600000)}h ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EventRow({ event }: { event: SuperRooEvent }) {
	const [expanded, setExpanded] = useState(false)
	const icon = EVENT_ICON[event.type] ?? "•"
	const hasPayload = Object.keys(event.payload).length > 0

	return (
		<div
			className={cn(
				"border-l-2 pl-3 py-1.5 text-xs cursor-pointer select-none",
				event.type === "task_transition"
					? "border-violet-500"
					: event.type === "final_report"
						? "border-green-500"
						: event.type === "repair_result"
							? "border-red-400"
							: "border-[#1e2535]",
			)}
			onClick={() => hasPayload && setExpanded((e) => !e)}>
			<div className="flex items-center gap-2 text-gray-300">
				<span className="shrink-0">{icon}</span>
				<span className="font-mono text-[11px] text-gray-500 shrink-0">
					{new Date(event.timestamp).toLocaleTimeString()}
				</span>
				<span className="truncate">
					{event.type === "task_transition"
						? `${event.payload.from} → ${event.payload.to}`
						: event.type === "agent_plan"
							? `Plan: ${(event.payload.plan as string[])?.join(" → ")}`
							: event.type === "brain_context"
								? `Brain: ${event.payload.count} lessons recalled`
								: event.type === "runtime_action"
									? `$ ${event.payload.command}`
									: event.type === "runtime_observation"
										? `exit ${event.payload.exitCode} ${event.payload.ok ? "✓" : "✗"}`
										: event.type === "repair_result" && event.payload.escalated
											? `ESCALATED — fingerprint ${event.payload.fingerprint}`
											: event.type === "user_message"
												? String(event.payload.goal || event.payload.message || "")
												: event.type}
				</span>
			</div>
			{expanded && (
				<pre className="mt-1 ml-5 text-[10px] text-gray-500 bg-[#0a0e1a] rounded p-2 overflow-x-auto max-h-32">
					{JSON.stringify(event.payload, null, 2)}
				</pre>
			)}
		</div>
	)
}

function StatusPip({ status }: { status: string }) {
	const color = STATUS_COLOR[status] ?? "bg-gray-600"
	const isActive = [
		"preparing",
		"loading_context",
		"planning",
		"running",
		"testing",
		"reviewing",
		"repairing",
	].includes(status)
	return (
		<span
			className={cn("inline-block h-2 w-2 rounded-full shrink-0", color, isActive && "animate-pulse")}
			title={status}
		/>
	)
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function TaskTimelineView() {
	const [tasks, setTasks] = useState<OrchestratorTask[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [events, setEvents] = useState<SuperRooEvent[]>([])
	const [streaming, setStreaming] = useState(false)
	const [loading, setLoading] = useState(false)
	const [taskIdInput, setTaskIdInput] = useState("")
	const [statusFilter, setStatusFilter] = useState<string>("all")
	const eventsEndRef = useRef<HTMLDivElement>(null)
	const sseRef = useRef<EventSource | null>(null)

	// Load recent tasks on mount
	useEffect(() => {
		fetchTasks()
	}, [])

	const filteredTasks = useMemo(() => {
		if (statusFilter === "all") return tasks
		return tasks.filter((t) => t.status === statusFilter)
	}, [tasks, statusFilter])

	const uniqueStatuses = useMemo(() => {
		return Array.from(new Set(tasks.map((t) => t.status))).sort()
	}, [tasks])

	const handleExport = useCallback(() => {
		const csv = ["id,type,status,instruction,createdAt"]
		csv.push(
			...filteredTasks.map((t) => {
				const instruction = t.input?.instruction ?? t.input?.goal ?? ""
				return `${t.id},${t.type},${t.status},"${instruction.replace(/"/g, '""')}",${t.createdAt}`
			}),
		)
		const blob = new Blob([csv.join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`
		a.click()
		URL.revokeObjectURL(url)
	}, [filteredTasks])

	// Auto-scroll events to bottom
	useEffect(() => {
		eventsEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [events])

	async function fetchTasks() {
		setLoading(true)
		try {
			const r = await fetch(`${API_BASE}/orchestrator/tasks`, {
				headers: { Authorization: `Bearer ${localStorage.getItem("superroo_token") ?? ""}` },
			})
			if (r.ok) {
				const data = await r.json()
				setTasks((data.tasks ?? []).slice(0, 30))
			}
		} catch {
			// silently ignore
		} finally {
			setLoading(false)
		}
	}

	function openStream(taskId: string) {
		if (sseRef.current) {
			sseRef.current.close()
			sseRef.current = null
		}
		setEvents([])
		setSelectedId(taskId)
		setStreaming(true)

		const sse = new EventSource(`${API_BASE}/orchestrator/tasks/${taskId}/events`)
		sseRef.current = sse

		sse.onmessage = (e) => {
			try {
				const event: SuperRooEvent = JSON.parse(e.data)
				setEvents((prev) => [...prev, event])
			} catch {}
		}

		sse.onerror = () => {
			setStreaming(false)
			sse.close()
		}
	}

	function handleManualSubscribe() {
		const id = taskIdInput.trim()
		if (id) openStream(id)
	}

	useEffect(() => {
		return () => {
			sseRef.current?.close()
		}
	}, [])

	const selectedTask = tasks.find((t) => (t.metadata?.taskId ?? t.id) === selectedId)

	return (
		<div className="flex h-full gap-4 p-4 overflow-hidden">
			{/* Left: task list */}
			<div className="w-64 shrink-0 flex flex-col gap-2 overflow-y-auto">
				<div className="flex items-center justify-between mb-1">
					<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Tasks</span>
					<div className="flex items-center gap-1">
						<button
							onClick={handleExport}
							disabled={tasks.length === 0}
							className="text-gray-500 hover:text-gray-300 transition-colors"
							title="Export tasks as CSV">
							<Download className="h-3.5 w-3.5" />
						</button>
						<button
							onClick={fetchTasks}
							className="text-gray-500 hover:text-gray-300 transition-colors"
							title="Refresh tasks">
							<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
						</button>
					</div>
				</div>

				{/* Status filter */}
				<div className="flex items-center gap-1">
					<Filter className="h-3 w-3 text-gray-500 shrink-0" />
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="flex-1 min-w-0 rounded bg-[#0f1420] border border-[#1e2535] px-2 py-1 text-[11px] text-gray-300 outline-none focus:border-violet-500">
						<option value="all">All statuses</option>
						{uniqueStatuses.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</div>

				{/* Manual task ID subscribe */}
				<div className="flex gap-1">
					<input
						className="flex-1 min-w-0 rounded bg-[#0f1420] border border-[#1e2535] px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500"
						placeholder="Task ID…"
						value={taskIdInput}
						onChange={(e) => setTaskIdInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleManualSubscribe()}
					/>
					<button
						onClick={handleManualSubscribe}
						className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors">
						Watch
					</button>
				</div>

				{tasks.length === 0 && !loading && (
					<p className="text-xs text-gray-600 mt-2">
						No tasks found. Run a Telegram coding job to see it here.
					</p>
				)}

				{filteredTasks.map((t) => {
					const tgId = t.metadata?.taskId ?? t.id
					const isSelected = tgId === selectedId
					return (
						<button
							key={t.id}
							onClick={() => openStream(tgId)}
							className={cn(
								"w-full text-left rounded-lg px-3 py-2 border transition-colors",
								isSelected
									? "bg-[#1a1f35] border-violet-500 text-gray-200"
									: "bg-[#0f1420] border-[#1e2535] text-gray-400 hover:border-[#2e3545] hover:text-gray-300",
							)}>
							<div className="flex items-center gap-2 mb-1">
								<StatusPip status={t.status} />
								<span className="text-[11px] font-mono truncate">{tgId.slice(0, 20)}</span>
							</div>
							<div className="text-[11px] truncate text-gray-500">
								{t.input?.instruction ?? t.input?.goal ?? t.type}
							</div>
							<div className="text-[10px] text-gray-600 mt-0.5">{relativeTime(t.createdAt)}</div>
						</button>
					)
				})}
			</div>

			{/* Right: event stream */}
			<div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-[#1e2535] bg-[#0a0e1a]">
				{/* Header */}
				<div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1e2535]">
					<Activity className="h-4 w-4 text-violet-400" />
					<span className="text-sm font-semibold text-gray-200">
						{selectedId ? `Task: ${selectedId}` : "Select a task to watch its event stream"}
					</span>
					{selectedTask && (
						<Badge
							status={
								selectedTask.status === "completed"
									? "active"
									: selectedTask.status === "failed"
										? "offline"
										: "warning"
							}
							label={selectedTask.status}
						/>
					)}
					{streaming && (
						<span className="ml-auto flex items-center gap-1 text-[11px] text-green-400">
							<Radio className="h-3 w-3 animate-pulse" />
							LIVE
						</span>
					)}
					{!streaming && selectedId && (
						<span className="ml-auto flex items-center gap-1 text-[11px] text-gray-500">
							<Clock className="h-3 w-3" />
							{events.length} events
						</span>
					)}
				</div>

				{/* State machine bar */}
				{selectedId && (
					<div className="flex items-center gap-1 px-4 py-2 border-b border-[#1e2535] overflow-x-auto">
						{(
							[
								"queued",
								"preparing",
								"loading_context",
								"planning",
								"running",
								"testing",
								"reviewing",
								"repairing",
								"completed",
								"failed",
							] as TaskStatus[]
						).map((s, i) => {
							const visited = events.some(
								(e) => e.type === "task_transition" && (e.payload.from === s || e.payload.to === s),
							)
							const isCurrent = selectedTask?.status === s
							return (
								<div key={s} className="flex items-center gap-1 shrink-0">
									<div
										className={cn(
											"px-1.5 py-0.5 rounded text-[10px] font-mono transition-all",
											isCurrent
												? cn(STATUS_COLOR[s], "text-black font-bold")
												: visited
													? "bg-[#1e2535] text-gray-400"
													: "bg-transparent text-gray-700 border border-[#1e2535]",
										)}>
										{s.replace("_", " ")}
									</div>
									{i < 9 && <span className="text-gray-700 text-[10px]">›</span>}
								</div>
							)
						})}
					</div>
				)}

				{/* Event feed */}
				<div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5 font-mono">
					{!selectedId && (
						<div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
							<Activity className="h-8 w-8" />
							<p className="text-sm">Select a task or enter a Task ID to watch its live event stream.</p>
						</div>
					)}

					{selectedId && events.length === 0 && (
						<div className="flex items-center gap-2 text-xs text-gray-600 mt-4">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							Waiting for events…
						</div>
					)}

					{events.map((event) => (
						<EventRow key={event.id} event={event} />
					))}
					<div ref={eventsEndRef} />
				</div>
			</div>
		</div>
	)
}
