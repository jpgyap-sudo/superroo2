/**
 * ConsoleProvider — Always-available observability provider that logs to console.
 *
 * This is the default provider used when no external observability backend
 * is configured. It provides structured JSON logging to stdout/stderr.
 */

const { ObservabilityProvider } = require("../ObservabilityProvider")

class ConsoleProvider extends ObservabilityProvider {
	constructor() {
		super()
		this._initialized = false
		this._config = {}
	}

	get name() {
		return "console"
	}

	async initialize(config = {}) {
		this._config = config
		this._initialized = true
		return true
	}

	async shutdown() {
		this._initialized = false
	}

	async startSpan(span) {
		if (!this._initialized) return
		const entry = {
			type: "span_start",
			name: span.name,
			traceId: span.traceId,
			spanId: span.spanId,
			parentSpanId: span.parentSpanId || null,
			attributes: span.attributes || {},
			timestamp: span.startTime || Date.now(),
		}
		console.log(`[observability] ${JSON.stringify(entry)}`)
	}

	async endSpan(span) {
		if (!this._initialized) return
		const entry = {
			type: "span_end",
			spanId: span.spanId,
			status: span.status || "ok",
			errorMessage: span.errorMessage || null,
			attributes: span.attributes || {},
			duration: span.endTime && span.startTime ? span.endTime - span.startTime : null,
			timestamp: span.endTime || Date.now(),
		}
		if (span.status === "error") {
			console.error(`[observability] ${JSON.stringify(entry)}`)
		} else {
			console.log(`[observability] ${JSON.stringify(entry)}`)
		}
	}

	async recordMetric(metric) {
		if (!this._initialized) return
		const entry = {
			type: "metric",
			name: metric.name,
			value: metric.value,
			tags: metric.tags || {},
			timestamp: metric.timestamp || Date.now(),
		}
		console.log(`[observability] ${JSON.stringify(entry)}`)
	}

	async recordLog(log) {
		if (!this._initialized) return
		const entry = {
			type: "log",
			message: log.message,
			level: log.level || "info",
			attributes: log.attributes || {},
			timestamp: log.timestamp || Date.now(),
		}
		const level = log.level || "info"
		if (level === "error" || level === "critical") {
			console.error(`[observability] ${JSON.stringify(entry)}`)
		} else if (level === "warning") {
			console.warn(`[observability] ${JSON.stringify(entry)}`)
		} else {
			console.log(`[observability] ${JSON.stringify(entry)}`)
		}
	}

	async healthCheck() {
		return this._initialized
	}
}

module.exports = { ConsoleProvider }
