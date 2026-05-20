#!/usr/bin/env node

/**
 * SuperRoo Cloud — VPS RAM Orchestrator Worker
 *
 * Standalone process that runs on the VPS to monitor RAM usage and dynamically
 * manage worker scheduling, queuing, and pausing to ensure RAM never exceeds 80%.
 *
 * Architecture:
 *
 *   RAMMonitor (sensing)
 *       │
 *       ├──► RAMScheduler (queuing/throttling)
 *       │       └──► TaskQueueBullMQ (persistent queue)
 *       │
 *       ├──► WorkerPauseManager (worker lifecycle)
 *       │       ├──► AgentRegistry (enable/disable agents)
 *       │       └──► ParallelExecutor (task dispatch)
 *       │
 *       └──► Health API (HTTP endpoint for dashboard)
 *
 * Run as a PM2 process on the VPS:
 *   pm2 start cloud/worker/vpsRamOrchestratorWorker.js --name vps-ram-orchestrator
 *
 * Environment variables:
 *   RAM_WARNING_PERCENT    — Warning threshold (default: 70)
 *   RAM_CRITICAL_PERCENT   — Critical threshold (default: 80)
 *   RAM_DANGER_PERCENT     — Danger threshold (default: 90)
 *   RAM_RECOVERY_PERCENT   — Recovery threshold (default: 60)
 *   RAM_POLL_INTERVAL_MS   — RAM polling interval (default: 5000)
 *   RAM_GRACE_PERIOD_MS    — Grace period for workers to finish (default: 30000)
 *   RAM_COOLDOWN_MS        — Cooldown between pause/resume cycles (default: 60000)
 *   RAM_API_PORT           — Health API port (default: 3456)
 *   RAM_DEFER_MAX          — Max deferred tasks (default: 100)
 *   ORCHESTRATOR_DB_PATH   — SQLite DB path for task queue
 *   REDIS_URL              — Redis URL for BullMQ (default: redis://127.0.0.1:6379)
 *   LOG_LEVEL              — Log level (debug|info|warn|error, default: info)
 */

const path = require("path")
const http = require("http")
const { Worker } = require("bullmq")
const IORedis = require("ioredis")

// ── Orchestrator modules ───────────────────────────────────────────────────────

const { RAMMonitor } = require("../orchestrator/modules/RAMMonitor")
const { RAMScheduler } = require("../orchestrator/modules/RAMScheduler")
const {
	WorkerPauseManager,
	WORKER_CRITICALITY,
} = require("../orchestrator/modules/WorkerPauseManager")
const { AgentRegistry } = require("../orchestrator/modules/AgentRegistry")
const { ParallelExecutor } = require("../orchestrator/modules/ParallelExecutor")
const TaskQueueBullMQ = require("../orchestrator/modules/TaskQueueBullMQ")
const MemoryStore = require("../orchestrator/stores/MemoryStore")

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
	warningPercent: parseInt(process.env.RAM_WARNING_PERCENT || "70", 10),
	criticalPercent: parseInt(process.env.RAM_CRITICAL_PERCENT || "80", 10),
	dangerPercent: parseInt(process.env.RAM_DANGER_PERCENT || "90", 10),
	recoveryPercent: parseInt(process.env.RAM_RECOVERY_PERCENT || "60", 10),
	pollIntervalMs: parseInt(process.env.RAM_POLL_INTERVAL_MS || "5000", 10),
	gracePeriodMs: parseInt(process.env.RAM_GRACE_PERIOD_MS || "30000", 10),
	cooldownMs: parseInt(process.env.RAM_COOLDOWN_MS || "60000", 10),
	apiPort: parseInt(process.env.RAM_API_PORT || "3456", 10),
	deferMax: parseInt(process.env.RAM_DEFER_MAX || "100", 10),
	dbPath:
		process.env.ORCHESTRATOR_DB_PATH ||
		path.join(__dirname, "..", "orchestrator", "data", "orchestrator.db"),
	redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
	logLevel: process.env.LOG_LEVEL || "info",
}

// ── Logger ─────────────────────────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const currentLogLevel = LOG_LEVELS[CONFIG.logLevel] ?? LOG_LEVELS.info

