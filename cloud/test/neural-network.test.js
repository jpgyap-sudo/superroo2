/**
 * Tests for NeuralNetwork.js (cloud port of the ML engine)
 *
 * Covers Tensor, all layer types, loss functions, optimizers, and NeuralNetwork.
 */

import { describe, it, expect, beforeAll } from "vitest"
import {
	Tensor,
	DenseLayer,
	ReLULayer,
	SigmoidLayer,
	TanhLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	CrossEntropyLoss,
	MSELoss,
	HuberLoss,
	HingeLoss,
	MAELoss,
	KLLoss,
	CosineSimilarityLoss,
	BCELoss,
	AdamOptimizer,
	SGDOptimizer,
	NeuralNetwork,
} from "../orchestrator/modules/NeuralNetwork.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Tensor Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tensor", () => {
	describe("construction", () => {
		it("creates a tensor with given dimensions", () => {
			const t = new Tensor(3, 4, "zeros")
			expect(t.rows).toBe(3)
			expect(t.cols).toBe(4)
			expect(t.data.length).toBe(12)
		})

		it("initializes with zeros", () => {
			const t = new Tensor(2, 2, "zeros")
			expect(t.to2D()).toEqual([
				[0, 0],
				[0, 0],
			])
		})

		it("initializes with ones", () => {
			const t = new Tensor(2, 2, "ones")
			expect(t.to2D()).toEqual([
				[1, 1],
				[1, 1],
			])
		})

		it("from2D creates correct tensor", () => {
			const t = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			expect(t.rows).toBe(2)
			expect(t.cols).toBe(2)
			expect(t.get(0, 0)).toBe(1)
			expect(t.get(1, 1)).toBe(4)
		})

		it("from1D creates row vector", () => {
			const t = Tensor.from1D([1, 2, 3])
			expect(t.rows).toBe(1)
			expect(t.cols).toBe(3)
			expect(t.get(0, 2)).toBe(3)
		})

		it("zeros static factory", () => {
			const t = Tensor.zeros(2, 3)
			expect(t.rows).toBe(2)
			expect(t.cols).toBe(3)
			expect(t.max()).toBe(0)
		})

		it("ones static factory", () => {
			const t = Tensor.ones(2, 2)
			expect(t.get(0, 0)).toBe(1)
		})

		it("random creates values in range", () => {
			const t = Tensor.random(10, 10, 1)
			for (let i = 0; i < t.data.length; i++) {
				expect(t.data[i]).toBeGreaterThanOrEqual(-1)
				expect(t.data[i]).toBeLessThanOrEqual(1)
			}
		})
	})

	describe("element-wise ops", () => {
		it("add scalar", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.add(1)
			expect(r.to2D()).toEqual([
				[2, 3],
				[4, 5],
			])
		})

		it("add tensors same shape", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = Tensor.from2D([
				[5, 6],
				[7, 8],
			])
			const r = a.add(b)
			expect(r.to2D()).toEqual([
				[6, 8],
				[10, 12],
			])
		})

		it("add broadcasts row vector", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = Tensor.from1D([10, 20])
			const r = a.add(b)
			expect(r.to2D()).toEqual([
				[11, 22],
				[13, 24],
			])
		})

		it("sub scalar", () => {
			const a = Tensor.from2D([
				[5, 6],
				[7, 8],
			])
			const r = a.sub(1)
			expect(r.to2D()).toEqual([
				[4, 5],
				[6, 7],
			])
		})

		it("mul scalar", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.mul(2)
			expect(r.to2D()).toEqual([
				[2, 4],
				[6, 8],
			])
		})

		it("div scalar", () => {
			const a = Tensor.from2D([
				[2, 4],
				[6, 8],
			])
			const r = a.div(2)
			expect(r.to2D()).toEqual([
				[1, 2],
				[3, 4],
			])
		})

		it("div by zero throws", () => {
			const a = Tensor.ones(2, 2)
			expect(() => a.div(0)).toThrow("division by zero")
		})

		it("pow", () => {
			const a = Tensor.from2D([
				[2, 3],
				[4, 5],
			])
			const r = a.pow(2)
			expect(r.to2D()).toEqual([
				[4, 9],
				[16, 25],
			])
		})

		it("abs", () => {
			const a = Tensor.from2D([
				[-1, 2],
				[-3, 4],
			])
			const r = a.abs()
			expect(r.to2D()).toEqual([
				[1, 2],
				[3, 4],
			])
		})

		it("sqrt", () => {
			const a = Tensor.from2D([
				[4, 9],
				[16, 25],
			])
			const r = a.sqrt()
			expect(r.get(0, 0)).toBeCloseTo(2)
			expect(r.get(1, 1)).toBeCloseTo(5)
		})

		it("log", () => {
			const a = Tensor.from2D([[Math.E, Math.E * Math.E]])
			const r = a.log()
			expect(r.get(0, 0)).toBeCloseTo(1)
			expect(r.get(0, 1)).toBeCloseTo(2)
		})

		it("exp", () => {
			const a = Tensor.from1D([0, 1])
			const r = a.exp()
			expect(r.get(0, 0)).toBeCloseTo(1)
			expect(r.get(0, 1)).toBeCloseTo(Math.E)
		})

		it("neg", () => {
			const a = Tensor.from2D([
				[1, -2],
				[3, -4],
			])
			const r = a.neg()
			expect(r.to2D()).toEqual([
				[-1, 2],
				[-3, 4],
			])
		})
	})

	describe("matrix ops", () => {
		it("transpose", () => {
			const a = Tensor.from2D([
				[1, 2, 3],
				[4, 5, 6],
			])
			const r = a.transpose()
			expect(r.rows).toBe(3)
			expect(r.cols).toBe(2)
			expect(r.get(0, 0)).toBe(1)
			expect(r.get(2, 1)).toBe(6)
		})

		it("matmul basic", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = Tensor.from2D([
				[5, 6],
				[7, 8],
			])
			const r = a.matmul(b)
			expect(r.rows).toBe(2)
			expect(r.cols).toBe(2)
			// [1*5+2*7, 1*6+2*8] = [19, 22]
			// [3*5+4*7, 3*6+4*8] = [43, 50]
			expect(r.get(0, 0)).toBe(19)
			expect(r.get(0, 1)).toBe(22)
			expect(r.get(1, 0)).toBe(43)
			expect(r.get(1, 1)).toBe(50)
		})

		it("matmul shape mismatch throws", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = Tensor.from2D([
				[1, 2, 3],
				[4, 5, 6],
				[7, 8, 9],
			])
			expect(() => a.matmul(b)).toThrow("shape mismatch")
		})

		it("matmul large uses optimized path", () => {
			const a = Tensor.random(100, 50, 0.1)
			const b = Tensor.random(50, 80, 0.1)
			const r = a.matmul(b)
			expect(r.rows).toBe(100)
			expect(r.cols).toBe(80)
		})
	})

	describe("reductions", () => {
		it("sum all", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.sum()
			expect(r.get(0, 0)).toBe(10)
		})

		it("sum axis 0", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.sum(0)
			expect(r.get(0, 0)).toBe(4)
			expect(r.get(0, 1)).toBe(6)
		})

		it("sum axis 1", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.sum(1)
			expect(r.get(0, 0)).toBe(3)
			expect(r.get(1, 0)).toBe(7)
		})

		it("mean all", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const r = a.mean()
			expect(r.get(0, 0)).toBeCloseTo(2.5)
		})

		it("max and min", () => {
			const a = Tensor.from2D([
				[1, 5],
				[3, 2],
			])
			expect(a.max()).toBe(5)
			expect(a.min()).toBe(1)
		})
	})

	describe("in-place ops", () => {
		it("addInPlace", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = Tensor.from2D([
				[5, 6],
				[7, 8],
			])
			a.addInPlace(b)
			expect(a.get(0, 0)).toBe(6)
			expect(a.get(1, 1)).toBe(12)
		})

		it("mulInPlace", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			a.mulInPlace(2)
			expect(a.get(0, 0)).toBe(2)
			expect(a.get(1, 1)).toBe(8)
		})
	})

	describe("utilities", () => {
		it("clone", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			const b = a.clone()
			b.set(0, 0, 99)
			expect(a.get(0, 0)).toBe(1) // original unchanged
		})

		it("argmax", () => {
			const a = Tensor.from2D([
				[0.1, 0.7, 0.2],
				[0.3, 0.1, 0.6],
			])
			expect(a.argmax()).toEqual([1, 2])
		})

		it("sliceRows", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
				[5, 6],
			])
			const s = a.sliceRows(1, 3)
			expect(s.rows).toBe(2)
			expect(s.get(0, 0)).toBe(3)
			expect(s.get(1, 1)).toBe(6)
		})

		it("to1D", () => {
			const a = Tensor.from2D([
				[1, 2],
				[3, 4],
			])
			expect(a.to1D()).toEqual([1, 2, 3, 4])
		})
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Layer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("DenseLayer", () => {
	it("forward produces correct output shape", () => {
		const layer = new DenseLayer(4, 3)
		const input = Tensor.random(2, 4, 0.1)
		const out = layer.forward(input)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(3)
	})

	it("backward computes gradients", () => {
		const layer = new DenseLayer(4, 3)
		const input = Tensor.random(2, 4, 0.1)
		layer.forward(input)
		const outputGrad = Tensor.random(2, 3, 0.1)
		const inputGrad = layer.backward(outputGrad)
		expect(inputGrad.rows).toBe(2)
		expect(inputGrad.cols).toBe(4)
		// Gradients should be non-zero
		expect(layer.weightGrad.max()).not.toBe(0)
		expect(layer.biasGrad.max()).not.toBe(0)
	})

	it("backward before forward throws", () => {
		const layer = new DenseLayer(4, 3)
		const outputGrad = Tensor.random(2, 3, 0.1)
		expect(() => layer.backward(outputGrad)).toThrow("backward called before forward")
	})

	it("parameters returns weights and biases", () => {
		const layer = new DenseLayer(4, 3)
		const params = layer.parameters()
		expect(params.length).toBe(2)
		expect(params[0].name).toBe("W")
		expect(params[1].name).toBe("b")
	})

	it("describe returns correct string", () => {
		const layer = new DenseLayer(4, 3)
		expect(layer.describe()).toBe("Dense(4 → 3)")
	})
})

