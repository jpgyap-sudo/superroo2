/**
 * Cloud Orchestrator — Self-Healing Loop.
 *
 * Background loop that processes incidents from the HealingBus through
 * a state machine: new → investigating → queued_for_fix → fixing →
 * fix_ready → deployed → verifying → verified.
 *
 * Ported from src/super-roo/healing/SelfHealingLoop.ts for the cloud runtime.
 */

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { IncidentStatus, RootCauseCategory, HealingActionType, isValidTransition } = require("./HealingBus")

const REPAIR_RUNS_LOG = process.env.REPAIR_RUNS_LOG_PATH || path.join(__dirname, "..", "data", "repair-runs.jsonl")

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
	// Fingerprint escalation: if the same failure fingerprint appears this many times
	// without a fix, escalate immediately and fire a Telegram alert.
	fingerprintEscalationThreshold: 3,
}

/**
 * Compute a stable fingerprint for a failure.
 * Based on: test name + error message + source file.
 * Identical failures across separate incidents share the same fingerprint,
 * which triggers escalation when seen fingerprintEscalationThreshold times.
 *
 * @param {object} incident
 * @returns {string} 8-char hex prefix of SHA-256
 */
function computeFingerprint(incident) {
	const raw = [incident.title || "", incident.message || "", incident.source || ""].join("|")
	return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)
}

