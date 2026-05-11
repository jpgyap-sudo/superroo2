/**
 * FederatedMerge.js
 *
 * Implements federated learning model merging using weighted averaging.
 * Combines model parameters from multiple sources (local VS Code instances + cloud)
 * weighted by their training sample counts.
 *
 * Principles:
 *   - Raw data stays local (privacy-preserving)
 *   - Only model weights and observation metadata are synced
 *   - Weighted by trainingSamples so more experienced models have more influence
 *   - Supports both neural-network and linear-regression model types
 */

const { deserialize, validate } = require("./ModelSerializer")

/**
 * Merge multiple serialized models into one using federated weighted averaging.
 *
 * @param {object[]} models - Array of serialized model JSON objects
 * @param {object} [options]
 * @param {number} [options.minSamples=1] - Minimum training samples required to participate
 * @param {string} [options.source="cloud"] - Source label for the merged model
 * @returns {object} Merged serialized model JSON
 */
function federatedMerge(models, options = {}) {
	const { minSamples = 1, source = "cloud" } = options

	if (!models || models.length === 0) {
		throw new Error("FederatedMerge: at least one model is required")
	}

	// Validate and deserialize all models
	const deserialized = models.map((m) => {
		const v = validate(m)
		if (!v.valid) {
			throw new Error(`FederatedMerge: invalid model - ${v.errors.join("; ")}`)
		}
		return deserialize(m)
	})

	// Filter by minimum samples
	const eligible = deserialized.filter((m) => m.trainingSamples >= minSamples)
	if (eligible.length === 0) {
		throw new Error(`FederatedMerge: no models meet the minimum sample threshold of ${minSamples}`)
	}

	// Determine model type from the majority
	const typeCounts = {}
	for (const m of eligible) {
		typeCounts[m.modelType] = (typeCounts[m.modelType] || 0) + 1
	}
	const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0]

	// Separate by type
	const sameType = eligible.filter((m) => m.modelType === dominantType)
	if (sameType.length === 0) {
		throw new Error("FederatedMerge: no models of the dominant type available for merge")
	}

	// Calculate total samples for weighting
	const totalSamples = sameType.reduce((sum, m) => sum + m.trainingSamples, 0)

	if (totalSamples === 0) {
		throw new Error("FederatedMerge: total training samples is zero, cannot compute weights")
	}

	// Merge based on model type
	let mergedParams
	let mergedFeatureDimensions
	let mergedSamples

	if (dominantType === "neural-network") {
		mergedParams = mergeNeuralNetworks(sameType, totalSamples)
		mergedFeatureDimensions = sameType[0].featureDimensions
	} else {
		// linear-regression
		mergedParams = mergeLinearRegressions(sameType, totalSamples)
		mergedFeatureDimensions = sameType[0].featureDimensions
	}

	mergedSamples = sameType.reduce((sum, m) => sum + m.trainingSamples, 0)

	// Build the merged model in serialized format
	const mergedModel = {
		schemaVersion: 1,
		modelType: dominantType,
		timestamp: new Date().toISOString(),
		source,
		featureDimensions: mergedFeatureDimensions,
		trainingSamples: mergedSamples,
		architecture:
			sameType[0].metadata?.architecture ||
			(dominantType === "neural-network"
				? { type: "dense", layers: mergedParams.layerInfo }
				: { type: "linear", inputSize: mergedFeatureDimensions, outputSize: 1 }),
		parameters: {
			weights: mergedParams.weights,
		},
		metadata: {
			mergedFrom: sameType.length,
			mergedSources: [...new Set(sameType.map((m) => m.source))],
			serializedAt: new Date().toISOString(),
			mergeAlgorithm: "weighted-average",
		},
	}

	return mergedModel
}

/**
 * Weighted average of neural network parameters.
 * Each model contributes proportionally to its trainingSamples / totalSamples.
 *
 * @param {object[]} models - Deserialized neural-network models
 * @param {number} totalSamples - Sum of all trainingSamples
 * @returns {{ weights: number[][][], layerInfo: object[] }}
 */
function mergeNeuralNetworks(models, totalSamples) {
	// Use the first model's architecture as the template
	const reference = models[0].weights
	const numLayers = reference.length

	// Initialize merged weights as zero-filled arrays matching reference shape
	const mergedWeights = []
	const layerInfo = []

	for (let l = 0; l < numLayers; l++) {
		const layerWeights = reference[l][0] // weight matrix: number[][]
		const layerBias = reference[l][1] // bias vector: number[]

		const numRows = layerWeights.length
		const numCols = numRows > 0 ? layerWeights[0].length : 0

		// Initialize merged matrices
		const mergedW = Array.from({ length: numRows }, () => new Float64Array(numCols))
		const mergedB = new Float64Array(layerBias.length)

		// Accumulate weighted sum
		for (const model of models) {
			const weight = model.trainingSamples / totalSamples
			const w = model.weights[l][0]
			const b = model.weights[l][1]

			for (let r = 0; r < numRows; r++) {
				for (let c = 0; c < numCols; c++) {
					mergedW[r][c] += w[r][c] * weight
				}
			}
			for (let i = 0; i < b.length; i++) {
				mergedB[i] += b[i] * weight
			}
		}

		// Convert Float64Array back to regular arrays for JSON serialization
		mergedWeights.push([mergedW.map((row) => Array.from(row)), Array.from(mergedB)])

		layerInfo.push({
			index: l,
			inputSize: numRows,
			outputSize: numCols,
		})
	}

	return { weights: mergedWeights, layerInfo }
}

/**
 * Weighted average of linear regression parameters.
 *
 * @param {object[]} models - Deserialized linear-regression models
 * @param {number} totalSamples - Sum of all trainingSamples
 * @returns {{ weights: number[][][], layerInfo: object[] }}
 */
function mergeLinearRegressions(models, totalSamples) {
	const reference = models[0]
	const numFeatures = reference.weights.length

	// Initialize accumulators
	let mergedWeights = new Float64Array(numFeatures)
	let mergedBias = 0

	// Accumulate weighted sum
	for (const model of models) {
		const weight = model.trainingSamples / totalSamples
		for (let i = 0; i < numFeatures; i++) {
			mergedWeights[i] += (model.weights[i] ?? 0) * weight
		}
		mergedBias += (model.bias ?? 0) * weight
	}

	// Return in neural-network compatible format: [weightsRow, biasScalar]
	return {
		weights: [[Array.from(mergedWeights)], [mergedBias]],
		layerInfo: [{ index: 0, inputSize: numFeatures, outputSize: 1 }],
	}
}

/**
 * Simple helper to merge two models (common case: local + cloud).
 *
 * @param {object} localModel - Serialized local model JSON
 * @param {object} cloudModel - Serialized cloud model JSON
 * @param {object} [options]
 * @returns {object} Merged serialized model JSON
 */
function mergeLocalAndCloud(localModel, cloudModel, options = {}) {
	return federatedMerge([localModel, cloudModel], options)
}

module.exports = {
	federatedMerge,
	mergeLocalAndCloud,
}
