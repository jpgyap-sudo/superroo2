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
	HuberLoss,
	HingeLoss,
	StepDecayScheduler,
	ExponentialDecayScheduler,
	ReduceLROnPlateau,
	Conv2D,
	MaxPool2D,
	Flatten,
	ModelCheckpoint,
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
		const dx = layer.backward(
			Tensor.from2D([
				[1, 1],
				[1, 1],
			]),
		)
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
		const y = Tensor.from2D([[0], [1], [1], [0]])

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

		const losses1 = nn.train(X, y, new MSELoss(), {
			epochs: 50,
			batchSize: 2,
			learningRate: 0.1,
		})

		const losses2 = nn.train(X, y, new MSELoss(), {
			epochs: 50,
			batchSize: 2,
			learningRate: 0.1,
		})

		const finalLoss1 = losses1[losses1.length - 1]
		const finalLoss2 = losses2[losses2.length - 1]
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

	it("SGDOptimizer with LR scheduler uses scheduled LR", () => {
		const w = Tensor.from2D([[1, 2]])
		const dw = Tensor.from2D([[0.5, 1]])
		const scheduler = new StepDecayScheduler({ initialLR: 0.1, stepSize: 5, dropFactor: 0.5 })
		const opt = new SGDOptimizer([{ tensor: w, grad: dw, name: "w" }], 0.9, scheduler)
		opt.step(0.1)
		expect(w.to2D()[0][0]).toBeLessThan(1)
	})

	it("AdamOptimizer with LR scheduler uses scheduled LR", () => {
		const w = Tensor.from2D([[1, 2]])
		const dw = Tensor.from2D([[0.5, 1]])
		const scheduler = new ExponentialDecayScheduler({ initialLR: 0.1, decayRate: 0.5 })
		const opt = new AdamOptimizer([{ tensor: w, grad: dw, name: "w" }], 0.9, 0.999, 1e-8, scheduler)
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

	it("HuberLoss computes correct value for small errors (MSE region)", () => {
		const loss = new HuberLoss(1.0)
		const pred = Tensor.from2D([[2], [4]])
		const target = Tensor.from2D([[1], [3]])
		const result = loss.forward(pred, target)
		// diff = 1, within delta=1, so 0.5 * 1^2 = 0.5 per element, avg = 0.5
		expect(result.loss).toBeCloseTo(0.5, 5)
	})

	it("HuberLoss computes correct value for large errors (MAE region)", () => {
		const loss = new HuberLoss(1.0)
		const pred = Tensor.from2D([[10]])
		const target = Tensor.from2D([[1]])
		const result = loss.forward(pred, target)
		// diff = 9 > delta=1, so delta * (|diff| - 0.5*delta) = 1 * (9 - 0.5) = 8.5
		expect(result.loss).toBeCloseTo(8.5, 5)
	})

	it("HuberLoss gradient is correct for large errors", () => {
		const loss = new HuberLoss(1.0)
		const pred = Tensor.from2D([[2.5]])
		const target = Tensor.from2D([[1.0]])
		const { grad } = loss.forward(pred, target)
		// diff = 1.5 > delta=1, so grad = delta * sign(diff) / n = 1 * 1 / 1 = 1
		expect(grad.to2D()[0][0]).toBeCloseTo(1, 5)
	})

	it("HingeLoss computes zero loss for correct predictions", () => {
		const loss = new HingeLoss()
		const pred = Tensor.from2D([[2]])
		const target = Tensor.from2D([[1]])
		expect(loss.forward(pred, target).loss).toBeCloseTo(0, 5)
	})

	it("HingeLoss computes positive loss for incorrect predictions", () => {
		const loss = new HingeLoss()
		const pred = Tensor.from2D([[-0.5]])
		const target = Tensor.from2D([[1]])
		expect(loss.forward(pred, target).loss).toBeCloseTo(1.5, 5)
	})

	it("HingeLoss gradient is zero for correct predictions", () => {
		const loss = new HingeLoss()
		const pred = Tensor.from2D([[2]])
		const target = Tensor.from2D([[1]])
		const { grad } = loss.forward(pred, target)
		expect(grad.to2D()[0][0]).toBe(0)
	})

	it("HingeLoss gradient is non-zero for incorrect predictions", () => {
		const loss = new HingeLoss()
		const pred = Tensor.from2D([[-0.5]])
		const target = Tensor.from2D([[1]])
		const { grad } = loss.forward(pred, target)
		// margin > 0 => grad = -t/n = -1/1 = -1
		expect(grad.to2D()[0][0]).toBeCloseTo(-1, 5)
	})
})

