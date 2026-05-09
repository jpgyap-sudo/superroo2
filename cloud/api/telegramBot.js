/**
 * SuperRoo Cloud — Telegram Bot Handler
 *
 * Processes incoming Telegram webhook updates and routes them to
 * the SuperRoo job queue. Supports /code, /diff, /test, /approve,
 * /deploy, /logs, /session, /status, /ask commands.
 *
 * Also supports @superroo_bot mentions in groups for AI-powered
 * support queries with Working Tree knowledge.
 *
 * Includes Google Authenticator TOTP verification for secure access
 * to sensitive operations like /deploy.
 *
 * Uses the Telegram Bot API (no third-party libraries required).
 *
 * Integrated with the unified auth module (auth.js) for session-based
 * authentication across Telegram, Web Dashboard, and VS Code extension.
 */

const crypto = require("crypto")
const auth = require("./auth")

// ─── Configuration ─────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org/bot"

/** The bot username (without @) for mention detection */
const BOT_USERNAME = "superroo_bot"

/** Boss-only mode: only @jpgy888 can use the bot */
const BOSS_USERNAME = "jpgy888"

/** Commands that don't require an active Telegram session */
const PUBLIC_COMMANDS = ["/start", "/login", "/help", "/about"]

/** Mini App URL for login */
const MINI_APP_URL = "https://dev.abcx124.xyz/telegram-miniapp"

// ─── In-memory state ───────────────────────────────────────────────────────

/** Map<chatId, { sessionId, authenticatedAt, otpVerified, otpSecret? }> */
const activeSessions = new Map()

/** Map<chatId, { pendingApprovalId, taskId, branchName, diff }> */
const pendingApprovals = new Map()

/** Map<chatId, CodingTask[]> */
const userTasks = new Map()

/** Map<chatId, { secret, verified }> — TOTP secrets awaiting verification */
const pendingOtpSecrets = new Map()

/** Session timeout: 30 minutes */
const SESSION_TTL_MS = 30 * 60 * 1000

// ─── TOTP (Google Authenticator) ───────────────────────────────────────────

/**
 * Generates a TOTP-compatible base32 secret key (16 bytes -> 26 chars base32).
 * Compatible with Google Authenticator, Authy, etc.
 */
function generateTOTPSecret() {
	const bytes = crypto.randomBytes(16)
	const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let base32 = ""
	let bits = 0
	let bitCount = 0
	for (let i = 0; i < bytes.length; i++) {
		bits = (bits << 8) | bytes[i]
		bitCount += 8
		while (bitCount >= 5) {
			bitCount -= 5
			base32 += base32Chars[(bits >> bitCount) & 0x1f]
		}
	}
	if (bitCount > 0) {
		base32 += base32Chars[(bits << (5 - bitCount)) & 0x1f]
	}
	while (base32.length % 8 !== 0) base32 += "="
	return base32
}

/**
 * Decodes a base32 string (RFC 4648) to a Buffer.
 */
function base32Decode(encoded) {
	const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	const clean = encoded.replace(/=+$/, "").toUpperCase()
	const bytes = []
	let bits = 0
	let bitCount = 0
	for (let i = 0; i < clean.length; i++) {
		const idx = base32Chars.indexOf(clean[i])
		if (idx === -1) continue
		bits = (bits << 5) | idx
		bitCount += 5
		if (bitCount >= 8) {
			bitCount -= 8
			bytes.push((bits >> bitCount) & 0xff)
		}
	}
	return Buffer.from(bytes)
}

/**
 * Computes a TOTP code for a given secret and time step.
 * Uses SHA-1 (standard for Google Authenticator compatibility).
 * @param {string} base32Secret - Base32-encoded secret
 * @param {number} timeStep - Time step in seconds
 * @param {number} offset - Time step offset (-1, 0, +1 for clock drift)
 * @returns {string} 6-digit TOTP code
 */
function computeTOTP(base32Secret, timeStep, offset) {
	const key = base32Decode(base32Secret)
	const counter = Math.floor(Date.now() / 1000 / timeStep) + (offset || 0)
	const counterBuf = Buffer.alloc(8)
	counterBuf.writeBigUInt64BE(BigInt(counter), 0)

	const hmac = crypto.createHmac("sha1", key)
	hmac.update(counterBuf)
	const digest = hmac.digest()

	const offset2 = digest[digest.length - 1] & 0xf
	const binary =
		((digest[offset2] & 0x7f) << 24) |
		((digest[offset2 + 1] & 0xff) << 16) |
		((digest[offset2 + 2] & 0xff) << 8) |
		(digest[offset2 + 3] & 0xff)

	const code = binary % 1000000
	return String(code).padStart(6, "0")
}

/**
 * Verifies a TOTP code against a secret.
 * Checks current and adjacent time steps (+-1) to account for clock drift.
 * @param {string} base32Secret
 * @param {string} code - 6-digit code from Google Authenticator
 * @returns {boolean}
 */
function verifyTOTP(base32Secret, code) {
	const timeStep = 30
	for (let offset = -1; offset <= 1; offset++) {
		const expected = computeTOTP(base32Secret, timeStep, offset)
		if (expected === code) return true
	}
	return false
}

/**
 * Generates an otpauth:// URI for easy QR code scanning.
 * @param {string} base32Secret
 * @param {string} [accountName="superroo@telegram"]
 * @returns {string}
 */
function generateOTPAuthURI(base32Secret, accountName) {
	const name = accountName || "jpgyap@gmail.com"
	const encodedName = encodeURIComponent(name)
	const encodedIssuer = encodeURIComponent("SuperRoo Cloud")
	return (
		"otpauth://totp/" +
		encodedIssuer +
		":" +
		encodedName +
		"?secret=" +
		base32Secret +
		"&issuer=" +
		encodedIssuer +
		"&algorithm=SHA1&digits=6&period=30"
	)
}

// ─── Helper: Call Telegram API ─────────────────────────────────────────────

/**
 * Sends a message to a Telegram chat.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {object} [opts]
 */
async function sendMessage(botToken, chatId, text, opts) {
	opts = opts || {}
	const url = TELEGRAM_API_BASE + botToken + "/sendMessage"
	const body = {
		chat_id: chatId,
		text: text,
		parse_mode: opts.parseMode || "Markdown",
		disable_web_page_preview: true,
	}
	if (opts.reply_to_message_id) body.reply_to_message_id = opts.reply_to_message_id
	if (opts.disable_notification) body.disable_notification = opts.disable_notification
	if (opts.reply_markup) body.reply_markup = opts.reply_markup
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const err = await res.text().catch(function () {
				return ""
			})
			console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
		}
	} catch (err) {
		console.error("[telegram] sendMessage network error:", err.message)
	}
}

