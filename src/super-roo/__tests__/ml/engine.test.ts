import { describe, expect, it } from "vitest"

import { Tensor } from "../../ml/engine/Tensor"
import { DenseLayer, ReLULayer, SigmoidLayer, TanhLayer, SoftmaxLayer, DropoutLayer, BatchNormLayer } from "../../ml/engine/Layer"
import { NeuralNetwork } from "../../ml/engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../../ml/engine/Loss"
import { AdamOptimizer, SGDOptimizer } from "../../ml/engine/Optimizer"

describe("Tensor", () => {
	it("creates zeros tensor", () => {
		const t = new Tensor(2, 3)
		expect(t.rows).toBe(2)
		expect(t.cols).toBe(3)
		expect(t.to2D()).toEqual([
			[0, 0, 0],
			[0, 0, 0],
		])
	})

	it("creates from 2D array", () => {
		const t = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		expect(t.to2D()).toEqual([
			[1, 2],
			[3, 4],
		])
	})

	it("adds element-wise", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const b = Tensor.from2D([
			[5, 6],
			[7, 8],
		])
		expect(a.add(b).to2D()).toEqual([
			[6, 8],
			[10, 12],
		])
	})

	it("adds scalar", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		expect(a.add(10).to2D()).toEqual([
			[11, 12],
			[13, 14],
		])
	})

	it("multiplies element-wise", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const b = Tensor.from2D([
			[2, 3],
			[4, 5],
		])
		expect(a.mul(b).to2D()).toEqual([
			[2, 6],
			[12, 20],
		])
	})

	it("divides by tensor with broadcasting", () => {
		const a = Tensor.from2D([
			[10, 20],
			[30, 40],
		])
		const b = Tensor.from2D([[2, 4]])
		expect(a.div(b).to2D()).toEqual([
			[5, 5],
			[15, 10],
		])
	})

	it("transposes", () => {
		const a = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		expect(a.transpose().to2D()).toEqual([
			[1, 4],
			[2, 5],
			[3, 6],
		])
	})

	it("matrix multiplies", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const b = Tensor.from2D([
			[5, 6],
			[7, 8],
		])
		expect(a.matmul(b).to2D()).toEqual([
			[19, 22],
			[43, 50],
		])
	})

	it("sums along axis 1", () => {
		const a = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		expect(a.sum(1).to2D()).toEqual([[6], [15]])
	})

	it("computes mean along axis 0", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		expect(a.mean(0).to2D()).toEqual([[2, 3]])
	})

	it("argmax along axis 1", () => {
		const a = Tensor.from2D([
			[1, 5, 2],
			[7, 3, 4],
		])
		expect(a.argmax(1)).toEqual([1, 0])
	})

	it("sliceRows returns correct subset", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
			[5, 6],
		])
		expect(a.sliceRows(1, 3).to2D()).toEqual([
			[3, 4],
			[5, 6],
		])
	})
})

