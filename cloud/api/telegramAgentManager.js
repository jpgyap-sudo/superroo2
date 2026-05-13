/**
 * Telegram Bot — Agent Manager GUI (Phase 4)
 *
 * Visual agent management system that replaces the static /agents command.
 * Shows all registered agents with status indicators, enables/disables agents,
 * and provides quick actions (run agent, view agent details).
 *
 * Integrates with:
 *   - AgentRegistry API (/orchestrator/agents) for live agent data
 *   - AgentBus API (/orchestrator/agent-bus/stats) for bus metrics
 *   - CommitDeployLog API (/orchestrator/deploys) for recent agent activity
 *   - telegramMenu for navigation
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const DASHBOARD_URL = "https://dev.abcx124.xyz"
const API_BASE = process.env.API_BASE_URL || "http://localhost:3001"

// ─── Agent Definitions (fallback when API is unavailable) ────────────────────

const DEFAULT_AGENTS = [
	{ id: "coder", name: "Coder", icon: "💻", description: "Write and modify code", enabled: true },
	{ id: "debugger", name: "Debugger", icon: "🔍", description: "Bug investigation & root cause analysis", enabled: true },
	{ id: "tester", name: "Tester", icon: "🧪", description: "Test execution & quality gates", enabled: true },
	{ id: "deployer", name: "Deployer", icon: "🚀", description: "Deployment orchestration", enabled: true },
	{ id: "planner", name: "Planner", icon: "📋", description: "Task planning & breakdown", enabled: true },
	{ id: "crawler", name: "Crawler", icon: "🕷️", description: "Web crawling & signal detection", enabled: true },
	{ id: "consultant", name: "Consultant", icon: "🧠", description: "Research & expert advice", enabled: true },
	{ id: "pm", name: "PM Agent", icon: "📊", description: "Product management & feature tracking", enabled: true },
	{ id: "self-healing", name: "Self-Healing", icon: "🩹", description: "Autonomous incident response", enabled: true },
	{ id: "orchestrator", name: "Orchestrator", icon: "🎭", description: "Multi-agent task coordination", enabled: true },
]

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
		console.error("[telegram-agent-manager] sendInlineKeyboard error:", err.message)
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
		console.error("[telegram-agent-manager] editMessageText error:", err.message)
		return null
	}
}

// ─── API Data Fetching ──────────────────────────────────────────────────────

/**
 * Fetch the list of agents from the orchestrator API.
 * Falls back to DEFAULT_AGENTS if the API is unavailable.
 */
async function fetchAgents() {
	try {
		const res = await fetch(API_BASE + "/orchestrator/agents", {
			signal: AbortSignal.timeout(5000),
		})
		if (!res.ok) throw new Error("HTTP " + res.status)
		const data = await res.json()
		if (data.success && Array.isArray(data.agents)) {
			return data.agents
		}
	} catch (err) {
		console.warn("[telegram-agent-manager] fetchAgents API unavailable, using defaults:", err.message)
	}
	return DEFAULT_AGENTS
}

/**
 * Fetch agent bus stats.
 */
async function fetchAgentBusStats() {
	try {
		const res = await fetch(API_BASE + "/orchestrator/agent-bus/stats", {
			signal: AbortSignal.timeout(5000),
		})
		if (!res.ok) throw new Error("HTTP " + res.status)
		const data = await res.json()
		if (data.success && data.stats) {
			return data.stats
		}
	} catch (err) {
		console.warn("[telegram-agent-manager] fetchAgentBusStats unavailable:", err.message)
	}
	return null
}

/**
 * Toggle an agent's enabled state via the API.
 */
async function toggleAgentApi(agentId, enabled) {
	try {
		const res = await fetch(API_BASE + "/orchestrator/agents/" + agentId + "/toggle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: enabled }),
			signal: AbortSignal.timeout(5000),
		})
		if (!res.ok) throw new Error("HTTP " + res.status)
		const data = await res.json()
		return data.success === true
	} catch (err) {
		console.warn("[telegram-agent-manager] toggleAgentApi failed:", err.message)
		return false
	}
}

/**
 * Fetch recent agent activity (deploys and commits).
 */
async function fetchRecentActivity() {
	try {
		const res = await fetch(API_BASE + "/orchestrator/deploys?limit=5", {
			signal: AbortSignal.timeout(5000),
		})
		if (!res.ok) throw new Error("HTTP " + res.status)
		const data = await res.json()
		if (data.success && Array.isArray(data.deploys)) {
			return data.deploys
		}
	} catch (err) {
		console.warn("[telegram-agent-manager] fetchRecentActivity unavailable:", err.message)
	}
	return []
}

// ─── Agent Manager Views ────────────────────────────────────────────────────

/**
 * Show the Agent Manager main view — list of all agents with status.
 */
