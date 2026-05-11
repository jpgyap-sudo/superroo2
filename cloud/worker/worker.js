/**
 * SuperRoo Cloud — Worker
 *
 * BullMQ worker that receives jobs from Redis and executes them
 * inside a Docker sandbox via sandboxRunner.
 * Supports agent jobs with agentId.
 *
 * Crash resilience features:
 * - Graceful shutdown on SIGTERM/SIGINT (drains jobs before exit)
 * - Redis connection health monitoring with circuit breaker
 * - Periodic health check logging
 * - Stalled job handling via BullMQ built-in
 * - Telegram notifications for job lifecycle events
 * - Job timeout to prevent hanging jobs
 * - Dead-letter queue for failed jobs
 * - Auto-recovery from paused state
 * - PM2 auto-restart with exponential backoff
 */

const { Worker, Queue } = require("bullmq")
const IORedis = require("ioredis")
const { runSandboxJob } = require("./sandboxRunner")
const { runAgentJob } = require("../agent-runtime/agentRunner")
const { runDebugJob } = require("./debugJobRunner")
const https = require("https")
const http = require("http")

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs"
const DLQ_NAME = QUEUE_NAME + "-dlq" // Dead-letter queue for failed jobs
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10)

/** Max consecutive Redis failures before worker pauses itself. */
const MAX_REDIS_FAILURES = parseInt(process.env.WORKER_MAX_REDIS_FAILURES || "5", 10)

/** Health check interval in ms. */
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL_MS || "30000", 10)

/** Max time (ms) a job can run before being timed out. */
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || "600000", 10)

/** Max time (ms) worker stays paused before forcing Redis reconnect. */
const MAX_PAUSE_DURATION_MS = parseInt(process.env.WORKER_MAX_PAUSE_DURATION_MS || "300000", 10)

// ---------------------------------------------------------------------------
// Redis connection for BullMQ
// ---------------------------------------------------------------------------
const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null, // required by BullMQ
	retryStrategy: (times) => {
		// Exponential backoff for Redis reconnection: 1s, 2s, 4s, 8s ... max 30s
		const delay = Math.min(1000 * Math.pow(2, times - 1), 30000)
		console.log(`[worker] Redis reconnecting in ${delay}ms (attempt ${times})...`)
		return delay
	},
	// Fail fast if Redis is unreachable, don't hang forever
	connectTimeout: 10000,
	maxRetriesPerRequest: null,
})

// Circuit breaker state
let redisFailureCount = 0
let workerPaused = false
let pausedAt = null

connection.on("connect", () => {
	console.log("[worker] Redis connected")
	redisFailureCount = 0
	if (workerPaused) {
		console.log("[worker] Resuming worker after Redis reconnection...")
		workerPaused = false
		pausedAt = null
	}
})

connection.on("error", (err) => {
	redisFailureCount++
	console.error(`[worker] Redis error (${redisFailureCount}/${MAX_REDIS_FAILURES}):`, err.message)

	if (redisFailureCount >= MAX_REDIS_FAILURES && !workerPaused) {
		console.error("[worker] Too many Redis failures — pausing worker to prevent crash loop")
		workerPaused = true
		pausedAt = Date.now()
		// BullMQ will automatically retry stalled jobs when reconnected
	}
})

// ---------------------------------------------------------------------------
// Dead-letter queue for failed jobs
// ---------------------------------------------------------------------------
const dlq = new Queue(DLQ_NAME, {
	connection,
	defaultJobOptions: {
		removeOnComplete: 100, // keep last 100 completed DLQ jobs
		removeOnFail: 50, // keep last 50 failed DLQ jobs
	},
})

/**
 * Move a failed job to the dead-letter queue for later inspection.
 */
async function moveToDeadLetterQueue(job, error) {
	try {
		await dlq.add(job.name + "-dlq", {
			originalJobId: job.id,
			originalData: job.data,
			failedAt: new Date().toISOString(),
			error: error.message,
			stack: error.stack,
		})
		console.log(`[worker] Job ${job.id} moved to DLQ (${DLQ_NAME})`)
	} catch (err) {
		console.error(`[worker] Failed to move job ${job.id} to DLQ:`, err.message)
	}
}

// ---------------------------------------------------------------------------
// Auto-recovery: if worker is paused for too long, force Redis reconnect
// ---------------------------------------------------------------------------
const recoveryInterval = setInterval(() => {
	if (workerPaused && pausedAt && Date.now() - pausedAt > MAX_PAUSE_DURATION_MS) {
		console.warn(`[worker] Worker paused for ${(Date.now() - pausedAt) / 1000}s — forcing Redis reconnect...`)
		redisFailureCount = 0
		workerPaused = false
		pausedAt = null
		// Force Redis to reconnect by disconnecting and reconnecting
		connection.disconnect()
		connection.connect().catch((err) => {
			console.error("[worker] Force reconnect failed:", err.message)
		})
	}
}, 30000) // check every 30s

recoveryInterval.unref()

// ---------------------------------------------------------------------------
// Health check heartbeat
// ---------------------------------------------------------------------------
const healthInterval = setInterval(() => {
	const status = workerPaused ? "PAUSED" : "RUNNING"
	console.log(`[worker] Health check | status=${status} | redisFailures=${redisFailureCount} | queue=${QUEUE_NAME}`)
}, HEALTH_CHECK_INTERVAL_MS)

