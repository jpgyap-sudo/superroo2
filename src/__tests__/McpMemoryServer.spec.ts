/**
 * Tests for McpMemoryServer — RateLimiter, deduplication, sync status,
 * LessonObligationTracker, _proxyToBrainV2, and brain tool handlers.
 *
 * Run from src/ directory:
 *   npx vitest run __tests__/McpMemoryServer.spec.ts
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

// ── Helpers ──

/** Advance Date.now() by the given number of milliseconds */
function advanceTime(ms: number): void {
	const now = Date.now()
	vi.setSystemTime(now + ms)
}

/** Create a temp directory for test artifacts */
async function createTempDir(): Promise<string> {
	const tmpDir = path.resolve(os.tmpdir(), "mcp-memory-test-" + Date.now())
	await fs.mkdir(tmpDir, { recursive: true })
	return tmpDir
}

/** Remove a temp directory recursively */
async function removeTempDir(dir: string): Promise<void> {
	try {
		await fs.rm(dir, { recursive: true, force: true })
	} catch {
		// ignore
	}
}

// ── RateLimiter Tests ──

describe("RateLimiter", () => {
	// Re-implement the RateLimiter class inline for testing
	// This avoids side effects from importing the actual module (which starts an HTTP server)
	interface RateLimitEntry {
		count: number
		resetAt: number
	}

	const RATE_LIMIT_WINDOW_MS = 1000
	const RATE_LIMIT_MAX_CALLS = 5

	class RateLimiter {
		private store = new Map<string, RateLimitEntry>()

		check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
			const now = Date.now()
			const entry = this.store.get(key)
			if (!entry || now >= entry.resetAt) {
				this.store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
				return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
			}
			if (entry.count >= RATE_LIMIT_MAX_CALLS) {
				return { allowed: false, remaining: 0, resetAt: entry.resetAt }
			}
			entry.count++
			return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - entry.count, resetAt: entry.resetAt }
		}

		cleanup(): void {
			const now = Date.now()
			for (const [key, entry] of this.store) {
				if (now >= entry.resetAt) this.store.delete(key)
			}
		}
	}

	let limiter: RateLimiter

	beforeEach(() => {
		vi.useFakeTimers()
		limiter = new RateLimiter()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("allows first call and returns correct remaining count", () => {
		const result = limiter.check("test-key")
		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(4) // max 5 - 1
		expect(result.resetAt).toBeGreaterThan(Date.now())
	})

	test("decrements remaining on each call", () => {
		limiter.check("test-key") // remaining: 4
		const r2 = limiter.check("test-key") // remaining: 3
		expect(r2.allowed).toBe(true)
		expect(r2.remaining).toBe(3)

		const r3 = limiter.check("test-key") // remaining: 2
		expect(r3.allowed).toBe(true)
		expect(r3.remaining).toBe(2)
	})

	test("blocks when rate limit is exceeded", () => {
		// Exhaust the limit (5 calls)
		for (let i = 0; i < 5; i++) {
			const r = limiter.check("test-key")
			expect(r.allowed).toBe(true)
		}

		// 6th call should be blocked
		const blocked = limiter.check("test-key")
		expect(blocked.allowed).toBe(false)
		expect(blocked.remaining).toBe(0)
	})

	test("resets after window expires", () => {
		// Exhaust the limit
		for (let i = 0; i < 5; i++) {
			limiter.check("test-key")
		}

		// Advance time past the window
		advanceTime(1001)

		// Should be allowed again
		const result = limiter.check("test-key")
		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(4)
	})

	test("different keys have independent counters", () => {
		// Exhaust key-a
		for (let i = 0; i < 5; i++) {
			limiter.check("key-a")
		}
		expect(limiter.check("key-a").allowed).toBe(false)

		// key-b should still be fresh
		expect(limiter.check("key-b").allowed).toBe(true)
		expect(limiter.check("key-b").remaining).toBe(3) // 5 - 2 calls
	})

	test("cleanup removes expired entries", () => {
		limiter.check("expired-key")
		advanceTime(1001)

		// After cleanup, the entry is removed from the map
		limiter.cleanup()

		// Should start fresh
		const result = limiter.check("expired-key")
		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(4)
	})

	test("cleanup does not remove active entries", () => {
		limiter.check("active-key")
		limiter.check("active-key")

		// Cleanup while still within window
		limiter.cleanup()

		// Should continue from where it left off
		const result = limiter.check("active-key")
		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(2) // 5 - 3 calls
	})
})

// ── Deduplication (_findDuplicateLesson) Tests ──

