/**
 * SuperRoo Cloud — ComposeSandbox
 *
 * Multi-container sandbox orchestration using Docker Compose.
 * Enables complex multi-service workflows (e.g., app + database + cache)
 * within isolated sandbox environments.
 *
 * Features:
 * - Dynamic docker-compose.yml generation
 * - Per-service resource limits
 * - Service dependency ordering
 * - Health check waiting
 * - Log aggregation across services
 * - Snapshot/restore for the entire composition
 * - Tear-down and cleanup
 *
 * Usage:
 *   const compose = new ComposeSandbox({
 *     projectName: "test-suite-123",
 *     services: {
 *       app: { image: "node:20", command: "npm test", dependsOn: ["db"] },
 *       db: { image: "postgres:16", env: { POSTGRES_PASSWORD: "test" } },
 *     },
 *   })
 *   await compose.up()
 *   const logs = await compose.logs("app")
 *   await compose.down()
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { v4: uuidv4 } = require("uuid")

// ── Configuration ─────────────────────────────────────────────────────────────

const COMPOSE_DIR = process.env.SANDBOX_COMPOSE_DIR || path.join(os.tmpdir(), "superroo-compose")
const COMPOSE_TIMEOUT_MS = parseInt(process.env.SANDBOX_COMPOSE_TIMEOUT || "120000", 10)

// ── ComposeSandbox Class ──────────────────────────────────────────────────────

class ComposeSandbox {
	/**
	 * @param {object} options
	 * @param {string} [options.projectName] - Docker Compose project name
	 * @param {object} options.services - Service definitions keyed by service name
	 * @param {string} [options.workDir] - Working directory for compose files
	 * @param {number} [options.timeout] - Default timeout for compose operations
	 */
	constructor(options = {}) {
		this.projectName = options.projectName || `sandbox-${uuidv4().slice(0, 8)}`
		this.services = options.services || {}
		this.workDir = options.workDir || path.join(COMPOSE_DIR, this.projectName)
		this.timeout = options.timeout || COMPOSE_TIMEOUT_MS

		/** @type {Map<string, object>} */
		this._serviceStatus = new Map()
		this._composeFile = path.join(this.workDir, "docker-compose.yml")
		this._initialized = false
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	/**
	 * Initialize the compose environment.
	 * Creates the working directory and generates docker-compose.yml.
	 */
	async init() {
		if (this._initialized) return
		this._initialized = true

		fs.mkdirSync(this.workDir, { recursive: true })
		this._generateComposeFile()
		console.log(`[compose-sandbox] Initialized project ${this.projectName} at ${this.workDir}`)
	}

	/**
	 * Start all services defined in the composition.
	 * Waits for services to become healthy if health checks are configured.
	 *
	 * @param {object} [options]
	 * @param {boolean} [options.wait] - Wait for all services to be healthy (default: true)
	 * @param {number} [options.timeout] - Timeout in ms for startup
	 * @returns {Promise<{success: boolean, services: object[], error?: string}>}
	 */
	async up(options = {}) {
		const wait = options.wait !== false
		const timeout = options.timeout || this.timeout

		await this.init()

		try {
			const result = await this._runCompose(["up", "-d", "--remove-orphans"], timeout)
			if (!result.success) {
				return { success: false, services: [], error: result.error }
			}

			// Update service status
			for (const serviceName of Object.keys(this.services)) {
				this._serviceStatus.set(serviceName, { status: "starting" })
			}

			// Wait for services to be healthy
			if (wait) {
				await this._waitForServices(timeout)
			}

			// Get final status
			const services = await this.ps()
			console.log(`[compose-sandbox] Project ${this.projectName} is up (${services.length} services)`)
			return { success: true, services }
		} catch (err) {
			return { success: false, services: [], error: err.message }
		}
	}

	/**
	 * Stop and remove all services.
	 */
	async down() {
		try {
			await this._runCompose(["down", "--volumes", "--remove-orphans"], 60000)
			this._serviceStatus.clear()
			console.log(`[compose-sandbox] Project ${this.projectName} torn down`)
			return { success: true }
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Service Management ─────────────────────────────────────────────────

	/**
	 * Execute a command in a specific service container.
	 *
	 * @param {string} serviceName - Name of the service
	 * @param {string} command - Command to execute
	 * @param {object} [options]
	 * @param {number} [options.timeout] - Command timeout
	 * @returns {Promise<{success: boolean, stdout?: string, stderr?: string, exitCode?: number}>}
	 */
	async exec(serviceName, command, options = {}) {
		const timeout = options.timeout || 60000
		try {
			const result = await this._runCompose(["exec", "-T", serviceName, "sh", "-c", command], timeout)
			return {
				success: result.exitCode === 0,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
			}
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Get logs from a specific service or all services.
	 *
	 * @param {string} [serviceName] - Optional service name filter
	 * @returns {Promise<string>}
	 */
	async logs(serviceName) {
		const args = ["logs", "--no-color", "--tail", "100"]
		if (serviceName) args.push(serviceName)
		try {
			const result = await this._runCompose(args, 30000)
			return result.stdout || ""
		} catch {
			return ""
		}
	}

	/**
	 * List running services and their status.
	 */
	async ps() {
		try {
			const result = await this._runCompose(["ps", "--format", "json"], 15000)
			if (!result.stdout) return []
			return result.stdout
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line)
					} catch {
						return { name: line.trim() }
					}
				})
		} catch {
			return []
		}
	}

	/**
	 * Restart a specific service.
	 */
	async restartService(serviceName) {
		try {
			await this._runCompose(["restart", serviceName], 30000)
			return { success: true }
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Snapshots ──────────────────────────────────────────────────────────

	/**
	 * Create a snapshot of the entire composition.
	 * Commits all running service containers to images.
	 *
	 * @param {string} [tag] - Optional base tag for snapshot images
	 * @returns {Promise<{success: boolean, snapshots: object[], error?: string}>}
	 */
	async snapshot(tag) {
		const baseTag = tag || `superroo-compose-snapshot-${this.projectName}`
		const snapshots = []

		try {
			const services = await this.ps()
			for (const svc of services) {
				const containerName = svc.Name || svc.name
				if (!containerName) continue

				const snapshotTag = `${baseTag}-${svc.Service || "unknown"}-${Date.now()}`
				const { spawn } = require("child_process")
				const result = await new Promise((resolve) => {
					const proc = spawn("docker", ["commit", containerName, snapshotTag], {
						stdio: ["ignore", "pipe", "pipe"],
					})
					let stdout = ""
					proc.stdout.on("data", (d) => {
						stdout += d.toString()
					})
					proc.on("close", (code) => resolve({ success: code === 0, imageId: stdout.trim() }))
					proc.on("error", () => resolve({ success: false }))
				})
				snapshots.push({
					service: svc.Service || "unknown",
					container: containerName,
					snapshotTag,
					success: result.success,
				})
			}
			return { success: snapshots.some((s) => s.success), snapshots }
		} catch (err) {
			return { success: false, snapshots, error: err.message }
		}
	}

	// ── Internal ───────────────────────────────────────────────────────────

	/**
	 * Generate docker-compose.yml from service definitions.
	 */
	_generateComposeFile() {
		const compose = {
			version: "3.8",
			services: {},
		}

		for (const [name, svc] of Object.entries(this.services)) {
			const serviceDef = {
				image: svc.image || "superroo-sandbox:latest",
				container_name: `${this.projectName}-${name}`,
				networks: svc.network ? [svc.network] : undefined,
				environment: svc.env || undefined,
				command: svc.command || undefined,
				depends_on: svc.dependsOn || undefined,
				restart: svc.restart || "no",
				volumes: svc.volumes || undefined,
				working_dir: svc.workDir || undefined,
			}

			// Resource limits
			if (svc.memory || svc.cpus) {
				serviceDef.deploy = {
					resources: {
						limits: {},
					},
				}
				if (svc.memory) serviceDef.deploy.resources.limits.memory = svc.memory
				if (svc.cpus) serviceDef.deploy.resources.limits.cpus = svc.cpus
			}

			// Health check
			if (svc.healthCheck) {
				serviceDef.healthcheck = {
					test: svc.healthCheck.test || ["CMD", "echo", "ok"],
					interval: svc.healthCheck.interval || "30s",
					timeout: svc.healthCheck.timeout || "10s",
					retries: svc.healthCheck.retries || 3,
					start_period: svc.healthCheck.startPeriod || "10s",
				}
			}

			// Ports
			if (svc.ports) {
				serviceDef.ports = svc.ports
			}

			compose.services[name] = serviceDef
		}

		// Networks
		const networks = new Set()
		for (const svc of Object.values(this.services)) {
			if (svc.network) networks.add(svc.network)
		}
		if (networks.size > 0) {
			compose.networks = {}
			for (const net of networks) {
				compose.networks[net] = { driver: "bridge" }
			}
		}

		fs.writeFileSync(this._composeFile, JSON.stringify(compose, null, 2))
	}

	/**
	 * Wait for all services to become healthy.
	 */
	async _waitForServices(timeout) {
		const startTime = Date.now()
		const serviceNames = Object.keys(this.services)

		while (Date.now() - startTime < timeout) {
			const allHealthy = serviceNames.every((name) => {
				const status = this._serviceStatus.get(name)
				return status && status.status === "healthy"
			})
			if (allHealthy) return

			// Check current status
			try {
				const ps = await this.ps()
				for (const svc of ps) {
					const serviceName = svc.Service || svc.name
					if (!serviceName) continue
					const state = (svc.State || svc.state || "").toLowerCase()
					const health = (svc.Health || svc.health || "").toLowerCase()
					if (health === "healthy") {
						this._serviceStatus.set(serviceName, { status: "healthy" })
					} else if (state === "running") {
						this._serviceStatus.set(serviceName, { status: "running" })
					}
				}
			} catch {
				// Ignore errors during polling
			}

			await new Promise((r) => setTimeout(r, 2000))
		}
	}

	/**
	 * Run a docker-compose command.
	 */
	async _runCompose(args, timeout) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				proc.kill()
				reject(new Error(`Compose command timed out after ${timeout}ms: docker compose ${args.join(" ")}`))
			}, timeout)

			const proc = spawn("docker", ["compose", ...args], {
				cwd: this.workDir,
				env: { ...process.env, COMPOSE_PROJECT_NAME: this.projectName },
				stdio: ["ignore", "pipe", "pipe"],
			})

			let stdout = ""
			let stderr = ""

			proc.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			proc.stderr.on("data", (d) => {
				stderr += d.toString()
			})

			proc.on("close", (code) => {
				clearTimeout(timer)
				resolve({
					success: code === 0,
					exitCode: code,
					stdout,
					stderr,
				})
			})

			proc.on("error", (err) => {
				clearTimeout(timer)
				reject(err)
			})
		})
	}
}

module.exports = { ComposeSandbox }
