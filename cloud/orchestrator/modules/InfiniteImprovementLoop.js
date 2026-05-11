/**
 * Cloud Orchestrator — Infinite Improvement Loop.
 *
 * ML-powered continuous improvement loop that observes task outcomes,
 * learns patterns, and makes predictions to improve future task execution.
 *
 * Ported from src/super-roo/ml/loop/InfiniteImprovementLoop.ts for the cloud runtime.
 * Uses a simplified in-memory learning model with SQLite-backed persistence.
 */

class InfiniteImprovementLoop {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.memoryStore - MemoryStore instance (SQLite).
	 * @param {Object} [opts.taskQueue] - Optional TaskQueueBullMQ for creating improvement tasks.
	 * @param {Object} [opts.config]
	 * @param {number} [opts.config.loopIntervalMs=60000]
	 * @param {number} [opts.config.observeBatchSize=10]
	 * @param {number} [opts.config.minSamplesForPrediction=5]
	 * @param {number} [opts.config.maxRecentActions=50]
	 */
	constructor(opts = {}) {
		if (!opts.memoryStore) {
			throw new Error("InfiniteImprovementLoop requires a memoryStore")
		}
		this.memory = opts.memoryStore
		this.taskQueue = opts.taskQueue || null
		this.config = {
			loopIntervalMs: opts.config?.loopIntervalMs || 60000,
			observeBatchSize: opts.config?.observeBatchSize || 10,
			minSamplesForPrediction: opts.config?.minSamplesForPrediction || 5,
			maxRecentActions: opts.config?.maxRecentActions || 50,
		}

		this._running = false
		this._loopHandle = null

		// In-memory learning state
		this._recentActions = []
		this._codeSamples = []
		this._debugSamples = []
		this._testSamples = []

		// Simple neural network weights (linear model)
		this._weights = {
			code: { featureWeights: null, bias: 0 },
			debug: { featureWeights: null, bias: 0 },
			test: { featureWeights: null, bias: 0 },
		}

		this.stats = {
			loopsRun: 0,
			observationsCollected: 0,
			predictionsMade: 0,
			actionsTaken: 0,
			validationFailures: 0,
			lastLoopTime: null,
		}
	}

	async initialize() {
		// Load persisted state
		try {
			const stored = this.memory.get("improvement_loop_state")
			if (stored) {
				const state = typeof stored === "string" ? JSON.parse(stored) : stored
				this._weights = state.weights || this._weights
				this._recentActions = state.recentActions || []
				this._codeSamples = state.codeSamples || []
				this._debugSamples = state.debugSamples || []
				this._testSamples = state.testSamples || []
				this.stats = state.stats || this.stats
				console.log("[orchestrator/improvement-loop] Loaded state from MemoryStore")
			}
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to load state:", err.message)
		}

		console.log("[orchestrator/improvement-loop] Initialized")
	}

	async _persist() {
		try {
			this.memory.set(
				"improvement_loop_state",
				{
					weights: this._weights,
					recentActions: this._recentActions.slice(-this.config.maxRecentActions),
					codeSamples: this._codeSamples.slice(-100),
					debugSamples: this._debugSamples.slice(-100),
					testSamples: this._testSamples.slice(-100),
					stats: this.stats,
				},
				"orchestrator",
			)
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to persist state:", err.message)
		}
	}

	/**
	 * Start the improvement loop.
	 */
	async start() {
		if (this._running) return
		this._running = true
		this._scheduleNext()
		console.log("[orchestrator/improvement-loop] Started (interval: " + this.config.loopIntervalMs + "ms)")
	}

	/**
	 * Stop the improvement loop.
	 */
	async stop() {
		this._running = false
		if (this._loopHandle) {
			clearTimeout(this._loopHandle)
			this._loopHandle = null
		}
		await this._persist()
		console.log("[orchestrator/improvement-loop] Stopped")
	}

