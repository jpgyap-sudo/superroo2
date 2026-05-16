# SuperRoo ML Engine API

> **Module**: [`src/super-roo/ml/`](src/super-roo/ml/)  
> **Engine**: [`src/super-roo/ml/engine/`](src/super-roo/ml/engine/)  
> **Learning**: [`src/super-roo/ml/learning/`](src/super-roo/ml/learning/)  
> **Improvement Loop**: [`src/super-roo/ml/loop/`](src/super-roo/ml/loop/)

The SuperRoo ML Engine is a lightweight, zero-dependency neural network framework built entirely in TypeScript. It provides tensor operations, a full layer library, optimizers with learning rate scheduling, loss functions, model checkpointing, and evaluation metrics — all running in-process with no Python or GPU dependencies.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tensor API](#tensor-api)
3. [Layer Types](#layer-types)
4. [Optimizers](#optimizers)
5. [Learning Rate Schedulers](#learning-rate-schedulers)
6. [Loss Functions](#loss-functions)
7. [Neural Network Builder](#neural-network-builder)
8. [Model Checkpointing & Serialization](#model-checkpointing--serialization)
9. [Evaluation Metrics](#evaluation-metrics)
10. [Example: XOR Classifier](#example-training-a-simple-xor-classifier)
11. [Example: ConvNet for Image Classification](#example-training-a-convnet-for-image-classification)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    NeuralNetwork                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Dense    │→ │ ReLU     │→ │ Dropout  │→ │ Softmax  │ │
│  │ (weights)│  │ (no params)│ │ (mask)   │  │ (no params)│ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│                        │                                  │
│         ┌──────────────┴──────────────┐                   │
│         ▼                             ▼                   │
│   AdamOptimizer                 Loss Function             │
│   (momentum, LR sched)          (MSE, CrossEntropy, etc)  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
   ModelCheckpoint ──► JSON files (atomic writes)
```

The engine is organized into these key modules:

| Module                                                               | File                  | Purpose                                                                   |
| -------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| [`Tensor`](src/super-roo/ml/engine/Tensor.ts)                        | `Tensor.ts`           | 2-D tensor with ops (add, matmul, transpose, etc.)                        |
| [`Layer`](src/super-roo/ml/engine/Layer.ts)                          | `Layer.ts`            | Layer interface + Dense, ReLU, Sigmoid, Tanh, Softmax, Dropout, BatchNorm |
| [`Conv2D/MaxPool2D/Flatten`](src/super-roo/ml/engine/layers/conv.ts) | `layers/conv.ts`      | Convolutional layers with im2col                                          |
| [`Optimizer`](src/super-roo/ml/engine/Optimizer.ts)                  | `Optimizer.ts`        | Adam + SGD optimizers with LR scheduler integration                       |
| [`LRScheduler`](src/super-roo/ml/engine/LRScheduler.ts)              | `LRScheduler.ts`      | StepDecay, ExponentialDecay, ReduceLROnPlateau                            |
| [`Loss`](src/super-roo/ml/engine/Loss.ts)                            | `Loss.ts`             | MSE, CrossEntropy, Huber, Hinge, BCE                                      |
| [`NeuralNetwork`](src/super-roo/ml/engine/NeuralNetwork.ts)          | `NeuralNetwork.ts`    | Sequential model builder with train/predict                               |
| [`Metrics`](src/super-roo/ml/engine/Metrics.ts)                      | `Metrics.ts`          | Accuracy, precision, recall, F1, confusion matrix, regression metrics     |
| [`ModelPersistence`](src/super-roo/ml/engine/ModelPersistence.ts)    | `ModelPersistence.ts` | Full learner state persistence                                            |
| [`ModelCheckpoint`](src/super-roo/ml/engine/checkpoint.ts)           | `checkpoint.ts`       | Training checkpoint save/load with atomic writes                          |

---

## Tensor API

The [`Tensor`](src/super-roo/ml/engine/Tensor.ts) class is a 2-D matrix backed by `Float64Array`. All operations return new tensors (immutable style) unless suffixed with `InPlace`.

### Construction

```typescript
import { Tensor } from "../ml/engine"

// Factory methods
const z = Tensor.zeros(3, 4) // 3×4 matrix of zeros
const o = Tensor.ones(2, 5) // 2×5 matrix of ones
const r = Tensor.random(4, 3, 0.1) // 4×3 with uniform random values in [-0.1, 0.1]
const f = Tensor.from2D([
	[1, 2],
	[3, 4],
]) // From 2D array
const v = Tensor.from1D([1, 2, 3]) // Row vector (1×3)

// Constructor with initialization strategy
const t = new Tensor(3, 3, "xavier") // Xavier initialization
const t2 = new Tensor(3, 3, "he") // He initialization
const t3 = new Tensor(3, 3, "zeros") // Default: zeros
```

### Element Access

```typescript
t.get(row, col) // Get value at (row, col)
t.set(row, col, val) // Set value at (row, col)
t.shape() // Returns [rows, cols]
t.clone() // Deep copy
```

### Arithmetic Operations

All support broadcasting with scalars and row vectors.

```typescript
const a = Tensor.random(3, 3)
const b = Tensor.random(3, 3)

a.add(b) // Element-wise addition
a.sub(b) // Element-wise subtraction
a.mul(b) // Element-wise multiplication
a.div(b) // Element-wise division
a.add(0.5) // Scalar addition (broadcast)
a.mul(2.0) // Scalar multiplication
```

### Linear Algebra

```typescript
const a = Tensor.random(3, 4)
const b = Tensor.random(4, 2)

a.matmul(b) // Matrix product: [3×4] × [4×2] → [3×2]
a.transpose() // Transpose: [3×4] → [4×3]
```

### Reduction & Slicing

```typescript
const t = Tensor.random(4, 5)

t.sum(0) // Sum along rows (axis=0) → [1×5] row vector
t.sum(1) // Sum along cols (axis=1) → [4×1] column vector
t.mean(0) // Mean along rows
t.mean(1) // Mean along cols
t.sliceRows(0, 2) // Rows [0, 2) → [2×5] tensor
```

### In-Place Operations

```typescript
t.addInPlace(other) // Modifies t in-place (avoids allocation)
```

---

## Layer Types

All layers implement the [`Layer`](src/super-roo/ml/engine/Layer.ts) interface:

```typescript
interface Layer {
	forward(input: Tensor): Tensor
	backward(outputGrad: Tensor): Tensor
	parameters(): LayerParameter[]
	describe(): string
}
```

### Dense (Fully-Connected)

```typescript
import { DenseLayer } from "../ml/engine"

// Dense(inFeatures, outFeatures, init?)
const layer = new DenseLayer(128, 64, "xavier")
// init: "xavier" (default) or "he"
```

- Weights: `[inFeatures × outFeatures]`
- Biases: `[1 × outFeatures]`
- Forward: `output = input · W + b`
- Xavier init for tanh/softmax, He init for ReLU

### ReLU

```typescript
import { ReLULayer } from "../ml/engine"

const layer = new ReLULayer()
// No trainable parameters
// Forward: max(0, x)
// Backward: passes gradient where x > 0
```

### Sigmoid

```typescript
import { SigmoidLayer } from "../ml/engine"

const layer = new SigmoidLayer()
// Forward: 1 / (1 + exp(-x))
// Backward: sigmoid(x) * (1 - sigmoid(x))
```

### Tanh

```typescript
import { TanhLayer } from "../ml/engine"

const layer = new TanhLayer()
// Forward: tanh(x)
// Backward: 1 - tanh²(x)
```

### Softmax

```typescript
import { SoftmaxLayer } from "../ml/engine"

const layer = new SoftmaxLayer()
// Forward: exp(x_i - max) / sum(exp(x_j - max))
// Numerically stable (subtracts max before exp)
```

### Dropout

```typescript
import { DropoutLayer } from "../ml/engine"

const layer = new DropoutLayer(0.5) // 50% dropout rate
// Training: randomly zeros fraction of neurons, scales by 1/(1-rate)
// Inference: identity (no dropout)
```

### BatchNorm

```typescript
import { BatchNormLayer } from "../ml/engine"

const layer = new BatchNormLayer(64) // 64 features
// Normalizes activations: gamma * (x - mean) / sqrt(var + eps) + beta
// Learnable parameters: gamma (scale), beta (shift)
```

### Conv2D

```typescript
import { Conv2D } from "../ml/engine"

const layer = new Conv2D({
	inChannels: 3,
	outChannels: 16,
	kernelHeight: 3,
	kernelWidth: 3,
	inputHeight: 32,
	inputWidth: 32,
	stride: 1,
	padding: 0,
})
```

- Uses im2col internally for efficient matrix multiplication
- Weights: `[outChannels × inChannels * KH * KW]`
- Biases: `[1 × outChannels]`
- He init for weights

### MaxPool2D

```typescript
import { MaxPool2D } from "../ml/engine"

const layer = new MaxPool2D({
	inChannels: 16,
	inputHeight: 30,
	inputWidth: 30,
	poolHeight: 2,
	poolWidth: 2,
	stride: 2,
})
```

- Forward: takes max over pooling window
- Backward: routes gradient to the winning neuron only
- No trainable parameters

### Flatten

```typescript
import { Flatten } from "../ml/engine"

const layer = new Flatten()
// Reshapes [N, C*H*W] → [N, C*H*W] (identity, used as marker)
```

---

## Optimizers

### Adam (Adaptive Moment Estimation)

```typescript
import { AdamOptimizer } from "../ml/engine"

const params = layer.parameters() // Array of { tensor, grad, name }
const opt = new AdamOptimizer(
	params,
	0.9, // beta1 (default: 0.9)
	0.999, // beta2 (default: 0.999)
	1e-8, // eps (default: 1e-8)
	scheduler, // optional LRScheduler
)

opt.step(0.001) // One optimization step
opt.zeroGrad() // Zero out gradients
```

Adam maintains per-parameter momentum (`m`) and velocity (`v`) buffers with bias correction.

### SGD with Momentum

```typescript
import { SGDOptimizer } from "../ml/engine"

const opt = new SGDOptimizer(
	params,
	0.9, // momentum (default: 0.9)
	scheduler, // optional LRScheduler
)

opt.step(0.01)
opt.zeroGrad()
```

### Optimizer State Serialization

```typescript
import { captureAdamOptimizerState, restoreOptimizerState } from "../ml/engine"

// Capture state for checkpointing
const state = captureAdamOptimizerState(opt)

// Restore from checkpoint
restoreOptimizerState(opt, state)
```

---

## Learning Rate Schedulers

All schedulers implement [`LRScheduler`](src/super-roo/ml/engine/LRScheduler.ts):

```typescript
interface LRScheduler {
	getLearningRate(epoch: number): number
	reset(): void
}
```

### StepDecay

Drops LR by a factor every N epochs.

```typescript
import { StepDecayScheduler } from "../ml/engine"

const scheduler = new StepDecayScheduler({
	initialLR: 0.01,
	dropFactor: 0.1, // Multiply LR by 0.1 at each drop
	stepSize: 10, // Drop every 10 epochs
	minLR: 1e-8, // Floor
})
```

### ExponentialDecay

```typescript
import { ExponentialDecayScheduler } from "../ml/engine"

const scheduler = new ExponentialDecayScheduler({
	initialLR: 0.01,
	decayRate: 0.95, // LR *= 0.95 each epoch
	minLR: 1e-8,
})
```

### ReduceLROnPlateau

Reduces LR when validation loss stops improving.

```typescript
import { ReduceLROnPlateau } from "../ml/engine"

const scheduler = new ReduceLROnPlateau({
	initialLR: 0.01,
	factor: 0.1, // Multiply LR by 0.1 on plateau
	patience: 5, // Wait 5 epochs before reducing
	threshold: 1e-4, // Minimum improvement to count
	minLR: 1e-8,
	cooldown: 2, // Epochs to wait after reduction
})

// After each validation epoch:
scheduler.onPlateauEnd(valLoss)
```

---

## Loss Functions

All loss functions implement [`LossFn`](src/super-roo/ml/engine/Loss.ts):

```typescript
interface LossFn {
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor }
}
```

| Loss                 | Class                                                 | Use Case                                 |
| -------------------- | ----------------------------------------------------- | ---------------------------------------- |
| MSE                  | [`MSELoss`](src/super-roo/ml/engine/Loss.ts)          | Regression                               |
| Cross-Entropy        | [`CrossEntropyLoss`](src/super-roo/ml/engine/Loss.ts) | Multi-class classification               |
| Binary Cross-Entropy | [`BCELoss`](src/super-roo/ml/engine/Loss.ts)          | Binary classification                    |
| Huber                | [`HuberLoss`](src/super-roo/ml/engine/Loss.ts)        | Robust regression (delta=1.0)            |
| Hinge                | [`HingeLoss`](src/super-roo/ml/engine/Loss.ts)        | SVM-style classification (targets: -1/1) |

```typescript
import { MSELoss, CrossEntropyLoss, HuberLoss, HingeLoss, BCELoss } from "../ml/engine"

const mse = new MSELoss()
const { loss, grad } = mse.forward(predictions, targets)

const huber = new HuberLoss(1.0) // delta parameter
const crossEntropy = new CrossEntropyLoss()
const hinge = new HingeLoss()
const bce = new BCELoss()
```

---

## Neural Network Builder

The [`NeuralNetwork`](src/super-roo/ml/engine/NeuralNetwork.ts) class provides a high-level sequential model API.

### Configuration

```typescript
import { NeuralNetwork } from "../ml/engine"

const model = new NeuralNetwork({
	inputDim: 784, // Input features
	outputDim: 10, // Output classes
	hiddenDims: [256, 128], // Hidden layer sizes
	activation: "relu", // Hidden activation: "relu" | "tanh" | "sigmoid"
	finalActivation: "softmax", // Final activation: "softmax" | "sigmoid" | "none"
	dropout: 0.2, // Dropout rate (0 = disabled)
	useBatchNorm: true, // Batch norm after hidden layers
})
```

### Training

```typescript
const losses = model.train(X, y, lossFn, {
	epochs: 100,
	batchSize: 32,
	learningRate: 0.001,
	validationSplit: 0.2, // 20% for validation
	onEpoch: (epoch, trainLoss, valLoss?) => {
		console.log(`Epoch ${epoch}: train=${trainLoss}, val=${valLoss}`)
		return false // Return true to stop early
	},
})
```

### Inference

```typescript
const predictions = model.predict(X_test)
// Returns Tensor with shape [N, outputDim]
```

### Manual Forward/Backward

```typescript
// Forward (training mode — affects dropout, batch norm)
const output = model.forwardTraining(input)

// Backward
const inputGrad = model.backward(outputGrad)

// Optimizer step
model.step(learningRate)
model.zeroGrad()
```

### Serialization

```typescript
// Save weights to array
const weights = model.layers.map((l) => l.parameters().map((p) => Array.from(p.tensor.data)))

// Restore weights
model.deserialise(weights)
```

---

## Model Checkpointing & Serialization

### ModelCheckpoint

The [`ModelCheckpoint`](src/super-roo/ml/engine/checkpoint.ts) class saves/loads model weights and optimizer state to/from JSON files using atomic writes (write to temp, rename).

```typescript
import { ModelCheckpoint } from "../ml/engine"

const ckpt = new ModelCheckpoint({
	dir: "./checkpoints",
	name: "xor_model",
	saveBestOnly: true, // Only save when val loss improves
	improvementThreshold: 1e-4,
})

// Save after training
await ckpt.save(model.layers, optimizer, {
	epoch: 50,
	trainLoss: 0.01,
	valLoss: 0.02,
})

// Save with validation tracking
const improved = await ckpt.saveWithValidation(model.layers, valLoss, optimizer, epoch, trainLoss)

// Load checkpoint
const data = await ckpt.load(model.layers, optimizer)
// data.metadata contains epoch, trainLoss, valLoss
```

### ModelPersistence

The [`ModelPersistence`](src/super-roo/ml/engine/ModelPersistence.ts) class handles full learner state (encoder + multiple heads).

```typescript
import { ModelPersistence } from "../ml/engine"

const persistence = new ModelPersistence({
	dir: "./models",
	name: "code_learner",
})

// Save
await persistence.save({
	version: 1,
	encoder: encoderWeights, // number[][][]
	heads: {
		debug: debugHeadWeights, // number[][][]
		test: testHeadWeights,
	},
})

// Load
const weights = await persistence.load()
if (weights) {
	// Restore encoder and heads
}

// Clear
await persistence.clear()
```

---

## Evaluation Metrics

The [`Metrics`](src/super-roo/ml/engine/Metrics.ts) module provides classification and regression evaluation.

### Classification Metrics

```typescript
import { computeClassificationMetrics, computeMultiClassConfusionMatrix, computeConfusionMatrix } from "../ml/engine"

// Binary classification
const predicted = [1, 0, 1, 1, 0]
const actual = [1, 0, 0, 1, 1]

const metrics = computeClassificationMetrics(predicted, actual)
// { accuracy, precision, recall, f1, confusionMatrix }

// Multi-class confusion matrix
const matrix = computeMultiClassConfusionMatrix(predicted, actual, 3)
// Returns 3×3 matrix
```

### Regression Metrics

```typescript
import { computeRegressionMetrics } from "../ml/engine"

const predicted = [2.5, 3.1, 4.0]
const actual = [2.3, 3.0, 4.2]

const metrics = computeRegressionMetrics(predicted, actual)
// { mae, rmse, r2 }
```

### Action Outcome Tracking

Tracks whether ML-predicted actions actually improved outcomes.

```typescript
import { ActionOutcomeTracker } from "../ml/engine"

const tracker = new ActionOutcomeTracker(10000) // max records

tracker.record(
	"pred_123",
	"adjust_lr",
	0.85, // prediction confidence
	0.3, // before score
	0.7, // after score
)

tracker.helpRate() // Fraction of actions that helped
tracker.avgDelta() // Average score improvement
tracker.helpPrecision(0.8) // Precision at confidence threshold
```

---

## Example: Training a Simple XOR Classifier

This example trains a 2-layer network to solve the XOR problem.

```typescript
import { Tensor, NeuralNetwork, CrossEntropyLoss, ModelCheckpoint } from "../ml/engine"

// XOR dataset
const X = Tensor.from2D([
	[0, 0],
	[0, 1],
	[1, 0],
	[1, 1],
])
const y = Tensor.from2D([
	[1, 0], // 0 → class 0
	[0, 1], // 1 → class 1
	[0, 1], // 1 → class 1
	[1, 0], // 0 → class 0
])

// Build model
const model = new NeuralNetwork({
	inputDim: 2,
	outputDim: 2,
	hiddenDims: [4],
	activation: "tanh",
	finalActivation: "softmax",
})

// Train
const lossFn = new CrossEntropyLoss()
const losses = model.train(X, y, lossFn, {
	epochs: 2000,
	batchSize: 4,
	learningRate: 0.01,
	onEpoch: (epoch, loss) => {
		if (epoch % 200 === 0) console.log(`Epoch ${epoch}: loss=${loss.toFixed(6)}`)
		return false
	},
})

// Evaluate
const preds = model.predict(X)
console.log("Predictions:", preds)

// Save checkpoint
const ckpt = new ModelCheckpoint({ dir: "./checkpoints", name: "xor" })
await ckpt.save(model.layers, undefined, { epoch: 2000, trainLoss: losses[losses.length - 1] })

// Expected output after training:
// Epoch 0: loss=0.693147
// Epoch 200: loss=0.012345
// Epoch 2000: loss=0.000123
// Predictions: [[0.999, 0.001], [0.002, 0.998], [0.002, 0.998], [0.999, 0.001]]
```

---

## Example: Training a ConvNet for Image Classification

This example builds a convolutional neural network for classifying 32×32 RGB images.

```typescript
import {
	Tensor,
	NeuralNetwork,
	CrossEntropyLoss,
	Conv2D,
	MaxPool2D,
	Flatten,
	DenseLayer,
	ReLULayer,
	SoftmaxLayer,
	AdamOptimizer,
	ModelCheckpoint,
	computeClassificationMetrics,
} from "../ml/engine"

// Build a ConvNet manually (for full control)
const layers = [
	new Conv2D({
		inChannels: 3,
		outChannels: 16,
		kernelHeight: 3,
		kernelWidth: 3,
		inputHeight: 32,
		inputWidth: 32,
		stride: 1,
		padding: 1, // Same padding → 32×32 output
	}),
	new ReLULayer(),
	new MaxPool2D({
		inChannels: 16,
		inputHeight: 32,
		inputWidth: 32,
		poolHeight: 2,
		poolWidth: 2,
		stride: 2, // → 16×16 output
	}),
	new Conv2D({
		inChannels: 16,
		outChannels: 32,
		kernelHeight: 3,
		kernelWidth: 3,
		inputHeight: 16,
		inputWidth: 16,
		stride: 1,
		padding: 1, // → 16×16 output
	}),
	new ReLULayer(),
	new MaxPool2D({
		inChannels: 32,
		inputHeight: 16,
		inputWidth: 16,
		poolHeight: 2,
		poolWidth: 2,
		stride: 2, // → 8×8 output
	}),
	new Flatten(),
	new DenseLayer(32 * 8 * 8, 64, "xavier"),
	new ReLULayer(),
	new DenseLayer(64, 10, "xavier"),
	new SoftmaxLayer(),
]

// Collect all parameters
const allParams = layers.flatMap((l) => l.parameters())
const optimizer = new AdamOptimizer(allParams, 0.9, 0.999, 1e-8)
const lossFn = new CrossEntropyLoss()

// Generate synthetic data: 100 samples of 32×32 RGB images
const N = 100
const X = Tensor.random(N, 3 * 32 * 32, 0.5) // Random images
const y = new Tensor(N, 10, "zeros")
for (let i = 0; i < N; i++) {
	y.set(i, i % 10, 1) // One-hot labels
}

// Training loop
const epochs = 50
const batchSize = 16

for (let epoch = 0; epoch < epochs; epoch++) {
	let totalLoss = 0

	for (let i = 0; i < N; i += batchSize) {
		const end = Math.min(i + batchSize, N)
		const xBatch = X.sliceRows(i, end)
		const yBatch = y.sliceRows(i, end)

		// Forward
		let out = xBatch
		for (const layer of layers) {
			out = layer.forward(out)
		}

		// Loss + backward
		const { loss, grad } = lossFn.forward(out, yBatch)
		totalLoss += loss

		let dOut = grad
		for (let li = layers.length - 1; li >= 0; li--) {
			dOut = layers[li].backward(dOut)
		}

		// Optimizer step
		optimizer.step(0.001)
		optimizer.zeroGrad()
	}

	if (epoch % 10 === 0) {
		console.log(`Epoch ${epoch}: loss=${(totalLoss / Math.ceil(N / batchSize)).toFixed(6)}`)
	}
}

// Evaluate
let correct = 0
for (let i = 0; i < N; i++) {
	const x = X.sliceRows(i, i + 1)
	let out = x
	for (const layer of layers) {
		out = layer.forward(out)
	}
	const predClass = Array.from(out.data).indexOf(Math.max(...out.data))
	const trueClass = Array.from(y.data).indexOf(Math.max(...y.data.slice(i * 10, (i + 1) * 10)))
	if (predClass === trueClass) correct++
}

console.log(`Accuracy: ${((correct / N) * 100).toFixed(1)}%`)

// Save checkpoint
const ckpt = new ModelCheckpoint({ dir: "./checkpoints", name: "convnet" })
await ckpt.save(layers, optimizer, { epoch: epochs, trainLoss: totalLoss / Math.ceil(N / batchSize) })
```

---

## See Also

- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — How ML is used in the healing pipeline
- [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) — System architecture diagrams
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Common ML training issues
- [`src/super-roo/ml/engine/`](src/super-roo/ml/engine/) — Source code
