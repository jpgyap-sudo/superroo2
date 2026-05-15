"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Styled section panel used across all dashboard views.
 * Extracted from overview.tsx to eliminate duplication.
 */
export function Panel({
	title,
	children,
	action,
	className = "",
}: {
	title: string
	children: ReactNode
	action?: ReactNode
	className?: string
}) {
	return (
		<section
			className={cn(
				"rounded-xl border border-[rgba(82,120,190,0.22)] bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(6,11,22,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_30px_rgba(40,110,255,0.08)]",
				className,
			)}>
			<div className="mb-4 flex items-center justify-between">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-100">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	)
}
