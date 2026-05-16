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
export { CrossEntropyLoss, MSELoss, BCELoss, HuberLoss, HingeLoss, type LossFn } from "./Loss"
export {
	AdamOptimizer,
	SGDOptimizer,
	captureSGDOptimizerState,
	captureAdamOptimizerState,
	restoreOptimizerState,
	type Optimizer,
	type OptimizerState,
} from "./Optimizer"
export {
	StepDecayScheduler,
	ExponentialDecayScheduler,
	ReduceLROnPlateau,
	type LRScheduler,
	type StepDecayConfig,
	type ExponentialDecayConfig,
	type ReduceLROnPlateauConfig,
} from "./LRScheduler"
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
export { ModelCheckpoint, type CheckpointData, type ModelCheckpointConfig } from "./checkpoint"
export { Conv2D, MaxPool2D, Flatten, type Conv2DConfig, type MaxPool2DConfig, type FlattenConfig } from "./layers/conv"