healthInterval.unref() // Don't prevent process exit

// ---------------------------------------------------------------------------
// Telegram Notification Helper
// ---------------------------------------------------------------------------
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:3001"
const BOSS_CHAT_ID = process.env.BOSS_TELEGRAM_CHAT_ID || ""

/**
 * Send a notification to the Telegram bot via the internal API.
 * Uses the /telegram/notify endpoint to push job lifecycle updates.
 */
function sendTelegramNotification(type, taskId, instruction, extra) {
	if (!BOSS_CHAT_ID) return // no chat configured, skip

	const payload = JSON.stringify({
		chatId: BOSS_CHAT_ID,
		type,
		taskId,
		instruction: instruction || "Untitled task",
		...(extra || {}),
	})

	const url = new URL("/telegram/notify", API_BASE_URL)
	const transport = url.protocol === "https:" ? https : http

	const req = transport.request(url.toString(), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(payload),
		},
		timeout: 5000,
	})

	req.on("error", (err) => {
		console.error(`[worker] Telegram notify error (${type}):`, err.message)
	})

	req.write(payload)
	req.end()
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------
async function processJob(job) {
	if (workerPaused) {
		console.warn(`[worker] Worker paused — discarding job ${job.id}`)
		throw new Error("Worker paused due to Redis failures")
	}

	console.log(`[worker] Received job ${job.id} — task: ${job.data.task || "n/a"}`)

	try {
		if (job.data.agentId === "superroo-debugger-agent") {
			console.log(`[worker] Running Super Debug Team job ${job.id}`)
			return await runDebugJob(job)
		}

		if (job.data.agentId) {
			console.log(`[worker] Running agent job for ${job.data.agentId}`)
			const result = await runAgentJob(
				{
					id: job.id,
					agentId: job.data.agentId,
					task: job.data.task,
					commands: job.data.commands,
					network: job.data.network,
				},
				(runPayload) => runSandboxJob(runPayload),
			)
			console.log(
				`[worker] Agent job ${job.id} completed | status=${result.status} | output=${result.outputPath}`,
			)
			return result
		}

		const result = await runSandboxJob({
			id: job.id,
			task: job.data.task,
			commands: job.data.commands,
			network: job.data.network,
		})

		console.log(`[worker] Job ${job.id} completed | success=${result.success} | log=${result.logPath}`)

		return result
	} catch (error) {
		console.error(`[worker] Job ${job.id} failed:`, error.message)
		throw error // let BullMQ handle retry / dead-letter
	}
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------
const worker = new Worker(QUEUE_NAME, processJob, {
	connection,
	concurrency: CONCURRENCY,
	// Automatically retry stalled jobs (jobs running when worker crashed)
	stalledInterval: 30000, // check every 30s for stalled jobs
	maxStalledCount: 3, // retry stalled jobs up to 3 times before marking failed
	// Job timeout — prevents jobs from hanging forever
	lockDuration: JOB_TIMEOUT_MS,
})

worker.on("completed", (job, result) => {
	console.log(`[worker] completed event — job ${job.id}`)
	// Only send Telegram notification if the job originated from Telegram
	if (job.data && job.data.telegram && job.data.telegram.chatId) {
		const taskName = job.data.task || "Untitled task"
		sendTelegramNotification("task_complete", job.id, taskName, {
			result: result ? (result.success !== undefined ? (result.success ? "✅ Success" : "❌ Failed") : "✅ Completed") : "✅ Completed",
		})
	}
})

worker.on("failed", (job, err) => {
	console.error(`[worker] failed event — job ${job.id}: ${err.message}`)
	// Move to dead-letter queue for inspection
	moveToDeadLetterQueue(job, err)
	// Only send Telegram notification if the job originated from Telegram
	if (job.data && job.data.telegram && job.data.telegram.chatId) {
		const taskName = job.data.task || "Untitled task"
		sendTelegramNotification("task_failed", job.id, taskName, {
			error: err.message,
		})
	}
})

worker.on("error", (err) => {
	console.error("[worker] Worker error:", err.message)
})

worker.on("drained", () => {
	console.log("[worker] Queue drained — no more jobs to process")
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
	console.log(`\n[worker] Received ${signal} — starting graceful shutdown...`)

	clearInterval(healthInterval)
	clearInterval(recoveryInterval)

	// Close the worker gracefully (waits for active jobs to finish)
	try {
		await worker.close()
		console.log("[worker] Worker closed gracefully")
	} catch (err) {
		console.error("[worker] Error closing worker:", err.message)
	}

	// Close dead-letter queue
	try {
		await dlq.close()
		console.log("[worker] DLQ closed")
	} catch (err) {
		console.error("[worker] Error closing DLQ:", err.message)
	}

	// Close Redis connection
	try {
		await connection.quit()
		console.log("[worker] Redis connection closed")
	} catch (err) {
		console.error("[worker] Error closing Redis:", err.message)
	}

	console.log("[worker] Shutdown complete")
	process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
console.log(`[worker] Started | queue=${QUEUE_NAME} | redis=${REDIS_URL} | concurrency=${CONCURRENCY}`)
console.log(
	`[worker] Config | timeout=${process.env.JOB_TIMEOUT_MS || "600000"}ms | maxRetries=${process.env.SANDBOX_MAX_RETRIES || "2"}`,
)
