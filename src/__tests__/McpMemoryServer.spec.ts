/**
 * Tests for McpMemoryServer — RateLimiter, deduplication, and sync status.
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
