/**
 * Super Roo — shared types.
 *
 * This module is the single source of truth for cross-module types used by the
 * orchestrator, queue, memory, safety, logging, and features modules.
 *
 * Phase 1 rule: this file MUST NOT import from "vscode" or any other module that
 * depends on the extension host. Keeping it headless lets us reuse super-roo
 * from the CLI app, tests, and (later) a sidecar process.
 */

import { z } from "zod"

// ──────────────────────────────────────────────────────────────────────────────
// Safety
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Autonomy level. Maps roughly onto the architecture pack's Levels 0–4 but is
 * named after the user-facing toggle the dashboard will eventually expose.
 *
 * - OFF:               No autonomous work. Orchestrator refuses to dispatch tasks.
 * - SAFE:              Suggest-only. Tasks may run but not edit files or run commands.
 * - AUTO:              Edits + tests + commits allowed. Production deploy blocked.
 * - FULL_AUTONOMOUS:   Everything allowed (subject to blocklist).
 */
export const SafetyMode = {
	OFF: "OFF",
	SAFE: "SAFE",
	AUTO: "AUTO",
	FULL_AUTONOMOUS: "FULL_AUTONOMOUS",
} as const

export type SafetyMode = (typeof SafetyMode)[keyof typeof SafetyMode]

/**
 * Capability is what an action wants to do. The safety module decides whether
 * the current SafetyMode permits it. Keeping this an open string union (not a
 * fixed enum) means new agents can declare new capabilities without editing
 * core types.
 */
export type Capability =
	| "read.file"
	| "write.file"
	| "execute.command"
	| "git.commit"
	| "git.push"
	| "deploy.staging"
	| "deploy.production"
	| "network.crawl"
	| "telegram.send"
	| string

export interface SafetyDecision {
	allowed: boolean
	reason: string
	/** Which rule fired: "mode", "blocklist", "self_improve_guard", etc. */
	rule: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Tasks
// ──────────────────────────────────────────────────────────────────────────────

export const TaskStatus = {
	PENDING: "pending",
	RUNNING: "running",
	SUCCEEDED: "succeeded",
	FAILED: "failed",
	BLOCKED: "blocked",
	CANCELLED: "cancelled",
} as const

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export const TaskPriority = {
	LOW: "low",
	NORMAL: "normal",
	HIGH: "high",
	CRITICAL: "critical",
} as const

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority]

/**
 * A unit of work the orchestrator hands to an agent.
 *
 * `agent` is a string (not enum) so Phase 2 can register new agents without
 * editing core types. The orchestrator validates that the agent exists at
 * dispatch time.
 */
export const TaskInputSchema = z.object({
	agent: z.string().min(1),
	goal: z.string().min(1),
	priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
	parentTaskId: z.string().optional(),
	featureId: z.string().optional(),
	bugId: z.string().optional(),
	requiredCapabilities: z.array(z.string()).default([]),
	/** Free-form payload the receiving agent interprets. */
	payload: z.record(z.unknown()).default({}),
	/** Cap loop iterations for this task. autonomous.md default is 5. */
	maxIterations: z.number().int().positive().max(50).default(5),
	/** Identity of the coder (human or AI) who submitted this task. */
	codedBy: z.string().optional(),
})

/**
 * Caller-facing task input. Fields with schema defaults are optional here.
 * Internal code that has already passed through `TaskInputSchema.parse()`
 * should use {@link TaskInput} instead, which has all fields filled.
 */
export interface TaskInputRaw {
	agent: string
	goal: string
	priority?: TaskPriority
	parentTaskId?: string
	featureId?: string
	bugId?: string
	requiredCapabilities?: string[]
	payload?: Record<string, unknown>
	maxIterations?: number
	/** Identity of the coder (human or AI) who submitted this task. */
	codedBy?: string
}

