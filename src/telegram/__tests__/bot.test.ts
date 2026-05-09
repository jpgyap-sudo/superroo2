import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fetch globally
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock logger
vi.mock("../../core/utils/logger", () => ({
	logHeader: vi.fn(),
	logWarn: vi.fn(),
}))

// Mock SuperRooTask
vi.mock("../../core/SuperRooTask", () => ({
	normalizeSuperRooTask: vi.fn((input) => ({
		...input,
		source: "telegram",
		agent: "coder",
		priority: "normal",
		maxIterations: 5,
		requiredCapabilities: [],
		payload: {},
	})),
	SuperRooTaskSource: { TELEGRAM: "telegram" },
}))

// ----- Pure function tests (imported from bot module) -----

describe("parseAllowedChatIds", () => {
	it("returns null for undefined input", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		expect(parseAllowedChatIds(undefined)).toBeNull()
	})

	it("returns null for empty string", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		expect(parseAllowedChatIds("")).toBeNull()
	})

	it("returns null for wildcard", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		expect(parseAllowedChatIds("*")).toBeNull()
	})

	it("parses a single chat ID", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		const result = parseAllowedChatIds("12345")
		expect(result).toBeInstanceOf(Set)
		expect(result!.has("12345")).toBe(true)
		expect(result!.size).toBe(1)
	})

	it("parses comma-separated chat IDs", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		const result = parseAllowedChatIds("12345, -10098765432, 999")
		expect(result).toBeInstanceOf(Set)
		expect(result!.has("12345")).toBe(true)
		expect(result!.has("-10098765432")).toBe(true)
		expect(result!.has("999")).toBe(true)
		expect(result!.size).toBe(3)
	})

	it("handles whitespace around IDs", async () => {
		const { parseAllowedChatIds } = await import("../bot")
		const result = parseAllowedChatIds("  111,  222 , 333  ")
		expect(result!.has("111")).toBe(true)
		expect(result!.has("222")).toBe(true)
		expect(result!.has("333")).toBe(true)
	})
})

describe("isChatAllowed", () => {
	it("allows all when allowedChatIds is null (wildcard)", async () => {
		const { isChatAllowed } = await import("../bot")
		expect(isChatAllowed(12345, null)).toBe(true)
		expect(isChatAllowed(-10012345, null)).toBe(true)
	})

	it("allows all when allowedChatIds is empty", async () => {
		const { isChatAllowed } = await import("../bot")
		expect(isChatAllowed(12345, new Set())).toBe(true)
	})

	it("allows when chat ID is in the set", async () => {
		const { isChatAllowed } = await import("../bot")
		const allowed = new Set(["12345", "-100999"])
		expect(isChatAllowed(12345, allowed)).toBe(true)
		expect(isChatAllowed(-100999, allowed)).toBe(true)
	})

	it("denies when chat ID is not in the set", async () => {
		const { isChatAllowed } = await import("../bot")
		const allowed = new Set(["12345"])
		expect(isChatAllowed(99999, allowed)).toBe(false)
		expect(isChatAllowed(-100999, allowed)).toBe(false)
	})
})

describe("stripBotMention", () => {
	it("strips @botusername prefix", async () => {
		const { stripBotMention } = await import("../bot")
		expect(stripBotMention("@MyBot /status", "MyBot")).toBe("/status")
	})

	it("strips @botusername prefix with trailing spaces", async () => {
		const { stripBotMention } = await import("../bot")
		expect(stripBotMention("@MyBot   /task fix bug", "MyBot")).toBe("/task fix bug")
	})

	it("is case-insensitive", async () => {
		const { stripBotMention } = await import("../bot")
		expect(stripBotMention("@mybot /health", "MyBot")).toBe("/health")
	})

	it("returns original text if no mention", async () => {
		const { stripBotMention } = await import("../bot")
		expect(stripBotMention("/status", "MyBot")).toBe("/status")
	})

	it("returns original text if different mention", async () => {
		const { stripBotMention } = await import("../bot")
		expect(stripBotMention("@OtherBot /status", "MyBot")).toBe("@OtherBot /status")
	})
})