async function showAgentManager(botToken, chatId, messageId) {
	const agents = await fetchAgents()
	const busStats = await fetchAgentBusStats()

	let text =
		"*🤖 Agent Manager*\n\n" +
		"Manage your SuperRoo agents — view status, enable/disable, and run agents.\n"

	// Bus stats summary
	if (busStats) {
		text += "\n*📊 Bus Stats:*\n"
		if (busStats.messagesSent !== undefined) text += "• Messages sent: " + busStats.messagesSent + "\n"
		if (busStats.messagesReceived !== undefined) text += "• Messages received: " + busStats.messagesReceived + "\n"
		if (busStats.activeChannels !== undefined) text += "• Active channels: " + busStats.activeChannels + "\n"
		if (busStats.queuedMessages !== undefined) text += "• Queued: " + busStats.queuedMessages + "\n"
	}

	text += "\n*Available Agents:*\n"

	const buttons = []
	for (const agent of agents) {
		const isEnabled = agent.enabled !== false
		const icon = agent.icon || getDefaultIcon(agent.id)
		const statusIcon = isEnabled ? "🟢" : "🔴"
		const label = statusIcon + " " + icon + " " + (agent.name || agent.id)
		buttons.push([
			{
				text: label,
				callback_data: "agentmgr:detail:" + agent.id,
			},
		])
	}

	// Bottom actions
	buttons.push([
		{ text: "🔄 Refresh", callback_data: "agentmgr:list" },
		{ text: "📊 Recent Activity", callback_data: "agentmgr:activity" },
	])
	buttons.push([{ text: "🔙 Back to Menu", callback_data: "menu:main" }])

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a single agent's detail view with status, description, and actions.
 */
async function showAgentDetail(botToken, chatId, messageId, agentId) {
	const agents = await fetchAgents()
	const agent = agents.find(function (a) {
		return a.id === agentId
	})

	if (!agent) {
		await showAgentManager(botToken, chatId, messageId)
		return
	}

	const isEnabled = agent.enabled !== false
	const icon = agent.icon || getDefaultIcon(agent.id)
	const statusIcon = isEnabled ? "🟢 Enabled" : "🔴 Disabled"
	const name = agent.name || agent.id

	let text =
		"*🤖 Agent: " +
		icon +
		" " +
		name +
		"*\n\n" +
		"*ID:* `" +
		agent.id +
		"`\n" +
		"*Status:* " +
		statusIcon +
		"\n" +
		(agent.description ? "*Description:* " + agent.description + "\n" : "")

	// Show capabilities if available
	if (agent.capabilities && agent.capabilities.length > 0) {
		text += "\n*Capabilities:*\n"
		for (const cap of agent.capabilities) {
			text += "• " + cap + "\n"
		}
	}

	// Show recent tasks if available
	if (agent.recentTasks && agent.recentTasks.length > 0) {
		text += "\n*Recent Tasks:*\n"
		for (const task of agent.recentTasks.slice(0, 3)) {
			text += "• `" + (task.id || "?").slice(0, 12) + "` " + (task.instruction || task.task || "").slice(0, 60) + "\n"
		}
	}

	text += "\n*Actions:*"

	const buttons = [
		[
			{
				text: isEnabled ? "🔴 Disable" : "🟢 Enable",
				callback_data: "agentmgr:toggle:" + agent.id,
			},
			{
				text: "▶️ Run Agent",
				callback_data: "agentmgr:run:" + agent.id,
			},
		],
		[
			{
				text: "📊 View Activity",
				callback_data: "agentmgr:activity:" + agent.id,
			},
			{
				text: "🌐 Open Dashboard",
				url: DASHBOARD_URL + "/dashboard?agent=" + agent.id,
			},
		],
		[
			{ text: "🔙 Back to Agents", callback_data: "agentmgr:list" },
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
 * Show recent agent activity (deploys, commits, tasks).
 */
async function showAgentActivity(botToken, chatId, messageId, filterAgentId) {
	const activity = await fetchRecentActivity()

	let text = "*📊 Recent Agent Activity*\n\n"
	if (filterAgentId) {
		text += "*Filtered by:* `" + filterAgentId + "`\n\n"
	}

	if (!activity || activity.length === 0) {
		text += "No recent activity found."
	} else {
		for (const entry of activity) {
			const statusIcon =
				entry.status === "healthy" || entry.status === "done"
					? "✅"
					: entry.status === "failed"
						? "❌"
						: entry.status === "running" || entry.status === "in_progress"
							? "🟡"
							: "⚪"
			const agentIcon = getDefaultIcon(entry.agent || entry.agentId)
			text +=
				statusIcon +
				" " +
				agentIcon +
				" `" +
				(entry.agent || entry.agentId || "?").slice(0, 16) +
				"`\n" +
				"  Version: " +
				(entry.version || entry.message || "N/A").slice(0, 60) +
				"\n" +
				(entry.created_at || entry.time
					? "  🕐 " + new Date(entry.created_at || entry.time).toLocaleString() + "\n"
					: "") +
				"\n"
		}
	}

	const buttons = [
		[
			{ text: "🔄 Refresh", callback_data: filterAgentId ? "agentmgr:activity:" + filterAgentId : "agentmgr:activity" },
			{ text: "🔙 Back to Agents", callback_data: "agentmgr:list" },
		],
		[{ text: "🏠 Main Menu", callback_data: "menu:main" }],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a confirmation dialog for toggling an agent.
 */
async function showToggleConfirm(botToken, chatId, messageId, agentId, newEnabled) {
	const agents = await fetchAgents()
	const agent = agents.find(function (a) {
		return a.id === agentId
	})
	const name = (agent && agent.name) || agentId
	const action = newEnabled ? "enable" : "disable"
	const icon = newEnabled ? "🟢" : "🔴"

	const text =
		icon +
		" *" +
		action.charAt(0).toUpperCase() +
		action.slice(1) +
		" Agent*\n\n" +
		"Are you sure you want to *" +
		action +
		 "* `" +
		name +
		"`?\n\n" +
		(newEnabled
			? "This agent will be available for task routing."
			: "This agent will be unavailable for task routing until re-enabled.")

	const buttons = [
		[
			{ text: "✅ Yes, " + action, callback_data: "agentmgr:confirm_toggle:" + agentId + ":" + newEnabled },
			{ text: "❌ Cancel", callback_data: "agentmgr:detail:" + agentId },
		],
	]

	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show a "processing" message while toggling an agent.
 */
async function showProcessing(botToken, chatId, messageId, text) {
	const buttons = [[{ text: "⏳ Please wait...", callback_data: "agentmgr:noop" }]]
	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

/**
 * Show an error message.
 */
async function showError(botToken, chatId, messageId, errorMessage) {
	const text = "*❌ Error*\n\n" + errorMessage
	const buttons = [[{ text: "🔙 Back to Agents", callback_data: "agentmgr:list" }]]
	if (messageId) {
		await editMessageText(botToken, chatId, messageId, text, buttons)
	} else {
		await sendInlineKeyboard(botToken, chatId, text, buttons)
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDefaultIcon(agentId) {
	const icons = {
		coder: "💻",
		debugger: "🔍",
		tester: "🧪",
		deployer: "🚀",
		planner: "📋",
		crawler: "🕷️",
		consultant: "🧠",
		pm: "📊",
		"self-healing": "🩹",
		orchestrator: "🎭",
		"product-manager": "📊",
		"bug-hunter": "🐛",
		"auto-deployer": "🤖",
		commissioner: "✅",
	}
	return icons[agentId] || "⚙️"
}

// ─── Callback Handler ───────────────────────────────────────────────────────

/**
 * Handle an agent manager callback query.
 * Returns { handled, action, data }
 */
async function handleAgentManagerCallback(botToken, callbackQuery) {
	const cq = callbackQuery
	const chatId = cq.message.chat.id
	const messageId = cq.message.message_id
	const data = cq.data || ""

	if (!data.startsWith("agentmgr:")) {
		return { handled: false }
	}

	const parts = data.split(":")
	const action = parts[1] || ""
	const actionData = parts.slice(2).join(":") || null

	switch (action) {
		case "list":
			await showAgentManager(botToken, chatId, messageId)
			return { handled: true, action, data: actionData }

		case "detail":
			await showAgentDetail(botToken, chatId, messageId, actionData)
			return { handled: true, action, data: actionData }

		case "toggle":
			// actionData is agentId — determine current state
			{
				const agents = await fetchAgents()
				const agent = agents.find(function (a) {
					return a.id === actionData
				})
				const isEnabled = agent ? agent.enabled !== false : true
				await showToggleConfirm(botToken, chatId, messageId, actionData, !isEnabled)
			}
			return { handled: true, action, data: actionData }

		case "confirm_toggle":
			// actionData is "agentId:true" or "agentId:false"
			{
				const toggleParts = actionData.split(":")
				const toggleAgentId = toggleParts[0]
				const newEnabled = toggleParts[1] === "true"
				await showProcessing(botToken, chatId, messageId, "⏳ *" + (newEnabled ? "Enabling" : "Disabling") + " agent...*")
				const success = await toggleAgentApi(toggleAgentId, newEnabled)
				if (success) {
					await showAgentDetail(botToken, chatId, messageId, toggleAgentId)
				} else {
					await showError(
						botToken,
						chatId,
						messageId,
						"Failed to " + (newEnabled ? "enable" : "disable") + " agent `" + toggleAgentId + "`.\n" +
						"The API may be unavailable. Try again later.",
					)
				}
			}
			return { handled: true, action, data: actionData }

		case "run":
			// actionData is agentId — route to the agent runner
			// Return unhandled so telegramBot.js can handle the actual run
			return { handled: false, action: "agent_run", data: actionData }

		case "activity":
			// actionData may be an agentId or null
			await showAgentActivity(botToken, chatId, messageId, actionData)
			return { handled: true, action, data: actionData }

		case "noop":
			return { handled: true, action, data: actionData }

		default:
			return { handled: false, action, data: actionData }
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	// View functions
	showAgentManager,
	showAgentDetail,
	showAgentActivity,

	// Callback handling
	handleAgentManagerCallback,

	// Data fetching (exported for use by telegramBot.js)
	fetchAgents,
	fetchAgentBusStats,
	fetchRecentActivity,

	// Helpers
	getDefaultIcon,
}
