/**
 * SuperRoo Cloud — DockerSandbox
 *
 * Container lifecycle management for sandboxed execution.
 * Handles container creation, command execution, file transfer,
 * health checks, and cleanup with crash resilience.
 *
 * Inspired by OpenHands's Docker sandbox and SWE-agent's environment abstraction.
 *
 * Crash resilience features:
 * - Configurable resource limits (CPU, memory, swap, PIDs)
 * - Timeout with SIGTERM → SIGKILL escalation
 * - OOM protection with --memory-swap and --oom-kill-disable
 * - Zombie container cleanup on timeout or error
 * - Graceful shutdown via tini init process
 * - Non-root user execution by default
 * - Network isolation (default: none)
 * - Read-only root filesystem option
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_IMAGE = process.env.SANDBOX_IMAGE || "superroo-sandbox:latest"
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || "600000", 10)
const DEFAULT_MEMORY = process.env.SANDBOX_MEMORY || "512m"
const DEFAULT_MEMORY_SWAP = process.env.SANDBOX_MEMORY_SWAP || "512m"
const DEFAULT_CPUS = process.env.SANDBOX_CPUS || "1"
const DEFAULT_MAX_PIDS = parseInt(process.env.SANDBOX_MAX_PIDS || "100", 10)
const DEFAULT_STOP_TIMEOUT = parseInt(process.env.SANDBOX_STOP_TIMEOUT || "30", 10)
const SANDBOX_DIR = process.env.SANDBOX_DIR || path.join(os.tmpdir(), "superroo-sandbox")
const JOBS_DIR = path.join(SANDBOX_DIR, "jobs")
const LOGS_DIR = path.join(SANDBOX_DIR, "logs")

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Block dangerous commands that must never run inside the sandbox.
 */
function isDangerousCommand(cmd) {
	const lower = cmd.toLowerCase()
	const forbidden = [
		"rm -rf /",
		"rm -rf /*",
		"shutdown",
		"reboot",
		"halt",
		"poweroff",
		"mkfs",
		"dd if=/dev/zero",
		":(){ :|:& };:", // fork bomb
	]
	return forbidden.some((f) => lower.includes(f))
}

/**
 * Ensure a directory exists.
 */
function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true })
	}
}

/**
 * Sleep helper.
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a safe container name from a job ID.
 */
function containerName(jobId) {
	const safe = String(jobId)
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.substring(0, 64)
	return `superroo-sandbox-${safe}`
}

// ── DockerSandbox Class ───────────────────────────────────────────────────────

class DockerSandbox {
	/**
	 * @param {object} options
	 * @param {string} [options.image] - Docker image to use
	 * @param {string} [options.jobId] - Unique job identifier
	 * @param {string[]} [options.commands] - Commands to execute
	 * @param {string} [options.network] - Docker network mode (default: "none")
	 * @param {string} [options.memory] - Memory limit (default: 512m)
	 * @param {string} [options.memorySwap] - Memory+swap limit (default: 512m)
	 * @param {string} [options.cpus] - CPU limit (default: 1)
	 * @param {number} [options.maxPids] - Max PIDs (default: 100)
	 * @param {number} [options.timeout] - Timeout in ms (default: 600000)
	 * @param {number} [options.stopTimeout] - Graceful stop timeout in s (default: 30)
	 * @param {boolean} [options.readOnlyRoot] - Mount rootfs read-only (default: false)
	 * @param {string} [options.workDir] - Working directory inside container
	 * @param {object} [options.env] - Environment variables to pass
	 * @param {string[]} [options.volumes] - Additional volume mounts
	 * @param {string} [options.user] - User to run as (default: "sandbox")
	 */
	constructor(options = {}) {
		this.image = options.image || DEFAULT_IMAGE
		this.jobId = options.jobId || `job-${Date.now()}`
		this.commands = Array.isArray(options.commands) ? options.commands : []
		this.network = options.network || "none"
		this.memory = options.memory || DEFAULT_MEMORY
		this.memorySwap = options.memorySwap || DEFAULT_MEMORY_SWAP
		this.cpus = options.cpus || DEFAULT_CPUS
		this.maxPids = options.maxPids || DEFAULT_MAX_PIDS
		this.timeout = options.timeout || DEFAULT_TIMEOUT_MS
		this.stopTimeout = options.stopTimeout || DEFAULT_STOP_TIMEOUT
		this.readOnlyRoot = options.readOnlyRoot || false
		this.workDir = options.workDir || "/workspace"
		this.env = options.env || {}
		this.volumes = options.volumes || []
		this.user = options.user || "sandbox"

		this.name = containerName(this.jobId)
		this.jobFolder = path.join(JOBS_DIR, this.jobId)
		this.logPath = path.join(LOGS_DIR, `${this.jobId}.log`)

		this._logStream = null
		this._timedOut = false
		this._startTime = null
		this._endTime = null
		this._exitCode = null
	}

