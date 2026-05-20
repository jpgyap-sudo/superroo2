/**
 * Super Roo — Cloud CPU Guard
 *
 * Port of src/super-roo/cpu-guard/ (cpuGuard.ts + AgentLoopGuard.ts + autonomousController.ts)
 *
 * Resource-aware backpressure for autonomous agent loops.
 * Monitors CPU and RAM usage, pausing agent execution when thresholds are exceeded.
 *
 * GAP 9: RAM measurement is now shared via RAMMonitor.getRamUsagePercent()
 * to ensure consistent RAM readings across all modules.
 */

const os = require("os")

// ── CPU measurement ──────────────────────────────────────────────────────────

function cpuAverage() {
	const cpus = os.cpus()
	let idle = 0
	let total = 0

	for (const cpu of cpus) {
		for (const type of Object.keys(cpu.times)) {
			total += cpu.times[type]
		}
		idle += cpu.times.idle
	}

	return { idle, total }
}

/**
 * Sample CPU usage over `sampleMs` milliseconds.
 * Returns a percentage 0–100.
 * @param {number} [sampleMs=500]
 * @returns {Promise<number>}
 */
async function getCpuUsagePercent(sampleMs = 500) {
	const start = cpuAverage()
	await sleep(sampleMs)
	const end = cpuAverage()

	const idleDiff = end.idle - start.idle
	const totalDiff = end.total - start.total
	if (totalDiff <= 0) return 0

	return Math.round((1 - idleDiff / totalDiff) * 100)
}

// ── RAM measurement (GAP 9: shared with RAMMonitor) ─────────────────────────

/**
 * Get current RAM usage as a percentage 0–100.
 * Delegates to RAMMonitor.getRamUsagePercent() when available for consistency.
 * Falls back to os module directly if RAMMonitor is not loaded.
 * @returns {number}
 */
function getRamUsagePercent() {
	try {
		const { getRamUsagePercent: sharedGetRam } = require("./RAMMonitor");
		if (typeof sharedGetRam === "function") {
			return sharedGetRam();
		}
	} catch {
		// RAMMonitor not available — use local fallback
	}
	const total = os.totalmem()
	const free = os.freemem()
	if (total <= 0) return 0
	return Math.round(((total - free) / total) * 100)
}

/**
 * Get a full resource snapshot (CPU + RAM).
 * @param {number} [sampleMs=500]
 * @returns {Promise<{cpuPercent: number, ramPercent: number, freeRamMb: number, totalRamMb: number, timestamp: number}>}
 */
async function getResourceSample(sampleMs = 500) {
	const totalRamMb = Math.round(os.totalmem() / (1024 * 1024))
	const freeRamMb = Math.round(os.freemem() / (1024 * 1024))
	const cpuPercent = await getCpuUsagePercent(sampleMs)

	return {
		cpuPercent,
		ramPercent: Math.round(((totalRamMb - freeRamMb) / totalRamMb) * 100),
		freeRamMb,
		totalRamMb,
		timestamp: Date.now(),
	}
}

// ── Event system ─────────────────────────────────────────────────────────────

/** @type {Set<Function>} */
const listeners = new Set()

/**
 * Subscribe to resource guard events (CPU/RAM threshold crossings).
 * Returns an unsubscribe function.
 * @param {Function} listener
 * @returns {Function}
 */
function onResourceGuardEvent(listener) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * @param {{ type: string, sample: Object, threshold: number }} event
 */
function emitEvent(event) {
	for (const listener of listeners) {
		try {
			listener(event)
		} catch {
			// prevent listener exceptions from breaking the guard
		}
	}
}

// ── Resource guard with backpressure ─────────────────────────────────────────

