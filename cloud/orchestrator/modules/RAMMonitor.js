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
 * Integrates with CPUGuard's getRamUsagePercent() for consistent measurements.
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
		this.logger = options.logger ?? console

		/** @type {"normal"|"warning"|"critical"|"danger"} */
		this._currentState = "normal"
		this._running = false
		this._pollHandle = null
		this._history = [] // { timestamp, ramPercent, freeMb, totalMb }
		this._maxHistorySamples = Math.ceil(this.sampleWindowMs / this.pollIntervalMs) + 10
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
		return { ramPercent, freeMb, totalMb, usedMb, timestamp: Date.now() }
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
			},
			historySamples: this._history.length,
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
	}

	/**
	 * Evaluate current RAM state against thresholds and emit events on transitions.
	 * @param {{ ramPercent: number, freeMb: number, totalMb: number, usedMb: number, timestamp: number }} snapshot
	 */
	_evaluateState(snapshot) {
		const { ramPercent, freeMb, totalMb, usedMb } = snapshot
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
				trend: this.getTrend(),
				timestamp: Date.now(),
			}

			this.logger.warn(
				`[RAM-Monitor] State transition: ${prevState} → ${newState} | RAM=${ramPercent}% (${usedMb}MB/${totalMb}MB)`,
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
			timestamp: Date.now(),
		})
	}
}

module.exports = { RAMMonitor, DEFAULT_THRESHOLDS }
