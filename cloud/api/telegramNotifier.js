/**
 * Telegram Notification Agent
 *
 * Sends real-time notifications to Telegram with inline action buttons
 * for task status updates, approval requests, and deployment results.
 *
 * This module acts as the bridge between the SuperRoo backend agents
 * and the Telegram bot, providing a "mini VS Code" experience where
 * users can approve, reject, view diffs, and run deploys directly
 * from Telegram chat.
 *
 * Usage:
 *   const notifier = require("./telegramNotifier")
 *   await notifier.sendTaskComplete(botToken, chatId, taskId, "Feature added", { changedFiles: 3, linesAdded: 42 })
 *   await notifier.sendApprovalRequest(botToken, chatId, taskId, "Fix login bug", { changedFiles: 2, linesAdded: 15 })
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TELEGRAM_API_BASE = "https://api.telegram.org/bot"
const DEFAULT_DASHBOARD_URL = "https://dev.abcx124.xyz"

const fs = require("fs").promises
const path = require("path")

// ---------------------------------------------------------------------------
// Notification State
// ---------------------------------------------------------------------------
// Tracks pending approval requests: chatId -> { taskId, instruction, diff, timestamp }
const pendingApprovals = new Map()

// Tracks pending coder jobs awaiting user action: taskId -> { phase, plan, changes, chatId, messageId, instruction, workspaceDir, repoName, branch }
// Used by the multi-phase approval/commit/deploy workflow
const pendingCoderJobs = new Map()

/** Map<taskId, number> — Last progress message ID for auto-delete */
const lastProgressMessageIds = new Map()

// Tracks active notifications: chatId -> Set of messageIds
const activeNotifications = new Map()

/** Path to persist notifier state (approvals, coder jobs) */
const TELEGRAM_NOTIFIER_STATE_FILE = path.join(__dirname, "..", "data", "telegram-notifier-state.json")

/** Debounce timeout for state persistence */
let _statePersistTimeout = null

/**
 * Persists pendingApprovals and pendingCoderJobs to disk.
 * Called automatically after mutations (debounced).
 */
async function persistState() {
	try {
		const dir = path.dirname(TELEGRAM_NOTIFIER_STATE_FILE)
		await fs.mkdir(dir, { recursive: true })
		const state = {
			pendingApprovals: Object.fromEntries(pendingApprovals),
			pendingCoderJobs: Object.fromEntries(pendingCoderJobs),
		}
		await fs.writeFile(TELEGRAM_NOTIFIER_STATE_FILE, JSON.stringify(state), "utf-8")
	} catch (err) {
		console.error("[telegram-notifier] Failed to persist state:", err.message)
	}
}

/**
 * Loads persisted state from disk into the in-memory Maps.
 * Called once at startup.
 */
async function loadState() {
	try {
		const data = await fs.readFile(TELEGRAM_NOTIFIER_STATE_FILE, "utf-8")
		const parsed = JSON.parse(data)
		if (parsed.pendingApprovals) {
			for (const [k, v] of Object.entries(parsed.pendingApprovals)) {
				pendingApprovals.set(k, v)
			}
		}
		if (parsed.pendingCoderJobs) {
			for (const [k, v] of Object.entries(parsed.pendingCoderJobs)) {
				pendingCoderJobs.set(k, v)
			}
		}
		console.log(
			"[telegram-notifier] Loaded state: " +
				pendingApprovals.size +
				" approvals, " +
				pendingCoderJobs.size +
				" coder jobs",
		)
	} catch {
		console.log("[telegram-notifier] No state file found, starting fresh")
	}
}

/**
 * Schedules a debounced persist of notifier state.
 */
function scheduleStatePersist() {
	if (_statePersistTimeout) {
		clearTimeout(_statePersistTimeout)
	}
	_statePersistTimeout = setTimeout(function () {
		_statePersistTimeout = null
		persistState().catch(function (err) {
			console.error("[telegram-notifier] Failed to persist state:", err.message)
		})
	}, 2000)
}

// ---------------------------------------------------------------------------
// Group Chat Routing
// ---------------------------------------------------------------------------
// Maps user chatId -> group chatId for routing notifications to the bound group.
// When a user binds a project to a group via /specify, all task notifications
// for that user's tasks should go to the group chat instead of the user's DM.
const groupChatRouting = new Map()

/**
 * Register a routing rule: notifications intended for `userChatId` should
 * be redirected to `groupChatId`.
 */
function setGroupRouting(userChatId, groupChatId) {
	if (groupChatId) {
		groupChatRouting.set(String(userChatId), String(groupChatId))
	} else {
		groupChatRouting.delete(String(userChatId))
	}
}

/**
 * Resolve the effective chatId for a notification.
 * If the userChatId has a group routing, returns the group chatId instead.
 */
function resolveChatId(userChatId) {
	const routed = groupChatRouting.get(String(userChatId))
	return routed || userChatId
}

function getDashboardBaseUrl() {
	return (process.env.PUBLIC_DASHBOARD_URL || process.env.DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "")
}

function getTelegramTaskDiffUrl(taskId) {
	return getDashboardBaseUrl() + "/?page=telegram&task=" + encodeURIComponent(taskId) + "&panel=diff"
}

// ---------------------------------------------------------------------------
// Helper: Send message with inline keyboard
// ---------------------------------------------------------------------------
/**
 * Escape special characters for Telegram MarkdownV2 parse mode.
 * Telegram MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * For regular Markdown (not MarkdownV2), only _ * ` [ ] need escaping in practice.
 * This function strips markdown formatting entirely for safe plain-text fallback.
 */