describe("ReLULayer", () => {
	it("forward passes positive values, zeroes negatives", () => {
		const layer = new ReLULayer()
		const input = Tensor.from2D([
			[-1, 2],
			[3, -4],
		])
		const out = layer.forward(input)
		expect(out.to2D()).toEqual([
			[0, 2],
			[3, 0],
		])
	})

	it("backward masks gradients", () => {
		const layer = new ReLULayer()
		const input = Tensor.from2D([
			[-1, 2],
			[3, -4],
		])
		layer.forward(input)
		const outputGrad = Tensor.from2D([
			[1, 1],
			[1, 1],
		])
		const inputGrad = layer.backward(outputGrad)
		expect(inputGrad.to2D()).toEqual([
			[0, 1],
			[1, 0],
		])
	})
})

describe("SigmoidLayer", () => {
	it("forward squashes to (0,1)", () => {
		const layer = new SigmoidLayer()
		const input = Tensor.from2D([
			[-10, 0, 10],
			[1, -1, 2],
		])
		const out = layer.forward(input)
		expect(out.get(0, 0)).toBeCloseTo(0)
		expect(out.get(0, 1)).toBeCloseTo(0.5)
		expect(out.get(0, 2)).toBeCloseTo(1)
	})

	it("backward computes sigmoid gradient", () => {
		const layer = new SigmoidLayer()
		const input = Tensor.from1D([0])
		layer.forward(input)
		const outputGrad = Tensor.from1D([1])
		const inputGrad = layer.backward(outputGrad)
		// sigmoid(0) = 0.5, gradient = 0.5 * (1 - 0.5) = 0.25
		expect(inputGrad.get(0, 0)).toBeCloseTo(0.25)
	})
})

