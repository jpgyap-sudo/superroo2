/**
 * SentryProvider — Observability provider for Sentry.
 *
 * Uses Sentry's Envelope API to submit errors and events.
 * Requires SENTRY_DSN environment variable.
 *
 * API reference: https://develop.sentry.dev/sdk/envelopes/
 */

const crypto = require("crypto")
const { ObservabilityProvider } = require("../ObservabilityProvider")

class SentryProvider extends ObservabilityProvider {
	constructor() {
		super()
		this._initialized = false
		this._dsn = null
		this._environment = "production"
		this._release = "1.0.0"
		this._service = "superroo"
	}

	get name() {
		return "sentry"
	}

	async initialize(config = {}) {
		this._dsn = config.dsn || process.env.SENTRY_DSN || null
		this._environment = config.environment || process.env.NODE_ENV || "production"
		this._release = config.release || "1.0.0"
		this._service = config.service || "superroo"

		if (!this._dsn) {
			console.warn("[SentryProvider] No SENTRY_DSN configured — provider disabled")
			return false
		}

		// Parse DSN to get endpoint
		try {
			const parsed = new URL(this._dsn)
			const projectId = parsed.pathname.replace("/", "")
			const host = parsed.host
			const protocol = parsed.protocol.replace(":", "")
			const key = parsed.username
			this._endpoint = `${protocol}://${host}/api/${projectId}/envelope/`
			this._authHeader = `Sentry sentry_key=${key}, sentry_version=7, sentry_client=superroo-observability/1.0.0`
		} catch (err) {
			console.warn(`[SentryProvider] Invalid SENTRY_DSN: ${err.message}`)
			return false
		}

		this._initialized = true
		return true
	}

	async shutdown() {
		this._initialized = false
	}

	async startSpan(span) {
		// Sentry doesn't have a direct startSpan API via HTTP;
		// spans are attached to transactions. We'll record as breadcrumb instead.
		if (!this._initialized) return
		// No-op for Sentry — spans are recorded via endSpan with transaction
	}

	async endSpan(span) {
		if (!this._initialized) return
		try {
			const eventId = crypto.randomUUID().replace(/-/g, "")
			const timestamp = (span.endTime || Date.now()) / 1000
			const startTimestamp = (span.startTime || Date.now()) / 1000

			const event = {
				event_id: eventId,
				timestamp,
				start_timestamp: startTimestamp,
				type: "transaction",
				transaction: span.name || "span",
				contexts: {
					trace: {
						trace_id: span.traceId,
						span_id: span.spanId,
						parent_span_id: span.parentSpanId || undefined,
						op: span.name,
						status: span.status === "error" ? "internal_error" : "ok",
					},
				},
				spans: [
					{
						trace_id: span.traceId,
						span_id: span.spanId,
						parent_span_id: span.parentSpanId || undefined,
						start_timestamp: startTimestamp,
						timestamp,
						op: span.name,
						description: span.name,
						status: span.status === "error" ? "internal_error" : "ok",
						tags: {
							...this._getTags(span.attributes),
						},
					},
				],
				tags: this._getTags(span.attributes),
				release: this._release,
				environment: this._environment,
				server_name: this._service,
			}

			if (span.status === "error" && span.errorMessage) {
				event.exception = {
					values: [
						{
							type: "ObservabilityError",
							value: span.errorMessage,
							mechanism: {
								type: "superroo-observability",
								handled: true,
							},
						},
					],
				}
			}

			await this._sendEnvelope(eventId, event)
		} catch (err) {
			console.warn(`[SentryProvider] endSpan error: ${err.message}`)
		}
	}

	async recordMetric(metric) {
		// Sentry doesn't have a native metrics API via HTTP.
		// Record as a breadcrumb instead.
		if (!this._initialized) return
		try {
			const eventId = crypto.randomUUID().replace(/-/g, "")
			const event = {
				event_id: eventId,
				timestamp: (metric.timestamp || Date.now()) / 1000,
				message: `metric: ${metric.name} = ${metric.value}`,
				level: "info",
				extra: {
					metric_name: metric.name,
					metric_value: metric.value,
					metric_tags: JSON.stringify(metric.tags || {}),
				},
				tags: this._getTags(metric.tags),
				release: this._release,
				environment: this._environment,
			}

			await this._sendEnvelope(eventId, event)
		} catch (err) {
			console.warn(`[SentryProvider] recordMetric error: ${err.message}`)
		}
	}

	async recordLog(log) {
		if (!this._initialized) return
		try {
			const eventId = crypto.randomUUID().replace(/-/g, "")
			const level = this._mapLevel(log.level || "info")

			const event = {
				event_id: eventId,
				timestamp: (log.timestamp || Date.now()) / 1000,
				message: log.message,
				level,
				logger: "superroo-observability",
				extra: log.attributes || {},
				tags: this._getTags(log.attributes),
				release: this._release,
				environment: this._environment,
			}

			if (level === "error" || level === "fatal") {
				event.exception = {
					values: [
						{
							type: "LogError",
							value: log.message,
							mechanism: {
								type: "superroo-observability",
								handled: true,
							},
						},
					],
				}
			}

			await this._sendEnvelope(eventId, event)
		} catch (err) {
			console.warn(`[SentryProvider] recordLog error: ${err.message}`)
		}
	}

	async healthCheck() {
		return this._initialized && !!this._dsn
	}

	_mapLevel(level) {
		switch (level) {
			case "critical":
				return "fatal"
			case "warning":
				return "warning"
			case "error":
				return "error"
			default:
				return "info"
		}
	}

	_getTags(attrs = {}) {
		const tags = {
			service: this._service,
			environment: this._environment,
		}
		for (const [key, value] of Object.entries(attrs)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				tags[key] = String(value)
			}
		}
		return tags
	}

	async _sendEnvelope(eventId, event) {
		// Sentry envelope format: JSON header line, then JSON event
		const header = JSON.stringify({
			event_id: eventId,
			sent_at: new Date().toISOString(),
			sdk: {
				name: "superroo-observability",
				version: "1.0.0",
			},
		})

		const payload = JSON.stringify(event)
		const envelope = `${header}\n${payload}\n`

		const res = await fetch(this._endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-sentry-envelope",
				"X-Sentry-Auth": this._authHeader,
			},
			body: envelope,
		})

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			console.warn(`[SentryProvider] POST envelope returned ${res.status}: ${text}`)
		}
	}
}

module.exports = { SentryProvider }