describe("isMessageForBot", () => {
	const botUsername = "SuperRooBot"

	it("returns true for bot_command entity", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 1,
			chat: { id: -100123, type: "supergroup" as const },
			text: "/status",
			entities: [{ type: "bot_command", offset: 0, length: 7 }],
		}
		expect(isMessageForBot(msg, botUsername)).toBe(true)
	})

	it("returns true for @mention of the bot", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 2,
			chat: { id: -100123, type: "supergroup" as const },
			text: "@SuperRooBot /status",
			entities: [{ type: "mention", offset: 0, length: 12 }],
		}
		expect(isMessageForBot(msg, botUsername)).toBe(true)
	})

	it("returns true when replying to bot message", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 3,
			chat: { id: -100123, type: "supergroup" as const },
			text: "what do you think?",
			reply_to_message: {
				from: { id: 999, is_bot: true },
			},
		}
		expect(isMessageForBot(msg, botUsername)).toBe(true)
	})

	it("returns false for regular group message without mention", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 4,
			chat: { id: -100123, type: "supergroup" as const },
			text: "hello everyone",
		}
		expect(isMessageForBot(msg, botUsername)).toBe(false)
	})

	it("returns false for mention of different bot", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 5,
			chat: { id: -100123, type: "supergroup" as const },
			text: "@OtherBot hello",
			entities: [{ type: "mention", offset: 0, length: 9 }],
		}
		expect(isMessageForBot(msg, botUsername)).toBe(false)
	})

	it("returns false when replying to a user (not bot)", async () => {
		const { isMessageForBot } = await import("../bot")
		const msg = {
			message_id: 6,
			chat: { id: -100123, type: "supergroup" as const },
			text: "good point!",
			reply_to_message: {
				from: { id: 555, is_bot: false },
			},
		}
		expect(isMessageForBot(msg, botUsername)).toBe(false)
	})
})

