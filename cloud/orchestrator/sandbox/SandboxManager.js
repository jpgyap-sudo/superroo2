/**
 * SuperRoo Cloud — SandboxManager
 *
 * Core orchestration class for sandboxed execution.
 * Manages container lifecycle, pooling, image management,
 * and provides a unified API for the rest of the system.
 *
 * Features:
 * - Container lifecycle (create, exec, destroy)
 * - Container pooling with warm containers
 * - Image management (build, pull, list, remove)
 * - Health checks and diagnostics
 * - Metrics and monitoring
 * - Configuration management
 * - Resource-aware scheduling (CPU Guard integration)
 * - Audit trail for all sandbox operations
 * - Snapshot/restore for checkpoint and rollback
 * - Self-healing container pool
 *
 * Inspired by OpenHands's sandbox architecture and SWE-agent's environment abstraction.
 */

const { DockerSandbox } = require("./DockerSandbox")
const { SandboxPool } = require("./SandboxPool")
const path = require("path")
const fs = require("fs")

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_SANDBOX_DIR = process.env.SANDBOX_DIR || "/opt/superroo2/cloud/sandbox"
const DEFAULT_IMAGE = process.env.SANDBOX_IMAGE || "superroo-sandbox:latest"
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || "600000", 10)
const DEFAULT_MEMORY = process.env.SANDBOX_MEMORY || "512m"
const DEFAULT_CPUS = process.env.SANDBOX_CPUS || "1"
const DEFAULT_NETWORK = process.env.SANDBOX_NETWORK || "none"
const DEFAULT_MAX_CONTAINERS = parseInt(process.env.SANDBOX_MAX_CONTAINERS || "10", 10)

// CPU Guard thresholds for resource-aware scheduling
const CPU_GUARD_URL = process.env.CPU_GUARD_URL || "http://127.0.0.1:3456"
const CPU_HIGH_THRESHOLD = 80 // percent
const MEM_HIGH_THRESHOLD = 85 // percent

// Audit log path
const AUDIT_LOG_DIR = process.env.SANDBOX_AUDIT_DIR || path.join(__dirname, "..", "..", "data", "sandbox-audit")
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.jsonl")

// ── SandboxManager Class ──────────────────────────────────────────────────────

