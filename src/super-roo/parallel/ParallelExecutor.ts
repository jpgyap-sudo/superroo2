/**
 * Super Roo — Parallel Task Executor.
 *
 * Enables true concurrent agent execution with resource-aware scheduling.
 * Manages a pool of "worker slots" that agents can occupy, with:
 *   - Configurable concurrency limits
 *   - Token budget tracking (simulated for now)
 *   - Priority-aware scheduling
 *   - Graceful cancellation of individual tasks
 *   - Resource backpressure (don't exceed token/rate limits)
 *
 * This is the engine that powers parallel AI agent coordination.
 * Multiple agents can work simultaneously on different tasks, while
 * the orchestrator maintains control over the overall resource budget.
 */

import type { Agent, AgentRunContext, AgentRunResult, Task, TaskInputRaw, TaskPriority } from "../types"
import type { EventLog } from "../logging/EventLog"
import type { SafetyManager } from "../safety/SafetyManager"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ParallelExecutorConfig {
	/** Max concurrent running tasks. Default: 2 */
	maxConcurrency: number
	/** Max total "token units" across all concurrent tasks. Default: 100 */
	maxTokenBudget: number
	/** Token cost per agent type (name → cost). Default: { coder: 10, debugger: 8, tester: 5, "product-manager": 6, "self-healing": 4 } */
	agentTokenCosts?: Record<string, number>
	/** Whether to enable priority preemption (higher priority can bump lower). Default: false */
	enablePreemption: boolean
	/** Max time a task can run before being flagged (ms). Default: 600000 (10min) */
	taskTimeoutMs: number
}

export interface WorkerSlot {
	id: string
	task: Task
	agent: Agent
	controller: AbortController
	startedAt: number
	promise: Promise<AgentRunResult>
	tokenCost: number
}

export interface ExecutorStats {
	runningTasks: number
	queuedTasks: number
	tokenBudgetUsed: number
	maxConcurrency: number
	maxTokenBudget: number
	slots: Array<{
		taskId: string
		agent: string
		goal: string
		priority: TaskPriority
		elapsedMs: number
	}>
}

const DEFAULT_AGENT_TOKEN_COSTS: Record<string, number> = {
	coder: 10,
	debugger: 8,
	tester: 5,
	"product-manager": 6,
	"self-healing": 4,
}

// ──────────────────────────────────────────────────────────────────────────────
// ParallelExecutor
// ──────────────────────────────────────────────────────────────────────────────

export class ParallelExecutor {
	private slots: Map<string, WorkerSlot> = new Map()
	private config: Required<ParallelExecutorConfig>
	private running = false
	private drainResolve: (() => void) | null = null

