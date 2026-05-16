/**
 * Approval Engine — evaluates actions/commands against configurable rules
 * and returns a decision: allow, require_approval, or block.
 *
 * Used by the Advanced VPS Settings to gate dangerous operations.
 */

export type ApprovalDecision = "allow" | "require_approval" | "block"

export interface ApprovalRule {
	/** Glob or regex pattern matching the action or command. */
	pattern: string
	/** Risk level assigned to this pattern. */
	risk: "Low" | "Medium" | "High" | "Critical"
	/** Decision override for this rule. */
	decision: ApprovalDecision
	/** Optional max uses per session. */
	maxUses?: number
	/** Optional cost threshold in USD. */
	costThreshold?: number
	/** Optional time window in ms for rate limiting. */
	timeWindowMs?: number
}

export interface ApprovalResult {
	decision: ApprovalDecision
	reason: string
	risk: "Low" | "Medium" | "High" | "Critical"
	matchedRule?: string
}

/**
 * Dangerous command patterns that should always be blocked.
 * These are destructive system-level operations.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; risk: "High" | "Critical"; reason: string }> = [
	{ pattern: /\brm\s+-rf\s+[\/~]\b/, risk: "Critical", reason: "Recursive force delete on root/home" },
	{ pattern: /\bmkfs\b/, risk: "Critical", reason: "Filesystem creation — destructive" },
	{ pattern: /\bdd\s+if=/, risk: "Critical", reason: "Raw disk write — destructive" },
	{ pattern: /\b:\(\)\s*\{.*:\s*:\s*\(\)\s*\{\s*\};\s*\};\s*:\s*\)/, risk: "Critical", reason: "Fork bomb detected" },
	{ pattern: /\bshutdown\b/, risk: "High", reason: "System shutdown" },
	{ pattern: /\breboot\b/, risk: "High", reason: "System reboot" },
	{ pattern: /\bchmod\s+-R\s+777\s+\//, risk: "Critical", reason: "Recursive world-writable on root" },
	{ pattern: /\bpasswd\b/, risk: "High", reason: "Password change" },
	{ pattern: /\buserdel\b/, risk: "High", reason: "User deletion" },
	{ pattern: /\bgroupdel\b/, risk: "High", reason: "Group deletion" },
]

/**
 * Evaluate an action or command against the rules and return a decision.
 *
 * @param input.action - The action name (e.g. "execute.command", "write.file")
 * @param input.command - The actual command string (for command actions)
 * @param input.rules - Custom approval rules from settings
 * @returns ApprovalResult with decision and reason
 */
export function evaluateApproval(input: { action: string; command?: string; rules: ApprovalRule[] }): ApprovalResult {
	const { action, command, rules } = input

	// 1. Check dangerous patterns first (always block)
	if (command) {
		for (const dp of DANGEROUS_PATTERNS) {
			if (dp.pattern.test(command)) {
				return {
					decision: "block",
					reason: dp.reason,
					risk: dp.risk,
					matchedRule: dp.pattern.source,
				}
			}
		}
	}

	// 2. Check custom rules
	for (const rule of rules) {
		const regex = new RegExp(rule.pattern, "i")
		if (regex.test(action) || (command && regex.test(command))) {
			return {
				decision: rule.decision,
				reason: `Matched rule: ${rule.pattern} (risk: ${rule.risk})`,
				risk: rule.risk,
				matchedRule: rule.pattern,
			}
		}
	}

	// 3. Default: allow low-risk, require approval for unknown
	if (action.startsWith("read.") || action === "network.crawl") {
		return { decision: "allow", reason: "Read-only action", risk: "Low" }
	}

	if (action.startsWith("write.") || action.startsWith("execute.")) {
		return { decision: "require_approval", reason: "Write/execute action requires approval", risk: "Medium" }
	}

	if (action.startsWith("deploy.")) {
		return { decision: "require_approval", reason: "Deploy action requires approval", risk: "High" }
	}

	return { decision: "allow", reason: "No matching rules — allowed by default", risk: "Low" }
}

/**
 * Get the list of built-in dangerous patterns (for display in settings UI).
 */
export function getDangerousPatterns(): Array<{ pattern: string; risk: string; reason: string }> {
	return DANGEROUS_PATTERNS.map((dp) => ({
		pattern: dp.pattern.source,
		risk: dp.risk,
		reason: dp.reason,
	}))
}
