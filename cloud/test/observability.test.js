/**
 * Tests for the Observability Stack (Sprint 2 F2).
 *
 * Covers:
 * - ObservabilityProvider base class
 * - ConsoleProvider
 * - DatadogProvider (with mocked fetch)
 * - SentryProvider (with mocked fetch)
 * - ObservabilityManager (span lifecycle, metrics, logs, module observers, EventLog wiring)
 *
 * Note: describe, it, expect, vi, beforeEach, afterEach are available as globals
 * via vitest config (globals: true).
 */

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe("ObservabilityProvider", () => {
	const { ObservabilityProvider } = require("../orchestrator/observability/ObservabilityProvider")

	it("should throw on unimplemented methods", async () => {
		const p = new ObservabilityProvider()
		await expect(p.initialize()).rejects.toThrow("implement initialize")
		await expect(p.shutdown()).rejects.toThrow("implement shutdown")
		await expect(p.startSpan({})).rejects.toThrow("implement startSpan")
		await expect(p.endSpan({})).rejects.toThrow("implement endSpan")
		await expect(p.recordMetric({})).rejects.toThrow("implement recordMetric")
		await expect(p.recordLog({})).rejects.toThrow("implement recordLog")
		expect(() => p.name).toThrow("implement get name()")
	})

	it("should have a default healthCheck that returns true", async () => {
		const p = new (class extends ObservabilityProvider {
			get name() {
				return "test"
			}
			async initialize() {
				return true
			}
			async shutdown() {}
			async startSpan() {}
			async endSpan() {}
			async recordMetric() {}
			async recordLog() {}
		})()
		expect(await p.healthCheck()).toBe(true)
	})
})

describe("ConsoleProvider", () => {
	const { ConsoleProvider } = require("../orchestrator/observability/providers/ConsoleProvider")

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should initialize and report name", async () => {
		const p = new ConsoleProvider()
		expect(p.name).toBe("console")
		const result = await p.initialize()
		expect(result).toBe(true)
	})

	it("should log span start to console", async () => {
		const p = new ConsoleProvider()
		await p.initialize()
		await p.startSpan({ name: "test.span", traceId: "trace-1", spanId: "span-1" })
		expect(console.log).toHaveBeenCalled()
		const call = console.log.mock.calls[0][0]
		expect(call).toContain("span_start")
		expect(call).toContain("test.span")
	})

	it("should log span end with error to console.error", async () => {
		const p = new ConsoleProvider()
		await p.initialize()
		await p.endSpan({ spanId: "span-1", status: "error", errorMessage: "oops" })
		expect(console.error).toHaveBeenCalled()
		const call = console.error.mock.calls[0][0]
		expect(call).toContain("span_end")
		expect(call).toContain("error")
	})

	it("should record metric to console", async () => {
		const p = new ConsoleProvider()
		await p.initialize()
		await p.recordMetric({ name: "test.metric", value: 42, tags: { env: "test" } })
		expect(console.log).toHaveBeenCalled()
		const call = console.log.mock.calls[0][0]
		expect(call).toContain("metric")
		expect(call).toContain("42")
	})

	it("should record log with appropriate level", async () => {
		const p = new ConsoleProvider()
		await p.initialize()
		await p.recordLog({ message: "test log", level: "warning" })
		expect(console.warn).toHaveBeenCalled()
	})

	it("should not log when not initialized", async () => {
		const p = new ConsoleProvider()
		await p.startSpan({ name: "test" })
		expect(console.log).not.toHaveBeenCalled()
	})

	it("should report health correctly", async () => {
		const p = new ConsoleProvider()
		expect(await p.healthCheck()).toBe(false)
		await p.initialize()
		expect(await p.healthCheck()).toBe(true)
		await p.shutdown()
		expect(await p.healthCheck()).toBe(false)
	})
})

