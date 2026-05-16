"use client"

import { cn } from "@/lib/utils"

const statusColors: Record<string, string> = {
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
	open: "bg-blue-500/10 text-blue-400 border-blue-500/30",
	review: "bg-amber-500/10 text-amber-400 border-amber-500/30",
}

export function Badge({ status, label, className }: { status: string; label?: string; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border",
				statusColors[status] || statusColors.idle,
				className,
			)}>
			{label || status}
		</span>
	)
}