function stripMarkdown(text) {
	if (!text) return ""
	// Remove bold/italic markers
	return text
		.replace(/\*{1,2}/g, "")
		.replace(/_{1,2}/g, "")
		.replace(/`{1,3}/g, "")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/>\s/g, "")
}

async function sendInlineKeyboard(botToken, chatId, text, buttons) {
	const url = TELEGRAM_API_BASE + botToken + "/sendMessage"
	const reply_markup = {
		inline_keyboard: buttons,
	}
	// Route to group chat if a binding exists for this user
	const effectiveChatId = resolveChatId(chatId)
	// Try with markdown first, fall back to plain text if markdown parsing fails
	var parseMode = "Markdown"
	var maxAttempts = 2
	for (var attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const body = {
				chat_id: effectiveChatId,
				text: text,
				parse_mode: parseMode,
				reply_markup: reply_markup,
			}
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			const data = await res.json()
			if (!data.ok && data.description && data.description.includes("can't parse entities")) {
				if (parseMode === "Markdown") {
					console.log("[telegram-notifier] Markdown parse failed, falling back to plain text")
					// Strip markdown formatting and retry without parse_mode
					text = stripMarkdown(text)
					parseMode = ""
					continue
				}
			}
			if (data.ok && data.result) {
				// Track the notification message
				if (!activeNotifications.has(String(chatId))) {
					activeNotifications.set(String(chatId), new Set())
				}
				activeNotifications.get(String(chatId)).add(data.result.message_id)
			}
			return data
		} catch (err) {
			console.error("[telegram-notifier] sendInlineKeyboard error:", err.message)
			return null
		}
	}
	return null
}

// ---------------------------------------------------------------------------
// Helper: Edit message text (for updating notification status)
// ---------------------------------------------------------------------------
async function editMessageText(botToken, chatId, messageId, text, buttons) {
	const url = TELEGRAM_API_BASE + botToken + "/editMessageText"
	// Route to group chat if a binding exists for this user
	const effectiveChatId = resolveChatId(chatId)
	// Try with markdown first, fall back to plain text if markdown parsing fails
	var parseMode = "Markdown"
	var maxAttempts = 2
	for (var attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const body = {
				chat_id: effectiveChatId,
				message_id: messageId,
				text: text,
				parse_mode: parseMode,
			}
			if (buttons) {
				body.reply_markup = { inline_keyboard: buttons }
			}
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			const data = await res.json()
			if (!data.ok && data.description && data.description.includes("can't parse entities")) {
				if (parseMode === "Markdown") {
					console.log("[telegram-notifier] editMessageText markdown parse failed, falling back to plain text")
					// Strip markdown formatting and retry without parse_mode
					text = stripMarkdown(text)
					parseMode = ""
					continue
				}
			}
			return data
		} catch (err) {
			console.error("[telegram-notifier] editMessageText error:", err.message)
			return null
		}
	}
	return null
}

// ---------------------------------------------------------------------------
// Helper: Answer callback query (remove loading state on button)
// ---------------------------------------------------------------------------
async function answerCallbackQuery(botToken, callbackQueryId, text) {
	const url = TELEGRAM_API_BASE + botToken + "/answerCallbackQuery"
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				callback_query_id: callbackQueryId,
				text: text || "",
			}),
		})
		return await res.json()
	} catch (err) {
		console.error("[telegram-notifier] answerCallbackQuery error:", err.message)
		return null
	}
}

// ---------------------------------------------------------------------------
// 1. Task Started Notification
// ---------------------------------------------------------------------------
async function sendTaskStarted(botToken, chatId, taskId, instruction, agentType) {
	const agentEmoji = {
		coder: "💻",
		debugger: "🪲",
		deployer: "🚀",
		tester: "🧪",
		consultant: "🔍",
	}
	const emoji = agentEmoji[agentType] || "⚙️"

	const text =
		`${emoji} *Task Started*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Agent:* ${agentType || "auto"}\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`_Processing... I'll notify you when it's done._`

	const buttons = [[{ text: "⏳ Check Status", callback_data: `notify:status:${taskId}` }]]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ─── GAP 4.1: Progress Bar for Long-Running Operations ──────────────────────
// Sends a visual progress indicator that can be updated as the task progresses.
// Uses emoji blocks to create a 10-segment progress bar.
// ---------------------------------------------------------------------------
const _progressMessages = new Map() // taskId -> { chatId, messageId, lastUpdate }

async function sendProgressBar(botToken, chatId, taskId, label, progress, statusText) {
	// progress: 0.0 to 1.0
	var clampedProgress = Math.max(0, Math.min(1, progress))
	var filled = Math.round(clampedProgress * 10)
	var empty = 10 - filled
	var bar = ""
	for (var fi = 0; fi < filled; fi++) bar += "🟩"
	for (var ei = 0; ei < empty; ei++) bar += "⬜"
	var pct = Math.round(clampedProgress * 100)
	var text = "*" + label + "*\n" + bar + " " + pct + "%\n" + (statusText || "_Working..._")

	var existing = _progressMessages.get(taskId)
	if (existing && existing.messageId) {
		try {
			var editUrl = "https://api.telegram.org/bot" + botToken + "/editMessageText"
			var editBody = {
				chat_id: chatId,
				message_id: existing.messageId,
				text: text,
				parse_mode: "Markdown",
			}
			var editRes = await fetch(editUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(editBody),
			})
			if (editRes.ok) {
				existing.lastUpdate = Date.now()
				return existing.messageId
			}
			// If edit fails (e.g. message too old), fall through to send new
		} catch (_) {}
	}

	// Send a new progress message
	var result = await sendMessage(botToken, chatId, text)
	if (result && result.message_id) {
		_progressMessages.set(taskId, { chatId: chatId, messageId: result.message_id, lastUpdate: Date.now() })
		return result.message_id
	}
	return null
}

async function updateProgressBar(botToken, taskId, progress, statusText) {
	var existing = _progressMessages.get(taskId)
	if (!existing) return false
	// Reuse the stored chatId/messageId to edit the existing message
	var clampedProgress = Math.max(0, Math.min(1, progress))
	var filled = Math.round(clampedProgress * 10)
	var empty = 10 - filled
	var bar = ""
	for (var fi = 0; fi < filled; fi++) bar += "🟩"
	for (var ei = 0; ei < empty; ei++) bar += "⬜"
	var pct = Math.round(clampedProgress * 100)
	var text =
		"*" +
		(statusText ? statusText.split("\n")[0] : "Progress") +
		"*\n" +
		bar +
		" " +
		pct +
		"%\n" +
		(statusText || "_Working..._")

	try {
		var editUrl = "https://api.telegram.org/bot" + botToken + "/editMessageText"
		var editBody = {
			chat_id: existing.chatId,
			message_id: existing.messageId,
			text: text,
			parse_mode: "Markdown",
		}
		var editRes = await fetch(editUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(editBody),
		})
		if (editRes.ok) {
			existing.lastUpdate = Date.now()
			return true
		}
	} catch (_) {}
	return false
}

async function clearProgressBar(taskId) {
	_progressMessages.delete(taskId)
}

