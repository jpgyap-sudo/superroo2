/**
 * CloudOrchestrator — Main orchestrator for the SuperRoo Cloud.
 * Ported from src/super-roo/orchestrator/SuperRooOrchestrator.ts
 *
 * Owns all 18 core modules and provides the unified API for:
 *   - Task submission and processing
 *   - Safety checking
 *   - Feature/bug lifecycle management
 *   - Self-healing
 *   - Parallel execution
 *   - ML-driven improvement
 *   - Event logging
 *   - Commit/deploy tracking
 */

const EventEmitter = require("events")
const MemoryStore = require("./stores/MemoryStore")
const EventLog = require("./modules/EventLog")
const TaskQueueBullMQ = require("./modules/TaskQueueBullMQ")
const { TaskExecutor } = require("./modules/TaskExecutor")

// ─── Safety Modes ─────────────────────────────────────────────────────

const SafetyMode = Object.freeze({
	OFF: "off",
	SAFE: "safe",
	AUTO: "auto",
	FULL_AUTONOMOUS: "full_autonomous",
})

// ─── Orchestrator ─────────────────────────────────────────────────────

class CloudOrchestrator extends EventEmitter {
	/**
	 * @param {object} config
	 * @param {string} config.dbPath - Path to SQLite database file
	 * @param {object} [config.bullQueue] - Optional BullMQ Queue instance
	 * @param {'off'|'safe'|'auto'|'full_autonomous'} [config.mode='safe']
	 * @param {boolean} [config.selfImproveEnabled=false]
	 * @param {number} [config.loopIntervalMs=5000]
	 */
	constructor(config) {
		super()
		this.config = config
		this.mode = config.mode || SafetyMode.SAFE
		this.selfImproveEnabled = config.selfImproveEnabled || false
		this.loopIntervalMs = config.loopIntervalMs || 5000

		// Core modules (Phase 1)
		this.memory = null
		this.eventLog = null
		this.taskQueue = null

		// Phase 2 modules
		this.safetyManager = null
		this.agentRegistry = null

		// Phase 3 modules
		this.featureRegistry = null
		this.bugRegistry = null
		this.commitDeployLog = null

		// Phase 4 modules
		this.healingBus = null
		this.selfHealingLoop = null

		// Phase 5 modules
		this.parallelExecutor = null
		this.agentBus = null
		this.improvementLoop = null

		// Phase 6 modules
		this.crawlerAgent = null
		this.deployOrchestrator = null
		this.fileImporter = null
		this.cpuGuard = null

		// HermesClaw — Memory & Context Agent
		this.hermesClaw = null

		// Internal state
		this._running = false
		this._loopHandle = null
		this._startedAt = null

		// Task executor for smart multi-agent breakdown
		this.taskExecutor = null

		// Provider resolver (set by api.js for LLM-based breakdown)
		this._resolveProvider = null
		this._callChatCompletion = null
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────

	/**
	 * Initialize all modules and start the orchestrator.
	 */
	async start() {
		if (this._running) return

		// Initialize core persistence
		this.memory = new MemoryStore(this.config.dbPath)
		this.memory.initialize()

		// Initialize core modules
		this.eventLog = new EventLog(this.memory)
		this.taskQueue = new TaskQueueBullMQ(this.memory, {
			bullQueue: this.config.bullQueue || null,
		})

		// Initialize task executor for smart multi-agent breakdown
		this.taskExecutor = new TaskExecutor(this)

		// Log startup event
		this.eventLog.record({
			type: "orchestrator.started",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { mode: this.mode, selfImproveEnabled: this.selfImproveEnabled },
		})

		this._running = true
		this._startedAt = Date.now()

		// Start the main processing loop
		this._startLoop()

		this.emit("started", { mode: this.mode, startedAt: this._startedAt })
		console.log(`[CloudOrchestrator] Started in mode: ${this.mode}`)
	}

	/**
	 * Gracefully stop the orchestrator and all modules.
	 */
	async stop() {
		if (!this._running) return

		this._running = false

		// Stop the processing loop
		if (this._loopHandle) {
			clearTimeout(this._loopHandle)
			this._loopHandle = null
		}

		// Stop Phase 5 modules
		if (this.improvementLoop && typeof this.improvementLoop.stop === "function") {
			await this.improvementLoop.stop()
		}
		if (this.parallelExecutor && typeof this.parallelExecutor.stop === "function") {
			this.parallelExecutor.stop()
		}
		if (this.selfHealingLoop && typeof this.selfHealingLoop.stop === "function") {
			await this.selfHealingLoop.stop()
		}

		// Log shutdown
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.stopped",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}

		// Close database
		if (this.memory) {
			this.memory.close()
		}

		this.emit("stopped")
		console.log("[CloudOrchestrator] Stopped")
	}

	// ─── Mode Management ────────────────────────────────────────────────

	/**
	 * Set the safety mode.
	 * @param {'off'|'safe'|'auto'|'full_autonomous'} mode
	 */
	setMode(mode) {
		if (!Object.values(SafetyMode).includes(mode)) {
			throw new Error(`Invalid safety mode: ${mode}`)
		}
		this.mode = mode
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.mode_changed",
				source: "CloudOrchestrator",
				severity: "info",
				payload: { mode },
			})
		}
		this.emit("modeChanged", { mode })
	}

	/**
	 * Enable self-improvement capabilities.
	 */
	enableSelfImprove() {
		this.selfImproveEnabled = true
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.self_improve_enabled",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
	}

	/**
	 * Disable self-improvement capabilities.
	 */
	disableSelfImprove() {
		this.selfImproveEnabled = false
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.self_improve_disabled",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
	}

	// ─── Task Submission ────────────────────────────────────────────────

	/**
	 * Submit a new task for processing.
	 * @param {object} input
	 * @param {string} input.type - Task type
	 * @param {unknown} input.input - Task input data
	 * @param {number} [input.priority]
	 * @param {string} [input.agent]
	 * @param {string} [input.sessionId]
	 * @param {string} [input.parentTaskId]
	 * @returns {object} The created task
	 */
	submit(input) {
		const task = this.taskQueue.add(input)

		this.eventLog.record({
			type: "task.submitted",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { taskId: task.id, type: task.type, priority: task.priority },
			taskId: task.id,
			sessionId: input.sessionId,
		})

		this.emit("taskSubmitted", task)
		return task
	}

	/**
	 * Process the next pending task from the queue.
	 * Uses TaskExecutor for orchestrator-type tasks (multi-agent breakdown).
	 * For other task types, emits taskReady for external processing.
	 * @returns {Promise<object>} Processing result
	 */
	async processNext() {
		const task = this.taskQueue.nextPending()
		if (!task) {
			return { processed: false, reason: "no_pending_tasks" }
		}

		// Safety check (if safety manager is available)
		if (this.safetyManager) {
			const decision = this.safetyManager.checkCapability(task.type)
			if (!decision.allowed) {
				this.taskQueue.update(task.id, {
					status: "failed",
					error: `Blocked by safety: ${decision.reason}`,
				})
				this.eventLog.record({
					type: "task.blocked",
					source: "CloudOrchestrator",
					severity: "warning",
					payload: { taskId: task.id, reason: decision.reason },
					taskId: task.id,
				})
				return { processed: false, reason: `blocked: ${decision.reason}`, taskId: task.id }
			}
		}

		// Mark as running
		this.taskQueue.update(task.id, { status: "running" })

		this.eventLog.record({
			type: "task.started",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { taskId: task.id, type: task.type },
			taskId: task.id,
		})

		try {
			// ── Orchestrator-type tasks: use smart multi-agent breakdown ──
			if (task.type === "orchestrator" && this.taskExecutor) {
				const result = await this.taskExecutor.execute(task)

				if (result.ok) {
					this.completeTask(task.id, result.output)
				} else {
					this.failTask(task.id, result.error || "Orchestration failed")
				}

				// Trigger healing cycle on failure if available
				if (!result.ok && this.selfHealingLoop) {
					try {
						this.selfHealingLoop.runHealingCycle().catch((err) => {
							console.error("[CloudOrchestrator] Healing cycle error:", err.message)
						})
					} catch {
						// Non-blocking
					}
				}

				return { processed: true, taskId: task.id, task, result }
			}

			// ── Other task types: emit for external processing ────────────
			if (!this.taskQueue.bullQueue) {
				this.emit("taskReady", task)
			}

			return { processed: true, taskId: task.id, task }
		} catch (err) {
			this.taskQueue.update(task.id, {
				status: "failed",
				error: err.message,
			})

			this.eventLog.record({
				type: "task.failed",
				source: "CloudOrchestrator",
				severity: "error",
				payload: { taskId: task.id, error: err.message },
				taskId: task.id,
			})

			return { processed: false, reason: err.message, taskId: task.id }
		}
	}

	/**
	 * Complete a task with output.
	 * @param {string} taskId
	 * @param {unknown} output
	 */
	completeTask(taskId, output) {
		this.taskQueue.update(taskId, { status: "completed", output })

		this.eventLog.record({
			type: "task.completed",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { taskId },
			taskId,
		})

		this.emit("taskCompleted", { taskId, output })
	}

	/**
	 * Fail a task with an error.
	 * @param {string} taskId
	 * @param {string} error
	 */
	failTask(taskId, error) {
		this.taskQueue.update(taskId, { status: "failed", error })

		this.eventLog.record({
			type: "task.failed",
			source: "CloudOrchestrator",
			severity: "error",
			payload: { taskId, error },
			taskId,
		})

		this.emit("taskFailed", { taskId, error })
	}

	// ─── Processing Loop ────────────────────────────────────────────────

	/**
	 * Start the main processing loop.
	 */
	_startLoop() {
		const loop = async () => {
			if (!this._running) return

			try {
				await this.processNext()
			} catch (err) {
				console.error("[CloudOrchestrator] Loop error:", err.message)
			}

			if (this._running) {
				this._loopHandle = setTimeout(loop, this.loopIntervalMs)
			}
		}

		this._loopHandle = setTimeout(loop, 100)
	}

	/**
	 * Run the processing loop with custom options.
	 * @param {object} [opts]
	 * @param {number} [opts.idleSleepMs=5000]
	 * @param {number} [opts.maxIterations]
	 * @returns {Promise<void>}
	 */
	async runLoop(opts = {}) {
		const idleSleepMs = opts.idleSleepMs || 5000
		const maxIterations = opts.maxIterations || Infinity
		let iterations = 0

		while (this._running && iterations < maxIterations) {
			const result = await this.processNext()
			iterations++

			if (!result.processed) {
				await new Promise((resolve) => setTimeout(resolve, idleSleepMs))
			}
		}
	}

	// ─── Module Registration (for Phases 2-6) ───────────────────────────

	/**
	 * Register the SafetyManager module.
	 * @param {object} safetyManager
	 */
	registerSafetyManager(safetyManager) {
		this.safetyManager = safetyManager
	}

	/**
	 * Register the AgentRegistry module.
	 * @param {object} agentRegistry
	 */
	registerAgentRegistry(agentRegistry) {
		this.agentRegistry = agentRegistry
	}

	/**
	 * Register the FeatureRegistry module.
	 * @param {object} featureRegistry
	 */
	registerFeatureRegistry(featureRegistry) {
		this.featureRegistry = featureRegistry
	}

	/**
	 * Register the BugRegistry module.
	 * @param {object} bugRegistry
	 */
	registerBugRegistry(bugRegistry) {
		this.bugRegistry = bugRegistry
	}

	/**
	 * Register the CommitDeployLog module.
	 * @param {object} commitDeployLog
	 */
	registerCommitDeployLog(commitDeployLog) {
		this.commitDeployLog = commitDeployLog
	}

	/**
	 * Register the HealingBus module.
	 * @param {object} healingBus
	 */
	registerHealingBus(healingBus) {
		this.healingBus = healingBus
	}

	/**
	 * Register the SelfHealingLoop module.
	 * @param {object} selfHealingLoop
	 */
	registerSelfHealingLoop(selfHealingLoop) {
		this.selfHealingLoop = selfHealingLoop
	}

	/**
	 * Register the ParallelExecutor module.
	 * @param {object} parallelExecutor
	 */
	registerParallelExecutor(parallelExecutor) {
		this.parallelExecutor = parallelExecutor
	}

	/**
	 * Register the AgentBus module.
	 * @param {object} agentBus
	 */
	registerAgentBus(agentBus) {
		this.agentBus = agentBus
	}

	/**
	 * Register the InfiniteImprovementLoop module.
	 * @param {object} improvementLoop
	 */
	registerImprovementLoop(improvementLoop) {
		this.improvementLoop = improvementLoop
	}

	/**
	 * Register the CrawlerAgent module.
	 * @param {object} crawlerAgent
	 */
	registerCrawlerAgent(crawlerAgent) {
		this.crawlerAgent = crawlerAgent
	}

	/**
	 * Register the DeployOrchestrator module.
	 * @param {object} deployOrchestrator
	 */
	registerDeployOrchestrator(deployOrchestrator) {
		this.deployOrchestrator = deployOrchestrator
	}

	/**
	 * Register the FileImporter module.
	 * @param {object} fileImporter
	 */
	registerFileImporter(fileImporter) {
		this.fileImporter = fileImporter
	}

	/**
	 * Register the CPUGuard module.
	 * @param {object} cpuGuard
	 */
	registerCPUGuard(cpuGuard) {
		this.cpuGuard = cpuGuard
	}

	/**
	 * Set the provider resolver function (called by api.js during init).
	 * This enables LLM-based multi-agent breakdown in TaskExecutor.
	 * @param {Function} resolveProviderFn
	 * @param {Function} callChatCompletionFn
	 */
	setProviderResolver(resolveProviderFn, callChatCompletionFn) {
		this._resolveProvider = resolveProviderFn
		this._callChatCompletion = callChatCompletionFn
		if (this.taskExecutor) {
			console.log("[CloudOrchestrator] Provider resolver set — LLM-based breakdown enabled")
		}
	}

	/**
	 * Register the HermesClaw memory & context agent.
	 * @param {object} hermesClaw - HermesClaw instance
	 */
	registerHermesClaw(hermesClaw) {
		this.hermesClaw = hermesClaw
		// Wire into TaskExecutor for context recall & lesson extraction
		if (this.taskExecutor && typeof this.taskExecutor.setHermesClaw === "function") {
			this.taskExecutor.setHermesClaw(hermesClaw)
		}
		console.log("[CloudOrchestrator] HermesClaw registered")
	}

	// ─── Status ─────────────────────────────────────────────────────────

	/**
	 * Get orchestrator status.
	 * @returns {object}
	 */
	getStatus() {
		return {
			running: this._running,
			mode: this.mode,
			selfImproveEnabled: this.selfImproveEnabled,
			startedAt: this._startedAt,
			uptime: this._startedAt ? Date.now() - this._startedAt : 0,
			modules: {
				memory: !!this.memory,
				eventLog: !!this.eventLog,
				taskQueue: !!this.taskQueue,
				safetyManager: !!this.safetyManager,
				agentRegistry: !!this.agentRegistry,
				featureRegistry: !!this.featureRegistry,
				bugRegistry: !!this.bugRegistry,
				commitDeployLog: !!this.commitDeployLog,
				healingBus: !!this.healingBus,
				selfHealingLoop: !!this.selfHealingLoop,
				parallelExecutor: !!this.parallelExecutor,
				agentBus: !!this.agentBus,
				improvementLoop: !!this.improvementLoop,
				crawlerAgent: !!this.crawlerAgent,
				deployOrchestrator: !!this.deployOrchestrator,
				fileImporter: !!this.fileImporter,
				cpuGuard: !!this.cpuGuard,
				hermesClaw: !!this.hermesClaw,
			},
			taskStats: this.taskQueue ? this.taskQueue.getStats() : null,
			eventStats: this.eventLog ? this.eventLog.getStats() : null,
		}
	}
}

module.exports = { CloudOrchestrator, SafetyMode }
