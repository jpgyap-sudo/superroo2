/**
 * SuperRoo Cloud — Orchestrator Worker
 *
 * Dedicated BullMQ worker that consumes orchestrator sub-tasks and routes them
 * to the appropriate agent runner (CoderRunner, DebuggerRunner, TesterRunner, etc.).
 *
 * This is the missing link between TaskExecutor (which creates sub-tasks) and
 * actual execution on the VPS. Without this worker, sub-tasks sit in the queue
 * and never get processed.
 *
 * Architecture:
 *   TaskExecutor.submit() → BullMQ queue (orchestrator-subtasks queue)
 *   → orchestratorWorker.js (this file)
 *   → agentRunners.executeRunner(type, job)
 *   → result written back to TaskQueueBullMQ
 *
 * Crash resilience:
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - Redis connection health monitoring with circuit breaker
 *   - Stalled job handling via BullMQ built-in
 *   - Job timeout to prevent hanging
 *   - Dead-letter queue for failed jobs
 *   - Auto-recovery from paused state
 */

const { Worker, Queue } = require("bullmq")
const IORedis = require("ioredis")
const { executeRunner } = require("./agentRunners")
const path = require("path")

// ── Configuration ─────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.ORCHESTRATOR_QUEUE_NAME || "superroo-orchestrator"
const DLQ_NAME = QUEUE_NAME + "-dlq"
const CONCURRENCY = parseInt(process.env.ORCHESTRATOR_WORKER_CONCURRENCY || "3", 10)
const MAX_REDIS_FAILURES = parseInt(process.env.ORCHESTRATOR_MAX_REDIS_FAILURES || "5", 10)
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.ORCHESTRATOR_HEALTH_INTERVAL || "30000", 10)
const JOB_TIMEOUT_MS = parseInt(process.env.ORCHESTRATOR_JOB_TIMEOUT || "600000", 10)
const MAX_PAUSE_DURATION_MS = parseInt(process.env.ORCHESTRATOR_MAX_PAUSE || "300000", 10)
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8787"

// ── Redis connection ──────────────────────────────────────────────────────────

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    const delay = Math.min(1000 * Math.pow(2, times - 1), 30000)
    console.log(`[orchestrator-worker] Redis reconnecting in ${delay}ms (attempt ${times})...`)
    return delay
  },
  connectTimeout: 10000,
})

// Circuit breaker state
let redisFailureCount = 0
let workerPaused = false
let pausedAt = null

connection.on("connect", () => {
  console.log("[orchestrator-worker] Redis connected")
  redisFailureCount = 0
  if (workerPaused) {
    console.log("[orchestrator-worker] Resuming after Redis reconnection...")
    workerPaused = false
    pausedAt = null
  }
})

connection.on("error", (err) => {
  redisFailureCount++
  console.error(`[orchestrator-worker] Redis error (${redisFailureCount}/${MAX_REDIS_FAILURES}):`, err.message)
  if (redisFailureCount >= MAX_REDIS_FAILURES && !workerPaused) {
    console.error("[orchestrator-worker] Too many Redis failures — pausing worker")
    workerPaused = true
    pausedAt = Date.now()
  }
})

// ── Dead-letter queue ─────────────────────────────────────────────────────────

const dlq = new Queue(DLQ_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
})

async function moveToDeadLetterQueue(job, error) {
  try {
    await dlq.add(job.name + "-dlq", {
      originalJobId: job.id,
      originalData: job.data,
      failedAt: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
    })
    console.log(`[orchestrator-worker] Job ${job.id} moved to DLQ`)
  } catch (err) {
    console.error(`[orchestrator-worker] Failed to move job ${job.id} to DLQ:`, err.message)
  }
}

// ── Auto-recovery ─────────────────────────────────────────────────────────────

const recoveryInterval = setInterval(() => {
  if (workerPaused && pausedAt && Date.now() - pausedAt > MAX_PAUSE_DURATION_MS) {
    console.warn(`[orchestrator-worker] Paused for ${(Date.now() - pausedAt) / 1000}s — forcing reconnect...`)
    redisFailureCount = 0
    workerPaused = false
    pausedAt = null
    connection.disconnect()
    connection.connect().catch((err) => {
      console.error("[orchestrator-worker] Force reconnect failed:", err.message)
    })
  }
}, 30000)