/**
 * Wait until CPU drops below `maxCpuPercent` (and optionally RAM below
 * `maxRamPercent`). Polls every `pollIntervalMs` ms.
 *
 * @param {number} maxCpuPercent
 * @param {Console} [logger=console]
 * @param {number} [resumeCpuPercent]
 * @param {Object} [options]
 * @param {number} [options.maxRamPercent=90]
 * @param {number} [options.resumeRamPercent]
 * @param {number} [options.pollIntervalMs=3000]
 * @param {number} [options.sampleMs=500]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
async function waitForCpuBelow(maxCpuPercent, logger = console, resumeCpuPercent, options = {}) {
	const resumeAt = resumeCpuPercent ?? maxCpuPercent
	const maxRam = options.maxRamPercent ?? 90
	const resumeRam = options.resumeRamPercent ?? maxRam
	const pollInterval = options.pollIntervalMs ?? 3000
	const sampleMs = options.sampleMs ?? 500

	let sample = await getResourceSample(sampleMs)
	let wasCpuPaused = sample.cpuPercent >= maxCpuPercent
	let wasRamPaused = sample.ramPercent >= maxRam

	while (true) {
		if (options.signal) options.signal.throwIfAborted()

		sample = await getResourceSample(sampleMs)

		// CPU check
		if (sample.cpuPercent >= maxCpuPercent) {
			if (!wasCpuPaused) {
				wasCpuPaused = true
				emitEvent({ type: "cpu_exceeded", sample, threshold: maxCpuPercent })
			}
			logger.warn?.(
				`[CPU GUARD] CPU ${sample.cpuPercent}% >= ${maxCpuPercent}%. Pausing until CPU <= ${resumeAt}%...`,
			)
			await sleep(pollInterval)
			continue
		}

		if (wasCpuPaused && sample.cpuPercent < resumeAt) {
			wasCpuPaused = false
			emitEvent({ type: "cpu_recovered", sample, threshold: resumeAt })
			logger.info?.(
				`[CPU GUARD] CPU recovered to ${sample.cpuPercent}% (resume threshold ${resumeAt}%). Resuming.`,
			)
		}

		// RAM check
		if (sample.ramPercent >= maxRam) {
			if (!wasRamPaused) {
				wasRamPaused = true
				emitEvent({ type: "ram_exceeded", sample, threshold: maxRam })
			}
			logger.warn?.(`[RAM GUARD] RAM ${sample.ramPercent}% >= ${maxRam}%. Pausing until RAM <= ${resumeRam}%...`)
			await sleep(pollInterval)
			continue
		}

		if (wasRamPaused && sample.ramPercent < resumeRam) {
			wasRamPaused = false
			emitEvent({ type: "ram_recovered", sample, threshold: resumeRam })
			logger.info?.(
				`[RAM GUARD] RAM recovered to ${sample.ramPercent}% (resume threshold ${resumeRam}%). Resuming.`,
			)
		}

		// Both CPU and RAM are within limits
		if (!wasCpuPaused && !wasRamPaused) break

		await sleep(pollInterval)
	}
}

// ── Guarded Agent Loop ───────────────────────────────────────────────────────

/**
 * @typedef {Object} GuardedLoopOptions
 * @property {string} taskName
 * @property {number} [maxLoops=5]
 * @property {number} [cooldownMs=2000]
 * @property {number} [maxCpuPercent=85]
 * @property {number} [maxRamPercent=90]
 * @property {Console} [logger]
 * @property {AbortSignal} [signal]
 */

class GuardedLoopError extends Error {
	/**
	 * @param {string} message
	 * @param {string} taskName
	 * @param {number} loopsExecuted
	 */
	constructor(message, taskName, loopsExecuted) {
		super(message)
		this.name = "GuardedLoopError"
		this.taskName = taskName
		this.loopsExecuted = loopsExecuted
	}
}

const GUARD_DEFAULTS = {
	maxLoops: 5,
	cooldownMs: 2000,
	maxCpuPercent: 85,
	maxRamPercent: 90,
}

/**
 * Run a bounded agent step loop with CPU/RAM-aware backpressure.
 *
 * @param {(loopIndex: number) => Promise<{done: boolean, message?: string}>} step
 * @param {GuardedLoopOptions} options
 * @returns {Promise<{done: boolean, message?: string}>}
 * @throws {GuardedLoopError}
 */
