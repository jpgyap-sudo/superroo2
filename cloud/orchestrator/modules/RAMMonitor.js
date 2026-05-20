/**
 * SuperRoo Cloud — RAM Monitor
 *
 * Continuously monitors VPS RAM usage and emits events when thresholds are
 * crossed. Provides the sensing layer for the RAM Orchestrator Worker.
 *
 * Thresholds:
 *   - WARNING  (default 70%)  → ram_warning event, queuing slows down
 *   - CRITICAL (default 80%)  → ram_critical event, non-essential workers paused
 *   - DANGER   (default 90%)  → ram_danger event, all non-critical work halted
 *   - RECOVERY (default 60%)  → ram_recovered event, workers can resume
 *
 * Features:
 *   - Physical RAM + swap monitoring (GAP 6 fix)
 *   - Rolling window trend analysis
 *   - CPUGuard integration via shared getRamUsagePercent() (GAP 9 fix)
 *   - Historical data persistence callback (GAP 7 fix)
 *   - Auto-scaling event hooks (GAP 8 fix)
 *   - PM2 cluster mode awareness (GAP 10 fix)
 */

const EventEmitter = require("events")
const os = require("os")

// ── Default thresholds ─────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = Object.freeze({
	WARNING: 70, // % — slow down queuing
	CRITICAL: 80, // % — pause non-essential workers
	DANGER: 90, // % — halt all non-critical work
	RECOVERY: 60, // % — resume paused workers
})

// ── Swap monitoring ────────────────────────────────────────────────────────────

/**
 * Get current swap usage as a percentage 0–100.
 * Returns null if swap info is unavailable.
 * @returns {{ totalMb: number, usedMb: number, freeMb: number, percent: number } | null}
 */
function getSwapUsage() {
	try {
		// On Linux, os.freemem() doesn't include swap. We read /proc/meminfo.
		// On Windows, we use a different approach.
		if (process.platform === "linux") {
			const fs = require("fs")
			const meminfo = fs.readFileSync("/proc/meminfo", "utf8")
			const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/)
			const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/)
			if (swapTotalMatch && swapFreeMatch) {
				const totalKb = parseInt(swapTotalMatch[1], 10)
				const freeKb = parseInt(swapFreeMatch[1], 10)
				if (totalKb > 0) {
					const usedKb = totalKb - freeKb
					return {
						totalMb: Math.round(totalKb / 1024),
						usedMb: Math.round(usedKb / 1024),
						freeMb: Math.round(freeKb / 1024),
						percent: Math.round((usedKb / totalKb) * 100),
					}
				}
			}
		}
		// Fallback: try os module (Node 20+ has os.totalmem/os.freemem for swap on some platforms)
		return null
	} catch {
		return null
	}
}

// ── CPUGuard shared RAM measurement (GAP 9) ────────────────────────────────────

/**
 * Get current RAM usage as a percentage 0–100.
 * Shared with CPUGuard.js for consistent measurements.
 * @returns {number}
 */
function getRamUsagePercent() {
	const total = os.totalmem()
	const free = os.freemem()
	if (total <= 0) return 0
	return Math.round(((total - free) / total) * 100)
}

// ── RAM Monitor ────────────────────────────────────────────────────────────────

