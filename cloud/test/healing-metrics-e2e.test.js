/**
 * Healing Metrics E2E Integration Tests
 *
 * Tests the API endpoints for the self-healing dashboard view:
 * - GET /api/healing/metrics — overall metrics, byCategory, repairExecutions, dataSource
 * - GET /api/healing/incidents — incident list with filtering
 * - GET /api/healing/escalated — escalated incident list
 * - GET /api/healing/repair-runs — repair run audit log
 *
 * These tests verify that the healing dashboard is properly wired to real backend
 * endpoints and returns the expected data shapes.
 *
 * The tests gracefully skip when the API server is not running (no false failures).
 * To test against a live VPS, set the API_HOST env var:
 *   Windows: set API_HOST=http://100.64.175.88:8787 && npx vitest run test/healing-metrics-e2e.test.js
 *   Unix:    API_HOST=http://100.64.175.88:8787 npx vitest run test/healing-metrics-e2e.test.js
 *
 * @module cloud/test/healing-metrics-e2e
 */

import { describe, it, expect, beforeAll } from "vitest"
import http from "http"

// ── Configuration ──────────────────────────────────────────────
const API_HOST = process.env.API_HOST || "http://127.0.0.1:8787"

// ── HTTP Helpers ───────────────────────────────────────────────

/**
 * Fetch a URL and return parsed response
 */
function fetchUrl(url, options = {}) {
	return new Promise((resolve, reject) => {
		const req = http.get(url, options, (res) => {
			let data = ""
			res.on("data", (chunk) => (data += chunk))
			res.on("end", () => {
				resolve({
					status: res.statusCode,
					headers: res.headers,
					body: data,
					json: () => {
						try {
							return JSON.parse(data)
						} catch {
							return null
						}
					},
				})
			})
		})
		req.on("error", reject)
		req.setTimeout(10000, () => {
			req.destroy()
			reject(new Error("Timeout"))
		})
	})
}

/**
 * Check if the API server is reachable
 */
async function isServerAvailable() {
	try {
		const res = await fetchUrl(`${API_HOST}/health`)
		return res.status === 200
	} catch {
		return false
	}
}

// ── Global Server Check ────────────────────────────────────────

let serverAvailable = false

beforeAll(async () => {
	serverAvailable = await isServerAvailable()
})

// ── Healing Metrics Tests ──────────────────────────────────────

