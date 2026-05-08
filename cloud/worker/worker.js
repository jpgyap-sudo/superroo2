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
 */

const { Worker } = require("bullmq")
const IORedis = require("ioredis")
const { runSandboxJob } = require("./sandboxRunner")
const { runAgentJob } = require("../agent-runtime/agentRunner")

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs"
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10)

/** Max consecutive Redis failures before worker pauses itself. */
const MAX_REDIS_FAILURES = parseInt(process.env.WORKER_MAX_REDIS_FAILURES || "5", 10)

/** Health check interval in ms. */
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL_MS || "30000", 10)

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

connection.on("connect", () => {
	console.log("[worker] Redis connected")
	redisFailureCount = 0
	if (workerPaused) {
		console.log("[worker] Resuming worker after Redis reconnection...")
		workerPaused = false
	}
})

connection.on("error", (err) => {
	redisFailureCount++
	console.error(`[worker] Redis error (${redisFailureCount}/${MAX_REDIS_FAILURES}):`, err.message)

	if (redisFailureCount >= MAX_REDIS_FAILURES && !workerPaused) {
		console.error("[worker] Too many Redis failures — pausing worker to prevent crash loop")
		workerPaused = true
		// BullMQ will automatically retry stalled jobs when reconnected
	}
})

// ---------------------------------------------------------------------------
// Health check heartbeat
// ---------------------------------------------------------------------------
const healthInterval = setInterval(() => {
	const status = workerPaused ? "PAUSED" : "RUNNING"
	console.log(`[worker] Health check | status=${status} | redisFailures=${redisFailureCount} | queue=${QUEUE_NAME}`)
}, HEALTH_CHECK_INTERVAL_MS)

healthInterval.unref() // Don't prevent process exit

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
})

worker.on("completed", (job, result) => {
	console.log(`[worker] completed event — job ${job.id}`)
})

worker.on("failed", (job, err) => {
	console.error(`[worker] failed event — job ${job.id}: ${err.message}`)
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

	// Close the worker gracefully (waits for active jobs to finish)
	try {
		await worker.close()
		console.log("[worker] Worker closed gracefully")
	} catch (err) {
		console.error("[worker] Error closing worker:", err.message)
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