const logger = {
	debug: (...args) => {
		if (currentLogLevel <= LOG_LEVELS.debug) console.log("[RAM-Orch:debug]", ...args)
	},
	info: (...args) => {
		if (currentLogLevel <= LOG_LEVELS.info) console.log("[RAM-Orch:info]", ...args)
	},
	warn: (...args) => {
		if (currentLogLevel <= LOG_LEVELS.warn) console.warn("[RAM-Orch:warn]", ...args)
	},
	error: (...args) => {
		if (currentLogLevel <= LOG_LEVELS.error) console.error("[RAM-Orch:error]", ...args)
	},
}

// ── State ──────────────────────────────────────────────────────────────────────

let ramMonitor = null
let ramScheduler = null
let workerPauseManager = null
let agentRegistry = null
let parallelExecutor = null
let taskQueue = null
let memoryStore = null
let redisConnection = null
let bullWorker = null
let httpServer = null
let isShuttingDown = false

// ── BullMQ Worker Integration ──────────────────────────────────────────────────

/**
 * Create a BullMQ worker that respects RAM pressure.
 * When RAM is in CRITICAL or DANGER state, the worker pauses consuming new jobs.
 */
async function createBullWorker() {
	if (!redisConnection) return null

	const QUEUE_NAME = process.env.ORCHESTRATOR_QUEUE_NAME || "superroo-orchestrator"

	const worker = new Worker(
		QUEUE_NAME,
		async (job) => {
			// Check RAM state before processing
			const ramState = ramMonitor ? ramMonitor.getCurrentState() : "normal"
			if (ramState === "danger") {
				logger.warn(`[BullWorker] RAM state is DANGER — deferring job ${job.id}`)
				if (ramScheduler) {
					ramScheduler.deferTask(
						{
							id: job.id,
							type: job.data?.runnerType || "unknown",
							priority: job.opts?.priority || 5,
							input: job.data,
						},
						`RAM state: ${ramState}`,
					)
				}
				throw new Error(`RAM state is DANGER — job ${job.id} deferred`)
			}

			if (ramState === "critical") {
				const jobPriority = job.opts?.priority || 5
				if (jobPriority > 1) {
					logger.warn(`[BullWorker] RAM state is CRITICAL — deferring low-priority job ${job.id}`)
					if (ramScheduler) {
						ramScheduler.deferTask(
							{
								id: job.id,
								type: job.data?.runnerType || "unknown",
								priority: jobPriority,
								input: job.data,
							},
							`RAM state: ${ramState}`,
						)
					}
					throw new Error(`RAM state is CRITICAL — low-priority job ${job.id} deferred`)
				}
			}

			logger.info(`[BullWorker] Processing job ${job.id} (RAM state: ${ramState})`)

			// Track the running task in WorkerPauseManager
			if (workerPauseManager) {
				workerPauseManager.trackTaskStart(
					job.data?.runnerType || "unknown",
					job.id,
					job.data?.runnerType || "unknown",
				)
			}

			// The actual job processing is delegated to the caller
			// This worker just gates based on RAM state
			return { ramState, deferred: false }
		},
		{
			connection: redisConnection,
			concurrency: parseInt(process.env.ORCHESTRATOR_WORKER_CONCURRENCY || "3", 10),
			stalledInterval: 30000,
			maxStalledCount: 3,
			lockDuration: parseInt(process.env.ORCHESTRATOR_JOB_TIMEOUT || "600000", 10),
		},
	)

	worker.on("completed", (job) => {
		if (workerPauseManager) {
			workerPauseManager.trackTaskEnd(job.data?.runnerType || "unknown")
		}
		logger.info(`[BullWorker] Job ${job.id} completed`)
	})

	worker.on("failed", (job, err) => {
		if (workerPauseManager) {
			workerPauseManager.trackTaskEnd(job.data?.runnerType || "unknown")
		}
		logger.error(`[BullWorker] Job ${job.id} failed: ${err.message}`)
	})

	worker.on("drained", () => {
		logger.debug("[BullWorker] Queue drained")
	})

	// Wire RAMMonitor to pause/resume the Bull worker
	if (ramMonitor) {
		ramMonitor.on("stateChange", (event) => {
			if (event.newState === "danger") {
				worker.pause()
				logger.warn("[BullWorker] Paused — RAM state is DANGER")
			} else if (event.newState === "normal" || event.newState === "warning") {
				worker.resume()
				logger.info("[BullWorker] Resumed — RAM recovered")
			}
		})
	}

	logger.info(`[BullWorker] Created for queue "${QUEUE_NAME}"`)
	return worker
}

