/**
 * Super Roo — Agent Communication Bus.
 *
 * Enables direct agent-to-agent messaging for parallel coordination.
 * Instead of agents only communicating through follow-up tasks (which
 * requires going through the orchestrator queue), agents can now:
 *
 *   1. Send direct messages to other agents
 *   2. Subscribe to specific event types from other agents
 *   3. Request information from other agents synchronously
 *   4. Broadcast status updates to all agents
 *
 * This enables true parallel coordination patterns:
 *   - Coder asks Debugger for root cause analysis mid-task
 *   - Tester notifies Coder of test failures in real-time
 *   - PM broadcasts feature status changes to all agents
 *   - Self-healing agent requests diagnostics from Debugger
 */

import type { AgentRunResult, TaskPriority } from "../types"
import type { EventLog } from "../logging/EventLog"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type AgentMessagePriority = "low" | "normal" | "high" | "critical"

export interface AgentMessage {
	id: string
	from: string
	to: string
	type: string
	payload: unknown
	priority: AgentMessagePriority
	timestamp: number
	correlationId?: string
	replyTo?: string
}

export interface AgentMessageHandler {
	(message: AgentMessage): Promise<AgentMessage | void> | AgentMessage | void
}

export interface AgentSubscription {
	agentName: string
	messageTypes: string[]
	handler: AgentMessageHandler
}

export interface AgentBusStats {
	totalMessagesSent: number
	totalMessagesDelivered: number
	pendingMessages: number
	activeSubscriptions: number
	agentsOnline: string[]
}

// ──────────────────────────────────────────────────────────────────────────────
// AgentBus
// ──────────────────────────────────────────────────────────────────────────────

export class AgentBus {
	private subscriptions: Map<string, AgentSubscription[]> = new Map()
	private pendingMessages: AgentMessage[] = []
	private agentsOnline: Set<string> = new Set()
	private messageCounter = 0
	private deliveredCount = 0

	constructor(private readonly events: EventLog) {}

	// ── Agent lifecycle ───────────────────────────────────────────────────

	/**
	 * Register an agent as online and ready to receive messages.
	 */
	registerAgent(agentName: string): void {
		this.agentsOnline.add(agentName)
		this.events.info("agentbus.agent_online", `Agent '${agentName}' registered on bus`, {
			data: { agentName, onlineCount: this.agentsOnline.size },
		})
	}

	/**
	 * Unregister an agent (e.g., when it shuts down).
	 */
	unregisterAgent(agentName: string): void {
		this.agentsOnline.delete(agentName)
		// Remove all subscriptions for this agent
		for (const [type, subs] of this.subscriptions) {
			this.subscriptions.set(
				type,
				subs.filter((s) => s.agentName !== agentName),
			)
		}
		this.events.info("agentbus.agent_offline", `Agent '${agentName}' unregistered from bus`, {
			data: { agentName, onlineCount: this.agentsOnline.size },
		})
	}

	/**
	 * Check if an agent is online.
	 */
	isAgentOnline(agentName: string): boolean {
		return this.agentsOnline.has(agentName)
	}

	/**
	 * Get list of all online agents.
	 */
	getOnlineAgents(): string[] {
		return Array.from(this.agentsOnline)
	}

	// ── Messaging ────────────────────────────────────────────────────────

	/**
	 * Send a message to a specific agent.
	 * Returns the message ID if the agent is online, or null if offline.
	 */
	async send(message: Omit<AgentMessage, "id" | "timestamp">): Promise<string | null> {
		const id = `msg_${++this.messageCounter}_${Date.now()}`
		const fullMessage: AgentMessage = {
			...message,
			id,
			timestamp: Date.now(),
		}

		this.events.debug("agentbus.send", `Message ${id}: ${message.from} → ${message.to} (${message.type})`, {
			data: {
				from: message.from,
				to: message.to,
				type: message.type,
				priority: message.priority,
			},
		})

		// Check if target agent is online
		if (!this.agentsOnline.has(message.to)) {
			this.pendingMessages.push(fullMessage)
			this.events.warn("agentbus.offline", `Agent '${message.to}' offline, message ${id} queued`, {
				data: { messageId: id, from: message.from, to: message.to },
			})
			return id
		}

		await this.deliver(fullMessage)
		return id
	}

	/**
	 * Broadcast a message to all online agents (except sender).
	 */
	async broadcast(
		from: string,
		type: string,
		payload: unknown,
		priority: AgentMessagePriority = "normal",
	): Promise<string[]> {
		const ids: string[] = []
		const targets = Array.from(this.agentsOnline).filter((a) => a !== from)

		for (const to of targets) {
			const id = await this.send({ from, to, type, payload, priority })
			if (id) ids.push(id)
		}

		return ids
	}