/**
 * Sends a chat action (typing indicator) to show the bot is processing.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} [action="typing"]
 */
async function sendChatAction(botToken, chatId, action) {
	action = action || "typing"
	const url = TELEGRAM_API_BASE + botToken + "/sendChatAction"
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, action: action }),
		})
	} catch (err) {
		// silently ignore
	}
}

/**
 * Sends a message with an inline keyboard.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {Array} buttons - Array of [{ text, callback_data }] rows
 * @param {object} [opts]
 */
async function sendInlineKeyboard(botToken, chatId, text, buttons, opts) {
	opts = opts || {}
	const reply_markup = {
		inline_keyboard: buttons.map(function (row) {
			return row.map(function (btn) {
				if (btn.web_app) {
					return { text: btn.text, web_app: { url: btn.web_app } }
				}
				if (btn.url) {
					return { text: btn.text, url: btn.url }
				}
				return { text: btn.text, callback_data: btn.callback_data }
			})
		}),
	}
	await sendMessage(botToken, chatId, text, Object.assign({}, opts, { reply_markup: JSON.stringify(reply_markup) }))
}

/**
 * Answers a callback query (removes the loading spinner on the button).
 * @param {string} botToken
 * @param {string} callbackQueryId
 * @param {string} [text]
 */
async function answerCallbackQuery(botToken, callbackQueryId, text) {
	const url = TELEGRAM_API_BASE + botToken + "/answerCallbackQuery"
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				callback_query_id: callbackQueryId,
				text: text || "",
			}),
		})
	} catch (err) {
		// silently ignore
	}
}

/**
 * Edits a message text (used to update inline keyboard messages).
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {number} messageId
 * @param {string} text
 * @param {object} [opts]
 */
async function editMessageText(botToken, chatId, messageId, text, opts) {
	opts = opts || {}
	const url = TELEGRAM_API_BASE + botToken + "/editMessageText"
	const body = {
		chat_id: chatId,
		message_id: messageId,
		text: text,
		parse_mode: opts.parseMode || "Markdown",
		disable_web_page_preview: true,
	}
	if (opts.reply_markup) body.reply_markup = opts.reply_markup
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
	} catch (err) {
		console.error("[telegram] editMessageText error:", err.message)
	}
}

/**
 * Sets the webhook URL for the bot.
 * @param {string} botToken
 * @param {string} webhookUrl - Public HTTPS URL pointing to /telegram/webhook
 */
