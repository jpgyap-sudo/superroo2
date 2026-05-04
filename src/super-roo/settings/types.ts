/**
 * Shared types for the SuperRoo settings module.
 */

// ── Provider / API Key types ─────────────────────────────────────────────────

export type ProviderStatus = "connected" | "invalid" | "missing" | "not_tested"

export interface ProviderEntry {
	id: string
	name: string
	description: string
	status: ProviderStatus
	hasKey: boolean
	lastTestedAt: number | null
	latencyMs: number | null
	models: string[]
	capabilities: string[]
}

export interface ProviderKeyPayload {
	apiKey: string
	test?: boolean
}

// ── Agent Routing types ──────────────────────────────────────────────────────

export type AgentName = "planner" | "coder" | "debugger" | "crawler" | "tester" | "deployChecker"

export interface AgentRouteConfig {
	agent: AgentName
	label: string
	primary: { provider: string; model: string }
	fallbacks: Array<{ provider: string; model: string }>
}

export interface RouteValidationResult {
	valid: boolean
	unreachableAgents: AgentName[]
}

// ── Approval Engine types ────────────────────────────────────────────────────

export type ApprovalDecision = "allow" | "require_approval" | "block"
export type RiskLevel = "Low" | "Medium" | "High" | "Critical"

export interface ApprovalRuleConfig {
	pattern: string
	risk: RiskLevel
	decision: ApprovalDecision
	maxUses?: number
	costThreshold?: number
	timeWindowMs?: number
}

export interface ApprovalEvaluationRequest {
	action: string
	command?: string
	rules: ApprovalRuleConfig[]
}

export interface ApprovalEvaluationResult {
	decision: ApprovalDecision
	reason: string
	risk: RiskLevel
	matchedRule?: string
}

// ── VPS Guardrails ───────────────────────────────────────────────────────────

export interface VpsGuardrailsConfig {
	maxConcurrentJobs: number
	cpuHighPercent: number
	ramHighPercent: number
	onHighCpu: "warn" | "throttle" | "block"
	onHighRam: "warn" | "throttle" | "block"
}

// ── MCP Server ───────────────────────────────────────────────────────────────

export interface MCPServerEntry {
	name: string
	use: string
	status: "connected" | "disconnected" | "error"
	agent: string
	risk: RiskLevel
}

// ── Settings Schema ──────────────────────────────────────────────────────────

export interface SuperRooSettings {
	activeProfile: string
	approval: {
		enabled: boolean
		rules: ApprovalRuleConfig[]
		maxApprovalCount: number
		maxCostUsd: number
		timeWindowMinutes: number
	}
	mcp: {
		servers: MCPServerEntry[]
	}
	routing: {
		routes: AgentRouteConfig[]
	}
	guardrails: VpsGuardrailsConfig
}
