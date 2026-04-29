/**
 * Super Roo ML — public barrel.
 *
 * Deep learning + machine learning for SuperRoo.
 * All zero-dependency pure TypeScript.
 */

// Engine
export {
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
	BCELoss,
	AdamOptimizer,
	SGDOptimizer,
	NeuralNetwork,
	type Layer,
	type LossFn,
	type Optimizer,
	type NeuralNetworkConfig,
	type TrainingConfig,
} from "./engine"

// Learning modules
export {
	CodeLearner,
	DebugLearner,
	TestLearner,
	type CodeSample,
	type CodeLearnerConfig,
	type DebugSample,
	type DebugLearnerConfig,
	type TestSample,
	type TestLearnerConfig,
} from "./learning"

// Improvement loop
export { InfiniteImprovementLoop, type LoopConfig, type LoopStats } from "./loop"
