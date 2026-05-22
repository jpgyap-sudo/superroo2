/**
 * ObservabilityManager — Central orchestrator for the observability stack.
 *
 * Manages multiple ObservabilityProvider instances, creates spans for
 * key system operations, records metrics, and wires into the EventLog.
 *
 * Inspired by OpenTelemetry's TracerProvider pattern but simplified for
 * SuperRoo2's architecture. Supports:
 * - Multiple concurrent providers (console + Datadog + Sentry, etc.)
 * - Span creation with automatic trace/span ID generation
 * - Metric recording with tag support
 * - Log forwarding to all providers
 * - Health checks across all providers
 * - EventLog integration (events are mirrored to observability)
 */

const crypto = require("crypto")
const { ConsoleProvider } = require("./providers/ConsoleProvider")

class ObservabilityManager {
	/**
	 * @param {object} [options]
	 * @param {import('./EventLog')} [options.eventLog] - Optional EventLog instance for integration
	 */
	constructor(options = {}) {
		this._providers = []
		this._eventLog = options.eventLog || null
		this._initialized = false
		this._activeSpans = new Map() // spanId -> span data
		this._defaultTags = {}
		this._serviceName = "superroo"

		// Stats
		this._stats = {
			spansStarted: 0,
			spansEnded: 0,
			metricsRecorded: 0,
			logsRecorded: 0,
			errors: 0,
		}
	}

	/**
	 * Initialize the observability manager.
	 * Always registers the ConsoleProvider as the default.
	 * @param {object} [config]
	 * @param {string} [config.serviceName]
	 * @param {object} [config.defaultTags]
	 * @param {Array<{provider: ObservabilityProvider, config: object}>} [config.providers]
	 * @returns {Promise<{success: boolean, providers: number}>}
	 */
	async initialize(config = {}) {
		this._serviceName = config.serviceName || "superroo"
		this._defaultTags = config.defaultTags || {}

		// Always register ConsoleProvider as default
		const consoleProvider = new ConsoleProvider()
		await consoleProvider.initialize({})
		this._providers.push(consoleProvider)

		// Register additional providers
		if (config.providers && Array.isArray(config.providers)) {
			for (const entry of config.providers) {
				try {
					const ok = await entry.provider.initialize(entry.config || {})
					if (ok) {
						this._providers.push(entry.provider)
					}
				} catch (err) {
					console.warn(`[ObservabilityManager] Failed to initialize provider: ${err.message}`)
				}
			}
		}

		this._initialized = true
		return {
			success: true,
			providers: this._providers.length,
		}
	}

	/**
	 * Shut down all providers.
	 */
	async shutdown() {
		for (const provider of this._providers) {
			try {
				await provider.shutdown()
			} catch (err) {
				console.warn(`[ObservabilityManager] Error shutting down ${provider.name}: ${err.message}`)
			}
		}
		this._providers = []
		this._activeSpans.clear()
		this._initialized = false
	}

	/**
	 * Start a new span (unit of work).
	 * @param {string} name - Span name (e.g., "task.execute", "agent.route")
	 * @param {object} [options]
	 * @param {string} [options.traceId] - Existing trace ID (for continuing a trace)
	 * @param {string} [options.parentSpanId] - Parent span ID (for nesting)
	 * @param {object} [options.attributes] - Key-value attributes
	 * @returns {{ spanId: string, traceId: string, startTime: number }}
	 */
	startSpan(name, options = {}) {
		const spanId = crypto.randomUUID()
		const traceId = options.traceId || crypto.randomUUID()
		const startTime = Date.now()

		const span = {
			name,
			traceId,
			spanId,
			parentSpanId: options.parentSpanId || null,
			attributes: { ...this._defaultTags, ...(options.attributes || {}) },
			startTime,
		}

		this._activeSpans.set(spanId, span)
		this._stats.spansStarted++

		// Notify all providers
		for (const provider of this._providers) {
			provider.startSpan(span).catch(() => {})
		}

		// Record in EventLog if available
		if (this._eventLog) {
			try {
				this._eventLog.record({
					type: `span.start`,
					source: "observability",
					payload: {
						name,
						traceId,
						spanId,
						parentSpanId: span.parentSpanId,
						attributes: span.attributes,
					},
					severity: "info",
				})
			} catch {
				// Non-critical
			}
		}

		return { spanId, traceId, startTime }
	}

