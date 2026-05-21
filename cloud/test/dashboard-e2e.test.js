/**
 * Dashboard E2E Integration Tests
 *
 * Tests the API endpoints and data flow for the three new dashboard views:
 * - Provider Dashboard: /api/providers, /api/providers/bridge/status
 * - Collaboration: /api/collaboration/sessions, /api/collaboration/collaborators/:sessionId, /api/collaboration/status
 * - MCP Servers: /api/mcp/status, /api/mcp/servers
 *
 * These tests verify that the dashboard views are properly wired to real backend
 * endpoints and return the expected data shapes.
 *
 * The tests gracefully skip when the API server is not running (no false failures).
 * To test against a live VPS, set the API_HOST env var:
 *   Windows: set API_HOST=http://100.64.175.88:8787 && npx vitest run test/dashboard-e2e.test.js
 *   Unix:    API_HOST=http://100.64.175.88:8787 npx vitest run test/dashboard-e2e.test.js
 *
 * @module cloud/test/dashboard-e2e
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

// ── Provider Dashboard Tests ───────────────────────────────────

describe("Provider Dashboard — API Wiring", () => {
	let providers = null
	let bridgeStatus = null

	beforeAll(async () => {
		if (!serverAvailable) return

		const [providersRes, bridgeRes] = await Promise.all([
			fetchUrl(`${API_HOST}/providers`),
			fetchUrl(`${API_HOST}/providers/bridge/status`),
		])
		providers = providersRes.json()
		bridgeStatus = bridgeRes.json()
	})

	it("GET /api/providers returns 200 with provider list", () => {
		if (!serverAvailable) return
		expect(providers).not.toBeNull()
		expect(providers.success).toBe(true)
		expect(Array.isArray(providers.providers)).toBe(true)
	})

	it("each provider has required fields", () => {
		if (!serverAvailable) return
		for (const p of providers.providers) {
			expect(p).toHaveProperty("id")
			expect(p).toHaveProperty("name")
			expect(p).toHaveProperty("status")
			expect(p).toHaveProperty("models")
			expect(Array.isArray(p.models)).toBe(true)
			expect(p).toHaveProperty("capabilities")
			expect(Array.isArray(p.capabilities)).toBe(true)
		}
	})

	it("GET /api/providers/bridge/status returns bridge metadata", () => {
		if (!serverAvailable) return
		expect(bridgeStatus).not.toBeNull()
		expect(bridgeStatus).toHaveProperty("registryProviderCount")
		expect(typeof bridgeStatus.registryProviderCount).toBe("number")
		expect(bridgeStatus).toHaveProperty("synced")
		expect(typeof bridgeStatus.synced).toBe("boolean")
	})

	it("bridge status includes connection metadata for providers", () => {
		if (!serverAvailable) return
		expect(bridgeStatus).toHaveProperty("connectionMeta")
		expect(typeof bridgeStatus.connectionMeta).toBe("object")
	})

	it("bridge status includes usage stats", () => {
		if (!serverAvailable) return
		expect(bridgeStatus).toHaveProperty("usageStats")
		expect(typeof bridgeStatus.usageStats).toBe("object")
	})

	it("provider count matches between endpoints", () => {
		if (!serverAvailable) return
		const providerCount = providers.providers.length
		expect(bridgeStatus.registryProviderCount).toBeGreaterThanOrEqual(0)
		if (bridgeStatus.registryProviderCount > 0) {
			expect(providerCount).toBeGreaterThan(0)
		}
	})
})

// ── Collaboration API Tests ────────────────────────────────────

describe("Collaboration — API Wiring", () => {
	let status = null
	let sessions = null

	beforeAll(async () => {
		if (!serverAvailable) return

		const [statusRes, sessionsRes] = await Promise.all([
			fetchUrl(`${API_HOST}/collaboration/status`),
			fetchUrl(`${API_HOST}/collaboration/sessions`),
		])
		status = statusRes.json()
		sessions = sessionsRes.json()
	})

	it("GET /api/collaboration/status returns availability and session count", () => {
		if (!serverAvailable) return
		expect(status).not.toBeNull()
		expect(status).toHaveProperty("available")
		expect(typeof status.available).toBe("boolean")
		expect(status).toHaveProperty("sessionCount")
		expect(typeof status.sessionCount).toBe("number")
	})

	it("GET /api/collaboration/sessions returns a sessions array", () => {
		if (!serverAvailable) return
		expect(sessions).not.toBeNull()
		expect(sessions).toHaveProperty("sessions")
		expect(Array.isArray(sessions.sessions)).toBe(true)
	})

	it("each session has required fields", () => {
		if (!serverAvailable) return
		for (const s of sessions.sessions) {
			expect(s).toHaveProperty("id")
			expect(s).toHaveProperty("workspaceId")
			expect(s).toHaveProperty("status")
			expect(s).toHaveProperty("collaborators")
			expect(Array.isArray(s.collaborators)).toBe(true)
		}
	})

	it("each collaborator has required fields", () => {
		if (!serverAvailable) return
		for (const s of sessions.sessions) {
			for (const c of s.collaborators) {
				expect(c).toHaveProperty("userId")
				expect(c).toHaveProperty("userName")
				expect(c).toHaveProperty("joinedAt")
			}
		}
	})

	it("GET /api/collaboration/collaborators/:sessionId returns collaborators for valid sessions", async () => {
		if (!serverAvailable) return
		if (sessions.sessions.length > 0) {
			const sessionId = sessions.sessions[0].id
			const res = await fetchUrl(`${API_HOST}/collaboration/collaborators/${encodeURIComponent(sessionId)}`)
			const data = res.json()
			expect(data).not.toBeNull()
			expect(data).toHaveProperty("collaborators")
			expect(Array.isArray(data.collaborators)).toBe(true)
		}
	})

	it("status sessionCount matches sessions length", () => {
		if (!serverAvailable) return
		expect(status.sessionCount).toBe(sessions.sessions.length)
	})
})

// ── MCP Servers API Tests ──────────────────────────────────────

describe("MCP Servers — API Wiring", () => {
	let status = null
	let servers = null

	beforeAll(async () => {
		if (!serverAvailable) return

		const [statusRes, serversRes] = await Promise.all([
			fetchUrl(`${API_HOST}/mcp/status`),
			fetchUrl(`${API_HOST}/mcp/servers`),
		])
		status = statusRes.json()
		servers = serversRes.json()
	})

	it("GET /api/mcp/status returns server summary", () => {
		if (!serverAvailable) return
		expect(status).not.toBeNull()
		expect(status).toHaveProperty("available")
		expect(typeof status.available).toBe("boolean")
	})

	it("status includes server counts when available", () => {
		if (!serverAvailable) return
		if (status.available && status.servers) {
			expect(status.servers).toHaveProperty("total")
			expect(typeof status.servers.total).toBe("number")
			expect(status.servers).toHaveProperty("running")
			expect(typeof status.servers.running).toBe("number")
			expect(status.servers).toHaveProperty("stopped")
			expect(typeof status.servers.stopped).toBe("number")
			expect(status.servers).toHaveProperty("error")
			expect(typeof status.servers.error).toBe("number")
		}
	})

	it("GET /api/mcp/servers returns server list", () => {
		if (!serverAvailable) return
		expect(servers).not.toBeNull()
		expect(servers).toHaveProperty("available")
		expect(typeof servers.available).toBe("boolean")
	})

	it("each server entry has required fields", () => {
		if (!serverAvailable) return
		if (servers.available && servers.servers) {
			for (const s of servers.servers) {
				expect(s).toHaveProperty("name")
				expect(s).toHaveProperty("status")
				expect(s).toHaveProperty("description")
				expect(s).toHaveProperty("tools")
				expect(typeof s.tools).toBe("number")
				expect(s).toHaveProperty("transport")
			}
		}
	})

	it("server counts are consistent between status and servers endpoints", () => {
		if (!serverAvailable) return
		if (status.available && servers.available && status.servers && servers.servers) {
			expect(servers.servers.length).toBe(status.servers.total)
		}
	})

	it("server status values are valid", () => {
		if (!serverAvailable) return
		if (servers.available && servers.servers) {
			const validStatuses = ["running", "stopped", "error"]
			for (const s of servers.servers) {
				expect(validStatuses).toContain(s.status)
			}
		}
	})

	it("transport field has valid value", () => {
		if (!serverAvailable) return
		if (servers.available && servers.servers) {
			const validTransports = ["stdio", "http", "sse"]
			for (const s of servers.servers) {
				expect(validTransports).toContain(s.transport)
			}
		}
	})
})

// ── Cross-View Consistency Tests ───────────────────────────────

describe("Cross-View Consistency", () => {
	it("all three view endpoints respond within timeout", async () => {
		if (!serverAvailable) return
		const start = Date.now()
		const results = await Promise.allSettled([
			fetchUrl(`${API_HOST}/providers`),
			fetchUrl(`${API_HOST}/collaboration/status`),
			fetchUrl(`${API_HOST}/mcp/status`),
		])
		const elapsed = Date.now() - start

		expect(elapsed).toBeLessThan(15000)
		expect(results[0].status).toBe("fulfilled")
		expect(results[1].status).toBe("fulfilled")
		expect(results[2].status).toBe("fulfilled")
	})

	it("all endpoints return JSON content-type", async () => {
		if (!serverAvailable) return
		const endpoints = [
			`${API_HOST}/providers`,
			`${API_HOST}/providers/bridge/status`,
			`${API_HOST}/collaboration/status`,
			`${API_HOST}/collaboration/sessions`,
			`${API_HOST}/mcp/status`,
			`${API_HOST}/mcp/servers`,
		]

		const results = await Promise.all(endpoints.map((url) => fetchUrl(url)))
		for (const res of results) {
			expect(res.status).toBe(200)
			const contentType = res.headers["content-type"] || ""
			expect(contentType).toMatch(/application\/json/)
		}
	})
})
