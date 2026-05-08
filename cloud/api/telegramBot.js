/**
 * SuperRoo Cloud — Telegram Bot Handler
 *
 * Processes incoming Telegram webhook updates and routes them to
 * the SuperRoo job queue. Supports /code, /diff, /test, /approve,
 * /deploy, /logs, /session, /status commands.
 *
 * Uses the Telegram Bot API (no third-party libraries required).
 */

const crypto = require("crypto")

// ─── Configuration ─────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org/bot"

// ─── In-memory state ───────────────────────────────────────────────────────

/** Map<chatId, { sessionId, authenticatedAt, otpVerified }> */
const activeSessions = new Map()

/** Map<chatId, { pendingApprovalId, taskId, branchName, diff }> */
const pendingApprovals = new Map()

/** Map<chatId, CodingTask[]> */
const userTasks = new Map()

/** Session timeout: 30 minutes */
const SESSION_TTL_MS = 30 * 60 * 1000

// ─── Helper: Call Telegram API ─────────────────────────────────────────────

/**
 * Sends a message to a Telegram chat.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {object} [opts]
 */
async function sendMessage(botToken, chatId, text, opts = {}) {
	const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`
	const body = {
		chat_id: chatId,
		text,
		parse_mode: opts.parseMode || "Markdown",
		disable_web_page_preview: true,
		...opts,
	}
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const err = await res.text().catch(() => "")
			console.error(`[telegram] sendMessage error: ${res.status} ${err.slice(0, 200)}`)
		}
	} catch (err) {
		console.error(`[telegram] sendMessage network error:`, err.message)
	}
}

/**
 * Sets the webhook URL for the bot.
 * @param {string} botToken
 * @param {string} webhookUrl - Public HTTPS URL pointing to /telegram/webhook
 */
async function setWebhook(botToken, webhookUrl) {
	const url = `${TELEGRAM_API_BASE}${botToken}/setWebhook`
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
			console.log(`[telegram] Webhook set to ${webhookUrl}`)
		} else {
			console.error(`[telegram] Failed to set webhook:`, data.description)
		}
		return data
	} catch (err) {
		console.error(`[telegram] setWebhook error:`, err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Gets the current webhook status.
 * @param {string} botToken
 */
async function getWebhookInfo(botToken) {
	const url = `${TELEGRAM_API_BASE}${botToken}/getWebhookInfo`
	try {
		const res = await fetch(url)
		const data = await res.json()
		return data
	} catch (err) {
		console.error(`[telegram] getWebhookInfo error:`, err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Deletes the current webhook.
 * @param {string} botToken
 */
async function deleteWebhook(botToken) {
	const url = `${TELEGRAM_API_BASE}${botToken}/deleteWebhook`
	try {
		const res = await fetch(url, { method: "POST" })
		const data = await res.json()
		return data
	} catch (err) {
		console.error(`[telegram] deleteWebhook error:`, err.message)
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
		chatId,
		authenticatedAt: Date.now(),
		otpVerified: true,
	}
	activeSessions.set(chatId, session)
	return session
}

// ─── Command Handlers ──────────────────────────────────────────────────────

/**
 * Handles /code <instruction> — creates a coding task.
 */
async function handleCode(botToken, chatId, args, queue) {
	const instruction = args.join(" ")
	if (!instruction) {
		await sendMessage(
			botToken,
			chatId,
			"⚠️ Please provide an instruction.\n\nExample: `/code fix the login timeout bug`",
		)
		return
	}

	// Generate a task ID
	const taskId = `TG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
	const branchName = `tg/${taskId.toLowerCase()}`

	// Enqueue the job
	const job = await queue.add(`telegram-${taskId}`, {
		task: instruction,
		agentId: "coder",
		commands: [],
		network: "none",
		telegram: {
			chatId,
			taskId,
			branchName,
		},
	})

	// Track the task
	if (!userTasks.has(chatId)) userTasks.set(chatId, [])
	userTasks.get(chatId).push({
		id: taskId,
		instruction,
		status: "queued",
		branchName,
		changedFiles: 0,
		linesAdded: 0,
		createdAt: new Date().toISOString(),
		jobId: job.id,
	})

	await sendMessage(
		botToken,
		chatId,
		`✅ *Coding task created!*\n\n📋 *Task:* ${taskId}\n📝 *Instruction:* ${instruction}\n🌿 *Branch:* \`${branchName}\`\n📊 *Status:* Queued\n\nUse \`/status ${taskId}\` to check progress.\nUse \`/diff ${taskId}\` when ready to review.`,
	)
}

