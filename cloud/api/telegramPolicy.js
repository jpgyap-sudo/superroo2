/**
 * Telegram Safety Policy Engine
 *
 * Determines which actions can run without approval vs. which require
 * dashboard approval. Inspired by OpenClaw's policy.ts pattern.
 *
 * Safe actions (no approval needed):
 *   chat, debug_plan, read_logs, run_tests, create_branch, create_pr, restart_worker
 *   + read-only shell commands (version, status, ps, df, etc.)
 *
 * Always blocked (require dashboard approval):
 *   deploy, delete_data, shell (destructive/write)
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
 * Dashboard URL for redirecting users to approve blocked actions.
 */
var dashboardUrl = process.env.DASHBOARD_URL || "https://superroo.app"

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
	"code_task",
	"feature_query",
	"commit_status",
	"upgrade_self",
])

/**
 * Set of action kinds that are always blocked without manual override.
 * These require dashboard approval flow.
 */
var blockedActions = new Set(["deploy", "delete_data", "shell"])

/**
 * Regex patterns for read-only shell commands that are safe to run
 * without dashboard approval. These only query state, never modify it.
 */
var safeShellPatterns = [
	// version checks
	/\b(--version|-v|--version)\b/,
	/\bversion\b/,
	// process / system status
	/\b(ps|top|htop|uptime|whoami|id|uname|pwd|env|hostname)\b/,
	// disk / memory
	/\b(df|du|free)\b/,
	// listing / reading
	/\b(ls|ll|cat|less|more|head|tail|grep|find)\b/,
	// service status only (not start/stop/restart)
	/\b(systemctl\s+status|service\s+\w+\s+status)\b/,
	// container read-only
	/\b(docker\s+ps|docker\s+images|docker\s+logs|docker\s+inspect|docker\s+version)\b/,
	// ollama read-only
	/\b(ollama\s+list|ollama\s+ps|ollama\s+--version|ollama\s+version)\b/,
	// network read-only (GET/HEAD only — POST/PUT/PATCH are blocked in dangerousShellPatterns)
	/\b(ping|ip\s+addr|ifconfig|netstat|ss\s+-tuln)\b/,
	/\bcurl\s+(-s\s+)?https?:\/\/\S+\s*$/, // bare curl URL with no flags (read-only GET)
	// package manager read-only
	/\b(apt\s+list|dpkg\s+-l|npm\s+list|pnpm\s+list|pip\s+list)\b/,
]

/**
 * Regex patterns that indicate a shell command is destructive or sensitive.
 * If matched, the command is NOT safe even if it also matches safeShellPatterns.
 */
var dangerousShellPatterns = [
	/\b(rm\s+-rf?|dd\s+|mkfs|fdisk|parted|format)\b/,
	/\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/,
	/\b(sudo\s+|su\s+-)\b/,
	/\b(chmod\s+|chown\s+|chgrp\s+)\b/,
	/\b(systemctl\s+(start|stop|restart|enable|disable)|service\s+\w+\s+(start|stop|restart))\b/,
	/\b(docker\s+(rm|stop|kill|exec|run|pull|push|build|compose\s+down))\b/,
	/\b(ollama\s+(run|pull|push|delete|rm|stop|create))\b/,
	/\b(>|>>|\|\s*tee\s+|wget\s+.*(-O|--output-document))\b/,
	// curl write / execute patterns
	/\bcurl\s+.*((-o|--output|-X\s*(POST|PUT|PATCH|DELETE)|--data|--data-raw|-d\s+|-F\s+))/i,
	/\bcurl\s+.*\|\s*(bash|sh|python|node|perl|ruby)/i, // curl | bash style
	/\b(apt\s+(install|remove|purge|upgrade|dist-upgrade)|dpkg\s+-i|npm\s+install|pnpm\s+install)\b/,
	/\b(git\s+(push|force|reset|revert|checkout\s+-f|clean\s+-f))\b/,
	/\b(ssh\s+|scp\s+|rsync\s+|sftp\s+)\b/,
]

// ─── Policy Functions ───────────────────────────────────────────────────────

/**
 * Checks whether a shell command text appears to be read-only / safe.
 * Returns false if the command matches any dangerous pattern.
 *
 * @param {string} commandText - Raw user message / command text
 * @returns {boolean} true if the shell command appears safe
 */
