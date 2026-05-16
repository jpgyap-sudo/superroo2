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
	"coder",
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
		coder: "💻 Code",
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

/**
 * Returns an inline keyboard with Approve/Deny buttons for a blocked action.
 * The callback data encodes the action kind and a unique request ID so the
 * handler can retrieve the original context when the user taps a button.
 *
 * @param {string} kind - The action kind (deploy, delete_data, shell)
 * @param {string} requestId - Unique ID for this approval request
 * @returns {Array} Array of button rows for sendInlineKeyboard
 */
function getApprovalKeyboard(kind, requestId) {
	var label = getActionLabel(kind)
	return [
		[
			{ text: "✅ Approve " + label, callback_data: "approve_action:" + kind + ":" + requestId },
			{ text: "❌ Deny", callback_data: "deny_action:" + kind + ":" + requestId },
		],
		[{ text: "📊 Dashboard", url: "https://dev.abcx124.xyz" }],
	]
}

/**
 * Returns contextual inline keyboard buttons based on the current context.
 * This is the centralized button factory for all Telegram GUI interactions.
 *
 * @param {string} context - The context name (e.g., "logs", "tests", "restart", "status", "about", "history", "code_error", "deploy_error", "no_project", "error")
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.taskId] - Task ID for task-specific buttons
 * @param {string} [options.target] - Target worker or project name
 * @param {boolean} [options.showStatus] - Show status button
 * @param {boolean} [options.showLogs] - Show logs button
 * @param {boolean} [options.showRetry] - Show retry button
 * @param {boolean} [options.showDashboard] - Show dashboard button
 * @param {boolean} [options.showTaskBoard] - Show task board button
 * @param {boolean} [options.showHelp] - Show help button
 * @param {boolean} [options.showProjects] - Show projects button
 * @param {boolean} [options.showOTP] - Show OTP setup button
 * @param {boolean} [options.showExamples] - Show examples button
 * @param {boolean} [options.showCode] - Show /code button
 * @returns {Array} Array of button rows for sendInlineKeyboard
 */
function getContextualButtons(context, options) {
	options = options || {}
	var buttons = []

	switch (context) {
		case "logs":
			buttons.push([
				{ text: "🔄 Refresh Logs", callback_data: "quick:logs:" + (options.target || "all") },
				{ text: "📊 Status", callback_data: "quick:status" },
			])
			buttons.push([
				{ text: "🔧 Restart Worker", callback_data: "quick:restart:" + (options.target || "superroo-api") },
			])
			break

		case "tests":
			buttons.push([
				{ text: "🔄 Run Again", callback_data: "quick:tests:" + (options.target || "") },
				{ text: "📊 Status", callback_data: "quick:status" },
			])
			break

		case "restart":
			buttons.push([
				{ text: "📊 Status", callback_data: "quick:status" },
				{ text: "📋 Logs", callback_data: "quick:logs:" + (options.target || "superroo-api") },
			])
			break

		case "status":
			buttons.push([
				{ text: "📋 Task Board", callback_data: "taskboard:list" },
				{ text: "📊 Dashboard", url: "https://dev.abcx124.xyz" },
			])
			buttons.push([
				{ text: "💻 New Code Task", callback_data: "quick:code" },
				{ text: "❓ Help", callback_data: "quick:help" },
			])
			break

		case "task_status":
			buttons.push([
				{ text: "🔄 Refresh", callback_data: "quick:status:" + (options.taskId || "") },
				{ text: "📋 Task Board", callback_data: "taskboard:list" },
			])
			if (options.taskId) {
				buttons.push([{ text: "📊 View Diff", callback_data: "notify:diff:" + options.taskId }])
			}
			break

		case "about":
			buttons.push([
				{ text: "❓ Help", callback_data: "quick:help" },
				{ text: "📊 Dashboard", url: "https://dev.abcx124.xyz" },
			])
			buttons.push([{ text: "💻 New Code Task", callback_data: "quick:code" }])
			break

		case "history":
			buttons.push([
				{ text: "💬 Ask Question", callback_data: "quick:ask" },
				{ text: "📊 Status", callback_data: "quick:status" },
			])
			break

		case "code_error":
			buttons.push([
				{ text: "📋 Examples", callback_data: "quick:examples" },
				{ text: "❓ Help", callback_data: "quick:help" },
			])
			break

		case "deploy_error":
			buttons.push([
				{ text: "🔐 Setup OTP", callback_data: "quick:otp" },
				{ text: "📊 Status", callback_data: "quick:status" },
			])
			if (options.taskId) {
				buttons.push([{ text: "📋 My Tasks", callback_data: "taskboard:list" }])
			}
			break

		case "no_project":
			buttons.push([
				{ text: "📁 View Projects", callback_data: "quick:projects" },
				{ text: "❓ Help", callback_data: "quick:help" },
			])
			break

		case "error":
			buttons.push([
				{ text: "🔄 Retry", callback_data: "quick:retry:" + (options.lastCommand || "") },
				{ text: "📊 Status", callback_data: "quick:status" },
			])
			buttons.push([{ text: "❓ Help", callback_data: "quick:help" }])
			break

		default:
			// Generic buttons based on options
			if (options.showStatus) {
				buttons.push([{ text: "📊 Status", callback_data: "quick:status" }])
			}
			if (options.showLogs) {
				buttons.push([{ text: "📋 Logs", callback_data: "quick:logs:" + (options.target || "all") }])
			}
			if (options.showRetry) {
				buttons.push([{ text: "🔄 Retry", callback_data: "quick:retry:" + (options.lastCommand || "") }])
			}
			if (options.showDashboard) {
				buttons.push([{ text: "📊 Dashboard", url: "https://dev.abcx124.xyz" }])
			}
			if (options.showTaskBoard) {
				buttons.push([{ text: "📋 Task Board", callback_data: "taskboard:list" }])
			}
			if (options.showHelp) {
				buttons.push([{ text: "❓ Help", callback_data: "quick:help" }])
			}
			if (options.showProjects) {
				buttons.push([{ text: "📁 Projects", callback_data: "quick:projects" }])
			}
			if (options.showOTP) {
				buttons.push([{ text: "🔐 Setup OTP", callback_data: "quick:otp" }])
			}
			if (options.showExamples) {
				buttons.push([{ text: "📋 Examples", callback_data: "quick:examples" }])
			}
			if (options.showCode) {
				buttons.push([{ text: "💻 New Code Task", callback_data: "quick:code" }])
			}
			break
	}

	return buttons
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	canRunWithoutApproval,
	isBlocked,
	getBlockedReason,
	getActionLabel,
	getApprovalKeyboard,
	getContextualButtons,
}
