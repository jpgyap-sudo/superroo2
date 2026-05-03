/**
 * Super Roo ML — Model Persistence
 *
 * Serialise / deserialise full learner state (encoder + heads) to disk.
 * Uses safeWriteJson for atomic writes.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface PersistedWeights {
	version: 1
	encoder: number[][][]
	heads: Record<string, number[][][]>
}

export interface ModelPersistenceConfig {
	/** Directory where model weights are stored. */
	dir: string
	/** Base name for the model file. */
	name: string
}

export class ModelPersistence {
	private filePath: string

	constructor(config: ModelPersistenceConfig) {
		this.filePath = path.join(config.dir, `${config.name}.json`)
	}

	/** Save weights atomically. */
	async save(weights: PersistedWeights): Promise<void> {
		const { safeWriteJson } = await import("../../../utils/safeWriteJson")
		await safeWriteJson(this.filePath, weights)
	}

	/** Load weights if they exist. */
	async load(): Promise<PersistedWeights | null> {
		try {
			const raw = await fs.readFile(this.filePath, "utf-8")
			const parsed = JSON.parse(raw) as PersistedWeights
			if (parsed.version !== 1) {
				throw new Error(`Unsupported weight version: ${parsed.version}`)
			}
			return parsed
		} catch (err: any) {
			if (err.code === "ENOENT") return null
			throw err
		}
	}

	/** Remove persisted weights. */
	async clear(): Promise<void> {
		try {
			await fs.unlink(this.filePath)
		} catch (err: any) {
			if (err.code !== "ENOENT") throw err
		}
	}
}
