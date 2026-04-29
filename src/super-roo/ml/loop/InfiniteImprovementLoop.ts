/**
 * Super Roo ML — Infinite Improvement Loop
 *
 * The core of SuperRoo's self-improving capability.
 *
 * Workflow:
 *   1. OBSERVE   — collect task outcomes, test results, bug reports
 *   2. LEARN     — train CodeLearner, DebugLearner, TestLearner on new data
 *   3. PREDICT   — score upcoming tasks, predict failures, prioritise work
 *   4. ACT       — submit follow-up tasks (code, debug, test) via orchestrator
 *   5. EVALUATE  — compare predicted vs actual outcomes, feed back as training data
 *   6. LOOP      — sleep and repeat
 *
 * The loop runs while `running` is true and can be gracefully stopped.
 */

import type { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"
import type { Task, TaskInputRaw } from "../../types"
import { CodeLearner } from "../learning/CodeLearner"
import { DebugLearner } from "../learning/DebugLearner"
import { TestLearner } from "../learning/TestLearner"

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
}

export interface LoopStats {
	iteration: number
	totalSamples: number
	lastTrainLoss: number
	predictionsMade: number
	actionsTaken: number
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
	}

	private codeLearner: CodeLearner
	private debugLearner: DebugLearner
	private testLearner: TestLearner

	constructor(
		private readonly orchestrator: SuperRooOrchestrator,
		private readonly config: LoopConfig = {
			minSamples: 5,
			maxIterations: 1000,
			idleSleepMs: 5000,
			trainEpochs: 20,
			confidenceThreshold: 0.75,
		},
	) {
		this.codeLearner = new CodeLearner({ inputDim: 8 })
		this.debugLearner = new DebugLearner({ inputDim: 8 })
		this.testLearner = new TestLearner({ inputDim: 8 })
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.orchestrator.events.info("ml.loop.started", "Infinite Improvement Loop started")
		this.handle = this.loop()
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		if (this.handle) {
			try {
				await this.handle
			} catch {
				/* loop will have logged */
			}
		}
		this.orchestrator.events.info("ml.loop.stopped", "Infinite Improvement Loop stopped")
	}

	getStats(): LoopStats {
		return { ...this.stats }
	}

	// ── Core loop ─────────────────────────────────────────────────────────────

	private async loop(): Promise<void> {
		while (this.running && this.stats.iteration < this.config.maxIterations) {
			this.stats.iteration++
			try {
				await this.observeAndLearn()
				await this.predictAndAct()
				await this.sleep(this.config.idleSleepMs)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("ml.loop.error", `Loop error: ${msg}`)
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
			this.orchestrator.events.debug("ml.loop.observe", `Waiting for more samples (${this.stats.totalSamples}/${this.config.minSamples})`)
			return
		}

		// Train each learner
		const codeLoss = this.codeLearner.train(codeSamples)
		const debugLoss = this.debugLearner.train(debugSamples)
		const testLoss = this.testLearner.train(testSamples)

		const avgLoss = (codeLoss.qualityLoss + debugLoss.causeLoss + testLoss.failLoss) / 3
		this.stats.lastTrainLoss = avgLoss

		this.orchestrator.events.info("ml.loop.learn", `Trained on ${this.stats.totalSamples} samples`, {
			data: {
				codeLoss,
				debugLoss,
				testLoss,
				avgLoss,
			},
		})
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
			if (codePred.bugRiskClass >= 2 && codePred.successProb < this.config.confidenceThreshold) {
				const followup: TaskInputRaw = {
					agent: "debugger",
					goal: `Pre-emptive debug for task ${task.id}: predicted high bug risk`,
					priority: "high",
					parentTaskId: task.id,
					payload: {
						predictedBugRisk: codePred.bugRiskClass,
						predictedSuccess: codePred.successProb,
					},
				}
				this.orchestrator.submit(followup)
				this.stats.actionsTaken++
			}

			// If test likely to fail, queue focused test run
			if (testPred.failProb > this.config.confidenceThreshold) {
				const followup: TaskInputRaw = {
					agent: "tester",
					goal: `Focused test run for task ${task.id}: predicted likely failure`,
					priority: "high",
					parentTaskId: task.id,
					payload: {
						predictedFailProb: testPred.failProb,
						predictedExecTime: testPred.execTime,
					},
				}
				this.orchestrator.submit(followup)
				this.stats.actionsTaken++
			}
		}

		// Auto-improve: if overall health is degrading, queue a self-improve task
		const recentEvents = this.orchestrator.events.recent({ type: "agent.completed", limit: 20 })
		const failureRate = recentEvents.filter((e) => e.data?.ok === false).length / Math.max(recentEvents.length, 1)
		if (failureRate > 0.5 && this.orchestrator.safety.getSelfImprove()) {
			const followup: TaskInputRaw = {
				agent: "coder",
				goal: "Self-improvement: high failure rate detected. Review recent failures and improve error handling.",
				priority: "critical",
				requiredCapabilities: ["read.file", "write.file"],
				payload: {
					failureRate,
					systemPromptOverlay: "Focus on robustness, error handling, and edge-case coverage.",
				},
			}
			this.orchestrator.submit(followup)
			this.stats.actionsTaken++
		}
	}

	// ── Feature extraction ────────────────────────────────────────────────────

	private taskToFeatures(task: Task): number[] {
		// Simple heuristics-based feature vector
		const goalLen = task.goal.length
		const capsCount = task.requiredCapabilities.length
		const hasWrite = task.requiredCapabilities.includes("write.file") ? 1 : 0
		const hasExecute = task.requiredCapabilities.includes("execute.command") ? 1 : 0
		const priorityScore = task.priority === "critical" ? 1 : task.priority === "high" ? 0.75 : task.priority === "normal" ? 0.5 : 0.25
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

	private extractCodeSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "coder" && t.status !== "pending")
			.map((t) => ({
				features: this.taskToFeatures(t),
				quality: t.status === "succeeded" ? 0.9 : 0.3,
				success: t.status === "succeeded" ? 1 : 0,
				bugRisk: t.status === "failed" ? 2 : t.status === "succeeded" ? 0 : 1,
			}))
	}

	private extractDebugSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "debugger" && t.status !== "pending")
			.map((t) => ({
				features: this.taskToFeatures(t),
				causeCategory: t.status === "succeeded" ? 2 : 3,
				fixComplexity: t.attempts > 1 ? 0.8 : 0.3,
				fixSuccess: t.status === "succeeded" ? 1 : 0,
			}))
	}

	private extractTestSamples(tasks: Task[]) {
		return tasks
			.filter((t) => t.agent === "tester" && t.status !== "pending")
			.map((t) => ({
				features: this.taskToFeatures(t),
				willFail: t.status === "failed" ? 1 : 0,
				execTime: 0.5, // placeholder: would come from actual timing
				coverageGap: t.status === "failed" ? 0.7 : 0.2,
			}))
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
