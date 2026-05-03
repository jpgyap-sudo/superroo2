/**
 * @typedef {Object} AgentJob
 * @property {string} id
 * @property {string} agentId
 * @property {string} task
 * @property {string} [project]
 * @property {string} [repo]
 * @property {Record<string, unknown>} [inputs]
 * @property {string[]} [commands]
 */

/**
 * @typedef {Object} AgentConfig
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} description
 * @property {string} version
 * @property {boolean} enabled
 * @property {{ preferred: string, fallbacks: string[], maxTokens: number }} [modelPolicy]
 * @property {string[]} skills
 * @property {string[]} workflows
 * @property {string[]} resources
 * @property {Record<string, unknown>} [memory]
 * @property {string} outputs
 * @property {{ requiresApproval: boolean, canEditFiles: boolean, canPublish: boolean, canDeploy: boolean, blockedCommands: string[], approvalTriggers: string[] }} safety
 * @property {{ sandbox: boolean, timeoutSeconds: number, maxRetries: number }} runtime
 */

/**
 * @typedef {Object} AgentRunResult
 * @property {string} jobId
 * @property {string} agentId
 * @property {"completed" | "failed" | "approval_required"} status
 * @property {string} [outputPath]
 * @property {string} [logPath]
 * @property {string} summary
 * @property {string[]} [suggestedActions]
 */

module.exports = {}
