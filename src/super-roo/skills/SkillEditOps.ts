/**
 * Super Roo — Skill Edit Operations
 *
 * Ported from SkillOpt's `skillopt/optimizer/skill.py`.
 *
 * Provides operations for applying edits and patches to skill documents,
 * with support for slow update protected fields.
 *
 * Slow update fields are sections within a skill document marked with:
 *   <!-- SLOW_UPDATE_START -->
 *   ... protected content ...
 *   <!-- SLOW_UPDATE_END -->
 *
 * These sections are read-only to step-level analysts and are only
 * overwritten at epoch boundaries by the slow update mechanism.
 */

import type { Edit, Patch } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SLOW_UPDATE_START = "<!-- SLOW_UPDATE_START -->"
const SLOW_UPDATE_END = "<!-- SLOW_UPDATE_END -->"

// ─────────────────────────────────────────────────────────────────────────────
// Slow update field helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Check if a position in the skill is inside a slow update region. */
export function isInSlowUpdateRegion(skill: string, target: string): boolean {
	const startIdx = skill.indexOf(SLOW_UPDATE_START)
	if (startIdx === -1) return false
	const endIdx = skill.indexOf(SLOW_UPDATE_END, startIdx + SLOW_UPDATE_START.length)
	if (endIdx === -1) return false
	const targetIdx = skill.indexOf(target)
	return targetIdx >= startIdx && targetIdx <= endIdx + SLOW_UPDATE_END.length
}

/** Strip slow update markers from text, keeping the content between them. */
export function stripSlowUpdateMarkers(text: string): string {
	return text
		.replace(new RegExp(SLOW_UPDATE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
		.replace(new RegExp(SLOW_UPDATE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
}

/** Inject an empty slow update field into a skill (if not already present). */
export function injectEmptySlowUpdateField(skill: string): string {
	if (skill.includes(SLOW_UPDATE_START)) return skill
	// Insert at the end, before any trailing whitespace
	const trimmed = skill.trimEnd()
	return `${trimmed}\n\n${SLOW_UPDATE_START}\n<!-- Strategic guidance updated at epoch boundaries -->\n${SLOW_UPDATE_END}\n`
}

/** Extract the content of the slow update field (without markers). */
export function extractSlowUpdateField(skill: string): string {
	const startIdx = skill.indexOf(SLOW_UPDATE_START)
	if (startIdx === -1) return ""
	const contentStart = startIdx + SLOW_UPDATE_START.length
	const endIdx = skill.indexOf(SLOW_UPDATE_END, contentStart)
	if (endIdx === -1) return ""
	return skill.slice(contentStart, endIdx).trim()
}

/** Strip all slow update fields from a skill (markers + content). */
export function stripAllSlowUpdateFields(skill: string): string {
	return skill
		.replace(
			new RegExp(
				`${SLOW_UPDATE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${SLOW_UPDATE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
				"g",
			),
			"",
		)
		.trim()
}

/** Replace the slow update field content (preserving markers). */
export function replaceSlowUpdateField(skill: string, newContent: string): string {
	const startIdx = skill.indexOf(SLOW_UPDATE_START)
	if (startIdx === -1) {
		// No existing field, inject one with the provided content
		const trimmed = skill.trimEnd()
		return `${trimmed}\n\n${SLOW_UPDATE_START}\n${newContent.trim()}\n${SLOW_UPDATE_END}\n`
	}
	const contentStart = startIdx + SLOW_UPDATE_START.length
	const endIdx = skill.indexOf(SLOW_UPDATE_END, contentStart)
	if (endIdx === -1) return skill

	return skill.slice(0, contentStart) + "\n" + newContent.trim() + "\n" + skill.slice(endIdx)
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit application
// ─────────────────────────────────────────────────────────────────────────────

/** Parse an edit into its field components. */
export function editFields(edit: Edit): { op: string; search: string; replace: string } {
	return { op: edit.op, search: edit.search, replace: edit.replace }
}

/**
 * Apply a single edit to a skill document with a report.
 * Returns [newSkill, report] where report contains metadata about the edit.
 */
export function applyEditWithReport(skill: string, edit: Edit): [string, Record<string, unknown>] {
	const report: Record<string, unknown> = {
		op: edit.op,
		applied: false,
		reason: "",
	}

	switch (edit.op) {
		case "replace": {
			const idx = skill.indexOf(edit.search)
			if (idx === -1) {
				report.reason = `Search string not found: "${edit.search.slice(0, 50)}..."`
				return [skill, report]
			}
			const newSkill = skill.slice(0, idx) + edit.replace + skill.slice(idx + edit.search.length)
			report.applied = true
			report.position = idx
			return [newSkill, report]
		}

		case "insert": {
			const idx = skill.indexOf(edit.search)
			if (idx === -1) {
				// If search not found, append at end
				const newSkill = skill + "\n" + edit.replace
				report.applied = true
				report.position = skill.length
				report.reason = "Insertion point not found, appended at end"
				return [newSkill, report]
			}
			const newSkill = skill.slice(0, idx) + edit.replace + "\n" + skill.slice(idx)
			report.applied = true
			report.position = idx
			return [newSkill, report]
		}

		case "delete": {
			const idx = skill.indexOf(edit.search)
			if (idx === -1) {
				report.reason = `Search string not found: "${edit.search.slice(0, 50)}..."`
				return [skill, report]
			}
			const newSkill = skill.slice(0, idx) + skill.slice(idx + edit.search.length)
			report.applied = true
			report.position = idx
			return [newSkill, report]
		}

		default:
			report.reason = `Unknown op: ${edit.op}`
			return [skill, report]
	}
}

/**
 * Apply a single edit to a skill document.
 * Simpler interface — returns just the new skill or original if edit fails.
 */
export function applyEdit(skill: string, edit: Edit): string {
	const [newSkill, report] = applyEditWithReport(skill, edit)
	return report.applied ? newSkill : skill
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply a patch (multiple edits) to a skill document with per-edit reports.
 * Edits that target slow update regions are skipped with a warning.
 */
export function applyPatchWithReport(skill: string, patch: Patch): [string, Array<Record<string, unknown>>] {
	let current = skill
	const reports: Array<Record<string, unknown>> = []

	for (const edit of patch.edits) {
		// Skip edits targeting slow update regions
		if (isInSlowUpdateRegion(current, edit.search)) {
			reports.push({
				op: edit.op,
				applied: false,
				reason: "Target is inside slow update region — skipped",
				edit,
			})
			continue
		}

		const [newSkill, report] = applyEditWithReport(current, edit)
		report.edit = edit
		reports.push(report)
		if (report.applied) {
			current = newSkill
		}
	}

	return [current, reports]
}

/**
 * Apply a patch to a skill document.
 * Simpler interface — returns just the new skill.
 */
export function applyPatch(skill: string, patch: Patch): string {
	const [newSkill] = applyPatchWithReport(skill, patch)
	return newSkill
}
