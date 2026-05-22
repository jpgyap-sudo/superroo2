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
 *                upgrade_self, commit_status, feature_query
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
const MIN_CONFIDENCE = 0.65

// ─── Keyword Fallback ───────────────────────────────────────────────────────

/**
 * Fast-path keyword-based intent detection (fallback when LLM is unavailable).
 * Mirrors the existing detectIntent() in telegramBot.js but maps to OpenClaw kinds.
 *
 * @param {string} text - User message
 * @param {string} [conversationContext] - Recent conversation summary for follow-up disambiguation
 * @returns {string} Intent kind
 */
function keywordFallback(text, conversationContext) {
	var lower = text.toLowerCase()
	var contextLower = (conversationContext || "").toLowerCase()

	if (isSelfUpgradeRequest(lower)) {
		return "upgrade_self"
	}

	// Follow-up implementation intent after the assistant has just given
	// recommendations. These phrases are common after "what should we improve?"
	// and must create a project coding task, not another chat answer.
	if (isRecommendationImplementationFollowup(lower, contextLower)) {
		return "code_task"
	}

	// ── Early exits: pure informational / contextual questions → always chat ──
	// These must come BEFORE any pattern that could mis-route to shell/deploy.
	if (
		lower.startsWith("is there any") ||
		lower.startsWith("are there any") ||
		lower.startsWith("what app") ||
		lower.startsWith("what project") ||
		lower.startsWith("which app") ||
		lower.startsWith("which project") ||
		lower.startsWith("what are we") ||
		lower.startsWith("what is we") ||
		lower.startsWith("what are the") ||
		lower.startsWith("what is the product") ||
		lower.startsWith("what are the product") ||
		lower.includes("what project are we") ||
		lower.includes("what app are we") ||
		lower.includes("what are we talking about") ||
		lower.includes("which app are we") ||
		lower.includes("which project are we")
	) {
		return "chat"
	}

	// Feature query — questions about the app/project's features, APIs, architecture, or how it works.
	// Catches both SuperRoo-specific questions AND questions about a bound workspace project.
	if (
		lower.includes("what feature") ||
		lower.includes("what features") ||
		lower.includes("feature list") ||
		lower.includes("product feature") ||
		lower.includes("capabilities") ||
		// SuperRoo internals
		lower.includes("what does superroo") ||
		lower.includes("how does superroo") ||
		lower.includes("superroo feature") ||
		lower.includes("what can superroo") ||
		lower.includes("safety mode") ||
		lower.includes("central brain") ||
		lower.includes("agent workflow") ||
		lower.includes("how does ollama") ||
		lower.includes("how does the orchestrator") ||
		lower.includes("what is the orchestrator") ||
		lower.includes("autonomous loop") ||
		lower.includes("deepseek route") ||
		lower.includes("hermes") ||
		lower.includes("memory system") ||
		(lower.includes("how") && lower.includes("work") && lower.includes("superroo")) ||
		(lower.includes("what") && lower.includes("superroo") && lower.includes("do")) ||
		// API / service / route questions (project-agnostic)
		lower.includes("api exposed") ||
		lower.includes("what api") ||
		lower.includes("what apis") ||
		lower.includes("what endpoint") ||
		lower.includes("what endpoints") ||
		lower.includes("what routes") ||
		lower.includes("what services") ||
		lower.includes("what ports") ||
		(lower.includes("is there") && lower.includes("api")) ||
		(lower.includes("are there") && lower.includes("api")) ||
		// "how does X work" / "what is X" questions about the *app* (not general knowledge)
		(lower.includes("how does") &&
			(lower.includes("app") || lower.includes("project") || lower.includes("this"))) ||
		(lower.includes("how does the") &&
			(lower.includes("auth") ||
				lower.includes("payment") ||
				lower.includes("flow") ||
				lower.includes("login") ||
				lower.includes("upload") ||
				lower.includes("queue") ||
				lower.includes("worker"))) ||
		(lower.includes("what is the") &&
			(lower.includes("flow") ||
				lower.includes("architecture") ||
				lower.includes("structure") ||
				lower.includes("stack") ||
				lower.includes("tech stack"))) ||
		(lower.includes("how is") &&
			(lower.includes("built") ||
				lower.includes("structured") ||
				lower.includes("deployed") ||
				lower.includes("hosted")))
	) {
		return "feature_query"
	}

	// Upgrade / Improve Self — route to Coder agent for self-modification
	if (isSelfUpgradeRequest(lower)) {
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

	// Shell — only match explicit shell/terminal intent, not casual use of "run" or "command"
	// "run " is too broad (matches "run tests", "run the deploy", etc.)
	// "command" is too broad (matches "what command", "recommend a command")
	// "execute" is too broad (matches "execute tests", "execute deploy")
	if (
		lower.includes("shell") ||
		lower.includes("open terminal") ||
		lower.includes("run a shell") ||
		lower.includes("run command") ||
		lower.includes("run this command") ||
		lower.includes("execute command") ||
		lower.includes("execute this command") ||
		lower.includes("bash command") ||
		lower.includes("bash shell") ||
		lower.includes("run bash") ||
		lower.includes("run sh") ||
		lower.includes("run a terminal") ||
		lower.includes("use terminal") ||
		lower.includes("use shell") ||
		lower.includes("in terminal") ||
		lower.includes("in shell") ||
		lower.includes("via terminal") ||
		lower.includes("via shell") ||
		lower.includes("through terminal") ||
		lower.includes("through shell")
	) {
		return "shell"
	}

	// Code task — user wants to ADD, IMPLEMENT, CREATE, BUILD, or MODIFY code.
	// Must come LAST (after deploy/delete/shell) so it doesn't swallow those intents.
	// But must come BEFORE the chat default so coding instructions don't become chat.
	if (
		lower.match(
			/^(add|implement|create|build|write|make|develop|refactor|update|change|modify|rename|move|extract|integrate)\s+/,
		) ||
		lower.match(/^(add|create|build|write|make|implement)\s+a\s+/) ||
		lower.includes("implement the") ||
		lower.includes("implement a") ||
		lower.includes("add a button") ||
		lower.includes("add a page") ||
		lower.includes("add a feature") ||
		lower.includes("add a route") ||
		lower.includes("add a function") ||
		lower.includes("add a component") ||
		lower.includes("add a field") ||
		lower.includes("add support for") ||
		lower.includes("add an endpoint") ||
		lower.includes("add an api") ||
		lower.includes("write a function") ||
		lower.includes("write a component") ||
		lower.includes("write a test") ||
		lower.includes("write tests") ||
		lower.includes("create a page") ||
		lower.includes("create a component") ||
		lower.includes("create a function") ||
		lower.includes("create an endpoint") ||
		lower.includes("build a") ||
		lower.includes("refactor the") ||
		lower.includes("refactor this") ||
		lower.includes("update the") ||
		lower.includes("change the") ||
		lower.includes("modify the") ||
		lower.includes("make the") ||
		lower.includes("make it") ||
		lower.includes("make a") ||
		lower.includes("integrate") ||
		lower.includes("wire up") ||
		lower.includes("hook up") ||
		lower.includes("connect the") ||
		(lower.includes("fix") && !lower.includes("fix bug") && lower.match(/fix\s+the\s+\w/))
	) {
		return "code_task"
	}

	// Default: chat
	return "chat"
}

function hasRecommendationContext(contextLower) {
	return (
		contextLower.includes("recommend") ||
		contextLower.includes("recommendation") ||
		contextLower.includes("improvement") ||
		contextLower.includes("suggestion") ||
		contextLower.includes("upgrade plan") ||
		contextLower.includes("roadmap") ||
		contextLower.includes("next step")
	)
}

function isSelfUpgradeRequest(lower) {
	return (
		lower.includes("upgrade yourself") ||
		lower.includes("upgrade you") ||
		lower.includes("improve yourself") ||
		lower.includes("improve you") ||
		lower.includes("make yourself smarter") ||
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
		lower.includes("ask coder to upgrade you") ||
		lower.includes("ask coder to improve you") ||
		lower.includes("ask coder to upgrade the bot") ||
		lower.includes("ask coder to improve the bot") ||
		lower.includes("ask the coder to upgrade you") ||
		lower.includes("ask the coder to improve you") ||
		lower.includes("ask the coder to upgrade the bot") ||
		lower.includes("ask the coder to improve the bot")
	)
}

function isRecommendationImplementationFollowup(lower, contextLower) {
	var hasObject =
		lower.includes("recommendation") ||
		lower.includes("recommendations") ||
		lower.includes("suggestion") ||
		lower.includes("suggestions") ||
		lower.includes("improvement") ||
		lower.includes("improvements") ||
		lower.includes("upgrade") ||
		lower.includes("upgrades") ||
		lower.includes("changes") ||
		lower.includes("those") ||
		lower.includes("these") ||
		lower.includes("that")

	var hasAction =
		lower.includes("ask coder to") ||
		lower.includes("ask the coder to") ||
		lower.includes("coder to") ||
		lower.includes("proceed") ||
		lower.includes("go ahead") ||
		lower.includes("move forward") ||
		lower.includes("implement") ||
		lower.includes("apply") ||
		lower.includes("build") ||
		lower.includes("start")

	if (!hasAction || !hasObject) return false

	// Explicit references to recommendations are enough on their own.
	if (lower.includes("recommendation") || lower.includes("recommendations") || lower.includes("suggestions")) {
		return true
	}

	// Vague follow-ups like "go ahead with those improvements" require recent
	// recommendation context so casual chat is not over-routed to coding.
	return hasRecommendationContext(contextLower)
}

// ─── LLM Classifier ─────────────────────────────────────────────────────────

/**
 * Builds the system prompt for the LLM intent classifier.
 * Instructs the model to return structured JSON with kind/project/target/message/confidence.
 *
 * @param {string} [conversationContext] - Optional recent conversation history for context-aware classification
 * @returns {string} System prompt
 */
function buildClassifierPrompt(conversationContext) {
	var prompt =
		"You are SuperRoo Telegram Assistant, a senior engineer dispatcher.\n" +
		"Convert the user's Telegram message into one JSON object only.\n" +
		"Allowed kind values: chat, debug_plan, read_logs, run_tests, create_branch, create_pr, restart_worker, deploy, delete_data, shell, upgrade_self, commit_status, feature_query, code_task.\n" +
		"Prefer safe engineering actions. For destructive or broad commands choose deploy/delete_data/shell ONLY when the user EXPLICITLY asks to run a terminal command, execute a script, or perform a system operation.\n" +
		"NEVER use shell/deploy/delete_data for informational questions. Questions like 'is there any api', 'what apis are exposed', 'what services run', 'what project are we in', 'are there any endpoints' → use feature_query or chat.\n" +
		"SPECIAL INTENTS:\n" +
		"- code_task: Use when the user wants to ADD, IMPLEMENT, CREATE, BUILD, WRITE, MAKE, DEVELOP, REFACTOR, UPDATE, MODIFY, or CHANGE code. Examples: 'add a login page', 'implement auth', 'create a button', 'build the checkout flow', 'refactor the API', 'write a function to X', 'improve on data accuracy and quality'. This is the PRIMARY coding intent.\n" +
		"- code_task: Also use for follow-ups after recommendations, such as 'ask coder to proceed', 'ask coder to implement the recommendations', 'proceed with those improvements', 'go ahead with the suggested upgrades', or 'apply those changes'. Use recent context to include the prior recommendations.\n" +
		"- feature_query: Use for ANY question about what the app does, what APIs/routes/services exist, what features are available, how the system works. This includes 'is there any api on my app', 'what endpoints does it have', 'what does this project do'.\n" +
		"- upgrade_self: Only when the user asks to upgrade, improve, or make the bot/assistant itself smarter (for example 'upgrade yourself', 'improve the bot', 'ask coder to upgrade you'). Do not use upgrade_self for improving the currently discussed project.\n" +
		"- commit_status: When the user asks about commit history, deploy status, latest commits/deploys.\n" +
		"- chat: For clarifying questions, follow-ups, 'what app are we talking about', 'what project', conversational messages. NOT for coding instructions.\n"

	if (conversationContext) {
		prompt +=
			"\n=== Recent Conversation Context ===\n" +
			conversationContext +
			"\n=== End Context ===\n\n" +
			"Use the conversation context above to disambiguate vague messages. " +
			"If the user says 'proceed', 'continue', 'do it', 'go ahead', or refers to 'this'/'that', " +
			"use the context to determine what they mean.\n"
	}

	prompt +=
		"Return compact JSON with: kind, project, target, message, confidence.\n" +
		"confidence is a number between 0 and 1 indicating how sure you are."
	return prompt
}

/**
 * Classifies a user message into a structured intent using the LLM.
 * Falls back to keyword-based detection if the LLM is unavailable or times out.
 *
 * @param {string} text - The user's message
 * @param {Array} providers - Array of AI provider configs (same format as askAI uses)
 * @param {string} [conversationContext] - Optional recent conversation history for context-aware classification
 * @returns {Promise<ClassifiedIntent>} Classified intent
 */
async function classifyIntent(text, providers, conversationContext) {
	var lower = text.toLowerCase()
	var contextLower = (conversationContext || "").toLowerCase()
	if (isSelfUpgradeRequest(lower)) {
		return {
			kind: "upgrade_self",
			message: text,
			confidence: 0.9,
		}
	}
	if (isRecommendationImplementationFollowup(lower, contextLower)) {
		return {
			kind: "code_task",
			message: text,
			confidence: 0.9,
		}
	}

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
							{ role: "system", content: buildClassifierPrompt(conversationContext) },
							{ role: "user", content: text },
						],
						max_tokens: 256,
						temperature: 0.1,
						response_format: { type: "json_object" },
					}),
					signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
				})
				if (!res.ok) {
					var errBody = ""
					try {
						errBody = await res.text()
					} catch (_) {}
					console.error(
						"[classifier] LLM error from " +
							provider.providerId +
							": " +
							res.status +
							" " +
							errBody.slice(0, 200),
					)
					// Skip providers that return 4xx (auth/config errors) — they won't work on retry
					if (res.status >= 400 && res.status < 500) {
						continue
					}
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
					"feature_query",
					"code_task",
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
	var fallbackKind = keywordFallback(text, conversationContext)
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
	isSelfUpgradeRequest,
	isRecommendationImplementationFollowup,
}
