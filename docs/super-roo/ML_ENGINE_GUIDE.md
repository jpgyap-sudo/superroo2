# SuperRoo ML Engine — Usage Guide

> **Module**: [`src/super-roo/ml/`](src/super-roo/ml/)  
> **Engine**: [`src/super-roo/ml/engine/`](src/super-roo/ml/engine/)  
> **Loop**: [`src/super-roo/ml/loop/InfiniteImprovementLoop.ts`](src/super-roo/ml/loop/InfiniteImprovementLoop.ts)  
> **Cloud Port**: [`cloud/orchestrator/modules/InfiniteImprovementLoop.js`](cloud/orchestrator/modules/InfiniteImprovementLoop.js)  
> **API Reference**: [`ML_ENGINE_API.md`](ML_ENGINE_API.md)

The SuperRoo ML Engine is a lightweight, zero-dependency neural network framework built entirely in TypeScript. It powers the **Infinite Improvement Loop** — an 8-step autonomous learning cycle that observes task outcomes, trains neural networks, makes predictions, and takes actions to improve code quality, debugging, and testing.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Neural Network Stack](#neural-network-stack)
3. [Optimizers & Loss Functions](#optimizers--loss-functions)
4. [Infinite Improvement Loop](#infinite-improvement-loop)
5. [Learners](#learners)
6. [API Reference](#api-reference)
7. [Dashboard](#dashboard)
8. [Configuration](#configuration)
9. [Example: Complete Training Workflow](#example-complete-training-workflow)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        InfiniteImprovementLoop                               │
│                                                                              │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────┐  ┌──────────┐            │
│  │ OBSERVE │─▶│  LEARN  │─▶│ PREDICT  │─▶│ ACT  │─▶│ EVALUATE │            │
│  │ (collect│  │ (train  │  │ (score   │  │(submit│  │(compare  │            │
│  │  tasks) │  │  nets)  │  │  tasks)  │  │ tasks)│  │ outcomes)│            │
│  └─────────┘  └─────────┘  └──────────┘  └──────┘  └──────────┘            │
│       │            │              │           │            │                 │
│       ▼            ▼              ▼           ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────┐  ┌──────────┐            │
│  │ PERSIST │  │  SYNC   │  │   LOOP   │  │      │  │          │            │
│  │ (save   │  │ (cloud  │  │ (sleep & │  │      │  │          │            │
│  │ weights)│  │  sync)  │  │  repeat) │  │      │  │          │            │
│  └─────────┘  └─────────┘  └──────────┘  └──────┘  └──────────┘            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  Three Neural Networks (CodeLearner, DebugLearner, TestLearner)      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │  CodeLearner │  │ DebugLearner │  │ TestLearner  │               │    │
│  │  │  (8→16→8→3)  │  │  (8→16→8→3)  │  │  (8→16→8→3)  │               │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  MLSyncClient (bidirectional sync with cloud API)                    │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │ Upload local │  │ Download     │  │ Federated    │               │    │
│  │  │ model        │─▶│ cloud model  │─▶│ Merge        │               │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | File | Role |
|---|---|---|
| [`InfiniteImprovementLoop`](src/super-roo/ml/loop/InfiniteImprovementLoop.ts) | `InfiniteImprovementLoop.ts` | 8-step autonomous learning cycle orchestrator |
| [`NeuralNetwork`](src/super-roo/ml/engine/NeuralNetwork.ts) | `NeuralNetwork.ts` | Sequential model builder with train/predict |
| [`Tensor`](src/super-roo/ml/engine/Tensor.ts) | `Tensor.ts` | 2-D matrix with ops (add, matmul, transpose) |
| [`Layer`](src/super-roo/ml/engine/Layer.ts) | `Layer.ts` | Layer interface + 7 layer implementations |
| [`Optimizer`](src/super-roo/ml/engine/Optimizer.ts) | `Optimizer.ts` | Adam + SGD optimizers with LR scheduling |
| [`Loss`](src/super-roo/ml/engine/Loss.ts) | `Loss.ts` | 8 loss functions (MSE, CrossEntropy, BCE, etc.) |
| [`ModelPersistence`](src/super-roo/ml/engine/ModelPersistence.ts) | `ModelPersistence.ts` | Full learner state save/load |
| [`MLSyncClient`](src/super-roo/ml/sync/MLSyncClient.ts) | `MLSyncClient.ts` | Bidirectional cloud sync |
| [`CodeLearner`](src/super-roo/ml/learning/CodeLearner.ts) | `CodeLearner.ts` | Code quality prediction network |
| [`DebugLearner`](src/super-roo/ml/learning/DebugLearner.ts) | `DebugLearner.ts` | Debug success prediction network |
| [`TestLearner`](src/super-roo/ml/learning/TestLearner.ts) | `TestLearner.ts` | Test failure prediction network |

---

## Neural Network Stack

### Layer Types

All layers implement the [`Layer`](src/super-roo/ml/engine/Layer.ts) interface with `forward()`, `backward()`, `parameters()`, and `describe()`.

| Layer | Class | Parameters | Forward |
|---|---|---|---|
| **Dense** | `DenseLayer` | Weights + biases | `input · W + b` |
| **ReLU** | `ReLULayer` | None | `max(0, x)` |
| **Tanh** | `TanhLayer` | None | `tanh(x)` |
| **Sigmoid** | `SigmoidLayer` | None | `1 / (1 + exp(-x))` |
| **Softmax** | `SoftmaxLayer` | None | `exp(x_i - max) / sum(exp(x_j - max))` |
| **Dropout** | `DropoutLayer` | Mask (training only) | Randomly zeros fraction, scales by `1/(1-rate)` |
| **BatchNorm** | `BatchNormLayer` | Gamma + beta | `γ · (x - μ) / √(σ² + ε) + β` |
| **Conv2D** | `Conv2D` | Filters + biases | im2col-based convolution |
| **MaxPool2D** | `MaxPool2D` | None | Max over pooling window |
| **Flatten** | `Flatten` | None | Reshape marker |

### NeuralNetwork Builder

```typescript
import { NeuralNetwork } from "../ml/engine"

const model = new NeuralNetwork({
  inputDim: 8,          // Input features
  outputDim: 3,         // Output classes
  hiddenDims: [16, 8],  // Hidden layer sizes
  activation: "relu",   // Hidden activation
  finalActivation: "sigmoid", // Final activation
  dropout: 0.2,         // Dropout rate (0 = disabled)
  useBatchNorm: true,   // Batch norm after hidden layers
})
```

---

## Optimizers & Loss Functions

### Optimizers

| Optimizer | Class | Key Parameters | Use Case |
|---|---|---|---|
| **Adam** | `AdamOptimizer` | `beta1=0.9`, `beta2=0.999`, `eps=1e-8` | Default — adaptive learning rate |
| **SGD** | `SGDOptimizer` | `momentum=0.9` | Simpler, faster per-step |

### Learning Rate Schedulers

| Scheduler | Class | Behavior |
|---|---|---|
| **StepDecay** | `StepDecayScheduler` | Drops LR by factor every N epochs |
| **ExponentialDecay** | `ExponentialDecayScheduler` | LR *= decayRate each epoch |
| **ReduceLROnPlateau** | `ReduceLROnPlateau` | Reduces LR when val loss plateaus |
| **CosineAnnealing** | `CosineAnnealingScheduler` | Cosine decay with optional warm restarts |

### Loss Functions

| Loss | Class | Use Case |
|---|---|---|
| **MSE** | `MSELoss` | Regression |
| **Cross-Entropy** | `CrossEntropyLoss` | Multi-class classification |
| **Binary Cross-Entropy** | `BCELoss` | Binary classification |
| **Huber** | `HuberLoss` | Robust regression (delta=1.0) |
| **Hinge** | `HingeLoss` | SVM-style (targets: -1/1) |
| **MAE** | `MAELoss` | Mean Absolute Error |
| **KL Divergence** | `KLLoss` | Distribution matching |
| **Cosine Similarity** | `CosineSimilarityLoss` | Similarity learning |

---

## Infinite Improvement Loop

The [`InfiniteImprovementLoop`](src/super-roo/ml/loop/InfiniteImprovementLoop.ts) is the core autonomous learning engine. It runs an 8-step cycle:

### 8-Step Cycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       8-Step Improvement Cycle                           │
│                                                                          │
│  Step 1: OBSERVE                                                         │
│    └─ Collect task outcomes, test results, bug reports from orchestrator │
│    └─ Extract code samples, debug samples, test samples                  │
│                                                                          │
│  Step 2: LEARN                                                           │
│    └─ Train CodeLearner on code quality features                         │
│    └─ Train DebugLearner on debug success features                       │
│    └─ Train TestLearner on test failure features                         │
│                                                                          │
│  Step 3: PREDICT                                                         │
│    └─ Score upcoming tasks for quality risk, debug complexity            │
│    └─ Predict test failures before they happen                           │
│    └─ Prioritize work based on predicted outcomes                        │
│                                                                          │
│  Step 4: ACT                                                             │
│    └─ Submit follow-up tasks via orchestrator (validated)                │
│    └─ Max actions per iteration to avoid runaway queuing                 │
│                                                                          │
│  Step 5: EVALUATE                                                        │
│    └─ Compare predicted vs actual outcomes                               │
│    └─ Track action help rate and average delta                           │
│    └─ Update ActionOutcomeTracker                                        │
│                                                                          │
│  Step 6: PERSIST                                                         │
│    └─ Save model weights to disk (survives restarts)                     │
│    └─ ModelPersistence handles encoder + multiple heads                  │
│                                                                          │
│  Step 7: SYNC                                                            │
│    └─ Upload local model to cloud API                                    │
│    └─ Download merged cloud model                                        │
│    └─ Federated merge across agents                                      │
│                                                                          │
│  Step 8: LOOP                                                            │
│    └─ Sleep for configured interval                                     │
│    └─ Repeat from Step 1                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Starting & Stopping

```typescript
import { InfiniteImprovementLoop } from "../ml/loop/InfiniteImprovementLoop"

const loop = new InfiniteImprovementLoop(orchestrator, {
  minSamples: 5,
  maxIterations: 1000,
  idleSleepMs: 5000,
  trainEpochs: 20,
  confidenceThreshold: 0.75,
  maxActionsPerIteration: 3,
  modelDir: "./models",
  cloudApiBaseUrl: "http://100.64.175.88:8787",
  cloudAuthToken: process.env.CLOUD_AUTH_TOKEN,
  syncIntervalMs: 300000, // 5 minutes
})

await loop.start()

// Check stats
const stats = loop.getStats()
// { iteration, totalSamples, lastTrainLoss, predictionsMade, actionsTaken, ... }

await loop.stop()
```

### Error Handling

The loop has built-in resilience:
- **Consecutive failure limit**: 5 failures stops the loop
- **Exponential backoff**: `min(idleSleepMs * 2^(failures-1), 60000)` ms
- **Per-learner isolation**: One learner failing doesn't block others
- **Weight restoration**: Automatically restores saved weights on start

---

## Learners

Each learner is a dedicated neural network trained on specific features extracted from orchestrator tasks.

### CodeLearner

Trains on code quality features to predict code quality, success probability, and bug risk.

```typescript
import { CodeLearner } from "../ml/learning/CodeLearner"

const learner = new CodeLearner({
  inputDim: 8,
  epochs: 20,
  modelDir: "./models",
})

// Train on code samples
const loss = learner.train(codeSamples)
// { qualityLoss: 0.12, successLoss: 0.08, bugRiskLoss: 0.15 }

// Predict on new task features
const prediction = learner.predict(features)
// { quality: 0.85, success: 0.92, bugRisk: 0.13 }
```

**Features** (8-dimensional): complexity, linesChanged, filesAffected, testCoverage, dependencyCount, previousFailureRate, authorExperience, reviewDepth

### DebugLearner

Trains on debug session features to predict root cause likelihood, debug complexity, and fix success probability.

```typescript
import { DebugLearner } from "../ml/learning/DebugLearner"

const learner = new DebugLearner({
  inputDim: 8,
  epochs: 20,
  modelDir: "./models",
})

const loss = learner.train(debugSamples)
// { causeLoss: 0.10, complexityLoss: 0.07, fixSuccessLoss: 0.09 }
```

**Features** (8-dimensional): errorType, stackDepth, moduleAffected, reproductionRate, environmentComplexity, dependencyChain, previousAttempts, timeSinceDeploy

### TestLearner

Trains on test execution features to predict test failure, execution time, and coverage gaps.

```typescript
import { TestLearner } from "../ml/learning/TestLearner"

const learner = new TestLearner({
  inputDim: 8,
  epochs: 20,
  modelDir: "./models",
})

const loss = learner.train(testSamples)
// { failLoss: 0.11, timeLoss: 0.06, coverageLoss: 0.14 }
```

**Features** (8-dimensional): testComplexity, dependencyCount, flakinessHistory, executionTime, coveragePercent, assertionCount, parallelRisk, environmentStability

---

## API Reference

All ML endpoints are served from the cloud API at `/api/orchestrator/ml/*`.

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| `POST` | `/api/orchestrator/ml/train` | Trigger a training cycle | — | `{ success, message, stats }` |
| `GET` | `/api/orchestrator/ml/model` | Inspect current model | — | `{ modelType, loopsRun, observationsCollected, predictionsMade, actionsTaken }` |
| `GET` | `/api/orchestrator/ml/learners` | View learner status | — | `{ learners: [{ name, status, samples }] }` |
| `GET` | `/api/orchestrator/improvement/stats` | Loop statistics | — | `{ iteration, totalSamples, lastTrainLoss, predictionsMade, actionHelpRate }` |

### POST `/api/orchestrator/ml/train`

```bash
curl -X POST http://localhost:8787/api/orchestrator/ml/train \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "success": true,
  "message": "Training cycle started",
  "stats": {
    "iteration": 42,
    "totalSamples": 156,
    "lastTrainLoss": 0.023,
    "predictionsMade": 89,
    "actionsTaken": 12,
    "actionHelpRate": 0.75
  }
}
```

### GET `/api/orchestrator/ml/model`

```bash
curl http://localhost:8787/api/orchestrator/ml/model \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "modelType": "linear-regression",
  "loopsRun": 42,
  "observationsCollected": 156,
  "predictionsMade": 89,
  "actionsTaken": 12,
  "latestSync": "2026-05-20T01:00:00Z",
  "latestModel": { "version": 3, "accuracy": 0.87 }
}
```

### GET `/api/orchestrator/ml/learners`

```bash
curl http://localhost:8787/api/orchestrator/ml/learners \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "learners": [
    { "name": "code", "status": "active", "samples": 64 },
    { "name": "debug", "status": "active", "samples": 48 },
    { "name": "test", "status": "idle", "samples": 44 }
  ]
}
```

---

## Dashboard

The ML Engine status is visible in the **Intelligence Layer** dashboard view (`intelligence-layer.tsx`). It shows:

- **Model Status**: Current model type, training state, last sync time
- **Learner Activity**: Which learners are active, sample counts per learner
- **Prediction Stats**: Total predictions made, action help rate
- **Sync Status**: Cloud sync health, last upload/download timestamps

The dashboard does **not** yet show:
- Neural network architecture visualization
- Training loss curves
- Per-learner accuracy metrics
- Model version history

---

## Configuration

### Loop Configuration

```typescript
interface LoopConfig {
  minSamples: number           // Min samples before training starts (default: 5)
  maxIterations: number        // Max iterations before forced checkpoint (default: 1000)
  idleSleepMs: number          // Sleep between loops when idle (default: 5000)
  trainEpochs: number          // Training epochs per iteration (default: 20)
  confidenceThreshold: number  // Min confidence for auto-actions (default: 0.75)
  maxActionsPerIteration: number // Max auto-actions per iteration (default: 3)
  modelDir?: string            // Directory to persist model weights
  cloudApiBaseUrl?: string     // Cloud API URL for ML sync
  cloudAuthToken?: string      // Auth token for cloud API
  syncIntervalMs?: number      // Sync interval in ms (default: 300000)
}
```

### Neural Network Configuration

```typescript
const model = new NeuralNetwork({
  inputDim: 8,           // Must match feature dimension
  outputDim: 3,          // Must match prediction targets
  hiddenDims: [16, 8],   // Layer sizes — more layers = more capacity
  activation: "relu",    // "relu" | "tanh" | "sigmoid"
  finalActivation: "sigmoid", // "softmax" | "sigmoid" | "none"
  dropout: 0.2,          // 0 = disabled, 0.5 = aggressive
  useBatchNorm: true,    // Stabilizes training
})
```

---

## Example: Complete Training Workflow

This example shows the full workflow from configuration to prediction.

```typescript
import { InfiniteImprovementLoop } from "../ml/loop/InfiniteImprovementLoop"
import { NeuralNetwork } from "../ml/engine/NeuralNetwork"
import { ModelPersistence } from "../ml/engine/ModelPersistence"
import { CodeLearner } from "../ml/learning/CodeLearner"

// 1. Configure the loop
const loop = new InfiniteImprovementLoop(orchestrator, {
  minSamples: 10,
  maxIterations: 500,
  idleSleepMs: 10000,
  trainEpochs: 30,
  confidenceThreshold: 0.8,
  maxActionsPerIteration: 2,
  modelDir: "./models/superroo-ml",
})

// 2. Start the loop
await loop.start()

// 3. Observe — the loop automatically collects samples from orchestrator tasks
// After enough samples accumulate, training begins automatically

// 4. Check training progress
const stats = loop.getStats()
console.log(`Iteration: ${stats.iteration}`)
console.log(`Total samples: ${stats.totalSamples}`)
console.log(`Last train loss: ${stats.lastTrainLoss}`)
console.log(`Predictions made: ${stats.predictionsMade}`)
console.log(`Action help rate: ${(stats.actionHelpRate * 100).toFixed(1)}%`)

// 5. Manually trigger a training cycle (via API)
// POST /api/orchestrator/ml/train

// 6. Inspect learner status
// GET /api/orchestrator/ml/learners
// → [{ name: "code", status: "active", samples: 64 }, ...]

// 7. View model stats
// GET /api/orchestrator/ml/model
// → { modelType: "linear-regression", loopsRun: 42, ... }

// 8. Stop the loop (weights auto-saved)
await loop.stop()

// 9. On next start, weights are automatically restored
await loop.start()
// → "Restored saved model weights"
```

### Expected Output

```
[ml.loop.started] Infinite Improvement Loop started
[ml.loop.observe] Waiting for more samples (3/10)
[ml.loop.observe] Waiting for more samples (7/10)
[ml.loop.observe] Training with 12 samples
[ml.loop.train] CodeLearner: quality=0.12, success=0.08, bugRisk=0.15
[ml.loop.train] DebugLearner: cause=0.10, complexity=0.07, fixSuccess=0.09
[ml.loop.train] TestLearner: fail=0.11, time=0.06, coverage=0.14
[ml.loop.predict] Predicted 3 tasks, confidence >= 0.75
[ml.loop.act] Submitted 2 follow-up tasks
[ml.loop.evaluate] Action help rate: 75.0%
[ml.loop.persist] Model weights saved
```

---

## See Also

- [`ML_ENGINE_API.md`](ML_ENGINE_API.md) — Full API reference for Tensor, Layers, Optimizers, Loss functions
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — How ML is used in the healing pipeline
- [`DEBUG_TEAM_GUIDE.md`](DEBUG_TEAM_GUIDE.md) — How the debug team uses ML predictions
- [`src/super-roo/ml/`](src/super-roo/ml/) — Source code
- [`src/super-roo/ml/engine/`](src/super-roo/ml/engine/) — Neural network engine
