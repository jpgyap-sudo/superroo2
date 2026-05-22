/**
 * SuperRoo Cloud — Sandbox Module Index
 *
 * Central export point for all sandbox components.
 * Provides a global singleton SandboxManager that all consumers
 * (api.js, sandboxRunner.js, debugJobRunner.js, worker.js, etc.)
 * MUST import to avoid the triple-singleton problem.
 *
 * Usage:
 *   const { getGlobalSandboxManager } = require("./orchestrator/sandbox")
 *   const manager = await getGlobalSandboxManager()
 *
 * Innovative features:
 * - ComposeSandbox: Multi-container orchestration via Docker Compose
 * - Snapshot/restore: Checkpoint container state for audit and rollback
 * - Network simulation: Latency, packet loss, bandwidth limits via tc
 * - Self-healing: Automatic container restart and recreation
 * - Multi-language images: Python, Go, Rust sandbox variants
 */

const { DockerSandbox, isDangerousCommand, containerName } = require("./DockerSandbox")
const { SandboxPool } = require("./SandboxPool")
const { SandboxManager } = require("./SandboxManager")
const { ComposeSandbox } = require("./ComposeSandbox")
const { SandboxProvider } = require("./SandboxProvider")
const { E2BSandbox } = require("./E2BSandbox")
const { DaytonaSandbox } = require("./DaytonaSandbox")

// ── Global Singleton ──────────────────────────────────────────────────────────

/** @type {SandboxManager|null} */
let _globalManager = null

/**
 * Get or create the global SandboxManager singleton.
 *
 * All consumers MUST call this instead of creating their own SandboxManager
 * instances. This ensures a single pool, single set of metrics, and
 * consistent configuration across the entire system.
 *
 * @param {object} [options] - Optional config overrides (only used on first call)
 * @returns {Promise<SandboxManager>}
 */
async function getGlobalSandboxManager(options = {}) {
	if (!_globalManager) {
		_globalManager = new SandboxManager({
			sandboxDir: process.env.SANDBOX_DIR || "/opt/superroo2/cloud/sandbox",
			defaultImage: process.env.SANDBOX_IMAGE || "superroo-sandbox:latest",
			defaultTimeout: parseInt(process.env.SANDBOX_TIMEOUT_MS || "600000", 10),
			defaultMemory: process.env.SANDBOX_MEMORY || "512m",
			defaultCpus: process.env.SANDBOX_CPUS || "1",
			defaultNetwork: process.env.SANDBOX_NETWORK || "none",
			maxContainers: parseInt(process.env.SANDBOX_MAX_CONTAINERS || "10", 10),
			poolConfig: {
				minPool: parseInt(process.env.SANDBOX_POOL_MIN || "0", 10),
				maxPool: parseInt(process.env.SANDBOX_POOL_MAX || "5", 10),
				idleTimeout: parseInt(process.env.SANDBOX_POOL_IDLE_TIMEOUT || "300000", 10),
				healthInterval: parseInt(process.env.SANDBOX_POOL_HEALTH_INTERVAL || "60000", 10),
			},
			...options,
		})
		await _globalManager.init()
	}
	return _globalManager
}

/**
 * Reset the global singleton (for testing).
 */
function resetGlobalSandboxManager() {
	_globalManager = null
}

module.exports = {
	DockerSandbox,
	SandboxPool,
	SandboxManager,
	ComposeSandbox,
	SandboxProvider,
	E2BSandbox,
	DaytonaSandbox,
	isDangerousCommand,
	containerName,
	getGlobalSandboxManager,
	resetGlobalSandboxManager,
}
