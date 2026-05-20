"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("rounded-lg border border-[#1e2535] bg-[#0f1117] p-4", className)}>{children}</div>
}

/**
 * Stat display card.
 *
 * ⚠️ This is a CUSTOM lightweight component — NOT shadcn/ui Card.
 * Props: { label: string; value: ReactNode; sub?: string; color?: string }
 *   - `label` -> small uppercase stat name
 *   - `value` -> the main stat value (can be ReactNode, e.g. include an icon manually)
 *   - `sub`   -> optional smaller subtitle
 *   - `color` -> optional Tailwind text color class for the value
 * Does NOT support `icon` prop. Render icons manually inside `value` if needed.
 *
 * @example
 *   <StatCard label="CPU" value={<><Cpu className="inline h-4 w-4" /> 45%</>} />
 *   <StatCard label="Memory" value="8 GB" sub="of 16 GB" color="text-amber-400" />
 */
export function StatCard({
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
		<Card className="flex flex-col gap-1">
			<span className="text-[11px] uppercase tracking-widest text-gray-500">{label}</span>
			<span className={cn("text-2xl font-bold", color)}>{value}</span>
			{sub && <span className="text-[11px] text-gray-600">{sub}</span>}
		</Card>
	)
}