async function setWebhook(botToken, webhookUrl) {
	const url = TELEGRAM_API_BASE + botToken + "/setWebhook"
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: webhookUrl,
				allowed_updates: ["message", "callback_query"],
			}),
		})
		const data = await res.json()
		if (data.ok) {
			console.log("[telegram] Webhook set to " + webhookUrl)
		} else {
			console.error("[telegram] Failed to set webhook:", data.description)
		}
		return data
	} catch (err) {
		console.error("[telegram] setWebhook error:", err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Gets the current webhook status.
 * @param {string} botToken
 */
async function getWebhookInfo(botToken) {
	const url = TELEGRAM_API_BASE + botToken + "/getWebhookInfo"
	try {
		const res = await fetch(url)
		const data = await res.json()
		return data
	} catch (err) {
		console.error("[telegram] getWebhookInfo error:", err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Deletes the current webhook.
 * @param {string} botToken
 */
async function deleteWebhook(botToken) {
	const url = TELEGRAM_API_BASE + botToken + "/deleteWebhook"
	try {
		const res = await fetch(url, { method: "POST" })
		const data = await res.json()
		return data
	} catch (err) {
		console.error("[telegram] deleteWebhook error:", err.message)
		return { ok: false, error: err.message }
	}
}

// ─── Session Management ────────────────────────────────────────────────────

function getSession(chatId) {
	const session = activeSessions.get(chatId)
	if (!session) return null
	if (Date.now() - session.authenticatedAt > SESSION_TTL_MS) {
		activeSessions.delete(chatId)
		return null
	}
	return session
}

function createOrRefreshSession(chatId) {
	const session = {
		chatId: chatId,
		authenticatedAt: Date.now(),
		otpVerified: false,
	}
	activeSessions.set(chatId, session)
	return session
}

// ─── Auth Module Integration ───────────────────────────────────────────────

/**
 * Checks if a Telegram user has an active session in the auth module.
 * If they do, creates/refreshes the local session.
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<object|null>} The auth session or null
 */
async function checkAuthSession(telegramUserId, chatId) {
	try {
		const result = await auth.handleTelegramSessionCheck({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		if (result && result.authenticated) {
			const localSession = createOrRefreshSession(chatId)
			localSession.authSession = result
			return result
		}
	} catch (err) {
		console.error("[telegram] checkAuthSession error:", err.message)
	}
	return null
}

/**
 * Gets the user's email from the auth module session.
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<string|null>}
 */
async function getAuthEmail(telegramUserId, chatId) {
	try {
		const result = await auth.handleTelegramSessionCheck({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		if (result && result.authenticated && result.email) {
			return result.email
		}
	} catch (err) {
		console.error("[telegram] getAuthEmail error:", err.message)
	}
	return null
}

// ─── AI Chat Helper ────────────────────────────────────────────────────────

/**
 * Calls the AI provider to answer a support query.
 * Uses the same callChatCompletion pattern as the main API.
 *
 * @param {string} message - User's question
 * @param {Array} providers - List of provider configs with apiBaseUrl, apiKey, model
 * @returns {Promise<string>} AI response text
 */
async function askAI(message, providers) {
	for (var i = 0; i < providers.length; i++) {
		var provider = providers[i]
		if (!provider.apiKey) continue
		try {
			var url = provider.apiBaseUrl.replace(/\/+$/, "") + "/chat/completions"
			var res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + provider.apiKey,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: [
						{
							role: "system",
							content:
								"You are SuperRoo AI Assistant, an expert support agent for the SuperRoo product. " +
								"You have deep knowledge of the SuperRoo system architecture, modules, features, and capabilities. " +
								"Answer questions concisely and accurately. If you don't know something, say so rather than guessing.\n\n" +
								"## SuperRoo System Architecture\n\n" +
								"The SuperRoo system is organized into 18 core modules:\n\n" +
								"### 1. Orchestrator\n" +
								"- Task routing, agent lifecycle management, workflow orchestration\n" +
								"- Source: src/super-roo/orchestrator/\n\n" +
								"### 2. Agent System\n" +
								"- Coder Agent: Code generation & implementation\n" +
								"- Debugger Agent: Bug investigation & root cause analysis\n" +
								"- PM Agent: Product management & feature tracking\n" +
								"- Tester Agent: Test execution & quality gates\n" +
								"- Supabase Agent: Database operations\n" +
								"- Self-Healing Agent: Autonomous incident response\n" +
								"- Source: src/super-roo/agents/\n\n" +
								"### 3. Safety System\n" +
								"- Autonomy level enforcement (OFF -> SAFE -> AUTO -> FULL_AUTONOMOUS)\n" +
								"- Capability gating, blocklist filtering\n" +
								"- Source: src/super-roo/safety/\n\n" +
								"### 4. Memory System\n" +
								"- SQLite persistence, CRUD for all entities, event sourcing\n" +
								"- Source: src/super-roo/memory/\n\n" +
								"### 5. Task Queue\n" +
								"- Priority queuing, job retry & backoff, concurrency control\n" +
								"- BullMQ integration\n" +
								"- Source: src/super-roo/queue/\n\n" +
								"### 6. Event Log\n" +
								"- Event streaming, observability, audit trail\n" +
								"- Source: src/super-roo/logging/\n\n" +
								"### 7. Feature Registry\n" +
								"- Feature lifecycle tracking (planned -> building -> testing -> working -> deprecated)\n" +
								"- Health monitoring (unknown -> healthy -> degraded -> failing)\n" +
								"- Bug-to-feature mapping\n" +
								"- Source: src/super-roo/features/\n\n" +
								"### 8. Bug Registry\n" +
								"- Bug recording & tracking, severity classification, fix attempt history\n" +
								"- Source: src/super-roo/bugs/\n\n" +
								"### 9. Self-Healing System\n" +
								"- Healing Bus: Incident coordination hub\n" +
								"- Root Cause Classifier: Pattern-based classification\n" +
								"- Repair Plan Builder: Structured fix generation\n" +
								"- Self-Healing Loop: detect -> classify -> plan -> fix -> verify\n" +
								"- Source: src/super-roo/healing/\n\n" +
								"### 10. Machine Learning Engine\n" +
								"- Neural network training, code/debug/test pattern learning\n" +
								"- Infinite improvement loop\n" +
								"- Source: src/super-roo/ml/\n\n" +
								"### 11. Product Memory\n" +
								"- Product Feature Agent, Product Updates Agent\n" +
								"- Feature Tester Agent, Bug-Feature Mapper\n" +
								"- Commit & Deploy Log: Centralized audit trail\n" +
								"- Source: src/super-roo/product-memory/\n\n" +
								"### 12. Commit & Deploy Log\n" +
								"- Centralized commit recording, deploy lifecycle tracking\n" +
								"- Health check verification, rollback tracking\n" +
								"- Agent-aware audit trail, feature-linked commits\n" +
								"- Source: src/super-roo/product-memory/CommitDeployLog.ts\n\n" +
								"### 13. Parallel Execution Engine\n" +
								"- Parallel task execution, inter-agent messaging\n" +
								"- Parallel healing pipeline, parallel ML training\n" +
								"- Source: src/super-roo/parallel/\n\n" +
								"### 14. CPU Guard\n" +
								"- CPU usage monitoring, autonomous task throttling\n" +
								"- Resource-aware scheduling\n" +
								"- Source: src/super-roo/cpu-guard/\n\n" +
								"### 15. Deploy System\n" +
								"- GitHub Actions dispatch, VPS SSH deployment\n" +
								"- Rollback management, health check verification\n" +
								"- Source: src/super-roo/deploy/\n\n" +
								"### 16. Crawler Agent\n" +
								"- Web crawling, entity extraction, signal detection\n" +
								"- Source: src/super-roo/crawler/\n\n" +
								"### 17. File Importer\n" +
								"- File import, content extraction, type validation\n" +
								"- Source: src/super-roo/import/\n\n" +
								"### 18. Remote Shell\n" +
								"- SSH command execution, remote file operations\n" +
								"- Source: src/super-roo/remote/\n\n" +
								"### 19. Settings & API Keys System\n" +
								"- Provider API key management, encrypted secret storage (AES-256-GCM)\n" +
								"- Real provider connection testing, agent routing sync\n" +
								"- VPS control center (auto-approve, MCP, guardrails)\n" +
								"- Source: cloud/api/api.js, cloud/dashboard/src/components/views/\n\n" +
								"## Cloud Infrastructure\n" +
								"- API Server: Port 8787, BullMQ queue, Redis backend\n" +
								"- Worker: Processes jobs from queue, runs in Docker sandbox\n" +
								"- Dashboard: Next.js app on port 3001\n" +
								"- VPS: 104.248.225.250, nginx reverse proxy at dev.abcx124.xyz\n" +
								"- PM2 process management with ecosystem.config.js\n\n" +
								"## Telegram Bot Commands\n" +
								"- /code <instruction> - Create a coding task\n" +
								"- /ask <question> - Ask the AI support assistant\n" +
								"- /diff <taskId> - Show changed files\n" +
								"- /test <taskId> - Run test suite\n" +
								"- /approve <taskId> - Approve pending changes\n" +
								"- /deploy <taskId> - Deploy approved build (OTP required)\n" +
								"- /status [taskId] - Check system or task status\n" +
								"- /session - Check active session\n" +
								"- /otp - Set up Google Authenticator\n" +
								"- /logs [n] - View recent logs\n" +
								"- /projects - List and select projects\n" +
								"- /workspace - Show active workspace\n" +
								"- /help - Show all commands\n\n" +
								"## Dashboard Pages\n" +
								"- Overview: System health, queue stats, recent activity\n" +
								"- Jobs: Job queue management\n" +
								"- Queue: Queue monitoring\n" +
								"- Agents: Agent management\n" +
								"- Model Router: AI provider routing configuration\n" +
								"- API Keys: Provider key management\n" +
								"- Settings: VPS control center\n" +
								"- Approvals: Approval workflow\n" +
								"- Telegram: Telegram bot monitoring\n" +
								"- GitHub: Repository management\n" +
								"- Docker: Container management\n" +
								"- Logs: System logs\n" +
								"- Bugs: Bug tracking\n" +
								"- Working Tree: Architecture visualization\n" +
								"- Projects: Project management\n" +
								"- AI Assistant: AI chat interface\n" +
								"- Skill Generator: Skill generation\n" +
								"- IDE Terminal: Remote terminal",
						},
						{ role: "user", content: message },
					],
					max_tokens: 2048,
					temperature: 0.7,
				}),
				signal: AbortSignal.timeout(30_000),
			})
			if (!res.ok) {
				var errBody = ""
				try {
					errBody = await res.text()
				} catch (e) {}
				console.error(
					"[telegram] askAI error from " +
						provider.providerId +
						": " +
						res.status +
						" " +
						errBody.slice(0, 100),
				)
				continue
			}
			var data = await res.json()
			return data.choices[0].message.content || "(no response)"
		} catch (err) {
			console.error("[telegram] askAI network error with " + provider.providerId + ":", err.message)
			continue
		}
	}
	return "Sorry, I couldn't reach any AI provider right now. Please check that an API key is configured and working in the dashboard (API Keys page)."
}

// ─── Command Handlers ──────────────────────────────────────────────────────

/**
 * Handles /ask <question> - AI-powered support assistant.
 */
async function handleAsk(botToken, chatId, args, providers) {
	var question = args.join(" ")
	if (!question) {
		await sendMessage(
			botToken,
			chatId,
			"*SuperRoo AI Assistant*\n\nAsk me anything about SuperRoo! I have knowledge of the entire system architecture, modules, features, and capabilities.\n\nExample: `/ask where is the self-healing code located?`\nExample: `/ask what modules does the agent system connect to?`\nExample: `/ask how do I deploy to the VPS?`",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	console.log("[telegram] AI query from " + chatId + ": " + question.slice(0, 100))

	var reply = await askAI(question, providers)

	var maxLen = 4000
	if (reply.length > maxLen) {
		reply = reply.slice(0, maxLen) + "\n\n*(truncated - response too long)*"
	}

	await sendMessage(botToken, chatId, reply)
}

/**
 * Handles /code <instruction> - creates a coding task.
 */
async function handleCode(botToken, chatId, args, queue) {
	var instruction = args.join(" ")
	if (!instruction) {
		await sendMessage(
			botToken,
			chatId,
			"Please provide an instruction.\n\nExample: `/code fix the login timeout bug`",
		)
		return
	}

	var taskId =
		"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
	var branchName = "tg/" + taskId.toLowerCase()

	var job = await queue.add("telegram-" + taskId, {
		task: instruction,
		agentId: "coder",
		commands: [],
		network: "none",
		telegram: {
			chatId: chatId,
			taskId: taskId,
			branchName: branchName,
		},
	})

	if (!userTasks.has(chatId)) userTasks.set(chatId, [])
	userTasks.get(chatId).push({
		id: taskId,
		instruction: instruction,
		status: "queued",
		branchName: branchName,
		changedFiles: 0,
		linesAdded: 0,
		createdAt: new Date().toISOString(),
		jobId: job.id,
	})

	await sendMessage(
		botToken,
		chatId,
		"*Coding task created!*\n\n*Task:* " +
			taskId +
			"\n*Instruction:* " +
			instruction +
			"\n*Branch:* `" +
			branchName +
			"`\n*Status:* Queued\n\nUse `/status " +
			taskId +
			"` to check progress.\nUse `/diff " +
			taskId +
			"` when ready to review.",
	)
}

/**
 * Handles /status [taskId] - shows system or task status.
 */
async function handleStatus(botToken, chatId, args, queue) {
	if (args.length > 0) {
		var taskId = args[0].toUpperCase()
		var tasks = userTasks.get(chatId) || []
		var task = tasks.find(function (t) {
			return t.id === taskId
		})
		if (!task) {
			await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
			return
		}

		var liveStatus = task.status
		try {
			var job = await queue.getJob(task.jobId)
			if (job) {
				liveStatus = await job.getState()
			}
		} catch (e) {}

		var emojiMap = { waiting: "", queued: "", active: "", running: "", completed: "", failed: "" }
		var emoji = emojiMap[liveStatus] || ""

		await sendMessage(
			botToken,
			chatId,
			emoji +
				" *Task " +
				taskId +
				"*\n\n*Instruction:* " +
				task.instruction +
				"\n*Branch:* `" +
				task.branchName +
				"`\n*Status:* `" +
				liveStatus +
				"`\n*Files changed:* " +
				task.changedFiles +
				"\n*Lines added:* " +
				task.linesAdded,
		)
	} else {
		var counts = { waiting: 0, active: 0, completed: 0, failed: 0 }
		try {
			counts = {
				waiting: await queue.getWaitingCount(),
				active: await queue.getActiveCount(),
				completed: await queue.getCompletedCount(),
				failed: await queue.getFailedCount(),
			}
		} catch (e) {}

		var userTaskList = userTasks.get(chatId) || []
		var activeTasks = userTaskList.filter(function (t) {
			return t.status !== "completed" && t.status !== "failed"
		})

		await sendMessage(
			botToken,
			chatId,
			"*SuperRoo System Status*\n\n" +
				"*Queue:* " +
				counts.waiting +
				" waiting . " +
				counts.active +
				" active . " +
				counts.completed +
				" completed . " +
				counts.failed +
				" failed\n" +
				"*Your tasks:* " +
				activeTasks.length +
				" active\n" +
				"*Session:* " +
				(getSession(chatId) ? "Active" : "Expired") +
				"\n\n" +
				"Use `/code <instruction>` to create a new coding task.",
		)
	}
}

/**
 * Handles /session - checks or refreshes session.
 */
async function handleSession(botToken, chatId) {
	var session = getSession(chatId)
	if (session) {
		var remaining = Math.round((SESSION_TTL_MS - (Date.now() - session.authenticatedAt)) / 60000)
		await sendMessage(
			botToken,
			chatId,
			"*Session Active*\n\nExpires in: " +
				remaining +
				" minutes\nChat: `" +
				chatId +
				"`\nOTP: " +
				(session.otpVerified ? "Verified" : "Not verified") +
				"\n\nUse `/otp` to set up Google Authenticator if not verified.",
		)
	} else {
		createOrRefreshSession(chatId)
		await sendMessage(
			botToken,
			chatId,
			"*New Session Started*\n\nYou are now authenticated.\nSession expires in 30 minutes of inactivity.\n\nUse `/otp` to set up Google Authenticator for secure operations.\nUse `/code <instruction>` to start coding!",
		)
	}
}

/**
 * Handles /otp - sets up Google Authenticator TOTP.
 */
async function handleOTP(botToken, chatId, args) {
	var session = getSession(chatId)
	if (!session) {
		createOrRefreshSession(chatId)
	}

	if (args.length > 0) {
		var code = args[0].replace(/\s/g, "")
		var pending = pendingOtpSecrets.get(chatId)

		if (!pending || !pending.secret) {
			await sendMessage(botToken, chatId, "No pending OTP setup. Use `/otp` first to generate a secret key.")
			return
		}

		if (verifyTOTP(pending.secret, code)) {
			var sess = getSession(chatId) || createOrRefreshSession(chatId)
			sess.otpVerified = true
			sess.otpSecret = pending.secret
			pendingOtpSecrets.delete(chatId)

			await sendMessage(
				botToken,
				chatId,
				"*Google Authenticator Verified!*\n\nYour OTP is now active. Secure operations like `/deploy` will require your 6-digit code.\n\nSession is now fully authenticated.",
			)
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*Invalid code.* Please try again.\n\nMake sure you've added the secret to Google Authenticator and entered the current 6-digit code.\n\nUse `/otp` to see the secret again.",
			)
		}
		return
	}

	var secret = generateTOTPSecret()
	pendingOtpSecrets.set(chatId, { secret: secret, verified: false })

	var otpUri = generateOTPAuthURI(secret, "superroo_" + chatId)

	await sendMessage(
		botToken,
		chatId,
		"*Google Authenticator Setup*\n\n" +
			"1. Open Google Authenticator on your phone\n" +
			"2. Tap *+* -> *Enter a setup key*\n" +
			"3. Enter the following key:\n\n" +
			"`" +
			secret +
			"`\n\n" +
			"Or scan this URI in a QR generator:\n" +
			"(copy the link below into any QR code generator)\n" +
			"`" +
			otpUri +
			"`\n\n" +
			"4. Then send the 6-digit code:\n" +
			"`/otp <code>`\n\n" +
			"Example: `/otp 123456`",
	)
}

/**
 * Handles /diff [taskId] - shows diff for a task.
 */
async function handleDiff(botToken, chatId, args) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "Please specify a task ID.\n\nExample: `/diff TG-221`")
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	if (task.changedFiles === 0) {
		await sendMessage(
			botToken,
			chatId,
			"*Diff for " +
				task.id +
				"*\n\nNo changes yet - task is still being processed.\n\nUse `/status " +
				task.id +
				"` to check progress.",
		)
		return
	}

	await sendMessage(
		botToken,
		chatId,
		"*Diff for " +
			task.id +
			"*\n\n*" +
			task.changedFiles +
			" files changed*\n*" +
			task.linesAdded +
			" lines added*\n*Branch:* `" +
			task.branchName +
			"`\n\nUse `/approve " +
			task.id +
			"` to approve or check the dashboard for full diff.",
	)
}

/**
 * Handles /approve [taskId] - approves a pending task.
 */
async function handleApprove(botToken, chatId, args) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "Please specify a task ID.\n\nExample: `/approve TG-221`")
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	task.status = "approved"

	await sendMessage(
		botToken,
		chatId,
		"*Task " +
			task.id +
			" Approved!*\n\nChanges will be applied to branch `" +
			task.branchName +
			"`.\nUse `/deploy " +
			task.id +
			"` to deploy when ready.",
	)
}

/**
 * Handles /test [taskId] - runs tests for a task.
 */
async function handleTest(botToken, chatId, args, queue) {
	var taskId = args[0] || "all"

	var job = await queue.add("test-" + taskId + "-" + Date.now(), {
		task: "Run tests: " + taskId,
		agentId: "tester",
		commands: [],
		network: "none",
	})

	await sendMessage(
		botToken,
		chatId,
		"*Tests triggered!*\n\nScope: `" + taskId + "`\nJob: `" + job.id + "`\n\nUse `/status` to check results.",
	)
}

/**
 * Handles /deploy [taskId] - deploys an approved task.
 * Requires OTP verification.
 */
async function handleDeploy(botToken, chatId, args, queue) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(
			botToken,
			chatId,
			"Please specify a task ID.\n\nExample: `/deploy TG-221`\n\n*Note:* Deploy requires OTP authentication via Google Authenticator.",
		)
		return
	}

	var session = getSession(chatId)
	if (!session || !session.otpVerified) {
		await sendMessage(
			botToken,
			chatId,
			"*OTP Required*\n\nDeploy requires Google Authenticator verification.\n\nUse `/otp` to set up and verify your OTP first.",
		)
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	if (task.status !== "approved") {
		await sendMessage(
			botToken,
			chatId,
			"Task `" + task.id + "` must be approved before deploying.\nUse `/approve " + task.id + "` first.",
		)
		return
	}

	var job = await queue.add("deploy-" + taskId + "-" + Date.now(), {
		task: "Deploy: " + task.instruction,
		agentId: "deployChecker",
		commands: [],
		network: "none",
	})

	task.status = "deploying"

	await sendMessage(
		botToken,
		chatId,
		"*Deploy triggered!*\n\nTask: " +
			task.id +
			"\nBranch: `" +
			task.branchName +
			"`\nJob: `" +
			job.id +
			"`\n\nUse `/status` to monitor deployment.",
	)
}

/**
 * Handles /logs [limit] - shows recent logs.
 */
async function handleLogs(botToken, chatId, args) {
	var limit = parseInt(args[0]) || 10
	await sendMessage(
		botToken,
		chatId,
		"*Recent Logs (last " +
			limit +
			")*\n\nLogs are available in the dashboard at https://dev.abcx124.xyz/logs\n\nUse `/status` to check system health.",
	)
}

// ─── New Auth-Integrated Command Handlers ────────────────────────────────

/**
 * Handles /login - opens the Mini App login panel or shows login instructions.
 * Users authenticate via the Telegram Mini App which links their Telegram
 * account to their SuperRoo Cloud account.
 */
async function handleLogin(botToken, chatId, telegramUserId) {
	// Check if already authenticated via auth module
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (authSession) {
		var email = authSession.email || "your account"
		await sendMessage(
			botToken,
			chatId,
			"*Already Logged In* ✅\n\nYou are signed in as: `" +
				email +
				"`\n\nUse `/projects` to view your projects.\nUse `/code <instruction>` to start a coding task.\nUse `/session` to check session details.",
		)
		return
	}

	// Send login button that opens the Mini App
	var loginButton = [
		[
			{
				text: "🔐 Login to SuperRoo Cloud",
				url: MINI_APP_URL + "?chat_id=" + chatId + "&telegram_id=" + telegramUserId,
			},
		],
	]

	await sendInlineKeyboard(
		botToken,
		chatId,
		"*Login to SuperRoo Cloud*\n\n" +
			"Click the button below to open the login panel and authenticate with your SuperRoo Cloud account.\n\n" +
			"After logging in, you'll be able to:\n" +
			"• View and select projects\n" +
			"• Send coding instructions\n" +
			"• Monitor task status\n" +
			"• Approve and deploy changes\n\n" +
			"*Don't have an account?*\n" +
			"Create one in the Settings tab at https://dev.abcx124.xyz",
		loginButton,
	)
}

/**
 * Handles /projects - lists available projects from the auth module.
 * Shows project cards with inline keyboard for selection.
 */
async function handleProjects(botToken, chatId, telegramUserId) {
	// Check auth session first
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(
			botToken,
			chatId,
			"*Authentication Required*\n\nPlease login first using `/login` to view your projects.",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (!result || !result.projects || result.projects.length === 0) {
			await sendMessage(
				botToken,
				chatId,
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the dashboard at https://dev.abcx124.xyz\n\nUse `/code <instruction>` to start a coding task in the default workspace.",
			)
			return
		}

		var projectList = result.projects
			.map(function (p, i) {
				return (
					"*" +
					(i + 1) +
					". " +
					p.name +
					"*" +
					(p.description ? "\n   " + p.description : "") +
					"\n   Status: " +
					(p.status || "active") +
					"\n   ID: `" +
					p.id +
					"`"
				)
			})
			.join("\n\n")

		// Build inline keyboard for project selection
		var projectButtons = result.projects.map(function (p) {
			return [{ text: p.name, callback_data: "project:" + p.id }]
		})

		await sendInlineKeyboard(
			botToken,
			chatId,
			"*Your Projects*\n\n" + projectList + "\n\nSelect a project to set as your active workspace:",
			projectButtons,
		)
	} catch (err) {
		console.error("[telegram] handleProjects error:", err.message)
		await sendMessage(
			botToken,
			chatId,
			"*Error loading projects*\n\n" + err.message + "\n\nPlease try again later.",
		)
	}
}

/**
 * Handles /workspace - shows the currently active workspace/project.
 */
async function handleWorkspace(botToken, chatId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		var activeProject = null
		if (result && result.projects) {
			activeProject = result.projects.find(function (p) {
				return p.is_active
			})
		}

		if (activeProject) {
			await sendMessage(
				botToken,
				chatId,
				"*Active Workspace*\n\n" +
					"*Project:* " +
					activeProject.name +
					"\n" +
					(activeProject.description ? "*Description:* " + activeProject.description + "\n" : "") +
					"*Status:* " +
					(activeProject.status || "active") +
					"\n" +
					"*ID:* `" +
					activeProject.id +
					"`\n\n" +
					"Use `/projects` to switch projects.\n" +
					"Use `/code <instruction>` to start coding.",
			)
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*No Active Workspace*\n\nUse `/projects` to select a project as your active workspace.",
			)
		}
	} catch (err) {
		console.error("[telegram] handleWorkspace error:", err.message)
		await sendMessage(botToken, chatId, "*Error*\n\nCould not load workspace information.")
	}
}

