/**
 * Super Roo ML — Model Checkpointing
 *
 * Saves and restores model weights and optimizer state to/from JSON files.
 * Uses atomic write pattern (write to temp, rename) for safety.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Tensor } from "./Tensor"
import type { Layer } from "./Layer"
import type { Optimizer } from "./Optimizer"
import { AdamOptimizer, SGDOptimizer, type OptimizerState } from "./Optimizer"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckpointData {
	version: 2
	/** Per-layer weight arrays: [layerIndex][paramIndex][] */
	weights: number[][][]
	/** Optional optimizer state snapshot */
	optimizerState?: OptimizerState
	/** Training metadata */
	metadata?: {
		epoch: number
		trainLoss: number
		valLoss?: number
		[key: string]: unknown
	}
}

export interface ModelCheckpointConfig {
	/** Directory where checkpoint files are stored. */
	dir: string
	/** Base name for the checkpoint file (without extension). */
	name: string
	/** If true, only save when validation loss improves. Default: false. */
	saveBestOnly?: boolean
	/** Minimum improvement threshold for saveBestOnly. Default: 1e-4. */
	improvementThreshold?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// ModelCheckpoint
// ─────────────────────────────────────────────────────────────────────────────

export class ModelCheckpoint {
	private filePath: string
	private bestPath: string
	private saveBestOnly: boolean
	private improvementThreshold: number
	private bestValLoss: number | null = null

	constructor(config: ModelCheckpointConfig) {
		this.filePath = path.join(config.dir, `${config.name}.json`)
		this.bestPath = path.join(config.dir, `${config.name}_best.json`)
		this.saveBestOnly = config.saveBestOnly ?? false
		this.improvementThreshold = config.improvementThreshold ?? 1e-4
	}

	/**
	 * Save model weights and optional optimizer state to a checkpoint file.
	 */
	async save(layers: Layer[], optimizer?: Optimizer, metadata?: CheckpointData["metadata"]): Promise<void> {
		const weights = layers.map((layer) => layer.parameters().map((p) => Array.from(p.tensor.data)))

		let optimizerState: OptimizerState | undefined
		if (optimizer) {
			if (optimizer instanceof AdamOptimizer) {
				const { captureAdamOptimizerState } = await import("./Optimizer")
				optimizerState = captureAdamOptimizerState(optimizer)
			} else if (optimizer instanceof SGDOptimizer) {
				const { captureSGDOptimizerState } = await import("./Optimizer")
				optimizerState = captureSGDOptimizerState(optimizer)
			}
		}

		const data: CheckpointData = {
			version: 2,
			weights,
			optimizerState,
			metadata,
		}

		// Atomic write: write to temp file, then rename
		const dir = path.dirname(this.filePath)
		await fs.mkdir(dir, { recursive: true })
		const tmpPath = path.join(dir, `.${path.basename(this.filePath)}.tmp_${Date.now()}`)
		await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
		await fs.rename(tmpPath, this.filePath)
	}

	/**
	 * Save checkpoint only if validation loss has improved.
	 * Returns true if saved, false if not (loss didn't improve).
	 */
	async saveWithValidation(
		layers: Layer[],
		valLoss: number,
		optimizer?: Optimizer,
		epoch?: number,
		trainLoss?: number,
	): Promise<boolean> {
		if (!this.saveBestOnly) {
			await this.save(layers, optimizer, {
				epoch: epoch ?? 0,
				trainLoss: trainLoss ?? 0,
				valLoss,
			})
			return true
		}

		const improved = this.bestValLoss === null || this.bestValLoss - valLoss > this.improvementThreshold

		if (improved) {
			this.bestValLoss = valLoss
			await this.save(layers, optimizer, {
				epoch: epoch ?? 0,
				trainLoss: trainLoss ?? 0,
				valLoss,
			})
			// Also save a copy as _best
			const weights = layers.map((layer) => layer.parameters().map((p) => Array.from(p.tensor.data)))
			const data: CheckpointData = {
				version: 2,
				weights,
				metadata: { epoch: epoch ?? 0, trainLoss: trainLoss ?? 0, valLoss },
			}
			const dir = path.dirname(this.bestPath)
			await fs.mkdir(dir, { recursive: true })
			const tmpPath = path.join(dir, `.${path.basename(this.bestPath)}.tmp_${Date.now()}`)
			await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
			await fs.rename(tmpPath, this.bestPath)
		}

		return improved
	}

	/**
	 * Load weights from a checkpoint file and apply them to the given layers.
	 * Optionally restores optimizer state.
	 */
	async load(layers: Layer[], optimizer?: Optimizer, filepath?: string): Promise<CheckpointData | null> {
		const targetPath = filepath ?? this.filePath
		try {
			const raw = await fs.readFile(targetPath, "utf-8")
			const data = JSON.parse(raw) as CheckpointData

			if (data.version !== 2) {
				throw new Error(`Unsupported checkpoint version: ${data.version}`)
			}

			// Restore weights
			for (let i = 0; i < layers.length; i++) {
				const layerParams = layers[i].parameters()
				const layerWeights = data.weights[i]
				if (!layerWeights || layerParams.length !== layerWeights.length) {
					throw new Error(
						`Layer ${i} parameter count mismatch: expected ${layerParams.length}, got ${layerWeights?.length ?? 0}`,
					)
				}
				for (let j = 0; j < layerParams.length; j++) {
					const p = layerParams[j]
					const w = layerWeights[j]
					if (w.length !== p.tensor.data.length) {
						throw new Error(
							`Shape mismatch loading layer ${i} param ${j}: expected ${p.tensor.data.length}, got ${w.length}`,
						)
					}
					p.tensor.data.set(Float64Array.from(w))
				}
			}

			// Restore optimizer state if available
			if (data.optimizerState && optimizer) {
				const { restoreOptimizerState } = await import("./Optimizer")
				restoreOptimizerState(optimizer, data.optimizerState)
			}

			return data
		} catch (err: any) {
			if (err.code === "ENOENT") return null
			throw err
		}
	}

	/**
	 * Load the best checkpoint (saved via saveBestOnly).
	 */
	async loadBest(layers: Layer[]): Promise<CheckpointData | null> {
		return this.load(layers, undefined, this.bestPath)
	}

	/**
	 * Get the best validation loss recorded.
	 */
	getBestValLoss(): number | null {
		return this.bestValLoss
	}

	/**
	 * Remove checkpoint files.
	 */
	async clear(): Promise<void> {
		for (const fp of [this.filePath, this.bestPath]) {
			try {
				await fs.unlink(fp)
			} catch (err: any) {
				if (err.code !== "ENOENT") throw err
			}
		}
		this.bestValLoss = null
	}
}
