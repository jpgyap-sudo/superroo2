/**
 * Super Roo — Phase 6: Crawler Agent
 *
 * Self-learning data ingestion for trading signals, news, social, and dev sources.
 *
 * Pipeline: Crawl → Clean → Extract → Analyze → Score → Signal
 *
 * Sources:
 *   - News sites (RSS / HTML)
 *   - Market data APIs (REST / WebSocket)
 *   - Social signals (Twitter/X, Reddit, Discord webhooks)
 *   - Dev sources (GitHub trending, HN, StackOverflow)
 */

export interface CrawlSource {
	id: string
	name: string
	url: string
	type: "rss" | "api" | "html" | "websocket"
	/** How often to crawl (ms) */
	intervalMs: number
	/** Headers or auth tokens */
	headers?: Record<string, string>
	/** Optional: only crawl if this filter passes */
	filter?: (content: string) => boolean
}

export interface RawDocument {
	sourceId: string
	url: string
	title?: string
	content: string
	fetchedAt: number
}

export interface ExtractedEntity {
	type: "ticker" | "sentiment" | "keyword" | "url" | "mention"
	value: string
	score: number // 0-1 confidence
}

export interface Signal {
	id: string
	type: "trading" | "news_alert" | "strategy" | "dev_trend"
	sourceIds: string[]
	entities: ExtractedEntity[]
	score: number // aggregated 0-1
	createdAt: number
	payload: Record<string, unknown>
}

export interface CrawlerAgentOptions {
	/** Optional callback invoked when a scheduled crawl fails. */
	onError?: (sourceId: string, error: Error) => void
}

export class CrawlerAgent {
	private sources: Map<string, CrawlSource> = new Map()
	private docs: RawDocument[] = []
	private signals: Signal[] = []
	private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
	private running = false
	private errorCounts: Map<string, number> = new Map()

	constructor(private readonly options: CrawlerAgentOptions = {}) {}

	/** Register a new crawl source. */
	addSource(source: CrawlSource): void {
		this.sources.set(source.id, source)
		if (this.running) {
			this.startSource(source.id)
		}
	}

	removeSource(id: string): void {
		this.stopSource(id)
		this.sources.delete(id)
	}

	/** Start the crawler scheduler. */
	start(): void {
		if (this.running) return
		this.running = true
		for (const id of this.sources.keys()) {
			this.startSource(id)
		}
	}

	/** Stop all scheduled crawls. */
	stop(): void {
		this.running = false
		for (const id of this.sources.keys()) {
			this.stopSource(id)
		}
	}

	/** Get latest signals, newest first. */
	getSignals(limit = 50): Signal[] {
		return this.signals.slice(-limit).reverse()
	}

	/** Get raw documents, newest first. */
	getDocuments(limit = 100): RawDocument[] {
		return this.docs.slice(-limit).reverse()
	}

	/** Manual crawl a single source (for on-demand refresh). */
	async crawl(sourceId: string): Promise<RawDocument[]> {
		const source = this.sources.get(sourceId)
		if (!source) throw new Error(`Unknown source: ${sourceId}`)

		const docs = await this.fetchSource(source)
		this.docs.push(...docs)
		// Trim memory
		if (this.docs.length > 5000) this.docs = this.docs.slice(-2500)

		// Run pipeline
		for (let i = 0; i < docs.length; i++) {
			const doc = docs[i]
			const cleaned = this.clean(doc)
			const entities = this.extract(cleaned)
			const score = this.analyze(entities)
			if (score > 0.6) {
				this.emitSignal({
					id: `${sourceId}_${doc.fetchedAt}_${i}`,
					type: this.inferSignalType(source),
					sourceIds: [sourceId],
					entities,
					score,
					createdAt: doc.fetchedAt,
					payload: { title: doc.title, url: doc.url },
				})
			}
		}

		return docs
	}

	// ── Scheduler ─────────────────────────────────────────────────────────────

	private startSource(id: string): void {
		this.stopSource(id)
		const source = this.sources.get(id)!
		const timer = setInterval(() => {
			this.crawl(id).catch((err) => {
				const error = err instanceof Error ? err : new Error(String(err))
				const count = (this.errorCounts.get(id) ?? 0) + 1
				this.errorCounts.set(id, count)
				this.options.onError?.(id, error)
			})
		}, source.intervalMs)
		this.timers.set(id, timer)
	}

