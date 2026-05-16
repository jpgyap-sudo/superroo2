/**
 * FeatureMapper.js
 *
 * Defines a unified 10-dimensional feature space that bridges:
 *   - Local (VS Code extension): 8-dim feature space (goalLen, capsCount, hasWrite, hasExecute,
 *     priorityScore, attempts, isFollowup, reserved)
 *   - Cloud (orchestrator): 5-dim feature space (taskAge, priority, hasTelegramContext,
 *     hasConversationSummary, messageLength)
 *
 * The unified 10-dim space:
 *   [0] goalLenNorm      - Normalized goal/task description length
 *   [1] capsCountNorm    - Normalized capability/context count
 *   [2] hasWriteAccess   - Binary: has write file access
 *   [3] hasExecuteAccess - Binary: has execute command access
 *   [4] priorityNorm     - Normalized priority score (0-1)
 *   [5] attemptsNorm     - Normalized retry/attempt count
 *   [6] isFollowup       - Binary: is a follow-up task
 *   [7] taskAgeNorm      - Normalized task age in hours
 *   [8] hasTelegramCtx   - Binary: has Telegram context
 *   [9] hasSummaryCtx    - Binary: has conversation summary
 */

const UNIFIED_DIMENSIONS = 10

/**
 * Map a local (VS Code) task to the unified 10-dim feature vector.
 *
 * Local features (8-dim):
 *   [0] goalLen/200       - Description length normalized
 *   [1] capsCount/5       - Capability count normalized
 *   [2] hasWrite          - Binary: has write access
 *   [3] hasExecute        - Binary: has execute access
 *   [4] priorityScore     - Priority (0-1)
 *   [5] attempts/3        - Retry count normalized
 *   [6] isFollowup        - Binary: follow-up task
 *   [7] reserved          - Reserved (always 0)
 *
 * @param {number[]} localFeatures - 8-dim array from local InfiniteImprovementLoop.taskToFeatures()
 * @param {object} [task] - Optional full task object for additional context
 * @returns {number[]} 10-dim unified feature vector
 */
function fromLocal(localFeatures, task = null) {
	if (!localFeatures || localFeatures.length < 8) {
		throw new Error(`FeatureMapper.fromLocal: expected at least 8 features, got ${localFeatures?.length ?? 0}`)
	}

	const f = localFeatures

	// Local 8-dim -> Unified 10-dim mapping
	const unified = [
		f[0] ?? 0, // [0] goalLenNorm
		f[1] ?? 0, // [1] capsCountNorm
		f[2] ?? 0, // [2] hasWriteAccess
		f[3] ?? 0, // [3] hasExecuteAccess
		f[4] ?? 0, // [4] priorityNorm
		f[5] ?? 0, // [5] attemptsNorm
		f[6] ?? 0, // [6] isFollowup
		0, // [7] taskAgeNorm - not available locally, defaults to 0
		0, // [8] hasTelegramCtx - not available locally, defaults to 0
		0, // [9] hasSummaryCtx - not available locally, defaults to 0
	]

	return unified
}

/**
 * Map a cloud (orchestrator) task to the unified 10-dim feature vector.
 *
 * Cloud features (5-dim):
 *   [0] taskAge/24         - Task age in hours normalized
 *   [1] priority           - Priority (0-1)
 *   [2] hasTelegramContext - Binary: has Telegram context
 *   [3] hasConversationSummary - Binary: has conversation summary
 *   [4] messageLength/1000 - Message length normalized
 *
 * @param {number[]} cloudFeatures - 5-dim array from cloud InfiniteImprovementLoop._taskToFeatures()
 * @param {object} [task] - Optional full task object for additional context
 * @returns {number[]} 10-dim unified feature vector
 */
function fromCloud(cloudFeatures, task = null) {
	if (!cloudFeatures || cloudFeatures.length < 5) {
		throw new Error(`FeatureMapper.fromCloud: expected at least 5 features, got ${cloudFeatures?.length ?? 0}`)
	}

	const f = cloudFeatures

	// Cloud 5-dim -> Unified 10-dim mapping
	// Cloud doesn't have local-specific features, so those default to 0
	const unified = [
		0, // [0] goalLenNorm - not available in cloud, defaults to 0
		0, // [1] capsCountNorm - not available in cloud, defaults to 0
		0, // [2] hasWriteAccess - not available in cloud, defaults to 0
		0, // [3] hasExecuteAccess - not available in cloud, defaults to 0
		f[1] ?? 0, // [4] priorityNorm (maps from cloud priority)
		0, // [5] attemptsNorm - not available in cloud, defaults to 0
		0, // [6] isFollowup - not available in cloud, defaults to 0
		f[0] ?? 0, // [7] taskAgeNorm (maps from cloud taskAge/24)
		f[2] ?? 0, // [8] hasTelegramCtx (maps from cloud hasTelegramContext)
		f[3] ?? 0, // [9] hasSummaryCtx (maps from cloud hasConversationSummary)
	]

	return unified
}

/**
 * Convert a unified 10-dim vector back to local 8-dim format.
 * Used when cloud-synced model needs to make predictions locally.
 *
 * @param {number[]} unified - 10-dim unified feature vector
 * @returns {number[]} 8-dim local feature vector
 */
function toLocal(unified) {
	if (!unified || unified.length < UNIFIED_DIMENSIONS) {
		throw new Error(`FeatureMapper.toLocal: expected ${UNIFIED_DIMENSIONS} features, got ${unified?.length ?? 0}`)
	}

	return [
		unified[0] ?? 0, // goalLenNorm
		unified[1] ?? 0, // capsCountNorm
		unified[2] ?? 0, // hasWriteAccess
		unified[3] ?? 0, // hasExecuteAccess
		unified[4] ?? 0, // priorityNorm
		unified[5] ?? 0, // attemptsNorm
		unified[6] ?? 0, // isFollowup
		0, // reserved
	]
}

/**
 * Convert a unified 10-dim vector back to cloud 5-dim format.
 * Used when local-synced model needs to make predictions in the cloud.
 *
 * @param {number[]} unified - 10-dim unified feature vector
 * @returns {number[]} 5-dim cloud feature vector
 */
function toCloud(unified) {
	if (!unified || unified.length < UNIFIED_DIMENSIONS) {
		throw new Error(`FeatureMapper.toCloud: expected ${UNIFIED_DIMENSIONS} features, got ${unified?.length ?? 0}`)
	}

	return [
		unified[7] ?? 0, // taskAgeNorm
		unified[4] ?? 0, // priorityNorm
		unified[8] ?? 0, // hasTelegramCtx
		unified[9] ?? 0, // hasSummaryCtx
		0, // messageLength - not available after mapping, defaults to 0
	]
}

/**
 * Get the names of all unified feature dimensions for debugging/display.
 *
 * @returns {string[]} Array of 10 feature names
 */
function getFeatureNames() {
	return [
		"goalLenNorm",
		"capsCountNorm",
		"hasWriteAccess",
		"hasExecuteAccess",
		"priorityNorm",
		"attemptsNorm",
		"isFollowup",
		"taskAgeNorm",
		"hasTelegramCtx",
		"hasSummaryCtx",
	]
}

module.exports = {
	UNIFIED_DIMENSIONS,
	fromLocal,
	fromCloud,
	toLocal,
	toCloud,
	getFeatureNames,
}