// ---------------------------------------------------------------------------
// 2. Task Complete Notification (with diff summary and action buttons)
// ---------------------------------------------------------------------------
async function sendTaskComplete(botToken, chatId, taskId, instruction, result) {
	const statusEmoji = result.success !== false ? "✅" : "⚠️"
	const statusText = result.success !== false ? "Completed Successfully" : "Completed with Warnings"

	const diffSummary =
		result.changedFiles > 0
			? `\n*Changes:* ${result.changedFiles} files, ${result.linesAdded || 0} lines added`
			: ""

	const text =
		`${statusEmoji} *Task ${statusText}*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}` +
		diffSummary +
		(result.outputSummary ? `\n\n${result.outputSummary}` : "") +
		"\n\n_What would you like to do?_"

	const buttons = []
	const row1 = []

	if (result.changedFiles > 0) {
		row1.push({ text: "📄 View Diff", callback_data: `notify:diff:${taskId}` })
		row1.push({ text: "✅ Approve", callback_data: `notify:approve:${taskId}` })
	}
	if (row1.length > 0) buttons.push(row1)

	buttons.push([
		{ text: "📊 Full Status", callback_data: `notify:status:${taskId}` },
		{ text: "❌ Reject", callback_data: `notify:reject:${taskId}` },
	])

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 3. Task Failed Notification
// ---------------------------------------------------------------------------
async function sendTaskFailed(botToken, chatId, taskId, instruction, error) {
	const text =
		`❌ *Task Failed*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		`*Error:* ${(error || "Unknown error").slice(0, 300)}\n\n` +
		`_You can retry or check the logs for details._`

	const buttons = [
		[
			{ text: "🔄 Retry", callback_data: `notify:retry:${taskId}` },
			{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 4. Approval Request Notification (with inline approve/reject buttons)
// ---------------------------------------------------------------------------
async function sendApprovalRequest(botToken, chatId, taskId, instruction, diffInfo) {
	// Store the pending approval
	const approvalKey = `${chatId}:${taskId}`
	pendingApprovals.set(approvalKey, {
		taskId,
		instruction,
		diffInfo,
		timestamp: Date.now(),
		status: "pending",
	})
	scheduleStatePersist()

	const diffSummary =
		diffInfo && diffInfo.changedFiles > 0
			? `\n*Changes:* ${diffInfo.changedFiles} files, ${diffInfo.linesAdded || 0} lines added`
			: ""

	const text =
		`🔔 *Approval Required*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}` +
		diffSummary +
		"\n\n_Please review and approve or reject:_"

	const buttons = [
		[
			{ text: "✅ Approve & Merge", callback_data: `notify:approve:${taskId}` },
			{ text: "📄 View Diff", callback_data: `notify:diff:${taskId}` },
		],
		[
			{ text: "❌ Reject", callback_data: `notify:reject:${taskId}` },
			{ text: "💬 Comment", callback_data: `notify:comment:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 5. Deploy Notification
// ---------------------------------------------------------------------------
async function sendDeployNotification(botToken, chatId, taskId, instruction, deployInfo) {
	const statusEmoji = deployInfo.status === "success" ? "🚀" : deployInfo.status === "failed" ? "❌" : "🔄"
	const statusText =
		deployInfo.status === "success"
			? "Deployed Successfully"
			: deployInfo.status === "failed"
				? "Deploy Failed"
				: "Deploying..."

	const text =
		`${statusEmoji} *${statusText}*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		(deployInfo.url ? `*URL:* ${deployInfo.url}\n` : "") +
		(deployInfo.branch ? `*Branch:* \`${deployInfo.branch}\`\n` : "") +
		(deployInfo.message ? `\n${deployInfo.message}` : "")

	const buttons = []
	if (deployInfo.status === "success") {
		buttons.push([
			{ text: "🌐 Open Dashboard", url: deployInfo.url || "https://dev.abcx124.xyz" },
			{ text: "📊 View Logs", callback_data: `notify:logs:${taskId}` },
		])
	} else if (deployInfo.status === "failed") {
		buttons.push([
			{ text: "🔄 Retry Deploy", callback_data: `notify:retry:${taskId}` },
			{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` },
		])
	}

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 6. Debug Complete Notification
// ---------------------------------------------------------------------------
async function sendDebugComplete(botToken, chatId, taskId, instruction, debugResult) {
	const text =
		`🪲 *Debug Complete*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Issue:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		(debugResult.rootCause ? `*Root Cause:* ${debugResult.rootCause}\n` : "") +
		(debugResult.fixSummary ? `*Fix:* ${debugResult.fixSummary}\n` : "") +
		(debugResult.changedFiles > 0 ? `*Changes:* ${debugResult.changedFiles} files\n` : "") +
		"\n_What would you like to do?_"

	const buttons = [
		[
			{ text: "✅ Approve Fix", callback_data: `notify:approve:${taskId}` },
			{ text: "📄 View Diff", callback_data: `notify:diff:${taskId}` },
		],
		[
			{ text: "❌ Reject", callback_data: `notify:reject:${taskId}` },
			{ text: "🔄 Run Tests", callback_data: `notify:test:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 7. Plan Preview Notification — shows the AI-generated plan for a task
// ---------------------------------------------------------------------------
async function sendPlanPreview(botToken, chatId, taskId, instruction, planDetails) {
	const text =
		`📋 *Plan Preview: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		`*Agent:* ${planDetails.agentType || "auto"}\n` +
		`*Estimated Changes:*\n` +
		`• Files: ${planDetails.changedFiles || "TBD"}\n` +
		`• Lines added: ${planDetails.linesAdded || "TBD"}\n` +
		`• Lines removed: ${planDetails.linesRemoved || "TBD"}\n\n` +
		(planDetails.summary ? `*Summary:* ${planDetails.summary}\n\n` : "") +
		`_Review the plan and approve to start coding._`

	const buttons = [
		[
			{ text: "✅ Approve Plan", callback_data: `approve_plan:${taskId}` },
			{ text: "📄 Full Details", callback_data: `preview_plan:${taskId}` },
		],
		[{ text: "❌ Reject", callback_data: `notify:reject:${taskId}` }],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 8. Savepoint Created Notification — notifies when a git savepoint is created
// ---------------------------------------------------------------------------
async function sendSavepointCreated(botToken, chatId, taskId, savepointInfo) {
	const text =
		`🔖 *Savepoint Created*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Savepoint:* \`${(savepointInfo.hash || "").slice(0, 12)}\`\n` +
		`*Branch:* \`${savepointInfo.branch || "main"}\`\n` +
		`*Timestamp:* ${new Date().toLocaleString()}\n\n` +
		`A git savepoint has been created before autonomous coding begins.\n` +
		`You can rollback to this point at any time.`

	const buttons = [
		[
			{ text: "🔄 Rollback", callback_data: `rollback:${savepointInfo.hash || taskId}` },
			{ text: "📊 View Status", callback_data: `notify:status:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 9. Review Ready Notification — notifies when code is ready for review
// ---------------------------------------------------------------------------
async function sendReviewReady(botToken, chatId, taskId, instruction, reviewInfo) {
	const text =
		`👀 *Review Ready: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		`*Changes:* ${reviewInfo.changedFiles || 0} files, +${reviewInfo.linesAdded || 0}/-${reviewInfo.linesRemoved || 0} lines\n` +
		`*Branch:* \`${reviewInfo.branch || "main"}\`\n\n` +
		`_The code is ready for your review. Please approve or request changes._`

	const buttons = [
		[
			{ text: "✅ Approve", callback_data: `notify:approve:${taskId}` },
			{ text: "📄 View Diff", callback_data: `view_diff:${taskId}` },
		],
		[
			{ text: "❌ Request Changes", callback_data: `notify:reject:${taskId}` },
			{ text: "🚀 Deploy Staging", callback_data: `deploy_staging:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 10. Deployment Health Notification — reports health check results after deploy
// ---------------------------------------------------------------------------
async function sendDeploymentHealth(botToken, chatId, taskId, environment, healthInfo) {
	const isHealthy = healthInfo.status === "healthy"
	const statusEmoji = isHealthy ? "✅" : "⚠️"
	const statusText = isHealthy ? "Deployment Healthy" : "Deployment Issues Detected"

	const text =
		`${statusEmoji} *${statusText}*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Environment:* \`${environment}\`\n` +
		`*URL:* ${healthInfo.url || "N/A"}\n` +
		(healthInfo.responseTime ? `*Response Time:* ${healthInfo.responseTime}ms\n` : "") +
		(healthInfo.statusCode ? `*Status Code:* ${healthInfo.statusCode}\n` : "") +
		(healthInfo.message ? `\n${healthInfo.message}` : "") +
		(healthInfo.checks
			? `\n\n*Health Checks:*\n${healthInfo.checks
					.map(function (c) {
						return `• ${c.name}: ${c.passed ? "✅" : "❌"}`
					})
					.join("\n")}`
			: "")

	const buttons = []
	if (isHealthy && environment === "staging") {
		buttons.push([{ text: "🚀 Deploy to Production", callback_data: `deploy_production:${taskId}` }])
	}
	buttons.push([
		{ text: "🌐 Open Dashboard", url: healthInfo.url || "https://dev.abcx124.xyz" },
		{ text: "📊 View Logs", callback_data: `notify:logs:${taskId}` },
	])
	if (!isHealthy) {
		buttons.push([{ text: "🔄 Rollback", callback_data: `rollback:${taskId}` }])
	}

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 11. Rollback Available Notification — notifies when a rollback point exists
// ---------------------------------------------------------------------------
async function sendRollbackAvailable(botToken, chatId, taskId, rollbackInfo) {
	const text =
		`↩️ *Rollback Available*\n\n` +
		`*Task:* \`${taskId}\`\n` +
		`*Savepoint:* \`${(rollbackInfo.hash || "").slice(0, 12)}\`\n` +
		`*Created:* ${rollbackInfo.createdAt || "recently"}\n` +
		(rollbackInfo.branch ? `*Branch:* \`${rollbackInfo.branch}\`\n` : "") +
		`\n_A savepoint is available for rollback if needed._`

	const buttons = [
		[
			{ text: "↩️ Rollback Now", callback_data: `rollback:${rollbackInfo.hash || taskId}` },
			{ text: "📊 View Status", callback_data: `notify:status:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 12. Generic Notification (for any custom message from agents)
// ---------------------------------------------------------------------------
async function sendNotification(botToken, chatId, title, message, buttons) {
	const text = `*${title}*\n\n${message}`

	const formattedButtons = []
	if (buttons && buttons.length > 0) {
		const row = buttons.map((btn) => {
			if (btn.url) {
				return { text: btn.label, url: btn.url }
			}
			return { text: btn.label, callback_data: `notify:${btn.action}:${btn.data || ""}` }
		})
		formattedButtons.push(row)
	}

	return await sendInlineKeyboard(botToken, chatId, text, formattedButtons)
}

// ---------------------------------------------------------------------------
// 13. Coder Plan Preview — shows the LLM-generated plan with approve/reject/clarify
// ---------------------------------------------------------------------------
async function sendCoderPlan(botToken, chatId, taskId, instruction, planData) {
	const planSummary = planData.plan || "No plan description"
	const changesList = Array.isArray(planData.changes) ? planData.changes : []
	const fileSummary = changesList
		.map(function (c) {
			return "• `" + c.file + "` — " + (c.description || c.action)
		})
		.join("\n")

	// Auto mode indicator — show when --auto flag was used
	const autoMode = planData.auto === true
	const autoNote = autoMode
		? "\n\n🤖 *Auto Mode Active* — Plan → Apply → Commit → Test → Deploy will run automatically. No approval needed."
		: ""

	const text =
		`💻 *Coder Plan: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 300)}${instruction.length > 300 ? "..." : ""}\n\n` +
		`*Plan:* ${planSummary}\n\n` +
		`*Proposed Changes (${changesList.length}):*\n` +
		(fileSummary || "  _(no file changes)_") +
		autoNote +
		(autoMode ? "" : `\n\n_Review the plan and approve to start coding, or ask for clarification._`)

	// In auto mode, skip approval buttons — the worker chains automatically
	const buttons = autoMode
		? [
				[{ text: "⏳ Auto-Processing...", callback_data: `notify:status:${taskId}` }],
				[{ text: "🛑 Cancel Auto Mode", callback_data: `coder:reject:${taskId}` }],
			]
		: [
				[
					{ text: "▶️ Proceed", callback_data: `coder:proceed:${taskId}` },
					{ text: "❌ Reject", callback_data: `coder:reject:${taskId}` },
				],
				[
					{ text: "✅ Approve & Code", callback_data: `coder:approve:${taskId}` },
					{ text: "💬 Clarify", callback_data: `coder:clarify:${taskId}` },
				],
			]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 14. Coder Applied — shows changes applied with commit/deploy/reject buttons
// ---------------------------------------------------------------------------
async function sendCoderApplied(botToken, chatId, taskId, instruction, applyResult) {
	const changes = Array.isArray(applyResult.changes) ? applyResult.changes : []
	const changeLines = changes
		.map(function (c) {
			const icon = c.action === "delete" ? "🗑️" : c.action === "create" ? "🆕" : "✏️"
			return icon + " " + c.file + (c.success !== false ? " ✅" : " ❌")
		})
		.join("\n")

	const allSuccess = applyResult.allSuccess !== false
	const text =
		`✏️ *Changes Applied: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`*Changes:*\n${changeLines || "  _(no changes)_"}\n` +
		(allSuccess ? "\n✅ All changes applied successfully" : "\n⚠️ Some changes had issues") +
		`\n\n_What would you like to do next?_`

	const buttons = [
		[
			{ text: "💾 Commit", callback_data: `coder:commit:${taskId}` },
			{ text: "🚀 Deploy Now", callback_data: `coder:deploy:${taskId}` },
		],
		[
			{ text: "❌ Reject Changes", callback_data: `coder:reject:${taskId}` },
			{ text: "📄 View Diff", url: getTelegramTaskDiffUrl(taskId) },
		],
		[{ text: "Preview Diff Here", callback_data: `coder:diff:${taskId}` }],
	]

	// Add retry button if some changes failed
	if (!allSuccess) {
		buttons.push([{ text: "🔄 Retry Failed Changes", callback_data: `coder:retry:${taskId}` }])
	}

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 15. Coder Committed — shows commit result with deploy/skip buttons
// ---------------------------------------------------------------------------
async function sendCoderCommitted(botToken, chatId, taskId, instruction, commitResult) {
	const commitHash = commitResult.hash || "unknown"
	const commitMsg = commitResult.message || "No commit message"
	const branch = commitResult.branch || "main"

	const text =
		`💾 *Changes Committed: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`*Commit:* \`${commitHash.slice(0, 12)}\`\n` +
		`*Branch:* \`${branch}\`\n` +
		`*Message:* ${commitMsg}\n\n` +
		`_Ready to deploy? Or continue working._`

	const buttons = [
		[
			{ text: "🚀 Deploy Now", callback_data: `coder:deploy:${taskId}` },
			{ text: "⏭️ Skip Deploy", callback_data: `coder:done:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 16. Coder Deployed — shows deploy result
// ---------------------------------------------------------------------------
async function sendCoderDeployed(botToken, chatId, taskId, instruction, deployResult) {
	const statusEmoji = deployResult.success ? "✅" : "❌"
	const statusText = deployResult.success ? "Deployed Successfully" : "Deploy Failed"

	const text =
		`${statusEmoji} *${statusText}: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n` +
		(deployResult.url ? `*URL:* ${deployResult.url}\n` : "") +
		(deployResult.message ? `\n${deployResult.message}` : "") +
		`\n\n_Deployment complete._`

	const buttons = []
	if (deployResult.success) {
		buttons.push([{ text: "🌐 Open Dashboard", url: deployResult.url || "https://dev.abcx124.xyz" }])
		// Quick-action buttons for next steps
		buttons.push([
			{ text: "🔄 Run Again", callback_data: `coder:retry:${taskId}` },
			{ text: "➕ New Task", callback_data: `menu:code` },
		])
		buttons.push([
			{ text: "📋 Similar Task", callback_data: `coder:similar:${taskId}` },
			{ text: "🔍 Audit Changes", callback_data: `coder:audit:${taskId}` },
		])
	} else {
		buttons.push([
			{ text: "🔄 Retry", callback_data: `coder:deploy:${taskId}` },
			{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` },
		])
	}
	buttons.push([{ text: "✅ Done", callback_data: `coder:done:${taskId}` }])

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 17. Coder Clarification — asks the user for more details
// ---------------------------------------------------------------------------
async function sendCoderClarification(botToken, chatId, taskId, instruction, question) {
	const text =
		`💬 *Clarification Needed: ${taskId}*\n\n` +
		`*Original instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`*Question:* ${question}\n\n` +
		`_Please reply with the additional information needed._`

	const buttons = [
		[
			{ text: "🔄 Retry with Details", callback_data: `coder:retry:${taskId}` },
			{ text: "❌ Cancel", callback_data: `coder:cancel:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 18. Coder Retryable Failure - reports system/model failures without blaming user input
// ---------------------------------------------------------------------------
async function sendCoderRetryableFailure(botToken, chatId, taskId, instruction, error) {
	const text =
		`⚠️ *Coder Retry Needed: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`*Issue:* ${error}\n\n` +
		`_This looks like a temporary system or model issue. You can retry the same task._`

	const buttons = [
		[
			{ text: "🔄 Retry Task", callback_data: `coder:retry:${taskId}` },
			{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` },
		],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// Improvement 4: Progress feedback — send periodic "still working" messages
// ---------------------------------------------------------------------------
async function sendCoderProgress(botToken, chatId, taskId, message) {
	const text =
		`*⏳ Coder Progress: ${taskId}*\n\n` + `${message}\n\n` + `_I'll notify you when the current phase completes._`

	return await sendMessage(botToken, chatId, text)
}

// ---------------------------------------------------------------------------
// Auto Mode Progress — sends phase-transition updates during auto chaining
// ---------------------------------------------------------------------------
async function sendCoderAutoProgress(botToken, chatId, taskId, fromPhase, toPhase) {
	const phaseEmojis = {
		plan: "🔍",
		apply: "✏️",
		commit: "💾",
		test: "🧪",
		deploy: "🚀",
	}
	const phaseEstimates = {
		plan: "~30-90s",
		apply: "~10-30s",
		commit: "~5-15s",
		test: "~20-60s",
		deploy: "~10-20s",
	}
	const text =
		`*🤖 Auto Mode: ${taskId}*\n\n` +
		`${phaseEmojis[fromPhase] || "✅"} *${fromPhase}* complete\n` +
		`→ ${phaseEmojis[toPhase] || "⏳"} Starting *${toPhase}* (${phaseEstimates[toPhase] || "~?"})\n\n` +
		`_All phases run automatically. You'll get a final summary when done._`

	// Auto-delete previous progress message for this task to keep chat clean
	try {
		var oldMsgId = lastProgressMessageIds.get(taskId)
		if (oldMsgId) {
			await deleteMessage(botToken, chatId, oldMsgId)
		}
	} catch (_) {
		// Non-fatal — message may be too old to delete
	}

	const sent = await sendMessage(botToken, chatId, text)
	// Store message ID for next auto-delete
	if (sent && sent.result && sent.result.message_id) {
		lastProgressMessageIds.set(taskId, sent.result.message_id)
	}
	return sent
}

// ---------------------------------------------------------------------------
// Improvement 6: Test phase result notification
// ---------------------------------------------------------------------------
async function sendCoderTestResult(botToken, chatId, taskId, instruction, testResult) {
	const statusEmoji = testResult.allTestsPassed ? "✅" : "⚠️"
	const statusText = testResult.allTestsPassed ? "All tests passed" : "Some tests failed"
	const commandsList = (testResult.testCommands || []).map((c) => "`" + c + "`").join("\n")

	const text =
		`${statusEmoji} *Test Result: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 200)}${instruction.length > 200 ? "..." : ""}\n\n` +
		`*Status:* ${statusText}\n` +
		`*Commands:*\n${commandsList || "_(none)_"}\n\n` +
		(testResult.allTestsPassed
			? "_Tests passed — ready for deployment._"
			: "_Tests failed — you can still deploy manually if needed._")

	const buttons = testResult.allTestsPassed
		? [
				[
					{ text: "🚀 Deploy", callback_data: `coder:deploy:${taskId}` },
					{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` },
				],
			]
		: [
				[
					{ text: "🚀 Deploy Anyway", callback_data: `coder:deploy:${taskId}` },
					{ text: "🔄 Retry Tests", callback_data: `coder:retry:${taskId}` },
				],
			]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// Handle Coder Workflow Callback Queries
// ---------------------------------------------------------------------------
async function handleCoderCallback(botToken, callbackQuery) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""
	const cqId = cq.id

	// Parse callback data: coder:<action>:<taskId>
	const parts = data.split(":")
	if (parts.length < 3) return false

	const action = parts[1]
	const taskId = parts.slice(2).join(":")

	// Answer the callback query to remove loading state
	await answerCallbackQuery(botToken, cqId)

	const pending = pendingCoderJobs.get(taskId)

	switch (action) {
		case "proceed":
		case "approve": {
			// User approved the plan — update message and return true so caller enqueues apply job
			const approveLabel = action === "proceed" ? "Proceed" : "Approved"
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`✅ *Plan ${approveLabel}: ${taskId}*\n\nCoding is starting... I'll notify you when changes are ready.`,
				[[{ text: "⏳ Processing...", callback_data: `notify:status:${taskId}` }]],
			)
			if (pending) {
				pending.status = "approved"
				pendingCoderJobs.set(taskId, pending)
				scheduleStatePersist()
			}
			return { action: "approved", taskId }
		}

		case "reject": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`❌ *Plan Rejected: ${taskId}*\n\nThe coding plan has been rejected. No changes were made.`,
			)
			if (pending) {
				pendingCoderJobs.delete(taskId)
				scheduleStatePersist()
			}
			return { action: "rejected", taskId }
		}

		case "clarify": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`💬 *Clarification Requested: ${taskId}*\n\nPlease reply with additional details about what you need.`,
				[[{ text: "🔄 Retry", callback_data: `coder:retry:${taskId}` }]],
			)
			if (pending) {
				pending.status = "awaiting_clarification"
				pendingCoderJobs.set(taskId, pending)
				scheduleStatePersist()
			}
			return { action: "clarify", taskId }
		}

		case "commit": {
			// User wants to commit — update message and return true so caller runs git commit
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`💾 *Committing: ${taskId}*\n\nCommitting changes... I'll notify you when done.`,
				[[{ text: "⏳ Committing...", callback_data: `notify:status:${taskId}` }]],
			)
			if (pending) {
				pending.status = "commit_requested"
				pendingCoderJobs.set(taskId, pending)
				scheduleStatePersist()
			}
			return { action: "commit", taskId }
		}

		case "deploy": {
			// User wants to deploy — update message and return true so caller runs deploy
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`🚀 *Deploying: ${taskId}*\n\nDeploying changes... I'll notify you when done.`,
				[[{ text: "⏳ Deploying...", callback_data: `notify:status:${taskId}` }]],
			)
			if (pending) {
				pending.status = "deploy_requested"
				pendingCoderJobs.set(taskId, pending)
				scheduleStatePersist()
			}
			return { action: "deploy", taskId }
		}

		case "diff": {
			// Show the diff from the pending job when available, and always offer the dashboard deep link.
			const fullDiffUrl = getTelegramTaskDiffUrl(taskId)
			const preview =
				pending && (pending.diff || pending.diffSummary) ? String(pending.diff || pending.diffSummary) : ""
			const diffText = preview
				? "```\n" + preview.substring(0, 3000) + "\n```"
				: "_Diff preview is not stored in Telegram memory. Open the dashboard diff page below for the latest captured task details._"

			await editMessageText(botToken, chatId, messageId, `Diff for ${taskId}\n\n${diffText}`, [
				[{ text: "Open Full Diff", url: fullDiffUrl }],
				[{ text: "Back", callback_data: `coder:back:${taskId}` }],
			])
			return { action: "diff", taskId }
		}

		case "retry": {
			// User wants to retry with clarification — return retry action
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`🔄 *Retrying: ${taskId}*\n\nRe-running with additional context...`,
			)
			if (pending) {
				pending.status = "retry_requested"
				pendingCoderJobs.set(taskId, pending)
				scheduleStatePersist()
			}
			return { action: "retry", taskId }
		}

		case "cancel": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`❌ *Cancelled: ${taskId}*\n\nThe operation has been cancelled.`,
			)
			if (pending) {
				pendingCoderJobs.delete(taskId)
				scheduleStatePersist()
			}
			return { action: "cancelled", taskId }
		}

		case "done": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`✅ *Complete: ${taskId}*\n\nAll done! You can start a new task anytime.`,
			)
			if (pending) {
				pendingCoderJobs.delete(taskId)
				scheduleStatePersist()
			}
			return { action: "done", taskId }
		}

		case "back": {
			// Go back to the previous state
			if (pending) {
				const phase = pending.phase || "plan"
				if (phase === "applied") {
					// Show the applied message again
					const changes = Array.isArray(pending.changes) ? pending.changes : []
					const changeLines = changes
						.map(function (c) {
							const icon = c.action === "delete" ? "🗑️" : c.action === "create" ? "🆕" : "✏️"
							return icon + " " + c.file + (c.success !== false ? " ✅" : " ❌")
						})
						.join("\n")
					await editMessageText(
						botToken,
						chatId,
						messageId,
						`✏️ *Changes Applied: ${taskId}*\n\n*Changes:*\n${changeLines || "  _(no changes)_"}\n\n_What would you like to do next?_`,
						[
							[
								{ text: "💾 Commit", callback_data: `coder:commit:${taskId}` },
								{ text: "🚀 Deploy Now", callback_data: `coder:deploy:${taskId}` },
							],
							[{ text: "❌ Reject Changes", callback_data: `coder:reject:${taskId}` }],
						],
					)
				} else {
					// Show the plan again
					await editMessageText(
						botToken,
						chatId,
						messageId,
						`📋 *Plan: ${taskId}*\n\n${pending.plan || "Plan details not available."}`,
						[
							[
								{ text: "▶️ Proceed", callback_data: `coder:proceed:${taskId}` },
								{ text: "❌ Reject", callback_data: `coder:reject:${taskId}` },
							],
							[{ text: "✅ Approve & Code", callback_data: `coder:approve:${taskId}` }],
						],
					)
				}
			}
			return { action: "back", taskId }
		}

		case "similar": {
			return { action: "similar", taskId }
		}

		case "audit": {
			return { action: "audit", taskId }
		}

		case "logs": {
			// Show coder job logs
			let logLines = []
			if (pending) {
				if (pending.createdAt) logLines.push(`🕐 Created: ${new Date(pending.createdAt).toLocaleString()}`)
				if (pending.updatedAt) logLines.push(`🔄 Updated: ${new Date(pending.updatedAt).toLocaleString()}`)
				if (pending.status) logLines.push(`📌 Status: ${pending.status}`)
				if (pending.commitHash) logLines.push(`💾 Commit: ${pending.commitHash.slice(0, 8)}`)
				if (pending.lastError) logLines.push(`❌ Last error: ${pending.lastError}`)
				if (pending.branch) logLines.push(`🌿 Branch: ${pending.branch}`)
				if (pending.healthOk === false) logLines.push(`🚨 Health check: failed`)
				if (Array.isArray(pending.appliedChanges)) {
					const ok = pending.appliedChanges.filter((c) => c.success !== false).length
					const fail = pending.appliedChanges.length - ok
					logLines.push(`📝 Changes: ${ok} applied${fail ? ", " + fail + " failed" : ""}`)
				}
			}
			// Read recent log file entries for this taskId
			try {
				const today = new Date().toISOString().slice(0, 10)
				const logFile = path.join(__dirname, "..", "logs", `superroo-${today}.jsonl`)
				const raw = (await fs.readFile(logFile, "utf-8")).trim().split("\n").filter(Boolean)
				const taskLines = raw
					.map((l) => {
						try {
							return JSON.parse(l)
						} catch {
							return null
						}
					})
					.filter((e) => e && e.message && String(e.message).includes(taskId))
					.slice(-5)
				for (const e of taskLines) {
					logLines.push(`${e.level === "error" ? "❌" : "ℹ️"} ${e.message.slice(0, 120)}`)
				}
			} catch {
				/* log file not yet available */
			}

			const logText = logLines.length ? logLines.join("\n") : "_No log entries found for this task._"

			await editMessageText(botToken, chatId, messageId, `📋 *Task Log: ${taskId}*\n\n${logText}`, [
				[{ text: "🔙 Back", callback_data: `coder:back:${taskId}` }],
			])
			return { action: "logs", taskId }
		}

		default:
			return false
	}
}

// ---------------------------------------------------------------------------
// Store pending coder job state for multi-phase workflow
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Store pending coder job state for multi-phase workflow
// ---------------------------------------------------------------------------
function setPendingCoderJob(taskId, state) {
	pendingCoderJobs.set(taskId, state)
	scheduleStatePersist()
}

function getPendingCoderJob(taskId) {
	return pendingCoderJobs.get(taskId) || null
}

function removePendingCoderJob(taskId) {
	pendingCoderJobs.delete(taskId)
	scheduleStatePersist()
}

// ---------------------------------------------------------------------------
// Handle Callback Query from Notification Buttons
// ---------------------------------------------------------------------------
async function handleNotificationCallback(botToken, callbackQuery) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""
	const cqId = cq.id

	// Parse callback data: notify:<action>:<taskId>
	const parts = data.split(":")
	if (parts.length < 3) return false

	const action = parts[1]
	const taskId = parts.slice(2).join(":")

	// Answer the callback query to remove loading state
	await answerCallbackQuery(botToken, cqId)

	switch (action) {
		case "approve": {
			// Update the message to show approved status
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`✅ *Task ${taskId} Approved*\n\nChanges have been approved and will be applied.`,
				[[{ text: "📊 Check Status", callback_data: `notify:status:${taskId}` }]],
			)
			// Record approval
			const approvalKey = `${chatId}:${taskId}`
			if (pendingApprovals.has(approvalKey)) {
				const approval = pendingApprovals.get(approvalKey)
				approval.status = "approved"
				pendingApprovals.set(approvalKey, approval)
				scheduleStatePersist()
			}
			return true
		}

		case "reject": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`❌ *Task ${taskId} Rejected*\n\nThe changes have been rejected. Please provide feedback or create a new task.`,
				[[{ text: "🔄 Retry", callback_data: `notify:retry:${taskId}` }]],
			)
			const approvalKey = `${chatId}:${taskId}`
			if (pendingApprovals.has(approvalKey)) {
				const approval = pendingApprovals.get(approvalKey)
				approval.status = "rejected"
				pendingApprovals.set(approvalKey, approval)
				scheduleStatePersist()
			}
			return true
		}

		case "diff": {
			const fullDiffUrl = getTelegramTaskDiffUrl(taskId)
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`Diff for ${taskId}\n\n` +
					`Open the dashboard for the full captured diff, file list, and current task status.\n\n` +
					`Actions:\n` +
					`- /approve ${taskId} - Approve changes\n` +
					`- /reject ${taskId} - Reject changes`,
				[
					[{ text: "Open Full Diff", url: fullDiffUrl }],
					[
						{ text: "Approve", callback_data: `notify:approve:${taskId}` },
						{ text: "Reject", callback_data: `notify:reject:${taskId}` },
					],
				],
			)
			return true
		}

		case "status": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`📊 *Status for ${taskId}*\n\n` +
					`_Checking status..._\n\n` +
					`Use \`/status ${taskId}\` in chat for detailed status.`,
				[[{ text: "🔙 Back", callback_data: `notify:back:${taskId}` }]],
			)
			return true
		}

		case "logs": {
			// Build log summary from pending job state + recent log file
			let logLines = []
			const p = pendingCoderJobs.get(taskId) || pendingApprovals.get(`${chatId}:${taskId}`) || null
			if (p) {
				if (p.createdAt) logLines.push(`🕐 Created: ${new Date(p.createdAt).toLocaleString()}`)
				if (p.updatedAt) logLines.push(`🔄 Updated: ${new Date(p.updatedAt).toLocaleString()}`)
				if (p.status) logLines.push(`📌 Status: ${p.status}`)
				if (p.commitHash) logLines.push(`💾 Commit: ${p.commitHash.slice(0, 8)}`)
				if (p.lastError) logLines.push(`❌ Last error: ${p.lastError}`)
				if (p.branch) logLines.push(`🌿 Branch: ${p.branch}`)
				if (p.allSuccess === false) logLines.push(`⚠️ Apply: some changes failed`)
				if (p.healthOk === false) logLines.push(`🚨 Health check: failed`)
				if (Array.isArray(p.appliedChanges)) {
					const ok = p.appliedChanges.filter((c) => c.success !== false).length
					const fail = p.appliedChanges.length - ok
					logLines.push(`📝 Changes: ${ok} applied${fail ? ", " + fail + " failed" : ""}`)
				}
			}
			// Read recent log file entries for this taskId
			try {
				const today = new Date().toISOString().slice(0, 10)
				const logFile = path.join(__dirname, "..", "logs", `superroo-${today}.jsonl`)
				const raw = (await fs.readFile(logFile, "utf-8")).trim().split("\n").filter(Boolean)
				const taskLines = raw
					.map((l) => {
						try {
							return JSON.parse(l)
						} catch {
							return null
						}
					})
					.filter((e) => e && e.message && String(e.message).includes(taskId))
					.slice(-5)
				for (const e of taskLines) {
					logLines.push(`${e.level === "error" ? "❌" : "ℹ️"} ${e.message.slice(0, 120)}`)
				}
			} catch {
				/* log file not yet available */
			}

			// Try auto-deployer status file for deploy tasks
			if (!p || p.status === "deploy_issues" || p.status === "deployed") {
				try {
					const deployStatusPath = path.join(__dirname, "..", "memory", "auto-deploy-status.json")
					const deployRaw = await fs.readFile(deployStatusPath, "utf-8")
					const deployStatus = JSON.parse(deployRaw)
					if (deployStatus.state && deployStatus.state !== "idle") {
						logLines.push(`🚀 Deploy State: ${deployStatus.state}`)
						if (deployStatus.lastError)
							logLines.push(`❌ Deploy Error: ${deployStatus.lastError.slice(0, 200)}`)
						if (deployStatus.attempts && deployStatus.attempts.length > 0) {
							const lastAttempt = deployStatus.attempts[deployStatus.attempts.length - 1]
							logLines.push(`🔄 Last Attempt: ${lastAttempt.status || "unknown"}`)
							if (lastAttempt.error) logLines.push(`❌ Attempt Error: ${lastAttempt.error.slice(0, 200)}`)
						}
						if (deployStatus.cooldownUntil)
							logLines.push(`⏳ Cooldown until: ${new Date(deployStatus.cooldownUntil).toLocaleString()}`)
					}
				} catch {
					/* auto-deploy status not available */
				}

				// Try auto-deployer log file
				try {
					const deployLogPath = path.join(__dirname, "..", "logs", "auto-deployer.log")
					const deployLogRaw = await fs.readFile(deployLogPath, "utf-8")
					const deployLines = deployLogRaw.trim().split("\n").filter(Boolean).slice(-10)
					if (deployLines.length > 0) {
						logLines.push(`\n📜 Recent deploy logs:`)
						for (const line of deployLines) {
							logLines.push(`  ${line.slice(0, 150)}`)
						}
					}
				} catch {
					/* auto-deploy log not available */
				}
			}

			const logText = logLines.length ? logLines.join("\n") : "_No log entries found for this task._"

			await editMessageText(botToken, chatId, messageId, `📋 *Task Log: ${taskId}*\n\n${logText}`, [
				[{ text: "🔙 Back", callback_data: `notify:back:${taskId}` }],
			])
			return true
		}

		case "retry": {
			const retryPending = pendingCoderJobs.get(taskId)
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`🔄 *Retrying: ${taskId}*\n\nRe-running with additional context...`,
			)
			if (retryPending) {
				retryPending.status = "retry_requested"
				pendingCoderJobs.set(taskId, retryPending)
				scheduleStatePersist()
			}
			return { action: "retry", taskId }
		}

		case "test": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`🧪 *Running Tests for ${taskId}*\n\n` +
					`_Tests are being executed..._\n\n` +
					`I'll notify you with the results.`,
			)
			return true
		}

		case "comment": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`💬 *Comment on ${taskId}*\n\n` +
					`Please type your feedback as a reply to this message.\n\n` +
					`_This feature requires additional setup — use /chat for now._`,
				[[{ text: "🔙 Back", callback_data: `notify:back:${taskId}` }]],
			)
			return true
		}

		case "back": {
			// Go back to the original notification
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`📋 *Task ${taskId}*\n\nUse commands to interact:\n` +
					`• \`/status ${taskId}\` — Check status\n` +
					`• \`/diff ${taskId}\` — View changes\n` +
					`• \`/approve ${taskId}\` — Approve\n` +
					`• \`/logs\` — View logs`,
				[
					[
						{ text: "📄 View Diff", callback_data: `notify:diff:${taskId}` },
						{ text: "✅ Approve", callback_data: `notify:approve:${taskId}` },
					],
				],
			)
			return true
		}

		case "rollback_confirm": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`↩️ *Rollback Executed*\n\n` +
					`Savepoint: \`${taskId}\`\n\n` +
					`_Rollback completed successfully._\n\n` +
					`The repository has been restored to the savepoint state.`,
				[[{ text: "📊 Check Status", callback_data: `notify:status:${taskId}` }]],
			)
			return true
		}

		case "cancel": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`❌ *Action Cancelled*\n\n` + `The operation has been cancelled. No changes were made.`,
			)
			return true
		}

		case "list": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`📋 *Task List*\n\n` +
					`Use \`/status\` in chat to see all tasks.\n\n` +
					`Or open the Mini App dashboard for a full view.`,
				[[{ text: "🚀 Open Mini App", url: "https://dev.abcx124.xyz/telegram-miniapp" }]],
			)
			return true
		}

		default:
			return false
	}
}

