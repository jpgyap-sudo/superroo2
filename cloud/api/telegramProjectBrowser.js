/**
 * Telegram Bot — Project Browser GUI (Phase 2)
 *
 * Visual project browser that replaces /projects and /specify commands.
 * Shows projects as interactive buttons with status indicators.
 * Supports project selection, detail view, and quick actions.
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
		console.error("[telegram-project-browser] sendInlineKeyboard error:", err.message)
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
		console.error("[telegram-project-browser] editMessageText error:", err.message)
		return null
	}
}

// ─── Project Browser ────────────────────────────────────────────────────────

/**
 * Show the project list as a visual browser.
 * Each project is a button row with status indicator.
 */
async function showProjectBrowser(botToken, chatId, messageId, projects, auth) {
	let text = "*📁 Project Browser*\n\n" + "Select a project to view details and actions:\n"

	if (!projects || projects.length === 0) {
		text =
			"*📁 Project Browser*\n\nNo projects found. Create one in the Cloud Dashboard first.\n\n" +
			"🌐 [" +
			DASHBOARD_URL +
			"/projects](" +
			DASHBOARD_URL +
			"/projects)"
	}

	const buttons = []

	if (projects && projects.length > 0) {
		for (const p of projects) {
			const isActive = p.is_active
			const statusIcon = isActive ? "🟢" : "⚪"
			const name = p.name || p.repoName || "Unnamed"
			const desc = p.description ? p.description.slice(0, 40) : ""
			const label = statusIcon + " " + name + (desc ? " — " + desc : "")
			buttons.push([{ text: label, callback_data: "browser:select:" + (p.id || p.name) }])
		}
	}

	// Bottom row: refresh + dashboard link
	const bottomRow = [{ text: "🔄 Refresh", callback_data: "browser:refresh" }]
	if (DASHBOARD_URL) {
		bottomRow.push({ text: "🌐 Open Dashboard", url: DASHBOARD_URL + "/projects" })
	}
	buttons.push(bottomRow)
	buttons.push([{ text: "🔙 Back to Menu", callback_data: "menu:main" }])

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a single project's detail view with all available actions.
 */
async function showProjectDetail(botToken, chatId, messageId, project, stats) {
	const name = project.name || project.repoName || "Unnamed"
	const isActive = project.is_active
	const statusText = isActive ? "🟢 *Active*" : "⚪ *Inactive*"

	let text =
		"*📁 " +
		name +
		"*\n\n" +
		"*Status:* " +
		statusText +
		"\n" +
		(project.repoName ? "*Repo:* `" + project.repoName + "`\n" : "") +
		(project.description ? "*Description:* " + project.description + "\n" : "") +
		(project.updated_at ? "*Last active:* " + new Date(project.updated_at).toLocaleString() + "\n" : "")

	// Add stats if available
	if (stats) {
		text += "\n*Stats:*\n"
		if (stats.openTasks !== undefined) text += "• 📋 Open tasks: " + stats.openTasks + "\n"
		if (stats.openPRs !== undefined) text += "• 🔀 Open PRs: " + stats.openPRs + "\n"
		if (stats.deployments !== undefined) text += "• 🚀 Deployments: " + stats.deployments + "\n"
		if (stats.branches !== undefined) text += "• 🌿 Branches: " + stats.branches + "\n"
	}

	text += "\n*Actions:*"

	const buttons = [
		// Row 1: Core actions
		[
			{ text: "💻 Create Task", callback_data: "browser:task:" + (project.id || project.name) },
			{ text: "📊 Status", callback_data: "browser:status:" + (project.id || project.name) },
		],
		// Row 2: Deploy + Logs
		[
			{ text: "🚀 Deploy", callback_data: "browser:deploy:" + (project.id || project.name) },
			{ text: "📋 Logs", callback_data: "browser:logs:" + (project.id || project.name) },
		],
		// Row 3: Tests + Brain
		[
			{ text: "🧪 Run Tests", callback_data: "browser:tests:" + (project.id || project.name) },
			{ text: "🧠 Brain", callback_data: "browser:brain:" + (project.id || project.name) },
		],
		// Row 4: Set active + Dashboard
		[
			{ text: "⭐ Set Active", callback_data: "browser:activate:" + (project.id || project.name) },
			{ text: "🌐 Open IDE", url: DASHBOARD_URL + "/dashboard?project=" + (project.id || project.name) },
		],
		// Row 5: Navigation
		[
			{ text: "🔙 Back to Projects", callback_data: "browser:list" },
			{ text: "🏠 Main Menu", callback_data: "menu:main" },
		],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a "no project selected" message with option to browse.
 */
async function showNoProjectMessage(botToken, chatId, messageId) {
	const text =
		"*📁 No Project Selected*\n\n" +
		"You need to select a project first before I can work on code.\n\n" +
		"Tap the button below to browse your projects:"

	const buttons = [
		[{ text: "📁 Browse Projects", callback_data: "browser:list" }],
		[{ text: "🔙 Back to Menu", callback_data: "menu:main" }],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Handle a project browser callback.
 * Returns { handled, action, projectId }
 */
async function handleProjectBrowserCallback(botToken, callbackQuery, auth) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""

	if (!data.startsWith("browser:")) {
		return { handled: false }
	}

	const parts = data.split(":")
	const action = parts[1] || ""
	const projectId = parts.slice(2).join(":") || null

	switch (action) {
		case "list":
			// Fetch projects and show browser
			try {
				const result = await auth.handleTelegramProjects({
					telegramUserId: cq.from.id,
					telegramChatId: chatId,
				})
				const projects = (result && result.projects) || []
				await showProjectBrowser(botToken, chatId, messageId, projects, auth)
			} catch (err) {
				console.error("[telegram-project-browser] Failed to fetch projects:", err.message)
				await showProjectBrowser(botToken, chatId, messageId, [], auth)
			}
			return { handled: true, action, projectId }

		case "select":
			// Show project detail
			try {
				const result = await auth.handleTelegramProjects({
					telegramUserId: cq.from.id,
					telegramChatId: chatId,
				})
				const projects = (result && result.projects) || []
				const project = projects.find(function (p) {
					return (p.id || p.name) === projectId
				})
				if (project) {
					await showProjectDetail(botToken, chatId, messageId, project, null)
				} else {
					await showProjectBrowser(botToken, chatId, messageId, projects, auth)
				}
			} catch (err) {
				console.error("[telegram-project-browser] Failed to select project:", err.message)
			}
			return { handled: true, action, projectId }

		case "activate":
			// Set project as active
			try {
				await auth.handleTelegramProjectSelect(projectId, {
					telegramUserId: cq.from.id,
					telegramChatId: chatId,
				})
				// Show updated detail
				const result = await auth.handleTelegramProjects({
					telegramUserId: cq.from.id,
					telegramChatId: chatId,
				})
				const projects = (result && result.projects) || []
				const project = projects.find(function (p) {
					return (p.id || p.name) === projectId
				})
				if (project) {
					await showProjectDetail(botToken, chatId, messageId, project, null)
				}
			} catch (err) {
				console.error("[telegram-project-browser] Failed to activate project:", err.message)
			}
			return { handled: true, action, projectId }

		case "refresh":
			// Refresh project list
			try {
				const result = await auth.handleTelegramProjects({
					telegramUserId: cq.from.id,
					telegramChatId: chatId,
				})
				const projects = (result && result.projects) || []
				await showProjectBrowser(botToken, chatId, messageId, projects, auth)
			} catch (err) {
				console.error("[telegram-project-browser] Failed to refresh:", err.message)
			}
			return { handled: true, action, projectId }

		default:
			// Other actions (task, status, deploy, logs, tests, brain) — return for caller
			return { handled: false, action, projectId }
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	showProjectBrowser,
	showProjectDetail,
	showNoProjectMessage,
	handleProjectBrowserCallback,
}
