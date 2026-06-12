/**
 * Super Roo ML — Infinite Improvement Loop
 *
 * The core of SuperRoo's self-improving capability.
 *
 * Workflow:
 *   1. OBSERVE   — collect task outcomes from orchestrator queue + brain server outcomes
 *   2. LEARN     — train CodeLearner, DebugLearner, TestLearner end-to-end
 *   3. PREDICT   — score upcoming tasks, predict failures, prioritise work
 *   4. ACT       — submit follow-up tasks via orchestrator (validated)
 *   5. EVALUATE  — compare predicted vs actual outcomes, track metrics
 *   6. PERSIST   — save model weights so learning survives restarts (brain server reads these)
 *   7. SYNC      — upload local model to cloud, download merged cloud model
 *   8. LOOP      — sleep and repeat
 *
 * Enhanced with bidirectional ML sync via MLSyncClient.
 * Brain server outcomes (record_outcome MCP tool) are loaded each cycle and merged into training.
 */

import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"
import type { Task, TaskInputRaw } from "../../types"
import { CancellableSleep } from "../../utils/CancellableSleep"
import { CodeLearner, type CodeSample } from "../learning/CodeLearner"
import { DebugLearner, type DebugSample } from "../learning/DebugLearner"
import { TestLearner } from "../learning/TestLearner"
import { ActionOutcomeTracker } from "../engine/Metrics"
import { MLSyncClient, type MLSyncConfig, type SyncObservation } from "../sync/MLSyncClient"
import { ModelPersistence } from "../engine/ModelPersistence"
import { NeuralNetwork } from "../engine/NeuralNetwork"
import type { ParallelMLTrainer } from "../../parallel/ParallelMLTrainer"
import type { TrainingExample } from "../../healing/MLClassifier"

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
	/** Cloud API base URL for ML sync (e.g., "http://100.64.175.88:8787"). */
	cloudApiBaseUrl?: string
	/** Auth token for cloud API. */
	cloudAuthToken?: string
	/** Sync interval in ms. Default: 5 minutes. */
	syncIntervalMs?: number
	/**
	 * Path to the brain server's ml-outcomes.json file.
	 * Outcomes recorded via the `record_outcome` MCP tool are loaded here
	 * each training cycle and merged into CodeLearner training data.
	 * Defaults to ~/.superroo/brain/ml-outcomes.json
	 */
	brainOutcomesPath?: string
	/** Parallel ML trainer for concurrent learner training (GAP #2). */
	parallelML?: ParallelMLTrainer
	/** Training examples from the healing MLClassifier, converted to DebugSamples (GAP #5). */
	mlClassifierTrainingExamples?: TrainingExample[]
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

	// ML Sync
	private mlSyncClient: MLSyncClient | null = null
	private modelPersistence: ModelPersistence | null = null

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

		// Initialize MLSyncClient if cloud API URL is configured
		if (this.config.cloudApiBaseUrl) {
			this.modelPersistence = new ModelPersistence({
				dir: this.config.modelDir || ".",
				name: "ml-sync-model",
			})
			// Create separate persistence instances for each learner (GAP #3 fix)
			const codePersistence = new ModelPersistence({
				dir: this.config.modelDir || ".",
				name: "code-learner",
			})
			const debugPersistence = new ModelPersistence({
				dir: this.config.modelDir || ".",
				name: "debug-learner",
			})
			const testPersistence = new ModelPersistence({
				dir: this.config.modelDir || ".",
				name: "test-learner",
			})
			const syncConfig: MLSyncConfig = {
				apiBaseUrl: this.config.cloudApiBaseUrl,
				syncIntervalMs: this.config.syncIntervalMs,
				authToken: this.config.cloudAuthToken,
			}
			this.mlSyncClient = new MLSyncClient(
				syncConfig,
				this.modelPersistence,
				null /* neuralNetwork */,
				[codePersistence, debugPersistence, testPersistence],
			)
		}
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

		// Start ML sync client if configured
		if (this.mlSyncClient) {
			try {
				await this.mlSyncClient.start()
				this.orchestrator.events.info("ml.loop.sync_started", "ML Sync client started")
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.warn("ml.loop.sync_error", `ML Sync client failed to start: ${msg}`)
			}
		}

		this.handle = this.loop()
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		this.sleeper.stop()

		// Stop ML sync client first
		if (this.mlSyncClient) {
			try {
				await this.mlSyncClient.stop()
			} catch {
				/* ignore */
			}
		}

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

	/**
	 * Get MLSyncClient status if available.
	 */
	getSyncStatus() {
		return this.mlSyncClient?.getStatus() ?? null
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

	// ── Brain Server Outcome Loader ───────────────────────────────────────────

	/**
	 * Load CodeSamples recorded via the brain MCP `record_outcome` tool.
	 * Returns an empty array if the file doesn't exist or can't be parsed.
	 */
	private loadBrainOutcomes(): CodeSample[] {
		const outcomesPath =
			this.config.brainOutcomesPath ||
			join(homedir(), ".superroo", "brain", "ml-outcomes.json")
		if (!existsSync(outcomesPath)) return []
		try {
			const raw = JSON.parse(readFileSync(outcomesPath, "utf8")) as Array<{
				features: number[]
				success?: number
				quality?: number
				bugRisk?: number
			}>
			return raw
				.filter((o) => Array.isArray(o.features) && o.features.length === 8)
				.map((o) => ({
					features: o.features,
					success: o.success,
					quality: o.quality,
					bugRisk: o.bugRisk,
				}))
		} catch {
			return []
		}
	}

	// ── Phase 1: Observe + Learn ──────────────────────────────────────────────

	private async observeAndLearn(): Promise<void> {
		// Collect recent task outcomes from orchestrator queue
		const tasks = this.orchestrator.queue.list({ limit: 100 })
		const codeSamples = this.extractCodeSamples(tasks)
		const debugSamples = this.extractDebugSamples(tasks)
		const testSamples = this.extractTestSamples(tasks)

		// Merge brain server outcomes (from Claude's record_outcome MCP calls)
		const brainOutcomes = this.loadBrainOutcomes()
		if (brainOutcomes.length > 0) {
			codeSamples.push(...brainOutcomes as CodeSample[])
			this.orchestrator.events.debug(
				"ml.loop.brain_outcomes",
				`Loaded ${brainOutcomes.length} brain server outcomes into training`,
			)
		}

		// Merge MLClassifier healing examples into DebugSamples (GAP #5)
		const classifierExamples = this.config.mlClassifierTrainingExamples
		if (classifierExamples && classifierExamples.length > 0) {
			const classifierDebugSamples = this.convertClassifierExamples(classifierExamples)
			debugSamples.push(...classifierDebugSamples)
			this.orchestrator.events.debug(
				"ml.loop.classifier_examples",
				`Loaded ${classifierDebugSamples.length} classifier examples into debug training`,
			)
		}

		this.stats.totalSamples = codeSamples.length + debugSamples.length + testSamples.length

		if (this.stats.totalSamples < this.config.minSamples) {
			this.orchestrator.events.debug(
				"ml.loop.observe",
				`Waiting for more samples (${this.stats.totalSamples}/${this.config.minSamples})`,
			)
			return
		}

		// Train using ParallelMLTrainer when available (GAP #2), otherwise fall back to sequential
		let codeLoss: { qualityLoss: number; successLoss: number; bugRiskLoss: number } | null = null
		let debugLoss: { causeLoss: number; complexityLoss: number; fixSuccessLoss: number } | null = null
		let testLoss: { failLoss: number; timeLoss: number; coverageLoss: number } | null = null
		let codeMetrics: object | null = null
		let debugMetrics: object | null = null
		let testMetrics: object | null = null

		if (this.config.parallelML) {
			// Use parallel training
			const result = await this.config.parallelML.trainAll(
				this.codeLearner,
				this.debugLearner,
				this.testLearner,
				codeSamples,
				debugSamples,
				testSamples,
			)
			codeLoss = result.codeLoss
			debugLoss = result.debugLoss
			testLoss = result.testLoss
			codeMetrics = result.codeMetrics
			debugMetrics = result.debugMetrics
			testMetrics = result.testMetrics

			if (result.codeError) {
				this.orchestrator.events.error("ml.loop.train_error", `CodeLearner parallel training failed: ${result.codeError}`)
			}
			if (result.debugError) {
				this.orchestrator.events.error("ml.loop.train_error", `DebugLearner parallel training failed: ${result.debugError}`)
			}
			if (result.testError) {
				this.orchestrator.events.error("ml.loop.train_error", `TestLearner parallel training failed: ${result.testError}`)
			}
		} else {
			// Sequential fallback
			try {
				codeLoss = this.codeLearner.train(codeSamples)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("ml.loop.train_error", `CodeLearner training failed: ${msg}`)
			}

			try {
				debugLoss = this.debugLearner.train(debugSamples)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("ml.loop.train_error", `DebugLearner training failed: ${msg}`)
			}

			try {
				testLoss = this.testLearner.train(testSamples)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("ml.loop.train_error", `TestLearner training failed: ${msg}`)
			}
		}

		// Build NaN-free loss array for validation
		const allLosses: number[] = []
		if (codeLoss) {
			if (!Number.isNaN(codeLoss.qualityLoss)) allLosses.push(codeLoss.qualityLoss)
			if (!Number.isNaN(codeLoss.successLoss)) allLosses.push(codeLoss.successLoss)
			if (!Number.isNaN(codeLoss.bugRiskLoss)) allLosses.push(codeLoss.bugRiskLoss)
		}
		if (debugLoss) {
			if (!Number.isNaN(debugLoss.causeLoss)) allLosses.push(debugLoss.causeLoss)
			if (!Number.isNaN(debugLoss.complexityLoss)) allLosses.push(debugLoss.complexityLoss)
			if (!Number.isNaN(debugLoss.fixSuccessLoss)) allLosses.push(debugLoss.fixSuccessLoss)
		}
		if (testLoss) {
			if (!Number.isNaN(testLoss.failLoss)) allLosses.push(testLoss.failLoss)
			if (!Number.isNaN(testLoss.timeLoss)) allLosses.push(testLoss.timeLoss)
			if (!Number.isNaN(testLoss.coverageLoss)) allLosses.push(testLoss.coverageLoss)
		}

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

		// Evaluate metrics (skip if already computed by parallel trainer)
		if (!codeMetrics && codeSamples.length > 0) {
			codeMetrics = this.codeLearner.evaluate(codeSamples)
		}
		if (!debugMetrics && debugSamples.length > 0) {
			debugMetrics = this.debugLearner.evaluate(debugSamples)
		}
		if (!testMetrics && testSamples.length > 0) {
			testMetrics = this.testLearner.evaluate(testSamples)
		}
		this.stats.lastMetrics = { code: codeMetrics ?? {}, debug: debugMetrics ?? {}, test: testMetrics ?? {} }

		this.orchestrator.events.info("ml.loop.learn", `Trained on ${this.stats.totalSamples} samples`, {
			data: {
				codeLoss: codeLoss ?? { qualityLoss: NaN, successLoss: NaN, bugRiskLoss: NaN },
				debugLoss: debugLoss ?? { causeLoss: NaN, complexityLoss: NaN, fixSuccessLoss: NaN },
				testLoss: testLoss ?? { failLoss: NaN, timeLoss: NaN, coverageLoss: NaN },
				avgLoss,
				codeMetrics: codeMetrics ?? {},
				debugMetrics: debugMetrics ?? {},
				testMetrics: testMetrics ?? {},
			},
		})

		// Persist after successful training
		try {
			await Promise.all([this.codeLearner.save(), this.debugLearner.save(), this.testLearner.save()])
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.orchestrator.events.warn("ml.loop.save_error", `Failed to save weights after training: ${msg}`)
		}

		// Queue observations for cloud sync
		if (this.mlSyncClient) {
			this.queueObservationsForSync(codeSamples, debugSamples, testSamples)
		}
	}

	/**
	 * Queue training samples as observations for cloud sync.
	 */
	private queueObservationsForSync(
		codeSamples: CodeSample[],
		debugSamples: Array<{ features: number[]; causeCategory: number; fixComplexity: number; fixSuccess: number }>,
		testSamples: Array<{ features: number[]; willFail: number; execTime: number; coverageGap: number }>,
	): void {
		if (!this.mlSyncClient) return

		const now = Date.now()

		// Queue code samples
		for (const s of codeSamples) {
			const obs: SyncObservation = {
				taskType: "code",
				inputSummary: `features: [${s.features.map((f) => f.toFixed(2)).join(",")}]`,
				outputSummary: `quality=${(s.quality ?? 0).toFixed(2)}, success=${s.success ?? 0}, bugRisk=${s.bugRisk ?? 0}`,
				success: (s.success ?? 0) === 1,
				durationMs: 0,
				featuresLocal: s.features,
				featuresUnified: s.features.concat(0, 0, 0),
				source: "local",
				createdAt: now,
			}
			this.mlSyncClient.queueObservation(obs)
		}

		// Queue debug samples
		for (const s of debugSamples) {
			const obs: SyncObservation = {
				taskType: "debug",
				inputSummary: `features: [${s.features.map((f) => f.toFixed(2)).join(",")}]`,
				outputSummary: `causeCategory=${s.causeCategory}, fixComplexity=${s.fixComplexity.toFixed(2)}, fixSuccess=${s.fixSuccess}`,
				success: s.fixSuccess === 1,
				durationMs: 0,
				featuresLocal: s.features,
				featuresUnified: s.features.concat(0, 0, 0),
				source: "local",
				createdAt: now,
			}
			this.mlSyncClient.queueObservation(obs)
		}

		// Queue test samples
		for (const s of testSamples) {
			const obs: SyncObservation = {
				taskType: "test",
				inputSummary: `features: [${s.features.map((f) => f.toFixed(2)).join(",")}]`,
				outputSummary: `willFail=${s.willFail}, execTime=${s.execTime.toFixed(2)}, coverageGap=${s.coverageGap.toFixed(2)}`,
				success: s.willFail === 0,
				durationMs: 0,
				featuresLocal: s.features,
				featuresUnified: s.features.concat(0, 0, 0),
				source: "local",
				createdAt: now,
			}
			this.mlSyncClient.queueObservation(obs)
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

	// ── Classifier example conversion (GAP #5) ───────────────────────────────

	/**
	 * Convert MLClassifier TrainingExamples to DebugSamples for the DebugLearner.
	 * Maps the 22 MLClassifier categories into 5 DebugLearner cause categories.
	 */
	private convertClassifierExamples(examples: TrainingExample[]) {
		return examples
			.filter((ex) => ex.confirmed && ex.category !== "UNKNOWN")
			.map((ex) => {
				const features = this.classifierTextToFeatures(ex.text)
				const causeCategory = this.mapClassifierCategory(ex.category)
				return {
					features,
					causeCategory,
					fixComplexity: 0.5, // neutral default — no retry info from classifier
					fixSuccess: 1, // confirmed incidents mean the cause was correctly identified
				}
			})
	}

	/**
	 * Convert classifier incident text to an 8-dim feature vector.
	 * Uses heuristics similar to taskToFeatures but from raw text.
	 */
	private classifierTextToFeatures(text: string): number[] {
		const lower = text.toLowerCase()
		return [
			Math.min(text.length / 200, 1), // goal length proxy
			lower.includes("api") || lower.includes("network") ? 1 : 0, // capabilities proxy
			lower.includes("write") || lower.includes("file") ? 1 : 0, // hasWrite proxy
			lower.includes("exec") || lower.includes("command") ? 1 : 0, // hasExecute proxy
			lower.includes("critical") || lower.includes("high") ? 1 : 0.5, // priority proxy
			lower.includes("retry") || lower.includes("attempt") ? 0.5 : 0, // attempts proxy
			lower.includes("follow") || lower.includes("dependent") ? 1 : 0, // isFollowup proxy
			0, // reserved
		]
	}

	/**
	 * Map MLClassifier's 22 RootCauseCategory values to DebugLearner's 5 cause categories.
	 * DebugLearner categories: 0=syntax/parse, 1=type, 2=assert/expect, 3=other, 4=env/config
	 */
	private mapClassifierCategory(category: string): number {
		switch (category) {
			case "SYNTAX_ERROR":
			case "PARSE_ERROR":
			case "IMPORT_ERROR":
				return 0 // syntax/parse
			case "TYPE_ERROR":
			case "NULL_POINTER":
			case "UNDEFINED_VARIABLE":
			case "REFERENCE_ERROR":
				return 1 // type/null/ref
			case "ASSERTION_ERROR":
			case "TEST_FAILURE":
			case "EXPECTATION_FAILED":
				return 2 // assert/expect
			case "API_ERROR":
			case "TIMEOUT":
			case "NETWORK_ERROR":
			case "DB_CONNECTION":
			case "AUTH_ERROR":
			case "PERMISSION_DENIED":
			case "RATE_LIMIT":
				return 3 // runtime/other
			case "MEMORY":
			case "DISK_FULL":
			case "RESOURCE_EXHAUSTED":
			case "CONFIG_ERROR":
			case "ENV_ERROR":
				return 4 // env/config
			default:
				return 3 // unknown → runtime default
		}
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

	private extractCodeSamples(tasks: Task[]): CodeSample[] {
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
