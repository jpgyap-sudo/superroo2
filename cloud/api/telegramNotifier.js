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
		? "\n\n⚡ *Auto Mode Active* — Plan will be automatically applied → committed → deployed after approval."
		: ""

	const text =
		`💻 *Coder Plan: ${taskId}*\n\n` +
		`*Instruction:* ${instruction.slice(0, 300)}${instruction.length > 300 ? "..." : ""}\n\n` +
		`*Plan:* ${planSummary}\n\n` +
		`*Proposed Changes (${changesList.length}):*\n` +
		(fileSummary || "  _(no file changes)_") +
		autoNote +
		`\n\n_Review the plan and approve to start coding, or ask for clarification._`

	const buttons = [
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
			{ text: "📄 View Diff", callback_data: `coder:diff:${taskId}` },
		],
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
			// Show the diff from the pending job
			const diffText =
				pending && pending.diff
					? "```\n" + pending.diff.substring(0, 3000) + "\n```"
					: "_Diff details not available._"

			await editMessageText(botToken, chatId, messageId, `📄 *Diff for ${taskId}*\n\n${diffText}`, [
				[{ text: "🔙 Back", callback_data: `coder:back:${taskId}` }],
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

		default:
			return false
	}
}

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
			// Show diff summary — in a real scenario this would fetch the actual diff
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`📄 *Diff for ${taskId}*\n\n` +
					`_Fetching diff details..._\n\n` +
					`Use \`/diff ${taskId}\` in chat to see the full diff.\n\n` +
					`*Actions:*\n` +
					`• \`/approve ${taskId}\` — Approve changes\n` +
					`• \`/reject ${taskId}\` — Reject changes`,
				[
					[
						{ text: "✅ Approve", callback_data: `notify:approve:${taskId}` },
						{ text: "❌ Reject", callback_data: `notify:reject:${taskId}` },
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
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`📋 *Logs for ${taskId}*\n\n` + `_Fetching logs..._\n\n` + `Use \`/logs\` in chat to view recent logs.`,
				[[{ text: "🔙 Back", callback_data: `notify:back:${taskId}` }]],
			)
			return true
		}

		case "retry": {
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`🔄 *Retrying ${taskId}*\n\n` + `_Re-queuing the task..._\n\n` + `I'll notify you when it's done.`,
			)
			return true
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

	// Coder workflow send functions
	sendCoderPlan,
	sendCoderApplied,
	sendCoderCommitted,
	sendCoderDeployed,
	sendCoderClarification,

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
}

// Auto-initialize on module load
loadState()
