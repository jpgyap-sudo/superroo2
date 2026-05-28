/**
 * Super Roo — Rewrite Stage (Full Skill Rewrite from Suggestions)
 *
 * Ported from SkillOpt's `skillopt/optimizer/rewrite.py`.
 *
 * Instead of applying individual patch edits, the rewrite stage asks the
 * optimizer LLM to produce a full skill rewrite based on selected
 * revise_suggestions. This is useful when:
 *   - The skill needs structural changes (not just edits)
 *   - Many small edits would be less coherent than a rewrite
 *   - The update mode is "rewrite_from_suggestions"
 */

import type { Patch } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RewriteConfig {
	/** Max skill content length (chars) */
	maxSkillLength?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite function type
// ─────────────────────────────────────────────────────────────────────────────

export interface RewriteContext {
	/** Current skill content */
	currentSkill: string
	/** Revise suggestions from the patch */
	suggestions: string[]
	/** Reasoning from the patch */
	reasoning: string
	/** Current meta skill content (if available) */
	metaSkillContent?: string
}

export type RewriteFn = (context: RewriteContext) => Promise<string>

// ─────────────────────────────────────────────────────────────────────────────
// Run rewrite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite a skill from revise suggestions.
 *
 * Extracts suggestions from the patch and calls the optimizer LLM
 * to produce a full rewrite of the skill.
 */
export async function rewriteSkillFromSuggestions(
	currentSkill: string,
	patch: Patch,
	rewriteFn: RewriteFn,
	metaSkillContent?: string,
	config?: RewriteConfig,
): Promise<string> {
	const suggestions = patch.edits.filter((e) => e.op === "replace" && e.search.length > 0).map((e) => e.replace)

	if (suggestions.length === 0) {
		console.log("[Rewrite] No suggestions to rewrite from")
		return currentSkill
	}

	try {
		const newSkill = await rewriteFn({
			currentSkill,
			suggestions,
			reasoning: patch.reasoning,
			metaSkillContent,
		})

		return newSkill
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[Rewrite] Failed: ${msg}`)
		return currentSkill
	}
}