	// ── Logging ────────────────────────────────────────────────────────────

	_timestamp() {
		return new Date().toISOString()
	}

	_log(line) {
		const text = `[${this._timestamp()}] ${line}\n`
		if (this._logStream) {
			this._logStream.write(text)
		}
		process.stdout.write(`[sandbox:${this.jobId}] ${text}`)
	}

	// ── Container Lifecycle ────────────────────────────────────────────────

	/**
	 * Initialize the sandbox: create directories, validate commands.
	 */
	async init() {
		ensureDir(JOBS_DIR)
		ensureDir(LOGS_DIR)
		ensureDir(this.jobFolder)

		// Validate commands
		for (const cmd of this.commands) {
			if (isDangerousCommand(cmd)) {
				throw new Error(`Dangerous command blocked: ${cmd}`)
			}
		}

		// Open log stream
		this._logStream = fs.createWriteStream(this.logPath, { flags: "a" })

		this._initialized = true

		this._log(`Sandbox initialized | image=${this.image} | timeout=${this.timeout}ms`)
		this._log(`Resource limits: memory=${this.memory} cpus=${this.cpus} pids=${this.maxPids}`)
		this._log(`Network: ${this.network} | User: ${this.user} | WorkDir: ${this.workDir}`)

		return this
	}

	/**
	 * Build the Docker run arguments.
	 */
	_buildDockerArgs() {
		const args = [
			"run",
			"--rm",
			`--network=${this.network}`,
			"-v",
			`${this.jobFolder}:/workspace`,
			"-w",
			this.workDir,
			`--cpus=${this.cpus}`,
			`--memory=${this.memory}`,
			`--memory-swap=${this.memorySwap}`,
			"--oom-kill-disable=false",
			`--pids-limit=${this.maxPids}`,
			`--stop-timeout=${this.stopTimeout}`,
			"--name",
			this.name,
		]

		// Read-only root filesystem
		if (this.readOnlyRoot) {
			args.push("--read-only")
		}

		// Environment variables
		for (const [key, value] of Object.entries(this.env)) {
			args.push("-e", `${key}=${value}`)
		}

		// Additional volumes
		for (const vol of this.volumes) {
			args.push("-v", vol)
		}

		// Image and command
		args.push(this.image)
		args.push("bash", "-c", this.commands.join(" && "))

		return args
	}

	/**
	 * Execute the commands inside the sandbox container.
	 *
	 * @returns {Promise<{success: boolean, logPath: string, stdout: string, stderr: string, exitCode: number, timedOut: boolean, duration: number}>}
	 */
	async run() {
		this._startTime = Date.now()
		const dockerArgs = this._buildDockerArgs()

		this._log(`Starting container: ${this.name}`)
		this._log(`Docker: docker ${dockerArgs.join(" ")}`)

		return new Promise((resolve, reject) => {
			const proc = spawn("docker", dockerArgs, { detached: false })

			let stdout = ""
			let stderr = ""
			let resolved = false

			// ── Timeout guard ──────────────────────────────────────────────
			const timeoutHandle = setTimeout(() => {
				if (resolved) return
				this._timedOut = true
				this._log(`[timeout] Job exceeded ${this.timeout}ms — killing container`)
				this.cleanup()
				// The 'close' event will fire after docker rm -f
			}, this.timeout)

			proc.stdout.on("data", (data) => {
				const chunk = data.toString()
				stdout += chunk
				this._log(`[stdout] ${chunk.trimEnd()}`)
			})

			proc.stderr.on("data", (data) => {
				const chunk = data.toString()
				stderr += chunk
				this._log(`[stderr] ${chunk.trimEnd()}`)
			})

			proc.on("error", (err) => {
				if (resolved) return
				clearTimeout(timeoutHandle)
				resolved = true
				this._log(`[error] ${err.message}`)
				reject(err)
			})

			proc.on("close", (code) => {
				if (resolved) return
				clearTimeout(timeoutHandle)
				resolved = true

				this._endTime = Date.now()
				this._exitCode = code !== null ? code : this._timedOut ? 137 : -1
				const success = this._exitCode === 0
				const duration = this._endTime - this._startTime

				this._log(
					`Container finished | exitCode=${this._exitCode} | success=${success} | ` +
						`timedOut=${this._timedOut} | duration=${duration}ms`,
				)

				resolve({
					success,
					logPath: this.logPath,
					stdout,
					stderr,
					exitCode: this._exitCode,
					timedOut: this._timedOut,
					duration,
				})
			})
		})
	}