// ── Health HTTP API ────────────────────────────────────────────────────────────

/**
 * Start a lightweight HTTP server for health checks and status queries.
 */
function startHealthAPI() {
	httpServer = http.createServer((req, res) => {
		// CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		const url = new URL(req.url, `http://localhost:${CONFIG.apiPort}`)
		const pathname = url.pathname

		try {
			if (pathname === "/health" || pathname === "/") {
				// Health check endpoint
				const snapshot = ramMonitor ? ramMonitor.getLatestSnapshot() : null
				const state = ramMonitor ? ramMonitor.getCurrentState() : "unknown"
				const trend = ramMonitor ? ramMonitor.getTrend() : null

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						status: "ok",
						service: "vps-ram-orchestrator",
						ramState: state,
						snapshot,
						trend,
						uptime: process.uptime(),
						timestamp: Date.now(),
					}),
				)
			} else if (pathname === "/status") {
				// Detailed status
				const ramStats = ramMonitor ? ramMonitor.getStats() : null
				const schedulerStats = ramScheduler ? ramScheduler.getStats() : null
				const pauseStats = workerPauseManager ? workerPauseManager.getStats() : null

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify(
						{
							status: "ok",
							service: "vps-ram-orchestrator",
							config: {
								warningPercent: CONFIG.warningPercent,
								criticalPercent: CONFIG.criticalPercent,
								dangerPercent: CONFIG.dangerPercent,
								recoveryPercent: CONFIG.recoveryPercent,
								pollIntervalMs: CONFIG.pollIntervalMs,
								gracePeriodMs: CONFIG.gracePeriodMs,
								cooldownMs: CONFIG.cooldownMs,
							},
							ramMonitor: ramStats,
							scheduler: schedulerStats,
							workerPauseManager: pauseStats,
							uptime: process.uptime(),
							timestamp: Date.now(),
						},
						null,
						2,
					),
				)
			} else if (pathname === "/pause" && req.method === "POST") {
				// Manually pause a specific worker
				let body = ""
				req.on("data", (chunk) => (body += chunk))
				req.on("end", async () => {
					try {
						const data = JSON.parse(body || "{}")
						const workerId = data.workerId
						if (!workerId) {
							res.writeHead(400, { "Content-Type": "application/json" })
							res.end(JSON.stringify({ error: "workerId is required" }))
							return
						}
						const result = await workerPauseManager.pauseWorker(workerId, data.reason || "manual")
						res.writeHead(result ? 200 : 409, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ paused: result, workerId }))
					} catch (err) {
						res.writeHead(400, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ error: err.message }))
					}
				})
			} else if (pathname === "/resume" && req.method === "POST") {
				// Manually resume a specific worker
				let body = ""
				req.on("data", (chunk) => (body += chunk))
				req.on("end", async () => {
					try {
						const data = JSON.parse(body || "{}")
						const workerId = data.workerId
						if (!workerId) {
							res.writeHead(400, { "Content-Type": "application/json" })
							res.end(JSON.stringify({ error: "workerId is required" }))
							return
						}
						const result = await workerPauseManager.resumeWorker(workerId)
						res.writeHead(result ? 200 : 409, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ resumed: result, workerId }))
					} catch (err) {
						res.writeHead(400, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ error: err.message }))
					}
				})
			} else if (pathname === "/deferred") {
				// Get list of deferred tasks
				const deferred = ramScheduler ? ramScheduler.getDeferredTasks() : []
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						count: deferred.length,
						tasks: deferred.map((d) => ({
							taskId: d.task.id,
							type: d.task.type,
							priority: d.task.priority,
							deferredAt: d.deferredAt,
							reason: d.reason,
						})),
					}),
				)
			} else {
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Not found" }))
			}
		} catch (err) {
			logger.error(`[HealthAPI] Error handling ${pathname}: ${err.message}`)
			res.writeHead(500, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Internal server error" }))
		}
	})

	httpServer.listen(CONFIG.apiPort, "127.0.0.1", () => {
		logger.info(`[HealthAPI] Listening on http://127.0.0.1:${CONFIG.apiPort}`)
	})

	httpServer.on("error", (err) => {
		logger.error(`[HealthAPI] Server error: ${err.message}`)
	})
}

