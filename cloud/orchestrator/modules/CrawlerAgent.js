/**
 * Super Roo — Cloud Crawler Agent
 *
 * Port of src/super-roo/crawler/CrawlerAgent.ts
 *
 * Self-learning data ingestion for trading signals, news, social, and dev sources.
 * Pipeline: Crawl → Clean → Extract → Analyze → Score → Signal
 */

const DEFAULT_MAX_DOCS = 5000
const DEFAULT_MAX_SIGNALS = 2000
const SIGNAL_SCORE_THRESHOLD = 0.6

/**
 * @typedef {Object} CrawlSource
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {"rss"|"api"|"html"|"websocket"} type
 * @property {number} intervalMs - How often to crawl (ms)
 * @property {Record<string,string>} [headers]
 * @property {(content: string) => boolean} [filter]
 */

/**
 * @typedef {Object} RawDocument
 * @property {string} sourceId
 * @property {string} url
 * @property {string} [title]
 * @property {string} content
 * @property {number} fetchedAt
 */

/**
 * @typedef {Object} ExtractedEntity
 * @property {"ticker"|"sentiment"|"keyword"|"url"|"mention"} type
 * @property {string} value
 * @property {number} score - 0-1 confidence
 */

/**
 * @typedef {Object} Signal
 * @property {string} id
 * @property {"trading"|"news_alert"|"strategy"|"dev_trend"} type
 * @property {string[]} sourceIds
 * @property {ExtractedEntity[]} entities
 * @property {number} score - aggregated 0-1
 * @property {number} createdAt
 * @property {Record<string,unknown>} payload
 */

class CrawlerAgent {
	/**
	 * @param {Object} [options]
	 * @param {(sourceId: string, error: Error) => void} [options.onError]
	 */
	constructor(options = {}) {
		/** @type {Map<string, CrawlSource>} */
		this.sources = new Map()
		/** @type {RawDocument[]} */
		this.docs = []
		/** @type {Signal[]} */
		this.signals = []
		/** @type {Map<string, ReturnType<typeof setInterval>>} */
		this.timers = new Map()
		this.running = false
		/** @type {Map<string, number>} */
		this.errorCounts = new Map()
		this.options = options
	}

	/**
	 * Register a new crawl source.
	 * @param {CrawlSource} source
	 */
	addSource(source) {
		this.sources.set(source.id, source)
		if (this.running) {
			this._startSource(source.id)
		}
	}

	/**
	 * Remove a crawl source.
	 * @param {string} id
	 */
	removeSource(id) {
		this._stopSource(id)
		this.sources.delete(id)
	}

	/** Start the crawler scheduler. */
	start() {
		if (this.running) return
		this.running = true
		for (const id of this.sources.keys()) {
			this._startSource(id)
		}
	}

	/** Stop all scheduled crawls. */
	stop() {
		this.running = false
		for (const id of this.sources.keys()) {
			this._stopSource(id)
		}
	}

	/**
	 * Get latest signals, newest first.
	 * @param {number} [limit=50]
	 * @returns {Signal[]}
	 */
	getSignals(limit = 50) {
		return this.signals.slice(-limit).reverse()
	}

	/**
	 * Get raw documents, newest first.
	 * @param {number} [limit=100]
	 * @returns {RawDocument[]}
	 */
	getDocuments(limit = 100) {
		return this.docs.slice(-limit).reverse()
	}

	/**
	 * Get stats about the crawler.
	 * @returns {{ sourceCount: number, docCount: number, signalCount: number, running: boolean, errorCounts: Record<string, number> }}
	 */
	getStats() {
		const errorMap = {}
		for (const [id, count] of this.errorCounts) {
			errorMap[id] = count
		}
		return {
			sourceCount: this.sources.size,
			docCount: this.docs.length,
			signalCount: this.signals.length,
			running: this.running,
			errorCounts: errorMap,
		}
	}