/**
 * Handles /agents - shows available agents and their status.
 */
async function handleAgents(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Available Agents*\n\n" +
			"1. *Coder* — Code generation & implementation\n" +
			"2. *Debugger* — Bug investigation & root cause analysis\n" +
			"3. *Tester* — Test execution & quality gates\n" +
			"4. *Deploy Checker* — Deployment verification\n" +
			"5. *PM Agent* — Product management & feature tracking\n\n" +
			"Use `/code <instruction>` to assign a task to the Coder agent.\n" +
			"Use `/status` to check agent activity.",
	)
}

/**
 * Handles /settings - shows settings options.
 */
async function handleSettings(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Settings*\n\n" +
			"Manage your account and preferences at the dashboard:\n" +
			"https://dev.abcx124.xyz/settings\n\n" +
			"*Available options:*\n" +
			"• Create/update your account (email + password)\n" +
			"• Link Telegram to your account\n" +
			"• Manage API keys\n" +
			"• Configure agent routing\n" +
			"• Set guardrails and approval rules",
	)
}

/**
 * Handles /about - shows bot information.
 */
/**
 * Handles /miniide command — sends inline keyboard with Mini IDE WebApp button.
 * @param {string} botToken
 * @param {number} chatId
 * @param {number} telegramUserId
 */