describe("TanhLayer", () => {
	it("forward squashes to (-1,1)", () => {
		const layer = new TanhLayer()
		const input = Tensor.from1D([-10, 0, 10])
		const out = layer.forward(input)
		expect(out.get(0, 0)).toBeCloseTo(-1)
		expect(out.get(0, 1)).toBeCloseTo(0)
		expect(out.get(0, 2)).toBeCloseTo(1)
	})

	it("backward computes tanh gradient", () => {
		const layer = new TanhLayer()
		const input = Tensor.from1D([0])
		layer.forward(input)
		const outputGrad = Tensor.from1D([1])
		const inputGrad = layer.backward(outputGrad)
		// tanh(0) = 0, gradient = 1 - 0^2 = 1
		expect(inputGrad.get(0, 0)).toBeCloseTo(1)
	})
})

describe("SoftmaxLayer", () => {
	it("forward outputs sum to 1 per row", () => {
		const layer = new SoftmaxLayer()
		const input = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const out = layer.forward(input)
		// Each row sums to ~1
		const row0Sum = out.get(0, 0) + out.get(0, 1) + out.get(0, 2)
		const row1Sum = out.get(1, 0) + out.get(1, 1) + out.get(1, 2)
		expect(row0Sum).toBeCloseTo(1)
		expect(row1Sum).toBeCloseTo(1)
		// Largest input gets highest probability
		expect(out.get(0, 2)).toBeGreaterThan(out.get(0, 0))
	})
})

