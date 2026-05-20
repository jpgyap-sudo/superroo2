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
 *       ├──► AlertManager (alerting — GAP 3+4)
 *       │       ├──► Webhook alerts
 *       │       └──► Telegram alerts
 *       │
 *       ├──► HistoryStore (persistence — GAP 7)
 *       │
 *       ├──► AutoScaler (auto-scaling — GAP 8)
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
 *   RAM_ENABLE_ALERTS      — Enable alerting (default: true)
 *   RAM_ALERT_WEBHOOK_URL  — Webhook URL for RAM alerts
 *   RAM_ALERT_COOLDOWN_MS  — Cooldown between same-state alerts (default: 300000)
 *   TELEGRAM_BOT_TOKEN     — Telegram bot token for alerts (GAP 4)
 *   TELEGRAM_CHAT_ID       — Telegram chat ID for alerts (GAP 4)
 *   RAM_ENABLE_HISTORY     — Enable historical persistence (default: true)
 *   RAM_HISTORY_MAX_SAMPLES — Max history samples (default: 720)
 *   RAM_ENABLE_AUTO_SCALE  — Enable auto-scaling (default: false)
 *   RAM_AUTO_SCALE_UP_ACTION   — Action on scale up (default: notify)
 *   RAM_AUTO_SCALE_DOWN_ACTION — Action on scale down (default: notify)
 *   RAM_CLUSTER_MODE       — Enable PM2 cluster mode (default: false)
 *   RAM_CLUSTER_WORKER_ID  — Cluster worker ID (default: "")
 */

const path = require("path")
const http = require("http")
const https = require("https")
const fs = require("fs")
const { Worker } = require("bullmq")
const IORedis = require("ioredis")

// ── Orchestrator modules ───────────────────────────────────────────────────────

const { RAMMonitor, getRamUsagePercent, getSwapUsage } = require("../orchestrator/modules/RAMMonitor")
const { RAMScheduler } = require("../orchestrator/modules/RAMScheduler")
const { WorkerPauseManager, WORKER_CRITICALITY } = require("../orchestrator/modules/WorkerPauseManager")
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
	dbPath: process.env.ORCHESTRATOR_DB_PATH || path.join(__dirname, "..", "orchestrator", "data", "orchestrator.db"),
	redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
	logLevel: process.env.LOG_LEVEL || "info",
	// ── Alerting config (GAP 3+4) ──────────────────────────────────────────────
	enableAlerts: process.env.RAM_ENABLE_ALERTS !== "false",
	alertWebhookUrl: process.env.RAM_ALERT_WEBHOOK_URL || "",
	alertCooldownMs: parseInt(process.env.RAM_ALERT_COOLDOWN_MS || "300000", 10), // 5 min between same-state alerts
	// ── Telegram alerting config (GAP 4) ───────────────────────────────────────
	telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
	telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
	// ── Historical persistence config (GAP 7) ──────────────────────────────────
	enableHistoryPersistence: process.env.RAM_ENABLE_HISTORY !== "false",
	historyMaxSamples: parseInt(process.env.RAM_HISTORY_MAX_SAMPLES || "720", 10), // 720 samples = 1hr at 5s
	// ── Auto-scaling config (GAP 8) ────────────────────────────────────────────
	enableAutoScale: process.env.RAM_ENABLE_AUTO_SCALE === "true",
	autoScaleUpAction: process.env.RAM_AUTO_SCALE_UP_ACTION || "notify",
	autoScaleDownAction: process.env.RAM_AUTO_SCALE_DOWN_ACTION || "notify",
	// ── Cluster mode config (GAP 10) ───────────────────────────────────────────
	clusterMode: process.env.RAM_CLUSTER_MODE === "true",
	clusterWorkerId: process.env.RAM_CLUSTER_WORKER_ID || "",
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

// ── Alert Manager (GAP 3+4) ────────────────────────────────────────────────────

/**
 * AlertManager handles alerting for RAM state changes.
 * Supports webhook alerts (GAP 3) and Telegram alerts (GAP 4).
 */
class AlertManager {
	constructor(config, logger) {
		this.config = config
		this.logger = logger
		this._lastAlertTime = {} // state -> timestamp
		this._alertHistoryPath = path.join(__dirname, "..", "orchestrator", "data", "ram-alert-history.jsonl")
	}

