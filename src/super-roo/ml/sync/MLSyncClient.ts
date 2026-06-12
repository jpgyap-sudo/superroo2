/**
 * MLSyncClient.ts
 *
 * Periodic sync client that bridges the local VS Code extension ML engine
 * with the cloud orchestrator for federated learning.
 *
 * Responsibilities:
 *   1. Upload local model weights to cloud after training
 *   2. Download latest merged cloud model for local inference
 *   3. Sync observations (features + outcomes) to cloud
 *   4. Offline-first: queue syncs when cloud is unreachable, retry on reconnect
 *   5. Configurable sync interval and feature mapping
 */

import { promises as fs } from "fs"
import { ModelPersistence, type PersistedWeights } from "../engine/ModelPersistence"
import { NeuralNetwork } from "../engine/NeuralNetwork"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MLSyncConfig {
	/** Cloud API base URL (e.g., "http://100.64.175.88:8787") */
	apiBaseUrl: string
	/** How often to sync (ms). Default: 5 minutes */
	syncIntervalMs?: number
	/** Minimum training samples before uploading model. Default: 10 */
	minSamplesForUpload?: number
	/** Maximum observations to batch per sync. Default: 100 */
	maxBatchSize?: number
	/** Auth token for cloud API */
	authToken?: string
}

export interface SyncObservation {
	id?: string
	taskType: string
	inputSummary: string
	outputSummary: string
	success: boolean
	durationMs: number
	featuresLocal: number[]
	featuresCloud?: number[]
	featuresUnified: number[]
	source: "local"
	sessionId?: string
	createdAt?: number
}

export interface SyncStatus {
	lastUploadAt: number | null
	lastDownloadAt: number | null
	lastObservationSyncAt: number | null
	totalUploads: number
	totalDownloads: number
	totalObservationsSynced: number
	pendingObservations: number
	isOnline: boolean
	lastError: string | null
	degradedMode: boolean
	degradationReason: string | null
	health: {
		api: boolean
		modelEndpoint: boolean
		observationEndpoint: boolean
	}
	retryBackoffMs: number
	consecutiveFailures: number
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MIN_SAMPLES = 10
const DEFAULT_MAX_BATCH_SIZE = 100
const MAX_RETRY_BACKOFF_MS = 30 * 60 * 1000 // 30 minutes
const INITIAL_RETRY_BACKOFF_MS = 5_000

// ── MLSyncClient ───────────────────────────────────────────────────────────────

export class MLSyncClient {
	private config: Required<MLSyncConfig>
	private modelPersistence: ModelPersistence
	private learnerPersistences: ModelPersistence[] = []
	private neuralNetwork: NeuralNetwork | null = null
	private syncTimer: ReturnType<typeof setInterval> | null = null
	private observationQueue: SyncObservation[] = []
	private status: SyncStatus = {
		lastUploadAt: null,
		lastDownloadAt: null,
		lastObservationSyncAt: null,
		totalUploads: 0,
		totalDownloads: 0,
		totalObservationsSynced: 0,
		pendingObservations: 0,
		isOnline: false,
		lastError: null,
		degradedMode: false,
		degradationReason: null,
		health: {
			api: false,
			modelEndpoint: false,
			observationEndpoint: false,
		},
		retryBackoffMs: INITIAL_RETRY_BACKOFF_MS,
		consecutiveFailures: 0,
	}
	private isSyncing = false
	private queueFilePath: string
	private syncMetaFilePath: string
	private retryBackoffMs = INITIAL_RETRY_BACKOFF_MS
	private consecutiveFailures = 0

	constructor(
		config: MLSyncConfig,
		modelPersistence: ModelPersistence,
		neuralNetwork: NeuralNetwork | null = null,
		learnerPersistences: ModelPersistence[] = [],
	) {
		this.config = {
			apiBaseUrl: config.apiBaseUrl,
			syncIntervalMs: config.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
			minSamplesForUpload: config.minSamplesForUpload ?? DEFAULT_MIN_SAMPLES,
			maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
			authToken: config.authToken ?? "",
		}
		this.modelPersistence = modelPersistence
		this.neuralNetwork = neuralNetwork
		this.learnerPersistences = learnerPersistences
		const modelDir = process.cwd()
		this.queueFilePath = `${modelDir}/memory/ml-sync-observation-queue.json`
		this.syncMetaFilePath = `${modelDir}/memory/ml-sync-meta.json`
	}