describe("DropoutLayer", () => {
	it("forward in training mode drops some values", () => {
		const layer = new DropoutLayer(0.5)
		const input = Tensor.ones(10, 10)
		const out = layer.forward(input)
		// With rate 0.5, roughly half should be zero
		let zeroCount = 0
		for (let i = 0; i < out.data.length; i++) {
			if (out.data[i] === 0) zeroCount++
		}
		expect(zeroCount).toBeGreaterThan(0)
		expect(zeroCount).toBeLessThan(out.data.length)
	})

	it("forward in eval mode passes through", () => {
		const layer = new DropoutLayer(0.5)
		layer.setTraining(false)
		const input = Tensor.ones(3, 3)
		const out = layer.forward(input)
		expect(out.to2D()).toEqual([
			[1, 1, 1],
			[1, 1, 1],
			[1, 1, 1],
		])
	})

	it("setRate and getRate work", () => {
		const layer = new DropoutLayer(0.5)
		expect(layer.getRate()).toBe(0.5)
		layer.setRate(0.3)
		expect(layer.getRate()).toBe(0.3)
		layer.resetRate()
		expect(layer.getRate()).toBe(0.5)
	})
})

describe("BatchNormLayer", () => {
	it("forward normalizes activations", () => {
		const layer = new BatchNormLayer(3)
		const input = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
			[7, 8, 9],
		])
		const out = layer.forward(input)
		expect(out.rows).toBe(3)
		expect(out.cols).toBe(3)
		// Output should be roughly zero-mean per feature
		const mean0 = out.mean(0)
		for (let j = 0; j < 3; j++) {
			expect(mean0.get(0, j)).toBeCloseTo(0, 0) // roughly zero
		}
	})

	it("backward computes gradients", () => {
		const layer = new BatchNormLayer(3)
		const input = Tensor.random(5, 3, 0.5)
		layer.forward(input)
		const outputGrad = Tensor.random(5, 3, 0.1)
		const inputGrad = layer.backward(outputGrad)
		expect(inputGrad.rows).toBe(5)
		expect(inputGrad.cols).toBe(3)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Loss Function Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CrossEntropyLoss", () => {
	it("computes loss and gradient", () => {
		const lossFn = new CrossEntropyLoss()
		const pred = Tensor.from2D([
			[0.7, 0.2, 0.1],
			[0.1, 0.8, 0.1],
		])
		const target = Tensor.from2D([
			[1, 0, 0],
			[0, 1, 0],
		])
		const { loss, grad } = lossFn.forward(pred, target)
		expect(loss).toBeGreaterThan(0)
		expect(grad.rows).toBe(2)
		expect(grad.cols).toBe(3)
	})
})

describe("MSELoss", () => {
	it("computes MSE loss", () => {
		const lossFn = new MSELoss()
		const pred = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const target = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(0) // perfect prediction
	})

	it("non-zero loss for imperfect predictions", () => {
		const lossFn = new MSELoss()
		const pred = Tensor.from2D([
			[0, 0],
			[0, 0],
		])
		const target = Tensor.from2D([
			[1, 1],
			[1, 1],
		])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(1) // MSE = (1+1+1+1)/4 = 1
	})
})

