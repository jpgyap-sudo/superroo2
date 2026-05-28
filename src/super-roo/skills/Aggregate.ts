/**
 * Super Roo — Aggregate Stage (Hierarchical Patch Merging)
 *
 * Ported from SkillOpt's `skillopt/gradient/aggregate.py`.
 *
 * The Aggregate stage merges multiple patches (from different minibatches)
 * into a single coherent set of edits. It uses a hierarchical merging
 * strategy:
 *
 *   1. Failure patches take priority (merged first)
 *   2. Patches are merged in parallel at each level of the hierarchy
 *   3. Each merge reduces the patch count by the branching factor
 *   4. Final merge produces one unified patch
 *
 * This is the "gradient accumulation" step — combining multiple gradient
 * signals into one update.
 */

import type { Patch, RawPatch } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface AggregateConfig {
	/** Branching factor: how many patches to merge at once (default: 4) */
	branchingFactor?: number
	/** Max workers for parallel merging */
	maxWorkers?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge function type
// ─────────────────────────────────────────────────────────────────────────────

export interface MergeContext {
	patches: Patch[]
	skillContent: string
}

export type MergeFn = (context: MergeContext) => Promise<Patch>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a RawPatch to a Patch. */
export function rawPatchToPatch(raw: RawPatch, sourceType: string): Patch {
	return {
		reasoning: raw.failureSummary?.map((f) => f.summary).join("; ") || "No reasoning",
		edits: raw.edits || [],
		sourceType,
		supportCount: 1,
	}
}

/** Sort patches: failure-first priority. */
export function sortPatchesByPriority(patches: Patch[]): Patch[] {
	return [...patches].sort((a, b) => {
		// Error analyst patches first
		const aPriority = a.sourceType === "error_analyst" ? 0 : 1
		const bPriority = b.sourceType === "error_analyst" ? 0 : 1
		if (aPriority !== bPriority) return aPriority - bPriority
		// Then by support count descending
		return b.supportCount - a.supportCount
	})
}

/** Deduplicate patches by comparing edit targets. */
export function deduplicatePatches(patches: Patch[]): Patch[] {
	const seen = new Set<string>()
	return patches.filter((p) => {
		const key = p.edits.map((e) => `${e.op}:${e.search.slice(0, 80)}`).join("|")
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge a batch of patches into one using the merge function.
 */
export async function mergeBatch(patches: Patch[], skillContent: string, mergeFn: MergeFn): Promise<Patch> {
	return mergeFn({ patches, skillContent })
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hierarchically merge patches until one remains.
 *
 * Algorithm:
 *   1. Sort patches by priority (failure first)
 *   2. Deduplicate
 *   3. Group into batches of `branchingFactor`
 *   4. Merge each batch in parallel
 *   5. Repeat until one patch remains
 */
export async function hierarchicalMerge(
	patches: Patch[],
	skillContent: string,
	mergeFn: MergeFn,
	config?: AggregateConfig,
): Promise<Patch | null> {
	if (patches.length === 0) return null
	if (patches.length === 1) return patches[0]

	const branchingFactor = config?.branchingFactor ?? 4
	const maxWorkers = config?.maxWorkers ?? 4

	let current = deduplicatePatches(sortPatchesByPriority(patches))

	while (current.length > 1) {
		const batches: Patch[][] = []
		for (let i = 0; i < current.length; i += branchingFactor) {
			batches.push(current.slice(i, i + branchingFactor))
		}

		// Merge each batch in parallel
		const merged: Patch[] = []
		for (let i = 0; i < batches.length; i += maxWorkers) {
			const chunk = batches.slice(i, i + maxWorkers)
			const results = await Promise.all(chunk.map((batch) => mergeBatch(batch, skillContent, mergeFn)))
			merged.push(...results)
		}

		current = merged
	}

	return current[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// Full aggregate stage
// ─────────────────────────────────────────────────────────────────────────────

export interface AggregateResult {
	/** The final merged patch (null if no patches) */
	mergedPatch: Patch | null
	/** Number of input patches */
	inputCount: number
	/** Number of merge rounds */
	mergeRounds: number
	/** Duration in ms */
	durationMs: number
}

/**
 * Run the full aggregate stage.
 *
 * 1. Convert raw patches to Patch objects
 * 2. Sort by priority (failure first)
 * 3. Hierarchically merge
 * 4. Return the final merged patch
 */
export async function runAggregate(
	errorPatches: RawPatch[],
	successPatches: RawPatch[],
	skillContent: string,
	mergeFn: MergeFn,
	config?: AggregateConfig,
): Promise<AggregateResult> {
	const startTime = Date.now()

	const patches: Patch[] = [
		...errorPatches.map((p) => rawPatchToPatch(p, "error_analyst")),
		...successPatches.map((p) => rawPatchToPatch(p, "success_analyst")),
	]

	if (patches.length === 0) {
		return {
			mergedPatch: null,
			inputCount: 0,
			mergeRounds: 0,
			durationMs: Date.now() - startTime,
		}
	}

	const mergedPatch = await hierarchicalMerge(patches, skillContent, mergeFn, config)

	return {
		mergedPatch,
		inputCount: patches.length,
		mergeRounds: mergedPatch ? Math.ceil(Math.log(patches.length) / Math.log(config?.branchingFactor ?? 4)) : 0,
		durationMs: Date.now() - startTime,
	}
}
