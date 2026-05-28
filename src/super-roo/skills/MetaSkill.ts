/**
 * Super Roo — Meta Skill Optimizer Memory
 *
 * Ported from SkillOpt's `skillopt/optimizer/meta_skill.py`.
 *
 * The meta skill is optimizer-side memory that captures editing strategies
 * to improve future optimizer calls. It's like an optimizer's internal state
 * (momentum / Adam buffers) but expressed as natural language guidance.
 *
 * The meta skill is updated at epoch boundaries by comparing adjacent epochs:
 *   - What editing strategies worked?
 *   - What strategies didn't work?
 *   - What should the optimizer try next?
 *
 * This is the "optimizer state" of the ReflACT pipeline.
 */

import type { MetaSkill } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaSkillConfig {
	/** Max length of meta skill content (chars) */
	maxContentLength?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta skill function type
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaSkillContext {
	/** Previous epoch's meta skill content */
	previousMetaSkill: string
	/** Current epoch's skill content */
	currentSkillContent: string
	/** Previous epoch's skill content */
	previousSkillContent: string
	/** Training history for the current epoch */
	epochHistory: Array<{
		step: number
		editsApplied: number
		gateAction: string
		successRate: number
		avgQuality: number
	}>
	/** Current epoch number */
	epoch: number
}

export type MetaSkillFn = (context: MetaSkillContext) => Promise<{ reasoning: string; content: string }>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format meta skill context for the optimizer prompt. */
export function formatMetaSkillContext(metaSkillContent: string): string {
	if (!metaSkillContent || metaSkillContent.trim().length === 0) {
		return "No previous meta skill available."
	}
	return metaSkillContent
}

/** Default max content length */
const DEFAULT_MAX_LENGTH = 2000

// ─────────────────────────────────────────────────────────────────────────────
// Run meta skill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce updated optimizer-side meta skill from adjacent epochs.
 *
 * The meta skill captures:
 *   - Which edit types were most effective
 *   - Which skill sections needed the most changes
 *   - Common failure patterns the optimizer should watch for
 *   - Strategies that consistently improved scores
 */
export async function runMetaSkill(
	context: MetaSkillContext,
	metaSkillFn: MetaSkillFn,
	config?: MetaSkillConfig,
): Promise<MetaSkill> {
	const maxLength = config?.maxContentLength ?? DEFAULT_MAX_LENGTH

	try {
		const result = await metaSkillFn(context)

		const content =
			result.content.length > maxLength
				? result.content.slice(0, maxLength) + "\n\n<!-- truncated -->"
				: result.content

		return {
			content,
			epoch: context.epoch,
			reasoning: result.reasoning,
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`[MetaSkill] Failed to generate meta skill: ${msg}`)
		return {
			content: context.previousMetaSkill || "Meta skill generation failed.",
			epoch: context.epoch,
			reasoning: `Fallback: previous meta skill preserved. Error: ${msg}`,
		}
	}
}