class SandboxManager {
	/**
	 * @param {object} [options]
	 * @param {string} [options.sandboxDir] - Sandbox directory path
	 * @param {string} [options.defaultImage] - Default Docker image
	 * @param {number} [options.defaultTimeout] - Default timeout in ms
	 * @param {string} [options.defaultMemory] - Default memory limit
	 * @param {string} [options.defaultCpus] - Default CPU limit
	 * @param {string} [options.defaultNetwork] - Default network mode
	 * @param {number} [options.maxContainers] - Max concurrent containers
	 * @param {object} [options.poolConfig] - SandboxPool configuration
	 * @param {boolean} [options.enableAudit] - Enable audit trail (default: true)
	 * @param {boolean} [options.enableResourceAware] - Enable resource-aware scheduling (default: true)
	 */
	constructor(options = {}) {
		this.sandboxDir = options.sandboxDir || DEFAULT_SANDBOX_DIR
		this.defaultImage = options.defaultImage || DEFAULT_IMAGE
		this.defaultTimeout = options.defaultTimeout || DEFAULT_TIMEOUT_MS
		this.defaultMemory = options.defaultMemory || DEFAULT_MEMORY
		this.defaultCpus = options.defaultCpus || DEFAULT_CPUS
		this.defaultNetwork = options.defaultNetwork || DEFAULT_NETWORK
		this.maxContainers = options.maxContainers || DEFAULT_MAX_CONTAINERS
		this.enableAudit = options.enableAudit !== false
		this.enableResourceAware = options.enableResourceAware !== false

		/** @type {Map<string, {sandbox: DockerSandbox, createdAt: number, status: string}>} */
		this._active = new Map()

		this.pool = new SandboxPool(options.poolConfig || {})
		this._initialized = false
		this._dockerAvailable = false

		// Metrics
		this._metrics = {
			totalJobs: 0,
			totalSuccess: 0,
			totalFailed: 0,
			totalTimedOut: 0,
			totalDockerErrors: 0,
			activeContainers: 0,
			totalSnapshots: 0,
			totalRestores: 0,
			totalSelfHeals: 0,
			totalResourceThrottles: 0,
		}

		// Audit trail buffer
		this._auditBuffer = []
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	/**
	 * Initialize the sandbox manager.
	 * Checks Docker availability and initializes the pool.
	 */
	async init() {
		if (this._initialized) return
		this._initialized = true

		// Check Docker availability
		this._dockerAvailable = await DockerSandbox.isDockerAvailable()
		if (!this._dockerAvailable) {
			console.warn("[sandbox-manager] Docker is not available — sandbox execution disabled")
		} else {
			console.log("[sandbox-manager] Docker is available")
		}

		// Initialize pool
		await this.pool.init()

		console.log("[sandbox-manager] Initialized")
	}

	/**
	 * Check if the sandbox manager is ready.
	 */
	isReady() {
		return this._initialized && this._dockerAvailable
	}

	// ── Job Execution ─────────────────────────────────────────────────────

	/**
	 * Execute a job inside a sandbox container.
	 *
	 * @param {object} job
	 * @param {string} job.id - Unique job identifier
	 * @param {string} [job.task] - Human-readable task name
	 * @param {string[]} job.commands - Commands to execute
	 * @param {object} [options]
	 * @param {string} [options.image] - Docker image override
	 * @param {string} [options.network] - Network mode override
	 * @param {string} [options.memory] - Memory limit override
	 * @param {string} [options.cpus] - CPU limit override
	 * @param {number} [options.timeout] - Timeout override in ms
	 * @param {boolean} [options.usePool] - Use pooled container (default: false)
	 * @param {object} [options.env] - Environment variables
	 * @param {string[]} [options.volumes] - Additional volume mounts
	 * @returns {Promise<object>}
	 */
	async executeJob(job, options = {}) {
		const jobId = job.id || `job-${Date.now()}`
		const taskName = job.task || "untitled"
		const commands = Array.isArray(job.commands) ? job.commands : []

		if (!this._dockerAvailable) {
			return {
				success: false,
				error: "Docker is not available on this host",
				jobId,
				taskName,
			}
		}

		// Check max containers
		if (this._active.size >= this.maxContainers) {
			return {
				success: false,
				error: `Max containers reached (${this.maxContainers})`,
				jobId,
				taskName,
			}
		}

		// Resource-aware scheduling: check system pressure before starting
		const pressure = await this._checkResourcePressure()
		if (pressure.throttle) {
			console.warn(`[sandbox-manager] Resource pressure detected: ${pressure.reason}`)
			// Still proceed but log the throttle — the job may be slower
		}

		this._metrics.totalJobs++

		try {
			let sandbox
			let release

			if (options.usePool) {
				// Acquire from pool
				const acquired = await this.pool.acquire({
					jobId,
					commands,
					image: options.image || this.defaultImage,
					network: options.network || this.defaultNetwork,
					memory: options.memory || this.defaultMemory,
					cpus: options.cpus || this.defaultCpus,
					timeout: options.timeout || this.defaultTimeout,
					env: options.env,
					volumes: options.volumes,
					workDir: options.workDir,
				})
				sandbox = acquired.sandbox
				release = acquired.release
			} else {
				// Create a dedicated container
				sandbox = new DockerSandbox({
					jobId,
					commands,
					image: options.image || this.defaultImage,
					network: options.network || this.defaultNetwork,
					memory: options.memory || this.defaultMemory,
					cpus: options.cpus || this.defaultCpus,
					timeout: options.timeout || this.defaultTimeout,
					env: options.env,
					volumes: options.volumes,
					workDir: options.workDir,
				})
				await sandbox.init()
			}

			// Track active
			this._active.set(sandbox.name, {
				sandbox,
				createdAt: Date.now(),
				status: "running",
			})
			this._metrics.activeContainers = this._active.size

			// Audit: job started
			this._audit("execute-start", { jobId, taskName, containerName: sandbox.name, options })

			// Run the job
			const result = await sandbox.run()

			// Update metrics
			if (result.success) {
				this._metrics.totalSuccess++
			} else {
				this._metrics.totalFailed++
			}
			if (result.timedOut) {
				this._metrics.totalTimedOut++
			}

			// Audit: job completed
			this._audit("execute-complete", {
				jobId,
				taskName,
				containerName: sandbox.name,
				success: result.success,
				exitCode: result.exitCode,
				timedOut: result.timedOut,
				duration: result.duration,
			})

			// Cleanup
			this._active.delete(sandbox.name)
			this._metrics.activeContainers = this._active.size

			if (release) {
				release()
			} else {
				await sandbox.cleanup()
				await sandbox.close()
			}

			return {
				success: result.success,
				jobId,
				taskName,
				exitCode: result.exitCode,
				timedOut: result.timedOut,
				duration: result.duration,
				stdout: result.stdout,
				stderr: result.stderr,
				logPath: result.logPath,
				resourcePressure: pressure.throttle ? pressure : undefined,
			}
		} catch (err) {
			this._metrics.totalFailed++
			this._metrics.totalDockerErrors++

			// Audit: job failed
			this._audit("execute-error", { jobId, taskName, error: err.message })

			return {
				success: false,
				error: err.message,
				jobId,
				taskName,
			}
		}
	}

	/**
	 * Execute a single command inside an existing sandbox container.
	 *
	 * @param {string} containerName - Name of the running container
	 * @param {string} command - Command to execute
	 * @param {object} [options]
	 * @param {number} [options.timeout] - Command timeout in ms
	 * @returns {Promise<object>}
	 */
	async execInContainer(containerName, command, options = {}) {
		const entry = this._active.get(containerName)
		if (!entry) {
			return { success: false, error: `Container ${containerName} not found or not active` }
		}

		try {
			const result = await entry.sandbox.exec(command, options)
			return {
				success: result.exitCode === 0,
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
			}
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Container Management ──────────────────────────────────────────────

	/**
	 * List all active sandbox containers.
	 */
	listActive() {
		return Array.from(this._active.entries()).map(([name, entry]) => ({
			name,
			createdAt: entry.createdAt,
			status: entry.status,
			age: Date.now() - entry.createdAt,
			summary: entry.sandbox.getSummary(),
		}))
	}

	/**
	 * Stop and remove a specific sandbox container.
	 */
	async destroyContainer(containerName) {
		const entry = this._active.get(containerName)
		if (entry) {
			await entry.sandbox.cleanup()
			await entry.sandbox.close()
			this._active.delete(containerName)
			this._metrics.activeContainers = this._active.size
			return { success: true }
		}
		return { success: false, error: `Container ${containerName} not found` }
	}

	/**
	 * Stop and remove all active sandbox containers.
	 */
	async destroyAll() {
		const promises = []
		for (const [name, entry] of this._active) {
			promises.push(
				entry.sandbox
					.cleanup()
					.then(() => entry.sandbox.close())
					.catch(() => {}),
			)
		}
		await Promise.all(promises)
		this._active.clear()
		this._metrics.activeContainers = 0
		return { success: true, destroyed: promises.length }
	}

	// ── Image Management ──────────────────────────────────────────────────

	/**
	 * Check if the sandbox image exists.
	 */
	async imageExists(image) {
		return DockerSandbox.imageExists(image || this.defaultImage)
	}

	/**
	 * Build the sandbox Docker image.
	 */
	async buildImage(dockerfileDir, tag) {
		return DockerSandbox.buildImage(dockerfileDir || path.join(this.sandboxDir), tag || this.defaultImage)
	}

	/**
	 * List all sandbox-related Docker images.
	 */
	async listImages() {
		try {
			const { spawn } = require("child_process")
			return new Promise((resolve) => {
				const proc = spawn(
					"docker",
					[
						"images",
						"--filter",
						"reference=superroo-sandbox*",
						"--format",
						"{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}",
					],
					{ stdio: ["ignore", "pipe", "pipe"] },
				)
				let stdout = ""
				proc.stdout.on("data", (d) => {
					stdout += d.toString()
				})
				proc.on("close", () => {
					const lines = stdout.trim().split("\n").filter(Boolean)
					resolve(
						lines.map((line) => {
							const [repoTag, id, size, created] = line.split("\t")
							return { repoTag, id, size, created }
						}),
					)
				})
				proc.on("error", () => resolve([]))
			})
		} catch {
			return []
		}
	}

	/**
	 * Remove a sandbox Docker image.
	 */
	async removeImage(image) {
		try {
			const { spawn } = require("child_process")
			return new Promise((resolve) => {
				const proc = spawn("docker", ["rmi", "-f", image], {
					stdio: ["ignore", "pipe", "pipe"],
				})
				proc.on("close", (code) => resolve(code === 0))
				proc.on("error", () => resolve(false))
			})
		} catch {
			return false
		}
	}

	// ── Health & Diagnostics ──────────────────────────────────────────────

	/**
	 * Run a comprehensive health check.
	 */
	async healthCheck() {
		const dockerAvailable = await DockerSandbox.isDockerAvailable()
		const imageExists = dockerAvailable ? await this.imageExists() : false
		const runningContainers = dockerAvailable ? await DockerSandbox.listRunning() : []

		return {
			status: dockerAvailable && this._initialized ? "healthy" : "unhealthy",
			dockerAvailable,
			initialized: this._initialized,
			imageExists,
			defaultImage: this.defaultImage,
			activeContainers: this._active.size,
			runningOnHost: runningContainers.length,
			poolStatus: this.pool.getStatus(),
			metrics: { ...this._metrics },
		}
	}

	/**
	 * Get detailed metrics.
	 */
	getMetrics() {
		return {
			...this._metrics,
			activeContainers: this._active.size,
			poolStatus: this.pool.getStatus(),
		}
	}

	// ── Audit Trail ───────────────────────────────────────────────────────

	/**
	 * Write an audit entry for a sandbox operation.
	 * Entries are buffered and flushed periodically.
	 *
	 * @param {string} action - Action type (execute, snapshot, restore, destroy, etc.)
	 * @param {object} details - Action details
	 */
	_audit(action, details = {}) {
		if (!this.enableAudit) return
		const entry = {
			timestamp: new Date().toISOString(),
			action,
			...details,
		}
		this._auditBuffer.push(entry)

		// Flush every 10 entries or on important actions
		if (this._auditBuffer.length >= 10 || ["destroy", "shutdown", "error"].includes(action)) {
			this._flushAudit()
		}
	}

	/**
	 * Flush the audit buffer to disk.
	 */
	async _flushAudit() {
		if (this._auditBuffer.length === 0) return
		try {
			fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true })
			const lines = this._auditBuffer.map((e) => JSON.stringify(e)).join("\n") + "\n"
			fs.appendFileSync(AUDIT_LOG_FILE, lines)
			this._auditBuffer = []
		} catch (err) {
			console.error(`[sandbox-manager] Failed to flush audit log: ${err.message}`)
		}
	}

	/**
	 * Get the audit trail.
	 *
	 * @param {object} [options]
	 * @param {number} [options.limit] - Max entries to return
	 * @param {string} [options.action] - Filter by action type
	 * @returns {object[]}
	 */
	getAuditTrail(options = {}) {
		const limit = options.limit || 100
		const actionFilter = options.action
		try {
			if (!fs.existsSync(AUDIT_LOG_FILE)) return []
			const content = fs.readFileSync(AUDIT_LOG_FILE, "utf8")
			const entries = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line)
					} catch {
						return null
					}
				})
				.filter(Boolean)
			const filtered = actionFilter ? entries.filter((e) => e.action === actionFilter) : entries
			return filtered.slice(-limit)
		} catch {
			return []
		}
	}

	// ── Resource-Aware Scheduling ─────────────────────────────────────────

	/**
	 * Check current system resource usage via CPU Guard.
	 * Returns throttling recommendation if resources are constrained.
	 *
	 * @returns {Promise<{throttle: boolean, reason?: string, cpu?: number, memory?: number}>}
	 */
	async _checkResourcePressure() {
		if (!this.enableResourceAware) return { throttle: false }

		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 3000)

			const res = await fetch(`${CPU_GUARD_URL}/api/system/stats`, {
				signal: controller.signal,
			})
			clearTimeout(timeout)

			if (!res.ok) return { throttle: false }

			const data = await res.json()
			const cpu = data.cpu || data.cpuPercent || 0
			const memory = data.memory || data.memoryPercent || 0

			if (cpu > CPU_HIGH_THRESHOLD) {
				this._metrics.totalResourceThrottles++
				return {
					throttle: true,
					reason: `CPU usage at ${cpu}% (threshold: ${CPU_HIGH_THRESHOLD}%)`,
					cpu,
					memory,
				}
			}

			if (memory > MEM_HIGH_THRESHOLD) {
				this._metrics.totalResourceThrottles++
				return {
					throttle: true,
					reason: `Memory usage at ${memory}% (threshold: ${MEM_HIGH_THRESHOLD}%)`,
					cpu,
					memory,
				}
			}

			return { throttle: false, cpu, memory }
		} catch {
			// CPU Guard unavailable — proceed without throttling
			return { throttle: false }
		}
	}

	/**
	 * Get current resource pressure status.
	 */
	async getResourcePressure() {
		return this._checkResourcePressure()
	}

	// ── Snapshot & Restore ────────────────────────────────────────────────

	/**
	 * Create a snapshot of a running sandbox container.
	 *
	 * @param {string} containerName - Name of the container to snapshot
	 * @param {string} [tag] - Optional tag for the snapshot image
	 * @returns {Promise<object>}
	 */
	async snapshotContainer(containerName, tag) {
		const entry = this._active.get(containerName)
		if (!entry) {
			return { success: false, error: `Container ${containerName} not found` }
		}

		try {
			const result = await entry.sandbox.snapshot(tag)
			if (result.success) {
				this._metrics.totalSnapshots++
				this._audit("snapshot", { containerName, imageId: result.imageId })
			}
			return result
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Restore a container from a snapshot.
	 *
	 * @param {string} containerName - Name of the container to restore
	 * @param {string} snapshotTag - Snapshot image tag to restore from
	 * @returns {Promise<object>}
	 */
	async restoreContainer(containerName, snapshotTag) {
		const entry = this._active.get(containerName)
		if (!entry) {
			return { success: false, error: `Container ${containerName} not found` }
		}

		try {
			const result = await entry.sandbox.restore(snapshotTag)
			if (result.success) {
				this._metrics.totalRestores++
				// Update the active map with the new container name
				this._active.delete(containerName)
				this._active.set(entry.sandbox.name, {
					sandbox: entry.sandbox,
					createdAt: Date.now(),
					status: "running",
				})
				this._audit("restore", { oldName: containerName, newName: entry.sandbox.name, snapshotTag })
			}
			return result
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Self-Healing ──────────────────────────────────────────────────────

	/**
	 * Attempt to self-heal a specific container.
	 *
	 * @param {string} containerName - Name of the container to heal
	 * @returns {Promise<object>}
	 */
	async healContainer(containerName) {
		const entry = this._active.get(containerName)
		if (!entry) {
			return { success: false, error: `Container ${containerName} not found` }
		}

		try {
			const result = await entry.sandbox.selfHeal()
			if (result.healthy) {
				this._metrics.totalSelfHeals++
				// Update active map if container was recreated
				if (result.action === "recreated" && result.oldName) {
					this._active.delete(containerName)
					this._active.set(entry.sandbox.name, {
						sandbox: entry.sandbox,
						createdAt: Date.now(),
						status: "running",
					})
				}
				this._audit("self-heal", { containerName, action: result.action })
			}
			return result
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Self-heal all unhealthy containers.
	 */
	async healAll() {
		const results = []
		for (const [name] of this._active) {
			const result = await this.healContainer(name)
			results.push({ containerName: name, ...result })
		}
		return results
	}

	// ── Shutdown ──────────────────────────────────────────────────────────

	/**
	 * Gracefully shut down the sandbox manager.
	 */
	async shutdown() {
		console.log("[sandbox-manager] Shutting down...")

		// Flush audit trail
		await this._flushAudit()

		// Drain pool
		await this.pool.drain()

		// Destroy all active containers
		await this.destroyAll()

		this._initialized = false
		console.log("[sandbox-manager] Shutdown complete")
	}
}

module.exports = { SandboxManager }