describe("DatadogProvider", () => {
	const { DatadogProvider } = require("../orchestrator/observability/providers/DatadogProvider")

	beforeEach(() => {
		mockFetch.mockReset()
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should not initialize without API key", async () => {
		const p = new DatadogProvider()
		const result = await p.initialize({})
		expect(result).toBe(false)
		expect(p.name).toBe("datadog")
	})

	it("should initialize with API key", async () => {
		const p = new DatadogProvider()
		const result = await p.initialize({ apiKey: "test-key-123" })
		expect(result).toBe(true)
	})

	it("should send span start to Datadog API", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new DatadogProvider()
		await p.initialize({ apiKey: "test-key" })
		await p.startSpan({ name: "test.span", traceId: "trace-1", spanId: "span-1" })
		expect(mockFetch).toHaveBeenCalled()
		const [url, opts] = mockFetch.mock.calls[0]
		expect(url).toContain("api.datadoghq.com/api/v0.2/traces")
		expect(opts.method).toBe("POST")
		expect(opts.headers["DD-API-KEY"]).toBe("test-key")
	})

	it("should send metric to Datadog API", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new DatadogProvider()
		await p.initialize({ apiKey: "test-key" })
		await p.recordMetric({ name: "test.metric", value: 100, tags: { env: "test" } })
		expect(mockFetch).toHaveBeenCalled()
		const [url, opts] = mockFetch.mock.calls[0]
		expect(url).toContain("/api/v2/series")
		const body = JSON.parse(opts.body)
		expect(body.series[0].metric).toBe("test.metric")
		expect(body.series[0].points[0].value).toBe(100)
	})

	it("should send log to Datadog API", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new DatadogProvider()
		await p.initialize({ apiKey: "test-key" })
		await p.recordLog({ message: "test log", level: "error" })
		expect(mockFetch).toHaveBeenCalled()
		const [url, opts] = mockFetch.mock.calls[0]
		expect(url).toContain("/api/v2/logs")
		const body = JSON.parse(opts.body)
		expect(body.message).toBe("test log")
		expect(body.level).toBe("error")
	})

	it("should handle API errors gracefully", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"))
		const p = new DatadogProvider()
		await p.initialize({ apiKey: "test-key" })
		// Should not throw
		await p.startSpan({ name: "test", traceId: "t1", spanId: "s1" })
		expect(console.warn).toHaveBeenCalled()
	})

	it("should check health via validate endpoint", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new DatadogProvider()
		await p.initialize({ apiKey: "test-key" })
		const healthy = await p.healthCheck()
		expect(healthy).toBe(true)
		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/validate"), expect.any(Object))
	})
})

describe("SentryProvider", () => {
	const { SentryProvider } = require("../orchestrator/observability/providers/SentryProvider")

	beforeEach(() => {
		mockFetch.mockReset()
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should not initialize without DSN", async () => {
		const p = new SentryProvider()
		const result = await p.initialize({})
		expect(result).toBe(false)
		expect(p.name).toBe("sentry")
	})

	it("should initialize with valid DSN", async () => {
		const p = new SentryProvider()
		const result = await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		expect(result).toBe(true)
	})

	it("should send transaction to Sentry on endSpan", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new SentryProvider()
		await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		await p.endSpan({
			name: "test.span",
			traceId: "trace-1",
			spanId: "span-1",
			startTime: Date.now() - 1000,
			endTime: Date.now(),
			status: "ok",
		})
		expect(mockFetch).toHaveBeenCalled()
		const [url, opts] = mockFetch.mock.calls[0]
		expect(url).toContain("ingest.sentry.io/api/123/envelope/")
		expect(opts.headers["Content-Type"]).toBe("application/x-sentry-envelope")
	})

	it("should send error event on error span", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new SentryProvider()
		await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		await p.endSpan({
			name: "error.span",
			traceId: "trace-1",
			spanId: "span-1",
			startTime: Date.now() - 1000,
			endTime: Date.now(),
			status: "error",
			errorMessage: "Something broke",
		})
		expect(mockFetch).toHaveBeenCalled()
		const body = mockFetch.mock.calls[0][1].body
		expect(body).toContain("Something broke")
	})

	it("should send log to Sentry", async () => {
		mockFetch.mockResolvedValue({ ok: true })
		const p = new SentryProvider()
		await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		await p.recordLog({ message: "test log", level: "error" })
		expect(mockFetch).toHaveBeenCalled()
	})

	it("should handle API errors gracefully", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"))
		const p = new SentryProvider()
		await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		await p.endSpan({ name: "test", traceId: "t1", spanId: "s1", startTime: Date.now(), endTime: Date.now() })
		expect(console.warn).toHaveBeenCalled()
	})

	it("should check health correctly", async () => {
		const p = new SentryProvider()
		expect(await p.healthCheck()).toBe(false)
		await p.initialize({ dsn: "https://key@o0.ingest.sentry.io/123" })
		expect(await p.healthCheck()).toBe(true)
	})
})