async function handleMiniIde(botToken, chatId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		var projects = (result && result.projects) || []

		if (projects.length === 0) {
			await sendMessage(
				botToken,
				chatId,
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the SuperRoo Cloud Dashboard.\n\nhttps://dev.abcx124.xyz",
			)
			return
		}

		if (projects.length === 1) {
			// Single project — open Mini IDE directly
			var project = projects[0]
			var miniIdeUrl =
				"https://dev.abcx124.xyz/tg?workspace=" +
				encodeURIComponent(project.id || project.project_id) +
				"&chat_id=" +
				chatId
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Mini IDE* 🚀\n\nActive workspace: *" +
					(project.name || project.project_name) +
					"*\n\nOpen the Mini IDE to code with a full editor, file browser, AI assistant, and file uploads.",
				[
					[{ text: "🚀 Open Mini IDE", web_app: miniIdeUrl }],
					[
						{ text: "📁 Projects", callback_data: "projects" },
						{ text: "❓ Help", callback_data: "help" },
					],
				],
			)
		} else {
			// Multiple projects — show project list first
			var buttons = projects.map(function (p) {
				return [
					{ text: "📁 " + (p.name || p.project_name), callback_data: "project:" + (p.id || p.project_id) },
				]
			})
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Select a Workspace*\n\nChoose a project to open in the Mini IDE:",
				buttons,
			)
		}
	} catch (err) {
		console.error("[telegram] handleMiniIde error:", err.message)
		await sendMessage(botToken, chatId, "*Error*\n\nCould not load projects. " + err.message)
	}
}