class SelfHealingLoop {
	/**
	 * Accepts two calling conventions:
	 *
	 *   new SelfHealingLoop({ healingBus, taskQueue?, config? })
	 *     — canonical form used by tests and direct callers.
	 *
	 *   new SelfHealingLoop(orchestrator, opts?)
	 *     — legacy form used by api.js: first arg is the CloudOrchestrator
	 *       instance whose .healingBus and .taskQueue properties are used.
	 *
	 * Both forms merge opts into DEFAULT_CONFIG.
	 *
	 * @param {Object} optsOrOrchestrator
	 * @param {Object} [legacyOpts]
	 */
	constructor(optsOrOrchestrator = {}, legacyOpts = {}) {
		// Detect legacy call: first arg is an orchestrator (has .healingBus property)
		let healingBus, taskQueue, configOverrides
		if (
			optsOrOrchestrator &&
			optsOrOrchestrator.healingBus !== undefined &&
			typeof optsOrOrchestrator.submit !== "function"
		) {
			// Canonical form: { healingBus, taskQueue?, config? }
			healingBus = optsOrOrchestrator.healingBus
			taskQueue = optsOrOrchestrator.taskQueue || null
			configOverrides = optsOrOrchestrator.config || {}
		} else {
			// Legacy form: (orchestrator, opts)
			const orchestrator = optsOrOrchestrator
			healingBus = orchestrator.healingBus || null
			taskQueue = orchestrator.taskQueue || null
			configOverrides = legacyOpts || {}
		}

		if (!healingBus) {
			throw new Error("SelfHealingLoop requires a healingBus")
		}
		this.healingBus = healingBus
		this.taskQueue = taskQueue
		this.config = { ...DEFAULT_CONFIG, ...configOverrides }

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
		// Compute and stamp the fingerprint if not already set
		if (!incident.fingerprint) {
			const fp = computeFingerprint(incident)
			this.healingBus.updateIncident(incident.id, { fingerprint: fp })
			incident = { ...incident, fingerprint: fp }
		}

		// Fingerprint-based escalation gate (from VILA Claude Code failure modes research)
		// If this exact failure has appeared >= threshold times without a fix, skip
		// investigation and escalate immediately.
		if (this._isFingerprintThresholdExceeded(incident.fingerprint)) {
			await this.healingBus.transitionState(
				incident.id,
				IncidentStatus.ESCALATED,
				"self-healing-loop",
				`Fingerprint ${incident.fingerprint} repeated ${this.config.fingerprintEscalationThreshold}+ times without fix`,
			)
			this.stats.escalations++
			this._writeRepairRun(incident, "escalated")
			this._emitFingerprintAlert(incident)
			return `escalated_fingerprint:${incident.id}`
		}

		// Record this occurrence
		this.recordFailure(incident)

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
			this._writeRepairRun(incident, "fixed", "auto-verified after grace period")
			this.clearFailureRecord(incident)
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
			this._writeRepairRun({ ...incident, fixCount: newFixCount }, "escalated")
			this._emitFingerprintAlert(incident)
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
	 * Returns true if a fingerprint has been seen >= fingerprintEscalationThreshold times
	 * without being cleared by a successful fix.
	 * @param {string} fingerprint
	 * @returns {boolean}
	 */
	_isFingerprintThresholdExceeded(fingerprint) {
		if (!fingerprint) return false
		const records = this._failureRecords.get(fingerprint) ?? []
		return records.length >= this.config.fingerprintEscalationThreshold
	}

	/**
	 * Emit a fingerprint escalation alert to SuperRooEventBus.
	 * Logged as structured JSONL so the Telegram alerter can pick it up.
	 * @param {object} incident
	 */
	_emitFingerprintAlert(incident) {
		try {
			const { eventBus } = require("./SuperRooEventBus")
			eventBus.emit(incident.id, "repair_result", {
				escalated: true,
				reason: "fingerprint_threshold",
				fingerprint: incident.fingerprint,
				threshold: this.config.fingerprintEscalationThreshold,
				title: incident.title,
				source: incident.source,
			})
		} catch {
			// eventBus not available in isolation
		}
		console.error(
			`[orchestrator/self-healing] ESCALATION fingerprint=${incident.fingerprint} ` +
				`title="${incident.title}" threshold=${this.config.fingerprintEscalationThreshold}`,
		)
	}

	/**
	 * Get fingerprint stats for the monitoring dashboard.
	 * @returns {Array<{fingerprint:string, count:number}>}
	 */
	getFingerprintStats() {
		const out = []
		for (const [fp, records] of this._failureRecords) {
			out.push({ fingerprint: fp, count: records.length })
		}
		return out.sort((a, b) => b.count - a.count)
	}

	/**
	 * Append a repair run record to the JSONL log file.
	 * Schema matches cloud/sql/repair_runs.sql for future Supabase sync.
	 *
	 * @param {object} incident
	 * @param {'fixed'|'escalated'|'failed'|'in_progress'} finalStatus
	 * @param {string} [fixApplied]
	 */
	_writeRepairRun(incident, finalStatus, fixApplied) {
		const record = {
			id: crypto.randomUUID(),
			triggered_at: new Date().toISOString(),
			incident_id: incident.id,
			failure_signature: incident.fingerprint || null,
			title: incident.title || null,
			source: incident.source || null,
			severity: incident.severity || null,
			attempts_count: incident.fixCount || 0,
			final_status: finalStatus,
			fix_applied: fixApplied || null,
			escalated_at: finalStatus === "escalated" ? new Date().toISOString() : null,
			cycle_count: this._failureRecords.get(incident.fingerprint || incident.id)?.length || 1,
			metadata: { rootCauseCategory: incident.rootCauseCategory || null },
		}
		try {
			fs.appendFileSync(REPAIR_RUNS_LOG, JSON.stringify(record) + "\n", "utf8")
		} catch (err) {
			console.warn("[orchestrator/self-healing] Could not write repair run:", err.message)
		}
	}

	/**
	 * Read recent repair runs from the JSONL log.
	 * @param {number} [limit=100]
	 * @returns {object[]}
	 */
	getRepairRuns(limit = 100) {
		try {
			const content = fs.readFileSync(REPAIR_RUNS_LOG, "utf8")
			const lines = content.trim().split("\n").filter(Boolean)
			return lines
				.slice(-limit)
				.map((l) => JSON.parse(l))
				.reverse()
		} catch {
			return []
		}
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