describe("ObservabilityManager", () => {
	const { ObservabilityManager } = require("../orchestrator/observability/ObservabilityManager")
	const { ConsoleProvider } = require("../orchestrator/observability/providers/ConsoleProvider")

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should initialize with ConsoleProvider by default", async () => {
		const manager = new ObservabilityManager()
		const result = await manager.initialize()
		expect(result.success).toBe(true)
		expect(result.providers).toBe(1)
		expect(manager.getProviders()).toEqual(["console"])
	})

	it("should start and end spans", () => {
		const manager = new ObservabilityManager()
		const { spanId, traceId } = manager.startSpan("test.span", { attributes: { env: "test" } })
		expect(spanId).toBeTruthy()
		expect(traceId).toBeTruthy()

		manager.endSpan(spanId, "ok")
		expect(manager.getStats().spansStarted).toBe(1)
		expect(manager.getStats().spansEnded).toBe(1)
	})

	it("should track active spans", () => {
		const manager = new ObservabilityManager()
		const { spanId } = manager.startSpan("active.span")
		expect(manager.getActiveSpans()).toHaveLength(1)
		expect(manager.getActiveSpans()[0].name).toBe("active.span")
		manager.endSpan(spanId, "ok")
		expect(manager.getActiveSpans()).toHaveLength(0)
	})

	it("should record metrics", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		await manager.recordMetric("test.metric", 42, { env: "test" })
		expect(manager.getStats().metricsRecorded).toBe(1)
	})

	it("should record logs", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		await manager.recordLog("test message", "info", { key: "value" })
		expect(manager.getStats().logsRecorded).toBe(1)
	})

	it("should run withSpan and handle success", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		const result = await manager.withSpan("test.withSpan", async ({ spanId, traceId }) => {
			expect(spanId).toBeTruthy()
			expect(traceId).toBeTruthy()
			return "done"
		})
		expect(result).toBe("done")
		expect(manager.getStats().spansStarted).toBe(1)
		expect(manager.getStats().spansEnded).toBe(1)
	})

	it("should run withSpan and handle errors", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		await expect(
			manager.withSpan("test.error", async () => {
				throw new Error("test error")
			}),
		).rejects.toThrow("test error")
		expect(manager.getStats().errors).toBe(1)
	})

	it("should create module observers", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		const observer = manager.createModuleObserver("testModule")
		expect(observer).toBeTruthy()
		expect(typeof observer.startSpan).toBe("function")
		expect(typeof observer.endSpan).toBe("function")
		expect(typeof observer.withSpan).toBe("function")
		expect(typeof observer.recordMetric).toBe("function")
		expect(typeof observer.recordLog).toBe("function")
	})

	it("should wire into EventLog", async () => {
		const mockEventLog = {
			record: vi.fn(),
		}
		const manager = new ObservabilityManager({ eventLog: mockEventLog })
		await manager.initialize()
		const { spanId } = manager.startSpan("logged.span")
		expect(mockEventLog.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "span.start",
				source: "observability",
			}),
		)
		manager.endSpan(spanId, "ok")
		expect(mockEventLog.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "span.end",
				source: "observability",
			}),
		)
	})

	it("should check health of all providers", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		const health = await manager.healthCheck()
		expect(health.console).toBe(true)
	})

	it("should register additional providers", async () => {
		const mockProvider = new (class extends require("../orchestrator/observability/ObservabilityProvider")
			.ObservabilityProvider {
			get name() {
				return "mock"
			}
			async initialize() {
				return true
			}
			async shutdown() {}
			async startSpan() {}
			async endSpan() {}
			async recordMetric() {}
			async recordLog() {}
		})()

		const manager = new ObservabilityManager()
		await manager.initialize({
			providers: [{ provider: mockProvider, config: {} }],
		})
		expect(manager.getProviders()).toContain("mock")
		expect(manager.getProviders()).toContain("console")
	})

	it("should handle provider init failure gracefully", async () => {
		const badProvider = new (class extends require("../orchestrator/observability/ObservabilityProvider")
			.ObservabilityProvider {
			get name() {
				return "bad"
			}
			async initialize() {
				throw new Error("init failed")
			}
			async shutdown() {}
			async startSpan() {}
			async endSpan() {}
			async recordMetric() {}
			async recordLog() {}
		})()

		const manager = new ObservabilityManager()
		await manager.initialize({
			providers: [{ provider: badProvider, config: {} }],
		})
		// Should still have console provider
		expect(manager.getProviders()).toEqual(["console"])
	})

	it("should shutdown all providers", async () => {
		const manager = new ObservabilityManager()
		await manager.initialize()
		await manager.shutdown()
		expect(manager.getProviders()).toHaveLength(0)
	})

	it("should handle endSpan for unknown span gracefully", () => {
		const manager = new ObservabilityManager()
		manager.endSpan("nonexistent", "ok")
		expect(manager.getStats().spansEnded).toBe(0)
	})

	it("should support parent-child span relationships", () => {
		const manager = new ObservabilityManager()
		const parent = manager.startSpan("parent")
		const child = manager.startSpan("child", { traceId: parent.traceId, parentSpanId: parent.spanId })
		expect(child.traceId).toBe(parent.traceId)
		expect(child.spanId).not.toBe(parent.spanId)
		manager.endSpan(child.spanId, "ok")
		manager.endSpan(parent.spanId, "ok")
		expect(manager.getStats().spansStarted).toBe(2)
		expect(manager.getStats().spansEnded).toBe(2)
	})
})

describe("Observability Module Index", () => {
	it("should export all expected classes", () => {
		const mod = require("../orchestrator/observability/index")
		expect(mod.ObservabilityManager).toBeTruthy()
		expect(mod.ObservabilityProvider).toBeTruthy()
		expect(mod.ConsoleProvider).toBeTruthy()
		expect(mod.DatadogProvider).toBeTruthy()
		expect(mod.SentryProvider).toBeTruthy()
	})
})