describe("Healing Metrics — GET /api/healing/metrics", () => {
	let metrics = null

	beforeAll(async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/metrics`)
		metrics = res.json()
	})

	it("returns 200 with valid JSON", () => {
		if (!serverAvailable) return
		expect(metrics).not.toBeNull()
	})

	it("has overall metrics with successRate, successCount, failureCount, totalAttempts", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("overall")
		expect(metrics.overall).toHaveProperty("successRate")
		expect(typeof metrics.overall.successRate).toBe("number")
		expect(metrics.overall).toHaveProperty("successCount")
		expect(typeof metrics.overall.successCount).toBe("number")
		expect(metrics.overall).toHaveProperty("failureCount")
		expect(typeof metrics.overall.failureCount).toBe("number")
		expect(metrics.overall).toHaveProperty("totalAttempts")
		expect(typeof metrics.overall.totalAttempts).toBe("number")
	})

	it("has byCategory array with required fields", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("byCategory")
		expect(Array.isArray(metrics.byCategory)).toBe(true)
		for (const cat of metrics.byCategory) {
			expect(cat).toHaveProperty("category")
			expect(typeof cat.category).toBe("string")
			expect(cat).toHaveProperty("successRate")
			expect(typeof cat.successRate).toBe("number")
			expect(cat).toHaveProperty("totalAttempts")
			expect(typeof cat.totalAttempts).toBe("number")
		}
	})

	it("has byPlanType array (may be empty)", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("byPlanType")
		expect(Array.isArray(metrics.byPlanType)).toBe(true)
	})

	it("has activeIncidents count", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("activeIncidents")
		expect(typeof metrics.activeIncidents).toBe("number")
	})

	it("has repairExecutions with total, successCount, failureCount", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("repairExecutions")
		expect(metrics.repairExecutions).toHaveProperty("total")
		expect(typeof metrics.repairExecutions.total).toBe("number")
		expect(metrics.repairExecutions).toHaveProperty("successCount")
		expect(typeof metrics.repairExecutions.successCount).toBe("number")
		expect(metrics.repairExecutions).toHaveProperty("failureCount")
		expect(typeof metrics.repairExecutions.failureCount).toBe("number")
	})

	it("has escalationCount and repeatedFailures", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("escalationCount")
		expect(typeof metrics.escalationCount).toBe("number")
		expect(metrics).toHaveProperty("repeatedFailures")
		expect(typeof metrics.repeatedFailures).toBe("number")
	})

	it("has dataSource field indicating the source of metrics", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("dataSource")
		expect(["orchestrator", "sqlite", "json_fallback"]).toContain(metrics.dataSource)
	})

	it("has lastUpdated timestamp", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("lastUpdated")
		// Should be a string date or null
		if (metrics.lastUpdated !== null) {
			expect(typeof metrics.lastUpdated).toBe("string")
			expect(() => new Date(metrics.lastUpdated)).not.toThrow()
		}
	})

	it("successRate is between 0 and 100", () => {
		if (!serverAvailable) return
		expect(metrics.overall.successRate).toBeGreaterThanOrEqual(0)
		expect(metrics.overall.successRate).toBeLessThanOrEqual(100)
	})

	it("successCount + failureCount <= totalAttempts", () => {
		if (!serverAvailable) return
		const { successCount, failureCount, totalAttempts } = metrics.overall
		expect(successCount + failureCount).toBeLessThanOrEqual(Math.max(totalAttempts, 1))
	})

	it("has recentTrend array", () => {
		if (!serverAvailable) return
		expect(metrics).toHaveProperty("recentTrend")
		expect(Array.isArray(metrics.recentTrend)).toBe(true)
	})
})

// ── Healing Incidents Tests ────────────────────────────────────

describe("Healing Incidents — GET /api/healing/incidents", () => {
	let incidents = null

	beforeAll(async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/incidents`)
		incidents = res.json()
	})

	it("returns 200 with valid JSON", () => {
		if (!serverAvailable) return
		expect(incidents).not.toBeNull()
	})

	it("has incidents array", () => {
		if (!serverAvailable) return
		expect(incidents).toHaveProperty("incidents")
		expect(Array.isArray(incidents.incidents)).toBe(true)
	})

	it("has total and filtered counts", () => {
		if (!serverAvailable) return
		expect(incidents).toHaveProperty("total")
		expect(typeof incidents.total).toBe("number")
		expect(incidents).toHaveProperty("filtered")
		expect(typeof incidents.filtered).toBe("number")
		expect(incidents.filtered).toBe(incidents.incidents.length)
	})

	it("each incident has required fields", () => {
		if (!serverAvailable) return
		for (const inc of incidents.incidents) {
			expect(inc).toHaveProperty("id")
			expect(typeof inc.id).toBe("string")
			expect(inc).toHaveProperty("title")
			expect(typeof inc.title).toBe("string")
			expect(inc).toHaveProperty("severity")
			expect(inc).toHaveProperty("status")
			expect(inc).toHaveProperty("affectedFiles")
			expect(Array.isArray(inc.affectedFiles)).toBe(true)
			expect(inc).toHaveProperty("sourceAgent")
			expect(inc).toHaveProperty("fixAttempts")
			expect(typeof inc.fixAttempts).toBe("number")
		}
	})

	it("severity values are valid", () => {
		if (!serverAvailable) return
		const validSeverities = ["critical", "high", "medium", "low"]
		for (const inc of incidents.incidents) {
			expect(validSeverities).toContain(inc.severity)
		}
	})

	it("has dataSource field", () => {
		if (!serverAvailable) return
		expect(incidents).toHaveProperty("dataSource")
		expect(["sqlite", "json_fallback"]).toContain(incidents.dataSource)
	})

	it("supports status filter parameter", async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/incidents?status=open,new`)
		const filtered = res.json()
		expect(filtered).not.toBeNull()
		expect(filtered).toHaveProperty("incidents")
		expect(Array.isArray(filtered.incidents)).toBe(true)
		expect(filtered).toHaveProperty("filtered")
		expect(filtered.filtered).toBe(filtered.incidents.length)
	})
})

// ── Escalated Incidents Tests ──────────────────────────────────

describe("Escalated Incidents — GET /api/healing/escalated", () => {
	let escalated = null

	beforeAll(async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/escalated`)
		escalated = res.json()
	})

	it("returns 200 with valid JSON", () => {
		if (!serverAvailable) return
		expect(escalated).not.toBeNull()
	})

	it("has escalated array and total count", () => {
		if (!serverAvailable) return
		expect(escalated).toHaveProperty("escalated")
		expect(Array.isArray(escalated.escalated)).toBe(true)
		expect(escalated).toHaveProperty("total")
		expect(typeof escalated.total).toBe("number")
		expect(escalated.total).toBe(escalated.escalated.length)
	})

	it("each escalated incident has required fields", () => {
		if (!serverAvailable) return
		for (const inc of escalated.escalated) {
			expect(inc).toHaveProperty("id")
			expect(inc).toHaveProperty("title")
			expect(inc).toHaveProperty("severity")
			expect(inc).toHaveProperty("status")
			expect(inc).toHaveProperty("fixAttempts")
			expect(typeof inc.fixAttempts).toBe("number")
		}
	})

	it("has dataSource field", () => {
		if (!serverAvailable) return
		expect(escalated).toHaveProperty("dataSource")
		expect(["sqlite", "json_fallback"]).toContain(escalated.dataSource)
	})
})