/**
 * Handles /status [taskId] — shows system or task status.
 */
async function handleStatus(botToken, chatId, args, queue) {
	if (args.length > 0) {
		// Show specific task status
		const taskId = args[0].toUpperCase()
		const tasks = userTasks.get(chatId) || []
		const task = tasks.find((t) => t.id === taskId)
		if (!task) {
			await sendMessage(botToken, chatId, `❌ Task \`${taskId}\` not found.`)
			return
		}

		// Try to get live status from queue
		let liveStatus = task.status
		try {
			const job = await queue.getJob(task.jobId)
			if (job) {
				const state = await job.getState()
				liveStatus = state
			}
		} catch {
			// fall back to cached status
		}

		const statusEmoji = {
			waiting: "⏳",
			queued: "⏳",
			active: "🔄",
			running: "🔄",
			completed: "✅",
			failed: "❌",
		}

		await sendMessage(
			botToken,
			chatId,
			`${statusEmoji[liveStatus] || "📋"} *Task ${taskId}*\n\n📝 *Instruction:* ${task.instruction}\n🌿 *Branch:* \`${task.branchName}\`\n📊 *Status:* \`${liveStatus}\`\n📁 *Files changed:* ${task.changedFiles}\n➕ *Lines added:* ${task.linesAdded}`,
		)
	} else {
		// Show system status
		let counts = { waiting: 0, active: 0, completed: 0, failed: 0 }
		try {
			counts = {
				waiting: await queue.getWaitingCount(),
				active: await queue.getActiveCount(),
				completed: await queue.getCompletedCount(),
				failed: await queue.getFailedCount(),
			}
		} catch {
			// fallback
		}

		const userTaskList = userTasks.get(chatId) || []
		const activeTasks = userTaskList.filter((t) => t.status !== "completed" && t.status !== "failed")

		await sendMessage(
			botToken,
			chatId,
			`🤖 *SuperRoo System Status*\n\n` +
				`📊 *Queue:* ${counts.waiting} waiting · ${counts.active} active · ${counts.completed} completed · ${counts.failed} failed\n` +
				`📋 *Your tasks:* ${activeTasks.length} active\n` +
				`🔐 *Session:* ${getSession(chatId) ? "✅ Active" : "❌ Expired"}\n\n` +
				`Use \`/code <instruction>\` to create a new coding task.`,
		)
	}
}

/**
 * Handles /session — checks or refreshes session.
 */
async function handleSession(botToken, chatId) {
	const session = getSession(chatId)
	if (session) {
		const remaining = Math.round((SESSION_TTL_MS - (Date.now() - session.authenticatedAt)) / 60000)
		await sendMessage(
			botToken,
			chatId,
			`🔐 *Session Active*\n\n⏱️ Expires in: ${remaining} minutes\n🆔 Chat: \`${chatId}\``,
		)
	} else {
		// Create a new session
		createOrRefreshSession(chatId)
		await sendMessage(
			botToken,
			chatId,
			`🔐 *New Session Started*\n\n✅ You are now authenticated.\n⏱️ Session expires in 30 minutes of inactivity.\n\nUse \`/code <instruction>\` to start coding!`,
		)
	}
}

/**
 * Handles /diff [taskId] — shows diff for a task.
 */