	constructor(
		private readonly events: EventLog,
		private readonly safety: SafetyManager,
		config: Partial<ParallelExecutorConfig> = {},
	) {
		this.config = {
			maxConcurrency: config.maxConcurrency ?? 2,
			maxTokenBudget: config.maxTokenBudget ?? 100,
			agentTokenCosts: { ...DEFAULT_AGENT_TOKEN_COSTS, ...config.agentTokenCosts },
			enablePreemption: config.enablePreemption ?? false,
			taskTimeoutMs: config.taskTimeoutMs ?? 600_000,
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.events.info(
			"parallel.executor.started",
			`Parallel executor started (max=${this.config.maxConcurrency}, budget=${this.config.maxTokenBudget})`,
		)
	}

	stop(): void {
		if (!this.running) return
		this.running = false
		// Abort all running slots
		for (const [id, slot] of this.slots) {
			slot.controller.abort()
		}
		this.slots.clear()
		this.events.info("parallel.executor.stopped", "Parallel executor stopped")
	}

	isRunning(): boolean {
		return this.running
	}

	// ── Slot management ───────────────────────────────────────────────────

	/**
	 * Check if a task can be dispatched given current resource usage.
	 */
	canDispatch(task: Task, agent: Agent): { allowed: boolean; reason?: string } {
		if (!this.running) {
			return { allowed: false, reason: "Executor not running" }
		}

		if (this.slots.size >= this.config.maxConcurrency) {
			return { allowed: false, reason: `Max concurrency (${this.config.maxConcurrency}) reached` }
		}

		const tokenCost = this.getTokenCost(task.agent)
		const currentUsage = this.currentTokenUsage()
		if (currentUsage + tokenCost > this.config.maxTokenBudget) {
			return {
				allowed: false,
				reason: `Token budget exceeded (${currentUsage + tokenCost}/${this.config.maxTokenBudget})`,
			}
		}

		return { allowed: true }
	}

	/**
	 * Dispatch a task to run in a worker slot.
	 * Returns the slot ID if dispatched, or null if resources are exhausted.
	 */
	dispatch(task: Task, agent: Agent, emit: AgentRunContext["emit"], codedBy?: string): string | null {
		const check = this.canDispatch(task, agent)
		if (!check.allowed) {
			return null
		}

		const tokenCost = this.getTokenCost(task.agent)
		const controller = new AbortController()
		const slotId = `slot_${task.id}`

		// Set up timeout
		const timeoutHandle = setTimeout(() => {
			this.events.warn(
				"parallel.slot.timeout",
				`Task ${task.id} timed out after ${this.config.taskTimeoutMs}ms`,
				{
					taskId: task.id,
					agent: agent.name,
				},
			)
			controller.abort()
		}, this.config.taskTimeoutMs)

		const promise = agent
			.run({
				task,
				safetyMode: this.safety.getMode(),
				codedBy,
				signal: controller.signal,
				emit: (level, type, message, data) =>
					emit(level, type, message, { taskId: task.id, agent: agent.name, codedBy, data }),
			})
			.finally(() => {
				clearTimeout(timeoutHandle)
				this.slots.delete(slotId)
				this.events.debug("parallel.slot.freed", `Slot ${slotId} freed (${this.slots.size} remaining)`, {
					data: { remainingSlots: this.slots.size, tokenBudgetUsed: this.currentTokenUsage() },
				})
				// If someone is waiting for drain, check
				if (this.drainResolve && this.slots.size === 0) {
					this.drainResolve()
					this.drainResolve = null
				}
			})

		const slot: WorkerSlot = {
			id: slotId,
			task,
			agent,
			controller,
			startedAt: Date.now(),
			promise,
			tokenCost,
		}

		this.slots.set(slotId, slot)

		this.events.info("parallel.slot.allocated", `Slot ${slotId} allocated to ${agent.name}`, {
			taskId: task.id,
			agent: agent.name,
			data: {
				tokenCost,
				totalSlots: this.slots.size,
				tokenBudgetUsed: this.currentTokenUsage(),
			},
		})

		return slotId
	}

	/**
	 * Cancel a specific running task.
	 */
	cancel(taskId: string): boolean {
		for (const [slotId, slot] of this.slots) {
			if (slot.task.id === taskId) {
				slot.controller.abort()
				this.slots.delete(slotId)
				this.events.info("parallel.slot.cancelled", `Task ${taskId} cancelled`, {
					taskId,
					agent: slot.agent.name,
				})
				return true
			}
		}
		return false
	}

	/**
	 * Wait for all running slots to complete.
	 */
	async drain(): Promise<void> {
		if (this.slots.size === 0) return
		return new Promise((resolve) => {
			this.drainResolve = resolve
		})
	}

	// ── Stats ─────────────────────────────────────────────────────────────

	getStats(): ExecutorStats {
		const slots = Array.from(this.slots.values()).map((s) => ({
			taskId: s.task.id,
			agent: s.agent.name,
			goal: s.task.goal.slice(0, 60),
			priority: s.task.priority,
			elapsedMs: Date.now() - s.startedAt,
		}))

		return {
			runningTasks: this.slots.size,
			queuedTasks: 0, // tracked by the orchestrator's queue
			tokenBudgetUsed: this.currentTokenUsage(),
			maxConcurrency: this.config.maxConcurrency,
			maxTokenBudget: this.config.maxTokenBudget,
			slots,
		}
	}

	/**
	 * Get the promise for a specific slot (for awaiting results).
	 */
	getSlotPromise(taskId: string): Promise<AgentRunResult> | null {
		for (const slot of this.slots.values()) {
			if (slot.task.id === taskId) {
				return slot.promise
			}
		}
		return null
	}

	/**
	 * Check if a specific task is currently running.
	 */
	isRunningTask(taskId: string): boolean {
		for (const slot of this.slots.values()) {
			if (slot.task.id === taskId) return true
		}
		return false
	}

	// ── Resource management ───────────────────────────────────────────────

	private getTokenCost(agentName: string): number {
		return this.config.agentTokenCosts[agentName] ?? 10
	}

	private currentTokenUsage(): number {
		let total = 0
		for (const slot of this.slots.values()) {
			total += slot.tokenCost
		}
		return total
	}
}
