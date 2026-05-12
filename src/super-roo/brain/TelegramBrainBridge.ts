import { CentralBrain } from "./CentralBrain.js"
import type { CentralBrainOptions, CentralBrainRunResult } from "./CentralBrain.js"
import type { Agent, AgentRunContext, AgentRunResult } from "../types"

export interface TelegramBrainBridgeOptions extends CentralBrainOptions {
	/** Daemon URL for fallback task posting */
	daemonUrl?: string
	daemonToken?: string
}

/**
 * TelegramBrainBridge wires Telegram messages into the Central Brain pipeline.
 *
 * Instead of posting raw tasks to the daemon, every Telegram command builds a
 * SharedContextPacket, queries RAG memory, routes via BrainRouter, executes
 * through the permission-controlled ToolRegistry, and saves the result back to
 * memory.
 *
 * Pipeline enforced:
 *   Telegram Message -> SharedContextPacket -> RAG -> Brain Router ->
 *   Permissions -> Agent Execute -> Memory Save -> Telegram Reply
 */
export class TelegramBrainBridge {
	readonly brain: CentralBrain
	private readonly daemonUrl: string
	private readonly daemonToken?: string

	constructor(options: TelegramBrainBridgeOptions = {}) {
		this.brain = new CentralBrain(options)
		this.daemonUrl = options.daemonUrl ?? process.env.SUPERROO_DAEMON_URL ?? "http://127.0.0.1:3417"
		this.daemonToken = options.daemonToken ?? process.env.SUPERROO_DAEMON_TOKEN
	}

	/**
	 * Handle a Telegram command through the Central Brain.
	 *
	 * @param command  The raw command text (e.g. "/fix login bug")
	 * @param chatId   Telegram chat ID
	 * @param userId   Telegram user ID
	 * @param messageId Message ID for reply threading
	 * @returns Short summary for Telegram + full result for dashboard
	 */
	async handleCommand(
		command: string,
		chatId: number,
		userId: number,
		messageId: number,
	): Promise<{ telegramReply: string; fullResult: CentralBrainRunResult }> {
		// Strip the command prefix to get the goal
		const goal = command.replace(/^\/[a-zA-Z0-9_]+\b/, "").trim() || command

		// Build a lightweight agent that delegates to the daemon
		// (The daemon has the real agents; Telegram is just an interface)
		const agent: Agent = {
			name: "telegram-proxy",
			description: "Proxy agent that forwards Telegram tasks to the SuperRoo daemon",
			requiredCapabilities: ["execute.command"],
			async run(ctx: AgentRunContext): Promise<AgentRunResult> {
				return { ok: true, summary: "Task forwarded to daemon" }
			},
		}

		// Build the AgentRunContext
		const ctx: AgentRunContext = {
			task: {
				id: `telegram-${chatId}-${messageId}`,
				agent: "telegram-proxy",
				goal,
				priority: "normal",
				requiredCapabilities: ["execute.command"],
				payload: {
					source: "telegram" as const,
					projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
					userId: String(userId),
					userMessage: goal,
					activeTaskId: `telegram-${chatId}-${messageId}`,
					conversationId: String(chatId),
					recentTerminalErrors: [],
				},
				maxIterations: 5,
				status: "running" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				attempts: 0,
			},
			safetyMode: "AUTO" as const,
			signal: new AbortController().signal,
			emit: (level, event, message, data?) => {
				console.log(`[telegram-brain][${level}] ${event}: ${message}`, data ?? "")
			},
		}

		// Run through CentralBrain
		const result = await this.brain.run(agent, ctx)

		// Build a short Telegram-friendly reply
		const telegramReply = this._formatTelegramReply(result, command)

		return { telegramReply, fullResult: result }
	}

	/**
	 * Handle a Telegram task command (/task, /autonomous, /fix, /plan, /code, /test, /deploy)
	 * by forwarding to the daemon BUT with brain-enriched context.
	 */
	async forwardTaskToDaemon(goal: string, chatId: number, userId: number): Promise<unknown> {
		// Build context packet enriched with RAG
		const { fullResult } = await this.handleCommand(goal, chatId, userId, 0)

		// Forward to daemon with brain context attached
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (this.daemonToken) headers.authorization = `Bearer ${this.daemonToken}`

		const response = await fetch(new URL("/tasks", this.daemonUrl), {
			method: "POST",
			headers,
			body: JSON.stringify({
				source: "telegram",
				goal,
				replyTo: { telegramChatId: String(chatId) },
				payload: {
					_brainRagContext: fullResult.ragContextText,
					_brainRoute: fullResult.route,
					_brainRouteReason: fullResult.routeReason,
					_brainMemorySaved: fullResult.memorySaved,
				},
			}),
		})

		const body = await response.json()
		if (!response.ok) {
			throw new Error(`Daemon task failed: ${response.status} ${JSON.stringify(body)}`)
		}
		return body
	}

	/**
	 * Format a brain result into a short Telegram message.
	 * Full details go to the dashboard; Telegram gets a summary.
	 */
	private _formatTelegramReply(result: CentralBrainRunResult, originalCommand: string): string {
		const cmd = originalCommand.split(" ")[0] ?? "/task"
		const status = result.ok ? "✅" : "❌"
		const route = result.route
		const memory = result.memorySaved ? "🧠" : ""

		if (result.ok) {
			return `${status} ${cmd} → ${route} ${memory}\n${result.summary.slice(0, 200)}`
		}
		return `${status} ${cmd} → ${route} ${memory}\n${result.summary.slice(0, 200)}\nError: ${result.agentResult.error?.slice(0, 100) ?? "unknown"}`
	}

	async close(): Promise<void> {
		await this.brain.close()
	}
}
