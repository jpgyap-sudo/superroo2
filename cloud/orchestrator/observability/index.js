/**
 * Observability Module — Entry point.
 *
 * Exports the ObservabilityManager, provider base class, and all built-in providers.
 *
 * Usage:
 *   const { ObservabilityManager, ConsoleProvider, DatadogProvider, SentryProvider } = require('./observability')
 *
 *   const manager = new ObservabilityManager({ eventLog })
 *   await manager.initialize({
 *     providers: [
 *       { provider: new DatadogProvider(), config: { apiKey: process.env.DD_API_KEY } },
 *       { provider: new SentryProvider(), config: { dsn: process.env.SENTRY_DSN } },
 *     ],
 *   })
 *
 *   // Create a module observer for convenience
 *   const taskObserver = manager.createModuleObserver('task')
 *   await taskObserver.withSpan('execute', async ({ spanId, traceId }) => {
 *     // ... do work ...
 *   })
 */

const { ObservabilityManager } = require("./ObservabilityManager")
const { ObservabilityProvider } = require("./ObservabilityProvider")
const { ConsoleProvider } = require("./providers/ConsoleProvider")
const { DatadogProvider } = require("./providers/DatadogProvider")
const { SentryProvider } = require("./providers/SentryProvider")

module.exports = {
	ObservabilityManager,
	ObservabilityProvider,
	ConsoleProvider,
	DatadogProvider,
	SentryProvider,
}
