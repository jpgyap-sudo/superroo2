/**
 * Super Roo ML — Infinite Improvement Loop
 *
 * The core of SuperRoo's self-improving capability.
 *
 * Workflow:
 *   1. OBSERVE   — collect task outcomes, test results, bug reports with richer labels
 *   2. LEARN     — train CodeLearner, DebugLearner, TestLearner end-to-end
 *   3. PREDICT   — score upcoming tasks, predict failures, prioritise work
 *   4. ACT       — submit follow-up tasks via orchestrator (validated)
 *   5. EVALUATE  — compare predicted vs actual outcomes, track metrics
 *   6. PERSIST   — save model weights so learning survives restarts
 *   7. LOOP      — sleep and repeat
 */

import type { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"
import type { Task, TaskInputRaw } from "../../types"
import { CancellableSleep } from "../../utils/CancellableSleep"
import { CodeLearner } from "../learning/CodeLearner"
import { DebugLearner } from "../learning/DebugLearner"
import { TestLearner } from "../learning/TestLearner"
import { ActionOutcomeTracker } from "../engine/Metrics"

export interface LoopConfig {
	/** Minimum samples before training starts. */
	minSamples: number
	/** Maximum iterations before forced checkpoint. */
	maxIterations: number
	/** Sleep ms between loops when idle. */
	idleSleepMs: number
	/** Training epochs per loop iteration. */
	trainEpochs: number
	/** Confidence threshold for auto-acting on predictions. */
	confidenceThreshold: number
	/** Directory to persist model weights. */
	modelDir?: string
	/** Max auto-actions per loop iteration to avoid runaway queuing. */
	maxActionsPerIteration: number
}

export interface LoopStats {
	iteration: number
	totalSamples: number
	lastTrainLoss: number
	predictionsMade: number
	actionsTaken: number
	lastMetrics: {
		code?: object
		debug?: object
		test?: object
	}
	actionHelpRate: number
}

export interface ValidationResult {
	valid: boolean
	reason?: string
}

export class InfiniteImprovementLoop {
	private running = false
	private handle: Promise<void> | null = null
	private stats: LoopStats = {
		iteration: 0,
		totalSamples: 0,
		lastTrainLoss: 0,
		predictionsMade: 0,
		actionsTaken: 0,
		lastMetrics: {},
		actionHelpRate: 0,
	}

	private codeLearner: CodeLearner
	private debugLearner: DebugLearner
	private testLearner: TestLearner
	private sleeper = new CancellableSleep()
	private outcomeTracker = new ActionOutcomeTracker()
	private actionCountThisIteration = 0

	constructor(
		private readonly orchestrator: SuperRooOrchestrator,
		private readonly config: LoopConfig = {
			minSamples: 5,
			maxIterations: 1000,
			idleSleepMs: 5000,
			trainEpochs: 20,
			confidenceThreshold: 0.75,
			maxActionsPerIteration: 3,
		},
	) {
		this.codeLearner = new CodeLearner({
			inputDim: 8,
			epochs: this.config.trainEpochs,
			modelDir: this.config.modelDir,
		})
		this.debugLearner = new DebugLearner({
			inputDim: 8,
			epochs: this.config.trainEpochs,
			modelDir: this.config.modelDir,
		})
		this.testLearner = new TestLearner({
			inputDim: 8,
			epochs: this.config.trainEpochs,
			modelDir: this.config.modelDir,
		})
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	async start(): Promise<void> {
		if (this.running) return
		this.running = true
		this.sleeper.start()
		this.orchestrator.events.info("ml.loop.started", "Infinite Improvement Loop started")

		// Attempt to restore prior learned weights
		try {
			const restored = await Promise.all([
				this.codeLearner.restore(),
				this.debugLearner.restore(),
				this.testLearner.restore(),
			])
			if (restored.some(Boolean)) {
				this.orchestrator.events.info("ml.loop.restore", "Restored saved model weights", {
					data: { code: restored[0], debug: restored[1], test: restored[2] },
				})
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.warn("ml.loop.restore_error", `Could not restore weights: ${msg}`)
		}

		this.handle = this.loop()
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		this.sleeper.stop()
		if (this.handle) {
			try {
				await this.handle
			} catch {
				/* loop will have logged */
			}
		}

		// Persist learned weights before shutting down
		try {
			await Promise.all([this.codeLearner.save(), this.debugLearner.save(), this.testLearner.save()])
			this.orchestrator.events.info("ml.loop.saved", "Saved model weights before stop")
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.warn("ml.loop.save_error", `Could not save weights: ${msg}`)
		}

		this.orchestrator.events.info("ml.loop.stopped", "Infinite Improvement Loop stopped")
	}

	getStats(): LoopStats {
		return { ...this.stats }
	}

	// ── Core loop ─────────────────────────────────────────────────────────────

	private async loop(): Promise<void> {
		let consecutiveFailures = 0
		const maxConsecutiveFailures = 5

		while (this.running && this.stats.iteration < this.config.maxIterations) {
			this.stats.iteration++
			this.actionCountThisIteration = 0
			try {
				await this.observeAndLearn()
				await this.predictAndAct()
				consecutiveFailures = 0
				await this.sleeper.sleep(this.config.idleSleepMs)
			} catch (err) {
				consecutiveFailures++
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error(
					"ml.loop.error",
					`Loop error (${consecutiveFailures}/${maxConsecutiveFailures}): ${msg}`,
				)

				if (consecutiveFailures >= maxConsecutiveFailures) {
					this.orchestrator.events.error(
						"ml.loop.fatal",
						`Too many consecutive failures (${consecutiveFailures}), stopping loop`,
					)
					this.running = false
					break
				}

				// Exponential backoff on error
				const backoffMs = Math.min(this.config.idleSleepMs * Math.pow(2, consecutiveFailures - 1), 60000)
				await this.sleeper.sleep(backoffMs)
			}
		}
	}

	// ── Phase 1: Observe + Learn ──────────────────────────────────────────────

	private async observeAndLearn(): Promise<void> {
		// Collect recent task outcomes
		const tasks = this.orchestrator.queue.list({ limit: 100 })
		const codeSamples = this.extractCodeSamples(tasks)
		const debugSamples = this.extractDebugSamples(tasks)
		const testSamples = this.extractTestSamples(tasks)

		this.stats.totalSamples = codeSamples.length + debugSamples.length + testSamples.length

		if (this.stats.totalSamples < this.config.minSamples) {
			this.orchestrator.events.debug(
				"ml.loop.observe",
				`Waiting for more samples (${this.stats.totalSamples}/${this.config.minSamples})`,
			)
			return
		}

		// Train each learner with error handling
		let codeLoss: { qualityLoss: number; successLoss: number; bugRiskLoss: number }
		let debugLoss: { causeLoss: number; complexityLoss: number; fixSuccessLoss: number }
		let testLoss: { failLoss: number; timeLoss: number; coverageLoss: number }

		try {
			codeLoss = this.codeLearner.train(codeSamples)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.error("ml.loop.train_error", `CodeLearner training failed: ${msg}`)
			codeLoss = { qualityLoss: NaN, successLoss: NaN, bugRiskLoss: NaN }
		}

		try {
			debugLoss = this.debugLearner.train(debugSamples)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.error("ml.loop.train_error", `DebugLearner training failed: ${msg}`)
			debugLoss = { causeLoss: NaN, complexityLoss: NaN, fixSuccessLoss: NaN }
		}

		try {
			testLoss = this.testLearner.train(testSamples)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.error("ml.loop.train_error", `TestLearner training failed: ${msg}`)
			testLoss = { failLoss: NaN, timeLoss: NaN, coverageLoss: NaN }
		}

		// Validate losses are finite numbers
		const allLosses = [
			codeLoss.qualityLoss,
			codeLoss.successLoss,
			codeLoss.bugRiskLoss,
			debugLoss.causeLoss,
			debugLoss.complexityLoss,
			debugLoss.fixSuccessLoss,
			testLoss.failLoss,
			testLoss.timeLoss,
			testLoss.coverageLoss,
		].filter((v) => !Number.isNaN(v))

		if (allLosses.length === 0) {
			this.orchestrator.events.warn("ml.loop.train_error", "All training losses are NaN, models may be corrupted")
			this.stats.lastTrainLoss = NaN
			// Reset learners to recover from corrupted state
			this.codeLearner = new CodeLearner({
				inputDim: 8,
				epochs: this.config.trainEpochs,
				modelDir: this.config.modelDir,
			})
			this.debugLearner = new DebugLearner({
				inputDim: 8,
				epochs: this.config.trainEpochs,
				modelDir: this.config.modelDir,
			})
			this.testLearner = new TestLearner({
				inputDim: 8,
				epochs: this.config.trainEpochs,
				modelDir: this.config.modelDir,
			})
			this.orchestrator.events.info("ml.loop.reset", "Reset all learners due to NaN losses")
			return
		}

		const avgLoss = allLosses.reduce((a, b) => a + b, 0) / allLosses.length
		this.stats.lastTrainLoss = avgLoss

		// Evaluate metrics on the latest samples
		const codeMetrics = this.codeLearner.evaluate(codeSamples)
		const debugMetrics = this.debugLearner.evaluate(debugSamples)
		const testMetrics = this.testLearner.evaluate(testSamples)
		this.stats.lastMetrics = { code: codeMetrics, debug: debugMetrics, test: testMetrics }

		this.orchestrator.events.info("ml.loop.learn", `Trained on ${this.stats.totalSamples} samples`, {
			data: {
				codeLoss,
				debugLoss,
				testLoss,
				avgLoss,
				codeMetrics,
				debugMetrics,
				testMetrics,
			},
		})

		// Persist after successful training
		try {
			await Promise.all([this.codeLearner.save(), this.debugLearner.save(), this.testLearner.save()])
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.warn("ml.loop.save_error", `Failed to save weights after training: ${msg}`)
		}
	}

	// ── Phase 2: Predict + Act ────────────────────────────────────────────────

	private async predictAndAct(): Promise<void> {
		// Score pending tasks
		const pending = this.orchestrator.queue.list({ status: "pending" })
		for (const task of pending) {
			const features = this.taskToFeatures(task)

			const codePred = this.codeLearner.predict(features)
			const debugPred = this.debugLearner.predict(features)
			const testPred = this.testLearner.predict(features)

			this.stats.predictionsMade++

			// If high bug risk predicted, queue pre-emptive debug task
			const bugRiskAction = {
				confidence: codePred.successProb,
				agent: "debugger" as const,
				reason: `Pre-emptive debug for task ${task.id}: predicted high bug risk`,
				payload: {
					predictedBugRisk: codePred.bugRiskClass,
					predictedSuccess: codePred.successProb,
				},
			}
			if (
				codePred.bugRiskClass >= 2 &&
				codePred.successProb < this.config.confidenceThreshold &&
				this.validateAction(bugRiskAction, task).valid
			) {
				const followup: TaskInputRaw = {
					agent: "debugger",
					goal: bugRiskAction.reason,
					priority: "high",
					parentTaskId: task.id,
					payload: bugRiskAction.payload,
				}
				this.orchestrator.submit(followup)
				this.stats.actionsTaken++
				this.actionCountThisIteration++
				this.outcomeTracker.record(
					`${task.id}-bugrisk`,
					"debugger",
					codePred.successProb,
					/* beforeScore */ 0.5,
					/* afterScore placeholder */ 0.5,
				)
			}

			if (this.actionCountThisIteration >= this.config.maxActionsPerIteration) {
				this.orchestrator.events.debug(
					"ml.loop.throttle",
					`Throttled actions at ${this.config.maxActionsPerIteration} this iteration`,
				)
				break
			}

			// If test likely to fail, queue focused test run
			const testAction = {
				confidence: testPred.failProb,
				agent: "tester" as const,
				reason: `Focused test run for task ${task.id}: predicted likely failure`,
				payload: {
					predictedFailProb: testPred.failProb,
					predictedExecTime: testPred.execTime,
				},
			}
			if (testPred.failProb > this.config.confidenceThreshold && this.validateAction(testAction, task).valid) {
				const followup: TaskInputRaw = {
					agent: "tester",
					goal: testAction.reason,
					priority: "high",
					parentTaskId: task.id,
					payload: testAction.payload,
				}
				this.orchestrator.submit(followup)
				this.stats.actionsTaken++
				this.actionCountThisIteration++
				this.outcomeTracker.record(
					`${task.id}-testfail`,
					"tester",
					testPred.failProb,
					/* beforeScore */ 0.5,
					/* afterScore placeholder */ 0.5,
				)
			}

			if (this.actionCountThisIteration >= this.config.maxActionsPerIteration) {
				this.orchestrator.events.debug(
					"ml.loop.throttle",
					`Throttled actions at ${this.config.maxActionsPerIteration} this iteration`,
				)
				break
			}
		}

		// Auto-improve: if overall health is degrading, queue a self-improve task
		const recentEvents = this.orchestrator.events.recent({ type: "agent.completed", limit: 20 })
		const failureRate = recentEvents.filter((e) => e.data?.ok === false).length / Math.max(recentEvents.length, 1)
		if (failureRate > 0.5 && this.orchestrator.safety.getSelfImprove()) {
			const selfImproveAction = {
				confidence: failureRate,
				agent: "coder" as const,
				reason: "Self-improvement: high failure rate detected. Review recent failures and improve error handling.",
				payload: {
					failureRate,
					systemPromptOverlay: "Focus on robustness, error handling, and edge-case coverage.",
				},
			}
			if (
				this.validateAction(selfImproveAction).valid &&
				this.actionCountThisIteration < this.config.maxActionsPerIteration
			) {
				const followup: TaskInputRaw = {
					agent: "coder",
					goal: selfImproveAction.reason,
					priority: "critical",
					requiredCapabilities: ["read.file", "write.file"],
					payload: selfImproveAction.payload,
				}
				this.orchestrator.submit(followup)
				this.stats.actionsTaken++
				this.actionCountThisIteration++
			}
		}

		// Update running help-rate stat
		this.stats.actionHelpRate = this.outcomeTracker.helpRate()
	}

	// ── Action validation guardrails ──────────────────────────────────────────

	private validateAction(
		action: {
			confidence: number
			agent: string
			reason: string
			payload?: Record<string, unknown>
		},
		task?: Task,
	): ValidationResult {
		// 1. Confidence floor
		if (action.confidence < 0.5) {
			return { valid: false, reason: `Confidence too low (${action.confidence.toFixed(2)})` }
		}

		// 2. Prevent duplicate actions for same task within a short window
		if (task) {
			const recent = this.orchestrator.queue.list({ status: "pending", limit: 50 })
			const dup = recent.find(
				(t) =>
					t.parentTaskId === task.id &&
					t.agent === action.agent &&
					t.goal.includes(action.reason.slice(0, 30)),
			)
			if (dup) {
				return { valid: false, reason: `Duplicate ${action.agent} action already queued for task ${task.id}` }
			}
		}

		// 3. Agent must be known (registered) or generic coder/tester/debugger
		const knownAgents = this.orchestrator.agents.list().map((a) => a.name)
		const genericAllowed = ["coder", "tester", "debugger"]
		if (!knownAgents.includes(action.agent) && !genericAllowed.includes(action.agent)) {
			return { valid: false, reason: `Unknown agent "${action.agent}"` }
		}

		// 4. Cap per-iteration action budget
		if (this.actionCountThisIteration >= this.config.maxActionsPerIteration) {
			return { valid: false, reason: `Max actions per iteration (${this.config.maxActionsPerIteration}) reached` }
		}

		return { valid: true }
	}

	// ── Feature extraction ────────────────────────────────────────────────────

	private taskToFeatures(task: Task): number[] {
		const goalLen = task.goal.length
		const capsCount = task.requiredCapabilities.length
		const hasWrite = task.requiredCapabilities.includes("write.file") ? 1 : 0
		const hasExecute = task.requiredCapabilities.includes("execute.command") ? 1 : 0
		const priorityScore =
			task.priority === "critical" ? 1 : task.priority === "high" ? 0.75 : task.priority === "normal" ? 0.5 : 0.25
		const attempts = task.attempts
		const isFollowup = task.parentTaskId ? 1 : 0

		return [
			Math.min(goalLen / 200, 1),
			Math.min(capsCount / 5, 1),
			hasWrite,
			hasExecute,
			priorityScore,
			Math.min(attempts / 3, 1),
			isFollowup,
			0, // reserved for future feature
		]
	}

	// ── Richer label extraction ───────────────────────────────────────────────

	private extractCodeSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "coder" && t.status !== "pending")
			.map((t) => {
				const attempts = Math.max(t.attempts, 1)
				const succeeded = t.status === "succeeded"
				const failed = t.status === "failed"

				// Quality: degrade with retries; boost with success, penalise hard failure
				let quality = succeeded ? 0.9 : failed ? 0.1 : 0.5
				quality -= (attempts - 1) * 0.15
				quality = Math.max(0, Math.min(1, quality))

				// Bug risk: more attempts → higher risk; failed with retries → high
				let bugRisk = succeeded ? 0 : failed ? 2 : 1
				if (failed && attempts > 2) bugRisk = 2
				if (succeeded && attempts > 3) bugRisk = 1

				return {
					features: this.taskToFeatures(t),
					quality,
					success: succeeded ? 1 : 0,
					bugRisk,
				}
			})
	}

	private extractDebugSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "debugger" && t.status !== "pending")
			.map((t) => {
				const succeeded = t.status === "succeeded"
				const attempts = Math.max(t.attempts, 1)

				// Cause category: heuristic based on error text when failed
				let causeCategory = 3 // runtime default
				const err = (t.error ?? "").toLowerCase()
				if (err.includes("syntax") || err.includes("parse")) causeCategory = 0
				else if (err.includes("type") || err.includes("typescript")) causeCategory = 2
				else if (err.includes("assert") || err.includes("expect")) causeCategory = 4
				else if (err.includes("env") || err.includes("config")) causeCategory = 4

				// Fix complexity: retries and long goals → more complex
				let fixComplexity = succeeded ? 0.3 : 0.7
				fixComplexity += (attempts - 1) * 0.15
				fixComplexity = Math.min(1, fixComplexity)

				return {
					features: this.taskToFeatures(t),
					causeCategory,
					fixComplexity,
					fixSuccess: succeeded ? 1 : 0,
				}
			})
	}

	private extractTestSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "tester" && t.status !== "pending")
			.map((t) => {
				const succeeded = t.status === "succeeded"
				const failed = t.status === "failed"
				const attempts = Math.max(t.attempts, 1)

				// Execution time proxy: more attempts / longer goal → slower
				let execTime = succeeded ? 0.3 : failed ? 0.7 : 0.5
				execTime += Math.min(t.goal.length / 1000, 0.3)
				execTime += (attempts - 1) * 0.1
				execTime = Math.min(1, execTime)

				// Coverage gap: failed tests often indicate missing coverage
				let coverageGap = failed ? 0.7 : succeeded ? 0.2 : 0.4
				if (failed && attempts > 2) coverageGap = 0.9

				return {
					features: this.taskToFeatures(t),
					willFail: failed ? 1 : 0,
					execTime,
					coverageGap,
				}
			})
	}
}