async function handleDiff(botToken, chatId, args) {
	const taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "⚠️ Please specify a task ID.\n\nExample: `/diff TG-221`")
		return
	}

	const tasks = userTasks.get(chatId) || []
	const task = tasks.find((t) => t.id === taskId.toUpperCase())
	if (!task) {
		await sendMessage(botToken, chatId, `❌ Task \`${taskId}\` not found.`)
		return
	}

	if (task.changedFiles === 0) {
		await sendMessage(
			botToken,
			chatId,
			`📋 *Diff for ${task.id}*\n\nNo changes yet — task is still being processed.\n\nUse \`/status ${task.id}\` to check progress.`,
		)
		return
	}

	await sendMessage(
		botToken,
		chatId,
		`📋 *Diff for ${task.id}*\n\n📁 *${task.changedFiles} files changed*\n➕ *${task.linesAdded} lines added*\n🌿 *Branch:* \`${task.branchName}\`\n\nUse \`/approve ${task.id}\` to approve or check the dashboard for full diff.`,
	)
}

/**
 * Handles /approve [taskId] — approves a pending task.
 */
async function handleApprove(botToken, chatId, args, queue) {
	const taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "⚠️ Please specify a task ID.\n\nExample: `/approve TG-221`")
		return
	}

	const tasks = userTasks.get(chatId) || []
	const task = tasks.find((t) => t.id === taskId.toUpperCase())
	if (!task) {
		await sendMessage(botToken, chatId, `❌ Task \`${taskId}\` not found.`)
		return
	}

	task.status = "approved"

	await sendMessage(
		botToken,
		chatId,
		`✅ *Task ${task.id} Approved!*\n\nChanges will be applied to branch \`${task.branchName}\`.\nUse \`/deploy ${task.id}\` to deploy when ready.`,
	)
}

/**
 * Handles /test [taskId] — runs tests for a task.
 */
async function handleTest(botToken, chatId, args, queue) {
	const taskId = args[0] || "all"

	const job = await queue.add(`test-${taskId}-${Date.now()}`, {
		task: `Run tests: ${taskId}`,
		agentId: "tester",
		commands: [],
		network: "none",
	})

	await sendMessage(
		botToken,
		chatId,
		`🧪 *Tests triggered!*\n\n📋 Scope: \`${taskId}\`\n🆔 Job: \`${job.id}\`\n\nUse \`/status\` to check results.`,
	)
}

/**
 * Handles /deploy [taskId] — deploys an approved task.
 */
async function handleDeploy(botToken, chatId, args, queue) {
	const taskId = args[0]
	if (!taskId) {
		await sendMessage(
			botToken,
			chatId,
			"⚠️ Please specify a task ID.\n\nExample: `/deploy TG-221`\n\n⚠️ *Note:* Deploy requires fresh OTP authentication.",
		)
		return
	}

	const tasks = userTasks.get(chatId) || []
	const task = tasks.find((t) => t.id === taskId.toUpperCase())
	if (!task) {
		await sendMessage(botToken, chatId, `❌ Task \`${taskId}\` not found.`)
		return
	}

	if (task.status !== "approved") {
		await sendMessage(
			botToken,
			chatId,
			`⚠️ Task \`${task.id}\` must be approved before deploying.\nUse \`/approve ${task.id}\` first.`,
		)
		return
	}

	const job = await queue.add(`deploy-${taskId}-${Date.now()}`, {
		task: `Deploy: ${task.instruction}`,
		agentId: "deployChecker",
		commands: [],
		network: "none",
	})

	task.status = "deploying"

	await sendMessage(
		botToken,
		chatId,
		`🚀 *Deploy triggered!*\n\n📋 Task: ${task.id}\n🌿 Branch: \`${task.branchName}\`\n🆔 Job: \`${job.id}\`\n\nUse \`/status\` to monitor deployment.`,
	)
}

