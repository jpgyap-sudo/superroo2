import type { RagContext, SharedContextPacket } from "@superroo/memory-core"

export type { RagContext, SharedContextPacket } from "@superroo/memory-core"

export type BrainRoute = "ollama" | "hermes" | "cloud" | "openclaw"

export interface BrainRequest {
	packet: SharedContextPacket
	rag: RagContext
	taskType?: string
	riskLevel?: "low" | "medium" | "high"
}

export interface BrainDecision {
	route: BrainRoute
	reason: string
	model?: string
	requiresApproval?: boolean
}

export interface ModelRunMetrics {
	taskType: string
	modelProvider: string
	modelName: string
	costUsd: number
	latencyMs: number
	success: boolean
	testsPassed: number
	retryCount: number
	userAccepted: boolean
}

export type ToolSafety = "safe" | "approval_required" | "blocked"

export interface ToolCall {
	name: string
	args: Record<string, unknown>
}

export interface ToolDefinition {
	name: string
	description: string
	parameters: Record<string, unknown>
	safety: ToolSafety
	handler?: (args: Record<string, unknown>) => Promise<unknown>
}
