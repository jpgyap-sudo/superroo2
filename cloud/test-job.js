/**
 * SuperRoo Cloud — Test Job Publisher
 *
 * Sends a test job to the BullMQ queue so the worker picks it up.
 *
 * Usage:
 *   node test-job.js
 */

const { Queue } = require("bullmq")
const IORedis = require("ioredis")

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs"

const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null,
})

const queue = new Queue(QUEUE_NAME, { connection })

async function publish() {
	const job = await queue.add("sandbox-test", {
		task: "sandbox test with fake repo",
		commands: [
			"git clone https://github.com/octocat/Hello-World.git test-repo",
			"cd test-repo && ls -la",
			"cd test-repo && git status",
			"node -v",
			"pnpm -v",
			"git --version",
		],
	})

	console.log(`Test job published: ${job.id}`)
	await queue.close()
	process.exit(0)
}

publish().catch((err) => {
	console.error("Failed to publish test job:", err)
	process.exit(1)
})