describe("Learning Rate Schedulers", () => {
	it("StepDecayScheduler drops LR at specified intervals", () => {
		const scheduler = new StepDecayScheduler({
			initialLR: 0.1,
			stepSize: 10,
			dropFactor: 0.1,
		})
		expect(scheduler.getLearningRate(0)).toBeCloseTo(0.1, 10)
		expect(scheduler.getLearningRate(9)).toBeCloseTo(0.1, 10)
		expect(scheduler.getLearningRate(10)).toBeCloseTo(0.01, 10)
		expect(scheduler.getLearningRate(19)).toBeCloseTo(0.01, 10)
		expect(scheduler.getLearningRate(20)).toBeCloseTo(0.001, 10)
	})

	it("StepDecayScheduler respects minLR", () => {
		const scheduler = new StepDecayScheduler({
			initialLR: 0.1,
			stepSize: 5,
			dropFactor: 0.1,
			minLR: 1e-4,
		})
		expect(scheduler.getLearningRate(15)).toBeCloseTo(0.0001, 10)
		expect(scheduler.getLearningRate(20)).toBeCloseTo(0.0001, 10)
	})

	it("ExponentialDecayScheduler decays LR exponentially", () => {
		const scheduler = new ExponentialDecayScheduler({
			initialLR: 0.1,
			decayRate: 0.5,
		})
		expect(scheduler.getLearningRate(0)).toBeCloseTo(0.1, 10)
		expect(scheduler.getLearningRate(1)).toBeCloseTo(0.05, 10)
		expect(scheduler.getLearningRate(2)).toBeCloseTo(0.025, 10)
		expect(scheduler.getLearningRate(3)).toBeCloseTo(0.0125, 10)
	})

	it("ExponentialDecayScheduler respects minLR", () => {
		const scheduler = new ExponentialDecayScheduler({
			initialLR: 0.1,
			decayRate: 0.1,
			minLR: 1e-5,
		})
		expect(scheduler.getLearningRate(5)).toBeCloseTo(1e-5, 10)
	})

	it("ReduceLROnPlateau reduces LR when loss plateaus", () => {
		const scheduler = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 3,
			threshold: 1e-4,
		})
		expect(scheduler.getLearningRate(0)).toBeCloseTo(0.1, 10)

		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(1.0)
		const newLR = scheduler.onPlateauEnd(1.0)
		expect(newLR).toBeCloseTo(0.05, 10)
	})

	it("ReduceLROnPlateau does not reduce LR when loss improves", () => {
		const scheduler = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 3,
			threshold: 1e-4,
		})
		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(0.9)
		scheduler.onPlateauEnd(0.8)
		scheduler.onPlateauEnd(0.7)
		expect(scheduler.getLearningRate(0)).toBeCloseTo(0.1, 10)
	})

	it("ReduceLROnPlateau respects cooldown", () => {
		const scheduler = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 2,
			cooldown: 2,
		})
		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(1.0)
		const lr1 = scheduler.onPlateauEnd(1.0)
		expect(lr1).toBeCloseTo(0.05, 10)

		const lr2 = scheduler.onPlateauEnd(1.0)
		expect(lr2).toBeCloseTo(0.05, 10)
		const lr3 = scheduler.onPlateauEnd(1.0)
		expect(lr3).toBeCloseTo(0.05, 10)
	})

	it("ReduceLROnPlateau reset restores initial state", () => {
		const scheduler = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 2,
		})
		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(1.0)
		scheduler.onPlateauEnd(1.0)
		scheduler.reset()
		expect(scheduler.getLearningRate(0)).toBeCloseTo(0.1, 10)
	})
})

