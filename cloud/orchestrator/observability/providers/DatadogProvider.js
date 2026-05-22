/**
 * DatadogProvider — Observability provider for Datadog.
 *
 * Uses Datadog's HTTP API to submit spans, metrics, and logs.
 * Requires DD_API_KEY and DD_SITE environment variables.
 *
 * API reference: https://docs.datadoghq.com/api/latest/
 */

const { ObservabilityProvider } = require("../ObservabilityProvider")

class DatadogProvider extends ObservabilityProvider {
	constructor() {
		super()
		this._initialized = false
		this._apiKey = null
		this._site = "datadoghq.com"
		this._service = "superroo"
		this._source = "superroo-cloud"
		this._host = null
		this._tags = {}
	}

	get name() {
		return "datadog"
	}

	async initialize(config = {}) {
		this._apiKey = config.apiKey || process.env.DD_API_KEY || null
		this._site = config.site || process.env.DD_SITE || "datadoghq.com"
		this._service = config.service || "superroo"
		this._source = config.source || "superroo-cloud"
		this._host = config.host || process.env.HOSTNAME || "unknown"
		this._tags = config.tags || {}

		if (!this._apiKey) {
			console.warn("[DatadogProvider] No DD_API_KEY configured — provider disabled")
			return false
		}

		this._baseUrl = `https://api.${this._site}`
		this._initialized = true
		return true
	}

	async shutdown() {
		this._initialized = false
	}

	async startSpan(span) {
		if (!this._initialized) return
		try {
			const body = {
				trace_id: span.traceId,
				span_id: span.spanId,
				parent_id: span.parentSpanId || undefined,
				name: span.name,
				service: this._service,
				resource: span.name,
				type: "custom",
				start: (span.startTime || Date.now()) * 1_000_000, // nanoseconds
				meta: {
					...this._tags,
					...(span.attributes || {}),
					source: this._source,
					host: this._host,
				},
			}

			await this._post("/api/v0.2/traces", [body])
		} catch (err) {
			console.warn(`[DatadogProvider] startSpan error: ${err.message}`)
		}
	}

	async endSpan(span) {
		if (!this._initialized) return
		try {
			const duration =
				span.endTime && span.startTime
					? (span.endTime - span.startTime) * 1_000_000 // nanoseconds
					: 0

			const body = {
				trace_id: span.traceId,
				span_id: span.spanId,
				name: span.name || "span.end",
				service: this._service,
				resource: span.name || "span.end",
				type: "custom",
				start: (span.startTime || Date.now()) * 1_000_000,
				duration,
				error: span.status === "error" ? 1 : 0,
				meta: {
					...this._tags,
					...(span.attributes || {}),
					status: span.status || "ok",
					error_message: span.errorMessage || "",
					source: this._source,
					host: this._host,
				},
			}

			await this._post("/api/v0.2/traces", [body])
		} catch (err) {
			console.warn(`[DatadogProvider] endSpan error: ${err.message}`)
		}
	}

	async recordMetric(metric) {
		if (!this._initialized) return
		try {
			const body = {
				series: [
					{
						metric: metric.name,
						type: "gauge",
						points: [
							{
								timestamp: Math.floor((metric.timestamp || Date.now()) / 1000),
								value: metric.value,
							},
						],
						tags: [
							...Object.entries(this._tags).map(([k, v]) => `${k}:${v}`),
							...Object.entries(metric.tags || {}).map(([k, v]) => `${k}:${v}`),
							`service:${this._service}`,
							`host:${this._host}`,
						],
					},
				],
			}

			await this._post("/api/v2/series", body)
		} catch (err) {
			console.warn(`[DatadogProvider] recordMetric error: ${err.message}`)
		}
	}

	async recordLog(log) {
		if (!this._initialized) return
		try {
			const level = log.level || "info"
			const body = {
				ddsource: this._source,
				ddtags: [
					...Object.entries(this._tags).map(([k, v]) => `${k}:${v}`),
					`service:${this._service}`,
					`host:${this._host}`,
					`level:${level}`,
				].join(","),
				hostname: this._host,
				service: this._service,
				message: log.message,
				level,
				...(log.attributes || {}),
			}

			await this._post("/api/v2/logs", body)
		} catch (err) {
			console.warn(`[DatadogProvider] recordLog error: ${err.message}`)
		}
	}

	async healthCheck() {
		if (!this._initialized || !this._apiKey) return false
		try {
			const res = await fetch(`${this._baseUrl}/api/v1/validate`, {
				headers: {
					"DD-API-KEY": this._apiKey,
				},
			})
			return res.ok
		} catch {
			return false
		}
	}

	async _post(path, body) {
		const url = `${this._baseUrl}${path}`
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"DD-API-KEY": this._apiKey,
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const text = await res.text().catch(() => "")
			console.warn(`[DatadogProvider] POST ${path} returned ${res.status}: ${text}`)
		}
	}
}

module.exports = { DatadogProvider }