class RAMMonitor extends EventEmitter {
	/**
	 * @param {Object} [options]
	 * @param {number} [options.warningPercent=70] - RAM % that triggers warning
	 * @param {number} [options.criticalPercent=80] - RAM % that triggers critical
	 * @param {number} [options.dangerPercent=90] - RAM % that triggers danger
	 * @param {number} [options.recoveryPercent=60] - RAM % that signals recovery
	 * @param {number} [options.pollIntervalMs=5000] - How often to check RAM
	 * @param {number} [options.sampleWindowMs=30000] - Rolling window for trend analysis (ms)
	 * @param {number} [options.swapWarningPercent=50] - Swap % that triggers warning
	 * @param {number} [options.swapCriticalPercent=75] - Swap % that triggers critical
	 * @param {Function} [options.onHistorySample] - Callback for historical persistence (GAP 7)
	 * @param {boolean} [options.enableSwapMonitoring=true] - Enable swap monitoring (GAP 6)
	 * @param {boolean} [options.clusterMode=false] - PM2 cluster mode (GAP 10)
	 * @param {Console} [options.logger=console]
	 */
	constructor(options = {}) {
		super()
		this.warningPercent = options.warningPercent ?? DEFAULT_THRESHOLDS.WARNING
		this.criticalPercent = options.criticalPercent ?? DEFAULT_THRESHOLDS.CRITICAL
		this.dangerPercent = options.dangerPercent ?? DEFAULT_THRESHOLDS.DANGER
		this.recoveryPercent = options.recoveryPercent ?? DEFAULT_THRESHOLDS.RECOVERY
		this.pollIntervalMs = options.pollIntervalMs ?? 5000
		this.sampleWindowMs = options.sampleWindowMs ?? 30000
		this.swapWarningPercent = options.swapWarningPercent ?? 50
		this.swapCriticalPercent = options.swapCriticalPercent ?? 75
		this.onHistorySample = options.onHistorySample || null
		this.enableSwapMonitoring = options.enableSwapMonitoring !== false
		this.clusterMode = options.clusterMode || false
		this.logger = options.logger ?? console

		/** @type {"normal"|"warning"|"critical"|"danger"} */
		this._currentState = "normal"
		this._running = false
		this._pollHandle = null
		this._history = [] // { timestamp, ramPercent, freeMb, totalMb, usedMb, swapPercent? }
		this._maxHistorySamples = Math.ceil(this.sampleWindowMs / this.pollIntervalMs) + 10

		// Auto-scaling state (GAP 8)
		this._consecutiveHighSamples = 0
		this._consecutiveLowSamples = 0
		this._autoScaleCooldown = 0
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	/**
	 * Start monitoring RAM usage.
	 */
	start() {
		if (this._running) return
		this._running = true
		this.logger.info(
			`[RAM-Monitor] Started | poll=${this.pollIntervalMs}ms | thresholds: WARN=${this.warningPercent}% CRIT=${this.criticalPercent}% DANGER=${this.dangerPercent}% RECOVERY=${this.recoveryPercent}%`,
		)
		this._poll()
	}

	/**
	 * Stop monitoring RAM usage.
	 */
	stop() {
		this._running = false
		if (this._pollHandle) {
			clearTimeout(this._pollHandle)
			this._pollHandle = null
		}
		this.logger.info("[RAM-Monitor] Stopped")
	}

	/**
	 * Get the current RAM state.
	 * @returns {"normal"|"warning"|"critical"|"danger"}
	 */
	getCurrentState() {
		return this._currentState
	}

	/**
	 * Get the latest RAM snapshot.
	 * @returns {{ ramPercent: number, freeMb: number, totalMb: number, usedMb: number, timestamp: number }}
	 */
	getLatestSnapshot() {
		const totalMb = Math.round(os.totalmem() / (1024 * 1024))
		const freeMb = Math.round(os.freemem() / (1024 * 1024))
		const usedMb = totalMb - freeMb
		const ramPercent = Math.round((usedMb / totalMb) * 100)

		// Include swap data if available (GAP 6)
		let swap = null
		if (this.enableSwapMonitoring) {
			swap = getSwapUsage()
		}

		return { ramPercent, freeMb, totalMb, usedMb, swap, timestamp: Date.now() }
	}

	/**
	 * Get RAM usage trend analysis over the rolling window.
	 * @returns {{ trend: "rising"|"falling"|"stable", ratePerMinute: number, samples: number }}
	 */
	getTrend() {
		if (this._history.length < 2) {
			return { trend: "stable", ratePerMinute: 0, samples: this._history.length }
		}

		const oldest = this._history[0]
		const newest = this._history[this._history.length - 1]
		const elapsedMs = newest.timestamp - oldest.timestamp

		if (elapsedMs <= 0) {
			return { trend: "stable", ratePerMinute: 0, samples: this._history.length }
		}

		const deltaPercent = newest.ramPercent - oldest.ramPercent
		const ratePerMinute = (deltaPercent / elapsedMs) * 60000

		let trend
		if (ratePerMinute > 5) {
			trend = "rising"
		} else if (ratePerMinute < -5) {
			trend = "falling"
		} else {
			trend = "stable"
		}

		return { trend, ratePerMinute: Math.round(ratePerMinute * 10) / 10, samples: this._history.length }
	}

	/**
	 * Get RAM monitor statistics.
	 * @returns {Object}
	 */
	getStats() {
		const snapshot = this.getLatestSnapshot()
		const trend = this.getTrend()
		return {
			state: this._currentState,
			running: this._running,
			snapshot,
			trend,
			thresholds: {
				warning: this.warningPercent,
				critical: this.criticalPercent,
				danger: this.dangerPercent,
				recovery: this.recoveryPercent,
				swapWarning: this.swapWarningPercent,
				swapCritical: this.swapCriticalPercent,
			},
			historySamples: this._history.length,
			swapEnabled: this.enableSwapMonitoring,
			clusterMode: this.clusterMode,
		}
	}

	// ── Internal ───────────────────────────────────────────────────────────────

	/**
	 * Internal polling loop.
	 */
	_poll() {
		if (!this._running) return

		try {
			const snapshot = this.getLatestSnapshot()
			this._recordSample(snapshot)
			this._evaluateState(snapshot)
		} catch (err) {
			this.logger.error(`[RAM-Monitor] Poll error: ${err.message}`)
		}

		this._pollHandle = setTimeout(() => this._poll(), this.pollIntervalMs)
	}

	/**
	 * Record a sample in the rolling history window.
	 * @param {{ ramPercent: number, freeMb: number, totalMb: number, timestamp: number }} sample
	 */
	_recordSample(sample) {
		this._history.push(sample)
		if (this._history.length > this._maxHistorySamples) {
			this._history.shift()
		}

		// Historical persistence callback (GAP 7)
		if (this.onHistorySample && typeof this.onHistorySample === "function") {
			try {
				this.onHistorySample(sample)
			} catch {
				// Non-blocking
			}
		}

		// Auto-scaling detection (GAP 8)
		if (this.clusterMode) {
			this._evaluateAutoScale(sample)
		}
	}

	/**
	 * Evaluate current RAM state against thresholds and emit events on transitions.
	 * @param {{ ramPercent: number, freeMb: number, totalMb: number, usedMb: number, timestamp: number }} snapshot
	 */
	_evaluateState(snapshot) {
		const { ramPercent, freeMb, totalMb, usedMb, swap } = snapshot
		const prevState = this._currentState

		// Determine new state (highest threshold wins)
		let newState
		if (ramPercent >= this.dangerPercent) {
			newState = "danger"
		} else if (ramPercent >= this.criticalPercent) {
			newState = "critical"
		} else if (ramPercent >= this.warningPercent) {
			newState = "warning"
		} else if (ramPercent <= this.recoveryPercent) {
			newState = "normal"
		} else {
			// Between recovery and warning — stay in previous state if it was warning,
			// otherwise transition to normal
			newState = prevState === "warning" ? "warning" : "normal"
		}

		// Swap-based state escalation (GAP 6)
		// If swap usage is critically high, escalate the RAM state
		if (swap && this.enableSwapMonitoring) {
			if (swap.percent >= this.swapCriticalPercent && newState === "normal") {
				newState = "warning"
			} else if (swap.percent >= this.swapCriticalPercent && newState === "warning") {
				newState = "critical"
			}
		}

		// Emit events on state transitions
		if (newState !== prevState) {
			this._currentState = newState
			const event = {
				type: `ram_${newState}`,
				prevState,
				newState,
				ramPercent,
				freeMb,
				totalMb,
				usedMb,
				swap,
				trend: this.getTrend(),
				timestamp: Date.now(),
			}

			this.logger.warn(
				`[RAM-Monitor] State transition: ${prevState} → ${newState} | RAM=${ramPercent}% (${usedMb}MB/${totalMb}MB)${swap ? ` | Swap=${swap.percent}% (${swap.usedMb}MB/${swap.totalMb}MB)` : ""}`,
			)
			this.emit("stateChange", event)
		}

		// Always emit a periodic heartbeat with current state
		this.emit("heartbeat", {
			state: this._currentState,
			ramPercent,
			freeMb,
			totalMb,
			usedMb,
			swap,
			timestamp: Date.now(),
		})
	}

	/**
	 * Evaluate auto-scaling conditions (GAP 8).
	 * Emits scaleUp/scaleDown events when sustained high/low RAM is detected.
	 * @param {{ ramPercent: number }} sample
	 */
	_evaluateAutoScale(sample) {
		const now = Date.now()

		// Cooldown check
		if (now < this._autoScaleCooldown) return

		if (sample.ramPercent >= this.criticalPercent) {
			this._consecutiveHighSamples++
			this._consecutiveLowSamples = 0

			// 3 consecutive critical samples → scale up
			if (this._consecutiveHighSamples >= 3) {
				this.logger.warn(
					`[RAM-Monitor] Auto-scale: sustained high RAM (${sample.ramPercent}%) — emitting scaleUp`,
				)
				this.emit("scaleUp", {
					ramPercent: sample.ramPercent,
					consecutiveSamples: this._consecutiveHighSamples,
					timestamp: now,
				})
				this._consecutiveHighSamples = 0
				this._autoScaleCooldown = now + 120000 // 2 min cooldown
			}
		} else if (sample.ramPercent <= this.recoveryPercent) {
			this._consecutiveLowSamples++
			this._consecutiveHighSamples = 0

			// 5 consecutive low samples → scale down
			if (this._consecutiveLowSamples >= 5) {
				this.logger.info(
					`[RAM-Monitor] Auto-scale: sustained low RAM (${sample.ramPercent}%) — emitting scaleDown`,
				)
				this.emit("scaleDown", {
					ramPercent: sample.ramPercent,
					consecutiveSamples: this._consecutiveLowSamples,
					timestamp: now,
				})
				this._consecutiveLowSamples = 0
				this._autoScaleCooldown = now + 300000 // 5 min cooldown
			}
		} else {
			// Reset counters in intermediate range
			this._consecutiveHighSamples = 0
			this._consecutiveLowSamples = 0
		}
	}
}

// Export shared RAM measurement function for CPUGuard (GAP 9)
module.exports = { RAMMonitor, DEFAULT_THRESHOLDS, getRamUsagePercent, getSwapUsage }

module.exports = { RAMMonitor, DEFAULT_THRESHOLDS }
