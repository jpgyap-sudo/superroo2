import {
	Tensor,
	DenseLayer,
	ReLULayer,
	SigmoidLayer,
	TanhLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	NeuralNetwork,
	SGDOptimizer,
	AdamOptimizer,
	MSELoss,
	CrossEntropyLoss,
} from "../../ml/engine"

describe("Tensor", () => {
	it("creates zeros tensor", () => {
		const t = new Tensor(2, 3)
		expect(t.rows).toBe(2)
		expect(t.cols).toBe(3)
		expect(t.data.every((v) => v === 0)).toBe(true)
	})

	it("creates from 2D array", () => {
		const t = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		expect(t.rows).toBe(2)
		expect(t.cols).toBe(2)
		expect(Array.from(t.data)).toEqual([1, 2, 3, 4])
	})

	it("adds element-wise", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const b = Tensor.from2D([
			[1, 1],
			[1, 1],
		])
		const c = a.add(b)
		expect(c.to2D()).toEqual([
			[2, 3],
			[4, 5],
		])
	})

	it("adds scalar", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const c = a.add(2)
		expect(c.to2D()).toEqual([
			[3, 4],
			[5, 6],
		])
	})

	it("multiplies element-wise", () => {
		const a = Tensor.from2D([
			[2, 3],
			[4, 5],
		])
		const b = Tensor.from2D([
			[2, 2],
			[2, 2],
		])
		const c = a.mul(b)
		expect(c.to2D()).toEqual([
			[4, 6],
			[8, 10],
		])
	})

	it("divides by tensor with broadcasting", () => {
		const a = Tensor.from2D([
			[4, 6],
			[8, 10],
		])
		const b = Tensor.from2D([[2]])
		const c = a.div(b)
		expect(c.to2D()).toEqual([
			[2, 3],
			[4, 5],
		])
	})

	it("transposes", () => {
		const a = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const c = a.transpose()
		expect(c.rows).toBe(3)
		expect(c.cols).toBe(2)
		expect(c.to2D()).toEqual([
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
			[2, 0],
			[1, 2],
		])
		const c = a.matmul(b)
		expect(c.to2D()).toEqual([
			[4, 4],
			[10, 8],
		])
	})

	it("sums along axis 1", () => {
		const a = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const c = a.sum(1)
		expect(c.rows).toBe(2)
		expect(c.cols).toBe(1)
		expect(c.to2D()).toEqual([[6], [15]])
	})

	it("computes mean along axis 0", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
			[5, 6],
		])
		const c = a.mean(0)
		expect(c.rows).toBe(1)
		expect(c.cols).toBe(2)
		expect(c.to2D()[0][0]).toBeCloseTo(3)
		expect(c.to2D()[0][1]).toBeCloseTo(4)
	})

	it("argmax along axis 1", () => {
		const a = Tensor.from2D([
			[0.1, 0.9],
			[0.8, 0.2],
		])
		expect(a.argmax(1)).toEqual([1, 0])
	})

	it("sliceRows returns correct subset", () => {
		const a = Tensor.from2D([
			[1, 2],
			[3, 4],
			[5, 6],
		])
		const b = a.sliceRows(1, 3)
		expect(b.rows).toBe(2)
		expect(b.to2D()).toEqual([
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

	it("ReLULayer blocks gradient at x=0", () => {
		const layer = new ReLULayer()
		const x = Tensor.from2D([[0, -1, 1]])
		layer.forward(x)
		const dx = layer.backward(Tensor.from2D([[1, 1, 1]]))
		expect(dx.to2D()[0]).toEqual([0, 0, 1])
	})

	it("SigmoidLayer outputs in (0,1)", () => {
		const layer = new SigmoidLayer()
		const x = Tensor.from2D([
			[0, 10],
			[-10, 5],
		])
		const out = layer.forward(x)
		const vals = out.to2D().flat()
		expect(vals.every((v) => v > 0 && v < 1)).toBe(true)
	})

	it("TanhLayer outputs in (-1,1)", () => {
		const layer = new TanhLayer()
		const x = Tensor.from2D([
			[0, 10],
			[-10, 5],
		])
		const out = layer.forward(x)
		const vals = out.to2D().flat()
		expect(vals.every((v) => v > -1 && v < 1)).toBe(true)
	})

	it("SoftmaxLayer sums to 1 per row", () => {
		const layer = new SoftmaxLayer()
		const x = Tensor.from2D([
			[1, 2, 3],
			[0.1, 0.9, 0.0],
		])
		const out = layer.forward(x)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(3)
		const rows = out.to2D()
		expect(rows[0].reduce((a, b) => a + b)).toBeCloseTo(1)
		expect(rows[1].reduce((a, b) => a + b)).toBeCloseTo(1)
	})

	it("SoftmaxLayer backward applies the softmax Jacobian", () => {
		const layer = new SoftmaxLayer()
		layer.forward(Tensor.from2D([[1, 2, 3]]))
		const dx = layer.backward(Tensor.from2D([[0.1, -0.2, 0.3]]))
		const vals = dx.to2D()[0]
		expect(vals.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 8)
		expect(vals).not.toEqual([0.1, -0.2, 0.3])
	})

	it("DropoutLayer zeros some values at training", () => {
		const layer = new DropoutLayer(0.5)
		const x = Tensor.from2D([Array.from({ length: 100 }, (_, i) => i + 1)])
		const out = layer.forward(x)
		expect(out.to2D()[0].some((v) => v === 0)).toBe(true)
	})

	it("BatchNormLayer forward shape", () => {
		const layer = new BatchNormLayer(3)
		const x = Tensor.from2D([
			[1, 2, 3],
			[4, 5, 6],
		])
		const out = layer.forward(x)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(3)
	})
})

describe("NeuralNetwork", () => {
	it("trains XOR-like pattern", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [8],
			activation: "tanh",
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
			epochs: 1000,
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

	it("optimizer persists across train calls", () => {
		const nn = new NeuralNetwork({
			inputDim: 2,
			outputDim: 1,
			hiddenDims: [2],
			activation: "relu",
			finalActivation: "sigmoid",
			useBatchNorm: false,
		})

		const X = Tensor.from2D([
			[0, 0],
			[1, 1],
		])
		const y = Tensor.from2D([[0], [1]])

		// First train call should create the optimizer and train
		const losses1 = nn.train(X, y, new MSELoss(), {
			epochs: 50,
			batchSize: 2,
			learningRate: 0.1,
		})

		// Second train call should continue with the same optimizer state
		const losses2 = nn.train(X, y, new MSELoss(), {
			epochs: 50,
			batchSize: 2,
			learningRate: 0.1,
		})

		// Continuing training should reduce loss further or maintain low loss
		const finalLoss1 = losses1[losses1.length - 1]
		const finalLoss2 = losses2[losses2.length - 1]
		// Loss should not spike (which would happen if optimizer state was reset)
		expect(finalLoss2).toBeLessThan(finalLoss1 * 2)
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

	it("CrossEntropyLoss returns probability-space gradient", () => {
		const loss = new CrossEntropyLoss()
		const pred = Tensor.from2D([
			[0.9, 0.1],
			[0.1, 0.9],
		])
		const target = Tensor.from2D([
			[1, 0],
			[0, 1],
		])
		const { grad } = loss.forward(pred, target)
		expect(grad.to2D()[0][0]).toBeCloseTo(-1 / 0.9 / 2)
		expect(grad.to2D()[0][1]).toBe(0)
		expect(grad.to2D()[1][0]).toBe(0)
		expect(grad.to2D()[1][1]).toBeCloseTo(-1 / 0.9 / 2)
	})
})
