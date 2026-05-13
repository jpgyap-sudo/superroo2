/**
 * Telegram Bot — Smart Menu System (Phase 1)
 *
 * Replaces slash commands with a visual, button-driven navigation system.
 * Every action returns to the main menu via "🔙 Back to Menu" buttons.
 * Supports nested sub-menus for deep navigation without typing commands.
 *
 * Usage:
 *   const menu = require("./telegramMenu")
 *   await menu.showMainMenu(botToken, chatId)
 *   await menu.showSubMenu(botToken, chatId, messageId, "Projects", projectButtons)
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const DASHBOARD_URL = "https://dev.abcx124.xyz"
const MINI_APP_URL = "https://dev.abcx124.xyz/telegram-miniapp"

// ─── Menu State ─────────────────────────────────────────────────────────────

/**
 * Map<chatId, { menuMessageId, currentMenu, menuHistory }>
 * Tracks which menu the user is currently viewing so we can navigate back.
 */
const menuState = new Map()

/**
 * Get the current menu state for a chat.
 */
function getMenuState(chatId) {
	if (!menuState.has(chatId)) {
		menuState.set(chatId, {
			menuMessageId: null,
			currentMenu: "main",
			menuHistory: [],
		})
	}
	return menuState.get(chatId)
}

/**
 * Update the menu state for a chat.
 */
function setMenuState(chatId, updates) {
	const state = getMenuState(chatId)
	Object.assign(state, updates)
}

// ─── Button Helpers ─────────────────────────────────────────────────────────

/**
 * Create a callback data string with a namespace prefix.
 * Format: "menu:<action>:<data>"
 */
function cb(action, data) {
	if (data !== undefined && data !== null) {
		return "menu:" + action + ":" + String(data)
	}
	return "menu:" + action
}

/**
 * Check if a callback data string belongs to the menu system.
 */
function isMenuCallback(callbackData) {
	return callbackData && callbackData.startsWith("menu:")
}

/**
 * Parse a menu callback data string.
 * Returns { action, data } or null.
 */
function parseMenuCallback(callbackData) {
	if (!callbackData || !callbackData.startsWith("menu:")) return null
	const parts = callbackData.split(":")
	if (parts.length < 2) return null
	return {
		action: parts[1],
		data: parts.slice(2).join(":") || null,
	}
}

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
		if (data.ok && data.result) {
			// Track the menu message ID
			setMenuState(chatId, { menuMessageId: data.result.message_id })
			return data
		}
		// Fallback: retry without markdown
		if (data.description && data.description.includes("can't parse entities")) {
			const res2 = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text: text,
					reply_markup: reply_markup,
				}),
			})
			const data2 = await res2.json()
			if (data2.ok && data2.result) {
				setMenuState(chatId, { menuMessageId: data2.result.message_id })
			}
			return data2
		}
		return data
	} catch (err) {
		console.error("[telegram-menu] sendInlineKeyboard error:", err.message)
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
	if (buttons) {
		body.reply_markup = { inline_keyboard: buttons }
	}
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
		console.error("[telegram-menu] editMessageText error:", err.message)
		return null
	}
}

async function answerCallbackQuery(botToken, callbackQueryId, text) {
	const url = "https://api.telegram.org/bot" + botToken + "/answerCallbackQuery"
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
		console.error("[telegram-menu] answerCallbackQuery error:", err.message)
		return null
	}
}

// ─── Menu Definitions ───────────────────────────────────────────────────────

/**
 * Show the main menu.
 * This is the central navigation hub — all actions return here.
 */