	/**
	 * End a span with a result status.
	 * @param {string} spanId - Span ID from startSpan()
	 * @param {'ok'|'error'} [status='ok'] - Result status
	 * @param {object} [options]
	 * @param {string} [options.errorMessage] - Error message if status is 'error'
	 * @param {object} [options.attributes] - Additional attributes to add on end
	 */
	endSpan(spanId, status = "ok", options = {}) {
		const span = this._activeSpans.get(spanId)
		if (!span) {
			console.warn(`[ObservabilityManager] endSpan: unknown span ${spanId}`)
			return
		}

		const endTime = Date.now()
		span.status = status
		span.endTime = endTime
		span.errorMessage = options.errorMessage || null
		if (options.attributes) {
			Object.assign(span.attributes, options.attributes)
		}

		this._activeSpans.delete(spanId)
		this._stats.spansEnded++

		if (status === "error") {
			this._stats.errors++
		}

		// Notify all providers
		for (const provider of this._providers) {
			provider.endSpan(span).catch(() => {})
		}

		// Record in EventLog if available
		if (this._eventLog) {
			try {
				this._eventLog.record({
					type: `span.end`,
					source: "observability",
					payload: {
						name: span.name,
						traceId: span.traceId,
						spanId,
						status,
						errorMessage: span.errorMessage,
						duration: endTime - span.startTime,
						attributes: span.attributes,
					},
					severity: status === "error" ? "error" : "info",
				})
			} catch {
				// Non-critical
			}
		}
	}

	/**
	 * Run a function within a span (auto-starts and ends).
	 * @template T
	 * @param {string} name - Span name
	 * @param {Function} fn - Async function to run within the span
	 * @param {object} [options]
	 * @param {string} [options.traceId]
	 * @param {string} [options.parentSpanId]
	 * @param {object} [options.attributes]
	 * @returns {Promise<T>}
	 */
	async withSpan(name, fn, options = {}) {
		const { spanId, traceId, startTime } = this.startSpan(name, options)
		try {
			const result = await fn({ spanId, traceId })
			this.endSpan(spanId, "ok", { attributes: { startTime } })
			return result
		} catch (err) {
			this.endSpan(spanId, "error", {
				errorMessage: err.message,
				attributes: { startTime },
			})
			throw err
		}
	}

	/**
	 * Record a metric value.
	 * @param {string} name - Metric name (e.g., "task.duration_ms")
	 * @param {number} value - Metric value
	 * @param {object} [tags] - Key-value tags
	 */
	async recordMetric(name, value, tags = {}) {
		this._stats.metricsRecorded++

		const metric = {
			name,
			value,
			tags: { ...this._defaultTags, ...tags },
			timestamp: Date.now(),
		}

		for (const provider of this._providers) {
			provider.recordMetric(metric).catch(() => {})
		}
	}

	/**
	 * Record a log entry.
	 * @param {string} message - Log message
	 * @param {'info'|'warning'|'error'|'critical'} [level='info']
	 * @param {object} [attributes] - Key-value attributes
	 */
	async recordLog(message, level = "info", attributes = {}) {
		this._stats.logsRecorded++

		const log = {
			message,
			level,
			attributes: { ...this._defaultTags, ...attributes },
			timestamp: Date.now(),
		}

		for (const provider of this._providers) {
			provider.recordLog(log).catch(() => {})
		}
	}

	/**
	 * Get the list of active (un-ended) spans.
	 * @returns {Array<{name: string, spanId: string, traceId: string, startTime: number}>}
	 */
	getActiveSpans() {
		return Array.from(this._activeSpans.values()).map((s) => ({
			name: s.name,
			spanId: s.spanId,
			traceId: s.traceId,
			startTime: s.startTime,
		}))
	}

	/**
	 * Get statistics about observability usage.
	 * @returns {object}
	 */
	getStats() {
		return { ...this._stats }
	}

	/**
	 * Get the list of registered providers.
	 * @returns {string[]}
	 */
	getProviders() {
		return this._providers.map((p) => p.name)
	}

	/**
	 * Check health of all providers.
	 * @returns {Promise<object>}
	 */
	async healthCheck() {
		const results = {}
		for (const provider of this._providers) {
			try {
				results[provider.name] = await provider.healthCheck()
			} catch {
				results[provider.name] = false
			}
		}
		return results
	}

	/**
	 * Wire into an EventLog instance so all events are mirrored to observability.
	 * @param {import('./EventLog')} eventLog
	 */
	wireEventLog(eventLog) {
		this._eventLog = eventLog
	}

	/**
	 * Create a convenience wrapper that records metrics for a specific module.
	 * @param {string} moduleName
	 * @returns {ModuleObserver}
	 */
	createModuleObserver(moduleName) {
		const self = this
		return {
			startSpan(name, attributes) {
				return self.startSpan(`${moduleName}.${name}`, { attributes })
			},
			endSpan(spanId, status, options) {
				self.endSpan(spanId, status, options)
			},
			async withSpan(name, fn, options = {}) {
				return self.withSpan(`${moduleName}.${name}`, fn, {
					...options,
					attributes: { ...(options.attributes || {}), module: moduleName },
				})
			},
			async recordMetric(name, value, tags = {}) {
				return self.recordMetric(`${moduleName}.${name}`, value, { ...tags, module: moduleName })
			},
			async recordLog(message, level = "info", attributes = {}) {
				return self.recordLog(`[${moduleName}] ${message}`, level, { ...attributes, module: moduleName })
			},
		}
	}
}

module.exports = { ObservabilityManager }
