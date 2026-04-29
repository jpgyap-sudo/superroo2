/**
 * Super Roo — webview ↔ extension host message protocol.
 *
 * All messages are namespaced under `superRoo:*` so they don't collide with
 * Roo's existing WebviewMessage / ExtensionMessage types. Phase 4's wiring
 * layer in `src/super-roo-host/dashboard/` will register a handler that
 * dispatches on these.
 */

import type { SafetyMode, SrBug, SrDashboardSnapshot, SrEvent, SrFeature, SrTask } from "../types"

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
