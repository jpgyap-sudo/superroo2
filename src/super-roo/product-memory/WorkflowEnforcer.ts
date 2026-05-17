/**
 * Workflow Enforcer — Ensures SuperRoo workflow compliance.
 *
 * This module intercepts and validates AI model API calls to ensure:
 * - DeepSeek is used for coding tasks
 * - Codex/Claude is used for planning/review
 * - Ollama is used for summarization
 * - All phases are tracked and logged
 *
 * Features:
 * - Intercept API calls before they're made
 * - Validate correct model is used for each phase
 * - Enforce DeepSeek delegation for coding
 * - Track API key usage
 * - Generate compliance warnings/errors
 * - Fallback handling with logging
 */

import type { EventLog } from "../logging/EventLog"
import { getModelUsageTracker, type ModelUsageRecord } from "./ModelUsageTracker"
import type { WorkflowCompliance } from "./CommitDeployLog"

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowPhase = "planning" | "coding" | "review" | "summarization" | "memory_storage"

export type ViolationAction = "warn" | "block" | "log_only"

export interface WorkflowEnforcerConfig {
	/** Require DeepSeek for coding tasks */
	requireDeepseekForCoding: boolean
	/** Action when workflow is violated */
	violationAction: ViolationAction
	/** Require API key tracking */
	requireApiKeyTracking: boolean
	/** Require all workflow phases */
	requireAllPhases: boolean
	/** Require Ollama summarization */
	requireOllamaSummary: boolean
	/** Store last 4 chars of API key */
	storeKeyLast4: boolean
	/** DeepSeek configuration */
	deepseek: {
		primaryApiKey: string
		fallbackApiKey: string
		model: string
		maxTokens: number
		timeoutMs: number
		retryAttempts: number
	}
}

export interface WorkflowViolation {
	phase: WorkflowPhase
	expectedProvider: string
	actualProvider: string
	message: string
	severity: "error" | "warning"
	timestamp: string
}

export interface WorkflowState {
	/** Current task ID */
	taskId: string
	/** Which phases have been completed */
	completedPhases: Set<WorkflowPhase>
	/** Violations detected */
	violations: WorkflowViolation[]
	/** Whether workflow is currently compliant */
	isCompliant: boolean
	/** When the task started */
	startedAt: string
}

// ── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: WorkflowEnforcerConfig = {
	requireDeepseekForCoding: true,
	violationAction: "warn",
	requireApiKeyTracking: true,
	requireAllPhases: true,
	requireOllamaSummary: true,
	storeKeyLast4: true,
	deepseek: {
		primaryApiKey: process.env.DEEPSEEK_API_KEY || "",
		fallbackApiKey: process.env.DEEPSEEK_API_KEY_FALLBACK || "",
		model: "deepseek-chat-v4-flash",
		maxTokens: 4096,
		timeoutMs: 30000,
		retryAttempts: 2,
	},
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WorkflowEnforcer {
	private config: WorkflowEnforcerConfig
	private currentState?: WorkflowState
	private readonly onViolationCallbacks: Array<(violation: WorkflowViolation) => void> = []

	constructor(
		private readonly events: EventLog,
		config?: Partial<WorkflowEnforcerConfig>,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	updateConfig(config: Partial<WorkflowEnforcerConfig>): void {
		this.config = { ...this.config, ...config }
	}

	// ── Task Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start a new task with workflow tracking
	 */
	startTask(taskId: string): WorkflowState {
		this.currentState = {
			taskId,
			completedPhases: new Set(),
			violations: [],
			isCompliant: true,
			startedAt: new Date().toISOString(),
		}

		// Also start tracking in ModelUsageTracker
		try {
			getModelUsageTracker().startTask(taskId)
		} catch {
			// Tracker not initialized, will use manual logging
		}

		this.events.info("workflow_enforcer.task_started", `Workflow tracking started for task: ${taskId}`)
		return this.currentState
	}

	/**
	 * End the current task and get compliance report
	 */
	async endTask(): Promise<{
		isCompliant: boolean
		violations: WorkflowViolation[]
		complianceData: WorkflowCompliance
	}> {
		if (!this.currentState) {
			throw new Error("No active task to end")
		}

		const endTime = new Date().toISOString()

		// Check which required phases are missing
		const requiredPhases: WorkflowPhase[] = ["planning", "coding", "review"]
		if (this.config.requireOllamaSummary) {
			requiredPhases.push("summarization")
		}

		const missingPhases = requiredPhases.filter((phase) => !this.currentState!.completedPhases.has(phase))

		// Generate violations for missing phases
		for (const phase of missingPhases) {
			const violation: WorkflowViolation = {
				phase,
				expectedProvider: this.getExpectedProviderForPhase(phase),
				actualProvider: "none",
				message: `Missing required phase: ${phase}`,
				severity: "error",
				timestamp: endTime,
			}
			this.currentState.violations.push(violation)
			this.currentState.isCompliant = false
		}

		// Build compliance data
		const complianceData: WorkflowCompliance = {
			isCompliant: this.currentState.isCompliant,
			steps: {
				lessonsRead: this.currentState.completedPhases.has("planning"),
				deepseekDelegated: this.currentState.completedPhases.has("coding"),
				codexReviewed: this.currentState.completedPhases.has("review"),
				ollamaSummarized: this.currentState.completedPhases.has("summarization"),
				centralBrainStored: this.currentState.completedPhases.has("memory_storage"),
			},
			violations: this.currentState.violations.map((v) => v.message),
		}

		// End tracking in ModelUsageTracker
		try {
			await getModelUsageTracker().endTask()
		} catch {
			// Tracker not initialized
		}

		this.events.info(
			"workflow_enforcer.task_completed",
			`Task ${this.currentState.taskId} completed - Compliant: ${this.currentState.isCompliant}`,
			{
				data: {
					taskId: this.currentState.taskId,
					isCompliant: this.currentState.isCompliant,
					violations: this.currentState.violations.length,
				} as unknown as Record<string, unknown>,
			},
		)

		const result = {
			isCompliant: this.currentState.isCompliant,
			violations: this.currentState.violations,
			complianceData,
		}

		this.currentState = undefined
		return result
	}

	// ── API Call Interception ─────────────────────────────────────────────

	/**
	 * Validate an API call before it's made
	 * Returns the (possibly modified) request or throws if blocked
	 */
	async validateApiCall(request: {
		phase: WorkflowPhase
		provider: string
		model: string
		apiKey?: string
	}): Promise<{
		approved: boolean
		modified?: {
			provider: string
			model: string
			apiKey?: string
		}
		violation?: WorkflowViolation
	}> {
		// If no active task, just log and approve
		if (!this.currentState) {
			return { approved: true }
		}

		const expectedProvider = this.getExpectedProviderForPhase(request.phase)

		// Special handling for coding phase - enforce DeepSeek
		if (request.phase === "coding" && this.config.requireDeepseekForCoding) {
			if (request.provider !== "deepseek") {
				const violation: WorkflowViolation = {
					phase: "coding",
					expectedProvider: "deepseek",
					actualProvider: request.provider,
					message: `Coding task must use DeepSeek, but ${request.provider} was requested`,
					severity: this.config.violationAction === "block" ? "error" : "warning",
					timestamp: new Date().toISOString(),
				}

				this.currentState.violations.push(violation)
				this.currentState.isCompliant = false
				this.onViolationCallbacks.forEach((cb) => cb(violation))

				this.events.warn("workflow_enforcer.violation", `Workflow violation: ${violation.message}`)

				switch (this.config.violationAction) {
					case "block":
						return { approved: false, violation }
					case "warn":
						// Approve but log warning - optionally redirect to DeepSeek
						return {
							approved: true,
							modified: {
								provider: "deepseek",
								model: this.config.deepseek.model,
								apiKey: this.getDeepseekApiKey(),
							},
							violation,
						}
					case "log_only":
					default:
						return { approved: true, violation }
				}
			}
		}

		// Check if provider matches expected
		if (expectedProvider && request.provider !== expectedProvider) {
			const violation: WorkflowViolation = {
				phase: request.phase,
				expectedProvider,
				actualProvider: request.provider,
				message: `Expected ${expectedProvider} for ${request.phase} phase, but ${request.provider} was used`,
				severity: "warning",
				timestamp: new Date().toISOString(),
			}

			this.currentState.violations.push(violation)
			this.onViolationCallbacks.forEach((cb) => cb(violation))
		}

		// Track this phase as completed
		this.currentState.completedPhases.add(request.phase)

		return { approved: true }
	}

	/**
	 * Log a successful API call
	 */
	async logApiCall(usage: Omit<ModelUsageRecord, "id" | "timestamp">): Promise<void> {
		try {
			await getModelUsageTracker().logApiCall(usage)
		} catch {
			// If tracker not available, just log to events
			this.events.info("workflow_enforcer.api_call", `${usage.phase}: ${usage.provider}/${usage.model}`)
		}
	}

	/**
	 * Log a DeepSeek delegation with verification
	 */
	async logDeepseekDelegation(
		success: boolean,
		latencyMs: number,
		tokens: { prompt: number; completion: number },
		usedFallback: boolean = false,
		error?: string,
	): Promise<void> {
		const apiKey = this.getDeepseekApiKey()
		const apiKeyLast4 = apiKey ? apiKey.slice(-4) : undefined

		try {
			await getModelUsageTracker().logDeepSeekDelegation(
				success,
				this.config.deepseek.model,
				apiKeyLast4,
				latencyMs,
				tokens,
				error,
			)
		} catch {
			// Log manually
			this.events.info(
				"workflow_enforcer.deepseek_delegation",
				`DeepSeek delegation: ${success ? "success" : "failed"}${usedFallback ? " (fallback)" : ""}`,
			)
		}

		if (this.currentState) {
			this.currentState.completedPhases.add("coding")
		}
	}

	/**
	 * Verify if a specific API key was used
	 */
	async verifyApiKeyUsage(apiKeyLast4: string): Promise<boolean> {
		try {
			return await getModelUsageTracker().wasApiKeyUsed(apiKeyLast4)
		} catch {
			return false
		}
	}

	/**
	 * Register a callback for workflow violations
	 */
	onViolation(callback: (violation: WorkflowViolation) => void): void {
		this.onViolationCallbacks.push(callback)
	}

	/**
	 * Get the current workflow state
	 */
	getCurrentState(): WorkflowState | undefined {
		return this.currentState
	}

	/**
	 * Get expected provider for a phase
	 */
	private getExpectedProviderForPhase(phase: WorkflowPhase): string {
		switch (phase) {
			case "planning":
				return "codex"
			case "coding":
				return this.config.requireDeepseekForCoding ? "deepseek" : "any"
			case "review":
				return "codex"
			case "summarization":
				return "ollama"
			case "memory_storage":
				return "central_brain"
			default:
				return "any"
		}
	}

	/**
	 * Get the DeepSeek API key to use
	 */
	private getDeepseekApiKey(): string {
		return this.config.deepseek.primaryApiKey || process.env.DEEPSEEK_API_KEY || ""
	}

	/**
	 * Get fallback API key
	 */
	private getFallbackApiKey(): string {
		return this.config.deepseek.fallbackApiKey || process.env.DEEPSEEK_API_KEY_FALLBACK || ""
	}
}

// ── Singleton Instance ────────────────────────────────────────────────────────

let globalEnforcer: WorkflowEnforcer | null = null

export function initializeWorkflowEnforcer(
	events: EventLog,
	config?: Partial<WorkflowEnforcerConfig>,
): WorkflowEnforcer {
	globalEnforcer = new WorkflowEnforcer(events, config)
	return globalEnforcer
}

export function getWorkflowEnforcer(): WorkflowEnforcer {
	if (!globalEnforcer) {
		throw new Error("WorkflowEnforcer not initialized. Call initializeWorkflowEnforcer first.")
	}
	return globalEnforcer
}

export function isWorkflowEnforcerInitialized(): boolean {
	return globalEnforcer !== null
}
