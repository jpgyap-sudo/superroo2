import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@superroo/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"

/**
 * CentralBrainHandler — routes ALL LLM calls through the Central Brain daemon.
 *
 * Instead of calling an LLM directly, this handler sends the system prompt and
 * messages to the Central Brain daemon's /brain/run endpoint (source=vscode).
 * The daemon handles:
 *   - RAG context retrieval from PostgreSQL + pgvector
 *   - Model routing (Ollama for cheap tasks, cloud for complex)
 *   - Permission gating (safety enforcement)
 *   - Memory persistence (saves every interaction)
 *   - Audit logging
 *
 * This ensures VS Code uses the SAME brain as Cloud IDE and Telegram.
 */
export class CentralBrainHandler implements ApiHandler {
	private readonly brainUrl: string
	private readonly deviceToken?: string

	constructor(private options: ApiHandlerOptions) {
		this.brainUrl = options.centralBrainUrl ?? "http://127.0.0.1:3417"
		this.deviceToken = options.centralBrainToken
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Build the user message from the conversation
		const lastUserMessage = messages.filter((m) => m.role === "user").pop()
		const userMessage = lastUserMessage?.content
			? typeof lastUserMessage.content === "string"
				? lastUserMessage.content
				: lastUserMessage.content.map((c) => (typeof c === "string" ? c : c.type === "text" ? c.text : "")).join("\n")
			: systemPrompt

		// Send to Central Brain daemon
		const res = await fetch(`${this.brainUrl}/brain/run`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(this.deviceToken ? { authorization: `Bearer ${this.deviceToken}` } : {}),
			},
			body: JSON.stringify({
				source: "vscode",
				projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
				userMessage,
				systemPrompt,
				agent: "coder",
				taskId: metadata?.taskId,
			}),
			signal: AbortSignal.timeout(120_000),
		})

		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Central Brain request failed: ${res.status} ${body}`)
		}

		const json = (await res.json()) as {
			ok: boolean
			summary: string
			route: string
			memorySaved: boolean
		}

		if (!json.ok) {
			throw new Error(`Central Brain returned error: ${json.summary}`)
		}

		// Yield the summary as a text chunk
		yield { type: "text", text: json.summary }
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "central-brain",
			info: {
				// Central Brain is a meta-provider — actual model is chosen by the brain router
				maxTokens: 128_000,
				contextWindow: 128_000,
				supportsPromptCache: false,
				supportsImages: true,
			},
		}
	}

	async countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
		// Approximate token count — the daemon handles real counting
		const text = content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
		return Math.ceil(text.length / 4)
	}
}