// ---------------------------------------------------------------------------
// Get pending approval status
// ---------------------------------------------------------------------------
function getApprovalStatus(chatId, taskId) {
	const approvalKey = `${chatId}:${taskId}`
	return pendingApprovals.get(approvalKey) || null
}

// ---------------------------------------------------------------------------
// Clear notification tracking for a chat
// ---------------------------------------------------------------------------
function clearNotifications(chatId) {
	activeNotifications.delete(String(chatId))
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
	// Send functions
	sendTaskStarted,
	sendTaskComplete,
	sendTaskFailed,
	sendApprovalRequest,
	sendDeployNotification,
	sendDebugComplete,
	sendPlanPreview,
	sendSavepointCreated,
	sendReviewReady,
	sendDeploymentHealth,
	sendRollbackAvailable,
	sendNotification,

	// Progress bar (GAP 4.1)
	sendProgressBar,
	updateProgressBar,
	clearProgressBar,

	// Coder workflow send functions
	sendCoderPlan,
	sendCoderApplied,
	sendCoderCommitted,
	sendCoderDeployed,
	sendCoderClarification,
	sendCoderRetryableFailure,
	sendCoderProgress,
	sendCoderAutoProgress,
	sendCoderTestResult,

	// Callback handlers
	handleNotificationCallback,
	handleCoderCallback,

	// State management
	getApprovalStatus,
	clearNotifications,
	pendingApprovals,
	pendingCoderJobs,
	setPendingCoderJob,
	getPendingCoderJob,
	removePendingCoderJob,

	// Group chat routing
	setGroupRouting,
	resolveChatId,

	// Utilities
	stripMarkdown,
	getDashboardBaseUrl,
	getTelegramTaskDiffUrl,
}

// Auto-initialize on module load
loadState()
