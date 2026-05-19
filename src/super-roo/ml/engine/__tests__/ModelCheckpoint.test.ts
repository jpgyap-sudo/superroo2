/**
 * Super Roo ML — ModelCheckpoint Tests
 *
 * Tests save, load, saveWithValidation, loadBest, and clear operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Tensor } from "../Tensor"
import { DenseLayer } from "../Layer"
import { ModelCheckpoint } from "../checkpoint"
import { SGDOptimizer } from "../Optimizer"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP_DIR = path.join(__dirname, ".test-checkpoints")

async function cleanTmpDir() {
	try {
		await fs.rm(TMP_DIR, { recursive: true, force: true })
	} catch {
		// ignore
	}
}

function createTestLayers(): DenseLayer[] {
	return [
		new DenseLayer(4, 3), // 4 inputs -> 3 outputs
		new DenseLayer(3, 2), // 3 inputs -> 2 outputs
	]
}

// ---------------------------------------------------------------------------
// ModelCheckpoint
// ---------------------------------------------------------------------------

describe("ModelCheckpoint", () => {
	beforeEach(async () => {
		await cleanTmpDir()
	})

	afterEach(async () => {
		await cleanTmpDir()
	})

	it("saves and loads weights correctly", async () => {
		const cp = new ModelCheckpoint({ dir: TMP_DIR, name: "test-model" })
		const layers = createTestLayers()

		// Save
		await cp.save(layers)

		// Verify file exists
		const filePath = path.join(TMP_DIR, "test-model.json")
		const stat = await fs.stat(filePath)
		expect(stat.size).toBeGreaterThan(0)

		// Modify weights to verify load restores them
		const originalWeights = layers[0].parameters()[0].tensor.data.slice()
		layers[0].parameters()[0].tensor.data.fill(0)

		// Load
		const data = await cp.load(layers)
		expect(data).not.toBeNull()
		expect(data!.version).toBe(2)

		// Verify weights restored
		const restored = Array.from(layers[0].parameters()[0].tensor.data)
		expect(restored).toEqual(Array.from(originalWeights))
	})

	it("saves and restores optimizer state", async () => {
		const cp = new ModelCheckpoint({ dir: TMP_DIR, name: "test-optim" })
		const layers = createTestLayers()
		const optimizer = new SGDOptimizer(layers.flatMap((l) => l.parameters()))

		await cp.save(layers, optimizer)

		// Load should not throw with optimizer
		const data = await cp.load(layers, optimizer)
		expect(data).not.toBeNull()
	})

	it("saveWithValidation saves when loss improves (saveBestOnly)", async () => {
		const cp = new ModelCheckpoint({
			dir: TMP_DIR,
			name: "test-best",
			saveBestOnly: true,
			improvementThreshold: 0.01,
		})
		const layers = createTestLayers()

		// First save: no previous best, should save
		const saved1 = await cp.saveWithValidation(layers, 1.0, undefined, 1, 2.0)
		expect(saved1).toBe(true)
		expect(cp.getBestValLoss()).toBe(1.0)

		// Second save: loss didn't improve (1.0 -> 1.0, diff=0 < 0.01), should NOT save
		const saved2 = await cp.saveWithValidation(layers, 1.0, undefined, 2, 1.5)
		expect(saved2).toBe(false)
		expect(cp.getBestValLoss()).toBe(1.0)

		// Third save: loss improved (1.0 -> 0.5, diff=0.5 > 0.01), should save
		const saved3 = await cp.saveWithValidation(layers, 0.5, undefined, 3, 1.0)
		expect(saved3).toBe(true)
		expect(cp.getBestValLoss()).toBe(0.5)
	})

	it("loadBest loads the best checkpoint", async () => {
		const cp = new ModelCheckpoint({
			dir: TMP_DIR,
			name: "test-best2",
			saveBestOnly: true,
		})
		const layers = createTestLayers()

		// Save with loss=1.0
		await cp.saveWithValidation(layers, 1.0)

		// Modify weights
		layers[0].parameters()[0].tensor.data.fill(99)

		// Save with loss=0.5 (better)
		await cp.saveWithValidation(layers, 0.5)

		// Load best should restore the 0.5-loss weights
		const bestData = await cp.loadBest(layers)
		expect(bestData).not.toBeNull()
		expect(bestData!.metadata?.valLoss).toBe(0.5)
	})

	it("load returns null for non-existent file", async () => {
		const cp = new ModelCheckpoint({ dir: TMP_DIR, name: "nonexistent" })
		const layers = createTestLayers()
		const data = await cp.load(layers)
		expect(data).toBeNull()
	})

	it("clear removes checkpoint files and resets state", async () => {
		const cp = new ModelCheckpoint({
			dir: TMP_DIR,
			name: "test-clear",
			saveBestOnly: true,
		})
		const layers = createTestLayers()

		await cp.saveWithValidation(layers, 1.0)
		expect(cp.getBestValLoss()).toBe(1.0)

		await cp.clear()
		expect(cp.getBestValLoss()).toBeNull()

		// File should be gone
		const data = await cp.load(layers)
		expect(data).toBeNull()
	})

	it("throws on version mismatch", async () => {
		const cp = new ModelCheckpoint({ dir: TMP_DIR, name: "test-version" })
		const layers = createTestLayers()

		// Manually write a v1 checkpoint
		const filePath = path.join(TMP_DIR, "test-version.json")
		await fs.mkdir(TMP_DIR, { recursive: true })
		await fs.writeFile(filePath, JSON.stringify({ version: 1, weights: [] }), "utf-8")

		await expect(cp.load(layers)).rejects.toThrow("Unsupported checkpoint version")
	})

	it("throws on layer parameter count mismatch", async () => {
		const cp = new ModelCheckpoint({ dir: TMP_DIR, name: "test-mismatch" })
		const layers = createTestLayers()

		// Save with 2 layers
		await cp.save(layers)

		// Manually corrupt the checkpoint to have wrong param count for layer 0
		const filePath = path.join(TMP_DIR, "test-mismatch.json")
		const raw = JSON.parse(await fs.readFile(filePath, "utf-8"))
		raw.weights[0] = raw.weights[0].slice(0, 1) // only 1 param instead of 2
		await fs.writeFile(filePath, JSON.stringify(raw), "utf-8")

		await expect(cp.load(layers)).rejects.toThrow("parameter count mismatch")
	})
})