	/**
	 * Manual crawl a single source (for on-demand refresh).
	 * @param {string} sourceId
	 * @returns {Promise<RawDocument[]>}
	 */
	async crawl(sourceId) {
		const source = this.sources.get(sourceId)
		if (!source) throw new Error(`Unknown source: ${sourceId}`)

		const docs = await this._fetchSource(source)
		this.docs.push(...docs)
		if (this.docs.length > DEFAULT_MAX_DOCS) {
			this.docs = this.docs.slice(-Math.floor(DEFAULT_MAX_DOCS / 2))
		}

		for (let i = 0; i < docs.length; i++) {
			const doc = docs[i]
			const cleaned = this._clean(doc)
			const entities = this._extract(cleaned)
			const score = this._analyze(entities)
			if (score > SIGNAL_SCORE_THRESHOLD) {
				this._emitSignal({
					id: `${sourceId}_${doc.fetchedAt}_${i}`,
					type: this._inferSignalType(source),
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

	/**
	 * @param {string} id
	 * @private
	 */
	_startSource(id) {
		this._stopSource(id)
		const source = this.sources.get(id)
		if (!source) return
		const timer = setInterval(() => {
			this.crawl(id).catch((err) => {
				const error = err instanceof Error ? err : new Error(String(err))
				const count = (this.errorCounts.get(id) ?? 0) + 1
				this.errorCounts.set(id, count)
				if (this.options.onError) this.options.onError(id, error)
			})
		}, source.intervalMs)
		this.timers.set(id, timer)
	}

	/**
	 * @param {string} id
	 * @private
	 */
	_stopSource(id) {
		const t = this.timers.get(id)
		if (t) {
			clearInterval(t)
			this.timers.delete(id)
		}
	}

	// ── Fetch ─────────────────────────────────────────────────────────────────

	/**
	 * @param {CrawlSource} source
	 * @returns {Promise<RawDocument[]>}
	 * @private
	 */
	async _fetchSource(source) {
		const now = Date.now()
		const res = await this._fetch(source.url, { headers: source.headers })
		if (!res.ok) {
			throw new Error(`Failed to fetch ${source.url}: ${res.status} ${res.statusText}`)
		}
		const text = await res.text()

		if (source.filter && !source.filter(text)) return []

		if (source.type === "rss") {
			return this._parseRss(text, source.id, now)
		}

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

	/**
	 * Minimal regex-based RSS parser (no external XML dep).
	 * @param {string} xml
	 * @param {string} sourceId
	 * @param {number} now
	 * @returns {RawDocument[]}
	 * @private
	 */
	_parseRss(xml, sourceId, now) {
		const items = []
		const itemRe = /<item>[\s\S]*?<\/item>/g
		const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/
		const linkRe = /<link>(.*?)<\/link>/
		const descRe = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/

		let m
		while ((m = itemRe.exec(xml)) !== null) {
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
		}
		return items
	}

	// ── Pipeline: Clean → Extract → Analyze ───────────────────────────────────

	/**
	 * Strip HTML tags, collapse whitespace, lowercase.
	 * @param {RawDocument} doc
	 * @returns {string}
	 * @private
	 */
	_clean(doc) {
		return doc.content
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
	}

	/**
	 * Extract entities from cleaned text.
	 * @param {string} text
	 * @returns {ExtractedEntity[]}
	 * @private
	 */
	_extract(text) {
		const entities = []

		// Tickers: $BTC, $ETH, $AAPL, etc.
		const tickerRe = /\$([a-z]{1,5})\b/gi
		let m
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

		// Keywords
		const keywords = ["crypto", "trading", "blockchain", "ai", "ml", "neural", "defi", "nft"]
		for (const kw of keywords) {
			if (text.includes(kw)) entities.push({ type: "keyword", value: kw, score: 0.7 })
		}

		return entities
	}

	/**
	 * Score entities. Returns 0-1.
	 * @param {ExtractedEntity[]} entities
	 * @returns {number}
	 * @private
	 */
	_analyze(entities) {
		if (entities.length === 0) return 0
		let score = 0
		for (const e of entities) {
			if (e.type === "ticker") score += e.score * 1.2
			else if (e.type === "sentiment") score += e.score * 1.0
			else score += e.score * 0.8
		}
		return Math.min(score / Math.max(entities.length * 0.8, 1), 1)
	}

	/**
	 * @param {CrawlSource} source
	 * @returns {Signal["type"]}
	 * @private
	 */
	_inferSignalType(source) {
		const name = source.name.toLowerCase()
		if (name.includes("news")) return "news_alert"
		if (name.includes("dev") || name.includes("github")) return "dev_trend"
		return "trading"
	}

	/**
	 * @param {Signal} signal
	 * @private
	 */
	_emitSignal(signal) {
		this.signals.push(signal)
		if (this.signals.length > DEFAULT_MAX_SIGNALS) {
			this.signals = this.signals.slice(-Math.floor(DEFAULT_MAX_SIGNALS / 2))
		}
	}

	/**
	 * @param {string} url
	 * @param {Object} [opts]
	 * @param {Record<string,string>} [opts.headers]
	 * @returns {Promise<Response>}
	 * @private
	 */
	async _fetch(url, opts) {
		return globalThis.fetch(url, { headers: opts?.headers })
	}
}

module.exports = { CrawlerAgent }
