/**
 * SuperRoo Cloud — SandboxPool
 *
 * Container pooling and reuse system for sandboxed execution.
 * Manages a pool of warm containers to reduce cold-start latency.
 *
 * Features:
 * - Configurable pool size (min/max)
 * - Idle container timeout (auto-cleanup)
 * - Health checks on pooled containers
 * - Graceful drain on shutdown
 * - Metrics for monitoring
 *
 * Inspired by OpenHands's container pooling pattern.
 */

const { DockerSandbox } = require("./DockerSandbox")

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_MIN_POOL = parseInt(process.env.SANDBOX_POOL_MIN || "0", 10)
const DEFAULT_MAX_POOL = parseInt(process.env.SANDBOX_POOL_MAX || "5", 10)
const DEFAULT_IDLE_TIMEOUT_MS = parseInt(process.env.SANDBOX_POOL_IDLE_TIMEOUT || "300000", 10) // 5 min
const DEFAULT_HEALTH_INTERVAL_MS = parseInt(process.env.SANDBOX_POOL_HEALTH_INTERVAL || "60000", 10) // 1 min
const POOL_CLEANUP_INTERVAL_MS = parseInt(process.env.SANDBOX_POOL_CLEANUP_INTERVAL || "30000", 10) // 30s

// ── SandboxPool Class ─────────────────────────────────────────────────────────

