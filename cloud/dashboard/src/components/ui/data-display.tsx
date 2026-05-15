"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// ─── Loading State ─────────────────────────────────────────────────────────

export function LoadingState({ message = "Loading..." }: { message?: string }) {
	return (
		<div className="flex items-center justify-center py-12">
			<div className="flex flex-col items-center gap-3">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
				<p className="text-sm text-gray-500">{message}</p>
			</div>
		</div>
	)
}

// ─── Empty State ───────────────────────────────────────────────────────────

export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon?: ReactNode
	title: string
	description?: string
	action?: ReactNode
}) {
	return (
		<div className="flex flex-col items-center justify-center py-12 text-center">
			{icon && <div className="mb-3 text-gray-600">{icon}</div>}
			<p className="text-sm font-medium text-gray-400">{title}</p>
			{description && <p className="mt-1 text-xs text-gray-600">{description}</p>}
			{action && <div className="mt-4">{action}</div>}
		</div>
	)
}

// ─── Error State ───────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-12 text-center">
			<div className="mb-3 text-red-500">
				<svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<p className="text-sm font-medium text-red-400">{message}</p>
			{onRetry && (
				<button
					onClick={onRetry}
					className="mt-3 rounded bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors">
					Retry
				</button>
			)}
		</div>
	)
}

// ─── Metric Card ───────────────────────────────────────────────────────────

export function MetricCard({
	label,
	value,
	sub,
	color = "text-[#e2e8f0]",
}: {
	label: string
	value: ReactNode
	sub?: string
	color?: string
}) {
	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117] p-4 flex flex-col gap-1">
			<span className="text-[11px] uppercase tracking-widest text-gray-500">{label}</span>
			<span className={cn("text-2xl font-bold", color)}>{value}</span>
			{sub && <span className="text-[11px] text-gray-600">{sub}</span>}
		</div>
	)
}

// ─── Badge Pill ────────────────────────────────────────────────────────────

const pillColors: Record<string, string> = {
	online: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
	completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
	success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
	queued: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	delayed: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	active: "bg-blue-500/10 text-blue-400 border-blue-500/30",
	running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
	failed: "bg-red-500/10 text-red-400 border-red-500/30",
	error: "bg-red-500/10 text-red-400 border-red-500/30",
	critical: "bg-red-500/10 text-red-400 border-red-500/30",
	idle: "bg-gray-500/10 text-gray-400 border-gray-500/30",
	offline: "bg-gray-500/10 text-gray-400 border-gray-500/30",
}

export function BadgePill({ label, className }: { label: string; className?: string }) {
	const color = pillColors[label.toLowerCase()] || pillColors.idle
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border",
				color,
				className,
			)}>
			{label}
		</span>
	)
}

// ─── Data Table ────────────────────────────────────────────────────────────

export interface Column<T> {
	key: string
	header: string
	render: (item: T) => ReactNode
	className?: string
	sortable?: boolean
	sortValue?: (item: T) => string | number
}

export function DataTable<T extends { id: string }>({
	columns,
	data,
	emptyMessage = "No data available",
	onRowClick,
}: {
	columns: Column<T>[]
	data: T[]
	emptyMessage?: string
	onRowClick?: (item: T) => void
}) {
	if (data.length === 0) {
		return <div className="flex items-center justify-center py-8 text-sm text-gray-500">{emptyMessage}</div>
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-sm">
				<thead className="border-b border-[#1e2535] text-xs text-gray-500">
					<tr>
						{columns.map((col) => (
							<th key={col.key} className={cn("px-3 py-2.5 font-medium", col.className)}>
								{col.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{data.map((item) => (
						<tr
							key={item.id}
							onClick={() => onRowClick?.(item)}
							className={cn(
								"border-b border-[#1e2535]/50 transition-colors",
								onRowClick && "cursor-pointer hover:bg-[#0f1117]",
							)}>
							{columns.map((col) => (
								<td key={col.key} className={cn("px-3 py-2.5", col.className)}>
									{col.render(item)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
