/**
 * Safety Guard — Command Safety Checker
 *
 * Determines whether a command is safe to auto-run,
 * requires approval, or should be blocked entirely.
 */

import type { SafetyDecision, CommandIntent } from "../../terminal-core/src/types"

// ─── Destructive Command Patterns ────────────────────────────────────────

const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\s+-rf\b/i,
	/\bdrop\s+database\b/i,
	/\bdocker\s+system\s+prune\s+-a\b/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+push\s+--force\b/i,
	/\bchmod\s+-R\s+777\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bformat\s+(drive|disk|volume)\b/i,
	/\bdel\s+\/f\s+\/s\b/i, // Windows force delete
	/\brmdir\s+\/s\b/i, // Windows recursive delete
	/\bdocker\s+rm\s+-f\b/i, // Force remove containers
	/\bDROP\s+TABLE\b/i,
	/\bDELETE\s+FROM\b/i,
	/\bTRUNCATE\b/i,
]

// ─── Safe Command Patterns ───────────────────────────────────────────────

const SAFE_PATTERNS: RegExp[] = [
	/^ls\b/,
	/^pwd\b/,
	/^cat\b/,
	/^echo\b/,
	/^pnpm\s+install\b/,
	/^pnpm\s+build\b/,
	/^pnpm\s+test\b/,
	/^pnpm\s+dev\b/,
	/^pnpm\s+lint\b/,
	/^pnpm\s+typecheck\b/,
	/^pnpm\s+format\b/,
	/^npm\s+install\b/,
	/^npm\s+run\s+build\b/,
	/^npm\s+test\b/,
	/^yarn\b/,
	/^docker\s+ps\b/,
	/^docker\s+logs\b/,
	/^docker\s+images\b/,
	/^docker\s+network\s+ls\b/,
	/^docker\s+volume\s+ls\b/,
	/^git\s+status\b/,
	/^git\s+diff\b/,
	/^git\s+log\b/,
	/^git\s+branch\b/,
	/^git\s+checkout\b/,
	/^git\s+pull\b/,
	/^git\s+fetch\b/,
	/^node\s+--version\b/,
	/^pnpm\s+--version\b/,
	/^npm\s+--version\b/,
	/^npx\b/,
	/^tsc\b/,
	/^vitest\b/,
	/^jest\b/,
	/^curl\b/,
	/^wget\b/,
	/^ping\b/,
	/^which\b/,
	/^type\b/,
	/^dir\b/,
	/^cd\b/,
	/^mkdir\b/,
]

// ─── Intent-based Safety ─────────────────────────────────────────────────

const INTENT_SAFETY: Record<CommandIntent, "safe" | "approval" | "blocked"> = {
	build: "safe",
	test: "safe",
	dev: "safe",
	install: "safe",
	lint: "safe",
	typecheck: "safe",
	git: "safe",
	docker: "approval", // docker commands beyond ps/logs need approval
	deploy: "approval",
	file_ops: "approval",
	unknown: "approval",
}

// ─── Guard Functions ─────────────────────────────────────────────────────

/**
 * Check if a command is safe to auto-run.
 */
export function isSafeCommand(command: string): boolean {
	const trimmed = command.trim()
	for (const pattern of SAFE_PATTERNS) {
		if (pattern.test(trimmed)) return true
	}
	return false
}

/**
 * Check if a command is destructive and requires approval.
 */
export function isDestructiveCommand(command: string): boolean {
	const trimmed = command.trim()
	for (const pattern of DESTRUCTIVE_PATTERNS) {
		if (pattern.test(trimmed)) return true
	}
	return false
}

/**
 * Make a safety decision for a command.
 */
export function checkCommand(command: string, intent?: CommandIntent): SafetyDecision {
	const trimmed = command.trim()
	if (!trimmed) {
		return { allowed: true, reason: "Empty command", requiresApproval: false }
	}

	// Check destructive patterns first
	if (isDestructiveCommand(trimmed)) {
		return {
			allowed: false,
			reason: `Command matches destructive pattern. Requires explicit approval.`,
			requiresApproval: true,
		}
	}

	// Check safe patterns
	if (isSafeCommand(trimmed)) {
		return { allowed: true, reason: "Command is in safe list", requiresApproval: false }
	}

	// Check by intent
	if (intent && INTENT_SAFETY[intent] === "safe") {
		return { allowed: true, reason: `Intent "${intent}" is safe`, requiresApproval: false }
	}

	if (intent && INTENT_SAFETY[intent] === "approval") {
		return {
			allowed: false,
			reason: `Intent "${intent}" requires approval`,
			requiresApproval: true,
		}
	}

	// Unknown command — require approval
	return {
		allowed: false,
		reason: "Unknown command — requires approval",
		requiresApproval: true,
	}
}

/**
 * Get a human-readable safety summary for a command.
 */
export function getSafetySummary(command: string): string {
	if (isDestructiveCommand(command)) {
		return "⚠️ DESTRUCTIVE — requires explicit approval"
	}
	if (isSafeCommand(command)) {
		return "✅ Safe — auto-run allowed"
	}
	return "❓ Unknown — requires approval"
}