class SandboxPool {
	/**
	 * @param {object} options
	 * @param {number} [options.minPool] - Minimum warm containers (default: 0)
	 * @param {number} [options.maxPool] - Maximum warm containers (default: 5)
	 * @param {number} [options.idleTimeout] - Idle timeout in ms (default: 300000)
	 * @param {number} [options.healthInterval] - Health check interval in ms (default: 60000)
	 * @param {object} [options.sandboxDefaults] - Default options for new DockerSandbox instances
	 */
	constructor(options = {}) {
		this.minPool = options.minPool ?? DEFAULT_MIN_POOL
		this.maxPool = options.maxPool ?? DEFAULT_MAX_POOL
		this.idleTimeout = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS
		this.healthInterval = options.healthInterval ?? DEFAULT_HEALTH_INTERVAL_MS
		this.sandboxDefaults = options.sandboxDefaults || {}

		/** @type {Map<string, {sandbox: DockerSandbox, createdAt: number, lastUsed: number, busy: boolean}>} */
		this._pool = new Map()
		this._initialized = false
		this._cleanupTimer = null
		this._healthTimer = null

		// Metrics
		this._metrics = {
			totalCreated: 0,
			totalDestroyed: 0,
			totalReused: 0,
			totalTimeouts: 0,
			totalHealthFails: 0,
			peakPoolSize: 0,
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	/**
	 * Initialize the pool and start background maintenance.
	 */
	async init() {
		if (this._initialized) return
		this._initialized = true

		console.log(
			`[sandbox-pool] Initializing | min=${this.minPool} max=${this.maxPool} idleTimeout=${this.idleTimeout}ms`,
		)

		// Pre-warm minimum pool
		for (let i = 0; i < this.minPool; i++) {
			await this._createWarmContainer()
		}

		// Start cleanup timer
		this._cleanupTimer = setInterval(() => this._cleanupIdle(), POOL_CLEANUP_INTERVAL_MS)
		this._cleanupTimer.unref()

		// Start health check timer
		if (this.healthInterval > 0) {
			this._healthTimer = setInterval(() => this._healthCheck(), this.healthInterval)
			this._healthTimer.unref()
		}

		console.log(`[sandbox-pool] Initialized | warm=${this._pool.size}`)
	}

	/**
	 * Acquire a sandbox from the pool or create a new one.
	 *
	 * @param {object} [options] - Override options for this sandbox
	 * @returns {Promise<{sandbox: DockerSandbox, release: Function}>}
	 */
	async acquire(options = {}) {
		// Try to find an idle, non-busy container
		for (const [id, entry] of this._pool) {
			if (!entry.busy) {
				entry.busy = true
				entry.lastUsed = Date.now()
				this._metrics.totalReused++
				console.log(`[sandbox-pool] Reusing container ${id} (pool size: ${this._pool.size})`)
				return {
					sandbox: entry.sandbox,
					release: () => this._release(id),
				}
			}
		}

		// Pool full? Wait for a release or create if under max
		if (this._pool.size >= this.maxPool) {
			// Wait for a container to become available
			return this._waitForContainer(options)
		}

		// Create a new container
		const sandbox = await this._createContainer(options)
		const id = sandbox.name
		this._pool.set(id, {
			sandbox,
			createdAt: Date.now(),
			lastUsed: Date.now(),
			busy: true,
		})
		this._metrics.totalCreated++
		this._metrics.peakPoolSize = Math.max(this._metrics.peakPoolSize, this._pool.size)

		console.log(`[sandbox-pool] Created container ${id} (pool size: ${this._pool.size})`)

		return {
			sandbox,
			release: () => this._release(id),
		}
	}

	/**
	 * Release a container back to the pool.
	 */
	_release(id) {
		const entry = this._pool.get(id)
		if (entry) {
			entry.busy = false
			entry.lastUsed = Date.now()
			console.log(`[sandbox-pool] Released container ${id}`)
		}
	}

	/**
	 * Wait for a container to become available.
	 */
	async _waitForContainer(options) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error("Sandbox pool timeout — all containers busy"))
			}, 30000)

			const interval = setInterval(() => {
				for (const [id, entry] of this._pool) {
					if (!entry.busy) {
						entry.busy = true
						entry.lastUsed = Date.now()
						this._metrics.totalReused++
						clearTimeout(timeout)
						clearInterval(interval)
						resolve({
							sandbox: entry.sandbox,
							release: () => this._release(id),
						})
						return
					}
				}
			}, 1000)

			const cleanup = () => {
				clearTimeout(timeout)
				clearInterval(interval)
			}
		})
	}

	/**
	 * Create a new warm (idle) container for the pool.
	 */
	async _createWarmContainer() {
		if (this._pool.size >= this.maxPool) return null

		const sandbox = new DockerSandbox({
			jobId: `warm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			commands: ["sleep infinity"],
			...this.sandboxDefaults,
		})

		try {
			await sandbox.init()
			// Start the container with sleep infinity to keep it warm
			sandbox.run().catch(() => {}) // Fire and forget — container runs until removed

			const id = sandbox.name
			this._pool.set(id, {
				sandbox,
				createdAt: Date.now(),
				lastUsed: Date.now(),
				busy: false,
			})
			this._metrics.totalCreated++
			this._metrics.peakPoolSize = Math.max(this._metrics.peakPoolSize, this._pool.size)

			return sandbox
		} catch (err) {
			console.error(`[sandbox-pool] Failed to create warm container: ${err.message}`)
			return null
		}
	}

	/**
	 * Create a new container for immediate use.
	 */
	async _createContainer(options) {
		const sandbox = new DockerSandbox({
			...this.sandboxDefaults,
			...options,
		})
		await sandbox.init()
		return sandbox
	}

	// ── Maintenance ───────────────────────────────────────────────────────

	/**
	 * Clean up idle containers that have exceeded the idle timeout.
	 */
	async _cleanupIdle() {
		const now = Date.now()
		const toRemove = []

		for (const [id, entry] of this._pool) {
			if (entry.busy) continue
			const idleTime = now - entry.lastUsed
			if (idleTime > this.idleTimeout) {
				toRemove.push(id)
			}
		}

		// Don't go below minPool
		const remainingIdle = this._pool.size - toRemove.length - this._countBusy()
		const excess = remainingIdle - this.minPool
		const actuallyRemove = excess < 0 ? toRemove.slice(0, toRemove.length + excess) : toRemove

		for (const id of actuallyRemove) {
			const entry = this._pool.get(id)
			if (entry) {
				await entry.sandbox.cleanup()
				await entry.sandbox.close()
				this._pool.delete(id)
				this._metrics.totalDestroyed++
				console.log(`[sandbox-pool] Cleaned up idle container ${id}`)
			}
		}
	}

	/**
	 * Health check all containers in the pool with self-healing.
	 * Attempts to restart unhealthy containers before removing them.
	 */
	async _healthCheck() {
		for (const [id, entry] of this._pool) {
			try {
				const running = await entry.sandbox.isRunning()
				if (!running) {
					console.warn(`[sandbox-pool] Container ${id} is not running — attempting self-heal`)
					const healResult = await entry.sandbox.selfHeal()
					if (healResult.healthy) {
						console.log(`[sandbox-pool] Self-healed container ${id}: ${healResult.action}`)
						// Update the pool entry with the new container name if recreated
						if (healResult.action === "recreated" && healResult.oldName) {
							this._pool.delete(id)
							this._pool.set(entry.sandbox.name, {
								...entry,
								sandbox: entry.sandbox,
								createdAt: Date.now(),
								lastUsed: Date.now(),
								busy: false,
							})
						}
						continue
					}
					console.warn(`[sandbox-pool] Self-heal failed for ${id} — removing from pool`)
					await entry.sandbox.close()
					this._pool.delete(id)
					this._metrics.totalDestroyed++
					this._metrics.totalHealthFails++
				}
			} catch {
				console.warn(`[sandbox-pool] Health check failed for ${id} — removing`)
				this._pool.delete(id)
				this._metrics.totalDestroyed++
				this._metrics.totalHealthFails++
			}
		}

		// Replenish if below minPool
		while (this._pool.size < this.minPool && this._pool.size < this.maxPool) {
			await this._createWarmContainer()
		}
	}

	_countBusy() {
		let count = 0
		for (const entry of this._pool.values()) {
			if (entry.busy) count++
		}
		return count
	}

	// ── Shutdown ──────────────────────────────────────────────────────────

	/**
	 * Gracefully drain and destroy the pool.
	 */
	async drain() {
		console.log(`[sandbox-pool] Draining pool (${this._pool.size} containers)...`)

		if (this._cleanupTimer) {
			clearInterval(this._cleanupTimer)
			this._cleanupTimer = null
		}
		if (this._healthTimer) {
			clearInterval(this._healthTimer)
			this._healthTimer = null
		}

		const promises = []
		for (const [id, entry] of this._pool) {
			promises.push(
				entry.sandbox
					.cleanup()
					.then(() => entry.sandbox.close())
					.then(() => console.log(`[sandbox-pool] Drained container ${id}`))
					.catch(() => {}),
			)
		}

		await Promise.all(promises)
		this._pool.clear()
		console.log(`[sandbox-pool] Drain complete`)
	}

	// ── Metrics ───────────────────────────────────────────────────────────

	/**
	 * Get pool metrics and status.
	 */
	getStatus() {
		return {
			initialized: this._initialized,
			poolSize: this._pool.size,
			busy: this._countBusy(),
			idle: this._pool.size - this._countBusy(),
			config: {
				minPool: this.minPool,
				maxPool: this.maxPool,
				idleTimeout: this.idleTimeout,
				healthInterval: this.healthInterval,
			},
			metrics: { ...this._metrics },
			containers: Array.from(this._pool.entries()).map(([id, entry]) => ({
				id,
				createdAt: entry.createdAt,
				lastUsed: entry.lastUsed,
				busy: entry.busy,
				idleFor: Date.now() - entry.lastUsed,
			})),
		}
	}
}

module.exports = { SandboxPool }
