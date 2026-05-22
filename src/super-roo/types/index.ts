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
	status: z
		.enum(["planned", "building", "testing", "working", "suspected_bug", "broken", "fixed", "deprecated"])
		.default("planned"),
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

// ──────────────────────────────────────────────────────────────────────────────
// Self-Healing Incidents (healing bus types)
// ──────────────────────────────────────────────────────────────────────────────

export const IncidentStatus = {
	NEW: "new",
	INVESTIGATING: "investigating",
	QUEUED_FOR_FIX: "queued_for_fix",
	FIXING: "fixing",
	FIX_READY: "fix_ready",
	DEPLOYED: "deployed",
	VERIFYING: "verifying",
	VERIFIED: "verified",
	REOPENED: "reopened",
	BLOCKED: "blocked",
	NEEDS_HUMAN_APPROVAL: "needs_human_approval",
} as const

export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus]

export const RootCauseCategory = {
	ENV_MISSING: "ENV_MISSING",
	DB_SCHEMA_MISMATCH: "DB_SCHEMA_MISMATCH",
	API_AUTH_FAILURE: "API_AUTH_FAILURE",
	API_RATE_LIMIT: "API_RATE_LIMIT",
	BROKEN_ROUTE: "BROKEN_ROUTE",
	FRONTEND_CORS: "FRONTEND_CORS",
	WORKER_CRASH: "WORKER_CRASH",
	STALE_DATA: "STALE_DATA",
	TRADING_GATE_BLOCKED: "TRADING_GATE_BLOCKED",
	DEPLOY_DRIFT: "DEPLOY_DRIFT",
	TEST_FAILURE: "TEST_FAILURE",
	SECURITY_RISK: "SECURITY_RISK",
	MEMORY_LEAK: "MEMORY_LEAK",
	RACE_CONDITION: "RACE_CONDITION",
	CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
	DEPENDENCY_CONFLICT: "DEPENDENCY_CONFLICT",
	AUTHENTICATION_FAILURE: "AUTHENTICATION_FAILURE",
	NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
	FILE_SYSTEM_ERROR: "FILE_SYSTEM_ERROR",
	DNS_RESOLUTION: "DNS_RESOLUTION",
	SSL_TLS_ERROR: "SSL_TLS_ERROR",
	CIRCUIT_BREAKER: "CIRCUIT_BREAKER",
	DEPLOYMENT_FAILURE: "DEPLOYMENT_FAILURE",
	DATABASE_CONNECTION: "DATABASE_CONNECTION",
	UNKNOWN: "UNKNOWN",
} as const

export type RootCauseCategory = (typeof RootCauseCategory)[keyof typeof RootCauseCategory]

export interface IncidentRecord {
	id: string
	fingerprint: string
	featureKey: string | null
	sourceAgent: string
	title: string
	symptom: string
	severity: BugSeverity
	status: IncidentStatus
	rootCauseCategory: RootCauseCategory | null
	affectedFiles: string[]
	recommendedAction: string | null
	evidence: Record<string, unknown>
	autoFixAllowed: boolean
	fixAttempts: number
	createdAt: number
	updatedAt: number
}

export interface HealingActionRecord {
	id: string
	incidentId: string
	actionType: string
	actorAgent: string
	summary: string
	input: Record<string, unknown>
	output: Record<string, unknown>
	createdAt: number
}

export interface IncidentInputRaw {
	fingerprint?: string
	featureKey?: string
	sourceAgent?: string
	title: string
	symptom: string
	severity?: BugSeverity
	status?: IncidentStatus
	rootCauseCategory?: RootCauseCategory
	affectedFiles?: string[]
	recommendedAction?: string
	evidence?: Record<string, unknown>
	autoFixAllowed?: boolean
	fixAttempts?: number
}

export type ExecutionStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled"

export interface ExecutionResult {
	success: boolean
	message: string
}

export interface RepairPlan {
	incidentId: string
	featureKey: string | null
	severity: BugSeverity
	rootCauseCategory: RootCauseCategory
	affectedFiles: string[]
	diagnosticSteps: string[]
	safePatchPlan: string[]
	testsToRun: string[]
	approvalRequired: boolean
	approvalReason?: string
	executionStatus: ExecutionStatus
	executedAt?: number
	executionResult?: ExecutionResult
}

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
	incidentId?: string
	/** Identity of the coder (human or AI) responsible for the action that produced this event. */
	codedBy?: string
	/** Arbitrary structured data; persisted as JSON. Keep small. */
	data?: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent contract (Theia-inspired typed interface)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A variable that an agent can declare for user customization.
 * Mirrors Theia's AgentSpecificVariables pattern.
 */
