/**
 * Super Roo — webview types.
 *
 * Mirror of types from `src/super-roo/types/index.ts`, but webview-local.
 * We don't import from the extension source because the webview is a
 * separate bundle with its own dependency graph; the build would pull in
 * better-sqlite3 etc. which can't run in the webview iframe.
 *
 * Extension-host code is responsible for serializing the headless types
 * into the shapes below before posting them. Phase 4 will land that
 * serialization layer in `src/super-roo-host/dashboard/`.
 */

export type SafetyMode = "OFF" | "SAFE" | "AUTO" | "FULL_AUTONOMOUS"

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "cancelled"
export type TaskPriority = "low" | "normal" | "high" | "critical"

export interface SrTask {
	id: string
	agent: string
	goal: string
	priority: TaskPriority
	status: TaskStatus
	createdAt: number
	updatedAt: number
	startedAt?: number
	finishedAt?: number
	attempts: number
	error?: string
	resultSummary?: string
	parentTaskId?: string
	featureId?: string
	bugId?: string
}

export type FeatureStatus =
	| "planned"
	| "building"
	| "testing"
	| "working"
	| "suspected_bug"
	| "broken"
	| "fixed"
	| "deprecated"

export type FeatureHealth = "unknown" | "healthy" | "degraded" | "failing"

export interface SrFeature {
	id: string
	name: string
	description: string
	ownerAgent: string
	status: FeatureStatus
	health: FeatureHealth
	priority: TaskPriority
	relatedFiles: string[]
	bugIds: string[]
	testIds: string[]
	fixAttempts: number
	lastCheckedAt: number | null
	createdAt: number
	updatedAt: number
}

export type BugSeverity = "low" | "medium" | "high" | "critical"
export type BugStatus = "open" | "investigating" | "fixed" | "blocked" | "wontfix"

export interface SrBug {
	id: string
	title: string
	severity: BugSeverity
	status: BugStatus
	featureId?: string
	symptoms: string[]
	suspectedRootCause?: string
	filesLikelyInvolved: string[]
	reproductionSteps: string[]
	recommendedFix?: string
	deploymentRisk: BugSeverity
	createdAt: number
	updatedAt: number
	fixAttempts: number
}

export type EventLevel = "debug" | "info" | "warn" | "error"

export interface SrEvent {
	id: string
	at: number
	level: EventLevel
	type: string
	message: string
	taskId?: string
	agent?: string
	featureId?: string
	bugId?: string
	data?: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────────────────
// Snapshot the extension host pushes to the webview for the dashboard.
// ──────────────────────────────────────────────────────────────────────────────

export interface SrDashboardSnapshot {
	mode: SafetyMode
	selfImprove: boolean
	running: boolean
	queue: {
		pending: number
		running: number
		succeeded24h: number
		failed24h: number
		blocked24h: number
	}
	agents: Array<{ name: string; description: string; ready: boolean }>
	recentTasks: SrTask[]
	recentEvents: SrEvent[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Settings the user can toggle from the UI. Subset of headless config.
// ──────────────────────────────────────────────────────────────────────────────

export interface SrSettings {
	mode: SafetyMode
	selfImprove: boolean
}
