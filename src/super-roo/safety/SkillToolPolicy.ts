/**
 * Skill Tool Policy — Security sandboxing for skill tool usage.
 *
 * Defines which tools a skill is allowed to use and validates tool calls
 * against those policies. Inspired by Eclipse Theia's SkillDescription
 * which includes `allowedTools` for security sandboxing.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/skill.ts
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SkillToolPolicy {
	/** Tools this skill is explicitly allowed to use. If undefined, all tools are allowed. */
	allowedTools?: string[]
	/** Tools this skill is explicitly denied from using. Takes precedence over allowedTools. */
	deniedTools?: string[]
}

export interface SkillToolValidationResult {
	allowed: boolean
	reason?: string
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate whether a skill is allowed to use a specific tool.
 *
 * Rules:
 * 1. If `deniedTools` includes the tool, it's denied.
 * 2. If `allowedTools` is defined and doesn't include the tool, it's denied.
 * 3. If `allowedTools` is undefined (not set), all tools are allowed (except denied).
 * 4. Otherwise, the tool is allowed.
 */
export function validateSkillToolUse(
	policy: SkillToolPolicy | undefined | null,
	toolName: string,
): SkillToolValidationResult {
	if (!policy) {
		return { allowed: true }
	}

	// Check denied tools first (takes precedence)
	if (policy.deniedTools && policy.deniedTools.includes(toolName)) {
		return {
			allowed: false,
			reason: `Tool "${toolName}" is in the skill's deniedTools list`,
		}
	}

	// Check allowed tools
	if (policy.allowedTools && !policy.allowedTools.includes(toolName)) {
		return {
			allowed: false,
			reason: `Tool "${toolName}" is not in the skill's allowedTools list`,
		}
	}

	return { allowed: true }
}

/**
 * Validate multiple tool policies against a tool name.
 * Returns the first denial found, or allowed if all pass.
 */
export function validateSkillToolUseMulti(
	policies: Array<SkillToolPolicy | undefined | null>,
	toolName: string,
): SkillToolValidationResult {
	for (const policy of policies) {
		const result = validateSkillToolUse(policy, toolName)
		if (!result.allowed) return result
	}
	return { allowed: true }
}
