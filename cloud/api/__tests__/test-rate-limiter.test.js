/**
 * Rate Limiter Tests
 *
 * Tests for the generic API rate limiter module.
 * Run with: node cloud/api/__tests__/test-rate-limiter.test.js
 */

const assert = require("assert")

/** @type {number} */
let passed = 0
/** @type {number} */
let failed = 0
/** @type {{ name: string, error: string }[]} */
let failures = []

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
	try {
		fn()
		passed++
	} catch (/** @type {any} */ e) {
		failed++
		failures.push({ name, error: e.message })
	}
}

/**
 * @param {string} title
 */
function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiter Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("rateLimiter")

// Fresh require to get a clean state
delete require.cache[require.resolve("../rateLimiter.js")]
const rateLimiter = require("../rateLimiter.js")

// --- Basic check ---

test("allows first request", () => {
	const result = rateLimiter.check("127.0.0.1", "read")
	assert.strictEqual(result.allowed, true)
	assert.strictEqual(result.remaining, 60, "remaining is calculated before push, so 60 - 0 = 60")
})

test("allows up to max requests", () => {
	rateLimiter.reset("test-ip-1")
	for (let i = 0; i < 60; i++) {
		const result = rateLimiter.check("test-ip-1", "read")
		assert.strictEqual(result.allowed, true)
	}
})

test("blocks after max requests", () => {
	rateLimiter.reset("test-ip-2")
	// Fill up the window
	for (let i = 0; i < 60; i++) {
		rateLimiter.check("test-ip-2", "read")
	}
	// Next request should be blocked
	const result = rateLimiter.check("test-ip-2", "read")
	assert.strictEqual(result.allowed, false)
	assert.strictEqual(result.remaining, 0)
})

test("returns correct remaining count", () => {
	rateLimiter.reset("test-ip-3")
	for (let i = 0; i < 10; i++) {
		rateLimiter.check("test-ip-3", "read")
	}
	const result = rateLimiter.check("test-ip-3", "read")
	assert.strictEqual(
		result.remaining,
		50,
		"remaining = maxRequests - timestamps.length (before push), so 60 - 10 = 50",
	)
})

// --- Tier resolution ---

test("resolveTier returns read for GET", () => {
	assert.strictEqual(rateLimiter.resolveTier("/health", "GET"), "read")
	assert.strictEqual(rateLimiter.resolveTier("/system", "GET"), "read")
})

test("resolveTier returns write for POST", () => {
	assert.strictEqual(rateLimiter.resolveTier("/deploy", "POST"), "write")
	assert.strictEqual(rateLimiter.resolveTier("/jobs/create", "POST"), "write")
})

test("resolveTier returns auth for /auth/*", () => {
	assert.strictEqual(rateLimiter.resolveTier("/auth/login", "POST"), "auth")
	assert.strictEqual(rateLimiter.resolveTier("/auth/refresh", "POST"), "auth")
})

test("resolveTier returns heavy for vision analyze", () => {
	assert.strictEqual(rateLimiter.resolveTier("/vision/analyze", "POST"), "heavy")
})

test("resolveTier falls back to read for unknown GET", () => {
	assert.strictEqual(rateLimiter.resolveTier("/unknown/route", "GET"), "read")
})

test("resolveTier falls back to write for unknown POST", () => {
	assert.strictEqual(rateLimiter.resolveTier("/unknown/route", "POST"), "write")
})

// --- Per-tier limits ---

test("write tier has stricter limits than read", () => {
	rateLimiter.reset("test-ip-write")
	for (let i = 0; i < 20; i++) {
		rateLimiter.check("test-ip-write", "write")
	}
	const result = rateLimiter.check("test-ip-write", "write")
	assert.strictEqual(result.allowed, false)
})

test("auth tier has strictest limits", () => {
	rateLimiter.reset("test-ip-auth")
	for (let i = 0; i < 5; i++) {
		rateLimiter.check("test-ip-auth", "auth")
	}
	const result = rateLimiter.check("test-ip-auth", "auth")
	assert.strictEqual(result.allowed, false)
})

