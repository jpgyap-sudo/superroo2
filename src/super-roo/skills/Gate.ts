/**
 * Super Roo — Validation Gate
 *
 * Ported from SkillOpt's `skillopt/evaluation/gate.py`.
 *
 * The validation gate decides whether to accept, reject, or accept-as-new-best
 * a candidate skill after a training step. It compares the candidate's
 * evaluation score against the current skill's score and the all-time best score.
 *
 * Decision logic:
 *   - candidateScore > bestScore  → accept_new_best
 *   - candidateScore > previousScore → accept
 *   - otherwise → reject
 */

import type { GateResult, GateAction } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Gate configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface GateConfig {
	/** Minimum improvement threshold to accept (default: 0.01) */
	improvementThreshold?: number
	/** Whether to allow acceptance even without improvement (default: false) */
	allowPlateauAcceptance?: boolean
	/** Plateau threshold: if score is within this range of previous, still accept (default: 0.005) */
	plateauThreshold?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a candidate skill against the current and best scores.
 * Pure function — no side effects.
 */
export function evaluateGate(
	candidateScore: number,
	previousScore: number,
	bestScore: number,
	config?: GateConfig,
): GateResult {
	const threshold = config?.improvementThreshold ?? 0.01
	const plateauThreshold = config?.plateauThreshold ?? 0.005
	const allowPlateau = config?.allowPlateauAcceptance ?? false

	let action: GateAction
	let reasoning: string

	if (candidateScore > bestScore + threshold) {
		action = "accept_new_best"
		reasoning = `Candidate (${candidateScore.toFixed(4)}) exceeds best (${bestScore.toFixed(4)}) by ${(candidateScore - bestScore).toFixed(4)}`
	} else if (candidateScore > previousScore + threshold) {
		action = "accept"
		reasoning = `Candidate (${candidateScore.toFixed(4)}) improves on previous (${previousScore.toFixed(4)}) by ${(candidateScore - previousScore).toFixed(4)}`
	} else if (allowPlateau && Math.abs(candidateScore - previousScore) <= plateauThreshold) {
		action = "accept"
		reasoning = `Candidate (${candidateScore.toFixed(4)}) within plateau threshold of previous (${previousScore.toFixed(4)})`
	} else {
		action = "reject"
		reasoning = `Candidate (${candidateScore.toFixed(4)}) does not improve on previous (${previousScore.toFixed(4)}) or best (${bestScore.toFixed(4)})`
	}

	return {
		action,
		candidateScore,
		bestScore,
		previousScore,
		reasoning,
	}
}

/**
 * Apply a gate result to update skill scores.
 * Returns the new best score and whether the skill was updated.
 */
export function applyGateResult(
	result: GateResult,
	currentBestScore: number,
): { newBestScore: number; accepted: boolean } {
	switch (result.action) {
		case "accept_new_best":
			return { newBestScore: result.candidateScore, accepted: true }
		case "accept":
			return { newBestScore: currentBestScore, accepted: true }
		case "reject":
			return { newBestScore: currentBestScore, accepted: false }
	}
}
