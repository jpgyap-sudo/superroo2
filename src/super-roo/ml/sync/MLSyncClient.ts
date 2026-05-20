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
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MIN_SAMPLES = 10
const DEFAULT_MAX_BATCH_SIZE = 100
const MAX_RETRY_BACKOFF_MS = 30 * 60 * 1000 // 30 minutes

// ── MLSyncClient ───────────────────────────────────────────────────────────────

export class MLSyncClient {
	private config: Required<MLSyncConfig>
	private modelPersistence: ModelPersistence
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
	}
	private isSyncing = false

	constructor(config: MLSyncConfig, modelPersistence: ModelPersistence, neuralNetwork: NeuralNetwork | null = null) {
		this.config = {
			apiBaseUrl: config.apiBaseUrl,
			syncIntervalMs: config.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
			minSamplesForUpload: config.minSamplesForUpload ?? DEFAULT_MIN_SAMPLES,
			maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
			authToken: config.authToken ?? "",
		}
		this.modelPersistence = modelPersistence
		this.neuralNetwork = neuralNetwork
	}

	/**
	 * Start periodic sync. Checks connectivity and begins the sync loop.
	 */
	async start(): Promise<void> {
		if (this.syncTimer) return

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
	}

	/**
	 * Get current sync status.
	 */
	getStatus(): SyncStatus {
		return { ...this.status, pendingObservations: this.observationQueue.length }
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
				return
			}

			// 1. Upload local model if we have enough samples
			await this.uploadModel()

			// 2. Download latest cloud model
			await this.downloadModel()

			// 3. Sync observations
			await this.syncObservations()

			this.status.lastError = null
		} catch (err: any) {
			this.status.lastError = err.message
			this.status.isOnline = false
		} finally {
			this.isSyncing = false
		}
	}

	/**
	 * Check if the cloud API is reachable.
	 */
	private async checkConnectivity(): Promise<boolean> {
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 5000)
			const res = await fetch(`${this.config.apiBaseUrl}/health`, {
				signal: controller.signal,
			})
			clearTimeout(timeout)
			return res.ok
		} catch {
			return false
		}
	}

	/**
	 * Upload the local model weights to the cloud.
	 */
	private async uploadModel(): Promise<void> {
		const weights = await this.modelPersistence.load()
		if (!weights) {
			return // No model to upload
		}

		// Count total training samples from all heads
		let totalSamples = 0
		for (const headKey of Object.keys(weights.heads)) {
			const headWeights = weights.heads[headKey]
			if (headWeights) {
				totalSamples++
			}
		}

		if (totalSamples < this.config.minSamplesForUpload) {
			return // Not enough training data yet
		}

		// Build the serialized model payload
		const payload = {
			schemaVersion: 1,
			modelType: "neural-network" as const,
			timestamp: new Date().toISOString(),
			source: "local",
			featureDimensions: 8, // Local uses 8-dim feature space
			trainingSamples: totalSamples,
			architecture: {
				type: "dense",
				layers: this.getLayerArchitecture(weights),
			},
			parameters: {
				weights: weights.encoder, // encoder is number[][][]
			},
			metadata: {
				heads: Object.keys(weights.heads),
				version: weights.version,
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

			// Convert cloud model weights to local PersistedWeights format
			// Cloud model parameters.weights is number[][][] — same format as local encoder
			const cloudWeights: PersistedWeights = {
				version: cloudModel.schemaVersion || 1,
				encoder: cloudModel.parameters.weights,
				heads: {}, // Cloud model doesn't have task-specific heads
			}

			// Save the downloaded model locally
			await this.modelPersistence.save(cloudWeights)

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
			} else {
				// Re-queue on failure (catch block below handles network errors)
				this.observationQueue.unshift(...batch)
				this.status.pendingObservations = this.observationQueue.length
				const errData = await res.json().catch(() => ({}))
				this.status.lastError = `ObsSync: ${res.status} - ${errData.error || res.statusText}`
			}
		} catch (err: any) {
			// Re-queue on network error
			this.observationQueue.unshift(...batch)
			this.status.pendingObservations = this.observationQueue.length
			this.status.lastError = `ObsSync: ${err.message}`
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