async function handleAbout(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*SuperRoo Bot* 🤖\n\n" +
			"Version: 2.0.0\n" +
			"Framework: Telegram Bot API (native)\n" +
			"Backend: SuperRoo Cloud API\n\n" +
			"*Features:*\n" +
			"• Unified auth across Telegram, Web, and VS Code\n" +
			"• Project management with workspace switching\n" +
			"• AI-powered coding assistant\n" +
			"• Task queue with status tracking\n" +
			"• Secure deploy with Google Authenticator OTP\n\n" +
			"*Dashboard:* https://dev.abcx124.xyz\n" +
			"*Support:* Use `/ask <question>` or tag @superroo_bot in group chat",
	)
}

/**
 * Handles project selection from inline keyboard callback.
 * @param {string} botToken
 * @param {number} chatId
 * @param {number} messageId
 * @param {string} projectId
 * @param {number} telegramUserId
 */
async function handleProjectSelect(botToken, chatId, messageId, projectId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjectSelect(projectId, {
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (result && result.project) {
			// Update the original message to show selection
			await editMessageText(
				botToken,
				chatId,
				messageId,
				"*Project Selected* ✅\n\n*" +
					result.project.name +
					"* is now your active workspace.\n\n" +
					"Use `/code <instruction>` to start coding in this project.\n" +
					"Use `/workspace` to view the active workspace.",
			)

			// Send a follow-up message with Mini IDE WebApp button
			const miniIdeUrl =
				"https://dev.abcx124.xyz/tg?workspace=" + encodeURIComponent(projectId) + "&chat_id=" + chatId
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Ready to Code* 🚀\n\nActive workspace: *" +
					result.project.name +
					"*\n\n" +
					"📱 *Open Mini IDE* — Full code editor with file browser, AI assistant, and file uploads.\n" +
					"Or send commands directly in chat:\n" +
					"`/code <instruction>` — Start coding\n" +
					"`/workspace` — View workspace\n" +
					"`/status` — Check status",
				[
					[{ text: "🚀 Open Mini IDE", web_app: miniIdeUrl }],
					[
						{ text: "📁 My Projects", callback_data: "projects" },
						{ text: "❓ Help", callback_data: "help" },
					],
				],
			)
		} else {
			await editMessageText(botToken, chatId, messageId, "*Error*\n\nCould not select project. Please try again.")
		}
	} catch (err) {
		console.error("[telegram] handleProjectSelect error:", err.message)
		await editMessageText(botToken, chatId, messageId, "*Error selecting project*\n\n" + err.message)
	}
}