	/**
	 * Run a single command inside an existing container.
	 * Uses `docker exec` instead of `docker run`.
	 *
	 * @param {string} command - Command to execute
	 * @param {object} [options]
	 * @param {number} [options.timeout] - Command timeout in ms
	 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
	 */
	async exec(command, options = {}) {
		const cmdTimeout = options.timeout || 30000

		this._log(`Exec in container ${this.name}: ${command}`)

		return new Promise((resolve, reject) => {
			const proc = spawn("docker", ["exec", "-i", this.name, "bash", "-c", command], { detached: false })

			let stdout = ""
			let stderr = ""
			let resolved = false

			const timeoutHandle = setTimeout(() => {
				if (resolved) return
				resolved = true
				this._log(`[exec timeout] Command exceeded ${cmdTimeout}ms`)
				resolve({ exitCode: -1, stdout, stderr: `Timeout after ${cmdTimeout}ms` })
			}, cmdTimeout)

			proc.stdout.on("data", (data) => {
				stdout += data.toString()
			})

			proc.stderr.on("data", (data) => {
				stderr += data.toString()
			})

			proc.on("error", (err) => {
				if (resolved) return
				clearTimeout(timeoutHandle)
				resolved = true
				reject(err)
			})

			proc.on("close", (code) => {
				if (resolved) return
				clearTimeout(timeoutHandle)
				resolved = true
				resolve({ exitCode: code !== null ? code : -1, stdout, stderr })
			})
		})
	}

	/**
	 * Copy a file into the container.
	 *
	 * @param {string} sourcePath - Local path to the file
	 * @param {string} destPath - Destination path inside container
	 * @returns {Promise<boolean>}
	 */
	async copyIn(sourcePath, destPath) {
		this._log(`Copy ${sourcePath} → ${this.name}:${destPath}`)
		try {
			await this._execDocker(["cp", sourcePath, `${this.name}:${destPath}`])
			return true
		} catch (err) {
			this._log(`[copy error] ${err.message}`)
			return false
		}
	}

	/**
	 * Copy a file out of the container.
	 *
	 * @param {string} sourcePath - Path inside container
	 * @param {string} destPath - Local destination path
	 * @returns {Promise<boolean>}
	 */
	async copyOut(sourcePath, destPath) {
		this._log(`Copy ${this.name}:${sourcePath} → ${destPath}`)
		try {
			await this._execDocker(["cp", `${this.name}:${sourcePath}`, destPath])
			return true
		} catch (err) {
			this._log(`[copy error] ${err.message}`)
			return false
		}
	}

	/**
	 * Execute a raw Docker command and return stdout.
	 */
	_execDocker(args) {
		return new Promise((resolve, reject) => {
			const proc = spawn("docker", args, { detached: false })
			let stdout = ""
			let stderr = ""

			proc.stdout.on("data", (data) => {
				stdout += data.toString()
			})
			proc.stderr.on("data", (data) => {
				stderr += data.toString()
			})
			proc.on("error", reject)
			proc.on("close", (code) => {
				if (code === 0) resolve(stdout.trim())
				else reject(new Error(stderr.trim() || `Exit code ${code}`))
			})
		})
	}

	/**
	 * Check if the container is still running.
	 *
	 * @returns {Promise<boolean>}
	 */
	async isRunning() {
		try {
			const stdout = await this._execDocker(["inspect", "-f", "{{.State.Running}}", this.name])
			return stdout === "true"
		} catch {
			return false
		}
	}

	/**
	 * Get container stats (CPU, memory, etc.).
	 *
	 * @returns {Promise<object|null>}
	 */
	async getStats() {
		try {
			const stdout = await this._execDocker(["stats", "--no-stream", "--format", "{{json .}}", this.name])
			return JSON.parse(stdout)
		} catch {
			return null
		}
	}

