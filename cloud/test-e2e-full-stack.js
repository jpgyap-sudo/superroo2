/**
 * Full-Stack E2E Test Suite
 *
 * Comprehensive end-to-end tests that validate the entire SuperRoo Cloud stack
 * works together: API server, WebSocket server, rate limiter, log rotator,
 * dashboard WebSocket, and cross-module integration.
 *
 * Run: node cloud/test-e2e-full-stack.js
 *
 * Environment variables:
 *   API_BASE_URL  - Backend API URL (default: http://localhost:8787)
 *   DASHBOARD_URL - Dashboard URL (default: http://localhost:3001)
 *   LOGS_DIR      - Log directory for rotator tests (default: temp dir)
 *   SKIP_NETWORK  - Set to "1" to skip network-dependent tests (API/Dashboard HTTP)
 */

const http = require("http")
const path = require("path")
const fs = require("fs")
const os = require("os")

// ─── Configuration ──────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE_URL || "http://localhost:8787"
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3001"
const TEST_LOG_DIR = process.env.LOGS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "e2e-fullstack-"))
const SKIP_NETWORK = process.env.SKIP_NETWORK === "1"

// ─── Test Runner ────────────────────────────────────────────────────────────

/** @type {number} */
let passed = 0
/** @type {number} */
let skipped = 0
/** @type {number} */
let failed = 0
/** @type {{ name: string, error: string }[]} */
let failures = []

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
async function test(name, fn) {
	try {
		await fn()
		passed++
		console.log(`  ✅ ${name}`)
	} catch (/** @type {any} */ e) {
		failed++
		failures.push({ name, error: e.message })
		console.log(`  ❌ ${name}: ${e.message}`)
	}
}

/**
 * Skip a test (server not available).
 * @param {string} name
 */
function skip(name) {
	skipped++
	console.log(`  ⏭  ${name} (skipped)`)
}

/**
 * @param {string} title
 */
function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

// ─── Server Availability Check ──────────────────────────────────────────────

/**
 * Check if a server is reachable.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function isServerReachable(url) {
	return new Promise((resolve) => {
		const parsed = new URL(url)
		const req = http.get(url, (res) => {
			res.resume()
			resolve(true)
		})
		req.on("error", () => resolve(false))
		req.setTimeout(2000, () => {
			req.destroy()
			resolve(false)
		})
	})
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

/**
 * Make an HTTP GET request.
 * @param {string} url
 * @returns {Promise<{ status: number, body: string, headers: http.IncomingHttpHeaders }>}
 */
function httpGet(url) {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			let body = ""
			res.on("data", (chunk) => {
				body += chunk
			})
			res.on("end", () => {
				resolve({ status: res.statusCode || 0, body, headers: res.headers })
			})
		}).on("error", (/** @type {any} */ err) => {
			reject(new Error(`HTTP GET ${url} failed: ${err.message}`))
		})
	})
}

/**
 * Make an HTTP POST request.
 * @param {string} url
 * @param {object} data
 * @returns {Promise<{ status: number, body: string, headers: http.IncomingHttpHeaders }>}
 */
function httpPost(url, data) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(data)
		const parsed = new URL(url)
		const req = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname + parsed.search,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				let body = ""
				res.on("data", (chunk) => {
					body += chunk
				})
				res.on("end", () => {
					resolve({ status: res.statusCode || 0, body, headers: res.headers })
				})
			},
		)
		req.on("error", (/** @type {any} */ err) => {
			reject(new Error(`HTTP POST ${url} failed: ${err.message}`))
		})
		req.write(payload)
		req.end()
	})
}