	/**
	 * Start periodic sync. Checks connectivity and begins the sync loop.
	 */
	async start(): Promise<void> {
		if (this.syncTimer) return

		await this.loadPersistedQueue()
		// Check connectivity on start
		this.status.isOnline = await this.checkConnectivity()

		// Run an initial sync
		await this.sync()

		// Schedule periodic sync
		this.syncTimer = setInterval(() => {
			this.sync().catch((err) => {
				this.status.lastError = err.message
				this.status.isOnline = false
			})
		}, this.config.syncIntervalMs)
	}

	/**
	 * Stop periodic sync.
	 */
	async stop(): Promise<void> {
		if (this.syncTimer) {
			clearInterval(this.syncTimer)
			this.syncTimer = null
		}
		// Flush remaining observations before stopping
		if (this.observationQueue.length > 0) {
			await this.syncObservations().catch(() => {})
		}
	}

	/**
	 * Set the neural network reference (used after model loading).
	 */
	setNeuralNetwork(nn: NeuralNetwork): void {
		this.neuralNetwork = nn
	}

	/**
	 * Queue an observation for sync to the cloud.
	 */
	queueObservation(obs: SyncObservation): void {
		this.observationQueue.push(obs)
		this.status.pendingObservations = this.observationQueue.length
		void this.persistQueue()
	}

	/**
	 * Get current sync status.
	 */
	getStatus(): SyncStatus {
		return {
			...this.status,
			pendingObservations: this.observationQueue.length,
			retryBackoffMs: this.retryBackoffMs,
			consecutiveFailures: this.consecutiveFailures,
		}
	}

	/**
	 * Force an immediate sync cycle.
	 */
	async sync(): Promise<void> {
		if (this.isSyncing) return
		this.isSyncing = true

		try {
			// Check connectivity
			this.status.isOnline = await this.checkConnectivity()
			if (!this.status.isOnline) {
				this.markDegraded("API health endpoint unreachable")
				await this.applyBackoffDelay()
				return
			}

			// 1. Upload local model if we have enough samples
			await this.uploadModel()

			// 2. Download latest cloud model
			await this.downloadModel()

			// 3. Sync observations
			await this.syncObservations()

			this.status.lastError = null
			this.clearDegraded()
			this.consecutiveFailures = 0
			this.retryBackoffMs = INITIAL_RETRY_BACKOFF_MS
		} catch (err: any) {
			this.status.lastError = err.message
			this.status.isOnline = false
			this.markDegraded(err?.message || "sync failed")
			await this.applyBackoffDelay()
		} finally {
			this.isSyncing = false
		}
	}

	/**
	 * Check if the cloud API is reachable.
	 */
	private async checkConnectivity(): Promise<boolean> {
		const health = {
			api: false,
			modelEndpoint: false,
			observationEndpoint: false,
		}
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 5000)
			const res = await fetch(`${this.config.apiBaseUrl}/health`, {
				signal: controller.signal,
			})
			clearTimeout(timeout)
			health.api = res.ok
		} catch {
			health.api = false
		}

		try {
			const res = await fetch(`${this.config.apiBaseUrl}/ml/model/latest?source=cloud&type=neural-network`, {
				headers: {
					...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
				},
			})
			health.modelEndpoint = res.ok || res.status === 404
		} catch {
			health.modelEndpoint = false
		}

		try {
			const res = await fetch(`${this.config.apiBaseUrl}/ml/observations/sync`, {
				method: "OPTIONS",
				headers: {
					...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
				},
			})
			health.observationEndpoint = res.ok || res.status === 204 || res.status === 405
		} catch {
			health.observationEndpoint = false
		}