describe("HuberLoss", () => {
	it("behaves like MSE for small errors", () => {
		const lossFn = new HuberLoss(1.0)
		const pred = Tensor.from2D([[0.5]])
		const target = Tensor.from2D([[0.6]])
		const { loss } = lossFn.forward(pred, target)
		// MSE region: 0.5 * (0.1)^2 = 0.005
		expect(loss).toBeCloseTo(0.005, 3)
	})

	it("behaves like MAE for large errors", () => {
		const lossFn = new HuberLoss(1.0)
		const pred = Tensor.from2D([[0]])
		const target = Tensor.from2D([[10]])
		const { loss } = lossFn.forward(pred, target)
		// MAE region: delta * (|diff| - 0.5 * delta) = 1 * (10 - 0.5) = 9.5
		expect(loss).toBeCloseTo(9.5, 1)
	})
})

describe("HingeLoss", () => {
	it("zero loss for correct classification", () => {
		const lossFn = new HingeLoss()
		const pred = Tensor.from2D([[2]])
		const target = Tensor.from2D([[1]])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(0)
	})

	it("positive loss for misclassification", () => {
		const lossFn = new HingeLoss()
		const pred = Tensor.from2D([[-2]])
		const target = Tensor.from2D([[1]])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeGreaterThan(0)
	})
})

describe("MAELoss", () => {
	it("computes MAE", () => {
		const lossFn = new MAELoss()
		const pred = Tensor.from2D([
			[1, 3],
			[5, 7],
		])
		const target = Tensor.from2D([
			[2, 4],
			[6, 8],
		])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(1) // |1-2|+|3-4|+|5-6|+|7-8| / 4 = 1
	})
})

describe("KLLoss", () => {
	it("zero loss for identical distributions", () => {
		const lossFn = new KLLoss()
		const pred = Tensor.from2D([[0.5, 0.5]])
		const target = Tensor.from2D([[0.5, 0.5]])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(0, 1)
	})
})

describe("CosineSimilarityLoss", () => {
	it("zero loss for identical vectors", () => {
		const lossFn = new CosineSimilarityLoss()
		const pred = Tensor.from2D([[1, 2, 3]])
		const target = Tensor.from2D([[1, 2, 3]])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeCloseTo(0, 2)
	})

	it("positive loss for orthogonal vectors", () => {
		const lossFn = new CosineSimilarityLoss()
		const pred = Tensor.from2D([[1, 0]])
		const target = Tensor.from2D([[0, 1]])
		const { loss } = lossFn.forward(pred, target)
		// cosine = 0, loss = 1 - 0 = 1
		expect(loss).toBeCloseTo(1, 1)
	})
})

