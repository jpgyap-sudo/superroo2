/**
 * Super Roo — Autonomous Controller
 *
 * Mode-based (paused/controlled/aggressive) task execution with
 * CPU/RAM-aware backpressure, runtime limits, and event notifications.
 */

import { waitForCpuBelow, getCpuUsagePercent, getRamUsagePercent } from "./cpuGuard"

// ── Types ────────────────────────────────────────────────────────────────────

export type AutonomousMode = "paused" | "controlled" | "aggressive"

export type AgentStepResult = {
	done: boolean
	message?: string
	nextAction?: "continue" | "retry" | "stop"
}

export type ControlledAutonomousOptions = {
	taskName: string
	maxLoops?: number
	maxAttempts?: number
	cooldownMs?: number
	maxRuntimeMs?: number
	cpuPauseThreshold?: number
	cpuResumeThreshold?: number
	ramPauseThreshold?: number
	ramResumeThreshold?: number
	logger?: Console
	signal?: AbortSignal
	onSummary?: (summary: TaskSummary) => Promise<void> | void
}

export type TaskSummary = {
	taskName: string
	status: "completed" | "stopped" | "failed"
	loops: number
	attempts: number
	runtimeMs: number
	finalMessage?: string
	cpuPercent?: number
	ramPercent?: number
	error?: string
	timestamp: string
}

export type AutonomousControllerEvent = {
	type:
		| "mode_changed"
		| "task_started"
		| "task_completed"
		| "task_failed"
		| "task_paused"
		| "cpu_throttled"
		| "ram_throttled"
	taskName?: string
	mode?: AutonomousMode
	summary?: TaskSummary
	cpuPercent?: number
	ramPercent?: number
	timestamp: number
}

export type AutonomousControllerListener = (event: AutonomousControllerEvent) => void

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
	maxParallelAgents: 2,
	maxLoops: 5,
	cooldownMs: 2000,
	cpuPauseThreshold: 85,
	ramPauseThreshold: 90,
	maxAttempts: 3,
	maxRuntimeMs: 600_000,
	cpuResumePercent: 60,
	ramResumePercent: 75,
}

// ── Mode state ───────────────────────────────────────────────────────────────

let mode: AutonomousMode = "controlled"
const controllerListeners: Set<AutonomousControllerListener> = new Set()

function emitControllerEvent(event: AutonomousControllerEvent): void {
	for (const listener of controllerListeners) {
		try {
			listener(event)
		} catch {
			// prevent listener exceptions from breaking the controller
		}
	}
}

/**
 * Subscribe to autonomous controller events (mode changes, task lifecycle).
 * Returns an unsubscribe function.
 */
export function onAutonomousControllerEvent(listener: AutonomousControllerListener): () => void {
	controllerListeners.add(listener)
	return () => controllerListeners.delete(listener)
}

export const autonomousController = {
	getMode(): AutonomousMode {
		return mode
	},

	setMode(nextMode: AutonomousMode): void {
		const prev = mode
		mode = nextMode
		if (prev !== nextMode) {
			emitControllerEvent({ type: "mode_changed", mode: nextMode, timestamp: Date.now() })
		}
	},

	isEnabled(): boolean {
		return mode !== "paused"
	},

	getLimits() {
		if (mode === "aggressive") {
			return {
				maxParallelAgents: Math.max(DEFAULTS.maxParallelAgents, 3),
				maxLoops: Math.max(DEFAULTS.maxLoops, 8),
				cooldownMs: Math.min(DEFAULTS.cooldownMs, 1000),
				cpuPauseThreshold: Math.max(DEFAULTS.cpuPauseThreshold, 90),
				ramPauseThreshold: Math.max(DEFAULTS.ramPauseThreshold, 95),
			}
		}

		return {
			maxParallelAgents: DEFAULTS.maxParallelAgents,
			maxLoops: DEFAULTS.maxLoops,
			cooldownMs: DEFAULTS.cooldownMs,
			cpuPauseThreshold: DEFAULTS.cpuPauseThreshold,
			ramPauseThreshold: DEFAULTS.ramPauseThreshold,
		}
	},
}

// ── Controlled autonomous task runner ────────────────────────────────────────

/**
 * Run a task with full controlled autonomy:
 * - Bounded loops and attempts
 * - CPU/RAM-aware backpressure
 * - Runtime limit enforcement
 * - Mode-aware (paused/controlled/aggressive)
 * - Event notifications and task summaries
 */
