import "dotenv/config"

import { normalizeSuperRooTask, SuperRooTaskSource } from "../core/SuperRooTask"
import { logHeader, logWarn } from "../core/utils/logger"

/** Telegram message entity types we care about */
export interface MessageEntity {
	type: "mention" | "bot_command" | string
	offset: number
	length: number
}

export interface TelegramChat {
	id: number
	type?: "private" | "group" | "supergroup" | "channel"
}

export interface TelegramMessage {
	message_id: number
	chat: TelegramChat
	text?: string
	entities?: MessageEntity[]
	reply_to_message?: {
		from?: { id: number; is_bot?: boolean }
	}
	from?: { id: number; is_bot?: boolean }
}

export interface MyChatMember {
	chat: TelegramChat
	from: { id: number }
	new_chat_member: { status: string }
}

export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
	my_chat_member?: MyChatMember
}

export interface BotConfig {
	token: string
	allowedChatIds: Set<string> | null
	daemonUrl: string
	daemonToken?: string
	botUsername: string
}

/**
 * Parse the ALLOWED_CHAT_ID env var.
 * Supports:
 *  - A single chat ID (positive for users, negative for groups)
 *  - Comma-separated list of chat IDs
 *  - "*" to allow all chats
 * Returns null when "*" is used (meaning allow all).
 */
export function parseAllowedChatIds(raw: string | undefined): Set<string> | null {
	if (!raw) return null
	const trimmed = raw.trim()
	if (trimmed === "*") return null // allow all
	const ids = trimmed
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
	return ids.length > 0 ? new Set(ids) : null
}

export function isChatAllowed(chatId: number, allowedChatIds: Set<string> | null): boolean {
	if (allowedChatIds === null) return true // "*" means allow all
	if (!allowedChatIds || allowedChatIds.size === 0) return true // no restriction
	return allowedChatIds.has(String(chatId))
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Strip bot mention prefix from text so commands still work.
 * E.g., "@SuperRooBot /status" -> "/status"
 */
export function stripBotMention(text: string, botUsername: string): string {
	return text.replace(new RegExp(`^@${escapeRegex(botUsername)}\\s*`, "i"), "").trim()
}

/**
 * Check if a message in a group chat is "addressed to" the bot.
 * Returns true if:
 *  1. The message is a reply to one of the bot's own messages, OR
 *  2. The message contains a @bot_username mention, OR
 *  3. The message starts with a bot_command entity (e.g., /status)
 */
export function isMessageForBot(message: TelegramMessage, botUsername: string): boolean {
	if (message.entities && message.entities.length > 0) {
		for (const entity of message.entities) {
			if (entity.type === "bot_command") return true
			if (entity.type === "mention" && message.text) {
				const mentioned = message.text.slice(entity.offset, entity.offset + entity.length)
				if (mentioned.toLowerCase() === `@${botUsername.toLowerCase()}`) return true
			}
		}
	}
	if (message.reply_to_message?.from?.is_bot) return true
	return false
}

export function createBot(config: BotConfig) {
	const { token, allowedChatIds, daemonUrl, daemonToken, botUsername } = config

	async function telegram(method: string, body: Record<string, unknown>): Promise<unknown> {
		const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "")
			throw new Error(`Telegram ${method} failed: ${response.status} ${response.statusText} — ${errorBody}`)
		}

		return response.json()
	}

	async function sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
		const body: Record<string, unknown> = { chat_id: chatId, text }
		if (replyTo) body.reply_to_message_id = replyTo
		await telegram("sendMessage", body)
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
		// Handle bot being added to a group
		if (update.my_chat_member) {
			const { chat, new_chat_member } = update.my_chat_member
			if (new_chat_member.status === "member" || new_chat_member.status === "administrator") {
				console.log(`[telegram] Bot added to chat ${chat.id} (${chat.type ?? "unknown"})`)
				if (isChatAllowed(chat.id, allowedChatIds)) {
					await sendMessage(
						chat.id,
						"Hello! I'm SuperRoo Bot. Use /status, /health, /autonomous [goal], or /task <goal> to interact with me.",
					)
				}
			}
			return
		}

		const message = update.message
		if (!message?.text) return

		const chatId = message.chat.id
		const chatType = message.chat.type ?? "private"

		// Skip messages from the bot itself
		if (message.from?.is_bot) return

		// Authorization check
		if (!isChatAllowed(chatId, allowedChatIds)) {
			// Only respond in private chats if unauthorized
			if (chatType === "private") {
				await sendMessage(chatId, "Unauthorized chat.")
			}
			return
		}

		// In group/supergroup chats, only respond if the message is addressed to the bot
		if (chatType === "group" || chatType === "supergroup") {
			if (!isMessageForBot(message, botUsername)) return
		}

		// Strip bot mention prefix so commands still parse correctly
		const rawText = stripBotMention(message.text.trim(), botUsername)

		// Handle commands
		if (rawText.startsWith("/status")) {
			const status = await getDaemon("/status")
			await sendMessage(chatId, JSON.stringify(status, null, 2).slice(0, 3500), message.message_id)
			return
		}

		if (rawText.startsWith("/health") || rawText.startsWith("/checkvps")) {
			const health = await getDaemon("/health")
			await sendMessage(chatId, JSON.stringify(health, null, 2).slice(0, 3500), message.message_id)
			return
		}

		if (rawText.startsWith("/autonomous")) {
			const goal = rawText.replace(/^\/autonomous\b/, "").trim() || "Run autonomous coding loop"
			const result = await postTask(goal, chatId)
			await sendMessage(
				chatId,
				`Queued SuperRoo task:\n${JSON.stringify(result, null, 2).slice(0, 3200)}`,
				message.message_id,
			)
			return
		}

		if (rawText.startsWith("/task")) {
			const goal = rawText.replace(/^\/task\b/, "").trim()
			if (!goal) {
				await sendMessage(chatId, "Usage: /task fix the failing checkout test", message.message_id)
				return
			}
			const result = await postTask(goal, chatId)
			await sendMessage(
				chatId,
				`Queued SuperRoo task:\n${JSON.stringify(result, null, 2).slice(0, 3200)}`,
				message.message_id,
			)
			return
		}

		// In private chats, show help for unrecognized messages
		if (chatType === "private") {
			await sendMessage(chatId, "Commands: /status, /health, /autonomous [goal], /task <goal>")
		}
	}

	return { handleUpdate, sendMessage }
}

