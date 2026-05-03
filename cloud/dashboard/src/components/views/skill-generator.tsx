"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Lightbulb, FilePlus, CheckCircle, XCircle, TrendingUp } from "lucide-react"

type DraftItem = {
	id: string
	type: "skill" | "workflow" | "resource"
	title: string
	targetAgent: string
	beforeScore: number
	afterScore: number
	status: "pending" | "approved" | "rejected"
	createdAt: string
}

const MOCK_DRAFTS: DraftItem[] = [
	{
		id: "draft-1",
		type: "skill",
		title: "seo-meta-tag-optimization.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 72,
		afterScore: 91,
		status: "pending",
		createdAt: "2026-05-02T14:30:00Z",
	},
	{
		id: "draft-2",
		type: "workflow",
		title: "batch-image-alt-generation.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 65,
		afterScore: 88,
		status: "pending",
		createdAt: "2026-05-02T16:00:00Z",
	},
	{
		id: "draft-3",
		type: "resource",
		title: "homeu-furniture-keywords.md",
		targetAgent: "homeu-seo-agent",
		beforeScore: 80,
		afterScore: 85,
		status: "approved",
		createdAt: "2026-05-01T10:00:00Z",
	},
]

function typeLabel(t: string) {
	return t.charAt(0).toUpperCase() + t.slice(1)
}

export function SkillGeneratorView() {
	const [drafts, setDrafts] = useState<DraftItem[]>(MOCK_DRAFTS)

	const setStatus = (id: string, status: "approved" | "rejected") => {
		setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)))
	}

	return (
		<div className="space-y-4">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-gray-300">Skill Generator</h2>
				<Badge status="warning" label="Drafts only — never auto-merge" />
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<div className="flex items-center gap-2 text-[11px] text-gray-500">
						<Lightbulb className="h-3.5 w-3.5 text-amber-400" />
						Failed runs reviewed
					</div>
					<div className="mt-1 text-lg font-bold text-[#e2e8f0]">12</div>
				</Card>
				<Card>
					<div className="flex items-center gap-2 text-[11px] text-gray-500">
						<TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
						Skill gaps found
					</div>
					<div className="mt-1 text-lg font-bold text-[#e2e8f0]">5</div>
				</Card>
				<Card>
					<div className="flex items-center gap-2 text-[11px] text-gray-500">
						<FilePlus className="h-3.5 w-3.5 text-violet-400" />
						Draft files created
					</div>
					<div className="mt-1 text-lg font-bold text-[#e2e8f0]">{drafts.length}</div>
				</Card>
				<Card>
					<div className="flex items-center gap-2 text-[11px] text-gray-500">
						<CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
						Avg score improvement
					</div>
					<div className="mt-1 text-lg font-bold text-[#e2e8f0]">
						+
						{Math.round(
							drafts.reduce((acc, d) => acc + (d.afterScore - d.beforeScore), 0) / (drafts.length || 1),
						)}
						pts
					</div>
				</Card>
			</div>

			<div className="space-y-3">
				{drafts.map((d) => (
					<Card key={d.id}>
						<div className="flex items-start justify-between">
							<div>
								<div className="flex items-center gap-2">
									<span className="text-sm font-semibold text-[#e2e8f0]">{d.title}</span>
									<Badge
										status={
											d.status === "approved"
												? "success"
												: d.status === "rejected"
													? "failed"
													: "warning"
										}
										label={d.status.toUpperCase()}
									/>
								</div>
								<div className="mt-1 text-[11px] text-gray-500">
									Target: {d.targetAgent} · Type: {typeLabel(d.type)} ·{" "}
									{new Date(d.createdAt).toLocaleString()}
								</div>
							</div>
							<div className="text-right">
								<div className="text-[10px] text-gray-500">Before / After</div>
								<div className="text-sm font-bold text-[#e2e8f0]">
									{d.beforeScore} → {d.afterScore}
								</div>
							</div>
						</div>
						{d.status === "pending" && (
							<div className="mt-3 flex items-center gap-2">
								<button
									onClick={() => setStatus(d.id, "approved")}
									className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20">
									<CheckCircle className="h-3 w-3" />
									Approve
								</button>
								<button
									onClick={() => setStatus(d.id, "rejected")}
									className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-400 hover:bg-red-500/20">
									<XCircle className="h-3 w-3" />
									Reject
								</button>
							</div>
						)}
					</Card>
				))}
			</div>
		</div>
	)
}