	/**
	 * Request-response pattern: send a message and wait for a reply.
	 * The target agent's handler should return a response message.
	 */
	async request(
		from: string,
		to: string,
		type: string,
		payload: unknown,
		timeoutMs = 30_000,
	): Promise<AgentMessage | null> {
		const correlationId = `req_${++this.messageCounter}_${Date.now()}`

		// Set up a one-shot listener for the reply
		const replyPromise = new Promise<AgentMessage | null>((resolve) => {
			const timeout = setTimeout(() => {
				this.unsubscribe(from, "reply", replyHandler)
				resolve(null)
			}, timeoutMs)

			const replyHandler: AgentMessageHandler = (msg) => {
				if (msg.correlationId === correlationId) {
					clearTimeout(timeout)
					this.unsubscribe(from, "reply", replyHandler)
					resolve(msg)
				}
			}

			this.subscribe(from, "reply", replyHandler)
		})

		await this.send({
			from,
			to,
			type,
			payload,
			priority: "high",
			correlationId,
		})

		return replyPromise
	}

	/**
	 * Reply to a specific message (used by request-response).
	 */
	async reply(original: AgentMessage, payload: unknown): Promise<string | null> {
		return this.send({
			from: original.to,
			to: original.from,
			type: "reply",
			payload,
			priority: original.priority,
			correlationId: original.correlationId,
		})
	}

	// ── Subscriptions ─────────────────────────────────────────────────────

	/**
	 * Subscribe to messages of a specific type.
	 * Returns an unsubscribe function.
	 */
	subscribe(agentName: string, messageType: string, handler: AgentMessageHandler): () => void {
		const sub: AgentSubscription = { agentName, messageTypes: [messageType], handler }

		const existing = this.subscriptions.get(messageType) ?? []
		existing.push(sub)
		this.subscriptions.set(messageType, existing)

		this.events.debug("agentbus.subscribe", `Agent '${agentName}' subscribed to '${messageType}'`)

		return () => {
			this.unsubscribe(agentName, messageType, handler)
		}
	}

	/**
	 * Subscribe to multiple message types at once.
	 */
	subscribeMany(agentName: string, messageTypes: string[], handler: AgentMessageHandler): () => void {
		const unsubs = messageTypes.map((type) => this.subscribe(agentName, type, handler))
		return () => unsubs.forEach((fn) => fn())
	}

	private unsubscribe(agentName: string, messageType: string, handler: AgentMessageHandler): void {
		const existing = this.subscriptions.get(messageType)
		if (!existing) return

		this.subscriptions.set(
			messageType,
			existing.filter((s) => s.agentName !== agentName || s.handler !== handler),
		)
	}

	// ── Delivery ─────────────────────────────────────────────────────────

	private async deliver(message: AgentMessage): Promise<void> {
		this.deliveredCount++

		// Deliver to type-specific subscribers whose agentName matches the recipient
		const typeSubs = (this.subscriptions.get(message.type) ?? []).filter((s) => s.agentName === message.to)
		const wildcardSubs = (this.subscriptions.get("*") ?? []).filter((s) => s.agentName === message.to)

		const allHandlers = [...typeSubs, ...wildcardSubs]

		for (const sub of allHandlers) {
			try {
				const result = await sub.handler(message)
				// If the handler returned a message and this is a request, auto-reply
				if (result && message.correlationId && !message.replyTo) {
					await this.reply(message, result.payload ?? result)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.events.error(
					"agentbus.delivery_error",
					`Failed to deliver ${message.id} to ${sub.agentName}: ${msg}`,
					{
						data: { messageId: message.id, subscriber: sub.agentName },
					},
				)
			}
		}

		this.events.debug(
			"agentbus.delivered",
			`Message ${message.id} delivered to ${allHandlers.length} subscribers`,
			{
				data: { messageId: message.id, subscriberCount: allHandlers.length },
			},
		)
	}

	// ── Stats ─────────────────────────────────────────────────────────────

	getStats(): AgentBusStats {
		return {
			totalMessagesSent: this.messageCounter,
			totalMessagesDelivered: this.deliveredCount,
			pendingMessages: this.pendingMessages.length,
			activeSubscriptions: Array.from(this.subscriptions.values()).reduce((a, b) => a + b.length, 0),
			agentsOnline: Array.from(this.agentsOnline),
		}
	}

	/**
	 * Drain all pending messages (for agents that came back online).
	 */
	async drainPending(): Promise<number> {
		const pending = [...this.pendingMessages]
		this.pendingMessages = []

		let delivered = 0
		for (const msg of pending) {
			if (this.agentsOnline.has(msg.to)) {
				await this.deliver(msg)
				delivered++
			} else {
				this.pendingMessages.push(msg) // re-queue
			}
		}

		return delivered
	}

	/**
	 * Clear all subscriptions and pending messages.
	 */
	reset(): void {
		this.subscriptions.clear()
		this.pendingMessages = []
		this.agentsOnline.clear()
		this.messageCounter = 0
		this.deliveredCount = 0
	}
}
