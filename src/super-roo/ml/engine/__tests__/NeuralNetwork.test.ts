/**
 * Super Roo ML — NeuralNetwork Integration Tests
 *
 * Tests the full training pipeline: forward pass, backward pass,
 * loss computation, and convergence on simple problems.
 */

import { Tensor } from "../Tensor"
import { NeuralNetwork } from "../NeuralNetwork"
import { MSELoss, CrossEntropyLoss, BCELoss } from "../Loss"

// ---------------------------------------------------------------------------
// Basic structure tests
// ---------------------------------------------------------------------------

describe("NeuralNetwork", () => {
	it("builds layers from config", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8, 6],
			activation: "relu",
		})
		const summary = nn.summary()
		expect(summary).toContain("Dense")
		expect(summary).toContain("ReLU")
	})

	it("can forward pass without training", () => {
		const nn = new NeuralNetwork({
			inputDim: 3,
			outputDim: 2,
			hiddenDims: [4],
		})
		const input = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const output = nn.predict(input)
		expect(output.rows).toBe(2)
		expect(output.cols).toBe(2)
	})

	it("serialises and deserialises correctly", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [3],
		})
		const weights = nn.serialise()
		expect(Array.isArray(weights)).toBe(true)
		expect(weights.length).toBeGreaterThan(0)

		// Deserialise should not throw
		expect(() => nn.deserialise(weights)).not.toThrow()
	})
})

// ---------------------------------------------------------------------------
// Training convergence tests
// ---------------------------------------------------------------------------

describe("NeuralNetwork training", () => {
	it("learns XOR function with BCE loss", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [8],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		// XOR dataset
		const X = Tensor.from2D([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		])
		const y = Tensor.from2D([[0], [1], [1], [0]])

		const losses = nn.train(X, y, new BCELoss(), {
			epochs: 800,
			batchSize: 4,
			learningRate: 0.1,
		})

		// Loss should decrease
		expect(losses.length).toBeGreaterThan(0)
		expect(losses[losses.length - 1]).toBeLessThan(losses[0])

		// Check predictions
		const pred = nn.predict(X)
		// pred(0,0) ≈ 0, pred(1,1) ≈ 0
		expect(pred.get(0, 0)).toBeLessThan(0.5)
		expect(pred.get(3, 0)).toBeLessThan(0.5)
		// pred(0,1) ≈ 1, pred(1,0) ≈ 1
		expect(pred.get(1, 0)).toBeGreaterThan(0.5)
		expect(pred.get(2, 0)).toBeGreaterThan(0.5)
	})

	it("learns AND function with BCE loss", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [3],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		const X = Tensor.from2D([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		])
		const y = Tensor.from2D([[0], [0], [0], [1]])

		const losses = nn.train(X, y, new BCELoss(), {
			epochs: 300,
			batchSize: 4,
			learningRate: 0.1,
		})

		expect(losses[losses.length - 1]).toBeLessThan(losses[0])

		const pred = nn.predict(X)
		// Only (1,1) should be close to 1
		expect(pred.get(0, 0)).toBeLessThan(0.5)
		expect(pred.get(1, 0)).toBeLessThan(0.5)
		expect(pred.get(2, 0)).toBeLessThan(0.5)
		expect(pred.get(3, 0)).toBeGreaterThan(0.5)
	})

	it("supports early stopping via onEpoch callback", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [8],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		// AND function is simpler than XOR — converges faster
		const X = Tensor.from2D([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		])
		const y = Tensor.from2D([[0], [0], [0], [1]])

		let epochCount = 0
		const losses = nn.train(X, y, new BCELoss(), {
			epochs: 1000,
			batchSize: 4,
			learningRate: 0.1,
			onEpoch: (epoch, trainLoss) => {
				epochCount = epoch + 1
				// Stop early when loss is low enough
				return trainLoss < 0.01
			},
		})

		// Should have stopped early (not all 1000 epochs)
		expect(losses.length).toBeLessThan(1000)
		expect(epochCount).toBeLessThan(1000)
		// Final loss should be low
		expect(losses[losses.length - 1]).toBeLessThan(0.01)
	})
})

// ---------------------------------------------------------------------------
// Classification with CrossEntropyLoss
// ---------------------------------------------------------------------------

describe("NeuralNetwork classification", () => {
	it("classifies 3-class problem with cross-entropy", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 3,
			hiddenDims: [8],
			activation: "relu",
			finalActivation: "softmax",
		})

		// Simple 3-class dataset: points near (0,0), (1,1), (2,2)
		const X = Tensor.from2D([
			[0, 0],
			[0.1, 0.1],
			[1, 1],
			[1.1, 1.1],
			[2, 2],
			[2.1, 2.1],
		])
		const y = Tensor.from2D([
			[1, 0, 0],
			[1, 0, 0],
			[0, 1, 0],
			[0, 1, 0],
			[0, 0, 1],
			[0, 0, 1],
		])

		const losses = nn.train(X, y, new CrossEntropyLoss(), {
			epochs: 500,
			batchSize: 6,
			learningRate: 0.05,
		})

		expect(losses[losses.length - 1]).toBeLessThan(losses[0])

		// Check predictions
		const pred = nn.predict(X)
		// For each sample, the predicted class should be correct
		for (let i = 0; i < 6; i++) {
			let maxIdx = 0
			for (let j = 1; j < 3; j++) {
				if (pred.get(i, j) > pred.get(i, maxIdx)) {
					maxIdx = j
				}
			}
			const expectedClass = i < 2 ? 0 : i < 4 ? 1 : 2
			expect(maxIdx).toBe(expectedClass)
		}
	})
})