describe("Layers", () => {
	it("DenseLayer forward/backward", () => {
		const layer = new DenseLayer(2, 3)
		const x = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const out = layer.forward(x)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(3)
		const dx = layer.backward(out)
		expect(dx.rows).toBe(2)
		expect(dx.cols).toBe(2)
	})

	it("ReLULayer clips negatives", () => {
		const layer = new ReLULayer()
		const x = Tensor.from2D([
			[-1, 2],
			[3, -4],
		])
		const out = layer.forward(x)
		expect(out.to2D()).toEqual([
			[0, 2],
			[3, 0],
		])
		const dx = layer.backward(Tensor.from2D([
			[1, 1],
			[1, 1],
		]))
		expect(dx.to2D()).toEqual([
			[0, 1],
			[1, 0],
		])
	})

	it("SigmoidLayer outputs in (0,1)", () => {
		const layer = new SigmoidLayer()
		const x = Tensor.from2D([
			[0, 10],
			[-10, 1],
		])
		const out = layer.forward(x)
		const d = out.to2D()
		expect(d[0][0]).toBeCloseTo(0.5, 2)
		expect(d[0][1]).toBeGreaterThan(0.99)
		expect(d[1][0]).toBeLessThan(0.01)
		expect(d[1][1]).toBeGreaterThan(0.7)
	})

	it("TanhLayer outputs in (-1,1)", () => {
		const layer = new TanhLayer()
		const x = Tensor.from2D([
			[0, 5],
			[-5, 1],
		])
		const out = layer.forward(x)
		const d = out.to2D()
		expect(d[0][0]).toBeCloseTo(0, 3)
		expect(d[0][1]).toBeGreaterThan(0.99)
		expect(d[1][0]).toBeLessThan(-0.99)
		expect(d[1][1]).toBeGreaterThan(0.7)
	})

	it("SoftmaxLayer sums to 1 per row", () => {
		const layer = new SoftmaxLayer()
		const x = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const out = layer.forward(x)
		const d = out.to2D()
		expect(d[0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
		expect(d[1].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
	})

	it("DropoutLayer zeros some values at training", () => {
		const layer = new DropoutLayer(0.5)
		const x = Tensor.from2D([
			[1, 1, 1],
			[1, 1, 1],
		])
		// At training time some values should be zero
		let zeroCount = 0
		for (let i = 0; i < 20; i++) {
			const out = layer.forward(x)
			zeroCount += out.to2D().flat().filter((v) => v === 0).length
		}
		expect(zeroCount).toBeGreaterThan(0)
	})

	it("BatchNormLayer forward shape", () => {
		const layer = new BatchNormLayer(3)
		const x = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
			[7, 8, 9],
		])
		const out = layer.forward(x)
		expect(out.rows).toBe(3)
		expect(out.cols).toBe(3)
	})
})

describe("NeuralNetwork", () => {
	it("trains XOR-like pattern", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [4],
			activation: "relu",
			finalActivation: "sigmoid",
			useBatchNorm: false,
		})

		const X = Tensor.from2D([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		])
		const y = Tensor.from2D([
			[0],
			[1],
			[1],
			[0],
		])

		const losses = nn.train(X, y, new MSELoss(), {
			epochs: 500,
			batchSize: 4,
			learningRate: 0.1,
		})

		const finalLoss = losses[losses.length - 1]
		expect(finalLoss).toBeLessThan(0.1)

		const preds = nn.predict(X)
		const predVals = preds.to2D().flat()
		expect(predVals[0]).toBeLessThan(0.3)
		expect(predVals[1]).toBeGreaterThan(0.7)
		expect(predVals[2]).toBeGreaterThan(0.7)
		expect(predVals[3]).toBeLessThan(0.3)
	})

	it("classifies simple OR pattern", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 2,
			hiddenDims: [4],
			activation: "relu",
			finalActivation: "softmax",
			useBatchNorm: false,
		})

		const X = Tensor.from2D([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		])
		const y = Tensor.from2D([
			[1, 0],
			[0, 1],
			[0, 1],
			[0, 1],
		])

		const losses = nn.train(X, y, new CrossEntropyLoss(), {
			epochs: 300,
			batchSize: 4,
			learningRate: 0.1,
		})

		expect(losses[losses.length - 1]).toBeLessThan(0.2)
		const argmax = nn.predict(X).argmax(1)
		expect(argmax).toEqual([0, 1, 1, 1])
	})

	it("predict returns correct shape", () => {
		const nn = new NeuralNetwork({
			inputDim: 3,
			outputDim: 2,
			hiddenDims: [5],
			activation: "relu",
			finalActivation: "softmax",
		})
		const x = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const out = nn.predict(x)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(2)
	})
})

describe("Optimizers", () => {
	it("SGDOptimizer updates params", () => {
		const w = Tensor.from2D([[1, 2]])
		const dw = Tensor.from2D([[0.5, 1]])
		const opt = new SGDOptimizer([{ tensor: w, grad: dw, name: "w" }])
		opt.step(0.1)
		expect(w.to2D()[0][0]).toBeCloseTo(0.95, 5)
		expect(w.to2D()[0][1]).toBeCloseTo(1.9, 5)
	})

	it("AdamOptimizer updates params", () => {
		const w = Tensor.from2D([[1, 2]])
		const dw = Tensor.from2D([[0.5, 1]])
		const opt = new AdamOptimizer([{ tensor: w, grad: dw, name: "w" }])
		opt.step(0.1)
		expect(w.to2D()[0][0]).not.toBe(1)
		expect(w.to2D()[0][1]).not.toBe(2)
	})
})

describe("Losses", () => {
	it("MSELoss computes correct value", () => {
		const loss = new MSELoss()
		const pred = Tensor.from2D([[2], [4]])
		const target = Tensor.from2D([[1], [3]])
		expect(loss.forward(pred, target).loss).toBeCloseTo(1, 5)
	})

	it("MSELoss grad shape", () => {
		const loss = new MSELoss()
		const pred = Tensor.from2D([[2], [4]])
		const target = Tensor.from2D([[1], [3]])
		const { grad } = loss.forward(pred, target)
		expect(grad.rows).toBe(2)
		expect(grad.cols).toBe(1)
	})

	it("CrossEntropyLoss computes correct value", () => {
		const loss = new CrossEntropyLoss()
		const pred = Tensor.from2D([
			[0.9, 0.1],
			[0.1, 0.9],
		])
		const target = Tensor.from2D([
			[1, 0],
			[0, 1],
		])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeLessThan(1)
		expect(l).toBeGreaterThan(0)
	})
})
