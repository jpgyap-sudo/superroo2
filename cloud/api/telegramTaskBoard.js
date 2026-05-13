/**
 * Telegram Bot — Task Board GUI (Phase 3)
 *
 * Visual task management board that replaces /code, /diff, /approve, /status commands.
 * Shows tasks as interactive cards with status indicators and action buttons.
 * Supports task creation, detail view, approval, diff viewing, and retry.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const DASHBOARD_URL = "https://dev.abcx124.xyz"

// ─── API Helpers ────────────────────────────────────────────────────────────

async function sendInlineKeyboard(botToken, chatId, text, buttons) {
	const url = "https://api.telegram.org/bot" + botToken + "/sendMessage"
	const reply_markup = { inline_keyboard: buttons }
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
				parse_mode: "Markdown",
				reply_markup: reply_markup,
			}),
		})
		const data = await res.json()
		if (!data.ok && data.description && data.description.includes("can't parse entities")) {
			const res2 = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text: text,
					reply_markup: reply_markup,
				}),
			})
			return await res2.json()
		}
		return data
	} catch (err) {
		console.error("[telegram-task-board] sendInlineKeyboard error:", err.message)
		return null
	}
}

async function editMessageText(botToken, chatId, messageId, text, buttons) {
	const url = "https://api.telegram.org/bot" + botToken + "/editMessageText"
	const body = {
		chat_id: chatId,
		message_id: messageId,
		text: text,
		parse_mode: "Markdown",
	}
	if (buttons) body.reply_markup = { inline_keyboard: buttons }
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		const data = await res.json()
		if (!data.ok && data.description && data.description.includes("can't parse entities")) {
			delete body.parse_mode
			const res2 = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			return await res2.json()
		}
		return data
	} catch (err) {
		console.error("[telegram-task-board] editMessageText error:", err.message)
		return null
	}
}

// ─── Status Helpers ─────────────────────────────────────────────────────────

const STATUS_ICONS = {
	pending: "⏳",
	in_progress: "🟡",
	running: "🟡",
	completed: "✅",
	done: "✅",
	failed: "❌",
	cancelled: "🚫",
	approved: "✅",
	rejected: "❌",
	review: "👀",
}

function getStatusIcon(status) {
	return STATUS_ICONS[status] || "⏳"
}

function getStatusColor(status) {
	switch (status) {
		case "done":
		case "completed":
		case "approved":
			return "🟢"
		case "failed":
		case "rejected":
			return "🔴"
		case "in_progress":
		case "running":
		case "review":
			return "🟡"
		default:
			return "⚪"
	}
}

// ─── Task Board ─────────────────────────────────────────────────────────────

/**
 * Show the task board — a list of all active tasks with status indicators.
 */