recoveryInterval.unref()

// ── Health check ──────────────────────────────────────────────────────────────

const healthInterval = setInterval(() => {
  const status = workerPaused ? "PAUSED" : "RUNNING"
  console.log(`[orchestrator-worker] Health | status=${status} | redisFailures=${redisFailureCount} | queue=${QUEUE_NAME}`)
}, HEALTH_CHECK_INTERVAL_MS)

healthInterval.unref()

// ── API notification helper ───────────────────────────────────────────────────

async function notifyAPI(endpoint, payload) {
  try {
    await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Non-blocking
  }
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processJob(job) {
  if (workerPaused) {
    throw new Error("Worker paused due to Redis failures")
  }

  const { runnerType, instruction, workspaceDir, repoName, branch, parentTaskId, phase, totalPhases } = job.data
  const tag = `[orchestrator-worker:${job.id}]`

  console.log(`${tag} Processing | runner=${runnerType} | phase=${phase}/${totalPhases} | instruction=${(instruction || "").substring(0, 80)}`)

  if (!runnerType) {
    throw new Error("No runnerType specified in job data")
  }

  // Notify API that sub-task started
  await notifyAPI("/api/orchestrator/subtask-progress", {
    jobId: job.id,
    parentTaskId,
    runnerType,
    phase,
    totalPhases,
    status: "running",
    timestamp: new Date().toISOString(),
  })

  // Execute the agent runner
  const result = await executeRunner(runnerType, {
    id: job.id,
    data: {
      instruction,
      workspaceDir,
      repoName,
      branch,
      files: job.data.files,
      filesLikelyInvolved: job.data.filesLikelyInvolved,
      testCommand: job.data.testCommand,
    },
  })

  // Notify API that sub-task completed
  await notifyAPI("/api/orchestrator/subtask-progress", {
    jobId: job.id,
    parentTaskId,
    runnerType,
    phase,
    totalPhases,
    status: result.success ? "completed" : "failed",
    summary: result.output?.slice(0, 3)?.join("\n") || "",
    timestamp: new Date().toISOString(),
  })

  console.log(`${tag} Completed | success=${result.success}`)

  return result
}

// ── Worker instantiation ──────────────────────────────────────────────────────

const worker = new Worker(QUEUE_NAME, processJob, {
  connection,
  concurrency: CONCURRENCY,
  stalledInterval: 30000,
  maxStalledCount: 3,
  lockDuration: JOB_TIMEOUT_MS,
})

worker.on("completed", (job, result) => {
  console.log(`[orchestrator-worker] completed — job ${job.id} | success=${result?.success}`)
})

worker.on("failed", (job, err) => {
  console.error(`[orchestrator-worker] failed — job ${job.id}: ${err.message}`)
  moveToDeadLetterQueue(job, err)
})

worker.on("error", (err) => {
  console.error("[orchestrator-worker] Worker error:", err.message)
})

worker.on("drained", () => {
  console.log("[orchestrator-worker] Queue drained")
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[orchestrator-worker] Received ${signal} — shutting down...`)
  clearInterval(healthInterval)
  clearInterval(recoveryInterval)
  try {
    await worker.close()
    console.log("[orchestrator-worker] Worker closed")
  } catch (err) {
    console.error("[orchestrator-worker] Error closing worker:", err.message)
  }
  try {
    await dlq.close()
  } catch {}
  try {
    await connection.quit()
  } catch {}
  console.log("[orchestrator-worker] Shutdown complete")
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

// ── Startup ───────────────────────────────────────────────────────────────────

console.log(`[orchestrator-worker] Started | queue=${QUEUE_NAME} | redis=${REDIS_URL} | concurrency=${CONCURRENCY}`)
console.log(`[orchestrator-worker] Config | timeout=${JOB_TIMEOUT_MS}ms | api=${API_BASE_URL}`)
