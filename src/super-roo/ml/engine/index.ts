/**
 * Super Roo ML — Engine barrel export.
 */

export { Tensor } from "./Tensor"
export {
	DenseLayer,
	ReLULayer,
	SigmoidLayer,
	TanhLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	type Layer,
} from "./Layer"
export { CrossEntropyLoss, MSELoss, BCELoss, type LossFn } from "./Loss"
export { AdamOptimizer, SGDOptimizer, type Optimizer } from "./Optimizer"
export { NeuralNetwork, type NeuralNetworkConfig, type TrainingConfig } from "./NeuralNetwork"
export {
	computeClassificationMetrics,
	computeMultiClassConfusionMatrix,
	computeRegressionMetrics,
	classificationMetricsFromConfusionMatrix,
	computeConfusionMatrix,
	ActionOutcomeTracker,
	type ClassificationMetrics,
	type RegressionMetrics,
	type ConfusionMatrix,
	type ActionOutcomeRecord,
} from "./Metrics"
export { ModelPersistence, type PersistedWeights, type ModelPersistenceConfig } from "./ModelPersistence"
