/**
 * Telegram Intent Classifier
 *
 * LLM-powered intent classification for the SuperRoo Telegram assistant.
 * Replaces the keyword-based detectIntent() with structured JSON classification
 * using the existing dashboard-configured AI providers.
 *
 * Inspired by OpenClaw's approach: uses a senior-engineer LLM prompt to convert
 * user messages into structured intents with confidence scores.
 *
 * Allowed kinds: chat, debug_plan, read_logs, run_tests, create_branch,
 *                create_pr, restart_worker, deploy, delete_data, shell,
 *                upgrade_self, commit_status
 *
 * @module telegramClassifier
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClassifiedIntent
 * @property {string} kind - Intent kind (chat, debug_plan, read_logs, etc.)
 * @property {string} [project] - Optional project/workspace name
 * @property {string} [target] - Optional target (worker name, service, etc.)
 * @property {string} message - Original user message
 * @property {number} confidence - Confidence score 0-1
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Timeout for LLM classification call (ms) */
const CLASSIFIER_TIMEOUT_MS = 120_000

/** Minimum confidence to accept LLM classification */
const MIN_CONFIDENCE = 0.3

// ─── Keyword Fallback ───────────────────────────────────────────────────────

/**
 * Fast-path keyword-based intent detection (fallback when LLM is unavailable).
 * Mirrors the existing detectIntent() in telegramBot.js but maps to OpenClaw kinds.
 *
 * @param {string} text - User message
 * @returns {string} Intent kind
 */
function keywordFallback(text) {
	var lower = text.toLowerCase()

	// Upgrade / Improve Self — route to Coder agent for self-modification
	if (
		lower.includes("upgrade yourself") ||
		lower.includes("upgrade you") ||
		lower.includes("improve yourself") ||
		lower.includes("improve you") ||
		lower.includes("make yourself smarter") ||
		lower.includes("upgrade yourself") ||
		lower.includes("self upgrade") ||
		lower.includes("self improve") ||
		lower.includes("make you better") ||
		lower.includes("upgrade the bot") ||
		lower.includes("improve the bot") ||
		lower.includes("make the bot smarter") ||
		lower.includes("upgrade your") ||
		lower.includes("improve your") ||
		lower.includes("coder to upgrade you") ||
		lower.includes("coder to improve you") ||
		lower.includes("ask coder to upgrade") ||
		lower.includes("ask coder to improve")
	) {
		return "upgrade_self"
	}

	// Commit / Deploy Status — query the CommitDeployLog
	if (
		lower.includes("commit status") ||
		lower.includes("deploy status") ||
		lower.includes("latest commit") ||
		lower.includes("latest deploy") ||
		lower.includes("is it deployed") ||
		lower.includes("last commit") ||
		lower.includes("last deploy") ||
		lower.includes("commit log") ||
		lower.includes("deploy log") ||
		lower.includes("what was deployed") ||
		lower.includes("what was committed") ||
		lower.includes("show commits") ||
		lower.includes("show deploys") ||
		lower.includes("recent commits") ||
		lower.includes("recent deploys") ||
		lower.includes("deployment history") ||
		lower.includes("commit history")
	) {
		return "commit_status"
	}

	// Consultant / research
	if (
		lower.includes("research") ||
		lower.includes("analyze") ||
		lower.includes("analysis") ||
		lower.includes("compare") ||
		lower.includes("recommend") ||
		lower.includes("what is") ||
		lower.includes("explain") ||
		lower.includes("tell me about") ||
		lower.includes("advise") ||
		lower.includes("architecture") ||
		lower.includes("best practice")
	) {
		return "chat"
	}

	// Debugging
	if (
		lower.includes("debug") ||
		lower.includes("fix bug") ||
		lower.includes("error") ||
		lower.includes("issue") ||
		lower.includes("not working") ||
		lower.includes("broken") ||
		lower.includes("crash") ||
		lower.includes("bug")
	) {
		return "debug_plan"
	}

	// Read logs
	if (
		lower.includes("log") ||
		lower.includes("logs") ||
		lower.includes("show log") ||
		lower.includes("view log") ||
		lower.includes("check log") ||
		lower.includes("recent log")
	) {
		return "read_logs"
	}

	// Testing — require explicit action phrases, not bare "test" (too broad for casual chat)
	if (
		lower.includes("run test") ||
		lower.includes("run the test") ||
		lower.includes("run tests") ||
		lower.includes("run e2e") ||
		lower.includes("run suite") ||
		lower.includes("execute test") ||
		lower.includes("unit test") ||
		lower.includes("vitest")
	) {
		return "run_tests"
	}

	// Create branch
	if (
		lower.includes("create branch") ||
		lower.includes("new branch") ||
		lower.includes("checkout branch") ||
		lower.includes("git branch")
	) {
		return "create_branch"
	}

	// Create PR
	if (
		lower.includes("create pr") ||
		lower.includes("create a pr") ||
		lower.includes("pull request") ||
		lower.includes("open pr") ||
		lower.includes("new pr") ||
		lower.includes("make pr")
	) {
		return "create_pr"
	}

	// Restart worker
	if (
		lower.includes("restart") ||
		lower.includes("reboot") ||
		lower.includes("reload") ||
		lower.includes("start worker") ||
		lower.includes("stop worker")
	) {
		return "restart_worker"
	}

	// Deploy
	if (
		lower.includes("deploy") ||
		lower.includes("release") ||
		lower.includes("publish") ||
		lower.includes("ship") ||
		lower.includes("go live")
	) {
		return "deploy"
	}

	// Delete data
	if (
		lower.includes("delete") ||
		lower.includes("remove") ||
		lower.includes("destroy") ||
		lower.includes("erase") ||
		lower.includes("clear data") ||
		lower.includes("drop")
	) {
		return "delete_data"
	}

	// Shell
	if (
		lower.includes("shell") ||
		lower.includes("terminal") ||
		lower.includes("command") ||
		lower.includes("run ") ||
		lower.includes("execute") ||
		lower.includes("bash") ||
		lower.includes("sh ")
	) {
		return "shell"
	}

	// Default: chat
	return "chat"
}

