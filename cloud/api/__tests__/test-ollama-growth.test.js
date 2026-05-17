/**
 * Tests for ollama-growth API endpoint
 * Run with: node cloud/api/__tests__/test-ollama-growth.test.js
 */

const assert = require("assert")
const path = require("path")

// We can't easily require api.js (it starts a server), so we test the endpoint via HTTP
const TEST_API_URL = process.env.TEST_API_URL || "http://127.0.0.1:8787"

async function test(name, fn) {
	try {
		await fn()
		console.log("  ✅", name)
	} catch (e) {
		console.log("  ❌", name)
		console.log("     ", e.message)
		process.exitCode = 1
	}
}

async function fetchJson(url) {
	const http = require("http")
	return new Promise((resolve, reject) => {
		const req = http.get(url, { timeout: 10_000 }, (res) => {
			let data = ""
			res.on("data", (c) => (data += c))
			res.on("end", () => {
				try {
					resolve(JSON.parse(data))
				} catch {
					reject(new Error("Invalid JSON: " + data.slice(0, 200)))
				}
			})
		})
		req.on("error", reject)
		req.on("timeout", () => {
			req.destroy()
			reject(new Error("timeout"))
		})
	})
}

;(async () => {
	console.log("\nOllama Growth API Tests")
	console.log("Target:", TEST_API_URL)
	console.log("")

	await test("GET /ollama-growth returns success", async () => {
		const data = await fetchJson(TEST_API_URL + "/ollama-growth")
		assert.strictEqual(data.success, true, "Expected success=true")
	})

	await test("Response has readiness object", async () => {
		const data = await fetchJson(TEST_API_URL + "/ollama-growth")
		assert.ok(data.readiness, "Missing readiness")
		assert.ok(typeof data.readiness.total_score === "number", "total_score should be number")
		assert.ok(typeof data.readiness.level === "string", "level should be string")
		assert.ok(typeof data.readiness.recommendation === "string", "recommendation should be string")
	})

	await test("Response has growth object", async () => {
		const data = await fetchJson(TEST_API_URL + "/ollama-growth")
		assert.ok(data.growth, "Missing growth")
		assert.ok(typeof data.growth.event_count === "number", "event_count should be number")
		assert.ok(typeof data.growth.event_types === "object", "event_types should be object")
	})

	await test("Response has timeline array", async () => {
		const data = await fetchJson(TEST_API_URL + "/ollama-growth")
		assert.ok(Array.isArray(data.timeline), "timeline should be array")
	})

	await test("Readiness handles mixed schema checks gracefully", async () => {
		const data = await fetchJson(TEST_API_URL + "/ollama-growth")
		assert.ok(typeof data.readiness.has_breakdown === "boolean", "has_breakdown should be boolean")
		// latest_check may be simple (health) or detailed (audit) — either is valid
		assert.ok(data.readiness.latest_check, "latest_check should exist")
	})

	console.log("")
	if (process.exitCode) {
		console.log("Some tests failed.")
	} else {
		console.log("All tests passed! ✅")
	}
})()
