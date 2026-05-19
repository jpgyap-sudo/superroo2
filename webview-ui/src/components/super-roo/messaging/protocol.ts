/**
 * Super Roo — webview ↔ extension host message protocol.
 *
 * All messages are namespaced under `superRoo:*` so they don't collide with
 * Roo's existing WebviewMessage / ExtensionMessage types. Phase 4's wiring
 * layer in `src/super-roo-host/dashboard/` will register a handler that
 * dispatches on these.
 */

import type {
	SafetyMode,
	SrBug,
	SrDashboardSnapshot,
	SrEvent,
	SrFeature,
	SrTask,
	VpsAggregatedLogEntry,
} from "../types"

// ──────────────────────────────────────────────────────────────────────────────
// Webview → Extension (commands)
// ──────────────────────────────────────────────────────────────────────────────

export type SrWebviewMessage =
	| { type: "superRoo:getDashboard" }
	| { type: "superRoo:getFeatures"; statusFilter?: string; healthFilter?: string }
	| { type: "superRoo:getBugs"; statusFilter?: string; severityFilter?: string }
	| { type: "superRoo:getEvents"; sinceMs?: number; typeFilter?: string; limit?: number }
	| { type: "superRoo:getTasks"; statusFilter?: string; agentFilter?: string }
	| { type: "superRoo:getSettings" }
	| { type: "superRoo:setMode"; mode: SafetyMode }
	| { type: "superRoo:setSelfImprove"; enabled: boolean }
	| { type: "superRoo:cancelTask"; taskId: string }
	| { type: "superRoo:retryTask"; taskId: string }
	| { type: "superRoo:enqueueGoal"; goal: string; agent: string; priority: string }
	// VPS Health monitoring
	| {
			type: "superRoo:getVpsAggregatedLogs"
			limit?: number
			level?: string
			source?: string
			search?: string
			since?: string
			offset?: number
	  }
	| { type: "superRoo:getVpsAggregatedStats" }
	// Product Memory commands
	| { type: "superRoo:productMemory"; action: "testFeature"; featureId: string; result: "pass" | "fail" | "warning" }
	| { type: "superRoo:productMemory"; action: "listFeatures" }
	| { type: "superRoo:productMemory"; action: "listUpdates" }
	| { type: "superRoo:productMemory"; action: "readMemoryFile"; fileName: string }
	// Settings / Provider commands
	| { type: "superRoo:getProviders" }
	| { type: "superRoo:saveProviderKey"; providerId: string; apiKey: string; test?: boolean }
	| { type: "superRoo:testProviderKey"; providerId: string }
	| { type: "superRoo:removeProviderKey"; providerId: string }
	| { type: "superRoo:getFullSettings" }
	| { type: "superRoo:saveFullSettings"; settings: Record<string, unknown> }
	| { type: "superRoo:getRoutes" }
	| { type: "superRoo:saveRoutes"; routes: Array<{ agent: string; primary: string; fallbacks: string[] }> }
	| { type: "superRoo:evaluateApproval"; action: string; command?: string }

// ──────────────────────────────────────────────────────────────────────────────
// Extension → Webview (push + replies)
// ──────────────────────────────────────────────────────────────────────────────

export type SrExtensionMessage =
	| { type: "superRoo:dashboard"; snapshot: SrDashboardSnapshot }
	| { type: "superRoo:features"; features: SrFeature[] }
	| { type: "superRoo:bugs"; bugs: SrBug[] }
	| { type: "superRoo:events"; events: SrEvent[] }
	| { type: "superRoo:tasks"; tasks: SrTask[] }
	| { type: "superRoo:settings"; mode: SafetyMode; selfImprove: boolean }
	| { type: "superRoo:event"; event: SrEvent } // streamed from EventLog.subscribe
	| { type: "superRoo:error"; message: string }
	// VPS Health monitoring responses
	| {
			type: "superRoo:vpsAggregatedLogs"
			rows: VpsAggregatedLogEntry[]
			total: number
			limit: number
			offset: number
	  }
	| {
			type: "superRoo:vpsAggregatedStats"
			total: number
			last24h: number
			errors24h: number
			levelDistribution: Array<{ level: string; count: number }>
			sourceDistribution: Array<{ source: string; count: number }>
	  }
	// Provider responses
	| {
			type: "superRoo:providers"
			providers: Array<{
				id: string
				name: string
				description: string
				status: string
				hasKey: boolean
				lastTestedAt: number | null
				latencyMs: number | null
				models: string[]
				capabilities: string[]
			}>
	  }
	| { type: "superRoo:providerKeySaved"; providerId: string; ok: boolean; status: string }
	| { type: "superRoo:providerTested"; providerId: string; ok: boolean; status: string; latencyMs: number | null }
	| { type: "superRoo:providerKeyRemoved"; providerId: string; ok: boolean }
	// Full settings response
	| { type: "superRoo:fullSettings"; settings: Record<string, unknown> }
	// Routes responses
	| { type: "superRoo:routes"; routes: Array<{ agent: string; primary: string; fallbacks: string[] }> }
	| { type: "superRoo:routesSaved"; ok: boolean }
	// Approval evaluation response
	| { type: "superRoo:approvalResult"; decision: string; reason: string }
	| { type: "superRoo:productMemoryResult"; fileName: string; content?: string; error?: string }

export const SR_MESSAGE_PREFIX = "superRoo:"
export function isSrExtensionMessage(msg: unknown): msg is SrExtensionMessage {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"type" in msg &&
		typeof (msg as { type: unknown }).type === "string" &&
		(msg as { type: string }).type.startsWith(SR_MESSAGE_PREFIX)
	)
}
