/**
 * Super Roo — Slow Update (Epoch-Level Longitudinal Skill Refinement)
 *
 * Ported from SkillOpt's `skillopt/optimizer/slow_update.py`.
 *
 * The slow update mechanism provides epoch-level strategic guidance for
 * skill documents. It operates on protected sections of the skill
 * (marked with <!-- SLOW_UPDATE_START --> ... <!-- SLOW_UPDATE_END -->)
 * that are read-only to step-level analysts.
 *
 * At epoch boundaries, the slow update:
 *   1. Builds comparison pairs between previous and current epoch rollouts
 *   2. Categorizes each pair (improved, regressed, persistent_fail, stable_success)
 *   3. Calls the optimizer LLM to produce strategic guidance
 *   4. Writes the guidance into the slow update field
 *
 * This is the "weight decay / regularization" of the ReflACT pipeline.
 */

import type { SlowUpdateResult, ComparisonPair, RolloutResult } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface SlowUpdateConfig {
	/** Max trajectory length per sample (chars) */
	maxTrajectoryChars?: number
	/** Max comparison pairs to include */
	maxPairs?: number
	/** Longitudinal pair policy: "all" | "improved_only" | "regressed_only" | "failures_only" */
	pairPolicy?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Slow update function type
// ─────────────────────────────────────────────────────────────────────────────

export interface SlowUpdateContext {
	/** Formatted comparison text */
	comparisonText: string
	/** Current skill content */
	skillContent: string
	/** Previous meta skill content */
	metaSkillContent: string
	/** Current epoch number */
	epoch: number
}

export type SlowUpdateFn = (context: SlowUpdateContext) => Promise<SlowUpdateResult>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Clip text to a maximum length. */
function clipText(value: string, limit: number): string {
	if (value.length <= limit) return value
	return value.slice(0, limit) + "\n... [truncated]"
}

// ─────────────────────────────────────────────────────────────────────────────
// Build comparison pairs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build structured comparison pairs between previous and current epoch rollouts.
 *
 * Each pair is categorized as:
 *   - improved:         Failed before, succeeded now
 *   - regressed:        Succeeded before, failed now
 *   - persistent_fail:  Failed both times
 *   - stable_success:   Succeeded both times
 */
export function buildComparisonPairs(
	previousRollouts: RolloutResult[],
	currentRollouts: RolloutResult[],
): ComparisonPair[] {
	const pairs: ComparisonPair[] = []
	const prevMap = new Map<string, RolloutResult>()
	for (const r of previousRollouts) {
		prevMap.set(r.taskId, r)
	}

	for (const current of currentRollouts) {
		const previous = prevMap.get(current.taskId)
		if (!previous) continue

		let category: ComparisonPair["category"]
		if (!previous.success && current.success) category = "improved"
		else if (previous.success && !current.success) category = "regressed"
		else if (!previous.success && !current.success) category = "persistent_fail"
		else category = "stable_success"

		pairs.push({
			taskId: current.taskId,
			category,
			previousTrajectory: previous.trajectory,
			currentTrajectory: current.trajectory,
			previousScore: previous.quality ?? (previous.success ? 0.8 : 0.2),
			currentScore: current.quality ?? (current.success ? 0.8 : 0.2),
		})
	}

	return pairs
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter comparison pairs by policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter comparison pairs based on the longitudinal pair policy.
 *
 * Policies:
 *   - "all":             Include all pairs
 *   - "improved_only":   Only pairs where score improved
 *   - "regressed_only":  Only pairs where score regressed
 *   - "failures_only":   Only pairs involving failures (improved or persistent_fail)
 */
export function filterComparisonPairs(pairs: ComparisonPair[], policy: string): ComparisonPair[] {
	switch (policy) {
		case "improved_only":
			return pairs.filter((p) => p.category === "improved")
		case "regressed_only":
			return pairs.filter((p) => p.category === "regressed")
		case "failures_only":
			return pairs.filter((p) => p.category === "persistent_fail" || p.category === "improved")
		case "all":
		default:
			return pairs
	}
}

/** Get category counts for reporting. */
export function pairCategoryCounts(pairs: ComparisonPair[]): Record<string, number> {
	const counts: Record<string, number> = {
		improved: 0,
		regressed: 0,
		persistent_fail: 0,
		stable_success: 0,
	}
	for (const p of pairs) {
		counts[p.category]++
	}
	return counts
}

// ─────────────────────────────────────────────────────────────────────────────
// Format comparison text
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format structured comparison pairs into optimizer-readable text.
 */
export function formatComparisonText(pairs: ComparisonPair[], maxTrajectoryChars: number = 2000): string {
	const byCategory: Record<string, ComparisonPair[]> = {
		improved: [],
		regressed: [],
		persistent_fail: [],
		stable_success: [],
	}
	for (const p of pairs) {
		byCategory[p.category]?.push(p)
	}

	const sections: string[] = []

	for (const [category, categoryPairs] of Object.entries(byCategory)) {
		if (categoryPairs.length === 0) continue
		sections.push(`=== ${category.toUpperCase()} (${categoryPairs.length} pairs) ===`)

		for (const pair of categoryPairs.slice(0, 5)) {
			sections.push(`Task: ${pair.taskId}`)
			sections.push(
				`Previous score: ${pair.previousScore.toFixed(3)} → Current score: ${pair.currentScore.toFixed(3)}`,
			)
			sections.push(`Previous trajectory:\n${clipText(pair.previousTrajectory, maxTrajectoryChars)}`)
			sections.push(`Current trajectory:\n${clipText(pair.currentTrajectory, maxTrajectoryChars)}`)
			sections.push("---")
		}
	}

	return sections.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Save comparison pairs (JSON)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize comparison pairs to a JSON-serializable format.
 */
export function serializeComparisonPairs(pairs: ComparisonPair[]): object[] {
	return pairs.map((p) => ({
		taskId: p.taskId,
		category: p.category,
		previousScore: p.previousScore,
		currentScore: p.currentScore,
		previousTrajectoryLength: p.previousTrajectory.length,
		currentTrajectoryLength: p.currentTrajectory.length,
	}))
}

// ─────────────────────────────────────────────────────────────────────────────
// Run slow update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the slow update optimizer call for one epoch boundary.
 *
 * 1. Build comparison pairs between previous and current epoch
 * 2. Filter by policy
 * 3. Format into optimizer-readable text
 * 4. Call optimizer LLM for strategic guidance
 * 5. Return the result
 */
export async function runSlowUpdate(
	previousRollouts: RolloutResult[],
	currentRollouts: RolloutResult[],
	skillContent: string,
	metaSkillContent: string,
	slowUpdateFn: SlowUpdateFn,
	epoch: number,
	config?: SlowUpdateConfig,
): Promise<SlowUpdateResult | null> {
	const maxPairs = config?.maxPairs ?? 20
	const maxTrajectoryChars = config?.maxTrajectoryChars ?? 2000
	const pairPolicy = config?.pairPolicy ?? "all"

	try {
		// Build and filter pairs
		const allPairs = buildComparisonPairs(previousRollouts, currentRollouts)
		const filteredPairs = filterComparisonPairs(allPairs, pairPolicy).slice(0, maxPairs)

		if (filteredPairs.length === 0) {
			console.log("[SlowUpdate] No comparison pairs to analyze")
			return null
		}

		// Format for optimizer
		const comparisonText = formatComparisonText(filteredPairs, maxTrajectoryChars)

		// Call optimizer
		const result = await slowUpdateFn({
			comparisonText,
			skillContent,
			metaSkillContent,
			epoch,
		})

		// Attach stats
		result.stats = pairCategoryCounts(allPairs) as SlowUpdateResult["stats"]

		return result
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[SlowUpdate] Failed: ${msg}`)
		return null
	}
}
