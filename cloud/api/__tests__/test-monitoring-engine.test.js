/**
 * Tests for the Monitoring Engine.
 *
 * Run with: cd cloud && node api/__tests__/test-monitoring-engine.test.js
 */

const path = require("path")
const fs = require("fs")
const os = require("os")

// ── Test Framework ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
let currentSection = ""

function section(title) {
	currentSection = title
	console.log(`\n  ${title}`)
}

function test(name, fn) {
	try {
		fn()
		passed++
		console.log(`    ✅ ${name}`)
	} catch (err) {
		failed++
		console.log(`    ❌ ${name}: ${err.message}`)
	}
}

// ── Tests ───────────────────────────────────────────────────────────────────────

async function main() {
	console.log("\nMonitoring Engine Tests")
	console.log("═══════════════════════")

	const monitoringEngine = require("../monitoringEngine")

	section("Default Rules")

	test("has 8 default alert rules", () => {
		const rules = monitoringEngine.DEFAULT_RULES
		if (!Array.isArray(rules)) throw new Error("DEFAULT_RULES is not an array")
		if (rules.length !== 8) throw new Error(`Expected 8 rules, got ${rules.length}`)
	})

	test("each rule has required fields", () => {
		const rules = monitoringEngine.DEFAULT_RULES
		for (const rule of rules) {
			if (!rule.id) throw new Error(`Missing id in rule: ${JSON.stringify(rule)}`)
			if (!rule.name) throw new Error(`Missing name in rule: ${rule.id}`)
			if (!rule.metric) throw new Error(`Missing metric in rule: ${rule.id}`)
			if (!rule.condition) throw new Error(`Missing condition in rule: ${rule.id}`)
			if (rule.threshold === undefined) throw new Error(`Missing threshold in rule: ${rule.id}`)
			if (!rule.severity) throw new Error(`Missing severity in rule: ${rule.id}`)
			if (!["warning", "critical"].includes(rule.severity)) {
				throw new Error(`Invalid severity ${rule.severity} in rule: ${rule.id}`)
			}
		}
	})

	section("Alert History")

	test("getAlertHistory returns empty initially", () => {
		const result = monitoringEngine.getAlertHistory()
		if (!Array.isArray(result.alerts)) throw new Error("alerts is not an array")
		if (result.total !== 0) throw new Error(`Expected 0 alerts, got ${result.total}`)
	})

	test("getAlertHistory respects limit and offset", () => {
		const result = monitoringEngine.getAlertHistory(10, 0)
		if (result.alerts.length > 10) throw new Error(`Expected at most 10 alerts, got ${result.alerts.length}`)
	})

	section("Alert Rules")

	test("getRules returns all rules", () => {
		const rules = monitoringEngine.getRules()
		if (!Array.isArray(rules)) throw new Error("rules is not an array")
		if (rules.length !== 8) throw new Error(`Expected 8 rules, got ${rules.length}`)
	})

	test("updateRule modifies a rule", () => {
		const updated = monitoringEngine.updateRule("cpu-high", { threshold: 3.0 })
		if (!updated) throw new Error("updateRule returned null")
		if (updated.threshold !== 3.0) throw new Error(`Expected threshold 3.0, got ${updated.threshold}`)

		// Verify persistence
		const rules = monitoringEngine.getRules()
		const cpuRule = rules.find((r) => r.id === "cpu-high")
		if (!cpuRule) throw new Error("cpu-high rule not found")
		if (cpuRule.threshold !== 3.0) throw new Error(`Expected threshold 3.0, got ${cpuRule.threshold}`)

		// Restore
		monitoringEngine.updateRule("cpu-high", { threshold: 2.0 })
	})

	test("updateRule returns null for unknown rule", () => {
		const result = monitoringEngine.updateRule("nonexistent", { threshold: 1 })
		if (result !== null) throw new Error("Expected null for unknown rule")
	})

	section("Alert Lifecycle")

	test("acknowledgeAlert returns false for unknown alert", () => {
		const result = monitoringEngine.acknowledgeAlert("nonexistent")
		if (result !== false) throw new Error("Expected false for unknown alert")
	})

	test("resolveAlert returns false for unknown alert", () => {
		const result = monitoringEngine.resolveAlert("nonexistent")
		if (result !== false) throw new Error("Expected false for unknown alert")
	})

	section("Alert Stats")

	test("getStats returns valid structure", () => {
		const stats = monitoringEngine.getStats()
		if (typeof stats.totalAlerts !== "number") throw new Error("Missing totalAlerts")
		if (typeof stats.recent24h !== "number") throw new Error("Missing recent24h")
		if (typeof stats.critical24h !== "number") throw new Error("Missing critical24h")
		if (typeof stats.unacknowledged !== "number") throw new Error("Missing unacknowledged")
		if (typeof stats.rulesEnabled !== "number") throw new Error("Missing rulesEnabled")
		if (typeof stats.rulesTotal !== "number") throw new Error("Missing rulesTotal")
		if (stats.rulesTotal !== 8) throw new Error(`Expected 8 total rules, got ${stats.rulesTotal}`)
	})

	section("Collect Metrics")

	test("collectMetrics returns system metrics", async () => {
		try {
			const metrics = await monitoringEngine.collectMetrics()
			if (!metrics) throw new Error("collectMetrics returned null")
			if (!metrics.cpu) throw new Error("Missing cpu")
			if (!metrics.memory) throw new Error("Missing memory")
			if (typeof metrics.memory.usagePercent !== "number") throw new Error("Missing memory.usagePercent")
			if (!metrics.timestamp) throw new Error("Missing timestamp")
		} catch (err) {
			throw new Error(`collectMetrics failed: ${err.message}`)
		}
	})

	// ── Summary ──────────────────────────────────────────────────────────

	console.log("\n═══════════════════════")
	console.log(`Results: ${passed} passed, ${failed} failed\n`)

	if (failed > 0) {
		process.exit(1)
	}
}

main().catch((err) => {
	console.error("Fatal error:", err)
	process.exit(1)
})