async function showMainMenu(botToken, chatId, options) {
	const state = getMenuState(chatId)
	state.currentMenu = "main"
	state.menuHistory = []

	const activeProject = (options && options.activeProject) || null
	const taskCount = (options && options.taskCount) || 0
	const userName = (options && options.userName) || "User"

	let text =
		"*🤖 SuperRoo Bot — Smart Dashboard*\n\n" +
		"Hi *" +
		userName +
		"*! I'm your AI coding assistant. " +
		"Everything is just a tap away — no commands needed.\n"

	if (activeProject) {
		text += "\n*📁 Active Project:* `" + activeProject + "`"
	}
	if (taskCount > 0) {
		text += "\n*📋 Active Tasks:* " + taskCount
	}
	text += "\n\n*What would you like to do?*"

	const buttons = [
		// Row 1: Projects + Code
		[
			{ text: "📁 Projects", callback_data: cb("projects") },
			{ text: "💻 New Task", callback_data: cb("new_task") },
		],
		// Row 2: Deploy + Status
		[
			{ text: "🚀 Deploy", callback_data: cb("deploy") },
			{ text: "📊 Status", callback_data: cb("status") },
		],
		// Row 3: Brain + Tasks
		[
			{ text: "🧠 Brain", callback_data: cb("brain") },
			{ text: "📋 Tasks", callback_data: cb("tasks") },
		],
		// Row 4: Logs + Tests
		[
			{ text: "📋 Logs", callback_data: cb("logs") },
			{ text: "🧪 Tests", callback_data: cb("tests") },
		],
		// Row 5: Settings + Help
		[
			{ text: "⚙️ Settings", callback_data: cb("settings") },
			{ text: "❓ Help", callback_data: cb("help") },
		],
		// Row 6: Open Dashboard
		[{ text: "🌐 Open Cloud Dashboard", url: DASHBOARD_URL }],
	]

	// If we have an existing menu message, edit it in-place
	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Projects sub-menu.
 */
async function showProjectsMenu(botToken, chatId, projects) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "projects"

	let text = "*📁 Projects*\n\n"
	if (!projects || projects.length === 0) {
		text += "No projects found. Create one in the Cloud Dashboard first."
	} else {
		text += "Select a project to manage:\n"
	}

	const buttons = []
	if (projects && projects.length > 0) {
		for (const p of projects) {
			const status = p.is_active ? "🟢" : "⚪"
			buttons.push([
				{
					text: status + " " + (p.name || p.repoName || "Unnamed"),
					callback_data: cb("project_select", p.id || p.name),
				},
			])
		}
	}

	buttons.push([
		{ text: "🔄 Refresh", callback_data: cb("projects") },
		{ text: "🌐 Open in Dashboard", url: DASHBOARD_URL + "/projects" },
	])
	buttons.push([{ text: "🔙 Back to Menu", callback_data: cb("main") }])

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a single project's detail menu.
 */
async function showProjectDetailMenu(botToken, chatId, project) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "project_detail"

	const name = project.name || project.repoName || "Unnamed"
	const status = project.is_active ? "🟢 Active" : "⚪ Inactive"

	let text =
		"*📁 Project: " +
		name +
		"*\n\n" +
		"*Status:* " +
		status +
		"\n" +
		(project.repoName ? "*Repo:* `" + project.repoName + "`\n" : "") +
		(project.description ? "*Description:* " + project.description + "\n" : "") +
		"\n*What would you like to do?*"

	const buttons = [
		[
			{ text: "💻 Create Task", callback_data: cb("project_task", project.id || project.name) },
			{ text: "📊 Status", callback_data: cb("project_status", project.id || project.name) },
		],
		[
			{ text: "🚀 Deploy", callback_data: cb("project_deploy", project.id || project.name) },
			{ text: "📋 Logs", callback_data: cb("project_logs", project.id || project.name) },
		],
		[
			{ text: "🧪 Run Tests", callback_data: cb("project_tests", project.id || project.name) },
			{ text: "🧠 Brain", callback_data: cb("project_brain", project.id || project.name) },
		],
		[
			{ text: "🔙 Back to Projects", callback_data: cb("projects") },
			{ text: "🏠 Main Menu", callback_data: cb("main") },
		],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the New Task creation menu.
 */
async function showNewTaskMenu(botToken, chatId, activeProject) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "new_task"

	let text =
		"*💻 Create New Task*\n\n" +
		"Just tell me what you need in natural language!\n\n" +
		"*Examples:*\n" +
		'• "Fix the login button not working"\n' +
		'• "Add a new API endpoint for user profiles"\n' +
		'• "Update the README with deployment steps"\n' +
		'• "Refactor the database schema"\n\n' +
		"Or tap one of the quick options below:"

	const buttons = [
		[
			{ text: "🐛 Fix Bug", callback_data: cb("quick_fix") },
			{ text: "✨ New Feature", callback_data: cb("quick_feature") },
		],
		[
			{ text: "🔧 Refactor", callback_data: cb("quick_refactor") },
			{ text: "📝 Update Docs", callback_data: cb("quick_docs") },
		],
		[
			{ text: "🧪 Write Tests", callback_data: cb("quick_tests") },
			{ text: "🔍 Debug Issue", callback_data: cb("quick_debug") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Deploy menu.
 */
async function showDeployMenu(botToken, chatId, activeProject) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "deploy"

	let text =
		"*🚀 Deploy*\n\n" +
		"Select deployment target:\n" +
		(activeProject ? "\n*Project:* `" + activeProject + "`" : "")

	const buttons = [
		[{ text: "🧪 Deploy to Staging", callback_data: cb("deploy_staging") }],
		[{ text: "🚀 Deploy to Production", callback_data: cb("deploy_production") }],
		[{ text: "📋 Recent Deployments", callback_data: cb("deploy_history") }],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Status menu.
 */
async function showStatusMenu(botToken, chatId, statusData) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "status"

	let text = "*📊 System Status*\n\n"
	if (statusData) {
		if (statusData.services) {
			text += "*Services:*\n"
			for (const [name, s] of Object.entries(statusData.services)) {
				const icon = s === "online" ? "🟢" : s === "degraded" ? "🟡" : "🔴"
				text += icon + " `" + name + "` — " + s + "\n"
			}
		}
		if (statusData.queue) {
			text +=
				"\n*Queue:* " +
				statusData.queue.waiting +
				" waiting, " +
				statusData.queue.active +
				" active, " +
				statusData.queue.completed +
				" completed"
		}
		if (statusData.system) {
			text +=
				"\n*System:* " +
				(statusData.system.cpu || "N/A") +
				" CPU, " +
				(statusData.system.memory || "N/A") +
				" RAM"
		}
	} else {
		text += "Fetching status... Use the refresh button below."
	}

	const buttons = [
		[
			{ text: "🔄 Refresh", callback_data: cb("status") },
			{ text: "📋 Logs", callback_data: cb("logs") },
		],
		[
			{ text: "🧠 Brain Memory", callback_data: cb("brain_memory") },
			{ text: "🧪 Run Tests", callback_data: cb("tests") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Brain sub-menu.
 */
async function showBrainMenu(botToken, chatId) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "brain"

	const text =
		"*🧠 Terminal Brain*\n\n" +
		"The Terminal Brain can plan, execute, analyze, and fix commands.\n" +
		"Just type what you need, or use the options below:"

	const buttons = [
		[
			{ text: "📋 Plan", callback_data: cb("brain_plan") },
			{ text: "▶️ Execute", callback_data: cb("brain_exec") },
		],
		[
			{ text: "🔍 Analyze", callback_data: cb("brain_analyze") },
			{ text: "🔧 Auto-Fix", callback_data: cb("brain_fix") },
		],
		[
			{ text: "💾 Memory", callback_data: cb("brain_memory") },
			{ text: "📊 Pipeline", callback_data: cb("brain_pipeline") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Tasks list menu.
 */
async function showTasksMenu(botToken, chatId, tasks) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "tasks"

	let text = "*📋 Active Tasks*\n\n"
	if (!tasks || tasks.length === 0) {
		text += 'No active tasks. Tap "💻 New Task" to create one!'
	} else {
		for (const t of tasks) {
			const statusIcon =
				t.status === "done" ? "✅" : t.status === "failed" ? "❌" : t.status === "in_progress" ? "🟡" : "⚪"
			text +=
				statusIcon + " `" + (t.id || "unknown") + "` — " + (t.instruction || t.task || "").slice(0, 60) + "\n"
		}
	}

	const buttons = []
	if (tasks && tasks.length > 0) {
		for (const t of tasks.slice(0, 8)) {
			buttons.push([
				{
					text: "📋 " + (t.instruction || t.task || "Task").slice(0, 40),
					callback_data: cb("task_detail", t.id),
				},
			])
		}
	}

	buttons.push([
		{ text: "💻 New Task", callback_data: cb("new_task") },
		{ text: "🔄 Refresh", callback_data: cb("tasks") },
	])
	buttons.push([{ text: "🔙 Back to Menu", callback_data: cb("main") }])

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a single task detail menu.
 */
async function showTaskDetailMenu(botToken, chatId, task) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "task_detail"

	const statusIcons = {
		pending: "⏳",
		in_progress: "🟡",
		done: "✅",
		failed: "❌",
		cancelled: "🚫",
	}
	const icon = statusIcons[task.status] || "⏳"

	let text =
		"*📋 Task: " +
		(task.id || "Unknown") +
		"*\n\n" +
		"*Status:* " +
		icon +
		" " +
		(task.status || "pending") +
		"\n" +
		(task.agent ? "*Agent:* " + task.agent + "\n" : "") +
		(task.instruction ? "*Instruction:* " + task.instruction.slice(0, 200) + "\n" : "") +
		(task.result && task.result.outputSummary ? "\n*Result:* " + task.result.outputSummary.slice(0, 200) : "")

	const buttons = []

	if (task.status === "done" || task.status === "failed") {
		const row1 = []
		if (task.result && task.result.changedFiles > 0) {
			row1.push({ text: "📄 View Diff", callback_data: cb("task_diff", task.id) })
			row1.push({ text: "✅ Approve", callback_data: cb("task_approve", task.id) })
		}
		if (row1.length > 0) buttons.push(row1)

		buttons.push([
			{ text: "📊 Full Status", callback_data: cb("task_status", task.id) },
			{ text: "📋 Logs", callback_data: cb("task_logs", task.id) },
		])

		if (task.status === "failed") {
			buttons.push([{ text: "🔄 Retry", callback_data: cb("task_retry", task.id) }])
		}

		if (task.result && task.result.changedFiles > 0) {
			buttons.push([{ text: "🌐 Open in Cloud IDE", url: DASHBOARD_URL + "/dashboard?task=" + task.id }])
		}
	} else {
		buttons.push([
			{ text: "⏳ Check Status", callback_data: cb("task_status", task.id) },
			{ text: "🚫 Cancel", callback_data: cb("task_cancel", task.id) },
		])
	}

	buttons.push([
		{ text: "🔙 Back to Tasks", callback_data: cb("tasks") },
		{ text: "🏠 Main Menu", callback_data: cb("main") },
	])

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Logs menu.
 */
async function showLogsMenu(botToken, chatId) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "logs"

	const text = "*📋 View Logs*\n\n" + "Select a service to view its logs:"

	const buttons = [
		[
			{ text: "🌐 API Server", callback_data: cb("logs_api") },
			{ text: "📊 Dashboard", callback_data: cb("logs_dashboard") },
		],
		[
			{ text: "⚙️ Worker", callback_data: cb("logs_worker") },
			{ text: "🧠 Mini IDE", callback_data: cb("logs_miniide") },
		],
		[
			{ text: "🚀 Auto-Deploy", callback_data: cb("logs_autodeploy") },
			{ text: "📋 All Logs", callback_data: cb("logs_all") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Settings menu.
 */
async function showSettingsMenu(botToken, chatId) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "settings"

	const text = "*⚙️ Settings*\n\n" + "Configure your bot preferences:"

	const buttons = [
		[
			{ text: "🔐 Session Info", callback_data: cb("session") },
			{ text: "🤖 Agents", callback_data: cb("agents") },
		],
		[
			{ text: "📁 Workspace", callback_data: cb("workspace") },
			{ text: "🔑 Login", callback_data: cb("login") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show the Help menu.
 */
async function showHelpMenu(botToken, chatId) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "help"

	const text =
		"*❓ Help & Tips*\n\n" +
		"*🤖 SuperRoo Bot* is your AI coding assistant.\n\n" +
		"*How to use:*\n" +
		"• **Tap buttons** — Navigate everything visually\n" +
		"• **Type naturally** — Just say what you need\n" +
		'  *"Fix the login bug"* → Creates a coding task\n' +
		'  *"Show my projects"* → Opens project browser\n' +
		'  *"Deploy to production"* → Starts deployment\n\n' +
		"*Quick tips:*\n" +
		"• Use `/login` to authenticate (one-time)\n" +
		"• All commands work as buttons AND text\n" +
		"• Group chat? Just talk naturally — I'll respond!\n" +
		"• Need to see code? I'll link to the Cloud IDE"

	const buttons = [
		[
			{ text: "📁 Projects", callback_data: cb("projects") },
			{ text: "💻 New Task", callback_data: cb("new_task") },
		],
		[
			{ text: "🌐 Open Dashboard", url: DASHBOARD_URL },
			{ text: "🔑 Login", callback_data: cb("login") },
		],
		[{ text: "🔙 Back to Menu", callback_data: cb("main") }],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a generic confirmation dialog with Yes/No buttons.
 */
async function showConfirmDialog(botToken, chatId, question, confirmAction, cancelAction) {
	const state = getMenuState(chatId)
	state.menuHistory.push(state.currentMenu)
	state.currentMenu = "confirm"

	const buttons = [
		[
			{ text: "✅ Yes", callback_data: cb("confirm_yes", confirmAction) },
			{ text: "❌ No", callback_data: cb("confirm_no", cancelAction || "main") },
		],
	]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, question, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, question, buttons)
	}
}

/**
 * Show a "processing" message with a spinner.
 */
async function showProcessing(botToken, chatId, message) {
	const text = "⏳ *" + (message || "Processing...") + "*"
	const buttons = [[{ text: "⏳ Please wait...", callback_data: cb("noop") }]]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show an error message with a back button.
 */
async function showError(botToken, chatId, errorMessage) {
	const text = "*❌ Error*\n\n" + errorMessage
	const buttons = [[{ text: "🔙 Back to Menu", callback_data: cb("main") }]]

	if (state.menuMessageId) {
		await editMessageText(botToken, chatId, state.menuMessageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Handle a menu callback query.
 * Returns { handled: boolean, action: string, data: string|null }
 */
async function handleMenuCallback(botToken, callbackQuery, context) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""

	// Answer the callback query to remove loading state
	await answerCallbackQuery(botToken, cq.id)

	const parsed = parseMenuCallback(data)
	if (!parsed) {
		return { handled: false, action: null, data: null }
	}

	// Update the menu message ID
	setMenuState(chatId, { menuMessageId: messageId })

	const { action, data: actionData } = parsed

	// Handle navigation actions
	switch (action) {
		case "main":
			await showMainMenu(botToken, chatId, context)
			return { handled: true, action, data: actionData }

		case "projects":
			// Context should have projects list
			if (context && context.projects) {
				await showProjectsMenu(botToken, chatId, context.projects)
			} else {
				await showProjectsMenu(botToken, chatId, [])
			}
			return { handled: true, action, data: actionData }

		case "new_task":
			await showNewTaskMenu(botToken, chatId, context && context.activeProject)
			return { handled: true, action, data: actionData }

		case "deploy":
			await showDeployMenu(botToken, chatId, context && context.activeProject)
			return { handled: true, action, data: actionData }

		case "status":
			await showStatusMenu(botToken, chatId, context && context.statusData)
			return { handled: true, action, data: actionData }

		case "brain":
			await showBrainMenu(botToken, chatId)
			return { handled: true, action, data: actionData }

		case "tasks":
			await showTasksMenu(botToken, chatId, context && context.tasks)
			return { handled: true, action, data: actionData }

		case "logs":
			await showLogsMenu(botToken, chatId)
			return { handled: true, action, data: actionData }

		case "settings":
			await showSettingsMenu(botToken, chatId)
			return { handled: true, action, data: actionData }

		case "help":
			await showHelpMenu(botToken, chatId)
			return { handled: true, action, data: actionData }

		case "noop":
			// No-op button (spinner/placeholder)
			return { handled: true, action, data: actionData }

		default:
			// Not a navigation action — return for the caller to handle
			return { handled: false, action, data: actionData }
	}
}

/**
 * Send a simple text message with a "Back to Menu" button.
 * Used for non-menu responses (e.g., AI replies, status results).
 */
async function sendWithBackButton(botToken, chatId, text) {
	const buttons = [[{ text: "🔙 Back to Menu", callback_data: cb("main") }]]
	return await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	// Menu display functions
	showMainMenu,
	showProjectsMenu,
	showProjectDetailMenu,
	showNewTaskMenu,
	showDeployMenu,
	showStatusMenu,
	showBrainMenu,
	showTasksMenu,
	showTaskDetailMenu,
	showLogsMenu,
	showSettingsMenu,
	showHelpMenu,
	showConfirmDialog,
	showProcessing,
	showError,
	sendWithBackButton,

	// Callback handling
	handleMenuCallback,
	isMenuCallback,
	parseMenuCallback,

	// State management
	getMenuState,
	setMenuState,

	// Button helpers
	cb,

	// Constants
	DASHBOARD_URL,
	MINI_APP_URL,
}
