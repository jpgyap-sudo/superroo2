/**
 * Telegram Safety Policy Engine
 *
 * Determines which actions can run without approval vs. which require
 * dashboard approval. Inspired by OpenClaw's policy.ts pattern.
 *
 * Safe actions (no approval needed):
 *   chat, debug_plan, read_logs, run_tests, create_branch, create_pr, restart_worker
 *
 * Always blocked (require dashboard approval):
 *   deploy, delete_data, shell
 *
 * @module telegramPolicy
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Reads REQUIRE_CODING_APPROVAL from environment.
 * When true, even safe coding actions require approval.
 * Default: false (safe actions run immediately).
 */
var requireCodingApproval = process.env.REQUIRE_CODING_APPROVAL === "true"

/**
 * Set of action kinds that are safe to run without approval.
 */
var safeActions = new Set([
	"chat",
	"debug_plan",
	"read_logs",
	"run_tests",
	"create_branch",
	"create_pr",
	"restart_worker",
])

/**
 * Set of action kinds that are always blocked without manual override.
 * These require dashboard approval flow.
 */
var blockedActions = new Set(["deploy", "delete_data", "shell"])

// ─── Policy Functions ───────────────────────────────────────────────────────

/**
 * Checks whether a given action kind can run without approval.
 *
 * @param {string} kind - The action kind to check
 * @returns {boolean} true if the action can run without approval
 */
function canRunWithoutApproval(kind) {
	// Blocked actions are never allowed without manual override
	if (blockedActions.has(kind)) {
		return false
	}

	// If REQUIRE_CODING_APPROVAL is set, even safe actions need approval
	if (requireCodingApproval) {
		return false
	}

	// Safe actions can run without approval
	return safeActions.has(kind)
}

/**
 * Checks whether an action kind is in the blocked set.
 * Blocked actions are those that could cause data loss, service disruption,
 * or security issues.
 *
 * @param {string} kind - The action kind to check
 * @returns {boolean} true if the action is blocked
 */
function isBlocked(kind) {
	return blockedActions.has(kind)
}

/**
 * Returns a human-readable explanation of why an action was blocked.
 *
 * @param {string} kind - The action kind
 * @returns {string} Explanation message
 */
function getBlockedReason(kind) {
	if (kind === "deploy") {
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Deploy actions require dashboard approval. " +
			"Please use the SuperRoo Cloud Dashboard to approve and execute deployments.\n\n" +
			"Dashboard: https://dev.abcx124.xyz"
		)
	}
	if (kind === "delete_data") {
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Data deletion requires dashboard approval. " +
			"Please use the SuperRoo Cloud Dashboard to manage data operations."
		)
	}
	if (kind === "shell") {
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Shell commands require dashboard approval. " +
			"Please use the SuperRoo Cloud Dashboard for shell operations."
		)
	}
	return (
		"*Blocked for Safety* 🚫\n\n" +
		"This action requires dashboard approval. " +
		"Please use the SuperRoo Cloud Dashboard to proceed."
	)
}

/**
 * Returns a human-readable label for an action kind.
 *
 * @param {string} kind - The action kind
 * @returns {string} Human-readable label
 */
function getActionLabel(kind) {
	var labels = {
		chat: "💬 Chat",
		debug_plan: "🔍 Debug Plan",
		read_logs: "📋 Read Logs",
		run_tests: "🧪 Run Tests",
		create_branch: "🌿 Create Branch",
		create_pr: "🔀 Create PR",
		restart_worker: "🔄 Restart Worker",
		deploy: "🚀 Deploy",
		delete_data: "🗑️ Delete Data",
		shell: "💻 Shell",
	}
	return labels[kind] || "❓ Unknown"
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	canRunWithoutApproval,
	isBlocked,
	getBlockedReason,
	getActionLabel,
}
