/**
 * Cloud Orchestrator — Infinite Improvement Loop.
 *
 * ML-powered continuous improvement loop that observes task outcomes,
 * learns patterns, and makes predictions to improve future task execution.
 *
 * Enhanced with bidirectional ML sync:
 *   - Loads merged models from ml_models table
 *   - Saves observations to ml_observations_v2 with unified 10-dim features
 *   - Triggers federated merge when sufficient new data arrives
 *   - Auto-queues improvement tasks based on predictions
 */

const crypto = require("crypto")
const { serializeLinearRegression, deserialize } = require("../ml/ModelSerializer")
const { fromCloud, toLocal, UNIFIED_DIMENSIONS } = require("../ml/FeatureMapper")
const { federatedMerge } = require("../ml/FederatedMerge")

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
	 * @param {number} [opts.config.minSamplesForMerge=20] - Min total samples before triggering merge
	 * @param {number} [opts.config.mergeIntervalMs=3600000] - Min time between merges (1 hour)
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
			minSamplesForMerge: opts.config?.minSamplesForMerge || 20,
			mergeIntervalMs: opts.config?.mergeIntervalMs || 3600000,
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
			lastMergeTime: null,
			modelsSynced: 0,
			observationsSynced: 0,
		}

		// Track last merge to avoid excessive merges
		this._lastMergeTimestamp = 0
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
				this._lastMergeTimestamp = state.lastMergeTimestamp || 0
				console.log("[orchestrator/improvement-loop] Loaded state from MemoryStore")
			}

			// Try to load a merged cloud model from ml_models to bootstrap weights
			await this._loadMergedModel()
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to load state:", err.message)
		}

		console.log("[orchestrator/improvement-loop] Initialized")
	}

	/**
	 * Load the latest merged model from ml_models table to bootstrap weights.
	 * Converts neural-network weights to linear regression format for the cloud model.
	 */
	async _loadMergedModel() {
		try {
			const db = this.memory.getDb()
			const row = db
				.prepare(
					`SELECT * FROM ml_models WHERE is_merged = 1 ORDER BY training_samples DESC, created_at DESC LIMIT 1`,
				)
				.get()

			if (!row) {
				// Try any cloud model
				const fallback = db
					.prepare(
						`SELECT * FROM ml_models WHERE source = 'cloud' ORDER BY training_samples DESC, created_at DESC LIMIT 1`,
					)
					.get()
				if (!fallback) return

				// Use fallback
				this._applyModelFromDb(fallback)
				return
			}

			this._applyModelFromDb(row)
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to load merged model:", err.message)
		}
	}

	/**
	 * Apply model parameters from a DB row to the in-memory weights.
	 */
	_applyModelFromDb(row) {
		try {
			const params = JSON.parse(row.parameters)
			const modelJson = {
				schemaVersion: row.schema_version,
				modelType: row.model_type,
				featureDimensions: row.feature_dimensions,
				trainingSamples: row.training_samples,
				parameters: params,
			}

			const deserialized = deserialize(modelJson)

			if (deserialized.modelType === "neural-network") {
				// Neural network: extract first layer weights as linear approximation
				const firstLayer = deserialized.weights[0]
				if (firstLayer && firstLayer.length >= 2) {
					// firstLayer[0] is the weight matrix (flattened), firstLayer[1] is bias
					// For a network with inputDim=8, the first layer weights are [inputDim, hiddenSize]
					// We take the mean across the hidden dimension to get a linear approximation
					const wFlat = firstLayer[0]
					const bFlat = firstLayer[1]
					const outputSize = bFlat ? bFlat.length : 1
					const inputSize = wFlat ? Math.floor(wFlat.length / outputSize) : 8

					// Average across output neurons to get a single weight per input feature
					const linearWeights = []
					for (let i = 0; i < inputSize; i++) {
						let sum = 0
						for (let j = 0; j < outputSize; j++) {
							sum += wFlat[j * inputSize + i] || 0
						}
						linearWeights.push(sum / outputSize)
					}
					const avgBias = bFlat ? bFlat.reduce((a, b) => a + b, 0) / bFlat.length : 0

					// Apply to all three task models
					for (const modelName of ["code", "debug", "test"]) {
						this._weights[modelName] = {
							featureWeights: [...linearWeights],
							bias: avgBias,
						}
					}
					console.log(
						`[orchestrator/improvement-loop] Applied merged neural network model (${inputDim} features)`,
					)
				}
			} else if (deserialized.modelType === "linear-regression") {
				// Linear regression: directly apply weights
				const w = deserialized.weights
				const b = deserialized.bias
				for (const modelName of ["code", "debug", "test"]) {
					this._weights[modelName] = {
						featureWeights: [...w],
						bias: b,
					}
				}
				console.log(
					`[orchestrator/improvement-loop] Applied merged linear regression model (${w.length} features)`,
				)
			}

			this.stats.modelsSynced++
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to apply model:", err.message)
		}
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
	 * Saves observations to ml_observations_v2 with unified 10-dim features.
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

		const now = Date.now()
		const obsInsert = db.prepare(
			`INSERT OR IGNORE INTO ml_observations_v2
			 (id, task_type, input_summary, output_summary, success, duration_ms, features_cloud, features_unified, source, session_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)

		for (const task of tasks) {
			const cloudFeatures = this._taskToFeatures(task)
			const unifiedFeatures = fromCloud(cloudFeatures, task)
			const outcome = task.status === "completed" ? 1 : 0

			// Categorize and store samples
			if (task.type && task.type.includes("code")) {
				this._codeSamples.push({ features: cloudFeatures, outcome })
				this._extractCodeSamples([task])
			} else if (task.type && task.type.includes("debug")) {
				this._debugSamples.push({ features: cloudFeatures, outcome })
				this._extractDebugSamples([task])
			} else if (task.type && task.type.includes("test")) {
				this._testSamples.push({ features: cloudFeatures, outcome })
				this._extractTestSamples([task])
			}

			this.stats.observationsCollected++

			// Save observation to ml_observations_v2
			try {
				obsInsert.run(
					crypto.randomUUID(),
					task.type || "unknown",
					(task.body || "").slice(0, 500),
					(task.output || task.error || "").slice(0, 500),
					outcome,
					task.completed_at && task.started_at ? task.completed_at - task.started_at : 0,
					JSON.stringify(cloudFeatures),
					JSON.stringify(unifiedFeatures),
					"cloud",
					task.session_id || null,
					now,
				)
				this.stats.observationsSynced++
			} catch (err) {
				console.warn("[orchestrator/improvement-loop] Failed to save observation:", err.message)
			}
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

		// Serialize cloud model and save to ml_models after training
		await this._saveCloudModel()
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
	 * Enhanced: auto-queues improvement tasks when predictions are low,
	 * and triggers federated merge when sufficient data accumulates.
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

				// Auto-queue an improvement task if we have a taskQueue
				if (this.taskQueue && this._recentActions.length % 5 === 0) {
					try {
						await this.taskQueue.add("ml-improvement-task", {
							type: "improvement",
							description: `Auto-generated: improve ${modelName} task handling (prediction: ${(prediction * 100).toFixed(1)}%)`,
							source: "improvement-loop",
							taskId: task.id,
							modelName,
							prediction,
						})
						console.log(`[orchestrator/improvement-loop] Queued improvement task for ${modelName}`)
					} catch (qErr) {
						console.warn("[orchestrator/improvement-loop] Failed to queue improvement task:", qErr.message)
					}
				}
			}
		}

		// Trigger federated merge if conditions are met
		await this._maybeTriggerMerge()
	}

	/**
	 * Check if conditions are right for a federated merge and trigger one.
	 */
	async _maybeTriggerMerge() {
		const now = Date.now()
		if (now - this._lastMergeTimestamp < this.config.mergeIntervalMs) {
			return // Not enough time since last merge
		}

		try {
			const db = this.memory.getDb()
			const totalSamples = db.prepare(`SELECT COALESCE(SUM(training_samples), 0) as total FROM ml_models`).get()

			if (totalSamples.total < this.config.minSamplesForMerge) {
				return // Not enough total samples
			}

			// Check if there are at least 2 models to merge
			const modelCount = db.prepare(`SELECT COUNT(*) as count FROM ml_models`).get()
			if (modelCount.count < 2) {
				return
			}

			console.log("[orchestrator/improvement-loop] Triggering federated model merge...")
			await this._triggerMerge()
			this._lastMergeTimestamp = now
			this.stats.lastMergeTime = new Date(now).toISOString()
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Merge check failed:", err.message)
		}
	}

	/**
	 * Perform federated merge of all available models.
	 */
	async _triggerMerge() {
		try {
			const db = this.memory.getDb()
			const rows = db
				.prepare(`SELECT * FROM ml_models WHERE training_samples >= 1 ORDER BY created_at DESC`)
				.all()

			if (rows.length < 2) {
				console.log("[orchestrator/improvement-loop] Not enough models to merge")
				return
			}

			const models = rows.map((r) => ({
				schemaVersion: r.schema_version,
				modelType: r.model_type,
				timestamp: new Date(r.created_at).toISOString(),
				source: r.source,
				featureDimensions: r.feature_dimensions,
				trainingSamples: r.training_samples,
				architecture: JSON.parse(r.architecture || "{}"),
				parameters: JSON.parse(r.parameters),
				metadata: JSON.parse(r.metadata || "{}"),
			}))

			const merged = federatedMerge(models, { minSamples: 1, source: "cloud" })

			const modelId = crypto.randomUUID()
			const now = Date.now()
			const mergedFrom = JSON.stringify(
				models.map((m) => ({
					source: m.source,
					samples: m.trainingSamples,
					type: m.modelType,
				})),
			)

			db.prepare(
				`INSERT INTO ml_models (id, model_type, source, schema_version, feature_dimensions, training_samples, parameters, architecture, metadata, is_merged, merged_from, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				modelId,
				merged.modelType,
				merged.source,
				merged.schemaVersion,
				merged.featureDimensions,
				merged.trainingSamples,
				JSON.stringify(merged.parameters),
				JSON.stringify(merged.architecture),
				JSON.stringify(merged.metadata),
				1,
				mergedFrom,
				now,
				now,
			)

			// Record sync log
			db.prepare(
				`INSERT INTO ml_sync_log (id, direction, status, model_id, model_type, feature_dimensions, training_samples, source, target, payload_size_bytes, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				crypto.randomUUID(),
				"bidirectional",
				"completed",
				modelId,
				merged.modelType,
				merged.featureDimensions,
				merged.trainingSamples,
				"cloud",
				"all",
				Buffer.byteLength(JSON.stringify(merged), "utf8"),
				now,
			)

			// Apply the merged model to local weights
			this._applyModelFromDb({
				schema_version: merged.schemaVersion,
				model_type: merged.modelType,
				feature_dimensions: merged.featureDimensions,
				training_samples: merged.trainingSamples,
				parameters: JSON.stringify(merged.parameters),
				architecture: JSON.stringify(merged.architecture),
			})

			console.log(
				`[orchestrator/improvement-loop] Federated merge complete: ${models.length} models -> 1 merged model (${merged.trainingSamples} samples)`,
			)
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Merge failed:", err.message)
		}
	}

	/**
	 * Save the current cloud model weights to ml_models table.
	 */
	async _saveCloudModel() {
		try {
			const db = this.memory.getDb()

			// Use the code model as the representative (all models have same feature count)
			const codeModel = this._weights.code
			if (!codeModel.featureWeights) return

			const serialized = serializeLinearRegression({
				weights: codeModel.featureWeights,
				bias: codeModel.bias,
				featureDimensions: codeModel.featureWeights.length,
				trainingSamples: this._codeSamples.length + this._debugSamples.length + this._testSamples.length,
				source: "cloud",
				metadata: {
					codeSamples: this._codeSamples.length,
					debugSamples: this._debugSamples.length,
					testSamples: this._testSamples.length,
				},
			})

			const modelId = crypto.randomUUID()
			const now = Date.now()

			db.prepare(
				`INSERT INTO ml_models (id, model_type, source, schema_version, feature_dimensions, training_samples, parameters, architecture, metadata, is_merged, merged_from, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				modelId,
				serialized.modelType,
				serialized.source,
				serialized.schemaVersion,
				serialized.featureDimensions,
				serialized.trainingSamples,
				JSON.stringify(serialized.parameters),
				JSON.stringify(serialized.architecture),
				JSON.stringify(serialized.metadata),
				0,
				null,
				now,
				now,
			)

			console.log(
				`[orchestrator/improvement-loop] Saved cloud model (${serialized.trainingSamples} samples, ${serialized.featureDimensions} features)`,
			)
		} catch (err) {
			console.warn("[orchestrator/improvement-loop] Failed to save cloud model:", err.message)
		}
	}

	/**
	 * Manually trigger an improvement cycle (called from API).
	 */
	async triggerCycle() {
		try {
			await this.observeAndLearn()
			await this.predictAndAct()
			await this._persist()
			console.log("[orchestrator/improvement-loop] Manual cycle triggered")
		} catch (err) {
			console.error("[orchestrator/improvement-loop] Manual cycle error:", err.message)
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