	_scheduleNext() {
		if (!this._running) return
		this._loopHandle = setTimeout(() => this._loop(), this.config.loopIntervalMs)
	}

	async _loop() {
		if (!this._running) return

		try {
			await this.observeAndLearn()
			await this.predictAndAct()
			this.stats.loopsRun++
			this.stats.lastLoopTime = new Date().toISOString()
		} catch (err) {
			console.error("[orchestrator/improvement-loop] Loop error:", err.message)
		}

		await this._persist()
		this._scheduleNext()
	}

	// ── Observation & Learning ───────────────────────────────────────────

	/**
	 * Observe completed tasks and learn from their outcomes.
	 */
	async observeAndLearn() {
		const db = this.memory.getDb()

		// Get recently completed tasks from the task queue table
		const tasks = db
			.prepare(
				`
			SELECT * FROM tasks
			WHERE status IN ('completed', 'failed')
			ORDER BY updated_at DESC
			LIMIT ?
		`,
			)
			.all(this.config.observeBatchSize)

		for (const task of tasks) {
			const features = this._taskToFeatures(task)
			const outcome = task.status === "completed" ? 1 : 0

			// Categorize and store samples
			if (task.type && task.type.includes("code")) {
				this._codeSamples.push({ features, outcome })
				this._extractCodeSamples([task])
			} else if (task.type && task.type.includes("debug")) {
				this._debugSamples.push({ features, outcome })
				this._extractDebugSamples([task])
			} else if (task.type && task.type.includes("test")) {
				this._testSamples.push({ features, outcome })
				this._extractTestSamples([task])
			}

			this.stats.observationsCollected++
		}

		// Train models if we have enough samples
		if (this._codeSamples.length >= this.config.minSamplesForPrediction) {
			this._trainModel("code", this._codeSamples)
		}
		if (this._debugSamples.length >= this.config.minSamplesForPrediction) {
			this._trainModel("debug", this._debugSamples)
		}
		if (this._testSamples.length >= this.config.minSamplesForPrediction) {
			this._trainModel("test", this._testSamples)
		}
	}

	/**
	 * Train a simple linear model using gradient descent.
	 * @param {string} modelName
	 * @param {Array} samples
	 */
	_trainModel(modelName, samples) {
		const featureCount = samples[0].features.length
		let weights = new Array(featureCount).fill(0)
		let bias = 0
		const learningRate = 0.01
		const epochs = 10

		for (let epoch = 0; epoch < epochs; epoch++) {
			for (const sample of samples) {
				const prediction = this._predict(sample.features, weights, bias)
				const error = prediction - sample.outcome

				// Update weights
				for (let i = 0; i < featureCount; i++) {
					weights[i] -= learningRate * error * sample.features[i]
				}
				bias -= learningRate * error
			}
		}

		this._weights[modelName] = { featureWeights: weights, bias }
	}

	_predict(features, weights, bias) {
		let sum = bias
		for (let i = 0; i < features.length; i++) {
			sum += features[i] * (weights[i] || 0)
		}
		// Sigmoid activation
		return 1 / (1 + Math.exp(-sum))
	}

	_taskToFeatures(task) {
		// Convert task properties to numerical feature vector
		const features = []
		// Feature 1: Task age (hours since creation)
		const age = (Date.now() - task.created_at) / 3600000
		features.push(Math.min(age / 24, 1))
		// Feature 2: Priority (normalized)
		const priority = task.priority || 5
		features.push(1 - (priority - 1) / 9)
		// Feature 3: Has telegram context
		features.push(task.telegram_context ? 1 : 0)
		// Feature 4: Has conversation summary
		features.push(task.conversation_summary ? 1 : 0)
		// Feature 5: Message length (normalized)
		const msgLen = (task.body || "").length
		features.push(Math.min(msgLen / 1000, 1))
		return features
	}

	// ── Prediction & Action ──────────────────────────────────────────────

