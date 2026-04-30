import "dotenv/config"

import { normalizeSuperRooTask, SuperRooTaskSource } from "../core/SuperRooTask"
import { logHeader, logWarn } from "../core/utils/logger"

interface TelegramUpdate {
	message?: {
		chat: { id: number }
		text?: string
	}
}

const token = process.env.TELEGRAM_BOT_TOKEN
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
const daemonUrl = process.env.SUPERROO_DAEMON_URL || "http://127.0.0.1:3417"
const daemonToken = process.env.SUPERROO_DAEMON_TOKEN

async function telegram(method: string, body: Record<string, unknown>): Promise<void> {
	if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN")

	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		throw new Error(`Telegram ${method} failed: ${response.status} ${response.statusText}`)
	}
}

async function sendMessage(chatId: number, text: string): Promise<void> {
	await telegram("sendMessage", { chat_id: chatId, text })
}

function daemonHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (daemonToken) headers.authorization = `Bearer ${daemonToken}`
	return headers
}

async function getDaemon(pathname: string): Promise<unknown> {
	const response = await fetch(new URL(pathname, daemonUrl), { headers: daemonHeaders() })
	const body = await response.json()
	if (!response.ok) {
		throw new Error(`Daemon ${pathname} failed: ${response.status} ${JSON.stringify(body)}`)
	}
	return body
}

async function postTask(goal: string, chatId: number): Promise<unknown> {
	const task = normalizeSuperRooTask({
		source: SuperRooTaskSource.TELEGRAM,
		goal,
		replyTo: { telegramChatId: String(chatId) },
	})
	const response = await fetch(new URL("/tasks", daemonUrl), {
		method: "POST",
		headers: daemonHeaders(),
		body: JSON.stringify(task),
	})
	const body = await response.json()
	if (!response.ok) {
		throw new Error(`Daemon task failed: ${response.status} ${JSON.stringify(body)}`)
	}
	return body
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
	const message = update.message
	if (!message?.text) return

	const chatId = message.chat.id
	if (allowedChatId && String(chatId) !== allowedChatId) {
		await sendMessage(chatId, "Unauthorized chat.")
		return
	}

	const text = message.text.trim()

	if (text.startsWith("/status")) {
		const status = await getDaemon("/status")
		await sendMessage(chatId, JSON.stringify(status, null, 2).slice(0, 3500))
		return
	}

	if (text.startsWith("/health") || text.startsWith("/checkvps")) {
		const health = await getDaemon("/health")
		await sendMessage(chatId, JSON.stringify(health, null, 2).slice(0, 3500))
		return
	}

	if (text.startsWith("/autonomous")) {
		const goal = text.replace(/^\/autonomous\b/, "").trim() || "Run autonomous coding loop"
		const result = await postTask(goal, chatId)
		await sendMessage(chatId, `Queued SuperRoo task:\n${JSON.stringify(result, null, 2).slice(0, 3200)}`)
		return
	}

	if (text.startsWith("/task")) {
		const goal = text.replace(/^\/task\b/, "").trim()
		if (!goal) {
			await sendMessage(chatId, "Usage: /task fix the failing checkout test")
			return
		}
		const result = await postTask(goal, chatId)
		await sendMessage(chatId, `Queued SuperRoo task:\n${JSON.stringify(result, null, 2).slice(0, 3200)}`)
		return
	}

	await sendMessage(chatId, "Commands: /status, /health, /autonomous [goal], /task <goal>")
}

export async function startTelegramPolling(): Promise<void> {
	logHeader("SuperRoo Telegram Bot")

	if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN")

	let offset = 0
	while (true) {
		const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`)
		const data = (await response.json()) as { result?: Array<TelegramUpdate & { update_id: number }> }

		for (const update of data.result || []) {
			offset = update.update_id + 1
			try {
				await handleUpdate(update)
			} catch (error) {
				logWarn(error instanceof Error ? error.message : String(error))
				const chatId = update.message?.chat.id
				if (chatId) await sendMessage(chatId, `SuperRoo command failed: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	}
}

if (require.main === module) {
	startTelegramPolling().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