function isSafeShellCommand(commandText) {
	if (!commandText || typeof commandText !== "string") {
		return false
	}
	var lower = commandText.toLowerCase()

	// First: reject anything explicitly dangerous
	for (var i = 0; i < dangerousShellPatterns.length; i++) {
		if (dangerousShellPatterns[i].test(lower)) {
			return false
		}
	}

	// Second: accept if it matches a safe read-only pattern
	for (var j = 0; j < safeShellPatterns.length; j++) {
		if (safeShellPatterns[j].test(lower)) {
			return true
		}
	}

	// Third: reject by default — if we can't prove it's safe, it's not safe
	return false
}

/**
 * Checks whether a given action kind can run without approval.
 *
 * @param {string} kind - The action kind to check
 * @param {string} [commandText] - Optional raw command text for shell intent classification
 * @returns {boolean} true if the action can run without approval
 */
function canRunWithoutApproval(kind, commandText) {
	// Blocked actions are never allowed without manual override,
	// UNLESS it's a read-only shell command.
	if (blockedActions.has(kind)) {
		if (kind === "shell" && isSafeShellCommand(commandText)) {
			return true
		}
		return false
	}

	// If REQUIRE_CODING_APPROVAL is set, even safe actions need approval
	if (requireCodingApproval) {
		return false
	}

	// Allow anything not explicitly blocked — new intent kinds added to the
	// classifier shouldn't silently break by defaulting to blocked.
	return true
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
 * @param {string} [commandText] - Optional raw command text for contextual hints
 * @returns {string} Explanation message
 */
function getBlockedReason(kind, commandText) {
	if (kind === "deploy") {
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Deploy actions can impact live services and require explicit approval.\n\n" +
			"👉 Use the SuperRoo Cloud Dashboard to approve and execute deployments.\n" +
			"Dashboard: " +
			dashboardUrl +
			"/deploy\n\n" +
			"Or run locally:\n" +
			"`ssh root@100.64.175.88 'cd /opt/superroo2 && ./deploy.sh'`"
		)
	}
	if (kind === "delete_data") {
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Data deletion is irreversible and requires explicit approval.\n\n" +
			"👉 Use the SuperRoo Cloud Dashboard to manage data operations.\n" +
			"Dashboard: " +
			dashboardUrl +
			"/settings\n\n" +
			"⚠️ This action cannot be undone."
		)
	}
	if (kind === "shell") {
		var lowerText = (commandText || "").toLowerCase()

		// Detect informational questions mis-routed as shell — give a helpful rephrase tip
		var isInfoQuestion =
			lowerText.startsWith("is there") ||
			lowerText.startsWith("are there") ||
			lowerText.startsWith("what api") ||
			lowerText.startsWith("what endpoint") ||
			lowerText.startsWith("what service") ||
			lowerText.startsWith("what port") ||
			lowerText.includes("api exposed") ||
			lowerText.includes("what routes")

		if (isInfoQuestion) {
			return (
				"*Hmm, that looked like a system query* 🤔\n\n" +
				"I classified your message as a shell command, but it looks like you're asking a question.\n\n" +
				"💡 *Try rephrasing as a plain question:*\n" +
				'  • "is there any api exposed?" → "what APIs does my app expose?"\n' +
				'  • "what services are running?" → just ask it exactly like that\n\n' +
				"Or use `/ask <your question>` to force a direct answer.\n\n" +
				"For actual shell commands, use `/shell <command>` or visit:\n" +
				dashboardUrl +
				"/ide-terminal"
			)
		}

		// Standard shell block — actual command that needs approval
		var rephraseTip = ""
		if (lowerText.includes("run ") && !lowerText.match(/\b(run\s+(test|e2e|suite|deploy))\b/)) {
			rephraseTip =
				'💡 *Tip:* Contains "run" — if you meant tests use "run the tests", for deploy use "deploy to production".\n\n'
		}
		return (
			"*Blocked for Safety* 🚫\n\n" +
			"Shell commands that modify the system require dashboard approval.\n\n" +
			rephraseTip +
			"✅ *Read-only commands are allowed* — just ask:\n" +
			'  • "what processes are running?"\n' +
			'  • "check disk space"\n' +
			'  • "show docker containers"\n\n' +
			"👉 Full shell access via dashboard terminal:\n" +
			dashboardUrl +
			"/ide-terminal"
		)
	}
	return (
		"*Blocked for Safety* 🚫\n\n" +
		"This action requires dashboard approval.\n\n" +
		"👉 Use the SuperRoo Cloud Dashboard to proceed.\n" +
		"Dashboard: " +
		dashboardUrl
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
	isSafeShellCommand,
}