/**
 * Routes a natural language text message to the orchestrator.
 * This is used when a user types a coding instruction directly (not as a command).
 * @param {string} botToken
 * @param {number} chatId
 * @param {string} text - The user's message
 * @param {number} telegramUserId
 * @param {object} queue - BullMQ queue
 */
async function handleNaturalLanguageInstruction(botToken, chatId, text, telegramUserId, queue) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		// If not authenticated, treat as /ask
		return false
	}

	// Check if user has an active project selected
	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		var activeProject = null
		if (result && result.projects) {
			activeProject = result.projects.find(function (p) {
				return p.is_active
			})
		}

		if (activeProject) {
			// Route to orchestrator as a coding instruction
			await sendChatAction(botToken, chatId, "typing")

			// Log the instruction via auth module
			try {
				await auth.handleOrchestratorInstruction({
					userId: authSession.userId,
					projectId: activeProject.id,
					instruction: text,
					source: "telegram",
				})
			} catch (logErr) {
				// Non-critical - just log it
				console.error("[telegram] Failed to log orchestrator instruction:", logErr.message)
			}

			// Create a coding task
			var taskId =
				"TG-" +
				Date.now().toString(36).toUpperCase() +
				"-" +
				Math.random().toString(36).slice(2, 6).toUpperCase()
			var branchName = "tg/" + taskId.toLowerCase()

			var job = await queue.add("telegram-" + taskId, {
				task: text,
				agentId: "coder",
				commands: [],
				network: "none",
				telegram: {
					chatId: chatId,
					taskId: taskId,
					branchName: branchName,
				},
			})

			if (!userTasks.has(chatId)) userTasks.set(chatId, [])
			userTasks.get(chatId).push({
				id: taskId,
				instruction: text,
				status: "queued",
				branchName: branchName,
				changedFiles: 0,
				linesAdded: 0,
				createdAt: new Date().toISOString(),
				jobId: job.id,
			})

			await sendMessage(
				botToken,
				chatId,
				"*Coding task created!* 🚀\n\n*Project:* " +
					activeProject.name +
					"\n*Task:* " +
					taskId +
					"\n*Instruction:* " +
					text +
					"\n*Branch:* `" +
					branchName +
					"`\n*Status:* Queued\n\nUse `/status " +
					taskId +
					"` to check progress.\nUse `/diff " +
					taskId +
					"` when ready to review.",
			)
			return true
		}
	} catch (err) {
		console.error("[telegram] handleNaturalLanguageInstruction error:", err.message)
	}

	return false
}

/**
 * Handles /projects - lists available projects on the VPS (legacy static version).
 * Kept for backward compatibility.
 */
async function handleProjectsLegacy(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Available Projects*\n\n" +
			"1. *SuperRoo Cloud* — AI-powered coding assistant platform\n" +
			"   Location: `/opt/superroo2`\n" +
			"   Dashboard: https://dev.abcx124.xyz\n" +
			"   Commands: `/code`, `/ask`, `/deploy`, `/status`\n\n" +
			"2. *Product Image Studio* — AI product photography using GPT Image & Gemini\n" +
			"   Location: `/root/productgenerator`\n" +
			"   Port: 3003\n" +
			"   Status: `product-image-studio` (PM2)\n\n" +
			"3. *Web SuperRoo* — Public-facing web app\n" +
			"   Location: `/opt/superroo2/apps/web-superroo`\n\n" +
			"4. *Web Evals* — Evaluation system dashboard\n" +
			"   Location: `/opt/superroo2/apps/web-evals`\n\n" +
			"*To code in a project:*\n" +
			"Use `/code <instruction>` to create a coding task.\n" +
			"Use `/ask <question>` to ask about any project.\n\n" +
			"*Dashboard:* https://dev.abcx124.xyz",
	)
}

/**
 * Handles /help - shows all available commands.
 */
async function handleHelp(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*SuperRoo Bot Commands*\n\n" +
			"*Account*\n" +
			"`/login` - Login to SuperRoo Cloud (opens Mini App)\n" +
			"`/session` - Check active session\n" +
			"`/otp [code]` - Set up Google Authenticator\n\n" +
			"*Projects*\n" +
			"`/projects` - List and select projects\n" +
			"`/workspace` - Show active workspace\n" +
			"`/miniide` - Open Mini IDE (full code editor in Telegram)\n" +
			"`/agents` - Show available agents\n\n" +
			"*Coding*\n" +
			"`/code <instruction>` - Create a coding task\n" +
			"`/diff <taskId>` - Show changed files\n" +
			"`/test <taskId>` - Run test suite\n" +
			"`/approve <taskId>` - Approve pending changes\n" +
			"`/deploy <taskId>` - Deploy approved build (OTP required)\n\n" +
			"*AI Support*\n" +
			"`/ask <question>` - Ask the AI support assistant\n" +
			"`@superroo_bot <question>` - Ask in group chat\n\n" +
			"*System*\n" +
			"`/status [taskId]` - Check system or task status\n" +
			"`/logs [n]` - View recent logs\n" +
			"`/settings` - Account and system settings\n" +
			"`/about` - Bot information\n" +
			"`/help` - Show this message\n\n" +
			"*Dashboard:* https://dev.abcx124.xyz\n" +
			"*Need help?* Use `/ask <question>` or tag `@superroo_bot` in group chat.",
	)
}

