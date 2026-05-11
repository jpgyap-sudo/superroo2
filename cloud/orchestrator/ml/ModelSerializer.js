/**
 * ModelSerializer.js
 *
 * Unified JSON schema for serializing ML models across local (VS Code extension)
 * and cloud (orchestrator) environments. Supports:
 *   - Neural network weights/biases (local, Tensor-based)
 *   - Linear regression weights/biases (cloud, simple arrays)
 *   - Versioned schema for forward/backward compatibility
 *
 * Schema version history:
 *   1 - Initial unified format
 */

const MODEL_SCHEMA_VERSION = 1

/**
 * Serialize a neural network model (local) into the unified JSON schema.
 *
 * @param {object} modelData
 * @param {number[][][]} modelData.weights - Neural network weights from NeuralNetwork.serialise()
 *   Format: layers × [weightsMatrix, biasVector] where weightsMatrix is number[][] and biasVector is number[]
 * @param {number} modelData.featureDimensions - Input feature count (8 for local)
 * @param {number} modelData.trainingSamples - Total training samples seen
 * @param {string} modelData.source - "local"
 * @param {object} [modelData.metadata] - Optional extra metadata
 * @returns {object} Serialized model JSON
 */
function serializeNeuralNetwork(modelData) {
	const { weights, featureDimensions, trainingSamples, source = "local", metadata = {} } = modelData

	if (!weights || !Array.isArray(weights)) {
		throw new Error("ModelSerializer: 'weights' must be a non-empty array of layer parameters")
	}

	return {
		schemaVersion: MODEL_SCHEMA_VERSION,
		modelType: "neural-network",
		timestamp: new Date().toISOString(),
		source,
		featureDimensions,
		trainingSamples: trainingSamples ?? 0,
		architecture: {
			type: "dense",
			layers: weights.map((layer, i) => ({
				index: i,
				// layer[0] = weight matrix (number[][]), layer[1] = bias vector (number[])
				inputSize: layer[0] ? layer[0].length : 0,
				outputSize: layer[0] && layer[0].length > 0 ? layer[0][0].length : 0,
			})),
		},
		parameters: {
			// Store as-is: layers × [weightsMatrix, biasVector]
			weights,
		},
		metadata: {
			...metadata,
			serializedAt: new Date().toISOString(),
		},
	}
}

/**
 * Serialize a linear regression model (cloud) into the unified JSON schema.
 *
 * @param {object} modelData
 * @param {number[]} modelData.weights - Linear regression weight coefficients
 * @param {number} modelData.bias - Linear regression bias term
 * @param {number} modelData.featureDimensions - Input feature count (5 for cloud)
 * @param {number} modelData.trainingSamples - Total training samples seen
 * @param {string} modelData.source - "cloud"
 * @param {object} [modelData.metadata] - Optional extra metadata
 * @returns {object} Serialized model JSON
 */
function serializeLinearRegression(modelData) {
	const { weights, bias, featureDimensions, trainingSamples, source = "cloud", metadata = {} } = modelData

	if (!weights || !Array.isArray(weights)) {
		throw new Error("ModelSerializer: 'weights' must be a non-empty array for linear regression")
	}

	return {
		schemaVersion: MODEL_SCHEMA_VERSION,
		modelType: "linear-regression",
		timestamp: new Date().toISOString(),
		source,
		featureDimensions,
		trainingSamples: trainingSamples ?? 0,
		architecture: {
			type: "linear",
			inputSize: weights.length,
			outputSize: 1,
		},
		parameters: {
			// Convert to neural-network compatible format for unified storage:
			// Single layer: [weightsRowVector, biasScalar]
			weights: [[weights], [bias]],
		},
		metadata: {
			...metadata,
			serializedAt: new Date().toISOString(),
		},
	}
}

/**
 * Deserialize a unified model JSON back into the appropriate format.
 *
 * @param {object} json - Serialized model JSON
 * @returns {object} Deserialized model data
 *   For neural-network: { modelType: "neural-network", weights: number[][][], featureDimensions, trainingSamples, source, metadata }
 *   For linear-regression: { modelType: "linear-regression", weights: number[], bias: number, featureDimensions, trainingSamples, source, metadata }
 */
function deserialize(json) {
	if (!json || typeof json !== "object") {
		throw new Error("ModelSerializer: invalid JSON input")
	}
	if (json.schemaVersion !== MODEL_SCHEMA_VERSION) {
		throw new Error(
			`ModelSerializer: unsupported schema version ${json.schemaVersion} (expected ${MODEL_SCHEMA_VERSION})`,
		)
	}

	const base = {
		featureDimensions: json.featureDimensions,
		trainingSamples: json.trainingSamples ?? 0,
		source: json.source ?? "unknown",
		metadata: json.metadata ?? {},
	}

	switch (json.modelType) {
		case "neural-network": {
			return {
				...base,
				modelType: "neural-network",
				weights: json.parameters.weights,
			}
		}
		case "linear-regression": {
			// Extract from unified format: weights[0] = weights row, weights[1] = bias
			const params = json.parameters.weights
			return {
				...base,
				modelType: "linear-regression",
				weights: params[0] ? params[0][0] : [],
				bias: params[1] ? params[1][0] : 0,
			}
		}
		default:
			throw new Error(`ModelSerializer: unknown modelType "${json.modelType}"`)
	}
}

/**
 * Validate a serialized model JSON against the schema.
 *
 * @param {object} json - Serialized model JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(json) {
	const errors = []

	if (!json || typeof json !== "object") {
		return { valid: false, errors: ["Input must be a non-null object"] }
	}

	if (json.schemaVersion !== MODEL_SCHEMA_VERSION) {
		errors.push(`schemaVersion must be ${MODEL_SCHEMA_VERSION}, got ${json.schemaVersion}`)
	}

	if (!json.modelType || !["neural-network", "linear-regression"].includes(json.modelType)) {
		errors.push(`modelType must be "neural-network" or "linear-regression", got "${json.modelType}"`)
	}

	if (typeof json.timestamp !== "string" || !json.timestamp) {
		errors.push("timestamp must be a non-empty ISO string")
	}

	if (typeof json.featureDimensions !== "number" || json.featureDimensions < 1) {
		errors.push("featureDimensions must be a positive number")
	}

	if (typeof json.trainingSamples !== "number" || json.trainingSamples < 0) {
		errors.push("trainingSamples must be a non-negative number")
	}

	if (!json.architecture || typeof json.architecture !== "object") {
		errors.push("architecture must be an object")
	}

	if (!json.parameters || !json.parameters.weights || !Array.isArray(json.parameters.weights)) {
		errors.push("parameters.weights must be an array")
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}

module.exports = {
	MODEL_SCHEMA_VERSION,
	serializeNeuralNetwork,
	serializeLinearRegression,
	deserialize,
	validate,
}