/** Fully-resolved task input (post-parse). All schema-defaulted fields populated. */
export interface TaskInput {
	agent: string
	goal: string
	priority: TaskPriority
	parentTaskId?: string
	featureId?: string
	bugId?: string
	requiredCapabilities: string[]
	payload: Record<string, unknown>
	maxIterations: number
	codedBy?: string
}

export interface Task extends TaskInput {
	id: string
	status: TaskStatus
	createdAt: number
	updatedAt: number
	startedAt?: number
	finishedAt?: number
	attempts: number
	error?: string
	resultSummary?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Features (the "product memory")
// ──────────────────────────────────────────────────────────────────────────────

export const FeatureStatus = {
	PLANNED: "planned",
	BUILDING: "building",
	TESTING: "testing",
	WORKING: "working",
	SUSPECTED_BUG: "suspected_bug",
	BROKEN: "broken",
	FIXED: "fixed",
	DEPRECATED: "deprecated",
} as const

export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus]

export const FeatureHealth = {
	UNKNOWN: "unknown",
	HEALTHY: "healthy",
	DEGRADED: "degraded",
	FAILING: "failing",
} as const

export type FeatureHealth = (typeof FeatureHealth)[keyof typeof FeatureHealth]

export const FeatureInputSchema = z.object({
	name: z.string().min(1),
	description: z.string().default(""),
	ownerAgent: z.string().default("product-manager"),
	status: z.enum(["planned", "building", "testing", "working", "suspected_bug", "broken", "fixed", "deprecated"]).default("planned"),
	health: z.enum(["unknown", "healthy", "degraded", "failing"]).default("unknown"),
	priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
	relatedFiles: z.array(z.string()).default([]),
})

/** Caller-facing feature input. Fields with schema defaults are optional. */
export interface FeatureInputRaw {
	name: string
	description?: string
	ownerAgent?: string
	status?: FeatureStatus
	health?: FeatureHealth
	priority?: TaskPriority
	relatedFiles?: string[]
}

/** Fully-resolved feature input (post-parse). */
export interface FeatureInput {
	name: string
	description: string
	ownerAgent: string
	status: FeatureStatus
	health: FeatureHealth
	priority: TaskPriority
	relatedFiles: string[]
}

