/**
 * Telegram Senior Engineer Reply Summarizer
 *
 * Takes raw backend JSON results and summarizes them into Telegram-friendly
 * markdown responses. Uses the existing dashboard-configured AI providers
 * with a senior engineer persona.
 *
 * Inspired by OpenClaw's seniorEngineerReply() pattern.
 *
 * @module telegramEngineer
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Timeout for LLM summarization call (ms) */
const SUMMARIZER_TIMEOUT_MS = 30_000

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sanitizes a string for use inside Telegram markdown backticks.
 * Replaces any backtick characters to prevent markdown parsing errors.
 *
 * @param {string} str - The string to sanitize
 * @returns {string} Sanitized string safe for inline code
 */
function sanitizeForCode(str) {
	return String(str).replace(/`/g, "'").replace(/\*/g, "·")
}

/**
 * Sanitizes a string for use inside Telegram markdown code blocks (```).
 * Ensures the string doesn't contain the closing triple-backtick sequence.
 *
 * @param {string} str - The string to sanitize
 * @returns {string} Sanitized string safe for code blocks
 */
function sanitizeForCodeBlock(str) {
	return String(str).replace(/```/g, "'''")
}

// ─── Summarization ──────────────────────────────────────────────────────────

/**
 * Builds the system prompt for the senior engineer summarizer.
 *
 * @returns {string} System prompt
 */
function buildSummarizerPrompt() {
	return (
		"Act like a senior engineer debugger. Be concise, phased, practical, and Telegram-friendly.\n" +
		"Format your response for Telegram markdown.\n" +
		"Use bullet points (max 6).\n" +
		"Keep each bullet under 200 characters.\n" +
		"Total response must be under 1000 characters.\n" +
		"Use emoji indicators where appropriate.\n" +
		"Focus on actionable information: what happened, what was done, what's next.\n" +
		"IMPORTANT: Ensure all markdown is valid. Every *bold* and `code` must be properly closed."
	)
}

/**
 * Summarizes a raw backend result into a Telegram-friendly markdown response.
 * Uses the LLM with a senior engineer persona.
 *
 * @param {string} input - The text to summarize (backend JSON, logs, etc.)
 * @param {Array} providers - Array of AI provider configs
 * @returns {Promise<string>} Summarized Telegram-friendly response
 */
async function seniorEngineerReply(input, providers) {
	if (!providers || providers.length === 0) {
		return formatFallback(input)
	}

	for (var i = 0; i < providers.length; i++) {
		var provider = providers[i]
		if (!provider.apiKey) continue
		try {
			var url = (provider.apiBaseUrl || "").replace(/\/+$/, "") + "/chat/completions"
			var res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + provider.apiKey,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: [
						{ role: "system", content: buildSummarizerPrompt() },
						{ role: "user", content: input },
					],
					max_tokens: 512,
					temperature: 0.2,
				}),
				signal: AbortSignal.timeout(SUMMARIZER_TIMEOUT_MS),
			})
			if (!res.ok) {
				console.error("[engineer] LLM error from " + provider.providerId + ": " + res.status)
				continue
			}
			var data = await res.json()
			var reply = data.choices[0]?.message?.content || ""
			if (reply.trim()) {
				return reply
			}
		} catch (err) {
			console.error("[engineer] LLM error with " + (provider.providerId || "unknown") + ": " + err.message)
			continue
		}
	}

	// Fallback: format without LLM
	return formatFallback(input)
}

/**
 * Fallback formatting when LLM is unavailable.
 * Converts JSON to a simple bullet list.
 *
 * @param {string} input - Raw text to format
 * @returns {string} Formatted response
 */
function formatFallback(input) {
	// Try to parse as JSON and format nicely
	try {
		var parsed = JSON.parse(input)
		var lines = []
		for (var key in parsed) {
			if (Object.prototype.hasOwnProperty.call(parsed, key)) {
				var val = parsed[key]
				if (typeof val === "object" && val !== null) {
					lines.push("• *" + key + "*: " + sanitizeForCode(JSON.stringify(val).slice(0, 100)))
				} else {
					lines.push("• *" + key + "*: " + sanitizeForCode(String(val).slice(0, 100)))
				}
			}
		}
		if (lines.length > 0) {
			return lines.join("\n")
		}
	} catch (e) {
		// Not JSON, use as-is
	}

	// Truncate long responses
	if (input.length > 1000) {
		return input.slice(0, 997) + "..."
	}
	return input
}

/**
 * Formats a debug plan result into a Telegram-friendly message.
 *
 * @param {Object} result - Debug plan result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatDebugPlan(result) {
	var lines = ["*🔍 Debug Plan Created*"]
	if (result.incidentId) {
		lines.push("• Incident: `" + sanitizeForCode(result.incidentId) + "`")
	}
	if (result.phases && Array.isArray(result.phases)) {
		for (var i = 0; i < result.phases.length; i++) {
			lines.push("• " + (i + 1) + ". " + result.phases[i])
		}
	}
	return lines.join("\n")
}

/**
 * Formats a logs result into a Telegram-friendly message.
 * Uses code blocks instead of inline code to avoid markdown issues with log content.
 *
 * @param {Object} result - Logs result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatLogsResult(result) {
	var lines = ["*📋 Log Results*"]
	if (result.logs && Array.isArray(result.logs)) {
		var maxLines = 10
		var count = 0
		for (var i = 0; i < result.logs.length && count < maxLines; i++) {
			var log = result.logs[i]
			if (typeof log === "string") {
				// Use code block for log lines to avoid markdown parsing issues
				lines.push("• `" + sanitizeForCode(log.slice(0, 150)) + "`")
				count++
			}
		}
		if (result.logs.length > maxLines) {
			lines.push("• *+" + (result.logs.length - maxLines) + " more lines*")
		}
	}
	if (result.target) {
		lines.push("\nSource: `" + sanitizeForCode(result.target) + "`")
	}
	return lines.join("\n")
}

/**
 * Formats a test result into a Telegram-friendly message.
 *
 * @param {Object} result - Test result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatTestResult(result) {
	var status = result.passed ? "✅ *Tests Passed*" : "❌ *Tests Failed*"
	var lines = [status]
	if (result.command) {
		lines.push("• Command: `" + sanitizeForCode(result.command) + "`")
	}
	if (result.summary) {
		lines.push("• " + result.summary)
	}
	if (result.output) {
		var output = sanitizeForCodeBlock(String(result.output).slice(0, 300))
		lines.push("• Output:\n```\n" + output + "\n```")
	}
	return lines.join("\n")
}

/**
 * Formats a branch creation result into a Telegram-friendly message.
 *
 * @param {Object} result - Branch result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatBranchResult(result) {
	var lines = ["*🌿 Branch Created*"]
	if (result.branch) {
		lines.push("• Branch: `" + sanitizeForCode(result.branch) + "`")
	}
	if (result.baseBranch) {
		lines.push("• Base: `" + sanitizeForCode(result.baseBranch) + "`")
	}
	return lines.join("\n")
}

/**
 * Formats a PR creation result into a Telegram-friendly message.
 *
 * @param {Object} result - PR result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatPrResult(result) {
	var lines = ["*🔀 Pull Request Created*"]
	if (result.prUrl) {
		lines.push("• URL: " + result.prUrl)
	}
	if (result.prNumber) {
		lines.push("• Number: `#" + sanitizeForCode(result.prNumber) + "`")
	}
	if (result.title) {
		lines.push("• Title: " + result.title)
	}
	return lines.join("\n")
}

/**
 * Formats a restart result into a Telegram-friendly message.
 *
 * @param {Object} result - Restart result from tgEndpoints
 * @returns {string} Formatted message
 */
function formatRestartResult(result) {
	var status = result.ok ? "✅ *Worker Restarted*" : "❌ *Restart Failed*"
	var lines = [status]
	if (result.restarted) {
		lines.push("• Worker: `" + sanitizeForCode(result.restarted) + "`")
	}
	if (result.message) {
		lines.push("• " + result.message)
	}
	return lines.join("\n")
}

// ─── Terminal Brain Formatting ──────────────────────────────────────────────

/**
 * Formats a Terminal Brain plan result into a Telegram-friendly message.
 * Shows the intent, confidence, and planned command steps.
 *
 * @param {Object} result - Brain plan result
 * @returns {string} Formatted message
 */
function formatBrainPlan(result) {
	var lines = ["*🧠 Terminal Brain — Plan*"]
	if (result.intent) {
		lines.push("• Intent: `" + sanitizeForCode(result.intent) + "` (confidence: " + (result.confidence || "N/A") + ")")
	}
	if (result.commands && Array.isArray(result.commands)) {
		for (var i = 0; i < result.commands.length; i++) {
			var cmd = result.commands[i]
			var num = i + 1
			if (typeof cmd === "string") {
				lines.push("• `" + num + ".` `" + sanitizeForCode(cmd) + "`")
			} else if (cmd && cmd.command) {
				var desc = cmd.description ? " — " + cmd.description : ""
				lines.push("• `" + num + ".` `" + sanitizeForCode(cmd.command) + "`" + desc)
			}
		}
	}
	if (result.plan && typeof result.plan === "string") {
		lines.push("\n" + result.plan)
	}
	return lines.join("\n")
}

/**
 * Formats a Terminal Brain execution feedback into a Telegram-friendly message.
 * Shows command, exit code, errors found, and fixes suggested.
 *
 * @param {Object} feedback - Brain execution feedback
 * @returns {string} Formatted message
 */
function formatBrainFeedback(feedback) {
	var lines = ["*🧠 Terminal Brain — Result*"]

	if (feedback.command) {
		lines.push("• Command: `" + sanitizeForCode(feedback.command) + "`")
	}
	if (feedback.exitCode !== undefined && feedback.exitCode !== null) {
		var codeIcon = feedback.exitCode === 0 ? "✅" : "❌"
		lines.push("• Exit Code: " + codeIcon + " `" + feedback.exitCode + "`")
	}
	if (feedback.status) {
		var statusIcon = feedback.status === "success" ? "✅" : feedback.status === "failed" ? "❌" : "⚠️"
		lines.push("• Status: " + statusIcon + " " + feedback.status)
	}

	// Show errors found
	if (feedback.errors && feedback.errors.length > 0) {
		lines.push("\n*🔍 Errors Detected:* " + feedback.errors.length)
		for (var i = 0; i < Math.min(feedback.errors.length, 3); i++) {
			var err = feedback.errors[i]
			lines.push("• `" + sanitizeForCode(err.type || "unknown") + "`" + (err.confidence ? " (" + (err.confidence * 100).toFixed(0) + "%)" : ""))
			if (err.message) {
				lines.push("  " + sanitizeForCode(err.message.slice(0, 150)))
			}
		}
		if (feedback.errors.length > 3) {
			lines.push("  *+ " + (feedback.errors.length - 3) + " more errors*")
		}
	}

	// Show fixes suggested
	if (feedback.fixes && feedback.fixes.length > 0) {
		lines.push("\n*🔧 Fixes Suggested:* " + feedback.fixes.length)
		for (var j = 0; j < Math.min(feedback.fixes.length, 3); j++) {
			lines.push("• " + sanitizeForCode(feedback.fixes[j].slice(0, 200)))
		}
		if (feedback.fixes.length > 3) {
			lines.push("  *+ " + (feedback.fixes.length - 3) + " more fixes*")
		}
	}

	// Show output snippet
	if (feedback.output && feedback.output.length > 0) {
		var snippet = feedback.output.slice(0, 300)
		lines.push("\n*Output:*\n```\n" + sanitizeForCodeBlock(snippet) + "\n```")
	}

	return lines.join("\n")
}

/**
 * Formats Terminal Brain memory stats into a Telegram-friendly message.
 *
 * @param {Object} stats - Brain memory stats
 * @returns {string} Formatted message
 */
function formatBrainMemory(stats) {
	var lines = ["*🧠 Terminal Brain — Memory Stats*"]
	if (!stats) return lines.join("\n")

	if (stats.totalSessions !== undefined) lines.push("• Sessions: `" + stats.totalSessions + "`")
	if (stats.totalCommands !== undefined) lines.push("• Commands: `" + stats.totalCommands + "`")
	if (stats.totalErrors !== undefined) lines.push("• Errors: `" + stats.totalErrors + "`")
	if (stats.totalFixes !== undefined) lines.push("• Fixes: `" + stats.totalFixes + "`")
	if (stats.totalDeployments !== undefined) lines.push("• Deployments: `" + stats.totalDeployments + "`")
	if (stats.successRate !== undefined) {
		var rate = (stats.successRate * 100).toFixed(1)
		lines.push("• Success Rate: `" + rate + "%`")
	}

	return lines.join("\n")
}

/**
 * Formats Terminal Brain error analysis into a Telegram-friendly message.
 *
 * @param {Array} errors - Array of error analysis objects
 * @returns {string} Formatted message
 */
function formatBrainErrors(errors) {
	if (!errors || errors.length === 0) {
		return "*🧠 Terminal Brain — No errors detected* ✅"
	}

	var lines = ["*🧠 Terminal Brain — Error Analysis*"]
	for (var i = 0; i < Math.min(errors.length, 5); i++) {
		var err = errors[i]
		var confidence = err.confidence ? " (" + (err.confidence * 100).toFixed(0) + "%)" : ""
		lines.push("\n*" + (i + 1) + ". " + sanitizeForCode(err.type || "unknown") + "*" + confidence)
		if (err.message) lines.push("   " + sanitizeForCode(err.message.slice(0, 200)))
		if (err.rootCause) lines.push("   Root: " + sanitizeForCode(err.rootCause.slice(0, 150)))
		if (err.suggestedFix) lines.push("   Fix: " + sanitizeForCode(err.suggestedFix.slice(0, 200)))
	}
	if (errors.length > 5) {
		lines.push("\n*+ " + (errors.length - 5) + " more errors*")
	}
	return lines.join("\n")
}

/**
 * Formats Terminal Brain project context into a Telegram-friendly message.
 *
 * @param {Object} ctx - Project context
 * @returns {string} Formatted message
 */
function formatBrainContext(ctx) {
	var lines = ["*🧠 Terminal Brain — Project Context*"]
	if (!ctx) return lines.join("\n")

	if (ctx.framework) lines.push("• Framework: `" + sanitizeForCode(ctx.framework) + "`")
	if (ctx.packageManager) lines.push("• Package Manager: `" + sanitizeForCode(ctx.packageManager) + "`")
	if (ctx.nodeVersion) lines.push("• Node: `" + sanitizeForCode(ctx.nodeVersion) + "`")
	if (ctx.port) lines.push("• Port: `" + ctx.port + "`")
	if (ctx.branch) lines.push("• Branch: `" + sanitizeForCode(ctx.branch) + "`")
	if (ctx.hasDocker !== undefined) lines.push("• Docker: " + (ctx.hasDocker ? "✅ Yes" : "❌ No"))
	if (ctx.hasTypeScript !== undefined) lines.push("• TypeScript: " + (ctx.hasTypeScript ? "✅ Yes" : "❌ No"))

	if (ctx.files && ctx.files.length > 0) {
		lines.push("\n*Files:* " + ctx.files.length + " total")
	}

	return lines.join("\n")
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
	seniorEngineerReply,
	formatFallback,
	formatDebugPlan,
	formatLogsResult,
	formatTestResult,
	formatBranchResult,
	formatPrResult,
	formatRestartResult,
	// Terminal Brain formatters
	formatBrainPlan,
	formatBrainFeedback,
	formatBrainMemory,
	formatBrainErrors,
	formatBrainContext,
}