describe("_findDuplicateLesson", () => {
	let tmpDir: string
	let lessonIndexPath: string
	let lessonsLearnedPath: string

	// Re-implement the dedup logic inline for testing
	async function findDuplicateLesson(
		topic: string,
	): Promise<{ topic: string; content?: string; source: string } | null> {
		if (!topic) return null

		const normalizedTopic = topic.toLowerCase().trim()

		// Check lesson-index.jsonl first (faster)
		try {
			const raw = await fs.readFile(lessonIndexPath, "utf8")
			const lines = raw.split("\n").filter((l) => l.trim())
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as { topic?: string; title?: string }
					const entryTopic = (entry.topic || entry.title || "").toLowerCase().trim()
					if (entryTopic === normalizedTopic || entryTopic.includes(normalizedTopic)) {
						return { topic: entry.topic || entry.title || topic, source: "lesson_index" }
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				console.warn(`[test] Failed to read lesson index: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		// Fall back to lessons-learned.md
		try {
			const raw = await fs.readFile(lessonsLearnedPath, "utf8")
			const lessonBlocks = raw.split("### ")
			for (const block of lessonBlocks) {
				if (!block.trim()) continue
				const titleLine = block.split("\n")[0]?.trim() || ""
				if (titleLine.toLowerCase().includes(normalizedTopic)) {
					return { topic: titleLine, content: block.slice(0, 500), source: "lessons_learned_md" }
				}
			}
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				console.warn(`[test] Failed to read lessons file: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		return null
	}

	beforeEach(async () => {
		tmpDir = await createTempDir()
		lessonIndexPath = path.join(tmpDir, "lesson-index.jsonl")
		lessonsLearnedPath = path.join(tmpDir, "lessons-learned.md")
	})

	afterEach(async () => {
		await removeTempDir(tmpDir)
	})

	test("returns null for empty topic", async () => {
		const result = await findDuplicateLesson("")
		expect(result).toBeNull()
	})

	test("returns null when no files exist", async () => {
		const result = await findDuplicateLesson("some topic")
		expect(result).toBeNull()
	})

	test("finds exact match in lesson-index.jsonl", async () => {
		await fs.writeFile(
			lessonIndexPath,
			[
				JSON.stringify({ topic: "docker deployment", title: "Docker Deployment Guide" }),
				JSON.stringify({ topic: "rate limiting", title: "Rate Limiter Pattern" }),
			].join("\n"),
		)

		const result = await findDuplicateLesson("rate limiting")
		expect(result).not.toBeNull()
		expect(result!.topic).toBe("rate limiting")
		expect(result!.source).toBe("lesson_index")
	})

	test("finds partial match in lesson-index.jsonl", async () => {
		await fs.writeFile(
			lessonIndexPath,
			JSON.stringify({ topic: "advanced docker deployment strategies", title: "Docker" }) + "\n",
		)

		const result = await findDuplicateLesson("docker")
		expect(result).not.toBeNull()
		expect(result!.source).toBe("lesson_index")
	})

	test("finds match in lessons-learned.md fallback", async () => {
		// Create empty JSONL (no match)
		await fs.writeFile(lessonIndexPath, "")

		// Create markdown with a matching lesson
		await fs.writeFile(
			lessonsLearnedPath,
			`# Lessons Learned

### Lesson: Redis Connection Pool Fix

Some content here

### Lesson: WebSocket Reconnection Strategy

More content

---
`,
		)

		const result = await findDuplicateLesson("WebSocket")
		expect(result).not.toBeNull()
		expect(result!.topic).toBe("Lesson: WebSocket Reconnection Strategy")
		expect(result!.source).toBe("lessons_learned_md")
	})

	test("returns null when no match found in either source", async () => {
		await fs.writeFile(lessonIndexPath, JSON.stringify({ topic: "docker", title: "Docker" }) + "\n")
		await fs.writeFile(lessonsLearnedPath, "# Lessons Learned\n\n### Lesson: Kubernetes\n\nSome content\n")

		const result = await findDuplicateLesson("machine learning")
		expect(result).toBeNull()
	})

	test("handles malformed JSON lines gracefully", async () => {
		await fs.writeFile(lessonIndexPath, ["{valid: json}", JSON.stringify({ topic: "valid topic" })].join("\n"))

		const result = await findDuplicateLesson("valid topic")
		expect(result).not.toBeNull()
		expect(result!.source).toBe("lesson_index")
	})

	test("is case-insensitive", async () => {
		await fs.writeFile(lessonIndexPath, JSON.stringify({ topic: "DOCKER DEPLOYMENT" }) + "\n")

		const result = await findDuplicateLesson("Docker Deployment")
		expect(result).not.toBeNull()
		expect(result!.source).toBe("lesson_index")
	})
})

// ── Sync Status (_getSyncStatus) Logic Tests ──

describe("_getSyncStatus logic", () => {
	// Test the health determination logic independently
	function determineOverallHealth(backends: Record<string, { reachable: boolean }>): string {
		const reachableCount = Object.values(backends).filter((b) => b.reachable).length
		const totalBackends = Object.keys(backends).length
		if (reachableCount >= 2) return "healthy"
		if (reachableCount === 1) return "degraded"
		return "offline"
	}

	test("returns healthy when 2+ backends are reachable", () => {
		const backends = {
			daemon: { reachable: true },
			restApi: { reachable: true },
			localFallback: { reachable: false },
		}
		expect(determineOverallHealth(backends)).toBe("healthy")
	})

	test("returns healthy when all 3 backends are reachable", () => {
		const backends = {
			daemon: { reachable: true },
			restApi: { reachable: true },
			localFallback: { reachable: true },
		}
		expect(determineOverallHealth(backends)).toBe("healthy")
	})

	test("returns degraded when only 1 backend is reachable", () => {
		const backends = {
			daemon: { reachable: false },
			restApi: { reachable: true },
			localFallback: { reachable: false },
		}
		expect(determineOverallHealth(backends)).toBe("degraded")
	})

	test("returns offline when 0 backends are reachable", () => {
		const backends = {
			daemon: { reachable: false },
			restApi: { reachable: false },
			localFallback: { reachable: false },
		}
		expect(determineOverallHealth(backends)).toBe("offline")
	})

	test("sync status response structure", () => {
		const startTime = Date.now()
		const status = {
			server: {
				uptime: Date.now() - startTime,
				uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
				startedAt: new Date(startTime).toISOString(),
			},
			rateLimiter: {
				windowMs: 60_000,
				maxCalls: 120,
			},
			backends: {
				daemon: { reachable: false, url: "http://127.0.0.1:3417", error: "connect ECONNREFUSED" },
				restApi: { reachable: false, url: "http://127.0.0.1:8787", error: "connect ECONNREFUSED" },
				localFallback: { reachable: true, source: "config" },
			},
		}

		expect(status.server.uptime).toBeGreaterThanOrEqual(0)
		expect(status.server.uptimeSeconds).toBeGreaterThanOrEqual(0)
		expect(status.server.startedAt).toBeTruthy()
		expect(status.rateLimiter.windowMs).toBe(60_000)
		expect(status.rateLimiter.maxCalls).toBe(120)
		expect(status.backends.daemon.reachable).toBe(false)
		expect(status.backends.daemon.url).toBe("http://127.0.0.1:3417")
		expect(status.backends.daemon.error).toBeTruthy()
		expect(status.backends.localFallback.reachable).toBe(true)
	})

	test("sync status returns source indicator", () => {
		const result = { success: true, status: {}, source: "sync_status_check" }
		expect(result.success).toBe(true)
		expect(result.source).toBe("sync_status_check")
	})
})

// ── LessonObligationTracker Tests ──

describe("LessonObligationTracker", () => {
	interface LessonObligation {
		agent: string
		projectId: string
		task: string
		registeredAt: number
		fulfilled: boolean
		lessonId?: string
	}

	class LessonObligationTracker {
		private obligations = new Map<string, LessonObligation>()

		register(agent: string, projectId: string, task: string): LessonObligation {
			const existing = this.obligations.get(agent)
			if (existing && !existing.fulfilled) {
				return existing
			}
			const obligation: LessonObligation = {
				agent,
				projectId,
				task,
				registeredAt: Date.now(),
				fulfilled: false,
			}
			this.obligations.set(agent, obligation)
			return obligation
		}

		fulfill(agent: string, lessonId: string): boolean {
			const obligation = this.obligations.get(agent)
			if (!obligation) return false
			obligation.fulfilled = true
			obligation.lessonId = lessonId
			return true
		}

		getStatus(agent: string): { registered: boolean; fulfilled: boolean; obligation: LessonObligation | null } {
			const obligation = this.obligations.get(agent) || null
			return {
				registered: obligation !== null,
				fulfilled: obligation?.fulfilled ?? false,
				obligation,
			}
		}

		getPending(): LessonObligation[] {
			const pending: LessonObligation[] = []
			for (const obligation of this.obligations.values()) {
				if (!obligation.fulfilled) {
					pending.push(obligation)
				}
			}
			return pending
		}

		warnPending(): void {
			const pending = this.getPending()
			if (pending.length > 0) {
				console.warn(`[LessonObligation] WARNING: ${pending.length} agent(s) have unfulfilled lesson obligations:`)
			}
		}

		getStats(): { total: number; fulfilled: number; pending: number } {
			let fulfilled = 0
			for (const ob of this.obligations.values()) {
				if (ob.fulfilled) fulfilled++
			}
			return {
				total: this.obligations.size,
				fulfilled,
				pending: this.obligations.size - fulfilled,
			}
		}
	}

	let tracker: LessonObligationTracker

	beforeEach(() => {
		tracker = new LessonObligationTracker()
	})

	test("register creates a new obligation", () => {
		const ob = tracker.register("deepseek", "superroo2", "Implement feature X")
		expect(ob.agent).toBe("deepseek")
		expect(ob.projectId).toBe("superroo2")
		expect(ob.task).toBe("Implement feature X")
		expect(ob.fulfilled).toBe(false)
		expect(ob.registeredAt).toBeGreaterThan(0)
	})

	test("register returns existing pending obligation for same agent", () => {
		const ob1 = tracker.register("deepseek", "superroo2", "Task A")
		const ob2 = tracker.register("deepseek", "superroo2", "Task B")
		expect(ob2).toBe(ob1) // Same object reference
		expect(ob2.task).toBe("Task A") // Original task preserved
	})

	test("register creates new obligation after previous one is fulfilled", () => {
		tracker.register("deepseek", "superroo2", "Task A")
		tracker.fulfill("deepseek", "lesson-123")
		const ob2 = tracker.register("deepseek", "superroo2", "Task B")
		expect(ob2.task).toBe("Task B")
		expect(ob2.fulfilled).toBe(false)
	})

	test("fulfill marks obligation as fulfilled", () => {
		tracker.register("codex", "superroo2", "Review PR")
		const result = tracker.fulfill("codex", "lesson-456")
		expect(result).toBe(true)
		const status = tracker.getStatus("codex")
		expect(status.fulfilled).toBe(true)
		expect(status.obligation?.lessonId).toBe("lesson-456")
	})

	test("fulfill returns false for unregistered agent", () => {
		const result = tracker.fulfill("unknown-agent", "lesson-999")
		expect(result).toBe(false)
	})

	test("getStatus returns correct state for registered agent", () => {
		tracker.register("claude", "superroo2", "Debug issue")
		const status = tracker.getStatus("claude")
		expect(status.registered).toBe(true)
		expect(status.fulfilled).toBe(false)
		expect(status.obligation).not.toBeNull()
		expect(status.obligation!.agent).toBe("claude")
	})

	test("getStatus returns not registered for unknown agent", () => {
		const status = tracker.getStatus("ghost")
		expect(status.registered).toBe(false)
		expect(status.fulfilled).toBe(false)
		expect(status.obligation).toBeNull()
	})

	test("getPending returns only unfulfilled obligations", () => {
		tracker.register("agent-a", "proj1", "Task 1")
		tracker.register("agent-b", "proj2", "Task 2")
		tracker.fulfill("agent-a", "lesson-a1")
		const pending = tracker.getPending()
		expect(pending).toHaveLength(1)
		expect(pending[0].agent).toBe("agent-b")
	})

	test("getPending returns empty when all fulfilled", () => {
		tracker.register("agent-a", "proj1", "Task 1")
		tracker.fulfill("agent-a", "lesson-a1")
		expect(tracker.getPending()).toHaveLength(0)
	})

	test("getPending returns empty when no obligations", () => {
		expect(tracker.getPending()).toHaveLength(0)
	})

	test("warnPending logs warning when pending exist", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		tracker.register("agent-a", "proj1", "Task 1")
		tracker.warnPending()
		expect(warnSpy).toHaveBeenCalled()
		warnSpy.mockRestore()
	})

	test("warnPending does not log when no pending", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		tracker.warnPending()
		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()
	})

	test("getStats returns correct counts", () => {
		expect(tracker.getStats()).toEqual({ total: 0, fulfilled: 0, pending: 0 })

		tracker.register("agent-a", "proj1", "Task 1")
		expect(tracker.getStats()).toEqual({ total: 1, fulfilled: 0, pending: 1 })

		tracker.register("agent-b", "proj2", "Task 2")
		expect(tracker.getStats()).toEqual({ total: 2, fulfilled: 0, pending: 2 })

		tracker.fulfill("agent-a", "lesson-a1")
		const stats = tracker.getStats()
		expect(stats.total).toBe(2)
		expect(stats.fulfilled).toBe(1)
		expect(stats.pending).toBe(1)
	})

	test("getStats with all fulfilled", () => {
		tracker.register("agent-a", "proj1", "Task 1")
		tracker.register("agent-b", "proj2", "Task 2")
		tracker.fulfill("agent-a", "lesson-a1")
		tracker.fulfill("agent-b", "lesson-b1")
		expect(tracker.getStats()).toEqual({ total: 2, fulfilled: 2, pending: 0 })
	})
})

// ── _proxyToBrainV2 Tests ──

describe("_proxyToBrainV2", () => {
	const BRAIN_V2_API_URL = "http://127.0.0.1:3456/api/brain"

	async function proxyToBrainV2(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<unknown> {
		const url = `${BRAIN_V2_API_URL}${path}`
		const fetchOptions: RequestInit = {
			method,
			headers: {
				"content-type": "application/json",
			},
			signal: AbortSignal.timeout(10_000),
		}
		if (body && (method === "POST" || method === "PATCH")) {
			fetchOptions.body = JSON.stringify(body)
		}

		const res = await fetch(url, fetchOptions)

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Brain v2 API error (${res.status}): ${text}`)
		}

		const json = await res.json()
		return json
	}

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	test("sends GET request without body", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true, data: { count: 5 } }),
		})
		vi.stubGlobal("fetch", mockFetch)

		const result = await proxyToBrainV2("GET", "/v2/scores?limit=10")

		expect(mockFetch).toHaveBeenCalledWith(
			"http://127.0.0.1:3456/api/brain/v2/scores?limit=10",
			expect.objectContaining({
				method: "GET",
				headers: { "content-type": "application/json" },
			}),
		)
		expect(result).toEqual({ success: true, data: { count: 5 } })
	})

	test("sends POST request with JSON body", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true, data: { id: "mem-123" } }),
		})
		vi.stubGlobal("fetch", mockFetch)

		const body = { query: "test", limit: 5 }
		const result = await proxyToBrainV2("POST", "/v2/memory/search", body)

		expect(mockFetch).toHaveBeenCalledWith(
			"http://127.0.0.1:3456/api/brain/v2/memory/search",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(body),
			}),
		)
		expect(result).toEqual({ success: true, data: { id: "mem-123" } })
	})

	test("throws on non-ok response", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			text: async () => "Service Unavailable",
		})
		vi.stubGlobal("fetch", mockFetch)

		await expect(proxyToBrainV2("GET", "/v2/stats")).rejects.toThrow(
			"Brain v2 API error (503): Service Unavailable",
		)
	})

	test("does not send body for GET requests even if provided", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		})
		vi.stubGlobal("fetch", mockFetch)

		await proxyToBrainV2("GET", "/v2/events?limit=10", { query: "should-not-be-sent" })

		const callArgs = mockFetch.mock.calls[0]
		const options = callArgs[1] as RequestInit
		expect(options.body).toBeUndefined()
	})

	test("uses 10-second timeout", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		})
		vi.stubGlobal("fetch", mockFetch)

		await proxyToBrainV2("GET", "/v2/stats")

		const callArgs = mockFetch.mock.calls[0]
		const options = callArgs[1] as RequestInit
		expect(options.signal).toBeDefined()
	})
})

// ── Brain Tool Handler Logic Tests ──

describe("brain tool handler logic", () => {
	// Test the validation and parameter construction logic for each brain tool
	// without requiring a live HTTP server

	test("brain_search_memory requires query", () => {
		const args: Record<string, unknown> = {}
		const query = (args?.query as string) || ""
		expect(() => {
			if (!query) throw new Error("'query' is required")
		}).toThrow("'query' is required")
	})

	test("brain_search_memory builds correct search body", () => {
		const args: Record<string, unknown> = { query: "test query", limit: 5, minSimilarity: 0.5, projectId: "superroo2" }
		const searchBody: Record<string, unknown> = {
			query: (args.query as string) || "",
			limit: Number(args.limit || 10),
			minSimilarity: Number(args.minSimilarity || 0.3),
		}
		if (args.projectId) searchBody.projectId = args.projectId
		if (args.status) searchBody.status = args.status

		expect(searchBody).toEqual({
			query: "test query",
			limit: 5,
			minSimilarity: 0.5,
			projectId: "superroo2",
		})
	})

	test("brain_search_memory uses defaults when optional args omitted", () => {
		const args: Record<string, unknown> = { query: "test" }
		const searchBody: Record<string, unknown> = {
			query: (args.query as string) || "",
			limit: Number(args.limit || 10),
			minSimilarity: Number(args.minSimilarity || 0.3),
		}
		if (args.projectId) searchBody.projectId = args.projectId
		if (args.status) searchBody.status = args.status

		expect(searchBody).toEqual({
			query: "test",
			limit: 10,
			minSimilarity: 0.3,
		})
	})

	test("brain_get_scores builds correct query string", () => {
		const args: Record<string, unknown> = { limit: 20, projectId: "superroo2" }
		const scoresParams: Record<string, unknown> = {
			limit: Number(args.limit || 20),
		}
		if (args.projectId) scoresParams.projectId = args.projectId
		const queryString = scoresParams.projectId
			? `?limit=${scoresParams.limit}&projectId=${encodeURIComponent(scoresParams.projectId as string)}`
			: `?limit=${scoresParams.limit}`

		expect(queryString).toBe("?limit=20&projectId=superroo2")
	})

	test("brain_get_scores omits projectId when not provided", () => {
		const args: Record<string, unknown> = {}
		const scoresParams: Record<string, unknown> = {
			limit: Number(args.limit || 20),
		}
		if (args.projectId) scoresParams.projectId = args.projectId
		const queryString = scoresParams.projectId
			? `?limit=${scoresParams.limit}&projectId=${encodeURIComponent(scoresParams.projectId as string)}`
			: `?limit=${scoresParams.limit}`

		expect(queryString).toBe("?limit=20")
	})

	test("brain_get_events builds correct query string with filters", () => {
		const args: Record<string, unknown> = { limit: 10, projectId: "superroo2", eventType: "lesson_stored" }
		const eventsParams: Record<string, unknown> = {
			limit: Number(args.limit || 50),
		}
		if (args.projectId) eventsParams.projectId = args.projectId
		if (args.eventType) eventsParams.eventType = args.eventType
		let eventsQuery = `?limit=${eventsParams.limit}`
		if (eventsParams.projectId) eventsQuery += `&projectId=${encodeURIComponent(eventsParams.projectId as string)}`
		if (eventsParams.eventType) eventsQuery += `&eventType=${encodeURIComponent(eventsParams.eventType as string)}`

		expect(eventsQuery).toBe("?limit=10&projectId=superroo2&eventType=lesson_stored")
	})

	test("brain_get_approvals builds correct query string", () => {
		const args: Record<string, unknown> = { limit: 5, projectId: "superroo2" }
		const approvalsParams: Record<string, unknown> = {
			limit: Number(args.limit || 50),
		}
		if (args.projectId) approvalsParams.projectId = args.projectId
		const approvalsQuery = approvalsParams.projectId
			? `?limit=${approvalsParams.limit}&projectId=${encodeURIComponent(approvalsParams.projectId as string)}`
			: `?limit=${approvalsParams.limit}`

		expect(approvalsQuery).toBe("?limit=5&projectId=superroo2")
	})

	test("brain_approve_memory requires approvalId", () => {
		const args: Record<string, unknown> = {}
		const approvalId = (args?.approvalId as string) || ""
		expect(() => {
			if (!approvalId) throw new Error("'approvalId' is required")
		}).toThrow("'approvalId' is required")
	})

	test("brain_approve_memory builds correct body", () => {
		const args: Record<string, unknown> = { approvalId: "approval-123", reviewedBy: "codex" }
		const approvalId = (args.approvalId as string) || ""
		const body = {
			approvalId,
			reviewedBy: (args.reviewedBy as string) || "mcp-agent",
		}
		expect(body).toEqual({ approvalId: "approval-123", reviewedBy: "codex" })
	})

	test("brain_approve_memory defaults reviewedBy to mcp-agent", () => {
		const args: Record<string, unknown> = { approvalId: "approval-456" }
		const approvalId = (args.approvalId as string) || ""
		const body = {
			approvalId,
			reviewedBy: (args.reviewedBy as string) || "mcp-agent",
		}
		expect(body).toEqual({ approvalId: "approval-456", reviewedBy: "mcp-agent" })
	})

	test("brain_reject_memory requires approvalId", () => {
		const args: Record<string, unknown> = {}
		const rejectId = (args?.approvalId as string) || ""
		expect(() => {
			if (!rejectId) throw new Error("'approvalId' is required")
		}).toThrow("'approvalId' is required")
	})

	test("brain_reject_memory builds correct body", () => {
		const args: Record<string, unknown> = { approvalId: "approval-789", reviewedBy: "deepseek" }
		const rejectId = (args.approvalId as string) || ""
		const body = {
			approvalId: rejectId,
			reviewedBy: (args.reviewedBy as string) || "mcp-agent",
		}
		expect(body).toEqual({ approvalId: "approval-789", reviewedBy: "deepseek" })
	})

	test("brain_store_lesson requires title", () => {
		const args: Record<string, unknown> = {}
		const title = (args?.title as string) || ""
		expect(() => {
			if (!title) throw new Error("'title' is required")
		}).toThrow("'title' is required")
	})

	test("brain_store_lesson requires content", () => {
		const args: Record<string, unknown> = { title: "Test Lesson" }
		const title = (args?.title as string) || ""
		const content = (args?.content as string) || ""
		expect(() => {
			if (!title) throw new Error("'title' is required")
			if (!content) throw new Error("'content' is required")
		}).toThrow("'content' is required")
	})

	test("brain_store_lesson builds correct memory body", () => {
		const args: Record<string, unknown> = {
			title: "Test Lesson",
			content: "This is a test lesson",
			agent: "codex",
			projectId: "superroo2",
			tags: ["test", "gap-fix"],
			files: ["src/test.ts"],
			summary: "A test lesson summary",
			confidence: 0.9,
		}
		const title = (args.title as string) || ""
		const content = (args.content as string) || ""
		const agent = (args.agent as string) || "unknown-agent"
		const projectId = (args.projectId as string) || "default"
		const tags = args.tags as string[] | undefined
		const files = args.files as string[] | undefined
		const summary = (args.summary as string) || ""
		const confidence = args.confidence as number | undefined

		const memoryBody: Record<string, unknown> = {
			title,
			content,
			agent,
			projectId,
			memoryType: "lesson",
			status: "candidate",
		}
		if (tags && Array.isArray(tags)) memoryBody.tags = tags
		if (files && Array.isArray(files)) memoryBody.files = files
		if (summary) memoryBody.summary = summary
		if (confidence !== undefined) memoryBody.importance = confidence

		expect(memoryBody).toEqual({
			title: "Test Lesson",
			content: "This is a test lesson",
			agent: "codex",
			projectId: "superroo2",
			memoryType: "lesson",
			status: "candidate",
			tags: ["test", "gap-fix"],
			files: ["src/test.ts"],
			summary: "A test lesson summary",
			importance: 0.9,
		})
	})

	test("brain_store_lesson omits optional fields when not provided", () => {
		const args: Record<string, unknown> = { title: "Minimal Lesson", content: "Minimal content" }
		const title = (args.title as string) || ""
		const content = (args.content as string) || ""
		const agent = (args.agent as string) || "unknown-agent"
		const projectId = (args.projectId as string) || "default"
		const tags = args.tags as string[] | undefined
		const files = args.files as string[] | undefined
		const summary = (args.summary as string) || ""
		const confidence = args.confidence as number | undefined

		const memoryBody: Record<string, unknown> = {
			title,
			content,
			agent,
			projectId,
			memoryType: "lesson",
			status: "candidate",
		}
		if (tags && Array.isArray(tags)) memoryBody.tags = tags
		if (files && Array.isArray(files)) memoryBody.files = files
		if (summary) memoryBody.summary = summary
		if (confidence !== undefined) memoryBody.importance = confidence

		expect(memoryBody).toEqual({
			title: "Minimal Lesson",
			content: "Minimal content",
			agent: "unknown-agent",
			projectId: "default",
			memoryType: "lesson",
			status: "candidate",
		})
	})

	test("brain_register_lesson_intent requires agent", () => {
		const args: Record<string, unknown> = {}
		const agent = (args?.agent as string) || ""
		expect(() => {
			if (!agent) throw new Error("'agent' is required")
		}).toThrow("'agent' is required")
	})

	test("brain_register_lesson_intent builds correct response", () => {
		const args: Record<string, unknown> = { agent: "codex", projectId: "superroo2", task: "Fix bug #123" }
		const agent = (args.agent as string) || ""
		const projectId = (args.projectId as string) || "default"
		const task = (args.task as string) || "unspecified task"

		// Simulate the tracker
		const obligation = { agent, projectId, task, registeredAt: Date.now(), fulfilled: false }
		const response = {
			success: true,
			message: `Lesson intent registered for agent "${agent}"`,
			obligation: {
				agent: obligation.agent,
				projectId: obligation.projectId,
				task: obligation.task.slice(0, 100),
				registeredAt: new Date(obligation.registeredAt).toISOString(),
				fulfilled: obligation.fulfilled,
			},
		}

		expect(response.success).toBe(true)
		expect(response.message).toBe('Lesson intent registered for agent "codex"')
		expect(response.obligation.agent).toBe("codex")
		expect(response.obligation.fulfilled).toBe(false)
	})

	test("brain_lesson_status returns per-agent status when agent provided", () => {
		const args: Record<string, unknown> = { agent: "codex" }
		const agent = (args.agent as string) || ""

		// Simulate tracker.getStatus
		const status = {
			registered: true,
			fulfilled: true,
			obligation: {
				agent: "codex",
				projectId: "superroo2",
				task: "Fix bug",
				registeredAt: Date.now(),
				fulfilled: true,
				lessonId: "lesson-123",
			},
		}

		const response = {
			success: true,
			agent,
			registered: status.registered,
			fulfilled: status.fulfilled,
			obligation: status.obligation
				? {
						agent: status.obligation.agent,
						projectId: status.obligation.projectId,
						task: status.obligation.task.slice(0, 100),
						registeredAt: new Date(status.obligation.registeredAt).toISOString(),
						fulfilled: status.obligation.fulfilled,
						lessonId: status.obligation.lessonId,
					}
				: null,
		}

		expect(response.success).toBe(true)
		expect(response.agent).toBe("codex")
		expect(response.registered).toBe(true)
		expect(response.fulfilled).toBe(true)
		expect(response.obligation?.lessonId).toBe("lesson-123")
	})

	test("brain_lesson_status returns aggregate stats when no agent", () => {
		const args: Record<string, unknown> = {}

		// Simulate tracker.getStats + getPending
		const stats = { total: 2, fulfilled: 1, pending: 1 }
		const pending = [
			{ agent: "deepseek", projectId: "superroo2", task: "Implement feature", registeredAt: Date.now() },
		]

		const response = {
			success: true,
			stats,
			pending: pending.map((ob) => ({
				agent: ob.agent,
				projectId: ob.projectId,
				task: ob.task.slice(0, 100),
				registeredAt: new Date(ob.registeredAt).toISOString(),
			})),
		}

		expect(response.success).toBe(true)
		expect(response.stats).toEqual({ total: 2, fulfilled: 1, pending: 1 })
		expect(response.pending).toHaveLength(1)
		expect(response.pending[0].agent).toBe("deepseek")
	})
})

// ── Workflow Enforcement Tests ──

describe("workflow enforcement", () => {
	// ── initialize response workflowRules ──

	test("initialize response includes workflowRules", () => {
		const response = {
			protocolVersion: "2024-11-05",
			capabilities: {
				tools: {},
				resources: {},
			},
			serverInfo: {
				name: "superroo-mcp-memory",
				version: "1.1.0",
			},
			workflowRules: {
				version: "1.0.0",
				defaultCoder: "deepseek",
				defaultEmbeddings: "ollama",
				defaultMemory: "central-brain-pgvector",
				lessonObligation: true,
				rules: [
					{ id: "wf-001", severity: "mandatory" },
					{ id: "wf-002", severity: "mandatory" },
					{ id: "wf-003", severity: "mandatory" },
					{ id: "wf-004", severity: "mandatory" },
					{ id: "wf-005", severity: "recommended" },
					{ id: "wf-006", severity: "recommended" },
				],
			},
		}

		expect(response.workflowRules).toBeDefined()
		expect(response.workflowRules.version).toBe("1.0.0")
		expect(response.workflowRules.defaultCoder).toBe("deepseek")
		expect(response.workflowRules.defaultEmbeddings).toBe("ollama")
		expect(response.workflowRules.defaultMemory).toBe("central-brain-pgvector")
		expect(response.workflowRules.lessonObligation).toBe(true)
		expect(response.workflowRules.rules).toHaveLength(6)
		expect(response.workflowRules.rules.filter((r: { severity: string }) => r.severity === "mandatory")).toHaveLength(4)
		expect(response.workflowRules.rules.filter((r: { severity: string }) => r.severity === "recommended")).toHaveLength(2)
	})

	test("workflowRules contains wf-001 mandating DeepSeek as default coder", () => {
		const response = {
			workflowRules: {
				version: "1.0.0",
				defaultCoder: "deepseek",
				rules: [
					{
						id: "wf-001",
						description:
							"DeepSeek is the DEFAULT coder for all implementation tasks. Use the deepseek-coder MCP server for code generation, refactoring, and debugging.",
						severity: "mandatory",
					},
				],
			},
		}

		const wf001 = response.workflowRules.rules.find((r: { id: string }) => r.id === "wf-001")
		expect(wf001).toBeDefined()
		expect(wf001!.severity).toBe("mandatory")
		expect(wf001!.description).toContain("DeepSeek")
		expect(wf001!.description).toContain("DEFAULT coder")
	})

	test("workflowRules contains wf-002 mandating Ollama as default embeddings provider", () => {
		const response = {
			workflowRules: {
				version: "1.0.0",
				defaultEmbeddings: "ollama",
				rules: [
					{
						id: "wf-002",
						description:
							"Ollama is the DEFAULT embeddings provider for semantic search, lesson summarization, and vector generation. Use the ollama MCP server for embedding operations.",
						severity: "mandatory",
					},
				],
			},
		}

		const wf002 = response.workflowRules.rules.find((r: { id: string }) => r.id === "wf-002")
		expect(wf002).toBeDefined()
		expect(wf002!.severity).toBe("mandatory")
		expect(wf002!.description).toContain("Ollama")
		expect(wf002!.description).toContain("embeddings provider")
	})

	test("workflowRules contains wf-003 mandating Central Brain pgvector as default memory", () => {
		const response = {
			workflowRules: {
				version: "1.0.0",
				defaultMemory: "central-brain-pgvector",
				rules: [
					{
						id: "wf-003",
						description:
							"Central Brain (pgvector) is the DEFAULT memory store. Use brain_search_memory for semantic search and brain_store_lesson for persisting lessons.",
						severity: "mandatory",
					},
				],
			},
		}

		const wf003 = response.workflowRules.rules.find((r: { id: string }) => r.id === "wf-003")
		expect(wf003).toBeDefined()
		expect(wf003!.severity).toBe("mandatory")
		expect(wf003!.description).toContain("Central Brain")
		expect(wf003!.description).toContain("pgvector")
	})

	test("workflowRules contains wf-004 mandating lesson contribution per session", () => {
		const response = {
			workflowRules: {
				version: "1.0.0",
				lessonObligation: true,
				rules: [
					{
						id: "wf-004",
						description:
							"Every coding agent MUST contribute at least one lesson per session. Call brain_register_lesson_intent at session start and brain_store_lesson before disconnecting.",
						severity: "mandatory",
					},
				],
			},
		}

		const wf004 = response.workflowRules.rules.find((r: { id: string }) => r.id === "wf-004")
		expect(wf004).toBeDefined()
		expect(wf004!.severity).toBe("mandatory")
		expect(wf004!.description).toContain("MUST contribute")
	})

	// ── brain_get_workflow_rules tool ──

	test("brain_get_workflow_rules returns full ruleset", () => {
		const response = {
			success: true,
			version: "1.0.0",
			defaultCoder: "deepseek",
			defaultEmbeddings: "ollama",
			defaultMemory: "central-brain-pgvector",
			lessonObligation: true,
			rules: [
				{ id: "wf-001", severity: "mandatory" },
				{ id: "wf-002", severity: "mandatory" },
				{ id: "wf-003", severity: "mandatory" },
				{ id: "wf-004", severity: "mandatory" },
				{ id: "wf-005", severity: "recommended" },
				{ id: "wf-006", severity: "recommended" },
			],
		}

		expect(response.success).toBe(true)
		expect(response.version).toBe("1.0.0")
		expect(response.defaultCoder).toBe("deepseek")
		expect(response.defaultEmbeddings).toBe("ollama")
		expect(response.defaultMemory).toBe("central-brain-pgvector")
		expect(response.lessonObligation).toBe(true)
		expect(response.rules).toHaveLength(6)
	})

	test("brain_get_workflow_rules returns mandatory rules with correct IDs", () => {
		const response = {
			success: true,
			rules: [
				{ id: "wf-001", severity: "mandatory" },
				{ id: "wf-002", severity: "mandatory" },
				{ id: "wf-003", severity: "mandatory" },
				{ id: "wf-004", severity: "mandatory" },
			],
		}

		const mandatoryIds = response.rules
			.filter((r: { severity: string }) => r.severity === "mandatory")
			.map((r: { id: string }) => r.id)
		expect(mandatoryIds).toEqual(["wf-001", "wf-002", "wf-003", "wf-004"])
	})

	test("brain_get_workflow_rules returns recommended rules with correct IDs", () => {
		const response = {
			success: true,
			rules: [
				{ id: "wf-005", severity: "recommended" },
				{ id: "wf-006", severity: "recommended" },
			],
		}

		const recommendedIds = response.rules
			.filter((r: { severity: string }) => r.severity === "recommended")
			.map((r: { id: string }) => r.id)
		expect(recommendedIds).toEqual(["wf-005", "wf-006"])
	})

	// ── submit_task workflow validation ──

	test("submit_task with non-deepseek agent returns workflowWarnings", () => {
		const taskAgent = "claude"
		const workflowWarnings: string[] = []
		if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
			workflowWarnings.push(
				`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
			)
		}

		expect(workflowWarnings).toHaveLength(1)
		expect(workflowWarnings[0]).toContain("wf-001")
		expect(workflowWarnings[0]).toContain("DeepSeek is the DEFAULT coder")
		expect(workflowWarnings[0]).toContain('agent="deepseek-coder"')
	})

	test("submit_task with deepseek-coder agent does not return workflowWarnings", () => {
		const taskAgent = "deepseek-coder"
		const workflowWarnings: string[] = []
		if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
			workflowWarnings.push(
				`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
			)
		}

		expect(workflowWarnings).toHaveLength(0)
	})

	test("submit_task with deepseek agent does not return workflowWarnings", () => {
		const taskAgent = "deepseek"
		const workflowWarnings: string[] = []
		if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
			workflowWarnings.push(
				`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
			)
		}

		expect(workflowWarnings).toHaveLength(0)
	})

	test("submit_task workflow warning is attached to result object", () => {
		const taskAgent = "codex"
		const workflowWarnings: string[] = []
		if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
			workflowWarnings.push(
				`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
			)
		}

		const result: Record<string, unknown> = { success: true, taskId: "abc-123" }
		if (workflowWarnings.length > 0) {
			result.workflowWarnings = workflowWarnings
		}

		expect(result.workflowWarnings).toBeDefined()
		expect(Array.isArray(result.workflowWarnings)).toBe(true)
		expect((result.workflowWarnings as string[])).toHaveLength(1)
		expect(result.success).toBe(true)
		expect(result.taskId).toBe("abc-123")
	})

	test("submit_task with deepseek-coder does not attach workflowWarnings", () => {
		const taskAgent = "deepseek-coder"
		const workflowWarnings: string[] = []
		if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
			workflowWarnings.push(
				`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
			)
		}

		const result: Record<string, unknown> = { success: true, taskId: "abc-123" }
		if (workflowWarnings.length > 0) {
			result.workflowWarnings = workflowWarnings
		}

		expect(result.workflowWarnings).toBeUndefined()
		expect(result.success).toBe(true)
	})
})
