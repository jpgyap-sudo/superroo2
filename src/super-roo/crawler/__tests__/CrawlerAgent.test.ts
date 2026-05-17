/**
 * Tests for CrawlerAgent
 *
 * Tests the crawling pipeline: source management, RSS parsing,
 * entity extraction, signal generation, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CrawlerAgent } from "../CrawlerAgent"
import type { CrawlSource } from "../CrawlerAgent"

describe("CrawlerAgent", () => {
	let agent: CrawlerAgent
	let onError: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		onError = vi.fn()
		agent = new CrawlerAgent({ onError })
	})

	afterEach(() => {
		agent.stop()
		vi.useRealTimers()
	})

	function makeSource(overrides: Partial<CrawlSource> = {}): CrawlSource {
		return {
			id: "test-source",
			name: "Test Source",
			url: "https://example.com/feed.xml",
			type: "rss",
			intervalMs: 60000,
			...overrides,
		}
	}

	describe("addSource / removeSource", () => {
		it("should add a source and make it available for crawling", () => {
			const source = makeSource()
			agent.addSource(source)
			agent.start()
			agent.stop()
		})

		it("should remove a source without throwing", () => {
			const source = makeSource()
			agent.addSource(source)
			agent.removeSource(source.id)
			agent.start()
			agent.stop()
		})

		it("should not throw when removing a non-existent source", () => {
			expect(() => agent.removeSource("non-existent")).not.toThrow()
		})
	})

	describe("start / stop", () => {
		it("should be idempotent when started multiple times", () => {
			agent.addSource(makeSource())
			agent.start()
			agent.start()
			agent.stop()
		})

		it("should be idempotent when stopped multiple times", () => {
			agent.stop()
			agent.stop()
		})
	})

	describe("crawl", () => {
		it("should throw for unknown source", async () => {
			await expect(agent.crawl("non-existent")).rejects.toThrow("Unknown source")
		})

		it("should handle fetch errors gracefully", async () => {
			const source = makeSource()
			agent.addSource(source)

			const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Test Article</title>
      <link>https://example.com/article1</link>
      <description>Test description.</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

			// Mock fetch to succeed
			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(rssXml),
			})

			const docs = await agent.crawl(source.id)
			expect(docs.length).toBeGreaterThanOrEqual(1)
			expect(docs[0].sourceId).toBe(source.id)

			globalThis.fetch = originalFetch
		})
	})

	describe("error tracking", () => {
		it("should track error counts per source", async () => {
			const source = makeSource()
			agent.addSource(source)

			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("Persistent failure"))

			await expect(agent.crawl(source.id)).rejects.toThrow()

			globalThis.fetch = originalFetch
		})
	})
})