/** Create the default bot config from environment variables */
export function defaultBotConfig(): BotConfig {
	const token = process.env.TELEGRAM_BOT_TOKEN
	const rawAllowed = process.env.TELEGRAM_ALLOWED_CHAT_ID
	const daemonUrl = process.env.SUPERROO_DAEMON_URL || "http://127.0.0.1:3417"
	const daemonToken = process.env.SUPERROO_DAEMON_TOKEN

	// Bot username from env (token prefix is the numeric ID, not the username)
	const botUsername = process.env.TELEGRAM_BOT_USERNAME || "superroo_bot"

	return {
		token: token ?? "",
		allowedChatIds: parseAllowedChatIds(rawAllowed),
		daemonUrl,
		daemonToken,
		botUsername,
	}
}

export async function startTelegramPolling(): Promise<void> {
	logHeader("SuperRoo Telegram Bot")

	const config = defaultBotConfig()
	if (!config.token) throw new Error("Missing TELEGRAM_BOT_TOKEN")

	const bot = createBot(config)

	let offset = 0
	while (true) {
		const response = await fetch(
			`https://api.telegram.org/bot${config.token}/getUpdates?timeout=30&offset=${offset}&allowed_updates=["message","my_chat_member"]`,
		)
		const data = (await response.json()) as { result?: TelegramUpdate[] }

		for (const update of data.result || []) {
			offset = update.update_id + 1
			try {
				await bot.handleUpdate(update)
			} catch (error) {
				logWarn(error instanceof Error ? error.message : String(error))
				const chatId = update.message?.chat.id ?? update.my_chat_member?.chat.id
				if (chatId) {
					await bot.sendMessage(
						chatId,
						`SuperRoo command failed: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
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
