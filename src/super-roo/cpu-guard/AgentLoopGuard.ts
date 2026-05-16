/**
 * Super Roo — Agent Loop Guard
 *
 * Bounded agent step loop with CPU/RAM-aware backpressure.
 * Prevents infinite loops by enforcing max iterations and cooldowns.
 */

import { waitForCpuBelow } from "./cpuGuard"

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentStepResult = {
	done: boolean
	message?: string
}

export type GuardedLoopOptions = {
	taskName: string
	maxLoops?: number
	cooldownMs?: number
	maxCpuPercent?: number
	maxRamPercent?: number
	logger?: Console
	/** Optional AbortSignal for graceful cancellation. */
	signal?: AbortSignal
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
	maxLoops: 5,
	cooldownMs: 2000,
	maxCpuPercent: 85,
	maxRamPercent: 90,
}

// ── Typed error ──────────────────────────────────────────────────────────────

export class GuardedLoopError extends Error {
	constructor(
		message: string,
		public readonly taskName: string,
		public readonly loopsExecuted: number,
	) {
		super(message)
		this.name = "GuardedLoopError"
	}
}

// ── Guarded loop runner ──────────────────────────────────────────────────────

/**
 * Run a bounded agent step loop with CPU/RAM-aware backpressure.
 *
 * - Respects `maxLoops` to prevent infinite loops.
 * - Pauses between iterations via `cooldownMs`.
 * - Waits for CPU to drop below `maxCpuPercent` before each step.
 * - Supports optional `AbortSignal` for graceful cancellation.
 *
 * Throws `GuardedLoopError` if `maxLoops` is exceeded.
 */
export async function runGuardedAgentLoop(
	step: (loopIndex: number) => Promise<AgentStepResult>,
	options: GuardedLoopOptions,
): Promise<AgentStepResult> {
	const logger = options.logger ?? console
	const maxLoops = options.maxLoops ?? DEFAULTS.maxLoops
	const cooldownMs = options.cooldownMs ?? DEFAULTS.cooldownMs
	const maxCpuPercent = options.maxCpuPercent ?? DEFAULTS.maxCpuPercent
	const maxRamPercent = options.maxRamPercent ?? DEFAULTS.maxRamPercent

	for (let i = 1; i <= maxLoops; i++) {
		options.signal?.throwIfAborted()

		await waitForCpuBelow(maxCpuPercent, logger, undefined, {
			maxRamPercent,
			signal: options.signal,
		})

		logger.info(`[AGENT] ${options.taskName}: loop ${i}/${maxLoops}`)
		const result = await step(i)

		if (result.done) {
			logger.info(`[AGENT] ${options.taskName}: completed. ${result.message ?? ""}`)
			return result
		}

		await sleep(cooldownMs)
	}

	throw new GuardedLoopError(
		`[AGENT LOOP STOPPED] ${options.taskName} exceeded maxLoops=${maxLoops}. Possible infinite loop prevented.`,
		options.taskName,
		maxLoops,
	)
}

// ── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
