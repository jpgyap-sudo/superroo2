/**
 * Super Roo — CPU & RAM Guard
 *
 * Resource monitoring and backpressure for autonomous agent loops.
 * Monitors CPU and RAM usage, pausing agent execution when thresholds are exceeded.
 */

import os from "node:os"

// ── Types ────────────────────────────────────────────────────────────────────

export type ResourceSample = {
	cpuPercent: number
	ramPercent: number
	freeRamMb: number
	totalRamMb: number
	timestamp: number
}

export type ResourceGuardEvent = {
	type: "cpu_exceeded" | "cpu_recovered" | "ram_exceeded" | "ram_recovered"
	sample: ResourceSample
	threshold: number
}

export type ResourceGuardListener = (event: ResourceGuardEvent) => void

// ── CPU measurement ──────────────────────────────────────────────────────────

function cpuAverage() {
	const cpus = os.cpus()
	let idle = 0
	let total = 0

	for (const cpu of cpus) {
		for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
			total += cpu.times[type]
		}
		idle += cpu.times.idle
	}

	return { idle, total }
}

/**
 * Sample CPU usage over `sampleMs` milliseconds.
 * Returns a percentage 0–100.
 */
export async function getCpuUsagePercent(sampleMs = 500): Promise<number> {
	const start = cpuAverage()
	await sleep(sampleMs)
	const end = cpuAverage()

	const idleDiff = end.idle - start.idle
	const totalDiff = end.total - start.total
	if (totalDiff <= 0) return 0

	return Math.round((1 - idleDiff / totalDiff) * 100)
}

// ── RAM measurement ──────────────────────────────────────────────────────────

/**
 * Get current RAM usage as a percentage 0–100.
 */
export function getRamUsagePercent(): number {
	const total = os.totalmem()
	const free = os.freemem()
	if (total <= 0) return 0
	return Math.round(((total - free) / total) * 100)
}

/**
 * Get a full resource snapshot (CPU + RAM).
 */
export async function getResourceSample(sampleMs = 500): Promise<ResourceSample> {
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

const listeners: Set<ResourceGuardListener> = new Set()

/**
 * Subscribe to resource guard events (CPU/RAM threshold crossings).
 * Returns an unsubscribe function.
 */
export function onResourceGuardEvent(listener: ResourceGuardListener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

function emitEvent(event: ResourceGuardEvent): void {
	for (const listener of listeners) {
		try {
			listener(event)
		} catch {
			// prevent listener exceptions from breaking the guard
		}
	}
}

// ── Resource guard with backpressure ─────────────────────────────────────────

export type WaitForCpuBelowOptions = {
	maxRamPercent?: number
	resumeRamPercent?: number
	pollIntervalMs?: number
	sampleMs?: number
	signal?: AbortSignal
}

/**
 * Wait until CPU drops below `maxCpuPercent` (and optionally RAM below
 * `maxRamPercent`). Polls every `pollIntervalMs` ms.
 *
 * Supports an optional `AbortSignal` for graceful cancellation.
 */
export async function waitForCpuBelow(
	maxCpuPercent: number,
	logger = console,
	resumeCpuPercent?: number,
	options?: WaitForCpuBelowOptions,
): Promise<void> {
	const resumeAt = resumeCpuPercent ?? maxCpuPercent
	const maxRam = options?.maxRamPercent ?? 90
	const resumeRam = options?.resumeRamPercent ?? maxRam
	const pollInterval = options?.pollIntervalMs ?? 3000
	const sampleMs = options?.sampleMs ?? 500

	let sample = await getResourceSample(sampleMs)
	let wasCpuPaused = sample.cpuPercent >= maxCpuPercent
	let wasRamPaused = sample.ramPercent >= maxRam

	while (true) {
		options?.signal?.throwIfAborted()

		sample = await getResourceSample(sampleMs)

		// CPU check
		if (sample.cpuPercent >= maxCpuPercent) {
			if (!wasCpuPaused) {
				wasCpuPaused = true
				emitEvent({ type: "cpu_exceeded", sample, threshold: maxCpuPercent })
			}
			logger.warn?.(
				`[CPU GUARD] CPU ${sample.cpuPercent}% >= ${maxCpuPercent}%. ` + `Pausing until CPU <= ${resumeAt}%...`,
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
			logger.warn?.(
				`[RAM GUARD] RAM ${sample.ramPercent}% >= ${maxRam}%. ` + `Pausing until RAM <= ${resumeRam}%...`,
			)
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

// ── Utility sleep (inlined to avoid circular deps) ───────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