/**
 * Main update handler — routes incoming Telegram updates to the appropriate handler.
 * Supports both direct commands and @superroo_bot mentions in groups.
 * Includes session guard: blocks non-public commands until authenticated via auth module.
 *
 * @param {object} update - Telegram webhook update object
 * @param {string} botToken
 * @param {object} queue - BullMQ queue instance
 * @param {Array} [providers] - AI provider configs for /ask and @mention support
 */
async function handleUpdate(update, botToken, queue, providers) {
	// Handle callback queries (inline keyboard button presses)
	if (update && update.callback_query) {
		var cq = update.callback_query
		var cqChatId = cq.message.chat.id
		var cqMessageId = cq.message.message_id
		var cqData = cq.data || ""
		var cqUserId = cq.from.id

		// Answer the callback query to remove loading state
		await answerCallbackQuery(botToken, cq.id)

		// Handle project selection
		if (cqData.startsWith("project:")) {
			var projectId = cqData.slice(8)
			await handleProjectSelect(botToken, cqChatId, cqMessageId, projectId, cqUserId)
			return
		}

		return
	}

	if (!update || !update.message) return

	var msg = update.message
	var chatId = msg.chat.id
	var text = (msg.text || "").trim()
	var entities = msg.entities || []
	var telegramUserId = msg.from ? msg.from.id : chatId

	if (!text) return

	// Check if this is a group chat and the bot was mentioned
	var isGroup = chatId < 0
	var botMentioned = false

	if (isGroup) {
		// Look for @superroo_bot in entities
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i]
			if (entity.type === "mention") {
				var mention = text.slice(entity.offset, entity.offset + entity.length)
				if (mention.toLowerCase() === "@" + BOT_USERNAME.toLowerCase()) {
					botMentioned = true
					break
				}
			}
		}
		// In groups, only respond if explicitly mentioned
		if (!botMentioned) return

		// Strip the @mention from the text for command processing
		text = text.replace(/@superroo_bot/gi, "").trim()
	}

	// Parse command and arguments
	var args = text.split(/\s+/)
	var command = args[0] ? args[0].toLowerCase() : ""
	var cmdArgs = args.slice(1)

	// If no command but bot was mentioned, treat as /ask
	if (isGroup && botMentioned && !command.startsWith("/")) {
		command = "/ask"
		cmdArgs = text.split(/\s+/)
	}

	// ─── Session Guard ──────────────────────────────────────────────────
	// Block non-public commands until the user has an active auth session.
	// PUBLIC_COMMANDS: /start, /login, /help, /about
	if (PUBLIC_COMMANDS.indexOf(command) === -1) {
		var authSession = await checkAuthSession(telegramUserId, chatId)
		if (!authSession) {
			// Also check if there's a local session (for backward compatibility)
			var localSession = getSession(chatId)
			if (!localSession) {
				await sendMessage(
					botToken,
					chatId,
					"*Authentication Required* 🔒\n\nPlease login first to use this command.\n\nUse `/login` to authenticate with your SuperRoo Cloud account.\n\n*Public commands:* `/start`, `/help`, `/about`, `/login`",
				)
				return
			}
		}
	}

	// ─── Boss-Only Guard ────────────────────────────────────────────────
	// Only @jpgy888 (boss) can use the bot. Others get a polite rejection.
	var senderUsername = (msg.from && msg.from.username) || ""
	if (senderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase()) {
		await sendMessage(
			botToken,
			chatId,
			"*Access Restricted* 🔒\n\nThis bot is configured for private use only. If you believe this is an error, please contact the administrator.\n\n_Bot ID: superroo_bot_",
		)
		return
	}

	// Ensure local session exists
	var session = getSession(chatId)
	if (!session) {
		createOrRefreshSession(chatId)
	}

	switch (command) {
		case "/start":
			await sendMessage(
				botToken,
				chatId,
				"*SuperRoo Bot* 🤖\n\nWelcome to SuperRoo Cloud! I can help you code, test, deploy, and answer questions about the system.\n\n" +
					"*Get Started:*\n" +
					"1. Use `/login` to authenticate with your SuperRoo Cloud account\n" +
					"2. Use `/projects` to view and select a project\n" +
					"3. Use `/code <instruction>` to start a coding task\n\n" +
					"Use `/help` to see all commands.\n" +
					"Use `/ask <question>` to ask the AI support assistant.",
			)
			break

		case "/login":
			await handleLogin(botToken, chatId, telegramUserId)
			break

		case "/help":
			await handleHelp(botToken, chatId)
			break

		case "/about":
			await handleAbout(botToken, chatId)
			break

		case "/ask":
			await handleAsk(botToken, chatId, cmdArgs, providers || [])
			break

		case "/code":
			await handleCode(botToken, chatId, cmdArgs, queue)
			break

		case "/status":
			await handleStatus(botToken, chatId, cmdArgs, queue)
			break

		case "/session":
			await handleSession(botToken, chatId)
			break

		case "/otp":
			await handleOTP(botToken, chatId, cmdArgs)
			break

		case "/diff":
			await handleDiff(botToken, chatId, cmdArgs)
			break

		case "/approve":
			await handleApprove(botToken, chatId, cmdArgs)
			break

		case "/test":
			await handleTest(botToken, chatId, cmdArgs, queue)
			break

		case "/deploy":
			await handleDeploy(botToken, chatId, cmdArgs, queue)
			break

		case "/logs":
			await handleLogs(botToken, chatId, cmdArgs)
			break

		case "/projects":
			// Try auth-based projects first, fall back to legacy
			await handleProjects(botToken, chatId, telegramUserId)
			break

		case "/workspace":
			await handleWorkspace(botToken, chatId, telegramUserId)
			break

		case "/agents":
			await handleAgents(botToken, chatId)
			break

		case "/miniide":
			await handleMiniIde(botToken, chatId, telegramUserId)
			break

		case "/settings":
			await handleSettings(botToken, chatId)
			break

		default:
			// If in group and mentioned, treat unknown commands as /ask
			if (isGroup && botMentioned) {
				await handleAsk(botToken, chatId, text.split(/\s+/), providers || [])
			} else {
				// Try natural language instruction routing
				var handled = await handleNaturalLanguageInstruction(botToken, chatId, text, telegramUserId, queue)
				if (!handled) {
					await sendMessage(botToken, chatId, "Unknown command. Use `/help` to see available commands.")
				}
			}
			break
	}
}

module.exports = {
	sendMessage,
	sendChatAction,
	sendInlineKeyboard,
	answerCallbackQuery,
	editMessageText,
	setWebhook,
	getWebhookInfo,
	deleteWebhook,
	handleUpdate,
	generateTOTPSecret,
	verifyTOTP,
	generateOTPAuthURI,
}
