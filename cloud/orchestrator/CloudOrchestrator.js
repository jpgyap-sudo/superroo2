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
 *   - RAM-aware scheduling and worker management
 */

const EventEmitter = require("events")
const MemoryStore = require("./stores/MemoryStore")
const EventLog = require("./modules/EventLog")
const TaskQueueBullMQ = require("./modules/TaskQueueBullMQ")
const { TaskExecutor } = require("./modules/TaskExecutor")
const { ContextAssembler } = require("./modules/ContextAssembler")
const { RAMMonitor } = require("./modules/RAMMonitor")
const { RAMScheduler } = require("./modules/RAMScheduler")
const { WorkerPauseManager } = require("./modules/WorkerPauseManager")
const { PromptCustomizer } = require("./modules/PromptCustomizer")
const { ReasoningConfig } = require("./modules/ReasoningConfig")

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
		this.parallelHealing = null
		this.parallelML = null
		this.agentBus = null
		this.improvementLoop = null

		// Phase 6 modules
		this.crawlerAgent = null
		this.deployOrchestrator = null
		this.fileImporter = null
		this.cpuGuard = null

		// Global Build Orchestrator (cross-agent build task compilation)
		this.globalBuildOrchestrator = null

		// HermesClaw — Memory & Context Agent
		this.hermesClaw = null
		this.learningGateway = null

		// RAM Orchestrator modules (Phase 7)
		this.ramMonitor = null
		this.ramScheduler = null
		this.workerPauseManager = null

		// Sprint 3 modules
		this.promptCustomizer = null
		this.reasoningConfig = null

		// Internal state
		this._running = false
		this._loopHandle = null
		this._startedAt = null

		// Task executor for smart multi-agent breakdown
		this.taskExecutor = null

		// Context assembler for task enrichment (combats context starvation)
		this.contextAssembler = null

		// Cross-task context chaining: maps parentTaskId → {goal, output, phases}
		/** @type {Map<string, {goal: string, output: string[], phases: Array, completedAt: number}>} */
		this._completedTaskContexts = new Map()
		this._maxChainedContexts = 50
		this._chainedContextCategory = "chained_context"

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

		// Load persisted chained contexts from SQLite for crash recovery
		this._loadChainedContexts()

		// Log startup event
		this.eventLog.record({
			type: "orchestrator.started",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { mode: this.mode, selfImproveEnabled: this.selfImproveEnabled },
		})

		this._running = true
		this._startedAt = Date.now()

		// Start the main processing loop only if this process is the leader.
		// In PM2 multi-process mode, only the instance with ORCHESTRATOR_LEADER=true
		// runs the loop to prevent duplicate task processing.
		if (process.env.ORCHESTRATOR_LEADER === "true") {
			this._startLoop()
			console.log("[CloudOrchestrator] Leader mode — processing loop started")
		} else {
			console.log("[CloudOrchestrator] Follower mode — processing loop disabled (awaiting leader tasks)")
		}

		this.emit("started", { mode: this.mode, startedAt: this._startedAt })
		console.log(`[CloudOrchestrator] Started in mode: ${this.mode}`)

		// Log which optional modules are unregistered so gaps are visible in PM2 logs
		const status = this.getStatus()
		const coreModules = new Set(["memory", "eventLog", "taskQueue"])
		const unregistered = status.unloadedModules.filter((m) => !coreModules.has(m))
		if (unregistered.length > 0) {
			console.log(`[CloudOrchestrator] Optional modules not registered: ${unregistered.join(", ")}`)
		}
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
		// Pre-check capabilities at submit time so we fail fast in OFF/SAFE.
		// Ported from SuperRooOrchestrator.submit() (src/super-roo/orchestrator/SuperRooOrchestrator.ts).
		if (this.safetyManager) {
			const decision = this.safetyManager.checkCapability(input.type)
			if (!decision.allowed) {
				// We still record the task so it appears in the dashboard, but mark it blocked.
				const task = this.taskQueue.add({
					...input,
					status: "failed",
					error: `Blocked by safety: ${decision.reason}`,
				})

				this.eventLog.record({
					type: "task.blocked",
					source: "CloudOrchestrator",
					severity: "warning",
					payload: { taskId: task.id, type: task.type, reason: decision.reason },
					taskId: task.id,
					sessionId: input.sessionId,
				})

				this.emit("taskSubmitted", task)
				return task
			}
		}

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
		// Atomically claim the next pending task for this worker.
		// claimNext() uses a single UPDATE ... RETURNING * to prevent
		// the race condition inherent in the two-statement SELECT-then-UPDATE pattern.
		const workerId = `worker-${process.pid}-${Date.now()}`
		const task = this.taskQueue.claimNext(workerId)
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

		this.eventLog.record({
			type: "task.started",
			source: "CloudOrchestrator",
			severity: "info",
			payload: { taskId: task.id, type: task.type },
			taskId: task.id,
		})

		try {
			// ── Context assembly: enrich task before execution ─────────────
			// ContextAssembler gathers FeatureRegistry entries, recent EventLog
			// events, LearningGateway lessons, and a repo file-tree snapshot.
			// This combats context starvation — the root cause of weak cloud
			// coding output.
			if (this.contextAssembler && task.type === "orchestrator") {
				try {
					const context = await this.contextAssembler.assemble(task)
					const contextText = this.contextAssembler.formatContext(context)

					// ── Cross-task context chaining (Improvement #5) ──────────
					// If this task has a parentTaskId, inject the parent's context
					// so the breakdown planner knows what was already done.
					let chainedContextText = ""
					if (task.parentTaskId && this._completedTaskContexts.has(task.parentTaskId)) {
						const parentCtx = this._completedTaskContexts.get(task.parentTaskId)
						chainedContextText = [
							`Parent Task Goal: ${parentCtx.goal}`,
							`Parent Task Output:`,
							...(parentCtx.output || []).map((l) => `  ${l}`),
							parentCtx.phases.length > 0
								? `Parent Task Phases: ${parentCtx.phases.map((p) => p.title || p).join(" → ")}`
								: "",
						]
							.filter(Boolean)
							.join("\n")
					}

					// Also chain sibling tasks (same parentTaskId, already completed)
					if (task.parentTaskId) {
						const siblingContexts = []
						for (const [tid, ctx] of this._completedTaskContexts) {
							if (tid !== task.id && tid.startsWith(task.parentTaskId)) {
								siblingContexts.push(`  - ${ctx.goal.substring(0, 100)}`)
							}
						}
						if (siblingContexts.length > 0) {
							chainedContextText +=
								"\nCompleted Sibling Tasks:\n" + siblingContexts.slice(0, 5).join("\n")
						}
					}

					// Attach context to task metadata so TaskExecutor can inject it
					// into the LLM breakdown prompt.
					task.metadata = task.metadata || {}
					task.metadata.context = context
					task.metadata.contextText = contextText
					task.metadata.chainedContext = chainedContextText || undefined

					// ── BullMQ Job-Level Context Assembly (Improvement #10) ──
					// Attach assembled context directly to the BullMQ job payload
					// so workers don't need to re-assemble context.
					if (this.taskQueue && this.taskQueue.bullQueue) {
						try {
							const bullJobPayload = {
								assembledContext: {
									features: context.features.slice(0, 10),
									lessons: (context.lessons || []).slice(0, 5),
									hasFileTree: !!context.fileTree,
									contextText: contextText.substring(0, 4000),
									chainedContext: chainedContextText
										? chainedContextText.substring(0, 2000)
										: undefined,
									complexity: context.complexity,
									tokenBudget: context.tokenBudget,
								},
							}
							// Store in task metadata for BullMQ dispatch
							task.metadata.bullJobContext = bullJobPayload
						} catch (bullCtxErr) {
							console.warn(
								"[CloudOrchestrator] BullMQ context attachment error (non-fatal):",
								bullCtxErr.message,
							)
						}
					}

					this.eventLog.record({
						type: "task.context_assembled",
						source: "CloudOrchestrator",
						severity: "info",
						payload: {
							taskId: task.id,
							features: context.features.length,
							events: context.recentEvents.length,
							lessons: context.lessons.length,
							hasFileTree: !!context.fileTree,
							complexity: context.complexity,
							tokenBudget: context.tokenBudget,
							hasChainedContext: !!chainedContextText,
							hasBullJobContext: !!task.metadata.bullJobContext,
						},
						taskId: task.id,
					})
				} catch (ctxErr) {
					console.warn("[CloudOrchestrator] Context assembly error (non-fatal):", ctxErr.message)
				}
			}

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

		// Store completed task context for cross-task chaining (Improvement #5)
		// This allows subsequent tasks to reference the goal and output of related tasks.
		try {
			const task = this.taskQueue.get(taskId)
			if (task) {
				const instruction =
					typeof task.input === "string"
						? task.input
						: task.input?.instruction || task.input?.description || ""
				const chainedContext = {
					goal: instruction.substring(0, 500),
					output: Array.isArray(output) ? output.slice(0, 20) : [String(output).substring(0, 500)],
					phases: task.metadata?.phases || [],
					completedAt: Date.now(),
				}
				this._completedTaskContexts.set(taskId, chainedContext)

				// Persist to SQLite for crash recovery
				if (this.memory) {
					try {
						this.memory.set(
							`chained:${taskId}`,
							JSON.stringify(chainedContext),
							this._chainedContextCategory,
						)
					} catch {
						// Non-blocking
					}
				}

				// Evict oldest entries if over limit
				if (this._completedTaskContexts.size > this._maxChainedContexts) {
					const oldestKey = this._completedTaskContexts.keys().next().value
					this._completedTaskContexts.delete(oldestKey)
					// Also remove from SQLite
					if (this.memory) {
						try {
							this.memory.delete(`chained:${oldestKey}`)
						} catch {
							// Non-blocking
						}
					}
				}
			}
		} catch {
			// Non-blocking
		}

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
	 * Register the ParallelHealingPipeline module.
	 * @param {object} parallelHealing
	 */
	registerParallelHealing(parallelHealing) {
		this.parallelHealing = parallelHealing
	}

	/**
	 * Ensure ParallelHealingPipeline is initialized.
	 * @returns {object} The parallelHealing instance
	 */
	ensureParallelHealing() {
		if (this.parallelHealing) return this.parallelHealing
		const { ParallelHealingPipeline } = require("./modules/ParallelHealingPipeline")
		const ph = new ParallelHealingPipeline(this.healingBus, this.eventLog, {})
		this.parallelHealing = ph
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.parallel_healing_lazy_init",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
		console.log("[CloudOrchestrator] ParallelHealingPipeline lazy-initialized")
		return ph
	}

	/**
	 * Register the ParallelMLTrainer module.
	 * @param {object} parallelML
	 */
	registerParallelML(parallelML) {
		this.parallelML = parallelML
	}

	/**
	 * Ensure ParallelMLTrainer is initialized.
	 * @returns {object} The parallelML instance
	 */
	ensureParallelML() {
		if (this.parallelML) return this.parallelML
		const { ParallelMLTrainer } = require("./modules/ParallelMLTrainer")
		const ml = new ParallelMLTrainer(this.eventLog, { enabled: false })
		this.parallelML = ml
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.parallel_ml_lazy_init",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
		console.log("[CloudOrchestrator] ParallelMLTrainer lazy-initialized")
		return ml
	}

	/**
	 * Ensure ParallelExecutor is initialized, creating a default instance if needed.
	 * Supports lazy initialization for dashboard endpoints that query stats before
	 * the full registration cycle completes (non-blocking API startup).
	 * @returns {object} The parallelExecutor instance
	 */
	ensureParallelExecutor() {
		if (this.parallelExecutor) return this.parallelExecutor
		const { ParallelExecutor } = require("./modules/ParallelExecutor")
		const pe = new ParallelExecutor({
			maxConcurrency: 2,
			maxTokens: 100,
			agentRegistry: this.agentRegistry || null,
		})
		pe.start()
		this.parallelExecutor = pe
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.parallel_executor_lazy_init",
				source: "CloudOrchestrator",
				severity: "info",
				payload: { maxConcurrency: pe.maxConcurrency, maxTokens: pe.maxTokens },
			})
		}
		console.log("[CloudOrchestrator] ParallelExecutor lazy-initialized")
		return pe
	}

	/**
	 * Register the AgentBus module.
	 * @param {object} agentBus
	 */
	registerAgentBus(agentBus) {
		this.agentBus = agentBus
	}

	/**
	 * Ensure AgentBus is initialized, creating a default instance if needed.
	 * @returns {object} The agentBus instance
	 */
	ensureAgentBus() {
		if (this.agentBus) return this.agentBus
		const { AgentBus } = require("./modules/AgentBus")
		const bus = new AgentBus({ memoryStore: this.memory || null })
		bus.initialize()
		this.agentBus = bus
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.agent_bus_lazy_init",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
		console.log("[CloudOrchestrator] AgentBus lazy-initialized")
		return bus
	}

	/**
	 * Register the InfiniteImprovementLoop module.
	 * @param {object} improvementLoop
	 */
	registerImprovementLoop(improvementLoop) {
		this.improvementLoop = improvementLoop
	}

	/**
	 * Ensure ImprovementLoop is initialized, creating a default instance if needed.
	 * @returns {object} The improvementLoop instance
	 */
	ensureImprovementLoop() {
		if (this.improvementLoop) return this.improvementLoop
		if (!this.memory) {
			console.warn("[CloudOrchestrator] Cannot lazy-init ImprovementLoop — memory not available")
			return null
		}
		const { InfiniteImprovementLoop } = require("./modules/InfiniteImprovementLoop")
		const loop = new InfiniteImprovementLoop({
			memoryStore: this.memory,
			taskQueue: this.taskQueue || null,
		})
		this.improvementLoop = loop
		if (this.eventLog) {
			this.eventLog.record({
				type: "orchestrator.improvement_loop_lazy_init",
				source: "CloudOrchestrator",
				severity: "info",
			})
		}
		console.log("[CloudOrchestrator] ImprovementLoop lazy-initialized")
		return loop
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
	 * Ensure CPUGuard namespace is initialized with default functions if needed.
	 * @returns {object} The cpuGuard namespace
	 */
	ensureCPUGuard() {
		if (this.cpuGuard) return this.cpuGuard
		const { getCpuUsagePercent, getRamUsagePercent } = require("./modules/CPUGuard")
		const guard = {
			getCpuUsagePercent: getCpuUsagePercent || (() => 0),
			getRamUsagePercent: getRamUsagePercent || (() => 0),
		}
		this.cpuGuard = guard
		console.log("[CloudOrchestrator] CPUGuard lazy-initialized")
		return guard
	}

	/**
	 * Register the GlobalBuildOrchestrator module.
	 * Compiles build tasks from Claude Code, Codex, SuperRoo agents and queues
	 * Docker image builds with VPS-aware throttling.
	 * @param {object} globalBuildOrchestrator
	 */
	registerGlobalBuildOrchestrator(globalBuildOrchestrator) {
		this.globalBuildOrchestrator = globalBuildOrchestrator
		console.log("[CloudOrchestrator] GlobalBuildOrchestrator registered")
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

	registerLearningGateway(learningGateway) {
		this.learningGateway = learningGateway
		console.log("[CloudOrchestrator] LearningGateway registered")
	}

	/**
	 * Register the ContextAssembler module.
	 *
	 * ContextAssembler enriches tasks with FeatureRegistry entries, recent
	 * EventLog events, LearningGateway lessons, and a repo file-tree snapshot
	 * before they are dispatched to TaskExecutor. This combats context
	 * starvation — the root cause of weak cloud coding output.
	 *
	 * @param {import('./modules/ContextAssembler')} contextAssembler
	 */
	registerContextAssembler(contextAssembler) {
		this.contextAssembler = contextAssembler
		// Wire safety manager to context assembler for safety-aware filtering
		if (contextAssembler && this.safetyManager) {
			contextAssembler.safetyManager = this.safetyManager
		}
		console.log("[CloudOrchestrator] ContextAssembler registered")
	}

	// ─── RAM Orchestrator Registration (Phase 7) ────────────────────────

	/**
	 * Register the RAMMonitor module.
	 * @param {import('./modules/RAMMonitor')} ramMonitor
	 */
	registerRAMMonitor(ramMonitor) {
		this.ramMonitor = ramMonitor
		console.log("[CloudOrchestrator] RAMMonitor registered")
	}

	/**
	 * Register the RAMScheduler module.
	 * @param {import('./modules/RAMScheduler')} ramScheduler
	 */
	registerRAMScheduler(ramScheduler) {
		this.ramScheduler = ramScheduler
		console.log("[CloudOrchestrator] RAMScheduler registered")
	}

	/**
	 * Register the WorkerPauseManager module.
	 * @param {import('./modules/WorkerPauseManager')} workerPauseManager
	 */
	registerWorkerPauseManager(workerPauseManager) {
		this.workerPauseManager = workerPauseManager
		console.log("[CloudOrchestrator] WorkerPauseManager registered")
	}

	// ─── Sprint 3 Module Registration ───────────────────────────────────

	/**
	 * Register the PromptCustomizer module.
	 * Provides prompt variant sets, slash commands, and agent variable documentation.
	 * @param {import('./modules/PromptCustomizer')} promptCustomizer
	 */
	registerPromptCustomizer(promptCustomizer) {
		this.promptCustomizer = promptCustomizer
		console.log("[CloudOrchestrator] PromptCustomizer registered")
	}

	/**
	 * Register the ReasoningConfig module.
	 * Provides provider-agnostic reasoning level abstraction and per-provider mapping.
	 * @param {import('./modules/ReasoningConfig')} reasoningConfig
	 */
	registerReasoningConfig(reasoningConfig) {
		this.reasoningConfig = reasoningConfig
		console.log("[CloudOrchestrator] ReasoningConfig registered")
	}

	// ─── Status ─────────────────────────────────────────────────────────

	/**
	 * Get orchestrator status.
	 * @returns {object}
	 */
	getStatus() {
		const moduleEntries = {
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
			parallelHealing: !!this.parallelHealing,
			parallelML: !!this.parallelML,
			agentBus: !!this.agentBus,
			improvementLoop: !!this.improvementLoop,
			crawlerAgent: !!this.crawlerAgent,
			deployOrchestrator: !!this.deployOrchestrator,
			fileImporter: !!this.fileImporter,
			cpuGuard: !!this.cpuGuard,
			globalBuildOrchestrator: !!this.globalBuildOrchestrator,
			hermesClaw: !!this.hermesClaw,
			learningGateway: !!this.learningGateway,
			ramMonitor: !!this.ramMonitor,
			ramScheduler: !!this.ramScheduler,
			workerPauseManager: !!this.workerPauseManager,
			promptCustomizer: !!this.promptCustomizer,
			reasoningConfig: !!this.reasoningConfig,
		}
		return {
			running: this._running,
			mode: this.mode,
			selfImproveEnabled: this.selfImproveEnabled,
			startedAt: this._startedAt,
			uptime: this._startedAt ? Date.now() - this._startedAt : 0,
			modules: moduleEntries,
			// Report which modules are actually loaded vs just defined as null slots
			loadedModules: Object.entries(moduleEntries)
				.filter(([, loaded]) => loaded)
				.map(([name]) => name),
			unloadedModules: Object.entries(moduleEntries)
				.filter(([, loaded]) => !loaded)
				.map(([name]) => name),
			taskStats: this.taskQueue ? this.taskQueue.getStats() : null,
			eventStats: this.eventLog ? this.eventLog.getStats() : null,
		}
	}

	/**
	 * Load persisted chained contexts from SQLite for crash recovery.
	 * Restores the _completedTaskContexts map from the previous session.
	 */
	_loadChainedContexts() {
		if (!this.memory) return
		try {
			const rows = this.memory.listByCategory(this._chainedContextCategory)
			if (!rows || rows.length === 0) return

			let loaded = 0
			for (const row of rows) {
				try {
					const parsed = JSON.parse(row.value)
					if (parsed && parsed.goal) {
						// Extract taskId from the key (format: "chained:<taskId>")
						const taskId = row.key.replace("chained:", "")
						this._completedTaskContexts.set(taskId, parsed)
						loaded++
					}
				} catch {
					// Skip malformed entries
				}
			}

			if (loaded > 0) {
				console.log(`[CloudOrchestrator] Loaded ${loaded} chained contexts from SQLite`)
			}
		} catch (err) {
			console.warn("[CloudOrchestrator] Failed to load chained contexts:", err.message)
		}
	}
}

module.exports = { CloudOrchestrator, SafetyMode }
