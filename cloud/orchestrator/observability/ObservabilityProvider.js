/**
 * ObservabilityProvider — Abstract adapter interface for observability backends.
 *
 * Inspired by Mastra's 14 observability providers pattern. Each provider
 * implements this interface to export spans, metrics, and logs to a specific
 * backend (Datadog, Sentry, Langfuse, PostHog, Arize, etc.).
 *
 * Providers are designed to be:
 * - Non-blocking: all methods return promises but failures are swallowed
 * - Best-effort: providers log errors internally but never throw
 * - Composable: multiple providers can be active simultaneously
 */

class ObservabilityProvider {
	/**
	 * Initialize the provider. Called once when the provider is registered.
	 * @param {object} config - Provider-specific configuration
	 * @returns {Promise<boolean>} true if initialization succeeded
	 */
	async initialize(config) {
		throw new Error("ObservabilityProvider subclasses must implement initialize()")
	}

	/**
	 * Shut down the provider. Called during system shutdown.
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		throw new Error("ObservabilityProvider subclasses must implement shutdown()")
	}

	/**
	 * Start a span (unit of work).
	 * @param {object} span - Span data
	 * @param {string} span.name - Span name (e.g., "task.execute")
	 * @param {string} span.traceId - Trace identifier
	 * @param {string} span.spanId - Span identifier
	 * @param {string} [span.parentSpanId] - Parent span identifier
	 * @param {object} [span.attributes] - Key-value attributes
	 * @param {number} [span.startTime] - Unix timestamp ms
	 * @returns {Promise<void>}
	 */
	async startSpan(span) {
		throw new Error("ObservabilityProvider subclasses must implement startSpan()")
	}

	/**
	 * End a span with a result status.
	 * @param {object} span - Span data
	 * @param {string} span.spanId - Span identifier
	 * @param {'ok'|'error'} span.status - Span result status
	 * @param {string} [span.errorMessage] - Error message if status is 'error'
	 * @param {number} [span.endTime] - Unix timestamp ms
	 * @param {object} [span.attributes] - Additional attributes to add on end
	 * @returns {Promise<void>}
	 */
	async endSpan(span) {
		throw new Error("ObservabilityProvider subclasses must implement endSpan()")
	}

	/**
	 * Record a metric value.
	 * @param {object} metric - Metric data
	 * @param {string} metric.name - Metric name (e.g., "task.duration_ms")
	 * @param {number} metric.value - Metric value
	 * @param {object} [metric.tags] - Key-value tags
	 * @param {number} [metric.timestamp] - Unix timestamp ms
	 * @returns {Promise<void>}
	 */
	async recordMetric(metric) {
		throw new Error("ObservabilityProvider subclasses must implement recordMetric()")
	}

	/**
	 * Record a log entry.
	 * @param {object} log - Log data
	 * @param {string} log.message - Log message
	 * @param {'info'|'warning'|'error'|'critical'} [log.level] - Log level
	 * @param {object} [log.attributes] - Key-value attributes
	 * @param {number} [log.timestamp] - Unix timestamp ms
	 * @returns {Promise<void>}
	 */
	async recordLog(log) {
		throw new Error("ObservabilityProvider subclasses must implement recordLog()")
	}

	/**
	 * Get the provider name (used for identification).
	 * @returns {string}
	 */
	get name() {
		throw new Error("ObservabilityProvider subclasses must implement get name()")
	}

	/**
	 * Check if the provider is healthy.
	 * @returns {Promise<boolean>}
	 */
	async healthCheck() {
		return true
	}
}

module.exports = { ObservabilityProvider }