	/**
	 * Send an alert for a RAM state change.
	 * Respects cooldown to prevent alert storms.
	 */
	async sendAlert(event) {
		if (!this.config.enableAlerts) return

		const alertKey = `${event.prevState || event.oldState}->${event.newState}`
		const now = Date.now()
		const lastTime = this._lastAlertTime[alertKey] || 0

		if (now - lastTime < this.config.alertCooldownMs) {
			this.logger.debug(`[AlertManager] Skipping alert "${alertKey}" — within cooldown`)
			return
		}

		this._lastAlertTime[alertKey] = now

		const alertPayload = {
			type: "ram_state_change",
			service: "vps-ram-orchestrator",
			timestamp: now,
			oldState: event.prevState || event.oldState,
			newState: event.newState,
			snapshot: {
				ramPercent: event.ramPercent,
				freeMb: event.freeMb,
				totalMb: event.totalMb,
				usedMb: event.usedMb,
			},
			swap: event.swap || null,
			swapUsage: getSwapUsage(),
			hostname: require("os").hostname(),
		}

		// Persist alert to history file
		try {
			const dir = path.dirname(this._alertHistoryPath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.appendFileSync(this._alertHistoryPath, JSON.stringify(alertPayload) + "\n")
		} catch (err) {
			this.logger.error(`[AlertManager] Failed to persist alert: ${err.message}`)
		}

		// GAP 3: Webhook alert
		if (this.config.alertWebhookUrl) {
			await this._sendWebhook(alertPayload)
		}

		// GAP 4: Telegram alert
		if (this.config.telegramBotToken && this.config.telegramChatId) {
			await this._sendTelegram(alertPayload)
		}

		// Log the alert
		const level = event.newState === "danger" ? "error" : event.newState === "critical" ? "warn" : "info"
		this.logger[level](
			`[AlertManager] RAM state changed: ${event.prevState || event.oldState || "?"} -> ${event.newState}` +
				` (RAM: ${event.ramPercent ?? "?"}%, ` +
				`Free: ${event.freeMb ?? "?"}MB)`,
		)
	}

	/**
	 * GAP 3: Send webhook alert.
	 */
	async _sendWebhook(payload) {
		try {
			const url = new URL(this.config.alertWebhookUrl)
			const isHttps = url.protocol === "https:"
			const transport = isHttps ? https : http

			const body = JSON.stringify(payload)
			const options = {
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname + url.search,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
				timeout: 5000,
			}

			return new Promise((resolve) => {
				const req = transport.request(options, (res) => {
					resolve(res.statusCode >= 200 && res.statusCode < 300)
				})
				req.on("error", () => resolve(false))
				req.on("timeout", () => {
					req.destroy()
					resolve(false)
				})
				req.write(body)
				req.end()
			})
		} catch {
			return false
		}
	}

	/**
	 * GAP 4: Send Telegram alert via Bot API.
	 */
	async _sendTelegram(payload) {
		try {
			const emoji =
				payload.newState === "danger"
					? "🚨"
					: payload.newState === "critical"
						? "⚠️"
						: payload.newState === "warning"
							? "⚡"
							: "✅"

			let message = [
				`${emoji} *RAM State Change*`,
				``,
				`**State**: ${payload.oldState || "?"} → ${payload.newState}`,
				`**RAM**: ${payload.snapshot?.ramPercent || "?"}%`,
				`**Free**: ${payload.snapshot?.freeMb || "?"}MB / ${payload.snapshot?.totalMb || "?"}MB`,
				`**Host**: ${payload.hostname}`,
				`**Time**: ${new Date(payload.timestamp).toISOString()}`,
			].join("\n")

			if (payload.swapUsage) {
				message += `\n**Swap**: ${payload.swapUsage.percent}% used`
			}

			const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`
			const body = JSON.stringify({
				chat_id: this.config.telegramChatId,
				text: message,
				parse_mode: "Markdown",
				disable_web_page_preview: true,
			})

			const urlObj = new URL(url)
			return new Promise((resolve) => {
				const req = https.request(
					{
						hostname: urlObj.hostname,
						path: urlObj.pathname,
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(body),
						},
						timeout: 10000,
					},
					(res) => {
						resolve(res.statusCode === 200)
					},
				)
				req.on("error", () => resolve(false))
				req.on("timeout", () => {
					req.destroy()
					resolve(false)
				})
				req.write(body)
				req.end()
			})
		} catch {
			return false
		}
	}
}

let alertManager = null

// ── History Store (GAP 7) ──────────────────────────────────────────────────────

/**
 * HistoryStore persists RAM samples to a JSONL file for historical analysis.
 */
class HistoryStore {
	constructor(config, logger) {
		this.config = config
		this.logger = logger
		this._samples = []
		this._historyPath = path.join(__dirname, "..", "orchestrator", "data", "ram-history.jsonl")
		this._maxSamples = config.historyMaxSamples
	}

	/**
	 * Record a RAM sample.
	 * Keeps a rolling window of the last N samples in memory.
	 * Appends to JSONL file for long-term persistence.
	 */
	recordSample(sample) {
		if (!this.config.enableHistoryPersistence) return

		this._samples.push(sample)
		if (this._samples.length > this._maxSamples) {
			this._samples.shift()
		}

		// Append to JSONL file
		try {
			const dir = path.dirname(this._historyPath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.appendFileSync(this._historyPath, JSON.stringify(sample) + "\n")

			// Rotate file if it exceeds 10MB to prevent unbounded growth
			const MAX_FILE_SIZE = 10 * 1024 * 1024
			const stats = fs.statSync(this._historyPath)
			if (stats.size > MAX_FILE_SIZE) {
				const data = fs.readFileSync(this._historyPath, "utf8")
				const lines = data.trim().split("\n").filter(Boolean)
				const trimmed = lines.slice(-this._maxSamples).join("\n") + "\n"
				fs.writeFileSync(this._historyPath, trimmed)
				this.logger.info(
					`[HistoryStore] Rotated history file to ${lines.slice(-this._maxSamples).length} samples`,
				)
			}
		} catch (err) {
			this.logger.error(`[HistoryStore] Failed to persist sample: ${err.message}`)
		}
	}

	/**
	 * Get recent samples for dashboard display.
	 */
	getRecentSamples(count = 60) {
		return this._samples.slice(-count)
	}

	/**
	 * Get all samples in memory.
	 */
	getAllSamples() {
		return this._samples
	}

	/**
	 * Load historical samples from JSONL file on startup.
	 */
	loadFromDisk() {
		try {
			if (!fs.existsSync(this._historyPath)) return
			const data = fs.readFileSync(this._historyPath, "utf8")
			const lines = data.trim().split("\n").filter(Boolean)
			for (const line of lines.slice(-this._maxSamples)) {
				try {
					this._samples.push(JSON.parse(line))
				} catch {
					/* skip malformed lines */
				}
			}
			this.logger.info(`[HistoryStore] Loaded ${this._samples.length} historical samples`)
		} catch (err) {
			this.logger.warn(`[HistoryStore] Failed to load history: ${err.message}`)
		}
	}
}

let historyStore = null

// ── Auto-Scaler (GAP 8) ────────────────────────────────────────────────────────

/**
 * AutoScaler handles scale-up and scale-down events from RAMMonitor.
 * Can trigger webhooks, PM2 scale commands, or just notify.
 */
class AutoScaler {
	constructor(config, logger) {
		this.config = config
		this.logger = logger
	}

	/**
	 * Handle a scale-up event (RAM critically high for sustained period).
	 */
	async handleScaleUp(event) {
		if (!this.config.enableAutoScale) {
			this.logger.info(`[AutoScaler] Scale-up triggered but auto-scaling disabled: ${event.ramPercent}%`)
			return
		}

		this.logger.warn(
			`[AutoScaler] Scale-up: RAM at ${event.ramPercent}% for ${event.consecutiveSamples} consecutive samples`,
		)

		switch (this.config.autoScaleUpAction) {
			case "notify":
				// Already logged above
				break
			case "pause_workers":
				if (workerPauseManager) {
					await workerPauseManager.pauseWorkersAtOrBelow(
						WORKER_CRITICALITY.NORMAL,
						"auto-scale: RAM critically high",
					)
					this.logger.warn("[AutoScaler] Paused normal and background workers")
				}
				break
			case "webhook":
				if (this.config.alertWebhookUrl) {
					await alertManager?._sendWebhook({
						type: "auto_scale_up",
						service: "vps-ram-orchestrator",
						timestamp: Date.now(),
						ramPercent: event.ramPercent,
						consecutiveSamples: event.consecutiveSamples,
					})
				}
				break
			default:
				this.logger.info(`[AutoScaler] Unknown scale-up action: ${this.config.autoScaleUpAction}`)
		}
	}

	/**
	 * Handle a scale-down event (RAM recovered for sustained period).
	 */
	async handleScaleDown(event) {
		if (!this.config.enableAutoScale) {
			this.logger.info(`[AutoScaler] Scale-down triggered but auto-scaling disabled: ${event.ramPercent}%`)
			return
		}

		this.logger.info(
			`[AutoScaler] Scale-down: RAM at ${event.ramPercent}% for ${event.consecutiveSamples} consecutive samples`,
		)

		switch (this.config.autoScaleDownAction) {
			case "notify":
				// Already logged above
				break
			case "resume_workers":
				if (workerPauseManager) {
					await workerPauseManager.resumeWorkersAtOrAbove(
						WORKER_CRITICALITY.NORMAL,
						"auto-scale: RAM recovered",
					)
					this.logger.info("[AutoScaler] Resumed normal and background workers")
				}
				break
			case "webhook":
				if (this.config.alertWebhookUrl) {
					await alertManager?._sendWebhook({
						type: "auto_scale_down",
						service: "vps-ram-orchestrator",
						timestamp: Date.now(),
						ramPercent: event.ramPercent,
						consecutiveSamples: event.consecutiveSamples,
					})
				}
				break
			default:
				this.logger.info(`[AutoScaler] Unknown scale-down action: ${this.config.autoScaleDownAction}`)
		}
	}
}

let autoScaler = null

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
			workerPauseManager.trackTaskEnd(job?.data?.runnerType || "unknown")
		}
		logger.error(`[BullWorker] Job ${job?.id || "unknown"} failed: ${err.message}`)
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
				const swapUsage = getSwapUsage()

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						status: "ok",
						service: "vps-ram-orchestrator",
						ramState: state,
						snapshot,
						trend,
						swapUsage,
						uptime: process.uptime(),
						timestamp: Date.now(),
					}),
				)
			} else if (pathname === "/status") {
				// Detailed status
				const ramStats = ramMonitor ? ramMonitor.getStats() : null
				const schedulerStats = ramScheduler ? ramScheduler.getStats() : null
				const pauseStats = workerPauseManager ? workerPauseManager.getStats() : null
				const historySamples = historyStore ? historyStore.getRecentSamples(60) : []
				const swapUsage = getSwapUsage()

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
								enableAlerts: CONFIG.enableAlerts,
								enableHistoryPersistence: CONFIG.enableHistoryPersistence,
								enableAutoScale: CONFIG.enableAutoScale,
								clusterMode: CONFIG.clusterMode,
							},
							ramMonitor: ramStats,
							scheduler: schedulerStats,
							workerPauseManager: pauseStats,
							swapUsage,
							history: {
								sampleCount: historySamples.length,
								recentSamples: historySamples,
							},
							uptime: process.uptime(),
							timestamp: Date.now(),
						},
						null,
						2,
					),
				)
			} else if (pathname === "/pause" && req.method === "POST") {
				// Manually pause a specific worker
				if (!workerPauseManager) {
					res.writeHead(503, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "WorkerPauseManager not initialized" }))
					return
				}
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
				if (!workerPauseManager) {
					res.writeHead(503, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "WorkerPauseManager not initialized" }))
					return
				}
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
			} else if (pathname === "/history") {
				// Get historical RAM samples
				const count = parseInt(url.searchParams.get("count") || "60", 10)
				const samples = historyStore ? historyStore.getRecentSamples(count) : []
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ count: samples.length, samples }))
			} else if (pathname === "/alerts") {
				// Get recent alerts
				const alertHistoryPath = path.join(__dirname, "..", "orchestrator", "data", "ram-alert-history.jsonl")
				const limit = parseInt(url.searchParams.get("limit") || "20", 10)
				const alerts = []
				try {
					if (fs.existsSync(alertHistoryPath)) {
						const data = fs.readFileSync(alertHistoryPath, "utf8")
						const lines = data.trim().split("\n").filter(Boolean).slice(-limit)
						for (const line of lines) {
							try {
								alerts.push(JSON.parse(line))
							} catch {
								/* skip */
							}
						}
					}
				} catch {
					/* ignore */
				}
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ count: alerts.length, alerts }))
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
		if (err.code === "EADDRINUSE") {
			logger.error(`[HealthAPI] Port ${CONFIG.apiPort} is already in use. Exiting so PM2 can restart.`)
			shutdown("EADDRINUSE").then(() => process.exit(1))
		}
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
			// GAP 6: Enable swap monitoring
			enableSwapMonitoring: true,
			swapWarningPercent: 50,
			swapCriticalPercent: 75,
			// GAP 10: Cluster mode awareness
			clusterMode: CONFIG.clusterMode,
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

		// 8. Initialize AlertManager (GAP 3+4)
		alertManager = new AlertManager(CONFIG, logger)
		logger.info("[Init] AlertManager initialized")

		// 9. Initialize HistoryStore (GAP 7)
		historyStore = new HistoryStore(CONFIG, logger)
		historyStore.loadFromDisk()
		logger.info("[Init] HistoryStore initialized")

		// 10. Initialize AutoScaler (GAP 8)
		autoScaler = new AutoScaler(CONFIG, logger)
		logger.info("[Init] AutoScaler initialized")

		// 11. Wire RAMMonitor events
		if (ramMonitor) {
			// Wire state change → alert manager (GAP 3+4)
			ramMonitor.on("stateChange", (event) => {
				alertManager?.sendAlert(event)
			})

			// Wire heartbeat → history store (GAP 7)
			ramMonitor.on("heartbeat", (event) => {
				historyStore?.recordSample(event)
			})

			// Wire scale events → auto-scaler (GAP 8)
			ramMonitor.on("scaleUp", (event) => {
				autoScaler?.handleScaleUp(event)
			})
			ramMonitor.on("scaleDown", (event) => {
				autoScaler?.handleScaleDown(event)
			})
		}

		// 12. Connect to Redis (optional, for BullMQ integration)
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
			const bullQueue = new Queue(process.env.ORCHESTRATOR_QUEUE_NAME || "superroo-orchestrator", {
				connection: redisConnection,
			})
			taskQueue.setBullQueue(bullQueue)
			logger.info("[Init] BullMQ queue connected to TaskQueueBullMQ")

			// Create BullMQ worker that respects RAM pressure
			bullWorker = await createBullWorker()
			logger.info("[Init] BullMQ worker created")
		} catch (err) {
			logger.warn(`[Init] Redis/BullMQ unavailable — running in standalone mode: ${err.message}`)
			logger.info("[Init] Task queuing and worker pausing will work without Redis")
		}

		// 13. Start health API
		startHealthAPI()

		// 14. Log startup summary
		logger.info("=".repeat(60))
		logger.info("VPS RAM Orchestrator Worker — Started successfully")
		logger.info(
			`RAM thresholds: WARN=${CONFIG.warningPercent}% CRIT=${CONFIG.criticalPercent}% DANGER=${CONFIG.dangerPercent}% RECOVERY=${CONFIG.recoveryPercent}%`,
		)
		logger.info(`Health API: http://127.0.0.1:${CONFIG.apiPort}`)
		logger.info(`Poll interval: ${CONFIG.pollIntervalMs}ms`)
		logger.info(`Grace period: ${CONFIG.gracePeriodMs}ms | Cooldown: ${CONFIG.cooldownMs}ms`)
		if (CONFIG.enableAlerts) {
			logger.info(
				`Alerts: enabled (webhook: ${CONFIG.alertWebhookUrl ? "yes" : "no"}, telegram: ${CONFIG.telegramBotToken ? "yes" : "no"})`,
			)
		}
		if (CONFIG.enableHistoryPersistence) {
			logger.info(`History persistence: enabled (max ${CONFIG.historyMaxSamples} samples)`)
		}
		if (CONFIG.enableAutoScale) {
			logger.info(`Auto-scale: enabled (up: ${CONFIG.autoScaleUpAction}, down: ${CONFIG.autoScaleDownAction})`)
		}
		if (CONFIG.clusterMode) {
			logger.info(`Cluster mode: enabled (worker: ${CONFIG.clusterWorkerId || "auto"})`)
		}
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