export async function runControlledAutonomousTask(
	step: (loopIndex: number, attemptIndex: number) => Promise<AgentStepResult>,
	options: ControlledAutonomousOptions,
): Promise<TaskSummary> {
	const logger = options.logger ?? console
	const limits = autonomousController.getLimits()
	const maxLoops = options.maxLoops ?? limits.maxLoops
	const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts
	const cooldownMs = options.cooldownMs ?? limits.cooldownMs
	const maxRuntimeMs = options.maxRuntimeMs ?? DEFAULTS.maxRuntimeMs
	const cpuPauseThreshold = options.cpuPauseThreshold ?? limits.cpuPauseThreshold
	const cpuResumeThreshold = options.cpuResumeThreshold ?? DEFAULTS.cpuResumePercent
	const ramPauseThreshold = options.ramPauseThreshold ?? limits.ramPauseThreshold
	const ramResumeThreshold = options.ramResumeThreshold ?? DEFAULTS.ramResumePercent

	const startedAt = Date.now()
	let loops = 0
	let attempts = 0

	const emitSummary = async (summary: TaskSummary): Promise<TaskSummary> => {
		await options.onSummary?.(summary)
		logger.info(`[TASK SUMMARY] ${JSON.stringify(summary)}`)
		return summary
	}

	try {
		emitControllerEvent({
			type: "task_started",
			taskName: options.taskName,
			timestamp: Date.now(),
		})

		for (attempts = 1; attempts <= maxAttempts; attempts++) {
			for (let loopIndex = 1; loopIndex <= maxLoops; loopIndex++) {
				options.signal?.throwIfAborted()

				if (!autonomousController.isEnabled()) {
					const summary = await emitSummary({
						taskName: options.taskName,
						status: "stopped",
						loops,
						attempts,
						runtimeMs: Date.now() - startedAt,
						finalMessage: "Autonomous mode paused",
						cpuPercent: await getCpuUsagePercent(),
						ramPercent: getRamUsagePercent(),
						timestamp: new Date().toISOString(),
					})
					emitControllerEvent({
						type: "task_paused",
						taskName: options.taskName,
						summary,
						timestamp: Date.now(),
					})
					return summary
				}

				if (Date.now() - startedAt > maxRuntimeMs) {
					const summary = await emitSummary({
						taskName: options.taskName,
						status: "stopped",
						loops,
						attempts,
						runtimeMs: Date.now() - startedAt,
						finalMessage: "Max runtime reached",
						cpuPercent: await getCpuUsagePercent(),
						ramPercent: getRamUsagePercent(),
						timestamp: new Date().toISOString(),
					})
					emitControllerEvent({
						type: "task_paused",
						taskName: options.taskName,
						summary,
						timestamp: Date.now(),
					})
					return summary
				}

				await waitForCpuBelow(cpuPauseThreshold, logger, cpuResumeThreshold, {
					maxRamPercent: ramPauseThreshold,
					resumeRamPercent: ramResumeThreshold,
					signal: options.signal,
				})

				loops++
				logger.info(
					`[CONTROLLED AUTONOMY] ${options.taskName}: attempt ${attempts}/${maxAttempts}, loop ${loopIndex}/${maxLoops}`,
				)

				const result = await step(loopIndex, attempts)

				if (result.done || result.nextAction === "stop") {
					const summary = await emitSummary({
						taskName: options.taskName,
						status: "completed",
						loops,
						attempts,
						runtimeMs: Date.now() - startedAt,
						finalMessage: result.message,
						cpuPercent: await getCpuUsagePercent(),
						ramPercent: getRamUsagePercent(),
						timestamp: new Date().toISOString(),
					})
					emitControllerEvent({
						type: "task_completed",
						taskName: options.taskName,
						summary,
						timestamp: Date.now(),
					})
					return summary
				}

				await sleep(cooldownMs)
			}

			logger.warn(
				`[CONTROLLED AUTONOMY] ${options.taskName}: max loops reached for attempt ${attempts}. Cooling down before retry.`,
			)
			await sleep(Math.max(cooldownMs, 5000))
		}

		const summary = await emitSummary({
			taskName: options.taskName,
			status: "stopped",
			loops,
			attempts: maxAttempts,
			runtimeMs: Date.now() - startedAt,
			finalMessage: "Max attempts reached. Infinite loop prevented.",
			cpuPercent: await getCpuUsagePercent(),
			ramPercent: getRamUsagePercent(),
			timestamp: new Date().toISOString(),
		})
		emitControllerEvent({
			type: "task_completed",
			taskName: options.taskName,
			summary,
			timestamp: Date.now(),
		})
		return summary
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		const summary = await emitSummary({
			taskName: options.taskName,
			status: "failed",
			loops,
			attempts,
			runtimeMs: Date.now() - startedAt,
			error: errorMessage,
			cpuPercent: await getCpuUsagePercent(),
			ramPercent: getRamUsagePercent(),
			timestamp: new Date().toISOString(),
		})
		emitControllerEvent({
			type: "task_failed",
			taskName: options.taskName,
			summary,
			timestamp: Date.now(),
		})
		return summary
	}
}

// ── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
