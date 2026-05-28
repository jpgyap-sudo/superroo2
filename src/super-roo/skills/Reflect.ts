/**
 * Super Roo — Reflect Stage (Minibatch Trajectory Analysis)
 *
 * Ported from SkillOpt's `skillopt/gradient/reflect.py`.
 *
 * The Reflect stage groups rollout trajectories into minibatches and
 * analyzes each minibatch in a single LLM call. This is the "gradient
 * computation" of the ReflACT pipeline — it produces patches (edits)
 * that would improve the skill based on observed failures and successes.
 *
 * Key concepts:
 *   - Minibatch: A group of M trajectories analyzed together
 *   - Error analyst: Analyzes failed trajectories → produces failure patches
 *   - Success analyst: Analyzes successful trajectories → produces success patches
 *   - Parallel execution: Multiple minibatches analyzed concurrently
 */

import type { RolloutResult, RawPatch, FailureSummaryEntry, Edit } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ReflectConfig {
	/** Minibatch size (number of trajectories per batch) */
	minibatchSize: number
	/** Max workers for parallel analysis */
	maxWorkers: number
	/** Whether to run success analysts (default: true) */
	runSuccessAnalysts?: boolean
	/** Whether to run error analysts (default: true) */
	runErrorAnalysts?: boolean
	/** Custom prompt overrides */
	prompts?: {
		errorAnalyst?: string
		successAnalyst?: string
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyst function type — the actual LLM call is injected
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalystContext {
	trajectories: string[]
	skillContent: string
	updateMode: string
	customPrompt?: string
}

export type AnalystFn = (context: AnalystContext) => Promise<RawPatch | null>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a single trajectory for analysis. */
export function formatTrajectory(result: RolloutResult, maxChars: number = 4000): string {
	const header = `=== Task: ${result.taskId} | Success: ${result.success} | Quality: ${result.quality ?? "N/A"} | Duration: ${result.durationMs}ms ===`
	const body = result.trajectory.slice(0, maxChars)
	const error = result.error ? `\n--- Error ---\n${result.error.slice(0, 500)}` : ""
	return `${header}\n${body}${error}`
}

/** Format multiple trajectories into a single minibatch text block. */
export function formatMinibatchTrajectories(results: RolloutResult[], maxPerTrajectory: number = 3000): string {
	return results
		.map((r, i) => `[Trajectory ${i + 1}/${results.length}]\n${formatTrajectory(r, maxPerTrajectory)}`)
		.join("\n\n---\n\n")
}

/** Shuffle items deterministically for minibatch formation. */
export function shuffleForMinibatch<T>(items: T[], seed?: number): T[] {
	const arr = [...items]
	const rng = seed ? seededRandom(seed) : Math.random
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[arr[i], arr[j]] = [arr[j], arr[i]]
	}
	return arr
}

function seededRandom(seed: number): () => number {
	let s = seed
	return () => {
		s = (s * 1664525 + 1013904223) & 0x7fffffff
		return s / 0x7fffffff
	}
}

/** Group items into minibatches. */
export function groupIntoMinibatches<T>(items: T[], batchSize: number): T[][] {
	const batches: T[][] = []
	for (let i = 0; i < items.length; i += batchSize) {
		batches.push(items.slice(i, i + batchSize))
	}
	return batches
}

// ─────────────────────────────────────────────────────────────────────────────
// Error analyst — analyze failed trajectories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze a minibatch of failed trajectories in one analyst call.
 * Returns a RawPatch with failure summaries and suggested edits.
 */
export async function runErrorAnalystMinibatch(
	trajectories: string[],
	skillContent: string,
	analystFn: AnalystFn,
	customPrompt?: string,
): Promise<RawPatch | null> {
	try {
		return await analystFn({
			trajectories,
			skillContent,
			updateMode: "patch",
			customPrompt,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[Reflect] Error analyst failed: ${msg}`)
		return null
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Success analyst — analyze successful trajectories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze a minibatch of successful trajectories in one analyst call.
 * Returns a RawPatch with success patterns and suggested improvements.
 */
export async function runSuccessAnalystMinibatch(
	trajectories: string[],
	skillContent: string,
	analystFn: AnalystFn,
	customPrompt?: string,
): Promise<RawPatch | null> {
	try {
		return await analystFn({
			trajectories,
			skillContent,
			updateMode: "patch",
			customPrompt,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[Reflect] Success analyst failed: ${msg}`)
		return null
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Full minibatch reflect stage
// ─────────────────────────────────────────────────────────────────────────────

export interface ReflectResult {
	/** Patches from error analysts */
	errorPatches: RawPatch[]
	/** Patches from success analysts */
	successPatches: RawPatch[]
	/** Total trajectories analyzed */
	totalTrajectories: number
	/** Number of minibatches processed */
	minibatchCount: number
	/** Duration in ms */
	durationMs: number
}

/**
 * Run the full minibatch reflect stage.
 *
 * 1. Separate rollouts into success/failure
 * 2. Shuffle and group into minibatches
 * 3. Run error analysts on failure minibatches (parallel)
 * 4. Run success analysts on success minibatches (parallel)
 * 5. Collect all patches
 */
export async function runMinibatchReflect(
	rollouts: RolloutResult[],
	skillContent: string,
	errorAnalystFn: AnalystFn,
	successAnalystFn: AnalystFn,
	config: ReflectConfig,
): Promise<ReflectResult> {
	const startTime = Date.now()

	const failedRollouts = rollouts.filter((r) => !r.success)
	const successRollouts = rollouts.filter((r) => r.success)

	// Shuffle for randomness
	const shuffledFailures = shuffleForMinibatch(failedRollouts)
	const shuffledSuccesses = shuffleForMinibatch(successRollouts)

	// Group into minibatches
	const failBatches =
		config.runErrorAnalysts !== false ? groupIntoMinibatches(shuffledFailures, config.minibatchSize) : []
	const successBatches =
		config.runSuccessAnalysts !== false ? groupIntoMinibatches(shuffledSuccesses, config.minibatchSize) : []

	const errorPatches: RawPatch[] = []
	const successPatches: RawPatch[] = []

	// Process error batches in parallel (limited by maxWorkers)
	const maxWorkers = config.maxWorkers || 4

	async function processBatch<T>(
		batch: RolloutResult[],
		analystFn: AnalystFn,
		isError: boolean,
	): Promise<RawPatch | null> {
		const trajectories = batch.map((r) => formatTrajectory(r))
		if (isError) {
			return runErrorAnalystMinibatch(trajectories, skillContent, analystFn)
		} else {
			return runSuccessAnalystMinibatch(trajectories, skillContent, analystFn)
		}
	}

	// Process in parallel with worker limit
	async function runParallel<T>(batches: RolloutResult[][], fn: AnalystFn, isError: boolean): Promise<RawPatch[]> {
		const results: RawPatch[] = []
		for (let i = 0; i < batches.length; i += maxWorkers) {
			const chunk = batches.slice(i, i + maxWorkers)
			const patches = await Promise.all(chunk.map((batch) => processBatch(batch, fn, isError)))
			for (const p of patches) {
				if (p) results.push(p)
			}
		}
		return results
	}

	// Run error and success analysts
	const [errors, successes] = await Promise.all([
		runParallel(failBatches, errorAnalystFn, true),
		runParallel(successBatches, successAnalystFn, false),
	])

	errorPatches.push(...errors)
	successPatches.push(...successes)

	return {
		errorPatches,
		successPatches,
		totalTrajectories: rollouts.length,
		minibatchCount: failBatches.length + successBatches.length,
		durationMs: Date.now() - startTime,
	}
}