	/**
	 * Make predictions about pending tasks and take improvement actions.
	 */
	async predictAndAct() {
		const db = this.memory.getDb()

		// Get pending tasks
		const pendingTasks = db
			.prepare(
				`
			SELECT * FROM tasks
			WHERE status = 'pending'
			ORDER BY priority ASC, created_at ASC
			LIMIT 5
		`,
			)
			.all()

		for (const task of pendingTasks) {
			const features = this._taskToFeatures(task)
			let modelName = "code"

			if (task.type && task.type.includes("debug")) modelName = "debug"
			else if (task.type && task.type.includes("test")) modelName = "test"

			const model = this._weights[modelName]
			if (!model.featureWeights) continue

			const prediction = this._predict(features, model.featureWeights, model.bias)
			this.stats.predictionsMade++

			// If prediction is low (< 0.3), the task is likely to fail
			if (prediction < 0.3) {
				const action = {
					type: "improvement_suggestion",
					taskId: task.id,
					prediction,
					modelName,
					timestamp: Date.now(),
				}

				this._recentActions.push(action)

				// Log the prediction
				console.log(
					`[orchestrator/improvement-loop] Low success prediction (${(prediction * 100).toFixed(1)}%) ` +
						`for task ${task.id} (${modelName})`,
				)

				this.stats.actionsTaken++
			}
		}
	}

	// ── Sample Extraction ────────────────────────────────────────────────

	_extractCodeSamples(tasks) {
		for (const task of tasks) {
			const body = task.body || ""
			this._codeSamples.push({
				features: this._taskToFeatures(task),
				outcome: task.status === "completed" ? 1 : 0,
				code: body.slice(0, 200),
				taskId: task.id,
			})
		}
	}

	_extractDebugSamples(tasks) {
		for (const task of tasks) {
			const body = task.body || ""
			this._debugSamples.push({
				features: this._taskToFeatures(task),
				outcome: task.status === "completed" ? 1 : 0,
				debug: body.slice(0, 200),
				taskId: task.id,
			})
		}
	}

	_extractTestSamples(tasks) {
		for (const task of tasks) {
			const body = task.body || ""
			this._testSamples.push({
				features: this._taskToFeatures(task),
				outcome: task.status === "completed" ? 1 : 0,
				test: body.slice(0, 200),
				taskId: task.id,
			})
		}
	}

	// ── Validation ───────────────────────────────────────────────────────

	/**
	 * Validate whether a proposed action should be taken.
	 * @param {Object} action
	 * @param {Array} recentActions
	 * @returns {{ valid: boolean, reason?: string }}
	 */
	validateAction(action, recentActions) {
		// Check for duplicate actions
		const dup = recentActions.find((a) => a.type === action.type && a.taskId === action.taskId)
		if (dup) {
			return { valid: false, reason: "Duplicate action already taken" }
		}

		// Check action rate
		const recentCount = recentActions.filter(
			(a) => a.type === action.type && Date.now() - a.timestamp < 3600000,
		).length
		if (recentCount > 5) {
			return { valid: false, reason: "Too many recent actions of this type" }
		}

		return { valid: true }
	}

	// ── Stats ────────────────────────────────────────────────────────────

	/**
	 * Get loop statistics.
	 * @returns {Object}
	 */
	getStats() {
		return {
			...this.stats,
			codeSamples: this._codeSamples.length,
			debugSamples: this._debugSamples.length,
			testSamples: this._testSamples.length,
			recentActions: this._recentActions.length,
			models: {
				code: this._weights.code.featureWeights ? "trained" : "untrained",
				debug: this._weights.debug.featureWeights ? "trained" : "untrained",
				test: this._weights.test.featureWeights ? "trained" : "untrained",
			},
		}
	}

	/**
	 * Get recent improvement actions.
	 * @param {number} [limit=20]
	 * @returns {Array}
	 */
	getRecentActions(limit = 20) {
		return this._recentActions.slice(-limit)
	}
}

module.exports = { InfiniteImprovementLoop }
