import { Activity, AlertCircle, CheckCircle2, Clock, Cpu, Pause, Play, ShieldAlert } from "lucide-react"

import { useSr } from "../hooks/SrContext"
import { ModePill, PriorityPill, TaskStatusPill, formatRelative } from "../parts/Pills"

export function DashboardTab() {
	const { snapshot, mockMode } = useSr()

	if (!snapshot) {
		return (
			<div className="p-6 text-vscode-descriptionForeground">
				<div className="flex items-center gap-2">
					<Clock className="size-4 animate-spin" />
					<span>Loading dashboard…</span>
				</div>
			</div>
		)
	}

	const { mode, selfImprove, running, queue, agents, recentTasks } = snapshot

	return (
		<div className="p-4 flex flex-col gap-4">
			{mockMode && (
				<div className="rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
					Showing mock data — extension host not connected.
				</div>
			)}

			{/* Top stat row */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					icon={running ? <Play className="size-4 text-green-400" /> : <Pause className="size-4 text-gray-400" />}
					label="Orchestrator"
					value={running ? "Running" : "Stopped"}
				/>
				<StatCard
					icon={<ShieldAlert className="size-4 text-blue-400" />}
					label="Safety mode"
					value={<ModePill mode={mode} />}
					sublabel={selfImprove ? "Self-improve ON" : undefined}
				/>
				<StatCard
					icon={<Activity className="size-4 text-blue-400" />}
					label="In-flight"
					value={`${queue.running} running, ${queue.pending} pending`}
				/>
				<StatCard
					icon={<CheckCircle2 className="size-4 text-green-400" />}
					label="Last 24h"
					value={`${queue.succeeded24h} ok, ${queue.failed24h} failed`}
					sublabel={queue.blocked24h ? `${queue.blocked24h} blocked` : undefined}
				/>
			</div>

			{/* Agents */}
			<section className="rounded border border-vscode-panel-border">
				<header className="px-3 py-2 border-b border-vscode-panel-border flex items-center gap-2">
					<Cpu className="size-4" />
					<h3 className="text-sm font-medium">Agents</h3>
				</header>
				<div className="divide-y divide-vscode-panel-border">
					{agents.map((a) => (
						<div key={a.name} className="px-3 py-2 flex items-center justify-between">
							<div>
								<div className="text-sm font-medium">{a.name}</div>
								<div className="text-xs text-vscode-descriptionForeground">{a.description}</div>
							</div>
							<span
								className={
									a.ready
										? "text-xs text-green-300 inline-flex items-center gap-1"
										: "text-xs text-red-300 inline-flex items-center gap-1"
								}>
								{a.ready ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
								{a.ready ? "ready" : "not ready"}
							</span>
						</div>
					))}
				</div>
			</section>

			{/* Recent tasks */}
			<section className="rounded border border-vscode-panel-border">
				<header className="px-3 py-2 border-b border-vscode-panel-border">
					<h3 className="text-sm font-medium">Recent tasks</h3>
				</header>
				<ul className="divide-y divide-vscode-panel-border">
					{recentTasks.length === 0 && (
						<li className="px-3 py-4 text-sm text-vscode-descriptionForeground">No tasks yet.</li>
					)}
					{recentTasks.map((t) => (
						<li key={t.id} className="px-3 py-2 flex items-start gap-3">
							<TaskStatusPill status={t.status} />
							<PriorityPill priority={t.priority} />
							<div className="flex-1 min-w-0">
								<div className="text-sm font-medium truncate">{t.goal}</div>
								<div className="text-xs text-vscode-descriptionForeground">
									{t.agent} · {formatRelative(t.updatedAt)}
									{t.error ? <span className="ml-2 text-red-300">— {t.error}</span> : null}
								</div>
							</div>
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}

function StatCard({
	icon,
	label,
	value,
	sublabel,
}: {
	icon: React.ReactNode
	label: string
	value: React.ReactNode
	sublabel?: string
}) {
	return (
		<div className="rounded border border-vscode-panel-border p-3">
			<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
				{icon}
				<span>{label}</span>
			</div>
			<div className="mt-1.5 text-sm font-medium">{value}</div>
			{sublabel && <div className="text-xs text-vscode-descriptionForeground mt-0.5">{sublabel}</div>}
		</div>
	)
}