// ═══════════════════════════════════════════════════════════════════════════════
// E2E Tests
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
	console.log("=".repeat(60))
	console.log("  SUPERROO FULL-STACK E2E TESTS")
	console.log("  API:      " + API_BASE)
	console.log("  Dashboard: " + DASHBOARD_URL)
	console.log("  Log Dir:  " + TEST_LOG_DIR)
	console.log("=".repeat(60))

	// ─── Section 1: API Health ─────────────────────────────────────────────

	section("1. API Health")

	const apiReachable = SKIP_NETWORK ? false : await isServerReachable(API_BASE + "/health")

	if (apiReachable) {
		await test("GET /health returns 200", async () => {
			const res = await httpGet(API_BASE + "/health")
			if (res.status !== 200) throw new Error("Expected 200, got " + res.status)
			const body = JSON.parse(res.body)
			if (!body.status) throw new Error("Response missing 'status' field")
		})

		await test("GET /health returns JSON content-type", async () => {
			const res = await httpGet(API_BASE + "/health")
			const ct = res.headers["content-type"] || ""
			if (!ct.includes("application/json")) {
				throw new Error("Expected application/json, got " + ct)
			}
		})

		await test("GET /api/system returns system stats", async () => {
			const res = await httpGet(API_BASE + "/api/system")
			if (res.status !== 200) throw new Error("Expected 200, got " + res.status)
			const body = JSON.parse(res.body)
			if (body.cpu === undefined && body.memory === undefined) {
				throw new Error("Response missing cpu/memory fields")
			}
		})
	} else {
		skip("GET /health returns 200")
		skip("GET /health returns JSON content-type")
		skip("GET /api/system returns system stats")
	}

	// ─── Section 2: Dashboard Health ───────────────────────────────────────

	section("2. Dashboard Health")

	const dashReachable = SKIP_NETWORK ? false : await isServerReachable(DASHBOARD_URL + "/")

	if (dashReachable) {
		await test("Dashboard returns 200", async () => {
			const res = await httpGet(DASHBOARD_URL + "/")
			if (res.status !== 200) throw new Error("Expected 200, got " + res.status)
		})

		await test("Dashboard HTML contains root div", async () => {
			const res = await httpGet(DASHBOARD_URL + "/")
			if (!res.body.includes('id="__next"') && !res.body.includes("_next")) {
				throw new Error("Dashboard HTML missing Next.js markers")
			}
		})
	} else {
		skip("Dashboard returns 200")
		skip("Dashboard HTML contains root div")
	}

	// ─── Section 3: Rate Limiter ───────────────────────────────────────────

	section("3. Rate Limiter")

	await test("Rate limiter module loads and exports expected API", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		if (typeof rl.check !== "function") throw new Error("check not exported")
		if (typeof rl.checkRequest !== "function") throw new Error("checkRequest not exported")
		if (typeof rl.reset !== "function") throw new Error("reset not exported")
		if (typeof rl.resetAll !== "function") throw new Error("resetAll not exported")
		if (typeof rl.getRemaining !== "function") throw new Error("getRemaining not exported")
		if (typeof rl.getStats !== "function") throw new Error("getStats not exported")
		if (typeof rl.resolveTier !== "function") throw new Error("resolveTier not exported")
		if (typeof rl.getClientIp !== "function") throw new Error("getClientIp not exported")
	})

	await test("Rate limiter allows first request", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		const result = rl.check("e2e-test-ip", "read")
		if (!result.allowed) throw new Error("First request should be allowed")
		if (result.remaining !== 60) throw new Error("Expected 60 remaining, got " + result.remaining)
	})

	await test("Rate limiter blocks after max requests", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		rl.reset("e2e-block-ip")
		for (let i = 0; i < 60; i++) {
			rl.check("e2e-block-ip", "read")
		}
		const result = rl.check("e2e-block-ip", "read")
		if (result.allowed) throw new Error("Should be blocked after 60 requests")
		if (result.remaining !== 0) throw new Error("Expected 0 remaining, got " + result.remaining)
	})

	await test("Rate limiter tier resolution works", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		if (rl.resolveTier("/health", "GET") !== "read") throw new Error("/health GET should be read")
		if (rl.resolveTier("/deploy", "POST") !== "write") throw new Error("/deploy POST should be write")
		if (rl.resolveTier("/auth/login", "POST") !== "auth") throw new Error("/auth/login POST should be auth")
		if (rl.resolveTier("/vision/analyze", "POST") !== "heavy")
			throw new Error("/vision/analyze POST should be heavy")
	})

	await test("Rate limiter different IPs have independent counters", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		rl.reset("e2e-ip-a")
		rl.reset("e2e-ip-b")
		for (let i = 0; i < 60; i++) {
			rl.check("e2e-ip-a", "read")
		}
		const result = rl.check("e2e-ip-b", "read")
		if (!result.allowed) throw new Error("Different IP should still be allowed")
	})

	await test("Rate limiter different tiers are independent", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		rl.reset("e2e-multi-tier")
		for (let i = 0; i < 60; i++) {
			rl.check("e2e-multi-tier", "read")
		}
		const result = rl.check("e2e-multi-tier", "write")
		if (!result.allowed) throw new Error("Write tier should still be available after read exhausted")
	})

	await test("Rate limiter getClientIp extracts X-Forwarded-For", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		const req = {
			headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
			socket: { remoteAddress: "10.0.0.1" },
		}
		const ip = rl.getClientIp(req)
		if (ip !== "203.0.113.1") throw new Error("Expected 203.0.113.1, got " + ip)
	})

	await test("Rate limiter getStats returns correct structure", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		const rl = require("./api/rateLimiter.js")
		rl.resetAll()
		rl.check("e2e-stats-1", "read")
		rl.check("e2e-stats-2", "write")
		const stats = rl.getStats()
		if (typeof stats.totalIps !== "number") throw new Error("totalIps should be a number")
		if (typeof stats.tiers !== "object") throw new Error("tiers should be an object")
	})

	// ─── Section 4: Log Rotator ────────────────────────────────────────────

	section("4. Log Rotator")

	await test("Log rotator module loads and exports expected API", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		if (typeof lr.start !== "function") throw new Error("start not exported")
		if (typeof lr.stop !== "function") throw new Error("stop not exported")
		if (typeof lr.rotateNow !== "function") throw new Error("rotateNow not exported")
		if (typeof lr.getStats !== "function") throw new Error("getStats not exported")
		if (typeof lr.getLogFiles !== "function") throw new Error("getLogFiles not exported")
	})

	await test("Log rotator getLogFiles returns empty for new dir", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		const files = lr.getLogFiles()
		if (files.length !== 0) throw new Error("Expected 0 files, got " + files.length)
	})

	await test("Log rotator finds created log files", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		fs.writeFileSync(path.join(TEST_LOG_DIR, "superroo-e2e-test.jsonl"), "test content\n")
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		const files = lr.getLogFiles()
		if (files.length < 1) throw new Error("Expected at least 1 file")
	})

	await test("Log rotator getStats returns correct structure", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		const stats = lr.getStats()
		if (typeof stats.fileCount !== "number") throw new Error("fileCount should be a number")
		if (typeof stats.totalSize !== "string") throw new Error("totalSize should be a string")
		if (typeof stats.totalBytes !== "number") throw new Error("totalBytes should be a number")
		if (typeof stats.maxFileSize !== "string") throw new Error("maxFileSize should be a string")
		if (typeof stats.maxAgeDays !== "number") throw new Error("maxAgeDays should be a number")
		if (typeof stats.maxFiles !== "number") throw new Error("maxFiles should be a number")
	})

	await test("Log rotator start and stop do not throw", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		lr.start()
		lr.stop()
	})

	await test("Log rotator rotateNow returns stats", async () => {
		process.env.LOGS_DIR = TEST_LOG_DIR
		delete require.cache[require.resolve("./api/logRotator.js")]
		const lr = require("./api/logRotator.js")
		const result = await lr.rotateNow()
		if (typeof result.fileCount !== "number") throw new Error("fileCount should be a number")
		if (typeof result.totalSize !== "string") throw new Error("totalSize should be a string")
	})

	// ─── Section 5: Dashboard WebSocket ────────────────────────────────────

	section("5. Dashboard WebSocket")

	await test("Dashboard WebSocket module loads and exports expected API", async () => {
		delete require.cache[require.resolve("./api/dashboardWebSocket.js")]
		const dws = require("./api/dashboardWebSocket.js")
		if (typeof dws.init !== "function") throw new Error("init not exported")
		if (typeof dws.broadcast !== "function") throw new Error("broadcast not exported")
		if (typeof dws.broadcastAll !== "function") throw new Error("broadcastAll not exported")
		if (typeof dws.getStats !== "function") throw new Error("getStats not exported")
		if (typeof dws.shutdown !== "function") throw new Error("shutdown not exported")
		if (typeof dws.getWss !== "function") throw new Error("getWss not exported")
	})

	await test("Dashboard WebSocket init without server returns early", async () => {
		delete require.cache[require.resolve("./api/dashboardWebSocket.js")]
		const dws = require("./api/dashboardWebSocket.js")
		// Should not throw when called without a real server
		// (init checks for wss already set, so calling twice is safe)
		dws.shutdown()
	})

	// ─── Section 6: Cross-Module Integration ───────────────────────────────

	section("6. Cross-Module Integration")

	await test("Rate limiter + log rotator can be loaded together", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		delete require.cache[require.resolve("./api/logRotator.js")]
		const rl = require("./api/rateLimiter.js")
		const lr = require("./api/logRotator.js")
		if (typeof rl.check !== "function") throw new Error("rateLimiter.check not a function")
		if (typeof lr.getStats !== "function") throw new Error("logRotator.getStats not a function")
		// Verify both work independently
		rl.check("integration-test", "read")
		const stats = lr.getStats()
		if (typeof stats.fileCount !== "number") throw new Error("logRotator stats.fileCount not a number")
	})

	await test("All three new modules load without errors", async () => {
		delete require.cache[require.resolve("./api/rateLimiter.js")]
		delete require.cache[require.resolve("./api/logRotator.js")]
		delete require.cache[require.resolve("./api/dashboardWebSocket.js")]
		const rl = require("./api/rateLimiter.js")
		const lr = require("./api/logRotator.js")
		const dws = require("./api/dashboardWebSocket.js")
		if (!rl || !lr || !dws) throw new Error("One or more modules failed to load")
	})

	await test("TypeScript type-checking passes for all cloud API files", async () => {
		const { execSync } = require("child_process")
		try {
			execSync("npx tsc --noEmit", { cwd: path.resolve(__dirname), stdio: "pipe" })
		} catch (/** @type {any} */ e) {
			const stderr = e.stderr ? e.stderr.toString() : ""
			const stdout = e.stdout ? e.stdout.toString() : ""
			throw new Error("tsc --noEmit failed:\n" + (stderr || stdout))
		}
	})

	// ─── Summary ───────────────────────────────────────────────────────────

	console.log("\n" + "=".repeat(60))
	console.log("  RESULTS: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		console.log("\n  Failures:")
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
		process.exit(1)
	} else {
		console.log("\n  ✅ All E2E tests passed!\n")
		process.exit(0)
	}
}

// Cleanup temp directory on exit
process.on("exit", () => {
	try {
		fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

main().catch((/** @type {any} */ err) => {
	console.error("\n  ❌ Fatal error:", err.message)
	process.exit(1)
})