async function showTaskBoard(botToken, chatId, messageId, tasks, activeProject) {
	let text = "*📋 Task Board*\n\n"

	if (activeProject) {
		text += "*Project:* `" + activeProject + "`\n\n"
	}

	if (!tasks || tasks.length === 0) {
		text +=
			"No active tasks. Tell me what you need and I'll create one!\n\n" +
			"*Examples:*\n" +
			'• "Fix the login button"\n' +
			'• "Add user profile API"\n' +
			'• "Update the README"'
	} else {
		// Group tasks by status
		const activeTasks = tasks.filter(function (t) {
			return t.status === "pending" || t.status === "in_progress" || t.status === "running"
		})
		const completedTasks = tasks.filter(function (t) {
			return t.status === "done" || t.status === "completed" || t.status === "approved"
		})
		const failedTasks = tasks.filter(function (t) {
			return t.status === "failed" || t.status === "rejected"
		})

		if (activeTasks.length > 0) {
			text += "*🟡 Active (" + activeTasks.length + ")*\n"
			for (const t of activeTasks) {
				text += "• `" + (t.id || "?").slice(0, 12) + "` " + (t.instruction || t.task || "").slice(0, 50) + "\n"
			}
			text += "\n"
		}

		if (completedTasks.length > 0) {
			text += "*✅ Completed (" + completedTasks.length + ")*\n"
			for (const t of completedTasks.slice(0, 5)) {
				text += "• `" + (t.id || "?").slice(0, 12) + "` " + (t.instruction || t.task || "").slice(0, 50) + "\n"
			}
			if (completedTasks.length > 5) {
				text += "  _...and " + (completedTasks.length - 5) + " more_\n"
			}
			text += "\n"
		}

		if (failedTasks.length > 0) {
			text += "*❌ Failed (" + failedTasks.length + ")*\n"
			for (const t of failedTasks.slice(0, 3)) {
				text += "• `" + (t.id || "?").slice(0, 12) + "` " + (t.instruction || t.task || "").slice(0, 50) + "\n"
			}
			text += "\n"
		}
	}

	const buttons = []

	// Add buttons for active tasks
	if (tasks && tasks.length > 0) {
		for (const t of tasks.slice(0, 6)) {
			const icon = getStatusIcon(t.status)
			const label = (t.instruction || t.task || "Task").slice(0, 35)
			buttons.push([{ text: icon + " " + label, callback_data: "taskboard:detail:" + t.id }])
		}
	}

	// Bottom actions
	const bottomRow = [
		{ text: "💻 New Task", callback_data: "taskboard:new" },
		{ text: "🔄 Refresh", callback_data: "taskboard:refresh" },
	]
	buttons.push(bottomRow)
	buttons.push([{ text: "🔙 Back to Menu", callback_data: "menu:main" }])

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a single task's detail view with all available actions.
 */
async function showTaskDetail(botToken, chatId, messageId, task, queue, orchestratorBridge) {
	const icon = getStatusIcon(task.status)
	const color = getStatusColor(task.status)

	let text =
		"*📋 Task Detail*\n\n" +
		"*ID:* `" +
		(task.id || "unknown") +
		"`\n" +
		"*Status:* " +
		color +
		" " +
		(task.status || "pending") +
		"\n" +
		(task.agent ? "*Agent:* " + task.agent + "\n" : "") +
		(task.instruction ? "*Instruction:* " + task.instruction + "\n" : "") +
		(task.task ? "*Task:* " + task.task + "\n" : "")

	if (task.created_at) {
		text += "*Created:* " + new Date(task.created_at).toLocaleString() + "\n"
	}
	if (task.completed_at) {
		text += "*Completed:* " + new Date(task.completed_at).toLocaleString() + "\n"
	}

	if (task.result) {
		if (task.result.outputSummary) {
			text += "\n*Result:* " + task.result.outputSummary.slice(0, 300) + "\n"
		}
		if (task.result.changedFiles > 0) {
			text +=
				"\n*Changes:* " +
				task.result.changedFiles +
				" files, " +
				(task.result.linesAdded || 0) +
				" lines added\n"
		}
	}

	if (task.error) {
		text += "\n*Error:* " + (typeof task.error === "string" ? task.error.slice(0, 200) : "Unknown error") + "\n"
	}

	text += "\n*Actions:*"

	const buttons = []

	// Context-sensitive action buttons
	if (task.status === "pending" || task.status === "in_progress" || task.status === "running") {
		buttons.push([
			{ text: "⏳ Check Status", callback_data: "taskboard:status:" + task.id },
			{ text: "🚫 Cancel", callback_data: "taskboard:cancel:" + task.id },
		])
	} else if (task.status === "done" || task.status === "completed") {
		const row1 = []
		if (task.result && task.result.changedFiles > 0) {
			row1.push({ text: "📄 View Diff", callback_data: "taskboard:diff:" + task.id })
			row1.push({ text: "✅ Approve", callback_data: "taskboard:approve:" + task.id })
		}
		if (row1.length > 0) buttons.push(row1)

		buttons.push([
			{ text: "📊 Full Status", callback_data: "taskboard:status:" + task.id },
			{ text: "📋 Logs", callback_data: "taskboard:logs:" + task.id },
		])

		if (task.result && task.result.changedFiles > 0) {
			buttons.push([{ text: "🌐 Open in Cloud IDE", url: DASHBOARD_URL + "/dashboard?task=" + task.id }])
		}
	} else if (task.status === "failed") {
		buttons.push([
			{ text: "🔄 Retry", callback_data: "taskboard:retry:" + task.id },
			{ text: "📋 View Logs", callback_data: "taskboard:logs:" + task.id },
		])
		buttons.push([{ text: "🔧 Debug with Brain", callback_data: "taskboard:debug:" + task.id }])
	} else if (task.status === "approved") {
		buttons.push([
			{ text: "🚀 Deploy", callback_data: "taskboard:deploy:" + task.id },
			{ text: "📄 View Diff", callback_data: "taskboard:diff:" + task.id },
		])
	}

	// Navigation
	buttons.push([
		{ text: "🔙 Back to Tasks", callback_data: "taskboard:list" },
		{ text: "🏠 Main Menu", callback_data: "menu:main" },
	])

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a "task created" confirmation with the task board.
 */
async function showTaskCreated(botToken, chatId, messageId, task) {
	const text =
		"*✅ Task Created!*\n\n" +
		"*ID:* `" +
		(task.id || "unknown") +
		"`\n" +
		(task.instruction ? "*Instruction:* " + task.instruction.slice(0, 200) + "\n" : "") +
		"\nI'll start working on this now and notify you when it's done."

	const buttons = [
		[
			{ text: "📋 View Task", callback_data: "taskboard:detail:" + task.id },
			{ text: "📊 Task Board", callback_data: "taskboard:list" },
		],
		[{ text: "🔙 Back to Menu", callback_data: "menu:main" }],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a "task completed" notification with action buttons.
 */
async function showTaskCompleted(botToken, chatId, messageId, task) {
	const icon = task.result && task.result.success !== false ? "✅" : "⚠️"
	const statusText =
		task.result && task.result.success !== false ? "Completed Successfully" : "Completed with Warnings"

	let text =
		icon +
		" *Task " +
		statusText +
		"*\n\n" +
		"*ID:* `" +
		(task.id || "unknown") +
		"`\n" +
		(task.instruction ? "*Instruction:* " + task.instruction.slice(0, 200) + "\n" : "")

	if (task.result) {
		if (task.result.changedFiles > 0) {
			text +=
				"\n*Changes:* " + task.result.changedFiles + " files, " + (task.result.linesAdded || 0) + " lines added"
		}
		if (task.result.outputSummary) {
			text += "\n\n" + task.result.outputSummary.slice(0, 200)
		}
	}

	text += "\n\n*What would you like to do?*"

	const buttons = []
	const row1 = []

	if (task.result && task.result.changedFiles > 0) {
		row1.push({ text: "📄 View Diff", callback_data: "taskboard:diff:" + task.id })
		row1.push({ text: "✅ Approve", callback_data: "taskboard:approve:" + task.id })
	}
	if (row1.length > 0) buttons.push(row1)

	buttons.push([
		{ text: "📊 Full Status", callback_data: "taskboard:status:" + task.id },
		{ text: "📋 Logs", callback_data: "taskboard:logs:" + task.id },
	])

	if (task.result && task.result.changedFiles > 0) {
		buttons.push([{ text: "🌐 Open in Cloud IDE", url: DASHBOARD_URL + "/dashboard?task=" + task.id }])
	}

	buttons.push([{ text: "🔙 Back to Tasks", callback_data: "taskboard:list" }])

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a "task failed" notification with retry/logs buttons.
 */
async function showTaskFailed(botToken, chatId, messageId, task) {
	const text =
		"*❌ Task Failed*\n\n" +
		"*ID:* `" +
		(task.id || "unknown") +
		"`\n" +
		(task.instruction ? "*Instruction:* " + task.instruction.slice(0, 200) + "\n" : "") +
		(task.error
			? "*Error:* " + (typeof task.error === "string" ? task.error.slice(0, 300) : "Unknown error") + "\n"
			: "") +
		"\n*What would you like to do?*"

	const buttons = [
		[
			{ text: "🔄 Retry", callback_data: "taskboard:retry:" + task.id },
			{ text: "📋 View Logs", callback_data: "taskboard:logs:" + task.id },
		],
		[{ text: "🔧 Debug with Brain", callback_data: "taskboard:debug:" + task.id }],
		[{ text: "🔙 Back to Tasks", callback_data: "taskboard:list" }],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Handle a task board callback.
 * Returns { handled, action, taskId }
 */
async function handleTaskBoardCallback(botToken, callbackQuery, context) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""

	if (!data.startsWith("taskboard:")) {
		return { handled: false }
	}

	const parts = data.split(":")
	const action = parts[1] || ""
	const taskId = parts.slice(2).join(":") || null

	switch (action) {
		case "list":
			// Show task board
			const tasks = (context && context.tasks) || []
			const activeProject = (context && context.activeProject) || null
			await showTaskBoard(botToken, chatId, messageId, tasks, activeProject)
			return { handled: true, action, taskId }

		case "detail":
			// Show task detail
			const allTasks = (context && context.tasks) || []
			const task = allTasks.find(function (t) {
				return t.id === taskId
			})
			if (task) {
				await showTaskDetail(
					botToken,
					chatId,
					messageId,
					task,
					context && context.queue,
					context && context.orchestratorBridge,
				)
			} else {
				await showTaskBoard(botToken, chatId, messageId, allTasks, context && context.activeProject)
			}
			return { handled: true, action, taskId }

		case "new":
			// Delegate to menu system for new task creation
			return { handled: false, action: "new_task", taskId: null }

		case "refresh":
			// Refresh — return for caller to re-fetch tasks
			return { handled: false, action: "refresh_tasks", taskId: null }

		default:
			// Other actions (status, diff, approve, retry, cancel, logs, deploy, debug)
			// Return for the caller to handle with actual backend logic
			return { handled: false, action, taskId }
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	showTaskBoard,
	showTaskDetail,
	showTaskCreated,
	showTaskCompleted,
	showTaskFailed,
	handleTaskBoardCallback,
}