export interface AgentVariable {
	readonly key: string
	readonly description: string
	/** Default value if the user doesn't provide one. */
	readonly defaultValue?: string
}

/**
 * A language model requirement an agent declares.
 * Mirrors Theia's LanguageModelRequirement pattern.
 */
export interface LanguageModelRequirement {
	readonly model?: string
	readonly provider?: string
	/** Minimum capability the model must have (e.g. "reasoning", "vision", "tool-use"). */
	readonly capability?: string
}

/**
 * A single prompt variant within a variant set.
 * Mirrors Theia's PromptVariant pattern.
 */
export interface PromptVariant {
	readonly id: string
	readonly name: string
	readonly description: string
	/** The system prompt template for this variant. */
	readonly systemPrompt: string
	/** Optional user-facing label for mode selection UI. */
	readonly label?: string
}

/**
 * A set of prompt variants for an agent.
 * Mirrors Theia's PromptVariantSet pattern.
 */
export interface PromptVariantSet {
	readonly id: string
	readonly name: string
	readonly description: string
	/** The default variant ID to use when no selection is made. */
	readonly defaultVariant: string
	/** All available variants. */
	readonly variants: PromptVariant[]
}

/**
 * A mode definition for an agent.
 * Mirrors Theia's mode-aware agent pattern (CoderAgent: Edit/Agent/Agent Next).
 */
export interface AgentMode {
	readonly id: string
	readonly name: string
	readonly description: string
	/** The Roo mode slug this mode maps to. */
	readonly modeSlug: string
	/** Prompt variant ID to use in this mode. */
	readonly promptVariantId?: string
	/** Capabilities granted in this mode. */
	readonly capabilities?: Capability[]
	/** Whether this mode can modify files. */
	readonly canModifyFiles: boolean
}

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
	/** The active mode ID if the agent supports multiple modes. */
	activeModeId?: string
	/** Resolved variable values for this run. */
	variables?: Record<string, string>
}

export interface AgentRunResult {
	ok: boolean
	summary: string
	/** Suggested follow-up tasks the orchestrator may enqueue. */
	followups?: TaskInputRaw[]
	/** Bug records the agent wants persisted. */
	bugs?: Array<Omit<BugRecord, "id" | "createdAt" | "updatedAt" | "fixAttempts" | "status"> & { status?: BugStatus }>
	/** Arbitrary data returned by the agent for consumers. */
	data?: Record<string, unknown>
	error?: string
}

/**
 * Typed Agent interface inspired by Eclipse Theia's Agent contract.
 * Adds prompt variants, language model requirements, variables, modes, and tags.
 */
export interface Agent {
	readonly name: string
	readonly description: string
	readonly requiredCapabilities: Capability[]

	/** Optional prompt variant sets for user customization. */
	readonly promptVariants?: PromptVariantSet[]
	/** Optional language model requirements. */
	readonly languageModelRequirements?: LanguageModelRequirement[]
	/** Optional variables the agent exposes for user configuration. */
	readonly variables?: AgentVariable[]
	/** Optional mode definitions for multi-mode agents. */
	readonly modes?: AgentMode[]
	/** Optional tags for categorization and routing. */
	readonly tags?: string[]

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

	// ── Phase 7: Self-Healing ──
	/** Enable the self-healing loop. Default: true */
	healingEnabled?: boolean
	/** Milliseconds between healing cycles. Default: 30000 (30s) */
	healingCycleIntervalMs?: number
	/** Auto-fix policies by severity. */
	healingAutoFixPolicies?: {
		low?: boolean
		medium?: boolean
		high?: boolean
		critical?: boolean
	}
	/** API keys for crawler data sources (e.g. { openai: "...", alphavantage: "..." }). */
	crawlerApiKeys?: Record<string, string>
	/** Crawl interval in ms. Default 5 minutes. */
	crawlerIntervalMs?: number
	/** Max sources to track. Default 50. */
	crawlerMaxSources?: number
}
