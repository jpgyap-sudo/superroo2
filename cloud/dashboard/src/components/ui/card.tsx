"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("rounded-lg border border-[#1e2535] bg-[#0f1117] p-4", className)}>{children}</div>
}

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