// ─── LLM Classifier ─────────────────────────────────────────────────────────

/**
 * Builds the system prompt for the LLM intent classifier.
 * Instructs the model to return structured JSON with kind/project/target/message/confidence.
 *
 * @returns {string} System prompt
 */
function buildClassifierPrompt() {
	return (
		"You are SuperRoo Telegram Assistant, a senior engineer dispatcher.\n" +
		"Convert the user's Telegram message into one JSON object only.\n" +
		"Allowed kind values: chat, debug_plan, read_logs, run_tests, create_branch, create_pr, restart_worker, deploy, delete_data, shell, upgrade_self, commit_status.\n" +
		"Prefer safe engineering actions. For destructive or broad commands choose deploy/delete_data/shell only when explicitly asked.\n" +
		"For normal coding/debugging, choose debug_plan/read_logs/run_tests/create_branch/create_pr/restart_worker.\n" +
		"IMPORTANT: If the message starts with '[Quoted message:' it means the user is REPLYING to a previous bot message. Treat this as a follow-up question (kind: chat) unless the reply explicitly contains a new command.\n" +
		"SPECIAL INTENTS:\n" +
		"- upgrade_self: When the user asks to upgrade, improve, or make the bot/assistant smarter. This includes phrases like 'upgrade yourself', 'improve yourself', 'make yourself smarter', 'coder to upgrade you'. Route to upgrade_self.\n" +
		"- commit_status: When the user asks about commit history, deploy status, latest commits/deploys, or deployment history. Route to commit_status.\n" +
		"Return compact JSON with: kind, project, target, message, confidence.\n" +
		"confidence is a number between 0 and 1 indicating how sure you are."
	)
}

/**
 * Classifies a user message into a structured intent using the LLM.
 * Falls back to keyword-based detection if the LLM is unavailable or times out.
 *
 * @param {string} text - The user's message
 * @param {Array} providers - Array of AI provider configs (same format as askAI uses)
 * @returns {Promise<ClassifiedIntent>} Classified intent
 */
async function classifyIntent(text, providers) {
	// Try LLM classification first
	if (providers && providers.length > 0) {
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
							{ role: "system", content: buildClassifierPrompt() },
							{ role: "user", content: text },
						],
						max_tokens: 256,
						temperature: 0.1,
						response_format: { type: "json_object" },
					}),
					signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
				})
				if (!res.ok) {
					console.error("[classifier] LLM error from " + provider.providerId + ": " + res.status)
					continue
				}
				var data = await res.json()
				var content = data.choices[0]?.message?.content || "{}"
				var parsed = JSON.parse(content)

				var intent = {
					kind: parsed.kind || "chat",
					project: parsed.project || undefined,
					target: parsed.target || undefined,
					message: parsed.message || text,
					confidence: Number(parsed.confidence || 0.5),
				}

				// Validate kind is in allowed list
				var allowedKinds = [
					"chat",
					"debug_plan",
					"read_logs",
					"run_tests",
					"create_branch",
					"create_pr",
					"restart_worker",
					"deploy",
					"delete_data",
					"shell",
					"upgrade_self",
					"commit_status",
				]
				if (allowedKinds.indexOf(intent.kind) === -1) {
					intent.kind = "chat"
					intent.confidence = 0.3
				}

				// Only accept if confidence is high enough
				if (intent.confidence >= MIN_CONFIDENCE) {
					console.log(
						"[classifier] LLM classified '" +
							text.slice(0, 60) +
							"' as " +
							intent.kind +
							" (confidence: " +
							intent.confidence.toFixed(2) +
							")",
					)
					return intent
				}
			} catch (err) {
				console.error("[classifier] LLM error with " + (provider.providerId || "unknown") + ": " + err.message)
				continue
			}
		}
	}

	// Fallback to keyword-based detection
	var fallbackKind = keywordFallback(text)
	console.log("[classifier] Keyword fallback for '" + text.slice(0, 60) + "' as " + fallbackKind)
	return {
		kind: fallbackKind,
		message: text,
		confidence: 0.5,
	}
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
	classifyIntent,
	keywordFallback,
	buildClassifierPrompt,
}
