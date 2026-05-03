/**
 * SuperRoo Cloud — Worker
 *
 * BullMQ worker that receives jobs from Redis and executes them
 * inside a Docker sandbox via sandboxRunner.
 * Supports agent jobs with agentId.
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

// ---------------------------------------------------------------------------
// Redis connection for BullMQ
// ---------------------------------------------------------------------------
const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null, // required by BullMQ
})

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------
async function processJob(job) {
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

console.log(`[worker] Started | queue=${QUEUE_NAME} | redis=${REDIS_URL} | concurrency=${CONCURRENCY}`)