		this.status.health = health
		return health.api
	}

	/**
	 * Upload the local model weights to the cloud.
	 * Consolidates weights from all learner files (GAP #3 fix).
	 */
	private async uploadModel(): Promise<void> {
		// Load from primary sync model persistence
		const primaryWeights = await this.modelPersistence.load()

		// Also load from individual learner persistences and merge heads (GAP #3)
		let encoder: number[][][] | null = primaryWeights?.encoder ?? null
		const allHeads: Record<string, number[][][]> = {}
		let version = 1
		let totalSamples = 0

		if (primaryWeights) {
			encoder = primaryWeights.encoder
			version = primaryWeights.version ?? 1
			for (const headKey of Object.keys(primaryWeights.heads)) {
				if (primaryWeights.heads[headKey]) {
					allHeads[headKey] = primaryWeights.heads[headKey]
					totalSamples++
				}
			}
		}

		// Merge weights from individual learner files
		for (const lp of this.learnerPersistences) {
			const learnerWeights = await lp.load()
			if (!learnerWeights) continue
			if (!encoder) {
				encoder = learnerWeights.encoder
				version = learnerWeights.version ?? 1
			}
			for (const headKey of Object.keys(learnerWeights.heads)) {
				if (learnerWeights.heads[headKey] && !allHeads[headKey]) {
					allHeads[headKey] = learnerWeights.heads[headKey]
					totalSamples++
				}
			}
		}

		if (!encoder) {
			return // No model to upload
		}

		if (totalSamples < this.config.minSamplesForUpload) {
			return // Not enough training data yet
		}

		// Build the serialized model payload with consolidated heads
		const payload = {
			schemaVersion: 1,
			modelType: "neural-network" as const,
			timestamp: new Date().toISOString(),
			source: "local",
			featureDimensions: 8, // Local uses 8-dim feature space
			trainingSamples: totalSamples,
			architecture: {
				type: "dense",
				layers: this.getLayerArchitecture({ encoder, heads: allHeads, version: 1 }),
			},
			parameters: {
				weights: encoder,
			},
			metadata: {
				heads: Object.keys(allHeads),
				version,
				serializedAt: new Date().toISOString(),
			},
		}

		try {
			const res = await fetch(`${this.config.apiBaseUrl}/ml/model/upload`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
				},
				body: JSON.stringify(payload),
			})

			if (res.ok) {
				this.status.lastUploadAt = Date.now()
				this.status.totalUploads++
			} else {
				const errData = await res.json().catch(() => ({}))
				throw new Error(`Upload failed: ${res.status} - ${errData.error || res.statusText}`)
			}
		} catch (err: any) {
			// Don't throw — offline queueing is handled by the caller
			this.status.lastError = `Upload: ${err.message}`
		}
	}

	/**
	 * Download the latest merged cloud model and apply it locally.
	 */
	private async downloadModel(): Promise<void> {
		try {
			const res = await fetch(`${this.config.apiBaseUrl}/ml/model/latest?source=cloud&type=neural-network`, {
				headers: {
					...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
				},
			})

			if (!res.ok) {
				if (res.status === 404) {
					return // No cloud model yet, that's fine
				}
				const errData = await res.json().catch(() => ({}))
				throw new Error(`Download failed: ${res.status} - ${errData.error || res.statusText}`)
			}

			const data = await res.json()
			if (!data.success || !data.model) {
				return
			}

			const cloudModel = data.model
			const shouldApply = await this.shouldApplyCloudModel(cloudModel)
			if (!shouldApply) {
				this.markDegraded("Rejected stale/regressive cloud model")
				return
			}

			// Convert cloud model weights to local PersistedWeights format
			// Cloud model parameters.weights is number[][][] — same format as local encoder
			const cloudWeights: PersistedWeights = {
				version: cloudModel.schemaVersion || 1,
				encoder: cloudModel.parameters.weights,
				heads: {}, // Cloud model doesn't have task-specific heads
			}

			// Save the downloaded model to ALL learner persistences (GAP #3 fix)
			await this.modelPersistence.save(cloudWeights)
			for (const lp of this.learnerPersistences) {
				await lp.save(cloudWeights).catch(() => {
					// Individual learner save failures are non-fatal
				})
			}

			// If we have a neural network reference, apply the weights
			if (this.neuralNetwork) {
				try {
					this.neuralNetwork.deserialise(cloudModel.parameters.weights)
				} catch (nnErr) {
					// Shape mismatch — cloud model may have different architecture
					this.status.lastError = `Download: shape mismatch — ${nnErr}`
				}
			}

			this.status.lastDownloadAt = Date.now()
			this.status.totalDownloads++
			await this.persistSyncMeta({
				lastCloudModelVersion: cloudWeights.version,
				lastCloudModelDownloadedAt: this.status.lastDownloadAt,
			})
		} catch (err: any) {
			this.status.lastError = `Download: ${err.message}`
		}
	}

	/**
	 * Sync queued observations to the cloud.
	 */
	private async syncObservations(): Promise<void> {
		if (this.observationQueue.length === 0) return

		const batch = this.observationQueue.splice(0, this.config.maxBatchSize)
		this.status.pendingObservations = this.observationQueue.length
		await this.persistQueue()

		try {
			const res = await fetch(`${this.config.apiBaseUrl}/ml/observations/sync`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
				},
				body: JSON.stringify({ observations: batch }),
			})

			if (res.ok) {
				this.status.lastObservationSyncAt = Date.now()
				this.status.totalObservationsSynced += batch.length
				await this.persistQueue()
			} else {
				// Re-queue on failure (catch block below handles network errors)
				this.observationQueue.unshift(...batch)
				this.status.pendingObservations = this.observationQueue.length
				await this.persistQueue()
				const errData = await res.json().catch(() => ({}))
				this.status.lastError = `ObsSync: ${res.status} - ${errData.error || res.statusText}`
			}
		} catch (err: any) {
			// Re-queue on network error
			this.observationQueue.unshift(...batch)
			this.status.pendingObservations = this.observationQueue.length
			await this.persistQueue()
			this.status.lastError = `ObsSync: ${err.message}`
		}
	}

	private markDegraded(reason: string): void {
		this.status.degradedMode = true
		this.status.degradationReason = reason
	}

	private clearDegraded(): void {
		this.status.degradedMode = false
		this.status.degradationReason = null
	}

	private async applyBackoffDelay(): Promise<void> {
		this.consecutiveFailures += 1
		const jitter = Math.floor(Math.random() * 1000)
		const delayMs = Math.min(this.retryBackoffMs + jitter, MAX_RETRY_BACKOFF_MS)
		await new Promise((resolve) => setTimeout(resolve, delayMs))
		this.retryBackoffMs = Math.min(this.retryBackoffMs * 2, MAX_RETRY_BACKOFF_MS)
	}

	private async persistQueue(): Promise<void> {
		try {
			await fs.mkdir(this.queueFilePath.substring(0, this.queueFilePath.lastIndexOf("/")), { recursive: true })
			await fs.writeFile(this.queueFilePath, JSON.stringify(this.observationQueue), "utf8")
		} catch {
			// non-fatal
		}
	}

	private async loadPersistedQueue(): Promise<void> {
		try {
			const raw = await fs.readFile(this.queueFilePath, "utf8")
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				this.observationQueue = parsed
				this.status.pendingObservations = this.observationQueue.length
			}
		} catch {
			// non-fatal
		}
	}

	private async persistSyncMeta(meta: Record<string, unknown>): Promise<void> {
		try {
			let existing: Record<string, unknown> = {}
			try {
				const raw = await fs.readFile(this.syncMetaFilePath, "utf8")
				existing = JSON.parse(raw)
			} catch {}
			await fs.mkdir(this.syncMetaFilePath.substring(0, this.syncMetaFilePath.lastIndexOf("/")), { recursive: true })
			await fs.writeFile(this.syncMetaFilePath, JSON.stringify({ ...existing, ...meta }), "utf8")
		} catch {
			// non-fatal
		}
	}

	private async shouldApplyCloudModel(cloudModel: any): Promise<boolean> {
		try {
			let existing: Record<string, any> = {}
			try {
				const raw = await fs.readFile(this.syncMetaFilePath, "utf8")
				existing = JSON.parse(raw)
			} catch {}
			const lastVersion = Number(existing.lastCloudModelVersion || 0)
			const incomingVersion = Number(cloudModel?.schemaVersion || 0)
			if (incomingVersion < lastVersion) {
				return false
			}
			return true
		} catch {
			return true
		}
	}

	/**
	 * Extract layer architecture from persisted weights for the serialized payload.
	 * encoder is number[][][] where each layer is [weights_flattened, bias_flattened].
	 * We estimate dimensions from the flattened weight vector length.
	 */
	private getLayerArchitecture(
		weights: PersistedWeights,
	): { index: number; inputSize: number; outputSize: number }[] {
		const encoder = weights.encoder
		if (!encoder || !Array.isArray(encoder)) return []

		return encoder.map((layer, i) => {
			// layer is number[][] — [weightsFlattened, biasFlattened]
			const weightsFlat = layer[0]
			const biasFlat = layer[1]
			const numBiases = biasFlat ? biasFlat.length : 0
			// For a dense layer: weights length = inputSize * outputSize, bias length = outputSize
			const outputSize = numBiases
			const inputSize = weightsFlat && outputSize > 0 ? Math.floor(weightsFlat.length / outputSize) : 0
			return { index: i, inputSize, outputSize }
		})
	}
}