test("heavy tier limits to 10 per minute", () => {
	rateLimiter.reset("test-ip-heavy")
	for (let i = 0; i < 10; i++) {
		rateLimiter.check("test-ip-heavy", "heavy")
	}
	const result = rateLimiter.check("test-ip-heavy", "heavy")
	assert.strictEqual(result.allowed, false)
})

// --- IP isolation ---

test("different IPs have independent counters", () => {
	rateLimiter.reset("ip-a")
	rateLimiter.reset("ip-b")

	// Fill ip-a
	for (let i = 0; i < 60; i++) {
		rateLimiter.check("ip-a", "read")
	}

	// ip-b should still be allowed
	const result = rateLimiter.check("ip-b", "read")
	assert.strictEqual(result.allowed, true)
	assert.strictEqual(result.remaining, 60, "fresh IP has all 60 remaining")
})

// --- Different tiers are independent ---

test("different tiers for same IP are independent", () => {
	rateLimiter.reset("test-ip-multi")
	// Fill read tier
	for (let i = 0; i < 60; i++) {
		rateLimiter.check("test-ip-multi", "read")
	}
	// Write tier should still be available
	const result = rateLimiter.check("test-ip-multi", "write")
	assert.strictEqual(result.allowed, true)
})

// --- Reset ---

test("reset clears specific IP and tier", () => {
	rateLimiter.reset("test-ip-reset")
	for (let i = 0; i < 60; i++) {
		rateLimiter.check("test-ip-reset", "read")
	}
	assert.strictEqual(rateLimiter.check("test-ip-reset", "read").allowed, false)

	rateLimiter.reset("test-ip-reset", "read")
	assert.strictEqual(rateLimiter.check("test-ip-reset", "read").allowed, true)
})

test("resetAll clears everything", () => {
	rateLimiter.check("reset-all-test", "read")
	rateLimiter.check("reset-all-test-2", "write")
	rateLimiter.resetAll()

	const stats = rateLimiter.getStats()
	assert.strictEqual(stats.totalIps, 0)
})

// --- getRemaining ---

test("getRemaining returns max for unused IP", () => {
	assert.strictEqual(rateLimiter.getRemaining("fresh-ip", "read"), 60)
})

test("getRemaining returns correct count after some requests", () => {
	rateLimiter.reset("remaining-test")
	for (let i = 0; i < 10; i++) {
		rateLimiter.check("remaining-test", "read")
	}
	assert.strictEqual(rateLimiter.getRemaining("remaining-test", "read"), 50)
})

// --- getClientIp ---

test("getClientIp returns X-Forwarded-For first IP", () => {
	const req = {
		headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
		socket: { remoteAddress: "10.0.0.1" },
	}
	assert.strictEqual(rateLimiter.getClientIp(req), "203.0.113.1")
})

test("getClientIp falls back to remoteAddress", () => {
	const req = {
		headers: {},
		socket: { remoteAddress: "192.168.1.1" },
	}
	assert.strictEqual(rateLimiter.getClientIp(req), "192.168.1.1")
})

test("getClientIp defaults to 127.0.0.1", () => {
	const req = { headers: {}, socket: {} }
	assert.strictEqual(rateLimiter.getClientIp(req), "127.0.0.1")
})

// --- getStats ---

test("getStats returns correct counts", () => {
	rateLimiter.resetAll()
	rateLimiter.check("stats-ip-1", "read")
	rateLimiter.check("stats-ip-2", "write")
	rateLimiter.check("stats-ip-2", "write")

	const stats = rateLimiter.getStats()
	assert.strictEqual(stats.totalIps, 2)
	assert.ok(stats.tiers.read >= 1)
	assert.ok(stats.tiers.write >= 1)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(60))
console.log("  TOTAL RESULTS: " + passed + " passed, " + failed + " failed")
console.log("=".repeat(60))

if (failures.length > 0) {
	console.log("\n  Failures:")
	for (const f of failures) {
		console.log("    ✗ " + f.name + ": " + f.error)
	}
	process.exit(1)
} else {
	console.log("\n  All tests passed! ✓\n")
}
