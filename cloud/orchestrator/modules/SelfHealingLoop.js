/**
 * Cloud Orchestrator — Self-Healing Loop.
 *
 * Background loop that processes incidents from the HealingBus through
 * a state machine: new → investigating → queued_for_fix → fixing →
 * fix_ready → deployed → verifying → verified.
 *
 * Ported from src/super-roo/healing/SelfHealingLoop.ts for the cloud runtime.
 */

const { IncidentStatus, RootCauseCategory, HealingActionType, isValidTransition } = require("./HealingBus")

// ─── Default config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
	loopIntervalMs: 10000,
	maxIncidentsPerCycle: 5,
	maxFixAttempts: 3,
	escalationMaxRetries: 3,
	backoffBaseMs: 5000,
	backoffMaxMs: 60000,
	autoFixEnabled: true,
	autoDeployEnabled: false,
}

class SelfHealingLoop {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.healingBus - HealingBus instance.
	 * @param {Object} [opts.taskQueue] - Optional TaskQueueBullMQ for creating fix tasks.
	 * @param {Object} [opts.config] - Configuration overrides.
	 */
	constructor(opts = {}) {
		if (!opts.healingBus) {
			throw new Error("SelfHealingLoop requires a healingBus")
		}
		this.healingBus = opts.healingBus
		this.taskQueue = opts.taskQueue || null
		this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) }

		this._running = false
		this._loopHandle = null
		this._failureRecords = new Map()

		this.stats = {
			cyclesRun: 0,
			incidentsProcessed: 0,
			actionsTaken: 0,
			autoFixesApplied: 0,
			escalations: 0,
			lastCycleDuration: 0,
			lastCycleTime: null,
		}
	}

	/**
	 * Start the healing loop.
	 */
	start() {
		if (this._running) return
		this._running = true
		this._scheduleNext()
		console.log("[orchestrator/self-healing] Loop started (interval: " + this.config.loopIntervalMs + "ms)")
	}

	/**
	 * Stop the healing loop.
	 */
	async stop() {
		this._running = false
		if (this._loopHandle) {
			clearTimeout(this._loopHandle)
			this._loopHandle = null
		}
		console.log("[orchestrator/self-healing] Loop stopped")
	}

	_scheduleNext() {
		if (!this._running) return
		this._loopHandle = setTimeout(() => this._runCycle(), this.config.loopIntervalMs)
	}

	async _runCycle() {
		if (!this._running) return
		const startTime = Date.now()

		try {
			const result = await this.runHealingCycle()
			this.stats.cyclesRun++
			this.stats.incidentsProcessed += result.processed
			this.stats.actionsTaken += result.actions.length
			this.stats.lastCycleDuration = Date.now() - startTime
			this.stats.lastCycleTime = new Date().toISOString()
		} catch (err) {
			console.error("[orchestrator/self-healing] Cycle error:", err.message)
		}

		this._scheduleNext()
	}

	/**
	 * Run a single healing cycle manually.
	 * @returns {Promise<{ processed: number, actions: string[] }>}
	 */
	async runHealingCycle() {
		const actions = []
		let processed = 0

		// Get open incidents, prioritizing by severity
		const openIncidents = this.healingBus.listOpen(this.config.maxIncidentsPerCycle)

		// Sort: critical first, then high, then new
		const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
		openIncidents.sort((a, b) => {
			const sa = severityOrder[a.severity] ?? 99
			const sb = severityOrder[b.severity] ?? 99
			if (sa !== sb) return sa - sb
			// Within same severity, older first
			return a.createdAt - b.createdAt
		})

		for (const incident of openIncidents) {
			if (processed >= this.config.maxIncidentsPerCycle) break

			try {
				const action = await this._processIncident(incident)
				if (action) {
					actions.push(action)
				}
				processed++
			} catch (err) {
				console.error(`[orchestrator/self-healing] Error processing incident ${incident.id}:`, err.message)
			}
		}

		return { processed, actions }
	}

	async _processIncident(incident) {
		switch (incident.status) {
			case IncidentStatus.NEW:
				return this._processNewIncident(incident)
			case IncidentStatus.INVESTIGATING:
				return this._processInvestigatingIncident(incident)
			case IncidentStatus.QUEUED_FOR_FIX:
				return this._processQueuedIncident(incident)
			case IncidentStatus.FIXING:
				return this._processFixingIncident(incident)
			case IncidentStatus.FIX_READY:
				return this._processFixReadyIncident(incident)
			case IncidentStatus.DEPLOYED:
				return this._processDeployedIncident(incident)
			case IncidentStatus.VERIFYING:
				return this._processVerifyingIncident(incident)
			case IncidentStatus.REOPENED:
				return this._processReopenedIncident(incident)
			default:
				return null
		}
	}

	async _processNewIncident(incident) {
		// Auto-investigate new incidents
		await this.healingBus.transitionState(
			incident.id,
			IncidentStatus.INVESTIGATING,
			"self-healing-loop",
			"Auto-investigating new incident",
		)
		return `investigated:${incident.id}`
	}

	async _processInvestigatingIncident(incident) {
		// Check if auto-fix is allowed
		if (this.config.autoFixEnabled && this.healingBus.isAutoFixAllowed(incident)) {
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.QUEUED_FOR_FIX,
				"self-healing-loop",
				"Auto-fix allowed, queuing for fix",
			)
			return `queued_for_fix:${incident.id}`
		}

		// If not auto-fixable, escalate
		if (this.shouldEscalate(incident)) {
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.ESCALATED,
				"self-healing-loop",
				"Auto-fix not allowed or max attempts reached",
			)
			this.stats.escalations++
			return `escalated:${incident.id}`
		}

		return null
	}

	async _processQueuedIncident(incident) {
		// Create a fix task in the task queue if available
		if (this.taskQueue) {
			this._queueFixTask(incident)
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.FIXING,
				"self-healing-loop",
				"Fix task queued",
			)
			return `fix_queued:${incident.id}`
		}

		// Without a task queue, mark as fix_ready directly
		await this.healingBus.transitionState(
			incident.id,
			IncidentStatus.FIX_READY,
			"self-healing-loop",
			"No task queue available, marking fix_ready",
		)
		return `fix_ready:${incident.id}`
	}

	async _processFixingIncident(incident) {
		// Check if fix has been in progress too long
		const fixDuration = Date.now() - incident.updatedAt
		if (fixDuration > 5 * 60 * 1000) {
			// 5 minutes timeout
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.REOPENED,
				"self-healing-loop",
				"Fix timed out after 5 minutes",
			)
			return `reopened_timeout:${incident.id}`
		}
		return null
	}

	async _processFixReadyIncident(incident) {
		if (this.config.autoDeployEnabled) {
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.DEPLOYED,
				"self-healing-loop",
				"Auto-deploying fix",
			)
			return `deployed:${incident.id}`
		}
		// Manual deploy required — leave as fix_ready
		return null
	}

	async _processDeployedIncident(incident) {
		// Auto-verify after deploy
		await this.healingBus.transitionState(
			incident.id,
			IncidentStatus.VERIFYING,
			"self-healing-loop",
			"Auto-verifying after deploy",
		)
		return `verifying:${incident.id}`
	}

	async _processVerifyingIncident(incident) {
		// For now, auto-verify after a grace period
		const verifyDuration = Date.now() - incident.updatedAt
		if (verifyDuration > 30 * 1000) {
			// 30 seconds grace period
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.VERIFIED,
				"self-healing-loop",
				"Auto-verified after grace period",
			)
			this.stats.autoFixesApplied++
			return `verified:${incident.id}`
		}
		return null
	}

	async _processReopenedIncident(incident) {
		// Increment fix count and check max attempts
		const newFixCount = (incident.fixCount || 0) + 1
		this.healingBus.updateIncident(incident.id, { fixCount: newFixCount })

		if (newFixCount >= this.config.maxFixAttempts) {
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.ESCALATED,
				"self-healing-loop",
				`Max fix attempts (${this.config.maxFixAttempts}) reached`,
			)
			this.stats.escalations++
			return `escalated_max_attempts:${incident.id}`
		}

		// Re-investigate
		await this.healingBus.transitionState(
			incident.id,
			IncidentStatus.INVESTIGATING,
			"self-healing-loop",
			"Re-investigating after reopen",
		)
		return `reinvestigating:${incident.id}`
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	_queueFixTask(incident) {
		if (!this.taskQueue) return

		const taskInput = {
			type: "healing_fix",
			priority: incident.severity === "critical" ? 1 : incident.severity === "high" ? 2 : 5,
			body: {
				incidentId: incident.id,
				title: incident.title,
				message: incident.message,
				rootCauseCategory: incident.rootCauseCategory,
				source: incident.source,
			},
			source: "self_healing_loop",
			sessionId: incident.id,
		}

		try {
			this.taskQueue.add(taskInput)
		} catch (err) {
			console.error(`[orchestrator/self-healing] Failed to queue fix task for ${incident.id}:`, err.message)
		}
	}

	shouldEscalate(incident) {
		if (incident.fixCount >= this.config.maxFixAttempts) return true
		if (incident.rootCauseCategory === RootCauseCategory.SECURITY) return true
		if (incident.rootCauseCategory === RootCauseCategory.UNKNOWN && incident.fixCount >= 1) return true
		return false
	}

	recordFailure(incident) {
		const key = incident.fingerprint || incident.id
		if (!this._failureRecords.has(key)) {
			this._failureRecords.set(key, [])
		}
		this._failureRecords.get(key).push({
			incidentId: incident.id,
			timestamp: Date.now(),
			status: incident.status,
		})
	}

	clearFailureRecord(incident) {
		const key = incident.fingerprint || incident.id
		this._failureRecords.delete(key)
	}

	/**
	 * Get the current stats.
	 * @returns {Object}
	 */
	getStats() {
		return { ...this.stats }
	}

	/**
	 * Get the current config.
	 * @returns {Object}
	 */
	getConfig() {
		return { ...this.config }
	}

	/**
	 * Update config at runtime.
	 * @param {Object} patch
	 */
	updateConfig(patch) {
		Object.assign(this.config, patch)
	}
}

module.exports = { SelfHealingLoop }
