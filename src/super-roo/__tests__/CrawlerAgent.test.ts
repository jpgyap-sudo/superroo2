import { afterEach, describe, expect, it, vi } from "vitest"

import { CrawlerAgent } from "../crawler/CrawlerAgent"

describe("CrawlerAgent", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("reports scheduled crawl fetch failures through onError", async () => {
		vi.useFakeTimers()
		const fetchError = new Error("network down")
		vi.spyOn(globalThis, "fetch").mockRejectedValue(fetchError)
		const onError = vi.fn()
		const crawler = new CrawlerAgent({ onError })

		crawler.addSource({
			id: "news",
			name: "News",
			url: "https://example.invalid/feed.xml",
			type: "rss",
			intervalMs: 100,
		})
		crawler.start()

		await vi.advanceTimersByTimeAsync(100)

		expect(onError).toHaveBeenCalledWith("news", fetchError)
		crawler.stop()
	})

	it("rejects manual crawls on non-OK responses", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: vi.fn(),
		} as unknown as Response)
		const crawler = new CrawlerAgent()
		crawler.addSource({
			id: "api",
			name: "API",
			url: "https://example.invalid/api",
			type: "api",
			intervalMs: 1000,
		})

		await expect(crawler.crawl("api")).rejects.toThrow("Failed to fetch")
	})
})
