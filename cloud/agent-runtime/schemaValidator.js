const agentSchema = require("../schemas/agent.schema.json")

function validateAgentConfig(config) {
	const errors = []
	const required = agentSchema.required || []

	for (const key of required) {
		if (!(key in config)) {
			errors.push(`Missing required field: ${key}`)
		}
	}

	if (typeof config.id !== "string") errors.push("id must be a string")
	if (typeof config.name !== "string") errors.push("name must be a string")
	if (typeof config.category !== "string") errors.push("category must be a string")
	if (typeof config.description !== "string") errors.push("description must be a string")
	if (typeof config.version !== "string") errors.push("version must be a string")

	if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
		errors.push("enabled must be a boolean")
	}

	if (!Array.isArray(config.skills)) errors.push("skills must be an array")
	if (!Array.isArray(config.workflows)) errors.push("workflows must be an array")
	if (!Array.isArray(config.resources)) errors.push("resources must be an array")

	const safety = config.safety
	if (safety) {
		if (typeof safety.requiresApproval !== "boolean") errors.push("safety.requiresApproval must be a boolean")
		if (typeof safety.canEditFiles !== "boolean") errors.push("safety.canEditFiles must be a boolean")
		if (typeof safety.canPublish !== "boolean") errors.push("safety.canPublish must be a boolean")
		if (typeof safety.canDeploy !== "boolean") errors.push("safety.canDeploy must be a boolean")
		if (safety.blockedCommands !== undefined && !Array.isArray(safety.blockedCommands)) {
			errors.push("safety.blockedCommands must be an array")
		}
		if (safety.approvalTriggers !== undefined && !Array.isArray(safety.approvalTriggers)) {
			errors.push("safety.approvalTriggers must be an array")
		}
	}

	const runtime = config.runtime
	if (runtime) {
		if (runtime.sandbox !== undefined && typeof runtime.sandbox !== "boolean") {
			errors.push("runtime.sandbox must be a boolean")
		}
		if (runtime.timeoutSeconds !== undefined && typeof runtime.timeoutSeconds !== "number") {
			errors.push("runtime.timeoutSeconds must be a number")
		}
		if (runtime.maxRetries !== undefined && typeof runtime.maxRetries !== "number") {
			errors.push("runtime.maxRetries must be a number")
		}
	}

	if (config.outputs !== undefined && typeof config.outputs !== "string") {
		errors.push("outputs must be a string")
	}

	return { valid: errors.length === 0, errors }
}

module.exports = { validateAgentConfig }
