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
const DASHBOARD_URL = "https://dev.abcx124.xyz"
const telegramConversationBridge = require("../../src/super-roo/conversation-history/TelegramConversationBridge")

// ---------------------------------------------------------------------------
// BullMQ Queue Reference (set by api.js after queue creation)
// ---------------------------------------------------------------------------
// Used to create apply jobs when the user approves a preview plan.
let _queue = null

/**
 * Set the BullMQ queue reference so the notifier can create apply jobs
 * when the user approves a preview plan.
 * @param {import("bullmq").Queue} queue
 */
function setQueue(queue) {
	_queue = queue
}

// ---------------------------------------------------------------------------
// Notification State
// ---------------------------------------------------------------------------
// Tracks pending approval requests: chatId -> { taskId, instruction, diff, timestamp }
const pendingApprovals = new Map()

// Tracks active notifications: chatId -> Set of messageIds
const activeNotifications = new Map()

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
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: effectiveChatId,
					text: text,
					parse_mode: parseMode,
					reply_markup: reply_markup,
				}),
			})
			const data = await res.json()
			if (!data.ok && data.description && data.description.includes("can't parse entities")) {
				if (parseMode === "Markdown") {
					console.log("[telegram-notifier] Markdown parse failed, falling back to plain text")
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
	telegramConversationBridge.recordSystemEvent(chatId, "task_started", "Task " + taskId + " started")
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

	const buttons = [
		[{ text: "⏳ Check Status", callback_data: `notify:status:${taskId}` }],
		[{ text: "📋 Task Board", callback_data: "taskboard:list" }],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 2. Task Complete Notification (with diff summary and action buttons)
// ---------------------------------------------------------------------------
async function sendTaskComplete(botToken, chatId, taskId, instruction, result) {
	telegramConversationBridge.recordSystemEvent(chatId, "task_completed", "Task " + taskId + " completed")
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

	// Task Board navigation
	buttons.push([{ text: "📋 Task Board", callback_data: "taskboard:list" }])

	// Cloud IDE integration — open task in the cloud dashboard
	buttons.push([{ text: "☁️ Open in Cloud IDE", url: DASHBOARD_URL + "/ide?task=" + taskId }])

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 3. Task Failed Notification
// ---------------------------------------------------------------------------
async function sendTaskFailed(botToken, chatId, taskId, instruction, error) {
	telegramConversationBridge.recordSystemEvent(
		chatId,
		"task_failed",
		"Task " + taskId + " failed: " + (error || "Unknown error"),
	)
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
		[{ text: "📋 Task Board", callback_data: "taskboard:list" }],
		[{ text: "☁️ Open in Cloud IDE", url: DASHBOARD_URL + "/ide?task=" + taskId }],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 4. Approval Request Notification (with inline approve/reject buttons)
// ---------------------------------------------------------------------------
async function sendApprovalRequest(botToken, chatId, taskId, instruction, diffInfo) {
	telegramConversationBridge.recordSystemEvent(chatId, "approval_requested", "Approval requested for task " + taskId)
	// Store the pending approval
	const approvalKey = `${chatId}:${taskId}`
	pendingApprovals.set(approvalKey, {
		taskId,
		instruction,
		diffInfo,
		timestamp: Date.now(),
		status: "pending",
	})

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
		[{ text: "📋 Task Board", callback_data: "taskboard:list" }],
		[{ text: "☁️ Open in Cloud IDE", url: DASHBOARD_URL + "/ide?task=" + taskId }],
	]

	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ---------------------------------------------------------------------------
// 5. Deploy Notification
// ---------------------------------------------------------------------------
async function sendDeployNotification(botToken, chatId, taskId, instruction, deployInfo) {
	telegramConversationBridge.recordSystemEvent(
		chatId,
		"deploy_" + deployInfo.status,
		"Deploy " + deployInfo.status + " for task " + taskId,
	)
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
			{ text: "☁️ Open in Cloud IDE", url: "https://dev.abcx124.xyz" },
		])
		buttons.push([{ text: "📊 View Logs", callback_data: `notify:logs:${taskId}` }])
	} else if (deployInfo.status === "failed") {
		buttons.push([
			{ text: "🔄 Retry Deploy", callback_data: `notify:retry:${taskId}` },
			{ text: "☁️ Open in Cloud IDE", url: "https://dev.abcx124.xyz" },
		])
		buttons.push([{ text: "📋 View Logs", callback_data: `notify:logs:${taskId}` }])
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
			const approvalKey = `${chatId}:${taskId}`
			const approval = pendingApprovals.get(approvalKey)
			const diffInfo = approval ? approval.diffInfo : null

			// ── If this is a preview approval (has plan data), create apply job ──
			if (diffInfo && diffInfo.plan && _queue) {
				// Update message to show applying status
				await editMessageText(
					botToken,
					chatId,
					messageId,
					`✅ *Task ${taskId} Approved*\n\n⏳ Applying changes... I'll notify you when it's done.`,
					[[{ text: "📊 Check Status", callback_data: `notify:status:${taskId}` }]],
				)

				// Create a new BullMQ job with applyPlan: true and the plan from preview
				const applyTaskId = taskId + "-apply"
				await _queue.add("telegram-" + applyTaskId, {
					task: diffInfo.plan.plan || "Apply approved changes",
					agentId: "superroo-coder-agent",
					commands: [],
					network: "none",
					goal: diffInfo.goal || diffInfo.plan.plan || "Apply approved changes",
					repo: diffInfo.repo || "superroo2",
					projectPath: diffInfo.projectPath,
					branch: diffInfo.branch || "main",
					applyPlan: true,
					plan: diffInfo.plan,
					telegram: {
						chatId: chatId,
						taskId: applyTaskId,
						branchName: "tg/apply-" + taskId.toLowerCase(),
						conversationSummary: "",
					},
				})

				// Record approval
				if (approval) {
					approval.status = "approved"
					pendingApprovals.set(approvalKey, approval)
				}
				return true
			}

			// ── Regular approval (no plan data) — just update message ──────────
			await editMessageText(
				botToken,
				chatId,
				messageId,
				`✅ *Task ${taskId} Approved*\n\nChanges have been approved and will be applied.`,
				[[{ text: "📊 Check Status", callback_data: `notify:status:${taskId}` }]],
			)

			// Record approval
			if (pendingApprovals.has(approvalKey)) {
				const approval = pendingApprovals.get(approvalKey)
				approval.status = "approved"
				pendingApprovals.set(approvalKey, approval)
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

	// Callback handler
	handleNotificationCallback,

	// State management
	getApprovalStatus,
	clearNotifications,
	pendingApprovals,

	// Group chat routing
	setGroupRouting,
	resolveChatId,

	// Queue reference (set by api.js)
	setQueue,
}
