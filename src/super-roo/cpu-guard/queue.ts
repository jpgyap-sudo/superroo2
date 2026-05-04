/**
 * Super Roo — BullMQ Queue Adapter
 *
 * Optional Redis-backed job queue for agent tasks.
 * Only active when `bullmq` and `ioredis` are installed.
 * Falls back gracefully if dependencies are missing.
 */

// bullmq and ioredis are optional dependencies — only installed in the standalone package
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bullmqModule: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ioredisModule: any = null

try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	bullmqModule = require("bullmq")
} catch {
	// bullmq not installed — queue features will be unavailable
}

try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	ioredisModule = require("ioredis")
} catch {
	// ioredis not installed — queue features will be unavailable
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.AGENT_QUEUE_NAME ?? "superroo-agent-tasks"

// ── Connection ───────────────────────────────────────────────────────────────

export const connection = ioredisModule ? new ioredisModule.default(REDIS_URL, { maxRetriesPerRequest: null }) : null

// ── Queue ────────────────────────────────────────────────────────────────────

export const agentQueue =
	bullmqModule && connection
		? new bullmqModule.Queue(QUEUE_NAME, {
				connection,
				defaultJobOptions: {
					attempts: 2,
					backoff: {
						type: "exponential" as const,
						delay: 5000,
					},
					removeOnComplete: 100,
					removeOnFail: 500,
				},
			})
		: null

// ── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Enqueue an agent task to the BullMQ queue.
 * Returns null if BullMQ/Redis is not available.
 */
export async function enqueueAgentTask(name: string, payload: Record<string, unknown>): Promise<{ id: string } | null> {
	if (!agentQueue) {
		console.warn("[QUEUE] BullMQ not available. Install bullmq and ioredis to enable queueing.")
		return null
	}

	const job = await agentQueue.add(name, payload, {
		priority: Number(payload.priority ?? 5),
	})

	return { id: job.id ?? "" }
}