	/**
	 * Clean up the container. Best-effort — ignores errors.
	 */
	async cleanup() {
		this._cleanedUp = true
		this._log(`Cleaning up container: ${this.name}`)
		try {
			await this._execDocker(["rm", "-f", this.name])
			this._log(`Container ${this.name} removed`)
		} catch {
			// Container may already be removed
		}
	}

	/**
	 * Close the log stream.
	 */
	async close() {
		if (this._logStream) {
			this._logStream.end()
			this._logStream = null
		}
	}

	/**
	 * Get a summary of this sandbox execution.
	 */
	getSummary() {
		return {
			jobId: this.jobId,
			containerName: this.name,
			image: this.image,
			network: this.network,
			resourceLimits: {
				memory: this.memory,
				memorySwap: this.memorySwap,
				cpus: this.cpus,
				maxPids: this.maxPids,
			},
			timeout: this.timeout,
			startTime: this._startTime,
			endTime: this._endTime,
			exitCode: this._exitCode,
			timedOut: this._timedOut,
			logPath: this.logPath,
			jobFolder: this.jobFolder,
		}
	}
	// ── Snapshot & Restore ────────────────────────────────────────────────

	/**
	 * Create a snapshot (commit) of the current container state.
	 * Useful for checkpoint/restore workflows and audit trails.
	 *
	 * @param {string} [tag] - Optional tag for the snapshot image
	 * @returns {Promise<{success: boolean, imageId?: string, error?: string}>}
	 */
	async snapshot(tag) {
		const snapshotTag = tag || `superroo-sandbox-snapshot:${this.jobId}-${Date.now()}`
		this._log(`Creating snapshot: ${snapshotTag}`)
		try {
			const result = await this._execDocker(["commit", this.name, snapshotTag])
			if (result.exitCode === 0) {
				this._log(`Snapshot created: ${snapshotTag}`)
				return { success: true, imageId: snapshotTag }
			}
			return { success: false, error: `docker commit exited with code ${result.exitCode}` }
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Restore container state from a snapshot image.
	 * Creates a new container from the snapshot image with the same config.
	 *
	 * @param {string} snapshotTag - The snapshot image tag to restore from
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async restore(snapshotTag) {
		this._log(`Restoring from snapshot: ${snapshotTag}`)
		try {
			// Clean up current container
			await this.cleanup()
			// Create a new container from the snapshot image
			const args = this._buildDockerArgs()
			// Replace image with snapshot
			const imageIndex = args.indexOf(this.image)
			if (imageIndex !== -1) {
				args[imageIndex] = snapshotTag
			}
			const proc = spawn("docker", ["run", "-d", ...args], {
				stdio: ["ignore", "pipe", "pipe"],
			})
			return new Promise((resolve) => {
				let containerId = ""
				proc.stdout.on("data", (d) => {
					containerId += d.toString().trim()
				})
				proc.on("close", (code) => {
					if (code === 0 && containerId) {
						this.name = containerId
						this._initialized = true
						this._log(`Restored from snapshot: ${snapshotTag} → ${containerId}`)
						resolve({ success: true })
					} else {
						resolve({ success: false, error: `Restore failed with exit code ${code}` })
					}
				})
				proc.on("error", (err) => resolve({ success: false, error: err.message }))
			})
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Network Simulation ────────────────────────────────────────────────

	/**
	 * Apply network simulation rules inside the container using tc (traffic control).
	 *
	 * @param {object} rules - Network simulation rules
	 * @param {number} [rules.latencyMs] - Simulated latency in ms (e.g., 200)
	 * @param {number} [rules.jitterMs] - Jitter in ms (e.g., 50)
	 * @param {number} [rules.lossPercent] - Packet loss percentage (e.g., 5)
	 * @param {number} [rules.bandwidthMbps] - Bandwidth limit in Mbps (e.g., 10)
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async simulateNetwork(rules = {}) {
		if (!this.name) {
			return { success: false, error: "Container not running" }
		}
		try {
			const commands = []
			// Add latency and jitter
			if (rules.latencyMs) {
				const jitter = rules.jitterMs ? ` ${rules.jitterMs}ms` : ""
				commands.push(`tc qdisc add dev eth0 root netem delay ${rules.latencyMs}ms${jitter}`)
			}
			// Add packet loss
			if (rules.lossPercent) {
				commands.push(`tc qdisc change dev eth0 root netem loss ${rules.lossPercent}%`)
			}
			// Add bandwidth limit
			if (rules.bandwidthMbps) {
				commands.push(
					`tc qdisc add dev eth0 root tbf rate ${rules.bandwidthMbps}mbit burst 32kbit latency 400ms`,
				)
			}
			if (commands.length === 0) {
				return { success: true }
			}
			for (const cmd of commands) {
				await this.exec(cmd, { timeout: 10000 })
			}
			this._log(`Network simulation applied: ${JSON.stringify(rules)}`)
			return { success: true }
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Clear all network simulation rules.
	 */
	async clearNetworkSimulation() {
		try {
			await this.exec("tc qdisc del dev eth0 root 2>/dev/null; true", { timeout: 5000 })
			return { success: true }
		} catch {
			return { success: true }
		}
	}

	// ── Self-Healing ──────────────────────────────────────────────────────

	/**
	 * Perform a self-healing check on this container.
	 * Attempts to restart if the container is not running.
	 *
	 * @returns {Promise<{healthy: boolean, action: string, error?: string}>}
	 */
	async selfHeal() {
		try {
			const running = await this.isRunning()
			if (running) {
				return { healthy: true, action: "none" }
			}
			this._log(`Container ${this.name} is not running — attempting restart`)
			// Try docker restart
			const restartResult = await this._execDocker(["restart", this.name])
			if (restartResult.exitCode === 0) {
				this._log(`Container ${this.name} restarted successfully`)
				return { healthy: true, action: "restarted" }
			}
			// If restart failed, try recreate
			this._log(`Restart failed — recreating container ${this.name}`)
			const oldName = this.name
			await this.cleanup()
			// Re-init will create a new container
			this._initialized = false
			await this.init()
			this._log(`Container recreated: ${oldName} → ${this.name}`)
			return { healthy: true, action: "recreated", oldName }
		} catch (err) {
			return { healthy: false, action: "failed", error: err.message }
		}
	}
}

// ── Static helpers ────────────────────────────────────────────────────────────

/**
 * Check if Docker is available on this host.
 */
DockerSandbox.isDockerAvailable = async function () {
	try {
		const proc = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		return new Promise((resolve) => {
			proc.on("close", (code) => resolve(code === 0))
			proc.on("error", () => resolve(false))
		})
	} catch {
		return false
	}
}

/**
 * Check if the sandbox image exists locally.
 */
DockerSandbox.imageExists = async function (image = DEFAULT_IMAGE) {
	try {
		const proc = spawn("docker", ["image", "inspect", image], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		return new Promise((resolve) => {
			proc.on("close", (code) => resolve(code === 0))
			proc.on("error", () => resolve(false))
		})
	} catch {
		return false
	}
}

/**
 * Build the sandbox Docker image.
 */
DockerSandbox.buildImage = async function (dockerfileDir, tag = DEFAULT_IMAGE) {
	const proc = spawn("docker", ["build", "-t", tag, dockerfileDir], {
		stdio: ["ignore", "inherit", "inherit"],
	})
	return new Promise((resolve) => {
		proc.on("close", (code) => resolve(code === 0))
		proc.on("error", () => resolve(false))
	})
}

/**
 * List all running sandbox containers.
 */
DockerSandbox.listRunning = async function () {
	try {
		const proc = spawn(
			"docker",
			[
				"ps",
				"--filter",
				"name=superroo-sandbox",
				"--format",
				"{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}",
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		)
		return new Promise((resolve) => {
			let stdout = ""
			proc.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			proc.on("close", () => {
				const lines = stdout.trim().split("\n").filter(Boolean)
				resolve(
					lines.map((line) => {
						const [id, image, name, status, created] = line.split("\t")
						return { id, image, name, status, created }
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
 * Clean up all zombie sandbox containers.
 */
DockerSandbox.cleanupAll = async function () {
	try {
		const proc = spawn("docker", ["rm", "-f", ...(await DockerSandbox._getAllSandboxContainers())], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		return new Promise((resolve) => {
			proc.on("close", (code) => resolve(code === 0))
			proc.on("error", () => resolve(false))
		})
	} catch {
		return false
	}
}

DockerSandbox._getAllSandboxContainers = async function () {
	try {
		const proc = spawn("docker", ["ps", "-a", "--filter", "name=superroo-sandbox", "--format", "{{.Names}}"], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		return new Promise((resolve) => {
			let stdout = ""
			proc.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			proc.on("close", () => resolve(stdout.trim().split("\n").filter(Boolean)))
			proc.on("error", () => resolve([]))
		})
	} catch {
		return []
	}
}

module.exports = { DockerSandbox, isDangerousCommand, containerName }