async function runGuardedAgentLoop(step, options) {
	const logger = options.logger ?? console
	const maxLoops = options.maxLoops ?? GUARD_DEFAULTS.maxLoops
	const cooldownMs = options.cooldownMs ?? GUARD_DEFAULTS.cooldownMs
	const maxCpuPercent = options.maxCpuPercent ?? GUARD_DEFAULTS.maxCpuPercent
	const maxRamPercent = options.maxRamPercent ?? GUARD_DEFAULTS.maxRamPercent

	for (let i = 1; i <= maxLoops; i++) {
		if (options.signal) options.signal.throwIfAborted()

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

// ── Autonomous Controller ────────────────────────────────────────────────────

/** @type {"paused"|"controlled"|"aggressive"} */
let autonomousMode = "controlled"
/** @type {Set<Function>} */
const controllerListeners = new Set()

/**
 * @param {{ type: string, mode?: string, taskName?: string, timestamp: number }} event
 */
function emitControllerEvent(event) {
	for (const listener of controllerListeners) {
		try {
			listener(event)
		} catch {
			// prevent listener exceptions from breaking the controller
		}
	}
}

/**
 * Subscribe to autonomous controller events.
 * @param {Function} listener
 * @returns {Function}
 */
function onAutonomousControllerEvent(listener) {
	controllerListeners.add(listener)
	return () => controllerListeners.delete(listener)
}

const autonomousController = {
	/** @returns {"paused"|"controlled"|"aggressive"} */
	getMode() {
		return autonomousMode
	},

	/** @param {"paused"|"controlled"|"aggressive"} nextMode */
	setMode(nextMode) {
		const prev = autonomousMode
		autonomousMode = nextMode
		if (prev !== nextMode) {
			emitControllerEvent({ type: "mode_changed", mode: nextMode, timestamp: Date.now() })
		}
	},

	/** @returns {boolean} */
	isEnabled() {
		return autonomousMode !== "paused"
	},

	/** @returns {{ maxParallelAgents: number, maxLoops: number, cooldownMs: number, cpuPauseThreshold: number, ramPauseThreshold: number }} */
	getLimits() {
		if (autonomousMode === "aggressive") {
			return {
				maxParallelAgents: Math.max(2, 3),
				maxLoops: Math.max(5, 8),
				cooldownMs: Math.min(2000, 1000),
				cpuPauseThreshold: Math.max(85, 90),
				ramPauseThreshold: Math.max(90, 95),
			}
		}
		return {
			maxParallelAgents: 2,
			maxLoops: 5,
			cooldownMs: 2000,
			cpuPauseThreshold: 85,
			ramPauseThreshold: 90,
		}
	},
}

/**
 * Run a task with full controlled autonomy.
 *
 * @param {(loopIndex: number, attemptIndex: number) => Promise<{done: boolean, message?: string, nextAction?: string}>} step
 * @param {Object} options
 * @param {string} options.taskName
 * @param {number} [options.maxLoops]
 * @param {number} [options.maxAttempts=3]
 * @param {number} [options.cooldownMs]
 * @param {number} [options.maxRuntimeMs=600000]
 * @param {number} [options.cpuPauseThreshold]
 * @param {number} [options.cpuResumeThreshold=60]
 * @param {number} [options.ramPauseThreshold]
 * @param {number} [options.ramResumeThreshold=75]
 * @param {Console} [options.logger]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onSummary]
 * @returns {Promise<{taskName: string, status: string, loops: number, attempts: number, runtimeMs: number, finalMessage?: string, error?: string, timestamp: string}>}
 */
async function runControlledAutonomousTask(step, options) {
	const logger = options.logger ?? console
	const limits = autonomousController.getLimits()
	const maxLoops = options.maxLoops ?? limits.maxLoops
	const maxAttempts = options.maxAttempts ?? 3
	const cooldownMs = options.cooldownMs ?? limits.cooldownMs
	const maxRuntimeMs = options.maxRuntimeMs ?? 600000
	const cpuPauseThreshold = options.cpuPauseThreshold ?? limits.cpuPauseThreshold
	const cpuResumeThreshold = options.cpuResumeThreshold ?? 60
	const ramPauseThreshold = options.ramPauseThreshold ?? limits.ramPauseThreshold
	const ramResumeThreshold = options.ramResumeThreshold ?? 75

	const startedAt = Date.now()
	let loops = 0
	let attempts = 0

	const emitSummary = async (summary) => {
		if (options.onSummary) await options.onSummary(summary)
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
				if (options.signal) options.signal.throwIfAborted()

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
	} catch (error) {
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

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	onResourceGuardEvent,
	waitForCpuBelow,
	runGuardedAgentLoop,
	GuardedLoopError,
	autonomousController,
	onAutonomousControllerEvent,
	runControlledAutonomousTask,
}
