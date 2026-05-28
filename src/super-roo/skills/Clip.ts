/**
 * Super Roo — Clip Stage (Edit Ranking and Selection)
 *
 * Ported from SkillOpt's `skillopt/optimizer/clip.py`.
 *
 * The Clip stage ranks edits by importance and selects the top-L edits
 * to apply, where L is the current edit budget (learning rate).
 *
 * This is the "gradient clipping" step — preventing too many edits
 * from being applied at once, which could destabilize the skill.
 *
 * Ranking criteria (from SkillOpt):
 *   1. Systematic impact — fixes that address root causes
 *   2. Complementarity — edits that don't conflict with each other
 *   3. Generality — fixes that apply to multiple scenarios
 *   4. Actionability — edits that are precise and implementable
 */

import type { Patch, Edit } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ClipConfig {
	/** Max edits to keep after ranking (default: inferred from budget) */
	maxEdits?: number
	/** Whether to use LLM-based ranking (default: true) */
	useLLMRanking?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking function type
// ─────────────────────────────────────────────────────────────────────────────

export interface RankingContext {
	edits: Edit[]
	skillContent: string
	maxEdits: number
}

export type RankingFn = (context: RankingContext) => Promise<Edit[]>

// ─────────────────────────────────────────────────────────────────────────────
// Simple truncation (fallback when LLM ranking unavailable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple truncation-based selection.
 * Keeps the first L edits (preserving order from the merge stage).
 */
export function truncateEdits(edits: Edit[], maxEdits: number): Edit[] {
	return edits.slice(0, maxEdits)
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-based ranking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use an LLM to rank edits by importance, then keep top-L.
 * Falls back to simple truncation on error.
 */
export async function rankAndSelect(
	edits: Edit[],
	skillContent: string,
	maxEdits: number,
	rankingFn: RankingFn,
): Promise<Edit[]> {
	if (edits.length <= maxEdits) return edits

	try {
		const ranked = await rankingFn({
			edits,
			skillContent,
			maxEdits,
		})
		return ranked.slice(0, maxEdits)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[Clip] LLM ranking failed, falling back to truncation: ${msg}`)
		return truncateEdits(edits, maxEdits)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Full clip stage
// ─────────────────────────────────────────────────────────────────────────────

export interface ClipResult {
	/** Selected edits */
	selectedEdits: Edit[]
	/** Total edits before selection */
	totalEdits: number
	/** Max edits allowed */
	maxEdits: number
	/** Whether LLM ranking was used */
	usedLLM: boolean
	/** Duration in ms */
	durationMs: number
}

/**
 * Run the clip stage on a merged patch.
 *
 * 1. Extract all edits from the patch
 * 2. If edits <= budget, return all
 * 3. Otherwise, rank and select top-L edits
 */
export async function runClip(
	patch: Patch,
	skillContent: string,
	editBudget: number,
	rankingFn: RankingFn,
	config?: ClipConfig,
): Promise<ClipResult> {
	const startTime = Date.now()
	const maxEdits = config?.maxEdits ?? editBudget
	const useLLM = config?.useLLMRanking !== false

	const allEdits = patch.edits

	if (allEdits.length <= maxEdits) {
		return {
			selectedEdits: allEdits,
			totalEdits: allEdits.length,
			maxEdits,
			usedLLM: false,
			durationMs: Date.now() - startTime,
		}
	}

	let selectedEdits: Edit[]
	if (useLLM) {
		selectedEdits = await rankAndSelect(allEdits, skillContent, maxEdits, rankingFn)
	} else {
		selectedEdits = truncateEdits(allEdits, maxEdits)
	}

	return {
		selectedEdits,
		totalEdits: allEdits.length,
		maxEdits,
		usedLLM: useLLM,
		durationMs: Date.now() - startTime,
	}
}