// ── Main startup ───────────────────────────────────────────────────────────────

async function main() {
	logger.info("=".repeat(60))
	logger.info("VPS RAM Orchestrator Worker — Starting")
	logger.info("=".repeat(60))
	logger.info(`Config: ${JSON.stringify(CONFIG, null, 2)}`)

	try {
		// 1. Initialize MemoryStore (SQLite persistence)
		memoryStore = new MemoryStore(CONFIG.dbPath)
		memoryStore.initialize()
		logger.info(`[Init] MemoryStore initialized at ${CONFIG.dbPath}`)

		// 2. Initialize TaskQueueBullMQ
		taskQueue = new TaskQueueBullMQ(memoryStore)
		logger.info("[Init] TaskQueueBullMQ initialized")

		// 3. Initialize AgentRegistry
		agentRegistry = new AgentRegistry({ memoryStore })
		await agentRegistry.initialize()
		logger.info("[Init] AgentRegistry initialized")

		// 4. Initialize ParallelExecutor
		parallelExecutor = new ParallelExecutor({
			maxConcurrency: parseInt(process.env.RAM_MAX_CONCURRENCY || "5", 10),
			agentRegistry,
		})
		parallelExecutor.start()
		logger.info("[Init] ParallelExecutor started")

		// 5. Initialize RAMMonitor (core sensing)
		ramMonitor = new RAMMonitor({
			warningPercent: CONFIG.warningPercent,
			criticalPercent: CONFIG.criticalPercent,
			dangerPercent: CONFIG.dangerPercent,
			recoveryPercent: CONFIG.recoveryPercent,
			pollIntervalMs: CONFIG.pollIntervalMs,
			logger,
		})
		ramMonitor.start()
		logger.info("[Init] RAMMonitor started")

		// 6. Initialize RAMScheduler (queuing/throttling)
		ramScheduler = new RAMScheduler({
			taskQueue,
			ramMonitor,
			maxDeferredTasks: CONFIG.deferMax,
			logger,
		})
		logger.info("[Init] RAMScheduler initialized")

		// 7. Initialize WorkerPauseManager (worker lifecycle)
		workerPauseManager = new WorkerPauseManager({
			ramMonitor,
			agentRegistry,
			parallelExecutor,
			gracePeriodMs: CONFIG.gracePeriodMs,
			cooldownMs: CONFIG.cooldownMs,
			logger,
		})
		logger.info("[Init] WorkerPauseManager initialized")

		// 8. Connect to Redis (optional, for BullMQ integration)
		try {
			redisConnection = new IORedis(CONFIG.redisUrl, {
				maxRetriesPerRequest: null,
				retryStrategy: (times) => {
					if (times > 3) {
						logger.warn(`[Redis] Giving up after ${times} retries`)
						return null // Stop retrying
					}
					const delay = Math.min(1000 * Math.pow(2, times - 1), 10000)
					logger.info(`[Redis] Reconnecting in ${delay}ms (attempt ${times})...`)
					return delay
				},
				connectTimeout: 5000,
				lazyConnect: true,
			})

			await redisConnection.connect()
			logger.info("[Init] Redis connected")

			// Wire BullMQ queue into TaskQueueBullMQ
			const { Queue } = require("bullmq")
			const bullQueue = new Queue(
				process.env.ORCHESTRATOR_QUEUE_NAME || "superroo-orchestrator",
				{ connection: redisConnection },
			)
			taskQueue.setBullQueue(bullQueue)
			logger.info("[Init] BullMQ queue connected to TaskQueueBullMQ")

			// Create BullMQ worker that respects RAM pressure
			bullWorker = await createBullWorker()
			logger.info("[Init] BullMQ worker created")
		} catch (err) {
			logger.warn(`[Init] Redis/BullMQ unavailable — running in standalone mode: ${err.message}`)
			logger.info("[Init] Task queuing and worker pausing will work without Redis")
		}

		// 9. Start health API
		startHealthAPI()

		// 10. Log startup summary
		logger.info("=".repeat(60))
		logger.info("VPS RAM Orchestrator Worker — Started successfully")
		logger.info(`RAM thresholds: WARN=${CONFIG.warningPercent}% CRIT=${CONFIG.criticalPercent}% DANGER=${CONFIG.dangerPercent}% RECOVERY=${CONFIG.recoveryPercent}%`)
		logger.info(`Health API: http://127.0.0.1:${CONFIG.apiPort}`)
		logger.info(`Poll interval: ${CONFIG.pollIntervalMs}ms`)
		logger.info(`Grace period: ${CONFIG.gracePeriodMs}ms | Cooldown: ${CONFIG.cooldownMs}ms`)
		logger.info("=".repeat(60))

		// Log initial RAM state
		const initialSnapshot = ramMonitor.getLatestSnapshot()
		logger.info(
			`Initial RAM: ${initialSnapshot.ramPercent}% (${initialSnapshot.usedMb}MB/${initialSnapshot.totalMb}MB) — State: ${ramMonitor.getCurrentState()}`,
		)
	} catch (err) {
		logger.error(`[Init] Fatal error during startup: ${err.message}`)
		logger.error(err.stack)
		await shutdown("INIT_FAILURE")
		process.exit(1)
	}
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

async function shutdown(signal) {
	if (isShuttingDown) return
	isShuttingDown = true

	logger.info(`\n[Shutdown] Received ${signal} — shutting down...`)

	// Stop RAMMonitor first (stops emitting events)
	if (ramMonitor) {
		ramMonitor.stop()
		logger.info("[Shutdown] RAMMonitor stopped")
	}

	// Close BullMQ worker
	if (bullWorker) {
		try {
			await bullWorker.close()
			logger.info("[Shutdown] BullMQ worker closed")
		} catch (err) {
			logger.error(`[Shutdown] Error closing BullMQ worker: ${err.message}`)
		}
	}

	// Dispose RAMScheduler
	if (ramScheduler) {
		ramScheduler.dispose()
		logger.info("[Shutdown] RAMScheduler disposed")
	}

	// Dispose WorkerPauseManager
	if (workerPauseManager) {
		workerPauseManager.dispose()
		logger.info("[Shutdown] WorkerPauseManager disposed")
	}

	// Stop ParallelExecutor
	if (parallelExecutor) {
		parallelExecutor.stop()
		logger.info("[Shutdown] ParallelExecutor stopped")
	}

	// Close Redis connection
	if (redisConnection) {
		try {
			await redisConnection.quit()
			logger.info("[Shutdown] Redis connection closed")
		} catch (err) {
			logger.error(`[Shutdown] Error closing Redis: ${err.message}`)
		}
	}

	// Close MemoryStore
	if (memoryStore) {
		memoryStore.close()
		logger.info("[Shutdown] MemoryStore closed")
	}

	// Close HTTP server
	if (httpServer) {
		await new Promise((resolve) => httpServer.close(resolve))
		logger.info("[Shutdown] Health API server closed")
	}

	logger.info("[Shutdown] Complete")
}

// ── Signal handlers ────────────────────────────────────────────────────────────

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("uncaughtException", (err) => {
	logger.error(`[FATAL] Uncaught exception: ${err.message}`)
	logger.error(err.stack)
	shutdown("UNCAUGHT_EXCEPTION").then(() => process.exit(1))
})
process.on("unhandledRejection", (reason) => {
	logger.error(`[FATAL] Unhandled rejection: ${reason}`)
	shutdown("UNHANDLED_REJECTION").then(() => process.exit(1))
})

// ── Start ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
	logger.error(`[FATAL] Main startup failed: ${err.message}`)
	process.exit(1)
})