describe("ModelCheckpoint", () => {
	const testDir = "__test_checkpoints__"

	afterEach(async () => {
		try {
			const fs = await import("node:fs/promises")
			await fs.rm(testDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("saves and loads weights", async () => {
		const layer = new DenseLayer(2, 3)
		const checkpoint = new ModelCheckpoint({ dir: testDir, name: "test_model" })

		layer.weights.data.fill(0.5)
		layer.biases.data.fill(0.1)

		await checkpoint.save([layer])

		layer.weights.data.fill(0)
		layer.biases.data.fill(0)

		const result = await checkpoint.load([layer])
		expect(result).not.toBeNull()
		expect(result!.version).toBe(2)
		expect(Array.from(layer.weights.data)).toEqual(Array(6).fill(0.5))
		expect(Array.from(layer.biases.data)).toEqual(Array(3).fill(0.1))
	})

	it("load returns null for non-existent file", async () => {
		const layer = new DenseLayer(2, 3)
		const checkpoint = new ModelCheckpoint({ dir: testDir, name: "nonexistent" })
		const result = await checkpoint.load([layer])
		expect(result).toBeNull()
	})

	it("saveBestOnly saves only when validation loss improves", async () => {
		const layer = new DenseLayer(2, 3)
		const checkpoint = new ModelCheckpoint({
			dir: testDir,
			name: "best_test",
			saveBestOnly: true,
			improvementThreshold: 0.01,
		})

		layer.weights.data.fill(0.5)
		const saved1 = await checkpoint.saveWithValidation([layer], 1.0)
		expect(saved1).toBe(true)

		layer.weights.data.fill(0.3)
		const saved2 = await checkpoint.saveWithValidation([layer], 1.5)
		expect(saved2).toBe(false)

		layer.weights.data.fill(0.7)
		const saved3 = await checkpoint.saveWithValidation([layer], 0.5)
		expect(saved3).toBe(true)
	})

	it("clear removes checkpoint files", async () => {
		const layer = new DenseLayer(2, 3)
		const checkpoint = new ModelCheckpoint({ dir: testDir, name: "clear_test" })
		await checkpoint.save([layer])
		await checkpoint.clear()
		const result = await checkpoint.load([layer])
		expect(result).toBeNull()
	})
})

describe("Conv2D Layer", () => {
	it("forward produces correct output shape", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 0,
		})

		const x = Tensor.from2D([
			Array.from({ length: 25 }, (_, i) => i + 1),
			Array.from({ length: 25 }, (_, i) => i + 1),
		])

		const out = conv.forward(x)
		expect(out.rows).toBe(2)
		expect(out.cols).toBe(2 * 3 * 3)
	})

	it("forward with padding produces larger output", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 1,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 1,
		})

		const x = Tensor.from2D([Array.from({ length: 25 }, (_, i) => i + 1)])

		const out = conv.forward(x)
		expect(out.cols).toBe(1 * 5 * 5)
	})

	it("backward returns correct gradient shape", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 0,
		})

		const x = Tensor.from2D([Array.from({ length: 25 }, (_, i) => i + 1)])

		const out = conv.forward(x)
		const dInput = conv.backward(out)
		expect(dInput.rows).toBe(1)
		expect(dInput.cols).toBe(25)
	})

	it("parameters returns weight and bias", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
		})
		const params = conv.parameters()
		expect(params.length).toBe(2)
		expect(params[0].name).toBe("W")
		expect(params[1].name).toBe("b")
	})

	it("describe returns informative string", () => {
		const conv = new Conv2D({
			inChannels: 3,
			outChannels: 16,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 32,
			inputWidth: 32,
			stride: 2,
			padding: 1,
		})
		expect(conv.describe()).toContain("Conv2D")
		expect(conv.describe()).toContain("3→16")
		expect(conv.describe()).toContain("3×3")
	})
})

describe("MaxPool2D Layer", () => {
	it("forward reduces spatial dimensions", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			inputHeight: 4,
			inputWidth: 4,
			channels: 1,
		})

		const x = Tensor.from2D([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]])

		const out = pool.forward(x)
		// 4x4 with 2x2 pool, stride 2 => 2x2 output
		expect(out.rows).toBe(1)
		expect(out.cols).toBe(1 * 2 * 2)
	})

	it("backward returns correct gradient shape", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			inputHeight: 4,
			inputWidth: 4,
			channels: 1,
		})

		const x = Tensor.from2D([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]])

		const out = pool.forward(x)
		const dInput = pool.backward(out)
		expect(dInput.rows).toBe(1)
		expect(dInput.cols).toBe(16)
	})

	it("parameters returns empty array", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			inputHeight: 4,
			inputWidth: 4,
			channels: 1,
		})
		expect(pool.parameters()).toEqual([])
	})
})

describe("Flatten Layer", () => {
	it("forward preserves data", () => {
		const flatten = new Flatten({ channels: 2, height: 3, width: 3 })
		const x = Tensor.from2D([Array.from({ length: 18 }, (_, i) => i + 1)])

		const out = flatten.forward(x)
		expect(out.rows).toBe(1)
		expect(out.cols).toBe(18)
		expect(Array.from(out.data)).toEqual(Array.from(x.data))
	})

	it("backward passes gradient through unchanged", () => {
		const flatten = new Flatten({ channels: 2, height: 3, width: 3 })
		const x = Tensor.from2D([Array.from({ length: 18 }, (_, i) => i + 1)])

		flatten.forward(x)
		const grad = Tensor.from2D([Array.from({ length: 18 }, (_, i) => i * 2)])
		const dInput = flatten.backward(grad)
		expect(Array.from(dInput.data)).toEqual(Array.from(grad.data))
	})

	it("parameters returns empty array", () => {
		const flatten = new Flatten({ channels: 2, height: 3, width: 3 })
		expect(flatten.parameters()).toEqual([])
	})

	it("describe returns informative string", () => {
		const flatten = new Flatten({ channels: 3, height: 32, width: 32 })
		expect(flatten.describe()).toContain("Flatten")
		expect(flatten.describe()).toContain("3×32×32")
	})
})