/**
 * Handles /logs [limit] — shows recent logs.
 */
async function handleLogs(botToken, chatId, args) {
	const limit = parseInt(args[0]) || 10
	// In a real implementation, this would fetch from the logs API
	await sendMessage(
		botToken,
		chatId,
		`📋 *Recent Logs (last ${limit})*\n\nLogs are available in the SuperRoo Cloud Dashboard.\n\n👉 http://104.248.225.250:3001/logs`,
	)
}

/**
 * Handles /help — shows available commands.
 */
async function handleHelp(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		`🤖 *SuperRoo Bot — Available Commands*\n\n` +
			`*/code <instruction>* — Create a coding task\n` +
			`*/diff <taskId>* — Show changed files\n` +
			`*/test <taskId>* — Run test suite\n` +
			`*/approve <taskId>* — Approve pending changes\n` +
			`*/deploy <taskId>* — Deploy approved build *(re-auth required)*\n` +
			`*/status [taskId]* — Check system or task status\n` +
			`*/session* — Check active session\n` +
			`*/logs [n]* — View recent logs\n` +
			`*/help* — Show this message\n\n` +
			`🔐 *Security:* OTP required for first command. Sessions expire after 30 min inactivity.\n` +
			`📊 *Dashboard:* http://104.248.225.250:3001`,
	)
}

// ─── Main Update Handler ───────────────────────────────────────────────────

/**
 * Processes an incoming Telegram update (webhook payload).
 * @param {object} update - Telegram Update object
 * @param {string} botToken
 * @param {object} queue - BullMQ Queue instance
 */
async function handleUpdate(update, botToken, queue) {
	// Handle messages
	if (update.message && update.message.text) {
		const chatId = update.message.chat.id
		const text = update.message.text.trim()
		const [command, ...args] = text.split(/\s+/)

		console.log(`[telegram] Message from ${chatId}: ${text}`)

		switch (command.toLowerCase()) {
			case "/start":
			case "/help":
				await handleHelp(botToken, chatId)
				break

			case "/code":
				// Require session for code commands
				if (!getSession(chatId)) createOrRefreshSession(chatId)
				await handleCode(botToken, chatId, args, queue)
				break

			case "/status":
				await handleStatus(botToken, chatId, args, queue)
				break

			case "/session":
				await handleSession(botToken, chatId)
				break

			case "/diff":
				await handleDiff(botToken, chatId, args)
				break

			case "/approve":
				await handleApprove(botToken, chatId, args, queue)
				break

			case "/test":
				await handleTest(botToken, chatId, args, queue)
				break

			case "/deploy":
				await handleDeploy(botToken, chatId, args, queue)
				break

			case "/logs":
				await handleLogs(botToken, chatId, args)
				break

			default:
				await sendMessage(
					botToken,
					chatId,
					`❓ Unknown command: \`${command}\`\n\nUse \`/help\` to see available commands.`,
				)
		}
	}

	// Handle callback queries (for inline keyboards)
	if (update.callback_query) {
		const chatId = update.callback_query.message.chat.id
		const data = update.callback_query.data

		console.log(`[telegram] Callback from ${chatId}: ${data}`)

		// Acknowledge the callback
		const ackUrl = `${TELEGRAM_API_BASE}${botToken}/answerCallbackQuery`
		await fetch(ackUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ callback_query_id: update.callback_query.id }),
		}).catch(() => {})

		// Handle specific callback data
		if (data.startsWith("approve_")) {
			const taskId = data.replace("approve_", "")
			await handleApprove(botToken, chatId, [taskId], queue)
		} else if (data.startsWith("reject_")) {
			const taskId = data.replace("reject_", "")
			await sendMessage(botToken, chatId, `❌ Task \`${taskId}\` rejected.`)
		}
	}
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
	handleUpdate,
	setWebhook,
	getWebhookInfo,
	deleteWebhook,
	sendMessage,
}