describe("BCELoss", () => {
	it("computes binary cross-entropy", () => {
		const lossFn = new BCELoss()
		const pred = Tensor.from2D([[0.9]])
		const target = Tensor.from2D([[1]])
		const { loss } = lossFn.forward(pred, target)
		expect(loss).toBeGreaterThan(0)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Optimizer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("AdamOptimizer", () => {
	it("updates parameters", () => {
		const w = Tensor.random(2, 2, 0.1)
		const g = Tensor.ones(2, 2)
		const params = [{ tensor: w, grad: g, name: "W" }]
		const opt = new AdamOptimizer(params)
		const before = w.clone()
		opt.step(0.01)
		// Weights should have changed
		let changed = false
		for (let i = 0; i < w.data.length; i++) {
			if (w.data[i] !== before.data[i]) changed = true
		}
		expect(changed).toBe(true)
	})

	it("zeroGrad resets gradients", () => {
		const w = Tensor.random(2, 2, 0.1)
		const g = Tensor.ones(2, 2)
		const params = [{ tensor: w, grad: g, name: "W" }]
		const opt = new AdamOptimizer(params)
		opt.zeroGrad()
		for (let i = 0; i < g.data.length; i++) {
			expect(g.data[i]).toBe(0)
		}
	})
})

describe("SGDOptimizer", () => {
	it("updates parameters with momentum", () => {
		const w = Tensor.random(2, 2, 0.1)
		const g = Tensor.ones(2, 2)
		const params = [{ tensor: w, grad: g, name: "W" }]
		const opt = new SGDOptimizer(params, 0.9)
		const before = w.clone()
		opt.step(0.01)
		let changed = false
		for (let i = 0; i < w.data.length; i++) {
			if (w.data[i] !== before.data[i]) changed = true
		}
		expect(changed).toBe(true)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// NeuralNetwork Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("NeuralNetwork", () => {
	it("builds layers from config", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8, 6],
		})
		expect(nn.layers.length).toBeGreaterThan(0)
		expect(nn.summary()).toContain("Dense")
	})

	it("predict produces correct output shape", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 3,
			hiddenDims: [8],
		})
		const input = Tensor.random(5, 4, 0.1)
		const out = nn.predict(input)
		expect(out.rows).toBe(5)
		expect(out.cols).toBe(3)
	})

	it("forwardTraining and backward work together", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		const input = Tensor.random(3, 4, 0.1)
		const out = nn.forwardTraining(input)
		const outputGrad = Tensor.random(3, 2, 0.1)
		const inputGrad = nn.backward(outputGrad)
		expect(inputGrad.rows).toBe(3)
		expect(inputGrad.cols).toBe(4)
	})

	it("train loop runs without error", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		const X = Tensor.random(20, 4, 0.5)
		const y = Tensor.random(20, 2, 0.5)
		const lossFn = new MSELoss()
		const losses = nn.train(X, y, lossFn, {
			epochs: 5,
			batchSize: 4,
			learningRate: 0.01,
		})
		expect(losses.length).toBe(5)
		// Loss should generally decrease (not guaranteed but likely)
		expect(losses[0]).toBeGreaterThan(0)
	})

	it("train with validation split", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		const X = Tensor.random(20, 4, 0.5)
		const y = Tensor.random(20, 2, 0.5)
		const lossFn = new MSELoss()
		let epochCalled = false
		const losses = nn.train(X, y, lossFn, {
			epochs: 3,
			batchSize: 4,
			learningRate: 0.01,
			validationSplit: 0.2,
			onEpoch: (epoch, trainLoss, valLoss) => {
				epochCalled = true
				expect(valLoss).toBeDefined()
				return false
			},
		})
		expect(losses.length).toBe(3)
		expect(epochCalled).toBe(true)
	})

	it("serialise and deserialise round-trip", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		const weights = nn.serialise()
		expect(Array.isArray(weights)).toBe(true)
		expect(weights.length).toBe(nn.layers.length)

		// Create a new network and load weights
		const nn2 = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		nn2.deserialise(weights)

		// Both should produce same output
		const input = Tensor.random(3, 4, 0.1)
		const out1 = nn.predict(input)
		const out2 = nn2.predict(input)
		for (let i = 0; i < out1.data.length; i++) {
			expect(out1.data[i]).toBe(out2.data[i])
		}
	})

	it("step and zeroGrad work with lazy optimizer", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		// optimizer is null initially
		expect(nn.optimizer).toBeNull()
		// step creates optimizer lazily
		nn.step(0.01)
		expect(nn.optimizer).not.toBeNull()
		// zeroGrad also creates optimizer lazily
		const nn2 = new NeuralNetwork({
			inputDim: 4,
			outputDim: 1,
			hiddenDims: [4],
		})
		nn2.zeroGrad()
		expect(nn2.optimizer).not.toBeNull()
	})

	it("summary describes architecture", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8, 6],
			activation: "tanh",
			finalActivation: "sigmoid",
		})
		const summary = nn.summary()
		expect(summary).toContain("Dense")
		expect(summary).toContain("Tanh")
		expect(summary).toContain("Sigmoid")
	})

	it("supports dropout and batch norm config", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
			dropout: 0.3,
			useBatchNorm: true,
		})
		const summary = nn.summary()
		expect(summary).toContain("Dropout")
		expect(summary).toContain("BatchNorm")
	})

	it("deserialise with wrong shape throws", () => {
		const nn = new NeuralNetwork({
			inputDim: 4,
			outputDim: 2,
			hiddenDims: [8],
		})
		expect(() => nn.deserialise([[[]]])).toThrow()
	})
})