export interface Feature extends FeatureInput {
	id: string
	createdAt: number
	updatedAt: number
	lastCheckedAt: number | null
	fixAttempts: number
	bugIds: string[]
	testIds: string[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Bugs / Fixes / Decisions (memory tables — schemas finalized in memory module)
// ──────────────────────────────────────────────────────────────────────────────

export const BugSeverity = {
	LOW: "low",
	MEDIUM: "medium",
	HIGH: "high",
	CRITICAL: "critical",
} as const

export type BugSeverity = (typeof BugSeverity)[keyof typeof BugSeverity]

export const BugStatus = {
	OPEN: "open",
	INVESTIGATING: "investigating",
	FIXED: "fixed",
	BLOCKED: "blocked",
	WONTFIX: "wontfix",
} as const

export type BugStatus = (typeof BugStatus)[keyof typeof BugStatus]

export interface BugRecord {
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

// ──────────────────────────────────────────────────────────────────────────────
// Event log
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Append-only event types. Phase 3's dashboard reads from this stream.
 *
 * Open string union (not enum) so future phases can add events without
 * touching core types.
 */
export type EventType =
	| "orchestrator.started"
	| "orchestrator.stopped"
	| "task.enqueued"
	| "task.dequeued"
	| "task.started"
	| "task.succeeded"
	| "task.failed"
	| "task.blocked"
	| "task.cancelled"
	| "agent.registered"
	| "agent.invoked"
	| "agent.completed"
	| "safety.allowed"
	| "safety.blocked"
	| "safety.mode_changed"
	| "feature.created"
	| "feature.updated"
	| "feature.status_changed"
	| "bug.recorded"
	| "bug.fixed"
	| "memory.migrated"
	| string

export const EventLevel = {
	DEBUG: "debug",
	INFO: "info",
	WARN: "warn",
	ERROR: "error",
} as const

export type EventLevel = (typeof EventLevel)[keyof typeof EventLevel]

export interface LogEvent {
	id: string
	at: number
	level: EventLevel
	type: EventType
	message: string
	taskId?: string
	agent?: string
	featureId?: string
	bugId?: string
	/** Identity of the coder (human or AI) responsible for the action that produced this event. */
	codedBy?: string
	/** Arbitrary structured data; persisted as JSON. Keep small. */
	data?: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent contract (Phase 2 will implement this; we declare it now so Phase 1
// orchestrator code can compile against the shape)
// ──────────────────────────────────────────────────────────────────────────────

export interface AgentRunContext {
	task: Task
	/** Current safety mode at dispatch time (informational; orchestrator already gated). */
	safetyMode: SafetyMode
	/** Identity of the coder (human or AI) running this session. Stamped on all emitted events. */
	codedBy?: string
	/** Agents may emit events through this. */
	emit: (level: EventLevel, type: EventType, message: string, data?: Record<string, unknown>) => void
	/** Cooperative cancellation — agents should poll this. */
	signal: AbortSignal
}

export interface AgentRunResult {
	ok: boolean
	summary: string
	/** Suggested follow-up tasks the orchestrator may enqueue. */
	followups?: TaskInputRaw[]
	/** Bug records the agent wants persisted. */
	bugs?: Array<Omit<BugRecord, "id" | "createdAt" | "updatedAt" | "fixAttempts" | "status"> & { status?: BugStatus }>
	error?: string
}

export interface Agent {
	readonly name: string
	readonly description: string
	readonly requiredCapabilities: Capability[]
	run(ctx: AgentRunContext): Promise<AgentRunResult>
}

// ──────────────────────────────────────────────────────────────────────────────
// Orchestrator config
// ──────────────────────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
	/** SQLite database path. Use ":memory:" in tests. */
	dbPath: string
	/** Initial safety mode. Defaults to SAFE. */
	initialMode?: SafetyMode
	/**
	 * Self-improve mode means the target project = Super Roo's own codebase.
	 * Default false. Toggled by the /super_roo_self_improve command (Phase 4+).
	 */
	selfImprove?: boolean
	/** Path to a JSON blocklist override. Optional. */
	blocklistPath?: string
	/** Max concurrent running tasks. Default 1 — Phase 1 is serial. */
	concurrency?: number
	/** Workspace root for file imports. Defaults to process.cwd(). */
	workspaceRoot?: string

	// ── Phase 5: Deploy ──
	/** GitHub personal access token for workflow triggers. */
	githubToken?: string
	/** GitHub repo owner (org or user). */
	repoOwner?: string
	/** GitHub repo name. */
	repoName?: string
	/** VPS hostname or IP for SSH deploy. */
	vpsHost?: string
	/** VPS SSH username. */
	vpsUser?: string
	/** Remote path on VPS to deploy into. Default "/opt/superroo". */
	vpsDeployPath?: string
	/** Local path to SSH private key for VPS. */
	vpsSshKeyPath?: string
	/** URL to hit for health checks after deploy. */
	healthUrl?: string
	/** Max rollback versions to keep. Default 5. */
	maxRollbackVersions?: number
	/** Identity of the coder (human or AI) running this session — stamped on tasks and events. */
	codedBy?: string

	// ── Phase 6: Crawler ──
	/** Enable the data crawler agent. */
	crawlerEnabled?: boolean
	/** API keys for crawler data sources (e.g. { openai: "...", alphavantage: "..." }). */
	crawlerApiKeys?: Record<string, string>
	/** Crawl interval in ms. Default 5 minutes. */
	crawlerIntervalMs?: number
	/** Max sources to track. Default 50. */
	crawlerMaxSources?: number
}