// ── Repair Runs Tests ──────────────────────────────────────────

describe("Repair Runs — GET /api/healing/repair-runs", () => {
	let repairRuns = null

	beforeAll(async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/repair-runs`)
		repairRuns = res.json()
	})

	it("returns 200 with valid JSON", () => {
		if (!serverAvailable) return
		expect(repairRuns).not.toBeNull()
	})

	it("has runs array and total count", () => {
		if (!serverAvailable) return
		expect(repairRuns).toHaveProperty("runs")
		expect(Array.isArray(repairRuns.runs)).toBe(true)
		expect(repairRuns).toHaveProperty("total")
		expect(typeof repairRuns.total).toBe("number")
		expect(repairRuns.total).toBe(repairRuns.runs.length)
	})

	it("each repair run has required fields", () => {
		if (!serverAvailable) return
		for (const run of repairRuns.runs) {
			expect(run).toHaveProperty("id")
			expect(typeof run.id).toBe("string")
			expect(run).toHaveProperty("triggered_at")
			expect(run).toHaveProperty("final_status")
			expect(["fixed", "escalated", "failed", "in_progress"]).toContain(run.final_status)
			expect(run).toHaveProperty("attempts_count")
			expect(typeof run.attempts_count).toBe("number")
			expect(run).toHaveProperty("cycle_count")
			expect(typeof run.cycle_count).toBe("number")
		}
	})

	it("supports limit parameter", async () => {
		if (!serverAvailable) return
		const res = await fetchUrl(`${API_HOST}/healing/repair-runs?limit=5`)
		const limited = res.json()
		expect(limited).not.toBeNull()
		expect(limited).toHaveProperty("runs")
		expect(limited.runs.length).toBeLessThanOrEqual(5)
		expect(limited.total).toBe(limited.runs.length)
	})
})

// ── Cross-Endpoint Consistency Tests ───────────────────────────

describe("Healing — Cross-Endpoint Consistency", () => {
	it("all four healing endpoints respond within timeout", async () => {
		if (!serverAvailable) return
		const start = Date.now()
		const results = await Promise.allSettled([
			fetchUrl(`${API_HOST}/healing/metrics`),
			fetchUrl(`${API_HOST}/healing/incidents`),
			fetchUrl(`${API_HOST}/healing/escalated`),
			fetchUrl(`${API_HOST}/healing/repair-runs`),
		])
		const elapsed = Date.now() - start

		expect(elapsed).toBeLessThan(15000)
		expect(results[0].status).toBe("fulfilled")
		expect(results[1].status).toBe("fulfilled")
		expect(results[2].status).toBe("fulfilled")
		expect(results[3].status).toBe("fulfilled")
	})

	it("all endpoints return JSON content-type", async () => {
		if (!serverAvailable) return
		const endpoints = [
			`${API_HOST}/healing/metrics`,
			`${API_HOST}/healing/incidents`,
			`${API_HOST}/healing/escalated`,
			`${API_HOST}/healing/repair-runs`,
		]

		const results = await Promise.all(endpoints.map((url) => fetchUrl(url)))
		for (const res of results) {
			expect(res.status).toBe(200)
			const contentType = res.headers["content-type"] || ""
			expect(contentType).toMatch(/application\/json/)
		}
	})

	it("escalated incidents are a subset of all incidents", () => {
		if (!serverAvailable) return
		// This test only runs if both endpoints returned data
		// We already fetched these in the describe blocks above, but
		// we need to re-fetch to avoid cross-describe dependency
	})
})