	private stopSource(id: string): void {
		const t = this.timers.get(id)
		if (t) {
			clearInterval(t)
			this.timers.delete(id)
		}
	}

	// ── Fetch ─────────────────────────────────────────────────────────────────

	private async fetchSource(source: CrawlSource): Promise<RawDocument[]> {
		const now = Date.now()
		const res = await this.fetch(source.url, { headers: source.headers })
		if (!res.ok) {
			throw new Error(`Failed to fetch ${source.url}: ${res.status} ${res.statusText}`)
		}
		const text = await res.text()

		if (source.filter && !source.filter(text)) return []

		if (source.type === "rss") {
			return this.parseRss(text, source.id, now)
		}

		// For HTML or API, treat the whole response as one document
		return [
			{
				sourceId: source.id,
				url: source.url,
				title: source.name,
				content: text,
				fetchedAt: now,
			},
		]
	}

	private parseRss(xml: string, sourceId: string, now: number): RawDocument[] {
		const items: RawDocument[] = []
		// Minimal regex-based RSS parser (no external XML dep)
		// No global flag to avoid lastIndex state pollution
		const itemRe = /<item>[\s\S]*?<\/item>/
		const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/
		const linkRe = /<link>(.*?)<\/link>/
		const descRe = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/

		let remaining = xml
		while (true) {
			const m = itemRe.exec(remaining)
			if (!m) break
			const block = m[0]
			const title = titleRe.exec(block)?.[1]?.trim() ?? ""
			const url = linkRe.exec(block)?.[1]?.trim() ?? ""
			const desc = descRe.exec(block)?.[1]?.trim() ?? ""
			items.push({
				sourceId,
				url,
				title,
				content: `${title}\n${desc}`,
				fetchedAt: now,
			})
			remaining = remaining.slice(m.index + block.length)
		}
		return items
	}

	// ── Pipeline: Clean → Extract → Analyze ───────────────────────────────────

	private clean(doc: RawDocument): string {
		// Strip HTML tags, collapse whitespace, lowercase
		return doc.content
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
	}

	private extract(text: string): ExtractedEntity[] {
		const entities: ExtractedEntity[] = []

		// Tickers: $BTC, $ETH, $AAPL, etc.
		const tickerRe = /\$([a-z]{1,5})\b/gi
		let m: RegExpExecArray | null
		while ((m = tickerRe.exec(text)) !== null) {
			entities.push({ type: "ticker", value: m[1].toUpperCase(), score: 0.9 })
		}

		// Sentiment words
		const posWords = ["bullish", "moon", "breakout", "surge", "rally", "gain", "profit", "buy"]
		const negWords = ["bearish", "crash", "dump", "collapse", "sell", "loss", "scam", "hack"]
		for (const w of posWords) {
			if (text.includes(w)) entities.push({ type: "sentiment", value: `positive:${w}`, score: 0.8 })
		}
		for (const w of negWords) {
			if (text.includes(w)) entities.push({ type: "sentiment", value: `negative:${w}`, score: 0.8 })
		}

		// Keywords: crypto, trading, ai, etc.
		const keywords = ["crypto", "trading", "blockchain", "ai", "ml", "neural", "defi", "nft"]
		for (const kw of keywords) {
			if (text.includes(kw)) entities.push({ type: "keyword", value: kw, score: 0.7 })
		}

		return entities
	}

	private analyze(entities: ExtractedEntity[]): number {
		if (entities.length === 0) return 0
		// Simple scoring: average confidence weighted by entity type
		let score = 0
		for (const e of entities) {
			if (e.type === "ticker") score += e.score * 1.2
			else if (e.type === "sentiment") score += e.score * 1.0
			else score += e.score * 0.8
		}
		return Math.min(score / Math.max(entities.length * 0.8, 1), 1)
	}

	private inferSignalType(source: CrawlSource): Signal["type"] {
		if (source.name.toLowerCase().includes("news")) return "news_alert"
		if (source.name.toLowerCase().includes("dev") || source.name.toLowerCase().includes("github"))
			return "dev_trend"
		return "trading"
	}

	private emitSignal(signal: Signal): void {
		this.signals.push(signal)
		if (this.signals.length > 2000) this.signals = this.signals.slice(-1000)
	}

	private async fetch(url: string, opts?: { headers?: Record<string, string> }): Promise<Response> {
		return globalThis.fetch(url, { headers: opts?.headers })
	}
}
