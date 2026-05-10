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
		"Focus on actionable information: what happened, what was done, what's next."
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
					lines.push("• *" + key + "*: " + JSON.stringify(val).slice(0, 100))
				} else {
					lines.push("• *" + key + "*: " + String(val).slice(0, 100))
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
		lines.push("• Incident: `" + result.incidentId + "`")
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
				lines.push("• `" + log.slice(0, 150) + "`")
				count++
			}
		}
		if (result.logs.length > maxLines) {
			lines.push("• *+" + (result.logs.length - maxLines) + " more lines*")
		}
	}
	if (result.target) {
		lines.push("\nSource: `" + result.target + "`")
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
		lines.push("• Command: `" + result.command + "`")
	}
	if (result.summary) {
		lines.push("• " + result.summary)
	}
	if (result.output) {
		var output = String(result.output).slice(0, 300)
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
		lines.push("• Branch: `" + result.branch + "`")
	}
	if (result.baseBranch) {
		lines.push("• Base: `" + result.baseBranch + "`")
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
		lines.push("• Number: `#" + result.prNumber + "`")
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
		lines.push("• Worker: `" + result.restarted + "`")
	}
	if (result.message) {
		lines.push("• " + result.message)
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
}