describe("handleUpdate integration (via createBot)", () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it("handles my_chat_member update (bot added to group)", async () => {
		// Mock the Telegram API response for sendMessage
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 1,
			my_chat_member: {
				chat: { id: -1001234567890, type: "supergroup" },
				from: { id: 555 },
				new_chat_member: { status: "member" },
			},
		})

		// Should have called Telegram API to send welcome message
		expect(mockFetch).toHaveBeenCalledTimes(1)
		const callUrl = mockFetch.mock.calls[0][0] as string
		expect(callUrl).toContain("sendMessage")
		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(callBody.chat_id).toBe(-1001234567890)
		expect(callBody.text).toContain("SuperRoo Bot")
	})

	it("ignores regular group messages not addressed to bot", async () => {
		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 2,
			message: {
				message_id: 10,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "hello everyone, how's it going?",
				from: { id: 555, is_bot: false },
			},
		})

		// Should NOT call Telegram API for non-addressed group messages
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("responds to bot command in group chat", async () => {
		// Mock daemon /health response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, uptimeMs: 12345, mode: "safe" }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 3,
			message: {
				message_id: 11,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "/health",
				entities: [{ type: "bot_command", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		// Should have called daemon AND Telegram API
		expect(mockFetch).toHaveBeenCalledTimes(2)
		// First call should be to daemon /health
		const firstUrl = String(mockFetch.mock.calls[0][0])
		expect(firstUrl).toContain("/health")
		// Second call should be sendMessage with reply_to_message_id
		const sendCall = JSON.parse(mockFetch.mock.calls[1][1].body)
		expect(sendCall.reply_to_message_id).toBe(11)
	})

	it("responds to @mention in group chat", async () => {
		// Mock daemon /status response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, running: true }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 4,
			message: {
				message_id: 12,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "@123456 /status",
				entities: [{ type: "mention", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(2)
	})

	it("responds to reply to bot message in group chat", async () => {
		// Mock daemon /status response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, running: true }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 5,
			message: {
				message_id: 13,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "/status",
				entities: [{ type: "bot_command", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(2)
	})

	it("responds to private chat messages", async () => {
		// Mock daemon /status response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, running: true }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 6,
			message: {
				message_id: 14,
				chat: { id: 12345, type: "private" },
				text: "/status",
				entities: [{ type: "bot_command", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(2)
	})

	it("rejects unauthorized private chat", async () => {
		// Mock Telegram sendMessage response for unauthorized message
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: new Set(["99999"]),
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 7,
			message: {
				message_id: 15,
				chat: { id: 12345, type: "private" },
				text: "/status",
				entities: [{ type: "bot_command", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(callBody.text).toBe("Unauthorized chat.")
	})

	it("silently ignores unauthorized group chat messages", async () => {
		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: new Set(["99999"]),
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 8,
			message: {
				message_id: 16,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "/status",
				entities: [{ type: "bot_command", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		// Should NOT respond in unauthorized group chats
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("shows help for unrecognized commands in private chat", async () => {
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 9,
			message: {
				message_id: 17,
				chat: { id: 12345, type: "private" },
				text: "some random message",
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(callBody.text).toContain("Commands:")
	})

	it("ignores unrecognized messages in group chat (no help shown)", async () => {
		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 10,
			message: {
				message_id: 18,
				chat: { id: -1001234567890, type: "supergroup" },
				text: "some random message",
				entities: [{ type: "mention", offset: 0, length: 7 }],
				from: { id: 555, is_bot: false },
			},
		})

		// In group chat, unrecognized commands should not show help
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("handles /task command with goal", async () => {
		// Mock daemon POST /tasks response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, task: { id: "task-1" } }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 11,
			message: {
				message_id: 19,
				chat: { id: 12345, type: "private" },
				text: "/task fix the login bug",
				entities: [{ type: "bot_command", offset: 0, length: 5 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(2)
		// First call should be POST to /tasks
		const firstUrl = String(mockFetch.mock.calls[0][0])
		expect(firstUrl).toContain("/tasks")
		expect(mockFetch.mock.calls[0][1].method).toBe("POST")
		const taskBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(taskBody.goal).toBe("fix the login bug")
	})

	it("shows usage when /task has no goal", async () => {
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 12,
			message: {
				message_id: 20,
				chat: { id: 12345, type: "private" },
				text: "/task",
				entities: [{ type: "bot_command", offset: 0, length: 5 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(callBody.text).toContain("Usage:")
	})

	it("handles /autonomous command with default goal", async () => {
		// Mock daemon POST /tasks response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, task: { id: "task-2" } }),
		})
		// Mock Telegram sendMessage response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		await bot.handleUpdate({
			update_id: 13,
			message: {
				message_id: 21,
				chat: { id: 12345, type: "private" },
				text: "/autonomous",
				entities: [{ type: "bot_command", offset: 0, length: 12 }],
				from: { id: 555, is_bot: false },
			},
		})

		expect(mockFetch).toHaveBeenCalledTimes(2)
		const taskBody = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(taskBody.goal).toBe("Run autonomous coding loop")
	})

	it("handles errors gracefully and sends error message", async () => {
		// Mock daemon to fail
		mockFetch.mockRejectedValueOnce(new Error("Daemon unreachable"))
		// Mock Telegram sendMessage for error response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
			text: async () => "",
		})

		const { createBot } = await import("../bot")
		const bot = createBot({
			token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
			allowedChatIds: null,
			daemonUrl: "http://127.0.0.1:3417",
			daemonToken: "test-daemon-token",
			botUsername: "123456",
		})

		// handleUpdate does not catch errors internally; the polling loop does.
		// So we expect the promise to reject.
		await expect(
			bot.handleUpdate({
				update_id: 14,
				message: {
					message_id: 22,
					chat: { id: 12345, type: "private" },
					text: "/status",
					entities: [{ type: "bot_command", offset: 0, length: 7 }],
					from: { id: 555, is_bot: false },
				},
			}),
		).rejects.toThrow("Daemon unreachable")

		// Should have called fetch once (the daemon call) before rejecting
		expect(mockFetch).toHaveBeenCalledTimes(1)
	})
})
